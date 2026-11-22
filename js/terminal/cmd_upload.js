const CmdUpload = {
    // Хранилище для накопления файлов (чтобы можно было догружать по очереди)
    sessionFiles:   {},
    dossierContent: "",
    dossierName:    "",
    audioBlob:      null,   // локальный mp3 (object URL)
    audioName:      "",

    async execute(args, terminal) {
        terminal.unlockInput();
        // Сбрасываем сессию при новом вызове команды
        this.sessionFiles   = {};
        this.dossierContent = "";
        this.dossierName    = "";
        this.audioBlob      = null;
        this.audioName      = "";

        terminal.printSystem("[СИСТЕМА] Ожидание выбора файлов...");
        await this.promptForFiles(terminal);
    },

    // -------------------------------------------------------------------------
    //  ВЫБОР ФАЙЛОВ
    // -------------------------------------------------------------------------

    async promptForFiles(terminal) {
        return new Promise((resolve) => {
            const fileInput   = document.createElement('input');
            fileInput.type    = 'file';
            fileInput.multiple = true;
            fileInput.accept  = '.txt,.mp3,image/*';

            fileInput.onchange = async (event) => {
                const files = Array.from(event.target.files);

                // 1. Текстовый файл досье
                const txtFile = files.find(f => f.name.toLowerCase().endsWith('.txt'));
                if (txtFile && !this.dossierContent) {
                    this.dossierContent = await txtFile.text();
                    this.dossierName    = txtFile.name;
                }

                // 2. Аудиофайл
                const mp3File = files.find(f => f.name.toLowerCase().endsWith('.mp3'));
                if (mp3File) {
                    // Освобождаем предыдущий blob-URL если был
                    if (this.audioBlob) URL.revokeObjectURL(this.audioBlob);
                    this.audioBlob = URL.createObjectURL(mp3File);
                    this.audioName = mp3File.name;
                }

                // 3. Изображения
                const imageFiles = files.filter(f => f.type.startsWith('image/'));
                for (const img of imageFiles) {
                    this.sessionFiles[img.name] = await this.fileToBase64(img);
                }

                // ── Ветка: обнаружен mp3 ─────────────────────────────────────
                if (this.audioBlob) {
                    if (this.dossierContent) {
                        // Текст уже есть → сразу echo-playback
                        await this.startEchoPlayback(terminal);
                    } else {
                        // Текста нет → спрашиваем
                        terminal.printSystem(
                            `ОБНАРУЖЕН АУДИОФАЙЛ: ${this.audioName}`
                        );
                        this._askForEchoText(terminal);
                    }
                    resolve();
                    return;
                }

                // ── Ветка: обычное досье (txt + картинки) ───────────────────
                if (!this.dossierContent) {
                    terminal.printError("КРИТИЧЕСКАЯ ОШИБКА: Файл конфигурации (.txt) не найден.");
                    resolve();
                    return;
                }

                const missing = this.getMissingImages();

                if (missing.length > 0) {
                    terminal.printError(`НЕДОСТАТОЧНО ФАЙЛОВ!`);
                    terminal.printSystem(`Для корректного отображения догрузите: ${missing.join(', ')}`);
                    this._addActionBtn(
                        '> ОЖИДАНИЕ ДЕЙСТВИЯ ОПЕРАТОРА: НАЖМИТЕ ДЛЯ ДОЗАГРУЗКИ ФАЙЛОВ <',
                        () => this.promptForFiles(terminal)
                    );
                } else {
                    await this.startRendering(terminal);
                }

                resolve();
            };

            fileInput.click();
        });
    },

    // -------------------------------------------------------------------------
    //  UI: ЗАПРОС ТЕКСТА ДЛЯ ECHO
    // -------------------------------------------------------------------------

    /**
     * Показывает два варианта:
     *   [ЗАГРУЗИТЬ ТЕКСТОВЫЙ ФАЙЛ] — открывает picker только для .txt
     *   [ВОСПРОИЗВЕСТИ БЕЗ ТЕКСТА] — только аудио
     */
    _askForEchoText(terminal) {
        const outNode = TerminalAPI.getOutputNode();

        // Кнопка «загрузить текст»
        this._addActionBtn(
            '> ЗАГРУЗИТЬ ТЕКСТОВЫЙ ФАЙЛ ДЛЯ СУБТИТРОВ <',
            () => this._pickTextFile(terminal)
        );

        // Кнопка «пропустить»
        this._addActionBtn(
            '> ВОСПРОИЗВЕСТИ БЕЗ ТЕКСТА <',
            () => this.startEchoPlayback(terminal)
        );
    },

    /** Открывает file picker строго на .txt */
    _pickTextFile(terminal) {
        const input   = document.createElement('input');
        input.type    = 'file';
        input.accept  = '.txt';

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

                // Запускаем аудио НЕМЕДЛЕННО — до любого await,
                // пока браузер ещё считает это доверенным жестом пользователя.
                // После await file.text() контекст жеста теряется и play() блокируется.
                // AudioHandler.play() вызывает audio.play() синхронно.
                const audioId = AudioHandler.play(this.audioBlob, {
                    onFail: () => terminal.printSystem('⚠ АУДИО НЕДОСТУПНО — ТОЛЬКО СУБТИТРЫ'),
                });

                // Теперь можно await — аудио уже в воздухе
                this.dossierContent = await file.text();
                this.dossierName    = file.name;

                // Скорость/питч/плёнка из метаданных текста — на лету,
                // т.к. старт уже состоялся в жесте пользователя
                const meta = parseEchoMeta(this.dossierContent);
                AudioHandler.setTape(audioId, meta.tape);
                AudioHandler.setSpeed(audioId, meta.speed);
                AudioHandler.setPitch(audioId, meta.pitch);

                terminal.printSystem(`ТЕКСТОВЫЙ ФАЙЛ ЗАГРУЖЕН: ${file.name}`);
                await this.startEchoPlayback(terminal, audioId);
        };

        input.click();
    },

    // -------------------------------------------------------------------------
    //  ECHO-PLAYBACK (локальные файлы)
    // -------------------------------------------------------------------------

    // audioId — опциональный уже запущенный звук в AudioHandler (из _pickTextFile).
    // Если не передан — создаём и запускаем здесь (прямой клик, жест не потерян).
    async startEchoPlayback(terminal, audioId = null) {
        // Убираем кнопки выбора если остались
        document.querySelectorAll('.operator-action-btn').forEach(b => b.remove());

        terminal.printSystem(`— ВОСПРОИЗВЕДЕНИЕ: ${this.audioName} —`);

        // Метаданные скорости/питча/плёнки из загруженного текста
        const meta = this.dossierContent
            ? parseEchoMeta(this.dossierContent)
            : { speed: 1.0, pitch: 1.0, tape: false };

        if (!audioId) {
            // Вызов из кнопки «ВОСПРОИЗВЕСТИ БЕЗ ТЕКСТА» — жест ещё живой
            audioId = AudioHandler.play(this.audioBlob, {
                speed:  meta.speed,
                pitch:  meta.pitch,
                tape:   meta.tape,
                onFail: () => terminal.printSystem('⚠ АУДИО НЕДОСТУПНО — ТОЛЬКО СУБТИТРЫ'),
            });
        }

        const outputContainer = TerminalAPI.getOutputNode();
        const renderer        = new StepRenderer();
        renderer.timeScale    = meta.speed;   // субтитры едут со скоростью аудио
        renderer.audioClock   = () => AudioHandler.getElapsed(audioId);  // [AT]/[SYNC]

        // Баннер прерывания
        const banner = this._makeBanner(
            'НАЖМИТЕ ПРОБЕЛ ИЛИ КЛИКНИТЕ ЗДЕСЬ, ЧТОБЫ ОСТАНОВИТЬ АУДИО',
            () => { AudioHandler.stop(audioId); renderer.skip(); }
        );

        const onKeyDown = (e) => {
            if (e.code === 'Space' || e.key === ' ') {
                if (document.activeElement?.id === 'cmd-input') return;
                e.preventDefault();
                AudioHandler.stop(audioId);
                renderer.skip();
            }
        };
        document.addEventListener('keydown', onKeyDown);

        try {
            if (this.dossierContent) {
                // Есть текст → рендерим с анимацией
                await renderer.render(this.dossierContent, outputContainer, 'local', this.sessionFiles);
            } else {
                // Только аудио → ждём окончания трека
                terminal.printSystem('[АУДИО БЕЗ СУБТИТРОВ]');
                await new Promise((resolve) => {
                    // getElapsed → null = звук закончился/остановлен/не заиграл
                    const checkDone = setInterval(() => {
                        if (renderer._skip || AudioHandler.getElapsed(audioId) == null) {
                            clearInterval(checkDone);
                            resolve();
                        }
                    }, 100);
                });
            }
        } finally {
            banner.remove();
            document.removeEventListener('keydown', onKeyDown);
            AudioHandler.stop(audioId);   // no-op, если уже закончилось/остановлено
        }
    },

    // -------------------------------------------------------------------------
    //  РЕНДЕР ДОСЬЕ (обычный)
    // -------------------------------------------------------------------------

    async startRendering(terminal) {
        terminal.printSystem(`[СИСТЕМА] Проверка целостности пройдена.`);
        terminal.printSystem(`[СИСТЕМА] Чтение досье: ${this.dossierName}...`);
        terminal.printSystem(`---`);

        const outputContainer = TerminalAPI.getOutputNode();
        const renderer        = new StepRenderer();

        // Баннер пропуска анимации
        const banner = this._makeBanner(
            'НАЖМИТЕ ПРОБЕЛ ИЛИ КЛИКНИТЕ ЗДЕСЬ, ЧТОБЫ ПРОПУСТИТЬ АНИМАЦИЮ',
            () => renderer.skip()
        );

        const onKeyDown = (e) => {
            if (e.code === 'Space' || e.key === ' ') {
                if (document.activeElement?.id === 'cmd-input') return;
                e.preventDefault();
                renderer.skip();
            }
        };
        document.addEventListener('keydown', onKeyDown);

        try {
            await renderer.render(this.dossierContent, outputContainer, 'local', this.sessionFiles);
        } finally {
            banner.remove();
            document.removeEventListener('keydown', onKeyDown);
        }
    },

    // -------------------------------------------------------------------------
    //  ВСПОМОГАТЕЛЬНЫЕ
    // -------------------------------------------------------------------------

    getMissingImages() {
        const imageTags    = this.dossierContent.match(/\[IMAGE\]\s*([^| \n\r\]]+)/g) || [];
        const requiredNames = imageTags.map(tag => tag.replace('[IMAGE]', '').trim());
        return requiredNames.filter(name => !this.sessionFiles[name]);
    },

    fileToBase64(file) {
        return new Promise((resolve) => {
            const r = new FileReader();
            r.onload  = e => resolve(e.target.result);
            r.readAsDataURL(file);
        });
    },

    /** Создаёт и вставляет баннер под console-area. */
    _makeBanner(text, onClick) {
        const banner       = document.createElement('div');
        banner.id          = 'echo-interrupt-banner';
        banner.textContent = text;
        banner.addEventListener('click', onClick);
        const consoleArea  = document.getElementById('console-area');
        if (consoleArea?.parentNode) {
            consoleArea.insertAdjacentElement('afterend', banner);
        } else {
            document.body.appendChild(banner);
        }
        return banner;
    },

    /** Создаёт кнопку действия оператора и вставляет в output. */
    _addActionBtn(label, onClick) {
        const btn       = document.createElement('div');
        btn.className   = 'operator-action-btn';
        btn.innerHTML   = label;
        btn.onclick     = () => { btn.remove(); onClick(); };
        const outNode   = TerminalAPI.getOutputNode();
        outNode.appendChild(btn);
        outNode.scrollTop = outNode.scrollHeight;
    },
};
