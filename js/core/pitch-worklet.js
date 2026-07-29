// =============================================================================
//  pitch-worklet.js — Phase Vocoder AudioWorkletProcessor
//
//  Чистый pitch-shift без изменения темпа.
//  Алгоритм: STFT → сдвиг частотных бинов → ISTFT → Overlap-Add
//
//  Загружается через AudioContext.audioWorklet.addModule('pitch-worklet.js')
//  Управление через MessagePort:
//    processor.port.postMessage({ pitch: 1.5 })  // сдвиг питча (0.25–4.0)
// =============================================================================

class PitchShifterProcessor extends AudioWorkletProcessor {

    static get parameterDescriptors() {
        return [{
            name:         'pitchRatio',
            defaultValue: 1.0,
            minValue:     0.25,
            maxValue:     4.0,
            automationRate: 'k-rate',
        }];
    }

    constructor(options) {
        super(options);

        const FFT_SIZE  = 2048;
        const HOP_SIZE  = FFT_SIZE / 4;   // 512 — оверлэп 75%

        this._fftSize   = FFT_SIZE;
        this._hopSize   = HOP_SIZE;
        this._frameSize = FFT_SIZE;

        // Буферы анализа
        this._analysisBuffer  = new Float32Array(FFT_SIZE);
        this._synthesisBuffer = new Float32Array(FFT_SIZE * 2); // двойной для OLA

        // Накопители для входа/выхода
        this._inputAccum  = new Float32Array(FFT_SIZE * 2);
        this._outputAccum = new Float32Array(FFT_SIZE * 2);
        this._inputPtr    = 0;
        this._outputPtr   = 0;
        this._filled      = 0;

        // Фазовое состояние
        this._lastPhase    = new Float32Array(FFT_SIZE);
        this._sumPhase     = new Float32Array(FFT_SIZE);
        this._lastSynthPhase = new Float32Array(FFT_SIZE);

        // Окно анализа/синтеза (Hann)
        this._window = new Float32Array(FFT_SIZE);
        for (let i = 0; i < FFT_SIZE; i++) {
            this._window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
        }

        // Нормализация OLA
        const norm = new Float32Array(FFT_SIZE * 2);
        for (let i = 0; i < FFT_SIZE * 2; i += HOP_SIZE) {
            for (let j = 0; j < FFT_SIZE && (i + j) < norm.length; j++) {
                norm[i + j] += this._window[j] * this._window[j];
            }
        }
        this._normFactor = norm;

        // Слушаем сообщения от основного потока (динамическая смена питча)
        this.port.onmessage = (e) => {
            if (e.data?.pitch != null) {
                // Обновляем параметр через port — AudioParam k-rate делает то же,
                // но port позволяет обновить без перепланировки
                this._manualPitch = e.data.pitch;
            }
        };

        this._manualPitch = null;
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

    // ── Один фрейм фазового вокодера ─────────────────────────────────────────

    _processFrame(input, pitch) {
        const N   = this._fftSize;
        const hop = this._hopSize;

        // Применяем окно Хана
        const re = new Float32Array(N);
        const im = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            re[i] = input[i] * this._window[i];
        }

        // Прямое FFT
        this._fft(re, im, false);

        // ── Анализ фаз + сдвиг бинов ─────────────────────────────────────────
        const freqPerBin = sampleRate / N;
        const twoPi      = 2 * Math.PI;

        // Спектр с новыми частотами
        const newRe = new Float32Array(N);
        const newIm = new Float32Array(N);

        for (let k = 0; k <= N / 2; k++) {
            const mag   = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
            const phase = Math.atan2(im[k], re[k]);

            // Истинная частота через разницу фаз
            let delta = phase - this._lastPhase[k];
            this._lastPhase[k] = phase;

            // Убираем ожидаемую фазу
            const expected = twoPi * k * hop / N;
            delta -= expected;

            // Оборачиваем в [-π, π]
            delta = delta - twoPi * Math.round(delta / twoPi);

            // Истинная частота бина
            const trueFreq = (k * freqPerBin) + (delta / hop) * (sampleRate / twoPi);

            // Целевой бин после сдвига питча
            const targetK = Math.round(k * pitch);
            if (targetK < 0 || targetK > N / 2) continue;

            // Аккумулируем фазу синтеза
            this._sumPhase[targetK] += (trueFreq * pitch / sampleRate) * hop * twoPi;

            const synthPhase = this._sumPhase[targetK];
            newRe[targetK] += mag * Math.cos(synthPhase);
            newIm[targetK] += mag * Math.sin(synthPhase);

            // Симметричная половина
            if (targetK > 0 && targetK < N / 2) {
                newRe[N - targetK] =  newRe[targetK];
                newIm[N - targetK] = -newIm[targetK];
            }
        }

        // Обратное FFT
        this._fft(newRe, newIm, true);

        // Окно синтеза + возвращаем результат
        const out = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            out[i] = newRe[i] * this._window[i];
        }
        return out;
    }

    // ── Основной цикл (вызывается браузером ~2.9мс при 128 samples / 44100Hz) ─

    process(inputs, outputs, parameters) {
        const input  = inputs[0]?.[0];
        const output = outputs[0]?.[0];
        if (!input || !output) return true;

        const pitch = this._manualPitch
            ?? parameters.pitchRatio[0]
            ?? 1.0;

        const blockSize = input.length; // обычно 128
        const N         = this._fftSize;
        const hop       = this._hopSize;

        // Накапливаем входные сэмплы
        for (let i = 0; i < blockSize; i++) {
            this._inputAccum[this._inputPtr++] = input[i];
        }

        // Обрабатываем полные фреймы
        while (this._inputPtr >= N) {
            // Берём фрейм
            const frame = new Float32Array(N);
            for (let i = 0; i < N; i++) frame[i] = this._inputAccum[i];

            // Сдвигаем буфер
            this._inputAccum.copyWithin(0, hop);
            this._inputPtr -= hop;

            if (Math.abs(pitch - 1.0) < 0.001) {
                // Питч = 1 — bypass, просто OLA без обработки
                for (let i = 0; i < N; i++) {
                    this._outputAccum[this._outputPtr + i] += frame[i] * this._window[i];
                }
            } else {
                const processed = this._processFrame(frame, pitch);
                for (let i = 0; i < N; i++) {
                    this._outputAccum[this._outputPtr + i] += processed[i];
                }
            }
            this._outputPtr += hop;

            // Нормализуем накопленный выход (убираем амплитудные артефакты OLA)
            if (this._outputPtr > hop) {
                const scale = 1 / (N / hop * 0.5 * 0.5); // hann window norm
                for (let i = 0; i < hop; i++) {
                    this._outputAccum[i] *= scale;
                }
            }
        }

        // Отдаём готовые сэмплы
        for (let i = 0; i < blockSize; i++) {
            output[i] = this._outputAccum[i] || 0;
        }

        // Сдвигаем выходной буфер
        this._outputAccum.copyWithin(0, blockSize);
        this._outputPtr = Math.max(0, this._outputPtr - blockSize);

        return true; // продолжаем работу
    }
}

registerProcessor('pitch-shifter', PitchShifterProcessor);
