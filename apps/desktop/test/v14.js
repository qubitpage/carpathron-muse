// Tests for 1.4: Stop, full mode, SSH servers (exec, files, shell, upload/download, chat on a server), documents,
// web search + research, Muse Image, SAM 3.1, background jobs, non-chat models, Muse Code bridge (MCP).
'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { WebSocket } = require('ws');
const fake = require('./fake-meta');
const fakeSsh = require('./fake-ssh');
const { startServer } = require('../backend/server');

const PORT = 18630;
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push(['PASS', name]); console.log(`  ✓ ${name} (${Date.now() - t} ms)`); }
  catch (e) { results.push(['FAIL', name, e]); console.log(`  ✗ ${name}\n    ${e.stack || e}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Minimal valid PDF with one line of text per page (for read_document tests).
function tinyPdf(pages) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objs.length + 1 + pages.length * 2;
  const kids = [];
  for (const text of pages) {
    const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
    const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const cat = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

(async () => {
  await fake.start(18631);
  const sshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mc14-home-'));
  await fakeSsh.start(18632, { home: sshHome });
  process.env.MC_GITHUB_API = 'http://127.0.0.1:18633'; process.env.MC_GITHUB_WEB = 'http://127.0.0.1:18633'; process.env.MC_GITHUB_UPLOADS = 'http://127.0.0.1:18633/uploads';
  const gh = { repos: new Map(), releases: [], assets: [], issues: [] };
  await new Promise((r) => require('http').createServer((req, res) => {
    let b = []; req.on('data', (d) => b.push(d)); req.on('end', () => {
      const body = Buffer.concat(b); const J = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json', 'x-oauth-scopes': 'repo, workflow' }); res.end(JSON.stringify(o)); };
      if (req.url === '/login/device/code') return J(200, { device_code: 'dc1', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 60 });
      if (req.url === '/login/oauth/access_token') { gh.polls = (gh.polls || 0) + 1; return J(200, gh.polls < 2 ? { error: 'authorization_pending' } : { access_token: 'ghp_test' }); }
      if (req.headers.authorization !== 'Bearer ghp_test') return J(401, { message: 'Bad credentials' });
      const u = req.url;
      if (u === '/user') return J(200, { login: 'msrusu87', id: 7, name: 'Mircea', public_repos: 3, total_private_repos: 2 });
      if (u === '/user/emails') return J(200, [{ email: 'm@example.com', primary: true }]);
      if (u === '/user/orgs') return J(200, [{ login: 'qubitpage' }]);
      let mm;
      if ((mm = u.match(/^\/repos\/([^/]+)\/([^/]+)$/)) && req.method === 'GET') { const r = gh.repos.get(`${mm[1]}/${mm[2]}`); return r ? J(200, r) : J(404, { message: 'Not Found' }); }
      if ((u === '/user/repos' || /^\/orgs\/[^/]+\/repos$/.test(u)) && req.method === 'POST') { const j = JSON.parse(body); const owner = u === '/user/repos' ? 'msrusu87' : u.split('/')[2]; const r = { full_name: `${owner}/${j.name}`, html_url: `https://github.com/${owner}/${j.name}`, private: j.private, default_branch: 'main' }; gh.repos.set(r.full_name, r); return J(201, r); }
      if (/\/releases\/tags\//.test(u)) return J(404, { message: 'Not Found' });
      if (/\/releases$/.test(u) && req.method === 'POST') { const j = JSON.parse(body); const rel = { id: 55, tag_name: j.tag_name, name: j.name, html_url: `https://github.com/x/releases/tag/${j.tag_name}`, assets: [] }; gh.releases.push(j); return J(201, rel); }
      if (u.startsWith('/uploads/')) { const name = new URL(u, 'http://x').searchParams.get('name'); gh.assets.push({ name, size: body.length }); return J(201, { name, browser_download_url: `https://github.com/x/releases/download/v9/${name}` }); }
      if (/\/issues$/.test(u) && req.method === 'POST') { const j = JSON.parse(body); gh.issues.push(j); return J(201, { number: 12, html_url: 'https://github.com/x/issues/12' }); }
      J(404, { message: 'Not Found ' + u });
    });
  }).listen(18633, r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc14-'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mc14-ws-'));
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc14-remote-'));
  fs.writeFileSync(path.join(remoteDir, 'server-file.txt'), 'hello from the server\nline 2\n');
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ apiKey: 'test-key', apiBase: 'http://127.0.0.1:18631/v1', engine: 'api', workspace: ws, port: PORT }));
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
  const waitFor = async (pred, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const e = events.find(pred); if (e) return e; await sleep(30); } throw new Error('timeout waiting for event'); };
  const waitIdle = async (convId, ms = 20000) => waitFor((e) => e.event === 'turn:state' && e.data.convId === convId && e.data.running === false && !e.data._seen && (e.data._seen = true), ms);
  const conv = async (extra = {}) => api('/api/convs', { ...extra });
  const sendMsg = async (c, text, extra = {}) => { await api(`/api/convs/${c.id}/send`, { text, ...extra }); await waitIdle(c.id); return api(`/api/convs/${c.id}`); };
  const toolMsg = (full) => full.messages.find((m) => m.role === 'tool');

  console.log('Muse Carpathron 1.4 tests');

  await step('built-in skills are added once (design-website, design-pdf, research, firmware, server-setup, carpathron-build)', async () => {
    const sk = (await api('/api/skills')).map((x) => x.name);
    for (const n of ['design-website', 'design-pdf', 'research', 'firmware', 'server-setup', 'carpathron-build']) assert.ok(sk.includes(n), n);
    await api('/api/skills/research', null, 'DELETE');
    assert.ok(!(await api('/api/skills')).some((x) => x.name === 'research'));
  });

  await step('STOP ends a turn even when the model never answers (slow stream)', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}/send`, { text: 'slow answer please' });
    await waitFor((e) => e.event === 'turn:state' && e.data.convId === c.id && e.data.running);
    const t0 = Date.now();
    await api(`/api/convs/${c.id}/stop`, {});
    await waitIdle(c.id, 5000);
    assert.ok(Date.now() - t0 < 4000, 'stopped quickly');
    const full = await api(`/api/convs/${c.id}`);
    assert.ok(full.messages.some((m) => m.role === 'info' && /Stopped/.test(m.text)));
    assert.strictEqual(full.running, false);
  });

  await step('STOP kills a long running command and the chat becomes idle', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}`, { mode: 'full' }, 'PATCH');
    await api(`/api/convs/${c.id}/send`, { text: 'long command' });
    await waitFor((e) => e.event === 'msg:add' && e.data.convId === c.id && e.data.msg.role === 'tool');
    await sleep(300);
    const t0 = Date.now();
    await api(`/api/convs/${c.id}/stop`, {});
    await waitIdle(c.id, 5000);
    assert.ok(Date.now() - t0 < 4000);
    const full = await api(`/api/convs/${c.id}`);
    assert.ok(['denied', 'done'].includes(toolMsg(full).status));
    assert.ok(!/never/.test(toolMsg(full).output || ''));
  });

  await step('STOP on a chat that is not running resets the UI state (no stuck button)', async () => {
    const c = await conv();
    const r = await api(`/api/convs/${c.id}/stop`, {});
    assert.strictEqual(r.ok, false);
    await waitFor((e) => e.event === 'turn:state' && e.data.convId === c.id && e.data.running === false);
  });

  await step('FULL mode: commands run without approval', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}`, { mode: 'full' }, 'PATCH');
    const full = await sendMsg(c, 'run echo please');
    assert.strictEqual(toolMsg(full).status, 'done');
    assert.ok(/agent-ran/.test(toolMsg(full).output));
    const sys = fake.calls().slice(-2)[0].messages[0].content;
    assert.ok(/FULL ACCESS MODE/.test(sys));
  });

  let server;
  await step('SSH: save server (credentials encrypted), test connection, host key remembered', async () => {
    server = await api('/api/servers', { name: 'testbox', host: '127.0.0.1', port: 18632, username: 'tester', password: 'secret', defaultPath: remoteDir });
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
    const raw = saved.servers[0];
    assert.ok(raw.password.startsWith('aes:'), 'password encrypted on disk');
    assert.ok(!JSON.stringify(saved).includes('secret'));
    const pub = await api('/api/settings');
    assert.strictEqual(pub.servers, undefined, 'server secrets never sent to the UI');
    const t = await api(`/api/servers/${server.id}/test`, {});
    assert.ok(t.ok, JSON.stringify(t));
    assert.strictEqual(t.os, 'linux');
    const list = await api('/api/servers');
    assert.ok(list[0].fingerprint && list[0].connected);
    const bad = await api('/api/servers', { name: 'bad', host: '127.0.0.1', port: 18632, username: 'nobody', password: 'nope' });
    const tb = await api(`/api/servers/${bad.id}/test`, {});
    assert.ok(!tb.ok && /login|authentication/i.test(tb.error), tb.error);
    await api(`/api/servers/${bad.id}`, null, 'DELETE');
  });

  await step('SSH: no duplicate servers (adding the same server updates it; old duplicates are merged)', async () => {
    const before = (await api('/api/servers')).length;
    const again = await api('/api/servers', { name: 'testbox copy', host: '127.0.0.1', port: 18632, username: 'tester', keyId: '' });
    assert.ok(again.existed && again.id === server.id, JSON.stringify(again));
    assert.strictEqual((await api('/api/servers')).length, before);
    assert.ok((await api(`/api/servers/${server.id}/test`, {})).ok, 'password kept');
    assert.strictEqual(again.name, 'testbox', 'keeps its name');
    const other = await api('/api/servers', { name: 'other', host: '127.0.0.1', port: 18632, username: 'someoneelse' });
    await assert.rejects(api('/api/servers', { id: other.id, host: '127.0.0.1', port: 18632, username: 'tester' }), /already saved/);
    await api(`/api/servers/${other.id}`, null, 'DELETE');
    // old installs: duplicates already saved are merged at start, chats follow the kept one
    const { Remote } = require('../backend/remote');
    const settings = { servers: [
      { id: 'a', name: 'q', host: 'Q.com ', port: 22, username: 'ubuntu', createdAt: 1, password: 'x' },
      { id: 'b', name: 'q', host: 'q.com', port: 22, username: 'ubuntu', createdAt: 2, keyId: 'k1' },
      { id: 'c', name: 'q', host: 'q.com', port: 22, username: 'ubuntu', createdAt: 3 },
      { id: 'd', name: 'other', host: 'q.com', port: 2222, username: 'ubuntu' },
    ] };
    const rm = new Remote({ store: { settings, saveSettings() {} }, secrets: {} });
    assert.deepStrictEqual(settings.servers.map((x) => x.id), ['b', 'd']);
    assert.strictEqual(settings.servers[0].password, 'x', 'credentials merged into the kept one');
    assert.deepStrictEqual(rm.merged, { a: 'b', c: 'b' });
  });

  await step('SSH: changed host key is refused with a clear warning', async () => {
    const s = srv.store.settings.servers.find((x) => x.id === server.id);
    const good = s.fingerprint;
    s.fingerprint = 'ff'.repeat(32);
    srv.remote.disconnect(server.id);
    const t = await api(`/api/servers/${server.id}/test`, {});
    assert.ok(!t.ok && /host key/i.test(t.error), t.error);
    s.fingerprint = good;
  });

  await step('SSH: folder browser lists remote folders', async () => {
    fs.mkdirSync(path.join(remoteDir, 'www'), { recursive: true });
    const r = await api(`/api/servers/${server.id}/ls?path=${encodeURIComponent(remoteDir)}`);
    assert.ok(r.dirs.includes('www'), JSON.stringify(r));
  });

  await step('chat on a server: list_dir, write_file, run_command run on the server', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}`, { mode: 'full', remote: { serverId: server.id, path: remoteDir } }, 'PATCH');
    let full = await sendMsg(c, 'remote list please');
    assert.ok(/server-file\.txt/.test(toolMsg(full).output), toolMsg(full).output);
    const sys = fake.calls().slice(-2)[0].messages[0].content;
    assert.ok(/WORKING ON REMOTE SERVER "testbox"/.test(sys), 'system prompt says where it works');
    full = await sendMsg(c, 'remote write now');
    assert.strictEqual(fs.readFileSync(path.join(remoteDir, 'from-agent.txt'), 'utf8'), 'written over sftp');
    full = await sendMsg(c, 'remote run something');
    const out = full.messages.filter((m) => m.role === 'tool').pop().output;
    assert.ok(/remote-42/.test(out) && out.includes(remoteDir), out);
  });

  await step('ssh_exec tool + interactive shell + upload/download', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}`, { mode: 'full' }, 'PATCH');
    const full = await sendMsg(c, 'ssh exec please');
    assert.ok(/via-ssh-exec/.test(toolMsg(full).output));
    const { execX } = require('../backend/xtools');
    const ctx = srv.agent.toolCtx({ id: 'x', workspace: ws }, { abort: new AbortController() });
    let r = await execX('ssh_shell', { server: 'testbox', action: 'start' }, ctx);
    const id = r.match(/shell_id: (\S+)/)[1];
    r = await execX('ssh_shell', { action: 'send', shell_id: id, input: 'echo shell-$((2+3))', wait_ms: 3000 }, ctx);
    assert.ok(/shell-5/.test(r), r);
    await execX('ssh_shell', { action: 'close', shell_id: id }, ctx);
    fs.writeFileSync(path.join(ws, 'up.txt'), 'upload me');
    r = await execX('ssh_upload', { server: 'testbox', local_path: 'up.txt', remote_path: path.join(remoteDir, 'sub', 'up.txt') }, ctx);
    assert.strictEqual(fs.readFileSync(path.join(remoteDir, 'sub', 'up.txt'), 'utf8'), 'upload me');
    r = await execX('ssh_download', { server: 'testbox', remote_path: path.join(remoteDir, 'server-file.txt'), local_path: 'down/server-file.txt' }, ctx);
    assert.ok(fs.readFileSync(path.join(ws, 'down', 'server-file.txt'), 'utf8').startsWith('hello from the server'));
  });

  await step('documents: Excel, Word, PowerPoint and PDF are read', async () => {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Part', 'Price'], ['X15-450', 1139], ['RS-04', 211]]), 'Parts');
    XLSX.writeFile(wb, path.join(ws, 'book.xlsx'));
    const c = await conv();
    const full = await sendMsg(c, 'read the sheet');
    assert.ok(/Sheet "Parts"/.test(toolMsg(full).output) && /X15-450,1139/.test(toolMsg(full).output), toolMsg(full).output);
    const JSZip = require('jszip');
    const docx = new JSZip();
    docx.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    docx.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    docx.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello Word document</w:t></w:r></w:p></w:body></w:document>');
    fs.writeFileSync(path.join(ws, 'a.docx'), await docx.generateAsync({ type: 'nodebuffer' }));
    const pptx = new JSZip();
    pptx.file('ppt/slides/slide1.xml', '<p:sld><a:t>First slide title</a:t></p:sld>');
    pptx.file('ppt/slides/slide2.xml', '<p:sld><a:t>Second &amp; last</a:t></p:sld>');
    fs.writeFileSync(path.join(ws, 'a.pptx'), await pptx.generateAsync({ type: 'nodebuffer' }));
    const { readDocument } = require('../backend/xtools');
    assert.ok(/Hello Word document/.test(await readDocument(path.join(ws, 'a.docx'))));
    const p = await readDocument(path.join(ws, 'a.pptx'));
    assert.ok(/slide 1[\s\S]*First slide title[\s\S]*slide 2[\s\S]*Second & last/.test(p), p);
    fs.writeFileSync(path.join(ws, 'two.pdf'), tinyPdf(['First page text', 'Second page text']));
    const t = await readDocument(path.join(ws, 'two.pdf'), { pages: '1' });
    assert.ok(/PDF, 2 pages/.test(t) && /First page text/.test(t) && !/Second page/.test(t), t.slice(0, 300));
  });

  await step('web search uses Meta search grounding (Responses API) with sources', async () => {
    const c = await conv();
    const full = await sendMsg(c, 'search the web for me');
    const out = toolMsg(full).output;
    assert.ok(/Carpathron builds robots/.test(out) && /example\.com\/a/.test(out) && /example\.com\/b/.test(out), out);
    const req = fake.media().filter((m) => m.url === '/v1/responses').pop().body;
    assert.deepStrictEqual(req.tools[0].type, 'web_search');
  });

  await step('deep research: plans searches, writes a cited report file', async () => {
    const c = await conv();
    const full = await sendMsg(c, 'research this topic');
    const out = toolMsg(full).output;
    assert.ok(/Report saved to/.test(out), out);
    const file = out.match(/Report saved to (.+?\.md)/)[1];
    assert.ok(fs.readFileSync(file, 'utf8').includes('Robots are useful [1]'));
  });

  await step('Muse Image: generate_image saves the picture and shows it in the chat', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}`, { mode: 'full' }, 'PATCH');
    const full = await sendMsg(c, 'draw a logo');
    const t = toolMsg(full);
    assert.strictEqual(t.status, 'done', t.output);
    assert.ok(fs.existsSync(path.join(ws, 'logo.png')));
    assert.ok(t.image && t.image.endsWith('logo.png'));
    const img = await fetch(`${base}/api/photo?path=${encodeURIComponent(t.image)}`, { headers: { 'x-mc-token': T } });
    assert.strictEqual(img.status, 200);
    assert.strictEqual(img.headers.get('content-type'), 'image/png');
    const req = fake.media().filter((m) => m.url === '/v1/images/generations').pop().body;
    assert.strictEqual(req.model, 'muse-image-1.0');
  });

  await step('SAM 3.1: segment_image returns boxes with confidence', async () => {
    fs.copyFileSync(path.join(__dirname, 'sample.jpg'), path.join(ws, 'photo.jpg'));
    const c = await conv();
    const full = await sendMsg(c, 'find the cup please');
    const out = toolMsg(full).output;
    assert.ok(/1 match/.test(out) && /x 10-110, y 20-220 of 640×480/.test(out) && /93%/.test(out), out);
    const req = fake.media().filter((m) => m.url === '/v1/responses' && m.body.model === 'sam-3.1').pop().body;
    assert.strictEqual(req.input[0].content[0].text, 'cup');
    assert.ok(req.input[0].content[1].image_url.startsWith('data:image/jpeg;base64,'));
  });

  await step('picking a non-chat model in the menu: Muse Image draws from the message, SAM segments an attachment', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}`, { model: 'muse-image-1.0' }, 'PATCH');
    let full = await sendMsg(c, 'a red robot on a farm 1792x1024');
    const a = full.messages.find((m) => m.role === 'assistant' && m.image);
    assert.ok(a && fs.existsSync(a.image), JSON.stringify(full.messages.slice(-2)));
    assert.strictEqual(fake.media().filter((m) => m.url === '/v1/images/generations').pop().body.size, '1792x1024');
    const c2 = await conv();
    await api(`/api/convs/${c2.id}`, { model: 'sam-3.1' }, 'PATCH');
    full = await sendMsg(c2, 'cup', { attachments: [{ name: 'p.jpg', dataBase64: fs.readFileSync(path.join(__dirname, 'sample.jpg')).toString('base64') }] });
    assert.ok(full.messages.some((m) => m.role === 'assistant' && /1 match/.test(m.text)), JSON.stringify(full.messages.slice(-2)));
  });

  await step('image attachment goes to a vision model as an image (not as text)', async () => {
    const c = await conv();
    await sendMsg(c, 'what is in this picture', { attachments: [{ name: 'p.jpg', dataBase64: fs.readFileSync(path.join(__dirname, 'sample.jpg')).toString('base64') }] });
    const call = fake.calls().filter((x) => /You are Muse Carpathron/.test(x.messages[0].content)).pop();
    const user = call.messages.find((m) => m.role === 'user' && Array.isArray(m.content));
    assert.ok(user && user.content.some((p) => p.type === 'image_url' && p.image_url.url.startsWith('data:image/jpeg')), 'image part sent');
  });

  await step('reasoning effort is sent to Muse Spark', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}`, { effort: 'high' }, 'PATCH');
    await sendMsg(c, 'hello effort');
    assert.strictEqual(fake.calls().pop().reasoning_effort, 'high');
  });

  await step('background jobs: start, read output, finished state', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}`, { mode: 'full' }, 'PATCH');
    const full = await sendMsg(c, 'background job please');
    const out = toolMsg(full).output;
    assert.ok(/Started job\d+/.test(out) && /job-started/.test(out), out);
    await sleep(1500);
    const { execX } = require('../backend/xtools');
    const ctx = srv.agent.toolCtx({ id: 'x', workspace: ws }, { abort: new AbortController() });
    const o = await execX('job_output', { job_id: out.match(/(job\d+)/)[1] }, ctx);
    assert.ok(/job-done/.test(o) && /exited with code 0/.test(o), o);
  });

  await step('Arduino: clear message when arduino-cli is missing; argument parsing', async () => {
    const { execX, splitArgs } = require('../backend/xtools');
    const ctx = srv.agent.toolCtx({ id: 'x', workspace: ws }, { abort: new AbortController() });
    ctx.settings = { ...ctx.settings, arduinoCli: '/nonexistent/arduino-cli' };
    const save = process.env.PATH; process.env.PATH = '/nonexistent';
    try { await assert.rejects(execX('arduino_boards', {}, ctx), /arduino_setup/); } finally { process.env.PATH = save; }
    assert.deepStrictEqual(splitArgs('compile --fqbn esp32:esp32:esp32 "My Sketch"'), ['compile', '--fqbn', 'esp32:esp32:esp32', 'My Sketch']);
  });

  await step('Muse Code bridge: MCP server lists the app tools and runs them', async () => {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
    const c = await conv();
    const cfg = srv.agent.bridgeFor({ id: c.id });
    assert.strictEqual(cfg.transport, 'stdio');
    const client = new Client({ name: 't', version: '1' });
    const env = { ...process.env, ...cfg.env }; delete env.NODE_TLS_REJECT_UNAUTHORIZED; // the bridge must trust the app's own certificate
    await client.connect(new StdioClientTransport({ command: cfg.command, args: cfg.args, env }));
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ['ssh_exec', 'read_document', 'create_pdf', 'web_search', 'arduino_compile', 'segment_image', 'robot_drive']) assert.ok(names.includes(n), n);
    const r = await client.callTool({ name: 'ssh_exec', arguments: { server: 'testbox', command: 'echo bridged' } });
    assert.ok(/bridged/.test(r.content[0].text), JSON.stringify(r));
    const r2 = await client.callTool({ name: 'view_image', arguments: { path: path.join(__dirname, 'sample.jpg') } });
    assert.ok(r2.content.some((x) => x.type === 'image'), 'image returned to Muse Code');
    await client.close();
  });

  await step('SSH keys: generate, install on the server, then log in with the key (password removed)', async () => {
    const k = await api('/api/keys/generate', { name: 'test-key-1' });
    assert.ok(k.public.startsWith('ssh-ed25519 ') && k.fingerprint.startsWith('SHA256:'));
    const keys = await api('/api/keys');
    assert.ok(keys.some((x) => x.id === k.id && x.source === 'app'));
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
    assert.ok(saved.sshKeys[0].private.startsWith('aes:') && !JSON.stringify(saved).includes('OPENSSH PRIVATE'), 'private key encrypted');
    assert.strictEqual((await api('/api/settings')).sshKeys, undefined, 'keys never sent to the UI');
    const r = await api(`/api/servers/${server.id}/install-key`, { keyId: k.id, use: true, removePassword: true });
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(fs.readFileSync(path.join(sshHome, '.ssh', 'authorized_keys'), 'utf8').includes(k.public.split(' ')[1]));
    const s2 = srv.store.settings.servers.find((x) => x.id === server.id);
    assert.strictEqual(s2.keyId, k.id); assert.ok(!s2.password, 'password removed');
    srv.remote.disconnect(server.id);
    const t = await api(`/api/servers/${server.id}/test`, {});
    assert.ok(t.ok, `key login works: ${t.error}`);
    await assert.rejects(api(`/api/keys/${k.id}`, null, 'DELETE'), /used by a server/);
  });

  await step('remote terminal: open a shell, run a command, close', async () => {
    const r = await api(`/api/servers/${server.id}/shell`, {});
    assert.ok(r.id, JSON.stringify(r));
    const x = await api(`/api/shells/${r.id}`, { input: 'echo term-$((6*7))', waitMs: 3000 });
    assert.ok(/term-42/.test(x.output), x.output);
    assert.ok((await api(`/api/shells/${r.id}`, null, 'DELETE')).ok);
    // the terminal session is saved as a chat on that server, and can be continued later
    assert.ok(r.convId, 'terminal saved as chat');
    const c = await api(`/api/convs/${r.convId}`);
    assert.strictEqual(c.source, 'terminal'); assert.strictEqual(c.remote.serverId, server.id);
    assert.ok(c.messages.some((m) => /echo term-/.test(m.text)) && c.messages.some((m) => /term-42/.test(m.text)), JSON.stringify(c.messages));
    const list = await api('/api/convs');
    assert.ok((list.convs || list).find((x) => x.id === r.convId).remote, 'chat list shows remote');
    const r2 = await api(`/api/servers/${server.id}/shell`, { convId: r.convId });
    assert.strictEqual(r2.convId, r.convId, 'reopened in the same chat');
    await api(`/api/shells/${r2.id}`, null, 'DELETE');
    // a normal chat started on a server keeps it
    const n = await api('/api/convs', { remote: { serverId: server.id, path: '/tmp' } });
    assert.strictEqual((await api(`/api/convs/${n.id}`)).remote.path, '/tmp');
  });

  await step('GitHub plugin: connect (token encrypted), create repo, release with installer upload, issue', async () => {
    await assert.rejects(api('/api/github/connect', { token: 'wrong' }), /refused/);
    const g = await api('/api/github/connect', { token: 'ghp_test' });
    assert.strictEqual(g.login, 'msrusu87'); assert.strictEqual(g.email, 'm@example.com');
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
    assert.ok(saved.github.token.startsWith('aes:') && !JSON.stringify(saved).includes('ghp_test'));
    assert.deepStrictEqual((await api('/api/settings')).github, { connected: true, login: 'msrusu87', name: 'Mircea', email: 'm@example.com' });
    const { execGitHub } = require('../backend/github');
    const ctx = srv.agent.toolCtx({ id: 'x', workspace: ws }, { abort: new AbortController() });
    assert.ok(/qubitpage/.test(await execGitHub('github_account', {}, ctx)));
    assert.ok(/msrusu87\/robot-app \(private\)/.test(await execGitHub('github_create_repo', { name: 'robot-app' }, ctx)));
    fs.writeFileSync(path.join(ws, 'Setup.exe'), Buffer.alloc(300000, 7));
    const rel = await execGitHub('github_release', { repo: 'msrusu87/robot-app', tag: 'v1.0.0', notes: '# First', files: ['Setup.exe'] }, ctx);
    assert.ok(/Uploaded Setup\.exe/.test(rel) && /releases\/latest\/download/.test(rel), rel);
    assert.strictEqual(gh.assets[0].size, 300000);
    assert.strictEqual(gh.releases[0].tag_name, 'v1.0.0');
    assert.ok(/#12/.test(await execGitHub('github_issues', { repo: 'msrusu87/robot-app', action: 'create', title: 'Bug' }, ctx)));
    // publish a folder (git init, commit, push) and clone it back
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'mc14-git-'));
    fs.mkdirSync(path.join(bare, 'msrusu87'));
    require('child_process').execSync(`git init --bare -q -b main ${path.join(bare, 'msrusu87', 'robot-app.git')}`);
    process.env.MC_GITHUB_GIT = `file://${bare}`;
    const proj = path.join(ws, 'robot-app'); fs.mkdirSync(proj); fs.writeFileSync(path.join(proj, 'README.md'), '# Robot app');
    const pub = await execGitHub('github_publish', { path: 'robot-app', repo: 'msrusu87/robot-app', message: 'First version' }, ctx);
    assert.ok(/Published/.test(pub), pub);
    const logOut = require('child_process').execSync(`git --git-dir=${path.join(bare, 'msrusu87', 'robot-app.git')} log --format=%an%n%ae%n%s main`).toString();
    assert.ok(/Mircea\nm@example\.com\nFirst version/.test(logOut), logOut);
    fs.writeFileSync(path.join(proj, 'b.txt'), 'two');
    assert.ok(/Published/.test(await execGitHub('github_publish', { path: 'robot-app', repo: 'msrusu87/robot-app', message: 'Second' }, ctx)));
    const cl = await execGitHub('github_clone', { repo: 'msrusu87/robot-app', path: 'clone-test' }, ctx);
    assert.ok(fs.existsSync(path.join(ws, 'clone-test', 'b.txt')), cl);
    const tools = srv.agent.bridgeTools().map((t) => t.name);
    assert.ok(tools.includes('github_publish') && tools.includes('ssh_key'));
  });

  await step('GitHub: sign in with the browser (OAuth device flow) connects automatically', async () => {
    await api('/api/github', null, 'DELETE');
    const d = await api('/api/github/device', { clientId: 'Ov23test' });
    assert.strictEqual(d.user_code, 'ABCD-1234');
    let st;
    for (let i = 0; i < 40; i++) { await sleep(250); st = await api('/api/github/device'); if (st.status !== 'pending') break; }
    assert.strictEqual(st.status, 'done', JSON.stringify(st));
    assert.strictEqual(st.info.login, 'msrusu87');
    assert.strictEqual((await api('/api/settings')).githubClientId, 'Ov23test');
  });

  await step('projects: create a project and put a chat in it (no browser prompt needed)', async () => {
    const p = await api('/api/projects', { name: 'EU funding' });
    const c = await conv();
    const r = await api(`/api/convs/${c.id}`, { projectId: p.id }, 'PATCH');
    assert.strictEqual(r.projectId, p.id);
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.ok(!/[^.\w]prompt\(/.test(appJs), 'no window.prompt in the UI (it does not work in Electron)');
  });

  await step('Muse engine: every method the app calls exists (guards against broken refactors)', async () => {
    const { MuseEngine } = require('../backend/engines/muse');
    const m = new MuseEngine({ getSettings: () => ({}), log: () => {} });
    const src = ['agent.js', 'server.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8')).join('\n');
    const used = new Set([...src.matchAll(/\.muse\.(\w+)\(/g)].map((x) => x[1]));
    for (const name of used) assert.strictEqual(typeof m[name], 'function', `MuseEngine.${name} missing`);
    assert.ok(used.size >= 8, [...used].join(','));
    assert.strictEqual(typeof MuseEngine.openInstaller, 'function');
    assert.strictEqual(await m.pickFullProfile(), null, 'no crash without Muse Code');
  });

  await step('PDF and screenshots report clearly outside the desktop app', async () => {
    const { execX } = require('../backend/xtools');
    const ctx = srv.agent.toolCtx({ id: 'x', workspace: ws }, { abort: new AbortController() });
    await assert.rejects(execX('create_pdf', { output_path: 'a.pdf', markdown: '# Hi' }, ctx), /desktop app/);
  });

  sock.close();
  await srv.close();
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
