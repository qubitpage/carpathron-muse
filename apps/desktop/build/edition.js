#!/usr/bin/env node
// One code base, two editions of the Windows app:
//   store  "Carpathron Robotics & Coding"  Microsoft Store (MSIX) + installer, update channel "store"   (this source as is)
//   muse   "Muse Carpathron"               hackathon / open-source edition, installer only, update channel "muse"
// Usage: node build/edition.js muse <folder>   rewrites a COPY of this source in <folder> (package.json, names, guide).
// Every new feature is made once here and reaches both editions.
'use strict';
const fs = require('fs');
const path = require('path');

const [edition, dir] = process.argv.slice(2);
if (edition !== 'muse' || !dir) { console.error('usage: node build/edition.js muse <copy-of-the-source>'); process.exit(2); }
const root = path.resolve(dir);
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const write = (f, s) => fs.writeFileSync(path.join(root, f), s);

// ---- package.json
const pkg = JSON.parse(read('package.json'));
pkg.name = 'muse-carpathron';
pkg.productName = 'Muse Carpathron';
pkg.description = 'Muse Carpathron: an AI agent for Windows powered by Meta Muse models (open-source hackathon edition). Coding, servers, GitHub, MCP, computer use and robot control.';
for (const k of ['dist:store', 'dist:msix']) delete pkg.scripts[k];
delete pkg.build.appx;
Object.assign(pkg.build.nsis, { shortcutName: 'Muse Carpathron', uninstallDisplayName: 'Muse Carpathron', artifactName: 'Muse-Carpathron-Setup-${version}.exe' });
pkg.build.publish = [{ provider: 'generic', url: 'https://qubitpage.com/downloads/carpathron', channel: 'muse' }];
pkg.homepage = 'https://github.com/qubitpage/carpathron-muse';
pkg.repository = { type: 'git', url: 'https://github.com/qubitpage/carpathron-muse' };
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

// ---- guide: install / update section of the installer edition
const GUIDE = [
  [/> \*\*New name \(1\.7\.0\):\*\*[^\n]*\n>[^\n]*\n/, '> **Muse Carpathron** is the open-source edition of this app (Meta AI hackathon). The same app is on the Microsoft\n> Store as *@@STORE_NAME@@*. It is made by **Qubitpage LIMITED** (qubitpage.com).\n'],
  [/1\. \*\*Install the app\*\* from the \*\*Microsoft Store\*\*[^\n]*\n/, '1. **Install the app**: download **Muse-Carpathron-Setup-<version>.exe** from <https://github.com/qubitpage/carpathron-muse/releases/latest> and double-click it (section 2).\n'],
  [/1\. Open the \*\*Microsoft Store\*\*, search[^\n]*\n[^\n]*\n/, '1. Download **Muse-Carpathron-Setup-<version>.exe** from <https://github.com/qubitpage/carpathron-muse/releases/latest> and\n   double-click it. If SmartScreen appears: *More info → Run anyway*.\n'],
  [/\*\*Update:\*\* the Microsoft Store updates the app automatically\./, '**Update:** the app updates itself. It checks **qubitpage.com** for new versions, downloads them in the background and\ninstalls them when you restart it (a banner shows *Restart and update*), or the next time you close it. You can switch\nthis off or check by hand in *Settings → Updates*.'],
  [/the app's private folder, managed by Windows \(`[^`]*`\)/, '`%APPDATA%\\Muse Carpathron\\data`'],
  [/Windows removes the app's private data with it; your workspace folder/, 'Your chats and settings (`%APPDATA%\\Muse Carpathron`) and your workspace folder'],
];
let guide = read('public/guide.md');
for (const [re, to] of GUIDE) {
  if (!re.test(guide)) { console.error(`guide: pattern not found: ${re}`); process.exit(1); }
  guide = guide.replace(re, to);
}
write('public/guide.md', guide);

// ---- the name everywhere else (UI, messages, window title, installer metadata, tests)
const NAMES = [
  ['<b>Carpathron</b><span>Robotics &amp; Coding · Meta Muse</span>', '<b>Muse Carpathron</b><span>AI agent · robots · Meta Muse</span>'],
  ['Pair with Carpathron Robotics/', 'Pair with Muse Carpathron/'],
  ['Carpathron Robotics &amp; Coding', 'Muse Carpathron'],
  ['Carpathron Robotics & Coding', 'Muse Carpathron'],
  ['Carpathron Robotics and Coding', 'Muse Carpathron'],
  ['Muse Carpathron (formerly Muse Carpathron)', 'Muse Carpathron'],
];
const SKIP = new Set(['node_modules', 'dist', '.git']);
let files = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(js|html|css|md|json|nsh)$/.test(e.name) || e.name === 'package-lock.json' || e.name === 'edition.js') continue;
    const s = fs.readFileSync(p, 'utf8');
    let t = s;
    for (const [a, b] of NAMES) t = t.split(a).join(b);
    if (t !== s) { fs.writeFileSync(p, t); files++; }
  }
})(root);
write('public/guide.md', read('public/guide.md').split('@@STORE_NAME@@').join('Carpathron Robotics & Coding').replace('(`%USERPROFILE%\\MuseCarpathron`) stays.', '(`%USERPROFILE%\\MuseCarpathron`) stay.'));
console.log(`Muse Carpathron edition: ${files} files renamed, package ${pkg.name} ${pkg.version}`);
