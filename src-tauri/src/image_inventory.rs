use serde::Serialize;
use std::{fs, io::ErrorKind, path::Path, time::UNIX_EPOCH};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryFile {
    path: String,
    mtime: u64,
    size: u64,
}

#[derive(Serialize)]
pub struct Inventory {
    images: Vec<InventoryFile>,
    notes: Vec<InventoryFile>,
    complete: bool,
}

#[tauri::command]
pub async fn image_inventory(app: tauri::AppHandle) -> Result<Inventory, String> {
    let root = app.path().app_data_dir().map_err(|error| error.to_string())?.join("notes");
    tauri::async_runtime::spawn_blocking(move || scan(&root)).await.map_err(|error| error.to_string())?
}

fn scan(root: &Path) -> Result<Inventory, String> {
    if fs::symlink_metadata(root).map_err(|error| error.to_string())?.file_type().is_symlink() {
        return Err("Корень хранилища не должен быть символической ссылкой".into());
    }
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let mut result = Inventory { images: Vec::new(), notes: Vec::new(), complete: true };
    walk(&root, &root, false, &mut result);
    Ok(result)
}

fn walk(root: &Path, directory: &Path, protected: bool, result: &mut Inventory) {
    // A directory may have been moved or replaced while the user edits files.
    let Ok(info) = fs::symlink_metadata(directory) else { result.complete = false; return; };
    if info.file_type().is_symlink() { result.complete = false; return; }
    match directory.canonicalize() {
        Ok(path) if path.starts_with(root) => {}
        _ => { result.complete = false; return; }
    }
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => { result.complete = false; return; }
    };
    for entry in entries {
        let Ok(entry) = entry else { result.complete = false; continue; };
        let filename = entry.file_name();
        let Some(name) = filename.to_str() else { result.complete = false; continue; };
        if name.starts_with("__tmp-") { continue; }
        let path = entry.path();
        let info = match fs::symlink_metadata(&path) {
            Ok(info) => info,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(_) => { result.complete = false; continue; }
        };
        if info.file_type().is_symlink() { continue; }
        if info.is_dir() {
            if name.starts_with('.') && ![".assets", ".trash", ".versions"].contains(&name) { continue; }
            walk(root, &path, protected || name == ".trash" || name == ".versions", result);
        } else if info.is_file() {
            let note = name.ends_with(".md");
            let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
            let image = !protected && ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "tif", "tiff", "ico", "heic", "heif"].contains(&extension.as_str());
            if !note && !image { continue; }
            let Some(relative) = path.strip_prefix(root).ok().and_then(Path::to_str) else { result.complete = false; continue; };
            let file = InventoryFile { path: relative.replace(std::path::MAIN_SEPARATOR, "/"), mtime: info.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|time| time.as_millis() as u64).unwrap_or(0), size: info.len() };
            if note { result.notes.push(file); } else { result.images.push(file); }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inventory_keeps_originals_and_history_but_excludes_hidden_work_and_symlinks() {
        let root = std::env::temp_dir().join(format!("synapse-inventory-{}", std::process::id()));
        fs::create_dir_all(root.join("Work")).unwrap();
        for (name, bytes) in [("Work/note.md", "![[photo.png]]"), ("Work/photo.PNG", "original"), (".assets/managed.jpg", "managed"), (".trash/old.md", "history"), (".versions/note/1.md", "version"), (".trash/hidden.png", "hidden"), (".cache/ignored.md", "ignored"), ("__tmp-staged.md", "temporary")] {
            let path = root.join(name); fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(path, bytes).unwrap();
        }
        #[cfg(unix)] std::os::unix::fs::symlink(root.join("Work"), root.join("linked")).unwrap();
        let inventory = scan(&root).unwrap();
        assert!(inventory.complete);
        let mut images: Vec<_> = inventory.images.iter().map(|file| file.path.as_str()).collect(); images.sort();
        let mut notes: Vec<_> = inventory.notes.iter().map(|file| file.path.as_str()).collect(); notes.sort();
        assert_eq!(images, [".assets/managed.jpg", "Work/photo.PNG"]);
        assert_eq!(notes, [".trash/old.md", ".versions/note/1.md", "Work/note.md"]);
        assert_eq!(inventory.images.iter().find(|file| file.path == "Work/photo.PNG").unwrap().size, 8);
        assert_eq!(fs::read(root.join("Work/photo.PNG")).unwrap(), b"original");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn missing_vault_and_linked_roots_cannot_publish_a_complete_inventory() {
        let root = std::env::temp_dir().join(format!("synapse-inventory-missing-{}", std::process::id()));
        assert!(scan(&root).is_err());
        #[cfg(unix)] {
            std::os::unix::fs::symlink(std::env::temp_dir(), &root).unwrap();
            assert!(scan(&root).is_err()); fs::remove_file(root).unwrap();
        }
    }
}
