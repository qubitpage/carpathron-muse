// Speech worker (its own process, so making a sentence never pauses the app or the driving). Loads the offline neural
// voice once and answers { id, text, voice } with a WAV file in the robot voice.
'use strict';
const fs = require('fs');
const path = require('path');
const fx = require('./robotfx');

const engineDir = process.env.MC_VOICE_ENGINE;
const sherpa = require(path.join(engineDir, 'sherpa-onnx-node'));
const loaded = {};
function engine(model) {
  if (loaded[model.id]) return loaded[model.id];
  const d = model.dir;
  const files = { model: path.join(d, model.file), voices: path.join(d, 'voices.bin'), tokens: path.join(d, 'tokens.txt'), dataDir: path.join(d, 'espeak-ng-data') };
  return (loaded[model.id] = new sherpa.OfflineTts({ model: { [model.kind]: files, debug: false, numThreads: Math.max(1, Math.min(4, require('os').cpus().length - 1)), provider: 'cpu' }, maxNumSentences: model.kind === 'kitten' ? 1 : 2 }));
}
// words the voice says wrong
const FIX = [[/Carpathron/gi, 'Car-path-ron'], [/\bMuse\b/g, 'Muse'], [/\bESP32\b/gi, 'E S P 32'], [/\bcm\b/g, 'centimetres'], [/°/g, ' degrees'], [/%/g, ' percent']];
process.on('message', (m) => {
  try {
    let text = String(m.text || '').slice(0, 600);
    for (const [re, to] of FIX) text = text.replace(re, to);
    text = text.replace(/https?:\/\/\S+/g, 'a link').replace(/[*_`#>|~\[\]{}]/g, ' ').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, ' ')
      .replace(/\s*[·•]\s*/g, ', ').replace(/\s*\n+\s*/g, '. ').replace(/\s{2,}/g, ' ').trim();
    if (text && !/[.!?…]$/.test(text)) text += '.';
    const t0 = Date.now();
    const tts = engine(m.model);
    // 2.2.5: enableExternalBuffer false — inside the app (Electron) native "external" buffers are not allowed, which
    // made every installed voice fail ("External buffers are not allowed"). The samples are copied instead.
    const a = tts.generate({ text, sid: m.sid, speed: fx.speedFor(m.preset) * Math.min(1.1, m.rate || 1), enableExternalBuffer: false });
    let y = m.preset === 'plain' ? a.samples : fx.robotize(Float32Array.from(a.samples), a.sampleRate, m.preset);
    // a little silence before and after: speakers (and Bluetooth ones especially) swallow the first syllable otherwise
    const lead = Math.round(a.sampleRate * 0.22), tail = Math.round(a.sampleRate * 0.15);
    const z = new Float32Array(lead + y.length + tail); z.set(y, lead); y = z;
    fs.writeFileSync(m.out, fx.wav(y, a.sampleRate));
    process.send({ id: m.id, ok: true, file: m.out, secs: y.length / a.sampleRate, ms: Date.now() - t0 });
  } catch (e) { process.send({ id: m.id, ok: false, error: e.message }); }
});
process.send({ ready: true });
