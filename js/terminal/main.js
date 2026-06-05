// --- ДОМ ЭЛЕМЕНТЫ ---
const input = document.getElementById('cmd-input');
const suggestion = document.getElementById('cmd-suggestion');
const output = document.getElementById('dossier-output');
const authOverlay = document.getElementById('auth-overlay');
const authTerminal = document.getElementById('auth-terminal');
const renderer = new StepRenderer();


//ПОЯВЛЯЕТСЯ ЛИ ПЛАШКА BETA-BRANCH ИЛИ НЕТ
let BetaBrach = false;

function introDelay(ms) {
    return Promise.race([
        new Promise(r => setTimeout(r, ms)),
    ]);
}

// --- URL ПАРАМЕТРЫ ---
let _urlParamsHandled = false;
async function handleUrlParams() {
    if (_urlParamsHandled) return;
    _urlParamsHandled = true;
    const urlParams = new URLSearchParams(window.location.search);
    const dossierId = urlParams.get('get');

    if (dossierId) {
        TerminalAPI.printSystem(`> АВТОМАТИЧЕСКИЙ ЗАПРОС СИСТЕМЫ: GET ${dossierId}`,'var(--terminal-green)');
        TerminalAPI.lockInput();
        await CmdGet.execute([dossierId], TerminalAPI);
        TerminalAPI.unlockInput();
    }

    window.history.replaceState({}, document.title, window.location.pathname);
}


// --- SCP СПЛЭШ ---
async function showSplash() {
    const splash = document.getElementById('scp-splash');
    const logo   = document.getElementById('splash-logo');
    const glow   = document.getElementById('splash-logo-glow');
    const sub    = document.getElementById('splash-sub');
    const delay  = introDelay;

    splash.style.display = 'flex';

    // Небольшая пауза, чтобы display:flex применился до старта анимаций
    await delay(80);

    // Запускаем анимацию SVG-логотипа и фонового свечения
    logo.classList.add('animate');
    glow.classList.add('animate');

    // Слова "SECURE. CONTAIN. PROTECT." появляются по очереди
    // пока стрелки ещё летят — создаёт ощущение динамики
    await delay(480);
    document.getElementById('sw-secure').classList.add('show');
    await delay(240);
    document.getElementById('sw-contain').classList.add('show');
    await delay(240);
    document.getElementById('sw-protect').classList.add('show');

    // Подпись
    await delay(200);
    sub.classList.add('show');

    // Держим собранный логотип на экране
    await delay(1600);

    // Плавное исчезновение сплэша
    splash.classList.add('fade-out');
    await delay(900); // ждём полного завершения анимации fade-out

    // Убираем из DOM-потока после исчезновения
    splash.style.display = 'none';
    // Сбрасываем классы на случай повторного показа
    splash.classList.remove('fade-out');
    logo.classList.remove('animate');
    glow.classList.remove('animate');
    ['sw-secure','sw-contain','sw-protect'].forEach(id => {
        document.getElementById(id).classList.remove('show');
    });
    sub.classList.remove('show');
    input.focus();
    await handleUrlParams();
}

