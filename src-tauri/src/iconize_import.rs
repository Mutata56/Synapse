//! Read Iconize metadata and custom glyphs. The Obsidian vault is never modified.
use serde::Serialize;
use serde_json::Value;
use std::{fs, path::{Component, Path, PathBuf}};
use tauri::Manager;

#[derive(Serialize)]
pub struct ImportIcon { id: String, name: String, pack: String, svg: String, #[serde(skip_serializing_if = "Option::is_none")] png: Option<String> }
#[derive(Serialize)]
pub struct IconizeImport { data: Value, icons: Vec<ImportIcon> }

fn relative_path(value: &str) -> Option<PathBuf> {
    let path = Path::new(value);
    if path.is_absolute() || value.contains('\\') || path.components().any(|c| !matches!(c, Component::Normal(_))) { return None; }
    Some(path.to_owned())
}
fn normalized(name: &str) -> String {
    name.split(['-', '_', ' ']).map(|part| { let mut chars = part.chars(); chars.next().map(|c| c.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default() }).collect()
}
fn prefix(name: &str) -> String {
    let parts: Vec<_> = name.split('-').collect();
    if parts.len() > 1 {
        parts.iter().enumerate().filter_map(|(i, p)| p.chars().next().map(|c| if i == 0 { c.to_ascii_uppercase() } else { c.to_ascii_lowercase() })).collect()
    } else { let mut c = name.chars(); c.next().map(|x| x.to_ascii_uppercase().to_string()).unwrap_or_default() + &c.next().map(|x| x.to_ascii_lowercase().to_string()).unwrap_or_default() }
}
fn read_bounded(path: &Path, limit: u64) -> Result<String, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > limit { return Err("Iconize file is too large or is not a regular file".into()); }
    fs::read_to_string(path).map_err(|e| e.to_string())
}
fn png_data(path: &Path) -> Result<String, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 2_000_000 { return Err("PNG icon is too large or is not a regular file".into()); }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if !bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) { return Err("Invalid PNG icon".into()); }
    const ABC: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::from("data:image/png;base64,");
    for chunk in bytes.chunks(3) {
        let a = chunk[0] as usize; let b = *chunk.get(1).unwrap_or(&0) as usize; let c = *chunk.get(2).unwrap_or(&0) as usize;
        encoded.push(ABC[a >> 2] as char); encoded.push(ABC[((a & 3) << 4) | (b >> 4)] as char);
        encoded.push(if chunk.len() > 1 { ABC[((b & 15) << 2) | (c >> 6)] as char } else { '=' });
        encoded.push(if chunk.len() > 2 { ABC[c & 63] as char } else { '=' });
    }
    Ok(encoded)
}
fn read_import(vault: &Path) -> Result<Option<IconizeImport>, String> {
    let vault = vault.canonicalize().map_err(|e| e.to_string())?;
    let file = vault.join(".obsidian/plugins/obsidian-icon-folder/data.json");
    if !file.is_file() { return Ok(None); }
    if !file.canonicalize().map_err(|e| e.to_string())?.starts_with(&vault) { return Err("Iconize data is outside the vault".into()); }
    let data: Value = serde_json::from_str(&read_bounded(&file, 2_000_000)?).map_err(|e| e.to_string())?;
    let pack_path = data.pointer("/settings/iconPacksPath").and_then(Value::as_str).unwrap_or(".obsidian/icons");
    let relative = relative_path(pack_path).ok_or("Icon pack path must be inside the vault")?;
    let root = vault.join(relative);
    let mut icons = Vec::new(); let mut bytes = 0usize;
    if root.is_dir() {
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        if !root.starts_with(&vault) { return Err("Icon packs are outside the vault".into()); }
        for pack in fs::read_dir(root).map_err(|e| e.to_string())?.flatten() {
            let ft = pack.file_type().map_err(|e| e.to_string())?;
            if !ft.is_dir() || ft.is_symlink() { continue; }
            let name = pack.file_name().to_string_lossy().to_string();
            for file in fs::read_dir(pack.path()).map_err(|e| e.to_string())?.flatten() {
                let ext = file.path().extension().and_then(|s| s.to_str()).map(str::to_ascii_lowercase);
                if ext.as_deref() != Some("svg") && ext.as_deref() != Some("png") { continue; }
                let png = if ext.as_deref() == Some("png") { Some(png_data(&file.path())?) } else { None };
                let svg = if png.is_some() { String::new() } else { read_bounded(&file.path(), 200_000)? };
                bytes += svg.len() + png.as_ref().map_or(0, String::len);
                if bytes > 10_000_000 || icons.len() >= 5000 { return Err("Custom icon collection is too large".into()); }
                let glyph = file.path().file_stem().unwrap_or_default().to_string_lossy().to_string();
                let glyph = normalized(&glyph);
                icons.push(ImportIcon { id: prefix(&name) + &glyph, name: glyph, pack: name.clone(), svg, png });
            }
        }
    }
    Ok(Some(IconizeImport { data, icons }))
}

