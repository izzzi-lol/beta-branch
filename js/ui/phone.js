// =============================================================================
//  phone.js — PhoneOS, мобильная оболочка SCIPNET
//
//  На тач-устройствах (Platform.isMobile) desktop-шелл недоступен, поэтому
//  здесь свой мини-OS: локскрин → home-экран (сетка приложений + док) →
//  полноэкранные окна Window Manager'а. Терминал тоже приложение («Консоль»).
//
//  Состояния: 'off' (настройка выключена / не мобилка — старый консольный UX)
//             'locked' (локскрин) → 'home' (главный экран) → 'hidden'
//             (открыто приложение или консоль)
//
//  Слой #phone-layer: z-index 700 — над окнами (500+) и таскбаром (600),
//  под CRT-fx (9998) и интро/auth (9999). Плавающая кнопка «⌂» (z 701) —
//  возврат на home из консоли, когда окон нет.
//
//  Навигация:
//    · тап по иконке            → AppRegistry.launch()
//    · «⌂» в тайтлбаре окна     → домой (окна остаются открытыми)
//    · свайп вверх в тайтлбаре  → домой
//    · свайп вверх на локскрине → разблокировка
//    · закрытие последнего окна → авто-возврат на home (window-manager.js)
//
//  Инициализация: main.js → PhoneOS.init() (после Taskbar.init()).
//  Настройка: settings.js → панель «Стол» → тоггл «PhoneOS» (phoneMode).
// =============================================================================

