// Muse Carpathron — front end (desktop window, Quest browser, phone browser)
'use strict';
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  };
  const isDesktop = !!window.desktop;

  // ------------------------------------------------------------ state
  const S = {
    boot: null, settings: null, convs: [], projects: [], skills: [],
    conv: null, view: 'chat', running: new Set(), models: { api: [], muse: [] },
    attachments: [], ws: null, activity: [],
  };
  window.MC = S;

  // ------------------------------------------------------------ api
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json' },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
    return data;
  }
  function toast(text, err = false) {
    const t = $('#toast');
    t.textContent = text; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), err ? 6000 : 2800);
  }
  const fmtDate = (ts) => {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString();
  };
  const md = (text) => {
    try { return DOMPurify.sanitize(marked.parse(String(text || ''), { breaks: true, gfm: true })); }
    catch { return DOMPurify.sanitize(String(text || '').replace(/</g, '&lt;')); }
  };
  const readFileB64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

  // ------------------------------------------------------------ websocket
  function connectWs() {
    const ws = new WebSocket(`wss://${location.host}/ws`);
    S.ws = ws;
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onEvent(m.event, m.data); };
    ws.onclose = () => { S.wsWasDown = true; setTimeout(connectWs, 1500); renderFoot(); };
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'hello', desktop: isDesktop, camera: window.MCcamOffer && window.MCcamOffer() })); renderFoot(); if (S.conv && S.conv.id && S.wsWasDown) resyncConv(); S.wsWasDown = false; };
  }
  window.MCreconnect = () => { try { S.ws && S.ws.close(); } catch {} };
  window.MCsend = (obj) => { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(obj)); };

  function onEvent(ev, d) {
    switch (ev) {
      case 'msg:add': if (S.conv && d.convId === S.conv.id) { S.conv.messages.push(d.msg); appendMsg(d.msg); } break;
      case 'msg:patch': if (S.conv && d.convId === S.conv.id) { const m = S.conv.messages.find((x) => x.id === d.id); if (m) { Object.assign(m, d.patch); updateMsg(m); } } break;
      case 'msg:delta': if (S.conv && d.convId === S.conv.id) { const m = S.conv.messages.find((x) => x.id === d.id); if (m) { m[d.field] = (m[d.field] || '') + d.delta; updateMsg(m, true); } } break;
      case 'turn:status': if (S.conv && d.convId === S.conv.id) setStatus(d.text); break;
      case 'turn:state':
        if (d.running) S.running.add(d.convId); else S.running.delete(d.convId);
        if (S.conv && d.convId === S.conv.id) setRunning(d.running);
        renderChatList();
        break;
      case 'conv:update': {
        const i = S.convs.findIndex((c) => c.id === d.id);
        if (i >= 0) S.convs[i] = { ...S.convs[i], ...d }; else S.convs.unshift(d);
        S.convs.sort((a, b) => b.updatedAt - a.updatedAt);
        if (S.conv && S.conv.id === d.id && d.title && document.activeElement !== $('#chatTitle')) $('#chatTitle').value = d.title;
        renderChatList();
        break;
      }
      case 'conv:delete': S.convs = S.convs.filter((c) => c.id !== d.id); renderChatList(); if (S.conv && S.conv.id === d.id) newChat(); break;
      case 'settings:update': S.settings = d; if (S.view === 'chat') renderHead(); break;
      case 'memory:update': if (S.view === 'memory') renderMemory(); break;
      case 'projects:update': refreshProjects(); break;
      case 'skills:update': api('/api/skills').then((x) => { S.skills = x; if (S.view === 'skills') renderSkills(); }); break;
      case 'wa:status': S.boot.wa = d; if (S.view === 'settings') renderWaStatus(); renderFoot(); break;
      case 'mcp:status': S.boot.mcp = d; if (S.view === 'settings') renderMcpStatus(); break;
      case 'activity': S.activity.push(d); if (S.activity.length > 300) S.activity.shift(); if (S.view === 'activity') prependActivity(d); break;
      case 'log': if (S.view === 'activity') { const pre = $('#techLog'); pre.textContent = `${new Date(d.ts).toLocaleTimeString()} ${d.text}\n` + pre.textContent.slice(0, 40000); } break;
      case 'camera:request': captureWebcam(d.id); break;
      case 'camera:photo': window.MCRobot && window.MCRobot.onPhoto && window.MCRobot.onPhoto(d); break;
      case 'robot:status': case 'robot:motors': case 'robot:scan': case 'robot:map': window.MCRobot && window.MCRobot.onEvent(ev, d); break;
      case 'avatar:link': avatarLinkPrompt(d); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ Carpathron Avatar (Quest app) wants to link
  function avatarLinkPrompt(d) {
    const box = h('div', { class: 'avatar-link' },
      h('div', {}, h('b', {}, `🥽 ${d.device} wants to link`), h('div', { class: 'small muted' }, `Carpathron Avatar at ${d.ip} asks to use Muse (voice, "what do you see", look, room scan). Allow only if this is your headset.`)),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: async () => { await api('/api/avatar/decide', { body: { id: d.id, allow: true } }); box.remove(); toast(`${d.device} linked`); } }, 'Allow'),
        h('button', { class: 'btn', onclick: async () => { await api('/api/avatar/decide', { body: { id: d.id, allow: false } }).catch(() => {}); box.remove(); } }, 'Deny')));
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 5 * 60 * 1000);
    try { if (isDesktop && window.desktop.focus) window.desktop.focus(); } catch {}
  }

  // ------------------------------------------------------------ PC webcam (used when the robot has no camera)
  async function captureWebcam(id) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'environment' } }, audio: false });
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.srcObject = stream;
      await v.play();
      await new Promise((r) => setTimeout(r, 700)); // let exposure settle
      const c = document.createElement('canvas');
      c.width = v.videoWidth || 1280; c.height = v.videoHeight || 720;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const dataBase64 = c.toDataURL('image/jpeg', 0.85).split(',')[1];
      await api(`/api/camera/${id}`, { body: { dataBase64 } });
    } catch (e) {
      await api(`/api/camera/${id}`, { body: { error: e.message || String(e) } }).catch(() => {});
    } finally { if (stream) stream.getTracks().forEach((t) => t.stop()); }
  }
  window.MCphotoUrl = (p) => `/api/photo?path=${encodeURIComponent(p)}`;

  // ------------------------------------------------------------ views
  function show(view) {
    S.view = view;
    $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
    document.body.dataset.view = view;
    $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    $('#sidebar').classList.remove('open');
    if (view === 'projects') renderProjects();
    if (view === 'memory') renderMemory();
    if (view === 'skills') renderSkills();
    if (view === 'activity') renderActivity();
    if (view === 'settings') renderSettings();
    if (view === 'robot') window.MCRobot && window.MCRobot.show(S);
    renderChatList();
  }
  $$('#nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
  $('#btnOpenSide').onclick = () => $('#sidebar').classList.add('open');
  $('#btnMenuAll').onclick = () => $('#sidebar').classList.add('open');
  $('#btnCloseSide').onclick = () => $('#sidebar').classList.remove('open');

  // ------------------------------------------------------------ sidebar
  function renderChatList(list) {
    const el = $('#chatList');
    el.innerHTML = '';
    const items = list || S.convs;
    if (list) el.append(h('h4', {}, 'Search results'));
    const today = new Date().toDateString();
    let group = null;
    for (const c of items) {
      if (!list) {
        const g = new Date(c.updatedAt).toDateString() === today ? 'Today' : 'Earlier';
        if (g !== group) { group = g; el.append(h('h4', {}, g)); }
      }
      const proj = c.projectId && S.projects.find((p) => p.id === c.projectId);
      el.append(h('div', { class: 'chat-item' + (S.conv && S.conv.id === (c.id || c.convId) && S.view === 'chat' ? ' on' : ''), role: 'button', tabindex: 0, onclick: () => openConv(c.id || c.convId) },
        S.running.has(c.id) ? h('span', { class: 'run', title: 'working' }) : null,
        h('span', { class: 't', title: c.snippet || c.title }, c.title || 'Untitled'),
        c.source === 'whatsapp' ? h('span', { class: 'badge', title: 'WhatsApp' }, '💬') : null,
        proj ? h('span', { class: 'badge', title: proj.name }, '▦') : null,
        !list ? h('button', { class: 'del', title: 'Delete chat', onclick: async (e) => { e.stopPropagation(); if (confirm(`Delete "${c.title}"?`)) await api(`/api/convs/${c.id}`, { method: 'DELETE' }); } }, '🗑') : null,
      ));
    }
    if (!items.length) el.append(h('div', { class: 'muted small', style: 'padding:8px 10px' }, list ? 'Nothing found.' : 'No chats yet.'));
  }
  let searchT;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchT);
    const q = e.target.value.trim();
    if (!q) return renderChatList();
    searchT = setTimeout(async () => renderChatList(await api(`/api/search?q=${encodeURIComponent(q)}`)), 250);
  });

  function renderFoot() {
    const el = $('#sideFoot');
    if (!S.boot) return;
    const e = S.boot.engines;
    const wa = S.boot.wa;
    const conn = S.ws && S.ws.readyState === 1;
    el.innerHTML = '';
    el.append(...[
      h('div', { class: conn ? 'ok' : 'bad' }, h('span', { class: 'dot' }), conn ? 'Connected' : 'Reconnecting…'),
      h('div', { class: e.muse.installed ? 'ok' : 'warn' }, h('span', { class: 'dot' }), e.muse.installed ? `Muse Code ${e.muse.version || 'installed'}` : 'Muse Code not found'),
      h('div', { class: e.api.hasKey ? 'ok' : 'warn' }, h('span', { class: 'dot' }), e.api.hasKey ? 'Meta API key set' : 'No Meta API key'),
      wa && (wa.personal.status !== 'off' || wa.cloud.status !== 'off') ? h('div', { class: wa.personal.status === 'connected' ? 'ok' : 'warn' }, h('span', { class: 'dot' }), `WhatsApp: ${wa.personal.status !== 'off' ? wa.personal.status : wa.cloud.status}`) : null,
    ].filter(Boolean));
    if (!e.muse.installed && !e.api.hasKey) el.append(h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); show('settings'); } }, 'Connect to Meta →'));
  }

  // ------------------------------------------------------------ chat
  function effectiveEngine(conv) {
    let e = (conv && conv.engine) || S.settings.engine;
    if (e === 'auto') e = S.settings.hasApiKey ? 'api' : (S.boot.engines.muse.installed ? 'muse' : 'api');
    return e;
  }

  async function newChat(projectId = null) {
    S.conv = { id: null, title: 'New chat', messages: [], projectId, workspace: projectId ? (S.projects.find((p) => p.id === projectId)?.workspace || S.settings.workspace) : S.settings.workspace, engine: null, mode: null, draft: true };
    show('chat');
    renderConv();
    $('#input').focus();
  }
  async function ensureConv() {
    if (S.conv && S.conv.id) return S.conv;
    const draft = S.conv || {};
    const c = await api('/api/convs', { body: { projectId: draft.projectId || null, workspace: draft.workspace, engine: draft.engine || undefined } });
    const patch = {};
    if (draft.mode) patch.mode = draft.mode;
    if (draft.model) patch.model = draft.model;
    if (draft.museModel) patch.museModel = draft.museModel;
    if (Object.keys(patch).length) Object.assign(c, await api(`/api/convs/${c.id}`, { method: 'PATCH', body: patch }));
    S.conv = { ...c, messages: [] };
    return S.conv;
  }
  async function openConv(id) {
    try {
      const c = await api(`/api/convs/${id}`);
      S.conv = c;
      S.statusText = c.status || '';
      if (c.running) S.running.add(c.id);
      show('chat');
      renderConv();
    } catch (e) { toast(e.message, true); }
  }
  async function patchConv(patch) {
    if (!S.conv) return;
    if (!S.conv.id) { Object.assign(S.conv, patch); renderHead(); return; }
    try { const c = await api(`/api/convs/${S.conv.id}`, { method: 'PATCH', body: patch }); Object.assign(S.conv, c); renderHead(); }
    catch (e) { toast(e.message, true); }
  }

  function renderConv() {
    renderHead();
    const box = $('#messages');
    box.innerHTML = '';
    const inner = h('div', { class: 'msgs-inner', id: 'msgsInner' });
    box.append(inner);
    if (!S.conv.messages.length) inner.append(emptyState());
    for (const m of S.conv.messages) inner.append(renderMsg(m));
    setRunning(S.running.has(S.conv.id));
    scrollDown(true);
    renderChatList();
  }

  function emptyState() {
    const name = S.conv.projectId ? (S.projects.find((p) => p.id === S.conv.projectId)?.name) : null;
    const sugg = [
      'What can you do on this PC?',
      'Look at my attached folder and summarize the project',
      'Write a Python script that renames photos by date',
      'Drive the robot in a small square',
      '/plan Build a web page for my startup',
    ];
    return h('div', { class: 'empty', id: 'emptyState' },
      h('img', { src: 'icon.png', width: 56, height: 56, style: 'border-radius:14px' }),
      h('h2', {}, name ? `Project: ${name}` : 'How can I help you today?'),
      h('div', { class: 'muted' }, `Engine: ${effectiveEngine(S.conv) === 'muse' ? 'Meta account (Muse Code)' : 'Meta API key'} · Mode: ${S.conv.mode || S.settings.mode}`),
      h('div', { class: 'sugg' }, sugg.map((t) => h('button', { onclick: () => { $('#input').value = t; autoGrow(); $('#input').focus(); } }, t))),
    );
  }

  function renderHead() {
    if (!S.conv) return;
    $('#chatTitle').value = S.conv.title || 'New chat';
    const ws = S.conv.workspace || S.settings.workspace;
    $('#chipFolder span').textContent = ws;
    const proj = S.conv.projectId && S.projects.find((p) => p.id === S.conv.projectId);
    $('#chipProject span').textContent = proj ? proj.name : 'No project';
    const eng = effectiveEngine(S.conv);
    $('#selEngine').value = eng;
    const mode = S.conv.mode || S.settings.mode;
    $$('#segMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    renderModels(eng);
  }

  async function loadModels(engine, force = false) {
    if (S.models[engine].length && !force) return S.models[engine];
    try {
      const r = await api(`/api/models?engine=${engine}`);
      S.models[engine] = r.models || [];
      if (r.error && engine === 'muse') S.models.museError = r.error;
    } catch { S.models[engine] = []; }
    return S.models[engine];
  }
  async function renderModels(engine) {
    const sel = $('#selModel');
    const list = await loadModels(engine);
    const current = engine === 'muse' ? (S.conv.museModel || S.settings.museModel || '') : (S.conv.model || S.settings.model);
    sel.innerHTML = '';
    if (engine === 'muse') sel.append(h('option', { value: '' }, 'Muse default model'));
    for (const m of list) sel.append(h('option', { value: m.id }, m.label || m.id));
    if (current && !list.some((m) => m.id === current)) sel.append(h('option', { value: current }, current));
    sel.value = current;
    sel.title = engine === 'muse' && S.models.museError ? S.models.museError : 'Model';
  }
  $('#selEngine').onchange = (e) => patchConv({ engine: e.target.value });
  $('#selModel').onchange = (e) => (effectiveEngine(S.conv) === 'muse' ? patchConv({ museModel: e.target.value }) : patchConv({ model: e.target.value }));
  $$('#segMode button').forEach((b) => (b.onclick = () => patchConv({ mode: b.dataset.mode })));
  $('#chatTitle').addEventListener('change', (e) => patchConv({ title: e.target.value.trim() || 'Untitled' }));
  $('#chipFolder').onclick = async () => {
    let p = null;
    if (isDesktop) p = await window.desktop.pickFolder(S.conv.workspace || S.settings.workspace);
    else p = prompt('Folder path on the PC:', S.conv.workspace || S.settings.workspace);
    if (p) { await patchConv({ workspace: p }); toast('Folder attached'); }
  };
  $('#chipProject').onclick = async () => {
    const opts = ['(none)', ...S.projects.map((p) => p.name)];
    const pick = prompt(`Put this chat in a project. Type a number:\n${opts.map((o, i) => `${i}. ${o}`).join('\n')}`, '0');
    if (pick === null) return;
    const i = Number(pick);
    if (!(i >= 0 && i < opts.length)) return;
    await patchConv({ projectId: i === 0 ? null : S.projects[i - 1].id });
  };

  // --- message rendering
  const ICON = { running: '◌', done: '✓', error: '✕', denied: '⊘' };
  function renderMsg(m) {
    let el;
    switch (m.role) {
      case 'user':
        el = h('div', { class: 'msg user' },
          m.from && m.from !== 'app' ? h('span', { class: 'from' }, m.from === 'whatsapp' ? '💬 from WhatsApp' : `from ${m.from}`) : null,
          m.text,
          (m.attachments || []).length ? h('span', { class: 'att' }, '📎 ' + m.attachments.map((a) => a.name).join(', ')) : null);
        break;
      case 'assistant':
        el = h('div', { class: 'msg assistant' + (m.streaming ? ' streaming' : ''), html: md(m.text) });
        decorateCode(el);
        break;
      case 'thinking':
        el = h('details', { class: 'fold thinking' }, h('summary', {}, '💭', h('span', {}, `Thinking${m.label ? ' ' + m.label : ''}…`)), h('div', { class: 'body' }, m.text || ''));
        break;
      case 'tool': {
        const out = typeof m.output === 'string' ? m.output : JSON.stringify(m.output, null, 2);
        const args = m.args && typeof m.args === 'object' ? JSON.stringify(m.args, null, 2) : String(m.args || '');
        el = h('details', { class: 'fold tool' + (m.sub ? ' sub' : '') },
          h('summary', {}, h('span', { class: `st ${m.status}` }, ICON[m.status] || '•'), h('span', { class: 'sum' }, m.summary || m.name)),
          h('div', { class: 'body' },
            args && args !== '{}' ? h('pre', { class: 'muted' }, args.length > 4000 ? args.slice(0, 4000) + '…' : args) : null,
            out ? h('pre', {}, out) : (m.status === 'running' ? h('span', { class: 'muted small' }, 'running…') : null)));
        if (m.image) { el.open = true; $('.body', el).prepend(h('img', { class: 'photo', src: window.MCphotoUrl(m.image), alt: 'robot photo', onclick: () => isDesktop && window.desktop.openPath(m.image) })); }
        if (m.status === 'error' && SANDBOX_RE.test(out || '')) { const wrap = h('div', {}, el, sandboxFix()); el.dataset.id = m.id; wrap.dataset.id = m.id; return wrap; }
        break;
      }
      case 'approval': {
        const done = m.status !== 'pending';
        el = h('div', { class: 'approval' + (done ? ' done' : '') },
          h('h5', {}, done ? (m.status === 'approved' ? `✓ Approved${m.decidedBy && m.decidedBy !== 'app' ? ' via ' + m.decidedBy : ''}` : `⊘ Denied${m.decidedBy && m.decidedBy !== 'app' ? ' via ' + m.decidedBy : ''}`) : '🔐 Permission needed'),
          h('div', { class: 'what' }, m.summary),
          !done && m.detail ? h('details', {}, h('summary', {}, 'Details'), h('pre', {}, m.detail)) : null,
          !done ? h('div', { class: 'row' }, (m.choices || []).map((c) => h('button', {
            class: 'btn' + (c.approve ? (c.scope && c.scope !== 'once' ? '' : ' primary') : ' danger'),
            onclick: async () => { try { await api(`/api/approvals/${m.approvalId}`, { body: { choiceId: c.id } }); } catch (e) { toast(e.message, true); } },
          }, c.label))) : null);
        break;
      }
      case 'error': el = h('div', { class: 'msg error' }, '⚠️ ', m.text, SANDBOX_RE.test(m.text || '') ? sandboxFix() : null); break;
      default: el = h('div', { class: 'msg info' }, m.text || '');
    }
    el.dataset.id = m.id;
    return el;
  }
  const SANDBOX_RE = /sandbox (setup has not run|enforcement unavailable)|setup_required/i;
  function sandboxFix() {
    return h('div', { class: 'fixbar' },
      h('span', {}, '🛡 Muse Code needs a one-time Windows sandbox setup before it can run commands.'),
      h('button', { class: 'btn primary', onclick: async () => { try { await api('/api/muse/sandbox', { body: {} }); toast('A setup window opened. Click YES on the Windows prompt, then send your message again.'); } catch (e) { toast(e.message, true); } } }, 'Set up sandbox'));
  }
  function decorateCode(el) {
    $$('pre', el).forEach((pre) => {
      if ($('.copy', pre)) return;
      const b = h('button', { class: 'copy', onclick: () => { navigator.clipboard.writeText(pre.innerText.replace(/Copy$/, '')); b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1200); } }, 'Copy');
      pre.append(b);
    });
  }
  function appendMsg(m) {
    const inner = $('#msgsInner');
    if (!inner) return;
    $('#emptyState')?.remove();
    const near = nearBottom();
    const w = $('#working');
    if (w) inner.insertBefore(renderMsg(m), w); else inner.append(renderMsg(m));
    if (near || m.role === 'user' || m.role === 'approval') scrollDown();
  }
  const pendingRender = new Map();
  function updateMsg(m, isDelta = false) {
    const doIt = () => {
      pendingRender.delete(m.id);
      const old = $(`[data-id="${m.id}"]`, $('#messages'));
      if (!old) return;
      const near = nearBottom();
      if (isDelta && m.role === 'assistant') {
        old.innerHTML = md(m.text);
        old.classList.toggle('streaming', !!m.streaming);
        decorateCode(old);
      } else if (isDelta && (m.role === 'thinking' || m.role === 'tool') && old.tagName === 'DETAILS') {
        const body = $('.body', old);
        if (m.role === 'thinking') body.textContent = m.text;
        else { const pres = $$('pre', body); const out = pres[pres.length - 1]; if (out && !out.classList.contains('muted')) out.textContent = m.output; else { const wasOpen = old.open; const n = renderMsg(m); n.open = wasOpen; old.replaceWith(n); } }
      } else {
        const wasOpen = old.open;
        const n = renderMsg(m);
        if (old.tagName === 'DETAILS' && n.tagName === 'DETAILS') n.open = wasOpen || !!m.image;
        old.replaceWith(n);
      }
      if (near) scrollDown();
    };
    if (isDelta) { if (!pendingRender.has(m.id)) pendingRender.set(m.id, requestAnimationFrame(doIt)); }
    else doIt();
  }
  const nearBottom = () => { const b = $('#messages'); return b.scrollHeight - b.scrollTop - b.clientHeight < 140; };
  const scrollDown = (instant) => { const b = $('#messages'); b.scrollTo({ top: b.scrollHeight, behavior: instant ? 'auto' : 'smooth' }); };

  function setRunning(on) {
    $('#btnSend').hidden = on;
    $('#btnStop').hidden = !on;
    if (on) { if (!S.workStart) S.workStart = Date.now(); setStatus(S.statusText || 'Working…'); }
    else { S.workStart = 0; S.statusText = ''; $('#working')?.remove(); }
  }
  // Live activity indicator: spinner + what it is doing + elapsed time
  function setStatus(text) {
    if (!S.conv || !S.running.has(S.conv.id)) { $('#working')?.remove(); return; }
    if (text) S.statusText = text;
    const inner = $('#msgsInner');
    if (!inner) return;
    let w = $('#working');
    if (!w) {
      w = h('div', { class: 'working', id: 'working' }, h('span', { class: 'spinner' }), h('span', { class: 'wtext' }), h('span', { class: 'wtime' }));
    }
    inner.append(w); // keep it last
    $('.wtext', w).textContent = S.statusText || 'Working…';
    const near = nearBottom();
    if (near) scrollDown(true);
  }
  setInterval(() => {
    const w = $('#working');
    if (w && S.workStart) $('.wtime', w).textContent = `${Math.round((Date.now() - S.workStart) / 1000)}s`;
  }, 1000);
  async function resyncConv() {
    if (!S.conv || !S.conv.id) return;
    try {
      const c = await api(`/api/convs/${S.conv.id}`);
      if (c.running) S.running.add(c.id); else S.running.delete(c.id);
      const changed = c.messages.length !== S.conv.messages.length || JSON.stringify(c.messages.slice(-1)) !== JSON.stringify(S.conv.messages.slice(-1));
      S.statusText = c.status || S.statusText;
      if (changed) { S.conv = c; renderConv(); } else setRunning(!!c.running);
    } catch {}
  }
  // Fallback: if the live connection is down, poll the open chat so output still appears.
  setInterval(() => { if ((!S.ws || S.ws.readyState !== 1) && S.view === 'chat') resyncConv(); }, 1500);

  // --- composer
  const input = $('#input');
  function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(240, input.scrollHeight) + 'px'; }
  input.addEventListener('input', () => { autoGrow(); updateSlash(); });
  input.addEventListener('keydown', (e) => {
    if (!$('#slash').hidden && ['ArrowDown', 'ArrowUp', 'Tab'].includes(e.key)) { e.preventDefault(); moveSlash(e.key === 'ArrowUp' ? -1 : 1); return; }
    if (!$('#slash').hidden && e.key === 'Enter' && $('#slash .sel')) { e.preventDefault(); $('#slash .sel').click(); return; }
    if (e.key === 'Escape') $('#slash').hidden = true;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
  });
  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && !S.attachments.length) return;
    if (text === '/new') { input.value = ''; autoGrow(); return newChat(); }
    $('#btnSend').disabled = true;
    try {
      const conv = await ensureConv();
      const attachments = S.attachments;
      const body = { text: text || '(see attached files)', attachments: await Promise.all(attachments.map(async (f) => ({ name: f.name, dataBase64: await readFileB64(f) }))) };
      input.value = ''; autoGrow(); S.attachments = []; renderAttachments(); $('#slash').hidden = true;
      if (!S.convs.some((c) => c.id === conv.id)) { S.convs.unshift({ id: conv.id, title: conv.title, updatedAt: Date.now() }); renderChatList(); }
      S.running.add(conv.id); S.workStart = Date.now(); S.statusText = 'Sending…'; setRunning(true);
      await api(`/api/convs/${conv.id}/send`, { body });
    } catch (err) { toast(err.message, true); }
    finally { $('#btnSend').disabled = false; }
  });
  $('#btnStop').onclick = async () => { if (S.conv && S.conv.id) await api(`/api/convs/${S.conv.id}/stop`, { body: {} }); };
  $('#btnNewChat').onclick = () => newChat();
  $('#btnAttach').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  function addFiles(files) {
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) { toast(`${f.name} is larger than 25 MB`, true); continue; }
      S.attachments.push(f);
    }
    renderAttachments();
  }
  function renderAttachments() {
    const el = $('#attachments');
    el.innerHTML = '';
    S.attachments.forEach((f, i) => el.append(h('span', {}, `📎 ${f.name} `, h('button', { title: 'Remove', onclick: () => { S.attachments.splice(i, 1); renderAttachments(); } }, '✕'))));
  }
  $('#view-chat').addEventListener('dragover', (e) => { e.preventDefault(); });
  $('#view-chat').addEventListener('drop', (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });

  // --- slash menu
  function slashItems() {
    const builtins = [
      { name: 'new', description: 'Start a new chat' },
      { name: 'remember', description: 'Save something to memory: /remember I prefer short answers' },
    ];
    return [...builtins, ...S.skills.map((s) => ({ name: s.name, description: s.description }))];
  }
  function updateSlash() {
    const v = input.value;
    const m = v.match(/^\/([\w-]*)$/);
    const box = $('#slash');
    if (!m) { box.hidden = true; return; }
    const items = slashItems().filter((s) => s.name.startsWith(m[1].toLowerCase()));
    if (!items.length) { box.hidden = true; return; }
    box.innerHTML = '';
    items.forEach((s, i) => box.append(h('button', { type: 'button', class: i === 0 ? 'sel' : '', onclick: () => { input.value = `/${s.name} `; box.hidden = true; input.focus(); autoGrow(); } }, h('b', {}, `/${s.name}`), h('span', {}, s.description))));
    box.hidden = false;
  }
  function moveSlash(dir) {
    const btns = $$('#slash button');
    let i = btns.findIndex((b) => b.classList.contains('sel'));
    btns[i]?.classList.remove('sel');
    i = (i + dir + btns.length) % btns.length;
    btns[i].classList.add('sel');
    btns[i].scrollIntoView({ block: 'nearest' });
  }

  // ------------------------------------------------------------ projects
  async function refreshProjects() {
    S.projects = await api('/api/projects');
    if (S.view === 'projects') renderProjects(S.openProject);
    if (S.view === 'chat') renderHead();
  }
  function renderProjects(openId) {
    const list = $('#projectList');
    list.innerHTML = '';
    for (const p of S.projects) {
      list.append(h('div', { class: 'card', onclick: () => renderProjects(p.id) },
        h('b', {}, p.name), h('p', {}, `${p.files.length} files · ${p.instructions ? 'has instructions' : 'no instructions'}`)));
    }
    if (!S.projects.length) list.append(h('div', { class: 'muted' }, 'No projects yet.'));
    const det = $('#projectDetail');
    S.openProject = openId;
    if (!openId) { det.hidden = true; return; }
    const p = S.projects.find((x) => x.id === openId);
    if (!p) { det.hidden = true; return; }
    det.hidden = false;
    det.innerHTML = '';
    const nameI = h('input', { value: p.name });
    const instr = h('textarea', { rows: 5, placeholder: 'Instructions for every chat in this project (tone, goals, rules)…' });
    instr.value = p.instructions || '';
    const drop = h('div', { class: 'drop' }, 'Drop files here or click to upload (PDF, Word, text, code, CSV…)');
    const fi = h('input', { type: 'file', multiple: true, hidden: true });
    const upload = async (files) => {
      for (const f of files) {
        drop.textContent = `Uploading ${f.name}…`;
        try { await api(`/api/projects/${p.id}/files`, { body: { name: f.name, dataBase64: await readFileB64(f) } }); }
        catch (e) { toast(e.message, true); }
      }
      await refreshProjects();
      renderProjects(p.id);
    };
    drop.onclick = () => fi.click();
    fi.onchange = () => upload([...fi.files]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); upload([...e.dataTransfer.files]); };
    const files = h('div', { class: 'list' }, p.files.map((f) => h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('div', {}, f.name), h('div', { class: 'meta' }, `${Math.round(f.size / 1024)} KB · ${f.chars.toLocaleString()} characters`)),
      h('button', { class: 'btn tiny', onclick: async () => { await api(`/api/projects/${p.id}/files/${f.id}`, { method: 'DELETE' }); await refreshProjects(); renderProjects(p.id); } }, 'Remove'))));
    const chats = S.convs.filter((c) => c.projectId === p.id);
    const total = p.files.reduce((a, f) => a + f.chars, 0);
    det.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, nameI, h('button', { class: 'btn primary', onclick: () => newChat(p.id) }, '＋ New chat in project')),
      h('label', { class: 'muted small' }, 'Instructions'), instr,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => { await api(`/api/projects/${p.id}`, { method: 'PATCH', body: { name: nameI.value, instructions: instr.value } }); toast('Project saved'); refreshProjects(); } }, 'Save'),
        isDesktop ? h('button', { class: 'btn', onclick: async () => { const f = await window.desktop.pickFolder(p.workspace); if (f) { await api(`/api/projects/${p.id}`, { method: 'PATCH', body: { workspace: f } }); toast('Project folder set'); refreshProjects(); } } }, `📁 ${p.workspace || 'Set project folder'}`) : null,
        h('button', { class: 'btn danger subtle', style: 'margin:0', onclick: async () => { if (confirm(`Delete project "${p.name}" and its files?`)) { await api(`/api/projects/${p.id}`, { method: 'DELETE' }); S.openProject = null; refreshProjects(); } } }, 'Delete project')),
      h('h3', { style: 'margin-top:14px' }, `Knowledge (${p.files.length} files, ${total.toLocaleString()} characters — ${total > 24000 ? 'searched with RAG' : 'read in full'})`),
      drop, fi, files,
      chats.length ? h('h3', {}, 'Chats') : null,
      h('div', { class: 'list' }, chats.map((c) => h('div', { class: 'item', style: 'cursor:pointer', onclick: () => openConv(c.id) }, h('div', { class: 'grow' }, c.title), h('span', { class: 'meta' }, fmtDate(c.updatedAt)))))));
  }
  $('#btnNewProject').onclick = async () => {
    const name = prompt('Project name:');
    if (!name) return;
    const p = await api('/api/projects', { body: { name } });
    await refreshProjects();
    renderProjects(p.id);
  };

  // ------------------------------------------------------------ memory
  async function renderMemory() {
    const items = await api('/api/memory');
    $('#autoMemory').checked = S.settings.autoMemory !== false;
    const list = $('#memList');
    list.innerHTML = '';
    if (!items.length) list.append(h('div', { class: 'muted' }, 'Nothing remembered yet. Tell me things in a chat, or add them here.'));
    for (const m of [...items].reverse()) {
      list.append(h('div', { class: 'item' },
        h('div', { class: 'grow' }, h('div', {}, m.text), h('div', { class: 'meta' }, `${m.source === 'auto' ? 'learned automatically' : m.source === 'agent' ? 'saved by the assistant' : 'added by you'} · ${fmtDate(m.createdAt)}`)),
        h('button', { class: 'btn tiny', onclick: async () => { const t = prompt('Edit memory:', m.text); if (t) { await api(`/api/memory/${m.id}`, { method: 'PATCH', body: { text: t } }); renderMemory(); } } }, 'Edit'),
        h('button', { class: 'btn tiny', onclick: async () => { await api(`/api/memory/${m.id}`, { method: 'DELETE' }); renderMemory(); } }, 'Delete')));
    }
  }
  $('#memForm').onsubmit = async (e) => { e.preventDefault(); const t = $('#memInput').value.trim(); if (!t) return; await api('/api/memory', { body: { text: t } }); $('#memInput').value = ''; renderMemory(); };
  $('#autoMemory').onchange = async (e) => { S.settings = await api('/api/settings', { body: { autoMemory: e.target.checked } }); toast(e.target.checked ? 'Automatic memory on' : 'Automatic memory off'); };
  $('#btnMemClear').onclick = async () => { if (confirm('Delete everything Muse Carpathron remembers about you?')) { await api('/api/memory', { method: 'DELETE' }); renderMemory(); } };

  // ------------------------------------------------------------ skills
  function renderSkills() {
    const list = $('#skillList');
    list.innerHTML = '';
    list.append(h('label', { class: 'toggle', style: 'margin-bottom:6px' }, h('input', { type: 'checkbox', checked: S.settings.autoSkills !== false, onchange: async (e) => { S.settings = await api('/api/settings', { body: { autoSkills: e.target.checked } }); toast(e.target.checked ? 'Will learn new skills from your work' : 'Automatic skills off'); } }), ' Learn new skills automatically from multi-step work'));
    for (const s of S.skills) {
      list.append(h('div', { class: 'item' },
        h('div', { class: 'grow' }, h('div', {}, h('code', {}, `/${s.name}`), ' ', s.description), h('div', { class: 'meta' }, s.body.slice(0, 160))),
        h('button', { class: 'btn tiny', onclick: () => editSkill(s) }, 'Edit'),
        h('button', { class: 'btn tiny', onclick: async () => { if (confirm(`Delete /${s.name}?`)) { await api(`/api/skills/${s.name}`, { method: 'DELETE' }); } } }, 'Delete')));
    }
  }
  function editSkill(s) {
    $('#skillForm').hidden = false;
    $('#skName').value = s ? s.name : ''; $('#skDesc').value = s ? s.description : ''; $('#skBody').value = s ? s.body : '';
    $('#skName').focus();
  }
  $('#btnNewSkill').onclick = () => editSkill(null);
  $('#skCancel').onclick = () => ($('#skillForm').hidden = true);
  $('#skillForm').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/skills', { body: { name: $('#skName').value, description: $('#skDesc').value, body: $('#skBody').value } }); $('#skillForm').hidden = true; toast('Skill saved'); }
    catch (err) { toast(err.message, true); }
  };

  // ------------------------------------------------------------ activity
  async function renderActivity() {
    const r = await api('/api/activity');
    S.activity = r.activity;
    const list = $('#activityList');
    list.innerHTML = '';
    for (const a of r.activity) prependActivity(a);
    if (!r.activity.length) list.append(h('div', { class: 'muted', id: 'actEmpty' }, 'No activity yet. Send a message in a chat.'));
    $('#techLog').textContent = r.log.slice().reverse().join('\n');
  }
  function prependActivity(a) {
    $('#actEmpty')?.remove();
    const label = { cloud: '☁ cloud', local: '💻 local', memory: '◎ memory' }[a.kind] || a.kind;
    $('#activityList').prepend(h('div', { class: 'item' }, h('span', { class: `tag ${a.kind}` }, label), h('div', { class: 'grow' }, a.text), h('span', { class: 'meta' }, new Date(a.ts).toLocaleTimeString())));
  }

  // ------------------------------------------------------------ settings
  function field(label, el, hint) { return h('label', {}, label, el, hint ? h('span', { class: 'small muted' }, hint) : null); }
  async function renderSettings() {
    const s = S.settings = await api('/api/settings');
    const eng = S.boot.engines = await api('/api/engines');
    const body = $('#settingsBody');
    body.innerHTML = '';

    // --- engines
    const museState = h('div', { class: 'status-line' },
      h('span', { class: 'pill ' + (eng.muse.installed ? 'ok' : 'warn') }, eng.muse.installed ? `Installed${eng.muse.version ? ' ' + eng.muse.version : ''}` : 'Not installed'),
      eng.muse.bin ? h('span', { class: 'small muted' }, eng.muse.bin) : null);
    const museOut = h('div', { class: 'small muted' }, eng.muse.lastError || '');
    const museBin = h('input', { value: s.museBin || '', placeholder: 'Auto-detect (leave empty)' });
    const apiKey = h('input', { type: 'password', placeholder: s.hasApiKey ? '•••••••• saved (type to replace)' : 'Paste your Meta Model API key' });
    const apiBase = h('input', { value: s.apiBase });
    const apiOut = h('div', { class: 'small muted' });
    const engineSel = h('select', {}, h('option', { value: 'auto' }, 'Automatic'), h('option', { value: 'muse' }, 'Meta account (Muse Code)'), h('option', { value: 'api' }, 'Meta API key'));
    engineSel.value = s.engine;
    body.append(h('div', { class: 'card' },
      h('h3', {}, 'Sign in to Meta'),
      h('p', { class: 'muted small' }, 'Two ways. "Meta account" uses Meta\'s official Muse Code agent and your Meta login (Facebook / Meta account) — you sign in on Meta\'s own page, this app never sees your password. "API key" talks to the Meta Model API directly.'),
      h('b', {}, '1 · Meta account (Muse Code)'), museState,
      h('div', { class: 'row' },
        !eng.muse.installed ? h('button', { class: 'btn primary', onclick: async () => { await api('/api/muse/install', { body: {} }); toast('Installer opened in a new window. Press "Re-check" when it finishes.'); } }, 'Install Muse Code') : null,
        h('button', { class: 'btn', onclick: async () => { try { await api('/api/muse/login', { body: {} }); toast('Sign-in window opened. Log in with your Meta account there, then press Test.'); } catch (e) { toast(e.message, true); } } }, 'Sign in with Meta'),
        h('button', { class: 'btn', onclick: async () => { museOut.textContent = 'Testing…'; const r = await api('/api/muse/test', { body: {} }); museOut.textContent = r.ok ? `✓ Connected. ${r.models.length} models: ${r.models.map((m) => m.id).join(', ')}` : `✕ ${r.error}`; S.models.muse = r.models || []; S.boot.engines.muse = r.status; renderFoot(); } }, 'Test'),
        h('button', { class: 'btn', onclick: () => renderSettings() }, 'Re-check'),
        eng.muse.installed && S.boot.platform === 'win32' ? h('button', { class: 'btn', title: 'One-time: lets Muse run PowerShell commands safely (Windows asks for permission)', onclick: async () => { try { await api('/api/muse/sandbox', { body: {} }); toast('Setup window opened — click YES on the Windows prompt.'); } catch (e) { toast(e.message, true); } } }, 'Set up Windows sandbox') : null),
      field('Muse Code path (optional)', museBin),
      museOut,
      h('hr', { style: 'border-color:var(--line);margin:14px 0' }),
      h('b', {}, '2 · Meta Model API key'),
      field('API key', apiKey, 'Create one on dev.meta.ai → API keys. Stored only on this PC.'),
      field('API base URL', apiBase),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => { apiOut.textContent = 'Testing…'; await saveEngines(); const r = await api('/api/api/test', { body: {} }); apiOut.textContent = r.ok ? `✓ Works. Reply: ${r.reply}` : `✕ ${r.error}`; } }, 'Save & test'),
        s.hasApiKey ? h('button', { class: 'btn', onclick: async () => { await api('/api/settings', { body: { clearApiKey: true } }); renderSettings(); } }, 'Remove key') : null),
      apiOut,
      field('Default engine for new chats', engineSel),
      h('button', { class: 'btn primary', onclick: async () => { await saveEngines(); toast('Saved'); } }, 'Save')));
    async function saveEngines() {
      const b = { engine: engineSel.value, apiBase: apiBase.value.trim(), museBin: museBin.value.trim() };
      if (apiKey.value.trim()) b.apiKey = apiKey.value.trim();
      S.settings = await api('/api/settings', { body: b });
      apiKey.value = '';
      S.models = { api: [], muse: [] };
      S.boot.engines = await api('/api/engines');
      renderFoot();
    }

    // --- defaults
    const model = h('input', { value: s.model });
    const mode = h('select', {}, h('option', { value: 'ask' }, 'Ask — approve changes, commands and robot moves'), h('option', { value: 'auto' }, 'Auto — do everything without asking'), h('option', { value: 'plan' }, 'Plan — read-only'));
    mode.value = s.mode;
    const ws = h('input', { value: s.workspace });
    const steps = h('input', { type: 'number', min: 5, max: 200, value: s.maxSteps });
    const sys = h('textarea', { rows: 4, placeholder: 'e.g. Answer in Romanian. I am building a robot startup called Carpathron.' });
    sys.value = s.systemPrompt || '';
    body.append(h('div', { class: 'card' },
      h('h3', {}, 'Defaults'),
      field('Default approval mode', mode),
      h('div', { class: 'row' }, field('Default folder (workspace)', ws), isDesktop ? h('button', { class: 'btn', style: 'align-self:flex-end', onclick: async () => { const f = await window.desktop.pickFolder(ws.value); if (f) ws.value = f; } }, 'Browse…') : null),
      field('Default API model', model, 'Used by the API-key engine. Pick per chat from the model menu.'),
      field('Max agent steps per message', steps),
      field('Custom instructions (for every chat)', sys),
      h('button', { class: 'btn primary', onclick: async () => {
        try { S.settings = await api('/api/settings', { body: { mode: mode.value, workspace: ws.value, model: model.value.trim(), maxSteps: Number(steps.value) || 40, systemPrompt: sys.value } }); toast('Saved'); }
        catch (e) { toast(e.message, true); }
      } }, 'Save')));

    // --- MCP
    const mcpText = h('textarea', { class: 'code', spellcheck: 'false' });
    mcpText.value = JSON.stringify(s.mcpServers || {}, null, 2);
    body.append(h('div', { class: 'card' },
      h('h3', {}, 'MCP servers (tools)'),
      h('p', { class: 'muted small' }, 'Connect extra tools with the Model Context Protocol (used by the API-key engine). Same format as other MCP apps:'),
      h('pre', { class: 'small muted' }, '{\n  "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\Users\\\\me\\\\Documents"] },\n  "remote": { "url": "https://example.com/mcp" }\n}'),
      mcpText,
      h('div', { id: 'mcpStatus', class: 'list' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: async () => {
          let cfg; try { cfg = JSON.parse(mcpText.value || '{}'); } catch (e) { return toast(`Invalid JSON: ${e.message}`, true); }
          S.settings = await api('/api/settings', { body: { mcpServers: cfg } }); toast('Saved — starting servers…');
        } }, 'Save & start'),
        h('button', { class: 'btn', onclick: async () => { S.boot.mcp = await api('/api/mcp/reload', { body: {} }); renderMcpStatus(); } }, 'Restart all'))));
    renderMcpStatus();

    // --- WhatsApp
    const allowed = h('input', { value: (s.whatsapp.allowed || []).join(', '), placeholder: 'e.g. +40 7xx xxx xxx, +40 7yy yyy yyy' });
    const personalOn = h('input', { type: 'checkbox' }); personalOn.checked = s.whatsapp.personal.enabled;
    const c = s.whatsapp.cloud;
    const cloudOn = h('input', { type: 'checkbox' }); cloudOn.checked = c.enabled;
    const pid = h('input', { value: c.phoneNumberId, placeholder: 'Phone number ID' });
    const tok = h('input', { type: 'password', placeholder: c.hasAccessToken ? '•••••• saved' : 'Access token' });
    const vtok = h('input', { value: c.verifyToken, placeholder: 'Any secret word you choose' });
    const asec = h('input', { type: 'password', placeholder: c.hasAppSecret ? '•••••• saved' : 'App secret (optional, recommended)' });
    const cfp = h('input', { value: c.cloudflaredPath, placeholder: 'cloudflared (auto)' });
    const testTo = h('input', { placeholder: 'Test: send to number' });
    body.append(h('div', { class: 'card', id: 'waCard' },
      h('h3', {}, 'WhatsApp remote control'),
      h('p', { class: 'muted small' }, 'Control Muse Carpathron from your phone. Only your own "Message yourself" chat and the numbers below can give commands. Send /help on WhatsApp for commands; approvals are answered with yes / no. Keep the app running (it stays in the tray when you close the window).'),
      field('Allowed phone numbers (with country code)', allowed),
      h('b', {}, 'A · Personal WhatsApp (QR code, like WhatsApp Web)'),
      h('p', { class: 'small', style: 'color:var(--warn)' }, 'Unofficial connection (Baileys). WhatsApp may restrict numbers that automate messages — use a spare number if possible.'),
      h('label', { class: 'inline toggle' }, personalOn, ' Enable personal WhatsApp'),
      h('div', { id: 'waPersonal' }),
      h('hr', { style: 'border-color:var(--line);margin:14px 0' }),
      h('b', {}, 'B · WhatsApp Business Cloud API (official, Meta)'),
      h('p', { class: 'small muted' }, 'In developers.facebook.com create an app → add WhatsApp → copy the Phone number ID and a token. Set the webhook to the public URL below + /whatsapp/webhook with your verify token, and subscribe to "messages".'),
      h('label', { class: 'inline toggle' }, cloudOn, ' Enable Cloud API'),
      h('div', { class: 'row' }, pid, tok), h('div', { class: 'row' }, vtok, asec),
      h('div', { class: 'row' }, cfp,
        h('button', { class: 'btn', onclick: async () => { S.boot.wa = await api('/api/wa/tunnel/start', { body: {} }); renderWaStatus(); } }, 'Start public tunnel'),
        h('button', { class: 'btn', onclick: async () => { S.boot.wa = await api('/api/wa/tunnel/stop', { body: {} }); renderWaStatus(); } }, 'Stop tunnel')),
      h('div', { id: 'waCloud' }),
      h('div', { class: 'row' }, testTo, h('button', { class: 'btn', onclick: async () => { const r = await api('/api/wa/cloud/test', { body: { to: testTo.value } }); toast(r.ok ? 'Sent' : r.error, !r.ok); } }, 'Send test')),
      h('button', { class: 'btn primary', onclick: async () => {
        const w = { allowed: allowed.value.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean), personal: { enabled: personalOn.checked }, cloud: { enabled: cloudOn.checked, phoneNumberId: pid.value.trim(), verifyToken: vtok.value.trim(), cloudflaredPath: cfp.value.trim() } };
        if (tok.value.trim()) w.cloud.accessToken = tok.value.trim();
        if (asec.value.trim()) w.cloud.appSecret = asec.value.trim();
        S.settings = await api('/api/settings', { body: { whatsapp: w } });
        toast('WhatsApp settings saved');
        renderWaStatus();
      } }, 'Save WhatsApp settings')));
    renderWaStatus();

    // --- phone & quest access
    const acc = h('div', {});
    body.append(h('div', { class: 'card' }, h('h3', {}, 'Phone & Quest access (same Wi-Fi)'), acc));
    try {
      const a = await api('/api/access');
      acc.append(
        h('p', { class: 'muted small' }, 'Easiest: on the Quest or phone open this address and type the PIN (accept the certificate warning first: Advanced → Proceed):'),
        ...a.pairUrls.map((u) => h('div', { class: 'pairurl' }, u)),
        h('div', { class: 'pin' }, a.pin.replace(/(\d{3})/, '$1 ')),
        h('p', { class: 'muted small' }, 'Or open this private link directly (contains your access key — do not share it):'),
        ...a.urls.map((u) => h('div', { class: 'access-url' }, u)),
        ...(a.urls.length ? [] : [h('p', { class: 'muted' }, 'No network address found — connect the PC to Wi-Fi.')]));
    } catch { acc.append(h('p', { class: 'muted small' }, 'Available on the PC only.')); }

    // --- about
    body.append(h('div', { class: 'card' }, h('h3', {}, 'About'),
      h('p', { class: 'small muted' }, `Muse Carpathron ${S.boot.version} · ${S.boot.platform} · Data stays on this PC except what is sent to Meta's model for each message (see Activity).`)));
  }
  function renderMcpStatus() {
    const el = $('#mcpStatus');
    if (!el) return;
    el.innerHTML = '';
    for (const sv of S.boot.mcp || []) {
      el.append(h('div', { class: 'item' },
        h('span', { class: 'pill ' + (sv.status === 'ready' ? 'ok' : sv.status === 'error' ? 'bad' : 'warn') }, sv.status),
        h('div', { class: 'grow' }, h('b', {}, sv.name), h('div', { class: 'meta' }, sv.error || sv.tools.join(', ')))));
    }
  }
  function renderWaStatus() {
    const wa = S.boot.wa;
    const p = $('#waPersonal'), c = $('#waCloud');
    if (!p || !wa) return;
    p.innerHTML = '';
    p.append(h('div', { class: 'status-line' }, h('span', { class: 'pill ' + (wa.personal.status === 'connected' ? 'ok' : wa.personal.status === 'off' ? '' : 'warn') }, wa.personal.status),
      wa.personal.me ? h('span', { class: 'small muted' }, `as ${String(wa.personal.me.id || '').split(':')[0].split('@')[0]}`) : null,
      wa.personal.status === 'connected' ? h('button', { class: 'btn tiny', onclick: async () => { const r = await api('/api/wa/personal/test', { body: {} }); toast(r.ok ? 'Test message sent — check "Message yourself" on your phone' : r.error, !r.ok); } }, 'Send test message to myself') : null,
      wa.personal.status !== 'off' ? h('button', { class: 'btn tiny', onclick: async () => { if (confirm('Unlink this PC from WhatsApp?')) { S.boot.wa = await api('/api/wa/personal/logout', { body: {} }); renderWaStatus(); } } }, 'Unlink') : null));
    if (wa.personal.qr) p.append(h('p', { class: 'small' }, 'On your phone: WhatsApp → Settings → Linked devices → Link a device, then scan:'), h('img', { class: 'qr', src: wa.personal.qr, alt: 'WhatsApp QR code' }));
    c.innerHTML = '';
    c.append(h('div', { class: 'status-line' }, h('span', { class: 'pill' }, wa.cloud.status),
      wa.cloud.tunnelUrl ? h('span', { class: 'access-url' }, `${wa.cloud.tunnelUrl}${wa.cloud.webhookPath}`) : h('span', { class: 'small muted' }, 'Webhook path: /whatsapp/webhook')));
  }

  // ------------------------------------------------------------ boot
  async function boot() {
    try { S.boot = await api('/api/bootstrap'); }
    catch (e) {
      document.body.innerHTML = '';
      document.body.append(h('div', { style: 'padding:40px;max-width:560px;margin:auto' }, h('h2', {}, 'Muse Carpathron'), h('p', {}, e.message)));
      return;
    }
    S.settings = S.boot.settings; S.convs = S.boot.convs; S.projects = S.boot.projects; S.skills = S.boot.skills;
    connectWs();
    renderFoot();
    newChat();
    const e = S.boot.engines;
    if (!e.muse.installed && !e.api.hasKey) { show('settings'); toast('Welcome! First connect to Meta: install Muse Code / sign in, or paste an API key.'); }
  }
  window.MCapi = api; window.MCtoast = toast;
  boot();
})();
