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
            easing     = 'ease-out',   // 'ease-out' | 'ease-in-out' | 'ease-in'
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
            const env = _envelope(t, easing) * (0.5 + 0.5 * Math.random());

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

    // ── Slice-эффект ──────────────────────────────────────────────────────────
    //
    //  Разрезает экран на горизонтальные (или вертикальные) полосы и смещает
    //  каждую независимо по X / Y — точно как glitch-transition в видеоредакторах.
    //
    //  Технически: feComponentTransfer type="discrete" квантует плавный шум
    //  в N ступеней с чёткими краями → каждая ступень = один слайс с постоянным
    //  displacement. Seed меняется на каждом кадре → полосы "прыгают".
    //
    //  opts:
    //    direction  : 'x' | 'y' | 'both'  (default: 'x')
    //    sliceCount : 4..24               (default: 10)  — кол-во полос
    //    intensity  : 1..200              (default: 80)  — макс. смещение в px
    //    duration   : мс                 (default: 700)
    //    colorShift : boolean             (default: true)
    //    jumpRate   : 0..1               (default: 0.35) — вероятность смены seed/таблицы каждый кадр

    const SLICE_FILTER_ID = 'glitch-slice-filter';

    // Строит массив дискретных значений для feComponentTransfer.
    // Значения намеренно НЕ монотонные — так слайсы разлетаются в разные стороны
    // (0.5 = нейтрально, <0.5 = влево/вверх, >0.5 = вправо/вниз).
    // Огибающая интенсивности — определяет форму нарастания/затухания эффекта.
    // t ∈ [0, 1].  Случайное дрожание накладывается поверх в вызывающем коде.
    //
    //   'ease-out'     — мгновенный удар, затухание (поведение по умолчанию)
    //   'ease-in-out'  — плавное нарастание, пик в середине, плавное затухание
    //   'ease-in'      — нарастание к пику в конце, затем резкий обрыв
    function _envelope(t, easing) {
        switch (easing) {
            case 'ease-in-out':
                // sin(π·t): ноль на краях, единица в центре — идеальная колоколообразная кривая
                return Math.sin(Math.PI * t);
            case 'ease-in':
                // Зеркальное ease-out: нарастает к концу
                return Math.pow(t, 0.55);
            default: // 'ease-out'
                return Math.pow(1 - t, 0.55);
        }
    }

    function _buildSliceTable(count) {
        const v = [];
        for (let i = 0; i < count; i++) {
            // Кластеры у краёв диапазона → резкие смещения в обе стороны,
            // несколько нейтральных полос ближе к центру для контраста.
            const r = Math.random();
            if      (r < 0.3) v.push((Math.random() * 0.22).toFixed(3));      // сильно влево
            else if (r < 0.6) v.push((0.78 + Math.random() * 0.22).toFixed(3)); // сильно вправо
            else              v.push((0.40 + Math.random() * 0.20).toFixed(3)); // почти нейтрально
        }
        return v.join(' ');
    }

    // Создаёт (один раз) отдельный SVG-фильтр для slice-эффекта.
    // Если фильтр уже есть — возвращает его ссылки.
    function _initSliceFilter(direction) {
        if (document.getElementById(SLICE_FILTER_ID)) {
            return {
                turb : document.getElementById('gsl-turbulence'),
                disp : document.getElementById('gsl-displacement'),
                funcR: document.getElementById('gsl-func-r'),
                funcG: document.getElementById('gsl-func-g'),
            };
        }

        _init(); // убедимся что основной SVG-контейнер создан

        const defs = document.querySelector('#glitch-svg-defs defs');
        if (!defs) return null;

        // baseFrequency:
        //   direction='x' — горизонтальные полосы (высокая частота по Y, 0 по X)
        //   direction='y' — вертикальные  полосы (высокая частота по X, 0 по Y)
        //   direction='both' — оба направления
        const bfx = (direction === 'y' || direction === 'both') ? '0.35' : '0';
        const bfy = (direction === 'x' || direction === 'both') ? '0.35' : '0';

        // xChannel: 'R' смещает по X если direction='x'|'both', иначе нет смысла
        // yChannel: 'G' смещает по Y если direction='y'|'both'
        const xCh = (direction === 'x' || direction === 'both') ? 'R' : 'G';
        const yCh = (direction === 'y' || direction === 'both') ? 'G' : 'R';

        const f = document.createElementNS(SVG_NS, 'filter');
        f.setAttribute('id',    SLICE_FILTER_ID);
        f.setAttribute('x',     '-5%');  // небольшой запас по краям
        f.setAttribute('y',     '-5%');
        f.setAttribute('width', '110%');
        f.setAttribute('height','110%');
        f.setAttribute('color-interpolation-filters', 'sRGB');
        f.innerHTML = `
            <!-- Базовый шум: numOctaves=1 — нет высокочастотного мусора -->
            <feTurbulence
                id="gsl-turbulence"
                type="fractalNoise"
                baseFrequency="${bfx} ${bfy}"
                numOctaves="1"
                seed="1"
                result="rawNoise"/>

            <!-- Квантизация: discrete превращает плавный градиент в ступени.
                 R управляет смещением по X, G — по Y.
                 Нейтральное значение = 0.5 (displacement = 0). -->
            <feComponentTransfer in="rawNoise" result="qNoise">
                <feFuncR id="gsl-func-r" type="discrete" tableValues="0.5"/>
                <feFuncG id="gsl-func-g" type="discrete" tableValues="0.5"/>
                <feFuncB type="linear" slope="0" intercept="0.5"/>
            </feComponentTransfer>

            <!-- Displacement: scale=0 = нет эффекта, нарастает в trigger -->
            <feDisplacementMap
                id="gsl-displacement"
                in="SourceGraphic"
                in2="qNoise"
                scale="0"
                xChannelSelector="${xCh}"
                yChannelSelector="${yCh}"/>
        `;
        defs.appendChild(f);

        return {
            turb : document.getElementById('gsl-turbulence'),
            disp : document.getElementById('gsl-displacement'),
            funcR: document.getElementById('gsl-func-r'),
            funcG: document.getElementById('gsl-func-g'),
        };
    }

    // Активный handle для sliceTrigger (чтобы отменять при повторном вызове)
    let _sliceRafId = null;

    /**
     * Запустить glitch-slice эффект.
     *
     * @param {object} opts
     * @param {'x'|'y'|'both'} opts.direction   — ось смещения (default: 'x')
     * @param {number} opts.sliceCount           — кол-во полос 4..24 (default: 10)
     * @param {number} opts.intensity            — макс. смещение px (default: 80)
     * @param {number} opts.duration             — длительность мс (default: 700)
     * @param {boolean} opts.colorShift          — RGB-сдвиг (default: true)
     * @param {number}  opts.jumpRate            — 0..1, вероятность прыжка в кадре (default: 0.35)
     */
    function sliceTrigger(opts = {}) {
        const {
            direction  = 'x',
            sliceCount = 10,
            intensity  = 80,
            duration   = 700,
            colorShift = true,
            jumpRate   = 0.35,
            easing     = 'ease-out',   // 'ease-out' | 'ease-in-out' | 'ease-in'
        } = opts;

        const refs = _initSliceFilter(direction);
        if (!refs) { console.warn('[GlitchFX] sliceTrigger: SVG defs не найдены'); return; }

        const { turb, disp, funcR, funcG } = refs;

        // Отменяем предыдущий если ещё идёт
        if (_sliceRafId) { cancelAnimationFrame(_sliceRafId); _sliceRafId = null; }

        const bodyStyle = document.body.style;
        bodyStyle.filter = `url(#${SLICE_FILTER_ID})`;

        const startTime = performance.now();

        // Первая таблица — сразу хаотичная
        const initTable = _buildSliceTable(sliceCount);
        funcR.setAttribute('tableValues', initTable);
        funcG.setAttribute('tableValues', initTable);

        function frame(now) {
            const t = Math.min((now - startTime) / duration, 1);

            if (t >= 1) {
                // Финальная очистка
                bodyStyle.filter     = '';
                bodyStyle.textShadow = '';
                disp.setAttribute('scale', '0');
                _sliceRafId = null;
                return;
            }

            // Огибающая: быстрый резкий удар, плавное затухание
            // pow < 1 → медленнее затухает в конце (дольше видны слайсы)
            const env   = _envelope(t, easing) * (0.55 + 0.45 * Math.random());
            const scale = (intensity * env).toFixed(1);
            disp.setAttribute('scale', scale);

            // "Прыжок" полос: меняем seed → все полосы сразу перемещаются
            if (Math.random() < jumpRate) {
                turb.setAttribute('seed', Math.floor(Math.random() * 300));
            }

            // Переназначаем дискретные уровни → полосы меняют величину смещения
            if (Math.random() < jumpRate * 0.7) {
                const table = _buildSliceTable(sliceCount);
                if (direction === 'x' || direction === 'both') funcR.setAttribute('tableValues', table);
                if (direction === 'y' || direction === 'both') funcG.setAttribute('tableValues', table);
            }

            // RGB-сдвиг: работает независимо от SVG-фильтра, усиливает ощущение цифрового разрыва
            if (colorShift) {
                const cs = (intensity * env * 0.12 * Math.random()).toFixed(1);
                bodyStyle.textShadow = Math.random() < 0.65
                    ? `${cs}px 0 rgba(255,0,64,0.9), -${cs}px 0 rgba(0,255,200,0.9)`
                    : '';
            }

            _sliceRafId = requestAnimationFrame(frame);
        }

        _sliceRafId = requestAnimationFrame(frame);
    }

    // ── Публичный API ─────────────────────────────────────────────────────────

    return { trigger, loop, stopLoop, isLooping, sliceTrigger };

})();