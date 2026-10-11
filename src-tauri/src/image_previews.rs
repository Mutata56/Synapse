use image::{imageops::FilterType, DynamicImage, ImageDecoder, ImageEncoder, ImageReader, Limits};
use serde::{Deserialize, Serialize};
use std::{collections::hash_map::DefaultHasher, fs, hash::{Hash, Hasher}, io::{BufWriter, Write}, path::{Component, Path, PathBuf}, sync::{atomic::{AtomicU64, Ordering}, Arc}, time::{SystemTime, UNIX_EPOCH}};
use tauri::Manager;

const MAX_FILE_BYTES: u64 = 80 * 1024 * 1024;
const CACHE_BYTES: u64 = 128 * 1024 * 1024;
const CACHE_ITEMS: usize = 384;
static WRITES: AtomicU64 = AtomicU64::new(0);
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub struct PreviewJobs(Arc<tokio::sync::Semaphore>);
impl Default for PreviewJobs {
    fn default() -> Self { Self(Arc::new(tokio::sync::Semaphore::new(2))) }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub preview_width: u32,
    pub preview_height: u32,
    pub bytes: u64,
    pub cached: bool,
}

#[tauri::command]
pub async fn image_preview(app: tauri::AppHandle, jobs: tauri::State<'_, PreviewJobs>, relative_path: String, regenerate: bool) -> Result<Preview, String> {
    let permit = jobs.0.clone().acquire_owned().await.map_err(|error| error.to_string())?;
    let base = app.path().app_data_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        make_preview_impl(&base.join("notes"), &base.join("image-previews/v1"), &relative_path, regenerate)
    }).await.map_err(|error| error.to_string())?
}

fn stamp(metadata: &fs::Metadata) -> (u64, u128) {
    (metadata.len(), metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|time| time.as_nanos()).unwrap_or(0))
}

#[cfg(test)]
fn make_preview(root: &Path, cache: &Path, relative: &str) -> Result<Preview, String> {
    make_preview_impl(root, cache, relative, false)
}

fn make_preview_impl(root: &Path, cache: &Path, relative: &str, regenerate: bool) -> Result<Preview, String> {
    let relative_path = Path::new(relative);
    if relative.is_empty() || relative_path.components().any(|part| !matches!(part, Component::Normal(_))) || relative.contains('\\') {
        return Err("Некорректный путь изображения".into());
    }
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let source = root.join(relative_path).canonicalize().map_err(|error| error.to_string())?;
    if !source.starts_with(&root) { return Err("Изображение вне хранилища".into()); }
    let before = fs::metadata(&source).map_err(|error| error.to_string())?;
    if !before.is_file() || before.len() > MAX_FILE_BYTES { return Err("Для этого файла доступен просмотр оригинала".into()); }
    let extension = source.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    // SVG stays an isolated image resource; never execute it as HTML. Only small
    // vectors are used directly, larger/unsupported files keep on-demand viewing.
    if extension == "svg" && before.len() <= 256 * 1024 {
        return Ok(Preview { path: source.to_string_lossy().into_owned(), width: 0, height: 0, preview_width: 0, preview_height: 0, bytes: before.len(), cached: true });
    }
    if !["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "ico"].contains(&extension.as_str()) {
        return Err("Для этого формата доступен просмотр оригинала".into());
    }
    fs::create_dir_all(cache).map_err(|error| error.to_string())?;
    let signature = stamp(&before);
    let mut hasher = DefaultHasher::new();
    ("v2-480x360-oriented", &source, signature).hash(&mut hasher);
    let key = format!("{:016x}", hasher.finish());
    let target = cache.join(format!("{key}.webp"));
    let sidecar = cache.join(format!("{key}.json"));
    if target.is_file() && !regenerate {
        if let Ok(bytes) = fs::read(&sidecar) {
            if let Ok(mut preview) = serde_json::from_slice::<Preview>(&bytes) {
                if preview.preview_width > 0 && preview.preview_height > 0 && preview.preview_width <= 480 && preview.preview_height <= 360 {
                    preview.path = target.to_string_lossy().into_owned();
                    preview.cached = true;
                    return Ok(preview);
                }
            }
        }
    }
    let mut reader = ImageReader::open(&source).map_err(|error| error.to_string())?.with_guessed_format().map_err(|error| error.to_string())?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|error| error.to_string())?;
    let orientation = decoder.orientation().map_err(|error| error.to_string())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|error| error.to_string())?;
    image.apply_orientation(orientation);
    let (width, height) = (image.width(), image.height());
    let preview = image.resize(width.min(480), height.min(360), FilterType::Triangle).to_rgba8();
    drop(image);
    let token = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = cache.join(format!(".{key}-{}-{token}.tmp", std::process::id()));
    let file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|error| error.to_string())?;
    let mut writer = BufWriter::new(file);
    let encoded = image::codecs::webp::WebPEncoder::new_lossless(&mut writer).write_image(preview.as_raw(), preview.width(), preview.height(), image::ExtendedColorType::Rgba8);
    if let Err(error) = encoded { drop(writer); let _ = fs::remove_file(&temporary); return Err(error.to_string()); }
    if let Err(error) = writer.flush() { drop(writer); let _ = fs::remove_file(&temporary); return Err(error.to_string()); }
    drop(writer);
    let after = fs::metadata(&source).map_err(|error| { let _ = fs::remove_file(&temporary); error.to_string() })?;
    if stamp(&after) != signature {
        let _ = fs::remove_file(&temporary);
        return Err("Изображение изменилось во время загрузки".into());
    }
    if regenerate { let _ = fs::remove_file(&target); }
    if let Err(error) = fs::rename(&temporary, &target) {
        let _ = fs::remove_file(&temporary);
        if !target.is_file() { return Err(error.to_string()); }
    }
    let result = Preview { path: target.to_string_lossy().into_owned(), width, height, preview_width: preview.width(), preview_height: preview.height(), bytes: fs::metadata(&target).map_err(|error| error.to_string())?.len(), cached: false };
    let temporary_meta = cache.join(format!(".{key}-{token}.json.tmp"));
    let mut metadata_file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary_meta).map_err(|error| error.to_string())?;
    metadata_file.write_all(&serde_json::to_vec(&result).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    drop(metadata_file);
    if fs::rename(&temporary_meta, &sidecar).is_err() { let _ = fs::remove_file(&temporary_meta); }
    if WRITES.fetch_add(1, Ordering::Relaxed).is_multiple_of(32) { prune_cache(cache); }
    Ok(result)
}

