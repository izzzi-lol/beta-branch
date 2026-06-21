// =============================================================================
//  plugin-manager.js — Менеджер плагинов SCIPNET
//
//  Хранит плагины в IndexedDB.
//  При загрузке страницы восстанавливает все установленные плагины.
//
//  Схема записи:
//    {
//        id:          string,   // ключ (объявляется плагином в PluginAPI.register)
//        name:        string,
//        command:     string,   // имя терминальной команды
//        url:         string,   // откуда был загружен
//        code:        string,   // JS-код плагина
//        version:     string,
//        autostart:   boolean,  // true → команда плагина запускается сама при загрузке сайта
//        installedAt: number,
//        updatedAt:   number,
//    }
//
//  Зависит от plugin-api.js — загружается после него.
// =============================================================================

const PluginManager = (() => {

    const DB_NAME    = 'scipnet_plugins';
    const DB_VERSION = 1;
    const STORE      = 'plugins';

    // =========================================================================
    //  IndexedDB — вспомогательный слой
    // =========================================================================

    function _openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = e => resolve(e.target.result);
            req.onerror   = e => reject(e.target.error);
        });
    }

    // Shorthand: db → objectStore (нужный режим)
    const _store = (db, mode = 'readonly') =>
        db.transaction(STORE, mode).objectStore(STORE);

    const _idbGet = (store, key) => new Promise((res, rej) => {
        const r = store.get(key);
        r.onsuccess = () => res(r.result ?? null);
        r.onerror   = () => rej(r.error);
    });

    const _idbGetAll = store => new Promise((res, rej) => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result);
        r.onerror   = () => rej(r.error);
    });

    const _idbPut = (store, value) => new Promise((res, rej) => {
        const r = store.put(value);
        r.onsuccess = () => res(r.result);
        r.onerror   = () => rej(r.error);
    });

    const _idbDelete = (store, key) => new Promise((res, rej) => {
        const r = store.delete(key);
        r.onsuccess = () => res();
        r.onerror   = () => rej(r.error);
    });

    // =========================================================================
    //  Загрузка кода плагина (с CORS-fallback)
    //
    //  Многие хостинги (Pastebin, GitHub Gist raw и др.) не присылают
    //  заголовок Access-Control-Allow-Origin, поэтому браузер блокирует
    //  прямой fetch. Стратегия:
    //    1. Пробуем напрямую.
    //    2. Если браузер выбросил TypeError (CORS / сеть) — повторяем
    //       через публичный CORS-прокси.
    //    3. Если прокси тоже вернул не-2xx — пробрасываем ошибку дальше.
    // =========================================================================

    const CORS_PROXY = 'https://corsproxy.io/?url=';

    async function _fetchPlugin(url, terminal) {
        // ── Попытка 1: напрямую ───────────────────────────────────────────────
        try {
            const resp = await fetch(url);
            if (resp.ok) return await resp.text();
            // Сервер ответил, но статус плохой (404, 403 и т.п.) — прокси не поможет
            throw new Error(`HTTP ${resp.status}`);
        } catch (err) {
            // TypeError означает сетевую блокировку / CORS; любую другую — пробрасываем
            if (!(err instanceof TypeError)) throw err;
        }

        // ── Попытка 2: через CORS-прокси ─────────────────────────────────────
        terminal?.printSystem('  (прямой запрос заблокирован CORS — пробуем через прокси...)');
        const proxyResp = await fetch(CORS_PROXY + encodeURIComponent(url));
        if (!proxyResp.ok) throw new Error(`HTTP ${proxyResp.status} (через прокси)`);
        return await proxyResp.text();
    }

    // =========================================================================
    //  Выполнение кода плагина
    // =========================================================================

    /**
     * Выполняет JS-код плагина в глобальном контексте.
     * Эквивалентно добавлению <script> в DOM, но чуть быстрее.
     * Плагин вызывает PluginAPI.register() при выполнении.
     */
    function _run(code, pluginId) {
        try {
            // new Function не имеет доступа к локальным переменным этой функции —
            // только к глобальным window.* объектам, что нам и нужно.
            // eslint-disable-next-line no-new-func
            new Function(code)();
        } catch (err) {
            console.error(`[PluginManager] Ошибка в плагине "${pluginId}":`, err);
        }
    }

    // =========================================================================
    //  Патч CommandHandler
    //  Перехватываем execute() до того, как оригинальный обработчик получит управление.
    //  Вызывается один раз в init().
    // =========================================================================

    function _patchCommandHandler() {
        // CommandHandler объявлен через const в commands.js — он НЕ попадает в window,
        // поэтому window.CommandHandler всегда undefined. Проверяем через typeof.
        if (typeof CommandHandler === 'undefined' || !CommandHandler.execute) {
            console.warn('[PluginManager] CommandHandler не найден, плагин-команды не будут работать в терминале');
            return;
        }
        if (CommandHandler._pluginPatched) return; // идемпотентность
        CommandHandler._pluginPatched = true;

        const _original = CommandHandler.execute.bind(CommandHandler);

        CommandHandler.execute = async function(rawInput, terminal) {
            const tokens = rawInput.trim().split(/\s+/);
            const cmd    = tokens[0].toLowerCase();
            const args   = tokens.slice(1);

            const pluginCmd = PluginAPI.getCommands()[cmd];
            if (pluginCmd) {
                try {
                    await pluginCmd.execute(args, terminal);
                } catch (err) {
                    terminal.printError(`[ПЛАГИН] Необработанная ошибка: ${err.message}`);
                }
                return;
            }

            return _original(rawInput, terminal);
        };
    }

    /** Человекочитаемый размер файла: 1234 → "1.2 KB" */
    function _formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    // =========================================================================
    //  Диалог подтверждения — окно с hold-to-install кнопкой
    //
    //  Пользователь должен зажать кнопку на 2 секунды.
    //  Это снижает случайные установки и подчёркивает серьёзность действия.
    // =========================================================================

    const HOLD_MS = 2000; // сколько держать кнопку

    function _confirmWindow(source) {
        return new Promise(resolve => {
            // source — либо строка-URL (установка по ссылке), либо объект
            // { type:'file', name, size } для drag-n-drop установки локального файла.
            const isFile  = typeof source === 'object' && source.type === 'file';
            const rawText = isFile ? `${source.name}  (${_formatBytes(source.size)})` : source;
            const safeUrl = String(rawText).replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const bodyText = isFile
                ? `Код из <b>локального файла</b> будет выполнен прямо на этой странице.<br>
        Проверьте источник перед установкой. Вредоносный плагин может<br>
        получить доступ ко всем данным терминала.`
                : `Код из <b>внешнего источника</b> будет выполнен прямо на этой странице.<br>
        Проверьте источник перед установкой. Вредоносный плагин может<br>
        получить доступ ко всем данным терминала.`;

            const html = `
<style>
.pc-wrap{display:flex;flex-direction:column;gap:14px}

/* ── Заголовок предупреждения ── */
.pc-header{
    display:flex;align-items:center;gap:10px;
    padding:10px 12px;
    background:rgba(255,170,0,.06);
    border:1px solid rgba(255,170,0,.2);
}
.pc-icon{
    font-size:1.5em;color:rgba(255,170,0,.9);flex-shrink:0;
    animation:pc-blink 2s ease-in-out infinite;
}
@keyframes pc-blink{0%,100%{opacity:1}50%{opacity:.45}}
.pc-title{
    font-size:.72em;letter-spacing:2.5px;
    color:rgba(255,170,0,.9);
}

/* ── Тело ── */
.pc-body{
    font-size:.72em;line-height:1.75;
    color:rgba(200,200,200,.65);
    letter-spacing:.4px;
}
.pc-body b{color:rgba(255,200,80,.8);font-weight:normal}

/* ── URL ── */
.pc-url{
    font-size:.62em;word-break:break-all;
    color:rgba(0,200,180,.6);
    padding:5px 9px;
    background:rgba(0,0,0,.3);
    border-left:2px solid rgba(0,200,180,.25);
}

.pc-sep{height:1px;background:rgba(255,255,255,.06)}

/* ── Подсказка ── */
.pc-hint{
    font-size:.6em;letter-spacing:2px;
    color:rgba(255,255,255,.22);
    text-align:center;
}

/* ── Кнопки ── */
.pc-btns{display:flex;gap:10px}

/* Hold-кнопка */
.pc-hold{
    flex:1;position:relative;overflow:hidden;
    background:rgba(0,200,100,.06);
    border:1px solid rgba(0,200,100,.3);
    color:rgba(0,200,100,.85);
    font-family:var(--mono-font,monospace);
    font-size:.72em;letter-spacing:2px;
    padding:11px 10px;
    cursor:pointer;user-select:none;
    -webkit-tap-highlight-color:transparent;
    transition:border-color .15s;
}
.pc-hold:active,.pc-hold.holding{border-color:rgba(0,200,100,.7)}

/* Заливка при удержании */
.pc-fill{
    position:absolute;inset:0;
    width:0%;
    background:rgba(0,200,100,.2);
    box-shadow:inset 0 0 24px rgba(0,200,100,.08);
    pointer-events:none;
}

.pc-hold-label{
    position:relative;z-index:1;
    display:flex;align-items:center;justify-content:center;gap:8px;
}
.pc-timer{
    font-size:.85em;opacity:.55;
    min-width:3ch;text-align:right;
}

/* Кнопка отмены */
.pc-cancel{
    background:rgba(255,50,80,.06);
    border:1px solid rgba(255,50,80,.3);
    color:rgba(255,50,80,.8);
    font-family:var(--mono-font,monospace);
    font-size:.72em;letter-spacing:2px;
    padding:11px 14px;
    cursor:pointer;
    transition:background .15s, border-color .15s;
    user-select:none;
}
.pc-cancel:hover{background:rgba(255,50,80,.15);border-color:rgba(255,50,80,.55)}
</style>

<div class="pc-wrap">
    <div class="pc-header">
        <div class="pc-icon">⚠</div>
        <div class="pc-title">ПРЕДУПРЕЖДЕНИЕ БЕЗОПАСНОСТИ</div>
    </div>
    <div class="pc-body">
        ${bodyText}
    </div>
    <div class="pc-url">${safeUrl}</div>
    <div class="pc-sep"></div>
    <div class="pc-hint">УДЕРЖИВАЙТЕ КНОПКУ ${HOLD_MS / 1000} СЕКУНДЫ ДЛЯ ПОДТВЕРЖДЕНИЯ</div>
    <div class="pc-btns">
        <button class="pc-hold" id="pc-install">
            <div class="pc-fill" id="pc-fill"></div>
            <div class="pc-hold-label">
                <span>⏸ УСТАНОВИТЬ</span>
                <span class="pc-timer" id="pc-timer"></span>
            </div>
        </button>
        <button class="pc-cancel" id="pc-cancel">✕ ОТМЕНА</button>
    </div>
</div>`;

            WindowManager.open('plugin-confirm', 'ПОДТВЕРЖДЕНИЕ УСТАНОВКИ', html, {
                width:   420,
                minSize: 40,
                maxSize: 320,
                status:  'SECURITY CHECK',
				isResizable: false,
				backdrop: true
            });

            TerminalAPI.unlockInput();

            // Ждём отрисовку окна
            requestAnimationFrame(() => {
                const win        = document.querySelector('.lyoko-window[data-id="plugin-confirm"]');
                if (!win) { resolve(false); return; }

                const holdBtn    = win.querySelector('#pc-install');
                const cancelBtn  = win.querySelector('#pc-cancel');
                const fill       = win.querySelector('#pc-fill');
                const timerLabel = win.querySelector('#pc-timer');

                let holdTimeout  = null;
                let tickInterval = null;
                let isHolding    = false;

                function startHold() {
                    if (isHolding) return;
                    isHolding = true;
                    holdBtn.classList.add('holding');

                    const startedAt = Date.now();

                    // CSS-заливка: плавно растёт за HOLD_MS мс
                    fill.style.transition = `width ${HOLD_MS}ms linear`;
                    fill.style.width      = '100%';

                    // Тикаем обратный отсчёт
                    tickInterval = setInterval(() => {
                        const left = Math.max(0, HOLD_MS - (Date.now() - startedAt));
                        timerLabel.textContent = (left / 1000).toFixed(1) + 's';
                    }, 50);

                    // Срабатываем через HOLD_MS
                    holdTimeout = setTimeout(() => {
                        cleanup();
                        resolve(true);
                        WindowManager.close('plugin-confirm');
                    }, HOLD_MS);
                }

                function cancelHold() {
                    if (!isHolding) return;
                    isHolding = false;
                    holdBtn.classList.remove('holding');

                    clearTimeout(holdTimeout);
                    clearInterval(tickInterval);
                    holdTimeout = tickInterval = null;

                    // Откат заливки
                    fill.style.transition = 'width 0.3s ease';
                    fill.style.width      = '0%';
                    timerLabel.textContent = '';
                }

                function cleanup() {
                    clearTimeout(holdTimeout);
                    clearInterval(tickInterval);
                    holdBtn.removeEventListener('mousedown',  startHold);
                    holdBtn.removeEventListener('mouseup',    cancelHold);
                    holdBtn.removeEventListener('mouseleave', cancelHold);
                    holdBtn.removeEventListener('touchstart', onTouch);
                    holdBtn.removeEventListener('touchend',   cancelHold);
                    holdBtn.removeEventListener('touchcancel',cancelHold);
                }

                function onTouch(e) { e.preventDefault(); startHold(); }

                // Мышь
                holdBtn.addEventListener('mousedown',  startHold);
                holdBtn.addEventListener('mouseup',    cancelHold);
                holdBtn.addEventListener('mouseleave', cancelHold);

                // Тач
                holdBtn.addEventListener('touchstart',  onTouch,    { passive: false });
                holdBtn.addEventListener('touchend',    cancelHold);
                holdBtn.addEventListener('touchcancel', cancelHold);

                // Отмена
                cancelBtn.addEventListener('click', () => {
                    cleanup();
                    resolve(false);
                    WindowManager.close('plugin-confirm');
                });
            });
        });
    }

    // =========================================================================
    //  ПУБЛИЧНЫЙ API
    // =========================================================================

    /**
     * Вызвать ОДИН РАЗ из main.js → window.onload (до unlockInput).
     * Патчит CommandHandler и загружает все сохранённые плагины из IDB.
     */
    async function init() {
        _patchCommandHandler();

        let db;
        try {
            db = await _openDB();
        } catch (err) {
            console.error('[PluginManager] IndexedDB недоступна:', err);
            return;
        }

        let records;
        try {
            records = await _idbGetAll(_store(db));
        } finally {
            db.close();
        }

        for (const rec of records) {
            _run(rec.code, rec.id);
        }

        if (records.length > 0) {
            console.log(`[PluginManager] Загружено плагинов: ${records.length}`);
        }

        // =====================================================================
        //  Автозапуск
        //
        //  Плагины с autostart:true вызывают свою же зарегистрированную команду
        //  сразу после того, как все плагины выполнили register(). Не дожидаемся
        //  завершения (fire-and-forget) — иначе тяжёлый плагин (сетевые запросы,
        //  построение UI) блокировал бы остальной запуск сайта (auth/splash/
        //  приветственные сообщения в main.js, которые идут после init()).
        // =====================================================================

        const autostartRecs = records.filter(r => r.autostart);
        if (autostartRecs.length) {
            // PluginAPI.terminal — typeof-safe геттер на TerminalAPI (см. plugin-api.js).
            // К моменту вызова init() (window.onload) TerminalAPI уже объявлен.
            const terminal = PluginAPI.terminal;
            const commands = PluginAPI.getCommands();

            for (const rec of autostartRecs) {
                const cmd = commands[rec.command];
                if (!cmd) {
                    console.warn(`[PluginManager] Автозапуск: команда "${rec.command}" не найдена (${rec.id})`);
                    continue;
                }
                cmd.execute([], terminal).catch(err =>
                    console.error(`[PluginManager] Ошибка автозапуска "${rec.id}":`, err)
                );
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Устанавливает плагин по прямой ссылке на JS-файл.
     *
     * Алгоритм:
     *   1. Fetch кода
     *   2. Диалог подтверждения
     *   3. Выполнение кода (плагин вызывает PluginAPI.register())
     *   4. Сохранение в IDB
     */
    // =========================================================================
    //  ОКНО УСТАНОВКИ — UI прогресс-бара
    // =========================================================================

    /**
     * Открывает окно установки и возвращает контроллер { setStep, setMeta, finish, error }.
     * Шаги (0–100) анимируются плавно.
     */
    function _openInstallWindow() {
        const html = `
<style>
.pi-wrap{display:flex;flex-direction:column;gap:14px;padding:4px 0}
.pi-meta{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:.75em;letter-spacing:.5px}
.pi-key{color:rgba(0,200,180,.5);white-space:nowrap}
.pi-val{color:#b0e8ff;word-break:break-all}
.pi-url{color:rgba(0,200,180,.6);font-size:.65em;word-break:break-all;margin-top:-6px;opacity:.7}
.pi-sep{height:1px;background:rgba(0,200,180,.12);margin:2px 0}
.pi-step-label{font-size:.68em;letter-spacing:2px;color:rgba(0,200,180,.55)}
.pi-track{width:100%;height:4px;background:rgba(0,200,180,.1);border:1px solid rgba(0,200,180,.18);overflow:hidden;border-radius:1px}
.pi-bar{height:100%;width:0%;background:#00c8b4;transition:width .28s cubic-bezier(.4,0,.2,1);box-shadow:0 0 8px #00c8b4}
.pi-pct{font-size:.65em;color:#00c8b4;text-align:right;letter-spacing:1px;margin-top:3px}
.pi-status{font-size:.7em;min-height:1.4em;color:rgba(0,200,180,.7);letter-spacing:1px}
.pi-status.ok{color:#00e8a0}
.pi-status.err{color:rgba(255,80,100,.85)}
</style>
<div class="pi-wrap">
  <div class="pi-meta" id="pi-meta">
    <span class="pi-key">НАЗВАНИЕ</span><span class="pi-val" id="pi-name">—</span>
    <span class="pi-key">ВЕРСИЯ</span>  <span class="pi-val" id="pi-ver">—</span>
    <span class="pi-key">АВТОР</span>   <span class="pi-val" id="pi-author">—</span>
  </div>
  <div class="pi-url" id="pi-url"></div>
  <div class="pi-sep"></div>
  <div class="pi-step-label" id="pi-step">ОЖИДАНИЕ...</div>
  <div class="pi-track"><div class="pi-bar" id="pi-bar"></div></div>
  <div class="pi-pct" id="pi-pct">0%</div>
  <div class="pi-status" id="pi-st"></div>
</div>`;

        WindowManager.open('plugin-install', 'УСТАНОВКА ПЛАГИНА', html, {
            width:   380,
            minSize: 40,
            maxSize: 280,
            status:  'PLUGIN MANAGER',
        });

        // Ждём пока DOM отрисует окно
        const _get = id => document.querySelector(`.lyoko-window[data-id="plugin-install"] #${id}`);

        // Плавно анимируем прогресс-бар до нужного значения
        let _current = 0;
        function _setProgress(target, label) {
            const bar  = _get('pi-bar');
            const pct  = _get('pi-pct');
            const step = _get('pi-step');
            if (bar)  bar.style.width  = target + '%';
            if (pct)  pct.textContent  = target + '%';
            if (step && label) step.textContent = label;
            _current = target;
        }

        function _setMeta(meta, url) {
            const set = (id, val) => { const el = _get(id); if (el) el.textContent = val || '—'; };
            set('pi-name',   meta.name);
            set('pi-ver',    meta.version ? 'v' + meta.version : '—');
            set('pi-author', meta.author);
            const urlEl = _get('pi-url');
            if (urlEl) urlEl.textContent = url || '';
        }

        function _setStatus(msg, type = '') {
            const el = _get('pi-st');
            if (!el) return;
            el.textContent = msg;
            el.className = 'pi-status' + (type ? ' ' + type : '');
        }

        function _finish(opts = {}) {
            if (opts.autostart) {
                _setProgress(100, 'УСТАНОВЛЕНО · АВТОЗАПУСК ВКЛ');
                _setStatus('⚡ Установлен — будет запускаться автоматически', 'ok');
                // Чуть дольше держим окно — уведомление об автозапуске важно прочитать
                setTimeout(() => WindowManager.close('plugin-install'), 3200);
            } else {
                _setProgress(100, 'УСТАНОВЛЕНО');
                _setStatus('✓ Плагин успешно установлен', 'ok');
                setTimeout(() => WindowManager.close('plugin-install'), 2200);
            }
        }

        function _error(msg) {
            const bar = _get('pi-bar');
            if (bar) {
                bar.style.background = 'rgba(255,80,100,.8)';
                bar.style.boxShadow  = '0 0 8px rgba(255,80,100,.6)';
            }
            _setStatus('✕ ' + msg, 'err');
            _get('pi-step') && (_get('pi-step').textContent = 'ОШИБКА');
        }

        return { setProgress: _setProgress, setMeta: _setMeta, finish: _finish, error: _error };
    }

    // =========================================================================
    //  INSTALL
    // =========================================================================

    /**
     * Общая логика установки ПОСЛЕ подтверждения пользователя.
     * Источник кода: либо fetchUrl (сетевая загрузка через _fetchPlugin),
     * либо готовый code + pseudoUrl (локальный файл — сетевой запрос не нужен).
     */
    async function _runInstall({ terminal, fetchUrl, code, pseudoUrl }) {
        const ui  = _openInstallWindow();
        const url = fetchUrl || pseudoUrl;

        await new Promise(r => setTimeout(r, 120));

        // ── Шаг 1: Получение кода (0→35%) ─────────────────────────────────────
        if (!code) {
            // _fetchPlugin уже содержит CORS-fallback через прокси.
            ui.setProgress(5, 'ЗАГРУЗКА ФАЙЛА...');
            try {
                ui.setProgress(20, 'ЗАГРУЗКА ФАЙЛА...');
                code = await _fetchPlugin(fetchUrl, terminal);
                ui.setProgress(35, 'ФАЙЛ ПОЛУЧЕН');
            } catch (err) {
                ui.error(`Ошибка загрузки: ${err.message}`);
                terminal.printError(`ОШИБКА ЗАГРУЗКИ: ${err.message}`);
                return;
            }
        } else {
            // Код уже прочитан из локального файла (drag-n-drop) — сетевой запрос
            // не требуется, но сохраняем шаг прогресса для единообразия UX.
            ui.setProgress(20, 'ЧТЕНИЕ ЛОКАЛЬНОГО ФАЙЛА...');
            await new Promise(r => setTimeout(r, 100));
            ui.setProgress(35, 'ФАЙЛ ПРОЧИТАН');
        }

        // ── Шаг 2: Выполнение и валидация (35→60%) ──────────────────────────
        ui.setProgress(40, 'ПРОВЕРКА ПЛАГИНА...');
        await new Promise(r => setTimeout(r, 80));

        const cmdsBefore = new Set(Object.keys(PluginAPI.getCommands()));
        _run(code, '(pending)');

        const newCmds = Object.entries(PluginAPI.getCommands())
            .filter(([cmd]) => !cmdsBefore.has(cmd));

        if (newCmds.length === 0) {
            ui.error('Плагин не вызвал PluginAPI.register()');
            terminal.printError('Плагин не зарегистрировал команду.');
            return;
        }

        const [, meta] = newCmds[0];
        ui.setMeta(meta, url);
        ui.setProgress(60, 'ВАЛИДАЦИЯ...');
        await new Promise(r => setTimeout(r, 80));

        // ── Шаг 3: Проверка дублей (60→75%) ─────────────────────────────────
        let db;
        try {
            db = await _openDB();
            const existing = await _idbGet(_store(db), meta.id);
            if (existing) {
                ui.error(`Уже установлен v${existing.version}`);
                terminal.printSystem(`ℹ Плагин "${meta.name}" уже установлен.`);
                db.close();
                return;
            }
        } catch (err) {
            ui.error(`IDB: ${err.message}`);
            terminal.printError(`ОШИБКА IDB: ${err.message}`);
            db?.close();
            return;
        }

        ui.setProgress(75, 'СОХРАНЕНИЕ...');
        await new Promise(r => setTimeout(r, 60));

        // ── Шаг 4: Сохранение в IndexedDB (75→95%) ───────────────────────────
        // autostart — запрос самого плагина из PluginAPI.register({ autostart: true }).
        // Применяем как есть: это явное намерение автора, пользователь уже видел
        // окно подтверждения безопасности и поставил его, а после установки
        // получит отдельное уведомление и сможет отключить в любой момент.
        const record = {
            id:          meta.id,
            name:        meta.name,
            command:     newCmds[0][0],
            version:     meta.version,
            author:      meta.author || '—',
            url,
            code,
            autostart:   meta.autostart === true,
            installedAt: Date.now(),
            updatedAt:   Date.now(),
        };

        try {
            await _idbPut(_store(db, 'readwrite'), record);
        } catch (err) {
            ui.error(`Ошибка записи: ${err.message}`);
            terminal.printError(`ОШИБКА ЗАПИСИ: ${err.message}`);
            return;
        } finally {
            db.close();
        }

        ui.setProgress(95, 'РЕГИСТРАЦИЯ КОМАНДЫ...');
        await new Promise(r => setTimeout(r, 80));

        // ── Шаг 5: Готово (95→100%) ──────────────────────────────────────────
        ui.finish({ autostart: record.autostart });
        terminal.printSystem(`✓ УСТАНОВЛЕНО: ${meta.name} v${meta.version}  [${record.command}]`, 'rgba(0,200,100,.9)');

        // Уведомление об автозапуске — плагин запросил его сам через register().
        if (record.autostart) {
            terminal.printSystem(
                '⚡ АВТОЗАПУСК: плагин будет запускаться автоматически при каждой загрузке сайта.',
                'rgba(255,200,0,.85)'
            );
            terminal.printSystem(
                `  Отключить: plugin autostart ${record.id}   (или Settings → Плагины)`,
                'rgba(150,150,150,.6)'
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    // =========================================================================
    //  ОКНО ВЫБОРА ИСТОЧНИКА — открывается при "plugin install" без аргумента
    //  Drag-n-drop ограничен областью этого окна (не вся страница),
    //  плюс кнопка выбора файла через системный диалог и поле для URL.
    // =========================================================================

    function _openFilePickerWindow(terminal) {
        const winId = 'plugin-install-pick';

        const html = `
<style>
.pf-wrap{display:flex;flex-direction:column;gap:14px;padding:2px 0}
.pf-zone{
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:9px;
    padding:34px 18px;
    border:2px dashed rgba(0,200,100,.35);
    background:rgba(0,200,100,.03);
    color:rgba(0,200,100,.75);
    font-family:var(--mono-font,monospace);
    text-align:center;
    cursor:pointer;
    transition:border-color .15s, background .15s, color .15s;
}
.pf-zone.drag{ border-color:rgba(0,200,100,.8); background:rgba(0,200,100,.09); }
.pf-zone.reject{
    border-color:rgba(255,50,80,.55);
    background:rgba(255,50,80,.06);
    color:rgba(255,80,100,.85);
}
.pf-icon{font-size:2.1em;animation:pf-bob 1.6s ease-in-out infinite}
@keyframes pf-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.pf-title{font-size:.74em;letter-spacing:2px;text-transform:uppercase}
.pf-sub{font-size:.6em;letter-spacing:1.5px;color:rgba(0,200,100,.4)}
.pf-zone.reject .pf-sub{color:rgba(255,80,100,.55)}
.pf-or{
    display:flex;align-items:center;gap:10px;
    font-size:.6em;letter-spacing:2px;color:rgba(150,150,150,.4);
}
.pf-or::before,.pf-or::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.08)}
.pf-url-row{display:flex;gap:8px}
.pf-url-input{
    flex:1;
    background:rgba(0,0,0,.25);
    border:1px solid rgba(0,200,100,.25);
    color:#aee8c4;
    font-family:var(--mono-font,monospace);
    font-size:.72em;
    padding:8px 10px;
    outline:none;
    transition:border-color .15s;
}
.pf-url-input:focus{border-color:rgba(0,200,100,.55)}
.pf-url-btn{
    background:rgba(0,200,100,.08);
    border:1px solid rgba(0,200,100,.3);
    color:rgba(0,200,100,.85);
    font-family:var(--mono-font,monospace);
    font-size:.68em;letter-spacing:1.5px;
    padding:0 16px;
    cursor:pointer;
    transition:background .15s;
}
.pf-url-btn:hover{background:rgba(0,200,100,.16)}
</style>
<div class="pf-wrap">
  <label class="pf-zone" id="pf-zone">
    <input type="file" id="pf-file-input" accept=".js" style="display:none">
    <div class="pf-icon">⇩</div>
    <div class="pf-title">ПЕРЕТАЩИТЕ .JS ФАЙЛ СЮДА</div>
    <div class="pf-sub">ИЛИ НАЖМИТЕ ДЛЯ ВЫБОРА · ДО 2 МБ</div>
  </label>
  <div class="pf-or">URL</div>
  <div class="pf-url-row">
    <input type="text" class="pf-url-input" id="pf-url-input" placeholder="https://example.com/plugin.js" autocomplete="off" spellcheck="false">
    <button class="pf-url-btn" id="pf-url-btn">УСТАНОВИТЬ</button>
  </div>
</div>`;

        WindowManager.open(winId, 'УСТАНОВКА ПЛАГИНА', html, {
            width:   380,
            minSize: 40,
            maxSize: 280,
            status:  'PLUGIN MANAGER · ВЫБЕРИТЕ ИСТОЧНИК',
        });

        requestAnimationFrame(() => {
            const win = document.querySelector(`.lyoko-window[data-id="${winId}"]`);
            if (!win) return;

            const zone      = win.querySelector('#pf-zone');
            const fileInput = win.querySelector('#pf-file-input');
            const urlInput  = win.querySelector('#pf-url-input');
            const urlBtn    = win.querySelector('#pf-url-btn');

            let rejectTimer = null;
            function flashReject(msg) {
                zone.classList.add('reject');
                clearTimeout(rejectTimer);
                rejectTimer = setTimeout(() => zone.classList.remove('reject'), 650);
                if (msg) terminal.printError(msg);
            }

            async function handleFile(file) {
                if (!file) return;
                if (!/\.js$/i.test(file.name)) {
                    flashReject(`PLUGIN INSTALL: неверный тип файла "${file.name}" — ожидается .js`);
                    return;
                }
                WindowManager.close(winId);
                await installFromFile(file, terminal);
            }

            // Выбор через системный диалог (клик по зоне → скрытый <input type="file">)
            fileInput.addEventListener('change', () => handleFile(fileInput.files?.[0]));

            // Drag-n-drop — ограничен только этой зоной, не всей страницей
            ['dragenter', 'dragover'].forEach(evt =>
                zone.addEventListener(evt, e => {
                    e.preventDefault();
                    zone.classList.add('drag');
                })
            );
            zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
            zone.addEventListener('drop', e => {
                e.preventDefault();
                zone.classList.remove('drag');
                const files = Array.from(e.dataTransfer.files || []);
                const file  = files.find(f => /\.js$/i.test(f.name)) || files[0];
                handleFile(file);
            });

            // Альтернатива — установка по URL прямо из этого же окна
            async function submitUrl() {
                const val = urlInput.value.trim();
                if (!val) { urlInput.focus(); return; }
                WindowManager.close(winId);
                await install(val, terminal);
            }
            urlBtn.addEventListener('click', submitUrl);
            urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitUrl(); });
        });
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Устанавливает плагин по прямой ссылке на JS-файл.
     * Без аргумента — открывает окно выбора источника (drag-n-drop / файл / URL).
     */
    async function install(url, terminal) {
        if (!url) {
            _openFilePickerWindow(terminal);
            return;
        }

        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

        const confirmed = await _confirmWindow(url);
        if (!confirmed) {
            terminal.printSystem('УСТАНОВКА ОТМЕНЕНА.');
            return;
        }

        await _runInstall({ terminal, fetchUrl: url });
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Устанавливает плагин из локального .js файла — drag-n-drop на страницу
     * или программный вызов с объектом File. Сетевой запрос не требуется:
     * код читается напрямую через File.text().
     *
     * Источник записывается как "file://<имя файла>" — это позволяет
     * "plugin update" распознать локально установленные плагины и не пытаться
     * их перезагружать по несуществующему URL.
     */
    async function installFromFile(file, terminal) {
        if (!file) return;

        if (!/\.js$/i.test(file.name)) {
            terminal.printError(`PLUGIN INSTALL: неверный тип файла "${file.name}" — ожидается .js`);
            return;
        }

        const MAX_SIZE = 2 * 1024 * 1024; // 2 МБ — разумный потолок для одного плагина
        if (file.size > MAX_SIZE) {
            terminal.printError(
                `PLUGIN INSTALL: файл слишком большой (${_formatBytes(file.size)}, максимум ${_formatBytes(MAX_SIZE)})`
            );
            return;
        }

        let code;
        try {
            code = await file.text();
        } catch (err) {
            terminal.printError(`ОШИБКА ЧТЕНИЯ ФАЙЛА: ${err.message}`);
            return;
        }

        const confirmed = await _confirmWindow({ type: 'file', name: file.name, size: file.size });
        if (!confirmed) {
            terminal.printSystem('УСТАНОВКА ОТМЕНЕНА.');
            return;
        }

        terminal.printSystem(`УСТАНОВКА ИЗ ФАЙЛА: ${file.name}`);
        await _runInstall({ terminal, code, pseudoUrl: 'file://' + file.name });
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Удаляет плагин из IDB и снимает его команду.
     * Изменения в CommandHandler — мгновенные (команда перестаёт работать сразу).
     */
    async function remove(id, terminal) {
        if (!id) {
            terminal.printError('PLUGIN REMOVE: укажите ID плагина (см. plugin list)');
            return;
        }

        let db;
        try {
            db = await _openDB();
            const rec = await _idbGet(_store(db), id);

            if (!rec) {
                terminal.printError(`ПЛАГИН НЕ НАЙДЕН: "${id}"`);
                db.close();
                return;
            }

            await _idbDelete(_store(db, 'readwrite'), id);
            db.close();

            // Снимаем команду немедленно (не нужна перезагрузка)
            PluginAPI.unregister(id);

            // Чистим персистентное хранилище плагина (PluginAPI.storage),
            // чтобы удалённый плагин не оставлял мусор в IndexedDB.
            try {
                await PluginAPI.storage(id).clear();
            } catch (err) {
                console.warn(`[PluginManager] Не удалось очистить storage плагина "${id}":`, err);
            }

            terminal.printSystem(`✓ УДАЛЕНО: ${rec.name ?? id}`, 'rgba(0,200,100,0.9)');
        } catch (err) {
            terminal.printError(`ОШИБКА: ${err.message}`);
            db?.close();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Выводит список установленных плагинов.
     */
    async function list(terminal) {
        let db, records;
        try {
            db      = await _openDB();
            records = await _idbGetAll(_store(db));
            db.close();
        } catch (err) {
            terminal.printError(`ОШИБКА IDB: ${err.message}`);
            return;
        }

        if (records.length === 0) {
            terminal.printSystem('НЕТ УСТАНОВЛЕННЫХ ПЛАГИНОВ.');
            terminal.printSystem('  Установить: plugin install <url>');
            return;
        }

        terminal.printSystem(`\n─── ПЛАГИНЫ (${records.length}) ───────────────────`);
        for (const r of records) {
            const date = new Date(r.installedAt).toLocaleDateString('ru-RU');
            terminal.printSystem(`  ${r.id}  ${r.name}  v${r.version}${r.autostart ? '  ⚡AUTOSTART' : ''}  (${date})`);
            terminal.printSystem(`  └─ команда: ${r.command}  |  ${r.url}`, 'rgba(150,150,150,0.6)');
        }
        terminal.printSystem('───────────────────────────────────────\n');
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Перезагружает код плагина с исходного URL и обновляет IDB.
     * Новый код вступает в силу после перезагрузки страницы.
     */
    async function update(id, terminal) {
        if (!id) {
            terminal.printError('PLUGIN UPDATE: укажите ID плагина (см. plugin list)');
            return;
        }

        let db;
        try {
            db = await _openDB();
            const rec = await _idbGet(_store(db), id);

            if (!rec) {
                terminal.printError(`ПЛАГИН НЕ НАЙДЕН: "${id}"`);
                db.close();
                return;
            }

            if (rec.url.startsWith('file://')) {
                terminal.printError(`PLUGIN UPDATE: "${rec.name}" установлен из локального файла — автообновление недоступно.`);
                terminal.printSystem('  Удалите плагин и перетащите новую версию .js файла для переустановки.');
                db.close();
                return;
            }

            terminal.printSystem(`ОБНОВЛЕНИЕ: ${rec.name}  (${rec.url})`);

            const code = await _fetchPlugin(rec.url, terminal);

            await _idbPut(_store(db, 'readwrite'), {
                ...rec,
                code,
                updatedAt: Date.now(),
            });
            db.close();

            terminal.printSystem(`✓ ОБНОВЛЕНО: ${rec.name}`, 'rgba(0,200,100,0.9)');
            terminal.printSystem('  Перезагрузите страницу для применения изменений.');
        } catch (err) {
            terminal.printError(`ОШИБКА: ${err.message}`);
            db?.close();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Включает/выключает автозапуск плагина при загрузке сайта.
     * Переключатель (toggle) — повторный вызов отключает обратно.
     * Вступает в силу со следующей загрузки страницы.
     */
    async function autostart(id, terminal) {
        if (!id) {
            terminal.printError('PLUGIN AUTOSTART: укажите ID плагина (см. plugin list)');
            return;
        }

        let db;
        let rec;
        try {
            db  = await _openDB();
            rec = await _idbGet(_store(db), id);
            db.close();
        } catch (err) {
            terminal.printError(`ОШИБКА: ${err.message}`);
            db?.close();
            return;
        }

        if (!rec) {
            terminal.printError(`ПЛАГИН НЕ НАЙДЕН: "${id}"`);
            return;
        }

        const enabled = !rec.autostart;
        const ok = await setAutostart(id, enabled);
        if (!ok) {
            terminal.printError('ОШИБКА ЗАПИСИ В IndexedDB');
            return;
        }

        if (enabled) {
            terminal.printSystem(`✓ АВТОЗАПУСК ВКЛЮЧЁН: ${rec.name}`, 'rgba(0,200,100,0.9)');
            terminal.printSystem('  Команда будет выполняться автоматически при каждой загрузке сайта.');
        } else {
            terminal.printSystem(`АВТОЗАПУСК ОТКЛЮЧЁН: ${rec.name}`, 'rgba(150,150,150,0.7)');
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Тихая запись флага автозапуска — без терминальных сообщений.
     * Используется UI настроек (Settings → Плагины).
     * Возвращает true при успехе, false если плагин не найден / ошибка IDB.
     */
    async function setAutostart(id, enabled) {
        let db;
        try {
            db = await _openDB();
            const rec = await _idbGet(_store(db), id);
            if (!rec) { db.close(); return false; }
            await _idbPut(_store(db, 'readwrite'), { ...rec, autostart: enabled === true });
            db.close();
            return true;
        } catch (err) {
            console.error('[PluginManager] setAutostart():', err);
            db?.close();
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Возвращает массив всех установленных плагинов (сырые записи из IDB).
     * Используется UI настроек для построения панели «Плагины».
     */
    async function getAll() {
        let db;
        try {
            db = await _openDB();
            const records = await _idbGetAll(_store(db));
            db.close();
            return records;
        } catch (err) {
            console.error('[PluginManager] getAll():', err);
            db?.close();
            return [];
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    return { init, install, installFromFile, remove, list, update, autostart, getAll, setAutostart };

})();
