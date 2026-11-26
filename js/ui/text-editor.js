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

        /* ═══════════════════════════════════════════
           FEAT: БЛОЧНЫЙ РЕДАКТОР (прототип v1)
           Переключатель режимов + карточки-блоки
           ═══════════════════════════════════════════ */
        .te-modebar {
            display: flex;
            align-items: center;
            padding: 4px 7px 0;
            background: #061008;
            border-bottom: 1px solid var(--te-accent-dim);
            flex-shrink: 0;
        }
        .te-mode-btn {
            padding: 3px 16px;
            font-size: 11px;
            letter-spacing: 2px;
            background: transparent;
            color: var(--te-accent-dim);
            border: 1px solid var(--te-accent-dim);
            border-bottom: none;
            cursor: pointer;
            font-family: inherit;
            transition: color 0.1s, background 0.1s;
        }
        .te-mode-btn:hover  { color: #eafff5; }
        .te-mode-btn.active { background: var(--te-accent-bg2); color: #eafff5; border-color: var(--te-accent); font-weight: bold; }
        .te-mode-note { margin-left: 10px; font-size: 9px; letter-spacing: 1px; color: var(--te-accent-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        #te-code-pane { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        #te-blocks-pane.te-hidden, #te-code-pane.te-hidden { display: none !important; }

        .te-blocks-pane { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .te-blocks-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 6px; }
        .te-blocks-empty {
            padding: 26px 10px;
            text-align: center;
            color: var(--te-accent-dim);
            font-size: 11px;
            letter-spacing: 1.5px;
            line-height: 1.9;
        }

        /* ── Карточка-блок ── */
        .te-card {
            position: relative;
            margin-bottom: 9px;
            background: #050d08;
            border: 1px solid var(--te-accent-dim);
            transition: border-color 0.1s;
        }
        .te-card:hover       { border-color: color-mix(in srgb, var(--te-accent) 55%, transparent); }
        .te-card.te-selected { border-color: var(--te-accent); }
        .te-stripe {
            position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
            background: var(--te-accent-dim);
            pointer-events: none;
        }
        .te-card[data-type="title"]   .te-stripe { background: #10b981; }
        .te-card[data-type="image"]   .te-stripe { background: #38bdf8; }
        .te-card[data-type="raw"]     .te-stripe { background: #5c6a62; }
        .te-card[data-type="comment"] .te-stripe { background: #a16207; }
        .te-card-head { display: flex; align-items: center; gap: 7px; padding: 4px 7px 3px 11px; }
        .te-chip {
            font-size: 9px;
            letter-spacing: 1.5px;
            padding: 1px 7px;
            border: 1px solid;
            white-space: nowrap;
            flex-shrink: 0;
        }
        .te-chip-title   { color: #10b981; border-color: #10b981; background: rgba(16,185,129,.08); }
        .te-chip-image   { color: #38bdf8; border-color: #38bdf8; background: rgba(56,189,248,.08); }
        .te-chip-raw     { color: #8fa89b; border-color: #5c6a62; background: rgba(92,106,98,.15); }
        .te-chip-comment { color: #d4a017; border-color: #a16207; background: rgba(161,98,7,.10); }
        .te-chip-hr, .te-chip-spacer { color: var(--te-accent-dim); border-color: var(--te-accent-dim); }
        .te-card-hint {
            flex: 1; min-width: 0;
            font-size: 9px; letter-spacing: 0.5px;
            color: var(--te-accent-dim);
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .te-card-btns { display: flex; gap: 3px; flex-shrink: 0; }
        .te-cbtn {
            padding: 0 6px;
            min-width: 20px; height: 18px;
            font-size: 9px; line-height: 1;
            background: var(--te-accent-bg);
            border: 1px solid var(--te-accent-dim);
            color: var(--te-accent-dim);
            cursor: pointer;
            transition: all 0.1s;
        }
        .te-cbtn:hover { color: #eafff5; border-color: var(--te-accent); background: var(--te-accent-bg2); }
        .te-cbtn-del:hover { color: #ff6666; border-color: rgba(220,30,30,.6); background: rgba(220,30,30,.12); }
        .te-card-body { padding: 2px 10px 8px 11px; }

        .te-input {
            background: #020604;
            border: 1px solid var(--te-accent-dim);
            color: #cdf7e3;
            font-family: inherit;
            font-size: 12px;
            padding: 3px 7px;
            outline: none;
            min-width: 0;
            width: 100%;
            box-sizing: border-box;
        }
        .te-input:focus { border-color: var(--te-accent); }
        .te-dim-input { color: #7d9387; }
        .te-file-input.te-drag-over { border-color: var(--te-accent); background: #041a0c; }

        .te-img-grid {
            display: grid;
            grid-template-columns: auto 1fr auto 1fr;
            gap: 5px 8px;
            align-items: center;
        }
        .te-img-grid label { font-size: 9px; letter-spacing: 1.5px; color: var(--te-accent-dim); white-space: nowrap; }
        .te-img-grid label:nth-of-type(4) { grid-column: 1; } /* «ПОДПИСЬ» с новой строки, перед своим полем */
        .te-img-grid .te-inline-field { grid-column: 2 / span 3; }
        .te-thumb { max-width: 180px; max-height: 110px; margin-top: 6px; border: 1px solid var(--te-accent-dim); display: block; }

        /* ── ПОЗИЦИЯ изображения: значки вместо списка ── */
        .te-pos-group { display: flex; gap: 4px; flex-wrap: wrap; }
        .te-pos-btn {
            display: flex; flex-direction: column; align-items: center; gap: 2px;
            padding: 3px 7px 2px;
            background: #020604;
            border: 1px solid var(--te-accent-dim);
            color: var(--te-accent-dim);
            cursor: pointer;
            font-family: inherit;
            font-size: 8px;
            letter-spacing: 1px;
            line-height: 1;
            transition: color 0.1s, border-color 0.1s, background 0.1s;
            user-select: none;
        }
        .te-pos-btn svg { width: 24px; height: 15px; display: block; fill: currentColor; }
        .te-pos-btn:hover { color: #eafff5; border-color: var(--te-accent); background: var(--te-accent-bg); }
        .te-pos-btn.active {
            color: var(--te-accent);
            border-color: var(--te-accent);
            background: var(--te-accent-bg2);
            box-shadow: 0 0 6px color-mix(in srgb, var(--te-accent) 30%, transparent);
        }
        .te-pos-btn.te-pos-custom { border-style: dashed; }

        /* ── Drag-and-drop сортировка карточек ── */
        .te-card-head { user-select: none; }
        .te-drag-grip {
            font-size: 11px;
            line-height: 1;
            color: var(--te-accent-dim);
            cursor: grab;
            padding: 0 1px;
            flex-shrink: 0;
            opacity: 0.55;
            transition: opacity 0.1s, color 0.1s;
        }
        .te-card-head:hover .te-drag-grip { opacity: 1; }
        .te-drag-grip:active { cursor: grabbing; }
        .te-card.te-dragging { opacity: 0.4; border-style: dashed; }
        .te-card.te-drop-above::before,
        .te-card.te-drop-below::after {
            content: '';
            position: absolute; left: 0; right: 0;
            height: 2px;
            background: var(--te-accent);
            box-shadow: 0 0 7px var(--te-accent);
            z-index: 5;
        }
        .te-card.te-drop-above::before { top: -6px; }
        .te-card.te-drop-below::after  { bottom: -6px; }

        /* ── Цвета полос/чипов новых карточек ── */
        .te-card[data-type="h"]          .te-stripe { background: #34d399; }
        .te-card[data-type="p"]          .te-stripe { background: #22906a; }
        .te-card[data-type="danger"]     .te-stripe { background: #ef4444; }
        .te-card[data-type="list"]       .te-stripe { background: #2dd4bf; }
        .te-card[data-type="quote"]      .te-stripe { background: #c084fc; }
        .te-card[data-type="footnote"]   .te-stripe { background: #fbbf24; }
        .te-card[data-type="table6"]     .te-stripe { background: #60a5fa; }
        .te-card[data-type="colorcodes"] .te-stripe { background: #e879f9; }
        .te-card[data-type="sys"]        .te-stripe { background: #64748b; }

        .te-chip-h      { color: #34d399; border-color: #34d399; background: rgba(52,211,153,.08); }
        .te-chip-p      { color: #6ee7b7; border-color: #22906a; background: rgba(34,144,106,.10); }
        .te-chip-danger { color: #ef4444; border-color: #ef4444; background: rgba(239,68,68,.10); }
        .te-chip-list   { color: #2dd4bf; border-color: #2dd4bf; background: rgba(45,212,191,.08); }
        .te-chip-quote  { color: #c084fc; border-color: #c084fc; background: rgba(192,132,252,.08); }
        .te-chip-foot   { color: #fbbf24; border-color: #fbbf24; background: rgba(251,191,36,.08); }
        .te-chip-table  { color: #60a5fa; border-color: #60a5fa; background: rgba(96,165,250,.08); }
        .te-chip-color  { color: #e879f9; border-color: #e879f9; background: rgba(232,121,249,.08); }
        .te-chip-sys    { color: #94a3b8; border-color: #64748b; background: rgba(100,116,139,.12); }

        /* ── Сегментные кнопки (H1/H2/H3, CHAR/WORD, DISABLE/ENABLE …) ── */
        .te-seg-btn { flex-direction: row; font-size: 9px; padding: 3px 8px; }
        .te-seg-btn svg { display: none; }

        /* ── Флажок [CENTER] ── */
        .te-check-btn {
            padding: 2px 8px;
            font-size: 9px; letter-spacing: 1px;
            font-family: inherit;
            background: #020604;
            border: 1px solid var(--te-accent-dim);
            color: var(--te-accent-dim);
            cursor: pointer;
            transition: all 0.1s;
            user-select: none;
        }
        .te-check-btn.active { color: var(--te-accent); border-color: var(--te-accent); background: var(--te-accent-bg2); }

        /* ── Редактор списка (СПИСОК / FOOTNOTE) ── */
        .te-listbox { display: flex; flex-direction: column; gap: 4px; }
        .te-listrow { display: flex; gap: 5px; align-items: center; }
        .te-listrow .te-input { flex: 1; width: auto; }
        .te-marker {
            width: 24px;
            padding: 3px 0;
            text-align: center;
            font-size: 11px;
            background: #020604;
            border: 1px solid var(--te-accent-dim);
            color: var(--te-accent);
            cursor: pointer;
            font-family: inherit;
            user-select: none;
        }
        .te-addrow { margin-top: 6px; }

        /* ── Редактор TABLE6 ── */
        .te-table { display: flex; flex-direction: column; gap: 4px; }
        .te-trow { display: flex; align-items: center; gap: 0; }
        .te-trow .te-cell { flex: 1; min-width: 40px; }
        .te-tsep { padding: 0 5px; color: var(--te-accent-dim); font-size: 10px; user-select: none; flex-shrink: 0; }
        .te-trowbtns { display: flex; gap: 2px; margin-left: 6px; flex-shrink: 0; }

        /* ── COLORCODES ── */
        .te-colorrow { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
        .te-colorrow label { font-size: 9px; letter-spacing: 1.5px; color: var(--te-accent-dim); width: 74px; flex-shrink: 0; }
        .te-colorrow .te-input { flex: 1; width: auto; font-size: 11px; }
        .te-swatch {
            width: 16px; height: 16px;
            border: 1px solid var(--te-accent-dim);
            background: #000;
            flex-shrink: 0;
        }
        .te-extra-row label { width: 74px; }

        /* ── QUOTE: многострочное инлайн-поле ── */
        .te-inline-field.te-quote-field {
            border-left: 3px solid #c084fc;
            background: rgba(192,132,252,.05);
            padding-left: 8px;
            min-height: 44px;
        }
        .te-inline-edit { max-height: 240px; overflow: auto; }

        /* ── Компактные системные карточки ── */
        .te-sysline { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
        .te-sysline .te-input { width: 90px; flex-shrink: 0; }
        .te-sysline .te-inline-field { flex: 1; min-width: 140px; }
        .te-sysunit { font-size: 9px; letter-spacing: 1px; color: var(--te-accent-dim); white-space: nowrap; }

        /* ── Инлайн-поле: рендер разметки + click-to-edit ── */
        .te-inline-field {
            position: relative;
            min-height: 24px;
            padding: 3px 6px;
            font-size: 12px;
            line-height: 1.6;
            color: #cdf7e3;
            border: 1px dashed transparent;
            cursor: text;
            overflow-wrap: anywhere;
            white-space: pre-wrap;
        }
        .te-inline-field:hover { border-color: var(--te-accent-dim); }
        .te-inline-field:hover::after {
            content: '✎ КОД';
            position: absolute; right: 3px; top: 2px;
            font-size: 8px; letter-spacing: 1px;
            color: var(--te-accent-dim);
        }
        .te-inline-field:empty::before { content: '(пусто — клик, чтобы ввести)'; color: var(--te-accent-dim); }
        .te-inline-edit {
            width: 100%;
            background: #020604;
            border: 1px solid var(--te-accent);
            color: #cdf7e3;
            font-family: inherit;
            font-size: 12px;
            line-height: 1.6;
            padding: 3px 6px;
            outline: none;
            resize: none;
            overflow: hidden;
            box-sizing: border-box;
        }
        .te-censor { background: #0b0f12; color: transparent !important; border-radius: 2px; }
        .te-censor:hover { color: #9fb8ab !important; }

        /* ── Сырое поле «ИСХОДНИК» ── */
        .te-raw-edit {
            width: 100%;
            min-height: 54px;
            background: #020604;
            border: 1px solid rgba(92,106,98,.55);
            color: #9fb8ab;
            font-family: inherit;
            font-size: 11.5px;
            line-height: 1.55;
            padding: 5px 7px;
            outline: none;
            resize: vertical;
            box-sizing: border-box;
        }
        .te-raw-edit:focus { border-color: #8fa89b; }
        .te-hr-line { height: 1px; background: var(--te-accent-dim); }

        /* ── Контекстное меню (копия/вставка/теги) ──
           ВАЖНО: меню аппендится в document.body — вне .te-root,
           поэтому CSS-переменные --te-* тут недоступны, только литералы. */
        .te-ctx {
            position: fixed;
            z-index: 99999;
            min-width: 236px;
            padding: 4px;
            background: rgba(4, 16, 10, .97);
            border: 1px solid #1a5c40;
            box-shadow: 0 6px 22px rgba(0, 0, 0, .65), 0 0 0 1px rgba(16, 185, 129, .12);
            font-family: inherit;
            user-select: none;
        }
        .te-ctx-lbl {
            padding: 4px 8px 2px;
            font-size: 8px; letter-spacing: 1.5px;
            color: #4f7a63;
        }
        .te-ctx-sep { height: 1px; margin: 4px 2px; background: #14382a; }
        .te-ctx-btn {
            display: flex;
            align-items: center;
            gap: 7px;
            width: 100%;
            padding: 5px 8px;
            background: transparent;
            border: 0;
            color: #cdf7e3;
            font-family: inherit;
            font-size: 11px;
            letter-spacing: .5px;
            text-align: left;
            cursor: pointer;
        }
        .te-ctx-btn:hover { background: rgba(16, 185, 129, .14); color: #10b981; }
        .te-ctx-btn kbd {
            margin-left: auto;
            padding: 1px 4px;
            font-family: inherit;
            font-size: 8.5px;
            letter-spacing: 1px;
            color: #4f7a63;
            border: 1px solid #14382a;
        }
        .te-ctx-btn:hover kbd { color: #4f7a63; }
        /* строка тегов: компактные кнопки в 2 колонки */
        .te-ctx-tags { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 2px; }
        .te-ctx-tag {
            padding: 5px 6px;
            background: transparent;
            border: 1px solid #14382a;
            color: #9fb8ab;
            font-family: inherit;
            font-size: 10px;
            letter-spacing: 1px;
            text-align: center;
            cursor: pointer;
            white-space: nowrap;
        }
        .te-ctx-tag:hover { border-color: #10b981; color: #10b981; background: rgba(16, 185, 129, .10); }
        .te-ctx-tag.te-ctx-tag-b  { font-weight: 700; }
        .te-ctx-tag.te-ctx-tag-i  { font-style: italic; }
        .te-ctx-tag.te-ctx-tag-s  { text-decoration: line-through; }

        /* ── Палитра «+ ДОБАВИТЬ БЛОК» ── */
        .te-addbar { position: relative; padding: 6px 10px; border-top: 1px solid var(--te-accent-dim); background: #061008; flex-shrink: 0; }
        .te-palette {
            position: absolute;
            bottom: calc(100% + 4px);
            left: 10px;
            z-index: 60;
            min-width: 460px;
            background: #041008;
            border: 1px solid var(--te-accent);
            padding: 7px 9px;
            box-shadow: 0 4px 18px rgba(0,0,0,.6);
        }
        .te-palette.te-xhide { display: none; }
        .te-pal-row { display: flex; align-items: center; gap: 5px; margin-bottom: 4px; flex-wrap: wrap; }
        .te-pal-row:last-child { margin-bottom: 0; }
        .te-pal-group { font-size: 9px; letter-spacing: 2px; color: var(--te-accent-dim); min-width: 56px; flex-shrink: 0; }
        .te-pal-btn {
            padding: 2px 8px;
            font-size: 10.5px;
            font-family: inherit;
            background: var(--te-accent-bg);
            border: 1px solid var(--te-accent-dim);
            color: var(--te-accent);
            cursor: pointer;
            white-space: nowrap;
        }
        .te-pal-btn:hover { background: var(--te-accent-bg2); color: #eafff5; border-color: var(--te-accent); }
        .te-pal-btn[disabled] { opacity: 0.38; cursor: default; color: var(--te-accent-dim); }

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

    // FIX: счётчики retry привязки событий. Раньше _bindEditorEvents и
    // _bindLoadWindowEvents при отсутствии DOM пере-планировали себя каждые
    // 50 мс БЕСКОНЕЧНО (если окно закрыли до отрисовки — цикл жил вечно).
    let _editorBindRetries = 0;
    let _loadBindRetries   = 0;

    // ── FEAT: блочный режим «БЛОКИ | КОД» ──
    let _mode        = 'code';   // активный режим редактора
    let _blocks      = [];       // view-model документа (карточки-блоки)
    let _selectedIdx = null;     // индекс выбранной карточки (точка вставки «+ БЛОК»)
    let _dragIdx     = null;     // индекс карточки, перетаскиваемой сейчас (drag-and-drop)

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
    //  FEAT: БЛОЧНЫЙ РЕДАКТОР (прототип v1) — режим «БЛОКИ»
    //
    //  Источник правды — исходный текст досье. Блочный режим = view-model:
    //  _parseBlocks(текст) → карточки → правки → _serializeBlocks → текст.
    //
    //  Парсер зеркалит блочную грамматику StepRenderer (renderer.js):
    //  строки тримятся, блоки распознаются по startsWith / точным регэкспам
    //  renderer'а (RE_SPEED/TIMER/AT/MODE/LIST, legacy-заголовки [H1]-[H6],
    //  многострочные [QUOTE]/[FOOTNOTE]/[TABLE6] до закрывающего тега).
    //  Пустые строки рендерером игнорируются, но СОХРАНЯЮТСЯ в модели —
    //  поэтому serialize(parse(x)) === x байт-в-байт для нетронутых блоков.
    //
    //  Непонятные строки (markdown-заголовки #, [H4]-[H6], брошенные
    //  закрывающие теги) попадают в карточку «ИСХОДНИК» и при сборке
    //  возвращаются 1:1 — потеря разметки исключена. Незакрытый QUOTE /
    //  FOOTNOTE / TABLE6 тоже уходит в «ИСХОДНИК» целиком (безопаснее,
    //  чем тащить в карточку весь хвост документа).
    // =========================================================================

    /** Убирает токен [CENTER] из строки, возвращая чистый текст. */
    function _stripCenter(t) {
        return t.replace(/\s*\[CENTER\]\s*/g, ' ').trim();
    }

    /** Разбирает исходник на блоки (чистая функция, без DOM — тестируется в Node). */
    function _parseBlocks(src) {
        const blocks = [];
        const lines  = String(src).split('\n');
        let rawRun = null;
        const flushRaw = () => { if (rawRun) { blocks.push(rawRun); rawRun = null; } };
        const pushRawLine = (line) => {
            if (!rawRun) rawRun = { type: 'raw', lines: [], dirty: false };
            rawRun.lines.push(line);
        };

        // Индекс закрывающего тега для многострочных блоков; -1 = не закрыт.
        const findClose = (from, closeTag) => {
            for (let j = from + 1; j < lines.length; j++) {
                if (lines[j].trim().startsWith(closeTag)) return j;
            }
            return -1;
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const t    = line.trim();
            let m;

            if (!t)                        { flushRaw(); blocks.push({ type: 'blank',  lines: [line] }); continue; }
            if (t.startsWith('!COM'))      { flushRaw(); blocks.push({ type: 'comment', lines: [line], f: { text: t.replace(/^!COM\s?/, '') } }); continue; }
            if (t.startsWith('[TITLE]'))   { flushRaw(); blocks.push({ type: 'title',   lines: [line], f: { text: t.slice(7).trim() } }); continue; }
            if (t.startsWith('[IMAGE]'))   { flushRaw(); blocks.push({ type: 'image',   lines: [line], f: _parseImageFields(t) }); continue; }
            if (t === '---' || t === '***'){ flushRaw(); blocks.push({ type: 'hr',      lines: [line] }); continue; }
            if (t === '.')                 { flushRaw(); blocks.push({ type: 'spacer',  lines: [line] }); continue; }

            // ── Системные однострочные теги (точные регэкспы из renderer.js) ──
            if ((m = t.match(/^\[SCROLLSPEED=([0-9.]+)\]$/i))) {
                flushRaw(); blocks.push({ type: 'speed', lines: [line], f: { val: m[1] } }); continue;
            }
            if ((m = t.match(/^\[TIMER=([0-9.]+)\]$/i))) {
                flushRaw(); blocks.push({ type: 'timer', lines: [line], f: { val: m[1] } }); continue;
            }
            if ((m = t.match(/^\[AT=([0-9.]+)\]$/i))) {
                flushRaw(); blocks.push({ type: 'at', lines: [line], f: { val: m[1] } }); continue;
            }
            if ((m = t.match(/^\[(CHAR|WORD)MODE\]$/i))) {
                flushRaw(); blocks.push({ type: 'mode', lines: [line], f: { mode: m[1].toUpperCase() } }); continue;
            }
            if ((m = t.match(/^\[(DISABLE|ENABLE)=(TAGS|MD)\]$/i))) {
                flushRaw(); blocks.push({ type: 'toggle', lines: [line], f: { on: m[1].toUpperCase(), what: m[2].toUpperCase() } }); continue;
            }
            if ((m = t.match(/^\[SYNC=([0-9.]+)\s*;\s*([0-9.]+)\]([\s\S]*)\[\/SYNC\]$/i))) {
                flushRaw(); blocks.push({ type: 'sync', lines: [line], f: { start: m[1], end: m[2], text: m[3] } }); continue;
            }
            if (t.startsWith('[COLORCODES]')) {
                const f = { main: '', quotes: '', tables: '', extra: '' };
                const extras = [];
                t.slice(12).split(';').forEach(pair => {
                    const eq = pair.indexOf('=');
                    if (eq <= 0) { if (pair.trim()) extras.push(pair.trim()); return; }
                    const k = pair.slice(0, eq).trim();
                    const v = pair.slice(eq + 1).trim();
                    if      (k === 'Mainpage' && !f.main)   f.main   = v;
                    else if (k === 'Quotes'    && !f.quotes) f.quotes = v;
                    else if (k === 'Tables'    && !f.tables) f.tables = v;
                    else extras.push(k + '=' + v);
                });
                if (extras.length) f.extra = extras.join('; ');
                flushRaw(); blocks.push({ type: 'colorcodes', lines: [line], f }); continue;
            }

            // ── Многострочные блоки: QUOTE / FOOTNOTE / TABLE6 ─────────────
            //  Внутрь карточки идёт всё до закрывающего тега verbatim.
            //  Без закрывающего тега — вся конструкция в «ИСХОДНИК» (round-trip
            //  всё равно 1:1, а карточка не тащит за собой хвост документа).
            if (t.startsWith('[QUOTE]') || t.startsWith('[FOOTNOTE]') || t.startsWith('[TABLE6]')) {
                const closeTag = t.startsWith('[QUOTE]') ? '[/QUOTE]'
                               : t.startsWith('[FOOTNOTE]') ? '[/FOOTNOTE]' : '[/TABLE6]';
                const kind     = t.startsWith('[QUOTE]') ? 'quote'
                               : t.startsWith('[FOOTNOTE]') ? 'footnote' : 'table6';
                const end      = findClose(i, closeTag);
                if (end === -1) { pushRawLine(line); continue; }
                flushRaw();
                const inner = lines.slice(i + 1, end);
                const f = kind === 'quote'
                    ? { text: inner.join('\n') }
                    : kind === 'footnote'
                        ? { items: inner.slice() }
                        : { rows: inner
                              .map(l => l.trim())
                              .filter(l2 => l2)
                              .map(l2 => l2.split('||').map(c => c.trim())) };
                blocks.push({ type: kind, lines: lines.slice(i, end + 1), f, dirty: false });
                i = end;
                continue;
            }

            // ── Заголовки [H1]-[H3] (с опциональным [CENTER]) ──────────────
            if ((m = t.match(/^\[H([1-3])\]\s*(.*)$/i))) {
                flushRaw();
                blocks.push({
                    type: 'h', lines: [line], dirty: false,
                    f: { level: Number(m[1]), center: /\[CENTER\]/.test(m[2]), text: _stripCenter(m[2]) },
                });
                continue;
            }

            // ── Неподдерживаемые карточкой, но валидные для renderer'а строки:
            //  markdown-заголовки #..######, legacy [H4]-[H6], брошенные
            //  закрывающие теги. В «ИСХОДНИК» — честнее показать как есть.
            if (/^#{1,6}\s/.test(t) || /^\[H[4-6]\]/i.test(t) || /^\[\/\w+\]/.test(t)) {
                pushRawLine(line);
                continue;
            }

            // ── Список: подряд идущие строки -/* → одна карточка ──────────
            if (/^[-*]\s+/.test(t)) {
                flushRaw();
                const run = [];
                let j = i;
                while (j < lines.length && /^[-*]\s+/.test(lines[j].trim())) {
                    run.push(lines[j]);
                    j++;
                }
                blocks.push({
                    type: 'list', lines: run, dirty: false,
                    f: { items: run.map(l => {
                        const mm = l.trim().match(/^([-*])\s+(.*)$/);
                        return { m: mm[1], t: mm[2] };
                    }) },
                });
                i = j - 1;
                continue;
            }

            // ── DANGER (без инлайн-тегов — renderer выводит textContent) ──
            if (t.startsWith('[DANGER]')) {
                flushRaw();
                blocks.push({ type: 'danger', lines: [line], f: { text: t.slice(8).trim() } });
                continue;
            }

            // ── Обычный абзац (в т.ч. центрированный через [CENTER]) ──────
            flushRaw();
            blocks.push({
                type: 'p', lines: [line], dirty: false,
                f: { center: /\[CENTER\]/.test(t), text: _stripCenter(t) },
            });
        }
        flushRaw();
        return blocks;
    }

    /** [IMAGE] файл || подпись || позиция || масштаб → поля карточки. */
    function _parseImageFields(t) {
        const parts = t.slice(7).split('||').map(p => p.trim());
        return {
            file:    parts[0] || '',
            caption: parts[1] || '',
            pos:     parts[2] ? parts[2].toLowerCase() : 'right',
            scale:   parts[3] !== undefined ? parts[3] : '',
        };
    }

    /** Поля карточки IMAGE → каноническая строка тега. */
    function _imageLineFromFields(f) {
        const scale    = String(f.scale ?? '').trim();
        const hasScale = scale !== '' && isFinite(parseFloat(scale));
        const pos      = (f.pos || 'right').toLowerCase();
        const needPos  = pos !== 'right' || hasScale;
        const parts    = [(f.file || '').trim()];
        if (needPos) {
            parts.push(f.caption || '');
            parts.push(pos);
            if (hasScale) parts.push(scale);
        } else if ((f.caption || '').trim()) {
            parts.push(f.caption);
        }
        return '[IMAGE] ' + parts.join(' || ');
    }

    /** Собирает исходник обратно из блоков (чистая функция — тестируется в Node).
     *  Нетронутые блоки возвращают свои исходные строки verbatim;
     *  изменённые (dirty) — перегенерируются из полей. */
    function _serializeBlocks(blocks) {
        return blocks.map(b => {
            if (!b.dirty) return b.lines.join('\n');
            switch (b.type) {
                case 'title':     return '[TITLE] ' + (b.f.text || '');
                case 'image':     return _imageLineFromFields(b.f);
                case 'h':         return '[H' + (b.f.level || 2) + '] ' + (b.f.center ? '[CENTER] ' : '') + (b.f.text || '');
                case 'p':         return (b.f.center ? '[CENTER] ' : '') + (b.f.text || '');
                case 'danger':    return '[DANGER] ' + (b.f.text || '');
                case 'list':      return (b.f.items || []).map(it => (it.m || '-') + ' ' + (it.t || '')).join('\n');
                case 'quote':     return '[QUOTE]\n' + (b.f.text || '') + '\n[/QUOTE]';
                case 'footnote':  return '[FOOTNOTE]\n' + (b.f.items || []).join('\n') + '\n[/FOOTNOTE]';
                case 'table6':    return '[TABLE6]\n' + (b.f.rows || []).map(r => r.join(' || ')).join('\n') + '\n[/TABLE6]';
                case 'colorcodes': {
                    const f     = b.f;
                    const pairs = [];
                    if (f.main)   pairs.push('Mainpage=' + f.main);
                    if (f.quotes) pairs.push('Quotes='   + f.quotes);
                    if (f.tables) pairs.push('Tables='   + f.tables);
                    if (f.extra && f.extra.trim()) pairs.push(f.extra.trim());
                    return '[COLORCODES]' + (pairs.length ? ' ' + pairs.join('; ') : '');
                }
                case 'speed':     return '[SCROLLSPEED=' + (b.f.val || '38') + ']';
                case 'timer':     return '[TIMER='       + (b.f.val || '1')  + ']';
                case 'at':        return '[AT='          + (b.f.val || '1')  + ']';
                case 'mode':      return b.f.mode === 'CHAR' ? '[CHARMODE]' : '[WORDMODE]';
                case 'toggle':    return '[' + (b.f.on || 'DISABLE') + '=' + (b.f.what || 'TAGS') + ']';
                case 'sync':      return '[SYNC=' + (b.f.start || '0') + ';' + (b.f.end || '0') + ']' + (b.f.text || '') + '[/SYNC]';
                case 'comment':   return '!COM' + (b.f.text ? (b.f.text.startsWith(' ') ? '' : ' ') + b.f.text : '');
                case 'hr':        return '---';
                case 'spacer':    return '.';
                default:          return b.lines.join('\n'); // «ИСХОДНИК»: lines — источник правды
            }
        }).join('\n');
    }

    /**
     * Облегчённый СТАТИЧЕСКИЙ рендер инлайн-разметки для полей карточек.
     * Только для отображения: сериализация всегда идёт из сырого текста,
     * поэтому даже «кривой» рендер не искажает исходник.
     */
    function _renderInlineStatic(s) {
        let h = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const nest = (re, fn) => { let prev; do { prev = h; h = h.replace(re, fn); } while (h !== prev); };
        nest(/\[COLOR=([^\]]+)\]([\s\S]*?)\[\/COLOR\]/gi,     (_, c, x) => `<span style="color:${c}">${x}</span>`);
        nest(/\[BGCOLOR=([^\]]+)\]([\s\S]*?)\[\/BGCOLOR\]/gi, (_, c, x) => `<span style="background:${c}">&nbsp;${x}&nbsp;</span>`);
        nest(/\[SIZE=(\d+)\]([\s\S]*?)\[\/SIZE\]/gi,          (_, n, x) => `<span style="font-size:${n}px">${x}</span>`);
        nest(/\*\*([^*]+)\*\*/g, (_, x) => `<b>${x}</b>`);
        nest(/(^|[\s(«"])_([^_\n]+)_(?=[\s)»".,!?;:]|$)/g, (_, a, x) => `${a}<i>${x}</i>`);
        nest(/~~([^~]+)~~/g,     (_, x) => `<s>${x}</s>`);
        nest(/==([^=]+)==/g,     (_, x) => `<span class="te-censor">${x}</span>`);
        nest(/`([^`]+)`/g,       (_, x) => `<code>${x}</code>`);
        return h;
    }

    // ── Палитра «+ ДОБАВИТЬ БЛОК» (on=false → карточка в следующей итерации) ──
    const _PALETTE_GROUPS = [
        { group: 'ТЕКСТ',   items: [
            { kind: 'title',    on: true, label: 'TITLE',        hint: 'Название досье (поиск GET)' },
            { kind: 'h',        on: true, label: 'H1–H3',        hint: 'Заголовок раздела; флажок [CENTER] — по центру' },
            { kind: 'p',        on: true, label: 'АБЗАЦ',        hint: 'Обычный текст; поддерживает инлайн-теги' },
            { kind: 'p-c',      on: true, label: 'АБЗАЦ · ЦЕНТР', hint: 'Абзац с [CENTER] — по центру' },
            { kind: 'danger',   on: true, label: 'DANGER',       hint: '[DANGER] предупреждение (без инлайн-тегов)' },
            { kind: 'list',     on: true, label: 'СПИСОК -/*',   hint: 'Подряд идущие пункты - / *' },
        ]},
        { group: 'МЕДИА',   items: [
            { kind: 'image',    on: true, label: 'IMAGE',   hint: 'файл || подпись || позиция || масштаб' },
            { kind: 'table6',   on: true, label: 'TABLE6',  hint: 'Таблица; строки — через ||' },
        ]},
        { group: 'ЦИТАТЫ',  items: [
            { kind: 'quote',    on: true, label: 'QUOTE',     hint: '[QUOTE]…[/QUOTE] блок-цитата' },
            { kind: 'footnote', on: true, label: 'FOOTNOTE',  hint: '[FOOTNOTE]…[/FOOTNOTE] сноска-список' },
        ]},
        { group: 'СИСТЕМА', items: [
            { kind: 'colorcodes', on: true, label: 'COLORCODES',  hint: 'Цветовая тема: Mainpage · Quotes · Tables' },
            { kind: 'speed',      on: true, label: 'SCROLLSPEED', hint: '[SCROLLSPEED=мс] скорость печати (default 38)' },
            { kind: 'timer',      on: true, label: 'TIMER',       hint: '[TIMER=с] пауза рендера' },
            { kind: 'at',         on: true, label: 'AT',          hint: '[AT=с] ждать аудио-отметку ECHO' },
            { kind: 'sync',       on: true, label: 'SYNC',        hint: '[SYNC=нач;кон]фраза[/SYNC]' },
            { kind: 'mode',       on: true, label: 'CHAR/WORDMODE', hint: 'Посимвольная / пословная анимация' },
            { kind: 'toggle',     on: true, label: 'DISABLE/ENABLE', hint: '[DISABLE=TAGS|MD] … [ENABLE=…]' },
            { kind: 'raw',        on: true, label: 'ИСХОДНИК',    hint: 'Произвольные строки — правятся как есть' },
        ]},
    ];

    /** Шаблон новой карточки по типу. */
    function _newBlock(kind) {
        switch (kind) {
            case 'title':
                return { type: 'title', lines: ['[TITLE] НОВОЕ ДОСЬЕ'], f: { text: 'НОВОЕ ДОСЬЕ' }, dirty: true };
            case 'h':
                return _newLineBlock('h', '[H2] Новый раздел', t => {
                    const m = t.match(/^\[H([1-3])\]\s*(.*)$/i);
                    return { level: Number(m[1]), center: false, text: m[2] };
                });
            case 'p':
            case 'p-c':
                return _newLineBlock('p', kind === 'p-c' ? '[CENTER] Текст по центру' : 'Текст абзаца', t => ({
                    center: /\[CENTER\]/.test(t), text: _stripCenter(t),
                }));
            case 'danger':
                return _newLineBlock('danger', '[DANGER] ПРЕДУПРЕЖДЕНИЕ', t => ({ text: t.slice(8).trim() }));
            case 'list': {
                const def = ['- Первый пункт', '- Второй пункт', '- Третий пункт'].join('\n');
                return { type: 'list', lines: def.split('\n'), dirty: true,
                         f: { items: [{ m: '-', t: 'Первый пункт' }, { m: '-', t: 'Второй пункт' }, { m: '-', t: 'Третий пункт' }] } };
            }
            case 'image': {
                const def = '[IMAGE] имя_файла.jpg || Подпись || right';
                return { type: 'image', lines: [def], f: _parseImageFields(def), dirty: true };
            }
            case 'table6': {
                const def = '[TABLE6]\nХарактеристика || Описание\nИмя || Тест\n[/TABLE6]';
                return { type: 'table6', lines: def.split('\n'), dirty: true,
                         f: { rows: [['Характеристика', 'Описание'], ['Имя', 'Тест']] } };
            }
            case 'quote': {
                const def = '[QUOTE]\n«Текст цитаты.»\n— Источник\n[/QUOTE]';
                return { type: 'quote', lines: def.split('\n'), dirty: true,
                         f: { text: '«Текст цитаты.»\n— Источник' } };
            }
            case 'footnote': {
                const def = '[FOOTNOTE]\n- Примечание 1\n- Примечание 2\n[/FOOTNOTE]';
                return { type: 'footnote', lines: def.split('\n'), dirty: true,
                         f: { items: ['- Примечание 1', '- Примечание 2'] } };
            }
            case 'colorcodes': {
                const def = '[COLORCODES] Mainpage=#10b981; Quotes=#10b981; Tables=#10b981';
                return { type: 'colorcodes', lines: [def], dirty: true,
                         f: { main: '#10b981', quotes: '#10b981', tables: '#10b981', extra: '' } };
            }
            case 'speed':   return _newLineBlock('speed', '[SCROLLSPEED=38]', t => ({ val: t.match(/^\[SCROLLSPEED=([0-9.]+)\]$/i)[1] }));
            case 'timer':   return _newLineBlock('timer', '[TIMER=1]',        t => ({ val: t.match(/^\[TIMER=([0-9.]+)\]$/i)[1] }));
            case 'at':      return _newLineBlock('at', '[AT=1.5]',           t => ({ val: t.match(/^\[AT=([0-9.]+)\]$/i)[1] }));
            case 'sync':    return _newLineBlock('sync', '[SYNC=1.0;2.0]фраза[/SYNC]', t => {
                const m = t.match(/^\[SYNC=([0-9.]+)\s*;\s*([0-9.]+)\]([\s\S]*)\[\/SYNC\]$/i);
                return { start: m[1], end: m[2], text: m[3] };
            });
            case 'mode':    return { type: 'mode', lines: ['[WORDMODE]'], f: { mode: 'WORD' }, dirty: true };
            case 'toggle':  return { type: 'toggle', lines: ['[DISABLE=TAGS]'], f: { on: 'DISABLE', what: 'TAGS' }, dirty: true };
            case 'raw':
            default:
                return { type: 'raw', lines: [''], dirty: true };
        }
    }

    /** Однострочный шаблон → блок с разбором полей (dirty сразу). */
    function _newLineBlock(type, line, parseF) {
        return { type, lines: [line], f: parseF(line), dirty: true };
    }

    /** Шапка карточки: полоса-тип, чип, подсказка, кнопки ▲ ▼ ✕. */
    function _cardHeadHTML(chipClass, chip, hint) {
        return `
          <div class="te-stripe"></div>
          <div class="te-card-head">
            <span class="te-drag-grip" title="Схватить и перетащить — изменить порядок">≡</span>
            <span class="te-chip ${chipClass}">${chip}</span>
            <span class="te-card-hint">${hint}</span>
            <span class="te-card-btns">
              <button class="te-cbtn" data-act="up"   title="Передвинуть выше">▲</button>
              <button class="te-cbtn" data-act="down" title="Передвинуть ниже">▼</button>
              <button class="te-cbtn te-cbtn-del" data-act="del" title="Удалить блок">✕</button>
            </span>
          </div>`;
    }

    // ── Значки ПОЗИЦИИ изображения ([IMAGE] → класс left/right/full-mode) ──
    //  SVG рисуется currentColor'ом — реагирует на hover/active без дублирования.
    const _POS_ICONS = {
        left:  '<svg viewBox="0 0 26 16" aria-hidden="true">' +
               '<rect x="0"  y="0" width="10" height="9"/>' +
               '<rect x="12" y="1" width="14" height="2"/>' +
               '<rect x="12" y="5" width="14" height="2"/>' +
               '<rect x="0"  y="12" width="26" height="2"/></svg>',
        right: '<svg viewBox="0 0 26 16" aria-hidden="true">' +
               '<rect x="16" y="0" width="10" height="9"/>' +
               '<rect x="0"  y="1" width="14" height="2"/>' +
               '<rect x="0"  y="5" width="14" height="2"/>' +
               '<rect x="0"  y="12" width="26" height="2"/></svg>',
        full:  '<svg viewBox="0 0 26 16" aria-hidden="true">' +
               '<rect x="0" y="0" width="26" height="7"/>' +
               '<rect x="0" y="10" width="26" height="2"/>' +
               '<rect x="0" y="13.5" width="26" height="2"/></svg>',
    };
    const _POS_TITLES = {
        left:  'left — слева, текст обтекает справа',
        right: 'right — справа, текст обтекает слева (по умолчанию)',
        full:  'full — во всю ширину, по центру',
    };

    /** Группа значков позиции IMAGE. Нестандартное значение → пунктирная кнопка «?», данные не теряются. */
    function _posGroupHTML(pos) {
        const known = ['left', 'right', 'full'];
        const btn = p => `
          <button type="button" class="te-pos-btn${p === pos ? ' active' : ''}${known.includes(p) ? '' : ' te-pos-custom'}"
                  data-pos="${_escapeForAttr(p)}" title="${_escapeForAttr(_POS_TITLES[p] || 'нестандартное значение «' + p + '» — renderer не знает такой класс')}">
            ${_POS_ICONS[p] || '<svg viewBox="0 0 26 16" aria-hidden="true">' +
                '<rect x="4" y="1" width="18" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/>' +
                '<text x="13" y="12.5" text-anchor="middle" font-size="11" font-family="inherit">?</text></svg>'}
            <span>${_escapeForAttr(p)}</span>
          </button>`;
        return `<div class="te-pos-group" data-field="pos">${known.map(btn).join('')}${known.includes(pos) ? '' : btn(pos)}</div>`;
    }

    /** Рисует панель карточек из _blocks (с сохранением прокрутки). */
    function _renderBlocksPane() {
        const list = document.getElementById('te-blocks-list');
        if (!list) return;
        const scrollPos = list.scrollTop;

        const cards = _blocks.map((b, i) => ({ b, i })).filter(x => x.b.type !== 'blank');

        const html = cards.length
            ? cards.map(({ b, i }) => {
                const sel = (i === _selectedIdx) ? ' te-selected' : '';
                switch (b.type) {
                    case 'title':
                        return `
<div class="te-card te-card-title${sel}" data-idx="${i}" data-type="title">
  ${_cardHeadHTML('te-chip-title', 'TITLE', 'название досье (поиск через GET)')}
  <div class="te-card-body">
    <div class="te-inline-field" data-field="text" title="Клик — правка исходной строки; Esc — отмена">${_renderInlineStatic(b.f.text)}</div>
  </div>
</div>`;

                    case 'image': {
                        const thumb = _localImageMap[b.f.file];
                        return `
<div class="te-card te-card-image${sel}" data-idx="${i}" data-type="image">
  ${_cardHeadHTML('te-chip-image', 'IMAGE', 'файл || подпись || позиция || масштаб')}
  <div class="te-card-body">
    <div class="te-img-grid">
      <label>ФАЙЛ</label>
      <input class="te-input te-file-input" data-field="file" value="${_escapeForAttr(b.f.file)}" title="Имя файла; можно перетащить картинку прямо сюда">
      <label>МАСШТАБ</label>
      <input class="te-input" data-field="scale" type="number" step="0.1" min="0" value="${_escapeForAttr(b.f.scale)}" placeholder="1">
      <label>ПОЗИЦИЯ</label>
      ${_posGroupHTML(b.f.pos)}
      <label>ПОДПИСЬ</label>
      <div class="te-inline-field" data-field="caption" title="Клик — правка; Esc — отмена">${_renderInlineStatic(b.f.caption)}</div>
    </div>
    ${thumb ? `<img class="te-thumb" src="${_escapeForAttr(thumb)}" alt="">` : ''}
  </div>
</div>`;
                    }

                    case 'h': {
                        const lvl = b.f.level || 2;
                        const seg = [1, 2, 3].map(n =>
                            `<button type="button" class="te-pos-btn te-seg-btn${n === lvl ? ' active' : ''}" data-level="${n}" title="Уровень заголовка H${n}">H${n}</button>`
                        ).join('');
                        return `
<div class="te-card te-card-h${sel}" data-idx="${i}" data-type="h">
  ${_cardHeadHTML('te-chip-h', 'H' + lvl, 'заголовок раздела · флажок [CENTER] — по центру')}
  <div class="te-card-body">
    <div class="te-sysline">
      <span class="te-pos-group">${seg}</span>
      <button type="button" class="te-check-btn${b.f.center ? ' active' : ''}" data-field="center" title="[CENTER] — выравнивание по центру">${b.f.center ? '▣' : '▢'} ЦЕНТР</button>
      <div class="te-inline-field" data-field="text" title="Клик — правка исходной строки; Esc — отмена">${_renderInlineStatic(b.f.text)}</div>
    </div>
  </div>
</div>`;
                    }

                    case 'p':
                        return `
<div class="te-card te-card-p${sel}" data-idx="${i}" data-type="p">
  ${_cardHeadHTML('te-chip-p', b.f.center ? 'ЦЕНТР' : 'ТЕКСТ', 'абзац · инлайн-теги поддерживаются')}
  <div class="te-card-body">
    <div class="te-sysline">
      <button type="button" class="te-check-btn${b.f.center ? ' active' : ''}" data-field="center" title="[CENTER] — выравнивание по центру">${b.f.center ? '▣' : '▢'} ЦЕНТР</button>
      <div class="te-inline-field" data-field="text" title="Клик — правка исходной строки; Esc — отмена">${_renderInlineStatic(b.f.text)}</div>
    </div>
  </div>
</div>`;

                    case 'danger':
                        return `
<div class="te-card te-card-danger${sel}" data-idx="${i}" data-type="danger">
  ${_cardHeadHTML('te-chip-danger', 'DANGER', 'предупреждение · без инлайн-тегов (renderer: textContent)')}
  <div class="te-card-body">
    <input class="te-input" data-field="text" value="${_escapeForAttr(b.f.text)}">
  </div>
</div>`;

                    case 'list': {
                        const rows = (b.f.items || []).map((it, r) => `
    <div class="te-listrow" data-row="${r}">
      <button type="button" class="te-marker" title="Маркер пункта: - или *">${_escapeForAttr(it.m)}</button>
      <input class="te-input" value="${_escapeForAttr(it.t)}">
      <span class="te-card-btns">
        <button class="te-cbtn" data-rowact="up"   title="Пункт выше">▲</button>
        <button class="te-cbtn" data-rowact="down" title="Пункт ниже">▼</button>
        <button class="te-cbtn te-cbtn-del" data-rowact="del" title="Удалить пункт">✕</button>
      </span>
    </div>`).join('');
                        return `
<div class="te-card te-card-list${sel}" data-idx="${i}" data-type="list">
  ${_cardHeadHTML('te-chip-list', 'СПИСОК', `${(b.f.items || []).length} пкт. · маркеры - / *`)}
  <div class="te-card-body">
    <div class="te-listbox">${rows}</div>
    <button class="te-btn te-addrow" data-rowact="add" title="Добавить пункт">+ ПУНКТ</button>
  </div>
</div>`;
                    }

                    case 'quote':
                        return `
<div class="te-card te-card-quote${sel}" data-idx="${i}" data-type="quote">
  ${_cardHeadHTML('te-chip-quote', 'QUOTE', 'блок-цитата · инлайн-теги работают · последняя строка — источник')}
  <div class="te-card-body">
    <div class="te-inline-field te-quote-field" data-field="text" data-multiline="1" title="Клик — правка (многострочно); Esc — отмена; Ctrl+Enter — сохранить">${_renderInlineStatic(b.f.text)}</div>
  </div>
</div>`;

                    case 'footnote': {
                        const rows = (b.f.items || []).map((it, r) => `
    <div class="te-listrow" data-row="${r}">
      <input class="te-input" value="${_escapeForAttr(it)}">
      <span class="te-card-btns">
        <button class="te-cbtn" data-rowact="up"   title="Строка выше">▲</button>
        <button class="te-cbtn" data-rowact="down" title="Строка ниже">▼</button>
        <button class="te-cbtn te-cbtn-del" data-rowact="del" title="Удалить строку">✕</button>
      </span>
    </div>`).join('');
                        return `
<div class="te-card te-card-footnote${sel}" data-idx="${i}" data-type="footnote">
  ${_cardHeadHTML('te-chip-foot', 'FOOTNOTE', `${(b.f.items || []).length} стр. · строки «- пункт» выводятся списком`)}
  <div class="te-card-body">
    <div class="te-listbox">${rows}</div>
    <button class="te-btn te-addrow" data-rowact="add" title="Добавить строку">+ ПУНКТ</button>
  </div>
</div>`;
                    }

                    case 'table6': {
                        const rows = (b.f.rows || []).map((row, r) => `
    <div class="te-trow" data-row="${r}">
      ${row.map((c, k) => `${k ? '<span class="te-tsep">||</span>' : ''}<input class="te-input te-cell" data-cell="${k}" value="${_escapeForAttr(c)}">`).join('')}
      <span class="te-trowbtns">
        <button class="te-cbtn" data-rowact="celladd" title="Добавить ячейку">+</button>
        <button class="te-cbtn" data-rowact="up"   title="Строка выше">▲</button>
        <button class="te-cbtn" data-rowact="down" title="Строка ниже">▼</button>
        <button class="te-cbtn te-cbtn-del" data-rowact="del" title="Удалить строку">✕</button>
      </span>
    </div>`).join('');
                        const cols = Math.max(1, ...(b.f.rows || []).map(r2 => r2.length));
                        return `
<div class="te-card te-card-table6${sel}" data-idx="${i}" data-type="table6">
  ${_cardHeadHTML('te-chip-table', 'TABLE6', `${(b.f.rows || []).length} строк × до ${cols} кол. · ячейки через ||`)}
  <div class="te-card-body">
    <div class="te-table">${rows}</div>
    <button class="te-btn te-addrow" data-rowact="rowadd" title="Добавить строку (кол-во ячеек — как в последней)">+ СТРОКА</button>
  </div>
</div>`;
                    }

                    case 'colorcodes': {
                        const sw  = v => `<span class="te-swatch" style="background:${_safeCssColor(v)}"></span>`;
                        const row = (lbl, key) => `
    <div class="te-colorrow">
      <label>${lbl}</label>
      <input class="te-input" data-color="${key}" value="${_escapeForAttr(b.f[key])}" placeholder="#10b981">
      ${sw(b.f[key])}
    </div>`;
                        return `
<div class="te-card te-card-colorcodes${sel}" data-idx="${i}" data-type="colorcodes">
  ${_cardHeadHTML('te-chip-color', 'ТЕМА', 'COLORCODES · цветовая схема документа (первая строка файла)')}
  <div class="te-card-body">
    ${row('MAINPAGE', 'main')}${row('QUOTES', 'quotes')}${row('TABLES', 'tables')}
    ${b.f.extra ? `<div class="te-colorrow te-extra-row"><label>ДРУГОЕ</label><input class="te-input" data-color="extra" value="${_escapeForAttr(b.f.extra)}"></div>` : ''}
  </div>
</div>`;
                    }

                    case 'speed':
                    case 'timer':
                    case 'at': {
                        const meta = {
                            speed: { chip: 'SCROLLSPEED', unit: 'мс',  hint: 'скорость посимвольной печати (default 38)' },
                            timer: { chip: 'TIMER',       unit: 'сек', hint: 'пауза рендера перед следующим блоком' },
                            at:    { chip: 'AT',          unit: 'сек (аудио)', hint: 'ждать отметку записи ECHO' },
                        }[b.type];
                        return `
<div class="te-card te-card-sys${sel}" data-idx="${i}" data-type="sys" data-syskind="${b.type}">
  ${_cardHeadHTML('te-chip-sys', meta.chip, meta.hint)}
  <div class="te-card-body">
    <div class="te-sysline">
      <input class="te-input" data-field="val" type="number" step="0.1" min="0" value="${_escapeForAttr(b.f.val)}">
      <span class="te-sysunit">${meta.unit}</span>
    </div>
  </div>
</div>`;
                    }

                    case 'mode': {
                        const seg = [['CHAR', 'ПОСИМВОЛЬНО'], ['WORD', 'ПОСЛОВНО (default)']].map(([v, l]) =>
                            `<button type="button" class="te-pos-btn te-seg-btn${b.f.mode === v ? ' active' : ''}" data-modeval="${v}" title="${l}">${l}</button>`
                        ).join('');
                        return `
<div class="te-card te-card-sys${sel}" data-idx="${i}" data-type="sys" data-syskind="mode">
  ${_cardHeadHTML('te-chip-sys', b.f.mode === 'CHAR' ? 'CHARMODE' : 'WORDMODE', 'режим анимации печати')}
  <div class="te-card-body"><div class="te-sysline"><span class="te-pos-group">${seg}</span></div></div>
</div>`;
                    }

                    case 'toggle': {
                        const onSeg   = ['DISABLE', 'ENABLE'].map(v =>
                            `<button type="button" class="te-pos-btn te-seg-btn${b.f.on === v ? ' active' : ''}" data-onval="${v}">${v}</button>`).join('');
                        const whatSeg = ['TAGS', 'MD'].map(v =>
                            `<button type="button" class="te-pos-btn te-seg-btn${b.f.what === v ? ' active' : ''}" data-whatval="${v}">${v}</button>`).join('');
                        return `
<div class="te-card te-card-sys${sel}" data-idx="${i}" data-type="sys" data-syskind="toggle">
  ${_cardHeadHTML('te-chip-sys', `${b.f.on}=${b.f.what}`, 'выключить/включить кастомные теги или Markdown')}
  <div class="te-card-body">
    <div class="te-sysline">
      <span class="te-pos-group">${onSeg}</span>
      <span class="te-sysunit">для</span>
      <span class="te-pos-group">${whatSeg}</span>
    </div>
  </div>
</div>`;
                    }

                    case 'sync':
                        return `
<div class="te-card te-card-sys${sel}" data-idx="${i}" data-type="sys" data-syskind="sync">
  ${_cardHeadHTML('te-chip-sys', 'SYNC', '[SYNC=нач;кон]фраза[/SYNC] — слова растягиваются по аудио-отрезку')}
  <div class="te-card-body">
    <div class="te-sysline">
      <span class="te-sysunit">НАЧАЛО</span>
      <input class="te-input" data-field="start" type="number" step="0.1" min="0" value="${_escapeForAttr(b.f.start)}">
      <span class="te-sysunit">КОНЕЦ</span>
      <input class="te-input" data-field="end" type="number" step="0.1" min="0" value="${_escapeForAttr(b.f.end)}">
      <span class="te-sysunit">ФРАЗА</span>
      <input class="te-input" data-field="text" value="${_escapeForAttr(b.f.text)}" style="flex:1;min-width:120px;width:auto">
    </div>
  </div>
</div>`;

                    case 'hr':
                        return `
<div class="te-card te-card-hr${sel}" data-idx="${i}" data-type="hr">
  ${_cardHeadHTML('te-chip-hr', '─── HR', 'горизонтальная линия')}
  <div class="te-card-body"><div class="te-hr-line"></div></div>
</div>`;

                    case 'spacer':
                        return `
<div class="te-card te-card-spacer${sel}" data-idx="${i}" data-type="spacer">
  ${_cardHeadHTML('te-chip-spacer', '. SPACER', 'пустая строка-отступ')}
</div>`;

                    case 'comment':
                        return `
<div class="te-card te-card-comment${sel}" data-idx="${i}" data-type="comment">
  ${_cardHeadHTML('te-chip-comment', '!COM', 'комментарий — игроку не выводится')}
  <div class="te-card-body">
    <input class="te-input te-dim-input" data-field="text" value="${_escapeForAttr(b.f.text)}">
  </div>
</div>`;

                    default: {
                        const n = b.lines.length;
                        return `
<div class="te-card te-card-raw${sel}" data-idx="${i}" data-type="raw">
  ${_cardHeadHTML('te-chip-raw', 'ИСХОДНИК', `произвольная разметка · ${n} стр. · вернётся 1:1`)}
  <div class="te-card-body">
    <textarea class="te-raw-edit" data-field="raw" spellcheck="false">${_escapeForAttr(b.lines.join('\n'))}</textarea>
  </div>
</div>`;
                    }
                }
            }).join('')
            : `<div class="te-blocks-empty">ДОКУМЕНТ ПУСТ<br><br>Нажмите «+ ДОБАВИТЬ БЛОК» ниже,<br>или переключитесь в режим КОД.</div>`;

        list.innerHTML = html;
        list.scrollTop = scrollPos;
        _bindBlocksEvents();
    }

    /** Кнопки ▲▼✕/+ внутри строк карточек (data-rowact) — общая привязка. */
    function _bindRowActions(card, onAct) {
        card.querySelectorAll('[data-rowact]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                onAct(btn);
            });
        });
    }

    /** События карточек (после каждой перерисовки панели). */
    function _bindBlocksEvents() {
        const list = document.getElementById('te-blocks-list');
        if (!list) return;

        // Выбор карточки → точка вставки для «+ БЛОК»
        list.querySelectorAll('.te-card').forEach(card => {
            card.addEventListener('click', e => {
                if (e.target.closest('.te-cbtn')) return;
                _selectedIdx = Number(card.dataset.idx);
                list.querySelectorAll('.te-card.te-selected').forEach(c => c.classList.remove('te-selected'));
                card.classList.add('te-selected');
            });
        });

        // ═══ Drag-and-drop: произвольный порядок карточек (в дополнение к ▲ ▼) ═══
        //  Перетаскивание разрешается только из шапки (ручка ≡ или свободное место
        //  шапки): mousedown «взводит» draggable, в полях — снимает, поэтому
        //  выделение текста в input/textarea не превращается в драг карточки.
        list.querySelectorAll('.te-card').forEach(card => {
            card.addEventListener('mousedown', e => {
                card.draggable = !!(e.target.closest('.te-card-head') && !e.target.closest('.te-cbtn'));
            });

            card.addEventListener('dragstart', e => {
                if (!card.draggable) { e.preventDefault(); return; }
                _dragIdx = Number(card.dataset.idx);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(_dragIdx)); // без setData Firefox не стартует драг
                card.classList.add('te-dragging');
            });

            card.addEventListener('dragend', () => {
                card.draggable = false;
                card.classList.remove('te-dragging');
                _dragIdx = null;
                list.querySelectorAll('.te-drop-above, .te-drop-below')
                    .forEach(c => c.classList.remove('te-drop-above', 'te-drop-below'));
            });

            card.addEventListener('dragover', e => {
                if (_dragIdx === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const r     = card.getBoundingClientRect();
                const above = (e.clientY - r.top) < r.height / 2;
                card.classList.toggle('te-drop-above', above);
                card.classList.toggle('te-drop-below', !above);
            });

            card.addEventListener('drop', e => {
                if (_dragIdx === null) return;
                e.preventDefault();
                e.stopPropagation();
                const r     = card.getBoundingClientRect();
                const above = (e.clientY - r.top) < r.height / 2;
                _moveBlock(_dragIdx, Number(card.dataset.idx) + (above ? 0 : 1));
            });
        });

        // Автопрокрутка у краёв списка + валидный drop в промежутках между карточками
        list.addEventListener('dragover', e => {
            if (_dragIdx === null) return;
            e.preventDefault();
            const r = list.getBoundingClientRect();
            if      (e.clientY - r.top  < 36) list.scrollTop -= 9;
            else if (r.bottom - e.clientY < 36) list.scrollTop += 9;
        });
        list.addEventListener('drop', e => { if (_dragIdx !== null) e.preventDefault(); });

        // ▲ ▼ ✕
        list.querySelectorAll('.te-cbtn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const i    = Number(btn.closest('.te-card').dataset.idx);
                const act  = btn.dataset.act;
                if (act === 'del') {
                    _blocks.splice(i, 1);
                    _selectedIdx = null;
                } else if (act === 'up' && i > 0) {
                    [_blocks[i - 1], _blocks[i]] = [_blocks[i], _blocks[i - 1]];
                    _selectedIdx = i - 1;
                } else if (act === 'down' && i < _blocks.length - 1) {
                    [_blocks[i + 1], _blocks[i]] = [_blocks[i], _blocks[i + 1]];
                    _selectedIdx = i + 1;
                } else return;
                _syncFromBlocks();
                _renderBlocksPane();
            });
        });

        // ── Универсальные текстовые поля (data-field): IMAGE файл/масштаб,
        //    !COM, DANGER, SCROLLSPEED/TIMER/AT val, SYNC start/end/text.
        //    Правка → b.f[поле] → dirty → пересборка исходника.
        list.querySelectorAll('.te-card .te-input[data-field]').forEach(inp => {
            inp.addEventListener('input', () => {
                const b = _blocks[Number(inp.closest('.te-card').dataset.idx)];
                b.f[inp.dataset.field] = inp.value;
                b.dirty = true;
                _syncFromBlocks();
            });
        });

        // Значки ПОЗИЦИИ (IMAGE): клик → правка модели без перерисовки панели
        list.querySelectorAll('.te-card[data-type="image"]').forEach(card => {
            const b = _blocks[Number(card.dataset.idx)];
            card.querySelectorAll('.te-pos-btn').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    b.f.pos = btn.dataset.pos;
                    b.dirty = true;
                    card.querySelectorAll('.te-pos-btn').forEach(x => x.classList.toggle('active', x === btn));
                    _syncFromBlocks();
                });
            });
            // Перетаскивание картинки прямо на поле ФАЙЛ
            const fileInp = card.querySelector('.te-file-input');
            if (fileInp) {
                fileInp.addEventListener('dragover', e => {
                    if (_dragIdx !== null) return; // идёт сортировка карточек — не подсвечивать поле
                    e.preventDefault();
                    fileInp.classList.add('te-drag-over');
                });
                fileInp.addEventListener('dragleave', () => fileInp.classList.remove('te-drag-over'));
                fileInp.addEventListener('drop', e => {
                    if (_dragIdx !== null) return; // это драг карточки, а не файла
                    e.preventDefault();
                    e.stopPropagation();
                    fileInp.classList.remove('te-drag-over');
                    const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
                    if (!file) return;
                    fileInp.value = file.name;
                    b.f.file  = file.name;
                    b.dirty   = true;
                    _syncFromBlocks();
                    const reader = new FileReader();
                    reader.onload = ev => {
                        _localImageMap[file.name] = ev.target.result;
                        _updateImgStat();
                        _checkMissingImages();
                        _renderBlocksPane(); // покажет миниатюру
                    };
                    reader.readAsDataURL(file);
                });
            }
        });

        // ── Сегментные кнопки: уровень заголовка H1-H3 ──
        list.querySelectorAll('.te-card[data-type="h"] .te-pos-btn[data-level]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const card = btn.closest('.te-card');
                const b    = _blocks[Number(card.dataset.idx)];
                b.f.level = Number(btn.dataset.level);
                b.dirty   = true;
                card.querySelectorAll('.te-pos-btn[data-level]').forEach(x => x.classList.toggle('active', x === btn));
                const chip = card.querySelector('.te-chip');
                if (chip) chip.textContent = 'H' + b.f.level;
                _syncFromBlocks();
            });
        });

        // ── Сегментные кнопки: CHARMODE/WORDMODE ──
        list.querySelectorAll('.te-card[data-syskind="mode"] .te-pos-btn[data-modeval]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const card = btn.closest('.te-card');
                const b    = _blocks[Number(card.dataset.idx)];
                b.f.mode = btn.dataset.modeval;
                b.dirty  = true;
                card.querySelectorAll('.te-pos-btn[data-modeval]').forEach(x => x.classList.toggle('active', x === btn));
                const chip = card.querySelector('.te-chip');
                if (chip) chip.textContent = b.f.mode === 'CHAR' ? 'CHARMODE' : 'WORDMODE';
                _syncFromBlocks();
            });
        });

        // ── Сегментные кнопки: DISABLE/ENABLE и TAGS/MD ──
        list.querySelectorAll('.te-card[data-syskind="toggle"] .te-pos-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const card = btn.closest('.te-card');
                const b    = _blocks[Number(card.dataset.idx)];
                if      (btn.dataset.onval)   b.f.on   = btn.dataset.onval;
                else if (btn.dataset.whatval) b.f.what = btn.dataset.whatval;
                else return;
                b.dirty = true;
                btn.closest('.te-pos-group').querySelectorAll('.te-pos-btn').forEach(x => x.classList.toggle('active', x === btn));
                const chip = card.querySelector('.te-chip');
                if (chip) chip.textContent = `${b.f.on}=${b.f.what}`;
                _syncFromBlocks();
            });
        });

        // ── Флажок [CENTER] (заголовки и абзацы) ──
        list.querySelectorAll('.te-check-btn[data-field="center"]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const card = btn.closest('.te-card');
                const b    = _blocks[Number(card.dataset.idx)];
                b.f.center = !b.f.center;
                b.dirty    = true;
                btn.classList.toggle('active', b.f.center);
                btn.textContent = (b.f.center ? '▣' : '▢') + ' ЦЕНТР';
                const chip = card.querySelector('.te-chip'); // у абзаца чип отражает центрирование
                if (chip && card.dataset.type === 'p') chip.textContent = b.f.center ? 'ЦЕНТР' : 'ТЕКСТ';
                _syncFromBlocks();
            });
        });

        // ── Редакторы строк: СПИСОК и FOOTNOTE (общая схема data-row/data-rowact) ──
        list.querySelectorAll('.te-card[data-type="list"], .te-card[data-type="footnote"]').forEach(card => {
            const b     = _blocks[Number(card.dataset.idx)];
            const isList = card.dataset.type === 'list';

            card.querySelectorAll('.te-listrow').forEach(rowEl => {
                const r = Number(rowEl.dataset.row);
                rowEl.querySelector('.te-input')?.addEventListener('input', e => {
                    if (isList) b.f.items[r].t = e.target.value;
                    else        b.f.items[r]   = e.target.value;
                    b.dirty = true;
                    _syncFromBlocks();
                });
            });
            // Маркер пункта: - ↔ *
            card.querySelectorAll('.te-marker').forEach(mk => {
                mk.addEventListener('click', e => {
                    e.stopPropagation();
                    const r = Number(mk.closest('.te-listrow').dataset.row);
                    b.f.items[r].m = b.f.items[r].m === '-' ? '*' : '-';
                    mk.textContent = b.f.items[r].m;
                    b.dirty = true;
                    _syncFromBlocks();
                });
            });
            _bindRowActions(card, btn => {
                const row = btn.closest('.te-listrow');
                const r   = row ? Number(row.dataset.row) : -1;
                const act = btn.dataset.rowact;
                if (act === 'add') { b.f.items.push(isList ? { m: '-', t: '' } : '- Пункт'); }
                else if (act === 'del' && r >= 0)  { b.f.items.splice(r, 1); }
                else if (act === 'up'  && r > 0)   { [b.f.items[r - 1], b.f.items[r]] = [b.f.items[r], b.f.items[r - 1]]; }
                else if (act === 'down' && r < b.f.items.length - 1) { [b.f.items[r + 1], b.f.items[r]] = [b.f.items[r], b.f.items[r + 1]]; }
                else return;
                b.dirty = true;
                _syncFromBlocks();
                _renderBlocksPane();
            });
        });

        // ── Редактор TABLE6: ячейки, строки, кнопки строк ──
        list.querySelectorAll('.te-card[data-type="table6"]').forEach(card => {
            const b = _blocks[Number(card.dataset.idx)];

            card.querySelectorAll('.te-trow').forEach(rowEl => {
                const r = Number(rowEl.dataset.row);
                rowEl.querySelectorAll('.te-cell').forEach(inp => {
                    inp.addEventListener('input', () => {
                        b.f.rows[r][Number(inp.dataset.cell)] = inp.value;
                        b.dirty = true;
                        _syncFromBlocks();
                    });
                });
            });
            _bindRowActions(card, btn => {
                const row = btn.closest('.te-trow');
                const r   = row ? Number(row.dataset.row) : -1;
                const act = btn.dataset.rowact;
                if (act === 'rowadd') {
                    const last = b.f.rows[b.f.rows.length - 1];
                    b.f.rows.push(new Array(Math.max(2, last ? last.length : 2)).fill(''));
                } else if (act === 'celladd' && r >= 0) { b.f.rows[r].push(''); }
                else if (act === 'del' && r >= 0)  { b.f.rows.splice(r, 1); }
                else if (act === 'up'  && r > 0)   { [b.f.rows[r - 1], b.f.rows[r]] = [b.f.rows[r], b.f.rows[r - 1]]; }
                else if (act === 'down' && r < b.f.rows.length - 1) { [b.f.rows[r + 1], b.f.rows[r]] = [b.f.rows[r], b.f.rows[r + 1]]; }
                else return;
                b.dirty = true;
                _syncFromBlocks();
                _renderBlocksPane();
            });
        });

        // ── COLORCODES: цветовые поля + живой свотч ──
        list.querySelectorAll('.te-card[data-type="colorcodes"]').forEach(card => {
            const b = _blocks[Number(card.dataset.idx)];
            card.querySelectorAll('.te-input[data-color]').forEach(inp => {
                inp.addEventListener('input', () => {
                    b.f[inp.dataset.color] = inp.value;
                    b.dirty = true;
                    const swatch = inp.closest('.te-colorrow')?.querySelector('.te-swatch');
                    if (swatch) swatch.style.background = _safeCssColor(inp.value);
                    _syncFromBlocks();
                });
            });
        });

        // Сырое поле «ИСХОДНИК»
        list.querySelectorAll('.te-card[data-type="raw"]').forEach(card => {
            const b = _blocks[Number(card.dataset.idx)];
            card.querySelector('.te-raw-edit')?.addEventListener('input', e => {
                b.lines = e.target.value.split('\n');
                b.dirty = true;
                _syncFromBlocks();
            });
        });

        // Инлайн-поля (TITLE/подпись IMAGE): рендер ↔ сырое редактирование
        list.querySelectorAll('.te-inline-field').forEach(fieldEl => {
            fieldEl.addEventListener('click', () => {
                if (fieldEl.dataset.editing === '1') return;
                const card = fieldEl.closest('.te-card');
                const b    = _blocks[Number(card.dataset.idx)];
                const key  = fieldEl.dataset.field;
                fieldEl.dataset.editing = '1';

                const editor = document.createElement('textarea');
                editor.className = 'te-inline-edit';
                editor.value     = b.f[key];
                editor.rows      = 1;
                fieldEl.innerHTML = '';
                fieldEl.appendChild(editor);
                editor.focus();
                editor.selectionStart = editor.selectionEnd = editor.value.length;
                const grow = () => {
                    editor.style.height = 'auto';
                    editor.style.height = Math.max(24, editor.scrollHeight) + 'px';
                };
                grow();
                editor.addEventListener('input', grow);

                let done = false;
                const finish = save => {
                    if (done) return;
                    done = true;
                    if (save) {
                        if (fieldEl.dataset.multiline === '1') {
                            // Многострочное поле (QUOTE): переводы строк сохраняем
                            b.f[key] = editor.value.replace(/\r\n?/g, '\n');
                        } else {
                            // Однострочное поле: переводы строк схлопываем в пробел
                            b.f[key] = editor.value.replace(/\r?\n+/g, ' ').trim();
                        }
                        b.dirty = true;
                        _syncFromBlocks();
                    }
                    _renderBlocksPane();
                };
                editor.addEventListener('blur', () => finish(true));
                editor.addEventListener('keydown', e => {
                    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
                });
            });
        });
    }

    /** Пересобирает исходник из карточек и синхронизирует textarea (скрытый). */
    function _syncFromBlocks() {
        _content = _serializeBlocks(_blocks);
        const ta = document.getElementById('te-textarea');
        if (ta && _mode === 'blocks') {
            ta.value = _content;
            ta.dispatchEvent(new Event('input')); // статистика, missing-images, live-превью
        }
    }

    /** Переключение режимов БЛОКИ ↔ КОД. */
    function _setMode(mode) {
        if (_mode === mode) return;
        const ta = document.getElementById('te-textarea');

        if (mode === 'blocks') {
            if (ta) _content = ta.value;          // забираем свежие правки из КОДа
            _blocks      = _parseBlocks(_content);
            _selectedIdx = null;
        } else {
            _content = _serializeBlocks(_blocks);
            if (ta) ta.value = _content;
        }
        _mode = mode;

        document.getElementById('te-code-pane')?.classList.toggle('te-hidden', mode === 'blocks');
        document.getElementById('te-blocks-pane')?.classList.toggle('te-hidden', mode !== 'blocks');
        document.querySelectorAll('.te-mode-btn').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.mode === mode));

        const note = document.getElementById('te-mode-note');
        if (note) note.textContent = mode === 'blocks'
            ? 'карточки: текст · медиа · цитаты · таблицы · система · ИСХОДНИК · порядок: ≡ drag или ▲▼'
            : 'РЕЖИМ РЕДАКТИРОВАНИЯ';

        if (mode === 'blocks') _renderBlocksPane();
        else ta?.dispatchEvent(new Event('input'));
    }

    /** Вставка нового блока после выбранной карточки (или в конец). */
    function _insertBlock(kind) {
        const b  = _newBlock(kind);
        const at = (_selectedIdx !== null && _selectedIdx >= 0 && _selectedIdx < _blocks.length)
            ? _selectedIdx + 1
            : _blocks.length;
        _blocks.splice(at, 0, b);
        _selectedIdx = at;
        _syncFromBlocks();
        _renderBlocksPane();
        document.querySelector(`.te-card[data-idx="${at}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    /** Перестановка блока drag-and-drop'ом: from → точка вставки to
     *  (to — индекс в системе ДО удаления, т.е. «перед карточкой to»).
     *  Обновляет модель, исходник и панель; сбрасывает состояние драга. */
    function _moveBlock(from, to) {
        _dragIdx = null;
        if (to === from || to === from + 1) return; // бросили на себя / на соседнюю границу
        const [moved] = _blocks.splice(from, 1);
        const at = to > from ? to - 1 : to;
        _blocks.splice(at, 0, moved);
        _selectedIdx = at;
        _syncFromBlocks();
        _renderBlocksPane();
        document.querySelector(`.te-card[data-idx="${at}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // =========================================================================
    //  FEAT: КОНТЕКСТНОЕ МЕНЮ (v2.5)
    //
    //  Появляется при выделении текста мышью или по правому клику в любом
    //  текстовом поле редактора: КОД (#te-textarea), инлайн-поля карточек
    //  (.te-inline-edit) и «ИСХОДНИК» (.te-raw-edit).
    //
    //  - Системное: копировать / вырезать / вставить / выделить всё.
    //    Вставка — через Clipboard API (HTTPS); fallback — подсказка Ctrl+V.
    //  - Теги: оборачивают выделение тем же _insertWrap, что и панель
    //    инструментов — WYSIWYG 1:1 с GET не нарушается.
    //    Без выделения пара тегов вставляется в позицию курсора.
    //
    //  Меню живёт в document.body (position:fixed, поверх WindowManager),
    //  закрывается: клик мимо, Esc, скролл, ввод текста, resize.
    //  =========================================================================

    /** Инлайн-теги меню (подмножество INLINE_TAGS — самое частое). */
    const _CTX_TAGS = [
        { l: 'Ж',      cls: 'te-ctx-tag-b', open: '**', close: '**', hint: 'Жирный  **текст**  (Ctrl+B)' },
        { l: 'К',      cls: 'te-ctx-tag-i', open: '_',  close: '_',  hint: 'Курсив  _текст_  (Ctrl+I)' },
        { l: 'ЗАЧЁРК', cls: 'te-ctx-tag-s', open: '~~', close: '~~', hint: 'Зачёркнутый  ~~текст~~' },
        { l: 'ЦЕНЗ',   cls: '',             open: '==', close: '==', hint: 'Цензура  ==скрытый текст==' },
        { l: 'КОД',    cls: '',             open: '`',  close: '`',  hint: 'Моноширинный  `код`' },
        { l: 'ЦВЕТ…',  cls: '', prompt: { tag: 'COLOR',   q: 'Цвет текста (#hex или имя):',  def: '#10b981' }, hint: '[COLOR=#hex]текст[/COLOR]' },
        { l: 'ФОН…',   cls: '', prompt: { tag: 'BGCOLOR', q: 'Цвет фона (#hex или имя):',   def: '#0a1f14' }, hint: '[BGCOLOR=#hex]текст[/BGCOLOR]' },
        { l: 'РАЗМЕР…',cls: '', prompt: { tag: 'SIZE',    q: 'Размер текста в пикселях:',   def: '24' },      hint: '[SIZE=N]текст[/SIZE]' },
    ];

    let _ctxEl       = null; // DOM меню (создаётся один раз)
    let _ctxTa       = null; // якорное текстовое поле
    let _ctxBound    = false; // документ-делегаты ставятся один раз

    /** Создаёт DOM меню (один раз) и возвращает его. */
    function _ctxEnsure() {
        if (_ctxEl) return _ctxEl;

        const menu = document.createElement('div');
        menu.id        = 'te-ctx';
        menu.className = 'te-ctx';
        menu.innerHTML = `
            <div class="te-ctx-lbl">РЕДАКТИРОВАНИЕ</div>
            <button class="te-ctx-btn" data-act="copy"><span>КОПИРОВАТЬ</span><kbd>Ctrl+C</kbd></button>
            <button class="te-ctx-btn" data-act="cut"><span>ВЫРЕЗАТЬ</span><kbd>Ctrl+X</kbd></button>
            <button class="te-ctx-btn" data-act="paste"><span>ВСТАВИТЬ</span><kbd>Ctrl+V</kbd></button>
            <button class="te-ctx-btn" data-act="all"><span>ВЫДЕЛИТЬ ВСЁ</span><kbd>Ctrl+A</kbd></button>
            <div class="te-ctx-sep"></div>
            <div class="te-ctx-lbl">ТЕГИ В ВЫДЕЛЕНИЕ</div>
            <div class="te-ctx-tags">
              ${_CTX_TAGS.map((t, i) =>
                  `<button class="te-ctx-tag ${t.cls || ''}" data-ctxidx="${i}" title="${_escapeForAttr(t.hint)}">${_escapeForAttr(t.l)}</button>`
              ).join('')}
            </div>`;
        document.body.appendChild(menu);

        // mousedown с preventDefault — чтобы НЕ терять фокус и выделение поля
        menu.addEventListener('mousedown', e => e.preventDefault());

        menu.addEventListener('click', e => {
            const sys  = e.target.closest('[data-act]');
            const tag  = e.target.closest('[data-ctxidx]');
            if      (sys) _ctxSystem(sys.dataset.act);
            else if (tag) _ctxTag(Number(tag.dataset.ctxidx));
            else return;
            _closeCtxMenu();
        });

        _ctxEl = menu;
        return menu;
    }

    /** Показ меню у точки (x, y) для поля ta. */
    function _openCtxMenu(ta, x, y) {
        const menu = _ctxEnsure();
        _ctxTa = ta;
        menu.style.visibility = 'hidden';
        menu.style.display    = 'block';
        // измеряем и вписываем в окно
        const w = menu.offsetWidth  || 240;
        const h = menu.offsetHeight || 300;
        menu.style.left = Math.max(4, Math.min(x, window.innerWidth  - w - 8)) + 'px';
        menu.style.top  = Math.max(4, Math.min(y, window.innerHeight - h - 8)) + 'px';
        menu.style.visibility = 'visible';
    }

    function _closeCtxMenu() {
        if (_ctxEl) _ctxEl.style.display = 'none';
        _ctxTa = null;
    }

    /** Системные действия: copy / cut / paste / all. */
    function _ctxSystem(act) {
        const ta = _ctxTa;
        if (!ta) return;
        const s   = ta.selectionStart;
        const e   = ta.selectionEnd;
        const sel = ta.value.slice(s, e);
        ta.focus();

        if (act === 'copy') {
            // execCommand сохраняет нативную интеграцию с буфером; fallback — Clipboard API
            if (!(document.execCommand && document.execCommand('copy')) &&
                navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(sel).catch(() => {});
            }
        } else if (act === 'cut') {
            if (!(document.execCommand && document.execCommand('cut'))) {
                if (navigator.clipboard?.writeText) navigator.clipboard.writeText(sel).catch(() => {});
                ta.setRangeText('', s, e, 'start');
                ta.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } else if (act === 'paste') {
            if (navigator.clipboard?.readText) {
                navigator.clipboard.readText().then(txt => {
                    if (!txt) return;
                    const cs = ta.selectionStart, ce = ta.selectionEnd;
                    ta.setRangeText(txt, cs, ce, 'end');
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                }).catch(() => {}); // нет разрешения — пользователь нажмёт Ctrl+V
            }
        } else if (act === 'all') {
            ta.setSelectionRange(0, ta.value.length);
        }
    }

    /** Теговые действия: обёртка выделения (или вставка пары в курсор). */
    function _ctxTag(idx) {
        const ta = _ctxTa;
        const def = _CTX_TAGS[idx];
        if (!ta || !def) return;
        ta.focus();
        if (def.prompt) {
            const v = prompt(def.prompt.q, def.prompt.def);
            if (!v) return;
            _insertWrap(ta, `[${def.prompt.tag}=${v.trim()}]`, `[/${def.prompt.tag}]`);
        } else {
            _insertWrap(ta, def.open, def.close);
        }
    }

    /** Делегаты документа: открытие на полях редактора + закрытие. Ставится 1 раз. */
    function _bindCtxMenuOnce() {
        if (_ctxBound) return;
        _ctxBound = true;

        const isEditorField = el => el.closest('#te-textarea, .te-inline-edit, .te-raw-edit');

        // Правый клик — всегда открываем (заменяет нативное меню на полях редактора)
        document.addEventListener('contextmenu', e => {
            const ta = e.target.nodeType === 1 ? isEditorField(e.target) : null;
            if (!ta) { _closeCtxMenu(); return; }
            e.preventDefault();
            _openCtxMenu(ta, e.clientX, e.clientY);
        });

        // Выделение мышью (ЛКМ) — меню у курсора
        document.addEventListener('mouseup', e => {
            if (e.button !== 0) return;
            if (_ctxEl && _ctxEl.style.display === 'block' && e.target.closest('#te-ctx')) return;
            const ta = e.target.nodeType === 1 ? isEditorField(e.target) : null;
            if (!ta) return;
            if (ta.selectionEnd > ta.selectionStart) {
                _openCtxMenu(ta, e.clientX + 2, e.clientY + 2);
            }
        });

        // Закрытие: клик/нажатие мимо меню
        document.addEventListener('mousedown', e => {
            if (_ctxEl && _ctxEl.style.display === 'block' && !e.target.closest('#te-ctx')) _closeCtxMenu();
        }, true);

        // Esc, скролл, ввод текста, resize
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') _closeCtxMenu();
        }, true);
        document.addEventListener('scroll', () => _closeCtxMenu(), true);
        document.addEventListener('input', e => {
            if (_ctxTa && e.target === _ctxTa) _closeCtxMenu();
        }, true);
        window.addEventListener('resize', _closeCtxMenu);
    }

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

        // FEAT: палитра «+ ДОБАВИТЬ БЛОК» для режима БЛОКИ
        const paletteHTML = _PALETTE_GROUPS.map(g => `
          <div class="te-pal-row">
            <span class="te-pal-group">${g.group}</span>
            ${g.items.map(it => it.on
                ? `<button class="te-pal-btn" data-kind="${it.kind}" title="${_escapeForAttr(it.hint)}">+ ${it.label}</button>`
                : `<button class="te-pal-btn" disabled title="${_escapeForAttr(it.hint)}">${it.label} · скоро</button>`
            ).join('')}
          </div>`).join('');

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
  <div class="te-modebar">
    <button class="te-mode-btn active" data-mode="code"   title="Исходный текст с тегами">КОД</button>
    <button class="te-mode-btn"        data-mode="blocks" title="Карточки-блоки (прототип)">БЛОКИ</button>
    <span class="te-mode-note" id="te-mode-note">РЕЖИМ РЕДАКТИРОВАНИЯ</span>
  </div>
  <div id="te-code-pane">
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
  </div>
  <div id="te-blocks-pane" class="te-blocks-pane te-hidden">
    <div class="te-blocks-scroll" id="te-blocks-list"></div>
    <div class="te-addbar">
      <button class="te-act-btn" id="te-add-block-btn" title="Вставить модуль-блок">+ ДОБАВИТЬ БЛОК ▾</button>
      <div class="te-palette te-xhide" id="te-palette">${paletteHTML}</div>
    </div>
  </div>
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
    <b>выделение / ПКМ</b> — контекстное меню (копия · вставка · теги) ·
    <b>БЛОКИ</b> — карточки всех групп тегов; #, [H4]-[H6], незакрытые блоки → «ИСХОДНИК» · порядок — ≡ drag или ▲▼ ·
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

    /** Цвет для preview-свотча: пропускает только #hex / имена цветов, иначе чёрный. */
    function _safeCssColor(v) {
        const s = String(v || '').trim();
        return (/^#[0-9a-f]{3,8}$/i.test(s) || /^[a-z]{3,20}$/i.test(s)) ? s : '#000';
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
            // WindowManager ещё не отрисовал DOM — повторная попытка.
            // FIX: если окно уже закрыто — выходим; кап ~40 попыток (~2 сек).
            const win = document.querySelector(`.lyoko-window[data-id="${EDITOR_WIN_ID}"]`);
            if (!win || ++_editorBindRetries > 40) return;
            setTimeout(_bindEditorEvents, 50);
            return;
        }
        _editorBindRetries = 0;

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

        // ── FEAT v2.5: контекстное меню (выделение/ПКМ — копия, вставка, теги) ──
        _bindCtxMenuOnce();

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

        // ── FEAT: режимы БЛОКИ | КОД ─────────────────────────────────────────
        document.querySelectorAll('.te-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => _setMode(btn.dataset.mode));
        });

        // ── FEAT: палитра «+ ДОБАВИТЬ БЛОК» ─────────────────────────────────
        const palette = document.getElementById('te-palette');
        const addBtn  = document.getElementById('te-add-block-btn');
        addBtn?.addEventListener('click', e => {
            e.stopPropagation();
            palette?.classList.toggle('te-xhide');
        });
        // Клик мимо палитры (внутри окна редактора) — закрыть её
        document.querySelector('.te-root')?.addEventListener('click', e => {
            if (palette && !palette.contains(e.target) && e.target !== addBtn) {
                palette.classList.add('te-xhide');
            }
        });
        palette?.querySelectorAll('.te-pal-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                palette.classList.add('te-xhide');
                _insertBlock(btn.dataset.kind);
            });
        });

        // ── CLEAR ────────────────────────────────────────────────────────────
        document.getElementById('te-clear')?.addEventListener('click', () => {
            if (!ta.value || confirm('Очистить весь текст?')) {
                ta.value = '';
                _localImageMap = {};
                _currentDossierName = null;
                _lastSavedSnapshot  = null;
                // FEAT: блочный режим тоже сбрасываем
                _blocks      = _parseBlocks('');
                _selectedIdx = null;
                if (_mode === 'blocks') _renderBlocksPane();
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
            // FIX: preventDefault теперь всегда — раньше срабатывал только когда
            // в drop были картинки: не-картинка (.txt, .pdf), брошенная на
            // textarea, открывалась браузером, и всё несохранённое терялось.
            e.preventDefault();
            ta.classList.remove('te-drag-over');
            const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
            if (!files.length) return;

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

        // FEAT: если открыт блочный режим — переразобрать документ в карточки
        if (_mode === 'blocks') {
            _blocks      = _parseBlocks(_content);
            _selectedIdx = null;
            _renderBlocksPane();
        }
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
            // FIX: окно могло быть уже закрыто — проверяем; кап ~40 попыток
            const win = document.querySelector(`.lyoko-window[data-id="${LOAD_WIN_ID}"]`);
            if (!win || ++_loadBindRetries > 40) return;
            setTimeout(_bindLoadWindowEvents, 50);
            return;
        }
        _loadBindRetries = 0;

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
            width:     680,
            height:    520,
            maxWidth:  1600,
            maxHeight: 900,
            status: 'TEXT EDITOR v2.5  |  КОД / БЛОКИ · выделение/ПКМ — меню тегов · Ctrl+B/I · Tab=4sp',
        });

        // Привязываем события после того, как WindowManager отрисует HTML
        setTimeout(_bindEditorEvents, 80);

        terminal.printSystem(
            'ТЕКСТОВЫЙ РЕДАКТОР: открыт. ' +
            'Режим КОД — исходный текст с тегами; режим БЛОКИ — карточки всех групп тегов ' +
            '(текст · заголовки · списки · IMAGE · TABLE6 · цитаты · система; редкое — «ИСХОДНИК»). ' +
            'Выдели текст или нажми ПКМ — контекстное меню: копировать/вставить/вырезать и теги ' +
            '(жирный, курсив, цензура, цвет, фон, размер). ' +
            'SAVE 💾 сохраняет текст и картинки локально, LOAD 📂 — открывает список сохранённых, ' +
            'PREVIEW ▶ — живой предпросмотр через реальный StepRenderer.'
        );
    }

    // =========================================================================
    //  Регистрация: терминальная команда + приложение SCIPNET OS
    // =========================================================================

    PluginAPI.register({
        id:          PLUGIN_ID,
        name:        'Текстовый Редактор',
        command:     'textedit',
        description: 'Редактор досье: режимы КОД и БЛОКИ (карточки-модули), локальное сохранение, живой предпросмотр',
        version:     '2.5',
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

    // FEAT: тест-хук для автопроверки round-trip (parse → serialize === исходник).
    // Не влияет на работу приложения; в Node читается через vm-харнесс.
    globalThis.__TE_BLOCKS_TEST__ = {
        parse:      _parseBlocks,
        serialize:  _serializeBlocks,
        parseImage: _parseImageFields,
        imageLine:  _imageLineFromFields,
    };

})();