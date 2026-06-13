#[cfg(desktop)]
use std::sync::Mutex;
#[cfg(desktop)]
use std::time::Duration;

use std::io::Write;
use std::path::PathBuf;

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

// ─── Лог запуска ─────────────────────────────────────────────────────────────
//
// Релизный билд под Windows собран как GUI (`windows_subsystem = "windows"` в
// main.rs) и в консоль не пишет ничего, поэтому при мгновенном краше причину
// поймать негде. Пишем простой текстовый лог рядом с данными приложения (там же,
// где лежат заметки) плюс panic-hook, который складывает туда же текст паники.
// Без сторонних крейтов: платформенную папку берём из переменных окружения.

#[cfg(target_os = "windows")]
fn base_data_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

#[cfg(target_os = "macos")]
fn base_data_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(|h| {
            let mut p = PathBuf::from(h);
            p.push("Library/Application Support");
            p
        })
        .unwrap_or_else(std::env::temp_dir)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn base_data_dir() -> PathBuf {
    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(xdg);
    }
    std::env::var_os("HOME")
        .map(|h| {
            let mut p = PathBuf::from(h);
            p.push(".local/share");
            p
        })
        .unwrap_or_else(std::env::temp_dir)
}

/// Путь к файлу лога: `<данные приложения>/com.kirill.synapse/synapse.log`.
fn log_path() -> PathBuf {
    let mut dir = base_data_dir();
    dir.push("com.kirill.synapse");
    let _ = std::fs::create_dir_all(&dir);
    dir.push("synapse.log");
    dir
}

/// Дописывает строку в лог-файл. Ошибки записи глотаем — лог не должен сам себя
/// ронять.
fn log_line(msg: &str) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())
    {
        let _ = writeln!(f, "[{ts}] {msg}");
    }
}

/// Ставит panic-hook, который пишет текст и место паники в лог-файл (и всё равно
/// зовёт стандартный, чтобы под Linux/в dev паника по-прежнему печаталась в
/// консоль). Зовём первым делом в `run`, чтобы поймать в том числе панику внутри
/// setup и обработчиков.
fn init_crash_log() {
    log_line(&format!(
        "──── запуск synapse {} на {} ────",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
    ));
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let where_ = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "?".into());
        let what = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "(без сообщения)".into());
        log_line(&format!("PANIC в {where_}: {what}"));
        prev(info);
    }));
}

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

// ─── CalDAV: пуш своих задач как событий (Яндекс.Календарь и любой CalDAV) ───
//
// Всё в Rust, чтобы не упереться в CORS вебвью и иметь basic-auth. Ошибки
// возвращаем со статусом И телом ответа: тело обычно объясняет причину, иначе
// отлаживать вслепую через пользователя.

/// HTTP-клиент CalDAV: те же таймаут и user-agent, что у fetch_ics.
#[cfg(desktop)]
fn caldav_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("synapse/1.0")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

/// Календарная коллекция, найденная при discovery (абсолютный URL + имя).
#[cfg(desktop)]
#[derive(serde::Serialize)]
struct CalCollection {
    href: String,
    name: String,
}

/// Локальное имя XML-тега без namespace-префикса (`d:href` -> `href`).
#[cfg(desktop)]
fn local_name(tag: &str) -> &str {
    tag.rsplit(':').next().unwrap_or(tag)
}