// --- ЛОГИКА АВТОРИЗАЦИИ ---
async function startAuth() {
    authOverlay.style.display = 'flex';

    const progressWrap  = document.getElementById('auth-progress-wrap');
    const progressBar   = document.getElementById('auth-progress-bar');
    const progressLabel = document.getElementById('auth-progress-label');
    const scanner       = document.getElementById('auth-scanner');
    const authFinal     = document.getElementById('auth-final');

    const delay = introDelay;

    // Добавить строку в лог авторизации
    function printLog(text, color = '') {
        const line = document.createElement('div');
        line.className = 'log-line';
        line.textContent = text;
        if (color) line.style.color = color;
        authTerminal.appendChild(line);
        authTerminal.scrollTop = authTerminal.scrollHeight;
    }

    // Анимировать прогресс-бар от from до to за duration мс
    async function animateProgress(from, to, duration, label) {
        progressLabel.textContent = label;
        const steps = 30;
        const stepTime = duration / steps;
        const stepVal  = (to - from) / steps;
        for (let i = 0; i <= steps; i++) {
            progressBar.style.width = (from + stepVal * i) + '%';
            await delay(stepTime);
        }
    }

    // === ФАЗА 1: Системные логи ===
    await delay(200);
    const logs = [
        ["> SCIPNET BOOT SEQUENCE v4.1.9...",         120],
        ["> LOADING KERNEL MODULES...",               110],
        ["> MEMETIC HAZARD FILTER: ACTIVE",           110],
        ["> CONNECTING TO O5 MAINFRAME...",           130],
        ["> ENCRYPTING CHANNEL [AES-4096]...",        110],
        ["> VERIFYING DIGITAL SIGNATURE...",          100],
        ["> ANOMALOUS ENTITY SCAN: CLEAR",            100],
        ["> BIOMETRIC AUTHENTICATION REQUIRED.",      160],
    ];

    for (const [text, wait] of logs) {
        printLog(text);
        await delay(wait);
    }

    // === ФАЗА 2: Прогресс-бар ===
    await delay(100);
    progressWrap.style.display = 'flex';
    await animateProgress(0,  40, 400, 'LOADING CORE SYSTEMS...');
    await animateProgress(40, 75, 350, 'ESTABLISHING SECURE LINK...');
    await animateProgress(75, 95, 250, 'VERIFYING CREDENTIALS...');
    printLog("> CREDENTIALS VERIFIED. INITIATING BIOMETRIC SCAN...");
    await animateProgress(95, 100, 150, 'READY.');
    await delay(200);
    progressWrap.style.display = 'none';

    // === ФАЗА 3: Сканер сетчатки ===
    scanner.style.display = 'flex';
    printLog("> RETINA SCAN IN PROGRESS...");
    await delay(1400);

    printLog("> SCAN COMPLETE. ANALYZING...");
    await delay(400);
    scanner.style.display = 'none';

    // === ФАЗА 4: Результат ===
    printLog("> CLEARANCE LEVEL O5 DETECTED.", '#fff');
    await delay(300);
    authFinal.textContent = 'ACCESS GRANTED';
    authFinal.className = 'granted';
    await delay(700);

    // === ФАЗА 5: Переход к сплэшу ===
    // Плавно прячем текст терминала авторизации
    authTerminal.style.transition = 'opacity 0.5s ease, filter 0.5s ease';
    authTerminal.style.opacity = '0';
    authTerminal.style.filter = 'blur(10px)';
    authFinal.style.transition = 'opacity 0.5s ease';
    authFinal.style.opacity = '0';
    await delay(350);

    // Показываем сплэш (z-index 10000 > auth-overlay 9999 — сплэш поверх оверлея).
    // showSplash() блокирует до полного завершения анимации.
    showSplash();

    await delay(200);
    // После исчезновения сплэша убираем оверлей — он уже скрыт сплэшем,
    // поэтому мгновенное скрытие не заметно для пользователя.
    authOverlay.style.display = 'none';

    document.body.classList.remove('locked');
    localStorage.setItem('has_seen_intro', 'true');
}

window.onload = async () => {
    document.getElementById('beta-badge').ariaHidden = !BetaBrach;
    AudioHandler.init();
    TerminalAPI.lockInput();
    let hasSeenIntro = localStorage.getItem('has_seen_intro');
    if (!hasSeenIntro || (hasSeenIntro === 'false')) { // 5 минут
        document.body.classList.add('locked');
        await startAuth();
    } else {
        authOverlay.style.display = 'none';
        document.body.classList.remove('locked');
        input.focus();
    }
    AudioHandler.playUI('ambient');
    await renderer.render("[SIZE=24][SCP FOUNDATION'S DOSSIER HUB][/SIZE][TIMER=1]",
        output, '', null, false);
    await renderer.render(`Введите команду [CMD="help"]"help"[/CMD], чтобы приступить.`,
        output, '', null, false);
    await handleUrlParams();
    TerminalAPI.unlockInput();
};

