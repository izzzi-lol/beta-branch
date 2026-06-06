// =============================================================================
//  plugin-api.js — Публичный API для плагинов SCIPNET
//
//  Плагин регистрирует себя одним вызовом:
//
//    PluginAPI.register({
//        id:          'dossier-editor',        // уникальный ID (используется в plugin remove)
//        name:        'Редактор Досье',         // отображаемое имя
//        command:     'edit',                  // команда в терминале
//        description: 'Редактор с превью',     // для help
//        version:     '1.0',                   // опционально
//        execute:     (args, terminal) => { }  // точка входа команды
//    });
//
//  Доступные объекты сайта:
//    PluginAPI.WindowManager   — открыть/закрыть окна
//    PluginAPI.terminal        — printSystem, printError, lockInput...
//    PluginAPI.renderer        — StepRenderer (рендер досье-текста)
//    PluginAPI.AudioHandler    — звуки интерфейса (playUI)
//
//  Загружается ПЕРВЫМ — до plugin-manager.js и до любых плагинов.
// =============================================================================

const PluginAPI = (() => {

    // Реестр: command → { id, name, description, version, execute }
    const _commands = {};

    // ── Регистрация ────────────────────────────────────────────────────────────

    /**
     * Регистрирует плагин и его терминальную команду.
     * Вызывается самим плагином при выполнении его кода.
     */
    function register({ id, name, command, description, version = '1.0', execute }) {
        if (!id || !command || typeof execute !== 'function') {
            console.warn('[PluginAPI] register(): обязательны id, command и execute');
            return false;
        }

        const cmd = command.trim().toLowerCase();

        if (_commands[cmd]) {
            console.warn(`[PluginAPI] Команда "${cmd}" уже занята плагином "${_commands[cmd].id}"`);
            return false;
        }

        _commands[cmd] = { id, name: name ?? id, description: description ?? '', version, execute };

        // Добавляем в COMMAND_LIST для автодополнения
        if (Array.isArray(window.COMMAND_LIST) && !window.COMMAND_LIST.includes(cmd)) {
            window.COMMAND_LIST.push(cmd);
        }

        console.log(`[PluginAPI] "${name}" v${version} → команда: ${cmd}`);
        return true;
    }

    /**
     * Возвращает копию реестра команд.
     * Используется PluginManager и _patchCommandHandler.
     */
    function getCommands() {
        return _commands;
    }

    /**
     * Снимает регистрацию команды плагина.
     * Вызывается при plugin remove — чтобы команда не работала до перезагрузки.
     * Возвращает true если команда была найдена и удалена.
     */
    function unregister(pluginId) {
        const cmd = Object.keys(_commands).find(k => _commands[k].id === pluginId);
        if (!cmd) return false;

        delete _commands[cmd];

        // Убираем из COMMAND_LIST
        if (Array.isArray(window.COMMAND_LIST)) {
            const idx = window.COMMAND_LIST.indexOf(cmd);
            if (idx !== -1) window.COMMAND_LIST.splice(idx, 1);
        }

        return true;
    }

    // ── Публичный объект ───────────────────────────────────────────────────────

    return {
        register,
        getCommands,
        unregister,

        // const-переменные не попадают в window, поэтому window.X всегда undefined.
        // Используем typeof-guard: безопасно читает любой глобальный идентификатор
        // вне зависимости от того, через var/const/let он объявлен.
        get WindowManager() { return typeof WindowManager !== 'undefined' ? WindowManager : undefined; },
        get terminal()      { return typeof TerminalAPI   !== 'undefined' ? TerminalAPI   : undefined; },
        get renderer()      { return typeof renderer      !== 'undefined' ? renderer      : undefined; },
        get AudioHandler()  { return typeof AudioHandler  !== 'undefined' ? AudioHandler  : undefined; },
    };

})();
