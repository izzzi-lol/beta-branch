// =============================================================================
//  desktop.js — Рабочий стол SCIPNET OS
//  Слой поверх терминала: обои, иконки приложений (drag + сетка),
//  переключение режимов «Рабочий стол» ⇄ «Консоль», shutdown-анимация.
//
//  Только для desktop-браузеров: на мобилке все методы — no-op, слой скрыт.
//  Инициализация: main.js → Desktop.init() (после registerBuiltins()).
//
//  Режимы:
//    desktop — непрозрачный #desktop-layer (z 450) накрывает консоль; окна
//              (z 500+) и таскбар (z 600) остаются над ним.
//    console — слой скрыт, работает исходный терминал со статус-баром.
// =============================================================================

const Desktop = (() => {

    const IS_MOBILE = Platform.isMobile; // единое определение из js/core/platform.js
    const TASKBAR_H = 36;              // синхронизировано с высотой в desktop.css
    const ICONS_KEY = 'scipnet_desktop_icons';

    // Сетка иконок
    const CELL_W = 92;
    const CELL_H = 104;
    const PAD_X  = 14;
    const PAD_Y  = 14;

    let layer, iconsHost;
    let _initialized = false;
    let _mode = 'console';             // 'desktop' | 'console'
    let _onModeChange = null;          // колбэк для таскбара

    // ── DOM ──────────────────────────────────────────────────────────────────
    function _initDOM() {
        if (_initialized) return;
        layer     = document.getElementById('desktop-layer');
        iconsHost = document.getElementById('desktop-icons');
        if (!layer || !iconsHost) return;
        _initialized = true;
    }

    // =========================================================================
    //  ИКОНКИ: рендер, drag, сетка, персистенс
    // =========================================================================

    function _loadPositions() {
        try { return JSON.parse(localStorage.getItem(ICONS_KEY)) || {}; }
        catch (_) { return {}; }
    }

    function _savePositions(map) {
        try { localStorage.setItem(ICONS_KEY, JSON.stringify(map)); } catch (_) {}
    }

    /** Позиция по умолчанию — колонка за колонкой сверху вниз. */
    function _defaultPos(index) {
        const perCol = Math.max(2, Math.floor((window.innerHeight - PAD_Y * 2) / CELL_H));
        const col = Math.floor(index / perCol);
        const row = index % perCol;
        return { x: PAD_X + col * CELL_W, y: PAD_Y + row * CELL_H };
    }

    function _renderIcons() {
        if (!_initialized) return;
        const apps  = AppRegistry.list();
        const saved = _loadPositions();

        iconsHost.innerHTML = apps.map((app, i) => {
            const pos = saved[app.id] || _defaultPos(i);
            return `
                <div class="os-desktop-icon" data-app="${app.id}"
                     style="left:${pos.x}px; top:${pos.y}px"
                     title="${app.description || app.name}">
                    <div class="os-icon-wrap">${app.icon}</div>
                    <span class="os-icon-label">${app.name}</span>
                </div>`;
        }).join('');

        iconsHost.querySelectorAll('.os-desktop-icon').forEach(iconEl => {
            _bindIconDrag(iconEl);

            // Одиночный клик — выделение, двойной — запуск (как в ОС)
            iconEl.addEventListener('click', () => {
                iconsHost.querySelectorAll('.os-desktop-icon.selected')
                    .forEach(s => { if (s !== iconEl) s.classList.remove('selected'); });
                iconEl.classList.add('selected');
            });
            iconEl.addEventListener('dblclick', () => AppRegistry.launch(iconEl.dataset.app));
        });
    }

    /**
     * Перетаскивание иконки с магнитом к сетке.
     * Порог 5px отличает drag от клика — клик не двигает иконку.
     */
    function _bindIconDrag(iconEl) {
        iconEl.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX, startY = e.clientY;
            const origX  = iconEl.offsetLeft, origY = iconEl.offsetTop;
            let moved = false;

            const onMove = ev => {
                const dx = ev.clientX - startX, dy = ev.clientY - startY;
                if (!moved && Math.hypot(dx, dy) < 5) return;
                moved = true;
                iconEl.classList.add('dragging');
                iconEl.style.left = (origX + dx) + 'px';
                iconEl.style.top  = (origY + dy) + 'px';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup',   onUp);
                iconEl.classList.remove('dragging');
                if (!moved) return; // это был клик

                // Магнит к сетке + сохранение раскладки.
                // FIX: раньше был только Math.max — иконку можно было утащить
                // за правый/нижний край экрана и сохранить там (недостижима
                // без «Сброса раскладки»). Добавлен верхний клэмп по вьюпорту.
                const maxX = Math.max(PAD_X, window.innerWidth  - PAD_X  - (iconEl.offsetWidth  || 48));
                const maxY = Math.max(PAD_Y, window.innerHeight - PAD_Y - (iconEl.offsetHeight || 48));
                const nx = Math.min(maxX, Math.max(PAD_X, Math.round((iconEl.offsetLeft - PAD_X) / CELL_W) * CELL_W + PAD_X));
                const ny = Math.min(maxY, Math.max(PAD_Y, Math.round((iconEl.offsetTop  - PAD_Y) / CELL_H) * CELL_H + PAD_Y));
                iconEl.style.left = nx + 'px';
                iconEl.style.top  = ny + 'px';

                const saved = _loadPositions();
                saved[iconEl.dataset.app] = { x: nx, y: ny };
                _savePositions(saved);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
        });
    }

    function resetIconLayout() {
        try { localStorage.removeItem(ICONS_KEY); } catch (_) {}
        _renderIcons();
    }

    // =========================================================================
    //  РЕЖИМЫ: рабочий стол ⇄ консоль
    // =========================================================================

    function _applyMode(mode) {
        if (!_initialized || IS_MOBILE) return;
        _mode = mode;
        document.body.classList.toggle('os-desktop', mode === 'desktop');

        if (mode === 'desktop') {
            // Фокус не должен оставаться в скрытом консольном вводе
            if (document.activeElement?.id === 'cmd-input') document.activeElement.blur();
        } else {
            const input = document.getElementById('cmd-input');
            if (input && !input.disabled) input.focus();
        }
        if (typeof _onModeChange === 'function') _onModeChange(mode);
    }

    function show()        { _applyMode('desktop'); }
    function showConsole() { _applyMode('console'); }
    function toggleMode()  { _applyMode(_mode === 'desktop' ? 'console' : 'desktop'); }
    function mode()        { return _mode; }
    function isSupported() { return !IS_MOBILE; }

    /** Колбэк таскбара на смену режима (кнопка «КОНСОЛЬ/СТОЛ»). */
    function onModeChange(cb) { _onModeChange = cb; }

    // =========================================================================
    //  SHUTDOWN: анимация выключения CRT → перезагрузка через boot
    // =========================================================================

    function shutdown() {
        if (!_initialized) { location.reload(); return; }

        // Закрываем оболочку: окна, меню
        WindowManager.closeAll();
        if (typeof Taskbar !== 'undefined') Taskbar.closeStartMenu();

        // Оверлей выключения: чёрный экран поверх всего (под CRT-эффектами,
        // чтобы scanlines оставались до конца), линия → точка → перезагрузка.
        const ov = document.createElement('div');
        ov.id = 'os-shutdown';
        ov.innerHTML = `
            <div class="os-shutdown-msg">SYSTEM SHUTDOWN</div>
            <div class="os-shutdown-line"></div>`;
        document.body.appendChild(ov);

        requestAnimationFrame(() => ov.classList.add('phase-fade'));
        setTimeout(() => ov.classList.add('phase-line'), 500);
        setTimeout(() => ov.classList.add('phase-dot'),  1500);
        setTimeout(() => ov.classList.add('phase-off'),  2100);

        setTimeout(() => {
            try { localStorage.setItem('has_seen_intro', 'false'); } catch (_) {}
            window.close();

            // FIX: window.close() работает только для вкладок, открытых
            // скриптом — в обычном случае он молча не срабатывает, и
            // пользователь оставался навсегда на чёрном экране без
            // подсказок. Если вкладка не закрылась — показываем сообщение
            // и перезагружаем систему по клику (или через 4 секунды).
            setTimeout(() => {
                if (window.closed) return;
                const msg = ov.querySelector('.os-shutdown-msg');
                if (msg) {
                    msg.textContent = 'СЕССИЯ ЗАВЕРШЕНА — НАЖМИТЕ, ЧТОБЫ ПЕРЕЗАГРУЗИТЬСЯ';
                    msg.style.cursor = 'pointer';
                }
                ov.style.cursor = 'pointer';
                ov.addEventListener('click', () => location.reload(), { once: true });
            }, 400);
            setTimeout(() => { if (!window.closed) location.reload(); }, 4400);
        }, 2500);
    }

    // =========================================================================
    //  ИНИЦИАЛИЗАЦИЯ
    // =========================================================================

    function init() {
        if (IS_MOBILE) return;
        _initDOM();
        if (!_initialized) return;

        _renderIcons();

        // Окна не должны залезать под таскбар
        WindowManager.setBottomInset(TASKBAR_H);

        // Режим из настроек (desktopMode, по умолчанию — рабочий стол)
        let desktopMode = true;
        try {
            const cfg = JSON.parse(localStorage.getItem('scipnet_settings') || '{}');
            if (cfg.desktopMode != null) desktopMode = !!cfg.desktopMode;
        } catch (_) {}
        _applyMode(desktopMode ? 'desktop' : 'console');

        // Клики по пустому месту стола снимают выделение иконок
        layer.addEventListener('click', e => {
            if (e.target === layer || e.target === iconsHost) {
                iconsHost.querySelectorAll('.os-desktop-icon.selected')
                    .forEach(s => s.classList.remove('selected'));
            }
        });
    }

    return { init, show, showConsole, toggleMode, mode, isSupported, onModeChange, shutdown, resetIconLayout };

})();
