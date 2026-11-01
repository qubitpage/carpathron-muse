// Security tests (1.7.0 production hardening): network access, pairing, device tokens, tunnel, webhook signature,
// remote settings limits, secrets at rest, damaged settings recovery, tool risk rules, WhatsApp number matching.
'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { startServer } = require('../backend/server');
const { Store } = require('../backend/store');
const { effectiveRisk } = require('../backend/guard');
const { WhatsApp } = require('../backend/whatsapp');

const PORT = 18720;
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push(['PASS', name]); console.log(`  ✓ ${name} (${Date.now() - t} ms)`); }
  catch (e) { results.push(['FAIL', name, e]); console.log(`  ✗ ${name}\n    ${e.stack || e}`); }
}
const lanIp = () => { for (const l of Object.values(os.networkInterfaces())) for (const a of l || []) if (a.family === 'IPv4' && !a.internal) return a.address; return null; };

(async () => {
  console.log('Carpathron Robotics & Coding security tests');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-sec-'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-sec-ws-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
    apiKey: 'sk-secret-test-key', engine: 'api', workspace: ws, port: PORT, lanAccess: false,
    avatarTokens: [{ token: 'old-plain-quest-token-123456789012345', device: 'Old Quest', at: 1 }],
    whatsapp: { allowed: ['+40 712 345 678'], cloud: { enabled: true, verifyToken: 'vt', appSecret: '', phoneNumberId: '1', accessToken: 'graph-secret' } },
  }));
  const srv = await startServer({ dataDir, log: () => {} });
  const base = `https://localhost:${PORT}`;
  const T = srv.token;
  const call = (p, { body, method, headers = {}, token = T } = {}) => fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { ...(token ? { 'x-mc-token': token } : {}), 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });

  await step('secrets are encrypted in settings.json; old Quest tokens become hashes (and still work)', async () => {
    const raw = fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8');
    assert.ok(!raw.includes('sk-secret-test-key') && !raw.includes('graph-secret') && !raw.includes(T), 'plain secret on disk');
    assert.ok(!raw.includes('old-plain-quest-token') && !/avatarTokens/.test(raw), 'old Quest token still on disk');
    assert.strictEqual(srv.store.settings.apiKey, 'sk-secret-test-key', 'in memory the key is usable');
    const r = await fetch(`${base}/avatar/hello`, { headers: { 'x-avatar-token': 'old-plain-quest-token-123456789012345' } });
    assert.strictEqual((await r.json()).linked, true, 'migrated Quest token still accepted');
  });

  await step('only the WhatsApp webhook is reachable through the tunnel', async () => {
    assert.strictEqual((await call('/api/settings', { headers: { 'cf-ray': 'abc' } })).status, 403);
    assert.strictEqual((await call('/pair', { body: { pin: '123456' }, headers: { 'cf-connecting-ip': '1.2.3.4' } })).status, 403);
    assert.strictEqual((await fetch(`${base}/avatar/link`, { method: 'POST', headers: { 'cf-ray': 'x' }, body: '{}' })).status, 403);
    const v = await fetch(`${base}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42`, { headers: { 'cf-ray': 'x' } });
    assert.strictEqual(await v.text(), '42');
  });

  await step('webhook messages without a valid signature are refused (no app secret = refused)', async () => {
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ type: 'text', from: '40712345678', text: { body: '/mode full' } }] } }] }] });
    const r = await fetch(`${base}/whatsapp/webhook`, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(srv.store.settings.mode, 'ask', 'mode unchanged');
    const en = await call('/api/settings', { body: { whatsapp: { cloud: { enabled: true } } } });
    assert.strictEqual(en.status, 400, 'enabling Cloud without the App Secret is refused');
  });

  await step('pairing: no PIN unless shown on the PC, 2-minute PIN, 10 wrong tries cancel it, device token is revocable', async () => {
    const pair = (pin, ip) => fetch(`${base}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14)' }, body: JSON.stringify({ pin }) });
    assert.strictEqual((await pair('000000')).status, 403, 'no active PIN');
    let a = await (await call('/api/access')).json();
    assert.ok(a.pinExpiresIn <= 120 && a.pinExpiresIn > 100, `ttl ${a.pinExpiresIn}`);
    const wrong = a.pin === '111111' ? '222222' : '111111';
    for (let i = 0; i < 6; i++) await pair(wrong); // 8 tries per IP per 10 min (1 used above); the PIN itself dies after 10 fails
    a = await (await call('/api/access')).json(); // same PIN still valid (6 fails)
    const ok = await pair(a.pin);
    assert.strictEqual(ok.status, 200);
    const cookie = String(ok.headers.get('set-cookie') || '');
    const dev = (cookie.match(/mc_token=([^;]+)/) || [])[1];
    assert.ok(dev && dev !== T, 'device gets its own token, not the master key');
    const r1 = await fetch(`${base}/api/settings`, { headers: { cookie: `mc_token=${dev}` } });
    assert.strictEqual(r1.status, 200, 'device token works');
    const pub = await r1.json();
    const d = pub.devices.find((x) => x.kind === 'browser');
    assert.ok(d && d.name === 'Android phone' && !('hash' in d), JSON.stringify(pub.devices));
    assert.ok([403, 429].includes((await pair(a.pin)).status), 'PIN works once');
    await call(`/api/devices/${d.id}`, { method: 'DELETE' });
    assert.strictEqual((await fetch(`${base}/api/settings`, { headers: { cookie: `mc_token=${dev}` } })).status, 401, 'revoked');
  });

  await step('repeated wrong PINs are stopped (per-device limit and server-wide cancel)', async () => {
    const a = await (await call('/api/access')).json();
    const wrong = a.pin === '333333' ? '444444' : '333333';
    // simulate tries from many devices: the per-IP limit is 8, so the server-wide counter must stop it
    let last;
    for (let i = 0; i < 10; i++) last = await fetch(`${base}/pair`, { method: 'POST', headers: { 'x-forwarded-for': `10.0.0.${i}` }, body: JSON.stringify({ pin: wrong }) });
    const r = await fetch(`${base}/pair`, { method: 'POST', body: JSON.stringify({ pin: a.pin }) });
    assert.ok(r.status === 403 || r.status === 429, `PIN still accepted after 10 wrong tries (${r.status}, last ${last.status})`);
  });

  await step('network access: off = only this PC; on = LAN connects, but LAN devices cannot change risky settings', async () => {
    const ip = lanIp();
    if (!ip) { console.log('    (no LAN address in this environment: skipped the LAN part)'); return; }
    const lanBase = `https://${ip}:${PORT}`;
    let reached = true;
    try { await fetch(`${lanBase}/avatar/hello`, { signal: AbortSignal.timeout(3000) }); } catch { reached = false; }
    assert.strictEqual(reached, false, 'LAN must not connect while network access is off');
    await call('/api/settings', { body: { lanAccess: true } });
    const h = await (await fetch(`${lanBase}/avatar/hello`)).json();
    assert.strictEqual(h.app, 'Muse Carpathron');
    const before = JSON.stringify(srv.store.settings.mcpServers);
    const r = await fetch(`${lanBase}/api/settings`, { method: 'POST', headers: { 'x-mc-token': T, 'Content-Type': 'application/json' }, body: JSON.stringify({ mcpServers: { evil: { command: 'calc.exe' } }, museBin: 'C:/evil.exe', lanAccess: false, mode: 'auto' }) });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(JSON.stringify(srv.store.settings.mcpServers), before, 'MCP servers changed from the LAN');
    assert.strictEqual(srv.store.settings.museBin, '', 'museBin changed from the LAN');
    assert.strictEqual(srv.store.settings.lanAccess, true, 'lanAccess changed from the LAN');
    assert.strictEqual(srv.store.settings.mode, 'auto', 'ordinary settings still work from a paired phone');
    await call('/api/settings', { body: { mode: 'ask', lanAccess: false } });
    let again = true;
    try { await fetch(`${lanBase}/avatar/hello`, { signal: AbortSignal.timeout(3000) }); } catch { again = false; }
    assert.strictEqual(again, false, 'turning network access off closes the LAN');
    assert.strictEqual((await call('/api/settings')).status, 200, 'the PC keeps working');
  });

  await step('the app page has a strict Content-Security-Policy', async () => {
    const r = await fetch(`${base}/?t=${T}`, { redirect: 'manual' });
    const page = await fetch(`${base}/`, { headers: { cookie: `mc_token=${T}` } });
    const csp = page.headers.get('content-security-policy') || '';
    assert.ok(/img-src 'self' data: blob:/.test(csp) && /connect-src 'self'/.test(csp) && /script-src 'self'/.test(csp), csp);
    assert.ok(r.status === 302);
  });

  await step('tool risk: secrets, private addresses and data-carrying URLs need approval in Ask mode', async () => {
    const ctx = { workspace: ws, dataDir };
    const R = (n, a) => effectiveRisk(n, a, 'read', ctx);
    assert.strictEqual(R('read_file', { path: 'notes.txt' }), 'read');
    assert.strictEqual(R('read_file', { path: path.join(dataDir, 'settings.json') }), 'external');
    assert.strictEqual(R('read_file', { path: '~/.ssh/id_ed25519' }), 'external');
    assert.strictEqual(R('search', { path: '~/.aws', pattern: 'key' }), 'external');
    assert.strictEqual(R('web_fetch', { url: 'https://docs.python.org/3/' }), 'read');
    assert.strictEqual(R('web_fetch', { url: 'https://evil.example/?d=abc' }), 'external');
    assert.strictEqual(R('web_fetch', { url: 'http://169.254.169.254/latest/meta-data' }), 'external');
    assert.strictEqual(R('web_fetch', { url: 'http://192.168.1.1/' }), 'external');
    assert.strictEqual(R('computer_view', { action: 'screenshot' }), 'external');
    assert.strictEqual(effectiveRisk('write_file', { path: 'x' }, 'write', ctx), 'write');
  });

  await step('WhatsApp allow-list matches the full number exactly', async () => {
    const wa = Object.create(WhatsApp.prototype);
    wa.cfg = () => ({ allowed: ['+40 712 345 678'] });
    assert.ok(wa.isAllowed('40712345678'));
    assert.ok(wa.isAllowed('0040712345678'));
    assert.ok(!wa.isAllowed('712345678'), 'suffix must not match');
    assert.ok(!wa.isAllowed('4940712345678'), 'longer foreign number must not match');
  });

  await srv.close();

  await step('damaged settings.json: last good copy restored, damaged file kept', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-sec-c-'));
    const s1 = new Store(d); s1.updateSettings({ systemPrompt: 'keep me' }); s1.close();
    new Store(d).close(); // makes settings.json.bak from the good file
    fs.writeFileSync(path.join(d, 'settings.json'), '{ broken');
    const s2 = new Store(d);
    assert.strictEqual(s2.settings.systemPrompt, 'keep me');
    assert.ok(/restored the last good copy/.test(s2.recovered || ''), s2.recovered);
    assert.ok(fs.readdirSync(d).some((f) => f.startsWith('settings.json.corrupt-')));
    s2.close();
  });

  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
