// =============================================================================
//  cmd_get.js — Команда GET для терминала досье
//  Загружает список папок через GitHub API, ищет совпадения и рендерит досье.
//  Рендер делегируется StepRenderer из renderer.js.
// =============================================================================

const GITHUB_USER    = "izzzi-lol";           // Ваш GitHub username
const GITHUB_REPO    = "izzzi-lol.github.io"; // Ваш репозиторий
const DOSSIERS_ROOT  = "dossiers";             // Папка с досье в репозитории
const DOSSIERS_BRANCH = "DossiersBase";        // Бранч, где хранятся досье

// Базовый URL для загрузки сырых файлов с нужного бранча
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${DOSSIERS_BRANCH}`;

// Токен хранится в двойном base64 — не идеальная защита, но лучше, чем plaintext.
// В продакшене лучше проксировать через свой backend.
const GITHUB_TOKEN = "WjJsMGFIVmlYM0JoZEY4eE1VSlBVVU5KTjFrd1ZsVmxZVEZZTjJJNFVYZFlYM0p6TlROQlprdHNUSEJTVjA1U1JESlBjVzFLZVdjMGRHNXdPR0UzZVdGRGQyTnNNRWhNTkdOeWFtUk9UVWRRTnpkR1VUVlFRM2xtVTNGMQ==";

const CmdGet = {
    // Кэш последних результатов поиска (для команды GET recent)
    recentMatches: [],

    // -------------------------------------------------------------------------
    //  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // -------------------------------------------------------------------------

    /** Стандартные заголовки для всех запросов к GitHub API. */
    _apiHeaders() {
        return {
            'Authorization':        `Bearer ${atob(atob(GITHUB_TOKEN))}`,
            'Accept':               'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        };
    },

    // -------------------------------------------------------------------------
    //  GITHUB API: получение списка папок (с кэшированием)
    // -------------------------------------------------------------------------

    /**
     * Возвращает массив имён папок в DOSSIERS_ROOT.
     * Кэшируется в sessionStorage на 5 минут, чтобы не тратить лимит запросов.
     * @param {object} terminal
     * @returns {Promise<string[]>}
     */
    async fetchAvailableFolders(terminal) {
        const CACHE_KEY = 'dossier_folders_cache';
        const CACHE_TTL = 5 * 60 * 1000; // 5 минут

        // Проверяем кэш
        try {
            const cached = sessionStorage.getItem(CACHE_KEY);
            if (cached) {
                const { folders, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_TTL) return folders;
            }
        } catch (_) {
            // sessionStorage недоступен — просто игнорируем
        }

        const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${DOSSIERS_ROOT}?ref=${DOSSIERS_BRANCH}`;

        try {
            const response = await fetch(url, { headers: this._apiHeaders() });

            // Показываем лимит запросов в консоли для отладки
            const remaining = response.headers.get('X-RateLimit-Remaining');
            const resetTs   = response.headers.get('X-RateLimit-Reset');
            if (remaining !== null) {
                const resetTime = new Date(resetTs * 1000).toLocaleTimeString();
                console.log(`[GitHub API] Лимит: осталось ${remaining} запросов, сброс в ${resetTime}`);
            }

            if (!response.ok) {
                const errorMessages = {
                    401: "ОШИБКА API: Токен недействителен или не указан.",
                    403: "ОШИБКА API: Превышен лимит запросов. Попробуйте позже.",
                    404: "ОШИБКА API: Репозиторий или папка не найдены. Проверьте GITHUB_USER / GITHUB_REPO / DOSSIERS_ROOT.",
                };
                terminal.printError(errorMessages[response.status] ?? `ОШИБКА API: Статус ${response.status}.`);
                return [];
            }

            const data = await response.json();

            // Нас интересуют только директории — их имена и есть ID досье
            const folders = data
                .filter(item => item.type === 'dir')
                .map(item => item.name);

            // Сохраняем в кэш
            try {
                sessionStorage.setItem(CACHE_KEY, JSON.stringify({ folders, timestamp: Date.now() }));
            } catch (_) {}

            return folders;

        } catch (e) {
            terminal.printError(`Ошибка подключения к базе данных: ${e.message}`);
            return [];
        }
    },

    // -------------------------------------------------------------------------
    //  КОМАНДА: execute
    // -------------------------------------------------------------------------

    /**
     * Точка входа команды GET.
     * @param {string[]} args      Аргументы после команды GET
     * @param {object}   terminal  Объект терминала (printSystem / printError)
     */
    async execute(args, terminal) {
        if (args.length === 0) {
            terminal.printError("ОШИБКА: Укажите ID или имя. Пример: get 01005423");
            return;
        }

        const query = args.join(' ').toLowerCase();

        // Специальная команда: показать последние результаты поиска
        if (query === 'recent') {
            this.displayRecent(terminal, "");
            return;
        }

        terminal.printSystem(`ИНИЦИАЛИЗАЦИЯ ПОИСКА: "${query.toUpperCase()}"...`);

        try {
            // 1. Получаем список папок через GitHub API
            const folderIds = await this.fetchAvailableFolders(terminal);

            if (folderIds.length === 0) {
                terminal.printError("КРИТИЧЕСКАЯ ОШИБКА: База данных недоступна или пуста.");
                return;
            }

            const outputContainer = TerminalAPI.getOutputNode();

            // 2. Проверяем точное совпадение по ID (регистронезависимо)
            const exactId = folderIds.find(id => id.toLowerCase() === query);

            if (exactId) {
                const docResponse = await fetch(`${RAW_BASE}/${DOSSIERS_ROOT}/${exactId}/dossier.txt`);
                if (docResponse.ok) {
                    terminal.printSystem("ДОКУМЕНТ ПО ID НАЙДЕН.");
                    await new Promise(r => setTimeout(r, 20));
                    await this.renderStepByStep(await docResponse.text(), outputContainer, exactId);
                    return;
                }
                // Папка есть, но dossier.txt отсутствует — продолжаем полный поиск
            }

            // 3. Полнотекстовый поиск по всем dossier.txt
            const matches = [];

            for (const id of folderIds) {
                const docResponse = await fetch(`${RAW_BASE}/${DOSSIERS_ROOT}/${id}/dossier.txt`);
                if (!docResponse.ok) continue;

                const content = await docResponse.text();
                if (!content.toLowerCase().includes(query)) continue;

                const titleMatch = content.match(/\[TITLE\](.*)/);
                const title = titleMatch ? titleMatch[1].trim() : "UNNAMED";

                matches.push({ id, title, content });
            }

            // 4. Обработка результатов
            if (matches.length === 0) {
                terminal.printError("СОВПАДЕНИЙ НЕ НАЙДЕНО.");

            } else if (matches.length === 1) {
                terminal.printSystem(`НАЙДЕНА ЗАПИСЬ ПО ID: ${matches[0].id}`);
                await new Promise(r => setTimeout(r, 20));
                terminal.printSystem("Инициализация . . .");
                await this.renderStepByStep(matches[0].content, outputContainer, matches[0].id);

            } else {
                // Несколько совпадений — показываем список
                this.recentMatches = matches;
                this.displayRecent(terminal, query);
            }

        } catch (error) {
            terminal.printError(`СИСТЕМНЫЙ СБОЙ: ${error.message}`);
        }
    },

    // -------------------------------------------------------------------------
    //  ОТОБРАЖЕНИЕ СПИСКА СОВПАДЕНИЙ
    // -------------------------------------------------------------------------

    /**
     * Выводит список последних совпадений с контекстным превью.
     * @param {object} terminal
     * @param {string} query   Исходный запрос (для подсветки контекста)
     */
    displayRecent(terminal, query) {
        if (this.recentMatches.length === 0) {
            terminal.printSystem("СПИСОК ПУСТ.");
            return;
        }

        terminal.printSystem("\n--- РЕЗУЛЬТАТЫ ПОИСКА ---");

        for (const m of this.recentMatches) {
            let preview = "";

            if (query) {
                const cleanText = m.content.replace(/\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim();
                const words     = cleanText.split(' ');
                const foundIndex = words.findIndex(w => w.toLowerCase().includes(query));

                if (foundIndex !== -1) {
                    const start = Math.max(0, foundIndex - 3);
                    const end   = Math.min(words.length, foundIndex + 4);
                    preview = `...${words.slice(start, end).join(' ')}...`;
                }
            }

            terminal.printSystem(`[ID: ${m.id}] | ${m.title}`);
            if (preview) terminal.printSystem(`  └─ Контекст: "${preview}"`, '#888');
        }

        terminal.printSystem("---------------------------\n");
        terminal.printSystem("Для доступа к нужной записи введите команду GET [ID]");
    },

    // -------------------------------------------------------------------------
    //  РЕНДЕР ДОСЬЕ
    //  Тонкая обёртка над StepRenderer — вся логика в renderer.js
    // -------------------------------------------------------------------------

    /**
     * @param {string}  content         Текст файла
     * @param {Element} output          DOM-узел для вывода
     * @param {string}  folderId        ID папки (для путей к изображениям)
     * @param {object}  [localImageMap] Карта имён → data-URL для локальных изображений
     */
    async renderStepByStep(content, output, folderId, localImageMap = {}) {
        this._ensureBannerStyles();

        // Баннер пропуска анимации
        const banner = document.createElement('div');
        banner.id          = 'echo-interrupt-banner';
        banner.textContent = 'КЛИКНИТЕ ЗДЕСЬ, ЧТОБЫ ПРОПУСТИТЬ АНИМАЦИЮ';
        banner.addEventListener('click', () => renderer.skip());

        const consoleArea = document.getElementById('console-area');
        if (consoleArea?.parentNode) {
            consoleArea.insertAdjacentElement('afterend', banner);
        } else {
            document.body.appendChild(banner);
        }

        // Пробел → мгновенный вывод
        const onKeyDown = (e) => {
            if (e.code === 'Space' || e.key === ' ') {
                if (document.activeElement?.id === 'cmd-input') return;
                e.preventDefault();
                renderer.skip();
            }
        };
        document.addEventListener('keydown', onKeyDown);

        // Изображения берём с нужного бранча через raw URL
        const imageBase = `${RAW_BASE}/${DOSSIERS_ROOT}/${folderId}/`;

        try {
            await renderer.render(content, output, imageBase, localImageMap);
        } finally {
            banner.remove();
            document.removeEventListener('keydown', onKeyDown);
        }
    },

    /** Инжектирует CSS баннера один раз (guard по id). */
    _ensureBannerStyles() {
        if (document.getElementById('echo-banner-style')) return;
        const st = document.createElement('style');
        st.id = 'echo-banner-style';
        st.textContent = `
            #echo-interrupt-banner {
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                padding: 9px 20px;
                background: rgba(220, 30, 30, 0.07);
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
                color: rgba(200, 80, 255, 1);
            }
            #echo-interrupt-banner:active {
                background: rgba(220, 30, 30, 0.22);
            }
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
    },
};
