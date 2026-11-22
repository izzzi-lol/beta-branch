// =============================================================================
//  taskbar.js — Таскбар SCIPNET OS
//  Кнопка ПУСК + старт-меню (приложения из AppRegistry + плагины),
//  кнопки открытых окон (минимизация/фокус), трей: часы, MEM, режим.
//
//  Только desktop-браузеры: на мобилке init() — no-op (там tab-strip окон).
//  Инициализация: main.js → Taskbar.init() (после Desktop.init()).
//
//  Z-порядок: окна 500+ → таскбар 600 → старт-меню 601 → CRT-fx 9998.
// =============================================================================

const Taskbar = (() => {

    const IS_MOBILE = window.matchMedia('(hover: none), (pointer: coarse)').matches;

    let bar, startBtn, menu, winBtns, modeBtn, clockEl, memEl;
    let _menuOpen = false;

    // Мини-сигил SCP для кнопки ПУСК
    const SIGIL = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9"/>
            <path d="M12 3v9"/>
            <path d="M6.8 6.9 12 12l5.2-5.1"/>
        </svg>`;

    // ── DOM ──────────────────────────────────────────────────────────────────
    function _initDOM() {
        bar = document.getElementById('taskbar');
        if (!bar) return false;

        bar.innerHTML = `
            <button id="os-start" title="Пуск">${SIGIL}<span>ПУСК</span></button>
            <div id="os-task-buttons"></div>
            <div id="os-tray">
                <span id="os-tray-mem" title="Загрузка памяти">MEM: —</span>
                <button id="os-mode-toggle" title="Переключить оболочку">КОНСОЛЬ</button>
                <span id="os-tray-clock">--:--:--</span>
            </div>`;

        startBtn = bar.querySelector('#os-start');
        winBtns  = bar.querySelector('#os-task-buttons');
        modeBtn  = bar.querySelector('#os-mode-toggle');
        clockEl  = bar.querySelector('#os-tray-clock');
        memEl    = bar.querySelector('#os-tray-mem');

        menu = document.createElement('div');
        menu.id = 'os-start-menu';
        document.body.appendChild(menu);
        return true;
    }

    // ── Старт-меню ───────────────────────────────────────────────────────────
    function _renderStartMenu() {
        if (!menu) return;
        const apps    = AppRegistry.list();
        const plugins = (typeof PluginManager !== 'undefined') ? (PluginManager.getAll() || []) : [];

        menu.innerHTML = `
            <div class="os-sm-header">
                <span class="os-sm-title">SCIPNET OS</span>
                <span class="os-sm-sub">O5-TERMINAL · CLEARANCE 4+</span>
            </div>
            <div class="os-sm-grid">
                ${apps.map(a => `
                    <button class="os-sm-app" data-app="${a.id}" title="${a.description || a.name}">
                        ${a.icon}<span>${a.name}</span>
                    </button>`).join('')}
            </div>
            ${plugins.length ? `
                <div class="os-sm-section">УСТАНОВЛЕННЫЕ ПРОГРАММЫ</div>
                <div class="os-sm-plugins">
                    ${plugins.map(p => `
                        <button class="os-sm-plugin" data-cmd="${p.command}">▸ ${p.name}</button>`).join('')}
                </div>` : ''}
        `;

        menu.querySelectorAll('.os-sm-app').forEach(btn => {
            btn.addEventListener('click', () => {
                _closeMenu();
                AppRegistry.launch(btn.dataset.app);
            });
        });
        menu.querySelectorAll('.os-sm-plugin').forEach(btn => {
            btn.addEventListener('click', () => {
                _closeMenu();
                TerminalAPI.typeAndExecute(btn.dataset.cmd);
            });
        });
    }

    function _openMenu() {
        if (!menu) return;
        _renderStartMenu();
        menu.classList.add('open');
        _menuOpen = true;
    }

    function _closeMenu() {
        if (!menu) return;
        menu.classList.remove('open');
        _menuOpen = false;
    }

    function _toggleMenu() {
        _menuOpen ? _closeMenu() : _openMenu();
    }

    // ── Кнопки открытых окон ─────────────────────────────────────────────────
    function _renderWinButtons() {
        if (!winBtns) return;
        const wins = WindowManager.list();

        winBtns.innerHTML = wins.map(w => `
            <button class="os-win-btn${w.focused ? ' focused' : ''}${w.minimized ? ' minimized' : ''}"
                    data-win-id="${w.id}" title="${w.title}">
                <span class="os-win-label">${w.title}</span>
            </button>`).join('');

        winBtns.querySelectorAll('.os-win-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const w = WindowManager.list().find(x => x.id === btn.dataset.winId);
                if (!w) return;
                // Классика: клик по сфокусированному окну — свернуть,
                // по свернутому/фоновому — развернуть и поднять
                if (w.focused && !w.minimized) WindowManager.minimize(w.id);
                else WindowManager.focus(w.id);
            });
        });
    }

    // ── Трей ─────────────────────────────────────────────────────────────────
    function _initTray() {
        const tickClock = () => { clockEl.textContent = new Date().toLocaleTimeString('en-GB'); };
        tickClock();
        setInterval(tickClock, 1000);

        const tickMem = () => { memEl.textContent = 'MEM: ' + (Math.floor(Math.random() * 20) + 78) + '%'; };
        tickMem();
        setInterval(tickMem, 5000);

        const syncModeBtn = () => {
            modeBtn.textContent = (typeof Desktop !== 'undefined' && Desktop.mode() === 'desktop')
                ? 'КОНСОЛЬ' : 'СТОЛ';
        };
        syncModeBtn();
        if (typeof Desktop !== 'undefined') Desktop.onModeChange(syncModeBtn);
        modeBtn.addEventListener('click', () => Desktop.toggleMode());
    }

    // ── Инициализация ────────────────────────────────────────────────────────
    function init() {
        if (IS_MOBILE) return;           // мобилка — прежний UX без таскбара
        if (!_initDOM()) return;
        bar.hidden = false;

        _renderWinButtons();
        _initTray();

        // Кнопки окон синхронизируются с любым изменением
        ['open', 'close', 'focus', 'minimize', 'restore']
            .forEach(ev => WindowManager.on(ev, _renderWinButtons));

        // ПУСК
        startBtn.addEventListener('click', e => { e.stopPropagation(); _toggleMenu(); });

        // Клик мимо меню и Escape — закрыть
        document.addEventListener('click', e => {
            if (_menuOpen && !menu.contains(e.target)) _closeMenu();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && _menuOpen) _closeMenu();
        });
    }

    return { init, closeStartMenu: _closeMenu, toggleStartMenu: _toggleMenu };

})();
