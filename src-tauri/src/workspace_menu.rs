use tauri::{menu::{Menu, MenuItem, PredefinedMenuItem, Submenu}, AppHandle, Emitter};

/// Native shortcuts dispatch to the webview, so Cmd+W closes a document tab
/// and Cmd+Q flushes the current editor before terminating the process.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let new_note = MenuItem::with_id(app, "workspace-new-note", "Новая заметка", true, Some("CmdOrCtrl+N"))?;
    let new_tab = MenuItem::with_id(app, "workspace-new-tab", "Новая вкладка", true, Some("CmdOrCtrl+T"))?;
    let new_database = MenuItem::with_id(app, "workspace-new-database", "Создать базу данных", true, None::<&str>)?;
    let new_canvas = MenuItem::with_id(app, "workspace-new-canvas", "Новый холст", true, None::<&str>)?;
    let switcher = MenuItem::with_id(app, "workspace-quick-switcher", "Перейти к файлу", true, Some("CmdOrCtrl+O"))?;
    let close_tab = MenuItem::with_id(app, "workspace-close-tab", "Закрыть вкладку", true, Some("CmdOrCtrl+W"))?;
    let settings = MenuItem::with_id(app, "workspace-settings", "Настройки…", true, Some("CmdOrCtrl+,"))?;
    let quit = MenuItem::with_id(app, "workspace-quit-app", "Выйти из Synapse", true, Some("CmdOrCtrl+Q"))?;
    let separator = PredefinedMenuItem::separator(app)?;
    let file = Submenu::with_items(app, "File", true, &[&new_note, &new_tab, &new_database, &new_canvas, &separator, &switcher, &close_tab])?;
    let edit = Submenu::with_items(app, "Edit", true, &[
        &PredefinedMenuItem::undo(app, None)?, &PredefinedMenuItem::redo(app, None)?,
        &PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::cut(app, None)?,
        &PredefinedMenuItem::copy(app, None)?, &PredefinedMenuItem::paste(app, None)?,
        &PredefinedMenuItem::select_all(app, None)?,
    ])?;
    let left = MenuItem::with_id(app, "workspace-toggle-sidebar", "Левая панель", true, Some("CmdOrCtrl+\\"))?;
    let right = MenuItem::with_id(app, "workspace-toggle-context", "Правая панель", true, Some("CmdOrCtrl+Shift+\\"))?;
    let view = Submenu::with_items(app, "View", true, &[&left, &right, &PredefinedMenuItem::fullscreen(app, None)?])?;
    let window = Submenu::with_items(app, "Window", true, &[
        &PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?,
    ])?;
    let help_item = MenuItem::with_id(app, "workspace-help", "Помощь и сочетания клавиш", true, None::<&str>)?;
    let help = Submenu::with_items(app, "Help", true, &[&help_item])?;
    #[cfg(target_os = "macos")]
    let menu = {
        let app_menu = Submenu::with_items(app, app.config().product_name.as_deref().unwrap_or("Synapse"), true, &[
            &PredefinedMenuItem::about(app, None, None)?, &PredefinedMenuItem::separator(app)?,
            &settings, &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?, &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?, &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?, &quit,
        ])?;
        Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])?
    };
    #[cfg(not(target_os = "macos"))]
    let menu = {
        file.append(&PredefinedMenuItem::separator(app)?)?;
        file.append(&settings)?; file.append(&quit)?;
        Menu::with_items(app, &[&file, &edit, &view, &window, &help])?
    };
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if let Some(command) = event.id().as_ref().strip_prefix("workspace-") {
            let _ = app.emit("workspace-command", command);
        }
    });
    Ok(())
}
