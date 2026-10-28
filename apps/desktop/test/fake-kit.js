// Simulates the KUONGSHUN factory programs: "web" (HTTP /control?var=car) and "app" (TCP port 100 packets).
const http = require('http'), net = require('net');
function start(kind, apiPort, tcpPort) {
  const log = [];
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(400, 3), Buffer.from([0xff, 0xd9])]);
  const api = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"framesize":4,"quality":12}'); }
    if (u.pathname === '/') return res.end(kind === 'web' ? '<html>ESP32 car <button onclick="fetch(\'/control?var=car&val=1\')">Forward</button></html>' : '<html>ESP32 OV2640 camera stream</html>');
    if (u.pathname === '/control') { log.push(`${u.searchParams.get('var')}=${u.searchParams.get('val')}`); return res.end('OK'); }
    if (u.pathname === '/capture') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(jpeg); }
    res.writeHead(404); res.end();
  }).listen(apiPort);
  let tcp = null;
  if (kind === 'app') {
    tcp = net.createServer((s) => {
      let buf = Buffer.alloc(0);
      s.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 13) {
          const i = buf.indexOf(Buffer.from([0xff, 0x55]));
          if (i < 0) { buf = Buffer.alloc(0); break; }
          if (buf.length - i < 13) { buf = buf.subarray(i); break; }
          const pkt = buf.subarray(i, i + 13);
          log.push(`dev${pkt[10].toString(16)}=${pkt[12]}`);
          buf = buf.subarray(i + 13);
        }
      });
    }).listen(tcpPort);
  }
  return { log, close: () => { api.close(); if (tcp) tcp.close(); } };
}
module.exports = { start };
