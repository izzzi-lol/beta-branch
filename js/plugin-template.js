// =============================================================================
//  ШАБЛОН ПЛАГИНА ДЛЯ SCIPNET
//  Скопируй, заполни и захости на GitHub Gist / raw GitHub / любом CDN.
//  Установка: plugin install <прямая ссылка на этот файл>
// =============================================================================

(function () {

    // ── Убеждаемся что PluginAPI доступен ─────────────────────────────────────
    if (typeof PluginAPI === 'undefined') {
        console.error('[my-plugin] PluginAPI не найден. Файл загружен вне SCIPNET?');
        return;
    }

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
        PluginAPI.WindowManager.open('my-plugin', 'МОЙ ПЛАГИН', _buildHTML(), {
            width:  500,
            height: 360,
            status: 'MY PLUGIN v1.0',
        });

        // Пример: вывести в терминал
        terminal.printSystem('МОЙ ПЛАГИН: запущен!');
    }

    // ── Регистрация ────────────────────────────────────────────────────────────
    PluginAPI.register({
        id:          'my-plugin',        // уникальный ID — используется в "plugin remove"
        name:        'Мой Плагин',       // отображаемое имя в "plugin list"
        command:     'myplugin',         // команда в терминале
        description: 'Пример плагина',  // для справки
        version:     '1.0',
        execute,
    });

})();
