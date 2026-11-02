// Robot page → 🗣 Voice: talk to the robot (hold to talk, or hands-free) and let the robot talk back.
// Short commands ("forward two seconds", "turn left 90 degrees", "stop", "take a photo") run at once; anything else goes
// to Muse, which can drive the car and answer. The robot's voice plays on every device switched on as "the robot's
// speaker" — this PC, or a phone fixed on the car (open Muse Carpathron on it): then the phone is the robot's mouth and,
// with hands-free on, its ears.
(() => {
  'use strict';
  const ui = () => window.MCui;
  const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const st = { speaker: LS.get('mc.robotSpeaker', '1') === '1', speakReplies: LS.get('mc.speakReplies', '1') === '1', voice: LS.get('mc.robotVoice', ''), rate: Number(LS.get('mc.robotRate', '1.05')), pitch: Number(LS.get('mc.robotPitch', '1.25')), handsFree: false, busy: false, speaking: false };
  const PHRASES = ['Hello! I am Baby Carpathron.', 'Excuse me, may I pass?', 'I am going to the door.', 'Mission complete!', 'Look what I found!', 'Please follow me.'];

  // ---------------------------------------------------------------- the robot's voice (Windows / browser voices, offline)
  function pickVoice() {
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    return vs.find((v) => v.name === st.voice) || vs.find((v) => /en(-|_)(US|GB)/i.test(v.lang) && /david|mark|guy|zira|google/i.test(v.name)) || vs.find((v) => /^en/i.test(v.lang)) || vs[0] || null;
  }
  let mouthT = null;
  // The robot's own voice: a WAV made on the PC by the offline neural voice (+ the robot effect). Played one after
  // another; the mouth follows the loudness of the sound. Without the neural voice, the browser's voice is used.
  const play = { ctx: null, queue: [], busy: false };
  function say(text, by, audio, more) {
    const t = String(text || '').trim();
    if (!t) return;
    if (!more) log(by === 'you' ? '🔊 (you)' : '🔊 Robot', t); // "more" = the next sentence of a line already shown
    if (!st.speaker) return;
    if (audio) { play.queue.push(audio); playNext(); return; }
    browserSay(t);
  }
  async function playNext() {
    if (play.busy || !play.queue.length) return;
    play.busy = true;
    const url = play.queue.shift();
    try {
      play.ctx = play.ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (play.ctx.state === 'suspended') await play.ctx.resume().catch(() => {});
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await play.ctx.decodeAudioData(await res.arrayBuffer());
      const src = play.ctx.createBufferSource(), an = play.ctx.createAnalyser();
      an.fftSize = 512; src.buffer = buf; src.connect(an); an.connect(play.ctx.destination);
      const data = new Uint8Array(an.fftSize);
      mouth(true, true);
      let raf = 0;
      const tick = () => {
        an.getByteTimeDomainData(data); let m = 0; for (const v of data) m = Math.max(m, Math.abs(v - 128));
        const open = Math.min(1, m / 70);
        document.querySelectorAll('.robot-face .mouth').forEach((el) => { el.style.height = `${3 + Math.round(open * 13)}px`; });
        raf = requestAnimationFrame(tick);
      };
      tick();
      await new Promise((r) => { src.onended = r; src.start(); });
      cancelAnimationFrame(raf);
      document.querySelectorAll('.robot-face .mouth').forEach((el) => { el.style.height = ''; });
    } catch (e) { console.warn('robot voice', e); }
    mouth(false); play.busy = false; playNext();
  }
  function browserSay(t) {
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(t);
    const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = st.rate; u.pitch = st.pitch;
    u.onstart = () => mouth(true); u.onend = () => mouth(false); u.onerror = () => mouth(false);
    u.onboundary = () => { const m = document.querySelector('.robot-face .mouth'); if (m) { m.classList.remove('pulse'); void m.offsetWidth; m.classList.add('pulse'); } };
    speechSynthesis.speak(u);
  }
  function mouth(on, live) {
    st.speaking = on;
    document.querySelectorAll('.robot-face').forEach((f) => { f.classList.toggle('talking', on && !live); f.classList.toggle('live', on && !!live); });
    clearTimeout(mouthT); if (on) mouthT = setTimeout(() => mouth(false), 20000);
  }

  // ---------------------------------------------------------------- listening: 16 kHz WAV straight from the mic
  const mic = { ctx: null, src: null, proc: null, stream: null, buf: [], rec: false, voiced: 0, silent: 0, level: 0, pre: [] };
  async function micOpen() {
    if (mic.ctx) return;
    mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    mic.ctx = new (window.AudioContext || window.webkitAudioContext)();
    mic.src = mic.ctx.createMediaStreamSource(mic.stream);
    mic.proc = mic.ctx.createScriptProcessor(2048, 1, 1);
    mic.src.connect(mic.proc); mic.proc.connect(mic.ctx.destination);
    mic.proc.onaudioprocess = (e) => {
      const x = e.inputBuffer.getChannelData(0);
      let sum = 0; for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
      const rms = Math.sqrt(sum / x.length);
      mic.level = rms;
      meter(rms);
      const chunk = new Float32Array(x);
      if (st.handsFree && !st.speaking && !st.busy) {
        // voice activity: start above the threshold (with 0.25 s before it), end after 0.7 s of quiet, at most 7 s
        const loud = rms > 0.025;
        if (!mic.rec) { mic.pre.push(chunk); if (mic.pre.length > 3) mic.pre.shift(); if (loud) { mic.rec = true; mic.buf = [...mic.pre]; mic.voiced = 0; mic.silent = 0; } }
        if (mic.rec) {
          mic.buf.push(chunk);
          if (loud) { mic.voiced += x.length; mic.silent = 0; } else mic.silent += x.length;
          const sr = mic.ctx.sampleRate;
          if (mic.silent > 0.7 * sr || mic.buf.length * x.length > 7 * sr) { const b = mic.buf; mic.rec = false; mic.buf = []; if (mic.voiced > 0.25 * sr) send(b); }
        }
      } else if (mic.rec && !st.handsFree) mic.buf.push(chunk);
    };
  }
  function micClose() {
    if (!mic.ctx) return;
    try { mic.proc.disconnect(); mic.src.disconnect(); mic.stream.getTracks().forEach((t) => t.stop()); mic.ctx.close(); } catch {}
    mic.ctx = null; mic.rec = false; meter(0);
  }
  function wav(chunks, rate) {
    const total = chunks.reduce((n, c) => n + c.length, 0), ratio = rate / 16000, n = Math.floor(total / ratio);
    const all = new Float32Array(total); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let k = Math.floor(i * ratio); k < Math.floor((i + 1) * ratio) && k < total; k++) { s += all[k]; c++; } v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, c ? s / c : 0)) * 32767, true); }
    return new Blob([buf], { type: 'audio/wav' });
  }
  async function send(chunks) {
    if (!mic.ctx) return;
    st.busy = true; status('⏳ Listening done — understanding…');
    try {
      const res = await fetch(`/api/robot/voice${st.speakReplies ? '?speak=1' : ''}`, { method: 'POST', body: wav(chunks, mic.ctx.sampleRate), headers: { 'Content-Type': 'audio/wav' }, credentials: 'same-origin' });
      const r = await res.json();
      if (r.error) { status(`✕ ${r.error}`); return; }
      if (!r.heard) { status('Did not hear any words.'); return; }
      log('🎤 You', r.heard + (r.command ? `  →  ${r.command}` : '  →  Muse'));
      if (!st.speakReplies) (r.replies || []).forEach((t) => log('🤖 Muse', t));
      status(st.handsFree ? '🎧 Listening…' : 'Hold the button and speak.');
    } catch (e) { status(`✕ ${e.message}`); } finally { st.busy = false; }
  }

  // ---------------------------------------------------------------- the card
  let els = null, onDownloadUi = null;
  const status = (t) => { if (els) els.status.textContent = t; };
  const meter = (rms) => { if (els) els.meter.style.width = `${Math.min(100, Math.round(rms * 900))}%`; };
  function log(who, text) {
    if (!els) return;
    els.log.prepend(ui().h('div', { class: 'vlog' }, ui().h('b', {}, who), ' ', text));
    while (els.log.children.length > 12) els.log.lastChild.remove();
  }
  function render() {
    const card = document.getElementById('voiceCard');
    if (!card || !window.MCui) return;
    const { h, api, toast } = ui();
    card.innerHTML = '';
    const face = h('div', { class: 'robot-face', 'aria-hidden': 'true' }, h('span', { class: 'eye' }), h('span', { class: 'eye' }), h('span', { class: 'mouth' }));
    const statusEl = h('div', { class: 'small muted' }, 'Hold the button and speak, or switch on hands-free.');
    const meterEl = h('div', { class: 'vmeter' }, h('div', {}));
    const talk = h('button', { class: 'btn primary talk', 'aria-label': 'Hold to talk' }, '🎤 Hold to talk');
    talk.addEventListener('pointerdown', async (e) => {
      talk.setPointerCapture(e.pointerId);
      try { await micOpen(); } catch (err) { toast(`Microphone: ${err.message}`, true); return; }
      mic.buf = []; mic.rec = true; talk.classList.add('on'); status('🎙 Speak now…');
    });
    const up = () => { if (!mic.rec || st.handsFree) return; mic.rec = false; talk.classList.remove('on'); const b = mic.buf; mic.buf = []; if (b.length > 4) send(b); else status('Too short — hold the button while you speak.'); if (!st.handsFree) setTimeout(micClose, 200); };
    talk.addEventListener('pointerup', up); talk.addEventListener('pointercancel', up);
    const hf = h('input', { type: 'checkbox', onchange: async (e) => {
      st.handsFree = e.target.checked;
      if (st.handsFree) { try { await micOpen(); status('🎧 Listening… say "forward", "turn left", "stop" or ask anything.'); } catch (err) { e.target.checked = st.handsFree = false; toast(`Microphone: ${err.message}`, true); } }
      else { micClose(); status('Hands-free off.'); }
    } });
    const spk = h('input', { type: 'checkbox', checked: st.speaker ? '' : null, onchange: (e) => { st.speaker = e.target.checked; LS.set('mc.robotSpeaker', st.speaker ? '1' : '0'); } });
    const rep = h('input', { type: 'checkbox', checked: st.speakReplies ? '' : null, onchange: (e) => { st.speakReplies = e.target.checked; LS.set('mc.speakReplies', st.speakReplies ? '1' : '0'); } });
    const sayIn = h('input', { placeholder: 'Type what the robot should say…', maxlength: 400 });
    const sayIt = async () => { const t = sayIn.value.trim(); if (!t) return; const r = await api('/api/robot/say', { body: { text: t } }).catch((e) => ({ error: e.message })); if (r.error) toast(r.error, true); else sayIn.value = ''; };
    sayIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sayIt(); } });
    // --- choose the robot's voice
    const voiceBox = h('div', { class: 'voicebox' });
    const browserRow = (() => {
      const voiceSel = h('select', { 'aria-label': 'Browser voice', onchange: (e) => { st.voice = e.target.value; LS.set('mc.robotVoice', st.voice); } });
      const fillVoices = () => { const vs = window.speechSynthesis ? speechSynthesis.getVoices() : []; voiceSel.innerHTML = ''; const cur = pickVoice(); for (const v of vs) voiceSel.append(h('option', { value: v.name, selected: cur && cur.name === v.name ? '' : null }, `${v.name} (${v.lang})`)); if (!vs.length) voiceSel.append(h('option', { value: '' }, 'default voice')); };
      fillVoices(); if (window.speechSynthesis) speechSynthesis.onvoiceschanged = fillVoices;
      const slider = (label, key, lo, hi, step) => h('label', { class: 'inline small' }, label, ' ', h('input', { type: 'range', min: lo, max: hi, step, value: st[key], oninput: (e) => { st[key] = Number(e.target.value); LS.set(key === 'rate' ? 'mc.robotRate' : 'mc.robotPitch', String(st[key])); } }));
      return h('details', { class: 'small' }, h('summary', {}, 'Backup voice (used only while the robot voice is not downloaded)'),
        h('div', { class: 'row small' }, voiceSel, slider('Speed', 'rate', 0.6, 1.6, 0.05), slider('Pitch', 'pitch', 0.5, 2, 0.05), h('button', { class: 'btn tiny', onclick: () => browserSay('Hello! This is my backup voice.') }, '▶ Test')));
    })();
    const fillVoiceBox = async () => {
      const s = await api('/api/robot/voice/status').catch(() => null);
      voiceBox.innerHTML = '';
      if (!s) return;
      if (!s.engine) { voiceBox.append(h('p', { class: 'small muted' }, 'The robot voice engine is not part of this installation — the backup voice is used.')); return; }
      const need = s.voices.find((v) => v.id === s.voice) || s.voices[0];
      const ready = s.voices.filter((v) => v.ready);
      voiceBox.append(h('p', { class: 'small muted' }, 'The robot speaks with an offline voice made on this PC (no internet needed once downloaded), with a small-robot sound effect. Pick the one you like and press ▶ to hear it.'));
      for (const [id, m] of Object.entries(s.models)) {
        if (m.installed) continue;
        const bar = h('div', { class: 'vmeter' }, h('div', { style: `width:${m.downloading ? m.downloading.pct : 0}%` }));
        const btn = h('button', { class: 'btn' + (id === need.model ? ' primary' : ''), disabled: m.downloading ? '' : null, onclick: async () => { btn.disabled = true; btn.textContent = 'Downloading…'; const r = await api('/api/robot/voice/download', { body: { model: id } }).catch((e) => ({ error: e.message })); if (r.error) { toast(r.error, true); btn.disabled = false; } } }, m.downloading ? 'Downloading…' : `⬇ Download ${m.label}`);
        voiceBox.append(h('div', { class: 'row small', 'data-model': id }, btn, bar));
      }
      const list = h('div', { class: 'voice-list' });
      for (const v of s.voices) {
        const row = h('label', { class: 'voice-opt' + (v.ready ? '' : ' off') },
          h('input', { type: 'radio', name: 'robotVoice', value: v.id, checked: v.id === s.voice ? '' : null, disabled: v.ready ? null : '', onchange: async () => { const r = await api('/api/robot/voice/choose', { body: { voice: v.id } }).catch((e) => ({ error: e.message })); if (r.error) toast(r.error, true); else toast(`Robot voice: ${v.label}`); } }),
          h('span', { class: 'grow' }, v.label, v.ready ? '' : h('span', { class: 'muted' }, ' — download first')),
          h('button', { class: 'btn tiny', disabled: v.ready ? null : '', title: 'Hear this voice', onclick: async (e) => { e.preventDefault(); const b = e.currentTarget; b.textContent = '…'; const r = await api('/api/robot/voice/sample', { body: { voice: v.id } }).catch((er) => ({ error: er.message })); b.textContent = '▶'; if (r.error) toast(r.error, true); else { play.queue.push(r.audio); playNext(); } } }, '▶'));
        list.append(row);
      }
      voiceBox.append(list);
      if (!ready.length) voiceBox.append(h('p', { class: 'small muted' }, 'Until a voice is downloaded, the robot uses the backup voice below.'));
    };
    fillVoiceBox();
    onDownloadUi = (d) => {
      const row = voiceBox.querySelector(`[data-model="${d.model}"]`);
      if (d.error) { toast(`Voice download: ${d.error}`, true); fillVoiceBox(); return; }
      if (d.done) { toast('Robot voice installed — it speaks with it now.'); fillVoiceBox(); return; }
      if (row) { const bar = row.querySelector('.vmeter > div'); if (bar) bar.style.width = `${d.pct}%`; const b = row.querySelector('button'); if (b) { b.disabled = true; b.textContent = d.pct >= 100 ? 'Unpacking…' : `Downloading… ${d.pct}%`; } }
    };
    const logEl = h('div', { class: 'vlogs' });
    card.append(h('h3', {}, '🗣 Voice'),
      h('div', { class: 'voice-top' }, face, h('div', { class: 'grow' },
        h('p', { class: 'small muted' }, 'Talk to the robot. Short commands run at once — "forward two seconds", "back", "turn right 90 degrees", "look left", "take a photo", "stop" — anything else goes to Muse, which drives and answers. Space or STOP always stops at once.'),
        h('div', { class: 'row' }, talk, h('label', { class: 'toggle small' }, hf, h('span', {}, 'Hands-free'))), meterEl, statusEl)),
      h('h4', {}, '🔊 The robot\'s voice'),
      h('div', { class: 'row' }, sayIn, h('button', { class: 'btn', onclick: sayIt }, 'Say')),
      h('div', { class: 'chips' }, ...PHRASES.map((p) => h('button', { class: 'chip', onclick: () => api('/api/robot/say', { body: { text: p } }) }, p))),
      voiceBox, browserRow,
      h('label', { class: 'toggle small' }, spk, h('span', {}, 'This device is the robot\'s speaker (on a phone fixed on the car, the phone is the robot\'s mouth; with hands-free, also its ears)')),
      h('label', { class: 'toggle small' }, rep, h('span', {}, 'Speak Muse\'s answers to voice commands')),
      logEl);
    els = { status: statusEl, meter: meterEl.firstChild, log: logEl };
  }
  window.MCvoice = { say, render, onDownload: (d) => onDownloadUi && onDownloadUi(d) };
  const tryRender = () => { if (window.MCui && document.getElementById('voiceCard')) render(); else setTimeout(tryRender, 300); };
  tryRender();
})();
