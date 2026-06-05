// =============================================================================
//  settings.js — Меню настроек сайта
//  Открывается командой: settings
//  Использует WindowManager для отображения.
//
//  Настройки сохраняются в localStorage под ключом 'scipnet_settings'
//  и применяются при каждой загрузке страницы.
// =============================================================================

const Settings = (() => {

    // ── Дефолтные значения ────────────────────────────────────────────────────
    const DEFAULTS = {
        scanlines:    true,
        vignette:     true,
        flicker:      true,
        animSpeed:    38,
        themeColor:   '#a200ff',
        terminalFont: 'JetBrains Mono',
        uiVolume:     50,   // громкость UI-звуков (0–100)
        echoVolume:   75,   // громкость ECHO-записей (0–100)
    };

    // ── Загрузка / сохранение ─────────────────────────────────────────────────
    function load() {
        try {
            return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('scipnet_settings') || '{}'));
        } catch { return { ...DEFAULTS }; }
    }

    function save(cfg) {
        localStorage.setItem('scipnet_settings', JSON.stringify(cfg));
    }

    // ── Применить настройки к странице ───────────────────────────────────────
    function apply(cfg) {
        const sl = document.getElementById('crt-scanlines');
        const vi = document.getElementById('crt-vignette');
        const ct = document.getElementById('container');

        if (sl) sl.style.display = cfg.scanlines ? '' : 'none';
        if (vi) vi.style.display = cfg.vignette  ? '' : 'none';
        if (ct) {
            ct.style.animationName = cfg.flicker ? 'crtFlicker' : 'none';
        }

        // Цвет темы
        document.documentElement.style.setProperty('--theme-color',       cfg.themeColor);
        document.documentElement.style.setProperty('--theme-quote-border', cfg.themeColor);
        document.documentElement.style.setProperty('--theme-quote-bg',
            cfg.themeColor + '18');
        document.documentElement.style.setProperty('--theme-table-bg',
            cfg.themeColor + '33');

        // Шрифт терминала
        document.documentElement.style.setProperty('--mono-font',
            `'${cfg.terminalFont}', monospace`);

        // Громкость аудио
        if (typeof AudioHandler !== 'undefined') AudioHandler.applyVolumes(cfg);
    }

    // ── Построить HTML меню ───────────────────────────────────────────────────
    function buildHTML(cfg) {
        const THEME_PRESETS = [
            { color: '#a200ff', label: 'Мираж'    },
            { color: '#00ff41', label: 'Матрица'  },
            { color: '#00ccff', label: 'Лиоко'    },
            { color: '#ff4060', label: 'Опасность'},
            { color: '#ffaa00', label: 'Янтарь'   },
            { color: '#ff00aa', label: 'Неон'     },
        ];

        const swatches = THEME_PRESETS.map(p => `
            <div class="lk-swatch ${cfg.themeColor === p.color ? 'selected' : ''}"
                 style="background:${p.color}; color:${p.color}"
                 data-color="${p.color}"
                 title="${p.label}"></div>
        `).join('');

        return `
        <div class="lk-settings">
            <!-- Боковая навигация -->
            <nav class="lk-nav">
                <div class="lk-nav-item active" data-panel="visuals">
                    <span class="lk-nav-icon">◈</span> Экран
                </div>
                <div class="lk-nav-item" data-panel="anim">
                    <span class="lk-nav-icon">▶</span> Анимация
                </div>
                <div class="lk-nav-item" data-panel="audio">
                    <span class="lk-nav-icon">♪</span> Аудио
                </div>
                <div class="lk-nav-item" data-panel="theme">
                    <span class="lk-nav-icon">◉</span> Тема
                </div>
                <div class="lk-nav-item" data-panel="system">
                    <span class="lk-nav-icon">⬡</span> Система
                </div>
            </nav>

            <!-- Панели -->
            <div class="lk-panels">

                <!-- ── Экран ── -->
                <div class="lk-panel active" data-panel="visuals">
                    <div>
                        <div class="lk-group-label">CRT Эффекты</div>
                        <div class="lk-row">
                            <div>
                                <div class="lk-label">Scanlines</div>
                                <div class="lk-hint">Горизонтальные полосы</div>
                            </div>
                            <div class="lk-toggle ${cfg.scanlines ? 'on' : ''}" data-key="scanlines"></div>
                        </div>
                        <div class="lk-row">
                            <div>
                                <div class="lk-label">Виньетка</div>
                                <div class="lk-hint">Затемнение краёв экрана</div>
                            </div>
                            <div class="lk-toggle ${cfg.vignette ? 'on' : ''}" data-key="vignette"></div>
                        </div>
                        <div class="lk-row">
                            <div>
                                <div class="lk-label">Мерцание</div>
                                <div class="lk-hint">Анимация CRT-дрожания</div>
                            </div>
                            <div class="lk-toggle ${cfg.flicker ? 'on' : ''}" data-key="flicker"></div>
                        </div>
                    </div>
                </div>

                <!-- ── Анимация ── -->
                <div class="lk-panel" data-panel="anim">
                    <div>
                        <div class="lk-group-label">Скорость вывода текста</div>
                        <div class="lk-row">
                            <div class="lk-label">Задержка (мс/слово)</div>
                            <div class="lk-slider-wrap">
                                <input type="range" class="lk-slider"
                                    data-key="animSpeed"
                                    min="5" max="150" step="5"
                                    value="${cfg.animSpeed}">
                                <span class="lk-slider-val">${cfg.animSpeed}</span>
                            </div>
                        </div>
                        <div class="lk-hint" style="margin-top:-8px">
                            5 = мгновенно · 38 = стандарт · 150 = атмосферно
                        </div>
                    </div>
                </div>

                <!-- ── Аудио ── -->
                <div class="lk-panel" data-panel="audio">
                    <div>
                        <div class="lk-group-label">Громкость</div>
                        <div class="lk-row">
                            <div class="lk-label">UI-звуки</div>
                            <div class="lk-slider-wrap">
                                <input type="range" class="lk-slider"
                                    data-key="uiVolume"
                                    min="0" max="100" step="5"
                                    value="${cfg.uiVolume}">
                                <span class="lk-slider-val">${cfg.uiVolume}</span>
                            </div>
                        </div>
                        <div class="lk-row">
                            <div class="lk-label">ECHO-записи</div>
                            <div class="lk-slider-wrap">
                                <input type="range" class="lk-slider"
                                    data-key="echoVolume"
                                    min="0" max="100" step="5"
                                    value="${cfg.echoVolume}">
                                <span class="lk-slider-val">${cfg.echoVolume}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ── Тема ── -->
                <div class="lk-panel" data-panel="theme">
                    <div>
                        <div class="lk-group-label">Цвет акцента</div>
                        <div class="lk-row" style="flex-wrap:wrap; gap:8px">
                            <div class="lk-swatches">${swatches}</div>
                            <input type="color" class="lk-color-input"
                                   data-key="themeColor"
                                   value="${cfg.themeColor}"
                                   title="Свой цвет">
                        </div>
                        <div class="lk-hint" style="margin-top:4px">
                            Влияет на заголовки, таблицы и ссылки в досье
                        </div>
                    </div>
                    <div>
                        <div class="lk-group-label">Шрифт терминала</div>
                        <div class="lk-row">
                            <div class="lk-label">Моноширинный</div>
                            <select class="lk-select" data-key="terminalFont">
                                <option value="JetBrains Mono" ${cfg.terminalFont === 'JetBrains Mono' ? 'selected' : ''}>JetBrains Mono</option>
                                <option value="VT323"          ${cfg.terminalFont === 'VT323'          ? 'selected' : ''}>VT323 (ретро)</option>
                                <option value="Courier New"    ${cfg.terminalFont === 'Courier New'    ? 'selected' : ''}>Courier New</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- ── Система ── -->
                <div class="lk-panel" data-panel="system">
                    <div>
                        <div class="lk-group-label">Кэш и данные</div>
                        <div class="lk-row">
                            <div>
                                <div class="lk-label">Кэш досье</div>
                                <div class="lk-hint">Список папок из GitHub API</div>
                            </div>
                            <button class="lk-btn" id="lk-clear-cache">Очистить</button>
                        </div>
                        <div class="lk-row">
                            <div>
                                <div class="lk-label">Сбросить настройки</div>
                                <div class="lk-hint">Вернуть всё по умолчанию</div>
                            </div>
                            <button class="lk-btn danger" id="lk-reset-settings">Сброс</button>
                        </div>
                    </div>
                    <div>
                        <div class="lk-group-label">Сессия</div>
                        <div class="lk-row">
                            <div>
                                <div class="lk-label">Повторить интро</div>
                                <div class="lk-hint">Авторизация + сплэш при перезагрузке</div>
                            </div>
                            <button class="lk-btn danger" id="lk-reboot">Reboot</button>
                        </div>
                    </div>
                </div>

            </div>
        </div>`;
    }

    // ── Навесить обработчики на меню ──────────────────────────────────────────
    function bindEvents(container, cfg) {

        // Навигация
        container.querySelectorAll('.lk-nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const target = item.dataset.panel;
                container.querySelectorAll('.lk-nav-item').forEach(i => i.classList.remove('active'));
                container.querySelectorAll('.lk-panel').forEach(p => p.classList.remove('active'));
                item.classList.add('active');
                container.querySelector(`.lk-panel[data-panel="${target}"]`).classList.add('active');
            });
        });

        // Тогглы
        container.querySelectorAll('.lk-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                toggle.classList.toggle('on');
                cfg[toggle.dataset.key] = toggle.classList.contains('on');
                save(cfg);
                apply(cfg);
            });
        });

        // Слайдеры
        container.querySelectorAll('.lk-slider').forEach(slider => {
            const valEl = slider.nextElementSibling;
            slider.addEventListener('input', () => {
                const v = parseInt(slider.value);
                valEl.textContent = v;
                cfg[slider.dataset.key] = v;
                save(cfg);
                apply(cfg);
            });
        });

        // Select
        container.querySelectorAll('.lk-select').forEach(sel => {
            sel.addEventListener('change', () => {
                cfg[sel.dataset.key] = sel.value;
                save(cfg);
                apply(cfg);
            });
        });

        // Свотчи
        container.querySelectorAll('.lk-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                container.querySelectorAll('.lk-swatch').forEach(s => s.classList.remove('selected'));
                swatch.classList.add('selected');
                cfg.themeColor = swatch.dataset.color;
                const colorInput = container.querySelector('.lk-color-input');
                if (colorInput) colorInput.value = cfg.themeColor;
                save(cfg);
                apply(cfg);
            });
        });

        // Кастомный цвет
        const colorInput = container.querySelector('.lk-color-input');
        if (colorInput) {
            colorInput.addEventListener('input', () => {
                container.querySelectorAll('.lk-swatch').forEach(s => s.classList.remove('selected'));
                cfg.themeColor = colorInput.value;
                save(cfg);
                apply(cfg);
            });
        }

        // Кнопки системы
        const clearCache = container.querySelector('#lk-clear-cache');
        if (clearCache) {
            clearCache.addEventListener('click', () => {
                sessionStorage.removeItem('dossier_folders_cache');
                clearCache.textContent = 'Готово ✓';
                setTimeout(() => { clearCache.textContent = 'Очистить'; }, 1500);
            });
        }

        const resetBtn = container.querySelector('#lk-reset-settings');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                Object.assign(cfg, DEFAULTS);
                save(cfg);
                apply(cfg);
                // Перерисовываем меню с дефолтными значениями
                Settings.open();
            });
        }

        const rebootBtn = container.querySelector('#lk-reboot');
        if (rebootBtn) {
            rebootBtn.addEventListener('click', () => {
                localStorage.removeItem('has_seen_intro');
                WindowManager.close('settings');
                setTimeout(() => location.reload(), 300);
            });
        }
    }

    // ── Публичный API ─────────────────────────────────────────────────────────

    function open() {
        const cfg = load();
        const html = buildHTML(cfg);

        WindowManager.open('settings', 'СИСТЕМНЫЕ НАСТРОЙКИ', html, {
            width:    740,
            height:   620,
            status:   'SCIPNET CONFIG v1.0',
            isResizable: false,
            backdrop: true
        });

        // Навешиваем события после вставки в DOM
        requestAnimationFrame(() => {
            const container = document.querySelector('.lyoko-window[data-id="settings"] .lyoko-content');
            if (container) bindEvents(container, cfg);
        });
    }

    // Применяем сохранённые настройки при загрузке страницы
    function init() {
        apply(load());
    }

    return { open, init };

})();

// Применяем настройки сразу при загрузке скрипта
Settings.init();