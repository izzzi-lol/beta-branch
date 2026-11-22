// =============================================================================
//  text-editor.js — Текстовый редактор досье — встроенное приложение SCIPNET OS
//
//  Иконка на рабочем столе: «Редактор».  Команда: textedit
//
//  Поддерживаемые теги соответствуют README "Туториал: написание досье".
//  Превью рендерится через тот же StepRenderer, что и реальные досье
//  (PluginAPI.renderer.toHTML), поэтому WYSIWYG соответствует GET 1:1.
// =============================================================================

(function () {

    if (typeof PluginAPI === 'undefined') {
        console.error('[text-editor] PluginAPI не найден. Файл загружен вне SCIPNET?');
        return;
    }

    const PLUGIN_ID      = 'text-editor';
    const EDITOR_WIN_ID  = 'text-editor-main';
    const PREVIEW_WIN_ID = 'text-editor-preview';
    const LOAD_WIN_ID    = 'text-editor-load';

    // Персистентное хранилище плагина (IndexedDB через PluginAPI.storage)
    const _store = PluginAPI.storage(PLUGIN_ID);

    // Ключ записи досье: "dossier:<имя>"
    const _DOSSIER_PREFIX = 'dossier:';

    // =========================================================================
    //  CSS — терминальная зелёная палитра
    // =========================================================================

    function _injectStyles() {
        if (document.getElementById('te-style')) return;
        const st = document.createElement('style');
        st.id = 'te-style';
        st.textContent = `

        /* ── Палитра: терминальный зелёный (совпадает с --terminal-green сайта) ── */
        .te-root {
            --te-accent:      var(--terminal-green, #10b981);
            --te-accent-dim:  color-mix(in srgb, var(--te-accent) 35%, transparent);
            --te-accent-bg:   color-mix(in srgb, var(--te-accent) 8%, transparent);
            --te-accent-bg2:  color-mix(in srgb, var(--te-accent) 18%, transparent);

            display: flex;
            flex-direction: column;
            height: 100%;
            background: #040705;
            color: #b8e8cf;
            font-family: 'JetBrains Mono', 'Courier New', monospace;
            box-sizing: border-box;
        }

        /* ── Панель инструментов ── */
        .te-toolbar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 3px;
            padding: 6px 7px;
            background: #061008;
            border-bottom: 1px solid var(--te-accent-dim);
            flex-shrink: 0;
        }
        .te-toolbar-row { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; width: 100%; }
        .te-toolbar-label {
            font-size: 9px;
            color: var(--te-accent-dim);
            letter-spacing: 2px;
            margin-right: 4px;
            text-transform: uppercase;
            flex-shrink: 0;
            min-width: 52px;
        }
        .te-btn {
            padding: 2px 7px;
            background: var(--te-accent-bg);
            border: 1px solid var(--te-accent-dim);
            color: var(--te-accent);
            cursor: pointer;
            font-size: 11px;
            font-family: 'JetBrains Mono', 'Courier New', monospace;
            line-height: 1.7;
            transition: background 0.1s, color 0.1s, border-color 0.1s;
            user-select: none;
            white-space: nowrap;
        }
        .te-btn:hover  { background: var(--te-accent-bg2); color: #eafff5; border-color: var(--te-accent); }
        .te-btn:active { background: var(--te-accent); color: #04140c; }
        .te-vsep {
            width: 1px;
            background: var(--te-accent-dim);
            align-self: stretch;
            margin: 1px 3px;
            flex-shrink: 0;
        }

        /* ── Область ввода ── */
        .te-textarea {
            flex: 1;
            min-height: 0;
            padding: 12px 14px;
            background: #020403;
            color: #cdf7e3;
            border: none;
            outline: none;
            resize: none;
            font-family: 'JetBrains Mono', 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.7;
            tab-size: 4;
            box-sizing: border-box;
            caret-color: var(--te-accent);
        }
        .te-textarea::placeholder { color: #1f3329; }
        .te-textarea:focus { background: #030604; }

        /* ── Строка состояния ── */
        .te-statusbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 3px 8px;
            background: #061008;
            border-top: 1px solid var(--te-accent-dim);
            font-size: 11px;
            color: var(--te-accent-dim);
            flex-shrink: 0;
        }
        .te-actions { display: flex; gap: 5px; }
        .te-act-btn {
            padding: 2px 10px;
            border: 1px solid var(--te-accent-dim);
            background: var(--te-accent-bg);
            color: var(--te-accent);
            cursor: pointer;
            font-size: 11px;
            font-family: 'JetBrains Mono', 'Courier New', monospace;
            transition: background 0.1s, color 0.1s;
        }
        .te-act-btn:hover  { background: var(--te-accent-bg2); color: #eafff5; border-color: var(--te-accent); }
        .te-act-btn:active { background: var(--te-accent); color: #04140c; }
        .te-act-btn.te-primary {
            border-color: var(--te-accent);
            background: var(--te-accent-bg2);
            color: #eafff5;
            font-weight: bold;
        }
        .te-act-btn.te-primary:hover { background: var(--te-accent); color: #04140c; }

        /* ── Подсказка по тегам (справочник) ── */
        .te-hint {
            padding: 8px 14px;
            font-size: 10px;
            color: var(--te-accent-dim);
            line-height: 1.8;
            border-top: 1px solid var(--te-accent-dim);
            flex-shrink: 0;
        }
        .te-hint b { color: var(--te-accent); }

        /* ── Drag-and-drop: визуальный отклик ── */
        .te-textarea.te-drag-over {
            background: #041a0c !important;
            outline: 2px dashed var(--te-accent);
            outline-offset: -2px;
        }

        /* ── Баннер "НЕ ХВАТАЕТ ФАЙЛОВ" ── */
        .te-missing-banner {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 5px 12px;
            background: rgba(200, 20, 20, 0.13);
            border-top: 1px solid rgba(220, 30, 30, 0.5);
            color: #ff5555;
            font-size: 10px;
            letter-spacing: 1.5px;
            flex-shrink: 0;
            animation: te-banner-pulse 2s ease-in-out infinite;
        }
        .te-missing-banner::before {
            content: '●';
            animation: te-dot-blink 1s step-start infinite;
        }
        .te-missing-banner.te-hidden { display: none !important; }
        @keyframes te-banner-pulse {
            0%, 100% { background: rgba(200, 20, 20, 0.10); }
            50%       { background: rgba(200, 20, 20, 0.22); }
        }
        @keyframes te-dot-blink {
            0%, 49%   { opacity: 1; }
            50%, 100% { opacity: 0; }
        }

        /* ── Счётчик изображений в статусбаре ── */
        .te-img-stat { color: var(--te-accent-dim); transition: color 0.2s; cursor: default; }
        .te-img-stat.has-images { color: var(--te-accent); }

        /* ── Имя текущего досье (рядом с COPY/CLEAR/SAVE) ── */
        .te-dossier-name {
            color: var(--te-accent-dim);
            font-size: 10px;
            max-width: 140px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            align-self: center;
        }
        .te-dossier-name.te-dirty::after { content: ' •'; color: #ff5555; }

        /* =========================================
           ОКНО "СОХРАНЁННЫЕ ДОСЬЕ" (LOAD)
           ========================================= */
        .te-list-root {
            display: flex;
            flex-direction: column;
            height: 100%;
            background: #040705;
            color: #b8e8cf;
            font-family: 'JetBrains Mono', 'Courier New', monospace;
            font-size: 12px;
            box-sizing: border-box;
        }
        .te-list-empty {
            padding: 24px 16px;
            text-align: center;
            color: var(--te-accent-dim, #0d5c40);
            font-size: 11px;
            letter-spacing: 1px;
        }
        .te-list-items { flex: 1; overflow-y: auto; }
        .te-list-row {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            border-bottom: 1px solid rgba(16, 185, 129, 0.12);
            cursor: pointer;
            transition: background 0.1s;
        }
        .te-list-row:hover { background: rgba(16, 185, 129, 0.07); }
        .te-list-info { flex: 1; min-width: 0; }
        .te-list-title {
            color: #cdf7e3;
            font-weight: bold;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .te-list-meta {
            color: rgba(184, 232, 207, 0.4);
            font-size: 10px;
            margin-top: 2px;
        }
        .te-list-del {
            flex-shrink: 0;
            padding: 3px 8px;
            background: rgba(220, 30, 30, 0.08);
            border: 1px solid rgba(220, 30, 30, 0.35);
            color: #ff6666;
            cursor: pointer;
            font-size: 10px;
            transition: background 0.1s;
        }
        .te-list-del:hover { background: rgba(220, 30, 30, 0.22); }

        /* =========================================
           ПРЕДПРОСМОТР
           Внутреннее оформление (scp-header, scp-list, dossier-scope и т.д.)
           задаётся глобальными стилями сайта — здесь только контейнер.
           ========================================= */
        .te-preview {
            padding: 18px 22px;
            font-family: 'JetBrains Mono', 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.8;
            color: #b8b8b8;
            height: 100%;
            overflow-y: auto;
            box-sizing: border-box;
            background: #040705;
        }
        `;
        document.head.appendChild(st);
    }

    // =========================================================================
    //  Парсер тегов → HTML (через тот же StepRenderer, что и реальные досье)
    // =========================================================================

    function _parse(text) {
        const renderer = PluginAPI.renderer;
        if (renderer && typeof renderer.toHTML === 'function') {
            return renderer.toHTML(text, '', _localImageMap, false);
        }
        // Фоллбэк, если renderer недоступен — просто экранируем и переносим строки
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
    }

    // =========================================================================
    //  Состояние плагина (сохраняется между открытиями окна)
    // =========================================================================

    let _content      = '';
    let _localImageMap = {}; // имя файла → data-URL (заполняется drag-and-drop)
    let _debounce     = null;
    let _currentDossierName = null; // имя текущего загруженного/сохранённого досье (или null)
    let _lastSavedSnapshot  = null; // content на момент последнего save/load — для индикатора "•"

    // =========================================================================
    //  Хранилище досье (PluginAPI.storage) — сохранение/загрузка целиком
    //
    //  Одна запись = { name, content, images: {filename: dataUrl}, savedAt }
    //  Ключ в IndexedDB: "dossier:<имя>" (через PLUGIN_ID-неймспейс PluginAPI.storage,
    //  то есть физически это "text-editor::dossier:<имя>" — другие плагины не видят).
    // =========================================================================

    /** Извлекает имя из первого тега [TITLE] в тексте, если есть. */
    function _extractTitle(text) {
        const m = text.match(/^\s*\[TITLE\]\s*(.+)$/mi);
        return m ? m[1].trim() : '';
    }

    /** Сохраняет текущее досье (текст + изображения) под указанным именем. */
    async function _saveDossier(name) {
        const record = {
            name,
            content: _content,
            images:  { ..._localImageMap },
            savedAt: Date.now(),
        };
        await _store.set(_DOSSIER_PREFIX + name, record);
        return record;
    }

    /** Возвращает список сохранённых досье, отсортированный по дате (новые сверху). */
    async function _listDossiers() {
        const keys = await _store.keys();
        const dossierKeys = keys.filter(k => k.startsWith(_DOSSIER_PREFIX));
        const records = await Promise.all(dossierKeys.map(k => _store.get(k)));
        return records
            .filter(Boolean)
            .sort((a, b) => b.savedAt - a.savedAt);
    }

    /** Загружает досье по имени и возвращает запись (или null, если не найдено). */
    async function _loadDossierRecord(name) {
        return _store.get(_DOSSIER_PREFIX + name);
    }

    /** Удаляет сохранённое досье. */
    async function _deleteDossier(name) {
        await _store.remove(_DOSSIER_PREFIX + name);
    }

    // =========================================================================
    //  Кнопки панели инструментов — по разделам README
    // =========================================================================

    // ── Инлайн-теги (оборачивают выделение) ────────────────────────────────
    const INLINE_TAGS = [
        { l: 'B',     open: '**',  close: '**',  hint: 'Жирный  **текст**' },
        { l: 'I',     open: '_',   close: '_',   hint: 'Курсив  _текст_' },
        { l: 'S',     open: '~~',  close: '~~',  hint: 'Зачёркнутый  ~~текст~~' },
        { l: 'CODE',  open: '`',   close: '`',   hint: 'Моноширинный  `код`' },
        { l: 'ЦЕНЗ',  open: '==',  close: '==',  hint: 'Цензура  ==скрытый текст==' },
        null,
        { l: 'COLOR',   open: '[COLOR=#10b981]',                    close: '[/COLOR]',   hint: '[COLOR=#HEX]...[/COLOR] — цвет текста' },
        { l: 'BGCOLOR', open: '[BGCOLOR=#0a1f14]',                   close: '[/BGCOLOR]', hint: '[BGCOLOR=#HEX]...[/BGCOLOR] — фон текста' },
        { l: 'SIZE',    open: '[SIZE=24]',                           close: '[/SIZE]',    hint: '[SIZE=N]...[/SIZE] — размер текста' },
        { l: 'GLITCH',  open: '[EFFECT=GLITCH;INTENSIVE=0.5]',       close: '[/EFFECT]',  hint: '[EFFECT=GLITCH;INTENSIVE=N]...[/EFFECT]' },
        { l: 'HREF',    open: '[HREF=https://]',                     close: '[/HREF]',    hint: '[HREF=ссылка]текст[/HREF]' },
        { l: 'CMD',     open: '[CMD="get id"]',                      close: '[/CMD]',     hint: '[CMD="команда"][метка][/CMD]' },
        { l: 'BROWSE',  open: '[BROWSE="https://"]',                  close: '[/BROWSE]',  hint: '[BROWSE="ссылка"]метка[/BROWSE]' },
    ];

    // ── Блочные теги (вставляются как отдельные строки/блоки) ───────────────
    const BLOCK_TAGS = [
        { l: 'TITLE',   kind: 'prefixLine', value: '[TITLE] ',    hint: '[TITLE] — название досье (для поиска GET)' },
        { l: 'H1',      kind: 'prefixLine', value: '[H1] ',       hint: '[H1] Заголовок раздела' },
        { l: 'H2',      kind: 'prefixLine', value: '[H2] ',       hint: '[H2] Подзаголовок' },
        { l: 'H3',      kind: 'prefixLine', value: '[H3] ',       hint: '[H3] Заголовок подраздела' },
        { l: '≡ CENTER', kind: 'prefixLine', value: '[CENTER] ',  hint: '[CENTER] — по центру (для заголовков и абзацев)' },
        null,
        { l: 'DANGER',   kind: 'prefixLine', value: '[DANGER] ',  hint: '[DANGER] Текст предупреждения — красный блок' },
        { l: '- LIST',   kind: 'prefixLine', value: '- ',         hint: '- пункт списка (поддерживает инлайн-теги)' },
        { l: '─── HR',   kind: 'line',       value: '---',        hint: 'Горизонтальная линия' },
        { l: '. SPACER', kind: 'line',       value: '.',          hint: 'Пустая строка-отступ' },
        null,
        {
            l: 'QUOTE', kind: 'template', hint: '[QUOTE]...[/QUOTE] — блок-цитата',
            value: '[QUOTE]\n«§Текст цитаты.§»\n— Источник\n[/QUOTE]'
        },
        {
            l: 'FOOTNOTE', kind: 'template', hint: '[FOOTNOTE]...[/FOOTNOTE] — сноска',
            value: '[FOOTNOTE]\n- §Примечание 1.§\n- Примечание 2.\n[/FOOTNOTE]'
        },
        {
            l: 'TABLE6', kind: 'template', hint: '[TABLE6]...[/TABLE6] — таблица, строки через ||',
            value: '[TABLE6]\nХарактеристика || Описание\n§Имя§ || ...\n[/TABLE6]'
        },
        {
            l: 'IMAGE', kind: 'template', hint: '[IMAGE] файл || подпись || позиция || масштаб',
            value: '[IMAGE] §имя_файла.jpg§ || Подпись || right || 1'
        },
    ];

    // ── Системные теги (управление рендером, отдельная строка) ───────────────
    const SYSTEM_TAGS = [
        {
            l: 'COLORCODES', kind: 'template', hint: '[COLORCODES] — цветовая тема (первая строка файла)',
            value: '[COLORCODES] Mainpage=§#10b981§; Quotes=#10b981; Tables=#10b981'
        },
        { l: 'SPEED',    kind: 'template', hint: '[SCROLLSPEED=мс] — скорость анимации (default 38)', value: '[SCROLLSPEED=§38§]' },
        { l: 'TIMER',    kind: 'template', hint: '[TIMER=с] — пауза рендера', value: '[TIMER=§1§]' },
        { l: 'AT',       kind: 'template', hint: '[AT=с] — ждать аудио-отметку записи ECHO (сек медиа-времени)', value: '[AT=§1.5§]' },
        { l: 'SYNC',     kind: 'template', hint: '[SYNC=нач;кон]текст[/SYNC] — растянуть фразу по аудио-отрезку (сек)', value: '[SYNC=§12.0§;§18.0§]§текст§[/SYNC]' },
        { l: 'CHARMODE', kind: 'line', value: '[CHARMODE]', hint: 'Посимвольная анимация' },
        { l: 'WORDMODE', kind: 'line', value: '[WORDMODE]', hint: 'Пословная анимация (по умолчанию)' },
        null,
        { l: 'DISABLE=TAGS', kind: 'line', value: '[DISABLE=TAGS]', hint: 'Отключить кастомные теги до [ENABLE=TAGS]' },
        { l: 'ENABLE=TAGS',  kind: 'line', value: '[ENABLE=TAGS]',  hint: 'Включить кастомные теги обратно' },
        { l: 'DISABLE=MD',   kind: 'line', value: '[DISABLE=MD]',   hint: 'Отключить Markdown до [ENABLE=MD]' },
        { l: 'ENABLE=MD',    kind: 'line', value: '[ENABLE=MD]',    hint: 'Включить Markdown обратно' },
        null,
        { l: '!COM',     kind: 'prefixLine', value: '!COM ', hint: '!COM комментарий — не выводится игроку' },
    ];

    // =========================================================================
    //  HTML редактора
    // =========================================================================

    function _editorHTML() {

        const inlineBtns = INLINE_TAGS.map(t =>
            t
                ? `<button class="te-btn" data-kind="inline" data-open="${_escapeForAttr(t.open)}" data-close="${_escapeForAttr(t.close)}" title="${_escapeForAttr(t.hint)}">${t.l}</button>`
                : `<div class="te-vsep"></div>`
        ).join('');

        const blockBtns = BLOCK_TAGS.map(t =>
            t
                ? `<button class="te-btn" data-kind="${t.kind}" data-value="${_escapeForAttr(t.value)}" title="${_escapeForAttr(t.hint)}">${t.l}</button>`
                : `<div class="te-vsep"></div>`
        ).join('');

        const systemBtns = SYSTEM_TAGS.map(t =>
            t
                ? `<button class="te-btn" data-kind="${t.kind}" data-value="${_escapeForAttr(t.value)}" title="${_escapeForAttr(t.hint)}">${t.l}</button>`
                : `<div class="te-vsep"></div>`
        ).join('');

        const ph = [
            '!COM Введите текст с тегами...',
            '',
            '[COLORCODES] Mainpage=#10b981; Quotes=#10b981; Tables=#10b981',
            '[TITLE] ИМЯ ДОСЬЕ',
            '',
            '[H1] [CENTER] Личные данные',
            '**Статус:** [COLOR=#10b981]Активен[/COLOR]',
            '[separator не нужен — используйте --- или ***]',
        ].join('&#10;');

        const savedVal = _escapeForAttr(_content);

        return `
<div class="te-root">
  <div class="te-toolbar">
    <div class="te-toolbar-row">
      <span class="te-toolbar-label">Инлайн</span>
      ${inlineBtns}
    </div>
    <div class="te-toolbar-row">
      <span class="te-toolbar-label">Блоки</span>
      ${blockBtns}
    </div>
    <div class="te-toolbar-row">
      <span class="te-toolbar-label">Система</span>
      ${systemBtns}
    </div>
  </div>
  <textarea
    class="te-textarea"
    id="te-textarea"
    placeholder="${ph}"
    spellcheck="false"
    title="Перетащите изображения сюда — они появятся в превью"
  >${savedVal}</textarea>
  <div id="te-missing-banner" class="te-missing-banner te-hidden">
    НЕ ХВАТАЕТ ФАЙЛОВ:&nbsp;<span id="te-missing-names"></span>
    <span style="margin-left:auto;opacity:0.6;font-size:9px;letter-spacing:1px">↑ ПЕРЕТАЩИТЕ ФАЙЛЫ НА ПОЛЕ РЕДАКТОРА</span>
  </div>
  <div class="te-statusbar">
    <span id="te-stat">0 симв.</span>
    <span id="te-img-stat" class="te-img-stat" title="Загруженные изображения (drag-and-drop на текстовое поле)">0 изобр.</span>
    <span id="te-dossier-name" class="te-dossier-name"></span>
    <div class="te-actions">
      <button class="te-act-btn" id="te-copy"    title="Скопировать исходный текст">COPY</button>
      <button class="te-act-btn" id="te-clear"   title="Очистить редактор">CLEAR</button>
      <button class="te-act-btn" id="te-save"    title="Сохранить досье локально (IndexedDB)">SAVE 💾</button>
      <button class="te-act-btn" id="te-load"    title="Загрузить сохранённое досье">LOAD 📂</button>
      <button class="te-act-btn te-primary" id="te-preview-btn" title="Открыть окно предпросмотра">PREVIEW ▶</button>
    </div>
  </div>
  <div class="te-hint">
    <b>Ctrl+B</b> жирный · <b>Ctrl+I</b> курсив · <b>Tab</b> = 4 пробела ·
    <b>SAVE</b> сохраняет текст+картинки локально · <b>LOAD</b> открывает список сохранённых ·
    Полный список тегов — см. README "Туториал: написание досье".
  </div>
</div>`;
    }

    // =========================================================================
    //  HTML окна предпросмотра
    // =========================================================================

    function _previewHTML() {
        return `<div class="te-preview" id="te-preview-content">${_parse(_content)}</div>`;
    }

    // =========================================================================
    //  HTML окна "Сохранённые досье" (LOAD)
    // =========================================================================

    function _formatSavedAt(ts) {
        const d = new Date(ts);
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function _loadListRowHTML(rec) {
        const imgCount = rec.images ? Object.keys(rec.images).length : 0;
        const chars    = rec.content ? rec.content.length : 0;
        return `
        <div class="te-list-row" data-name="${_escapeForAttr(rec.name)}">
            <div class="te-list-info">
                <div class="te-list-title">${_escapeForAttr(rec.name)}</div>
                <div class="te-list-meta">${_formatSavedAt(rec.savedAt)} · ${chars} симв. · ${imgCount} изобр.</div>
            </div>
            <button class="te-list-del" data-name="${_escapeForAttr(rec.name)}" title="Удалить безвозвратно">✕</button>
        </div>`;
    }

    function _loadListHTML(records) {
        const body = records.length
            ? `<div class="te-list-items">${records.map(_loadListRowHTML).join('')}</div>`
            : `<div class="te-list-empty">НЕТ СОХРАНЁННЫХ ДОСЬЕ<br>Нажмите SAVE 💾 в редакторе, чтобы сохранить текущий текст.</div>`;
        return `<div class="te-list-root">${body}</div>`;
    }

    // =========================================================================
    //  Вспомогательные функции
    // =========================================================================

    /** Безопасное значение для value="" / data-*="" атрибутов */
    function _escapeForAttr(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /** Границы текущей строки (с учётом курсора) */
    function _lineBounds(value, pos) {
        const start = value.lastIndexOf('\n', pos - 1) + 1;
        let end = value.indexOf('\n', pos);
        if (end === -1) end = value.length;
        return { start, end };
    }

    /** Оборачивает выделение парой строк open/close (или вставляет в позицию курсора) */
    function _insertWrap(ta, open, close) {
        const s   = ta.selectionStart;
        const e   = ta.selectionEnd;
        const sel = ta.value.slice(s, e);

        ta.value = ta.value.slice(0, s) + open + sel + close + ta.value.slice(e);

        if (sel.length === 0) {
            ta.selectionStart = ta.selectionEnd = s + open.length;
        } else {
            ta.selectionStart = s;
            ta.selectionEnd   = s + open.length + sel.length + close.length;
        }

        ta.focus();
        ta.dispatchEvent(new Event('input'));
    }

    /** Добавляет префикс в начало каждой строки текущего выделения (или текущей строки) */
    function _prefixLines(ta, prefix) {
        const s = ta.selectionStart;
        const e = ta.selectionEnd;

        const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
        let lineEnd = ta.value.indexOf('\n', Math.max(e - 1, lineStart));
        if (lineEnd === -1) lineEnd = ta.value.length;

        const block = ta.value.slice(lineStart, lineEnd);
        const lines = block.split('\n');

        const allPrefixed = lines.every(l => l.startsWith(prefix));
        const result = lines
            .map(l => allPrefixed ? l.slice(prefix.length) : prefix + l)
            .join('\n');

        ta.value = ta.value.slice(0, lineStart) + result + ta.value.slice(lineEnd);

        const delta = result.length - block.length;
        ta.selectionStart = s + (allPrefixed ? -prefix.length : prefix.length);
        ta.selectionEnd   = e + delta;

        ta.focus();
        ta.dispatchEvent(new Event('input'));
    }

    /** Вставляет текст как отдельную строку (гарантируя перенос до и после) */
    function _insertLine(ta, text) {
        const s = ta.selectionStart;
        const { start, end } = _lineBounds(ta.value, s);
        const currentLine = ta.value.slice(start, end);

        let insertion = text;
        let prefix = '';
        let suffix = '';

        if (currentLine.trim() !== '') {
            prefix = '\n';     // текущая строка не пуста — переносим на новую
        }
        suffix = '\n';

        const insertPos = currentLine.trim() === '' ? start : end;
        ta.value = ta.value.slice(0, insertPos) + prefix + insertion + suffix + ta.value.slice(insertPos);

        const cursorPos = insertPos + prefix.length + insertion.length + suffix.length;
        ta.selectionStart = ta.selectionEnd = cursorPos;

        ta.focus();
        ta.dispatchEvent(new Event('input'));
    }

    /**
     * Вставляет многострочный шаблон. Символ "§" в шаблоне маркирует
     * границы выделения для быстрого редактирования placeholder'а;
     * сами символы "§" удаляются из итогового текста.
     */
    function _insertTemplate(ta, template) {
        const s = ta.selectionStart;
        const { start, end } = _lineBounds(ta.value, s);
        const currentLine = ta.value.slice(start, end);

        const prefix = currentLine.trim() === '' ? '' : '\n';
        const block  = prefix + template + '\n';
        const insertPos = currentLine.trim() === '' ? start : end;

        const markStart = block.indexOf('§');
        const markEnd   = block.indexOf('§', markStart + 1);

        const clean = block.replace(/§/g, '');
        ta.value = ta.value.slice(0, insertPos) + clean + ta.value.slice(insertPos);

        if (markStart !== -1 && markEnd !== -1) {
            ta.selectionStart = insertPos + markStart;
            ta.selectionEnd   = insertPos + (markEnd - 1); // -1: первый § уже "съеден"
        } else {
            ta.selectionStart = ta.selectionEnd = insertPos + clean.length;
        }

        ta.focus();
        ta.dispatchEvent(new Event('input'));
    }

    /** Извлекает все имена файлов из тегов [IMAGE] в тексте. */
    function _extractImageNames(text) {
        const names = new Set();
        for (const line of text.split('\n')) {
            const t = line.trim();
            if (t.startsWith('[IMAGE]')) {
                const name = t.slice(7).split('||')[0].trim();
                if (name) names.add(name);
            }
        }
        return names;
    }

    /**
     * Сравнивает [IMAGE]-теги текста с _localImageMap.
     * Показывает красный баннер если есть недостающие файлы,
     * скрывает если всё в порядке.
     */
    function _checkMissingImages() {
        const banner  = document.getElementById('te-missing-banner');
        const nameEl  = document.getElementById('te-missing-names');
        if (!banner) return;

        const needed  = _extractImageNames(_content);
        if (needed.size === 0) { banner.classList.add('te-hidden'); return; }

        const missing = [...needed].filter(n => !_localImageMap[n]);
        if (missing.length === 0) {
            banner.classList.add('te-hidden');
        } else {
            banner.classList.remove('te-hidden');
            if (nameEl) nameEl.textContent = missing.join(', ');
        }
    }

    /** Обновляет счётчик загруженных изображений в статусбаре. */
    function _updateImgStat() {
        const el    = document.getElementById('te-img-stat');
        if (!el) return;
        const count = Object.keys(_localImageMap).length;
        el.textContent = `${count} изобр.`;
        el.classList.toggle('has-images', count > 0);
    }

    /**
     * Обновляет индикатор "текущее досье" в статусбаре.
     * dirty=true добавляет красную точку — есть несохранённые изменения.
     */
    function _updateDossierNameIndicator(dirty = false) {
        const el = document.getElementById('te-dossier-name');
        if (!el) return;
        if (!_currentDossierName) {
            el.textContent = '';
            el.classList.remove('te-dirty');
            return;
        }
        el.textContent = _currentDossierName;
        el.title = `Текущее досье: ${_currentDossierName}`;
        el.classList.toggle('te-dirty', dirty);
    }

    /** Обновить содержимое предпросмотра, если окно открыто */
    function _liveUpdatePreview() {
        const el = document.getElementById('te-preview-content');
        if (el) el.innerHTML = _parse(_content);
    }

    function _scheduleLiveUpdate() {
        clearTimeout(_debounce);
        _debounce = setTimeout(_liveUpdatePreview, 120);
    }

    // =========================================================================
    //  Привязка событий после рендера окна редактора
    // =========================================================================

    function _bindEditorEvents() {
        const ta   = document.getElementById('te-textarea');
        const stat = document.getElementById('te-stat');

        if (!ta) {
            // WindowManager ещё не отрисовал DOM — повторная попытка
            setTimeout(_bindEditorEvents, 50);
            return;
        }

        // Восстанавливаем сохранённый текст
        ta.value = _content;

        // ── Статистика ──────────────────────────────────────────────────────
        function updateStat() {
            _content = ta.value;
            const chars = ta.value.length;
            const words = ta.value.trim().length
                ? ta.value.trim().split(/\s+/).length
                : 0;
            const lines = ta.value.split('\n').length;
            if (stat) stat.textContent = `${chars} симв. / ${words} сл. / ${lines} стр.`;
            _checkMissingImages();
            _updateDossierNameIndicator(_currentDossierName !== null && _content !== _lastSavedSnapshot);
            _scheduleLiveUpdate();
        }

        ta.addEventListener('input', updateStat);
        updateStat();

        // ── Горячие клавиши (Ctrl/Cmd + B / I) ──────────────────────────────
        ta.addEventListener('keydown', e => {
            const ctrl = e.ctrlKey || e.metaKey;
            if (!ctrl) return;
            if (e.key === 'b' || e.key === 'B') { e.preventDefault(); _insertWrap(ta, '**', '**'); }
            if (e.key === 'i' || e.key === 'I') { e.preventDefault(); _insertWrap(ta, '_', '_'); }
        });

        // ── Tab → 4 пробела ─────────────────────────────────────────────────
        ta.addEventListener('keydown', e => {
            if (e.key === 'Tab') {
                e.preventDefault();
                _insertWrap(ta, '    ', '');
            }
        });

        // ── Кнопки тегов ────────────────────────────────────────────────────
        document.querySelectorAll('.te-btn[data-kind]').forEach(btn => {
            const kind = btn.dataset.kind;
            btn.addEventListener('click', () => {
                switch (kind) {
                    case 'inline':
                        _insertWrap(ta, btn.dataset.open, btn.dataset.close);
                        break;
                    case 'prefixLine':
                        _prefixLines(ta, btn.dataset.value);
                        break;
                    case 'line':
                        _insertLine(ta, btn.dataset.value);
                        break;
                    case 'template':
                        _insertTemplate(ta, btn.dataset.value);
                        break;
                }
            });
        });

        // ── CLEAR ────────────────────────────────────────────────────────────
        document.getElementById('te-clear')?.addEventListener('click', () => {
            if (!ta.value || confirm('Очистить весь текст?')) {
                ta.value = '';
                _localImageMap = {};
                _currentDossierName = null;
                _lastSavedSnapshot  = null;
                updateStat();
                _updateImgStat();
                _updateDossierNameIndicator();
            }
        });

        // ── COPY ─────────────────────────────────────────────────────────────
        document.getElementById('te-copy')?.addEventListener('click', () => {
            if (!ta.value) return;
            navigator.clipboard.writeText(ta.value).then(() => {
                const btn = document.getElementById('te-copy');
                if (!btn) return;
                const orig = btn.textContent;
                btn.textContent = 'COPIED ✓';
                setTimeout(() => { btn.textContent = orig; }, 1400);
            });
        });

        // ── PREVIEW ──────────────────────────────────────────────────────────
        document.getElementById('te-preview-btn')?.addEventListener('click', () => {
            _content = ta.value;
            _openPreview();
        });

        // ── SAVE ─────────────────────────────────────────────────────────────
        document.getElementById('te-save')?.addEventListener('click', async () => {
            _content = ta.value;
            if (!_content.trim()) {
                alert('Нечего сохранять — редактор пуст.');
                return;
            }

            const suggested = _currentDossierName || _extractTitle(_content) || '';
            const name = prompt('Имя досье для сохранения:', suggested);
            if (!name || !name.trim()) return;

            const trimmedName = name.trim();
            const saveBtn = document.getElementById('te-save');

            try {
                await _saveDossier(trimmedName);
                _currentDossierName = trimmedName;
                _lastSavedSnapshot  = _content;
                _updateDossierNameIndicator(false);

                if (saveBtn) {
                    const orig = saveBtn.textContent;
                    saveBtn.textContent = 'SAVED ✓';
                    setTimeout(() => { saveBtn.textContent = orig; }, 1400);
                }
            } catch (err) {
                console.error('[text-editor] Ошибка сохранения:', err);
                alert('Не удалось сохранить досье: ' + err.message);
            }
        });

        // ── LOAD ─────────────────────────────────────────────────────────────
        document.getElementById('te-load')?.addEventListener('click', () => {
            _openLoadWindow();
        });

        // ── Drag-and-drop изображений на textarea ────────────────────────────
        ta.addEventListener('dragover', e => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            ta.classList.add('te-drag-over');
        });

        ta.addEventListener('dragleave', e => {
            // Проверяем: курсор ушёл именно за пределы textarea (не в child-элемент)
            if (!ta.contains(e.relatedTarget)) ta.classList.remove('te-drag-over');
        });

        ta.addEventListener('drop', e => {
            ta.classList.remove('te-drag-over');
            const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
            if (!files.length) return;
            e.preventDefault(); // не даём браузеру открыть картинку

            let loaded = 0;
            const imgStat = document.getElementById('te-img-stat');

            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = ev => {
                    _localImageMap[file.name] = ev.target.result;
                    loaded++;
                    if (loaded === files.length) {
                        // Flash-подтверждение
                        if (imgStat) {
                            imgStat.textContent = `+${files.length} ✓`;
                            setTimeout(_updateImgStat, 1500);
                        }
                        _checkMissingImages();
                        _scheduleLiveUpdate(); // превью обновится с реальными картинками
                    }
                };
                reader.readAsDataURL(file);
            });
        });

        // Начальный счётчик (если файлы уже были загружены до открытия окна)
        _updateImgStat();
        _checkMissingImages();
        _updateDossierNameIndicator(_currentDossierName !== null && _content !== _lastSavedSnapshot);
    }

    // =========================================================================
    //  Открытие окна предпросмотра
    // =========================================================================

    function _openPreview() {
        const wm = PluginAPI.WindowManager;
        if (!wm) {
            console.error('[text-editor] WindowManager недоступен');
            return;
        }
        wm.open(PREVIEW_WIN_ID, 'ПРЕДПРОСМОТР', _previewHTML(), {
            width:  500,
            height: 440,
            status: 'TEXT EDITOR — LIVE PREVIEW (обновляется автоматически)',
        });
    }

    // =========================================================================
    //  Окно "Сохранённые досье" (LOAD)
    // =========================================================================

    /** Применяет загруженную запись к редактору: текст, картинки, индикаторы. */
    function _applyLoadedRecord(rec) {
        _content             = rec.content || '';
        _localImageMap       = { ...(rec.images || {}) };
        _currentDossierName  = rec.name;
        _lastSavedSnapshot   = _content;

        const ta = document.getElementById('te-textarea');
        if (ta) {
            ta.value = _content;
            ta.dispatchEvent(new Event('input')); // пересчитает статистику, dirty, missing-images
        }
        _updateImgStat();
        _updateDossierNameIndicator(false);
    }

    async function _refreshLoadWindow() {
        const wm = PluginAPI.WindowManager;
        const records = await _listDossiers();
        wm.open(LOAD_WIN_ID, 'СОХРАНЁННЫЕ ДОСЬЕ', _loadListHTML(records), {
            width:  380,
            height: 420,
            status: `TEXT EDITOR — ${records.length} сохранено`,
        });
        setTimeout(_bindLoadWindowEvents, 60);
    }

    function _bindLoadWindowEvents() {
        const root = document.querySelector('.te-list-root');
        if (!root) {
            setTimeout(_bindLoadWindowEvents, 50);
            return;
        }

        // Клик по строке (но не по кнопке удаления) → загрузить досье в редактор
        root.querySelectorAll('.te-list-row').forEach(row => {
            row.addEventListener('click', async e => {
                if (e.target.closest('.te-list-del')) return; // обрабатывается отдельно ниже
                const name = row.dataset.name;
                const rec  = await _loadDossierRecord(name);
                if (!rec) { alert('Досье не найдено (могло быть удалено).'); return; }

                _applyLoadedRecord(rec);

                const wm = PluginAPI.WindowManager;
                wm?.close?.(LOAD_WIN_ID);
            });
        });

        // Удаление
        root.querySelectorAll('.te-list-del').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const name = btn.dataset.name;
                if (!confirm(`Удалить досье "${name}" безвозвратно?`)) return;

                await _deleteDossier(name);

                // Если удалили текущее открытое досье — снимаем привязку
                if (_currentDossierName === name) {
                    _currentDossierName = null;
                    _lastSavedSnapshot  = null;
                    _updateDossierNameIndicator();
                }

                _refreshLoadWindow(); // перерисовываем список
            });
        });
    }

    function _openLoadWindow() {
        const wm = PluginAPI.WindowManager;
        if (!wm) {
            console.error('[text-editor] WindowManager недоступен');
            return;
        }
        _refreshLoadWindow();
    }

    // =========================================================================
    //  Точка входа команды
    // =========================================================================

    async function execute(args, terminal) {
        const wm = PluginAPI.WindowManager;
        if (!wm) {
            terminal.printError('TEXT EDITOR: WindowManager не найден.');
            return;
        }

        _injectStyles();

        wm.open(EDITOR_WIN_ID, 'ТЕКСТОВЫЙ РЕДАКТОР', _editorHTML(), {
            width:  680,
            height: 520,
			maxWidth: 1600,
			maxHeight: 900,
            status: 'TEXT EDITOR v2.0  |  Ctrl+B/I · Tab=4sp · теги по README',
        });

        // Привязываем события после того, как WindowManager отрисует HTML
        setTimeout(_bindEditorEvents, 80);

        terminal.printSystem(
            'ТЕКСТОВЫЙ РЕДАКТОР: открыт. ' +
            'Теги соответствуют формату досье SCIPNET (см. README). ' +
            'SAVE 💾 сохраняет текст и картинки локально, LOAD 📂 — открывает список сохранённых. ' +
            'PREVIEW ▶ открывает окно живого предпросмотра через реальный StepRenderer.'
        );
    }

    // =========================================================================
    //  Регистрация: терминальная команда + приложение SCIPNET OS
    // =========================================================================

    PluginAPI.register({
        id:          PLUGIN_ID,
        name:        'Текстовый Редактор',
        command:     'textedit',
        description: 'Редактор досье с тегами SCIPNET, локальным сохранением и живым предпросмотром',
        version:     '2.1',
        execute,
    });

    if (typeof AppRegistry !== 'undefined') {
        AppRegistry.register({
            id:          'editor',
            name:        'Редактор',
            icon:        AppRegistry.ICONS.editor,
            description: 'Редактор досье с тегами',
            launch:      () => execute([], PluginAPI.terminal),
        });
    }

})();