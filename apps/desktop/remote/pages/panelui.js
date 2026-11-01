// Carpathron Remote — the chat / voice call / files panel, shared by the viewer window and the panel on the
// controlled computer. The page gives the actions (send chat, start call, send files…); this file only draws.
'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = (t) => new Date(t || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const linkify = (s) => esc(s).replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

  class PanelUI {
    constructor(a) {
      this.a = a; this.state = ''; this.muted = false; this.unread = 0; this.files = new Map();
      $('#chatf').addEventListener('submit', (e) => { e.preventDefault(); const t = $('#chatin').value.trim(); if (!t) return; $('#chatin').value = ''; a.sendChat(t); });
      $('#callbtn').onclick = () => { if (this.state === '') a.call(); else if (this.state === 'ringing') a.join(); else a.hangup(); };
      $('#mutebtn').onclick = () => { this.muted = !this.muted; a.mute(this.muted); this._call(); };
      $('#pick').onclick = (e) => { e.preventDefault(); $('#filein').click(); };
      $('#filein').onchange = (e) => { this.sendFileList(e.target.files); e.target.value = ''; };
      $('#opendl').onclick = () => a.openFolder();
      $('#files').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.show) a.show(b.dataset.show); if (b.dataset.cancel) a.cancel(b.dataset.cancel); });
      const dz = $('#dropzone');
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('over'); this.sendFileList(e.dataTransfer.files); });
      setInterval(() => { const m = $('#mic'); if (!m || m.hidden) return; const l = a.level ? a.level() : 0; m.firstElementChild.style.width = Math.min(100, Math.round(l * 160)) + '%'; }, 150);
      this._call();
    }
    async sendFileList(list) {
      for (const f of [...(list || [])]) {
        try { const info = await window.rd.fileFromDrop(f); this.a.sendFile(info); }
        catch (e) { this.info(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
      }
    }
    _add(html, cls) {
      const log = $('#chatlog'); const d = document.createElement('div'); d.className = 'msg ' + (cls || ''); d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight;
      if (cls !== 'me' && this.a.onUnread) this.a.onUnread();
    }
    chat(from, text, me, at) { this._add(`<span class="from">${esc(from)} · ${time(at)}</span><div class="body">${linkify(text)}</div>`, me ? 'me' : 'them'); }
    info(text, bad) { this._add(`<div class="body">${esc(text)}</div>`, 'sys' + (bad ? ' bad' : '')); }
    callState(state, who) {
      const was = this.state; this.state = state || '';
      if (this.state === 'ringing') this.info(`${who || 'The other side'} is calling you. Click Join to talk.`);
      else if (this.state === 'on' && was !== 'on') this.info('Voice call started. Use headphones for the best sound.');
      else if (!this.state && was) this.info('Voice call ended.');
      if (!this.state) this.muted = false;
      this._call();
    }
    _call() {
      const b = $('#callbtn'), m = $('#mutebtn'), s = $('#callstate'), mic = $('#mic');
      const L = { '': ['Start call', 'primary', 'Not in a call'], calling: ['Cancel call', 'danger', 'Calling…'], ringing: ['Join call', 'primary', 'Incoming call'], on: ['Hang up', 'danger', this.muted ? 'In call · muted' : 'In call'] }[this.state];
      b.textContent = L[0]; b.className = L[1]; s.textContent = L[2]; s.className = 'small ' + (this.state === 'on' ? 'okc' : this.state ? 'warnc' : 'muted');
      m.hidden = this.state !== 'on'; m.textContent = this.muted ? 'Unmute' : 'Mute'; mic.hidden = this.state !== 'on' && this.state !== 'calling';
      let dec = $('#declinebtn');
      if (this.state === 'ringing' && !dec) { dec = document.createElement('button'); dec.id = 'declinebtn'; dec.textContent = 'Decline'; dec.onclick = () => this.a.hangup(); b.after(dec); }
      if (this.state !== 'ringing' && dec) dec.remove();
    }
    // file events from RD.Transfers: out-start/out-progress/out-done, in-start/in-progress/in-done
    file(ev) {
      let f = this.files.get(ev.id);
      if (ev.t === 'out-start' || ev.t === 'in-start') { f = { id: ev.id, name: ev.name, size: ev.size, dir: ev.t[0] === 'o' ? 'out' : 'in', done: 0, state: 'go' }; this.files.set(ev.id, f); }
      if (!f) return;
      if (/progress/.test(ev.t)) f.done = ev.done;
      if (/done/.test(ev.t)) { f.state = ev.ok ? 'ok' : 'bad'; f.path = ev.path || ''; f.error = ev.error || ''; if (ev.name) f.name = ev.name; if (ev.ok) f.done = f.size; if (this.a.onUnread && f.dir === 'in') this.a.onUnread(); }
      this._files();
    }
    _files() {
      const list = [...this.files.values()].reverse().slice(0, 30);
      $('#files').innerHTML = list.map((f) => {
        const pct = f.size ? Math.floor((f.done / f.size) * 100) : 100;
        const label = f.state === 'go' ? `${f.dir === 'out' ? 'Sending' : 'Receiving'} ${pct}% · ${window.RD.fmtSize(f.done)} of ${window.RD.fmtSize(f.size)}` : f.state === 'ok' ? (f.dir === 'out' ? 'Sent ✓' : 'Received ✓ — saved in Downloads\\Carpathron Remote') : `Not ${f.dir === 'out' ? 'sent' : 'received'}${f.error ? ': ' + f.error : ''}`;
        const btn = f.state === 'go' ? `<button data-cancel="${esc(f.id)}">Cancel</button>` : f.state === 'ok' && f.dir === 'in' ? `<button data-show="${esc(f.path)}">Show</button>` : '';
        return `<div class="file ${f.state}"><div class="t"><b title="${esc(f.name)}">${f.dir === 'out' ? '↑' : '↓'} ${esc(f.name)}</b><span class="small muted">${esc(label)}</span><div class="bar"><i style="width:${pct}%"></i></div></div>${btn}</div>`;
      }).join('');
    }
  }
  window.PanelUI = PanelUI;
})();
