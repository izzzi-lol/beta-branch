// =============================================================================
//  plugin-api.js — Публичный API для плагинов SCIPNET
//
//  Плагин регистрирует себя одним вызовом:
//
//    PluginAPI.register({
//        id:          'dossier-editor',        // уникальный ID (используется в plugin remove)
//        name:        'Редактор Досье',         // отображаемое имя
//        command:     'edit',                  // команда в терминале
//        description: 'Редактор с превью',     // для help
//        version:     '1.0',                   // опционально
//        author:      'izzzi_lol',             // опционально, показывается при установке
//        autostart:   false,                   // опционально — запросить автозапуск
//                                               // при каждой загрузке сайта. Пользователь
//                                               // увидит уведомление при установке и сможет
//                                               // отключить (plugin autostart / Settings).
//        execute:     (args, terminal) => { }  // точка входа команды
//    });
//
//  Доступные объекты сайта:
//    PluginAPI.WindowManager   — открыть/закрыть окна
//    PluginAPI.terminal        — printSystem, printError, lockInput...
//    PluginAPI.renderer        — StepRenderer (рендер досье-текста)
//    PluginAPI.AudioHandler    — звуки интерфейса (playUI)
//
//  Персистентное хранилище (IndexedDB, неймспейс по pluginId):
//    const store = PluginAPI.storage('my-plugin-id');
//    await store.set('key', value);   // строка, объект, data-URL — что угодно
//    await store.get('key');          // → значение или null
//    await store.remove('key');
//    await store.keys();              // → ['key', ...] только этого плагина
//    await store.clear();             // удаляет все данные плагина (авто при plugin remove)
//
//  Загружается ПЕРВЫМ — до plugin-manager.js и до любых плагинов.
// =============================================================================

