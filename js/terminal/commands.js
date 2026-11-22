// Глобальный список для автодополнения в main.js
const COMMAND_LIST = ['get', 'help', 'clear', 'echo', 'reboot','test-dossier', 'upload','settings','browse','changelogs','plugin','desktop','apps','start'];

const CommandHandler = {
    async execute(rawInput, terminal) {
        const parts = rawInput.trim().split(' ');
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1); // Всё, что идет после названия команды

        switch (cmd) {
            case 'get':
                await CmdGet.execute(args, terminal);
                break;
            case 'clear':
                terminal.clearScreen();
                break;
            case 'help':
                terminal.printSystem("╔══════════════════════════════════════════╗");
                terminal.printSystem("║       SCIPNET // СПРАВОЧНИК КОМАНД       ║");
                terminal.printSystem("╚══════════════════════════════════════════╝");
                terminal.printSystem(" ");
                terminal.printSystem("  GET [запрос]", 'var(--terminal-green)');
                terminal.printSystem("    Поиск и вывод досье по ID или ключевому слову.");
                terminal.printSystem("    Пример: get 01005423 / get izzy");
                terminal.printSystem(`    "get ." - Показывает все доступные досье.`);
                terminal.printSystem(" ");
                terminal.printSystem("  ECHO [ID]", 'var(--terminal-green)');
                terminal.printSystem("    Воспроизведение звуковой записи с субтитрами.");
                terminal.printSystem("    Записи хранятся в папке echoes/. Пример: echo 01");
                terminal.printSystem(" ");
                terminal.printSystem("  UPLOAD", 'var(--terminal-green)');
                terminal.printSystem("    Загрузка и демонстрация локального досье (.txt) с изображениями");
                terminal.printSystem("    и/или аудиозаписью (.mp3) прямо из файловой системы.");
                terminal.printSystem("    ВНИМАНИЕ! Ваше досье никак не загружается на сайт! Подробности внизу!");
                terminal.printSystem(" ");
                terminal.printSystem("  BROWSE [url]", 'var(--terminal-green)');
                terminal.printSystem("    Встроенный браузер. Пример: browse https://scp-wiki.net");
                terminal.printSystem(" ");
                terminal.printSystem("  DESKTOP [on/off]", 'var(--terminal-green)');
                terminal.printSystem("    Рабочий стол SCIPNET OS. Переключение стол ⇄ консоль.");
                terminal.printSystem("  APPS", 'var(--terminal-green)');
                terminal.printSystem("    Список приложений системы. Запуск — через ПУСК или иконки.");
                terminal.printSystem(" ");
                terminal.printSystem("  CLEAR", 'var(--terminal-green)');
                terminal.printSystem("    Очистка экрана терминала.");
                terminal.printSystem(" ");
                terminal.printSystem("  REBOOT", 'var(--terminal-green)');
                terminal.printSystem("    Полный перезапуск системы с повторным прохождением");
                terminal.printSystem("    авторизации и интро-заставки.");
                terminal.printSystem(" ");
                terminal.printSystem("  HELP", 'var(--terminal-green)');
                terminal.printSystem("    Вывод этого справочника.");
                terminal.printSystem(" ");
                terminal.printSystem("──────────────────────────────────────────────");
            await renderer.render("[SCROLLSPEED=0]        -> [HREF=https://github.com/izzzi-lol/izzzi-lol.github.io/blob/main/README.md]Туториал для написания досье[/HREF] <-",
                    terminal.getOutputNode(), '', null, false);
                terminal.printSystem("Если вы хотите опубликовать своё досье здесь - обратитесь к администратору!")
                terminal.printSystem("Discord: izzzi_lol")
                terminal.printSystem("──────────────────────────────────────────────");
                break;
            case 'reboot':
                terminal.printSystem("ПЕРЕЗАГРУЗКА СИСТЕМЫ...");
                localStorage.setItem('has_seen_intro', 'false');
                setTimeout(() => location.reload(), 1500);
                break;
            case 'upload':
                await CmdUpload.execute(args, terminal);
                break;
            case 'echo':
                await CmdEcho.execute(args, terminal);
                break;
            case 'settings':
                if (typeof Settings !== "undefined") Settings.open();
                break;
            case 'browse':
                CmdBrowse.execute(args, terminal);
                break;
            case 'changelogs':
                    const content = await StepRenderer.fromFile('./changelogs.txt', '', false);
                    WindowManager.open('CHANGELOGS', 'CHANGELOGS', `
        <body>
            <center>
                <img src="assets/images/scp-animated.svg" style="width:25%;height:25%">
            </center>
            <div style="text-align:center;">
                <p>SCP FOUNDATION'S DOSSIER HUB</p>
                ${BetaBranch ? `<p style="background-color: #ff0000a0;">[BETA BRANCH]</p>` : ``}
                <h1>CHANGELOGS</h1>
            </div>
            <hr style="border-color:#00EE00">
            <div style="height:1.5em;"></div>
            <div>${content}</div>
        </body>
    `, {
                        width: 420,
                        height: 420,
                        status: 'SITE-VERSION: 1.1-03_BETA',
                        backdrop: false,
                        isResizable: false
                    });
                    break;
            case 'plugin':
                await CmdPlugin.execute(args, terminal);
                break;
            case 'desktop':
                if (typeof Desktop === 'undefined' || !Desktop.isSupported()) {
                    terminal.printError("ОШИБКА: Оболочка недоступна на этом устройстве.");
                    break;
                }
                terminal.printSystem("ПЕРЕКЛЮЧЕНИЕ РЕЖИМА ОБОЛОЧКИ…");
                if (args[0]?.toLowerCase() === 'on')  Desktop.show();
                else if (args[0]?.toLowerCase() === 'off') Desktop.showConsole();
                else Desktop.toggleMode();
                break;
            case 'apps': {
                if (typeof AppRegistry === 'undefined') break;
                terminal.printSystem("╔═══════════════════════════════════════════╗");
                terminal.printSystem("║     SCIPNET OS // СИСТЕМНЫЕ ПАКЕТЫ        ║");
                terminal.printSystem("╚═══════════════════════════════════════════╝");
                AppRegistry.list().forEach(a =>
                    terminal.printSystem(`  ${(a.name || a.id).padEnd(14)} ${a.description || ''}`, 'var(--terminal-green)'));
                terminal.printSystem(" ");
                terminal.printSystem("Запуск: ПУСК на таскбаре, иконки стола или DESKTOP для смены режима.");
                break;
            }
            case 'start':
                if (typeof Taskbar !== 'undefined') Taskbar.toggleStartMenu();
                break;
            case 'test-dossier':
                try {
                    const res = await fetch('dossier_for_test.txt');
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const text = await res.text();

                    const imgRes = await fetch('izzy_profile.jpg');
                    if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
                    const sessionFiles = { 'izzy_profile.jpg': await CmdUpload.fileToBase64(await imgRes.blob()) };

                    await renderer.render(text, terminal.getOutputNode(), './', sessionFiles, true);
                } catch (e) {
                    terminal.printError(`ОШИБКА ЗАГРУЗКИ ТЕСТОВОГО ДОСЬЕ: ${e.message}`);
                }
                break;
            case 'whoami':
                await Cabinet.open(terminal);
                break;
            default:
                if (cmd !== '') {
                    terminal.printError(`КОМАНДА НЕ РАСПОЗНАНА: ${cmd}. Введите help для списка команд.`);
                }
        }
    }
};
