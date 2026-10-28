// Simulates the Carpathron car firmware HTTP API (port 80 API + port 81 MJPEG stream).
const http = require('http');
function start(apiPort, streamPort, jpeg) {
  const log = [];
  let led = 0;
  const api = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    log.push(u.pathname + u.search);
    if (u.pathname === '/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ name: 'Baby Carpathron', camera: true, rssi: -50 })); }
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
