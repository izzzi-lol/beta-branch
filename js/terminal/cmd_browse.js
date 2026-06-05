// =============================================================================
//  cmd_browse.js — Встроенный браузер
//
//  browse                     — пустой браузер
//  browse https://google.com  — открыть сразу
//
//  Два режима:
//    DIRECT — прямой iframe (работает для сайтов без X-Frame-Options)
//    PROXY  — через corsproxy.io (снимает X-Frame-Options, работает с большинством сайтов)
// =============================================================================

const BROWSE_PROXY = 'https://api.allorigins.win/get?url=';

// ── Состояние режима прокси ───────────────────────────────────────────────────
let _brProxyMode = false;

// ── Объект команды (по образцу CmdGet / CmdUpload) ───────────────────────────
const CmdBrowse = {
    execute(args, terminal) {
        const url = args[0] ? _brNormalizeUrl(args[0]) : '';
        _brOpenWindow(url);
    },
};

// ── Нормализация URL ──────────────────────────────────────────────────────────
function _brNormalizeUrl(raw) {
    raw = raw.trim();
    if (!raw) return '';
    return /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
}

// ── HTML браузера ─────────────────────────────────────────────────────────────
function _brBuildHTML(url) {
    const esc = url ? url.replace(/"/g, '&quot;') : '';
    return `
<style>
/* ── Корень ── */
.wb { display:flex; flex-direction:column; height:100%; }

/* ── Тулбар ── */
.wb-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 6px;
    border-bottom: 1px solid rgba(var(--tc),0.18);
    background: rgba(0,0,0,0.35);
    flex-shrink: 0;
    flex-wrap: nowrap;
}

/* ── Кнопки навигации ── */
.wb-btn {
    flex-shrink: 0;
    width: 30px; height: 30px;
    background: rgba(var(--tc),0.06);
    border: 1px solid rgba(var(--tc),0.22);
    color: rgba(var(--tc),0.65);
    font-size: 12px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    transition: all 0.12s;
    clip-path: polygon(3px 0,100% 0,100% calc(100% - 3px),calc(100% - 3px) 100%,0 100%,0 3px);
    user-select: none; -webkit-tap-highlight-color: transparent;
}
.wb-btn:hover, .wb-btn:active {
    background: rgba(var(--tc),0.18);
    border-color: rgba(var(--tc),0.55);
    color: rgb(var(--tc));
    box-shadow: 0 0 8px rgba(var(--tc),0.3);
}
.wb-btn[disabled] { opacity:0.25; pointer-events:none; }
.wb-btn.proxy-on {
    background: rgba(var(--tc),0.18);
    border-color: rgba(var(--tc),0.7);
    color: rgb(var(--tc));
    box-shadow: 0 0 8px rgba(var(--tc),0.35);
}

/* ── Адресная строка ── */
.wb-url {
    flex: 1;
    min-width: 0;
    background: rgba(0,0,0,0.45);
    border: 1px solid rgba(var(--tc),0.2);
    color: rgba(var(--tc-txt),1);
    font-family: var(--mono-font, monospace);
    font-size: 0.72em;
    padding: 6px 10px;
    outline: none;
    clip-path: polygon(4px 0,100% 0,100% 100%,0 100%,0 4px);
    transition: border-color 0.15s;
    -webkit-appearance: none;
}
.wb-url:focus {
    border-color: rgba(var(--tc),0.55);
    box-shadow: 0 0 8px rgba(var(--tc),0.18);
}

/* ── Статус ── */
.wb-status {
    padding: 3px 10px;
    font-size: 0.58em;
    color: rgba(var(--tc),0.32);
    letter-spacing: 1px;
    border-bottom: 1px solid rgba(var(--tc),0.08);
    background: rgba(0,0,0,0.18);
    flex-shrink: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ── Фрейм ── */
.wb-frame-wrap { flex:1; position:relative; min-height:0; }

.wb-iframe {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    border: none; display: block;
    background: #0a0a0a;
}

/* ── Заглушка ── */
.wb-placeholder {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 10px;
    color: rgba(var(--tc),0.18);
    pointer-events: none;
}
.wb-placeholder-icon { font-size: 2.2em; }
.wb-placeholder-text { font-size: 0.62em; letter-spacing: 2px; font-family: var(--mono-font, monospace); }

/* ── Ошибка ── */
.wb-error {
    position: absolute; inset: 0;
    display: none;
    flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    background: rgba(4,12,24,0.97);
    color: rgba(255,80,100,0.7);
    font-family: var(--mono-font, monospace);
    text-align: center; padding: 20px;
}
.wb-error-icon  { font-size: 2em; }
.wb-error-title { font-size: 0.8em; letter-spacing: 2px; }
.wb-error-hint  { font-size: 0.62em; color: rgba(255,80,100,0.45); line-height: 1.7; }

/* ── Мобайл ── */
@media (hover: none), (pointer: coarse) {
    .wb-toolbar { padding: 6px; gap: 5px; }
    .wb-btn     { width: 38px; height: 38px; font-size: 14px; }
    .wb-url     { font-size: 0.82em; padding: 8px 10px; }
    .wb-status  { display: none; }
}
</style>

<div class="wb" id="wb-root"
     style="--tc:0,200,180; --tc-txt:125,230,220">

    <div class="wb-toolbar">
        <button class="wb-btn" id="wb-back"    title="Назад"    disabled>◀</button>
        <button class="wb-btn" id="wb-fwd"     title="Вперёд"   disabled>▶</button>
        <button class="wb-btn" id="wb-reload"  title="Обновить">↻</button>
        <input  class="wb-url" id="wb-url-in"
                type="url" spellcheck="false" autocomplete="off"
                placeholder="https://..."
                value="${esc}">
        <button class="wb-btn" id="wb-go"      title="Перейти">→</button>
        <button class="wb-btn" id="wb-proxy"   title="Режим прокси (для крупных сайтов)">⚡</button>
        <button class="wb-btn" id="wb-newtab"  title="Открыть в новой вкладке">↗</button>
    </div>

    <div class="wb-status" id="wb-status">ГОТОВ</div>

    <div class="wb-frame-wrap">
        <div class="wb-placeholder" id="wb-ph">
            <div class="wb-placeholder-icon">⬡</div>
            <div class="wb-placeholder-text">ВВЕДИТЕ АДРЕС И НАЖМИТЕ →</div>
        </div>
        <div class="wb-error" id="wb-err">
            <div class="wb-error-icon">⚠</div>
            <div class="wb-error-title">САЙТ ЗАБЛОКИРОВАЛ ВСТРАИВАНИЕ</div>
            <div class="wb-error-hint" id="wb-err-hint">
                Попробуйте включить режим прокси ⚡<br>или откройте в новой вкладке ↗
            </div>
        </div>
        <iframe class="wb-iframe" id="wb-frame"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation">
        </iframe>
    </div>
</div>`;
}

// ── Открыть окно ──────────────────────────────────────────────────────────────
function _brOpenWindow(url) {
    const IS_MOBILE = window.matchMedia('(hover:none),(pointer:coarse)').matches;
    const _vw = window.innerWidth;
    const _vh = window.innerHeight;

    WindowManager.open('browser', 'БРАУЗЕР', _brBuildHTML(url), {
        width:     IS_MOBILE ? _vw : Math.round(_vw * 0.9),
        height:    IS_MOBILE ? _vh - 80 : Math.round(_vh * 0.9),
        maxWidth:  Math.round(_vw * 0.9),
        maxHeight: Math.round(_vh * 0.95),
        isResizable: true,
        status:    'SCIPNET BROWSER v2.0',
    });

    requestAnimationFrame(() => {
        const win = document.querySelector('.lyoko-window[data-id="browser"]');
        if (!win) return;

        const content  = win.querySelector('.lyoko-content');
        const browseH  = IS_MOBILE ? (_vh - 120) : Math.round(_vh * 0.9);

        // Высоту задаём на внутреннем контейнере браузера, а НЕ на .lyoko-content.
        // Это позволяет _makeSizeToggle свободно анимировать max-height контента
        // и корректно схлопывать окно до нуля.
        if (content) content.style.cssText = 'padding:0; overflow:hidden;';
        const wb = win.querySelector('#wb-root');
        if (wb) wb.style.height = browseH + 'px';

        _brBind(win);
        if (url) _brNavigate(win, url, _brProxyMode);
    });
}

// ── Навигация ─────────────────────────────────────────────────────────────────
function _brNavigate(win, url, useProxy) {
    if (!url) return;

    const frame    = win.querySelector('#wb-frame');
    const ph       = win.querySelector('#wb-ph');
    const errEl    = win.querySelector('#wb-err');
    const status   = win.querySelector('#wb-status');
    const urlIn    = win.querySelector('#wb-url-in');
    const errHint  = win.querySelector('#wb-err-hint');
    const proxyBtn = win.querySelector('#wb-proxy');

    ph.style.display    = 'none';
    errEl.style.display = 'none';
    frame.style.display = 'block';

    status.textContent = (useProxy ? '[PROXY] ' : '') + url;
    urlIn.value = url;
    proxyBtn.classList.toggle('proxy-on', useProxy);

    const _showError = (hint) => {
        frame.style.display = 'none';
        errHint.innerHTML   = hint;
        errEl.style.display = 'flex';
        status.textContent  = 'ОШИБКА';

        const tryProxy = win.querySelector('#wb-try-proxy');
        if (tryProxy) tryProxy.addEventListener('click', () => {
            _brProxyMode = true;
            _brNavigate(win, url, true);
        });
    };

    // ── PROXY MODE: allorigins возвращает JSON → грузим через srcdoc ──────────
    if (useProxy) {
        status.textContent = '[PROXY] ЗАГРУЗКА...';
        fetch(BROWSE_PROXY + encodeURIComponent(url))
            .then(r => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(data => {
                if (!data.contents) throw new Error('empty contents');
                // srcdoc не конфликтует с src — сначала сбросим src
                frame.removeAttribute('src');
                frame.srcdoc = data.contents;
                status.textContent = '[PROXY] ' + url;
            })
            .catch(() => {
                _showError(`
                    Прокси не помог.<br>
                    <a href="${url}" target="_blank"
                       style="color:rgba(0,200,180,0.5);text-decoration:underline">
                       ↗ Открыть в новой вкладке
                    </a>`);
            });
        return;
    }

    // ── DIRECT MODE: прямой iframe с таймаутом на X-Frame-Options ────────────
    let tid = setTimeout(() => {
        _showError(`
            Сайт запрещает встраивание.<br>
            <span id="wb-try-proxy" style="color:rgba(0,200,180,0.7);cursor:pointer;text-decoration:underline">
                ⚡ Попробовать через прокси
            </span>
            &nbsp;|&nbsp;
            <a href="${url}" target="_blank"
               style="color:rgba(0,200,180,0.5);text-decoration:underline">
               ↗ Открыть в новой вкладке
            </a>`);
    }, 9000);

    frame.onload = () => {
        clearTimeout(tid);
        try {
            const loc = frame.contentWindow?.location?.href;
            if (loc && loc !== 'about:blank') {
                status.textContent = loc;
                urlIn.value = loc;
            } else {
                status.textContent = url;
            }
        } catch {
            status.textContent = url; // cross-origin — норма
        }
    };

    frame.removeAttribute('srcdoc');
    frame.src = url;
}

// ── События ───────────────────────────────────────────────────────────────────
function _brBind(win) {
    const urlIn  = win.querySelector('#wb-url-in');
    const goBtn  = win.querySelector('#wb-go');
    const reload = win.querySelector('#wb-reload');
    const back   = win.querySelector('#wb-back');
    const fwd    = win.querySelector('#wb-fwd');
    const proxy  = win.querySelector('#wb-proxy');
    const newtab = win.querySelector('#wb-newtab');
    const frame  = win.querySelector('#wb-frame');

    const go = () => {
        const url = _brNormalizeUrl(urlIn.value);
        if (url) _brNavigate(win, url, _brProxyMode);
    };

    goBtn.addEventListener('click', go);
    reload.addEventListener('click', () => {
        const url = _brNormalizeUrl(urlIn.value);
        if (url) _brNavigate(win, url, _brProxyMode);
    });

    urlIn.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.stopPropagation(); go(); }
    });
    urlIn.addEventListener('focus', () => urlIn.select());

    proxy.addEventListener('click', () => {
        _brProxyMode = !_brProxyMode;
        proxy.classList.toggle('proxy-on', _brProxyMode);
        proxy.title = _brProxyMode
            ? 'Прокси: ВКЛ (нажмите для отключения)'
            : 'Режим прокси (для крупных сайтов)';
        const url = _brNormalizeUrl(urlIn.value);
        if (url) _brNavigate(win, url, _brProxyMode);
    });

    newtab.addEventListener('click', () => {
        const url = _brNormalizeUrl(urlIn.value);
        if (url) window.open(url, '_blank');
    });

    back.addEventListener('click', () => {
        try { frame.contentWindow?.history.back(); } catch (_) {}
    });
    fwd.addEventListener('click', () => {
        try { frame.contentWindow?.history.forward(); } catch (_) {}
    });
}
