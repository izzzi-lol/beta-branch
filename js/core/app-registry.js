// =============================================================================
//  app-registry.js — Реестр приложений SCIPNET OS
//
//  Приложение = { id, name, icon, description, launch(args) }
//  icon — инлайн SVG (stroke: currentColor — цвет задаёт CSS иконки).
//
//  Встроенные приложения — тонкие обёртки над существующими точками входа
//  (команды терминала, Settings, PluginManager). registerBuiltins() вызывается
//  из main.js после загрузки всех модулей — ссылки внутри launch() ленивые.
//
//  Скрипты приложений (app-dossiers.js, app-echo.js) регистрируют себя сами
//  через AppRegistry.register() при загрузке — грузиться ПОСЛЕ этого файла.
// =============================================================================

const AppRegistry = (() => {

    const _apps = new Map(); // id → app

    // ── Иконки (inline SVG, stroke = currentColor) ───────────────────────────
    const _svg = (inner) =>
        `<svg class="os-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
        `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

    const ICONS = {
        console:  _svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3"/><path d="M12 15h5"/>'),
        dossiers: _svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
        echo:     _svg('<path d="M3 12h2"/><path d="M7 8v8"/><path d="M11 5v14"/><path d="M15 8v8"/><path d="M19 10v4"/>'),
        audio:    _svg('<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5z" fill="currentColor" stroke="none"/>'),
        browser:  _svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14.5 14.5 0 0 1 0 18a14.5 14.5 0 0 1 0-18"/>'),
        plugins:  _svg('<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 7V4M14 7V4M10 20v-3M14 20v-3M7 10H4M7 14H4M20 10h-3M20 14h-3"/>'),
        settings: _svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M21.2 12h-3M5.8 12h-3M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1M18.5 18.5l-2.1-2.1M7.6 7.6L5.5 5.5"/>'),
        cabinet:  _svg('<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="9" r="3"/><path d="M8 17.5c1.2-2.6 6.8-2.6 8 0"/>'),
        editor:   _svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
        logs:     _svg('<path d="M4 6h16M4 12h16M4 18h10"/>'),
        shutdown: _svg('<path d="M12 3v9"/><path d="M6.2 6.5a8 8 0 1 0 11.6 0"/>'),
    };

    // ── Ядро реестра ─────────────────────────────────────────────────────────
    function register(app) {
        if (!app || !app.id || !app.name || typeof app.launch !== 'function') {
            console.error('[AppRegistry] приложение требует id, name и launch():', app);
            return false;
        }
        if (_apps.has(app.id)) {
            console.warn(`[AppRegistry] приложение "${app.id}" уже зарегистрировано — перезаписываю`);
        }
        _apps.set(app.id, { icon: '', description: '', ...app });
        return true;
    }

    function get(id) { return _apps.get(id) || null; }
    function has(id) { return _apps.has(id); }
    function list()  { return [..._apps.values()]; }

    function launch(id, args) {
        const app = _apps.get(id);
        if (!app) return false;
        try {
            app.launch(args);
            return true;
        } catch (e) {
            console.error(`[AppRegistry] сбой запуска "${id}":`, e);
            return false;
        }
    }

    // =========================================================================
    //  ВСТРОЕННЫЕ ПРИЛОЖЕНИЯ
    // =========================================================================

    // Экранирование сторонних строк (имена плагинов — данные с удалённых URL)
    const _esc = s => String(s ?? '').replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** Окно «Программы»: список установленных плагинов + установка по URL. */
    function _openPluginsApp() {
        const html = `
            <div class="os-plugins">
                <div class="os-plugins-install">
                    <input type="text" id="os-plugin-url" class="os-input"
                           placeholder="URL программы (pastebin / raw GitHub …)" spellcheck="false">
                    <button id="os-plugin-install-btn" class="os-btn">УСТАНОВИТЬ</button>
                </div>
                <div id="os-plugin-list" class="os-plugin-list"></div>
                <div class="os-plugins-hint">Программы — это плагины терминала. Установка запрашивает
                    подтверждение удержанием кнопки. Ссылка на шаблон — в окне «Изменения».</div>
            </div>`;
        WindowManager.open('plugins', 'ПРОГРАММЫ', html, {
            width: 580,
            height: 430,
            status: 'PLUGIN MANAGER v1.0',
            backdrop: false,
        });
        _renderPluginList();

        const content = document.querySelector('.lyoko-window[data-id="plugins"] .lyoko-content');
        if (!content) return;
        content.querySelector('#os-plugin-install-btn').addEventListener('click', async () => {
            const url = content.querySelector('#os-plugin-url').value.trim();
            if (!url) return;
            try {
                await PluginManager.install(url, TerminalAPI);
            } catch (_) { /* install сам печатает ошибки в терминал */ }
            // FIX: раньше был фиктивный setTimeout(5000) — теперь ре-рендер ровно
            // по завершении установки (install — async).
            _renderPluginList();
        });
    }

    async function _renderPluginList() {
        const listEl = document.querySelector('.lyoko-window[data-id="plugins"] #os-plugin-list');
        if (!listEl || typeof PluginManager === 'undefined') return;

        // FIX: getAll() — async. Раньше результат (Promise) использовался как
        // массив: items.length === undefined → окно всегда показывало
        // «Установленных программ нет», а кнопки запуска/удаления не вешались.
        let items = [];
        try { items = (await PluginManager.getAll()) || []; }
        catch (_) { items = []; }

        listEl.innerHTML = items.length
            ? items.map(p => `
                <div class="os-plugin-item">
                    <div class="os-plugin-info">
                        <span class="os-plugin-name">${_esc(p.name)}</span>
                        <span class="os-plugin-meta">/${_esc(p.command)} · v${_esc(p.version || '?')} · ${p.autostart ? 'автозапуск' : 'ручной запуск'}</span>
                    </div>
                    <button class="os-btn small os-plugin-run"    data-cmd="${_esc(p.command)}" title="Запустить">▶</button>
                    <button class="os-btn small danger os-plugin-remove" data-id="${_esc(p.id)}"  title="Удалить">✕</button>
                </div>`).join('')
            : '<div class="os-empty">Установленных программ нет.</div>';

        listEl.querySelectorAll('.os-plugin-run').forEach(btn => {
            btn.addEventListener('click', () => TerminalAPI.typeAndExecute(btn.dataset.cmd));
        });
        listEl.querySelectorAll('.os-plugin-remove').forEach(btn => {
            btn.addEventListener('click', async () => {
                try { await PluginManager.remove(btn.dataset.id, TerminalAPI); }
                catch (_) { /* remove сам печатает ошибки */ }
                _renderPluginList();
            });
        });
    }

    function registerBuiltins() {
        register({
            id: 'console', name: 'Консоль', icon: ICONS.console,
            description: 'Терминал SCIPNET',
            launch: () => {
                // Мобилка: PhoneOS скрывает свой слой и показывает терминал
                if (typeof PhoneOS !== 'undefined' && PhoneOS.isSupported()) {
                    PhoneOS.showConsole();
                    return;
                }
                Desktop.toggleMode();
            },
        });
        // Файлы приложений (dos-explorer.js, app-echo.js) саморегистрируются
        // при загрузке — здесь только fallback, если файл не подключён
        if (!AppRegistry.has('dossiers')) {
            register({
                id: 'dossiers', name: 'Досье', icon: ICONS.dossiers,
                description: 'База данных персонала',
                launch: () => TerminalAPI.typeAndExecute('get .'),
            });
        }
        if (!AppRegistry.has('echo')) {
            register({
                id: 'echo', name: 'Архив ECHO', icon: ICONS.echo,
                description: 'Аудиозаписи инцидентов',
                launch: () => {},
            });
        }
        register({
            id: 'browser', name: 'Браузер', icon: ICONS.browser,
            description: 'Встроенный браузер',
            launch: () => CmdBrowse.execute([], TerminalAPI),
        });
        register({
            id: 'plugins', name: 'Программы', icon: ICONS.plugins,
            description: 'Установка и управление',
            launch: () => _openPluginsApp(),
        });
        register({
            id: 'settings', name: 'Настройки', icon: ICONS.settings,
            description: 'Конфигурация системы',
            launch: () => Settings.open(),
        });
        register({
            id: 'cabinet', name: 'Кабинет', icon: ICONS.cabinet,
            description: 'Профиль оператора',
            launch: () => Cabinet.open(TerminalAPI),
        });
        register({
            id: 'changelogs', name: 'Изменения', icon: ICONS.logs,
            description: 'Что нового в системе',
            launch: () => CommandHandler.execute('changelogs', TerminalAPI),
        });
        register({
            id: 'shutdown', name: 'Выключение', icon: ICONS.shutdown,
            description: 'Завершение работы',
            launch: () => Desktop.shutdown(),
        });
    }

    return { register, get, has, list, launch, registerBuiltins, ICONS };

})();
