// =============================================================================
//  text-editor-plugin.js — Текстовый редактор досье для SCIPNET
//
//  Установка:
//    plugin install <прямая ссылка на этот файл>
//
//  Команда:
//    textedit
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

        /* ── Drag-and-drop ── */
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

        /* ── Статусбар: счётчики ── */
        .te-img-stat  { color: var(--te-accent-dim); transition: color 0.2s; cursor: default; }
        .te-img-stat.has-images { color: var(--te-accent); }
        .te-save-ind  { color: var(--te-accent-dim); font-size: 10px; letter-spacing: 1px; transition: color 0.15s; }

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
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
    }

    // =========================================================================
    //  Персистентность — сохранение черновика и изображений в PluginStorage
    // =========================================================================

    /**
     * Загружает черновик и изображения из хранилища.
     * Вызывается в execute() ДО открытия окна, чтобы _editorHTML() уже
     * содержал актуальный текст.
     */
    async function _loadDraft() {
        try {
            const store   = _store();
            const draft   = await store.get('draft');
            if (draft !== null) _content = draft;

            // Восстанавливаем изображения
            const allKeys = await store.keys();
            const imgKeys = allKeys.filter(k => k.startsWith('img:'));
            for (const k of imgKeys) {
                const dataUrl = await store.get(k);
                if (dataUrl) _localImageMap[k.slice(4)] = dataUrl;
            }
        } catch (e) {
            console.warn('[text-editor] _loadDraft:', e);
        }
    }

    /**
     * Сохраняет текст и актуальный набор изображений в хранилище.
     * Синхронизирует: удаляет старые img: ключи которых больше нет в _localImageMap.
     */
    async function _saveDraft() {
        try {
            const store = _store();

            await store.set('draft', _content);

            // Получаем текущие сохранённые img: ключи
            const storedImgKeys = (await store.keys()).filter(k => k.startsWith('img:'));
            const currentNames  = new Set(Object.keys(_localImageMap));

            // Удаляем изображения которые были удалены из _localImageMap
            for (const k of storedImgKeys) {
                if (!currentNames.has(k.slice(4))) await store.remove(k);
            }

            // Сохраняем все текущие изображения
            for (const [name, dataUrl] of Object.entries(_localImageMap)) {
                await store.set('img:' + name, dataUrl);
            }

            _updateSaveIndicator(true);
        } catch (e) {
            console.warn('[text-editor] _saveDraft:', e);
        }
    }

    /** Планирует сохранение через 800мс после последнего изменения. */
    function _scheduleSave() {
        clearTimeout(_saveTimeout);
        _updateSaveIndicator(false);
        _saveTimeout = setTimeout(_saveDraft, 800);
    }

    /** Обновляет индикатор сохранения в статусбаре. */
    function _updateSaveIndicator(saved) {
        const el = document.getElementById('te-save-ind');
        if (!el) return;
        if (saved) {
            el.textContent = 'SAVED';
            el.style.color = '';
            el.title = 'Черновик сохранён в локальном хранилище';
        } else {
            el.textContent = '●';
            el.style.color = '#e0a020';
            el.title = 'Сохранение...';
        }
    }

    // =========================================================================
    //  Состояние плагина (сохраняется между открытиями окна)
    // =========================================================================

    let _content       = '';
    let _localImageMap = {}; // имя → data-URL, заполняется drag-and-drop
    let _debounce      = null;
    let _saveTimeout   = null;

    /** Хранилище этого плагина (ленивый доступ через PluginAPI.storage). */
    const _store = () => PluginAPI.storage(PLUGIN_ID);

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
    title="Перетащите изображения сюда — они попадут в превью и будут сохранены"
  >${savedVal}</textarea>
  <div id="te-missing-banner" class="te-missing-banner te-hidden">
    НЕ ХВАТАЕТ ФАЙЛОВ:&nbsp;<span id="te-missing-names"></span>
    <span style="margin-left:auto;opacity:0.6;font-size:9px;letter-spacing:1px">↑ ПЕРЕТАЩИТЕ ФАЙЛЫ НА ПОЛЕ РЕДАКТОРА</span>
  </div>
  <div class="te-statusbar">
    <span id="te-stat">0 симв.</span>
    <span id="te-img-stat"  class="te-img-stat"  title="Загруженные изображения (drag-and-drop)">0 изобр.</span>
    <span id="te-save-ind"  class="te-save-ind"  title="Статус автосохранения">SAVED</span>
    <div class="te-actions">
      <button class="te-act-btn" id="te-copy"    title="Скопировать исходный текст">COPY</button>
      <button class="te-act-btn" id="te-clear"   title="Очистить редактор">CLEAR</button>
      <button class="te-act-btn te-primary" id="te-preview-btn" title="Открыть окно предпросмотра">PREVIEW ▶</button>
    </div>
  </div>
  <div class="te-hint">
    <b>Ctrl+B</b> жирный · <b>Ctrl+I</b> курсив · <b>Tab</b> = 4 пробела ·
    Черновик сохраняется автоматически · Перетащи картинки на поле для превью.
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

    // =========================================================================
    //  Изображения — drag-and-drop + проверка недостающих файлов
    // =========================================================================

    /** Извлекает имена файлов из всех [IMAGE] тегов в тексте. */
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

    /** Сравнивает [IMAGE]-теги с _localImageMap и обновляет красный баннер. */
    function _checkMissingImages() {
        const banner = document.getElementById('te-missing-banner');
        const nameEl = document.getElementById('te-missing-names');
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

    /** Обновить содержимое предпросмотра, если окно открыто. */
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
            setTimeout(_bindEditorEvents, 50);
            return;
        }

        // _content уже загружен в execute() через _loadDraft()
        ta.value = _content;

        // ── Статистика + автосохранение ──────────────────────────────────────
        function updateStat() {
            _content = ta.value;
            const chars = ta.value.length;
            const words = ta.value.trim().length
                ? ta.value.trim().split(/\s+/).length
                : 0;
            const lines = ta.value.split('\n').length;
            if (stat) stat.textContent = `${chars} симв. / ${words} сл. / ${lines} стр.`;
            _checkMissingImages();
            _scheduleLiveUpdate();
            _scheduleSave();
        }

        ta.addEventListener('input', updateStat);
        updateStat();

        // ── Горячие клавиши ──────────────────────────────────────────────────
        ta.addEventListener('keydown', e => {
            const ctrl = e.ctrlKey || e.metaKey;
            if (!ctrl) return;
            if (e.key === 'b' || e.key === 'B') { e.preventDefault(); _insertWrap(ta, '**', '**'); }
            if (e.key === 'i' || e.key === 'I') { e.preventDefault(); _insertWrap(ta, '_', '_'); }
        });

        ta.addEventListener('keydown', e => {
            if (e.key === 'Tab') { e.preventDefault(); _insertWrap(ta, '    ', ''); }
        });

        // ── Кнопки тегов ────────────────────────────────────────────────────
        document.querySelectorAll('.te-btn[data-kind]').forEach(btn => {
            const kind = btn.dataset.kind;
            btn.addEventListener('click', () => {
                switch (kind) {
                    case 'inline':    _insertWrap(ta,    btn.dataset.open,  btn.dataset.close); break;
                    case 'prefixLine':_prefixLines(ta,   btn.dataset.value); break;
                    case 'line':      _insertLine(ta,    btn.dataset.value); break;
                    case 'template':  _insertTemplate(ta, btn.dataset.value); break;
                }
            });
        });

        // ── CLEAR ────────────────────────────────────────────────────────────
        document.getElementById('te-clear')?.addEventListener('click', () => {
            if (!ta.value || confirm('Очистить весь текст? Черновик в хранилище тоже будет удалён.')) {
                ta.value = '';
                _localImageMap = {};
                _store().clear().catch(() => {});
                updateStat();
                _updateImgStat();
                _updateSaveIndicator(true);
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

        // ── Drag-and-drop изображений ────────────────────────────────────────
        ta.addEventListener('dragover', e => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            ta.classList.add('te-drag-over');
        });
        ta.addEventListener('dragleave', e => {
            if (!ta.contains(e.relatedTarget)) ta.classList.remove('te-drag-over');
        });
        ta.addEventListener('drop', e => {
            ta.classList.remove('te-drag-over');
            const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
            if (!files.length) return;
            e.preventDefault();

            let loaded = 0;
            const imgStat = document.getElementById('te-img-stat');

            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = ev => {
                    _localImageMap[file.name] = ev.target.result;
                    loaded++;
                    if (loaded === files.length) {
                        if (imgStat) {
                            imgStat.textContent = `+${files.length} ✓`;
                            setTimeout(_updateImgStat, 1500);
                        }
                        _checkMissingImages();
                        _scheduleLiveUpdate();
                        _scheduleSave(); // сохраняем картинки в хранилище
                    }
                };
                reader.readAsDataURL(file);
            });
        });

        // Инициализация индикаторов
        _updateImgStat();
        _checkMissingImages();
        _updateSaveIndicator(true); // данные только что загружены из хранилища
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
            'PREVIEW ▶ открывает окно живого предпросмотра через реальный StepRenderer.'
        );
    }

    // =========================================================================
    //  Регистрация плагина
    // =========================================================================

    PluginAPI.register({
        id:          PLUGIN_ID,
        name:        'Текстовый Редактор',
        command:     'textedit',
        description: 'Редактор досье с тегами SCIPNET и живым предпросмотром',
        version:     '2.0',
        execute,
    });

})();