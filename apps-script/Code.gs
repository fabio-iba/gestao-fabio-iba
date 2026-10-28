/**
 * Backend dos painéis "Gestão Fabio Iba" (GitHub Pages).
 * Os dados ficam nesta planilha (uma aba por coleção) e os arquivos na pasta do Drive.
 *
 * Propriedades do script (Configurações do projeto > Propriedades do script):
 *   CHAVE           (obrigatória) senha de acesso digitada no site na primeira vez
 *   PASTA_ASSETS    (opcional) ID da pasta do Drive dos arquivos; padrão: "Arquivos dos painéis"
 *   ANTHROPIC_KEY   (opcional) chave da API da Anthropic, para as funções de IA
 *   ANTHROPIC_MODEL (opcional) modelo da API (padrão: claude-sonnet-4-5)
 */

var PROPS = PropertiesService.getScriptProperties();

function doGet(e) {
  return responder(tratar(e && e.parameter && e.parameter.q ? JSON.parse(e.parameter.q) : {}));
}

function doPost(e) {
  var req = {};
  try { req = JSON.parse(e.postData.contents); } catch (err) { return responder({ ok: false, code: 'invalid_argument', message: 'Pedido mal formado.' }); }
  return responder(tratar(req));
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function tratar(req) {
  try {
    var chave = PROPS.getProperty('CHAVE');
    if (!chave) return { ok: false, code: 'not_configured', message: 'Defina a propriedade CHAVE no Apps Script.' };
    if (req.key !== chave) return { ok: false, code: 'not_granted', message: 'Chave de acesso incorreta.' };
    var op = req.op;
    if (op === 'ping') return { ok: true };
    if (op === 'listMany') return { ok: true, data: listMany(req.app, req.cols || []) };
    if (op === 'set' || op === 'update' || op === 'delete') return comTrava(function () { return { ok: true, data: gravar(req) }; });
    if (op === 'batch') return comTrava(function () { (req.ops || []).forEach(gravar); return { ok: true }; });
    if (op === 'upload') return { ok: true, data: upload(req) };
    if (op === 'arquivo') return { ok: true, data: baixarArquivo(req.id) };
    if (op === 'driveSearch') return { ok: true, data: driveSearch(req.query, req.pageSize) };
    if (op === 'driveDownload') return { ok: true, data: driveDownload(req.fileId, req.exportMimeType) };
    if (op === 'driveText') return { ok: true, data: driveText(req.fileId) };
    if (op === 'ia') return { ok: true, data: ia(req.prompt, req.max) };
    return { ok: false, code: 'invalid_argument', message: 'Operação desconhecida: ' + op };
  } catch (err) {
    return { ok: false, code: err.code || 'internal', message: String(err.message || err) };
  }
}

function comTrava(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- planilha: uma aba por coleção (app__colecao), colunas id | dados | atualizadoEm ---------- */

function nomeAba(app, col) { return (app + '__' + col).replace(/[\/\\?*\[\]:]/g, '_').slice(0, 99); }

function aba(app, col, criar) {
  var ss = SpreadsheetApp.getActive(), nome = nomeAba(app, col), sh = ss.getSheetByName(nome);
  if (!sh && criar) {
    sh = ss.insertSheet(nome);
    sh.getRange(1, 1, 1, 3).setValues([['id', 'dados (JSON)', 'atualizadoEm']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(2, 600);
  }
  return sh;
}

function linhas(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
}

function listMany(app, cols) {
  var out = {};
  cols.forEach(function (col) {
    var docs = [];
    linhas(aba(app, col, false)).forEach(function (r) {
      if (!r[0]) return;
      var d = {}; try { d = JSON.parse(lerJson(r[1])); } catch (e) {}
      docs.push({ id: String(r[0]), data: d });
    });
    out[col] = docs;
  });
  return out;
}

// células têm limite de 50 mil caracteres: documentos maiores ficam num arquivo JSON no Drive
function lerJson(v) {
  v = String(v || '');
  if (v.indexOf('drive:') === 0) return DriveApp.getFileById(v.slice(6)).getBlob().getDataAsString('UTF-8');
  return v || '{}';
}
function guardarJson(app, col, id, txt, antigo) {
  if (String(antigo || '').indexOf('drive:') === 0) { try { DriveApp.getFileById(String(antigo).slice(6)).setTrashed(true); } catch (e) {} }
  if (txt.length < 45000) return txt;
  var f = pastaAssets().createFile(Utilities.newBlob(txt, 'application/json', 'dados_' + nomeAba(app, col) + '_' + id + '.json'));
  return 'drive:' + f.getId();
}

function gravar(req) {
  var sh = aba(req.app, req.col, true), id = String(req.id), rows = linhas(sh), idx = -1;
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === id) { idx = i; break; }
  var linha = idx + 2;
  if (req.op === 'delete') {
    if (idx >= 0) { guardarJson(req.app, req.col, id, '', rows[idx][1]); sh.deleteRow(linha); }
    return null;
  }
  var atual = {};
  if (idx >= 0) { try { atual = JSON.parse(lerJson(rows[idx][1])); } catch (e) {} }
  var novo = req.op === 'set' ? (req.data || {}) : aplicar(atual, req.data || {});
  var txt = guardarJson(req.app, req.col, id, JSON.stringify(novo), idx >= 0 ? rows[idx][1] : '');
  var vals = [[id, txt, new Date()]];
  if (idx >= 0) sh.getRange(linha, 1, 1, 3).setValues(vals); else sh.appendRow(vals[0]);
  return novo;
}

// update com campos "a.b.c" e remoção ({__delete__:true})
function aplicar(alvo, patch) {
  Object.keys(patch).forEach(function (k) {
    var partes = k.split('.'), o = alvo;
    for (var i = 0; i < partes.length - 1; i++) { if (typeof o[partes[i]] !== 'object' || o[partes[i]] === null) o[partes[i]] = {}; o = o[partes[i]]; }
    var v = patch[k], ult = partes[partes.length - 1];
    if (v && typeof v === 'object' && v.__delete__) delete o[ult]; else o[ult] = v;
  });
  return alvo;
}

/* ---------- arquivos ---------- */

function pastaAssets() {
  var id = PROPS.getProperty('PASTA_ASSETS') || '13GWOql2vpgmWeqdcyVP60v8hfHBpAE7f';
  if (!id) throw { code: 'not_configured', message: 'Defina a propriedade PASTA_ASSETS no Apps Script.' };
  return DriveApp.getFolderById(id);
}

function upload(req) {
  var blob = Utilities.newBlob(Utilities.base64Decode(req.base64), req.mime || 'application/octet-stream', req.name || ('arquivo_' + Date.now()));
  var f = pastaAssets().createFile(blob);
  return { id: f.getId(), name: f.getName(), mime: f.getMimeType(), size: f.getSize(), url: 'https://drive.google.com/file/d/' + f.getId() + '/view' };
}

function baixarArquivo(id) {
  var f = DriveApp.getFileById(id), b = f.getBlob();
  return { id: id, name: f.getName(), mime: b.getContentType(), base64: Utilities.base64Encode(b.getBytes()) };
}

/* ---------- Google Drive (substitui o conector do Claude) ---------- */

function driveSearch(query, pageSize) {
  // aceita o subconjunto usado pelos painéis: parentId = 'X', title contains 'Y', mimeType != 'Z', ligados por "and"
  var PASTA = 'application/vnd.google-apps.folder';
  var partes = String(query || '').split(/\s+and\s+/i), base = [], mimeEq = null, semPastas = false, soPastas = false;
  partes.forEach(function (p) {
    var m;
    if ((m = /parentId\s*=\s*'([^']+)'/.exec(p))) base.push("'" + m[1] + "' in parents");
    else if ((m = /title contains\s*'((?:\\'|[^'])*)'/.exec(p))) base.push("title contains '" + m[1] + "'");
    else if ((m = /mimeType\s*(!=|=)\s*'([^']+)'/.exec(p))) {
      if (m[2] === PASTA) { if (m[1] === '=') soPastas = true; else semPastas = true; }
      else if (m[1] === '=') mimeEq = m[2];
    }
  });
  base.push('trashed = false');
  var files = [], max = pageSize || 100;
  if (!soPastas) {
    var it = DriveApp.searchFiles(base.concat(mimeEq ? ["mimeType = '" + mimeEq + "'"] : []).join(' and '));
    while (it.hasNext() && files.length < max) {
      var f = it.next();
      files.push({ id: f.getId(), title: f.getName(), mimeType: f.getMimeType(), modifiedTime: f.getLastUpdated().toISOString() });
    }
  }
  if (!semPastas && !mimeEq) {
    var pastas = DriveApp.searchFolders(base.join(' and '));
    while (pastas.hasNext() && files.length < max) { var d = pastas.next(); files.push({ id: d.getId(), title: d.getName(), mimeType: PASTA, modifiedTime: d.getLastUpdated().toISOString() }); }
  }
  return { files: files };
}

function driveDownload(fileId, exportMime) {
  var f = DriveApp.getFileById(fileId), blob;
  if (f.getMimeType() === MimeType.GOOGLE_SHEETS && exportMime) {
    var url = 'https://docs.google.com/spreadsheets/d/' + fileId + '/export?format=xlsx';
    blob = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getBlob();
  } else blob = f.getBlob();
  return { content: Utilities.base64Encode(blob.getBytes()), mimeType: blob.getContentType(), title: f.getName() };
}

function driveText(fileId) {
  var f = DriveApp.getFileById(fileId), mt = f.getMimeType();
  if (mt === MimeType.GOOGLE_DOCS) return DocumentApp.openById(fileId).getBody().getText();
  if (mt === MimeType.PLAIN_TEXT || /markdown|csv/.test(mt)) return f.getBlob().getDataAsString('UTF-8');
  // Word, PDF etc.: converte para Documento Google temporário (precisa do serviço avançado "Drive API")
  var copia = Drive.Files.copy({ title: 'tmp_leitura', mimeType: MimeType.GOOGLE_DOCS }, fileId, { ocr: mt === MimeType.PDF });
  try { return DocumentApp.openById(copia.id).getBody().getText(); }
  finally { DriveApp.getFileById(copia.id).setTrashed(true); }
}

/* ---------- IA (opcional, API da Anthropic) ---------- */

function ia(prompt, max) {
  var key = PROPS.getProperty('ANTHROPIC_KEY');
  if (!key) throw { code: 'sampling_disabled', message: 'Função de IA desativada: defina ANTHROPIC_KEY no Apps Script.' };
  var r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: PROPS.getProperty('ANTHROPIC_MODEL') || 'claude-sonnet-4-5', max_tokens: max || 8000, messages: [{ role: 'user', content: prompt }] })
  });
  var j = JSON.parse(r.getContentText());
  if (r.getResponseCode() >= 300) throw { code: r.getResponseCode() === 429 ? 'rate_limited' : 'upstream_error', message: (j.error && j.error.message) || 'Erro na API.' };
  return (j.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
}

/* Rode uma vez pelo editor para autorizar Planilha, Drive e chamadas externas. */
function autorizar() {
  SpreadsheetApp.getActive().getName();
  DriveApp.getRootFolder();
  UrlFetchApp.getRequest('https://api.anthropic.com');
  Logger.log('Autorizado. Pasta de assets: ' + (PROPS.getProperty('PASTA_ASSETS') || '(defina PASTA_ASSETS)'));
}
