// Carpathron Remote — mouse and keyboard of this PC, in their own background process (Electron utilityProcess).
// The host page sends input here straight through a MessagePort, so it never waits for the app's main thread.
// Why: when the person controlling this PC presses the minimize / maximize / close button of one of this app's own
// windows, drags its title bar or resizes it, Windows runs a loop on the app's main thread until the mouse button is
// released. If the input went through the main thread, that release could never arrive and the control froze.
// The main process only tells this process which sessions may control and which screen each one uses.
'use strict';
const { Injector } = require('./inject');

const send = (m) => { try { process.parentPort.postMessage(m); } catch {} };
const inj = new Injector((t) => send({ log: String(t) }));
inj.onStatus = (t) => send({ status: String(t) });

let allow = {}; // sid -> physical rect of the shared screen, only for sessions allowed to control
const seen = new Set();
let port = null;

function input(sid, ev) {
  sid = String(sid);
  const rect = allow[sid];
  if (!rect || !ev) return;
  if (!seen.has(sid)) { seen.add(sid); send({ first: sid, k: String(ev.k || '') }); }
  try { inj.handle(ev, rect); } catch (e) { send({ log: `remote control: input error ${e && e.message}` }); }
}

process.parentPort.on('message', (e) => {
  const m = e.data || {};
  if (m.type === 'port' && e.ports && e.ports[0]) {
    try { if (port) port.close(); } catch {}
    port = e.ports[0];
    port.on('message', (pe) => { const d = pe.data || {}; input(d.sid, d.ev); });
    port.start();
  } else if (m.type === 'sessions') {
    allow = m.allow || {};
    for (const sid of [...seen]) if (!allow[sid]) seen.delete(sid);
  } else if (m.type === 'in') input(m.sid, m.ev); // fallback path through the main process
  else if (m.type === 'release') { try { inj.releaseAll(m.rect); } catch {} }
  else if (m.type === 'stop') { try { inj.stop(); } catch {} process.exit(0); }
});
send({ ready: true });
