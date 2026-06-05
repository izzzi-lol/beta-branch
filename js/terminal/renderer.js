// =============================================================================
//  renderer.js — StepRenderer
//  Рендерит текст (досье, эхо-записи) пословно с анимацией.
//
//  Поддерживает:
//    • Инлайн-теги и вложенный Markdown
//    • [SCROLLSPEED=мс]   — меняет задержку между словами (мс/слово)
//    • [TIMER=с]          — пауза N секунд (поддерживает дробные значения)
//    • !COM ...           — комментарий, строка полностью игнорируется
//    • AbortSignal        — чистая отмена воспроизведения на полуслове
// =============================================================================

class StepRenderer {

    /**
     * @param {object}      [opts]
     * @param {AbortSignal} [opts.signal]       AbortSignal для отмены воспроизведения
     * @param {number}      [opts.defaultSpeed] Задержка по умолчанию (мс/слово), default 38
     */
    constructor({ signal = null, defaultSpeed = 38 } = {}) {
        this.signal       = signal;
        this.defaultSpeed = defaultSpeed;
        this.currentSpeed = defaultSpeed;
        this._output      = null;   // DOM-узел вывода, устанавливается в render()
        this._skip        = false;  // Флаг мгновенного вывода (skip-to-end)
        this._charMode    = false;  // Флаг посимвольного вывода ([CHARMODE]/[WORDMODE])
        this._scrollRafId = null;   // RAF-handle для debounced-scroll
        // Самокорректирующийся таймер: компенсирует накопленный drift setTimeout.
        // _clockStart  — performance.now() в момент старта render().
        // _clockExpected — сколько мс должно было пройти по «идеальным» задержкам.
        // Разница (_clockExpected - elapsed) — остаток для следующего setTimeout.
        // Если event loop опаздывал, corrected < ms, тем самым долг гасится.
        this._clockStart    = 0;
        this._clockExpected = 0;
    }

    /**
     * Переключает рендер в режим мгновенного вывода.
     * Все задержки (скорость слов, TIMER) обнуляются.
     * Вызывается при прерывании ECHO, когда нужно дочитать без аудио.
     */
    skip() {
        this._skip = true;
    }

    /**
     * Скроллит вывод вниз не чаще одного раза за кадр (requestAnimationFrame).
     * Предотвращает сотни принудительных layout reflow при CHARMODE —
     * главная причина замедления при длинных ECHO-записях.
     */
    _scheduleScroll() {
        if (this._scrollRafId) return;
        this._scrollRafId = requestAnimationFrame(() => {
            this._scrollRafId = null;
            if (this._output) this._output.scrollTop = this._output.scrollHeight;
        });
    }

    // =========================================================================
    //  ОТМЕНА
    // =========================================================================

    _aborted() {
        return this.signal?.aborted ?? false;
    }