// --- АВТОДОПОЛНЕНИЕ ---
input.addEventListener('input', () => {
    const val = input.value.toLowerCase();
    if (!val) { suggestion.textContent = ''; return; }
    const match = COMMAND_LIST.find(cmd => cmd.startsWith(val));
    suggestion.textContent = match ? input.value + match.slice(val.length) : '';
});

// --- ОБРАБОТКА ВВОДА ---
input.addEventListener('keydown', async (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        if (suggestion.textContent) {
            input.value = suggestion.textContent;
            suggestion.textContent = '';
        }
    }

    if (e.key === 'Enter') {
        const rawInput = input.value;
        if (!rawInput.trim()) return;

        TerminalAPI.printSystem(`> ${rawInput}`, '#fff');
        input.value = '';
        suggestion.textContent = '';
        TerminalAPI.lockInput();

        await CommandHandler.execute(rawInput, TerminalAPI);

        TerminalAPI.unlockInput();
    }
});

// --- API ТЕРМИНАЛА ---
const TerminalAPI = {
    getOutputNode: () => output,

    printError(text) {
        let el = document.createElement('div');
        el.style.color = 'var(--danger-color)';
        el.style.marginBottom = '10px';
        el.textContent = `[ОШИБКА] ${text}`;
        output.appendChild(el);
        this.scrollToBottom();
    },

    printSystem(text, color = 'var(--terminal-green)') {
        let el = document.createElement('div');
        el.style.color = color;
        el.style.marginBottom = '10px';
        el.textContent = text;
        output.appendChild(el);
        this.scrollToBottom();
    },

    clearScreen() {
        output.innerHTML = '';
    },

    scrollToBottom() {
        output.scrollTop = output.scrollHeight;
    },

    lockInput() {
        input.blur();          // явно убираем фокус ДО отключения
        input.disabled = true;
    },

    unlockInput() {
        input.disabled = false;
        // Фокус только на десктопе — на мобильных программный focus() без
        // жеста пользователя всё равно не открывает клавиатуру (iOS/Android).
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            input.focus();
        }
    },

    async typeAndExecute(command) {
        this.lockInput();
        input.value = '';
        suggestion.textContent = '';

        for (let i = 0; i < command.length; i++) {
            input.value += command[i];
            await new Promise(r => setTimeout(r, 60));
        }

        await new Promise(r => setTimeout(r, 400));

        this.printSystem(`> ${command}`, '#fff');
        input.value = '';
        suggestion.textContent = '';

        await CommandHandler.execute(command, TerminalAPI);
        this.unlockInput();
    },

    parseCmdTags(container) {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) textNodes.push(node);

        const tagRegex = /\[CMD="([^"]+)"\](\[.*?\])\[\/CMD\]/g;

        for (const textNode of textNodes) {
            const raw = textNode.textContent;
            if (!tagRegex.test(raw)) continue;
            tagRegex.lastIndex = 0;

            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let match;

            while ((match = tagRegex.exec(raw)) !== null) {
                const [fullMatch, command, label] = match;

                if (match.index > lastIndex) {
                    fragment.appendChild(document.createTextNode(raw.slice(lastIndex, match.index)));
                }

                const link = document.createElement('span');
                link.textContent = label;
                link.title = `Выполнить: ${command}`;
                link.style.cssText = `
                    color: var(--terminal-green);
                    cursor: pointer;
                    text-decoration: underline;
                    text-underline-offset: 3px;
                    font-weight: bold;
                    transition: opacity 0.2s;
                `;
                link.addEventListener('mouseenter', () => link.style.opacity = '0.7');
                link.addEventListener('mouseleave', () => link.style.opacity = '1');
                link.addEventListener('click', () => TerminalAPI.typeAndExecute(command));

                fragment.appendChild(link);
                lastIndex = match.index + fullMatch.length;
            }

            if (lastIndex < raw.length) {
                fragment.appendChild(document.createTextNode(raw.slice(lastIndex)));
            }

            textNode.parentNode.replaceChild(fragment, textNode);
        }
    },

    printHTML(html) {
        const el = document.createElement('div');
        el.innerHTML = html;
        this.parseCmdTags(el);
        output.appendChild(el);
        this.scrollToBottom();
    },
};
