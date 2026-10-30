// Writes AppxManifest.xml from electron-builder's template and package.json "build.appx" (same values electron-builder uses).
'use strict';
const fs = require('fs'), path = require('path');
const pkg = require('../package.json');
const o = pkg.build.appx;
const assets = fs.readdirSync(path.join(__dirname, 'appx'));
const has = (n) => assets.some((a) => a.includes(n.replace(/\.png$/, '')));
const tile = ['<uap:DefaultTile', 'Wide310x150Logo="assets\\Wide310x150Logo.png"'];
if (has('LargeTile.png')) tile.push('Square310x310Logo="assets\\LargeTile.png"');
if (has('SmallTile.png')) tile.push('Square71x71Logo="assets\\SmallTile.png"');
if (o.showNameOnTiles) tile.push('>', '<uap:ShowNameOnTiles>', '<uap:ShowOn', 'Tile="wide310x150Logo"', '/>', '<uap:ShowOn', 'Tile="square150x150Logo"', '/>', '</uap:ShowNameOnTiles>', '</uap:DefaultTile>');
else tile.push('/>');
const v = pkg.version.split('.').map(Number);
const xmlText = (s) => String(s).replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;').replace(/</g, '&lt;');
const vals = {
  identityName: o.identityName, arch: 'x64', publisher: o.publisher, version: `${v[0]}.${v[1]}.${v[2]}.0`,
  displayName: xmlText(o.displayName), publisherDisplayName: xmlText(o.publisherDisplayName), description: xmlText(pkg.description),
  logo: 'assets\\StoreLogo.png', resourceLanguages: (o.languages || ['en-US']).map((l) => `<Resource Language="${l}" />`).join('\n'),
  minVersion: o.minVersion, maxVersionTested: o.maxVersionTested, applicationId: o.applicationId,
  executable: `app\\${pkg.build.win.executableName || pkg.build.productName}.exe`, backgroundColor: o.backgroundColor,
  square150x150Logo: 'assets\\Square150x150Logo.png', square44x44Logo: 'assets\\Square44x44Logo.png',
  lockScreen: '', defaultTile: tile.join(' '), splashScreen: has('SplashScreen.png') ? '<uap:SplashScreen Image="assets\\SplashScreen.png" />' : '', extensions: '',
};
const tpl = fs.readFileSync(require.resolve('app-builder-lib/templates/appx/appxmanifest.xml'), 'utf8');
const out = tpl.replace(/\${([a-zA-Z0-9]+)}/g, (m, k) => { if (!(k in vals)) throw new Error(`no value for ${k}`); return vals[k]; });
fs.writeFileSync(process.argv[2], out);
console.log(out);