    /**
     * Пауза с поддержкой AbortSignal и автокоррекцией drift.
     *
     * setTimeout не гарантирует точное время — он срабатывает *не раньше* чем
     * через N мс, но может позже (занятый event loop, тяжёлый DOM).
     * При CHARMODE это тысячи вызовов, каждый +1–3 мс → итого секунды рассинхрона.
     *
     * Фикс: ведём «идеальные часы» (_clockExpected) и вычитаем накопленный drift
     * из каждого следующего таймаута. Если отстали — паузы сжимаются и долг гасится.
     * Если вдруг опередили (маловероятно) — пауза растягивается, не ломая поток.
     *
     * Бросает DOMException('AbortError') если воспроизведение отменено.
     */
    _delay(ms) {
        return new Promise((resolve, reject) => {
            if (this._aborted()) {
                return reject(new DOMException('Aborted', 'AbortError'));
            }
            // В режиме skip все задержки обнуляются — текст выводится мгновенно
            if (this._skip) return resolve();

            this._clockExpected += ms;
            const elapsed   = performance.now() - this._clockStart;
            const corrected = Math.max(0, this._clockExpected - elapsed);

            const id = setTimeout(resolve, corrected);
            this.signal?.addEventListener('abort', () => {
                clearTimeout(id);
                reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
        });
    }

    // =========================================================================
    //  CSS-ТЕМА
    // =========================================================================

    _resetTheme() {
        const def = '#a200ff';
        document.documentElement.style.setProperty('--theme-color',        def);
        document.documentElement.style.setProperty('--theme-quote-border', def);
        document.documentElement.style.setProperty('--theme-quote-bg',     'rgba(162,0,255,0.05)');
        document.documentElement.style.setProperty('--theme-table-bg',     'rgba(162,0,255,0.2)');
    }

    _applyTheme(colors) {
        const base   = colors['Mainpage'] || '#a200ff';
        const quotes = colors['Quotes']   || base;
        const tables = colors['Tables']   || base;
        document.documentElement.style.setProperty('--theme-color',        base);
        document.documentElement.style.setProperty('--theme-quote-border', quotes);
        document.documentElement.style.setProperty('--theme-quote-bg',     quotes + '0D');
        document.documentElement.style.setProperty('--theme-table-bg',     tables + '33');
    }

    // =========================================================================
    //  ИНЛАЙН-ПАРСЕР: Markdown + кастомные теги
    //
    //  Архитектура: рекурсивный descent-парсер вместо regex.
    //  Regex не умеет считать вложенные пары тегов —
    //  [COLOR=#A]([COLOR=#B]...[/COLOR])[/COLOR] ломается из-за .*?
    //  _findMatchingClose считает глубину и находит правильный [/TAG],
    //  _parseSegment рекурсивно обрабатывает содержимое.
    // =========================================================================

    /** 1. Чистый Markdown без обработки тегов. */
    _applyMD(str, state) {
        if (state.disableMD) return str;
        return str
            .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
            .replace(/\*\*(.*?)\*\*/g,     '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g,          '<em>$1</em>')
            .replace(/_(.*?)_/g,            '<em>$1</em>')
            .replace(/~~(.*?)~~/g,          '<del>$1</del>')
            .replace(/==(.*?)==/g,          '<span class="scp-redacted">$1</span>')
            .replace(/`(.*?)`/g,            '<code class="scp-inline-code">$1</code>');
    }

    /**
     * 2. Ищет закрывающий [/tagName] с учётом вложенности.
     * fromPos — позиция сразу после открывающего тега.
     * Возвращает индекс закрывающего тега или -1.
     */
    _findMatchingClose(text, tagName, fromPos) {
        const tn       = tagName.toLowerCase();
        const closeStr = `[/${tn}]`;
        const openStr  = `[${tn}`;
        const ltext    = text.toLowerCase(); // вычисляем один раз, не в каждой итерации
        let depth = 1;
        let pos   = fromPos;

        while (pos < text.length) {
            const nextCloseIdx = ltext.indexOf(closeStr, pos);
            if (nextCloseIdx === -1) return -1;

            let openIdx    = -1;
            let searchFrom = pos;
            while (searchFrom < nextCloseIdx) {
                const idx = ltext.indexOf(openStr, searchFrom);
                if (idx === -1 || idx >= nextCloseIdx) break;
                const charAfter = ltext[idx + 1 + tn.length];
                if (charAfter === ']' || charAfter === '=') { openIdx = idx; break; }
                searchFrom = idx + 1;
            }

            if (openIdx !== -1) {
                depth++;
                const closeBracket = ltext.indexOf(']', openIdx + 1 + tn.length);
                pos = closeBracket !== -1 ? closeBracket + 1 : openIdx + 1 + tn.length + 1;
            } else {
                depth--;
                if (depth === 0) return nextCloseIdx;
                pos = nextCloseIdx + closeStr.length;
            }
        }
        return -1;
    }

    /** 3. Рендерит глитч-эффект. */
    _renderGlitch(intensiveVal, innerText) {
        const gi = Math.max(0.01, Math.min(5, intensiveVal || 0.5));

        if (!window._scpGlitchInit) {
            window._scpGlitchInit = true;
            const st = document.createElement('style');
            st.textContent = `
                .scp-effect-glitch {
                    display: inline-block;
                    animation: _scpGlitchJitter calc(0.22s / max(var(--gi, 0.5), 0.05)) steps(1) infinite;
                }
                @keyframes _scpGlitchJitter {
                    0%,100% { transform: translate(0,0) skewX(0deg); filter: none; }
                    15%     { transform: translate(calc(var(--gi)*-3px),0) skewX(calc(var(--gi)*-2deg)); filter: brightness(1.6) hue-rotate(30deg); }
                    30%     { transform: translate(calc(var(--gi)*2px),0); filter: none; }
                    55%     { transform: translate(calc(var(--gi)*-1px),0) skewX(calc(var(--gi)*1.5deg)); }
                    70%     { transform: translate(0,0) skewX(0deg); filter: brightness(0.7); }
                    85%     { transform: translate(calc(var(--gi)*1px),0); filter: none; }
                }
            `;
            document.head.appendChild(st);

            const GLITCH_CHARS = '!@#$%^&*<>?/|~±░▒▓│┼╬═║╝╔▄▀■□▪';
            (function loop() {
                document.querySelectorAll('.scp-effect-glitch').forEach(el => {
                    const elGi = parseFloat(el.dataset.gi) || 0.5;
                    const orig = el.dataset.orig;
                    if (!orig) return;
                    let out = '';
                    for (let i = 0; i < orig.length; i++) {
                        out += (orig[i] > ' ' && Math.random() < elGi * 0.18)
                            ? GLITCH_CHARS[Math.random() * GLITCH_CHARS.length | 0]
                            : orig[i];
                    }
                    el.textContent = out;
                });
                const allGi = [...document.querySelectorAll('.scp-effect-glitch')]
                    .map(el => parseFloat(el.dataset.gi) || 0.5);
                const maxGi = allGi.length ? Math.max(...allGi) : 0.5;
                setTimeout(loop, Math.max(40, 180 / maxGi + Math.random() * 100));
            })();
        }

        const safeOrig = innerText
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        return `<span class="scp-effect-glitch" data-gi="${gi}" data-orig="${safeOrig}" style="--gi:${gi}">${innerText}</span>`;
    }

    /** 4. Превращает распознанный тег + его содержимое в HTML. */
    _renderTag(name, attr, innerHtml) {
        switch (name) {
            case 'color':   return `<span style="color:${attr}">${innerHtml}</span>`;
            case 'bgcolor': return `<span style="background-color:${attr}; padding:0 4px; border-radius:2px;">${innerHtml}</span>`;
            case 'href':    return `<a href="${attr}" target="_blank" class="scp-link">${innerHtml}</a>`;
            case 'size':    return `<span style="font-size:${attr}px;">${innerHtml}</span>`;
            case 'effect': {
                const m = attr.match(/GLITCH;INTENSIVE=([0-9.]+)/i);
                return m ? this._renderGlitch(parseFloat(m[1]), innerHtml) : innerHtml;
            }
            default: return innerHtml;
        }
    }

    /**
     * 5. Рекурсивный парсер: обходит текст слева направо,
     *    находит самый ранний тег и рекурсивно обрабатывает содержимое.
     *
     *    Поддерживаемые парные теги (все вложенные):
     *      [color=#HEX]…[/color]
     *      [bgcolor=#HEX]…[/bgcolor]
     *      [href=URL]…[/href]
     *      [size=VALUE]…[/size]
     *      [EFFECT=GLITCH;INTENSIVE=N]…[/EFFECT]
     *    Отдельно (не вложенный):
     *      [CMD="cmd"]label[/CMD]
     */
    static get NESTABLE_TAGS() {
        return [
            { name: 'color',   openRe: /\[color=(#[0-9a-fA-F]{3,8})\]/i   },
            { name: 'bgcolor', openRe: /\[bgcolor=(#[0-9a-fA-F]{3,8})\]/i },
            { name: 'href',    openRe: /\[href=([^\]]+)\]/i                },
            { name: 'size',    openRe: /\[size=([0-9]+)\]/i           },
            { name: 'effect',  openRe: /\[effect=([^;\]]+;[^\]]+)\]/i     },
        ];
    }

    _parseSegment(text, state) {
        let earliest = null;
        for (const { name, openRe } of StepRenderer.NESTABLE_TAGS) {
            const m = new RegExp(openRe.source, 'i').exec(text);
            if (m && (earliest === null || m.index < earliest.index)) {
                earliest = { index: m.index, full: m[0], name, attr: m[1] };
            }
        }

        const cmdRe  = /\[CMD="([^"]+)"\](.*?)\[\/CMD\]/i;
        const cmdM   = cmdRe.exec(text);
        const useCMD = cmdM && (earliest === null || cmdM.index < earliest.index);

        const browseRe = /\[BROWSE="([^"]+)"\](.*?)\[\/BROWSE\]/i;
        const browseM  = browseRe.exec(text);
        const useBROWSE = browseM && (earliest === null || browseM.index < earliest.index)
            && (!cmdM || browseM.index < cmdM.index);

        // Ранний выход — только если нет НИ ОДНОГО известного тега
        if (!earliest && !cmdM && !browseM) return this._applyMD(text, state);

        if (useCMD) {
            const before  = text.slice(0, cmdM.index);
            const after   = text.slice(cmdM.index + cmdM[0].length);
            const safeCmd = cmdM[1].replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const tagHtml = `<span class="scp-cmd-link" onclick="TerminalAPI.typeAndExecute('${safeCmd}')">${this._applyMD(cmdM[2], state)}</span>`;
            return this._applyMD(before, state) + tagHtml + this._parseSegment(after, state);
        }

        if (useBROWSE) {
            const before      = text.slice(0, browseM.index);
            const after       = text.slice(browseM.index + browseM[0].length);
            const safeBrowse  = browseM[1].replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const tagHtml     = `<span class="scp-browse-link" onclick="CmdBrowse.execute(['${safeBrowse}'], TerminalAPI)">[BROWSE: ${this._applyMD(browseM[2], state)}]</span>`;
            return this._applyMD(before, state) + tagHtml + this._parseSegment(after, state);
        }

        const { index, full, name, attr } = earliest;
        const innerStart = index + full.length;
        const closeIdx   = this._findMatchingClose(text, name, innerStart);

        if (closeIdx === -1) {
            // Незакрытый тег — пропускаем, обрабатываем хвост
            return this._applyMD(text.slice(0, innerStart), state) + this._parseSegment(text.slice(innerStart), state);
        }

        const before    = text.slice(0, index);
        const inner     = text.slice(innerStart, closeIdx);
        const after     = text.slice(closeIdx + `[/${name}]`.length);
        const innerHtml = this._parseSegment(inner, state);
        const tagHtml   = this._renderTag(name, attr, innerHtml);

        return this._applyMD(before, state) + tagHtml + this._parseSegment(after, state);
    }

    /**
     * 6. Точка входа инлайн-парсера.
     *    Сначала обрабатывает переключатели [DISABLE=TAGS/MD] / [ENABLE=TAGS/MD],
     *    затем вызывает _parseSegment или _applyMD по флагам.
     */
    _applyInlineMarkdown(text, state) {
        // Инлайн [SCROLLSPEED=N] / [TIMER=N] → невидимые DOM-маркеры.
        // Скорость и паузы применяются в _animateElement по мере прохода по словам,
        // что позволяет синхронизировать их с аудио в любом месте строки.
        text = text.replace(
            /\[SCROLLSPEED=([0-9.]+)\]/gi,
            (_, v) => `<span class="scp-speed-marker" data-speed="${v}" style="display:none"></span>`
        );
        text = text.replace(
            /\[TIMER=([0-9.]+)\]/gi,
            (_, v) => `<span class="scp-timer-marker" data-delay="${v}" style="display:none"></span>`
        );

        const controlRe = /(\[DISABLE=TAGS\]|\[ENABLE=TAGS\]|\[DISABLE=MD\]|\[ENABLE=MD\])/gi;
        const tokens    = text.split(controlRe);
        let result = '';

        for (const token of tokens) {
            const lower = token.toLowerCase();
            if (lower === '[disable=tags]') { state.disableTags = true;  continue; }
            if (lower === '[enable=tags]')  { state.disableTags = false; continue; }
            if (lower === '[disable=md]')   { state.disableMD  = true;  continue; }
            if (lower === '[enable=md]')    { state.disableMD  = false; continue; }
            if (!token) continue;
            result += state.disableTags ? this._applyMD(token, state) : this._parseSegment(token, state);
        }
        return result;
    }

    // =========================================================================
    //  АНИМАЦИЯ
    // =========================================================================

    /** Оборачивает текстовые узлы в <span class="word"> для пословной анимации. */
    _wrapWords(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const frag = document.createDocumentFragment();
            if (this._charMode) {
                // Посимвольный режим: символы каждого слова упакованы в display:inline-block,
                // чтобы браузер не мог перенести строку внутри слова.
                node.nodeValue.split(' ').forEach((word, i, arr) => {
                    if (word.length > 0) {
                        const wordWrap = document.createElement('span');
                        wordWrap.style.cssText = 'display:inline-block; white-space:nowrap;';
                        for (const char of word) {
                            const span = document.createElement('span');
                            span.className = 'word';
                            span.textContent = char;
                            wordWrap.appendChild(span);
                        }
                        frag.appendChild(wordWrap);
                    }
                    if (i < arr.length - 1) frag.appendChild(document.createTextNode(' '));
                });
            } else {
                // Пословный режим (по умолчанию)
                node.nodeValue.split(' ').forEach((word, i, arr) => {
                    if (word.trim()) {
                        const span = document.createElement('span');
                        span.className = 'word';
                        span.textContent = word;
                        frag.appendChild(span);
                    }
                    if (i < arr.length - 1) frag.appendChild(document.createTextNode(' '));
                });
            }
            return frag;
        }
        // Глитч-спаны — атомарные единицы анимации: весь спан оборачивается в один .word.
        // Внутрь рекурсировать нельзя: глитч-цикл делает el.textContent = ...,
        // что уничтожает любые дочерние .word-спаны и ломает reveal-анимацию.
        if (node.nodeType === Node.ELEMENT_NODE && node.classList?.contains('scp-effect-glitch')) {
            const wrapper = document.createElement('span');
            wrapper.className = 'word';
            wrapper.appendChild(node.cloneNode(true));
            return wrapper;
        }

        const clone = node.cloneNode(false);
        node.childNodes.forEach(child => clone.appendChild(this._wrapWords(child)));
        return clone;
    }

    /**
     * Анимирует появление элемента.
     * Текстовые элементы: пословно с задержкой currentSpeed мс/слово.
     * Структурные (hr, div-разделители): задержка пропорциональна скорости.
     */
    /**
     * После анимации заменяет все <span class="word"> обратно на текстовые узлы.
     * Резко снижает количество DOM-узлов — с тысяч до единиц.
     */
    _unwrapWords(el) {
        el.querySelectorAll('.word').forEach(span => {
            if (span.childElementCount === 0) {
                // Чистый текст — заменяем на текстовый узел (оптимизация DOM)
                span.replaceWith(document.createTextNode(span.textContent));
            } else {
                // Внутри живые элементы (глитч, ссылки, CMD) —
                // НЕ двигаем из DOM — иначе браузер сбросит CSS-анимацию глитча.
                // Просто снимаем служебные классы и фиксируем видимость на месте.
                span.classList.remove('word', 'revealed');
                span.style.cssText = 'opacity:1; display:inline; background:transparent;';
            }
        });
        el.normalize();
    }

    async _animateElement(el) {
        const nodes = el.querySelectorAll('.word, .scp-speed-marker, .scp-timer-marker');
        if (nodes.length > 0) {
            // При скипе — показываем все слова разом без анимации
            if (this._skip) {
                el.classList.add('skip-reveal');
                await this._delay(0); // один кадр — браузер применяет стили
                this._unwrapWords(el);
                el.classList.remove('skip-reveal');
                return;
            }
            for (const node of nodes) {
                if (this._skip) {
                    el.classList.add('skip-reveal');
                    await this._delay(0);
                    this._unwrapWords(el);
                    el.classList.remove('skip-reveal');
                    return;
                }
                // Маркер скорости: меняем currentSpeed и продолжаем без задержки
                if (node.classList.contains('scp-speed-marker')) {
                    this.currentSpeed = Math.max(1, parseFloat(node.dataset.speed));
                    continue;
                }
                // Маркер паузы: ждём N секунд (skip обнуляет задержку)
                if (node.classList.contains('scp-timer-marker')) {
                    await this._delay(parseFloat(node.dataset.delay) * 1000);
                    continue;
                }
                node.classList.add('revealed');
                await this._delay(this.currentSpeed);
                this._scheduleScroll();
            }
            // Анимация завершена — ждём конца CSS (0.18s) и чистим спаны
            await this._delay(190);
            this._unwrapWords(el);
        } else {
            el.classList.add('visible');
            await this._delay(Math.max(40, this.currentSpeed * 2.5));
        }
    }

    // =========================================================================
    //  ГЛАВНЫЙ РЕНДЕР
    // =========================================================================

    /**
     * Парсит и рендерит текст в output пословно с анимацией.
     *
     * @param {string}  content         Текст файла
     * @param {Element} output          DOM-узел для вывода
     * @param {string}  basePath        Базовый путь для ресурсов, напр. "dossiers/01-B/"
     * @param {object}  [localImageMap] Карта имён → data-URL для локальных изображений
     * @param {object}  [renderStartEnd] Выводить [НАЧАЛО ДОКУМЕНТА] и [КОНЕЦ ДОКУМЕНТА]
     */
    async render(content, output, basePath, localImageMap = {}, renderStartEnd = true) {
        this._output = output;
        this.currentSpeed = this.defaultSpeed;
        this._charMode = false;
        if (this._scrollRafId) {
            cancelAnimationFrame(this._scrollRafId);
            this._scrollRafId = null;
        }
        // Обнуляем самокорректирующиеся часы при каждом новом render().
        // Оба поля должны сбрасываться вместе — иначе drift от предыдущего
        // рендера «протечёт» в следующий и первые паузы окажутся слишком короткими.
        this._clockStart    = performance.now();
        this._clockExpected = 0;

        const lines = content.split('\n');
        const parserState = {disableTags: false, disableMD: false};

        let currentTable    = null;
        let currentQuote    = null;
        let currentFootnote = null;
        let currentList     = null;

        // Регулярки вынесены за пределы цикла — не пересоздаются на каждой строке
        const RE_SPEED    = /^\[SCROLLSPEED=([0-9.]+)\]$/i;
        const RE_TIMER    = /^\[TIMER=([0-9.]+)\]$/i;
        const RE_CHARMODE = /^\[CHARMODE\]$/i;
        const RE_WORDMODE = /^\[WORDMODE\]$/i;
        const RE_H1       = /^\[H1\]|^#(?!#)/i;
        const RE_H2       = /^\[H2\]|^##(?!#)/i;
        const RE_H3       = /^\[H3\]|^###/i;
        const RE_LIST     = /^[-*]\s+/;

        this._resetTheme();
        if (renderStartEnd) {
            // Маркер начала документа
            const startLine = document.createElement('div');
            startLine.classList.add('doc-line');
            startLine.appendChild(Object.assign(document.createElement('span'), {textContent: '[НАЧАЛО ДОКУМЕНТА]'}));
            output.appendChild(startLine);
        }
        try {
            for (let line of lines) {
                line = line.trim();
                if (!line) continue;

                // ── !COM — комментарий, строка полностью игнорируется ─────────
                //    Пример: !COM Это служебная заметка, игрок её не увидит
                if (line.startsWith('!COM')) continue;

                const speedMatch = RE_SPEED.exec(line);
                if (speedMatch) {
                    this.currentSpeed = Math.max(1, parseFloat(speedMatch[1]));
                    continue;
                }

                const timerMatch = RE_TIMER.exec(line);
                if (timerMatch) {
                    await this._delay(parseFloat(timerMatch[1]) * 1000);
                    continue;
                }

                if (RE_CHARMODE.test(line)) { this._charMode = true;  continue; }
                if (RE_WORDMODE.test(line)) { this._charMode = false; continue; }

                // ── [COLORCODES] — переопределение цветовой темы ─────────────
                if (line.startsWith('[COLORCODES]')) {
                    const colors = {};
                    line.replace('[COLORCODES]', '').split(';').forEach(pair => {
                        const [k, v] = pair.split('=');
                        if (k && v) colors[k.trim()] = v.trim();
                    });
                    this._applyTheme(colors);
                    continue;
                }

                // ── Закрывающие теги блоков ───────────────────────────────────
                if (line.startsWith('[/TABLE6]'))   { currentTable    = null; continue; }
                if (line.startsWith('[/FOOTNOTE]')) { currentFootnote = null; continue; }
                if (line.startsWith('[/QUOTE]'))    { currentQuote    = null; continue; }

                let el;
                let targetContainer = output;

                // ─────────────────────────────────────────────────────────────
                //  БЛОЧНЫЕ ТЕГИ
                // ─────────────────────────────────────────────────────────────

                if (line.startsWith('[TITLE]')) {
                    el = document.createElement('span');
                    el.className = 'glitch-title';
                    el.textContent = line.replace('[TITLE]', '').trim();

                } else if (line.startsWith('[DANGER]')) {
                    el = document.createElement('div');
                    el.className = 'danger-diamond';
                    el.textContent = line.replace('[DANGER]', '').trim();

                } else if (line.startsWith('[IMAGE]')) {
                    const parts     = line.replace('[IMAGE]', '').split('||');
                    const imageName = parts[0].trim();
                    const caption   = parts[1] ? parts[1].trim() : '';
                    const mode      = parts[2] ? parts[2].trim().toLowerCase() : 'right';
                    const scale     = parts[3] ? parseFloat(parts[3].trim()) : 1;

                    el = document.createElement('div');
                    el.className = `scp-image-container ${mode}-mode visible`;
                    if (!isNaN(scale)) el.style.setProperty('--img-scale', scale);

                    const imageSrc = (localImageMap && localImageMap[imageName])
                        ? localImageMap[imageName]
                        : `${basePath}images/${imageName}`;

                    el.innerHTML = `<img src="${imageSrc}" alt="${caption}"><div class="scp-image-caption">${caption}</div>`;

                } else if (line.startsWith('[TABLE6]')) {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'table-wrapper visible';
                    currentTable = document.createElement('table');
                    currentTable.className = 'table6';
                    wrapper.appendChild(currentTable);
                    el = wrapper;

                } else if (line.startsWith('[QUOTE]')) {
                    currentQuote = document.createElement('blockquote');
                    el = currentQuote;

                } else if (line.startsWith('[FOOTNOTE]')) {
                    currentFootnote = document.createElement('div');
                    currentFootnote.className = 'footnote';
                    el = currentFootnote;
                } else {

                    // ─────────────────────────────────────────────────────────
                    //  СТРОКИ ВНУТРИ ТАБЛИЦЫ
                    // ─────────────────────────────────────────────────────────
                    if (currentTable && line.includes('||')) {
                        const tr = document.createElement('tr');
                        line.split('||').forEach(cellText => {
                            const td   = document.createElement('td');
                            const html = this._applyInlineMarkdown(cellText.trim(), parserState);
                            const temp = document.createElement('div');
                            temp.innerHTML = html;
                            Array.from(temp.childNodes).forEach(n => td.appendChild(this._wrapWords(n)));
                            tr.appendChild(td);
                        });
                        currentTable.appendChild(tr);

                        const words = tr.querySelectorAll('.word');
                        if (words.length > 0) {
                            if (this._skip) {
                                tr.classList.add('skip-reveal');
                                await this._delay(0);
                                this._unwrapWords(tr);
                                tr.classList.remove('skip-reveal');
                            } else {
                                for (const w of words) {
                                    if (this._skip) {
                                        tr.classList.add('skip-reveal');
                                        await this._delay(0);
                                        this._unwrapWords(tr);
                                        tr.classList.remove('skip-reveal');
                                        break;
                                    }
                                    w.classList.add('revealed');
                                    await this._delay(this.currentSpeed);
                                    this._scheduleScroll();
                                }
                                // Анимация строки завершена — чистим спаны
                                await this._delay(190);
                                this._unwrapWords(tr);
                            }
                        } else {
                            tr.classList.add('visible');
                            await this._delay(100);
                        }
                        continue;
                    }

                    // ─────────────────────────────────────────────────────────
                    //  ОБЫЧНЫЕ СТРОКИ: MARKDOWN + КАСТОМНЫЕ ТЕГИ
                    // ─────────────────────────────────────────────────────────
                    let isListItem      = false;
                    const listMatch     = line.match(/^[-*]\s+(.*)/);
                    const mdHeaderMatch = line.match(/^(#{1,6})\s+(.*)/);

                    if (listMatch) {
                        isListItem = true;
                        el = document.createElement('li');
                        line = listMatch[1];

                    } else if (line === '---' || line === '***') {
                        el = document.createElement('hr');
                        el.className = 'scp-hr';
                        line = '';

                    } else if (line === '.') {
                        el = document.createElement('div');
                        el.style.height = '1.5em';
                        line = '';

                    } else if (mdHeaderMatch) {
                        const level = mdHeaderMatch[1].length;
                        el = document.createElement(`h${level}`);
                        el.classList.add('scp-header', `scp-h${level}`);
                        line = mdHeaderMatch[2];

                    } else {
                        // Поддержка устаревших заголовков [H1]–[H6]
                        const legacyHeader = line.match(/^\[H([1-6])\]/i);
                        if (legacyHeader) {
                            const level = legacyHeader[1];
                            el = document.createElement(`h${level}`);
                            el.classList.add('scp-header', `scp-h${level}`);
                            line = line.replace(legacyHeader[0], '').trim();
                        } else {
                            el = document.createElement('p');
                        }
                    }

                    // [CENTER] — выравнивание по центру
                    if (line.includes('[CENTER]')) {
                        el.classList.add('center');
                        line = line.replace('[CENTER]', '').trim();
                    }

                    // Управление контейнерами: списки, цитаты, сноски
                    if (isListItem) {
                        if (!currentList) {
                            currentList = document.createElement('ul');
                            currentList.className = 'scp-list';
                            const parent = currentQuote ?? currentFootnote ?? output;
                            parent.appendChild(currentList);
                        }
                        targetContainer = currentList;
                    } else {
                        currentList = null;
                        targetContainer = currentQuote ?? currentFootnote ?? output;
                    }

                    const html = this._applyInlineMarkdown(line, parserState);
                    const temp = document.createElement('div');
                    temp.innerHTML = html;
                    // Используем фрагмент чтобы избежать лишних reflow при вставке узлов
                    const frag = document.createDocumentFragment();
                    temp.childNodes.forEach(n => frag.appendChild(this._wrapWords(n)));
                    el.appendChild(frag);
                }
                targetContainer.appendChild(el);
                await this._animateElement(el);
            }

        } catch (e) {
            if (e.name !== 'AbortError') throw e;
            return;
        }
        if (renderStartEnd) {
            // Маркер конца документа
            const endLine = document.createElement('div');
            endLine.classList.add('doc-line');
            endLine.appendChild(Object.assign(document.createElement('span'), {textContent: '[КОНЕЦ ДОКУМЕНТА]'}));
            output.appendChild(endLine);
            this._scheduleScroll();
        }
        this._skip = false;
    }
}
