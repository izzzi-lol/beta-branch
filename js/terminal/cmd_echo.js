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

const CmdEcho = {

    /** Активный StepRenderer — нужен для вызова .skip() при прерывании */
    _currentRenderer: null,
    /** Активный Audio-элемент */
    _currentAudio: null,

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

        // 2. Создаём аудиоэлемент
        const audio        = new Audio(`${ECHO_RAW_BASE}/${ECHOES_ROOT}/${id}/audio.mp3`);
        audio.preload      = 'auto';
        audio.volume = 0.75;
        this._currentAudio = audio;

        // 3. StepRenderer (без AbortSignal — текст всегда доходит до конца)
        this._currentRenderer = renderer;

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

        // 5. Запускаем аудио
        try {
            await audio.play();
        } catch (_) {
            terminal.printSystem('⚠ АУДИО НЕДОСТУПНО — ТОЛЬКО СУБТИТРЫ');
        }
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
            this._currentAudio    = null;
            terminal.unlockInput();
		}
    },

    // -------------------------------------------------------------------------
    //  ПРЕРЫВАНИЕ: аудио стоп + мгновенный вывод оставшегося текста
    // -------------------------------------------------------------------------

    _interrupt() {
        if (this._currentAudio && !this._currentAudio.paused) {
            this._currentAudio.pause();
            this._currentAudio.currentTime = 0;
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
