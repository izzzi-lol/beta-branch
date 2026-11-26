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
//  Движок ECHO-воспроизведения (один реестр, один play):
//    AudioHandler.play(src, opts)   → id        — запустить звук
//    AudioHandler.stop(id)                      — остановить по ID
//    AudioHandler.stopAll()                     — остановить все
//    AudioHandler.seek(id, timeSec)             — перемотать на таймкод
//    AudioHandler.getElapsed(id)    → number    — позиция (сек, медиа-время)
//    AudioHandler.getActive()       → Map       — все активные звуки
//    AudioHandler.setSpeed(id, s)               — темп на лету (голос сохраняется)
//    AudioHandler.setPitch(id, p)               — высота тона на лету (темп сохраняется)
//    AudioHandler.setTape(id, tape)             — включить/выключить плёночный режим
//
//  Независимые скорость и питч:
//    speed — темп через audio.playbackRate; preservesPitch = true, поэтому
//            замедление НЕ искажает голос (нативный time-stretch браузера).
//    pitch — чистая высота тона через AudioWorklet (js/core/pitch-worklet.js,
//            фазовый вокодер): темп не меняется. Граф (element → MediaElement-
//            Source → pitch-shifter → destination) подключается лениво, только
//            когда pitch ≠ 1, поэтому обычное воспроизведение остаётся
//            стриминговым и лёгким.
//    tape  — «плёночный» режим: preservesPitch = false, скорость и высота
//            меняются вместе (эффект старой плёнки). Параметр pitch при этом
//            игнорируется.
//
//  opts = {
//    volume:  0..1      (default: _echoVolume)
//    speed:   0.25..4   (default: 1.0)  — темп, голос сохраняется
//    pitch:   0.25..4   (default: 1.0)  — высота тона, темп не меняется
//    tape:    boolean   (default: false) — плёночный режим (pitch игнорируется)
//    loop:    boolean   (default: false)
//    id:      string    (default: авто-генерируется)
//    startAt: number    (default: 0)    — начать с этой секунды
//    onEnd:   Function  — по завершении (в т.ч. после stop)
//    onFail:  Function  — если аудио не смогло заиграть (нет файла / блок автоплея)
//  }
//
//  Если AudioWorklet недоступен (старый браузер) — pitch тихо игнорируется,
//  воспроизведение продолжается без него.
//
//  Пример:
//    const id = AudioHandler.play('echoes/01/audio.mp3', { speed: 0.8, pitch: 1.2 });
//    AudioHandler.seek(id, 30);           // перемотать на 30 сек
//    AudioHandler.setSpeed(id, 0.5);      // замедлить без искажения голоса
//    AudioHandler.setPitch(id, 0.8);      // понизить тон без изменения темпа
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

    // Единый реестр активных звуков движка:
    // id → { audio, speed, pitch, tape, volumeScale, onEnd, graph }
    // graph = { source: MediaElementAudioSourceNode, worklet: AudioWorkletNode } | null
    const _active = new Map();

    let _idCounter = 0;
    function _genId() { return `sfx_${++_idCounter}_${Date.now()}`; }

    const _clamp = (v, min, max) => Math.max(min, Math.min(max, v));

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

        // Громкость всех активных звуков движка (echoVolume работает для ECHO)
        for (const [, entry] of _active) {
            entry.audio.volume = _clamp(_echoVolume * (entry.volumeScale ?? 1), 0, 1);
        }
    }

    // =========================================================================
    //  WEB AUDIO: ленивый pitch-граф
    // =========================================================================

    let   _audioCtx      = null;   // единый AudioContext на всю страницу
    let   _workletLoaded = false;
    let   _workletFailed = false;  // после первой неудачи pitch не ретраим

    function _getCtx() {
        if (!_audioCtx || _audioCtx.state === 'closed') {
            _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return _audioCtx;
    }

    /**
     * Загружает AudioWorklet один раз.
     * @returns {Promise<boolean>} true — воркет доступен
     */
    async function _ensureWorklet() {
        if (_workletLoaded) return true;
        if (_workletFailed) return false;
        try {
            const ctx = _getCtx();
            // Путь к воркету — рядом с audio-handler.js
            await ctx.audioWorklet.addModule('js/core/pitch-worklet.js');
            _workletLoaded = true;
            return true;
        } catch (e) {
            console.warn('[AudioHandler] AudioWorklet недоступен — pitch игнорируется:', e?.message);
            _workletFailed = true;
            return false;
        }
    }

    /**
     * Лениво подключает pitch-граф к активному звуку:
     * element → MediaElementSource → pitch-shifter (AudioWorklet) → destination.
     *
     * До подключения звук идёт напрямую из элемента, поэтому play() вызывается
     * сразу и жест пользователя не теряется — питч «доезжает» следом.
     *
     * @param {string} id
     * @param {object} entry
     */
    async function _attachGraph(id, entry) {
        // FIX: защита от параллельного вызова. Два быстрых setPitch() подряд
        // запускали два _attachGraph: второй createMediaElementSource бросал
        // InvalidStateError, и питч молча сбрасывался в 1 (см. catch ниже).
        if (entry._attachInFlight) return;
        entry._attachInFlight = true;
        try {
            const ok = await _ensureWorklet();
            if (!ok || _active.get(id) !== entry) return;   // остановлен, пока грузился воркет
            try {
                const ctx = _getCtx();
                // FIX: resume теперь awaited — раньше не-awaited resume при
                // контексте, созданном без жеста пользователя, давал
                // MediaElementSource в suspended-графе: звук исчезал совсем.
                if (ctx.state === 'suspended') {
                    try { await ctx.resume(); } catch (_) { /* попробуем без него */ }
                }

                const source  = ctx.createMediaElementSource(entry.audio);
                const worklet = new AudioWorkletNode(ctx, 'pitch-shifter', {
                    numberOfInputs:  1,
                    numberOfOutputs: 1,
                    // FIX: читаем entry.pitch в момент подключения (а не в момент
                    // первого вызова) — параллельный setPitch уже обновил значение
                    processorOptions: { pitch: entry.pitch },
                });
                source.connect(worklet);
                worklet.connect(ctx.destination);
                entry.graph = { source, worklet };
            } catch (e) {
                console.warn('[AudioHandler] pitch-граф не подключился — питч пропущен:', e?.message);
                entry.pitch = 1;
            }
        } finally {
            entry._attachInFlight = false;
        }
    }

    // =========================================================================
    //  ДВИЖОК ECHO-ВОСПРОИЗВЕДЕНИЯ
    // =========================================================================

    /**
     * Запустить звук. Возвращает ID для дальнейшего управления.
     *
     * @param {string} src   — URL файла (стриминг, без полной загрузки в память)
     * @param {object} opts  — см. шапку файла
     * @returns {string}     — ID звука
     */
    function play(src, opts = {}) {
        const {
            volume   = _echoVolume,
            speed    = 1.0,
            pitch    = 1.0,
            tape     = false,
            loop     = false,
            id       = _genId(),
            startAt  = 0,
            onEnd    = null,
            onFail   = null,
        } = opts;

        // Останавливаем, если уже играет с таким ID
        if (_active.has(id)) stop(id);

        const clSpeed = _clamp(speed, 0.25, 4);
        // В плёночном режиме высота едет вместе со скоростью — питч не нужен
        const clPitch = tape ? 1.0 : _clamp(pitch, 0.25, 4);

        const audio = new Audio();
        // Обязательно ДО установки src: createMediaElementSource требует
        // CORS-clean источник (raw.githubusercontent.com отдаёт ACAO: *)
        audio.crossOrigin = 'anonymous';
        audio.src         = src;
        audio.preload     = 'auto';
        audio.volume      = _clamp(volume, 0, 1);
        audio.loop        = loop;
        audio.playbackRate = clSpeed;
        audio.preservesPitch       = !tape;   // скорость без искажения голоса
        audio.webkitPreservesPitch = !tape;   // старые Safari/Chrome

        const entry = {
            audio,
            speed: clSpeed,
            pitch: clPitch,
            tape,
            volumeScale: (_echoVolume > 0) ? volume / _echoVolume : 1,
            onEnd,
            graph: null,
            _failed: false,   // onFail срабатывает один раз
        };

        audio.addEventListener('ended', () => {
            // stop() уже снимает запись и звал onEnd — не звать дважды
            if (_active.get(id) !== entry) return;
            _active.delete(id);
            onEnd?.();
        }, { once: true });

        audio.addEventListener('error', () => {
            _fail(id, entry, onFail);
        }, { once: true });

        if (startAt > 0) {
            audio.addEventListener('loadedmetadata', () => {
                if (_active.get(id) !== entry) return;
                try { audio.currentTime = Math.min(startAt, audio.duration || startAt); } catch (_) {}
            }, { once: true });
        }

        _active.set(id, entry);

        // Питч ≠ 1 → подключаем воркет-граф (асинхронно, звук стартует сразу)
        if (clPitch !== 1.0) _attachGraph(id, entry);

        audio.load();

        // play() сразу — браузер сам доразуется, когда придут данные.
        // Вызов ДО любых await сохраняет жест пользователя (UPLOAD).
        const pr = audio.play();
        if (pr && pr.catch) {
            pr.catch(() => _fail(id, entry, onFail));
        }

        return id;
    }

    /** Единая точка «аудио не заиграло» — один вызов на entry, только если он жив. */
    function _fail(id, entry, onFail) {
        if (entry._failed) return;
        // Звук уже остановлен (stop чистит src → браузер кидает error) или
        // естественным образом завершился — это не «аудио недоступно»
        if (_active.get(id) !== entry) return;
        entry._failed = true;
        _active.delete(id);
        onFail?.();
    }

    /**
     * Остановить звук по ID (вызывает onEnd).
     */
    function stop(id) {
        const entry = _active.get(id);
        if (!entry) return;
        _active.delete(id);

        if (entry.graph) {
            try { entry.graph.source.disconnect(); } catch (_) {}
            try { entry.graph.worklet.disconnect(); } catch (_) {}
        }
        entry.audio.pause();
        entry.audio.src = '';   // обрываем загрузку из сети
        entry.onEnd?.();
    }

    /**
     * Остановить все активные звуки.
     */
    function stopAll() {
        for (const id of [..._active.keys()]) stop(id);
    }

    /**
     * Перемотать на нужный таймкод (секунды, медиа-время).
     * Работает и во время воспроизведения, на любом пути (с графом и без).
     */
    function seek(id, timeSec) {
        const entry = _active.get(id);
        if (!entry) return;
        try { entry.audio.currentTime = Math.max(0, timeSec); } catch (_) {}
    }

    /**
     * Позиция звука в секундах (медиа-время — с учётом скорости).
     * Возвращает null если звук не найден.
     */
    function getElapsed(id) {
        const entry = _active.get(id);
        if (!entry) return null;
        return entry.audio.currentTime;
    }

    /**
     * Изменить темп на лету (голос сохраняется).
     * @param {string} id
     * @param {number} speed   0.25 (медленно) .. 1.0 (норма) .. 4.0 (быстро)
     */
    function setSpeed(id, speed) {
        const entry = _active.get(id);
        if (!entry) return;
        entry.speed = _clamp(speed, 0.25, 4);
        entry.audio.playbackRate = entry.speed;
    }

    /**
     * Изменить высоту тона на лету (темп не меняется).
     * В плёночном режиме (tape) питч управляется скоростью — вызов игнорируется.
     * @param {string} id
     * @param {number} pitch   0.25 .. 4.0 (1.0 = норма; 2.0 = октава вверх)
     */
    function setPitch(id, pitch) {
        const entry = _active.get(id);
        if (!entry || entry.tape) return;
        const v = _clamp(pitch, 0.25, 4);
        entry.pitch = v;
        if (entry.graph && !entry.graph.bypassed) {
            entry.graph.worklet.port.postMessage({ pitch: v });
        } else if (entry.graph && entry.graph.bypassed) {
            // Граф был обойдён (tape off → pitch on): возвращаем воркет в цепочку
            try {
                entry.graph.source.disconnect();
                entry.graph.source.connect(entry.graph.worklet);
                entry.graph.worklet.connect(_getCtx().destination);
                entry.graph.worklet.port.postMessage({ pitch: v });
                entry.graph.bypassed = false;
            } catch (_) {}
        } else if (v !== 1.0) {
            // FIX: _attachGraph сам игнорирует повторный вызов, пока предыдущий
            // в полёте (entry._attachInFlight) — раньше гонка молча теряла питч.
            _attachGraph(id, entry);   // ленивое подключение при первом живом питче
        }
    }

    /**
     * Включить/выключить плёночный режим у уже играющего звука.
     * Нужен для UPLOAD: аудио стартует раньше, чем известны метаданные текста
     * (жест пользователя нельзя терять), поэтому режим применяется на лету.
     * @param {string} id
     * @param {boolean} tape
     */
    function setTape(id, tape) {
        const entry = _active.get(id);
        if (!entry) return;
        entry.tape = !!tape;
        entry.audio.preservesPitch       = !entry.tape;
        entry.audio.webkitPreservesPitch = !entry.tape;
        if (entry.tape && entry.graph) {
            // В плёнке питч едет со скоростью — воркет выводим из цепочки
            // (сам MediaElementSource отсоединить нельзя, но можно направить
            // его прямо в destination в обход воркета)
            try {
                entry.graph.source.disconnect();
                entry.graph.source.connect(_getCtx().destination);
                entry.graph.worklet.disconnect();
                entry.graph.bypassed = true;
            } catch (_) {}
        }
    }

    /**
     * Список всех активных звуков.
     * Возвращает Map: id → { elapsed, speed, pitch, tape, loop, volume, src, paused }
     */
    function getActive() {
        const result = new Map();
        for (const [id, entry] of _active) {
            result.set(id, {
                elapsed: entry.audio.currentTime,
                speed:   entry.speed,
                pitch:   entry.pitch,
                tape:    entry.tape,
                loop:    entry.audio.loop,
                volume:  entry.audio.volume,
                src:     entry.audio.src,
                paused:  entry.audio.paused,
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
        // Движок воспроизведения (единый реестр)
        play,        // (src, opts) → id
        stop,        // (id)
        stopAll,     // ()
        seek,        // (id, timeSec)
        getElapsed,  // (id) → number|null
        getActive,   // () → Map
        setSpeed,    // (id, speed)  — темп на лету, голос сохраняется
        setPitch,    // (id, pitch)  — высота тона на лету, темп сохраняется
        setTape,     // (id, tape)   — плёночный режим на лету
    };

})();
