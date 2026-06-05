// =============================================================================
//  window-manager.js — Lyoko Window Manager
//  Система интерактивных окон в стиле Суперкомпьютера из Code Lyoko.
//
//  API:
//    WindowManager.open(id, title, contentHTML, opts)  → открыть/показать окно
//    WindowManager.close(id)                           → закрыть окно
//    WindowManager.closeAll()                          → закрыть все окна
//    WindowManager.setContent(id, html)                → обновить контент
//
//  opts = {
//    width:       number,  // (desktop) начальная ширина (px), default: 420
//    height:      number,  // (desktop) начальная высота контента (px), default: 480
//    maxWidth:    number,  // (desktop) максимальная ширина (px), без ограничения по умолчанию
//    maxHeight:   number,  // (desktop) максимальная высота контента (px), без ограничения по умолчанию
//    isResizable: boolean, // (desktop) разрешить ресайз мышью (default: true)
//    minSize:     number,  // [устар.] псевдоним height — оставлен для обратной совместимости
//    maxSize:     number,  // [устар.] псевдоним height — оставлен для обратной совместимости
//    status:      string,  // текст статус-бара (опционально)
//    backdrop:    boolean, // затемнить фон (default: false)
//    x: number, y: number  // (desktop) начальная позиция (default: по центру)
//  }
//
//  ── ДЕСКТОП ──────────────────────────────────────────────────────────────────
//  Плавающие перетаскиваемые окна с поддержкой collapse/expand/maximize.
//  Анимация открытия (3 фазы): flash → titlebar/statusbar → контент слайдером вниз
//  Анимация закрытия (3 фазы): контент слайдером вверх → flash → scaleX(0)
//
//  ── МОБАЙЛ ───────────────────────────────────────────────────────────────────
//  Полноэкранные окна над консолью; одно поверх другого по z-index.
//  Тайтл-бар: горизонтальный скролл-стрип из вкладок всех открытых окон.
//    · Тап по вкладке             → переключиться на это окно
//    · Быстрый свайп влево        → следующее окно (по порядку открытия)
//    · Быстрый свайп вправо       → предыдущее окно
//  Анимации: flash in/out (без grid-слайдера)
// =============================================================================

