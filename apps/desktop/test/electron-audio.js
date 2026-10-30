// Electron test: MP3 / M4A / WebM audio is decoded by the built-in Chromium and converted to WAV for transcription.
'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
app.on('window-all-closed', () => {}); // the decoder uses short-lived hidden windows
app.whenReady().then(async () => {
  const voice = require('../backend/voice');
  const dir = process.argv[process.argv.length - 1];
  let fails = 0;
  for (const f of ['tone.mp3', 'tone.m4a', 'tone.webm']) {
    try {
      const { wav, seconds } = await voice.anyToWav(fs.readFileSync(path.join(dir, f)), '');
      const ok = wav.toString('ascii', 0, 4) === 'RIFF' && seconds > 1.8 && seconds < 2.3;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${f} -> WAV ${seconds.toFixed(2)} s, ${wav.length} bytes`);
      if (!ok) fails++;
    } catch (e) { console.log(`FAIL ${f}: ${e.message}`); fails++; }
  }
  app.exit(fails ? 1 : 0);
});