/// Внутренняя разметка каждого элемента с локальным именем `name`. Грубый разбор
/// без XML-зависимости: CalDAV multistatus плоский (одноимённые элементы не
/// вложены друг в друга), этого хватает для href/resourcetype/displayname.
#[cfg(desktop)]
fn elements<'a>(xml: &'a str, name: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut i = 0usize;
    while let Some(rel) = xml[i..].find('<') {
        let lt = i + rel;
        let after = &xml[lt + 1..];
        // закрывающие теги, комментарии, объявления пропускаем
        if matches!(after.as_bytes().first(), Some(b'/') | Some(b'!') | Some(b'?')) {
            i = lt + 1;
            continue;
        }
        let name_end = match after.find(|c: char| {
            c == '>' || c == ' ' || c == '/' || c == '\t' || c == '\n' || c == '\r'
        }) {
            Some(e) => e,
            None => break,
        };
        let tag = &after[..name_end];
        let gt = match after.find('>') {
            Some(g) => g,
            None => break,
        };
        let self_closing = gt > 0 && after.as_bytes()[gt - 1] == b'/';
        let content_start = lt + 1 + gt + 1;
        if local_name(tag) == name {
            if self_closing {
                out.push("");
            } else if let Some(end_rel) = find_close(&xml[content_start..], name) {
                out.push(&xml[content_start..content_start + end_rel]);
                i = content_start + end_rel;
                continue;
            } else {
                break;
            }
        }
        i = content_start;
    }
    out
}

/// Смещение начала закрывающего тега `</...name>` от начала `s`.
#[cfg(desktop)]
fn find_close(s: &str, name: &str) -> Option<usize> {
    let mut i = 0usize;
    while let Some(rel) = s[i..].find("</") {
        let p = i + rel + 2;
        let after = &s[p..];
        let end = after.find(|c: char| c == '>' || c == ' ')?;
        if local_name(&after[..end]) == name {
            return Some(i + rel);
        }
        i = p;
    }
    None
}

/// Origin (`scheme://host[:port]`) из полного URL, чтобы разрешать относительные
/// href из ответа сервера в абсолютные.
#[cfg(desktop)]
fn origin_of(url: &str) -> String {
    if let Some(scheme_end) = url.find("://") {
        let after = scheme_end + 3;
        if let Some(slash) = url[after..].find('/') {
            return url[..after + slash].to_string();
        }
    }
    url.trim_end_matches('/').to_string()
}

/// PROPFIND Depth:1 по календарь-хоуму: проверяет креды и отдаёт календарные
/// коллекции (href + имя). На не-2xx возвращает статус и тело ответа.
#[cfg(desktop)]
#[tauri::command]
async fn caldav_discover(
    url: String,
    login: String,
    password: String,
) -> Result<Vec<CalCollection>, String> {
    let client = caldav_client()?;
    let method = reqwest::Method::from_bytes(b"PROPFIND").map_err(|e| e.to_string())?;
    let body = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>"#;
    let resp = client
        .request(method, &url)
        .basic_auth(&login, Some(&password))
        .header("Depth", "1")
        .header("Content-Type", "application/xml; charset=utf-8")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("{} {}", status.as_u16(), text.trim()));
    }
    let origin = origin_of(&url);
    let mut out = Vec::new();
    for block in elements(&text, "response") {
        let href = match elements(block, "href").into_iter().next() {
            Some(h) => h.trim().to_string(),
            None => continue,
        };
        // только календари: у самого хоума и адресных книг нет <calendar/>
        let rt = elements(block, "resourcetype")
            .into_iter()
            .next()
            .unwrap_or("");
        if elements(rt, "calendar").is_empty() {
            continue;
        }
        let name = elements(block, "displayname")
            .into_iter()
            .next()
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let abs = if href.starts_with("http") {
            href
        } else {
            format!("{}{}", origin, href)
        };
        out.push(CalCollection { href: abs, name });
    }
    Ok(out)
}

/// Кладёт (создаёт/обновляет) событие: PUT VCALENDAR по `{коллекция}{uid}.ics`.
/// UID=id задачи, так что повторный пуш просто перезаписывает.
#[cfg(desktop)]
#[tauri::command]
async fn caldav_put(
    url: String,
    login: String,
    password: String,
    ics: String,
) -> Result<(), String> {
    let client = caldav_client()?;
    let resp = client
        .put(&url)
        .basic_auth(&login, Some(&password))
        .header("Content-Type", "text/calendar; charset=utf-8")
        .body(ics)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("{} {}", status.as_u16(), body.trim()));
    }
    Ok(())
}

