// =============================================================================
//  ШАБЛОН ПЛАГИНА ДЛЯ SCIPNET
//  Скопируй, заполни и захости на GitHub Gist / raw GitHub / любом CDN.
//  Установка: plugin install <прямая ссылка на этот файл>
//
//  Доступные объекты PluginAPI:
//    PluginAPI.WindowManager   — открыть/закрыть окна (.open, .close, .closeAll)
//    PluginAPI.terminal        — printSystem, printError, lockInput...
//    PluginAPI.renderer        — StepRenderer (toHTML — рендер досье-текста)
//    PluginAPI.AudioHandler    — звуки интерфейса (playUI)
//    PluginAPI.storage(id)     — персистентное хранилище плагина (IndexedDB)
// =============================================================================

(function () {

    // ── Убеждаемся что PluginAPI доступен ─────────────────────────────────────
    if (typeof PluginAPI === 'undefined') {
        console.error('[my-plugin] PluginAPI не найден. Файл загружен вне SCIPNET?');
        return;
    }

    const PLUGIN_ID = 'my-plugin'; // используй ОДНО и то же значение здесь и в register()

    // ── Персистентное хранилище плагина ────────────────────────────────────────
    // Данные переживают перезагрузку страницы и физически изолированы от
    // других плагинов (ключи неймспейсятся по PLUGIN_ID внутри PluginAPI).
    // Подходит для текста, JSON-объектов, data-URL изображений и т.п.
    const _store = PluginAPI.storage(PLUGIN_ID);

    // Пример использования (раскомментируй где нужно):
    //
    //   await _store.set('settings', { theme: 'green' });   // сохранить
    //   const settings = await _store.get('settings');      // → объект или null
    //   await _store.remove('settings');                    // удалить один ключ
    //   const keys = await _store.keys();                   // все ключи ЭТОГО плагина
    //   await _store.clear();                                // удалить всё (обычно не нужно
    //                                                         //   вручную — plugin remove делает это сам)

    // ── Опциональный CSS плагина ───────────────────────────────────────────────
    // Вставляется один раз через guard по id.
    function _injectStyles() {
        if (document.getElementById('my-plugin-style')) return;
        const st = document.createElement('style');
        st.id = 'my-plugin-style';
        st.textContent = `
            /* Стили специфичны для этого плагина */
            .my-plugin-root {
                /* ... */
            }
        `;
        document.head.appendChild(st);
    }

    // ── HTML интерфейса (если используется WindowManager) ─────────────────────
    function _buildHTML() {
        return `
            <div class="my-plugin-root">
                <p>Привет из плагина!</p>
            </div>
        `;
    }

    // ── Логика команды ─────────────────────────────────────────────────────────
    async function execute(args, terminal) {
        _injectStyles();

        // Пример: открыть окно
        PluginAPI.WindowManager.open(PLUGIN_ID, 'МОЙ ПЛАГИН', _buildHTML(), {
            width:  500,
            height: 360,
            status: 'MY PLUGIN v1.0',
        });

        // Пример: вывести в терминал
        terminal.printSystem('МОЙ ПЛАГИН: запущен!');
    }

    // ── Регистрация ────────────────────────────────────────────────────────────
    PluginAPI.register({
        id:          PLUGIN_ID,          // уникальный ID — используется в "plugin remove"
        name:        'Мой Плагин',       // отображаемое имя в "plugin list"
        command:     'myplugin',         // команда в терминале
        description: 'Пример плагина',  // для справки
        version:     '1.0',
        execute,
    });

})();
