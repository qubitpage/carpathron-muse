// Carpathron Remote — the bar + side panel on the computer being controlled: who is connected, Disconnect, and
// chat, voice call, files and "let them control" (view only). The session itself runs in the hidden host page.
'use strict';
(function () {
  const rd = window.rd; const $ = (s) => document.querySelector(s);
  let st = null, unread = 0, open = false, level = 0;
  const cmd = (c) => rd.panelCmd(c).catch(() => {});
  const ui = new window.PanelUI({
    sendChat: (text) => cmd({ t: 'chat', text }),
    sendFile: (file) => cmd({ t: 'file', file }),
    cancel: (id) => cmd({ t: 'cancel', id }),
    show: (p) => rd.showFile(p), openFolder: () => rd.showFile('downloads'),
    call: () => cmd({ t: 'call' }), join: () => cmd({ t: 'join' }), hangup: () => cmd({ t: 'hangup' }),
    mute: (on) => cmd({ t: 'mute', on }), level: () => level,
    onUnread: () => { if (!open) { unread += 1; $('#badge').textContent = unread; $('#badge').hidden = false; } },
  });
  function setOpen(on) { open = !!on; $('#side').hidden = !open; document.body.classList.toggle('open', open); if (open) { unread = 0; $('#badge').hidden = true; } }
  $('#toggle').onclick = async () => { setOpen(await rd.panelOpen(!open)); };
  rd.onPanelOpen((on) => setOpen(on));
  $('#end').onclick = () => rd.disconnect('*');
  $('#ctl').onchange = (e) => cmd({ t: 'control', on: e.target.checked });

  async function refresh() {
    st = await rd.state(); const n = st.sessions.length; const s0 = st.sessions[0] || {};
    const watching = st.sessions.every((x) => x.control === false);
    $('#txt').textContent = n === 1 ? `${s0.name} is ${s0.control === false ? 'watching' : 'controlling'} this computer` : `${n} people are ${watching ? 'watching' : 'connected to'} this computer`;
    $('#ctl').checked = st.sessions.some((x) => x.control !== false);
    const c = st.sessions.find((x) => x.call) || {}; const call = c.call || '';
    if (call !== ui.state) ui.callState(call, c.name);
  }
  rd.onState(refresh); refresh();
  function onEvent(ev) {
    if (ev.t === 'chat') ui.chat(ev.from, ev.text, !!ev.me, ev.at);
    else if (ev.t === 'info') ui.info(ev.text);
    else if (ev.t === 'call-error') ui.info('The microphone could not be started: ' + ev.error, true);
    else if (/^(in|out)-/.test(ev.t)) ui.file(ev);
    else if (ev.t === 'level') level = ev.v;
    if (/^call/.test(ev.t)) refresh();
  }
  rd.panelLog().then((log) => log.forEach(onEvent)).catch(() => {});
  rd.onPanelEvent(onEvent);
  // drop files anywhere on the panel
  window.addEventListener('dragover', (e) => { e.preventDefault(); if (!open) rd.panelOpen(true).then(setOpen); });
  window.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) ui.sendFileList(e.dataTransfer.files); });
})();
