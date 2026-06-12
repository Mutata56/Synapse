#[cfg(desktop)]
use std::sync::Mutex;
#[cfg(desktop)]
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

#[cfg(desktop)]
use tauri_plugin_global_shortcut::Shortcut;

/// Текущий шорткат быстрого захвата, лежит в managed state чтобы
/// `set_capture_shortcut` мог снять старый перед назначением нового. `None`
/// до первой успешной регистрации при setup.
#[cfg(desktop)]
#[derive(Default)]
struct CaptureShortcut(Mutex<Option<Shortcut>>);

/// Поднимает главное окно на передний план (из трея или свёрнутого).
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Показывает безрамочное окно быстрого захвата поверх остальных.
#[cfg(desktop)]
fn show_capture(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("capture") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Переназначает глобальный шорткат быстрого захвата. `accelerator` это строка
/// ускорителя Tauri (например "CommandOrControl+Shift+N"): парсим, регистрируем
/// новый, снимаем старый. Ошибки отдаём строками, фронтенд покажет тост
/// (невалидная комбинация или уже занята другим приложением). Старый шорткат
/// остаётся активным до успешной замены.
#[cfg(desktop)]
#[tauri::command]
fn set_capture_shortcut(
    app: AppHandle,
    state: tauri::State<'_, CaptureShortcut>,
    accelerator: String,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let shortcut: Shortcut = accelerator
        .parse()
        .map_err(|_| format!("Некорректная комбинация: {accelerator}"))?;

    let mut current = state.0.lock().map_err(|e| e.to_string())?;
    if current.as_ref() == Some(&shortcut) {
        return Ok(()); // уже привязан к этой комбинации, ничего не делаем
    }

    let gs = app.global_shortcut();
    gs.register(shortcut)
        .map_err(|e| format!("Не удалось назначить {accelerator}: {e}"))?;
    // Снимаем предыдущую привязку только после успешной регистрации новой,
    // чтобы при ошибке пользователь не остался без шортката совсем.
    if let Some(prev) = current.replace(shortcut) {
        let _ = gs.unregister(prev);
    }
    Ok(())
}

/// Загружает удалённый iCalendar (`.ics`) как текст. Работает в Rust, а не
/// в вебвью, чтобы CORS страницы не мешал (провайдеры календарей не шлют
/// `Access-Control-Allow-Origin`). Принимает только http(s) URL, парсинг на
/// фронте.
#[cfg(desktop)]
#[tauri::command]
async fn fetch_ics(url: String) -> Result<String, String> {
    // Лимиты подобраны под личные iCal-фиды: 30 сек таймаут, 10 мб тело.
    // Настоящие экспорт Google/Yandex/Apple отрабатывают за <1s и весят десятки
    // килобайт. Лимиты нужны чтобы зависший или злой эндпоинт не блокировал IPC
    // бесконечно и не убивал рендерер при конвертации String в JS.
    const MAX_BYTES: u64 = 10 * 1024 * 1024;

    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("URL должен начинаться с http:// или https://".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("synapse/1.0")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Сервер вернул {}", resp.status()));
    }
    // Если сервер обещает больше MAX_BYTES, отбрасываем до стриминга.
    // (Серверы могут врать про Content-Length, поэтому ниже ещё проверка
    // реального тела.)
    if let Some(len) = resp.content_length() {
        if len > MAX_BYTES {
            return Err(format!(
                "ICS слишком большой ({} байт, лимит {} байт)",
                len, MAX_BYTES
            ));
        }
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(format!(
            "ICS слишком большой ({} байт, лимит {} байт)",
            bytes.len(),
            MAX_BYTES
        ));
    }
    String::from_utf8(bytes.to_vec()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // TODO: на Linux пока запускаем с WEBKIT_DISABLE_DMABUF_RENDERER=1 руками.
    // Вшить здесь через std::env::set_var до инициализации вебвью (под cfg linux).
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    // Состояние global-shortcut и команда переназначения только для десктопа.
    #[cfg(desktop)]
    let builder = builder
        .manage(CaptureShortcut::default())
        .invoke_handler(tauri::generate_handler![set_capture_shortcut, fetch_ics]);

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, ShortcutState,
                };

                // По умолчанию Ctrl+Shift+N открывает окно быстрого захвата.
                // Активная комбинация лежит в managed state чтобы
                // `set_capture_shortcut` мог менять её на лету. Обработчик
                // сверяется с состоянием, а не с захваченной константой.
                let capture_sc =
                    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyN);
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }
                            let is_capture = app
                                .state::<CaptureShortcut>()
                                .0
                                .lock()
                                .map(|g| g.as_ref() == Some(shortcut))
                                .unwrap_or(false);
                            if is_capture {
                                show_capture(app);
                            }
                        })
                        .build(),
                )?;
                // TODO: на Wayland (Hyprland) X11-grab не ловит нативные окна, а
                // register может и упасть на старте. Переделать под Linux или выпилить.
                app.global_shortcut().register(capture_sc)?;
                app.state::<CaptureShortcut>()
                    .0
                    .lock()
                    .unwrap()
                    .replace(capture_sc);

                // Иконка в трее: держит приложение в фоне чтобы глобальный
                // шорткат работал даже после закрытия окна в трей.
                let open_i = MenuItem::with_id(app, "open", "Открыть", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&open_i, &quit_i])?;
                TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "open" => show_main(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            show_main(tray.app_handle());
                        }
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Закрытие = скрытие в трей вместо выхода, чтобы глобальный шорткат
            // и окно захвата продолжали работать. Настоящий выход через "Выход"
            // в меню трея.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
