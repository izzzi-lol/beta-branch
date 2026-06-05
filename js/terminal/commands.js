// Глобальный список для автодополнения в main.js
const COMMAND_LIST = ['get', 'help', 'clear', 'echo', 'reboot', 'upload','settings','browse'];

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
            default:
                if (cmd !== '') {
                    terminal.printError(`КОМАНДА НЕ РАСПОЗНАНА: ${cmd}. Введите help для списка команд.`);
                }
        }
    }
};
