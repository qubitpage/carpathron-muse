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
    const t0 = Date.now();
    const tts = engine(m.model);
    const a = tts.generate({ text, sid: m.sid, speed: fx.speedFor(m.preset) * (m.rate || 1) });
    const y = m.preset === 'plain' ? a.samples : fx.robotize(a.samples, a.sampleRate, m.preset);
    fs.writeFileSync(m.out, fx.wav(y, a.sampleRate));
    process.send({ id: m.id, ok: true, file: m.out, secs: y.length / a.sampleRate, ms: Date.now() - t0 });
  } catch (e) { process.send({ id: m.id, ok: false, error: e.message }); }
});
process.send({ ready: true });