const PhoneOS = (() => {

    const IS_MOBILE = Platform.isMobile; // единое определение из js/core/platform.js

    // Приложения, живущие в доке (из сетки убираются)
    const DOCK_APPS = ['console', 'dossiers', 'echo', 'settings'];

    let _state = 'off';      // 'off' | 'locked' | 'home' | 'hidden'
    let _enabled = false;
    let _layer, _lock, _home, _pill;
    let _lockClock, _sbClock, _battFill, _battPct;
    let _clockTimer = null;
    let _built = false;

    // Мини-сигил SCP (копия из taskbar.js)
    const SIGIL = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9"/>
            <path d="M12 3v9"/>
            <path d="M6.8 6.9 12 12l5.2-5.1"/>
        </svg>`;

    // ═════════════════════════════════════════════════════════════════════════
    //  DOM
    // ═════════════════════════════════════════════════════════════════════════

    function _buildDOM() {
        if (_built) return;
        _built = true;

        _layer = document.createElement('div');
        _layer.id = 'phone-layer';
        _layer.innerHTML = `
            <div id="phone-lock">
                <div class="phone-lock-time">--:--:--</div>
                <div class="phone-lock-date"></div>
                <div class="phone-lock-sigil">${SIGIL}</div>
                <div class="phone-lock-title">SCIPNET MOBILE</div>
                <div class="phone-lock-sub">FOUNDATION SECURE INTRANET</div>
                <div class="phone-lock-hint">▲ СВАЙПНИТЕ ДЛЯ РАЗБЛОКИРОВКИ</div>
            </div>
            <div id="phone-home">
                <div class="phone-statusbar">
                    <span class="phone-sb-time">--:--:--</span>
                    <span class="phone-sb-label">SCIPNET MOBILE</span>
                    <span class="phone-sb-right">
                        <svg class="phone-signal" viewBox="0 0 20 12" aria-hidden="true">
                            <rect x="0"  y="8" width="3" height="4"/>
                            <rect x="5"  y="6" width="3" height="6"/>
                            <rect x="10" y="3" width="3" height="9"/>
                            <rect x="15" y="0" width="3" height="12"/>
                        </svg>
                        <span class="phone-batt-pct">87%</span>
                        <span class="phone-batt"><span class="phone-batt-fill"></span></span>
                    </span>
                </div>
                <div class="phone-grid"></div>
                <div class="phone-dock"></div>
                <div class="phone-homebar"></div>
            </div>
        `;
        document.body.appendChild(_layer);

        _lock     = _layer.querySelector('#phone-lock');
        _home     = _layer.querySelector('#phone-home');
        _lockClock = _lock.querySelector('.phone-lock-time');
        _sbClock   = _home.querySelector('.phone-sb-time');
        _battFill  = _home.querySelector('.phone-batt-fill');
        _battPct   = _home.querySelector('.phone-batt-pct');

        _renderApps();
        _bindLockGestures();

        // Плавающая «⌂» — возврат домой из консоли (когда окон нет)
        _pill = document.createElement('button');
        _pill.id = 'phone-home-pill';
        _pill.title = 'На главный экран';
        _pill.innerHTML = '⌂';
        _pill.addEventListener('click', () => showHome());
        document.body.appendChild(_pill);
        _pill.style.display = 'none';

        _startClock();
        _initBattery();
    }

    function _renderApps() {
        const dockHost = _layer.querySelector('.phone-dock');
        const gridHost = _layer.querySelector('.phone-grid');

        const iconHTML = (app) => `
            <button class="phone-app" data-app="${app.id}" title="${app.description || app.name}">
                <span class="phone-app-icon">${app.icon}</span>
                <span class="phone-app-label">${app.name}</span>
            </button>`;

        const apps = (typeof AppRegistry !== 'undefined') ? AppRegistry.list() : [];

        // Сетка: всё, кроме доковых
        gridHost.innerHTML = apps
            .filter(a => !DOCK_APPS.includes(a.id))
            .map(iconHTML).join('');

        // Док: фиксированные ключевые приложения
        dockHost.innerHTML = DOCK_APPS
            .map(id => apps.find(a => a.id === id))
            .filter(Boolean)
            .map(iconHTML).join('');

        _layer.querySelectorAll('.phone-app').forEach(btn => {
            btn.addEventListener('click', () => _launch(btn.dataset.app));
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  ЛОКСКРИН: свайп вверх / клик → разблокировка
    // ═════════════════════════════════════════════════════════════════════════

    function _bindLockGestures() {
        let sy = 0, t0 = 0;

        _lock.addEventListener('touchstart', e => {
            sy = e.touches[0].clientY;
            t0 = Date.now();
        }, { passive: true });

        _lock.addEventListener('touchend', e => {
            const dy = e.changedTouches[0].clientY - sy;
            // Свайп вверх (быстрый ИЛИ достаточно длинный) — разблокировка
            if (dy < -40 && (Math.abs(dy) / (Date.now() - t0 || 1)) >= 0.15) _unlock();
        }, { passive: true });

        // Клик — фолбэк (и для отладки на десктопе)
        _lock.addEventListener('click', () => _unlock());
    }

    function _unlock() {
        if (_state !== 'locked') return;
        if (typeof AudioHandler !== 'undefined') AudioHandler.playUI('open');
        _state = 'home';
        _lock.classList.add('unlocked');   // CSS-анимация ухода вверх
        setTimeout(() => { _lock.style.display = 'none'; }, 350);
        _syncView();
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  ЧАСЫ / БАТАРЕЯ
    // ═════════════════════════════════════════════════════════════════════════

    function _startClock() {
        const tick = () => {
            const t = new Date().toLocaleTimeString('en-GB');
            if (_lockClock) _lockClock.textContent = t;
            if (_sbClock)   _sbClock.textContent   = t;
        };
        tick();
        _clockTimer = setInterval(tick, 1000);
    }

    function _initBattery() {
        // Реальный уровень там, где есть Battery API; иначе правдоподобные 87%
        if (navigator.getBattery) {
            navigator.getBattery().then(b => {
                const upd = () => {
                    const pct = Math.round(b.level * 100);
                    _battPct.textContent = pct + '%';
                    _battFill.style.width = pct + '%';
                    _battFill.classList.toggle('low', pct <= 20);
                };
                upd();
                b.addEventListener('levelchange', upd);
            }).catch(() => {});
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  НАВИГАЦИЯ
    // ═════════════════════════════════════════════════════════════════════════

    function _syncView() {
        if (!_built) return;
        const showLayer = (_state === 'locked' || _state === 'home');
        _layer.classList.toggle('visible', showLayer);
        _home.style.display = (_state === 'home') ? 'flex' : 'none';
        // Плавающая ⌂ видна только в консоли (скрытый слой + нет окон)
        const pillVisible = _state === 'hidden' &&
            typeof WindowManager !== 'undefined' && WindowManager.list().length === 0;
        _pill.style.display = pillVisible ? 'flex' : 'none';
    }

    function _launch(appId) {
        // Приложение «Консоль» — просто показать терминал
        if (appId === 'console') { showConsole(); return; }
        _state = 'hidden';
        _syncView();
        if (typeof AppRegistry !== 'undefined') AppRegistry.launch(appId);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  PUBLIC API
    // ═════════════════════════════════════════════════════════════════════════

    /** Показать главный экран (окна остаются открытыми под слоем). */
    function showHome() {
        if (!_enabled) return;
        _state = 'home';
        _syncView();
    }

    /** Скрыть оболочку и показать терминал (приложение «Консоль»). */
    function showConsole() {
        if (!_enabled) return; // PhoneOS выключен — терминал и так виден
        _state = 'hidden';
        _syncView();
    }

    /** Полное выключение оболочки (настройка phoneMode = off). */
    function disable() {
        _enabled = false;
        _state = 'off';
        if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; }
        if (_layer)  _layer.remove();
        if (_pill)   _pill.remove();
        _layer = _pill = null;
        _built = false;
    }

    /** Включение оболочки после disable (настройка phoneMode = on). */
    function enable() {
        if (!IS_MOBILE || _enabled) return;
        _enabled = true;
        _buildDOM();
        // Не форсим home: пользователь мог быть в окне/консоли — просто
        // показываем слой поверх (state 'hidden' → виден терминал, ⌂ вернёт)
        _state = 'hidden';
        _syncView();
    }

    /** Инициализация при загрузке (main.js). Не мобилка или phoneMode=off → no-op. */
    function init() {
        if (!IS_MOBILE || _enabled) return;

        let phoneMode = true;
        try {
            const cfg = JSON.parse(localStorage.getItem('scipnet_settings') || '{}');
            if (cfg.phoneMode != null) phoneMode = !!cfg.phoneMode;
        } catch (_) {}

        if (!phoneMode) { _state = 'off'; return; }

        _enabled = true;
        _buildDOM();
        _state = 'locked';
        _syncView();

        // Окно открылось из любого пути (приложение, команда в консоли) → скрыть слой
        if (typeof WindowManager !== 'undefined') {
            WindowManager.on('open', () => {
                if (_state !== 'locked') { _state = 'hidden'; _syncView(); }
            });
            WindowManager.on('close', () => {
                // закрылось последнее окно в консоли → вернуть плавающую ⌂
                if (_state === 'hidden') _syncView();
            });
        }
    }

    function isSupported() { return IS_MOBILE; }
    function isActive()    { return _enabled && _state !== 'off'; }

    return { init, showHome, showConsole, enable, disable, isSupported, isActive };
})();
