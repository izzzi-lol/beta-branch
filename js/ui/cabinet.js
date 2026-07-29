// =============================================================================
//  cabinet.js — Личный кабинет автора
//  Команда: cabinet
//
//  Авторизация через Discord OAuth2 → JWT в localStorage
//  Публикация досье → /api/publish
// =============================================================================

const Cabinet = (() => {

    const LS_TOKEN = 'cabinet:jwt';
    const LS_DRAFT = 'cabinet:draft';

    // ── JWT утилиты ───────────────────────────────────────────────────────────

    function _saveToken(jwt) { localStorage.setItem(LS_TOKEN, jwt); }
    function _getToken()    { return localStorage.getItem(LS_TOKEN); }
    function _clearToken()  { localStorage.removeItem(LS_TOKEN); }

    /** Декодирует payload JWT без верификации (верифицирует сервер). */
    function _decodeJWT(jwt) {
        try {
            const payload = jwt.split('.')[1];
            return JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/')));
        } catch { return null; }
    }

    function _isExpired(payload) {
        return payload?.exp ? payload.exp * 1000 < Date.now() : true;
    }

    // ── Авторизованный fetch ──────────────────────────────────────────────────

    async function _apiFetch(url, opts = {}) {
        const token = _getToken();
        return fetch(url, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(opts.headers ?? {}),
            },
        });
    }

    // ── Проверка токена из URL после OAuth2 редиректа ────────────────────────

    function _checkUrlToken() {
        const hash = window.location.hash;
        if (!hash.includes('token=')) return;

        const token = new URLSearchParams(hash.slice(1)).get('token');
        if (token) {
            _saveToken(token);
            // Убираем токен из URL — не должен светиться в истории браузера
            window.history.replaceState({}, '', window.location.pathname + window.location.search);
        }

        const params = new URLSearchParams(window.location.search);
        if (params.get('auth') === 'denied') {
            window.history.replaceState({}, '', window.location.pathname);
            return 'denied';
        }
    }

    // ── Получить данные пользователя ──────────────────────────────────────────

    async function _getUser() {
        const token = _getToken();
        if (!token) return null;

        const payload = _decodeJWT(token);
        if (_isExpired(payload)) { _clearToken(); return null; }

        // Быстро из JWT без запроса к серверу
        return { id: payload.id, username: payload.username, avatar: payload.avatar };
    }

    // ── Стили ─────────────────────────────────────────────────────────────────

    function _injectStyles() {
        if (document.getElementById('cabinet-style')) return;
        const st = document.createElement('style');
        st.id = 'cabinet-style';
        st.textContent = `
        .cab-root { display:flex; flex-direction:column; height:100%; gap:0; }

        /* ── Профиль ── */
        .cab-profile {
            display: flex; align-items: center; gap: 12px;
            padding: 12px 14px;
            border-bottom: 1px solid rgba(0,200,255,0.12);
            background: rgba(0,10,20,0.5);
            flex-shrink: 0;
        }
        .cab-avatar {
            width: 42px; height: 42px; border-radius: 50%;
            border: 2px solid rgba(0,200,255,0.35);
            box-shadow: 0 0 10px rgba(0,200,255,0.2);
            flex-shrink: 0;
        }
        .cab-avatar-placeholder {
            width: 42px; height: 42px; border-radius: 50%;
            background: rgba(0,200,255,0.08);
            border: 2px solid rgba(0,200,255,0.2);
            display: flex; align-items: center; justify-content: center;
            font-size: 1.2em; color: rgba(0,200,255,0.4);
            flex-shrink: 0;
        }
        .cab-user-info { flex: 1; }
        .cab-username { font-size: .82em; color: #7dd8ff; letter-spacing: 1px; }
        .cab-user-sub { font-size: .62em; color: rgba(0,200,255,0.35); letter-spacing: 1px; margin-top: 2px; }
        .cab-logout-btn {
            font-size: .62em; padding: 4px 10px; letter-spacing: 1.5px;
            background: rgba(255,80,100,0.06); border: 1px solid rgba(255,80,100,0.22);
            color: rgba(255,80,100,0.6); cursor: pointer; transition: all .15s;
            clip-path: polygon(3px 0,100% 0,100% calc(100% - 3px),calc(100% - 3px) 100%,0 100%,0 3px);
            font-family: var(--mono-font, monospace);
        }
        .cab-logout-btn:hover { background: rgba(255,80,100,.14); color: #ff6070; }

        /* ── Не авторизован ── */
        .cab-login {
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 16px; flex: 1; padding: 20px;
        }
        .cab-login-icon { font-size: 2.5em; color: rgba(0,200,255,.2); }
        .cab-login-text { font-size: .72em; color: rgba(0,200,255,.45); letter-spacing: 1px; text-align: center; line-height: 1.7; }
        .cab-discord-btn {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 20px; font-size: .75em; letter-spacing: 2px;
            background: rgba(88,101,242,0.15); border: 1px solid rgba(88,101,242,0.4);
            color: rgba(180,185,255,0.9); cursor: pointer; transition: all .15s;
            clip-path: polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px);
            font-family: var(--mono-font, monospace); text-decoration: none;
        }
        .cab-discord-btn:hover {
            background: rgba(88,101,242,0.28); border-color: rgba(88,101,242,0.65);
            color: #fff; box-shadow: 0 0 12px rgba(88,101,242,0.3);
        }
        .cab-discord-icon { font-size: 1.1em; }

        /* ── Редактор ── */
        .cab-editor { display:flex; flex-direction:column; flex:1; overflow:hidden; }
        .cab-editor-label {
            font-size: .62em; letter-spacing: 2px; color: rgba(0,200,255,.35);
            padding: 8px 14px 4px; flex-shrink: 0;
        }
        .cab-textarea {
            flex: 1; background: rgba(0,4,12,.75); border: none;
            color: #c8e6ff; font-family: var(--mono-font, monospace);
            font-size: 12px; padding: 8px 13px; resize: none; outline: none;
            box-sizing: border-box; line-height: 1.75; caret-color: #00c8ff;
        }
        .cab-textarea::placeholder { color: rgba(0,200,255,.12); }

        /* ── ID поле ── */
        .cab-id-row {
            display: flex; align-items: center; gap: 8px;
            padding: 6px 14px; border-top: 1px solid rgba(0,200,255,.1);
            border-bottom: 1px solid rgba(0,200,255,.1);
            background: rgba(0,10,20,.4); flex-shrink: 0;
        }
        .cab-id-label { font-size: .62em; color: rgba(0,200,255,.4); letter-spacing: 1.5px; white-space: nowrap; }
        .cab-id-input {
            flex: 1; background: rgba(0,0,0,.35); border: 1px solid rgba(0,200,255,.2);
            color: #7dd8ff; font-family: var(--mono-font, monospace); font-size: .72em;
            padding: 4px 8px; outline: none; letter-spacing: 1px;
            clip-path: polygon(3px 0,100% 0,100% 100%,0 100%,0 3px);
            transition: border-color .15s;
        }
        .cab-id-input:focus { border-color: rgba(0,200,255,.45); }

        /* ── Подвал ── */
        .cab-footer {
            display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
            padding: 6px 10px; border-top: 1px solid rgba(0,200,255,.1);
            background: rgba(0,10,20,.5); flex-shrink: 0;
        }
        .cab-btn {
            padding: 4px 12px; font-size: .65em; letter-spacing: 1.5px;
            background: rgba(0,200,255,.05); border: 1px solid rgba(0,200,255,.22);
            color: rgba(0,200,255,.6); cursor: pointer; transition: all .15s;
            clip-path: polygon(3px 0,100% 0,100% calc(100% - 3px),calc(100% - 3px) 100%,0 100%,0 3px);
            font-family: var(--mono-font, monospace); text-transform: uppercase;
        }
        .cab-btn:hover { background: rgba(0,200,255,.15); color: #00ddff; border-color: rgba(0,220,255,.5); }
        .cab-btn-publish {
            border-color: rgba(0,200,255,.45); color: rgba(0,200,255,.85);
        }
        .cab-btn-publish:hover { box-shadow: 0 0 10px rgba(0,200,255,.25); }
        .cab-btn-publish:disabled { opacity: .3; pointer-events: none; }
        .cab-status {
            margin-left: auto; font-size: .6em; letter-spacing: 1px;
            color: rgba(0,200,255,.3); text-align: right;
        }
        .cab-status.ok  { color: #00e8a0; }
        .cab-status.err { color: rgba(255,80,100,.8); }

        /* ── Прогресс-бар публикации ── */
        .cab-progress {
            display: none; padding: 8px 14px; flex-shrink: 0;
            border-top: 1px solid rgba(0,200,255,.1);
        }
        .cab-progress.visible { display: block; }
        .cab-progress-track { height: 3px; background: rgba(0,200,255,.1); overflow: hidden; }
        .cab-progress-bar { height: 100%; width: 0%; background: #00c8b4; transition: width .3s ease; box-shadow: 0 0 8px #00c8b4; }
        `;
        document.head.appendChild(st);
    }

    // ── HTML ──────────────────────────────────────────────────────────────────

    function _buildLoginHTML() {
        return `<div class="cab-root">
            <div class="cab-login">
                <div class="cab-login-icon">⬡</div>
                <div class="cab-login-text">
                    Для публикации досье необходима авторизация.<br>
                    Войдите через аккаунт Discord.
                </div>
                <a class="cab-discord-btn" href="/api/auth/login">
                    <span class="cab-discord-icon">⬡</span>
                    ВОЙТИ ЧЕРЕЗ DISCORD
                </a>
            </div>
        </div>`;
    }

    function _buildCabinetHTML(user) {
        const draft = localStorage.getItem(LS_DRAFT) ?? '';
        return `<div class="cab-root">

            <div class="cab-profile">
                ${user.avatar
                    ? `<img class="cab-avatar" src="${user.avatar}" alt="">`
                    : `<div class="cab-avatar-placeholder">⬡</div>`
                }
                <div class="cab-user-info">
                    <div class="cab-username">${user.username}</div>
                    <div class="cab-user-sub">ID: ${user.id} · АВТОР</div>
                </div>
                <button class="cab-logout-btn" id="cab-logout">ВЫЙТИ</button>
            </div>

            <div class="cab-id-row">
                <span class="cab-id-label">ID ДОСЬЕ:</span>
                <input class="cab-id-input" id="cab-id" type="text"
                    placeholder="my-dossier-01" maxlength="64"
                    value="${localStorage.getItem('cabinet:last-id') ?? ''}">
            </div>

            <div class="cab-editor">
                <div class="cab-editor-label">ТЕКСТ ДОСЬЕ (теги SCIPNET и Markdown)</div>
                <textarea class="cab-textarea" id="cab-textarea"
                    placeholder="[TITLE] Имя персонажа
[COLORCODES] Mainpage=#a200ff; Quotes=#a200ff; Tables=#a200ff

[H1] [CENTER] Личные данные
..."
                    spellcheck="false">${draft}</textarea>
            </div>

            <div class="cab-progress" id="cab-progress">
                <div class="cab-progress-track">
                    <div class="cab-progress-bar" id="cab-progress-bar"></div>
                </div>
            </div>

            <div class="cab-footer">
                <button class="cab-btn" id="cab-save">↓ ЧЕРНОВИК</button>
                <button class="cab-btn" id="cab-preview">▶ ПРЕВЬЮ</button>
                <button class="cab-btn cab-btn-publish" id="cab-publish">⬆ ОПУБЛИКОВАТЬ</button>
                <span class="cab-status" id="cab-status">Черновик автосохраняется</span>
            </div>

        </div>`;
    }

    // ── Логика кабинета ───────────────────────────────────────────────────────

    function _q(sel) {
        const w = document.querySelector('.lyoko-window[data-id="cabinet"]');
        return w ? w.querySelector(sel) : null;
    }

    function _setStatus(msg, type = '') {
        const el = _q('#cab-status');
        if (!el) return;
        el.textContent = msg;
        el.className = 'cab-status' + (type ? ' ' + type : '');
    }

    function _setProgress(pct) {
        const bar = _q('#cab-progress-bar');
        const wrap = _q('#cab-progress');
        if (bar)  bar.style.width = pct + '%';
        if (wrap) wrap.classList.toggle('visible', pct > 0 && pct < 100);
    }

    function _bindCabinet() {
        const ta = _q('#cab-textarea');
        const id = _q('#cab-id');
        if (!ta) return;

        // Автосохранение черновика
        ta.addEventListener('input', () => {
            localStorage.setItem(LS_DRAFT, ta.value);
        });

        id?.addEventListener('input', () => {
            localStorage.setItem('cabinet:last-id', id.value);
        });

        // Tab в textarea
        ta.addEventListener('keydown', e => {
            if (e.key !== 'Tab') return;
            e.preventDefault();
            const s = ta.selectionStart;
            ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(ta.selectionEnd);
            ta.setSelectionRange(s + 4, s + 4);
        });

        // Выйти
        _q('#cab-logout')?.addEventListener('click', () => {
            _clearToken();
            // Перерисовываем окно как незалогиненное
            const content = document.querySelector('.lyoko-window[data-id="cabinet"] .lyoko-content');
            if (content) {
                content.innerHTML = _buildLoginHTML();
            }
        });

        // Черновик
        _q('#cab-save')?.addEventListener('click', () => {
            localStorage.setItem(LS_DRAFT, ta.value);
            _setStatus('Черновик сохранён', 'ok');
            setTimeout(() => _setStatus('Черновик автосохраняется'), 2000);
        });

        // Превью
        _q('#cab-preview')?.addEventListener('click', () => {
            const R = typeof renderer !== 'undefined' ? renderer : null;
            if (!R || !ta.value.trim()) return;
            try {
                const inst = (typeof R === 'function') ? new R() : R;
                const fn   = inst.toStaticHTML ?? inst.toHTML;
                const html = fn.call(inst, ta.value, '', {}, false);
                PluginAPI?.WindowManager?.open(
                    'cab-preview', 'ПРЕВЬЮ ДОСЬЕ',
                    `<div style="padding:14px 20px;font-family:var(--mono-font,monospace);font-size:13px;color:#c8e6ff;line-height:1.75">${html}</div>`,
                    { width: 640, maxSize: 520, status: 'PREVIEW' }
                );
            } catch (e) {
                _setStatus('Ошибка рендера', 'err');
            }
        });

        // Публикация
        _q('#cab-publish')?.addEventListener('click', () => _publish(ta, id));
    }

    async function _publish(ta, idInput) {
        const content = ta?.value?.trim();
        const id      = idInput?.value?.trim();

        if (!content) { _setStatus('Текст пуст', 'err'); return; }
        if (!id)      { _setStatus('Укажите ID досье', 'err'); return; }
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
            _setStatus('ID: только буквы, цифры, дефис', 'err'); return;
        }

        const btn = _q('#cab-publish');
        if (btn) btn.disabled = true;
        _setProgress(10);
        _setStatus('Публикация...');

        try {
            _setProgress(40);
            const res = await _apiFetch('/api/publish', {
                method: 'POST',
                body: JSON.stringify({ id, content }),
            });
            _setProgress(85);

            const data = await res.json();

            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

            _setProgress(100);
            _setStatus(`✓ Отправлено на модерацию (ветка: drafts)`, 'ok');
            setTimeout(() => {
                _setProgress(0);
                _setStatus('Черновик автосохраняется');
            }, 4000);

        } catch (err) {
            _setProgress(0);
            _setStatus(`✕ ${err.message}`, 'err');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ── Публичный API ─────────────────────────────────────────────────────────

    async function open(terminal) {
        _injectStyles();

        // Проверяем новый токен из URL (после OAuth2 редиректа)
        const authResult = _checkUrlToken();
        if (authResult === 'denied') {
            terminal.printError('Discord: доступ запрещён. Убедитесь что у вас есть нужная роль.');
        }

        const user = await _getUser();
        const html = user ? _buildCabinetHTML(user) : _buildLoginHTML();

        const WM = typeof WindowManager !== 'undefined' ? WindowManager : PluginAPI?.WindowManager;
        WM?.open('cabinet', 'ЛИЧНЫЙ КАБИНЕТ', html, {
            width:   520,
            maxSize: 580,
            status:  user ? `@${user.username}` : 'НЕ АВТОРИЗОВАН',
        });

        if (user) {
            requestAnimationFrame(() => requestAnimationFrame(() => _bindCabinet()));
        }

        terminal.printSystem(
            user
                ? `Кабинет открыт. Добро пожаловать, ${user.username}!`
                : 'Кабинет открыт. Войдите через Discord для публикации.'
        );
    }

    return { open };

})();
