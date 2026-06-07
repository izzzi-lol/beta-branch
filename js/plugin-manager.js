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

    // =========================================================================
    //  Диалог подтверждения — окно с hold-to-install кнопкой
    //
    //  Пользователь должен зажать кнопку на 2 секунды.
    //  Это снижает случайные установки и подчёркивает серьёзность действия.
    // =========================================================================

    const HOLD_MS = 2000; // сколько держать кнопку

    function _confirmWindow(url) {
        return new Promise(resolve => {
            const safeUrl = url.replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
        Код из <b>внешнего источника</b> будет выполнен прямо на этой странице.<br>
        Проверьте источник перед установкой. Вредоносный плагин может<br>
        получить доступ ко всем данным терминала.
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
            });

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

        function _finish() {
            _setProgress(100, 'УСТАНОВЛЕНО');
            _setStatus('✓ Плагин успешно установлен', 'ok');
            // Закрываем окно через 2.2 сек
            setTimeout(() => WindowManager.close('plugin-install'), 2200);
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

    async function install(url, terminal) {
        if (!url) {
            terminal.printError('PLUGIN INSTALL: укажите URL');
            terminal.printSystem('  Пример: plugin install https://example.com/my-plugin.js');
            return;
        }

        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

        // Показываем окно подтверждения с hold-to-install
        const confirmed = await _confirmWindow(url);
        if (!confirmed) {
            terminal.printSystem('УСТАНОВКА ОТМЕНЕНА.');
            return;
        }

        // Открываем окно установки
        const ui = _openInstallWindow();

        // Небольшая пауза — окно успевает отрисоваться
        await new Promise(r => setTimeout(r, 120));

        // ── Шаг 1: Загрузка (0→35%) ─────────────────────────────────────────
        ui.setProgress(5, 'ЗАГРУЗКА ФАЙЛА...');

        let code;
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            ui.setProgress(25, 'ЗАГРУЗКА ФАЙЛА...');
            code = await resp.text();
            ui.setProgress(35, 'ФАЙЛ ПОЛУЧЕН');
        } catch (err) {
            ui.error(`Ошибка загрузки: ${err.message}`);
            terminal.printError(`ОШИБКА ЗАГРУЗКИ: ${err.message}`);
            return;
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

        // ── Шаг 4: Сохранение в IndexedDB (75→95%) ──────────────────────────
        const record = {
            id:          meta.id,
            name:        meta.name,
            command:     newCmds[0][0],
            version:     meta.version,
            author:      meta.author || '—',
            url,
            code,
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
        ui.finish();
        terminal.printSystem(`✓ УСТАНОВЛЕНО: ${meta.name} v${meta.version}  [${record.command}]`, 'rgba(0,200,100,.9)');
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
            terminal.printSystem(`  ${r.id}  ${r.name}  v${r.version}  (${date})`);
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

    return { init, install, remove, list, update };

})();
