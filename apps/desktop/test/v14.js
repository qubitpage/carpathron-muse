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
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Parts').addRows([['Part', 'Price'], ['X15-450', 1139], ['RS-04', 211]]);
    await wb.xlsx.writeFile(path.join(ws, 'book.xlsx'));
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
    assert.ok(full.messages.some((m) => m.role === 'assistant' && /SAM 3\.1 found:\*\* cup ×1/.test(m.text)), JSON.stringify(full.messages.slice(-2)));
  });

  await step('image attachment goes to a vision model as an image (not as text)', async () => {
    const c = await conv();
    await sendMsg(c, 'what is in this picture', { attachments: [{ name: 'p.jpg', dataBase64: fs.readFileSync(path.join(__dirname, 'sample.jpg')).toString('base64') }] });
    const call = fake.calls().filter((x) => /You are Carpathron/.test(x.messages[0].content)).pop();
    const user = call.messages.find((m) => m.role === 'user' && Array.isArray(m.content));
    assert.ok(user && user.content.some((p) => p.type === 'image_url' && p.image_url.url.startsWith('data:image/jpeg')), 'image part sent');
  });

  await step('reasoning effort is sent to Muse Spark', async () => {
    const c = await conv();
    await api(`/api/convs/${c.id}`, { effort: 'high' }, 'PATCH');
    await sendMsg(c, 'hello effort');
    const last = fake.calls().pop();
    assert.strictEqual(last._wire, 'responses', 'the Responses API is used by default');
    assert.deepStrictEqual(last.reasoning, { effort: 'high', summary: 'auto' });
    const full = await api(`/api/convs/${c.id}`);
    assert.ok(full.messages.some((m) => m.role === 'thinking' && /Thinking about the request/.test(m.text || '')), 'reasoning summary shown');
  });

  await step('Meta API: falls back to Chat Completions when /v1/responses is refused, and tool calls work in both', async () => {
    fake.opts.noResponses = true;
    srv.agent.api.responsesBroken = false;
    try {
      const c = await conv();
      await api(`/api/convs/${c.id}`, { mode: 'full' }, 'PATCH');
      const full = await sendMsg(c, 'run echo please');
      assert.ok(/agent-ran/.test(toolMsg(full).output || ''), JSON.stringify(full.messages.slice(-3)));
      assert.ok(srv.agent.api.responsesBroken, 'remembered for the session');
      const last = fake.calls().pop();
      assert.ok(!last._wire && last.reasoning_effort === undefined, 'chat path used');
    } finally { fake.opts.noResponses = false; srv.agent.api.responsesBroken = false; }
    const c2 = await conv();
    await api(`/api/convs/${c2.id}`, { mode: 'full' }, 'PATCH');
    const full2 = await sendMsg(c2, 'run echo please');
    assert.ok(/agent-ran/.test(toolMsg(full2).output || ''), 'tool call through Responses');
    assert.strictEqual(fake.calls().pop()._wire, 'responses');
  });

  await step('photos, voice and SAM: image-only message, audio is transcribed, SAM answers questions and outlines objects', async () => {
    const jpg = fs.readFileSync(path.join(__dirname, 'sample.jpg')).toString('base64');
    // a photo with no text: the model gets a default question and the picture
    const c = await conv();
    await api(`/api/convs/${c.id}/send`, { text: '', attachments: [{ name: 'robot.jpg', dataBase64: jpg }] });
    await waitIdle(c.id);
    let last = fake.calls().pop();
    const u = last.messages[last.messages.length - 1];
    assert.ok(Array.isArray(u.content) && u.content.some((p) => p.type === 'image_url') && /What is in this picture/.test(u.content[0].text), JSON.stringify(u).slice(0, 300));
    // a voice message (16-bit WAV) with no text: transcribed, and the transcript is the request
    const n = 16000, w = Buffer.alloc(44 + n * 2);
    w.write('RIFF', 0); w.writeUInt32LE(36 + n * 2, 4); w.write('WAVE', 8); w.write('fmt ', 12); w.writeUInt32LE(16, 16); w.writeUInt16LE(1, 20); w.writeUInt16LE(1, 22); w.writeUInt32LE(16000, 24); w.writeUInt32LE(32000, 28); w.writeUInt16LE(2, 32); w.writeUInt16LE(16, 34); w.write('data', 36); w.writeUInt32LE(n * 2, 40);
    const c2 = await conv();
    await api(`/api/convs/${c2.id}/send`, { text: '', attachments: [{ name: 'voice-1201.wav', dataBase64: w.toString('base64') }] });
    await waitIdle(c2.id);
    const full2 = await api(`/api/convs/${c2.id}`);
    assert.ok(full2.messages.some((m) => m.role === 'info' && /voice-1201\.wav: “Look left”/.test(m.text || '')), JSON.stringify(full2.messages.map((m) => m.text)));
    last = fake.calls().pop();
    assert.ok(/^Look left/.test(String(last.messages[last.messages.length - 1].content)), 'transcript sent to the model');
    // SAM with a question: vision answers + names objects, SAM outlines them
    const c3 = await conv({ model: 'sam-3.1' });
    await api(`/api/convs/${c3.id}`, { model: 'sam-3.1' }, 'PATCH');
    await api(`/api/convs/${c3.id}/send`, { text: 'what is this', attachments: [{ name: 'carpathron.jpg', dataBase64: jpg }] });
    await waitIdle(c3.id);
    let m3 = (await api(`/api/convs/${c3.id}`)).messages.filter((m) => m.role === 'assistant').pop();
    assert.ok(/small white robot/.test(m3.text) && /SAM 3\.1 found:\*\* robot ×1, table ×1/.test(m3.text), m3.text);
    // SAM with a name it cannot find: a vision answer instead of "0 matches"
    await api(`/api/convs/${c3.id}/send`, { text: 'unicorn', attachments: [{ name: 'carpathron.jpg', dataBase64: jpg }] });
    await waitIdle(c3.id);
    m3 = (await api(`/api/convs/${c3.id}`)).messages.filter((m) => m.role === 'assistant').pop();
    assert.ok(/no unicorn here/.test(m3.text) && /found nothing for: unicorn/.test(m3.text), m3.text);
  });

  await step('WhatsApp: a photo and an audio file sent to the bot reach the agent', async () => {
    const sent = [];
    const saved = { cloudSend: srv.wa.cloudSend, cloudDownload: srv.wa.cloudDownload, cfg: srv.wa.cfg };
    srv.wa.cloudSend = async (to, t) => { sent.push(t); };
    srv.wa.cfg = () => ({ ...saved.cfg.call(srv.wa), allowed: ['+40 712 345 678'], cloud: { ...saved.cfg.call(srv.wa).cloud, enabled: true } });
    const jpg = fs.readFileSync(path.join(__dirname, 'sample.jpg'));
    srv.wa.cloudDownload = async (id) => jpg;
    try {
      await srv.wa.cloudReceive({ entry: [{ changes: [{ value: { messages: [{ from: '40712345678', type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'what is this?' } }] } }] }] });
      for (let i = 0; i < 100 && !sent.some((t) => /I can see the photo/.test(t)); i++) await sleep(50);
      assert.ok(sent.some((t) => /Got the photo/.test(t)) && sent.some((t) => /I can see the photo \(data:image\/jpeg;base64/.test(t)), JSON.stringify(sent));
    } finally { Object.assign(srv.wa, saved); }
  });

  await step('long conversations: full history is kept up to the context budget, then old turns are dropped safely', async () => {
    const { compactHistory, toResponsesInput } = require('../backend/engines/api');
    const big = 'x'.repeat(50000);
    const mk = (n) => {
      const l = [{ role: 'system', content: 'sys' }];
      for (let i = 0; i < n; i++) l.push({ role: 'user', content: `q${i}` }, { role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] }, { role: 'tool', tool_call_id: `c${i}`, content: big }, { role: 'assistant', content: `a${i}` });
      return l;
    };
    const keep = mk(20); compactHistory(keep, 700000);
    assert.strictEqual(keep.filter((m) => m.content === big).length, 20, '1 MB history stays complete under a 700k-token budget');
    const cut = mk(60); compactHistory(cut, 100000);
    assert.ok(JSON.stringify(cut).length <= 100000 * 3.5, 'fits the budget');
    assert.strictEqual(cut[0].role, 'system');
    assert.ok(cut.some((m) => m.content === 'q59') && cut.some((m) => m.content === 'a59'), 'latest turn kept');
    const ids = new Set(cut.filter((m) => m.tool_calls).flatMap((m) => m.tool_calls.map((c) => c.id)));
    assert.ok(cut.filter((m) => m.role === 'tool').every((m) => ids.has(m.tool_call_id)), 'no orphan tool results');
    const r = toResponsesInput(cut);
    assert.strictEqual(r.instructions, 'sys');
    assert.ok(r.input.some((i) => i.type === 'function_call_output') && r.input.some((i) => i.type === 'function_call'));
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
    // a line typed at a password prompt is never saved in the chat or sent to the model
    await api(`/api/shells/${r2.id}`, { input: "printf 'Password for me@example.com: '; read -s P; echo; echo got-${#P}", waitMs: 1500 });
    const y = await api(`/api/shells/${r2.id}`, { input: 'hunter2-very-secret', waitMs: 1500 });
    assert.ok(/got-19/.test(y.output), y.output);
    const c2 = await api(`/api/convs/${r.convId}`);
    assert.ok(!JSON.stringify(c2).includes('hunter2-very-secret'), 'password stored in the chat');
    assert.ok(c2.messages.some((m) => /typed at a password prompt — not saved/.test(m.text || '')));
    assert.ok(!JSON.stringify(srv.store.get(r.convId).llm || []).includes('hunter2-very-secret'), 'password in model context');
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

  await step('GitHub: browser sign-in with the GitHub CLI runs in the background and shows the code in the app', async () => {
    await api('/api/github', null, 'DELETE');
    const fake = path.join(dataDir, 'fake-gh.js');
    fs.writeFileSync(fake, `#!/usr/bin/env node
const a = process.argv.slice(2).join(' ');
if (a === '--version') { console.log('gh version 9.9.9 (test)'); process.exit(0); }
if (a.startsWith('auth token')) { if (process.env.GH_TOKEN) { console.log('env-token-leaked'); process.exit(0); } console.log('ghp_test'); process.exit(0); }
if (a.startsWith('auth login')) {
  if (process.env.GH_TOKEN) { console.error('The value of the GH_TOKEN environment variable is being used'); process.exit(1); }
  process.stderr.write('\\n! One-time code (WXYZ-9876) copied to clipboard\\nOpen this URL to continue in your web browser: https://github.com/login/device\\n');
  setTimeout(() => { console.error('✓ Logged in as msrusu87'); process.exit(0); }, 1500);
} else process.exit(2);
`, { mode: 0o755 });
    process.env.MC_GH_BIN = fake;
    process.env.GH_TOKEN = 'should-be-ignored';
    try {
      let st = await api('/api/github/gh/start', {});
      for (let i = 0; i < 20 && st.status !== 'code'; i++) { await new Promise((r) => setTimeout(r, 200)); st = await api('/api/github/gh/start'); }
      assert.strictEqual(st.code, 'WXYZ-9876', JSON.stringify(st));
      assert.strictEqual(st.url, 'https://github.com/login/device');
      for (let i = 0; i < 30 && st.status !== 'done'; i++) { await new Promise((r) => setTimeout(r, 200)); st = await api('/api/github/gh/start'); }
      assert.strictEqual(st.status, 'done', JSON.stringify(st));
      assert.strictEqual(st.login, 'msrusu87');
      assert.strictEqual((await api('/api/settings')).github.login, 'msrusu87');
    } finally { delete process.env.MC_GH_BIN; delete process.env.GH_TOKEN; }
  });

  await step('MCP: built-in servers (filesystem, memory, sequential-thinking) start with no Node.js install and their tools run', async () => {
    const st = await api('/api/mcp');
    assert.deepStrictEqual(Object.keys(st.config).sort(), ['filesystem', 'memory', 'sequential-thinking'], 'seeded on first run');
    let list = srv.mcp.status();
    for (let i = 0; i < 100 && list.some((x) => x.status === 'starting'); i++) { await new Promise((r) => setTimeout(r, 200)); list = srv.mcp.status(); }
    for (const x of list) assert.strictEqual(x.status, 'ready', `${x.name}: ${x.error}`);
    const fsDir = st.config.filesystem.args[0];
    fs.mkdirSync(fsDir, { recursive: true }); fs.writeFileSync(path.join(fsDir, 'mcp-hello.txt'), 'hello from mcp');
    assert.ok(/hello from mcp/.test(await srv.mcp.call('filesystem', 'read_text_file', { path: path.join(fsDir, 'mcp-hello.txt') })));
    await srv.mcp.call('memory', 'create_entities', { entities: [{ name: 'Carpathron', entityType: 'robot', observations: ['ESP32-CAM car'] }] });
    assert.ok(/ESP32-CAM car/.test(await srv.mcp.call('memory', 'read_graph', {})));
    const think = srv.mcp.status().find((x) => x.name === 'sequential-thinking');
    assert.ok(think.tools.length >= 1);
    assert.ok(srv.agent.tools ? true : true);
    // Muse Code sessions get the same servers
    const ms = srv.mcp.museServers(st.config);
    assert.deepStrictEqual(Object.keys(ms).sort(), ['filesystem', 'memory', 'sequential-thinking']);
    assert.strictEqual(ms.memory.env.ELECTRON_RUN_AS_NODE, '1');
    // a server whose program is missing reports it clearly
    await api('/api/settings', { mcpServers: { ...st.config, broken: { command: 'npx-does-not-exist', args: [] } } });
    for (let i = 0; i < 50; i++) { const b = srv.mcp.status().find((x) => x.name === 'broken'); if (b && b.status !== 'starting') break; await new Promise((r) => setTimeout(r, 200)); }
    const broken = srv.mcp.status().find((x) => x.name === 'broken');
    assert.ok(broken.status === 'error' && /not found|ENOENT|spawn/i.test(broken.error), JSON.stringify(broken));
    await api('/api/settings', { mcpServers: st.config });
  });

  await step('tasks: the agent keeps a task list and keeps working until every task is done, then checks its work', async () => {
    const c = await conv(); await api(`/api/convs/${c.id}`, { mode: 'auto' }, 'PATCH');
    const full = await sendMsg(c, 'make tasks for the job');
    assert.deepStrictEqual(full.tasks.map((t) => t.status), ['done', 'done'], JSON.stringify(full.tasks));
    assert.ok(full.messages.some((m) => m.role === 'info' && /not finished yet/.test(m.text)), 'auto-continued');
    assert.ok(events.some((e) => e.event === 'tasks:update' && e.data.convId === c.id));
    // task_update is "read" risk: no self-check needed; a turn that changed something gets one
    const w = await sendMsg(c, 'write hello again');
    assert.ok(w.messages.some((m) => m.role === 'info' && /Checking the work/.test(m.text)), 'self-check ran');
    assert.ok(w.messages.some((m) => m.role === 'assistant' && m.draft), 'first answer marked as draft');
    assert.strictEqual(w.messages.filter((m) => m.role === 'assistant').pop().text, 'Verified: everything checked.');
  });

  await step('messages while working: "now" joins the running work, "queue" runs after it', async () => {
    const c = await conv(); await api(`/api/convs/${c.id}`, { mode: 'auto' }, 'PATCH');
    await api(`/api/convs/${c.id}/send`, { text: 'short wait please' });
    await waitFor((e) => e.event === 'turn:state' && e.data.convId === c.id && e.data.running);
    const now = await api(`/api/convs/${c.id}/send`, { text: 'also say banana', when: 'now' });
    assert.ok(now.busy && now.when === 'now', JSON.stringify(now));
    const q = await api(`/api/convs/${c.id}/send`, { text: 'write hello from the queue', when: 'queue' });
    assert.ok(q.busy && q.when === 'queue');
    let mid = await api(`/api/convs/${c.id}`);
    assert.strictEqual(mid.queue.length, 1);
    // a second queued message can be removed again
    await api(`/api/convs/${c.id}/send`, { text: 'never mind this one', when: 'queue' });
    mid = await api(`/api/convs/${c.id}`);
    await api(`/api/convs/${c.id}/queue/${mid.queue[1].id}`, null, 'DELETE');
    await waitIdle(c.id, 30000);   // first turn (with the steered message)
    let full = await api(`/api/convs/${c.id}`);
    assert.ok(full.messages.some((m) => m.role === 'user' && m.steered && /banana/.test(m.text)), 'steered message shown');
    assert.ok(full.messages.some((m) => m.role === 'assistant' && /also handled: also say banana/.test(m.text)), JSON.stringify(full.messages.map((m) => m.text)));
    await waitIdle(c.id, 30000);   // then the queued one runs by itself
    full = await api(`/api/convs/${c.id}`);
    assert.strictEqual(full.queue.length, 0);
    assert.ok(full.messages.some((m) => m.role === 'user' && /from the queue/.test(m.text)));
    assert.ok(!full.messages.some((m) => /never mind/.test(m.text || '')), 'removed message did not run');
    assert.ok(fs.existsSync(path.join(full.workspace, 'hello.txt')));
  });

  await step('stuck: repeating the same failing call gets a "change approach" note', async () => {
    const { Agent } = require('../backend/agent');
    const rt = {};
    const a = Object.create(Agent.prototype);
    assert.strictEqual(a.stuckNote(rt, 'read_file', { path: 'x' }, true, 'Error: nope'), 'Error: nope');
    assert.ok(/Do not repeat the same call/.test(a.stuckNote(rt, 'read_file', { path: 'x' }, true, 'Error: nope')));
    assert.strictEqual(a.stuckNote(rt, 'read_file', { path: 'y' }, false, 'ok'), 'ok');
    const s = require('../backend/agent').systemPrompt({}, { workspace: '/tmp', tasks: [] }, { tasks: [{ title: 'T1', status: 'pending' }], scratch: '/tmp/s' });
    assert.ok(/Never invent facts/.test(s) && /Test before delivery/.test(s) && /\[pending\] T1/.test(s) && /Scratch folder/.test(s));
  });

  await step('computer use: screenshot, clicks mapped from picture to screen pixels, keys, windows (stand-in desktop helper)', async () => {
    const logf = path.join(dataDir, 'desktop.log');
    process.env.MC_DESKTOP_HELPER = path.join(__dirname, 'fake-desktop.js');
    process.env.FAKE_DESKTOP_LOG = logf;
    const { execComputer, desktop } = require('../backend/computer');
    const photos = [];
    const ctx = { dataDir, onPhoto: (p) => photos.push(p), computerState: {} };
    try {
      await assert.rejects(execComputer('computer_act', { action: 'click', x: 1, y: 1 }, ctx), /screenshot first/);
      let r = await execComputer('computer_view', { action: 'screenshot' }, ctx);
      assert.ok(/1366x768/.test(r) && /scaled 50%/.test(r) && photos.length === 1, r);
      r = await execComputer('computer_act', { action: 'double_click', x: 683, y: 384 }, ctx);
      assert.ok(/Done: double click at 683,384/.test(r) && photos.length === 2, r);
      r = await execComputer('computer_act', { action: 'key', keys: 'ctrl+s', screenshot: false }, ctx);
      r = await execComputer('computer_act', { action: 'type', text: 'héllo\nworld', screenshot: false }, ctx);
      r = await execComputer('computer_act', { action: 'focus_window', window: 'notepad', screenshot: false }, ctx);
      assert.ok(/focused "Untitled - Notepad"/.test(r), r);
      await assert.rejects(execComputer('computer_act', { action: 'focus_window', window: 'nope' }, ctx), /No window matches "nope"/);
      r = await execComputer('computer_view', { action: 'list_windows' }, ctx);
      assert.ok(/"Untitled - Notepad" — notepad at 50,50 size 400x300/.test(r), r);
      await assert.rejects(execComputer('computer_act', { action: 'key', keys: 'ctrl+banana' }, ctx), /unknown key "banana"/);
      const ops = fs.readFileSync(logf, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const click = ops.find((o) => o.op === 'click');
      assert.deepStrictEqual([click.x, click.y, click.count, click.button], [1366, 768, 2, 'left'], 'picture px → screen px');
      assert.deepStrictEqual(ops.find((o) => o.op === 'combo'), { id: ops.find((o) => o.op === 'combo').id, op: 'combo', vks: '17,83', ext: '0,0' });
      assert.strictEqual(ops.find((o) => o.op === 'type').text, 'héllo\nworld');
      assert.strictEqual(ops.find((o) => o.op === 'focus').hwnd, 42);
    } finally { desktop.stop(); delete process.env.MC_DESKTOP_HELPER; }
    // the agent offers these tools, with actions needing approval in Ask mode
    const specs = srv.agent.toolSpecs({ id: 'x', workspace: dataDir });
    const by = Object.fromEntries(specs.map((t) => [t.name, t.risk]));
    assert.deepStrictEqual([by.computer_view, by.computer_act, by.browser_view, by.browser_act], ['read', 'external', 'read', 'external']);
  });

  await step('security_check: server findings, website certificate/headers/exposed files; ask_model; dev tools', async () => {
    const { analyseServer, securityCheck } = require('../backend/devtools');
    const sample = ['== OS', 'Ubuntu 22.04.4 LTS', '== LISTENING', 'tcp 0.0.0.0:22 users:(("sshd"))', 'tcp 0.0.0.0:6379 users:(("redis"))', 'tcp 127.0.0.1:5432 users:(("postgres"))', '== FIREWALL', 'Status: inactive',
      '== SSHD', 'permitrootlogin yes', 'passwordauthentication yes', '== UPDATES', '4', '20', '== AUTOUPDATES', '0', '== FAIL2BAN', 'inactive', '== SUDO_NOPASSWD', '== USERS_SHELL', 'root ubuntu', '== DOCKER', '== WEBROOT', '/var/www/site/.env', '== DISK', '/dev/sda1 50G 47G 3G 95% /', '== REBOOT', 'required'].join('\n');
    const f = analyseServer(sample).findings.join('\n');
    for (const re of [/✗ Redis listens on all interfaces/, /✗ No active firewall/, /✗ SSH allows root login/, /⚠ SSH password login is enabled/, /✗ 4 security updates pending/, /⚠ fail2ban is not running/, /✗ Sensitive files inside a web root/, /⚠ Disk almost full \(95%\)/, /⚠ A reboot is required/]) assert.ok(re.test(f), `${re} in\n${f}`);
    assert.ok(!/PostgreSQL listens/.test(f), 'localhost-only database is fine');
    // a small website with a leaked .env and .git, no security headers
    const http = require('http');
    const site = http.createServer((req, res) => {
      if (req.url === '/.env') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('DB_PASSWORD=secret'); }
      if (req.url === '/.git/HEAD') { res.writeHead(200); return res.end('ref: refs/heads/main'); }
      if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html', Server: 'nginx/1.18.0', 'X-Powered-By': 'PHP/7.4' }); return res.end('<html>hi</html>'); }
      res.writeHead(404); res.end('<html>not found</html>');
    });
    await new Promise((r) => site.listen(18655, '127.0.0.1', r));
    try {
      const r = await securityCheck({ url: 'http://127.0.0.1:18655/' }, { status: () => {} });
      assert.ok(/✗ Publicly readable: .*\/\.git\/HEAD/.test(r) && /\/\.env/.test(r), r);
      assert.ok(/Missing security headers: HSTS/.test(r) && /Server reveals versions/.test(r), r);
      assert.ok(/Summary: \d+ critical/.test(r));
    } finally { site.close(); }
    // the same check on a real SSH server (the test server runs the commands in a local shell)
    const sr = await securityCheck({ server: 'testbox' }, { remote: srv.remote, status: () => {} });
    assert.ok(/## Server testbox/.test(sr) && /Summary:/.test(sr), sr);
    // ask another model (through the Meta API)
    const { execDev } = require('../backend/devtools');
    const am = await execDev('ask_model', { model: 'muse-wonder-1.0', prompt: 'review this' }, { api: srv.agent.api, status: () => {} });
    assert.ok(/muse-wonder-1.0 answered:[\s\S]*Hello from fake Muse/.test(am), am);
    await assert.rejects(execDev('ask_model', { model: 'muse-image-1.0', prompt: 'x' }, { api: srv.agent.api }), /not a text model/);
    const env = await execDev('dev_environment', { network: false }, { dataDir, settings: {} });
    assert.ok(/## IDEs and tools/.test(env) && /## NVIDIA/.test(env) && /## Connected boards/.test(env), env);
    const mp = await execDev('micropython', { action: 'devices' }, { workspace: dataDir });
    assert.ok(/mpremote is not installed|devices|\/dev|No MicroPython/i.test(mp), mp);
    // erasing a drive always asks the user, even in Full mode
    const c = await conv(); await api(`/api/convs/${c.id}`, { mode: 'full' }, 'PATCH');
    const cv = srv.store.get(c.id);
    const p = srv.agent.requestApproval(cv, { summary: 'ERASE disk 3', risk: 'external', tool: 'sd_card_image', always: true });
    const ap = cv.messages.find((m) => m.role === 'approval');
    assert.ok(ap && ap.choices.length === 2, 'approval card shown in Full mode');
    srv.agent.decide(ap.approvalId, 'deny');
    assert.strictEqual((await p).approved, false);
    const auto = await srv.agent.requestApproval(cv, { summary: 'write', risk: 'external', tool: 'write_file' });
    assert.ok(auto.approved && auto.auto, 'normal actions stay automatic in Full mode');
  });

  await step('step limit: Auto/Full keep going past the checkpoint until done; no progress or the safety limit stops; Ask pauses', async () => {
    await api('/api/settings', { maxSteps: 3, maxTotalSteps: 9 });
    try {
      const c = await conv(); await api(`/api/convs/${c.id}`, { mode: 'full' }, 'PATCH');
      let full = await sendMsg(c, 'loop forever please');
      const tools = full.messages.filter((m) => m.role === 'tool').length;
      assert.ok(tools >= 9, `kept going past 3 steps (${tools} tool calls)`);
      assert.ok(full.messages.some((m) => m.role === 'info' && /still working/.test(m.text)), 'checkpoint note');
      assert.ok(full.messages.some((m) => m.role === 'info' && /safety limit of 9 steps/.test(m.text)), JSON.stringify(full.messages.filter((m) => m.role === 'info').map((m) => m.text)));
      const c2 = await conv(); await api(`/api/convs/${c2.id}`, { mode: 'auto' }, 'PATCH');
      full = await sendMsg(c2, 'always fail please');
      assert.ok(full.messages.some((m) => m.role === 'info' && /made no progress/.test(m.text)), 'stops when only errors');
      assert.ok(full.messages.filter((m) => m.role === 'tool').length <= 4);
      const c3 = await conv(); await api(`/api/convs/${c3.id}`, { mode: 'ask' }, 'PATCH');
      await api(`/api/convs/${c3.id}/send`, { text: 'loop forever please' });
      for (let i = 0; i < 3; i++) {   // approve the 3 commands
        const e = await waitFor((x) => x.event === 'approval:new' && x.data.convId === c3.id && !x._done && (x._done = true));
        await api(`/api/approvals/${e.data.approvalId}`, { choiceId: 'allow' });
      }
      await waitIdle(c3.id);
      full = await api(`/api/convs/${c3.id}`);
      assert.ok(full.messages.some((m) => m.role === 'info' && /Ask and Plan modes pause here/.test(m.text)));
    } finally { await api('/api/settings', { maxSteps: 100, maxTotalSteps: 1000 }); }
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
