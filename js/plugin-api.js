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
//        execute:     (args, terminal) => { }  // точка входа команды
//    });
//
//  Доступные объекты сайта:
//    PluginAPI.WindowManager   — открыть/закрыть окна
//    PluginAPI.terminal        — printSystem, printError, lockInput...
//    PluginAPI.renderer        — StepRenderer (рендер досье-текста)
//    PluginAPI.AudioHandler    — звуки интерфейса (playUI)
//
//  Загружается ПЕРВЫМ — до plugin-manager.js и до любых плагинов.
// =============================================================================

const PluginAPI = (() => {

    // Реестр: command → { id, name, description, version, execute }
    const _commands = {};

    // ── Регистрация ────────────────────────────────────────────────────────────

    /**
     * Регистрирует плагин и его терминальную команду.
     * Вызывается самим плагином при выполнении его кода.
     */
    function register({ id, name, command, description, version = '1.0', execute }) {
        if (!id || !command || typeof execute !== 'function') {
            console.warn('[PluginAPI] register(): обязательны id, command и execute');
            return false;
        }

        const cmd = command.trim().toLowerCase();

        if (_commands[cmd]) {
            console.warn(`[PluginAPI] Команда "${cmd}" уже занята плагином "${_commands[cmd].id}"`);
            return false;
        }

        _commands[cmd] = { id, name: name ?? id, description: description ?? '', version, execute };

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

    // =========================================================================
    //  Plugin Storage — изолированное персистентное хранилище для плагинов
    //
    //  Каждый плагин получает независимое пространство ключей:
    //    ключи хранятся как  `plugin::<pluginId>::<key>`
    //
    //  База данных:  scipnet_plugin_data  (отдельно от scipnet_plugins)
    //  Object store: data
    //
    //  Поддерживаемые значения: строки, числа, объекты, массивы,
    //  data-URL изображений — всё, что структурно клонируется IndexedDB.
    //  В отличие от localStorage нет ограничения в 5 МБ.
    // =========================================================================

    const _STORAGE_DB      = 'scipnet_plugin_data';
    const _STORAGE_VERSION = 1;
    const _STORAGE_STORE   = 'data';

    class PluginStorage {

        constructor(pluginId) {
            this._ns  = `plugin::${pluginId}::`;
            this._dbP = null; // Promise<IDBDatabase>, ленивое открытие
        }

        // ── Открытие / переиспользование соединения ──────────────────────────

        _open() {
            if (this._dbP) return this._dbP;
            this._dbP = new Promise((resolve, reject) => {
                const req = indexedDB.open(_STORAGE_DB, _STORAGE_VERSION);
                req.onupgradeneeded = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(_STORAGE_STORE)) {
                        db.createObjectStore(_STORAGE_STORE);
                    }
                };
                req.onsuccess = e => resolve(e.target.result);
                req.onerror   = () => {
                    this._dbP = null; // при ошибке — сброс, чтобы retry сработал
                    reject(req.error);
                };
            });
            return this._dbP;
        }

        // ── Публичный API ─────────────────────────────────────────────────────

        /**
         * Читает значение по ключу.
         * @returns {Promise<any>} значение или null если ключ не существует
         */
        async get(key) {
            const db = await this._open();
            return new Promise((resolve, reject) => {
                const req = db.transaction(_STORAGE_STORE, 'readonly')
                              .objectStore(_STORAGE_STORE)
                              .get(this._ns + key);
                req.onsuccess = () => resolve(req.result ?? null);
                req.onerror   = () => reject(req.error);
            });
        }

        /**
         * Сохраняет значение.
         * Строки, числа, объекты, массивы, data-URL — любой структурно клонируемый тип.
         * @returns {Promise<void>}
         */
        async set(key, value) {
            const db = await this._open();
            return new Promise((resolve, reject) => {
                const req = db.transaction(_STORAGE_STORE, 'readwrite')
                              .objectStore(_STORAGE_STORE)
                              .put(value, this._ns + key);
                req.onsuccess = () => resolve();
                req.onerror   = () => reject(req.error);
            });
        }

        /**
         * Удаляет ключ. Не бросает ошибку если ключ не существовал.
         * @returns {Promise<void>}
         */
        async remove(key) {
            const db = await this._open();
            return new Promise((resolve, reject) => {
                const req = db.transaction(_STORAGE_STORE, 'readwrite')
                              .objectStore(_STORAGE_STORE)
                              .delete(this._ns + key);
                req.onsuccess = () => resolve();
                req.onerror   = () => reject(req.error);
            });
        }

        /**
         * Возвращает все ключи этого плагина (без неймспейс-префикса).
         * @returns {Promise<string[]>}
         */
        async keys() {
            const db = await this._open();
            return new Promise((resolve, reject) => {
                // IDBKeyRange.bound с '\uffff' захватывает все ключи с нашим префиксом
                const range = IDBKeyRange.bound(this._ns, this._ns + '\uffff');
                const req   = db.transaction(_STORAGE_STORE, 'readonly')
                                .objectStore(_STORAGE_STORE)
                                .getAllKeys(range);
                req.onsuccess = () =>
                    resolve(req.result.map(k => k.slice(this._ns.length)));
                req.onerror = () => reject(req.error);
            });
        }

        /**
         * Удаляет все данные этого плагина.
         * @returns {Promise<void>}
         */
        async clear() {
            const ks = await this.keys();
            await Promise.all(ks.map(k => this.remove(k)));
        }

        /**
         * Возвращает примерный объём данных в байтах.
         * (строки × 2 байта/символ, остальное — длина JSON-строки × 2)
         * @returns {Promise<number>}
         */
        async size() {
            const ks   = await this.keys();
            const vals = await Promise.all(ks.map(k => this.get(k)));
            return vals.reduce((sum, v) =>
                sum + (typeof v === 'string' ? v.length * 2
                                             : JSON.stringify(v).length * 2), 0);
        }
    }

    // Кеш: один объект PluginStorage на pluginId
    const _storageCache = {};

    /**
     * Возвращает изолированное хранилище для плагина.
     * Повторные вызовы с тем же ID возвращают один и тот же объект.
     *
     * @param   {string} pluginId — тот же ID, что передан в PluginAPI.register({ id })
     * @returns {PluginStorage}
     *
     * @example
     *   const store = PluginAPI.storage('text-editor');
     *   await store.set('draft', content);           // сохранить текст
     *   await store.set('img:photo.jpg', dataUrl);   // сохранить картинку
     *   const draft = await store.get('draft');      // прочитать
     *   const imgs  = await store.keys();            // список ключей
     */
    function storage(pluginId) {
        if (!pluginId) throw new Error('[PluginAPI.storage] pluginId обязателен');
        if (!_storageCache[pluginId]) {
            _storageCache[pluginId] = new PluginStorage(pluginId);
        }
        return _storageCache[pluginId];
    }

    /**
     * Полностью очищает хранилище плагина и удаляет его из кеша.
     * Вызывается из plugin-manager.js при удалении плагина (plugin remove).
     *
     * @param   {string}  pluginId
     * @returns {Promise<void>}
     */
    async function clearStorage(pluginId) {
        if (!pluginId) return;
        await storage(pluginId).clear();
        delete _storageCache[pluginId];
        console.log(`[PluginAPI] Хранилище плагина "${pluginId}" очищено.`);
    }

    // ── Публичный объект ───────────────────────────────────────────────────────

    return {
        register,
        getCommands,
        unregister,
        storage,
        clearStorage,

        // const-переменные не попадают в window, поэтому window.X всегда undefined.
        // Используем typeof-guard: безопасно читает любой глобальный идентификатор
        // вне зависимости от того, через var/const/let он объявлен.
        get WindowManager() { return typeof WindowManager !== 'undefined' ? WindowManager : undefined; },
        get terminal()      { return typeof TerminalAPI   !== 'undefined' ? TerminalAPI   : undefined; },
        get renderer()      { return typeof renderer      !== 'undefined' ? renderer      : undefined; },
        get AudioHandler()  { return typeof AudioHandler  !== 'undefined' ? AudioHandler  : undefined; },
    };

})();
