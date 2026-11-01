// Carpathron Remote — SSH terminal window (saved connections on the left, terminals in tabs).
'use strict';
(function () {
  const rd = window.rd; const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  let conns = []; const tabs = new Map(); let active = null;

  async function loadList() { conns = await rd.sshList(); drawList(); }
  function drawList() {
    $('#conns').innerHTML = conns.length ? conns.map((c) => `<div class="conn" data-id="${esc(c.id)}"><div class="t"><b>${esc(c.name)}</b><span class="muted small">${esc(c.user)}@${esc(c.host)}${c.port !== 22 ? ':' + c.port : ''} · ${c.auth === 'key' ? 'key' : 'password'}</span></div>
      <button data-open="${esc(c.id)}" class="primary">Connect</button><button data-edit="${esc(c.id)}" title="Edit">✎</button><button data-del="${esc(c.id)}" title="Delete">✕</button></div>`).join('') : '<div class="muted small" style="padding:10px 0">No connections yet.</div>';
  }

  // ---------------------------------------------------------------- modals
  function modal(html) { const m = $('#modal'); if (html == null) { m.hidden = true; m.innerHTML = ''; return null; } m.innerHTML = `<div class="card">${html}</div>`; m.hidden = false; const f = m.querySelector('input:not([type=checkbox]):not([type=radio])'); if (f) f.focus(); return m; }
  function editForm(c) {
    c = c || { port: 22, auth: 'password' };
    const m = modal(`<h2>${c.id ? 'Edit connection' : 'New SSH connection'}</h2>
      <form id="cf" class="form">
        <label>Name <input type="text" id="f-name" value="${esc(c.name || '')}" placeholder="My VPS"></label>
        <div class="row tight"><label style="flex:1">Server (name or IP) <input type="text" id="f-host" value="${esc(c.host || '')}" placeholder="example.com"></label><label style="width:90px">Port <input type="text" id="f-port" value="${esc(c.port || 22)}"></label></div>
        <label>User <input type="text" id="f-user" value="${esc(c.user || '')}" placeholder="root, ubuntu…"></label>
        <div class="row tight"><label class="switch small"><input type="radio" name="auth" value="password" ${c.auth !== 'key' ? 'checked' : ''}> Password</label><label class="switch small"><input type="radio" name="auth" value="key" ${c.auth === 'key' ? 'checked' : ''}> Private key</label></div>
        <div id="a-pw"><label>Password <input type="password" id="f-pw" placeholder="${c.hasPw ? '(saved — leave empty to keep it)' : 'leave empty to be asked each time'}" autocomplete="new-password"></label>
          <label class="switch small"><input type="checkbox" id="f-savepw" ${c.id && !c.hasPw ? '' : 'checked'}> Save the password (encrypted on this PC)</label></div>
        <div id="a-key" hidden><label>Private key file <div class="row tight" style="margin:0"><input type="text" id="f-keypath" value="${esc(c.keyPath || '')}" placeholder="C:\\Users\\you\\.ssh\\id_ed25519" style="flex:1"><button type="button" id="f-browse">Browse…</button></div></label>
          <label>…or paste the private key <textarea id="f-key" rows="3" placeholder="${c.hasKey ? '(a key is saved — leave empty to keep it)' : '-----BEGIN OPENSSH PRIVATE KEY-----'}"></textarea></label>
          <label>Key passphrase (if it has one) <input type="password" id="f-pass" placeholder="${c.hasPass ? '(saved)' : ''}" autocomplete="new-password"></label></div>
        ${c.fp ? `<p class="muted small">Host key: ${esc(c.fp)} <button type="button" class="link small" id="f-forget">Forget host key</button></p>` : ''}
        <p id="f-err" class="err small" hidden></p>
        <div class="row"><button class="primary" type="submit">Save &amp; connect</button><button type="button" id="f-saveonly">Save</button><button type="button" id="f-cancel">Cancel</button></div>
      </form>`);
    const authSel = () => m.querySelector('input[name=auth]:checked').value;
    const sw = () => { $('#a-pw').hidden = authSel() !== 'password'; $('#a-key').hidden = authSel() !== 'key'; };
    m.querySelectorAll('input[name=auth]').forEach((r) => { r.onchange = sw; }); sw();
    $('#f-cancel').onclick = () => modal(null);
    $('#f-browse').onclick = async () => { const p = await rd.sshKeyFile(); if (p) $('#f-keypath').value = p; };
    if ($('#f-forget')) $('#f-forget').onclick = async () => { await rd.sshForgetKey(c.id); $('#f-forget').parentElement.textContent = 'The host key will be checked again on the next connection.'; };
    const doSave = async (connect) => {
      const pw = $('#f-pw').value; const keyText = $('#f-key').value.trim();
      const o = { id: c.id, name: $('#f-name').value, host: $('#f-host').value, port: $('#f-port').value, user: $('#f-user').value, auth: authSel(), keyPath: $('#f-keypath').value };
      if (o.auth === 'password') { if (!$('#f-savepw').checked) o.password = ''; else if (pw) o.password = pw; }
      if (keyText) o.keyText = keyText; if ($('#f-pass').value) o.passphrase = $('#f-pass').value;
      try { const saved = await rd.sshSave(o); await loadList(); modal(null); if (connect) openTab(saved.id, o.auth === 'password' && pw && !$('#f-savepw').checked ? { password: pw } : {}); }
      catch (e) { const er = $('#f-err'); er.hidden = false; er.textContent = clean(e); }
    };
    $('#cf').onsubmit = (e) => { e.preventDefault(); doSave(true); };
    $('#f-saveonly').onclick = () => doSave(false);
  }
  function askPassword(c) {
    return new Promise((res) => {
      modal(`<h2>Password for ${esc(c.user)}@${esc(c.host)}</h2><form id="pf"><input type="password" id="p-pw" autocomplete="off"><div class="row"><button class="primary">Connect</button><button type="button" id="p-x">Cancel</button></div></form>`);
      $('#p-x').onclick = () => { modal(null); res(null); };
      $('#pf').onsubmit = (e) => { e.preventDefault(); const v = $('#p-pw').value; modal(null); res(v || null); };
    });
  }

  // ---------------------------------------------------------------- terminals
  async function openTab(id, extra) {
    const c = conns.find((x) => x.id === id); if (!c) return;
    const el = document.createElement('div'); el.className = 'term'; $('#terms').appendChild(el); $('#empty').hidden = true;
    const term = new window.Terminal({ cursorBlink: true, fontFamily: '"Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace', fontSize: 14, theme: { background: '#0b0d10', foreground: '#e8ecf1', cursor: '#f5a524', selectionBackground: '#3a4352' }, scrollback: 5000, allowProposedApi: false });
    const fit = new window.FitAddon.FitAddon(); term.loadAddon(fit); term.open(el);
    const tab = { id: null, c, el, term, fit, title: c.name, state: 'connecting' };
    const tb = document.createElement('div'); tb.className = 'tab'; tb.innerHTML = `<span class="dot"></span><span class="tt">${esc(c.name)}</span><button title="Close">✕</button>`; $('#tabs').appendChild(tb); tab.tb = tb;
    tb.onclick = (e) => { if (e.target.tagName === 'BUTTON') closeTab(tab); else select(tab); };
    select(tab); fitNow(tab);
    term.writeln(`\x1b[90mConnecting to ${c.user}@${c.host}:${c.port}…\x1b[0m`);
    // right-click pastes (like PuTTY); selecting text copies it
    el.addEventListener('contextmenu', async (e) => { e.preventDefault(); const t = await rd.clipRead().catch(() => ''); if (t && tab.id) rd.sshWrite(tab.id, t); });
    term.onSelectionChange(() => { const s = term.getSelection(); if (s) rd.clipWrite(s).catch(() => {}); });
    term.onData((d) => { if (tab.id && tab.state === 'ready') rd.sshWrite(tab.id, d); });
    term.onResize(({ cols, rows }) => { if (tab.id) rd.sshResize(tab.id, cols, rows); });
    try {
      const r = await rd.sshOpen(id, extra || {}, term.cols, term.rows); tab.id = r.tid; tabs.set(r.tid, tab);
    } catch (e) {
      const m = clean(e);
      if (m === 'password-needed') { closeTab(tab); const pw = await askPassword(c); if (pw) openTab(id, { password: pw }); return; }
      term.writeln(`\r\n\x1b[31m${m}\x1b[0m`); setState(tab, 'closed');
    }
  }
  function setState(tab, st) { tab.state = st; tab.tb.className = 'tab ' + st + (tab === active ? ' on' : ''); }
  function select(tab) { active = tab; for (const t of [...tabs.values(), tab]) { t.el.hidden = t !== tab; t.tb.classList.toggle('on', t === tab); } setTimeout(() => { fitNow(tab); tab.term.focus(); }, 30); }
  function fitNow(tab) { try { tab.fit.fit(); } catch {} }
  function closeTab(tab) {
    if (tab.id) { rd.sshClose(tab.id).catch(() => {}); tabs.delete(tab.id); }
    tab.term.dispose(); tab.el.remove(); tab.tb.remove();
    const rest = [...tabs.values()]; if (rest.length) select(rest[rest.length - 1]); else { active = null; $('#empty').hidden = false; }
  }
  rd.onSshData((tid, d) => { const t = tabs.get(tid); if (t) t.term.write(d); });
  rd.onSshReady((tid, who) => { const t = tabs.get(tid); if (!t) return; setState(t, 'ready'); t.term.focus(); window.__sshReady = (window.__sshReady || 0) + 1; });
  rd.onSshExit((tid, why) => { const t = tabs.get(tid); if (!t) return; t.term.writeln(`\r\n\x1b[33m${why}\x1b[0m`); setState(t, 'closed'); });
  rd.onSshHostKey((tid, fp) => {
    const t = tabs.get(tid); const c = t ? t.c : { host: '?' };
    modal(`<h2>New server: check its key</h2><p>This is the first connection to <b>${esc(c.host)}</b>. Its host key fingerprint is:</p><p class="mono">${esc(fp)}</p>
      <p class="muted small">If you know the server's fingerprint, compare it. Accept to remember it: Carpathron Remote will warn you if it ever changes.</p>
      <div class="row"><button class="primary" id="h-ok">Accept and connect</button><button id="h-no">Cancel</button></div>`);
    $('#h-ok').onclick = () => { modal(null); rd.sshTrust(tid, true); loadList(); };
    $('#h-no').onclick = () => { modal(null); rd.sshTrust(tid, false); };
  });
  window.addEventListener('resize', () => { if (active) fitNow(active); });
  $('#new').onclick = () => editForm();
  $('#conns').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.open) openTab(b.dataset.open);
    if (b.dataset.edit) editForm(conns.find((x) => x.id === b.dataset.edit));
    if (b.dataset.del && confirm('Delete this connection (and its saved password or key)?')) { conns = await rd.sshDelete(b.dataset.del); drawList(); }
  });
  $('#conns').addEventListener('dblclick', (e) => { const d = e.target.closest('.conn'); if (d) openTab(d.dataset.id); });
  window.__ssh = { openTab, tabs };
  loadList();
  rd.state().then((s) => { $('#appver').textContent = s.app === 'Carpathron Remote' ? `Carpathron Remote ${s.version}` : `${s.app} ${s.version}`; }).catch(() => {});
})();
