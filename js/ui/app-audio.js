// =============================================================================
//  app-audio.js — АУДИО ПЛЕЕР (приложение SCIPNET OS)
//
//  Плеер по макету пользователя:
//    • панель с большой круглой кнопкой play/pause и ЖИВЫМ спектром
//      «палочками» (AnalyserNode на собственном аудио-графе);
//    • блок «Транскрипция» с синхронной подсветкой фраз из text.txt
//      архивных записей (теги [AT]/[SYNC], как в команде echo);
//    • полный набор управления: стоп, перемотка, тайм-код, громкость;
//    • плейлист из двух источников — архив ECHO (echoes/ на GitHub,
//      общий кеш с окном «Архив ECHO») и локальные аудиофайлы
//      (file picker / drag&drop; файлы также прилетают из DOS-проводника,
//      если в его дропзону бросили аудио).
//
//  Аудио-граф плеера (отдельный элемент, AudioHandler не трогаем):
//      <audio> → MediaElementSource → Gain(громкость) → Analyser → out
//  Регуляторов speed/pitch/tape в плеере нет (решение по макету), поэтому
//  pitch-воркет не подключается — граф лёгкий и всегда доступен спектру.
//
//  Поведение: закрытие окна ОСТАНАВЛИВАЕТ воспроизведение (решение
//  пользователя); плейлист и позиция треков живут в сессии страницы.
//
//  Точка входа: AppRegistry 'audio-player' → AudioPlayerApp.open(args),
//  args = { files: [File,…] } — открыть с локальными файлами (DEX),
//         { echoId: 'RECORD-…' } — открыть и сразу играть запись архива.
// =============================================================================