const WindowManager = (() => {

    // ── Определение платформы ────────────────────────────────────────────────
    const IS_MOBILE = window.matchMedia('(hover: none), (pointer: coarse)').matches;

    // ── DOM ──────────────────────────────────────────────────────────────────
    let layer, backdrop;

    function _initDOM() {
        if (layer) return;
        backdrop = document.createElement('div');
        backdrop.id = 'wm-backdrop';
        document.body.appendChild(backdrop);
        layer = document.createElement('div');
        layer.id = 'wm-layer';
        document.body.appendChild(layer);
    }

    // ── Z-index management ───────────────────────────────────────────────────
    let _zBase    = 500;
    let _zCounter = 0;
    const _windows = {}; // id → { el, title, opts }
    let _mobileActiveId = null;

    function _bringToFront(el) {
        _zCounter++;
        el.style.zIndex = _zBase + _zCounter;
        layer.querySelectorAll('.lyoko-window').forEach(w => w.classList.remove('active'));
        el.classList.add('active');
    }

    // ── Desktop: каскадное позиционирование ──────────────────────────────────
    let _cascadeOffset = 0;
    function _defaultPos(width, height) {
        const cx = Math.round((window.innerWidth  - width)  / 2) + _cascadeOffset;
        const cy = Math.round((window.innerHeight - height) / 2) + _cascadeOffset;
        _cascadeOffset = (_cascadeOffset + 28) % 112;
        return {
            x: Math.max(0, Math.min(cx, window.innerWidth  - width  - 20)),
            y: Math.max(0, Math.min(cy, window.innerHeight - height - 40)),
        };
    }

    // ── Утилиты ──────────────────────────────────────────────────────────────
    const _sleep = ms => new Promise(r => setTimeout(r, ms));
    const _raf   = ()  => new Promise(r => requestAnimationFrame(r));

    // =========================================================================
    //  МОБАЙЛ: tab strip + навигация свайпом
    // =========================================================================

    /**
     * Перестраивает tab-strip во всех открытых окнах.
     * Активная вкладка = _mobileActiveId.
     */
    function _refreshAllTabs() {
        if (!IS_MOBILE) return;
        const ids = Object.keys(_windows);

        ids.forEach(ownId => {
            const strip = _windows[ownId].el.querySelector('.lyoko-tab-strip');
            if (!strip) return;

            strip.innerHTML = ids.map(wid => {
                const isActive = wid === _mobileActiveId;
                return `<span class="lyoko-tab${isActive ? ' active' : ''}" data-wid="${wid}">${_windows[wid].title}</span>`;
            }).join('');

            // Клик по вкладке
            strip.querySelectorAll('.lyoko-tab').forEach(tab => {
                tab.addEventListener('click', e => {
                    e.stopPropagation();
                    _switchToWindow(tab.dataset.wid);
                });
            });

            // Прокрутить активную вкладку в видимую зону
            if (ownId === _mobileActiveId) {
                const activeTab = strip.querySelector('.lyoko-tab.active');
                activeTab?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
            }
        });
    }

    /** Переключиться на окно по id (мобайл). */
    function _switchToWindow(id) {
        if (!_windows[id]) return;
        _mobileActiveId = id;
        _bringToFront(_windows[id].el);
        _refreshAllTabs();
    }

    /**
     * Растягивает окно на весь экран над консолью.
     * Высота #console-area + #crt-statusbar измеряется динамически.
     */
    function _fitMobile(win) {
        const consoleEl = document.getElementById('console-area');
        const statusEl  = document.getElementById('crt-statusbar');
        const bottomH   = (consoleEl?.offsetHeight ?? 0) + (statusEl?.offsetHeight ?? 0);

        Object.assign(win.style, {
            position  : 'fixed',
            left      : '0',
            top       : '0',
            right     : '0',
            bottom    : bottomH + 'px',
            width     : '100%',
            height    : '',
            maxHeight : '',
        });
    }

    /**
     * Добавляет свайп-навигацию на тайтл-бар (мобайл).
     * Быстрый свайп (скорость ≥ 0.3 px/мс И смещение ≥ 40px) → смена окна.
     * Медленный скролл → нативный скролл вкладок.
     */
    function _addMobileSwipe(win, titlebar) {
        let sx = 0, sy = 0, t0 = 0;

        titlebar.addEventListener('touchstart', e => {
            sx = e.touches[0].clientX;
            sy = e.touches[0].clientY;
            t0 = Date.now();
        }, { passive: true });

        titlebar.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - sx;
            const dy = e.changedTouches[0].clientY - sy;

            // Игнорируем вертикальный свайп и слишком медленные/короткие
            if (Math.abs(dy) > Math.abs(dx)) return;
            const velocity = Math.abs(dx) / (Date.now() - t0 || 1);
            if (velocity < 0.3 || Math.abs(dx) < 40) return;

            const ids = Object.keys(_windows);
            const cur = ids.indexOf(_mobileActiveId);
            if (dx < 0 && cur < ids.length - 1) _switchToWindow(ids[cur + 1]); // влево  → вперёд
            if (dx > 0 && cur > 0)               _switchToWindow(ids[cur - 1]); // вправо → назад
        }, { passive: true });
    }

    // =========================================================================
    //  ДЕСКТОП: drag, size-toggle
    // =========================================================================

    function _makeDraggable(win, titlebar) {
        let ox = 0, oy = 0, startX = 0, startY = 0;
        let winW = 0, winH = 0;
        let _dragRaf = null;
        let _pendingX = 0, _pendingY = 0;

        titlebar.addEventListener('mousedown', e => {
            if (e.target.closest('.lyoko-btn')) return;
            e.preventDefault();
            _bringToFront(win);

            startX = e.clientX;
            startY = e.clientY;
            const rect = win.getBoundingClientRect();
            ox = rect.left;
            oy = rect.top;
            // Кэшируем размер окна один раз — не читаем offsetWidth/Height в каждом mousemove
            winW = win.offsetWidth;
            winH = win.offsetHeight;

            const onMove = e => {
                _pendingX = ox + (e.clientX - startX);
                _pendingY = oy + (e.clientY - startY);
                // rAF-троттлинг: не ставим новый кадр, если предыдущий ещё не отрисован
                if (_dragRaf) return;
                _dragRaf = requestAnimationFrame(() => {
                    _dragRaf = null;
                    win.style.left = Math.max(0, Math.min(_pendingX, window.innerWidth  - winW)) + 'px';
                    win.style.top  = Math.max(0, Math.min(_pendingY, window.innerHeight - winH)) + 'px';
                });
            };
            const onUp = () => {
                if (_dragRaf) { cancelAnimationFrame(_dragRaf); _dragRaf = null; }
                document.body.style.cursor = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup',   onUp);
            };
            // Фиксируем курсор на документе — не теряем захват при быстром движении
            document.body.style.cursor = 'grabbing';
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
        });
    }

    function _makeSizeToggle(win, content, statusbar, opts, maxCtrl) {
        // savedH обновляется перед каждым сворачиванием — учитывает ручной ресайз
        let savedH = opts.height || opts.maxSize || 480;
        let isMin  = false;
        const btn  = win.querySelector('.lyoko-btn.resize');
        if (!btn) return;

        function setSize(toMin) {
            isMin = toMin;
            if (toMin) {
                // Сохраняем текущую высоту перед сворачиванием
                const curH = parseInt(content.style.maxHeight);
                if (curH > 0) savedH = curH;
                content.style.maxHeight = '0';
            } else {
                content.style.maxHeight = savedH + 'px';
            }
            content.style.overflow  = isMin ? 'hidden' : '';
            btn.title     = isMin ? 'Развернуть' : 'Свернуть';
            btn.innerHTML = isMin ? '▲' : '▼';
            content.closest('.lyoko-content-wrapper').classList.toggle('collapsed', toMin);

            AudioHandler.playUI(isMin ? 'minimize' : 'maximize');
        }

        setSize(false);
        btn.addEventListener('click', () => {
            // Если окно maximized — restore вместо collapse
            if (maxCtrl?.isMaximized()) { maxCtrl.restore(); return; }
            setSize(!isMin);
        });
    }

    // ── Maximize / Restore ────────────────────────────────────────────────────
    /**
     * Разворачивает окно до своего максимума и центрирует.
     * Повторный клик (или клик collapse) — восстанавливает прежние размер и позицию.
     *
     * Возвращает контроллер { isMaximized(), restore() } для _makeSizeToggle.
     */
    function _makeMaximize(win, content, opts) {
        const btn = win.querySelector('.lyoko-btn.maximize');
        if (!btn) return { isMaximized: () => false, restore: () => {} };

        let _isMax = false;
        let _snap  = null; // { left, top, width, maxHeight }

        const TRANS = 'left 0.22s ease, top 0.22s ease, width 0.22s ease';

        function maximize() {
            // Снимок текущего состояния.
            // Если окно свёрнуто (maxHeight='0'), сохраняем дефолтную высоту —
            // иначе restore вернёт окно в свёрнутое состояние.
            const curMaxH = parseInt(content.style.maxHeight);
            _snap = {
                left:      win.style.left,
                top:       win.style.top,
                width:     win.style.width,
                maxHeight: curMaxH > 0
                    ? content.style.maxHeight
                    : (opts.height || opts.maxSize || 480) + 'px',
            };

            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const targetW = Math.min(opts.maxWidth  ?? vw,  vw  - 20);
            const targetH = Math.min(opts.maxHeight ?? opts.maxSize ?? (vh - 60), vh - 40);
            const cx = Math.max(0, Math.round((vw - targetW) / 2));
            const cy = Math.max(0, Math.round((vh - targetH) / 2));

            win.style.transition    = TRANS;
            win.style.maxWidth      = '';          // снимаем ограничение maxWidth
            win.style.left          = cx + 'px';
            win.style.top           = cy + 'px';
            win.style.width         = targetW + 'px';
            content.style.overflow  = '';
            content.style.maxHeight = targetH + 'px';

            if (!opts.backdrop) backdrop.classList.toggle('visible', true);

            _isMax = true;
            win.classList.add('wm-maximized');
            btn.innerHTML = '⊟';
            btn.title     = 'Восстановить';
            btn.classList.add('maximized');

            setTimeout(() => { win.style.transition = ''; }, 240);
        }

        function restore() {
            if (!_snap) return;

            win.style.transition    = TRANS;
            win.style.left          = _snap.left;
            win.style.top           = _snap.top;
            win.style.width         = _snap.width;
            content.style.maxHeight = _snap.maxHeight;

            if (opts.maxWidth) win.style.maxWidth = opts.maxWidth + 'px';

            win.classList.remove('wm-maximized');
            if (!opts.backdrop) {
                // Прячем backdrop только если больше нет развёрнутых окон
                const anyMaximized = layer.querySelectorAll('.wm-maximized').length > 0;
                if (!anyMaximized) backdrop.classList.toggle('visible', false);
            }

            _isMax = false;
            btn.innerHTML = '⊞';
            btn.title     = 'Развернуть на весь экран';
            btn.classList.remove('maximized');

            setTimeout(() => { win.style.transition = ''; }, 240);
        }

        btn.addEventListener('click', () => _isMax ? restore() : maximize());

        return { isMaximized: () => _isMax, restore };
    }

    // ── Ресайз: ghost-режим ──────────────────────────────────────────────────
    // При старте тянем призрачный прямоугольник (outline), контент окна прячется.
    // Размер применяется единственный раз — в момент отпускания кнопки мыши.
    function _makeResizable(win, opts) {
        if (IS_MOBILE) return;
        if (opts.isResizable === false) return;

        function mkHandle(cls) {
            const h = document.createElement('div');
            h.className = 'lyoko-rh ' + cls;
            win.appendChild(h);
            return h;
        }

        function attach(handle, doW, doH) {
            handle.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
                _bringToFront(win);

                const x0   = e.clientX;
                const y0   = e.clientY;
                const rect = win.getBoundingClientRect();
                const w0   = rect.width;

                const content = win.querySelector('.lyoko-content');
                const wrapper = win.querySelector('.lyoko-content-wrapper');
                const h0 = content
                    ? (parseInt(content.style.maxHeight) || content.offsetHeight)
                    : 200;

                // extraH = высота titlebar + statusbar (не меняется во время ресайза)
                const extraH = rect.height - h0;

                // ── Создаём ghost-прямоугольник ──────────────────────────────
                // Без box-shadow: тень с блюром пересчитывается каждый кадр при
                // изменении размера — главный источник лагов. Используем outline
                // (не влияет на layout) и will-change для изоляции перерисовки.
                const ghost = document.createElement('div');
                ghost.className = 'lyoko-resize-ghost';
                Object.assign(ghost.style, {
                    position     : 'fixed',
                    boxSizing    : 'border-box',
                    left         : rect.left + 'px',
                    top          : rect.top  + 'px',
                    width        : w0 + 'px',
                    height       : rect.height + 'px',
                    outline      : '1px solid var(--theme-color, #a200ff)',
                    background   : 'transparent',
                    pointerEvents: 'none',
                    zIndex       : String((parseInt(win.style.zIndex) || 500) + 1),
                    willChange   : 'width, height',
                });
                layer.appendChild(ghost);

                // ── Прячем контент, оставляем titlebar и statusbar ───────────
                // visibility:hidden дешевле opacity:0 — не создаёт compositing layer
                if (wrapper) wrapper.style.visibility = 'hidden';

                let _pendingW = w0, _pendingH = h0;
                let _resizeRaf = null;

                const onMove = ev => {
                    if (doW) _pendingW = Math.max(280, Math.min(opts.maxWidth  || Infinity, w0 + (ev.clientX - x0)));
                    if (doH) _pendingH = Math.max(80,  Math.min(opts.maxHeight || opts.maxSize || Infinity, h0 + (ev.clientY - y0)));
                    if (_resizeRaf) return;
                    _resizeRaf = requestAnimationFrame(() => {
                        _resizeRaf = null;
                        if (doW) ghost.style.width  = _pendingW + 'px';
                        if (doH) ghost.style.height = (extraH + _pendingH) + 'px';
                    });
                };

                const onUp = () => {
                    if (_resizeRaf) { cancelAnimationFrame(_resizeRaf); _resizeRaf = null; }

                    // ── Применяем финальный размер к окну ───────────────────
                    if (doW) win.style.width = _pendingW + 'px';
                    if (doH && content) {
                        content.style.overflow  = '';
                        content.style.maxHeight = _pendingH + 'px';
                    }

                    // ── Убираем ghost, возвращаем контент ───────────────────
                    ghost.remove();
                    if (wrapper) wrapper.style.visibility = '';

                    document.body.style.cursor = '';
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup',   onUp);
                    win.style.userSelect = '';
                };

                win.style.userSelect = 'none';
                document.body.style.cursor = doW && doH ? 'nwse-resize'
                    : doW        ? 'ew-resize'
                        : 'ns-resize';
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup',   onUp);
            });
        }

        attach(mkHandle('lyoko-rh-s'),  false, true);  // ↕ снизу
        attach(mkHandle('lyoko-rh-e'),  true,  false); // ↔ справа
        attach(mkHandle('lyoko-rh-se'), true,  true);  // ↘ угол
    }

    // =========================================================================
    //  АНИМАЦИИ
    // =========================================================================

    /**
     * Появление окна.
     * Мобайл:  flash → контент сразу видим
     * Десктоп: flash → только titlebar/statusbar → контент слайдером вниз (grid)
     */
    async function _animateOpen(win, wrapper) {
        if (IS_MOBILE) {
            win.classList.add('wm-flash-in');
            await _raf(); await _raf();
            await _sleep(55);
            win.classList.remove('wm-flash-in');
            return;
        }

        // Desktop
        wrapper.style.transition = 'none';
        wrapper.classList.add('collapsed');
        win.classList.add('wm-flash-in');

        await _raf(); await _raf();
        await _sleep(55);

        if (win.dataset.closing) return;
        win.classList.remove('wm-flash-in');
        await _sleep(28);

        if (win.dataset.closing) return;
        wrapper.style.transition = '';
        wrapper.classList.remove('collapsed');
    }

    /**
     * Исчезновение окна.
     * Мобайл:  flash → удаление
     * Десктоп: контент слайдером вверх → flash → scaleX(0) → удаление
     *
     * Вызывается ПОСЛЕ delete _windows[id], повторный close невозможен.
     */
    async function _animateClose(win, wrapper) {
        win.style.pointerEvents = 'none';

        if (IS_MOBILE) {
            win.classList.add('wm-flash-out');
            await _sleep(350); // чуть больше длины lyokoFlashClose (0.3s)
            win.remove();
            return;
        }

        // Desktop
        wrapper.classList.add('collapsed');
        await _sleep(410);
        win.classList.add('wm-flash-out');

        await _sleep(12);

        win.style.transition = 'transform 0.26s cubic-bezier(0.55, 0, 1, 0.45)';
        win.style.transform  = 'scaleX(0)';
        await _sleep(280);

        win.remove();
    }

    // =========================================================================
    //  ПОСТРОЕНИЕ DOM ОКНА
    // =========================================================================

    function _buildWindow(id, title, contentHTML, opts) {
        const win = document.createElement('div');
        win.className  = 'lyoko-window';
        win.dataset.id = id;

        if (IS_MOBILE) {
            // ── Мобайл: tab-strip вместо заголовка, нет кнопки resize ────────
            win.innerHTML = `
                <div class="lyoko-titlebar">
                    <div class="lyoko-tab-strip"></div>
                    <button class="lyoko-btn close" title="Закрыть">✕</button>
                </div>
                <div class="lyoko-content-wrapper">
                    <div class="lyoko-content">${contentHTML}</div>
                </div>
                ${opts.status ? `<div class="lyoko-statusbar"><span>${opts.status}</span><span>ID:${id.toUpperCase()}</span></div>` : ''}
            `;

            _fitMobile(win);
            _addMobileSwipe(win, win.querySelector('.lyoko-titlebar'));

        } else {
            // ── Десктоп: стандартный заголовок + resize + drag ───────────────
            const width    = opts.width || 420;
            const initH    = opts.height || opts.maxSize || 480;
            const pos      = (opts.x != null && opts.y != null)
                ? { x: opts.x, y: opts.y }
                : _defaultPos(width, initH);

            win.style.width    = width + 'px';
            if (opts.maxWidth)  win.style.maxWidth  = opts.maxWidth  + 'px';
            win.style.left  = pos.x + 'px';
            win.style.top   = pos.y + 'px';

            win.innerHTML = `
                <div class="lyoko-titlebar">
                    <span class="lyoko-title">${title}</span>
                    <button class="lyoko-btn resize"   title="Свернуть">▼</button>
                    <button class="lyoko-btn maximize" title="Развернуть на весь экран">⊞</button>
                    <button class="lyoko-btn close"    title="Закрыть">✕</button>
                </div>
                <div class="lyoko-content-wrapper">
                    <div class="lyoko-content">${contentHTML}</div>
                </div>
                ${opts.status ? `<div class="lyoko-statusbar"><span>${opts.status}</span><span>ID:${id.toUpperCase()}</span></div>` : ''}
            `;

            const titlebar  = win.querySelector('.lyoko-titlebar');
            const content   = win.querySelector('.lyoko-content');
            const statusbar = win.querySelector('.lyoko-statusbar');

            _makeDraggable(win, titlebar);
            const maxCtrl = _makeMaximize(win, content, opts);
            _makeSizeToggle(win, content, statusbar, opts, maxCtrl);
            _makeResizable(win, opts);
        }

        win.querySelector('.lyoko-btn.close').addEventListener('click', () => WindowManager.close(id));
        win.addEventListener('mousedown', () => _bringToFront(win));

        return win;
    }

    // ── Backdrop ─────────────────────────────────────────────────────────────
    function _updateBackdrop() {
        const anyBackdrop = Object.values(_windows).some(w => w.opts.backdrop);
        backdrop.classList.toggle('visible', anyBackdrop);
    }

    // =========================================================================
    //  ПУБЛИЧНЫЙ API
    // =========================================================================

    function open(id, title, contentHTML, opts = {}) {
        _initDOM();

        // Окно уже открыто → обновляем контент, выносим вперёд
        if (_windows[id]) {
            setContent(id, contentHTML);
            IS_MOBILE ? _switchToWindow(id) : _bringToFront(_windows[id].el);
            return;
        }

        const win = _buildWindow(id, title, contentHTML, opts);
        layer.appendChild(win);
        _windows[id] = { el: win, title, opts };

        if (IS_MOBILE) {
            _mobileActiveId = id;
            _bringToFront(win);
            _refreshAllTabs(); // заполняем tab-strip во всех окнах
        } else {
            _bringToFront(win);
        }

        _updateBackdrop();
        AudioHandler.playUI('open');

        const wrapper = win.querySelector('.lyoko-content-wrapper');
        _animateOpen(win, wrapper);
    }

    function close(id) {
        const entry = _windows[id];
        if (!entry) return;

        const win     = entry.el;
        const wrapper = win.querySelector('.lyoko-content-wrapper');

        // Удаляем из реестра сразу — повторный close(id) вернётся здесь
        delete _windows[id];
        _updateBackdrop();

        AudioHandler.playUI('close');

        // Флаг для _animateOpen — прерваться, если запущен параллельно
        win.dataset.closing = '1';

        // Мобайл: автоматически перейти на другое окно
        if (IS_MOBILE) {
            const remaining = Object.keys(_windows);
            if (remaining.length > 0) {
                _switchToWindow(remaining[remaining.length - 1]);
            } else {
                _mobileActiveId = null;
            }
        }

        _animateClose(win, wrapper);
    }

    function closeAll() {
        Object.keys(_windows).forEach(id => close(id));
    }

    function setContent(id, html) {
        const entry = _windows[id];
        if (!entry) return;
        const content = entry.el.querySelector('.lyoko-content');
        if (content) content.innerHTML = html;
    }

    return { open, close, closeAll, setContent };

})();