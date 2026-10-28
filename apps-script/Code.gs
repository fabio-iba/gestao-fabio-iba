/**
 * CARREGADOR dos painéis "Gestão Fabio Iba".
 * Este arquivo não precisa mais ser alterado: a lógica do backend fica no GitHub
 * (apps-script/backend.js) e é carregada daqui a cada pedido (com cache de 5 minutos).
 * Assim, toda mudança publicada no repositório passa a valer sozinha.
 */
var BACKEND_URL = 'https://raw.githubusercontent.com/fabio-iba/gestao-fabio-iba/main/apps-script/backend.js';
var __B = null;

function backendFonte_() {
  var cache = CacheService.getScriptCache(), src = cache.get('BACKEND_JS');
  if (src) return src;
  try {
    var r = UrlFetchApp.fetch(BACKEND_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
    if (r.getResponseCode() === 200 && r.getContentText().indexOf('function tratar') >= 0) {
      src = r.getContentText();
      if (src.length < 95000) cache.put('BACKEND_JS', src, 300);
      salvarReserva_(src);
      return src;
    }
  } catch (e) {}
  // GitHub fora do ar: usa a última cópia guardada no Drive
  return lerReserva_();
}

function salvarReserva_(src) {
  try {
    var id = PropertiesService.getScriptProperties().getProperty('BACKEND_RESERVA_ID');
    if (id) { DriveApp.getFileById(id).setContent(src); return; }
    var f = DriveApp.createFile('backend-reserva-paineis.js', src, 'text/plain');
    PropertiesService.getScriptProperties().setProperty('BACKEND_RESERVA_ID', f.getId());
  } catch (e) {}
}
function lerReserva_() {
  var id = PropertiesService.getScriptProperties().getProperty('BACKEND_RESERVA_ID');
  if (!id) throw new Error('Não foi possível carregar o backend do GitHub.');
  return DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8');
}

function backend_() {
  if (!__B) __B = (new Function(backendFonte_() + '\nreturn { doGet: doGet, doPost: doPost, autorizar: autorizar };'))();
  return __B;
}

function doGet(e) { return backend_().doGet(e); }
function doPost(e) { return backend_().doPost(e); }

/* Rode uma vez pelo editor: autoriza e testa o carregamento. */
function autorizar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); }); // remove a tentativa antiga de atualização
  CacheService.getScriptCache().remove('BACKEND_JS');
  backend_().autorizar();
  Logger.log('Carregador pronto: backend lido do GitHub.');
}

/* (gatilho antigo, desativado) */
function atualizarDoGitHub() {}