/// Удаляет событие с сервера (когда задачу убрали в приложении). 404 считаем
/// успехом: значит его и так нет.
#[cfg(desktop)]
#[tauri::command]
async fn caldav_delete(url: String, login: String, password: String) -> Result<(), String> {
    let client = caldav_client()?;
    let resp = client
        .delete(&url)
        .basic_auth(&login, Some(&password))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() && status.as_u16() != 404 {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("{} {}", status.as_u16(), body.trim()));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Пишем лог запуска и ловим паники в файл (под Windows консоли нет).
    init_crash_log();

    // WebKitGTK с DMABUF-рендерером на части GPU/драйверов (и обычно под Wayland)
    // показывает пустой серый экран вместо интерфейса. Отключаем рендерер ДО
    // инициализации вебвью. Только Linux; Windows (WebView2) и macOS (WKWebView)
    // это не касается. Если переменную выставили снаружи — уважаем её.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        log_line("linux: WEBKIT_DISABLE_DMABUF_RENDERER=1 (защита от серого экрана)");
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    // Состояние global-shortcut и команда переназначения только для десктопа.
    #[cfg(desktop)]
    let builder = builder
        .manage(CaptureShortcut::default())
        .invoke_handler(tauri::generate_handler![
            set_capture_shortcut,
            fetch_ics,
            caldav_discover,
            caldav_put,
            caldav_delete
        ]);

    let run_result = builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, ShortcutState,
                };

                log_line("setup: старт");

                // По умолчанию Ctrl+Shift+N открывает окно быстрого захвата.
                // Активная комбинация лежит в managed state чтобы
                // `set_capture_shortcut` мог менять её на лету. Обработчик
                // сверяется с состоянием, а не с захваченной константой.
                let capture_sc =
                    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyN);

                // Плагин глобального шортката и регистрация дефолтной комбинации.
                // Любая осечка тут НЕ фатальна: приложение стартует и без
                // глобального хоткея (раньше `?` ронял весь запуск — это и был
                // мгновенный краш под Windows, когда Ctrl+Shift+N уже занят
                // другим приложением).
                match app.handle().plugin(
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
                ) {
                    Ok(()) => match app.global_shortcut().register(capture_sc) {
                        Ok(()) => {
                            if let Ok(mut g) = app.state::<CaptureShortcut>().0.lock() {
                                g.replace(capture_sc);
                            }
                            log_line("setup: глобальный хоткей Ctrl+Shift+N зарегистрирован");
                        }
                        Err(e) => log_line(&format!(
                            "setup: хоткей не зарегистрирован, продолжаем без него: {e}"
                        )),
                    },
                    Err(e) => log_line(&format!(
                        "setup: плагин global-shortcut не поднялся, продолжаем без него: {e}"
                    )),
                }

                // Иконка в трее: держит приложение в фоне чтобы глобальный
                // шорткат работал даже после закрытия окна в трей. Тоже не валим
                // запуск, если трея/иконки нет — раньше `unwrap()` на иконке и
                // `?` на сборке трея могли убить старт.
                let tray_result: tauri::Result<()> = (|| {
                    let open_i = MenuItem::with_id(app, "open", "Открыть", true, None::<&str>)?;
                    let quit_i = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
                    let menu = Menu::with_items(app, &[&open_i, &quit_i])?;
                    let mut tray = TrayIconBuilder::new()
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
                        });
                    // Иконку ставим, только если она есть (без unwrap).
                    if let Some(icon) = app.default_window_icon() {
                        tray = tray.icon(icon.clone());
                    }
                    tray.build(app)?;
                    Ok(())
                })();
                match tray_result {
                    Ok(()) => log_line("setup: трей создан"),
                    Err(e) => log_line(&format!(
                        "setup: трей не создан, продолжаем без него: {e}"
                    )),
                }
            }
            log_line("setup: готово");
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
        .run(tauri::generate_context!());

    // Сюда доходим, только если приложение вообще не смогло стартовать (например,
    // под Windows нет рантайма WebView2). Пишем причину в лог и выходим с кодом 1;
    // если это была паника — её отдельно зафиксирует panic-hook выше.
    if let Err(e) = run_result {
        log_line(&format!("FATAL: приложение не запустилось: {e}"));
        std::process::exit(1);
    }
}
