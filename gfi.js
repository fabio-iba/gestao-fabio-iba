/*
 * Camada de compatibilidade: faz os painéis (feitos como Artifacts do Claude) funcionarem
 * no GitHub Pages, guardando dados na planilha do Google e arquivos no Google Drive
 * por meio do Apps Script (veja apps-script/Code.gs).
 *
 * Cada página define antes deste script:  <script>window.GFI_APP='gd'</script>
 * e carrega config.js (endereço do Apps Script).
 */
(function () {
  'use strict';
  var CFG = window.GFI_CONFIG || {};
  var API = /^https?:\/\//.test(CFG.api || '') ? CFG.api : '';
  var APP = window.GFI_APP || 'geral';
  var KEY_LS = 'gfi_chave';
  var POLL_MS = CFG.atualizarACada || 20000;

  function erro(code, message) { var e = new Error(message || code); e.code = code; return e; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  /* ---------------- chave de acesso ---------------- */
  // link do professor (gestao-docente.html#p=ID.CODIGO): acesso só às entregas dele, sem a chave
  function portal() {
    if (APP !== 'gd') return '';
    var src = (location.hash || '') + '&' + (location.search || '') + '&p=' + (lsGet('gdPortal') || '');
    var m = /[#?&]p=([\w-]+\.[a-z0-9]+)/i.exec(src);
    return m ? m[1] : '';
  }
  function chave() {
    var k = lsGet(KEY_LS);
    if (!k && portal()) return '';
    while (!k) {
      k = window.prompt('Gestão Fabio Iba\n\nDigite a chave de acesso (definida no Apps Script, propriedade CHAVE).\nEla fica guardada neste navegador.');
      if (k === null) break;
      k = String(k).trim();
      if (k) lsSet(KEY_LS, k);
    }
    return k || '';
  }
  function trocarChave() { try { localStorage.removeItem(KEY_LS); } catch (e) {} location.reload(); }

  /* ---------------- chamadas ao Apps Script ----------------
   * O navegador bloqueia (CORS) a leitura direta das respostas do Apps Script.
   * Por isso: pedidos pequenos vão por JSONP (<script>); grandes vão por POST sem
   * leitura da resposta e o resultado é buscado depois por JSONP (op "resultado"). */
  var seqCb = 0;
  function jsonp(obj) {
    return new Promise(function (ok, no) {
      var nome = '__gfi' + Date.now().toString(36) + (seqCb++), s = document.createElement('script'), fim = false;
      var t = setTimeout(function () { limpar(); no(erro('server_unavailable', 'O servidor (Apps Script) não respondeu.')); }, 60000);
      function limpar() { fim = true; clearTimeout(t); try { delete window[nome]; } catch (e) { window[nome] = undefined; } if (s.parentNode) s.parentNode.removeChild(s); }
      window[nome] = function (j) { if (fim) return; limpar(); ok(j); };
      s.onerror = function () { if (fim) return; limpar(); no(erro('server_unavailable', 'Sem conexão com o servidor (Apps Script). Verifique a internet e o endereço em config.js.')); };
      s.src = API + '?callback=' + nome + '&q=' + encodeURIComponent(JSON.stringify(obj));
      (document.head || document.documentElement).appendChild(s);
    });
  }
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function postGrande(corpo) {
    var rid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    corpo.rid = rid;
    return fetch(API, { method: 'POST', mode: 'no-cors', body: JSON.stringify(corpo), headers: { 'Content-Type': 'text/plain;charset=utf-8' } })
      .then(function () {
        var n = 0;
        function buscar() {
          return jsonp({ op: 'resultado', key: corpo.key, rid: rid }).then(function (j) {
            if (j && j.code === 'pending' && ++n < 80) return esperar(2000).then(buscar);
            return j;
          });
        }
        return buscar();
      });
  }
  function api(op, dados) {
    if (!API) return Promise.reject(erro('not_configured', 'Configure o endereço do Apps Script em config.js.'));
    var corpo = Object.assign({ op: op, key: chave(), app: APP }, dados || {});
    if (!corpo.key && portal()) corpo.portal = portal();
    var txt = JSON.stringify(corpo);
    var req = txt.length < 5000 ? jsonp(corpo) : postGrande(corpo);
    return req.then(function (j) {
        if (!j || !j.ok) {
          if (j && j.code === 'not_granted' && !corpo.portal) { try { localStorage.removeItem(KEY_LS); } catch (e) {} aviso('Chave de acesso incorreta. Recarregue a página e digite a chave de novo.'); }
          throw erro((j && j.code) || 'internal', (j && j.message) || 'Erro no servidor.');
        }
        return j.data;
      }, function (e) { console.error('GFI api', op, e); if (e && e.code) throw e; throw erro('server_unavailable', 'Sem conexão com o servidor (Apps Script).'); });
  }

  // dados lidos ANTES dos scripts da página (página inicial, calendário e chaves do navegador):
  // carregados por um <script> escrito durante a leitura do <head>, que roda antes do resto da página
  var PRE = window.GFI_PRE = { ok: false, data: null };
  window.__gfiPre = function (j) { PRE.ok = !!(j && j.ok); PRE.data = PRE.ok ? j.data : null; };
  if (API && document.readyState === 'loading') {
    var colsPre = []; if (APP === 'inicio' || APP === 'cal') colsPre.push('paginas'); if ((window.GFI_LS || []).length) colsPre.push('navegador');
    if (colsPre.length) document.write('<script src="' + API + '?callback=__gfiPre&q=' + encodeURIComponent(JSON.stringify({ op: 'listMany', key: chave(), app: APP, cols: colsPre })) + '"><\/script>');
  }
  function apiSync(op, dados) { return PRE.ok ? PRE.data : null; }

  function aviso(msg) {
    var id = 'gfi-aviso', el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div'); el.id = id;
      el.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:99999;background:#B92F26;color:#fff;padding:10px 16px;border-radius:10px;font:600 14px Arial,sans-serif;max-width:calc(100vw - 32px);box-shadow:0 8px 24px rgba(0,0,0,.25)';
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = msg; el.hidden = false;
    clearTimeout(el._t); el._t = setTimeout(function () { el.hidden = true; }, 9000);
  }

  /* ---------------- banco (planilha), mesma forma do db do Claude ---------------- */
  var cache = {}, ouvintes = {}, pendentes = {}, agendado = null, timer = null, escritasEmCurso = 0;

  function snapshot(col) {
    var m = cache[col] || {}, ids = Object.keys(m).sort();
    var docs = ids.map(function (id) { var d = m[id]; return { id: id, exists: true, data: function () { return clone(d); } }; });
    return { docs: docs, size: docs.length, empty: !docs.length, forEach: function (f) { docs.forEach(f); } };
  }
  function avisar(col) { (ouvintes[col] || []).forEach(function (o) { try { o.cb(snapshot(col)); } catch (e) { console.error(e); } }); }

  function carregar(cols) {
    return api('listMany', { cols: cols }).then(function (res) {
      cols.forEach(function (col) {
        var m = {};
        (res[col] || []).forEach(function (d) { m[d.id] = d.data; });
        var antes = JSON.stringify(cache[col] || null), depois = JSON.stringify(m);
        cache[col] = m;
        if (antes !== depois || !ouvintes[col].primeira) { ouvintes[col].primeira = true; avisar(col); }
      });
    });
  }
  function agendarCarga(col) {
    pendentes[col] = 1;
    if (agendado) return;
    agendado = setTimeout(function () {
      var cols = Object.keys(pendentes); pendentes = {}; agendado = null;
      carregar(cols).catch(function (e) { cols.forEach(function (c) { (ouvintes[c] || []).forEach(function (o) { if (o.err) o.err(e); }); }); aviso(e.message); });
      if (!timer) timer = setInterval(function () {
        if (document.hidden || escritasEmCurso) return;
        carregar(Object.keys(ouvintes)).catch(function () {});
      }, POLL_MS);
    }, 0);
  }

  function partes(path) { var p = String(path).split('/'); return { col: p.slice(0, -1).join('/'), id: p[p.length - 1] }; }
  function novoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

  function aplicarLocal(col, id, op, data) {
    cache[col] = cache[col] || {};
    if (op === 'delete') delete cache[col][id];
    else if (op === 'set') cache[col][id] = clone(data);
    else {
      var alvo = cache[col][id] = cache[col][id] || {};
      Object.keys(data).forEach(function (k) {
        var ps = k.split('.'), o = alvo;
        for (var i = 0; i < ps.length - 1; i++) { if (typeof o[ps[i]] !== 'object' || o[ps[i]] === null) o[ps[i]] = {}; o = o[ps[i]]; }
        var v = data[k], u = ps[ps.length - 1];
        if (v && typeof v === 'object' && v.__delete__) delete o[u]; else o[u] = clone(v);
      });
    }
  }

  function docRef(col, id) {
    function escrever(op, data) {
      var antes = clone((cache[col] || {})[id]);
      aplicarLocal(col, id, op, data);
      if (ouvintes[col]) avisar(col);
      escritasEmCurso++;
      return api(op, { col: col, id: id, data: data }).then(function () { escritasEmCurso--; },
        function (e) {
          escritasEmCurso--;
          cache[col] = cache[col] || {};
          if (antes === undefined) delete cache[col][id]; else cache[col][id] = antes;
          if (ouvintes[col]) avisar(col);
          throw e;
        });
    }
    return {
      id: id, path: col + '/' + id,
      set: function (data) { return escrever('set', data || {}); },
      update: function (data) { return escrever('update', data || {}); },
      delete: function () { return escrever('delete'); },
      get: function () {
        var p = ouvintes[col] && cache[col] ? Promise.resolve() : carregar([col]).catch(function () {});
        return p.then(function () { var d = (cache[col] || {})[id]; return { id: id, exists: d !== undefined, data: function () { return clone(d); } }; });
      }
    };
  }

  var db = {
    collection: function (col) {
      return {
        doc: function (id) { return docRef(col, id || novoId()); },
        onSnapshot: function (cb, err) {
          var lista = ouvintes[col] = ouvintes[col] || [];
          var o = { cb: cb, err: err }; lista.push(o);
          if (cache[col] && lista.primeira) setTimeout(function () { cb(snapshot(col)); }, 0); else agendarCarga(col);
          return function () { var i = lista.indexOf(o); if (i >= 0) lista.splice(i, 1); };
        },
        get: function () { return carregar([col]).then(function () { return snapshot(col); }); },
        add: function (data) { var r = docRef(col, novoId()); return r.set(data).then(function () { return r; }); }
      };
    },
    doc: function (path) { var p = partes(path); return docRef(p.col, p.id); }
  };

  /* ---------------- usuário: o site é só do coordenador ---------------- */
  var user = {
    me: function () { return Promise.resolve({ id: 'coordenador', name: CFG.nome || 'Fabio Iba', isOwner: true }); },
    isOwner: function () { return Promise.resolve(true); },
    canEdit: function () { return Promise.resolve(true); },
    can: function () { return Promise.resolve(true); }
  };

  /* ---------------- downloads ---------------- */
  var downloads = {
    save: function (o) {
      o = o || {};
      var data = o.data, blob = data instanceof Blob ? data : new Blob([data], { type: o.mimeType || o.type || 'application/octet-stream' });
      var u = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = u; a.download = o.filename || 'arquivo'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 30000);
      return Promise.resolve({ saved: true });
    }
  };

  /* ---------------- arquivos no Drive ---------------- */
  function base64DeBlob(b) {
    return new Promise(function (ok, no) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { no(erro('invalid_argument', 'Não consegui ler o arquivo.')); };
      r.readAsDataURL(b);
    });
  }
  function bytesDeBase64(s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  var assets = {
    upload: function (blob, opts) {
      if (!(blob instanceof Blob)) blob = new Blob([blob]);
      if (blob.size > 25 * 1024 * 1024) return Promise.reject(erro('too_large', 'Arquivo acima de 25 MB.'));
      return base64DeBlob(blob).then(function (b64) {
        var nome = (opts && opts.name) || blob.name || (APP + '_' + novoId() + (/jpeg/.test(blob.type) ? '.jpg' : /png/.test(blob.type) ? '.png' : /pdf/.test(blob.type) ? '.pdf' : ''));
        return api('upload', { name: nome, mime: blob.type, base64: b64 });
      }).then(function (r) { return { id: r.id, url: imgUrl(r.id), name: r.name, size: r.size }; });
    }
  };
  function imgUrl(id) { return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w2000'; }

  // fetch de arquivos do Drive (bytes) passa pelo Apps Script, que tem acesso à pasta
  var fetchOrig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var m = /^https:\/\/drive\.google\.com\/(?:thumbnail\?id=|file\/d\/|uc\?(?:export=\w+&)?id=)([\w-]+)/.exec(url);
    if (m) return api('arquivo', { id: decodeURIComponent(m[1]) }).then(function (r) { return new Response(bytesDeBase64(r.base64), { status: 200, headers: { 'Content-Type': r.mime } }); });
    return fetchOrig(input, init);
  };

  /* ---------------- Google Drive (substitui o conector do Claude) ---------------- */
  var mcp = {
    callTool: function (server, tool, args) {
      args = args || {};
      if (tool === 'search_files') return api('driveSearch', { query: args.query, pageSize: args.pageSize }).then(function (r) { return { payload: r }; });
      if (tool === 'download_file_content') return api('driveDownload', { fileId: args.fileId, exportMimeType: args.exportMimeType }).then(function (r) { return { payload: r }; });
      if (tool === 'read_file_content') return api('driveText', { fileId: args.fileId }).then(function (t) { return { payload: { fileContent: t } }; });
      return Promise.reject(erro('tool_error', 'Ferramenta não disponível fora do Claude: ' + tool));
    }
  };

  /* ---------------- IA (opcional: API da Anthropic pelo Apps Script) ---------------- */
  function extrairJson(t) {
    t = String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(t); } catch (e) {}
    var i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch (e) {} }
    throw erro('invalid_json', 'A resposta da IA veio fora do formato esperado.');
  }
  var sample = {
    text: function (prompt, o) { return api('ia', { prompt: String(prompt), max: o && o.maxTokens }); },
    json: function (prompt, o) { return api('ia', { prompt: String(prompt) + '\n\nResponda somente com JSON válido, sem texto antes ou depois.', max: o && o.maxTokens }).then(extrairJson); }
  };

  /* ---------------- páginas que guardam os próprios dados (início e calendário) ---------------- */
  var artifact = {
    publish: function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var s = doc.querySelector('script[type="application/json"][id]');
      if (!s) return Promise.reject(erro('invalid_argument', 'Dados da página não encontrados.'));
      var dados = JSON.parse(s.textContent);
      return db.doc('paginas/' + s.id).set({ json: JSON.stringify(dados) }).then(function () {
        if (APP === 'inicio') setTimeout(function () { location.reload(); }, 800);
      });
    }
  };
  // dados salvos da página (carregados antes dos scripts dela)
  window.GFI_DADOS_PAGINA = function (idScript) {
    var r = apiSync('listMany', { cols: ['paginas'] });
    var d = r && (r.paginas || []).filter(function (x) { return x.id === idScript; })[0];
    if (d && d.data && d.data.json) { try { return JSON.parse(d.data.json); } catch (e) {} }
    return null;
  };

  // chaves do navegador que a página usa como "banco" (histórico da Validação, checklist do Roteiro):
  // passam a ser guardadas na planilha, para valer em qualquer computador
  var LS = window.GFI_LS || [];
  if (LS.length && API) {
    var setOrig = Storage.prototype.setItem, rmOrig = Storage.prototype.removeItem;
    // os valores guardados chegam pelo <script> pré-carregado, que roda logo depois deste arquivo
    var preOrig = window.__gfiPre;
    window.__gfiPre = function (j) {
      preOrig(j);
      var r0 = PRE.data;
      ((r0 && r0.navegador) || []).forEach(function (d) { if (LS.indexOf(d.id) >= 0 && d.data && typeof d.data.v === 'string') { try { setOrig.call(localStorage, d.id, d.data.v); } catch (e) {} } });
    };
    Storage.prototype.setItem = function (k, v) {
      setOrig.call(this, k, v);
      if (this === localStorage && LS.indexOf(k) >= 0) db.doc('navegador/' + k).set({ v: String(v) }).catch(function (e) { aviso('Não foi possível salvar na planilha: ' + e.message); });
    };
    Storage.prototype.removeItem = function (k) {
      rmOrig.call(this, k);
      if (this === localStorage && LS.indexOf(k) >= 0) db.doc('navegador/' + k).delete().catch(function () {});
    };
  }

  var CAPS = { db: db, user: user, downloads: downloads, assets: assets, mcp: mcp, sample: sample, artifact: artifact };
  window.claude = window.claude || {};
  window.claude.use = function (nome) { return Promise.resolve(CAPS[nome] || null); };
  window.GFI = { api: api, trocarChave: trocarChave, imgUrl: imgUrl, db: db };
})();
