// =============================================================================
//  cmd_echo.js — Команда ECHO для терминала досье
//  Воспроизводит аудиозапись с синхронными субтитрами-титрами.
//
//  Структура директории:
//    echoes/
//      ID/
//        text.txt   — текст с тегами [SCROLLSPEED], [TIMER], etc.
//        audio.mp3  — аудиозапись
//
//  Использование: echo <ID>
//
//  Метаданные воспроизведения (в text.txt, строки !COM рендер игнорирует —
//  тот же формат, что у метаданных проводника досье):
//    !COM $EchoSpeed: 0.85   — темп (голос сохраняется), 0.25–4
//    !COM $EchoPitch: 0.9    — высота тона (темп не меняется), 0.25–4
//    !COM $EchoTape: true    — плёночный режим: скорость и высота вместе
//    !COM end$
//
//  Прерывание (пробел / клик):
//    — аудио останавливается немедленно
//    — текст домативается до конца мгновенно (skip-to-end)
// =============================================================================

const ECHOES_ROOT    = "echoes";
const ECHOES_BRANCH  = "DossiersBase";   // Бранч, где хранятся записи
const ECHO_RAW_BASE  = `https://raw.githubusercontent.com/izzzi-lol/izzzi-lol.github.io/${ECHOES_BRANCH}`;

// ─── Инжект CSS баннера (один раз) ───────────────────────────────────────────
(function _injectEchoBannerStyles() {
    if (document.getElementById('echo-banner-style')) return;
    const st = document.createElement('style');
    st.id = 'echo-banner-style';
    st.textContent = `
        /* ── Баннер прерывания ECHO ─────────────────────────────────── */
        #echo-interrupt-banner {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 9px 20px;
            background: rgba(162, 0, 255, 0.07);
            border-bottom: 1px solid rgba(220, 30, 30, 0.30);
            border-top: 1px solid rgba(220, 30, 30, 0.15);
            font-family: var(--mono-font, monospace);
            font-size: 0.70em;
            letter-spacing: 2px;
            color: rgba(220, 30, 30, 0.85);
            cursor: pointer;
            user-select: none;
            animation: echoBannerPulse 2s ease-in-out infinite;
            z-index: 20;
            position: relative;
            transition: background 0.15s, color 0.15s;
        }
        #echo-interrupt-banner:hover {
            background: rgba(220, 30, 30, 0.14);
            color: rgba(220, 30, 30, 1);
        }
        #echo-interrupt-banner:active {
            background: rgba(220, 30, 30, 0.22);
        }
        /* Пульсирующий индикатор ● */
        #echo-interrupt-banner::before {
            content: '●';
            font-size: 0.9em;
            animation: echoDotBlink 1s step-start infinite;
            color: rgba(220, 30, 30, 0.9);
        }
        @keyframes echoBannerPulse {
            0%, 100% { box-shadow: 0 0 8px rgba(220, 30, 30,0.15),
                                   inset 0 0 12px rgba(220, 30, 30,0.04); }
            50%      { box-shadow: 0 0 18px rgba(220, 30, 30,0.28),
                                   inset 0 0 20px rgba(220, 30, 30,0.08); }
        }
        @keyframes echoDotBlink {
            0%, 49% { opacity: 1; }
            50%, 100% { opacity: 0; }
        }
    `;
    document.head.appendChild(st);
})();

// =============================================================================

/**
 * Парсинг метаданных ECHO из !COM-блока text.txt (формат конвенции плагинов,
 * как у $ExplorerDossierDescription — строки !COM рендер не показывает).
 *
 * Поддерживаемые ключи: $EchoSpeed, $EchoPitch, $EchoTape.
 * Значения по умолчанию: скорость/питч 1.0, плёнка выключена.
 *
 * @param {string} text
 * @returns {{speed: number, pitch: number, tape: boolean}}
 */
function parseEchoMeta(text) {
    const meta = { speed: 1.0, pitch: 1.0, tape: false };
    const re = /^!COM\s+\$(EchoSpeed|EchoPitch|EchoTape)\s*[:=]\s*(.+)$/gim;
    let m;
    while ((m = re.exec(text)) !== null) {
        const key = m[1].toLowerCase();
        const raw = m[2].trim();
        if (key === 'echotape') {
            meta.tape = /^(true|1|yes|да|on)$/i.test(raw);
        } else {
            const v = parseFloat(raw.replace(',', '.'));
            if (isFinite(v)) {
                meta[key === 'echospeed' ? 'speed' : 'pitch'] = Math.min(4, Math.max(0.25, v));
            }
        }
    }
    return meta;
}

