// Carpathron Remote DevOps — the AI panel (remote desktop viewer: "AI technician"; SSH window: "AI DevOps").
// The AI itself runs in the app (ai.js); this panel sends tasks, shows each step, and asks for your OK.
'use strict';
(function () {
  const rd = window.rd;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // the AI's answers: a small, safe subset of Markdown (everything is escaped first): **bold**, `code`, headings, lists
  const md = (t) => {
    const lines = esc(t).split('\n'); let html = '', list = false;
    const inline = (x) => x.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');
    for (const raw of lines) {
      const l = raw.trimEnd(); const li = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/); const h = l.match(/^\s*#{1,4}\s+(.*)$/);
      if (li) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(li[1])}</li>`; continue; }
      if (list) { html += '</ul>'; list = false; }
      html += h ? `<b>${inline(h[1])}</b><br>` : l ? `${inline(l)}<br>` : '<br>';
    }
    if (list) html += '</ul>';
    return html.replace(/(<br>)+$/, '');
  };
  const clean = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const ICON = { ask: '⏸', running: '…', done: '✓', error: '✕', denied: '–' };

  class AIPanel {
    // o = { root (element), target: 'desktop'|'ssh', tid, quick: [[label, task]], title, onCommand(script) for the console (optional) }
    constructor(o) {
      this.o = o; this.tid = o.tid || ''; this.running = false; this.cards = new Map();
      const r = this.root = o.root;
      r.classList.add('aip');
      r.innerHTML = `
        <div class="aip-head"><b>${esc(o.title || 'AI technician')}</b><select class="aip-svc" title="Which AI works on this job (the services you added a key for in Settings)"></select><span class="muted small aip-model"></span><span class="grow"></span>
          <select class="aip-mode" title="How the AI works"><option value="approve">Ask before changes</option><option value="auto">Autopilot</option></select>
          <button class="aip-new small" title="Start a new task (forget this conversation)">New</button></div>
        <div class="aip-setup" hidden><p>Add your AI API key to use the ${esc(o.title || 'AI technician')}: Meta Muse, Anthropic Claude, OpenAI, OpenRouter or a local model.</p><button class="primary aip-open">Open Settings → AI</button></div>
        <div class="aip-log"></div>
        <div class="aip-quick"></div>
        <form class="aip-form"><textarea rows="2" placeholder="${o.target === 'ssh' ? 'Give a job, e.g. “Install nginx with a free HTTPS certificate for example.com”' : 'Give a job, e.g. “Free up disk space on C:” or “Check this PC for security problems”'}"></textarea>
          <div class="row tight"><button class="primary aip-send" type="submit">Send</button><button type="button" class="danger aip-stop" hidden>Stop</button><span class="muted small aip-status"></span></div></form>
        ${o.onCommand ? `<details class="aip-console"><summary>Run a command yourself</summary><form class="aip-cform"><textarea rows="2" placeholder="${o.target === 'ssh' ? 'bash command' : 'PowerShell command (bash on Linux)'}"></textarea><div class="row tight"><label class="switch small"><input type="checkbox" class="aip-admin"> <span>as administrator</span></label><span class="grow"></span><button type="submit">Run</button></div><pre class="aip-cout" hidden></pre></form></details>` : ''}`;
      this.$ = (s) => r.querySelector(s);
      this.log = this.$('.aip-log');
      (o.quick || []).forEach(([label, task]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'small'; b.textContent = label; b.onclick = () => this.send(task); this.$('.aip-quick').appendChild(b); });
      this.$('.aip-form').onsubmit = (e) => { e.preventDefault(); const t = this.$('.aip-form textarea'); const v = t.value.trim(); if (v) { this.send(v); t.value = ''; } };
      this.$('.aip-form textarea').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.$('.aip-form').requestSubmit(); } e.stopPropagation(); });
      this.$('.aip-stop').onclick = () => rd.aiStop(this.tid);
      this.$('.aip-new').onclick = async () => { await rd.aiReset(this.tid); this.log.innerHTML = ''; this.cards.clear(); this.refreshLabel(); };
      // the AI service / model may change in Settings while this window is open: show the current one
      window.addEventListener('focus', () => this.refreshLabel());
      this.$('.aip-open').onclick = () => rd.openHome();
      this.$('.aip-mode').onchange = (e) => rd.aiSave({ mode: e.target.value }).catch(() => {});
      // switch the AI while working: the next job (and the rest of this conversation) uses the chosen service
      this.$('.aip-svc').onchange = async (e) => {
        try { await rd.aiSave({ provider: e.target.value }); this.add(`Now working with ${esc(e.target.selectedOptions[0].textContent)}.`, 'note'); }
        catch (err) { this.add(esc(clean(err)), 'err'); }
        this.refreshLabel(); this.refresh();
      };
      if (o.onCommand) {
        const f = this.$('.aip-cform');
        f.querySelector('textarea').addEventListener('keydown', (e) => e.stopPropagation());
        f.onsubmit = async (e) => {
          e.preventDefault(); const v = f.querySelector('textarea').value.trim(); if (!v) return;
          const out = this.$('.aip-cout'); out.hidden = false; out.textContent = 'Running…';
          try { const r = await o.onCommand(v, this.$('.aip-admin').checked); out.textContent = `${r.out || r.error || '(no output)'}\n[exit code ${r.code}]`; } catch (err) { out.textContent = clean(err); }
        };
      }
      this.unsub = rd.onAiEv((tid, ev) => { if (tid === this.tid) this.onEv(ev); });
      this.refresh();
    }
    async refreshLabel() {
      const s = await rd.aiSettings().catch(() => null); const el = this.$('.aip-model'); if (!s || !el) return;
      const p = s.presets[s.provider] || {}; el.textContent = s.ready ? `${s.model || s.defModel}` : '';
      const sel = this.$('.aip-svc');
      if (sel) { // the services that can work now: with a saved key, no key needed (local), or the app's own AI
        const ids = Object.keys(s.presets).filter((k) => k === s.provider || (s.keysFor || []).includes(k) || s.presets[k].noKey || s.presets[k].app);
        sel.innerHTML = ids.map((k) => `<option value="${esc(k)}">${esc((s.presets[k].label || k).replace(/ \(.*\)$/, ''))}</option>`).join('');
        sel.value = s.provider; sel.hidden = ids.length < 2;
      }
    }
    async refresh() {
      const s = await rd.aiSettings().catch(() => null); if (!s) return;
      this.$('.aip-setup').hidden = s.ready; this.$('.aip-form').hidden = !s.ready; this.$('.aip-quick').hidden = !s.ready;
      this.$('.aip-mode').value = s.mode;
      this.refreshLabel();
    }
    add(html, cls) { const d = document.createElement('div'); d.className = 'aip-msg ' + (cls || ''); d.innerHTML = html; this.log.appendChild(d); this.log.scrollTop = this.log.scrollHeight; return d; }
    async send(task) {
      this.add(esc(task), 'me'); this.refreshLabel();
      try { await rd.aiStart({ target: this.o.target, tid: this.tid, task, mode: this.$('.aip-mode').value }); }
      catch (e) { const m = clean(e); if (m === 'setup') { this.refresh(); this.add('Add your AI API key in Settings first.', 'err'); } else this.add(esc(m), 'err'); }
    }
    setRunning(on) { this.running = on; this.$('.aip-stop').hidden = !on; this.$('.aip-send').textContent = on ? 'Send to the AI' : 'Send'; this.$('.aip-status').textContent = on ? 'Working…' : ''; if (this.o.onRunning) this.o.onRunning(on); }
    onEv(ev) {
      if (ev.t === 'state') this.setRunning(ev.running);
      else if (ev.t === 'thinking') this.$('.aip-status').textContent = 'Thinking…';
      else if (ev.t === 'say') this.add(md(ev.text), 'ai');
      else if (ev.t === 'info') this.add(esc(ev.text), 'note');
      else if (ev.t === 'error') this.add(esc(ev.text), 'err');
      else if (ev.t === 'done') this.$('.aip-status').textContent = 'Done';
      else if (ev.t === 'tool') this.card(ev);
      else if (ev.t === 'tool-update') this.update(ev);
      else if (ev.t === 'verdict') this.verdict(ev);
    }
    // 🛡 the Supervisor's verdict: what was checked, how, and what it saw
    verdict(v) {
      const L = { verified: ['✓ Verified', 'ok'], partly: ['◐ Partly done', 'warn'], failed: ['✕ Not verified — problems found', 'bad'], not_verifiable: ['? Could not verify', 'warn'] }[v.verdict] || ['?', 'warn'];
      const passed = (v.checks || []).filter((x) => x.pass).length;
      const checks = (v.checks || []).map((x) => `<div class="aip-chk ${x.pass ? 'ok' : 'bad'}"><b>${x.pass ? '✓' : '✕'} ${esc(x.requirement)}</b><div class="muted small">Checked with: ${esc(x.method)}</div>${x.evidence ? `<pre class="aip-out">${esc(x.evidence)}</pre>` : ''}</div>`).join('');
      this.add(`<div class="aip-vh"><b>🛡 Supervisor: ${L[0]}</b><span class="muted small">${passed}/${(v.checks || []).length} checks passed · ${v.ran || 0} checks run · ${Math.round((v.ms || 0) / 1000)} s · ${esc(v.model || '')}</span></div>
        <div>${esc(v.summary || '')}</div>${checks ? `<details ${v.verdict === 'verified' ? '' : 'open'}><summary>Evidence</summary>${checks}</details>` : ''}${v.fix && v.verdict !== 'verified' ? `<div><b>To fix:</b> ${esc(v.fix)}</div>` : ''}`, 'verdict ' + L[1]);
    }
    card(ev) {
      const d = this.add(`<div class="aip-ct"><span class="aip-st"></span><b>${esc(ev.title)}</b></div>${ev.detail ? `<pre class="aip-detail">${esc(ev.detail)}</pre>` : ''}<div class="aip-act" hidden><button class="primary small" data-a="yes">Allow</button><button class="small" data-a="all">Allow all for this job</button><button class="small" data-a="no">Don't</button></div><pre class="aip-out" hidden></pre><img class="aip-img" hidden alt="">`, 'tool');
      d.dataset.id = ev.id; this.cards.set(ev.id, d); if (ev.sup) d.classList.add('sup');
      d.querySelector('.aip-act').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; rd.aiApprove(this.tid, ev.id, b.dataset.a === 'yes' ? true : b.dataset.a === 'all' ? 'all' : false); d.querySelector('.aip-act').hidden = true; };
      this.update({ id: ev.id, status: ev.status, out: ev.out });
      if (ev.status === 'ask') { this.$('.aip-status').textContent = 'Waiting for your OK'; d.scrollIntoView({ block: 'nearest' }); }
    }
    update(ev) {
      const d = this.cards.get(ev.id); if (!d) return;
      d.className = 'aip-msg tool ' + ev.status + (d.classList.contains('sup') ? ' sup' : ''); d.querySelector('.aip-st').textContent = ICON[ev.status] || '';
      d.querySelector('.aip-act').hidden = ev.status !== 'ask';
      if (ev.out) { const o = d.querySelector('.aip-out'); o.hidden = false; o.textContent = ev.out; }
      if (ev.image) { const i = d.querySelector('.aip-img'); i.src = ev.image; i.hidden = false; i.onclick = () => i.classList.toggle('big'); }
      if (ev.status === 'running') this.$('.aip-status').textContent = 'Working…';
      this.log.scrollTop = this.log.scrollHeight;
    }
  }
  window.AIPanel = AIPanel;
})();
