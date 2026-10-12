/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// null'ing of global vars need to be after init.js
window.ICONSEARCH_PATH = null;
window.ICON_SERVICE_PATH = null;

// Modified for Synapse: host owns persistence, navigation and service lifecycle.
Editor.enableServiceWorker = false;
Editor.enableRealtime = false;
Editor.enableRealtimeCache = false;
Editor.enableAi = false;
Editor.enableExportUrl = false;
Editor.suppressNewWindows = true;
Editor.popupsAllowed = false;
mxStencilRegistry.allowEval = false;
Editor.sketchFontSource = new URL('../styles/local-fonts.css', document.currentScript.src).href;

// Keep migration recovery metadata out of the user's shape-properties form.
// Rows stay in the dialog/model, so Apply retains their original values.
var SynapseOriginalEditDataDialog = EditDataDialog;
EditDataDialog = function () {
  SynapseOriginalEditDataDialog.apply(this, arguments);
  var reserved = ['synapseLegacyData','synapseLegacyId','synapseLegacyType','synapseLegacySnapshot','synapseCamera'];
  this.container.querySelectorAll('.geDialogFormRow').forEach(function (row) {
    var label = row.querySelector('.geDialogFormLabel');
    if (label && reserved.indexOf(label.textContent.trim().replace(/:$/, '')) !== -1) row.style.display = 'none';
  });
};
Object.setPrototypeOf(EditDataDialog, SynapseOriginalEditDataDialog);
EditDataDialog.prototype = SynapseOriginalEditDataDialog.prototype;

// Recovery attributes stay in the model but never crowd shape tooltips.
Graph.prototype.builtInProperties = Graph.prototype.builtInProperties.concat(['synapseLegacyData','synapseLegacyId','synapseLegacyType','synapseLegacySnapshot','synapseCamera']);
