// Run the backend without the desktop window (for testing): node backend/standalone.js
'use strict';
const path = require('path');
const { startServer } = require('./server');
startServer({ dataDir: process.env.MC_DATA || path.join(__dirname, '..', 'data'), portOverride: Number(process.env.MC_PORT) || undefined })
  .then((s) => console.log(`Open https://localhost:${s.port}/?t=${encodeURIComponent(s.token)}`))
  .catch((e) => { console.error(e); process.exit(1); });
