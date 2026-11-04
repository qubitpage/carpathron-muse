// Simulates the Carpathron car firmware HTTP API (port 80 API + port 81 MJPEG stream).
const http = require('http');
function start(apiPort, streamPort, jpeg) {
  const log = [];
  let led = 0, statusN = 0, drovesAt = 0;
  const api = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    log.push(u.pathname + u.search);
    if (u.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // FAKE_CAR_SENSORS=1 (the Quest app test): firmware 2.4 sensors; after a few readings it "bumps" into something
      const st = { name: 'Baby Carpathron', camera: true, rssi: -50 };
      if (process.env.FAKE_CAR_SENSORS) { statusN++; st.sensors = { tof: true, dist: 420, stopMm: 300, blocked: false, lean: 0.4, linkLost: false, sideEyes: false, cliffSensor: false, bumps: drovesAt && Date.now() - drovesAt > 1500 ? 1 : 0, tiltStops: 0, cliffStops: 0 }; }
      return res.end(JSON.stringify(st));
    }
    if (u.pathname === '/drive' && Number(u.searchParams.get('l')) > 0) drovesAt = drovesAt || Date.now();
    if (u.pathname === '/drive' || u.pathname === '/stop') { res.end('ok'); return; }
    if (u.pathname === '/led') { led = Number(u.searchParams.get('v')); return res.end('ok'); }
    if (u.pathname === '/capture') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(jpeg); }
    res.writeHead(404); res.end();
  }).listen(apiPort);
  const stream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace;boundary=B' });
    const t = setInterval(() => res.write(Buffer.concat([Buffer.from(`\r\n--B\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`), jpeg])), 100);
    req.on('close', () => clearInterval(t));
  }).listen(streamPort);
  return { log, led: () => led, close: () => { api.close(); stream.close(); } };
}
module.exports = { start };
