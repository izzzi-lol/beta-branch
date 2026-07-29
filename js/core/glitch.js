// =============================================================================
//  glitch.js — Глитч-дисторшн для всего сайта
//
//  Использует SVG-фильтр (feTurbulence + feDisplacementMap) поверх body —
//  никаких зависимостей, работает везде, весит ~3KB.
//
//  API:
//    GlitchFX.trigger(opts)   — запустить глитч один раз
//    GlitchFX.loop(opts)      — запустить бесконечный фоновый ambient
//    GlitchFX.stopLoop()      — остановить ambient
//    GlitchFX.isLooping()     — boolean
//
//  opts = {
//    duration:  число мс   (default: 600)  — общая длина эффекта
//    intensity: 1..100     (default: 30)   — сила дисторшна
//    slices:    boolean    (default: true) — горизонтальные цветные слайсы
//    colorShift:boolean    (default: true) — RGB-сдвиг
//    scanFlash: boolean    (default: true) — белая вспышка scan-line
// }
//
//  Пример из консоли / кода:
//    GlitchFX.trigger({ intensity: 80, duration: 1200 })
//    GlitchFX.trigger()   ← стандартный лёгкий глитч
// =============================================================================

const GlitchFX = (() => {

    // ── SVG-фильтр (вставляется один раз в body) ─────────────────────────────

    const FILTER_ID     = 'glitch-displacement-filter';
    const OVERLAY_ID    = 'glitch-overlay';
    const SVG_NS        = 'http://www.w3.org/2000/svg';

    let _overlay        = null;
    let _turbulence     = null;   // feTurbulence node
    let _displacement   = null;   // feDisplacementMap node
    let _rafId          = null;   // requestAnimationFrame handle
    let _loopRafId      = null;   // ambient loop handle
    let _isLooping      = false;

    function _init() {
        if (_overlay) return;

        // ── SVG с фильтром (невидимый, только определение) ───────────────────
        const svgDef = document.createElementNS(SVG_NS, 'svg');
        svgDef.setAttribute('id', 'glitch-svg-defs');
        svgDef.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        svgDef.innerHTML = `
            <defs>
                <filter id="${FILTER_ID}" x="0%" y="0%" width="100%" height="100%"
                        color-interpolation-filters="sRGB">

                    <!-- Шум для дисторшна -->
                    <feTurbulence
                        id="glitch-turbulence"
                        type="fractalNoise"
                        baseFrequency="0.05 0.8"
                        numOctaves="1"
                        seed="2"
                        result="noise"/>

                    <!-- Смещение пикселей -->
                    <feDisplacementMap
                        id="glitch-displacement"
                        in="SourceGraphic"
                        in2="noise"
                        scale="0"
                        xChannelSelector="R"
                        yChannelSelector="G"
                        result="displaced"/>

                </filter>
            </defs>`;
        document.body.appendChild(svgDef);

        _turbulence  = document.getElementById('glitch-turbulence');
        _displacement = document.getElementById('glitch-displacement');

        // ── Полноэкранный оверлей (дополнительные эффекты поверх SVG-фильтра) ─
        _overlay = document.createElement('div');
        _overlay.id = OVERLAY_ID;
        _overlay.setAttribute('aria-hidden', 'true');
        document.body.appendChild(_overlay);
    }

    // ── Запуск одного глитча ──────────────────────────────────────────────────

    /**
     * Основная функция.
     * @param {object} opts
     */
    function trigger(opts = {}) {
        _init();

        const {
            duration   = 600,
            intensity  = 30,
            slices     = true,
            colorShift = true,
            scanFlash  = true,
        } = opts;

        // Отменяем предыдущую анимацию если ещё идёт
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }

        const startTime = performance.now();
        const bodyStyle = document.body.style;

        // Применяем SVG-фильтр к body
        bodyStyle.filter = `url(#${FILTER_ID})`;

        // Параметры тряски (меняются каждый кадр)
        const BASE_FREQ_X = 0.04 + Math.random() * 0.06;
        const BASE_FREQ_Y = 0.4 + Math.random() * 0.8;

        function frame(now) {
            const elapsed = now - startTime;
            const t = elapsed / duration; // 0 → 1

            if (t >= 1) {
                // Конец — убираем всё
                _cleanup(bodyStyle);
                return;
            }

            // Огибающая: резкий пик в начале, затухает
            // Пики случайны — не монотонно
            const env = Math.pow(1 - t, 0.6) * (0.5 + 0.5 * Math.random());

            // ── Дисторшн (SVG фильтр) ──
            const scale = intensity * env * (0.3 + 0.7 * Math.random());
            _displacement.setAttribute('scale', scale.toFixed(2));

            // Рандомизируем seed — даёт "дрожание" шума
            if (Math.random() < 0.3) {
                _turbulence.setAttribute('seed', Math.floor(Math.random() * 100));
            }

            // baseFrequency: по Y большая (горизонтальные полосы искажений)
            const fy = BASE_FREQ_Y * (0.8 + 0.4 * Math.random());
            _turbulence.setAttribute('baseFrequency', `${BASE_FREQ_X.toFixed(3)} ${fy.toFixed(3)}`);

            // ── RGB-сдвиг (text-shadow cyan + red) ──
            if (colorShift) {
                const shift = (intensity * env * 0.4 * Math.random()).toFixed(1);
                bodyStyle.textShadow = Math.random() < 0.5
                    ? `${shift}px 0 #ff0040, -${shift}px 0 #00ffff`
                    : 'none';
            }

            // ── Слайсы: случайный translate по X на body ──
            if (slices && Math.random() < 0.2) {
                const tx = ((Math.random() - 0.5) * intensity * 0.3 * env).toFixed(1);
                bodyStyle.transform = `translateX(${tx}px)`;
            } else if (slices) {
                bodyStyle.transform = '';
            }

            // ── Scan-flash: быстрая белая полоса ──
            if (scanFlash && Math.random() < 0.05 * intensity / 30) {
                _flashScan(env);
            }

            _rafId = requestAnimationFrame(frame);
        }

        _rafId = requestAnimationFrame(frame);

        // Дополнительные CSS-слайсы через оверлей
        if (slices) _triggerSlices(duration, intensity);
    }

    // ── Scan-flash: горизонтальная белая полоса ──────────────────────────────

    function _flashScan(intensity) {
        const line = document.createElement('div');
        const top  = Math.random() * 100;
        const h    = 2 + Math.random() * 8;
        line.style.cssText = `
            position: fixed;
            top: ${top}%;
            left: 0; right: 0;
            height: ${h}px;
            background: rgba(255,255,255,${0.3 + intensity * 0.4});
            pointer-events: none;
            z-index: 99999;
            mix-blend-mode: screen;
        `;
        document.body.appendChild(line);
        setTimeout(() => line.remove(), 80 + Math.random() * 120);
    }

    // ── CSS-слайсы (clip-path рандомные куски экрана) ────────────────────────

    function _triggerSlices(duration, intensity) {
        const count  = Math.floor(2 + intensity / 20);
        const endMs  = Date.now() + duration * 0.7;

        function makeSlice() {
            if (Date.now() > endMs) return;

            const top    = Math.random() * 90;
            const h      = 1 + Math.random() * 12;
            const offset = ((Math.random() - 0.5) * intensity * 0.5).toFixed(1);
            const slice  = document.createElement('div');

            slice.style.cssText = `
                position: fixed;
                top: ${top}%;
                left: 0; right: 0;
                height: ${h}px;
                overflow: hidden;
                pointer-events: none;
                z-index: 99998;
                transform: translateX(${offset}px);
                background: rgba(${Math.random()<0.5?'0,255,200':'255,0,64'},0.07);
                mix-blend-mode: screen;
            `;

            document.body.appendChild(slice);
            const life = 40 + Math.random() * 150;
            setTimeout(() => slice.remove(), life);

            const nextIn = 30 + Math.random() * 80;
            setTimeout(makeSlice, nextIn);
        }

        for (let i = 0; i < count; i++) {
            setTimeout(makeSlice, Math.random() * duration * 0.3);
        }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    function _cleanup(bodyStyle) {
        bodyStyle.filter      = '';
        bodyStyle.textShadow  = '';
        bodyStyle.transform   = '';
        if (_displacement) _displacement.setAttribute('scale', '0');
        _overlay.innerHTML    = '';
        _rafId = null;
    }

    // ── Ambient loop (постоянные лёгкие подёргивания) ────────────────────────

    function loop(opts = {}) {
        if (_isLooping) return;
        _isLooping = true;

        const {
            minInterval = 4000,
            maxInterval = 12000,
            intensity   = 15,
            duration    = 300,
        } = opts;

        function scheduleNext() {
            if (!_isLooping) return;
            const wait = minInterval + Math.random() * (maxInterval - minInterval);
            _loopRafId = setTimeout(() => {
                trigger({ intensity, duration, slices: true, colorShift: true, scanFlash: false });
                scheduleNext();
            }, wait);
        }

        scheduleNext();
    }

    function stopLoop() {
        _isLooping = false;
        clearTimeout(_loopRafId);
        _loopRafId = null;
    }

    function isLooping() { return _isLooping; }

    // ── Публичный API ─────────────────────────────────────────────────────────

    return { trigger, loop, stopLoop, isLooping };

})();