#[tauri::command]
pub async fn read_iconize_import(app: tauri::AppHandle, vault_path: Option<String>) -> Result<Option<IconizeImport>, String> {
    let vault = match vault_path {
        Some(path) => PathBuf::from(path),
        None => {
            let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("notes");
            let copied = root.join(".obsidian/plugins/obsidian-icon-folder/data.json");
            if copied.is_file() { root } else {
                let manifest = root.join(".synapse/obsidian-import.json");
                if !manifest.is_file() { return Ok(None); }
                let data: Value = serde_json::from_str(&read_bounded(&manifest, 10_000_000)?).map_err(|e| e.to_string())?;
                match data.get("sourceVault").and_then(Value::as_str) { Some(path) => PathBuf::from(path), None => return Ok(None) }
            }
        }
    };
    if !vault.is_dir() { return Ok(None); }
    tauri::async_runtime::spawn_blocking(move || read_import(&vault)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn restrict_pack_paths() { assert!(relative_path(".obsidian/icons").is_some()); assert!(relative_path("../../elsewhere").is_none()); assert!(relative_path("/tmp/icons").is_none()); assert!(relative_path("..\\icons").is_none()); }
    #[test] fn compatible_names() { assert_eq!(prefix("font-awesome-brands"), "Fab"); assert_eq!(prefix("simple-icons"), "Si"); assert_eq!(normalized("alarm-clock-minus"), "AlarmClockMinus"); }
    #[test]
    fn read_custom_icons_without_modifying_vault() {
        let root = std::env::temp_dir().join(format!("synapse-iconize-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(root.join(".obsidian/plugins/obsidian-icon-folder")).unwrap();
        fs::create_dir_all(root.join(".obsidian/icons/my-icons")).unwrap();
        let data = r#"{"settings":{"iconPacksPath":".obsidian/icons"},"Study":"LiBook"}"#;
        let file = root.join(".obsidian/plugins/obsidian-icon-folder/data.json");
        fs::write(&file, data).unwrap();
        fs::write(root.join(".obsidian/icons/my-icons/java.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0\"/></svg>").unwrap();
        fs::write(root.join(".obsidian/icons/my-icons/logo.png"), [137,80,78,71,13,10,26,10]).unwrap();
        let imported = read_import(&root).unwrap().unwrap();
        assert_eq!(imported.icons.len(), 2); assert!(imported.icons.iter().any(|icon| icon.id == "MiJava"));
        assert_eq!(imported.icons.iter().find(|icon| icon.id == "MiLogo").unwrap().png.as_deref(), Some("data:image/png;base64,iVBORw0KGgo="));
        assert_eq!(fs::read_to_string(file).unwrap(), data);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn configured_vault_is_read_only() {
        if let Ok(path) = std::env::var("SYNAPSE_ICONIZE_TEST_VAULT") {
            let imported = read_import(Path::new(&path)).unwrap().unwrap();
            assert!(imported.data.get("settings").is_some());
            println!("Read {} assignments and {} extracted icons", imported.data.as_object().unwrap().len() - 1, imported.icons.len());
        }
    }
}
