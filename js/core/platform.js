// =============================================================================
//  platform.js — единая точка определения платформы
//
//  Раньше matchMedia('(hover: none), (pointer: coarse)') дублировался в четырёх
//  модулях (window-manager, desktop, taskbar, cmd_browse) — теперь все берут
//  Platform.isMobile отсюда. Флаг вычисляется ОДИН раз при загрузке скрипта,
//  поэтому platform.js должен подключаться раньше window-manager.js.
//
//  Отладка/тесты без тач-устройства:
//    localStorage.setItem('scipnet_force_env', 'phone')   → имитировать мобилку
//    localStorage.setItem('scipnet_force_env', 'desktop') → имитировать десктоп
//    (применяется после перезагрузки страницы; удалить ключ — вернуться к авто)
// =============================================================================

const Platform = (() => {
    let isMobile = window.matchMedia('(hover: none), (pointer: coarse)').matches;

    try {
        const forced = localStorage.getItem('scipnet_force_env');
        if (forced === 'phone')   isMobile = true;
        else if (forced === 'desktop') isMobile = false;
    } catch (_) { /* приватный режим — просто автоопределение */ }

    return { isMobile };
})();
