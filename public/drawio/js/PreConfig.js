/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 * Modified for Synapse: local, pinned browser-embed configuration.
 * Local assets may render user-imported external images/fonts; diagram storage
 * and cloud/export services are owned by Synapse and never selected here.
 */
(function () {
  var base = new URL('../', document.currentScript.src).href;
  window.DRAWIO_PUBLIC_BUILD = true;
  window.EXPORT_URL = null;
  window.DRAWIO_BASE_URL = base.replace(/\/$/, '');
  window.DRAWIO_SERVER_URL = base;
  window.DRAWIO_VIEWER_URL = base + 'js/viewer-static.min.js';
  window.DRAWIO_LIGHTBOX_URL = base + 'index.html';
  window.DRAW_MATH_URL = base + 'math4/es5';
  window.DRAWIO_CONFIG = null;
  urlParams['embed'] = '1';
  urlParams['proto'] = 'json';
  urlParams['offline'] = '1';
  urlParams['stealth'] = '1';
  urlParams['local'] = '1';
  urlParams['lockdown'] = '1';
  urlParams['plugins'] = '0';
  urlParams['pwa'] = '0';
  urlParams['sync'] = 'manual';
  urlParams['embedRT'] = '0';
  urlParams['rt'] = '0';
  urlParams['gapi'] = '0';
  urlParams['picker'] = '0';
  urlParams['db'] = '0';
  urlParams['od'] = '0';
  urlParams['gh'] = '0';
  urlParams['gl'] = '0';
  urlParams['tr'] = '0';
  urlParams['ms365'] = '0';
  urlParams['suppressNewWindows'] = '1';
  if (urlParams['saveAndExit'] == null) urlParams['saveAndExit'] = '0';
})();
