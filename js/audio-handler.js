// =============================================================================
//  audio-handler.js — Централизованное управление звуком
//
//  Два независимых канала громкости:
//    UI    — системные звуки окон (open / close / minimize / maximize)
//    ECHO  — аудиозаписи команды ECHO
//
//  AudioHandler.init()               — вызвать один раз при загрузке
//  AudioHandler.playUI(key)          — воспроизвести UI-звук по ключу
//  AudioHandler.getEchoVolume()      — получить громкость ECHO (0–1)
//  AudioHandler.applyVolumes(cfg)    — применить из объекта настроек
// =============================================================================

const AudioHandler = (() => {

    // Ключи → пути к файлам
    const UI_SOUNDS = {
        open:     'assets/sounds/windows/window_opening.mp3',
        close:    'assets/sounds/windows/window_closing.mp3',
        minimize: 'assets/sounds/windows/window_minimize.mp3',
        maximize: 'assets/sounds/windows/window_maximize.mp3',
        ambient: 'assets/sounds/ambient/ambient.mp3',
    };

    // Предзагруженные Audio-объекты (используем cloneNode для параллельного воспроизведения)
    const _preloaded = {};

    // Текущие уровни громкости (0–1)
    let _uiVolume   = 0.5;
    let _echoVolume = 0.75;

    // Ссылка на активный ambient-клон (зациклен, ended не срабатывает)
    let _ambientClone = null;

    // ── Предзагрузка ─────────────────────────────────────────────────────────
    function _preload(key, src) {
        const audio = new Audio(src);
        audio.preload = 'auto';
        // Молча подавляем ошибки загрузки (файл может отсутствовать)
        audio.addEventListener('error', () => {}, { once: true });
        _preloaded[key] = audio;
    }

    // ── Публичные методы ─────────────────────────────────────────────────────

    /**
     * Инициализация: предзагружает все UI-звуки и читает громкость из настроек.
     * Вызывать один раз при старте страницы (после Settings.init()).
     */
    function init() {
        // Читаем громкость из сохранённых настроек
        try {
            const saved = JSON.parse(localStorage.getItem('scipnet_settings') || '{}');
            _uiVolume   = (saved.uiVolume   ?? 50) / 100;
            _echoVolume = (saved.echoVolume  ?? 75) / 100;
        } catch (_) {}

        // Предзагружаем звуки
        for (const [key, src] of Object.entries(UI_SOUNDS)) {
            _preload(key, src);
        }
    }

    /**
     * Воспроизвести UI-звук по ключу ('open' | 'close' | 'minimize' | 'maximize').
     * Использует cloneNode — позволяет параллельное воспроизведение одного звука.
     * Все ошибки (autoplay policy, файл не найден) подавляются молча.
     */
    function playUI(key) {
        const src = _preloaded[key];
        if (!src || _uiVolume === 0) return;

        const clone = /** @type {HTMLAudioElement} */ (src.cloneNode());
        clone.volume = _uiVolume;
        clone.loop = (key === 'ambient');
        clone.play().catch(() => {});

        if (key === 'ambient') {
            // Сохраняем ссылку, чтобы можно было обновить громкость на лету
            _ambientClone = clone;
        } else {
            // Освобждаем клон после окончания — нет утечки памяти
            clone.addEventListener('ended', () => {
                clone.src = '';
            }, { once: true });
        }
    }

    /**
     * Текущая громкость ECHO-аудио (0–1).
     * Используется в CmdEcho при создании Audio-объекта.
     */
    function getEchoVolume() {
        return _echoVolume;
    }

    /**
     * Применить громкость из объекта настроек (cfg.uiVolume, cfg.echoVolume — 0..100).
     * Вызывается из Settings.apply() при изменении слайдеров.
     */
    function applyVolumes(cfg) {
        if (cfg.uiVolume  != null) _uiVolume   = cfg.uiVolume  / 100;
        if (cfg.echoVolume != null) _echoVolume = cfg.echoVolume / 100;
        // Обновляем громкость активного ambient — зациклен, поэтому ended никогда не срабатывает
        if (_ambientClone) _ambientClone.volume = _uiVolume;
    }

    return { init, playUI, getEchoVolume, applyVolumes };

})();