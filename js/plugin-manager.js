// =============================================================================
//  plugin-manager.js — Менеджер плагинов SCIPNET
//
//  Хранит плагины в IndexedDB.
//  При загрузке страницы восстанавливает все установленные плагины.
//
//  Схема записи:
//    {
//        id:          string,   // ключ (объявляется плагином в PluginAPI.register)
//        name:        string,
//        command:     string,   // имя терминальной команды
//        url:         string,   // откуда был загружен
//        code:        string,   // JS-код плагина
//        version:     string,
//        installedAt: number,
//        updatedAt:   number,
//    }
//
//  Зависит от plugin-api.js — загружается после него.
// =============================================================================

const PluginManager = (() => {

    const DB_NAME    = 'scipnet_plugins';
    const DB_VERSION = 1;
    const STORE      = 'plugins';

    // =========================================================================
    //  IndexedDB — вспомогательный слой
    // =========================================================================

    function _openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = e => resolve(e.target.result);
            req.onerror   = e => reject(e.target.error);
        });
    }

    // Shorthand: db → objectStore (нужный режим)
    const _store = (db, mode = 'readonly') =>
        db.transaction(STORE, mode).objectStore(STORE);

    const _idbGet = (store, key) => new Promise((res, rej) => {
        const r = store.get(key);
        r.onsuccess = () => res(r.result ?? null);
        r.onerror   = () => rej(r.error);
    });

    const _idbGetAll = store => new Promise((res, rej) => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result);
        r.onerror   = () => rej(r.error);
    });

    const _idbPut = (store, value) => new Promise((res, rej) => {
        const r = store.put(value);
        r.onsuccess = () => res(r.result);
        r.onerror   = () => rej(r.error);
    });

    const _idbDelete = (store, key) => new Promise((res, rej) => {
        const r = store.delete(key);
        r.onsuccess = () => res();
        r.onerror   = () => rej(r.error);
    });

    // =========================================================================
    //  Загрузка кода плагина (с CORS-fallback)
    //
    //  Многие хостинги (Pastebin, GitHub Gist raw и др.) не присылают
    //  заголовок Access-Control-Allow-Origin, поэтому браузер блокирует
    //  прямой fetch. Стратегия:
    //    1. Пробуем напрямую.
    //    2. Если браузер выбросил TypeError (CORS / сеть) — повторяем
    //       через публичный CORS-прокси.
    //    3. Если прокси тоже вернул не-2xx — пробрасываем ошибку дальше.
    // =========================================================================

    const CORS_PROXY = 'https://corsproxy.io/?url=';

    async function _fetchPlugin(url, terminal) {
        // ── Попытка 1: напрямую ───────────────────────────────────────────────
        try {
            const resp = await fetch(url);
            if (resp.ok) return await resp.text();
            // Сервер ответил, но статус плохой (404, 403 и т.п.) — прокси не поможет
            throw new Error(`HTTP ${resp.status}`);
        } catch (err) {
            // TypeError означает сетевую блокировку / CORS; любую другую — пробрасываем
            if (!(err instanceof TypeError)) throw err;
        }

        // ── Попытка 2: через CORS-прокси ─────────────────────────────────────
        terminal?.printSystem('  (прямой запрос заблокирован CORS — пробуем через прокси...)');
        const proxyResp = await fetch(CORS_PROXY + encodeURIComponent(url));
        if (!proxyResp.ok) throw new Error(`HTTP ${proxyResp.status} (через прокси)`);
        return await proxyResp.text();
    }

    // =========================================================================
    //  Выполнение кода плагина
    // =========================================================================

    /**
     * Выполняет JS-код плагина в глобальном контексте.
     * Эквивалентно добавлению <script> в DOM, но чуть быстрее.
     * Плагин вызывает PluginAPI.register() при выполнении.
     */
    function _run(code, pluginId) {
        try {
            // new Function не имеет доступа к локальным переменным этой функции —
            // только к глобальным window.* объектам, что нам и нужно.
            // eslint-disable-next-line no-new-func
            new Function(code)();
        } catch (err) {
            console.error(`[PluginManager] Ошибка в плагине "${pluginId}":`, err);
        }
    }

    // =========================================================================
    //  Патч CommandHandler
    //  Перехватываем execute() до того, как оригинальный обработчик получит управление.
    //  Вызывается один раз в init().
    // =========================================================================

    function _patchCommandHandler() {
        // CommandHandler объявлен через const в commands.js — он НЕ попадает в window,
        // поэтому window.CommandHandler всегда undefined. Проверяем через typeof.
        if (typeof CommandHandler === 'undefined' || !CommandHandler.execute) {
            console.warn('[PluginManager] CommandHandler не найден, плагин-команды не будут работать в терминале');
            return;
        }
        if (CommandHandler._pluginPatched) return; // идемпотентность
        CommandHandler._pluginPatched = true;

        const _original = CommandHandler.execute.bind(CommandHandler);

        CommandHandler.execute = async function(rawInput, terminal) {
            const tokens = rawInput.trim().split(/\s+/);
            const cmd    = tokens[0].toLowerCase();
            const args   = tokens.slice(1);

            const pluginCmd = PluginAPI.getCommands()[cmd];
            if (pluginCmd) {
                try {
                    await pluginCmd.execute(args, terminal);
                } catch (err) {
                    terminal.printError(`[ПЛАГИН] Необработанная ошибка: ${err.message}`);
                }
                return;
            }

            return _original(rawInput, terminal);
        };
    }

    // =========================================================================
    //  Диалог подтверждения
    //  Встраивает кнопки прямо в терминал — без браузерного confirm().
    // =========================================================================

    function _confirm(url, terminal) {
        return new Promise(resolve => {
            terminal.printSystem('');
            terminal.printSystem('⚠  ПРЕДУПРЕЖДЕНИЕ БЕЗОПАСНОСТИ', 'rgba(255,200,0,0.9)');
            terminal.printSystem('   Код из внешнего источника будет выполнен на странице:', 'rgba(255,200,0,0.65)');
            terminal.printSystem(`   ${url}`, 'rgba(180,180,180,0.6)');
            terminal.printSystem('   Устанавливайте только плагины из доверенных источников.', 'rgba(255,200,0,0.65)');
            terminal.printSystem('');

            const wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;gap:10px;margin-bottom:10px;';
            wrap.innerHTML = `
                <button id="pm-ok" style="
                    background:rgba(0,200,100,0.08); border:1px solid rgba(0,200,100,0.4);
                    color:rgba(0,200,100,0.9); font-family:var(--mono-font,monospace);
                    font-size:0.76em; letter-spacing:2px; padding:6px 18px; cursor:pointer;
                    transition:background 0.15s;">
                    ✓ УСТАНОВИТЬ
                </button>
                <button id="pm-no" style="
                    background:rgba(255,50,80,0.08); border:1px solid rgba(255,50,80,0.4);
                    color:rgba(255,50,80,0.9); font-family:var(--mono-font,monospace);
                    font-size:0.76em; letter-spacing:2px; padding:6px 18px; cursor:pointer;
                    transition:background 0.15s;">
                    ✕ ОТМЕНА
                </button>
            `;

            const out = TerminalAPI.getOutputNode();
            out.appendChild(wrap);
            out.scrollTop = out.scrollHeight;

            const ok = wrap.querySelector('#pm-ok');
            const no = wrap.querySelector('#pm-no');

            ok.addEventListener('mouseenter', () => ok.style.background = 'rgba(0,200,100,0.18)');
            ok.addEventListener('mouseleave', () => ok.style.background = 'rgba(0,200,100,0.08)');
            no.addEventListener('mouseenter', () => no.style.background = 'rgba(255,50,80,0.18)');
            no.addEventListener('mouseleave', () => no.style.background = 'rgba(255,50,80,0.08)');

            ok.addEventListener('click', () => { wrap.remove(); resolve(true);  });
            no.addEventListener('click', () => { wrap.remove(); resolve(false); });
        });
    }

    // =========================================================================
    //  ПУБЛИЧНЫЙ API
    // =========================================================================

    /**
     * Вызвать ОДИН РАЗ из main.js → window.onload (до unlockInput).
     * Патчит CommandHandler и загружает все сохранённые плагины из IDB.
     */
    async function init() {
        _patchCommandHandler();

        let db;
        try {
            db = await _openDB();
        } catch (err) {
            console.error('[PluginManager] IndexedDB недоступна:', err);
            return;
        }

        let records;
        try {
            records = await _idbGetAll(_store(db));
        } finally {
            db.close();
        }

        for (const rec of records) {
            _run(rec.code, rec.id);
        }

        if (records.length > 0) {
            console.log(`[PluginManager] Загружено плагинов: ${records.length}`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Устанавливает плагин по прямой ссылке на JS-файл.
     *
     * Алгоритм:
     *   1. Fetch кода
     *   2. Диалог подтверждения
     *   3. Выполнение кода (плагин вызывает PluginAPI.register())
     *   4. Сохранение в IDB
     */
    async function install(url, terminal) {
        if (!url) {
            terminal.printError('PLUGIN INSTALL: укажите URL');
            terminal.printSystem('  Пример: plugin install https://example.com/my-plugin.js');
            return;
        }

        // Нормализуем URL
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

        terminal.printSystem(`ЗАГРУЗКА: ${url}`);

        // 1. Загружаем код
        let code;
        try {
            code = await _fetchPlugin(url, terminal);
        } catch (err) {
            terminal.printError(`ОШИБКА ЗАГРУЗКИ: ${err.message}`);
            return;
        }

        // 2. Подтверждение
        const confirmed = await _confirm(url, terminal);
        if (!confirmed) {
            terminal.printSystem('УСТАНОВКА ОТМЕНЕНА.');
            return;
        }

        // 3. Выполняем код и отслеживаем что зарегистрировалось
        const cmdsBefore = new Set(Object.keys(PluginAPI.getCommands()));
        _run(code, '(pending)');

        // Ищем новые команды
        const newCmds = Object.entries(PluginAPI.getCommands())
            .filter(([cmd]) => !cmdsBefore.has(cmd));

        if (newCmds.length === 0) {
            terminal.printError('Плагин не вызвал PluginAPI.register() — команда не зарегистрирована.');
            return;
        }

        // Берём первую зарегистрированную команду как главную
        const [, meta] = newCmds[0];

        // 4. Проверяем: плагин уже установлен?
        let db;
        try {
            db = await _openDB();
            const existing = await _idbGet(_store(db), meta.id);
            if (existing) {
                terminal.printSystem(`ℹ Плагин "${meta.name}" уже установлен (v${existing.version}).`);
                terminal.printSystem('  Используйте "plugin update" для обновления.');
                db.close();
                return;
            }
        } catch (err) {
            terminal.printError(`ОШИБКА IDB: ${err.message}`);
            db?.close();
            return;
        }

        // 5. Сохраняем в IDB
        const record = {
            id:          meta.id,
            name:        meta.name,
            command:     newCmds[0][0], // строка команды терминала
            version:     meta.version,
            url,
            code,
            installedAt: Date.now(),
            updatedAt:   Date.now(),
        };

        try {
            await _idbPut(_store(db, 'readwrite'), record);
        } finally {
            db.close();
        }

        terminal.printSystem('');
        terminal.printSystem(`✓ УСТАНОВЛЕНО: ${meta.name}  v${meta.version}`, 'rgba(0,200,100,0.9)');
        terminal.printSystem(`  Команда: ${record.command}`);
        terminal.printSystem('');
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Удаляет плагин из IDB и снимает его команду.
     * Изменения в CommandHandler — мгновенные (команда перестаёт работать сразу).
     */
    async function remove(id, terminal) {
        if (!id) {
            terminal.printError('PLUGIN REMOVE: укажите ID плагина (см. plugin list)');
            return;
        }

        let db;
        try {
            db = await _openDB();
            const rec = await _idbGet(_store(db), id);

            if (!rec) {
                terminal.printError(`ПЛАГИН НЕ НАЙДЕН: "${id}"`);
                db.close();
                return;
            }

            await _idbDelete(_store(db, 'readwrite'), id);
            db.close();

            // Снимаем команду немедленно (не нужна перезагрузка)
            PluginAPI.unregister(id);

            terminal.printSystem(`✓ УДАЛЕНО: ${rec.name ?? id}`, 'rgba(0,200,100,0.9)');
        } catch (err) {
            terminal.printError(`ОШИБКА: ${err.message}`);
            db?.close();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Выводит список установленных плагинов.
     */
    async function list(terminal) {
        let db, records;
        try {
            db      = await _openDB();
            records = await _idbGetAll(_store(db));
            db.close();
        } catch (err) {
            terminal.printError(`ОШИБКА IDB: ${err.message}`);
            return;
        }

        if (records.length === 0) {
            terminal.printSystem('НЕТ УСТАНОВЛЕННЫХ ПЛАГИНОВ.');
            terminal.printSystem('  Установить: plugin install <url>');
            return;
        }

        terminal.printSystem(`\n─── ПЛАГИНЫ (${records.length}) ───────────────────`);
        for (const r of records) {
            const date = new Date(r.installedAt).toLocaleDateString('ru-RU');
            terminal.printSystem(`  ${r.id}  ${r.name}  v${r.version}  (${date})`);
            terminal.printSystem(`  └─ команда: ${r.command}  |  ${r.url}`, 'rgba(150,150,150,0.6)');
        }
        terminal.printSystem('───────────────────────────────────────\n');
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Перезагружает код плагина с исходного URL и обновляет IDB.
     * Новый код вступает в силу после перезагрузки страницы.
     */
    async function update(id, terminal) {
        if (!id) {
            terminal.printError('PLUGIN UPDATE: укажите ID плагина (см. plugin list)');
            return;
        }

        let db;
        try {
            db = await _openDB();
            const rec = await _idbGet(_store(db), id);

            if (!rec) {
                terminal.printError(`ПЛАГИН НЕ НАЙДЕН: "${id}"`);
                db.close();
                return;
            }

            terminal.printSystem(`ОБНОВЛЕНИЕ: ${rec.name}  (${rec.url})`);

            const code = await _fetchPlugin(rec.url, terminal);

            await _idbPut(_store(db, 'readwrite'), {
                ...rec,
                code,
                updatedAt: Date.now(),
            });
            db.close();

            terminal.printSystem(`✓ ОБНОВЛЕНО: ${rec.name}`, 'rgba(0,200,100,0.9)');
            terminal.printSystem('  Перезагрузите страницу для применения изменений.');
        } catch (err) {
            terminal.printError(`ОШИБКА: ${err.message}`);
            db?.close();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    return { init, install, remove, list, update };

})();
