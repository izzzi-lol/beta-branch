// =============================================================================
//  audio-handler.js — Централизованное управление звуком
//
//  Два независимых канала громкости:
//    UI    — системные звуки окон (open / close / minimize / maximize / ambient)
//    ECHO  — аудиозаписи команды ECHO
//
//  Базовый API:
//    AudioHandler.init()                        — вызвать один раз при загрузке
//    AudioHandler.playUI(key)                   — воспроизвести UI-звук
//    AudioHandler.getEchoVolume()               — громкость ECHO (0–1)
//    AudioHandler.applyVolumes(cfg)             — применить из настроек
//
//  Расширенный API (ECHO и долгие звуки):
//    AudioHandler.play(src, opts)   → id        — запустить звук с полным контролем
//    AudioHandler.stop(id)                      — остановить по ID
//    AudioHandler.stopAll()                     — остановить все
//    AudioHandler.seek(id, timeSec)             — перемотать на таймкод
//    AudioHandler.getElapsed(id)    → number    — сколько секунд проиграно
//    AudioHandler.getActive()       → Map       — все активные звуки {id → info}
//    AudioHandler.setPitch(id, rate)            — изменить питч на лету (0.1 – 4.0)
//
//  opts = {
//    volume:  0..1      (default: _echoVolume)
//    pitch:   0.1..4.0  (default: 1.0)  — скорость/высота воспроизведения
//    loop:    boolean   (default: false)
//    id:      string    (default: авто-генерируется)
//    onEnd:   Function  — callback по завершению
//  }
//
//  Пример:
//    const id = AudioHandler.play('echoes/01/audio.mp3', { pitch: 1.2, volume: 0.8 });
//    AudioHandler.seek(id, 30);           // перемотать на 30 сек
//    AudioHandler.getElapsed(id);         // → 30.4
//    AudioHandler.setPitch(id, 0.8);      // замедлить
//    AudioHandler.stop(id);
// =============================================================================

