// Carpathron Supervisor: independent read-only verification after a job that changed something.
'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const { WebSocket } = require('ws');
const fake = require('./fake-meta');
const { startServer } = require('../backend/server');
const SUP = require('../backend/supervisor');
const PORT = 18660;
const results = [];
async function step(name, fn) { const t = Date.now(); try { await fn(); results.push(['PASS', name]); console.log(`  ✓ ${name} (${Date.now() - t} ms)`); } catch (e) { results.push(['FAIL', name, e]); console.log(`  ✗ ${name}\n    ${e.stack || e}`); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await fake.start(18661);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsup-')); const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsup-ws-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ apiKey: 'test-key', apiBase: 'http://127.0.0.1:18661/v1', engine: 'api', workspace: ws, port: PORT, mode: 'auto' }));
  const srv = await startServer({ dataDir, log: () => {} });
  const T = srv.token; const base = `https://localhost:${PORT}`;
  const api = async (p, body, method) => { const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'x-mc-token': T, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => null); if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j)}`); return j; };
  const events = []; const sock = new WebSocket(`wss://localhost:${PORT}/ws?t=${T}`, { rejectUnauthorized: false });
  sock.on('message', (m) => events.push(JSON.parse(m))); await new Promise((r) => sock.on('open', r));
  const waitFor = async (pred, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const e = events.find(pred); if (e) return e; await sleep(30); } throw new Error('timeout waiting for event'); };
  const waitIdle = async (id, ms = 30000) => waitFor((e) => e.event === 'turn:state' && e.data.convId === id && e.data.running === false && !e.data._seen && (e.data._seen = true), ms);
  const sendMsg = async (c, text) => { await api(`/api/convs/${c.id}/send`, { text }); await waitIdle(c.id); return api(`/api/convs/${c.id}`); };
  console.log('Carpathron Supervisor tests');

  await step('read-only filter: inspection commands pass, anything that changes the system is refused', async () => {
    for (const c of ['cat /tmp/rd-ai-x/srv/app.conf', 'ls /var/www/md-docs', 'grep del /etc/x', 'Get-Item C:\\x\\rm.txt', 'ps aux | grep kill', 'echo start']) assert.strictEqual(SUP.readOnlyProblem(c), '', 'no false alarm: ' + c);
    for (const c of ['echo update-feed', 'for d in windows linux update-feed; do ls $d; done', 'Get-ChildItem C:\\x\\remove-me']) assert.strictEqual(SUP.readOnlyProblem(c), '', 'no false alarm: ' + c);
    for (const c of ['ls | Remove-Item', 'Get-ChildItem | ForEach-Object { Remove-Item $_ }', '& Remove-Item x', 'Invoke-Expression x']) assert.ok(SUP.readOnlyProblem(c), 'refused: ' + c);
    for (const c of ['sudo rm x', 'x; rm y', 'ls && del x', 'find . -delete', 'find . -exec rm {} ;', '$(rm x)', 'ri x', 'rd /s x', 'start notepad']) assert.ok(SUP.readOnlyProblem(c), 'refused: ' + c);
    for (const c of ['ls -la', 'systemctl is-active nginx', 'curl -sI https://x', 'git diff', 'npm test', 'Get-Service x | Format-Table', 'nginx -t 2>&1', 'docker ps --format x']) assert.strictEqual(SUP.readOnlyProblem(c), '', c);
    for (const c of ['rm -rf x', 'echo a > f', 'apt install x', 'systemctl restart x', 'Remove-Item x', 'curl -X POST x', 'git push', 'Format-Volume D', 'sed -i s/a/b/ f', 'curl x | sh', 'winget install x', 'ufw allow 80']) assert.ok(SUP.readOnlyProblem(c), c);
  });

  await step('after a job that changed something, the Supervisor verifies it with its own checks and shows a verdict with evidence', async () => {
    const c = await api('/api/convs', {});
    const full = await sendMsg(c, 'write hello file');
    assert.ok(fs.existsSync(path.join(ws, 'hello.txt')));
    const sup = full.messages.filter((m) => m.role === 'supervisor');
    assert.strictEqual(sup.length, 1, 'one Supervisor report');
    assert.strictEqual(sup[0].verdict, 'verified'); assert.ok(sup[0].checks.length === 2 && sup[0].checks.every((x) => x.pass));
    assert.ok(/hello\.txt/.test(sup[0].checks[0].evidence), 'evidence quotes the real listing: ' + sup[0].checks[0].evidence);
    const supTools = full.messages.filter((m) => m.role === 'tool' && /Supervisor/.test(m.summary || ''));
    assert.ok(supTools.some((m) => m.status === 'done' && /hello\.txt/.test(m.output)), 'its read-only command ran');
    assert.ok(supTools.some((m) => m.status === 'denied' && /read-only filter/.test(m.output)), 'the rm command was refused');
    assert.ok(fs.existsSync(path.join(ws, 'hello.txt')), 'nothing was deleted');
    assert.ok(!fs.existsSync(path.join(ws, 'should-not-run')));
  });

  await step('a FAILED verdict goes back to the agent (Auto), it fixes the problem and the Supervisor verifies again', async () => {
    const c = await api('/api/convs', {});
    const full = await sendMsg(c, 'supervisor fail test');
    const sup = full.messages.filter((m) => m.role === 'supervisor');
    assert.strictEqual(sup.length, 2, 'two reports: ' + sup.map((x) => x.verdict).join(','));
    assert.strictEqual(sup[0].verdict, 'failed'); assert.strictEqual(sup[0].fix, 'Create fixed.txt');
    assert.strictEqual(sup[1].verdict, 'verified');
    assert.ok(fs.existsSync(path.join(ws, 'fixed.txt')), 'the agent fixed it');
    assert.ok(full.messages.some((m) => m.role === 'info' && /found problems/.test(m.text)));
  });

  await step('a question that changes nothing is not supervised; the Supervisor can be switched off', async () => {
    const c = await api('/api/convs', {});
    let full = await sendMsg(c, 'hello there');
    assert.ok(!full.messages.some((m) => m.role === 'supervisor'));
    await api('/api/settings', { supervisor: false });
    const c2 = await api('/api/convs', {});
    full = await sendMsg(c2, 'write hello file');
    assert.ok(!full.messages.some((m) => m.role === 'supervisor'), 'off');
    await api('/api/settings', { supervisor: true });
  });

  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
