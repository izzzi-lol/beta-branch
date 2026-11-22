// =============================================================================
//  app-echo.js — Архив ECHO (приложение SCIPNET OS)
//  Окно со списком записей echoes/ (GitHub Contents API + кеш).
//
//  Плейбэк ECHO — терминальный по своей природе (субтитры в #dossier-output,
//  баннер прерывания в консоли), поэтому клик по записи автоматически
//  переключает оболочку в режим консоли и запускает команду
//  `echo <ID>` через TerminalAPI.typeAndExecute.
// =============================================================================

const EchoArchive = (() => {

    const WINDOW_ID = 'echo-archive';
    const APP_ID    = 'echo';
    const CACHE_KEY = 'echo_folders_cache';
    const CACHE_TTL = 5 * 60 * 1000;

    function _register() {
        if (typeof AppRegistry === 'undefined' || AppRegistry.has(APP_ID)) return;
        AppRegistry.register({
            id: APP_ID,
            name: 'Архив ECHO',
            icon: AppRegistry.ICONS.echo,
            description: 'Аудиозаписи инцидентов',
            launch: () => EchoArchive.open(),
        });
    }

    // ── Список записей (GitHub API + кеш на 5 минут) ─────────────────────────
    async function _fetchRecords() {
        try {
            const cached = sessionStorage.getItem(CACHE_KEY);
            if (cached) {
                const { folders, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_TTL) return folders;
            }
        } catch (_) { /* sessionStorage недоступен */ }

        const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${ECHOES_ROOT}?ref=${ECHOES_BRANCH}`;

        const response = await fetch(url, { headers: CmdGet._apiHeaders() });
        if (!response.ok) throw new Error(`GITHUB API: HTTP ${response.status}`);

        const folders = (await response.json())
            .filter(item => item.type === 'dir')
            .map(item => item.name);

        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ folders, timestamp: Date.now() }));
        } catch (_) {}

        return folders;
    }

    /** RECORD-01-CI-MIRAGE → «01 · CI · MIRAGE» — читаемая подпись. */
    function _prettyName(id) {
        return id
            .replace(/^RECORD-/i, '')
            .split('-')
            .join(' · ')
            .toUpperCase();
    }

    function open() {
        const html = `
            <div class="os-echo">
                <div class="os-explorer-list" id="os-echo-list">
                    <div class="os-explorer-hint">ЗАПРОС АРХИВА…</div>
                </div>
                <div class="os-explorer-hint">
                    Воспроизведение — в терминале: субтитры идут синхронно с аудио.
                    Прерывание — пробел или клик по баннеру.
                </div>
            </div>`;

        WindowManager.open(WINDOW_ID, 'АРХИВ ECHO', html, {
            width: 500,
            height: 340,
            status: 'ECHO ARCHIVE // DossiersBase',
            backdrop: false,
        });

        requestAnimationFrame(async () => {
            const listEl = document.querySelector(`.lyoko-window[data-id="${WINDOW_ID}"] #os-echo-list`);
            if (!listEl) return;

            try {
                const records = await _fetchRecords();

                if (!records.length) {
                    listEl.innerHTML = '<div class="os-explorer-hint">АРХИВ ПУСТ.</div>';
                    return;
                }

                listEl.innerHTML = records.map(id => `
                    <button class="os-explorer-item" data-echo="${id}">
                        <span class="os-doc-icon">${AppRegistry.ICONS.echo}</span>
                        <span>${_prettyName(id)}</span>
                    </button>`).join('');

                listEl.querySelectorAll('.os-explorer-item').forEach(btn => {
                    btn.addEventListener('click', () => {
                        // Плейбэк терминальный — уходим в консоль и запускаем команду
                        if (typeof Desktop !== 'undefined') Desktop.showConsole();
                        TerminalAPI.typeAndExecute(`echo ${btn.dataset.echo}`);
                    });
                });
            } catch (e) {
                listEl.innerHTML = `<div class="os-explorer-hint">ОШИБКА АРХИВА: ${e.message}</div>`;
            }
        });
    }

    _register();

    return { open };

})();