const AudioHandler = (() => {

    // ── Ключи UI-звуков → пути ───────────────────────────────────────────────
    const UI_SOUNDS = {
        open:     'assets/sounds/windows/window_opening.mp3',
        close:    'assets/sounds/windows/window_closing.mp3',
        minimize: 'assets/sounds/windows/window_minimize.mp3',
        maximize: 'assets/sounds/windows/window_maximize.mp3',
        ambient:  'assets/sounds/ambient/ambient.mp3',
    };

    // ── Состояние ────────────────────────────────────────────────────────────
    const _preloaded   = {};         // key → HTMLAudioElement (предзагруженные)
    let   _uiVolume    = 0.5;
    let   _echoVolume  = 0.75;
    let   _ambientClone = null;

    // Реестр активных расширенных звуков
    // id → { audio: HTMLAudioElement, startedAt: Date.now(), seekOffset: number, pitch: number, onEnd: fn }
    const _active = new Map();

    let _idCounter = 0;
    function _genId() { return `sfx_${++_idCounter}_${Date.now()}`; }

    // ── Предзагрузка ─────────────────────────────────────────────────────────
    function _preload(key, src) {
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.addEventListener('error', () => {}, { once: true });
        _preloaded[key] = audio;
    }

    // =========================================================================
    //  БАЗОВЫЙ API (UI-звуки, без регистрации)
    // =========================================================================

    function init() {
        try {
            const saved = JSON.parse(localStorage.getItem('scipnet_settings') || '{}');
            _uiVolume   = (saved.uiVolume  ?? 50) / 100;
            _echoVolume = (saved.echoVolume ?? 75) / 100;
        } catch (_) {}

        for (const [key, src] of Object.entries(UI_SOUNDS)) {
            _preload(key, src);
        }
    }

    function playUI(key) {
        const src = _preloaded[key];
        if (!src || _uiVolume === 0) return;

        const clone = /** @type {HTMLAudioElement} */ (src.cloneNode());
        clone.volume = _uiVolume;
        clone.loop   = (key === 'ambient');

        // Pitch через playbackRate (не требует Web Audio API для простых случаев)
        // playbackRate меняет и скорость, и питч вместе — для UI-звуков это ок
        clone.play().catch(() => {});

        if (key === 'ambient') {
            _ambientClone = clone;
        } else {
            clone.addEventListener('ended', () => { clone.src = ''; }, { once: true });
        }
    }

    function getEchoVolume() { return _echoVolume; }

    function applyVolumes(cfg) {
        if (cfg.uiVolume   != null) _uiVolume   = cfg.uiVolume   / 100;
        if (cfg.echoVolume != null) _echoVolume = cfg.echoVolume / 100;
        if (_ambientClone) _ambientClone.volume = _uiVolume;

        // Обновляем громкость всех активных расширенных звуков
        for (const [, entry] of _active) {
            entry.audio.volume = _echoVolume * (entry.volumeScale ?? 1);
        }
    }

    // =========================================================================
    //  РАСШИРЕННЫЙ API
    // =========================================================================

    /**
     * Запустить звук с полным контролем.
     * Возвращает ID для дальнейшего управления.
     *
     * @param {string} src   — URL файла
     * @param {object} opts
     * @returns {string}     — ID звука
     */
    function play(src, opts = {}) {
        const {
            volume      = _echoVolume,
            pitch       = 1.0,
            loop        = false,
            id          = _genId(),
            startAt     = 0,       // начать с этой секунды
            onEnd       = null,
        } = opts;

        // Останавливаем если уже играет с таким ID
        if (_active.has(id)) stop(id);

        const audio = new Audio(src);
        audio.volume       = Math.max(0, Math.min(1, volume));
        audio.playbackRate = Math.max(0.1, Math.min(4.0, pitch));
        audio.loop         = loop;

        if (startAt > 0) audio.currentTime = startAt;

        const entry = {
            audio,
            // startedAt — момент реального старта воспроизведения (после загрузки)
            // используем для getElapsed() с учётом seekOffset
            startedAt:   null,
            seekOffset:  startAt,  // сколько секунд уже "прошло" до текущего play
            volumeScale: volume / (_echoVolume || 1),
            pitch,
            onEnd,
        };

        audio.addEventListener('canplay', () => {
            if (!_active.has(id)) return; // был остановлен пока грузился
            entry.startedAt = performance.now();
            audio.play().catch(() => {
                _active.delete(id);
            });
        }, { once: true });

        audio.addEventListener('ended', () => {
            _active.delete(id);
            onEnd?.();
        }, { once: true });

        audio.addEventListener('error', () => {
            _active.delete(id);
        }, { once: true });

        audio.load();
        _active.set(id, entry);
        return id;
    }

    /**
     * Остановить звук по ID.
     */
    function stop(id) {
        const entry = _active.get(id);
        if (!entry) return;
        entry.audio.pause();
        entry.audio.src = '';
        _active.delete(id);
        entry.onEnd?.();
    }

    /**
     * Остановить все активные расширенные звуки.
     */
    function stopAll() {
        for (const id of _active.keys()) stop(id);
    }

    /**
     * Перемотать на нужный таймкод (секунды).
     * Работает и во время воспроизведения.
     *
     * @param {string} id
     * @param {number} timeSec
     */
    function seek(id, timeSec) {
        const entry = _active.get(id);
        if (!entry) return;

        const t = Math.max(0, timeSec);
        entry.audio.currentTime = t;

        // Обновляем seekOffset чтобы getElapsed() считал правильно
        entry.seekOffset  = t;
        entry.startedAt   = performance.now();
    }

    /**
     * Сколько секунд звук уже проиграл с учётом перемоток.
     * Возвращает null если звук не найден.
     *
     * @param {string} id
     * @returns {number|null}
     */
    function getElapsed(id) {
        const entry = _active.get(id);
        if (!entry) return null;

        // Берём currentTime у HTMLAudioElement — браузер сам считает с учётом паузы
        return entry.audio.currentTime;
    }

    /**
     * Изменить питч активного звука на лету.
     * playbackRate меняет и скорость, и высоту тона одновременно.
     * Для чистого питча без изменения скорости нужен Web Audio API —
     * но для ECHO и UI-звуков совмещённый эффект звучит органично.
     *
     * @param {string} id
     * @param {number} rate   — 0.1 (очень низкий) .. 1.0 (норма) .. 4.0 (очень высокий)
     */
    function setPitch(id, rate) {
        const entry = _active.get(id);
        if (!entry) return;
        const clamped = Math.max(0.1, Math.min(4.0, rate));
        entry.audio.playbackRate = clamped;
        entry.pitch = clamped;
    }

    /**
     * Список всех активных расширенных звуков.
     * Возвращает Map: id → { elapsed, pitch, loop, src }
     *
     * @returns {Map<string, object>}
     */
    function getActive() {
        const result = new Map();
        for (const [id, entry] of _active) {
            result.set(id, {
                elapsed: entry.audio.currentTime,
                pitch:   entry.audio.playbackRate,
                loop:    entry.audio.loop,
                volume:  entry.audio.volume,
                src:     entry.audio.src,
                paused:  entry.audio.paused,
            });
        }
        return result;
    }

    // =========================================================================
    //  ЧИСТый PITCH-SHIFT через Web Audio API + AudioWorklet
    //  Темп не меняется — только высота тона.
    // =========================================================================

    let   _audioCtx       = null;   // единый AudioContext на всю страницу
    let   _workletLoaded  = false;  // флаг загрузки воркера

    // Реестр pitch-shifted источников: id → { source, gainNode, ctx, startedAt, offset }
    const _pitchActive = new Map();

    /**
     * Получить (или создать) AudioContext.
     * Браузеры требуют создания только после жеста пользователя.
     */
    function _getCtx() {
        if (!_audioCtx || _audioCtx.state === 'closed') {
            _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (_audioCtx.state === 'suspended') _audioCtx.resume();
        return _audioCtx;
    }

    /**
     * Загрузить AudioWorklet один раз.
     * @returns {Promise<void>}
     */
    async function _loadWorklet() {
        if (_workletLoaded) return;
        const ctx = _getCtx();
        // Путь к воркету — рядом с audio-handler.js
        await ctx.audioWorklet.addModule('js/core/pitch-worklet.js');
        _workletLoaded = true;
    }

    /**
     * Декодировать аудио-файл в AudioBuffer.
     * @param {string} src
     * @returns {Promise<AudioBuffer>}
     */
    async function _fetchBuffer(src) {
        const resp = await fetch(src);
        const arr  = await resp.arrayBuffer();
        return _getCtx().decodeAudioData(arr);
    }

    /**
     * Воспроизвести звук с чистым pitch-shift (темп не меняется).
     *
     * @param {string} src        — URL файла
     * @param {object} opts
     * @param {number} opts.pitch — множитель питча: 0.5 = октава вниз, 2.0 = октава вверх (default 1.0)
     * @param {number} opts.volume — 0..1 (default echoVolume)
     * @param {boolean} opts.loop
     * @param {string}  opts.id
     * @param {number}  opts.startAt — начать с этой секунды
     * @param {Function} opts.onEnd
     * @returns {Promise<string>} — ID для управления
     */
    async function playWithPitch(src, opts = {}) {
        const {
            pitch   = 1.0,
            volume  = _echoVolume,
            loop    = false,
            id      = _genId(),
            startAt = 0,
            onEnd   = null,
        } = opts;

        // Останавливаем предыдущий с тем же ID
        stopPitch(id);

        await _loadWorklet();
        const ctx = _getCtx();

        // Декодируем аудио
        const buffer = await _fetchBuffer(src);

        // Граф: source → pitchNode → gainNode → destination
        const source    = ctx.createBufferSource();
        source.buffer   = buffer;
        source.loop     = loop;

        const gainNode  = ctx.createGain();
        gainNode.gain.setValueAtTime(Math.max(0, Math.min(1, volume)), ctx.currentTime);

        let pitchNode = null;

        if (Math.abs(pitch - 1.0) > 0.01) {
            // Создаём фазовый вокодер
            pitchNode = new AudioWorkletNode(ctx, 'pitch-shifter', {
                numberOfInputs:  1,
                numberOfOutputs: 1,
                processorOptions: {},
            });

            // Устанавливаем начальный питч
            pitchNode.port.postMessage({ pitch });

            source.connect(pitchNode);
            pitchNode.connect(gainNode);
        } else {
            // Pitch = 1 — bypass воркета, прямое подключение
            source.connect(gainNode);
        }

        gainNode.connect(ctx.destination);

        // Запускаем с нужного таймкода
        const offset = Math.min(startAt, buffer.duration);
        source.start(0, offset);

        const entry = {
            source,
            pitchNode,
            gainNode,
            ctx,
            buffer,
            startedAt:   ctx.currentTime - offset,
            currentPitch: pitch,
            loop,
            onEnd,
        };

        source.addEventListener('ended', () => {
            if (_pitchActive.get(id) === entry) {
                _pitchActive.delete(id);
            }
            onEnd?.();
        });

        _pitchActive.set(id, entry);
        return id;
    }

    /**
     * Изменить питч активного pitch-shifted звука на лету.
     * @param {string} id
     * @param {number} pitch
     */
    function setPitchLive(id, pitch) {
        const entry = _pitchActive.get(id);
        if (!entry?.pitchNode) return;
        entry.pitchNode.port.postMessage({ pitch: Math.max(0.25, Math.min(4.0, pitch)) });
        entry.currentPitch = pitch;
    }

    /**
     * Перемотать pitch-shifted звук на таймкод.
     * (Перезапускает source с нового offset — единственный способ в Web Audio API)
     * @param {string} id
     * @param {number} timeSec
     */
    async function seekPitch(id, timeSec) {
        const entry = _pitchActive.get(id);
        if (!entry) return;

        const { buffer, currentPitch, gainNode, loop, onEnd } = entry;
        const volume = gainNode.gain.value;

        // Останавливаем текущий source
        try { entry.source.stop(); } catch (_) {}
        entry.source.disconnect();

        // Создаём новый source с той же позицией в графе
        const ctx    = _getCtx();
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop   = loop;

        const offset = Math.max(0, Math.min(timeSec, buffer.duration));

        if (entry.pitchNode) {
            source.connect(entry.pitchNode);
        } else {
            source.connect(gainNode);
        }

        source.start(0, offset);
        entry.source     = source;
        entry.startedAt  = ctx.currentTime - offset;

        source.addEventListener('ended', () => {
            if (_pitchActive.get(id) === entry) _pitchActive.delete(id);
            onEnd?.();
        });
    }

    /**
     * Сколько секунд проиграл pitch-shifted звук.
     * @param {string} id
     * @returns {number|null}
     */
    function getElapsedPitch(id) {
        const entry = _pitchActive.get(id);
        if (!entry) return null;
        const elapsed = _getCtx().currentTime - entry.startedAt;
        if (entry.loop) return elapsed % entry.buffer.duration;
        return Math.min(elapsed, entry.buffer.duration);
    }

    /**
     * Остановить pitch-shifted звук.
     * @param {string} id
     */
    function stopPitch(id) {
        const entry = _pitchActive.get(id);
        if (!entry) return;
        try { entry.source.stop(); } catch (_) {}
        entry.source.disconnect();
        entry.gainNode.disconnect();
        _pitchActive.delete(id);
        entry.onEnd?.();
    }

    /**
     * Все активные pitch-shifted звуки.
     * @returns {Map<string, object>}
     */
    function getActivePitch() {
        const result = new Map();
        for (const [id, entry] of _pitchActive) {
            result.set(id, {
                elapsed:  getElapsedPitch(id),
                pitch:    entry.currentPitch,
                loop:     entry.loop,
                volume:   entry.gainNode.gain.value,
                duration: entry.buffer.duration,
            });
        }
        return result;
    }

    // ── Публичный API ─────────────────────────────────────────────────────────
    return {
        // Базовый
        init,
        playUI,
        getEchoVolume,
        applyVolumes,
        // Расширенный (HTMLAudioElement — скорость + питч вместе)
        play,
        stop,
        stopAll,
        seek,
        getElapsed,
        getActive,
        setPitch,
        // Чистый pitch-shift (Web Audio API + Phase Vocoder)
        playWithPitch,   // async (src, opts) → id
        stopPitch,       // (id)
        seekPitch,       // async (id, timeSec)
        setPitchLive,    // (id, pitch) — на лету без перезапуска
        getElapsedPitch, // (id) → number
        getActivePitch,  // () → Map
    };

})();
