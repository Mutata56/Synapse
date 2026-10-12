//! Vector PDF snapshots of exported SVG pages in a dedicated, nonpersistent WebKit view.
//! The visible notes/editor webview and user files are never captured or navigated.
use tauri::AppHandle;

fn validate_page(svg: &str, width: f64, height: f64) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0
        || width > 50_000.0 || height > 50_000.0 {
        return Err("Некорректный размер SVG-страницы для PDF.".into());
    }
    if svg.len() > 25 * 1024 * 1024 || !svg.contains("<svg") || !svg.contains("</svg>") {
        return Err("Некорректная SVG-страница для PDF.".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use super::validate_page;
    use block2::RcBlock;
    use objc2::{msg_send, sel, rc::Retained, runtime::AnyObject, MainThreadMarker, MainThreadOnly};
    use objc2_foundation::{NSData, NSError, NSPoint, NSRect, NSSize, NSString};
    use objc2_web_kit::{WKPDFConfiguration, WKWebView, WKWebViewConfiguration, WKWebsiteDataStore};
    use std::{
        cell::RefCell,
        collections::HashMap,
        sync::atomic::{AtomicU64, Ordering},
        time::{Duration, Instant},
    };
    use tauri::AppHandle;
    use tokio::sync::oneshot;

    type Reply = Result<Vec<u8>, String>;
    #[derive(Clone, Copy, PartialEq)]
    enum Stage { Idle, Checking, Ready, Capturing }
    struct Job {
        view: Retained<WKWebView>,
        width: f64,
        height: f64,
        stage: Stage,
        sender: oneshot::Sender<Reply>,
    }
    // WKWebView is MainThreadOnly. Keep every retain/release on the Tauri main thread.
    thread_local! { static JOBS: RefCell<HashMap<u64, Job>> = RefCell::new(HashMap::new()); }
    static NEXT_JOB: AtomicU64 = AtomicU64::new(1);

    fn finish(id: u64, result: Reply) {
        let job = JOBS.with(|jobs| jobs.borrow_mut().remove(&id));
        if let Some(job) = job {
            unsafe { job.view.stopLoading(); }
            let _ = job.sender.send(result);
        }
    }

    fn start(id: u64, svg: String, width: f64, height: f64, sender: oneshot::Sender<Reply>) {
        let Some(mtm) = MainThreadMarker::new() else {
            let _ = sender.send(Err("PDF renderer должен работать в главном потоке.".into()));
            return;
        };
        let start = svg.find("<svg").unwrap_or(0);
        let end = svg.rfind("</svg>").map(|offset| offset + 6).unwrap_or(svg.len());
        let html = format!(
            "<!doctype html><html><head><meta charset='utf-8'>\
             <meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline' data:; script-src 'none';\">\
             <style>html,body{{margin:0;padding:0;width:{width}px;height:{height}px;overflow:hidden;background:white}}\
             body>svg{{display:block;width:100%;height:100%}}</style></head>\
             <body data-drawio-pdf-job='{id}'>{}</body></html>", &svg[start..end]);
        unsafe {
            let configuration = WKWebViewConfiguration::new(mtm);
            configuration.setWebsiteDataStore(&WKWebsiteDataStore::nonPersistentDataStore(mtm));
            let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(width, height));
            let view = WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), rect, &configuration);
            let available: bool = msg_send![&*view, respondsToSelector: sel!(createPDFWithConfiguration:completionHandler:)];
            if !available {
                let _ = sender.send(Err("Эта версия macOS не поддерживает векторный PDF-экспорт WebKit.".into()));
                return;
            }
            JOBS.with(|jobs| jobs.borrow_mut().insert(id, Job {
                view: view.clone(), width, height, stage: Stage::Idle, sender,
            }));
            if view.loadHTMLString_baseURL(&NSString::from_str(&html), None).is_none() {
                finish(id, Err("WebKit не смог загрузить SVG-страницу.".into()));
            }
        }
    }

    fn advance(id: u64) {
        let current = JOBS.with(|jobs| jobs.borrow().get(&id)
            .map(|job| (job.view.clone(), job.stage, job.width, job.height)));
        let Some((view, stage, width, height)) = current else { return; };
        if stage == Stage::Checking || stage == Stage::Capturing { return; }
        if stage == Stage::Ready {
            JOBS.with(|jobs| { if let Some(job) = jobs.borrow_mut().get_mut(&id) { job.stage = Stage::Capturing; } });
            unsafe {
                let Some(mtm) = MainThreadMarker::new() else { return; };
                let configuration = WKPDFConfiguration::new(mtm);
                configuration.setRect(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(width, height)));
                let completion = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
                    let result = if !error.is_null() {
                        Err(format!("WebKit PDF: {}", (&*error).localizedDescription()))
                    } else if !data.is_null() {
                        let bytes = (&*data).to_vec();
                        if bytes.starts_with(b"%PDF-") { Ok(bytes) }
                        else { Err("WebKit не вернул PDF-данные.".into()) }
                    } else { Err("WebKit вернул пустой PDF.".into()) };
                    finish(id, result);
                });
                view.createPDFWithConfiguration_completionHandler(Some(&configuration), &completion);
            }
        } else {
            if unsafe { view.isLoading() } { return; }
            JOBS.with(|jobs| { if let Some(job) = jobs.borrow_mut().get_mut(&id) { job.stage = Stage::Checking; } });
            let check = format!(
                "Boolean(document.body && document.body.dataset.drawioPdfJob === '{id}' && \
                 document.readyState === 'complete' && (!document.fonts || document.fonts.status === 'loaded') && \
                 Array.from(document.images).every(image => image.complete))");
            unsafe {
                let completion = RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
                    // JavaScript expression above returns a Boolean, represented by NSNumber.
                    let ready = error.is_null() && !result.is_null() && msg_send![result, boolValue];
                    JOBS.with(|jobs| { if let Some(job) = jobs.borrow_mut().get_mut(&id) {
                        job.stage = if ready { Stage::Ready } else { Stage::Idle };
                    } });
                });
                view.evaluateJavaScript_completionHandler(&NSString::from_str(&check), Some(&completion));
            }
        }
    }

    pub async fn render(app: AppHandle, svg: String, width: f64, height: f64) -> Reply {
        validate_page(&svg, width, height)?;
        let id = NEXT_JOB.fetch_add(1, Ordering::Relaxed);
        let (sender, mut receiver) = oneshot::channel();
        app.run_on_main_thread(move || start(id, svg, width, height, sender)).map_err(|error| error.to_string())?;
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(20) {
            match receiver.try_recv() {
                Ok(result) => return result,
                Err(oneshot::error::TryRecvError::Closed) => return Err("PDF renderer завершился без результата.".into()),
                Err(oneshot::error::TryRecvError::Empty) => {}
            }
            if let Err(error) = app.run_on_main_thread(move || advance(id)) {
                let _ = app.run_on_main_thread(move || finish(id, Err("PDF renderer остановлен.".into())));
                return Err(error.to_string());
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
        let _ = app.run_on_main_thread(move || finish(id, Err("Превышено время PDF-экспорта.".into())));
        Err("Превышено время PDF-экспорта.".into())
    }
}

#[tauri::command]
pub async fn canvas_render_pdf_page(app: AppHandle, svg: String, width: f64, height: f64) -> Result<Vec<u8>, String> {
    validate_page(&svg, width, height)?;
    #[cfg(target_os = "macos")]
    { macos::render(app, svg, width, height).await }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Векторный PDF-экспорт пока доступен в Synapse для macOS.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::validate_page;
    #[test]
    fn checks_dimensions_and_svg_before_webkit() {
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        assert!(validate_page(svg, 800.0, 600.0).is_ok());
        assert!(validate_page(svg, f64::NAN, 600.0).is_err());
        assert!(validate_page(svg, 0.0, 600.0).is_err());
        assert!(validate_page(svg, 50_001.0, 600.0).is_err());
        assert!(validate_page("%PDF-1.7", 800.0, 600.0).is_err());
    }
}