const CmdEcho = {

    /** Активный StepRenderer — нужен для вызова .skip() при прерывании */
    _currentRenderer: null,
    /** ID активного звука в AudioHandler */
    _currentAudioId: null,

    // -------------------------------------------------------------------------
    //  ТОЧКА ВХОДА
    // -------------------------------------------------------------------------

    /**
     * @param {string[]} args     Аргументы после команды ECHO
     * @param {object}   terminal Объект терминала (printSystem / printError)
     */
    async execute(args, terminal) {

        if (args.length === 0) {
            terminal.printError("ОШИБКА: Укажите ID записи. Пример: echo 01");
            return;
        }

        // Если что-то уже играет — прерываем его (аудио + мгновенный вывод хвоста)
        this._interrupt();

        const id = args[0].trim();

        terminal.printSystem(`ЗАПРОС ЗАПИСИ: "${id.toUpperCase()}"...`);

        // 1. Загружаем текст
        let textContent;
        try {
            const textResp = await fetch(`${ECHO_RAW_BASE}/${ECHOES_ROOT}/${id}/text.txt`);
            if (!textResp.ok) {
                terminal.printError(
                    textResp.status === 404
                        ? `ЗАПИСЬ НЕ НАЙДЕНА: ${id.toUpperCase()}`
                        : `ОШИБКА ЗАГРУЗКИ: HTTP ${textResp.status}`
                );
                return;
            }
            textContent = await textResp.text();
        } catch (e) {
            terminal.printError(`ОШИБКА ПОДКЛЮЧЕНИЯ: ${e.message}`);
            return;
        }

        // 2. Метаданные воспроизведения + аудио через движок:
        //    громкость — из настроек (echoVolume), speed/pitch/tape — из text.txt
        const meta = parseEchoMeta(textContent);
        this._currentAudioId = AudioHandler.play(
            `${ECHO_RAW_BASE}/${ECHOES_ROOT}/${id}/audio.mp3`,
            {
                speed:  meta.speed,
                pitch:  meta.pitch,
                tape:   meta.tape,
                onFail: () => terminal.printSystem('⚠ АУДИО НЕДОСТУПНО — ТОЛЬКО СУБТИТРЫ'),
            }
        );

        // 3. StepRenderer (без AbortSignal — текст всегда доходит до конца);
        //    субтитры растягиваются под скорость аудио, чтобы не разошлись;
        //    теги [AT]/[SYNC] ждут реальные отметки позиции записи
        this._currentRenderer = renderer;
        renderer.timeScale    = meta.speed;
        renderer.audioClock   = () => AudioHandler.getElapsed(this._currentAudioId);

        // 4. Баннер + слушатель пробела
        const banner    = this._createBanner();
        const onKeyDown = (e) => {
            if (e.code === 'Space' || e.key === ' ') {
                if (document.activeElement?.id === 'cmd-input') return;
                e.preventDefault();
                this._interrupt();
            }
        };
        window.addEventListener('keydown', onKeyDown, {capture: true});

        // 5. Запускаем аудио.
        // FIX: здесь был мёртвый блок `await audio.play()` — переменной `audio`
        // не существует (остаток рефакторинга на AudioHandler). ReferenceError
        // ловился catch'ем и на КАЖДОМ запуске печатал
        // «АУДИО НЕДОСТУПНО — ТОЛЬКО СУБТИТРЫ», даже когда звук играл нормально.
        // Провал воспроизведения обрабатывается через onFail в AudioHandler.play
        // (см. шаг 2 выше) — дублировать его здесь не нужно.
        // 6. Рендерим текст (ждём полного завершения)
        terminal.lockInput();
        const outputContainer = TerminalAPI.getOutputNode();

        terminal.printSystem(`— НАЧАЛО ЗАПИСИ ${id.toUpperCase()} —`);
        await new Promise(r => setTimeout(r, 20));
                try {
                await renderer.render(textContent, outputContainer, `${ECHO_RAW_BASE}/${ECHOES_ROOT}/${id}/`);
                } finally {
            banner.remove();
            window.removeEventListener('keydown', onKeyDown, { capture: true });
            this._currentRenderer = null;
            this._currentAudioId  = null;
            renderer.timeScale    = 1;      // глобальный инстанс — вернуть масштаб
            renderer.audioClock   = null;   // и аудио-часы тоже
            terminal.unlockInput();
                }
    },

    // -------------------------------------------------------------------------
    //  ПРЕРЫВАНИЕ: аудио стоп + мгновенный вывод оставшегося текста
    // -------------------------------------------------------------------------

    _interrupt() {
        if (this._currentAudioId) {
            AudioHandler.stop(this._currentAudioId);
            this._currentAudioId = null;
        }
        if (this._currentRenderer) {
            this._currentRenderer.skip();   // текст домотается мгновенно
        }
    },

    // -------------------------------------------------------------------------
    //  СОЗДАНИЕ БАННЕРА
    // -------------------------------------------------------------------------

    _createBanner() {
        const banner       = document.createElement('div');
        banner.id          = 'echo-interrupt-banner';
        banner.textContent = 'КЛИКНИТЕ ЗДЕСЬ, ЧТОБЫ ОСТАНОВИТЬ АУДИО';
        banner.addEventListener('click', () => this._interrupt());
        const consoleArea = document.getElementById('console-area');
        if (consoleArea?.parentNode) {
            consoleArea.insertAdjacentElement('afterend', banner);
        } else {
            document.body.appendChild(banner);
        }

        return banner;
    },
};
