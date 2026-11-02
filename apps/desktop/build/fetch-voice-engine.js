// Fetches the offline speech engine (sherpa-onnx native addon, Apache-2.0) into build/voice-engine/node_modules for
// Windows x64 (packaged with the app as resources/voice-engine) and for this machine (tests). Runs before electron-builder.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const VERSION = '1.12.15';
const dir = path.join(__dirname, 'voice-engine', 'node_modules');
const pkgs = ['sherpa-onnx-node', 'sherpa-onnx-win-x64', `sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`];
fs.mkdirSync(dir, { recursive: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const name of [...new Set(pkgs)]) {
  const target = path.join(dir, name);
  if (fs.existsSync(path.join(target, 'package.json')) && JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).version === VERSION) continue;
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 've-'));
  const tgz = execFileSync(npm, ['pack', `${name}@${VERSION}`, '--silent'], { cwd: tmp, encoding: 'utf8' }).trim().split('\n').pop();
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-xzf', path.join(tmp, tgz), '-C', target, '--strip-components=1']);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`voice engine: ${name}@${VERSION}`);
}
