// Carpathron Shield page: scan projects / servers / websites, apply fixes, live monitoring, alerts and fix history.
'use strict';
(() => {
  const U = () => window.MCui;
  const SEV = { critical: { icon: '✗', label: 'critical', cls: 'bad' }, warning: { icon: '⚠', label: 'warning', cls: 'warn' }, info: { icon: 'ℹ', label: 'info', cls: '' }, ok: { icon: '✓', label: 'ok', cls: 'ok' } };
  const st = { status: null, result: null, unseen: 0, busy: false, project: '', purpose: 'review', server: '', url: '', deep: true, owner: false };
  try { Object.assign(st, JSON.parse(localStorage.getItem('mc.shield') || '{}'), { status: null, result: null, busy: false }); } catch {}
  const save = () => { try { localStorage.setItem('mc.shield', JSON.stringify({ project: st.project, purpose: st.purpose, server: st.server, url: st.url, deep: st.deep })); } catch {} };
  const time = (ts) => (ts ? new Date(ts).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

  async function load() { st.status = await U().api('/api/shield'); return st.status; }

  // ------------------------------------------------------------ scan cards
  function renderScan() {
    const { h, $, api, isDesktop, S } = U();
    const el = $('#shieldScan');
    el.innerHTML = '';
    const servers = (st.status && st.status.servers) || [];
    if (!st.project) st.project = (S.conv && S.conv.workspace) || (S.settings && S.settings.workspace) || '';
    if (!st.server && servers[0]) st.server = servers[0].id;

    const proj = h('input', { value: st.project, placeholder: 'Project folder', oninput: (e) => { st.project = e.target.value; save(); } });
    const purpose = h('select', { onchange: (e) => { st.purpose = e.target.value; save(); } },
      ...[['review', 'Review'], ['github', 'Before GitHub'], ['server', 'Before server upload']].map(([v, t]) => h('option', { value: v, selected: st.purpose === v }, t)));
    const srvSel = h('select', { onchange: (e) => { st.server = e.target.value; save(); } }, ...servers.map((s) => h('option', { value: s.id, selected: st.server === s.id }, `${s.name} (${s.username}@${s.host})`)));
    const url = h('input', { value: st.url, placeholder: 'https://your-site.com', oninput: (e) => { st.url = e.target.value; save(); } });
    const deep = h('input', { type: 'checkbox', checked: st.deep, onchange: (e) => { st.deep = e.target.checked; save(); } });
    const owner = h('input', { type: 'checkbox', checked: st.owner, onchange: (e) => { st.owner = e.target.checked; } });

    el.append(h('div', { class: 'shield-cards' },
      h('div', { class: 'card' }, h('h3', {}, '📦 Project — before publishing'),
        h('p', { class: 'small muted' }, 'API keys and passwords in code, .env files, private keys, public source maps, open Firebase rules, Supabase tables without row-level security, debug mode.'),
        h('div', { class: 'row' }, proj, isDesktop ? h('button', { class: 'btn', onclick: async () => { const f = await window.desktop.pickFolder(proj.value); if (f) { proj.value = st.project = f; save(); } } }, 'Browse…') : null),
        h('div', { class: 'row' }, purpose, h('button', { class: 'btn primary', disabled: st.busy, onclick: () => run({ target: 'project', path: proj.value.trim(), purpose: purpose.value }) }, 'Scan project'))),
      h('div', { class: 'card' }, h('h3', {}, '🖥 Server'),
        h('p', { class: 'small muted' }, 'Firewall, SSH logins (incl. post-quantum key exchange), updates, password guessing, exposed databases, world-readable .env files, web roots.'),
        servers.length ? h('div', { class: 'row' }, srvSel, h('button', { class: 'btn primary', disabled: st.busy, onclick: () => run({ target: 'server', server: srvSel.value }) }, 'Scan server'))
          : h('div', { class: 'row' }, h('span', { class: 'small muted grow' }, 'No servers saved yet.'), h('button', { class: 'btn', onclick: () => U().show('remote') }, 'Add a server'))),
      h('div', { class: 'card' }, h('h3', {}, '🌍 Website'),
        h('p', { class: 'small muted' }, 'HTTPS, security headers, exposed files, secret keys in the site JavaScript, public source maps; deep: Supabase / Firebase data readable by anyone.'),
        h('div', { class: 'row' }, url),
        h('label', { class: 'toggle small' }, deep, h('span', {}, 'Deep check (reads at most 1 row per table, keeps nothing)')),
        h('label', { class: 'toggle small' }, owner, h('span', {}, 'I own or manage this site')),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: st.busy, onclick: () => { if (!owner.checked) return U().toast('Confirm that you own or manage this site', true); run({ target: 'site', url: url.value.trim(), deep: deep.checked }); } }, 'Scan website')))));
  }

  async function run(body) {
    const { api, toast, $ } = U();
    if (body.target === 'project' && !body.path) return toast('Choose a project folder', true);
    if (body.target === 'site' && !body.url) return toast('Enter the site address', true);
    st.busy = true; renderScan();
    $('#shieldResult').innerHTML = '';
    $('#shieldResult').append(U().h('div', { class: 'card shield-wait' }, U().h('span', { class: 'spinner' }), ` Scanning ${body.target === 'project' ? 'the project' : body.target === 'server' ? 'the server over SSH' : 'the website'}…`));
    try {
      const r = await api('/api/shield/scan', { body });
      if (r.error) throw new Error(r.error);
      st.result = r;
      renderResult();
      load().then(() => { renderServers(); }).catch(() => {});
    } catch (e) { $('#shieldResult').innerHTML = ''; toast(e.message, true); }
    finally { st.busy = false; renderScan(); }
  }

  // ------------------------------------------------------------ result
  function renderResult() {
    const { h, $ } = U();
    const el = $('#shieldResult');
    el.innerHTML = '';
    const r = st.result;
    if (!r) return;
    const label = { project: 'Project', server: 'Server', site: 'Website' }[r.kind];
    const problems = r.findings.filter((f) => f.severity !== 'ok');
    const passed = r.findings.filter((f) => f.severity === 'ok');
    const rescan = () => run(r.kind === 'project' ? { target: 'project', path: r.target, purpose: r.purpose } : r.kind === 'server' ? { target: 'server', server: r.serverId } : { target: 'site', url: r.target, deep: r.deep });
    el.append(h('div', { class: 'card shield-result' },
      h('div', { class: 'shield-head' },
        h('div', { class: `shield-grade g-${r.grade}` }, h('b', {}, r.grade), h('span', {}, `${r.score}`)),
        h('div', { class: 'grow' },
          h('div', { class: 'small muted' }, `${label}${r.kind === 'project' ? ` · ${{ github: 'before GitHub', server: 'before server upload', review: 'review' }[r.purpose]}` : ''} · ${time(r.at)}`),
          h('h3', { style: 'margin:2px 0 4px' }, r.target),
          h('div', { class: 'row', style: 'margin:0' },
            h('span', { class: 'pill bad' }, `${r.counts.critical} critical`), h('span', { class: 'pill warn' }, `${r.counts.warning} warnings`), h('span', { class: 'pill' }, `${r.counts.info} info`), h('span', { class: 'pill ok' }, `${r.counts.ok} passed`),
            r.kind === 'project' ? h('span', { class: 'small muted', style: 'align-self:center' }, `${r.scannedFiles} files checked`) : null),
          r.note ? h('div', { class: 'small muted', style: 'margin-top:6px' }, r.note) : null),
        h('button', { class: 'btn', onclick: rescan }, '↻ Scan again')),
      problems.length ? h('div', { class: 'shield-findings' }, ...problems.map((f) => finding(r, f))) : h('div', { class: 'shield-clean' }, '✓ No problems found.'),
      passed.length ? h('details', { class: 'small', style: 'margin-top:10px' }, h('summary', {}, `✓ ${passed.length} check${passed.length === 1 ? '' : 's'} passed`), h('div', { class: 'shield-findings' }, ...passed.map((f) => finding(r, f)))) : null));
  }
  function finding(r, f) {
    const { h } = U();
    const s = SEV[f.severity] || SEV.info;
    const canFix = r.kind === 'server' && f.fix && f.fix.id && r.canFix !== false;
    return h('div', { class: `shield-finding sev-${f.severity}` },
      h('span', { class: 'sev-icon' }, s.icon),
      h('div', { class: 'grow' },
        h('b', {}, f.title),
        f.file ? h('div', { class: 'mono small' }, `${f.file}${f.line ? `:${f.line}` : ''}`) : null,
        f.detail ? h('div', { class: 'small muted' }, f.detail) : null,
        f.fix && f.fix.text ? h('div', { class: 'small fix-text' }, `→ ${f.fix.text}`) : null),
      f.severity === 'critical' || f.severity === 'warning' ? h('div', { class: 'shield-actions' },
        canFix ? h('button', { class: 'btn tiny primary', onclick: () => fixDialog(r, f.fix.id) }, '⚡ Fix') : null,
        h('button', { class: 'btn tiny', title: 'Open a chat that fixes this with the agent (you review the message first)', onclick: () => aiFix(r, f) }, '🤖 Fix with AI')) : null);
  }

  async function aiFix(r, f) {
    const { newChat, patchConv, toast } = U();
    await newChat();
    if (r.kind === 'server' && r.serverId) await patchConv({ remote: { serverId: r.serverId, path: '' } });
    if (r.kind === 'project') await patchConv({ workspace: r.target });
    const where = r.kind === 'project' ? `in the project ${r.target}` : r.kind === 'server' ? `on the server ${r.target}` : `on the website ${r.target}`;
    const text = `Carpathron Shield found this problem ${where}:\n${(SEV[f.severity] || SEV.info).icon} ${f.title}${f.file ? ` — ${f.file}${f.line ? `:${f.line}` : ''}` : ''}${f.detail ? `\n${f.detail}` : ''}${f.fix && f.fix.text ? `\nSuggested fix: ${f.fix.text}` : ''}\n\nExplain it in two sentences, fix it (ask me before anything risky or hard to undo), then run shield_scan again to confirm it is gone.`;
    const input = document.querySelector('#input');
    input.value = text; input.dispatchEvent(new Event('input')); input.focus();
    toast('Review the message, then press Enter');
  }

  async function fixDialog(r, fixId, allowPorts = []) {
    const { h, api, modal, closeModal, toast } = U();
    modal(h('h3', {}, 'Preparing the fix…'), h('div', { class: 'small muted' }, 'Checking the server.'));
    let p;
    try { p = await api('/api/shield/fix/preview', { body: { server: r.serverId, fix: fixId, allowPorts } }); if (p.error) throw new Error(p.error); }
    catch (e) { closeModal(); return toast(e.message, true); }
    const keep = new Set(allowPorts);
    modal(h('h3', {}, `⚡ ${p.title}`),
      h('p', { class: 'small muted' }, `On ${p.server}. These commands run with a backup first:`),
      h('pre', { class: 'shield-cmds' }, p.commands.map((c) => `$ ${c}`).join('\n')),
      p.willBlockPorts && p.willBlockPorts.length ? h('div', { class: 'card shield-warnbox' }, h('b', {}, '⚠ These public ports will be closed:'),
        h('div', { class: 'row' }, ...p.willBlockPorts.map((port) => h('label', { class: 'toggle small' }, h('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) keep.add(port); else keep.delete(port); } }), h('span', {}, `keep ${port} open`)))),
        h('button', { class: 'btn tiny', onclick: () => fixDialog(r, fixId, [...keep]) }, 'Update the plan')) : null,
      p.lockoutProtection ? h('p', { class: 'small' }, '🛟 Lockout protection: after the change the app logs in again over a new connection. If that fails, the server undoes the change by itself within 2.5 minutes.') : null,
      p.caution ? h('p', { class: 'small', style: 'color:var(--warn)' }, `Note: ${p.caution}`) : null,
      p.undo && p.undo.length ? h('p', { class: 'small muted' }, `Undo later from Fix history (${p.undo.join('; ').slice(0, 160)}).`) : null,
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'btn primary', onclick: () => apply(r, fixId, [...keep]) }, 'Apply fix'),
        h('button', { class: 'btn', onclick: closeModal }, 'Cancel')));
  }
  async function apply(r, fixId, allowPorts) {
    const { h, api, modal, closeModal } = U();
    modal(h('h3', {}, 'Applying the fix…'), h('div', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Running on the server. Firewall and SSH fixes also log in again to confirm the app is not locked out.'));
    let x;
    try { x = await api('/api/shield/fix', { body: { server: r.serverId, fix: fixId, allowPorts } }); }
    catch (e) { x = { error: e.message }; }
    const msg = x.error ? `✕ ${x.error}` : `${x.ok ? '✓' : '✕'} ${x.title}${x.verified === true ? ' — logged in again, change kept' : x.verified === false ? ' — the app could NOT log in again: the server undoes the change by itself within 2.5 minutes' : ''}`;
    modal(h('h3', {}, x.error || !x.ok ? 'Fix not completed' : 'Fix applied'), h('p', {}, msg),
      x.output ? h('details', {}, h('summary', { class: 'small' }, 'Server output'), h('pre', { class: 'shield-cmds' }, x.output.slice(-3000))) : null,
      x.backup ? h('p', { class: 'small muted' }, `Backup: ${x.backup}`) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => { closeModal(); run({ target: 'server', server: r.serverId }); } }, 'Scan again'), h('button', { class: 'btn', onclick: closeModal }, 'Close')));
    load().then(() => { renderHistory(); renderEvents(); }).catch(() => {});
  }

  // ------------------------------------------------------------ monitoring
  function renderServers() {
    const { h, $, api, toast } = U();
    const el = $('#shieldServers');
    if (!el) return;
    el.innerHTML = '';
    const servers = (st.status && st.status.servers) || [];
    if (!servers.length) el.append(h('div', { class: 'card muted small' }, 'Add a server on the Remote page to monitor it.'));
    for (const s of servers) {
      const m = s.monitor || {};
      const iv = h('select', { title: 'Check every' }, ...[1, 5, 15, 30, 60].map((n) => h('option', { value: n, selected: (m.intervalMin || 5) === n }, `every ${n} min`)));
      const urls = h('input', { value: (m.urls || []).join(', '), placeholder: 'sites on this server (optional): example.com, api.example.com', style: 'flex:1;min-width:220px' });
      const act = async (body, ok) => { const x = await api('/api/shield/monitor', { body: { server: s.id, ...body } }); if (x && x.error) toast(x.error, true); else if (ok) toast(ok); await load(); renderServers(); renderEvents(); };
      const scan = s.lastScan;
      el.append(h('div', { class: 'item shield-mon' },
        h('span', { class: 'pill ' + (m.enabled ? (m.down ? 'bad' : 'ok') : '') }, m.enabled ? (m.down ? 'down' : 'monitoring') : 'off'),
        h('div', { class: 'grow' },
          h('b', {}, s.name), scan ? h('span', { class: `shield-mini g-${scan.grade}`, title: `Last scan ${time(scan.at)}` }, `${scan.grade} ${scan.score}`) : null,
          h('div', { class: 'meta' }, `${s.username}@${s.host}${m.enabled ? ` · last check ${time(m.lastTick)}` : ''}${m.baseline ? ` · open ports ${m.baseline.join(', ') || 'none'}` : ''}`),
          h('div', { class: 'row', style: 'margin:6px 0 0' }, iv, urls)),
        m.enabled
          ? h('div', { class: 'shield-actions' }, h('button', { class: 'btn tiny', onclick: () => act({ action: 'now' }, 'Checked') }, 'Check now'), h('button', { class: 'btn tiny', title: 'Accept the current open ports as normal', onclick: () => act({ action: 'reset' }, 'Baseline reset') }, 'Reset baseline'), h('button', { class: 'btn tiny', onclick: () => act({ action: 'stop' }, 'Monitoring stopped') }, 'Stop'))
          : h('div', { class: 'shield-actions' }, h('button', { class: 'btn tiny primary', onclick: () => { askNotify(); act({ action: 'start', intervalMin: Number(iv.value), urls: urls.value.split(/[\s,]+/).filter(Boolean) }, `Monitoring ${s.name}`); } }, '▶ Start')),
        h('button', { class: 'btn tiny', onclick: () => { st.server = s.id; save(); run({ target: 'server', server: s.id }); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 'Scan')));
      if (m.enabled) { iv.onchange = () => act({ action: 'start', intervalMin: Number(iv.value) }, 'Interval saved'); urls.onchange = () => act({ action: 'start', urls: urls.value.split(/[\s,]+/).filter(Boolean) }, 'Sites saved'); }
    }
  }
  function askNotify() { try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch {} }

  function renderEvents() {
    const { h, $ } = U();
    const el = $('#shieldEvents');
    if (!el) return;
    el.innerHTML = '';
    const evs = (st.status && st.status.events) || [];
    if (!evs.length) el.append(h('div', { class: 'muted small' }, 'No alerts yet.'));
    for (const e of evs.slice(0, 80)) el.append(eventItem(e));
  }
  function eventItem(e) {
    const { h } = U();
    const s = SEV[e.severity] || SEV.info;
    return h('div', { class: `item sev-${e.severity}` }, h('span', { class: `pill ${s.cls}` }, `${s.icon} ${s.label}`),
      h('div', { class: 'grow' }, h('b', {}, e.title), e.detail ? h('div', { class: 'meta' }, e.detail) : null),
      h('span', { class: 'meta' }, `${e.server ? e.server + ' · ' : ''}${time(e.at)}`));
  }

  function renderHistory() {
    const { h, $, api, toast } = U();
    const el = $('#shieldHistory');
    if (!el) return;
    el.innerHTML = '';
    const hist = (st.status && st.status.history) || [];
    if (!hist.length) el.append(h('div', { class: 'muted small' }, 'No fixes applied yet.'));
    for (const x of hist) {
      el.append(h('div', { class: 'item' }, h('span', { class: 'pill ' + (x.undone ? '' : x.ok ? 'ok' : 'bad') }, x.undone ? 'undone' : x.ok ? 'applied' : 'failed'),
        h('div', { class: 'grow' }, h('b', {}, x.title), h('div', { class: 'meta' }, `${x.server} · ${time(x.at)} · backup ${x.backup}`)),
        x.undo && !x.undone ? h('button', { class: 'btn tiny', onclick: async () => { if (!confirm(`Undo "${x.title}" on ${x.server}?`)) return; const r = await api('/api/shield/undo', { body: { id: x.id } }); toast(r.error || (r.ok ? 'Undone' : 'Undo did not finish'), !!r.error || !r.ok); await load(); renderHistory(); } }, 'Undo') : null));
    }
  }

  function badge() {
    const b = document.querySelector('#shieldNavBadge');
    if (!b) return;
    b.hidden = !st.unseen;
    b.textContent = st.unseen > 9 ? '9+' : String(st.unseen);
  }

  window.MCShield = {
    async show() {
      st.unseen = 0; badge();
      try { await load(); } catch (e) { U().toast(e.message, true); }
      renderScan(); renderResult(); renderServers(); renderEvents(); renderHistory();
      U().$('#shieldClear').onclick = async () => { await U().api('/api/shield/events', { method: 'DELETE' }); await load(); renderEvents(); };
    },
    onEvent(ev, d) {
      const onPage = U() && U().view() === 'shield';
      if (ev === 'shield:event') {
        if (st.status) st.status.events = [d, ...(st.status.events || [])].slice(0, 120);
        if (onPage) { const el = document.querySelector('#shieldEvents'); if (el) { if (!el.querySelector('.item')) el.innerHTML = ''; el.prepend(eventItem(d)); } }
        if (d.severity === 'critical' || d.severity === 'warning') {
          if (!onPage) { st.unseen++; badge(); }
          try { if ((document.hidden || !onPage) && window.Notification && Notification.permission === 'granted') new Notification(`Carpathron Shield — ${d.server || ''}`, { body: d.title, silent: d.severity !== 'critical' }); } catch {}
        }
        return;
      }
      if (onPage && (ev === 'shield:status' || ev === 'remote:status')) load().then(() => { renderServers(); if (ev === 'remote:status') renderScan(); }).catch(() => {});
    },
  };
})();
