// ─── Платформа и возможности вебвью ─────────────────────────────────
//
// На Windows Tauri рисует через WebView2 (Chromium), на Linux через WebKitGTK.
// WebKitGTK заметно слабее в композитинге: backdrop-filter и покадровые пружины
// framer-motion, которые на Chromium бесплатны, тут дёргаются (особенно видно
// при переключении вкладок). На Linux эти тяжёлые эффекты глушим до дешёвых
// статичных, на Windows оставляем красоту.

/** Крутимся в Linux-вебвью (WebKitGTK). */
export const isLinux = /\bLinux\b/i.test(navigator.userAgent);

/** Глушим фрост-блюр и пружинные анимации там, где вебвью не тянет их плавно.
 *  Пока совпадает с `isLinux`. */
export const reducedFx = isLinux;
