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
  var p = (e && e.parameter) || {}, cb = p.callback;
  var req = {}; try { req = p.q ? JSON.parse(p.q) : {}; } catch (err) { return responder({ ok: false, code: 'invalid_argument', message: 'Pedido mal formado.' }, cb); }
  var res;
  if (req.op === 'resultado') {
    // resultado de um pedido grande enviado antes por POST (rid)
    var pm = /^([\w-]+)\.([a-z0-9]+)$/i.exec(String(req.portal || ''));
    if (req.key !== PROPS.getProperty('CHAVE') && !(pm && codProf(pm[1]) === pm[2].toLowerCase())) res = { ok: false, code: 'not_granted', message: 'Chave de acesso incorreta.' };
    else { var t = CacheService.getScriptCache().get('rid_' + req.rid); res = t ? JSON.parse(t) : { ok: false, code: 'pending', message: 'Aguardando.' }; }
  } else res = tratar(req);
  return responder(res, cb);
}

function doPost(e) {
  var req = {};
  try { req = JSON.parse(e.postData.contents); } catch (err) { return responder({ ok: false, code: 'invalid_argument', message: 'Pedido mal formado.' }); }
  var res = tratar(req);
  if (req.rid) { var t = JSON.stringify(res); if (t.length < 95000) CacheService.getScriptCache().put('rid_' + req.rid, t, 600); }
  return responder(res);
}

