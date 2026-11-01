'use strict';
(function () {
  const rd = window.rd; const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATE = { ready: ['Ready for connections', 'good'], connecting: ['Connecting to the relay…', 'warn'], offline: ['Offline — retrying', 'bad'], error: ['Error', 'bad'], off: ['Remote control off', ''] };
  const ERR = { 'id-taken': 'this ID belongs to another computer; a new one will be assigned', rate: 'too many attempts, waiting', 'bad-relay': 'the relay address is not valid', replaced: 'the same ID was opened somewhere else' };
  let st = null; let typing = false;
  function ago(t) { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; }
  function render(s) {
    st = s; const h = s.host;
    $('#enabled').checked = h.enabled;
    $('#hostinfo').style.opacity = h.enabled ? 1 : 0.45;
    $('#myid').textContent = h.enabled && h.idFmt ? h.idFmt : '—';
    $('#otp').textContent = h.enabled && h.otp ? h.otp : '—';
    const [label, kind] = STATE[h.state] || STATE.off;
    $('#hstate').textContent = h.state === 'error' && h.error ? `Error: ${ERR[h.error] || h.error}` : label; $('#hstate').className = 'pill ' + kind;
    $('#unattended').checked = h.unattended; $('#unattended').disabled = !h.hasPerm;
    $('#ppwstate').textContent = h.hasPerm ? 'A personal password is set. Leave the box empty and click Set to remove it.' : 'No personal password yet.';
    const C = h.control || { ok: true }; $('#ctlnote').hidden = C.ok;
    if (!C.ok) $('#ctlnote').textContent = C.why === 'wayland' ? 'This Linux desktop uses Wayland: others can see this screen, but Wayland does not let any app move the mouse or type for them. To be controlled, choose an "Xorg"/X11 session on the login screen.' : C.why === 'xdotool' ? 'To be controlled on Linux, install xdotool first:  sudo apt install xdotool  (or your distribution\'s package manager).' : 'Being controlled is not supported on this system yet; you can still control other computers.';
    $('#lock').hidden = !h.locked; if (h.locked) $('#lock').textContent = `5 wrong passwords: connections are refused until ${new Date(h.locked).toLocaleTimeString()}. The one-time password was changed.`;
    $('#sessions').innerHTML = s.sessions.map((x) => `<div class="item"><div class="t"><b>${esc(x.name)} is ${x.control === false ? 'watching' : 'controlling'} this computer${x.call === 'on' ? ' · in a call' : ''}</b><span class="muted small">${esc(x.how)} · ${esc(x.mode === 'direct' ? 'direct connection' : x.mode === 'relay' ? 'through the relay' : 'starting')} · since ${new Date(x.started).toLocaleTimeString()}</span></div><button class="danger" data-kill="${esc(x.sid)}">Disconnect</button></div>`).join('');
    $('#saved').innerHTML = s.saved.length ? s.saved.map((c) => `<div class="item"><div class="t"><b>${esc(c.name || c.idFmt)}</b><span class="muted small">${esc(c.idFmt)}${c.last ? ' · ' + ago(c.last) : ''}${c.hasPw ? ' · password saved' : ''}</span></div><button class="primary" data-go="${esc(c.id)}">Connect</button><button data-ren="${esc(c.id)}">Rename</button><button data-del="${esc(c.id)}">Remove</button></div>`).join('') : '<div class="muted small" style="padding:8px 0">None yet.</div>';
    if (!typing) { $('#name').value = h.name || ''; $('#relay').value = s.relay || ''; $('#relay').placeholder = `Automatic (now ${s.relayNow})`; }
    $('#quality').value = s.quality; $('#autowrap').hidden = !s.standalone || s.store; $('#storeauto').hidden = !(s.standalone && s.store); $('#autostart').checked = !!s.autostart;
    $('#ver').textContent = `Version ${s.version}`;
    $('#viewonly').checked = !!s.viewOnly; $('#clipsync').checked = s.clipSync !== false;
    const L = s.license || {}; const days = (t) => Math.max(0, Math.ceil((t - Date.now()) / 864e5));
    const day = (t) => new Date(t).toLocaleDateString();
    $('#lic').className = 'panel lic ' + (L.plan === 'pro' || L.plan === 'max' ? 'pro' : L.plan === 'free' ? 'free' : '');
    const mins = (ms) => Math.round(ms / 60000);
    const hostsEl = $('#lichosts'); hostsEl.hidden = L.plan !== 'pro';
    if (L.plan === 'pro') hostsEl.innerHTML = `<div class="muted small" style="padding:6px 0">Computers this license controls (${L.hosts.length} of ${L.hostLimit}; a computer not used for 30 days frees its place):</div>` + (L.hosts.length ? L.hosts.map((h) => `<div class="item"><div class="t"><b>${esc(h.name || h.idFmt)}</b><span class="muted small">${esc(h.idFmt)} · last used ${ago(h.last)}</span></div><button data-unhost="${esc(h.id)}">Remove</button></div>`).join('') : '<div class="muted small" style="padding:6px 0">None yet.</div>');
    if (L.plan === 'max') { $('#lictitle').textContent = 'Max license — unlimited computers'; $('#lictext').textContent = `Key ${L.key} · ${L.used} of ${L.seats} PC${L.seats === 1 ? '' : 's'} · ${L.period === 'yearly' ? 'yearly' : 'monthly'} · until ${day(L.until)}`; }
    else if (L.plan === 'pro') { $('#lictitle').textContent = 'Pro license — up to 3 computers, no time limits'; $('#lictext').textContent = `Key ${L.key} · ${L.used} of ${L.seats} PC${L.seats === 1 ? '' : 's'} · ${L.period === 'yearly' ? 'yearly' : 'monthly'} · until ${day(L.until)}`; }
    else if (L.plan === 'free') { $('#lictitle').textContent = `Free (personal use) — ${mins(L.leftToday)} of ${mins(L.dayLimit)} minutes left today`; $('#lictext').textContent = `Sessions up to ${mins(L.sessionLimit)} minutes, ${mins(L.dayLimit) / 60} hours per day, one at a time. Being helped is never counted. Unlimited: ${L.price}.`; }
    else { $('#lictitle').textContent = 'License'; $('#lictext').textContent = 'Checking the license with qubitpage.com… (needs the internet)'; }
    const paid = L.plan === 'pro' || L.plan === 'max'; $('#buy').hidden = L.plan === 'max'; $('#buy').textContent = L.plan === 'pro' ? 'Upgrade to Max' : 'Get a license'; $('#release').hidden = !paid; $('#lickey').hidden = $('#activate').hidden = paid;
  }
  const refresh = () => rd.state().then(render);
  setInterval(() => rd.licenseQuiet().catch(() => {}), 120000);
  rd.onState(refresh); refresh();
  setInterval(refresh, 30000);
  for (const id of ['name', 'relay']) { $('#' + id).addEventListener('focus', () => { typing = true; }); $('#' + id).addEventListener('blur', () => { typing = false; }); }

  const licMsg = (t, bad) => { const m = $('#licmsg'); m.hidden = !t; m.textContent = t || ''; m.className = 'small ' + (bad ? 'err' : 'muted'); };
  const clean = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  $('#buy').onclick = () => rd.buy();
  $('#sshbtn').onclick = () => rd.openSsh();
  $('#activate').onclick = async () => { licMsg('Activating…'); try { render(await rd.licenseActivate($('#lickey').value)); $('#lickey').value = ''; licMsg('License activated on this PC.'); } catch (e) { licMsg(clean(e), true); } };
  $('#release').onclick = async () => { if (!confirm('Remove the license from this PC? You can then use it on another PC.')) return; try { render(await rd.licenseRelease()); licMsg('The license was removed from this PC.'); } catch (e) { licMsg(clean(e), true); } };
  $('#licrefresh').onclick = async () => { licMsg('Checking…'); try { render(await rd.licenseRefresh()); licMsg(''); } catch (e) { licMsg(clean(e), true); } };
  $('#enabled').onchange = (e) => rd.set({ enabled: e.target.checked }).then(render);
  $('#unattended').onchange = (e) => rd.set({ unattended: e.target.checked }).then(render);
  $('#newotp').onclick = () => rd.newOtp().then(render);
  $('#setppw').onclick = async () => { try { render(await rd.setPassword($('#ppw').value)); $('#ppw').value = ''; } catch (e) { alert(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } };
  $('#savename').onclick = () => rd.set({ name: $('#name').value }).then(render);
  $('#saverelay').onclick = () => rd.set({ relay: $('#relay').value }).then(render);
  $('#quality').onchange = (e) => rd.set({ quality: e.target.value }).then(render);
  $('#viewonly').onchange = (e) => rd.set({ viewOnly: e.target.checked }).then(render);
  $('#clipsync').onchange = (e) => rd.set({ clipSync: e.target.checked }).then(render);
  $('#autostart').onchange = (e) => rd.set({ autostart: e.target.checked }).then(render);
  $('#pid').addEventListener('input', (e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 9); e.target.value = d.replace(/(\d{3})(?=\d)/g, '$1 '); });
  $('#cf').onsubmit = async (e) => {
    e.preventDefault(); const id = $('#pid').value.replace(/\D/g, '');
    if (id.length !== 9) { alert('A Carpathron ID has 9 digits.'); return; }
    if (st && st.license && st.license.plan === 'free' && !st.license.canControl) { alert(`You have used the 2 free hours for today. For unlimited use get a license (${st.license.price}), or come back tomorrow.`); return; }
    try { await rd.openViewer(id, $('#remember').checked); } catch (err) { alert(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  };
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.kill) rd.disconnect(t.dataset.kill);
    if (t.dataset.unhost && confirm('Remove this computer from your Pro license? Its place can then be used by another computer (at most 3 removals per 30 days).')) { try { render(await rd.licenseUnhost(t.dataset.unhost)); licMsg('Removed.'); } catch (err) { licMsg(clean(err), true); } }
    if (t.dataset.go) rd.openViewer(t.dataset.go, false);
    if (t.dataset.del && confirm('Remove this computer from the list (and its saved password)?')) render(await rd.forget(t.dataset.del));
    if (t.dataset.ren) {
      const b = t.closest('.item').querySelector('.t b'); const id = t.dataset.ren;
      const inp = document.createElement('input'); inp.type = 'text'; inp.value = b.textContent; inp.style.width = '100%';
      b.replaceWith(inp); inp.focus(); inp.select(); typing = true;
      const done = async (ok) => { typing = false; if (ok) render(await rd.renameSaved(id, inp.value)); else refresh(); };
      inp.addEventListener('keydown', (k) => { if (k.key === 'Enter') done(true); if (k.key === 'Escape') done(false); });
      inp.addEventListener('blur', () => done(true));
    }
  });
})();
