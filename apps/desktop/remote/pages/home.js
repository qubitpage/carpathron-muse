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
    $('#appver').textContent = /^Carpathron Remote/.test(s.app) ? `${s.app} ${s.version}` : `${s.app} ${s.version} · Carpathron Remote plugin`;
    $('#cmdun').checked = !!s.cmdUnattended; $('#cmdun').disabled = !h.hasPerm;
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
  const refresh = () => rd.state().then((st) => { document.title = st.app || document.title; const a2 = document.getElementById('appname2'); if (a2 && st.app) a2.textContent = st.app; return render(st); });
  setInterval(() => rd.licenseQuiet().catch(() => {}), 120000);
  rd.onState(refresh); refresh();
  setInterval(refresh, 30000);
  for (const id of ['name', 'relay']) { $('#' + id).addEventListener('focus', () => { typing = true; }); $('#' + id).addEventListener('blur', () => { typing = false; }); }

  const licMsg = (t, bad) => { const m = $('#licmsg'); m.hidden = !t; m.textContent = t || ''; m.className = 'small ' + (bad ? 'err' : 'muted'); };
  const clean = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  // Plans panel: live plans from qubitpage.com; Buy opens that plan there (PayPal), with the number of PCs
  let plans = null; let period = 'yearly';
  const SYM = { EUR: '€', USD: '$', GBP: '£' };
  const money = (c, cur) => (SYM[cur] || '') + (c / 100).toFixed(2).replace(/\.00$/, '') + (SYM[cur] ? '' : ' ' + cur);
  const PER = { monthly: 'Monthly', quarterly: '3 months', 'half-yearly': '6 months', yearly: 'Yearly', 'two-years': '2 years' };
  const ORDER = ['monthly', 'quarterly', 'half-yearly', 'yearly', 'two-years'];
  function drawPlans() {
    if (!plans) return;
    const periods = [...new Set(plans.plans.map((p) => p.period))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
    if (!periods.includes(period)) period = periods.includes('yearly') ? 'yearly' : periods[0];
    $('#period').innerHTML = periods.map((x) => `<button data-period="${esc(x)}">${esc(PER[x] || x)}</button>`).join('');
    for (const b of document.querySelectorAll('#period button')) b.classList.toggle('on', b.dataset.period === period);
    const list = plans.plans.filter((p) => p.period === period);
    const pcs = Math.max(1, Math.floor(Number($('#pcs').value) || 1));
    $('#plangrid').innerHTML = list.map((p) => `<div class="plan ${p.tier}"><div class="pt">${p.tier === 'max' ? 'Max' : 'Pro'} <span class="muted small">${p.tier === 'max' ? 'any number of computers' : 'up to 3 computers'}</span></div>
      <div class="pp">${esc(money(p.price_cents, p.currency))} <span class="muted small">per PC / ${p.months % 12 === 0 ? (p.months === 12 ? 'year' : p.months / 12 + ' years') : p.months === 1 ? 'month' : p.months + ' months'}</span></div>
      <div class="muted small">No time limits · unattended access · ${p.recurring ? 'renews automatically, stop any time' : 'one payment'}</div>
      <button class="primary" data-buy="${esc(p.code)}">Buy ${pcs} PC${pcs === 1 ? '' : 's'} — ${esc(money(p.price_cents * Math.min(pcs, p.max_pcs), p.currency))} on qubitpage.com</button></div>`).join('') || '<div class="muted small">No plans for this period.</div>';
    $('#plansnote').textContent = plans.live ? '' : 'qubitpage.com could not be reached; these are the standard prices. The page that opens shows the current ones.';
  }
  async function openPlans() { $('#plans').hidden = false; if (!plans) { $('#plangrid').innerHTML = '<div class="muted small">Loading the plans from qubitpage.com…</div>'; plans = await rd.plans(); } drawPlans(); $('#plans').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  $('#buy').onclick = () => { if ($('#plans').hidden) openPlans(); else $('#plans').hidden = true; };
  $('#plansclose').onclick = () => { $('#plans').hidden = true; };
  $('#period').onclick = (e) => { const b = e.target.closest('button'); if (b) { period = b.dataset.period; drawPlans(); } };
  $('#pcs').oninput = drawPlans;
  $('#plangrid').onclick = (e) => { const b = e.target.closest('[data-buy]'); if (b) rd.buy(b.dataset.buy, Number($('#pcs').value) || 1); };
  $('#mylic').onclick = () => rd.myLicenses();
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
  $('#cmdun').onchange = (e) => rd.set({ cmdUnattended: e.target.checked }).then(render);

  // ---------------------------------------------------------------- AI technician settings
  let ai = null;
  const aiMsg = (t, bad) => { $('#aimsg').textContent = t || ''; $('#aimsg').className = 'small ' + (bad ? 'err' : 'muted'); };
  function drawAi(s) {
    ai = s;
    $('#aiprov').innerHTML = Object.entries(s.presets).map(([k, p]) => `<option value="${esc(k)}">${esc(p.label)}</option>`).join('');
    $('#aiprov').value = s.provider; $('#aimode').value = s.mode; $('#aisup').checked = s.supervisor !== false;
    $('#aimodel').value = s.model || s.defModel; $('#aimodel').placeholder = s.defModel || 'model name';
    $('#aibase').value = s.base; $('#aibase').placeholder = s.defBase || 'https://…/v1';
    $('#aiadv').open = !s.defBase || !!s.base; // a service without a fixed address (Other) or a changed address
    const p = s.presets[s.provider] || {};
    $('#aikey').placeholder = p.noKey ? 'Not needed for a local model' : s.hasKey ? 'Saved (encrypted) — paste a new one to change it' : 'Paste your API key';
    $('#aidelkey').hidden = !s.hasKey;
    $('#aistate').textContent = s.ready ? `Ready: ${s.model || s.defModel} on ${p.label}. Open ✦ AI technician in a remote session, or ✦ AI DevOps in the SSH terminal.` : 'Add your own API key: the AI works on remote computers (screen, mouse, commands) and on your servers over SSH.';
    // the host app's own AI (Muse Carpathron): no key or address here — they come from the app's settings
    $('#aikey').closest('label').hidden = !!s.app; $('#aiadv').hidden = !!s.app; $('#aidelkey').hidden = !!s.app || !s.hasKey;
    if (s.app) $('#aistate').textContent = s.ready ? `Ready: ${s.model || s.defModel} with ${s.appName}'s own AI settings (its Meta API key). Open ✦ AI technician in a remote session, or ✦ AI DevOps in the SSH terminal.` : `Add your Meta API key in ${s.appName}: Settings → AI models. The AI technician uses the same key — or choose another AI service here.`;
    $('#aiset').classList.toggle('ready', !!s.ready);
  }
  rd.aiSettings().then(drawAi).catch(() => {});
  $('#aisup').onchange = async (e) => { try { drawAi(await rd.aiSave({ supervisor: e.target.checked })); aiMsg(e.target.checked ? 'Supervisor on.' : 'Supervisor off.'); } catch (err) { aiMsg(clean(err), true); } };
  $('#aiprov').onchange = async (e) => { try { drawAi(await rd.aiSave({ provider: e.target.value })); aiMsg(''); } catch (err) { aiMsg(clean(err), true); } };
  // returns true when saved; a key pasted into the address box by mistake is saved as the key
  $('#aisave').onclick = async () => {
    let base = $('#aibase').value.trim(); let key = $('#aikey').value.trim(); let note = '';
    if (base && !/^https?:\/\//i.test(base)) {
      if (!key && !/\s/.test(base) && base.length >= 16) { key = base; base = ''; $('#aibase').value = ''; note = 'That was your API key in the address box: it is now saved as the API key. '; }
      else { aiMsg('The API address must be a link that starts with https:// — paste the key in the API key box instead.', true); return false; }
    }
    const patch = { model: $('#aimodel').value.trim(), base, mode: $('#aimode').value };
    if (key) patch.key = key;
    try { drawAi(await rd.aiSave(patch)); $('#aikey').value = ''; aiMsg(note + 'Saved.'); return true; } catch (err) { aiMsg(clean(err), true); return false; }
  };
  $('#aidelkey').onclick = async () => { if (confirm('Remove the saved API key?')) { drawAi(await rd.aiSave({ key: '' })); aiMsg('The key was removed.'); } };
  $('#aitest').onclick = async () => { if (!(await $('#aisave').onclick())) return; const note = $('#aimsg').textContent.replace(/Saved\.$/, ''); aiMsg(note + 'Testing…'); try { const t = await rd.aiTest(); aiMsg(note + 'It works: ' + t); } catch (err) { aiMsg(note + clean(err), true); } };
  $('#aiload').onclick = async () => { aiMsg('Loading models…'); try { const list = await rd.aiModels(); $('#aimodels').innerHTML = list.map((m) => `<option value="${esc(m)}">`).join(''); aiMsg(`${list.length} models: click the Model box to choose.`); } catch (err) { aiMsg(clean(err), true); } };
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