const PluginAPI = (() => {

    // Реестр: command → { id, name, description, version, execute }
    const _commands = {};

    // =========================================================================
    //  PluginStorage — персистентное хранилище для каждого плагина
    //
    //  Единая IndexedDB на все плагины (scipnet_plugin_storage), один
    //  объектный стор (data), записи с составным ключом "pluginId::key" —
    //  так плагины физически не могут прочитать чужие данные через get(),
    //  а удаление плагина (plugin remove) одним clear() чистит только его.
    //
    //  Подходит для текста, JSON, data-URL изображений и т.п. — всё что
    //  можно положить в IndexedDB. Лимит на порядки больше localStorage
    //  (обычно сотни MB – единицы GB, зависит от браузера/диска).
    // =========================================================================

    const _STORAGE_DB      = 'scipnet_plugin_storage';
    const _STORAGE_VERSION = 1;
    const _STORAGE_STORE   = 'data';

    function _openStorageDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(_STORAGE_DB, _STORAGE_VERSION);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(_STORAGE_STORE)) {
                    db.createObjectStore(_STORAGE_STORE); // ключ передаётся явно в put/get
                }
            };
            req.onsuccess = e => resolve(e.target.result);
            req.onerror   = e => reject(e.target.error);
        });
    }

    const _idbReq = req => new Promise((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror   = () => rej(req.error);
    });

    /**
     * Хранилище одного плагина. Все ключи плагина физически
     * префиксуются "pluginId::", изоляция от других плагинов гарантирована
     * на уровне самого класса — наружу утечь не может.
     */
    class PluginStorage {
        constructor(pluginId) {
            this._id = pluginId;
        }

        _k(key) {
            return `${this._id}::${key}`;
        }

        /** Сохраняет значение (любой структурно-клонируемый тип: строка, объект, data-URL...). */
        async set(key, value) {
            const db = await _openStorageDB();
            try {
                const store = db.transaction(_STORAGE_STORE, 'readwrite').objectStore(_STORAGE_STORE);
                await _idbReq(store.put(value, this._k(key)));
            } finally {
                db.close();
            }
        }

        /** Возвращает значение или null, если ключ не найден. */
        async get(key) {
            const db = await _openStorageDB();
            try {
                const store = db.transaction(_STORAGE_STORE, 'readonly').objectStore(_STORAGE_STORE);
                const val = await _idbReq(store.get(this._k(key)));
                return val === undefined ? null : val;
            } finally {
                db.close();
            }
        }

        /** Удаляет один ключ. */
        async remove(key) {
            const db = await _openStorageDB();
            try {
                const store = db.transaction(_STORAGE_STORE, 'readwrite').objectStore(_STORAGE_STORE);
                await _idbReq(store.delete(this._k(key)));
            } finally {
                db.close();
            }
        }

        /** Список ключей ЭТОГО плагина (без префикса pluginId::). */
        async keys() {
            const db = await _openStorageDB();
            try {
                const store = db.transaction(_STORAGE_STORE, 'readonly').objectStore(_STORAGE_STORE);
                const allKeys = await _idbReq(store.getAllKeys());
                const prefix = this._id + '::';
                return allKeys
                    .filter(k => typeof k === 'string' && k.startsWith(prefix))
                    .map(k => k.slice(prefix.length));
            } finally {
                db.close();
            }
        }

        /** Удаляет ВСЕ данные этого плагина. Вызывается автоматически при plugin remove. */
        async clear() {
            const keys = await this.keys();
            const db = await _openStorageDB();
            try {
                const store = db.transaction(_STORAGE_STORE, 'readwrite').objectStore(_STORAGE_STORE);
                await Promise.all(keys.map(k => _idbReq(store.delete(this._k(k)))));
            } finally {
                db.close();
            }
        }
    }

    // Кеш инстансов — один PluginStorage на pluginId за всю сессию
    const _storageInstances = {};

    /**
     * Возвращает (создавая при необходимости) хранилище для плагина.
     *
     *   const store = PluginAPI.storage('text-editor');
     *   await store.set('draft', content);
     *   const saved = await store.get('draft');
     *   await store.set('img:photo.jpg', dataUrl);
     *   const imgKeys = (await store.keys()).filter(k => k.startsWith('img:'));
     */
    function storage(pluginId) {
        if (!pluginId) {
            console.warn('[PluginAPI] storage(): требуется pluginId');
            return null;
        }
        if (!_storageInstances[pluginId]) {
            _storageInstances[pluginId] = new PluginStorage(pluginId);
        }
        return _storageInstances[pluginId];
    }

    // ── Регистрация ────────────────────────────────────────────────────────────

    /**
     * Регистрирует плагин и его терминальную команду.
     * Вызывается самим плагином при выполнении его кода.
     */
    function register({ id, name, command, description, version = '1.0', author = '—', autostart = false, execute }) {
        if (!id || !command || typeof execute !== 'function') {
            console.warn('[PluginAPI] register(): обязательны id, command и execute');
            return false;
        }

        const cmd = command.trim().toLowerCase();

        if (_commands[cmd]) {
            console.warn(`[PluginAPI] Команда "${cmd}" уже занята плагином "${_commands[cmd].id}"`);
            return false;
        }

        // autostart — пожелание автора плагина: запускать команду автоматически
        // при каждой загрузке сайта. Решение принимается на установке (PluginManager.install),
        // пользователь может в любой момент переключить через "plugin autostart <id>"
        // или Settings → Плагины.
        _commands[cmd] = {
            id, name: name ?? id, description: description ?? '',
            version, author, autostart: autostart === true,
            execute,
        };

        // Добавляем в COMMAND_LIST для автодополнения
        if (Array.isArray(window.COMMAND_LIST) && !window.COMMAND_LIST.includes(cmd)) {
            window.COMMAND_LIST.push(cmd);
        }

        console.log(`[PluginAPI] "${name}" v${version} → команда: ${cmd}`);
        return true;
    }

    /**
     * Возвращает копию реестра команд.
     * Используется PluginManager и _patchCommandHandler.
     */
    function getCommands() {
        return _commands;
    }

    /**
     * Снимает регистрацию команды плагина.
     * Вызывается при plugin remove — чтобы команда не работала до перезагрузки.
     * Возвращает true если команда была найдена и удалена.
     */
    function unregister(pluginId) {
        const cmd = Object.keys(_commands).find(k => _commands[k].id === pluginId);
        if (!cmd) return false;

        delete _commands[cmd];

        // Убираем из COMMAND_LIST
        if (Array.isArray(window.COMMAND_LIST)) {
            const idx = window.COMMAND_LIST.indexOf(cmd);
            if (idx !== -1) window.COMMAND_LIST.splice(idx, 1);
        }

        return true;
    }

    // ── Публичный объект ───────────────────────────────────────────────────────

    return {
        register,
        getCommands,
        unregister,
        storage,

        // const-переменные не попадают в window, поэтому window.X всегда undefined.
        // Используем typeof-guard: безопасно читает любой глобальный идентификатор
        // вне зависимости от того, через var/const/let он объявлен.
        get WindowManager() { return typeof WindowManager !== 'undefined' ? WindowManager : undefined; },
        get terminal()      { return typeof TerminalAPI   !== 'undefined' ? TerminalAPI   : undefined; },
        get renderer()      { return typeof renderer      !== 'undefined' ? renderer      : undefined; },
        get AudioHandler()  { return typeof AudioHandler  !== 'undefined' ? AudioHandler  : undefined; },
    };

})();
