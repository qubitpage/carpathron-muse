// The @muse-code/sdk facade does not forward session "config" yet. We need it to give Muse Code sessions
// the app's own tools (MCP bridge). Run after npm install (postinstall) and before packaging.
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'node_modules', '@muse-code', 'sdk', 'dist', 'src', 'facade', 'client.js');
let src = fs.readFileSync(file, 'utf8');
if (src.includes('params.config = options.config')) { console.log('sdk already patched'); process.exit(0); }
const start = src.indexOf('async startSession(options = {})');
const anchor = 'if (options.recoveryMode != null)\n            params.recoveryMode = options.recoveryMode;';
const at = src.indexOf(anchor, start);
if (start < 0 || at < 0) { console.error('patch-sdk: anchor not found — @muse-code/sdk changed; update build/patch-sdk.js'); process.exit(1); }
src = src.slice(0, at + anchor.length) + '\n        if (options.config != null)\n            params.config = options.config;' + src.slice(at + anchor.length);
fs.writeFileSync(file, src);
console.log('patched @muse-code/sdk startSession to forward config');