// com "callback" responde em JSONP (lido por <script>, sem bloqueio de CORS)
function responder(obj, cb) {
  var txt = JSON.stringify(obj);
  if (cb && /^[\w.$]{1,80}$/.test(cb)) return ContentService.createTextOutput(cb + '(' + txt + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(txt).setMimeType(ContentService.MimeType.JSON);
}

function tratar(req) {
  try {
    var chave = PROPS.getProperty('CHAVE');
    if (!chave) return { ok: false, code: 'not_configured', message: 'Defina a propriedade CHAVE no Apps Script.' };
    if (req.key !== chave) {
      if (req.portal) return tratarPortal(req);
      return { ok: false, code: 'not_granted', message: 'Chave de acesso incorreta.' };
    }
    var op = req.op;
    if (op === 'ping') return { ok: true };
    // escolhas enviadas pelo link do professor, mesmo quando o navegador já tem a chave da coordenação
    if (op === 'escolhas') {
      var pe = /^([\w-]+)\.([a-z0-9]+)$/i.exec(String(req.portal || req.pid || ''));
      if (!pe || codProf(pe[1]) !== pe[2].toLowerCase()) return { ok: false, code: 'invalid_argument', message: 'Link do professor inválido.' };
      return comTrava(function () { return { ok: true, data: salvarEscolhas(pe[1], req.lista || [], req.obs || '') }; });
    }
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

/* ---------- link do professor: lê as entregas e marca "Entreguei", sem a chave ---------- */
function codProf(pid) {
  var s = String(pid) + '|gd-entregas', x = 7;
  for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0;
  return x.toString(36).slice(-5);
}
function tratarPortal(req) {
  var m = /^([\w-]+)\.([a-z0-9]+)$/i.exec(String(req.portal || ''));
  if (!m || codProf(m[1]) !== m[2].toLowerCase() || req.app !== 'gd') return { ok: false, code: 'not_granted', message: 'Código do professor inválido.' };
  var pid = m[1], op = req.op;
  if (op === 'ping') return { ok: true };
  if (op === 'listMany') {
    var cols = (req.cols || []).filter(function (c) { return ['disciplinas', 'pessoas', 'entregas', 'confirmacoes', 'cursos', 'habilitacoes', 'escolhas'].indexOf(c) >= 0; });
    var r = listMany('gd', cols);
    if (r.pessoas) r.pessoas = r.pessoas.filter(function (d) { return d.id === pid; });
    if (r.confirmacoes) r.confirmacoes = r.confirmacoes.filter(function (d) { return d.data && d.data.professorId === pid; });
    if (r.escolhas) r.escolhas = r.escolhas.filter(function (d) { return d.id === pid; });
    // das habilitações, o link só recebe as disciplinas fixas (para travar as de outros professores)
    if (r.habilitacoes) r.habilitacoes = r.habilitacoes.map(function (d) { var f = (d.data && d.data.fixas) || {}; return { id: d.id, data: { fixas: { ead: f.ead || [], estendida: f.estendida || [] } } }; });
    return { ok: true, data: r };
  }
  if (op === 'escolhas') return comTrava(function () { return { ok: true, data: salvarEscolhas(pid, req.lista || [], req.obs || '') }; });
  if ((op === 'set' || op === 'delete') && req.col === 'confirmacoes') {
    return comTrava(function () {
      var atual = listMany('gd', ['confirmacoes']).confirmacoes.filter(function (d) { return d.id === String(req.id); })[0];
      if (atual && atual.data && atual.data.professorId !== pid) return { ok: false, code: 'not_granted', message: 'Entrega de outro professor.' };
      if (op === 'set' && (!req.data || req.data.professorId !== pid)) return { ok: false, code: 'not_granted', message: 'Entrega de outro professor.' };
      if (op === 'delete' && !atual) return { ok: true, data: null };
      return { ok: true, data: gravar({ app: 'gd', col: 'confirmacoes', id: req.id, op: op, data: req.data }) };
    });
  }
  return { ok: false, code: 'not_granted', message: 'Operação não permitida pelo link do professor.' };
}

/* ---------- escolha de disciplinas pelos professores (preferencias.html) ---------- */
function chaveDisc(n) { return String(n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ''); }
function dataBR(d) { return Utilities.formatDate(d, 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm'); }

function salvarEscolhas(pid, lista, obs) {
  // não aceita disciplina fixa de outro professor
  var fixasOutros = {};
  listMany('gd', ['habilitacoes']).habilitacoes.forEach(function (h) {
    if (h.id === pid) return;
    var f = (h.data && h.data.fixas) || {};
    (f.ead || []).concat(f.estendida || []).forEach(function (k) { fixasOutros[k] = 1; });
  });
  lista = lista.filter(function (x) { return x && x.chave && !fixasOutros[x.chave]; });
  var agora = new Date();
  gravar({ app: 'gd', col: 'escolhas', id: pid, op: 'set', data: { professorId: pid, lista: lista, obs: String(obs).slice(0, 2000), enviadoEm: agora.toISOString() } });

  var pes = listMany('gd', ['pessoas']).pessoas.filter(function (d) { return d.id === pid; })[0];
  var nome = (pes && pes.data && pes.data.nome) || pid, email = (pes && pes.data && pes.data.email) || '';
  var sh = planilhaEscolhas(), dados = sh.getDataRange().getValues();
  for (var i = dados.length - 1; i >= 1; i--) if (String(dados[i][1]) === pid) sh.deleteRow(i + 1);
  var linhas = lista.map(function (x) { return [dataBR(agora), pid, nome, email, x.modulo || '', x.nome || '', x.cursos || '', x.ano || '', x.fixa ? 'Fixa' : '', obs || '']; });
  if (!linhas.length) linhas = [[dataBR(agora), pid, nome, email, '', '(nenhuma disciplina marcada)', '', '', '', obs || '']];
  sh.getRange(sh.getLastRow() + 1, 1, linhas.length, linhas[0].length).setValues(linhas);
  abaProfessor(sh.getParent(), nome, email, agora, lista, obs);
  return { total: lista.length, enviadoEm: agora.toISOString() };
}

// uma aba por professor, refeita a cada envio
function abaProfessor(ss, nome, email, agora, lista, obs) {
  var titulo = String(nome).replace(/[\/\\?*\[\]:]/g, ' ').slice(0, 90) || 'Professor';
  var sh = ss.getSheetByName(titulo);
  if (!sh) sh = ss.insertSheet(titulo); else sh.clear();
  sh.getRange(1, 1, 4, 2).setValues([['Professor', nome], ['E-mail', email], ['Enviado em', dataBR(agora)], ['Observação', obs || '']]);
  sh.getRange(1, 1, 4, 1).setFontWeight('bold');
  var cab = [['Módulo', 'Disciplina', 'Cursos / matrizes', 'Ano', 'Situação']];
  sh.getRange(6, 1, 1, 5).setValues(cab).setFontWeight('bold').setBackground('#DDF1F1');
  var linhas = lista.map(function (x) { return [x.modulo || '', x.nome || '', x.cursos || '', x.ano || '', x.fixa ? 'Fixa' : '']; });
  if (!linhas.length) linhas = [['', '(nenhuma disciplina marcada)', '', '', '']];
  sh.getRange(7, 1, linhas.length, 5).setValues(linhas);
  sh.setFrozenRows(6);
  sh.setColumnWidth(1, 110); sh.setColumnWidth(2, 360); sh.setColumnWidth(3, 260); sh.setColumnWidth(4, 70); sh.setColumnWidth(5, 90);
}

function planilhaEscolhas() {
  var id = PROPS.getProperty('ESCOLHAS_PLANILHA'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Escolha de disciplinas - professores');
    try { DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents().next()); } catch (e) {}
    PROPS.setProperty('ESCOLHAS_PLANILHA', ss.getId());
    var s0 = ss.getSheets()[0];
    s0.setName('Escolhas');
    s0.getRange(1, 1, 1, 10).setValues([['Enviado em', 'ID professor', 'Professor', 'E-mail', 'Módulo', 'Disciplina', 'Cursos / matrizes', 'Ano', 'Situação', 'Observação']]).setFontWeight('bold');
    s0.setFrozenRows(1);
  }
  return ss.getSheetByName('Escolhas') || ss.getSheets()[0];
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

/* ---------- atualização automática a partir do GitHub ----------
 * A cada 10 minutos, busca apps-script/Code.gs e appsscript.json no repositório.
 * Se mudaram, troca o código deste projeto, cria uma nova versão e atualiza a
 * implantação do site (mesmo endereço /exec). Instale uma vez rodando
 * instalarAtualizacaoAutomatica() no editor.
 * Requer: "API do Google Apps Script" ativada em script.google.com/home/usersettings */
var REPO_RAW = 'https://raw.githubusercontent.com/fabio-iba/gestao-fabio-iba/main/apps-script/';
var IMPLANTACAO_SITE = 'AKfycbwlUiqOBPX4Rqi1G8mWnDJpc0zemk332aH_-vGdHhn-M640-rneKvBx7SBr_USLNPuv';

function instalarAtualizacaoAutomatica() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'atualizarDoGitHub') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('atualizarDoGitHub').timeBased().everyMinutes(10).create();
  atualizarDoGitHub(true);
  Logger.log('Atualização automática instalada (a cada 10 minutos).');
}

function atualizarDoGitHub(forcar) {
  var t = '?t=' + Date.now();
  var gs = UrlFetchApp.fetch(REPO_RAW + 'Code.gs' + t).getContentText();
  var man = UrlFetchApp.fetch(REPO_RAW + 'appsscript.json' + t).getContentText();
  if (gs.indexOf('function atualizarDoGitHub') < 0) throw new Error('Código do GitHub sem a função de atualização; ignorado por segurança.');
  JSON.parse(man);
  var hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, gs + '\n' + man));
  if (forcar !== true && hash === PROPS.getProperty('VERSAO_GITHUB')) return 'sem mudanças';
  var base = 'https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId();
  var op = { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, contentType: 'application/json', muteHttpExceptions: true };
  function chamar(metodo, url, corpo) {
    var r = UrlFetchApp.fetch(url, Object.assign({ method: metodo, payload: corpo ? JSON.stringify(corpo) : undefined }, op));
    if (r.getResponseCode() >= 300) throw new Error(metodo + ' ' + url + ' -> ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 400));
    return JSON.parse(r.getContentText() || '{}');
  }
  chamar('put', base + '/content', { files: [{ name: 'Code', type: 'SERVER_JS', source: gs }, { name: 'appsscript', type: 'JSON', source: man }] });
  var v = chamar('post', base + '/versions', { description: 'GitHub ' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm') });
  chamar('put', base + '/deployments/' + IMPLANTACAO_SITE, { deploymentConfig: { versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Site (atualizado do GitHub)' } });
  PROPS.setProperty('VERSAO_GITHUB', hash);
  Logger.log('Atualizado para a versão ' + v.versionNumber);
  return 'versão ' + v.versionNumber;
}
