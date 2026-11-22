// =============================================================================
//  pitch-worklet.js — Phase Vocoder AudioWorkletProcessor
//
//  Чистый pitch-shift без изменения темпа.
//  Алгоритм: STFT (Hann, N=2048, hop=512) → сдвиг спектра по истинным
//  частотам (phase-vocoder) → identity phase-locking (фазы неглавных бинов
//  привязываются к пиковым — спектр не рассыпается в «металл») → ISTFT →
//  overlap-add с точной нормализацией.
//
//  Качество звука против первой версии:
//    • ноль аллокаций в горячем цикле (главная причина щелчков/треска от GC)
//    • точная нормализация overlap-add: bypass и обработка выровнены по
//      громкости (раньше расходились в 1.33×)
//    • identity phase-locking — меньше металлического призвука на голосе
//    • смена питча на лету сглаживается (~100 мс) — без щелчков
//
//  Загружается через AudioContext.audioWorklet.addModule('pitch-worklet.js')
//  Управление через MessagePort:
//    node.port.postMessage({ pitch: 1.5 })   // сдвиг питча (0.25–4.0)
//  Начальный питч — через processorOptions: { pitch } (без рампы со старта).
// =============================================================================

class PitchShifterProcessor extends AudioWorkletProcessor {

    constructor(options) {
        super(options);

        const FFT_SIZE = 2048;
        const HOP_SIZE = FFT_SIZE / 4;   // оверлэп 75% (COLA для Hann)

        this._fftSize = FFT_SIZE;
        this._hopSize = HOP_SIZE;

        // ── Предаллоцированные буферы ────────────────────────────────────────
        // В process() и _processFrame() НИ ОДНОЙ аллокации — иначе GC рвёт
        // аудио-поток щелчками.
        const N    = FFT_SIZE;
        const half = N / 2;

        this._inputAccum  = new Float32Array(N * 2);
        this._outputAccum = new Float32Array(N * 2);
        this._frame       = new Float32Array(N);   // копия входного фрейма
        this._re          = new Float32Array(N);   // спектр анализа
        this._im          = new Float32Array(N);
        this._outRe       = new Float32Array(N);   // спектр синтеза
        this._outIm       = new Float32Array(N);
        this._synthFrame  = new Float32Array(N);   // результат IFFT × окно

        this._inputPtr  = 0;
        this._outputPtr = 0;

        // Окно Ханна
        this._window = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            this._window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / N));
        }

        // Точные константы нормализации overlap-add (не эвристика):
        //   bypass:    Σ_j w(i + jH)      = 2.0 для Hann, H = N/4
        //   processed: Σ_j w(i + jH)²     = 1.5 (окно стоит с двух сторон)
        this._NORM_BYPASS = 2.0;
        this._NORM_PROC   = 1.5;

        // Фазовое состояние (half+1 бинов — односторонний спектр)
        this._lastPhase = new Float32Array(half + 1);  // фаза анализа прошлого фрейма
        this._sumPhase  = new Float32Array(half + 1);  // накопленная фаза синтеза (пики)
        this._synthPh   = new Float32Array(half + 1);  // итоговая фаза синтеза бина
        this._mag       = new Float32Array(half + 1);
        this._phs       = new Float32Array(half + 1);
        this._trueFreq  = new Float32Array(half + 1);
        this._peakOf    = new Int32Array(half + 1);    // пик-владелец региона бина
        this._isPeak    = new Uint8Array(half + 1);

        // Питч: текущий (плавный) и целевой.
        // Начальное значение — сразу без рампы (processorOptions от движка).
        const init = options?.processorOptions?.pitch ?? 1.0;
        this._targetPitch = init;
        this._pitch       = init;

        this.port.onmessage = (e) => {
            const p = e.data?.pitch;
            if (typeof p === 'number' && isFinite(p)) {
                this._targetPitch = Math.min(4.0, Math.max(0.25, p));
            }
        };
    }

    // ── FFT (Cooley–Tukey, iterative in-place) ────────────────────────────────

    _fft(re, im, inverse) {
        const n = re.length;
        const angle = (inverse ? 2 : -2) * Math.PI / n;

        // Bit-reversal permutation
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                [re[i], re[j]] = [re[j], re[i]];
                [im[i], im[j]] = [im[j], im[i]];
            }
        }

        for (let len = 2; len <= n; len <<= 1) {
            const wAngle = angle * (n / len);
            const wr = Math.cos(wAngle);
            const wi = Math.sin(wAngle);
            for (let i = 0; i < n; i += len) {
                let curR = 1, curI = 0;
                for (let j = 0; j < len / 2; j++) {
                    const uR = re[i + j];
                    const uI = im[i + j];
                    const vR = re[i + j + len/2] * curR - im[i + j + len/2] * curI;
                    const vI = re[i + j + len/2] * curI + im[i + j + len/2] * curR;
                    re[i + j]         = uR + vR;
                    im[i + j]         = uI + vI;
                    re[i + j + len/2] = uR - vR;
                    im[i + j + len/2] = uI - vI;
                    const newR = curR * wr - curI * wi;
                    curI = curR * wi + curI * wr;
                    curR = newR;
                }
            }
        }

        if (inverse) {
            for (let i = 0; i < n; i++) {
                re[i] /= n;
                im[i] /= n;
            }
        }
    }

    // ── Один фрейм фазового вокодера (заполняет this._synthFrame) ────────────

    _processFrame(pitch) {
        const N    = this._fftSize;
        const hop  = this._hopSize;
        const half = N / 2;
        const w    = this._window;
        const twoPi = 2 * Math.PI;

        // Окно анализа + прямое FFT (в предаллоцированные re/im)
        const re = this._re, im = this._im;
        const frame = this._frame;
        for (let i = 0; i < N; i++) re[i] = frame[i] * w[i];
        im.fill(0);
        this._fft(re, im, false);

        // ── Анализ: амплитуды, фазы, истинные частоты ─────────────────────────
        const mag = this._mag, phs = this._phs, tf = this._trueFreq;
        const lastPh = this._lastPhase;
        const binHz = sampleRate / N;

        for (let k = 0; k <= half; k++) {
            const r = re[k], m = im[k];
            mag[k] = Math.sqrt(r * r + m * m);
            const ph = Math.atan2(m, r);

            // Истинная частота через разницу фаз
            let delta = ph - lastPh[k] - twoPi * k * hop / N;
            delta -= twoPi * Math.round(delta / twoPi);
            lastPh[k] = ph;
            tf[k] = k * binHz + (delta / hop) * (sampleRate / twoPi);
            phs[k] = ph;
        }

        // ── Пики спектра (локальные максимумы) ────────────────────────────────
        const isPeak = this._isPeak;
        isPeak.fill(0);
        isPeak[0] = 1;   // DC — всегда якорь нижнего региона
        for (let k = 1; k < half; k++) {
            if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) isPeak[k] = 1;
        }
        if (mag[half] > mag[half - 1]) isPeak[half] = 1;

        // Регион бина = ближайший пик слева
        const peakOf = this._peakOf;
        let cur = 0;
        for (let k = 0; k <= half; k++) {
            if (isPeak[k]) cur = k;
            peakOf[k] = cur;
        }

        // ── Фаза синтеза ──────────────────────────────────────────────────────
        const sumPh = this._sumPhase, synthPh = this._synthPh;
        for (let k = 0; k <= half; k++) {
            if (isPeak[k]) {
                // Пик накапливает фазу по истинной частоте, сдвинутой на pitch —
                // партиал приземляется на частоту tf·pitch
                sumPh[k] += (tf[k] * pitch / sampleRate) * hop * twoPi;
                synthPh[k] = sumPh[k];
            } else {
                // Identity phase-locking (Laroche–Dolson): фаза бина = фаза
                // пика региона + исходный относительный офсет. Бины региона
                // движутся когерентно — без «металла».
                const p = peakOf[k];
                synthPh[k] = synthPh[p] + (phs[k] - phs[p]);
            }
        }

        // ── Сборка выходного спектра: величина → бин k·pitch (с интерполяцией) ─
        const outRe = this._outRe, outIm = this._outIm;
        outRe.fill(0);
        outIm.fill(0);

        for (let k = 0; k <= half; k++) {
            const m = mag[k];
            if (m < 1e-9) continue;

            const target = k * pitch;
            const k0 = Math.floor(target);
            const frac = target - k0;
            const ph = synthPh[k];
            const c = Math.cos(ph), s = Math.sin(ph);

            if (k0 <= half) {
                outRe[k0] += m * (1 - frac) * c;
                outIm[k0] += m * (1 - frac) * s;
            }
            if (frac > 0 && k0 + 1 <= half) {
                outRe[k0 + 1] += m * frac * c;
                outIm[k0 + 1] += m * frac * s;
            }
        }

        // Сопряжённая симметрия
        for (let k = 1; k < half; k++) {
            outRe[N - k] =  outRe[k];
            outIm[N - k] = -outIm[k];
        }

        // Обратное FFT + окно синтеза → в предаллоцированный буфер
        this._fft(outRe, outIm, true);
        const sf = this._synthFrame;
        for (let i = 0; i < N; i++) sf[i] = outRe[i] * w[i];
    }

    // ── Основной цикл (вызывается браузером ~2.9 мс при 128 сэмплов) ──────────

    process(inputs, outputs) {
        const input  = inputs[0]?.[0];
        const output = outputs[0]?.[0];
        if (!input || !output) return true;

        // Плавное приближение к целевому питчу — смена на лету без щелчков
        const tp = this._targetPitch;
        let p = this._pitch;
        if (p !== tp) {
            p += (tp - p) * 0.15;
            if (Math.abs(tp - p) < 0.002) p = tp;
            this._pitch = p;
        }

        const N    = this._fftSize;
        const hop  = this._hopSize;
        const w    = this._window;
        const frame = this._frame;
        const blockSize = input.length; // обычно 128
        const shifted = p !== 1.0;

        // Накапливаем входные сэмплы
        for (let i = 0; i < blockSize; i++) {
            this._inputAccum[this._inputPtr++] = input[i];
        }

        // Обрабатываем полные фреймы (шаг анализа = hop)
        while (this._inputPtr >= N) {
            for (let i = 0; i < N; i++) frame[i] = this._inputAccum[i];

            if (shifted) {
                this._processFrame(p);
                // Нормализация прямо при накоплении — каждый фрейм делится на
                // СВОЮ константу, поэтому уровень не прыгает при переходе
                // через pitch = 1 и при смене режима
                const sf = this._synthFrame;
                const norm = 1 / this._NORM_PROC;
                for (let i = 0; i < N; i++) {
                    this._outputAccum[this._outputPtr + i] += sf[i] * norm;
                }
            } else {
                const norm = 1 / this._NORM_BYPASS;
                for (let i = 0; i < N; i++) {
                    this._outputAccum[this._outputPtr + i] += frame[i] * w[i] * norm;
                }
            }
            this._outputPtr += hop;
            this._inputAccum.copyWithin(0, hop);
            this._inputPtr -= hop;
        }

        // Отдаём готовые сэмплы (моно-обработка зеркалится во все каналы)
        const out = outputs[0];
        for (let ch = 0; ch < out.length; ch++) {
            const o = out[ch];
            for (let i = 0; i < blockSize; i++) {
                o[i] = this._outputAccum[i] || 0;
            }
        }

        // Сдвигаем выходной буфер
        this._outputAccum.copyWithin(0, blockSize);
        this._outputPtr = Math.max(0, this._outputPtr - blockSize);

        return true; // продолжаем работу
    }
}

registerProcessor('pitch-shifter', PitchShifterProcessor);
