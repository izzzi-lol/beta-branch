// =============================================================================
//  cmd_plugin.js — Команда PLUGIN для терминала SCIPNET
//
//  Использование:
//    plugin list                    — список установленных плагинов
//    plugin install <url>           — установить плагин
//    plugin remove <id>             — удалить плагин
//    plugin update <id>             — обновить плагин (перезагрузить с URL)
//    plugin help                    — эта справка
//
//  Зависит от plugin-manager.js.
// =============================================================================

const CmdPlugin = {

    async execute(args, terminal) {
        const [sub, arg] = args;

        switch (sub?.toLowerCase()) {

            case 'install':
                await PluginManager.install(arg, terminal);
                break;

            case 'remove':
            case 'uninstall':
                await PluginManager.remove(arg, terminal);
                break;

            case 'update':
                await PluginManager.update(arg, terminal);
                break;

            case 'list':
            case undefined:
            case '':
                await PluginManager.list(terminal);
                break;

            case 'help':
            default:
                terminal.printSystem('ИСПОЛЬЗОВАНИЕ: plugin <команда> [аргумент]');
                terminal.printSystem('');
                terminal.printSystem('  plugin list               — список установленных плагинов');
                terminal.printSystem('  plugin install <url>      — установить плагин из URL');
                terminal.printSystem('  plugin remove <id>        — удалить плагин');
                terminal.printSystem('  plugin update <id>        — перезагрузить плагин с исходного URL');
                terminal.printSystem('');
                terminal.printSystem('  <id> — идентификатор из "plugin list"');
                break;
        }
    },

};
