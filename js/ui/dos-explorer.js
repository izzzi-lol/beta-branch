// =============================================================================
//  dos-explorer.js — Dossier Explorer (DEX) — встроенное приложение SCIPNET OS
//  Браузер досье с поиском, фильтрами (фракция/должность/статус/WIP),
//  предпросмотром, локальной загрузкой и двумя режимами вывода.
//
//  Иконка на рабочем столе: «Досье».  Команда: explorer
//
//  Требует: cmd_get.js (CmdGet, RAW_BASE, DOSSIERS_ROOT), app-registry.js
// =============================================================================

(function () {

    // ── Проверки окружения ────────────────────────────────────────────────────

    if (typeof PluginAPI === 'undefined') {
        console.error('[dex-plugin] PluginAPI не найден. Файл загружен вне SCIPNET?');
        return;
    }
    if (typeof CmdGet === 'undefined') {
        console.error('[dex-plugin] CmdGet не найден. Убедитесь, что cmd_get.js загружен.');
        return;
    }

    // ── Константы ─────────────────────────────────────────────────────────────

    const DEX_WIN_ID      = 'dex-explorer';
    const DOS_WIN_PREFIX  = 'dex-dos-';

    // Коды фракций → отображаемые названия
    const ORG_LABELS = {
        SCP:       'SCP Фонд',
        CI:        'Повстанцы Хаоса',
        EPSILON11: 'МОГ «Девятихвостая Лиса»',
        NU7:       'МОГ «Удар Молота»',
        ETA7:      'МОГ «Крылья Гермеса»',
        GOC:       'ГОК',
        SH:        'Длань Змея',
    };

    // Коды должностей → отображаемые названия
    // NB: в исходном ТЗ Engineer был указан как "Учёный" (совпадает со Scientist) —
    // похоже на опечатку, использую "Инженер". Поправьте здесь при необходимости.
    const PROF_LABELS = {
        ClassD:    'Класс Д',
        Scientist: 'Учёный',
                Medic:     'Медик',
        Engineer:  'Инженер',
        Director:  'Директор',
        Manager:   'Менеджер',
        Security:  'Охранник',
        Operative: 'Оперативник',
        Agent:     'Агент',
    };

    /**
     * Парсит служебный блок метаданных проводника из текста досье:
     *
     *   !COM $ExplorerDossierDescription
     *   !COM Author=LizzTea
     *   !COM Organization=SCP
     *   !COM Profession=Scientist
     *   !COM WIP
     *   !COM end$
     *
     * Блок и сами строки игнорируются движком рендера (StepRenderer пропускает
     * любую строку начинающуюся с !COM), поэтому на отображение досье не влияет.
     * Порядок полей и лишние !COM-строки внутри блока не важны.
     */
    function _parseExplorerMeta(content) {
        const meta = { author: null, organization: null, profession: null, status: null, wip: false };

        const blockMatch = content.match(/!COM\s*\$ExplorerDossierDescription([\s\S]*?)!COM\s*end\$/i);
        if (!blockMatch) return meta;

        const block = blockMatch[1];

        const kvRegex = /!COM\s+(\w+)\s*=\s*(.+?)\s*(?:\r?\n|$)/gi;
        let kv;
        while ((kv = kvRegex.exec(block))) {
            const key = kv[1].toLowerCase();
            const val = kv[2].trim();
            if (key === 'author')            meta.author       = val;
            else if (key === 'organization') meta.organization = val;
            else if (key === 'profession')   meta.profession   = val;
            else if (key === 'status') {
                // Нормализуем к 'Alive' / 'Dead' независимо от регистра в файле
                if (/^alive$/i.test(val)) meta.status = 'Alive';
                else if (/^dead$/i.test(val)) meta.status = 'Dead';
            }
        }

        if (/!COM\s+WIP\s*(?:\r?\n|$)/i.test(block)) meta.wip = true;

        return meta;
    }

    // ── Состояние ─────────────────────────────────────────────────────────────

    // Кэш загруженных досье: id → { title, excerpt, content }
    // Живёт на уровне плагина — сохраняется между открытиями окна
    const _cache = {};

    // ID выбранной записи
    let _selected = null;

    // Поколение фоновой подгрузки. FIX: execute() запускает асинхронный
    // prefetch-цикл; при переоткрытии окна старый цикл не умирал (проверка
    // существования окна не срабатывала — окно переиспользуется через
    // setContent) → дублирующиеся fetch-батчи и refreshList. Инкремент
    // поколения при каждом execute() позволяет старому циклу выйти.
    let _loadEpoch = 0;

    // Экранирование HTML для значений из удалённых досье: [TITLE], метаданные
    // !COM-блока и имена файлов попадают в innerHTML списка/превью/заголовка
    // окна. Досье публикуются сообществом — без экранирования это stored XSS:
    // [TITLE] <img src=x onerror=…> исполнялся у каждого открывшего проводник.
    const _esc = s => String(s ?? '').replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /**
     * Вывод «в терминал» рендерит в #dossier-output, который в режиме
     * рабочего стола скрыт под слоем стола — переключаем режим на консоль.
     */
    function _showConsoleIfNeeded() {
        if (typeof Desktop !== 'undefined'
            && typeof Desktop.isSupported === 'function'
            && Desktop.isSupported()
            && Desktop.mode() === 'desktop') {
            Desktop.showConsole();
        }
    }

    // ── Стили ─────────────────────────────────────────────────────────────────

    function _injectStyles() {
        if (document.getElementById('dex-plugin-style')) return;
        const st = document.createElement('style');
        st.id = 'dex-plugin-style';
        st.textContent = `

        /* ── Корень: flex-колонка, заполняет .lyoko-content-inner ── */
        .dex-root {
            font-family:    var(--mono-font, 'JetBrains Mono', monospace);
            display:        flex;
            flex-direction: column;
            height:         100%;
            gap:            8px;
            overflow:       hidden;
            box-sizing:     border-box;
        }

        /* ── Строка поиска ── */
        .dex-search-bar {
            display:     flex;
            align-items: center;
            gap:         8px;
            background:  rgba(0,0,0,0.35);
            border:      1px solid rgba(0,238,0,0.18);
            padding:     6px 10px;
            flex-shrink: 0;
            position:    relative;
        }
        .dex-search-bar::before {
            content:    '⌕';
            color:      rgba(0,238,0,0.35);
            font-size:  1.1em;
            flex-shrink: 0;
        }
        .dex-search-input {
            flex:        1;
            background:  none;
            border:      none;
            outline:     none;
            font-family: inherit;
            font-size:   0.76em;
            letter-spacing: 1px;
            color:       rgba(0,238,0,0.9);
            caret-color: rgba(0,238,0,0.9);
        }
        .dex-search-input::placeholder { color: rgba(0,238,0,0.22); }

        /* ── Счётчик ── */
        .dex-count {
            font-size:      0.6em;
            letter-spacing: 1.5px;
            color:          rgba(0,238,0,0.28);
            flex-shrink:    0;
        }
        .dex-count.loading::after {
            content:   ' ●';
            animation: dexDot 1s step-start infinite;
        }
        @keyframes dexDot {
            0%, 49%  { opacity: 1;   }
            50%, 100%{ opacity: 0.2; }
        }

        /* ── Основной layout: список + превью ── */
        .dex-layout {
            display:    flex;
            flex:       1;
            min-height: 0;
            gap:        8px;
            overflow:   hidden;
        }

        /* ── Список досье ── */
        .dex-list {
            flex:         0 0 46%;
            overflow-y:   auto;
            border:       1px solid rgba(0,238,0,0.1);
            display:      flex;
            flex-direction: column;
        }
        /* (скроллбар .dex-list — единый системный, см. windows.css) */

        .dex-empty {
            padding:      14px;
            font-size:    0.68em;
            letter-spacing: 1px;
            color:        rgba(0,238,0,0.2);
            text-align:   center;
        }

        .dex-item {
            padding:       6px 10px 6px 12px;
            cursor:        pointer;
            border-bottom: 1px solid rgba(0,238,0,0.05);
            border-left:   2px solid transparent;
            display:       flex;
            flex-direction: column;
            gap:           2px;
            transition:    background 0.1s, border-color 0.1s;
            flex-shrink:   0;
        }
        .dex-item:last-child    { border-bottom: none; }
        .dex-item:hover         { background: rgba(0,238,0,0.06); }
        .dex-item.selected {
            background:    rgba(0,238,0,0.1);
            border-left-color: rgba(0,238,0,0.55);
        }
        .dex-item-id {
            font-size:      0.7em;
            letter-spacing: 1.5px;
            color:          rgba(0,238,0,0.8);
        }
        .dex-item-title {
            font-size:     0.62em;
            color:         rgba(0,238,0,0.38);
            white-space:   nowrap;
            overflow:      hidden;
            text-overflow: ellipsis;
        }
        .dex-item-title.dex-pending {
            color:      rgba(0,238,0,0.18);
            font-style: italic;
        }

        /* ── Панель превью ── */
        .dex-preview {
            flex:      1;
            overflow-y: auto;
            border:    1px solid rgba(0,238,0,0.1);
            padding:   12px;
            display:   flex;
            flex-direction: column;
            gap:       10px;
            min-height: 0;
        }
        /* (скроллбар .dex-preview — единый системный, см. windows.css) */

        .dex-preview-hint {
            margin:     auto;
            text-align: center;
            color:      rgba(0,238,0,0.15);
            font-size:  0.68em;
            letter-spacing: 1px;
            line-height: 1.8;
        }
        .dex-preview-hint::before {
            content:    '◁\A';
            white-space: pre;
            font-size:  1.4em;
            display:    block;
            margin-bottom: 4px;
        }
        .dex-preview-spinner {
            color:      rgba(0,238,0,0.2);
            font-size:  0.68em;
            letter-spacing: 1px;
            animation:  dexDot 1s step-start infinite;
        }
        .dex-preview-badge {
            font-size:      0.58em;
            letter-spacing: 2px;
            color:          rgba(0,238,0,0.3);
            border:         1px solid rgba(0,238,0,0.12);
            display:        inline-block;
            padding:        2px 6px;
            align-self:     flex-start;
        }
        .dex-preview-title {
            font-size:      0.88em;
            letter-spacing: 1.5px;
            color:          rgba(0,238,0,0.9);
            text-shadow:    0 0 10px rgba(0,238,0,0.25);
            line-height:    1.5;
        }
        .dex-preview-divider {
            border:     none;
            border-top: 1px solid rgba(0,238,0,0.1);
            margin:     0;
        }
        .dex-preview-excerpt {
            font-size:   0.66em;
            color:       rgba(0,238,0,0.38);
            line-height: 1.8;
            padding-left: 8px;
            border-left:  2px solid rgba(0,238,0,0.12);
        }

        /* ── Кнопки действий ── */
        .dex-actions {
            display:     flex;
            gap:         6px;
            flex-shrink: 0;
        }
        .dex-btn {
            flex:        1;
            padding:     8px 4px;
            font-family: inherit;
            font-size:   0.67em;
            letter-spacing: 2px;
            cursor:      pointer;
            border:      1px solid;
            transition:  background 0.12s, border-color 0.12s;
            text-align:  center;
        }
        .dex-btn:disabled {
            opacity: 0.28;
            cursor:  default;
        }
        .dex-btn-terminal {
            background:   rgba(0,238,0,0.04);
            border-color: rgba(0,238,0,0.22);
            color:        rgba(0,238,0,0.8);
        }
        .dex-btn-terminal:not(:disabled):hover {
            background:   rgba(0,238,0,0.12);
            border-color: rgba(0,238,0,0.45);
        }
        .dex-btn-window {
            background:   rgba(80,210,255,0.03);
            border-color: rgba(80,210,255,0.18);
            color:        rgba(80,210,255,0.75);
        }
        .dex-btn-window:not(:disabled):hover {
            background:   rgba(80,210,255,0.1);
            border-color: rgba(80,210,255,0.4);
        }

        /* ── Баннер пропуска: полоса строго под шапкой окна ── */
        /*                                                                  */
        /*  Живёт НЕ в скроллящемся .lyoko-content, а отдельным child'ом    */
        /*  .lyoko-window сразу после .lyoko-titlebar. Окно — flex-column,  */
        /*  поэтому полоса занимает собственную строку: контент не пробегает */
        /*  под ней, output не перекрывается и скроллится в чистой области. */
        /*  max-height — точка отсчёта для плавного схлопывания (.done),    */
        /*  когда рендер досье завершается.                                  */
        .dex-skip-banner {
            flex-shrink:   0;
            overflow:      hidden;
            max-height:    72px;           /* > одной строки — на случай переноса */
            text-align:    center;
            padding:       6px 16px;
            font-size:     0.62em;
            letter-spacing: 1.8px;
            color:         rgba(255,140,140,0.92);
            background:    rgba(6, 12, 9, 0.94);
            border-bottom: 1px solid rgba(220,30,30,0.3);
            cursor:        pointer;
            transition:
                background 0.12s,
                max-height 0.24s ease,
                padding    0.24s ease,
                opacity    0.20s ease,
                border-bottom-width 0.24s ease;
            animation:     dexSkipPulse 2.2s ease-in-out infinite;
        }
        .dex-skip-banner:hover { background: rgba(40, 8, 8, 0.94); }

        /* Рендер завершён: полоса схлопывается, окно мягко «дораскрыается» */
        .dex-skip-banner.done {
            animation: none;               /* пульс не должен мешать opacity:0 */
            max-height: 0;
            padding-top:    0;
            padding-bottom: 0;
            border-bottom-width: 0;
            opacity:        0;
            pointer-events: none;
        }

        @keyframes dexSkipPulse {
            0%, 100%{ opacity: 1;   }
            50%     { opacity: 0.7; }
        }

        /* ── Вкладки ── */
        .dex-tabs {
            display:     flex;
            flex-shrink: 0;
            border-bottom: 1px solid rgba(0,238,0,0.14);
        }
        .dex-tab {
            flex:        1;
            background:  none;
            border:      none;
            border-bottom: 2px solid transparent;
            padding:     7px 4px 8px;
            font-family: inherit;
            font-size:   0.64em;
            letter-spacing: 1.8px;
            color:       rgba(0,238,0,0.32);
            cursor:      pointer;
            transition:  color 0.12s, border-color 0.12s;
        }
        .dex-tab:hover    { color: rgba(0,238,0,0.6); }
        .dex-tab.active {
            color:        rgba(0,238,0,0.92);
            border-bottom-color: rgba(0,238,0,0.6);
            text-shadow:  0 0 8px rgba(0,238,0,0.3);
        }

        /* ── Панели вкладок ── */
        .dex-pane {
            display:        none;
            flex-direction: column;
            gap:            8px;
            flex:           1;
            min-height:     0;
            overflow:       hidden;
        }
        .dex-pane.active { display: flex; }

        /* ── Drag-n-drop зона ── */
        .dex-dropzone {
            border:      1.5px dashed rgba(0,238,0,0.22);
            background:  rgba(0,238,0,0.015);
            padding:     22px 12px;
            text-align:  center;
            cursor:      pointer;
            transition:  background 0.15s, border-color 0.15s;
            flex-shrink: 0;
        }
        .dex-dropzone:hover,
        .dex-dropzone.drag-over {
            background:   rgba(0,238,0,0.06);
            border-color: rgba(0,238,0,0.5);
        }
        .dex-dropzone-icon {
            font-size: 1.4em;
            color:     rgba(0,238,0,0.3);
            margin-bottom: 6px;
        }
        .dex-dropzone-text {
            font-size:      0.66em;
            letter-spacing: 1.5px;
            color:          rgba(0,238,0,0.45);
            line-height:    1.7;
        }
        .dex-dropzone-text span {
            color: rgba(0,238,0,0.22);
            font-size: 0.92em;
        }
        .dex-dropzone.compact {
            padding: 10px 12px;
        }
        .dex-dropzone.compact .dex-dropzone-icon { display: none; }

        /* ── Инфопанель загруженного файла ── */
        .dex-local-info {
            border:      1px solid rgba(0,238,0,0.1);
            padding:     8px 10px;
            font-size:   0.64em;
            letter-spacing: 0.5px;
            line-height: 1.7;
            flex-shrink: 0;
        }
        .dex-local-filename {
            color:          rgba(0,238,0,0.75);
            letter-spacing: 1px;
        }
        .dex-local-clear {
            float:       right;
            color:       rgba(220,30,30,0.6);
            cursor:      pointer;
            letter-spacing: 1.5px;
        }
        .dex-local-clear:hover { color: rgba(220,30,30,0.95); }
        .dex-local-missing {
            color:      rgba(255,180,40,0.85);
            margin-top: 4px;
        }
        .dex-local-missing-list {
            color:      rgba(255,180,40,0.55);
            font-size:  0.94em;
        }
        .dex-local-ok { color: rgba(0,238,0,0.55); }

        /* ── Фильтр-бар (фракция / должность / статус / WIP) ── */
        .dex-filter-bar {
            display:     flex;
            flex-wrap:   wrap;
            gap:         6px;
            flex-shrink: 0;
        }
        .dex-filter-select {
            flex:        1;
            min-width:   86px;
            background:  rgba(0,0,0,0.3);
            border:      1px solid rgba(0,238,0,0.16);
            color:       rgba(0,238,0,0.7);
            font-family: inherit;
            font-size:   0.6em;
            letter-spacing: 1px;
            padding:     4px 4px;
            outline:     none;
            cursor:      pointer;
            transition:  border-color 0.12s;
        }
        .dex-filter-select:hover  { border-color: rgba(0,238,0,0.4); }
        .dex-filter-select option { background: #0a120c; color: #aee8c4; }

        /* Трёхпозиционная кнопка-кнопка: ОБЫЧНЫЕ → WIP → ВСЕ → (цикл) */
        .dex-filter-wip-toggle {
            display:        flex;
            align-items:    center;
            gap:            4px;
            padding:        4px 8px;
            background:     none;
            border:         1px solid rgba(150,150,150,0.25);
            color:          rgba(190,190,190,0.65);
            font-family:    inherit;
            font-size:      0.6em;
            letter-spacing: 1.5px;
            cursor:         pointer;
            user-select:    none;
            flex-shrink:    0;
            transition:     border-color 0.12s, background 0.12s, color 0.12s;
        }
        .dex-filter-wip-toggle:hover { border-color: rgba(190,190,190,0.5); }

        /* Состояние WIP — красный акцент, как раньше */
        .dex-filter-wip-toggle[data-mode="wip"] {
            background:   rgba(220,30,30,0.12);
            border-color: rgba(220,30,30,0.6);
            color:        rgba(255,140,140,0.9);
        }

        /* Состояние ВСЕ — нейтральный голубой акцент */
        .dex-filter-wip-toggle[data-mode="all"] {
            background:   rgba(0,180,255,0.1);
            border-color: rgba(0,180,255,0.5);
            color:        rgba(120,210,255,0.9);
        }

        /* ── WIP-метка в списке ── */
        .dex-item-wip-tag {
            display:        inline-block;
            margin-left:    6px;
            padding:        0 4px;
            font-size:      0.85em;
            letter-spacing: 1px;
            color:          rgba(255,90,90,0.95);
            border:         1px solid rgba(255,90,90,0.4);
            background:     rgba(255,90,90,0.08);
            vertical-align: middle;
        }

        /* ── Метка "мёртв" в списке (живые — статус по умолчанию, без метки) ── */
        .dex-item-dead-tag {
            display:        inline-block;
            margin-left:    6px;
            padding:        0 4px;
            font-size:      0.85em;
            letter-spacing: 0.5px;
            color:          rgba(170,170,170,0.85);
            border:         1px solid rgba(170,170,170,0.35);
            background:     rgba(170,170,170,0.06);
            vertical-align: middle;
        }

        /* ── WIP-плашка в превью ── */
        .dex-wip-banner {
            background:     rgba(220,30,30,0.14);
            border:         1px solid rgba(220,30,30,0.45);
            color:          rgba(255,130,130,0.95);
            font-size:      0.62em;
            letter-spacing: 1.5px;
            padding:        5px 8px;
            text-align:     center;
        }

        /* ── Статус-бейдж в превью (Alive/Dead) ── */
        .dex-status-badge {
            display:        inline-flex;
            align-items:    center;
            gap:            5px;
            align-self:     flex-start;
            font-size:      0.6em;
            letter-spacing: 1.5px;
            padding:        2px 7px;
            border:         1px solid;
        }
        .dex-status-alive {
            color:        rgba(90,230,120,0.9);
            border-color: rgba(90,230,120,0.4);
            background:   rgba(90,230,120,0.07);
        }
        .dex-status-dead {
            color:        rgba(190,190,190,0.85);
            border-color: rgba(190,190,190,0.35);
            background:   rgba(190,190,190,0.06);
        }

        /* ── Мета-строки в превью (автор / фракция / должность) ── */
        .dex-preview-meta {
            display:        flex;
            flex-direction: column;
            gap:            3px;
        }
        .dex-meta-row {
            display:   flex;
            gap:       6px;
            font-size: 0.62em;
            letter-spacing: 0.5px;
        }
        .dex-meta-label {
            color:       rgba(0,238,0,0.32);
            min-width:   64px;
            flex-shrink: 0;
        }
        .dex-meta-value { color: rgba(0,238,0,0.68); }
        `;
        document.head.appendChild(st);
    }

    // ── HTML главного окна ─────────────────────────────────────────────────────

    function _buildExplorerHTML() {
        return `
        <div class="dex-root">
            <div class="dex-tabs">
                <button class="dex-tab active" data-tab="remote">БАЗА ДАННЫХ</button>
                <button class="dex-tab" data-tab="local">ЛОКАЛЬНАЯ ЗАГРУЗКА</button>
            </div>

            <div class="dex-pane active" data-pane="remote">
                <div class="dex-search-bar">
                    <input class="dex-search-input" id="dex-search" type="text"
                        placeholder="ID ЗАПИСИ ИЛИ НАЗВАНИЕ..."
                        autocomplete="off" spellcheck="false">
                </div>
                <div class="dex-filter-bar">
                    <select class="dex-filter-select" id="dex-filter-org">
                        <option value="">ФРАКЦИЯ: ВСЕ</option>
                    </select>
                    <select class="dex-filter-select" id="dex-filter-prof">
                        <option value="">ДОЛЖНОСТЬ: ВСЕ</option>
                    </select>
                    <select class="dex-filter-select" id="dex-filter-status">
                        <option value="">СТАТУС: ВСЕ</option>
                        <option value="Alive">ЖИВ</option>
                        <option value="Dead">МЁРТВ</option>
                    </select>
                    <button type="button" class="dex-filter-wip-toggle"
                            id="dex-filter-wipmode" data-mode="normal">
                        <span id="dex-filter-wipmode-label">ОБЫЧНЫЕ</span>
                    </button>
                </div>
                <div class="dex-count loading" id="dex-count">ЗАГРУЗКА БАЗЫ ДАННЫХ</div>
                <div class="dex-layout">
                    <div class="dex-list" id="dex-list"></div>
                    <div class="dex-preview" id="dex-preview">
                        <div class="dex-preview-hint">ВЫБЕРИТЕ<br>ЗАПИСЬ</div>
                    </div>
                </div>
                <div class="dex-actions">
                    <button class="dex-btn dex-btn-terminal" id="dex-btn-term" disabled>▶ В ТЕРМИНАЛ</button>
                    <button class="dex-btn dex-btn-window"   id="dex-btn-win"  disabled>⊞ ОТКРЫТЬ В ОКНЕ</button>
                </div>
            </div>

            <div class="dex-pane" data-pane="local">
                <input type="file" id="dex-file-input" multiple accept=".txt,image/*" style="display:none">
                <div class="dex-dropzone" id="dex-dropzone">
                    <div class="dex-dropzone-icon">⇩</div>
                    <div class="dex-dropzone-text">
                        ПЕРЕТАЩИТЕ ФАЙЛЫ СЮДА ИЛИ НАЖМИТЕ<br>
                        <span>.txt досье + изображения (если требуются)</span>
                    </div>
                </div>
                <div class="dex-local-info" id="dex-local-info" style="display:none"></div>
                <div class="dex-preview" id="dex-local-preview">
                    <div class="dex-preview-hint">ЗАГРУЗИТЕ<br>ДОСЬЕ</div>
                </div>
                <div class="dex-actions">
                    <button class="dex-btn dex-btn-terminal" id="dex-local-btn-term" disabled>▶ В ТЕРМИНАЛ</button>
                    <button class="dex-btn dex-btn-window"   id="dex-local-btn-win"  disabled>⊞ ОТКРЫТЬ В ОКНЕ</button>
                </div>
            </div>
        </div>`;
    }

    // ── Извлечение метаданных из текста досье ──────────────────────────────────
    // Общий хелпер для удалённых (GitHub) и локальных (drag-n-drop) файлов.

    function _extractMeta(content, fallbackTitle) {
        const titleMatch = content.match(/\[TITLE\](.*)/i);
        const title = titleMatch ? titleMatch[1].trim() : fallbackTitle;

        const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('!COM'));
        let excerpt = '';
        for (const line of lines) {
            const clean = line.replace(/\[.*?\]/g, '').replace(/[*_~=`]/g, '').trim();
            if (clean.length > 40) { excerpt = clean.slice(0, 220); break; }
        }

        return { title, excerpt };
    }

    /** Возвращает имена изображений из [IMAGE] тегов, которых нет в sessionFiles. */
    function _getMissingImages(content, sessionFiles) {
        const imageTags = content.match(/\[IMAGE\]\s*([^| \n\r\]]+)/g) || [];
        const required   = imageTags.map(t => t.replace('[IMAGE]', '').trim());
        return required.filter(name => !sessionFiles[name]);
    }

    function _fileToBase64(file) {
        return new Promise((resolve) => {
            const r = new FileReader();
            r.onload = e => resolve(e.target.result);
            r.readAsDataURL(file);
        });
    }

    /**
     * Рендерит контент в произвольный output-узел с баннером пропуска анимации
     * (тот же стиль, что у GET/UPLOAD — #echo-interrupt-banner из глобального CSS).
     */
    async function _renderWithSkipBanner(content, outputNode, imageBase, imageMap) {
        const banner = document.createElement('div');
        banner.id          = 'echo-interrupt-banner';
        banner.textContent = 'НАЖМИТЕ ПРОБЕЛ ИЛИ КЛИКНИТЕ ЗДЕСЬ, ЧТОБЫ ПРОПУСТИТЬ АНИМАЦИЮ';
        banner.addEventListener('click', () => PluginAPI.renderer?.skip());

        const consoleArea = document.getElementById('console-area');
        if (consoleArea?.parentNode) consoleArea.insertAdjacentElement('afterend', banner);
        else document.body.appendChild(banner);

        const onSpace = (e) => {
            if (e.code !== 'Space') return;
            if (document.activeElement?.id === 'cmd-input') return;
            e.preventDefault();
            PluginAPI.renderer?.skip();
        };
        document.addEventListener('keydown', onSpace);

        try {
            await PluginAPI.renderer.render(content, outputNode, imageBase, imageMap);
        } finally {
            banner.remove();
            document.removeEventListener('keydown', onSpace);
        }
    }

    /**
     * Плавно убирает баннер пропуска после завершения рендера досье:
     * класс .done схлопывает полосу (max-height/padding/opacity → 0),
     * затем баннер удаляется из DOM — окно «дораскрыается» без рывка.
     */
    function _retireSkipBanner(banner) {
        if (!banner?.isConnected) return;
        banner.classList.add('done');
        banner.addEventListener('transitionend', function onEnd(e) {
            if (e.propertyName !== 'max-height') return; // ждём именно схлопывание
            banner.removeEventListener('transitionend', onEnd);
            banner.remove();
        });
        setTimeout(() => banner.remove(), 400); // страховка: transitionend может не прийти
    }

    // ── Загрузка одного досье (с кэшем) ───────────────────────────────────────

    async function _loadDossier(id) {
        if (_cache[id]) return _cache[id];

        try {
            const resp = await fetch(`${RAW_BASE}/${DOSSIERS_ROOT}/${id}/dossier.txt`);
            if (!resp.ok) return null;

            const content = await resp.text();
            const { title, excerpt } = _extractMeta(content, id);
            const meta = _parseExplorerMeta(content);

            _cache[id] = { title, excerpt, content, meta };
            return _cache[id];

        } catch {
            return null;
        }
    }

    // ── Главная функция плагина ────────────────────────────────────────────────

    async function execute(args, terminal) {
        _injectStyles();
        _selected = null;

        PluginAPI.WindowManager.open(DEX_WIN_ID, '[ DOSSIER EXPLORER ]', _buildExplorerHTML(), {
            width:       490,
            height:      520,
            status:      'DEX v1.0  //  БАЗА ДАННЫХ ФОНДА',
            backdrop:    false,
            isResizable: true,
        });

        // Ждём, пока DOM окна будет готов
        await new Promise(r => requestAnimationFrame(r));

        const win = document.querySelector(`[data-id="${DEX_WIN_ID}"]`);
        if (!win) return;

        const listEl       = win.querySelector('#dex-list');
        const previewEl    = win.querySelector('#dex-preview');
        const countEl      = win.querySelector('#dex-count');
        const searchEl     = win.querySelector('#dex-search');
        const btnTerm      = win.querySelector('#dex-btn-term');
        const btnWin       = win.querySelector('#dex-btn-win');
        const filterOrgEl    = win.querySelector('#dex-filter-org');
        const filterProfEl   = win.querySelector('#dex-filter-prof');
        const filterStatusEl = win.querySelector('#dex-filter-status');
        const wipModeBtn      = win.querySelector('#dex-filter-wipmode');

        // ── Вкладки ───────────────────────────────────────────────────────────

        const tabs  = win.querySelectorAll('.dex-tab');
        const panes = win.querySelectorAll('.dex-pane');
        tabs.forEach(tab => tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.toggle('active', t === tab));
            panes.forEach(p => p.classList.toggle('active', p.dataset.pane === tab.dataset.tab));
        }));

        // ── Трёхпозиционный фильтр WIP: ОБЫЧНЫЕ → WIP → ВСЕ → (цикл) ───────────

        const WIP_MODES  = ['normal', 'wip', 'all'];
        const WIP_LABELS = { normal: 'ОБЫЧНЫЕ', wip: 'WIP', all: 'ВСЕ' };

        wipModeBtn.addEventListener('click', () => {
            const next = WIP_MODES[(WIP_MODES.indexOf(wipModeBtn.dataset.mode) + 1) % WIP_MODES.length];
            wipModeBtn.dataset.mode = next;
            wipModeBtn.querySelector('span').textContent = WIP_LABELS[next];
            refreshList();
        });

        // ── Локальная загрузка (drag-n-drop) ─────────────────────────────────

        const localState = {
            content: null,
            name:    null,
            sessionFiles: {},
        };

        const dropzone     = win.querySelector('#dex-dropzone');
        const fileInput     = win.querySelector('#dex-file-input');
        const localInfo     = win.querySelector('#dex-local-info');
        const localPreview  = win.querySelector('#dex-local-preview');
        const localBtnTerm  = win.querySelector('#dex-local-btn-term');
        const localBtnWin   = win.querySelector('#dex-local-btn-win');

        function resetLocalState() {
            localState.content = null;
            localState.name    = null;
            localState.sessionFiles = {};
            dropzone.classList.remove('compact');
            dropzone.querySelector('.dex-dropzone-icon').style.display = '';
            dropzone.querySelector('.dex-dropzone-text').innerHTML =
                'ПЕРЕТАЩИТЕ ФАЙЛЫ СЮДА ИЛИ НАЖМИТЕ<br><span>.txt досье + изображения (если требуются)</span>';
            localInfo.style.display = 'none';
            localPreview.innerHTML = '<div class="dex-preview-hint">ЗАГРУЗИТЕ<br>ДОСЬЕ</div>';
            localBtnTerm.disabled = true;
            localBtnWin.disabled  = true;
        }

        function renderLocalState() {
            if (!localState.content) { resetLocalState(); return; }

            // Dropzone → компактный режим "догрузить ещё файлы"
            dropzone.classList.add('compact');
            dropzone.querySelector('.dex-dropzone-text').innerHTML =
                'ДОГРУЗИТЬ ФАЙЛЫ <span>(перетащите или нажмите)</span>';

            const missing = _getMissingImages(localState.content, localState.sessionFiles);
            const { title, excerpt } = _extractMeta(localState.content, localState.name);

            // ── Инфопанель ──
            localInfo.style.display = '';
            localInfo.innerHTML = `
                <span class="dex-local-filename">📄 ${_esc(localState.name)}</span>
                <span class="dex-local-clear" id="dex-local-clear">✕ ОЧИСТИТЬ</span>
                ${missing.length
                    ? `<div class="dex-local-missing">⚠ НЕ ХВАТАЕТ ИЗОБРАЖЕНИЙ:
                        <div class="dex-local-missing-list">${_esc(missing.join(', '))}</div></div>`
                    : `<div class="dex-local-ok">✓ ВСЕ ФАЙЛЫ НА МЕСТЕ</div>`}
            `;
            localInfo.querySelector('#dex-local-clear').addEventListener('click', resetLocalState);

            // ── Превью ──
            localPreview.innerHTML = `
                <div class="dex-preview-badge">ЛОКАЛЬНЫЙ ФАЙЛ</div>
                <div class="dex-preview-title">${_esc(title)}</div>
                <hr class="dex-preview-divider">
                <div class="dex-preview-excerpt">${_esc(excerpt) || '—'}</div>
            `;

            // Кнопки доступны только когда все требуемые изображения на месте
            const ready = missing.length === 0;
            localBtnTerm.disabled = !ready;
            localBtnWin.disabled  = !ready;
        }

        async function handleLocalFiles(fileList) {
            const files = Array.from(fileList);
            let changed = false;

            // АУДИО → ПЛЕЕР: аудиофайлы не являются частью досье — их забирает
            // АУДИО ПЛЕЕР (окно открывается поверх, файлы добавляются в
            // «ЛОКАЛЬНЫЕ ФАЙЛЫ» и сразу играют). Досье-логика ниже не меняется.
            const audioFiles = files.filter(f =>
                (f.type || '').startsWith('audio/') ||
                /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(f.name || ''));
            if (audioFiles.length && typeof AudioPlayerApp !== 'undefined') {
                AudioPlayerApp.open({ files: audioFiles });
            }

            const txtFile = files.find(f => f.name.toLowerCase().endsWith('.txt'));
            if (txtFile && !localState.content) {
                localState.content = await txtFile.text();
                localState.name    = txtFile.name;
                changed = true;
            }

            const imageFiles = files.filter(f => f.type.startsWith('image/'));
            for (const img of imageFiles) {
                localState.sessionFiles[img.name] = await _fileToBase64(img);
                changed = true;
            }

            if (changed) renderLocalState();
            else if (!localState.content && !audioFiles.length) {
                // Аудио уже ушли в плеер — сообщение про .txt не показываем
                terminal.printError('Файл .txt не найден среди перетащенных файлов.');
            }
        }

        // Клик по дропзоне → file picker
        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            handleLocalFiles(e.target.files);
            fileInput.value = ''; // позволяет повторно выбрать тот же файл
        });

        // Drag-n-drop
        ['dragenter', 'dragover'].forEach(evt =>
            dropzone.addEventListener(evt, (e) => {
                e.preventDefault();
                dropzone.classList.add('drag-over');
            })
        );
        ['dragleave', 'drop'].forEach(evt =>
            dropzone.addEventListener(evt, (e) => {
                e.preventDefault();
                dropzone.classList.remove('drag-over');
            })
        );
        dropzone.addEventListener('drop', (e) => {
            if (e.dataTransfer?.files?.length) handleLocalFiles(e.dataTransfer.files);
        });

        // Кнопка «В ТЕРМИНАЛ» (локальное досье)
        localBtnTerm.addEventListener('click', async () => {
            if (!localState.content) return;
            // В десктоп-режиме консоль скрыта — переключаемся, чтобы рендер было видно
            _showConsoleIfNeeded();
            PluginAPI.WindowManager.close(DEX_WIN_ID);
            terminal.printSystem(`> UPLOAD ${localState.name}`);
            await _renderWithSkipBanner(
                localState.content, terminal.getOutputNode(), 'local', localState.sessionFiles
            );
        });

        // Кнопка «В ОКНЕ» (локальное досье)
        localBtnWin.addEventListener('click', async () => {
            if (!localState.content) return;
            const { title } = _extractMeta(localState.content, localState.name);
            await _openDossierWindow(
                'local-' + Date.now(), title, localState.content,
                { imageBase: 'local', imageMap: localState.sessionFiles }
            );
        });

        // ── 1. Загружаем список папок ─────────────────────────────────────────

        const folders = await CmdGet.fetchAvailableFolders(terminal);
        if (!folders.length) {
            countEl.textContent = 'БАЗА ДАННЫХ НЕДОСТУПНА';
            countEl.classList.remove('loading');
            return;
        }

        // Рабочий массив записей — title подгружается постепенно
        const allItems = folders.map(id => ({ id, title: null }));
        let loadedCount = 0;

        // ── 2. Синхронизация опций фильтров ────────────────────────────────────

        function _syncSelectOptions(selectEl, valuesSet, labelMap) {
            const existing = new Set(Array.from(selectEl.options).map(o => o.value));
            for (const val of valuesSet) {
                if (existing.has(val)) continue;
                const opt = document.createElement('option');
                opt.value       = val;
                opt.textContent = labelMap[val] ?? val;
                selectEl.appendChild(opt);
            }
        }

        function updateFilterOptions() {
            const orgs  = new Set();
            const profs = new Set();
            for (const it of allItems) {
                if (it.meta?.organization) orgs.add(it.meta.organization);
                if (it.meta?.profession)   profs.add(it.meta.profession);
            }
            _syncSelectOptions(filterOrgEl,  orgs,  ORG_LABELS);
            _syncSelectOptions(filterProfEl, profs, PROF_LABELS);
        }

        // ── 3. Рендер списка (поиск + фильтры) ──────────────────────────────────

        function refreshList() {
            const q     = searchEl.value.toLowerCase().trim();
            const org   = filterOrgEl.value;
            const prof  = filterProfEl.value;
            const status = filterStatusEl.value;
            const wipMode = wipModeBtn.dataset.mode; // 'normal' | 'wip' | 'all'

            const visible = allItems.filter(it => {
                if (q && !(
                    it.id.toLowerCase().includes(q) ||
                    (it.title && it.title.toLowerCase().includes(q)) ||
                    (it.meta?.author && it.meta.author.toLowerCase().includes(q))
                )) return false;
                if (org    && it.meta?.organization !== org)    return false;
                if (prof   && it.meta?.profession   !== prof)   return false;
                if (status && it.meta?.status       !== status) return false;
                // 'all' — без фильтра; 'wip' — только помеченные WIP;
                // 'normal' — скрываем известные WIP (ещё не загруженные мета пропускаем).
                if (wipMode === 'wip'    && !it.meta?.wip) return false;
                if (wipMode === 'normal' && it.meta?.wip)  return false;
                return true;
            });

            countEl.textContent = `${loadedCount < allItems.length ? '⟳ ' : ''}ЗАПИСЕЙ: ${visible.length} / ${allItems.length}`;
            if (loadedCount < allItems.length) countEl.classList.add('loading');
            else countEl.classList.remove('loading');

            listEl.innerHTML = '';

            if (!visible.length) {
                listEl.innerHTML = '<div class="dex-empty">НЕТ СОВПАДЕНИЙ</div>';
                return;
            }

            const frag = document.createDocumentFragment();
            for (const item of visible) {
                const el = document.createElement('div');
                el.className   = 'dex-item' + (item.id === _selected ? ' selected' : '');
                el.dataset.id  = item.id;
                el.innerHTML   = `
                    <span class="dex-item-id">${_esc(item.id)}${item.meta?.wip ? ' <span class="dex-item-wip-tag">WIP</span>' : ''}${item.meta?.status === 'Dead' ? ' <span class="dex-item-dead-tag">✝</span>' : ''}</span>
                    <span class="dex-item-title ${item.title ? '' : 'dex-pending'}">${_esc(item.title) ?? '…'}</span>
                `;
                el.addEventListener('click', () => selectItem(item.id));
                frag.appendChild(el);
            }
            listEl.appendChild(frag);
        }

        // ── 4. Выбор записи → превью ─────────────────────────────────────────────

        async function selectItem(id) {
            _selected = id;

            listEl.querySelectorAll('.dex-item').forEach(el =>
                el.classList.toggle('selected', el.dataset.id === id)
            );

            btnTerm.disabled = false;
            btnWin.disabled  = false;

            previewEl.innerHTML = `<div class="dex-preview-spinner">ЗАПРОС К БАЗЕ...</div>`;

            const data = await _loadDossier(id);

            if (!data) {
                previewEl.innerHTML = `<div class="dex-preview-hint">ФАЙЛ<br>НЕДОСТУПЕН</div>`;
                return;
            }

            // Обновляем заголовок/мету в списке если ещё не загружены
            const item = allItems.find(i => i.id === id);
            if (item) {
                if (!item.title) {
                    item.title = data.title;
                    const titleEl = listEl.querySelector(`[data-id="${id}"] .dex-item-title`);
                    if (titleEl) { titleEl.textContent = data.title; titleEl.classList.remove('dex-pending'); }
                }
                if (!item.meta) {
                    item.meta = data.meta;
                    updateFilterOptions();
                }
            }

            const m = data.meta;
            previewEl.innerHTML = `
                <div class="dex-preview-badge">ID: ${_esc(id)}</div>
                ${m.status ? `<div class="dex-status-badge ${m.status === 'Dead' ? 'dex-status-dead' : 'dex-status-alive'}">${m.status === 'Dead' ? '✝ МЁРТВ' : '● ЖИВ'}</div>` : ''}
                ${m.wip ? `<div class="dex-wip-banner">⚠ ДОСЬЕ НАХОДИТСЯ В РАЗРАБОТКЕ</div>` : ''}
                <div class="dex-preview-title">${_esc(data.title)}</div>
                ${(m.author || m.organization || m.profession) ? `
                <div class="dex-preview-meta">
                    ${m.author       ? `<div class="dex-meta-row"><span class="dex-meta-label">АВТОР</span><span class="dex-meta-value">${_esc(m.author)}</span></div>` : ''}
                    ${m.organization ? `<div class="dex-meta-row"><span class="dex-meta-label">ФРАКЦИЯ</span><span class="dex-meta-value">${_esc(ORG_LABELS[m.organization] ?? m.organization)}</span></div>` : ''}
                    ${m.profession   ? `<div class="dex-meta-row"><span class="dex-meta-label">ДОЛЖНОСТЬ</span><span class="dex-meta-value">${_esc(PROF_LABELS[m.profession] ?? m.profession)}</span></div>` : ''}
                </div>` : ''}
            `;
        }

        // ── 5. Поиск и фильтры ───────────────────────────────────────────────────

        searchEl.addEventListener('input', refreshList);
        filterOrgEl.addEventListener('change', refreshList);
        filterProfEl.addEventListener('change', refreshList);
        filterStatusEl.addEventListener('change', refreshList);
        searchEl.focus();

        // ── 6. Кнопка «В ТЕРМИНАЛ» ───────────────────────────────────────────

        btnTerm.addEventListener('click', async () => {
            if (!_selected) return;
            const id   = _selected;
            const data = _cache[id] ?? await _loadDossier(id);
            if (!data) return;

            // В десктоп-режиме консоль скрыта — переключаемся, чтобы рендер было видно
            _showConsoleIfNeeded();
            PluginAPI.WindowManager.close(DEX_WIN_ID);
            terminal.printSystem(`> GET ${id}`);
            await CmdGet.renderStepByStep(data.content, terminal.getOutputNode(), id);
        });

        // ── 7. Кнопка «В ОКНЕ» ───────────────────────────────────────────────

        btnWin.addEventListener('click', async () => {
            if (!_selected) return;
            const id   = _selected;
            const data = _cache[id] ?? await _loadDossier(id);
            if (!data) return;
            await _openDossierWindow(id, data.title, data.content);
        });

        // ── 8. Первый рендер + фоновая подгрузка заголовков и метаданных ─────────

        refreshList();

        // Подгружаем досье батчами по 4 — заголовок, мета (автор/фракция/WIP)
        // FIX: epoch — старый prefetch-цикл умирает, если окно переоткрыли
        const epoch = ++_loadEpoch;
        (async () => {
            const BATCH = 4;
            for (let i = 0; i < allItems.length; i += BATCH) {
                // Если окно закрыто ИЛИ переоткрыто (новое поколение) — останавливаемся
                if (epoch !== _loadEpoch || !document.querySelector(`[data-id="${DEX_WIN_ID}"]`)) return;

                const batch = allItems.slice(i, i + BATCH);
                await Promise.all(batch.map(async item => {
                    if (item.title) return; // уже загружен
                    const data = await _loadDossier(item.id);
                    if (!data) return;
                    item.title = data.title;
                    item.meta  = data.meta;
                    loadedCount++;
                }));

                updateFilterOptions();
                refreshList(); // перерисовываем разом — учитывает текущий поиск/фильтры

                await new Promise(r => setTimeout(r, 120)); // пауза между батчами
            }
        })();
    }

    // ── Открытие досье в отдельном окне с рендером ────────────────────────────

    async function _openDossierWindow(id, title, content, opts = {}) {
        const winId = DOS_WIN_PREFIX + id;

        // Открываем окно с placeholder-ом
        PluginAPI.WindowManager.open(winId, `ДОСЬЕ: ${_esc(title)}`, `
            <div id="dex-dos-wrap-${id}">
                <div style="padding:20px;text-align:center;font-size:0.7em;
                            letter-spacing:2px;color:rgba(0,238,0,0.25);">
                    ИНИЦИАЛИЗАЦИЯ...
                </div>
            </div>
        `, {
            width:       640,
            height:      640,
            status:      opts.imageBase === 'local' ? 'ЛОКАЛЬНЫЙ ФАЙЛ  //  НЕ В БАЗЕ ДАННЫХ' : `ID: ${id}  //  ЗАСЕКРЕЧЕНО`,
            backdrop:    false,
            isResizable: true,
        });

        await new Promise(r => requestAnimationFrame(r));

        const win = document.querySelector(`[data-id="${winId}"]`);
        if (!win) return;

        // Целевой контейнер: .lyoko-content-inner (новая структура) или .lyoko-content
        const inner = win.querySelector('.lyoko-content-inner')
                   ?? win.querySelector('.lyoko-content');
        if (!inner) return;

        // Очищаем placeholder, строим структуру для рендера
        inner.innerHTML = '';

        // Баннер пропуска анимации — НЕ внутри скроллящегося output, а отдельной
        // полосой строго под шапкой окна: между .lyoko-titlebar и
        // .lyoko-content-wrapper. Текст досье бежит только в своей области,
        // баннер его не перекрывает и не уезжает вместе со скроллом.
        const banner = document.createElement('div');
        banner.className   = 'dex-skip-banner';
        banner.textContent = '● НАЖМИТЕ ЗДЕСЬ ИЛИ ПРОБЕЛ ДЛЯ ПРОПУСКА АНИМАЦИИ';
        banner.addEventListener('click', () => PluginAPI.renderer?.skip());

        const contentWrapper = win.querySelector('.lyoko-content-wrapper');
        if (contentWrapper) win.insertBefore(banner, contentWrapper); // под шапкой
        else inner.appendChild(banner); // защитный fallback (структура окна изменилась)

        const outputDiv = document.createElement('div');
        inner.appendChild(outputDiv);

        // Пробел → skip (сбрасываем по закрытию)
        const onSpace = (e) => {
            if (e.code !== 'Space') return;
            if (document.activeElement?.id === 'cmd-input') return;
            e.preventDefault();
            PluginAPI.renderer?.skip();
        };
        document.addEventListener('keydown', onSpace);

        // MutationObserver: убираем обработчик если окно закрыли
        const obs = new MutationObserver(() => {
            if (!document.querySelector(`[data-id="${winId}"]`)) {
                document.removeEventListener('keydown', onSpace);
                obs.disconnect();
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });

        const imageBase = opts.imageBase ?? `${RAW_BASE}/${DOSSIERS_ROOT}/${id}/`;
        const imageMap  = opts.imageMap  ?? {};

        try {
            await PluginAPI.renderer.render(content, outputDiv, imageBase, imageMap);
        } finally {
            _retireSkipBanner(banner);
            document.removeEventListener('keydown', onSpace);
        }
    }

    // ── Регистрация: терминальная команда + приложение SCIPNET OS ─────────────

    PluginAPI.register({
        id:          'dex-plugin',
        name:        'Dossier Explorer',
        command:     'explorer',
        description: 'Браузер досье: поиск, фильтры, предпросмотр, вывод в терминал или в окне',
        version:     '1.0',
        execute,
    });

    if (typeof AppRegistry !== 'undefined') {
        AppRegistry.register({
            id:          'dossiers',
            name:        'Досье',
            icon:        AppRegistry.ICONS.dossiers,
            description: 'База данных персонала',
            launch:      () => execute([], PluginAPI.terminal),
        });
    }

})();
