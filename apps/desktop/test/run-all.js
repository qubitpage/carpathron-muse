// End-to-end tests of the backend: engines, tools, approvals, MCP, memory, RAG, history, skills, WhatsApp, robot, security.
'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { WebSocket } = require('ws');
const fake = require('./fake-meta');
const { startServer } = require('../backend/server');

const PORT = 18610;
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push(['PASS', name]); console.log(`  ✓ ${name} (${Date.now() - t} ms)`); }
  catch (e) { results.push(['FAIL', name, e]); console.log(`  ✗ ${name}\n    ${e.stack || e}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await fake.start(18611);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-test-'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-ws-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
    apiKey: 'test-key', apiBase: 'http://127.0.0.1:18611/v1', engine: 'api', workspace: ws, port: PORT,
    mcpServers: { echo: { command: process.execPath, args: [path.join(__dirname, 'fake-mcp.js')] } },
    whatsapp: { allowed: ['+40 712 345 678'], cloud: { enabled: true, verifyToken: 'vt', appSecret: 'sec', phoneNumberId: '123', accessToken: 'x' } },
  }));
  const srv = await startServer({ dataDir, log: () => {} });
  const T = srv.token;
  const base = `https://localhost:${PORT}`;
  const api = async (p, body, method) => {
    const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'x-mc-token': T, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(`${r.status} ${JSON.stringify(j)}`), { status: r.status });
    return j;
  };
  const events = [];
  const sock = new WebSocket(`wss://localhost:${PORT}/ws?t=${T}`, { rejectUnauthorized: false });
  sock.on('message', (m) => events.push(JSON.parse(m)));
  await new Promise((r) => sock.on('open', r));
  const waitFor = async (pred, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const e = events.find(pred); if (e) return e; await sleep(30); } throw new Error('timeout waiting for event'); };
  const waitIdle = async (convId) => waitFor((e) => e.event === 'turn:state' && e.data.convId === convId && e.data.running === false && !e.data._seen && (e.data._seen = true), 15000);
  const lastAgentCall = () => fake.calls().filter((x) => /You are Muse Carpathron/.test(x.messages[0].content)).slice(-1)[0];
  const conv = async (extra = {}) => { const c = await api('/api/convs', { ...extra }); return c; };
  const sendMsg = async (c, text, extra = {}) => { await api(`/api/convs/${c.id}/send`, { text, ...extra }); await waitIdle(c.id); return api(`/api/convs/${c.id}`); };

  console.log('Muse Carpathron backend tests');

  await step('security: API and WebSocket refuse requests without the access token', async () => {
    const r = await fetch(base + '/api/bootstrap');
    assert.strictEqual(r.status, 401);
    const bad = new WebSocket(`wss://localhost:${PORT}/ws`, { rejectUnauthorized: false });
    await new Promise((resolve) => { bad.on('error', resolve); bad.on('unexpected-response', resolve); });
    const s = await api('/api/settings');
    assert.strictEqual(s.apiKey, undefined, 'API key must never be sent to the UI');
    assert.strictEqual(s.hasApiKey, true);
  });

  await step('pairing PIN: wrong PIN refused, right PIN gives access, PIN works once', async () => {
    const acc = await api('/api/access');
    assert.ok(/^\d{6}$/.test(acc.pin));
    const post = (pin) => fetch(`${base}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
    assert.strictEqual((await post('000000' === acc.pin ? '111111' : '000000')).status, 403);
    const ok = await post(acc.pin);
    assert.strictEqual(ok.status, 200);
    const cookie = ok.headers.get('set-cookie').split(';')[0];
    const r = await fetch(`${base}/api/settings`, { headers: { cookie } });
    assert.strictEqual(r.status, 200, 'paired device can use the app');
    assert.strictEqual((await post(acc.pin)).status, 403, 'PIN is single use');
    const page = await fetch(`${base}/pair`);
    assert.ok(/Pair with Muse Carpathron/.test(await page.text()));
  });

  await step('bootstrap + models list from Meta API', async () => {
    const b = await api('/api/bootstrap');
    assert.ok(Array.isArray(b.convs) && b.skills.length >= 4);
    const m = await api('/api/models?engine=api');
    assert.deepStrictEqual(m.models.map((x) => x.id), ['muse-spark-1.3', 'muse-spark-test']);
  });

  await step('MCP server starts and exposes its tool', async () => {
    for (let i = 0; i < 100 && !(srv.mcp.status()[0] || {}).status?.startsWith('ready'); i++) await sleep(100);
    const st = srv.mcp.status();
    assert.strictEqual(st[0].status, 'ready', JSON.stringify(st));
    assert.deepStrictEqual(st[0].tools, ['shout']);
  });

  let c1;
  await step('chat streams a reply (API engine) and gets a title', async () => {
    c1 = await conv();
    const full = await sendMsg(c1, 'Hi there, my first message');
    const a = full.messages.find((m) => m.role === 'assistant');
    assert.ok(a && a.text.startsWith('Hello from fake Muse'), JSON.stringify(full.messages));
    assert.ok(events.some((e) => e.event === 'msg:delta' && e.data.convId === c1.id), 'streamed deltas');
    assert.strictEqual(full.title, 'Hi there, my first message');
  });

  await step('ASK mode: write_file waits for approval, then runs locally after "Allow"', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}/send`, { text: 'write hello file' });
    const ap = await waitFor((e) => e.event === 'approval:new' && e.data.convId === c.id);
    assert.ok(!fs.existsSync(path.join(ws, 'hello.txt')), 'must not write before approval');
    await api(`/api/approvals/${ap.data.approvalId}`, { choiceId: 'allow' });
    await waitIdle(c.id);
    assert.strictEqual(fs.readFileSync(path.join(ws, 'hello.txt'), 'utf8'), 'hi from agent');
    const full = await api(`/api/convs/${c.id}`);
    assert.ok(full.messages.some((m) => m.role === 'tool' && m.status === 'done'));
    assert.ok(full.messages.some((m) => m.role === 'assistant' && /^Done/.test(m.text)));
  });

  await step('ASK mode: denied command is not executed', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}/send`, { text: 'run echo please' });
    const ap = await waitFor((e) => e.event === 'approval:new' && e.data.convId === c.id);
    await api(`/api/approvals/${ap.data.approvalId}`, { choiceId: 'deny' });
    await waitIdle(c.id);
    const full = await api(`/api/convs/${c.id}`);
    const tool = full.messages.find((m) => m.role === 'tool');
    assert.strictEqual(tool.status, 'denied');
  });

  await step('AUTO mode: PowerShell/bash command runs without asking', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}`, { mode: 'auto' }, 'PATCH');
    const full = await sendMsg(c, 'run echo please');
    const tool = full.messages.find((m) => m.role === 'tool');
    assert.strictEqual(tool.status, 'done');
    assert.ok(/agent-ran/.test(tool.output), tool.output);
  });

  await step('PLAN mode: write is blocked automatically', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}`, { mode: 'plan' }, 'PATCH');
    fs.rmSync(path.join(ws, 'hello.txt'), { force: true });
    const full = await sendMsg(c, 'write hello file');
    assert.strictEqual(full.messages.find((m) => m.role === 'tool').status, 'denied');
    assert.ok(!fs.existsSync(path.join(ws, 'hello.txt')));
  });

  await step('"Always allow in this chat" skips later approvals for that tool', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}/send`, { text: 'write hello file' });
    const ap = await waitFor((e) => e.event === 'approval:new' && e.data.convId === c.id);
    await api(`/api/approvals/${ap.data.approvalId}`, { choiceId: 'allow_chat' });
    await waitIdle(c.id);
    const before = events.filter((e) => e.event === 'approval:new' && e.data.convId === c.id).length;
    await sendMsg(c, 'write hello file again');
    const after = events.filter((e) => e.event === 'approval:new' && e.data.convId === c.id).length;
    assert.strictEqual(after, before, 'no new approval');
  });

  await step('MCP tool call through the agent', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}`, { mode: 'auto' }, 'PATCH');
    const full = await sendMsg(c, 'use mcp now');
    const tool = full.messages.find((m) => m.role === 'tool');
    assert.strictEqual(tool.output, 'HELLO MCP!!');
  });

  await step('orchestration: delegate runs 2 sub-agents in parallel', async () => {
    const c = await conv();
    const full = await sendMsg(c, 'delegate this work');
    const tool = full.messages.find((m) => m.role === 'tool' && m.name === 'delegate');
    assert.ok(/Report for: task alpha/.test(tool.output) && /Report for: task beta/.test(tool.output), tool.output);
  });

  await step('memory: agent saves a fact, it is used in a NEW chat', async () => {
    const c = await conv();
    await sendMsg(c, 'please remember my favorite color');
    const mem = await api('/api/memory');
    assert.ok(mem.some((m) => /favorite color is green/.test(m.text)), JSON.stringify(mem));
    const c2 = await conv();
    const full = await sendMsg(c2, 'what do you know?');
    assert.ok(/Memory in prompt: yes/.test(full.messages.find((m) => m.role === 'assistant').text));
  });

  await step('memory: automatic learning + /remember + edit + delete', async () => {
    await sleep(500);
    let mem = await api('/api/memory');
    assert.ok(mem.some((m) => m.source === 'auto' && /Baby Carpathron/.test(m.text)), 'auto memory');
    const c = await conv();
    const full = await sendMsg(c, '/remember I live in Romania');
    assert.ok(full.messages.some((m) => m.role === 'assistant' && /remember/.test(m.text)));
    mem = await api('/api/memory');
    const it = mem.find((m) => m.text === 'I live in Romania');
    assert.ok(it);
    await api(`/api/memory/${it.id}`, { text: 'I live in Cluj, Romania' }, 'PATCH');
    await api(`/api/memory/${it.id}`, null, 'DELETE');
    mem = await api('/api/memory');
    assert.ok(!mem.some((m) => m.id === it.id));
  });

  await step('chat history: search_chats finds details from an older chat', async () => {
    const old = await conv();
    await sendMsg(old, 'My secret project codename is pineapple rocket');
    const c = await conv();
    const full = await sendMsg(c, 'look in old chats');
    const tool = full.messages.find((m) => m.role === 'tool' && m.name === 'search_chats');
    assert.ok(/pineapple rocket/.test(tool.output), tool.output);
    const s = await api('/api/search?q=pineapple');
    assert.ok(s.some((x) => x.convId === old.id));
  });

  await step('projects: upload knowledge (big → RAG) and knowledge_search finds the passage', async () => {
    const p = await api('/api/projects', { name: 'Robot docs', instructions: 'Be technical.' });
    const filler = Array.from({ length: 600 }, (_, i) => `Line ${i}: motors, wheels, batteries and chassis notes.`).join('\n');
    const doc = `${filler}\nThe zebra secret is that pin 27 drives the right motor.\n${filler}`;
    await api(`/api/projects/${p.id}/files`, { name: 'manual.md', dataBase64: Buffer.from(doc).toString('base64') });
    const hits = await api(`/api/projects/${p.id}/search?q=zebra%20secret`);
    assert.ok(/pin 27/.test(hits[0].text));
    const c = await conv({ projectId: p.id });
    const full = await sendMsg(c, 'search project docs');
    const tool = full.messages.find((m) => m.role === 'tool' && m.name === 'knowledge_search');
    assert.ok(/pin 27/.test(tool.output));
    const sys = lastAgentCall().messages[0].content;
    assert.ok(/Project: Robot docs/.test(sys) && /Be technical/.test(sys) && /knowledge_search/.test(sys));
  });

  await step('attachments: text from an attached file reaches the model', async () => {
    const c = await conv();
    await sendMsg(c, 'summarize', { attachments: [{ name: 'notes.txt', dataBase64: Buffer.from('banana-attachment-content').toString('base64') }] });
    const last = lastAgentCall().messages.slice(-1)[0].content;
    assert.ok(/banana-attachment-content/.test(last) && /attached_file name="notes.txt"/.test(last));
  });

  await step('skills: /review expands to the skill instructions; custom skill saved', async () => {
    const c = await conv();
    await sendMsg(c, '/review src folder');
    const last = fake.calls().filter((x) => x.messages[0].content.includes('Muse Carpathron')).slice(-1)[0].messages.slice(-1)[0].content;
    assert.ok(/Review the code/.test(last) && /src folder/.test(last), last);
    await api('/api/skills', { name: 'Daily Report', description: 'd', body: 'Write my daily report' });
    assert.ok((await api('/api/skills')).some((s) => s.name === 'daily-report'));
  });

  await step('folder context: attached folder file names are sent, contents are not', async () => {
    fs.writeFileSync(path.join(ws, 'secret-notes.txt'), 'TOPSECRETCONTENT');
    const c = await conv();
    await sendMsg(c, 'hello folder');
    const sys = lastAgentCall().messages[0].content;
    assert.ok(/secret-notes\.txt/.test(sys));
    assert.ok(!/TOPSECRETCONTENT/.test(JSON.stringify(lastAgentCall())));
  });

  await step('robot: AI drive plan reaches the motors and stops', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}`, { mode: 'auto' }, 'PATCH');
    const full = await sendMsg(c, 'drive robot forward');
    const tool = full.messages.find((m) => m.role === 'tool' && m.name === 'robot_drive');
    assert.ok(/"completed":true/.test(tool.output), tool.output);
    assert.ok(events.some((e) => e.event === 'robot:motors' && e.data.left === 50));
    assert.strictEqual(srv.robot.current.left, 0);
  });

  // fake ESP32-CAM
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7), Buffer.from([0xff, 0xd9])]);
  const camSrv = require('http').createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(jpeg); }).listen(18613);

  await step('camera: snapshot URL photo is saved and served', async () => {
    await api('/api/settings', { robot: { cameraUrl: 'http://127.0.0.1:18613/capture' } });
    const r = await api('/api/camera/capture', {});
    assert.ok(r.path && fs.existsSync(r.path), JSON.stringify(r));
    const img = await fetch(`${base}/api/photo?path=${encodeURIComponent(r.path)}`, { headers: { 'x-mc-token': T } });
    assert.strictEqual(img.status, 200);
    const bad = await fetch(`${base}/api/photo?path=${encodeURIComponent(path.join(ws, 'hello.txt'))}`, { headers: { 'x-mc-token': T } });
    assert.strictEqual(bad.status, 404, 'only photos can be served');
  });

  await step('agent: robot_photo tool + the model receives the image (vision)', async () => {
    const c = await conv();
    const full = await sendMsg(c, 'take a photo of what is ahead');
    const tool = full.messages.find((m) => m.role === 'tool' && m.name === 'robot_photo');
    assert.ok(tool && tool.image && /photos/.test(tool.image), JSON.stringify(tool));
    assert.ok(full.messages.some((m) => m.role === 'assistant' && /I can see the photo \(data:image\/jpeg;base64/.test(m.text)), JSON.stringify(full.messages.slice(-2)));
    srv.store.flush();
    assert.ok(!/base64,\/9j|base64,\/\/8/.test(fs.readFileSync(path.join(dataDir, 'conversations', `${c.id}.json`), 'utf8')), 'photo data not stored in chat file');
  });

  await step('camera: no URL and no window gives a clear message', async () => {
    await api('/api/settings', { robot: { cameraUrl: '' } });
    const r = await api('/api/camera/capture', {});
    assert.ok(/No camera/.test(r.error), JSON.stringify(r));
    await api('/api/settings', { robot: { cameraUrl: 'http://127.0.0.1:18613/capture' } });
  });

  await step('WhatsApp: /drive and /photo work without the AI, photo is sent back', async () => {
    const out = [], imgs = [];
    await srv.wa.handle('cloud', '40712345678', '/drive forward 0.3', async (t) => out.push(t), async (b, cap) => imgs.push([b.length, cap]));
    assert.ok(out.some((t) => /Driving forward/.test(t)) && out.some((t) => /Done/.test(t)), JSON.stringify(out));
    assert.ok(events.some((e) => e.event === 'robot:motors' && e.data.left === 60 && e.data.source === 'whatsapp'));
    await srv.wa.handle('cloud', '40712345678', '/photo', async (t) => out.push(t), async (b, cap) => imgs.push([b.length, cap]));
    assert.strictEqual(imgs.length, 1);
    assert.strictEqual(imgs[0][0], jpeg.length);
    await srv.wa.handle('cloud', '40712345678', '/mode auto', async (t) => out.push(t));
    await srv.wa.handle('cloud', '40712345678', 'take a photo please', async (t) => out.push(t), async (b, cap) => imgs.push([b.length, cap]));
    assert.strictEqual(imgs.length, 2, 'photo taken by the agent is sent to WhatsApp');
    await srv.wa.handle('cloud', '40712345678', '/mode ask', async (t) => out.push(t));
  });

  await step('real-car firmware API: online, drive, car camera photo, live video proxy', async () => {
    const fakeCar = require('./fake-car').start(18690, 18691, jpeg);
    await api('/api/settings', { robot: { carIp: '127.0.0.1:18690', cameraUrl: '' } });
    for (let i = 0; i < 40 && srv.robot.status().state !== 'online'; i++) await sleep(100);
    assert.strictEqual(srv.robot.status().state, 'online');
    sock.send(JSON.stringify({ type: 'drive', left: 70, right: 70 }));
    await sleep(250);
    assert.ok(fakeCar.log.some((x) => x === '/drive?l=70&r=70'), fakeCar.log.slice(-5).join(' '));
    const ph = await api('/api/camera/capture', {});
    assert.strictEqual(ph.source, 'robot camera', JSON.stringify(ph));
    assert.ok(fakeCar.log.includes('/capture'));
    const ctl = new AbortController();
    const st = await fetch(`${base}/api/robot/stream`, { headers: { 'x-mc-token': T }, signal: ctl.signal });
    assert.ok(/multipart/.test(st.headers.get('content-type')));
    const rd = st.body.getReader(); const first = await rd.read(); ctl.abort();
    assert.ok(first.value && first.value.length > 100, 'video bytes arrive');
    await api('/api/settings', { robot: { carIp: '' } });
    fakeCar.close();
  });

  await step('robot head: look left/right turns the car, photographs, turns back (app + WhatsApp)', async () => {
    const fakeCar = require('./fake-car').start(18692, 18693, jpeg);
    await api('/api/settings', { robot: { carIp: '127.0.0.1:18692', cameraUrl: '', turnMs360: 1200, turnSpeed: 70 } });
    for (let i = 0; i < 40 && srv.robot.status().state !== 'online'; i++) await sleep(100);
    const r = await api('/api/robot/look', { direction: 'left' });
    assert.ok(r.ok && r.degrees === -90, JSON.stringify(r));
    const iL = fakeCar.log.indexOf('/drive?l=-70&r=70'), iCap = fakeCar.log.lastIndexOf('/capture'), iBack = fakeCar.log.lastIndexOf('/drive?l=70&r=-70');
    assert.ok(iL >= 0 && iCap > iL && iBack > iCap, 'turn left, photo, turn back right: ' + fakeCar.log.slice(-12).join(' '));
    const imgs = [], out = [];
    await srv.wa.handle('cloud', '40712345678', '/look right', async (t) => out.push(t), async (b, cap) => imgs.push(cap));
    assert.strictEqual(imgs.length, 1, out.join(' | '));
    const t = await api('/api/robot/turn', { degrees: 180 });
    assert.ok(t.ok && t.ms === 600, JSON.stringify(t));
    global.__car = fakeCar;
  });

  await step('room scan: full circle of photos -> AI map (SVG), summary, memory, WhatsApp /scan', async () => {
    const before = srv.wa.agent.memory.list().length;
    const r = await srv.wa.agent.mapper.scan({ steps: 4 });
    assert.strictEqual(r.photos.length, 4);
    assert.ok(/chair/.test(r.svg) && /small office/.test(r.summary), r.summary);
    assert.strictEqual(global.__car.log.filter((x) => x === '/drive?l=70&r=-70').length >= 4, true, 'turned 4 times');
    assert.ok(srv.wa.agent.memory.list().length > before && srv.wa.agent.memory.list().some((m) => /Room map/.test(m.text)), 'saved to memory');
    const maps = await api('/api/robot/maps');
    assert.ok(maps.length >= 1 && maps[0].id === r.id);
    const svg = await fetch(`${base}/api/robot/maps/${r.id}/map.svg`, { headers: { 'x-mc-token': T } });
    assert.ok(svg.ok && /<svg/.test(await svg.text()));
    const bad = await fetch(`${base}/api/robot/maps/${r.id}/..%2F..%2Fsettings.json`, { headers: { 'x-mc-token': T } });
    assert.notStrictEqual(bad.status, 200);
    const out = [];
    await srv.wa.handle('cloud', '40712345678', '/scan', async (t) => out.push(t), async () => {});
    assert.ok(out.some((x) => /Room map/.test(x)), out.join(' | '));
  });

  await step('WhatsApp voice note: Ogg/Opus -> WAV -> Muse Voice Transcribe -> command', async () => {
    const { execFileSync } = require('child_process');
    const ogg = path.join(os.tmpdir(), 'mc-voice.ogg');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2', '-c:a', 'libopus', '-ar', '48000', ogg]);
    const voice = require('../backend/voice');
    const { wav, seconds } = await voice.oggToWav(fs.readFileSync(ogg));
    assert.strictEqual(wav.toString('ascii', 0, 4), 'RIFF');
    assert.strictEqual(wav.readUInt32LE(24), 24000, '24 kHz');
    assert.strictEqual(wav.readUInt16LE(22), 1, 'mono');
    assert.ok(seconds > 1 && seconds < 1.4, String(seconds));
    const out = [], imgs = [];
    const said = await srv.wa.voiceText(async () => fs.readFileSync(ogg), 'audio/ogg; codecs=opus', async (t) => out.push(t));
    assert.strictEqual(said, '/look left');
    assert.ok(out.some((t) => /Look left/.test(t)), out.join(' | '));
    assert.ok(fake.asr().length >= 1);
    await srv.wa.handle('cloud', '40712345678', said, async (t) => out.push(t), async (b, cap) => imgs.push(cap));
    assert.strictEqual(imgs.length, 1, 'voice "look left" -> car looked and sent the photo');
    await api('/api/settings', { robot: { carIp: '' } });
    global.__car.close();
  });

  await step('Carpathron Avatar (Quest app) link: request -> Allow on PC -> token -> ask Muse / voice / look', async () => {
    const car = require('./fake-car').start(18694, 18695, jpeg);
    await api('/api/settings', { robot: { carIp: '127.0.0.1:18694', turnMs360: 1200 } });
    for (let i = 0; i < 40 && srv.robot.status().state !== 'online'; i++) await sleep(100);
    const hello = await (await fetch(`${base}/avatar/hello`)).json();
    assert.strictEqual(hello.app, 'Muse Carpathron');
    const no = await fetch(`${base}/avatar/ask`, { method: 'POST', body: '{}' });
    assert.strictEqual(no.status, 401, 'not linked -> refused');
    const { id } = await (await fetch(`${base}/avatar/link`, { method: 'POST', body: JSON.stringify({ device: 'Quest 3S' }) })).json();
    const ev = await waitFor((e) => e.event === 'avatar:link' && e.data.id === id);
    assert.strictEqual(ev.data.device, 'Quest 3S');
    assert.strictEqual((await (await fetch(`${base}/avatar/link/${id}`)).json()).status, 'pending');
    await api('/api/avatar/decide', { id, allow: true });
    const ok = await (await fetch(`${base}/avatar/link/${id}`)).json();
    assert.ok(ok.status === 'allowed' && ok.token.length >= 32, JSON.stringify(ok));
    const H = { 'x-avatar-token': ok.token, 'Content-Type': 'application/json' };
    const ask = await (await fetch(`${base}/avatar/ask`, { method: 'POST', headers: H, body: JSON.stringify({ question: 'What do you see?' }) })).json();
    assert.ok(/I can see the photo/.test(ask.answer), JSON.stringify(ask));
    // 48 kHz stereo WAV like the Quest microphone
    const n = 24000, w = Buffer.alloc(44 + n * 4);
    w.write('RIFF', 0); w.writeUInt32LE(36 + n * 4, 4); w.write('WAVE', 8); w.write('fmt ', 12); w.writeUInt32LE(16, 16); w.writeUInt16LE(1, 20); w.writeUInt16LE(2, 22); w.writeUInt32LE(48000, 24); w.writeUInt32LE(192000, 28); w.writeUInt16LE(4, 32); w.writeUInt16LE(16, 34); w.write('data', 36); w.writeUInt32LE(n * 4, 40);
    const vr = await (await fetch(`${base}/avatar/voice`, { method: 'POST', headers: { 'x-avatar-token': ok.token, 'Content-Type': 'audio/wav' }, body: w })).json();
    assert.ok(vr.heard === 'Look left' && vr.command === '/look left' && vr.replies.some((t) => /Looking left/.test(t)), JSON.stringify(vr));
    assert.ok(car.log.includes('/drive?l=-70&r=70') || car.log.some((x) => x === 'ws:-70,70'), 'the car turned to look');
    const pub = await api('/api/settings');
    assert.ok(!JSON.stringify(pub).includes(ok.token) && pub.avatarLinked.length >= 1, 'token never sent to the UI');
    await api('/api/settings', { robot: { carIp: '' } });
    car.close();
  });

  await step('stop button interrupts a running turn', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}/send`, { text: 'write hello file' });
    await waitFor((e) => e.event === 'approval:new' && e.data.convId === c.id);
    await api(`/api/convs/${c.id}/stop`, {});
    await waitIdle(c.id);
    const full = await api(`/api/convs/${c.id}`);
    assert.ok(full.messages.some((m) => m.role === 'info' && /Stopped/.test(m.text)));
  });

  await step('activity log shows cloud vs local steps', async () => {
    const a = await api('/api/activity');
    assert.ok(a.activity.some((x) => x.kind === 'cloud') && a.activity.some((x) => x.kind === 'local'));
  });

  await step('WhatsApp Cloud: verify, signature check, allow-list, reply, approve by "yes"', async () => {
    const v = await fetch(`${base}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42`);
    assert.strictEqual(await v.text(), '42');
    const bad = await fetch(`${base}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=no&hub.challenge=42`);
    assert.strictEqual(bad.status, 403);
    const sent = [];
    srv.wa.cloudSend = async (to, text) => { sent.push([to, text]); };
    const crypto = require('crypto');
    const post = async (from, text) => {
      const body = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '123' }, messages: [{ from, type: 'text', text: { body: text } }] } }] }] });
      const sig = 'sha256=' + crypto.createHmac('sha256', 'sec').update(body).digest('hex');
      return fetch(`${base}/whatsapp/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': sig, 'Content-Type': 'application/json' }, body });
    };
    const forged = await fetch(`${base}/whatsapp/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=00' }, body: '{}' });
    assert.strictEqual(forged.status, 401);
    await post('49111222333', 'hello');
    await sleep(300);
    assert.strictEqual(sent.length, 0, 'stranger ignored');
    await post('40712345678', '/help');
    await sleep(300);
    assert.ok(sent.some(([, t]) => /commands/.test(t)));
    await post('40712345678', 'write hello file');
    for (let i = 0; i < 100 && !sent.some(([, t]) => /Approval needed/.test(t)); i++) await sleep(50);
    assert.ok(sent.some(([, t]) => /Approval needed/.test(t)), JSON.stringify(sent));
    await post('40712345678', 'yes');
    for (let i = 0; i < 100 && !sent.some(([, t]) => /^Done/.test(t)); i++) await sleep(50);
    assert.ok(sent.some(([, t]) => /^Done/.test(t)), JSON.stringify(sent));
    assert.ok((await api('/api/convs')).some((c) => c.source === 'whatsapp'));
  });

  await step('conversations persist on disk and reload lazily', async () => {
    srv.store.flush();
    const files = fs.readdirSync(path.join(dataDir, 'conversations'));
    assert.ok(files.length >= 10);
    srv.store.loaded.clear();
    const again = await api(`/api/convs/${c1.id}`);
    assert.ok(again.messages.length >= 2);
  });

  await step('bad API key gives a clear error in the chat', async () => {
    await api('/api/settings', { apiKey: 'wrong' });
    const c = await conv();
    const full = await sendMsg(c, 'hello');
    assert.ok(full.messages.some((m) => m.role === 'error' && /rejected the key/.test(m.text)));
    await api('/api/settings', { apiKey: 'test-key' });
  });

  await step('Muse engine: clear message when Muse Code is not installed', async () => {
    const c = await conv({ engine: 'muse' });
    const full = await sendMsg(c, 'hello');
    assert.ok(full.messages.some((m) => m.role === 'error' && /Muse Code is not installed/.test(m.text)), JSON.stringify(full.messages.slice(-1)));
  });

  sock.close();
  camSrv.close();
  await srv.close();
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