const AudioPlayerApp = (() => {

    const WINDOW_ID = 'audio-player';
    const CACHE_KEY = 'echo_folders_cache';   // общий кеш с EchoArchive (app-echo.js)
    const CACHE_TTL = 5 * 60 * 1000;
    const VOL_KEY   = 'scipnet_ap_volume';    // громкость плеера (localStorage)

    // ── Состояние: живёт независимо от окна, переживает его закрытие ─────────
    const _state = {
        tracks: [],            // {kind:'echo'|'local', id?, url, name}
        current: -1,
        playing: false,
        audioEl: null,         // текущий HTMLAudioElement
        srcNode: null,         // его MediaElementSource
        ctx: null, gain: null, analyser: null,
        transcript: [],        // [{start, end, text}] активной записи
        transcriptFor: null,   // ключ транскрипции в кеше
        trActive: -1,
        vol: null,             // ленивая инициализация из localStorage/настроек
    };

    let _ui   = null;          // DOM-ссылки окна
    let _raf  = 0;
    let _freq = null;          // Uint8Array под getByteFrequencyData
    let _dpr  = 1;
    let _tab  = 'echo';        // активная вкладка плейлиста
    let _seekDrag = false;     // палец на ползунке перемотки — rAF не дёргает
    let _closeHooked = false;  // WindowManager.on('close') подписка — один раз
    let _globalBound = false;  // window pointerup для _seekDrag — один раз
    let _resizeObs  = null;

    // ── Утилиты ───────────────────────────────────────────────────────────────

    const _esc = s => String(s ?? '').replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** RECORD-01-CI-MIRAGE → «01 · CI · MIRAGE» — как в архиве ECHO. */
    function _prettyName(id) {
        return String(id).replace(/^RECORD-/i, '').split('-').join(' · ').toUpperCase();
    }

    /** 73.4 → «01:13» (или 1:02:07 для длинных). */
    function _fmt(sec) {
        if (!isFinite(sec) || sec < 0) return '--:--';
        sec = Math.floor(sec);
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const mm = String(m).padStart(2, '0');
        const ss = String(s).padStart(2, '0');
        return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    const _iconPlay  = () => '<svg viewBox="0 0 24 24" class="os-ap-ic" aria-hidden="true"><path d="M8 5.2v13.6L19.2 12z" fill="currentColor"/></svg>';
    const _iconPause = () => '<svg viewBox="0 0 24 24" class="os-ap-ic" aria-hidden="true"><path d="M7.2 5h3.5v14H7.2zM13.3 5h3.5v14h-3.5z" fill="currentColor"/></svg>';
    const _iconNote  = () => '<svg class="os-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>';
    const _iconVol   = () => '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3l4.5 4v-13L7 9.5z" fill="currentColor" stroke="none"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.8a7.6 7.6 0 0 1 0 10.4"/></svg>';

    // ── Регистрация приложения ────────────────────────────────────────────────

    function _register() {
        if (typeof AppRegistry === 'undefined' || AppRegistry.has(WINDOW_ID)) return;
        AppRegistry.register({
            id: WINDOW_ID,
            name: 'АУДИО ПЛЕЕР',
            icon: AppRegistry.ICONS.audio,
            description: 'Спектр · транскрипция · архив ECHO',
            launch: (args) => open(args || {}),
        });
    }

    // =========================================================================
    //  ОКНО
    // =========================================================================

    function _html() {
        return `
        <div class="os-ap" id="os-ap">
            <div class="os-ap-deck">
                <button id="ap-play" class="os-ap-play" title="Играть / пауза" aria-label="Играть или пауза">
                    ${_iconPlay()}
                </button>
                <div class="os-ap-spectrum" id="ap-spectrum">
                    <canvas id="ap-canvas"></canvas>
                    <div class="os-ap-spectrum-label">аудио спектр</div>
                </div>
            </div>

            <div class="os-ap-controls">
                <button id="ap-stop" class="os-ap-stop" title="Стоп" aria-label="Стоп">■</button>
                <span class="os-ap-time" id="ap-time-cur">00:00</span>
                <input type="range" id="ap-seek" class="os-ap-range" min="0" max="1000" value="0" step="1" aria-label="Перемотка">
                <span class="os-ap-time" id="ap-time-total">--:--</span>
                <div class="os-ap-vol" title="Громкость">
                    ${_iconVol()}
                    <input type="range" id="ap-vol" class="os-ap-range os-ap-vol-range" min="0" max="100" value="75" aria-label="Громкость">
                </div>
            </div>

            <div class="os-ap-trackline" id="ap-trackline">НЕТ ТРЕКА</div>

            <div class="os-ap-transcript" id="ap-transcript">
                <button class="os-ap-tr-head" id="ap-tr-toggle" aria-label="Свернуть транскрипцию">
                    <span>ТРАНСКРИПЦИЯ</span>
                    <span class="os-ap-tr-arrow">⌃</span>
                </button>
                <div class="os-ap-tr-body" id="ap-tr-body">
                    <div class="os-ap-tr-text" id="ap-tr-text">
                        <div class="os-ap-tr-hint">Тут будет текст аудиозаписи</div>
                    </div>
                </div>
            </div>

            <div class="os-ap-tabs">
                <button class="os-ap-tab active" data-tab="echo">АРХИВ ECHO</button>
                <button class="os-ap-tab" data-tab="local">ЛОКАЛЬНЫЕ ФАЙЛЫ</button>
                <button class="os-btn small" id="ap-add" title="Добавить аудиофайлы с компьютера">+ ФАЙЛЫ</button>
            </div>
            <div class="os-ap-playlist" id="ap-playlist">
                <div class="os-explorer-hint">ЗАПРОС АРХИВА…</div>
            </div>
            <div class="os-ap-drop">или перетащите аудиофайлы прямо в окно</div>
            <input type="file" id="ap-file" accept="audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.opus" multiple hidden>
        </div>`;
    }

    /**
     * Открыть (или обновить) окно плеера.
     * @param {{files?: File[], echoId?: string}} args
     */
    function open(args = {}) {
        WindowManager.open(WINDOW_ID, _titleText(), _html(), {
            width: 520,
            height: 600,
            status: 'AUDIO ENGINE // ANALYSER READY',
            backdrop: false,
        });

        _bindUI();
        _renderTabs();
        _updatePlayBtn();
        _updateTitle();
        _syncSeekUI(0, null);
        if (_tab === 'echo') _loadArchiveTab(); else _renderPlaylist();

        if (!_closeHooked && typeof WindowManager.on === 'function') {
            _closeHooked = true;
            WindowManager.on('close', (detail) => {
                if (detail?.id === WINDOW_ID) _onWindowClosed();
            });
        }

        // Аргументы запуска
        if (Array.isArray(args.files) && args.files.length) {
            _addLocalFiles(args.files, { autoplay: true });
        } else if (args.echoId) {
            _playEchoById(String(args.echoId));
        }
    }

    /** Закрытие окна: воспроизведение останавливается (решение пользователя). */
    function _onWindowClosed() {
        _stop();
        _ui = null;
        if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
        if (_resizeObs) { try { _resizeObs.disconnect(); } catch (_) {} _resizeObs = null; }
    }

    // =========================================================================
    //  АУДИО-ГРАФ ПЛЕЕРА (element → source → gain → analyser → out)
    // =========================================================================

    function _ensureCtx() {
        if (_state.ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;                      // Web Audio нет — звук идёт, спектра не будет
        try {
            const ctx      = new AC();
            const gain     = ctx.createGain();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.82;
            gain.gain.value = _vol();
            gain.connect(analyser);
            analyser.connect(ctx.destination);
            _state.ctx = ctx;
            _state.gain = gain;
            _state.analyser = analyser;
            _freq = new Uint8Array(analyser.frequencyBinCount);
        } catch (e) {
            console.warn('[AudioPlayer] AudioContext недоступен — спектр отключён:', e?.message);
        }
    }

    /** Подключить граф к НОВОМУ элементу (на старом элементе нода уже была). */
    function _connectGraph(audioEl) {
        _ensureCtx();
        _disconnectGraph();
        if (!_state.ctx) return;
        try {
            const src = _state.ctx.createMediaElementSource(audioEl);
            src.connect(_state.gain);
            _state.srcNode = src;
        } catch (e) {
            // Элемент уже подключён к другому графу и т.п. — звук остаётся,
            // спектр просто не получит данных.
            console.warn('[AudioPlayer] граф не подключился:', e?.message);
        }
    }

    function _disconnectGraph() {
        if (_state.srcNode) {
            try { _state.srcNode.disconnect(); } catch (_) {}
            _state.srcNode = null;
        }
    }

    // ── Громкость ─────────────────────────────────────────────────────────────

    function _vol() {
        if (_state.vol == null) {
            let v = 0.75;
            try {
                const saved = parseFloat(localStorage.getItem(VOL_KEY));
                if (isFinite(saved)) v = saved;
                else if (typeof AudioHandler !== 'undefined') v = AudioHandler.getEchoVolume();
            } catch (_) { /* localStorage недоступен */ }
            _state.vol = Math.min(1, Math.max(0, v));
        }
        return _state.vol;
    }

    function _setVol(v) {
        _state.vol = Math.min(1, Math.max(0, v));
        if (_state.gain) _state.gain.gain.value = _state.vol;
        try { localStorage.setItem(VOL_KEY, String(_state.vol)); } catch (_) {}
    }

    // =========================================================================
    //  ВОСПРОИЗВЕДЕНИЕ
    // =========================================================================

    function _teardownAudio() {
        const a = _state.audioEl;
        if (!a) return;
        a.pause();
        a.src = '';                            // обрываем загрузку из сети
        _disconnectGraph();
        _state.audioEl = null;
    }

    function _loadTrack(index, { autoplay = true } = {}) {
        const tr = _state.tracks[index];
        if (!tr) return;

        _teardownAudio();
        _state.current      = index;
        _state.playing      = false;
        _state.trActive     = -1;
        _state.transcript   = [];

        const audio = new Audio();
        if (tr.kind === 'echo') audio.crossOrigin = 'anonymous';  // для MediaElementSource
        audio.src     = tr.url;
        audio.preload = 'auto';

        audio.addEventListener('loadedmetadata', () => {
            if (_state.audioEl !== audio) return;
            if (_ui?.tTot) _ui.tTot.textContent = _fmt(audio.duration);
        });
        audio.addEventListener('play', () => {
            if (_state.audioEl !== audio) return;
            _state.playing = true;
            _updatePlayBtn(); _updateTitle(); _renderPlaylist(); _startRaf();
        });
        audio.addEventListener('pause', () => {
            if (_state.audioEl !== audio) return;
            _state.playing = false;
            _updatePlayBtn(); _updateTitle(); _renderPlaylist();
        });
        audio.addEventListener('ended', () => {
            if (_state.audioEl !== audio) return;
            _onTrackEnd();
        });
        audio.addEventListener('error', () => {
            if (_state.audioEl !== audio) return;
            _state.playing = false;
            _setTrackline(`ОШИБКА ЗАГРУЗКИ: ${tr.name}`);
            _updateTitle('ОШИБКА ФАЙЛА');
            _updatePlayBtn();
        });

        _state.audioEl = audio;
        _connectGraph(audio);

        _setTrackline(tr.name);
        _updateTitle();
        _updatePlayBtn();
        _syncSeekUI(0, null);
        if (_ui?.tTot) _ui.tTot.textContent = '--:--';
        _renderPlaylist();

        // Транскрипция есть только у записей архива (text.txt рядом с audio.mp3)
        if (tr.kind === 'echo') {
            _loadTranscript(tr.id);
        } else {
            _showTranscriptHint('У ЛОКАЛЬНЫХ ФАЙЛОВ ТРАНСКРИПЦИИ НЕТ');
        }

        // play() синхронно из жеста пользователя — автоплей-политика не мешает
        if (autoplay) _play();
    }

    function _play() {
        if (!_state.audioEl) {
            // Ничего не загружено — берём первый трек текущей вкладки
            const items = _state.tracks
                .map((t, i) => ({ t, i }))
                .filter(x => x.t.kind === _tab);
            if (items.length) _loadTrack(items[0].i);
            return;
        }
        _ensureCtx();
        if (_state.ctx && _state.ctx.state === 'suspended') {
            _state.ctx.resume().catch(() => {});
        }
        // play() возвращает промис: reject (автоплей-политика, прерванная
        // загрузка) глотаем — состояние скорректируют события play/pause/error.
        try {
            const pr = _state.audioEl.play();
            if (pr && pr.catch) pr.catch(() => {});
        } catch (_) {}
    }

    function _pause() {
        try { _state.audioEl?.pause(); } catch (_) {}
    }

    function _stop() {
        const a = _state.audioEl;
        if (!a) return;
        try { a.pause(); } catch (_) {}
        try { a.currentTime = 0; } catch (_) {}
        _state.playing = false;
        _updatePlayBtn();
        _updateTitle();
        _syncSeekUI(0, null);
        if (_ui?.tCur) _ui.tCur.textContent = '00:00';
        _setActiveTranscript(-1);
    }

    /** Конец трека: авто-переход к следующему в той же вкладке плейлиста. */
    function _onTrackEnd() {
        const next = _nextIndex(1);
        if (next >= 0) {
            _loadTrack(next);
        } else {
            _stop();
        }
    }

    /** Следующий/предыдущий индекс внутри вкладки текущего трека. */
    function _nextIndex(dir) {
        const cur = _state.tracks[_state.current];
        if (!cur) return -1;
        const sameKind = _state.tracks
            .map((t, i) => ({ t, i }))
            .filter(x => x.t.kind === cur.kind);
        const pos = sameKind.findIndex(x => x.i === _state.current);
        const nextPos = pos + dir;
        return (nextPos >= 0 && nextPos < sameKind.length) ? sameKind[nextPos].i : -1;
    }

    // =========================================================================
    //  ПЛЕЙЛИСТ
    // =========================================================================

    const _AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)$/i;

    function _isAudioFile(f) {
        return (f.type || '').startsWith('audio/') || _AUDIO_RE.test(f.name || '');
    }

    function _addLocalFiles(files, { autoplay = false } = {}) {
        const list = Array.from(files).filter(_isAudioFile);
        if (!list.length) return 0;
        const added = [];
        for (const f of list) {
            const url = URL.createObjectURL(f);
            _state.tracks.push({
                kind: 'local',
                url,
                name: f.name.replace(/\.[^.]+$/, '') || f.name,
            });
            added.push(_state.tracks.length - 1);
        }
        _switchTab('local');
        _renderPlaylist();
        if (autoplay && added.length) _loadTrack(added[0]);
        return added.length;
    }

    const _echoAudioUrl = (id) => `${ECHO_RAW_BASE}/${ECHOES_ROOT}/${id}/audio.mp3`;

    /** Открыть запись архива по id (используется и для args.echoId). */
    function _playEchoById(id) {
        let idx = _state.tracks.findIndex(t => t.kind === 'echo' && t.id === id);
        if (idx < 0) {
            _state.tracks.push({ kind: 'echo', id, url: _echoAudioUrl(id), name: _prettyName(id) });
            idx = _state.tracks.length - 1;
        }
        _switchTab('echo');
        _renderPlaylist();
        _loadTrack(idx);
    }

    /** Список записей архива — GitHub Contents API + общий кеш с EchoArchive. */
    async function _fetchEchoFolders() {
        try {
            const cached = sessionStorage.getItem(CACHE_KEY);
            if (cached) {
                const { folders, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_TTL) return folders;
            }
        } catch (_) { /* sessionStorage недоступен */ }

        const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${ECHOES_ROOT}?ref=${ECHOES_BRANCH}`;
        const response = await fetch(url, {
            headers: (typeof CmdGet !== 'undefined' && CmdGet._apiHeaders) ? CmdGet._apiHeaders() : {},
        });
        if (!response.ok) throw new Error(`GITHUB API: HTTP ${response.status}`);

        const folders = (await response.json())
            .filter(item => item.type === 'dir')
            .map(item => item.name);

        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ folders, timestamp: Date.now() }));
        } catch (_) {}

        return folders;
    }

    /** Подгрузить записи архива в плейлист (вкладка ECHO). */
    async function _loadArchiveTab() {
        const host = _ui?.playlist;
        if (!host) return;
        host.innerHTML = '<div class="os-explorer-hint">ЗАПРОС АРХИВА…</div>';
        try {
            const folders = await _fetchEchoFolders();
            for (const id of folders) {
                if (!_state.tracks.some(t => t.kind === 'echo' && t.id === id)) {
                    _state.tracks.push({ kind: 'echo', id, url: _echoAudioUrl(id), name: _prettyName(id) });
                }
            }
            // список мог обновиться, пока грузился архив
            if (_ui) _renderPlaylist();
        } catch (e) {
            if (_ui) host.innerHTML = `<div class="os-explorer-hint">ОШИБКА АРХИВА: ${_esc(e.message)}</div>`;
        }
    }

    function _switchTab(tab) {
        _tab = (tab === 'local') ? 'local' : 'echo';
        if (_ui) _renderTabs();
        if (_tab === 'echo') _loadArchiveTab();
        else if (_ui) _renderPlaylist();
    }

    function _renderTabs() {
        if (!_ui) return;
        _ui.tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === _tab));
    }

    function _renderPlaylist() {
        const host = _ui?.playlist;
        if (!host) return;

        const items = _state.tracks
            .map((t, i) => ({ t, i }))
            .filter(x => x.t.kind === _tab);

        if (!items.length) {
            host.innerHTML = _tab === 'echo'
                ? '<div class="os-explorer-hint">АРХИВ ПУСТ.</div>'
                : '<div class="os-explorer-hint">ЛОКАЛЬНЫХ ФАЙЛОВ НЕТ — кнопка «+ ФАЙЛЫ» или перетащите аудио в окно.</div>';
            return;
        }

        host.innerHTML = items.map(({ t, i }) => `
            <button class="os-explorer-item os-ap-item${i === _state.current ? ' active' : ''}" data-idx="${i}">
                <span class="os-doc-icon">${t.kind === 'echo' ? AppRegistry.ICONS.echo : _iconNote()}</span>
                <span class="os-ap-item-name">${_esc(t.name)}</span>
                ${(i === _state.current && _state.playing) ? '<span class="os-ap-eq" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}
            </button>`).join('');

        host.querySelectorAll('.os-ap-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = +btn.dataset.idx;
                if (idx === _state.current) {
                    _state.playing ? _pause() : _play();      // клик по играющему — пауза
                } else {
                    _loadTrack(idx);
                }
            });
        });
    }

    // =========================================================================
    //  ТРАНСКРИПЦИЯ (text.txt → синхронные фразы)
    // =========================================================================

    // Служебные/разметочные теги text.txt — вычищаются из отображаемого текста
    const _RE_COM     = /^!COM/i;
    const _RE_CTRL    = /^\[(SCROLLSPEED|TIMER|CHARMODE|WORDMODE|H1|H2|H3)[=\]]/i;
    const _RE_SYNC    = /\[SYNC=([0-9.]+)\s*;\s*([0-9.]+)\]([\s\S]*?)\[\/SYNC\]/i;
    const _RE_AT_LINE = /^\[AT=([0-9.]+)\]\s*(.*)$/i;
    const _RE_TAGS    = /\[\/?(SYNC|AT|TIMER|SCROLLSPEED|CHARMODE|WORDMODE|H1|H2|H3)[^\]]*\]/gi;
    const _RE_MD      = /(\*\*|__|\*|_|`)/g;

    function _cleanText(s) {
        return String(s ?? '')
            .replace(_RE_TAGS, ' ')
            .replace(/^#{1,3}\s*/, '')
            .replace(_RE_MD, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /** Оценка длительности фразы (сек) — для сегментов без якорей. */
    function _estSec(text) {
        const words = text.split(/\s+/).filter(Boolean).length;
        return Math.max(1.2, words * 0.34);
    }

    /**
     * text.txt → [{start, end, text}].
     *
     * • [SYNC=s;e]фраза[/SYNC] — точный отрезок (приоритет);
     * • [AT=s] фраза          — точка старта;
     * • остальные фразы раскладываются между якорями пропорционально числу
     *   слов (оценка), чтобы подсветка не «прыгала» на незаякоренных строках;
     * • !COM-строки и чисто служебные теги пропускаются.
     */
    function _parseTranscript(raw) {
        const segs = [];
        for (const rawLine of String(raw ?? '').split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || _RE_COM.test(line)) continue;

            const sync = _RE_SYNC.exec(line);
            if (sync) {
                // Текст фразы — СОДЕРЖИМОЕ блока [SYNC=…][/SYNC] (sync[3]);
                // если вокруг блока есть ещё текст в той же строке — добавим его.
                // FIX: раньше брался только остаток строки после вырезания
                // блока — строка из одной SYNC-фразы давала пустой текст и
                // фраза молча терялась из транскрипции.
                const rest  = _cleanText(line.replace(_RE_SYNC, ' '));
                const text  = _cleanText(sync[3] + (rest ? ' ' + rest : ''));
                if (text) segs.push({ start: +sync[1], end: +sync[2], text });
                continue;
            }
            const at = _RE_AT_LINE.exec(line);
            if (at) {
                const text = _cleanText(at[2]);
                if (text) segs.push({ start: +at[1], end: null, text });
                continue;
            }
            if (_RE_CTRL.test(line)) continue;   // [TIMER=…] / [CHARMODE] и т.п.

            const text = _cleanText(line);
            if (text) segs.push({ start: null, end: null, text });
        }
        if (!segs.length) return segs;

        const known = [];
        segs.forEach((s, i) => { if (s.start != null) known.push(i); });

        if (!known.length) {
            // Якорей нет вовсе — идеальная шкала от нуля по оценкам
            let t = 0;
            for (const s of segs) {
                s.start = t;
                s.end   = t + _estSec(s.text);
                t = s.end + 0.15;
            }
            return segs;
        }

        // Голова до первого якоря: раскладываем назад, заканчивая на якоре
        const firstIdx = known[0];
        const head = segs.slice(0, firstIdx);
        if (head.length) {
            const total = head.reduce((acc, s) => acc + _estSec(s.text), 0);
            let t = Math.max(0, segs[firstIdx].start - total);
            for (const s of head) {
                s.start = t;
                s.end   = t + _estSec(s.text);
                t = s.end + 0.15;
            }
        }

        // Между якорями: unanchored распределяются пропорционально словам
        for (let k = 0; k < known.length; k++) {
            const a     = known[k];
            const b     = (k + 1 < known.length) ? known[k + 1] : segs.length;
            const inner = segs.slice(a + 1, b);
            const nextStart = (k + 1 < known.length) ? segs[known[k + 1]].start : null;

            if (!inner.length) continue;

            const anchorEst = _estSec(segs[a].text);
            const innerTotal = inner.reduce((acc, s) => acc + _estSec(s.text), 0);
            const room = (nextStart != null)
                ? Math.max(0.8, nextStart - segs[a].start - anchorEst)
                : innerTotal + 0.4;
            const scale = innerTotal > 0 ? room / innerTotal : 1;

            let t = segs[a].start + anchorEst;
            for (const s of inner) {
                s.start = t;
                s.end   = t + _estSec(s.text) * scale;
                t = s.end + 0.05;
            }
        }

        // Хвост после последнего якоря — последовательная оценка
        const lastAnchor = known[known.length - 1];
        let tailT = segs[lastAnchor].end ?? (segs[lastAnchor].start + _estSec(segs[lastAnchor].text));
        for (let i = lastAnchor + 1; i < segs.length; i++) {
            if (segs[i].start == null) {
                segs[i].start = tailT;
                segs[i].end   = tailT + _estSec(segs[i].text);
                tailT = segs[i].end + 0.15;
            } else {
                tailT = Math.max(tailT, segs[i].end ?? segs[i].start);
            }
        }

        // Финальный проход: концы без явного end — до начала следующей фразы
        for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            if (s.end == null) {
                const nxt = segs[i + 1];
                s.end = nxt ? Math.max(s.start + 0.4, nxt.start) : s.start + _estSec(s.text) * 1.6;
            }
            if (s.end <= s.start) s.end = s.start + 0.4;
        }

        return segs;
    }

    const _transcriptKey = (id) => `${ECHOES_BRANCH}/${id}`;

    async function _loadTranscript(echoId) {
        const key = _transcriptKey(echoId);
        if (_state.transcriptFor === key) return;
        _state.transcriptFor = key;
        _state.transcript    = [];
        _showTranscriptHint('ЗАПРОС ТЕКСТА ЗАПИСИ…');

        try {
            const resp = await fetch(`${ECHO_RAW_BASE}/${ECHOES_ROOT}/${echoId}/text.txt`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const raw = await resp.text();

            // Трек могли переключить, пока текст грузился
            const cur = _state.tracks[_state.current];
            if (!cur || cur.id !== echoId) return;

            _state.transcript = _parseTranscript(raw);
            _renderTranscript();
        } catch (e) {
            const cur = _state.tracks[_state.current];
            if (cur && cur.id === echoId) {
                _showTranscriptHint(`ТЕКСТ ЗАПИСИ НЕДОСТУПЕН (${_esc(e.message)})`);
            }
        }
    }

    function _renderTranscript() {
        if (!_ui?.trText) return;
        if (!_state.transcript.length) {
            _showTranscriptHint('ТЕКСТ ЗАПИСИ ПУСТ');
            return;
        }
        _ui.trText.innerHTML = _state.transcript
            .map(s => `<div class="tr-line">${_esc(s.text)}</div>`)
            .join('');
        _state.trActive = -1;
    }

    function _showTranscriptHint(html) {
        if (!_ui?.trText) return;
        _ui.trText.innerHTML = `<div class="os-ap-tr-hint">${html}</div>`;
        _state.trActive = -1;
    }

    /** Подсветка активной фразы + автопрокрутка (поведение субтитров). */
    function _setActiveTranscript(active) {
        if (!_ui?.trText) return;
        if (active === _state.trActive) return;
        _state.trActive = active;
        const rows = _ui.trText.children;
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].classList.contains('tr-line')) {
                rows[i].classList.toggle('active', i === active);
            }
        }
        if (active >= 0) {
            const row  = rows[active];
            const body = _ui.trBody;
            if (row && body) {
                const target = row.offsetTop - body.clientHeight / 2 + row.clientHeight / 2;
                body.scrollTop = Math.max(0, target);
            }
        }
    }

    function _updateTranscript(elapsed) {
        if (!_ui?.trText || !_state.transcript.length) return;
        let active = -1;
        for (let i = 0; i < _state.transcript.length; i++) {
            if (_state.transcript[i].start <= elapsed) active = i;
            else break;
        }
        _setActiveTranscript(active);
    }

    function _toggleTranscript() {
        if (!_ui) return;
        const box = _ui.root.querySelector('#ap-transcript');
        if (!box) return;
        box.classList.toggle('collapsed');
    }

    // =========================================================================
    //  СПЕКТР (canvas, «палочки»)
    // =========================================================================

    function _setupCanvas() {
        if (!_ui?.spec || !_ui?.canvas) return;
        _dpr = Math.min(2, window.devicePixelRatio || 1);

        const fit = () => {
            const w = _ui.spec.clientWidth;
            const h = _ui.spec.clientHeight;
            if (!w || !h) return;
            _ui.canvas.width  = Math.max(1, Math.round(w * _dpr));
            _ui.canvas.height = Math.max(1, Math.round(h * _dpr));
        };
        fit();

        if (_resizeObs) { try { _resizeObs.disconnect(); } catch (_) {} }
        if (typeof ResizeObserver !== 'undefined') {
            _resizeObs = new ResizeObserver(fit);
            _resizeObs.observe(_ui.spec);
        } else {
            window.addEventListener('resize', fit);
        }
    }

    function _drawSpectrum() {
        const cv = _ui?.canvas;
        if (!cv) return;
        const g = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        g.clearRect(0, 0, W, H);

        const live = _state.playing && _state.analyser && _state.audioEl && !_state.audioEl.paused;
        if (live) _state.analyser.getByteFrequencyData(_freq);

        // Число палочек — от ширины панели (9px * dpr на палочку)
        const N = Math.max(16, Math.min(48, Math.floor(W / (9 * _dpr))));
        const gap  = Math.max(2, 3 * _dpr);
        const bw   = Math.max(2, (W - gap * (N - 1)) / N);
        const base = 3 * _dpr;                 // «шум пола», как в макете
        const maxH = H - 2 * _dpr;

        const grad = g.createLinearGradient(0, H, 0, 0);
        grad.addColorStop(0, 'rgba(0, 160, 70, 0.55)');
        grad.addColorStop(1, 'rgba(0, 255, 65, 0.95)');

        const bins = _freq ? _freq.length : 0;
        for (let i = 0; i < N; i++) {
            let v;
            if (live) {
                // лог-группировка бинов: низкие частоты — шире бины
                const lo = Math.floor(Math.pow(i / N, 1.7) * bins * 0.72);
                const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / N, 1.7) * bins * 0.72));
                let sum = 0;
                for (let b = lo; b < hi; b++) sum += _freq[b];
                v = sum / (hi - lo) / 255;
            } else {
                v = 0.05 + Math.random() * 0.035;   // «дышащий» шум в простое
            }
            const h = Math.max(base, Math.min(maxH, v * maxH));
            const x = i * (bw + gap);
            g.fillStyle = grad;
            if (v > 0.55) {
                g.shadowColor = 'rgba(0, 255, 65, 0.6)';
                g.shadowBlur  = 6 * _dpr;
            } else {
                g.shadowBlur = 0;
            }
            g.fillRect(x, H - h, bw, h);
        }
        g.shadowBlur = 0;
    }

    // =========================================================================
    //  RAF-ЦИКЛ: спектр + тайм-код + перемотка + транскрипция
    // =========================================================================

    function _startRaf() {
        if (_raf) return;
        const loop = () => {
            if (!_ui) { _raf = 0; return; }        // окно закрыто
            _raf = requestAnimationFrame(loop);

            _drawSpectrum();
            const a = _state.audioEl;
            const elapsed = a ? a.currentTime : 0;
            const dur = (a && isFinite(a.duration)) ? a.duration : null;
            if (_ui.tCur) _ui.tCur.textContent = _fmt(elapsed);
            _syncSeekUI(elapsed, dur);
            _updateTranscript(elapsed);
        };
        _raf = requestAnimationFrame(loop);
    }

    function _syncSeekUI(elapsed, dur) {
        if (!_ui?.seek) return;
        if (_seekDrag) return;                     // пользователь тянет сам
        _ui.seek.value = dur ? Math.round((elapsed / dur) * 1000) : 0;
    }

    // =========================================================================
    //  UI: биндинг, титул, кнопки
    // =========================================================================

    function _bindUI() {
        const root = document.querySelector(`.lyoko-window[data-id="${WINDOW_ID}"]`);
        if (!root) { _ui = null; return; }

        _ui = {
            root,
            play:      root.querySelector('#ap-play'),
            stop:      root.querySelector('#ap-stop'),
            seek:      root.querySelector('#ap-seek'),
            tCur:      root.querySelector('#ap-time-cur'),
            tTot:      root.querySelector('#ap-time-total'),
            vol:       root.querySelector('#ap-vol'),
            trackline: root.querySelector('#ap-trackline'),
            trBody:    root.querySelector('#ap-tr-body'),
            trText:    root.querySelector('#ap-tr-text'),
            tabs:      [...root.querySelectorAll('.os-ap-tab')],
            addBtn:    root.querySelector('#ap-add'),
            playlist:  root.querySelector('#ap-playlist'),
            file:      root.querySelector('#ap-file'),
            spec:      root.querySelector('#ap-spectrum'),
            canvas:    root.querySelector('#ap-canvas'),
        };

        // Кнопка play/pause
        _ui.play.addEventListener('click', () => {
            _state.playing ? _pause() : _play();
        });
        _ui.stop.addEventListener('click', _stop);

        // Перемотка
        _ui.seek.addEventListener('pointerdown', () => { _seekDrag = true; });
        _ui.seek.addEventListener('input', () => {
            const a = _state.audioEl;
            if (!a || !isFinite(a.duration)) return;
            try { a.currentTime = (_ui.seek.value / 1000) * a.duration; } catch (_) {}
        });
        if (!_globalBound) {
            _globalBound = true;
            window.addEventListener('pointerup', () => { _seekDrag = false; });
        }

        // Громкость
        _ui.vol.value = Math.round(_vol() * 100);
        _ui.vol.addEventListener('input', () => _setVol(_ui.vol.value / 100));

        // Транскрипция — свернуть/развернуть (стрелка в макете)
        root.querySelector('#ap-tr-toggle').addEventListener('click', _toggleTranscript);

        // Вкладки плейлиста + добавление локальных файлов
        _ui.tabs.forEach(b => b.addEventListener('click', () => _switchTab(b.dataset.tab)));
        _ui.addBtn.addEventListener('click', () => _ui.file.click());
        _ui.file.addEventListener('change', (e) => {
            _addLocalFiles(e.target.files, { autoplay: true });
            _ui.file.value = '';
        });

        // Drag&drop аудио прямо в окно плеера
        const stop = (e) => { e.preventDefault(); };
        root.addEventListener('dragover', stop);
        root.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer?.files?.length) {
                _addLocalFiles(e.dataTransfer.files, { autoplay: true });
            }
        });

        _setupCanvas();
        _startRaf();

        // Если окно пересоздано, а трек уже был выбран — показать его состояние
        const cur = _state.tracks[_state.current];
        if (cur) {
            _setTrackline(cur.name);
            if (_ui.tTot && _state.audioEl && isFinite(_state.audioEl.duration)) {
                _ui.tTot.textContent = _fmt(_state.audioEl.duration);
            }
            if (cur.kind === 'echo') {
                // транскрипция уже в кеше состояния — перерисовать
                if (_state.transcript.length) _renderTranscript();
                else _loadTranscript(cur.id);
            } else {
                _showTranscriptHint('У ЛОКАЛЬНЫХ ФАЙЛОВ ТРАНСКРИПЦИИ НЕТ');
            }
            _updateTranscript(_state.audioEl?.currentTime ?? 0);
        }
    }

    function _setTrackline(text) {
        if (_ui?.trackline) _ui.trackline.textContent = text;
    }

    function _titleText(status) {
        const cur = _state.tracks[_state.current];
        if (status) return `АУДИО ПЛЕЕР: [${status}]`;
        if (!cur) return 'АУДИО ПЛЕЕР: [НИЧЕГО НЕ ИГРАЕТ]';
        // [ПАУЗА] — только когда остановились посреди трека; на нуле
        // (после стопа или до старта) просто имя записи
        const midTrack = !_state.playing && _state.audioEl && _state.audioEl.currentTime >= 0.15;
        return `АУДИО ПЛЕЕР: ${midTrack ? '[ПАУЗА] ' : ''}${cur.name.toUpperCase()}`;
    }

    function _updateTitle(status) {
        const text = _titleText(status);
        // Десктоп: заголовок окна; мобилка: титул живёт в табе tab-strip
        const titleEl = document.querySelector(`.lyoko-window[data-id="${WINDOW_ID}"] .lyoko-title`);
        if (titleEl) titleEl.textContent = text;
        const tabEl = document.querySelector(`.lyoko-tab[data-wid="${WINDOW_ID}"]`);
        if (tabEl) tabEl.textContent = text;
    }

    function _updatePlayBtn() {
        if (!_ui?.play) return;
        _ui.play.innerHTML = _state.playing ? _iconPause() : _iconPlay();
        _ui.play.classList.toggle('is-playing', _state.playing);
    }

    // ── Запуск ────────────────────────────────────────────────────────────────
    _register();

    return { open };

})();