fn prune_cache(cache: &Path) {
    let Ok(entries) = fs::read_dir(cache) else { return; };
    let mut files: Vec<(SystemTime, u64, PathBuf)> = entries.filter_map(|entry| {
        let path = entry.ok()?.path();
        let stem = path.file_stem()?.to_str()?;
        if path.extension()?.to_str()? != "webp" || stem.len() != 16 || !stem.chars().all(|ch| ch.is_ascii_hexdigit()) { return None; }
        let metadata = path.metadata().ok()?;
        Some((metadata.modified().unwrap_or(UNIX_EPOCH), metadata.len(), path))
    }).collect();
    let mut bytes: u64 = files.iter().map(|item| item.1).sum();
    let mut count = files.len();
    files.sort_by_key(|item| item.0);
    for (_, size, path) in files {
        if count <= CACHE_ITEMS && bytes <= CACHE_BYTES { break; }
        if fs::remove_file(&path).is_ok() { let _ = fs::remove_file(path.with_extension("json")); bytes = bytes.saturating_sub(size); count -= 1; }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let path = std::env::temp_dir().join(format!("synapse-images-{}-{}", std::process::id(), TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(path.join("notes")).unwrap(); path
    }
    #[test]
    fn preview_is_bounded_cached_and_does_not_change_the_original() {
        let base = fixture(); let source = base.join("notes/image.png");
        image::RgbaImage::from_pixel(1200, 600, image::Rgba([80, 130, 200, 90])).save(&source).unwrap();
        let original = fs::read(&source).unwrap();
        let first = make_preview(&base.join("notes"), &base.join("cache"), "image.png").unwrap();
        assert_eq!((first.width, first.height), (1200, 600));
        assert_eq!((first.preview_width, first.preview_height), (480, 240));
        assert!(!first.cached);
        let second = make_preview(&base.join("notes"), &base.join("cache"), "image.png").unwrap();
        assert!(second.cached); assert_eq!(first.path, second.path);
        assert_eq!(original, fs::read(&source).unwrap());
        let decoded = ImageReader::open(&first.path).unwrap().decode().unwrap().to_rgba8();
        assert_eq!(decoded.get_pixel(0, 0).0[3], 90);
        image::RgbaImage::from_pixel(800, 400, image::Rgba([20, 30, 40, 255])).save(&source).unwrap();
        let updated = make_preview(&base.join("notes"), &base.join("cache"), "image.png").unwrap();
        assert_ne!(updated.path, first.path); assert_eq!(updated.width, 800);
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn paths_outside_the_vault_and_invalid_files_are_rejected() {
        let base = fixture();
        fs::write(base.join("outside.png"), b"invalid").unwrap();
        fs::write(base.join("notes/broken.png"), b"invalid").unwrap();
        for path in ["../outside.png", "/outside.png", "nested/../outside.png", "broken.png"] {
            assert!(make_preview(&base.join("notes"), &base.join("cache"), path).is_err());
        }
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn jpeg_orientation_and_16_bit_transparency_are_respected() {
        let base = fixture();
        let jpeg = base.join("notes/portrait.jpg");
        image::RgbImage::from_pixel(1200, 600, image::Rgb([80, 120, 150])).save(&jpeg).unwrap();
        let bytes = fs::read(&jpeg).unwrap();
        let exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
        let mut rotated = vec![0xff, 0xd8, 0xff, 0xe1, 0, 34];
        rotated.extend_from_slice(exif); rotated.extend_from_slice(&bytes[2..]); fs::write(&jpeg, &rotated).unwrap();
        let preview = make_preview(&base.join("notes"), &base.join("cache"), "portrait.jpg").unwrap();
        assert_eq!((preview.width, preview.height), (600, 1200));
        assert_eq!((preview.preview_width, preview.preview_height), (180, 360));
        assert_eq!(fs::read(&jpeg).unwrap(), rotated);
        let png = base.join("notes/16bit.png");
        image::ImageBuffer::<image::Rgba<u16>, Vec<u16>>::from_pixel(600, 300, image::Rgba([1000, 20000, 50000, 64000])).save(&png).unwrap();
        let preview = make_preview(&base.join("notes"), &base.join("cache"), "16bit.png").unwrap();
        let decoded = ImageReader::open(&preview.path).unwrap().decode().unwrap().to_rgba8();
        assert_eq!(decoded.get_pixel(0, 0).0[3], 249);
        fs::write(&preview.path, b"corrupted derived cache").unwrap();
        let repaired = make_preview_impl(&base.join("notes"), &base.join("cache"), "16bit.png", true).unwrap();
        assert!(ImageReader::open(repaired.path).unwrap().decode().is_ok());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn copied_library_benchmark_when_requested() {
        let Ok(base) = std::env::var("SYNAPSE_IMAGES_REVIEW_ROOT") else { return; };
        let base = PathBuf::from(base);
        let paths: Vec<String> = serde_json::from_slice(&fs::read(base.join("paths.json")).unwrap()).unwrap();
        let cache = base.join("previews").join(format!("run-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let before: Vec<_> = paths.iter().map(|path| fs::read(base.join("notes").join(path)).unwrap()).collect();
        let started = std::time::Instant::now();
        let mut map = serde_json::Map::new();
        let mut preview_bytes = 0; let mut pixels = 0u64; let mut preview_pixels = 0u64; let mut unavailable = 0;
        for path in &paths {
            match make_preview(&base.join("notes"), &cache, path) {
                Ok(preview) => {
                    preview_bytes += preview.bytes;
                    pixels += preview.width as u64 * preview.height as u64;
                    preview_pixels += preview.preview_width as u64 * preview.preview_height as u64;
                    map.insert(path.clone(), serde_json::to_value(preview).unwrap());
                }
                Err(error) => { unavailable += 1; map.insert(path.clone(), serde_json::json!({"error": error})); }
            }
        }
        let cold_ms = started.elapsed().as_secs_f64() * 1000.;
        let warm = std::time::Instant::now();
        let mut hits = 0;
        for path in &paths { if make_preview(&base.join("notes"), &cache, path).is_ok_and(|preview| preview.cached) { hits += 1; } }
        let warm_ms = warm.elapsed().as_secs_f64() * 1000.;
        for (path, bytes) in paths.iter().zip(before) { assert_eq!(bytes, fs::read(base.join("notes").join(path)).unwrap()); }
        fs::write(base.join("preview-map.json"), serde_json::to_vec(&map).unwrap()).unwrap();
        let report = serde_json::json!({"images":paths.len(),"unavailable":unavailable,"previewBytes":preview_bytes,"originalPixels":pixels,"previewPixels":preview_pixels,"coldMs":cold_ms,"warmMs":warm_ms,"warmHits":hits,"changedOriginalImages":0});
        fs::write(base.join("preview-report.json"), serde_json::to_vec_pretty(&report).unwrap()).unwrap();
        println!("{report}");
    }
}
