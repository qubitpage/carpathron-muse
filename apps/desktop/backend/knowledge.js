// Local retrieval (RAG) without any cloud service: BM25 search over
//  - project knowledge files (chunked),
//  - long-term memory items,
//  - past conversations.
// Works offline, handles Romanian/English (diacritics folded), and stays light on RAM.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const STOP = new Set(('a an and are as at be by for from has have i in is it its of on or that the this to was were will with you your me my we our ' +
  'si sau de la in pe cu ce care este sunt un o al ai ale lui ei eu tu el ea noi voi nu da mai fi am ar asa cum').split(' '));

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 1 && t.length < 40 && !STOP.has(t));
}

class Bm25 {
  constructor(docs = []) { this.build(docs); }
  build(docs) {
    this.docs = docs;
    this.tf = docs.map((d) => { const m = new Map(); for (const t of tokenize(d.text)) m.set(t, (m.get(t) || 0) + 1); return m; });
    this.len = this.tf.map((m) => { let n = 0; for (const v of m.values()) n += v; return n; });
    this.avg = this.len.reduce((a, b) => a + b, 0) / (this.len.length || 1);
    this.df = new Map();
    for (const m of this.tf) for (const t of m.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
  }
  search(query, k = 5) {
    const q = [...new Set(tokenize(query))];
    if (!q.length || !this.docs.length) return [];
    const N = this.docs.length, k1 = 1.4, b = 0.75;
    const scores = [];
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (const t of q) {
        const f = this.tf[i].get(t);
        if (!f) continue;
        const idf = Math.log(1 + (N - this.df.get(t) + 0.5) / (this.df.get(t) + 0.5));
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * this.len[i] / (this.avg || 1)));
      }
      if (s > 0) scores.push([s, i]);
    }
    scores.sort((a, b) => b[0] - a[0]);
    return scores.slice(0, k).map(([score, i]) => ({ score: Math.round(score * 100) / 100, ...this.docs[i] }));
  }
}

function chunkText(text, size = 1200, overlap = 200) {
  const clean = String(text || '').replace(/\r\n/g, '\n');
  const out = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(clean.length, i + size);
    if (end < clean.length) {
      const nl = clean.lastIndexOf('\n', end);
      if (nl > i + size * 0.5) end = nl;
    }
    out.push({ start: i, text: clean.slice(i, end) });
    if (end >= clean.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out;
}

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.xml', '.html', '.htm', '.js', '.ts', '.jsx', '.tsx', '.py', '.c', '.cpp', '.h', '.hpp', '.ino', '.java', '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.ps1', '.bat', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.sql', '.css', '.scss', '.log', '.env', '.kt', '.swift', '.lua', '.r', '.m', '.tex']);

async function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(await fsp.readFile(file)));
    const { text } = await pdfText(doc, { mergePages: true });
    return text || '';
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ path: file });
    return r.value || '';
  }
  const buf = await fsp.readFile(file);
  if (!TEXT_EXT.has(ext) && buf.subarray(0, 8000).includes(0)) throw new Error('Unsupported binary file type');
  let t = buf.toString('utf8');
  if (ext === '.html' || ext === '.htm') t = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ');
  return t;
}

// ------------------------------------------------------------------ Projects
class Projects {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cache = new Map(); // id -> { meta, bm25 }
  }
  list() {
    const out = [];
    for (const id of fs.readdirSync(this.dir)) {
      try { out.push(this.meta(id)); } catch {}
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  meta(id) {
    const m = JSON.parse(fs.readFileSync(path.join(this.dir, id, 'project.json'), 'utf8'));
    return m;
  }
  saveMeta(m) {
    m.updatedAt = Date.now();
    fs.writeFileSync(path.join(this.dir, m.id, 'project.json'), JSON.stringify(m, null, 2));
    this.cache.delete(m.id);
    return m;
  }
  create({ name, instructions = '' }) {
    const id = crypto.randomUUID();
    fs.mkdirSync(path.join(this.dir, id, 'files'), { recursive: true });
    return this.saveMeta({ id, name: String(name || 'New project').slice(0, 80), instructions: String(instructions), files: [], createdAt: Date.now() });
  }
  update(id, patch) {
    const m = this.meta(id);
    if (typeof patch.name === 'string') m.name = patch.name.slice(0, 80);
    if (typeof patch.instructions === 'string') m.instructions = patch.instructions;
    return this.saveMeta(m);
  }
  remove(id) { fs.rmSync(path.join(this.dir, id), { recursive: true, force: true }); this.cache.delete(id); }

  async addFile(id, name, buffer) {
    const m = this.meta(id);
    const fid = crypto.randomUUID().slice(0, 8);
    const safeName = path.basename(String(name)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'file';
    const stored = path.join(this.dir, id, 'files', `${fid}-${safeName}`);
    await fsp.writeFile(stored, buffer);
    let text;
    try { text = await extractText(stored); }
    catch (e) { await fsp.unlink(stored).catch(() => {}); throw new Error(`${safeName}: ${e.message}`); }
    await fsp.writeFile(`${stored}.txt`, text);
    m.files.push({ id: fid, name: safeName, size: buffer.length, chars: text.length, addedAt: Date.now() });
    this.saveMeta(m);
    return m;
  }
  removeFile(id, fid) {
    const m = this.meta(id);
    const f = m.files.find((x) => x.id === fid);
    if (f) {
      for (const suffix of ['', '.txt']) try { fs.unlinkSync(path.join(this.dir, id, 'files', `${f.id}-${f.name}${suffix}`)); } catch {}
      m.files = m.files.filter((x) => x.id !== fid);
      this.saveMeta(m);
    }
    return m;
  }
  index(id) {
    const c = this.cache.get(id);
    if (c) return c;
    const m = this.meta(id);
    const docs = [];
    for (const f of m.files) {
      let text = '';
      try { text = fs.readFileSync(path.join(this.dir, id, 'files', `${f.id}-${f.name}.txt`), 'utf8'); } catch { continue; }
      for (const ch of chunkText(text)) docs.push({ file: f.name, text: ch.text, at: ch.start });
    }
    const entry = { meta: m, bm25: new Bm25(docs), totalChars: docs.reduce((a, d) => a + d.text.length, 0) };
    this.cache.set(id, entry);
    if (this.cache.size > 5) this.cache.delete(this.cache.keys().next().value);
    return entry;
  }
  search(id, query, k = 6) { return this.index(id).bm25.search(query, k); }
  // Small projects fit fully into the prompt (project knowledge); big ones use retrieval.
  fullTextIfSmall(id, limit = 24000) {
    const { meta, totalChars } = this.index(id);
    if (totalChars > limit) return null;
    return meta.files.map((f) => {
      try { return `### ${f.name}\n${fs.readFileSync(path.join(this.dir, id, 'files', `${f.id}-${f.name}.txt`), 'utf8')}`; } catch { return ''; }
    }).join('\n\n');
  }
}

// ------------------------------------------------------------------ Memory
class Memory {
  constructor(file) {
    this.file = file;
    try { this.items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.items = []; }
    this.bm25 = null;
  }
  save() { fs.writeFileSync(this.file, JSON.stringify(this.items, null, 2)); this.bm25 = null; }
  list() { return this.items; }
  add(text, source = 'user', convId = null) {
    text = String(text || '').trim().slice(0, 500);
    if (!text) throw new Error('empty memory');
    const dupe = this.items.find((m) => m.text.toLowerCase() === text.toLowerCase());
    if (dupe) return dupe;
    const m = { id: crypto.randomUUID().slice(0, 8), text, source, convId, createdAt: Date.now() };
    this.items.push(m);
    if (this.items.length > 1000) this.items.shift();
    this.save();
    return m;
  }
  update(id, text) { const m = this.items.find((x) => x.id === id); if (m) { m.text = String(text).slice(0, 500); this.save(); } return m; }
  remove(id) { const n = this.items.length; this.items = this.items.filter((m) => m.id !== id); if (n !== this.items.length) this.save(); return n !== this.items.length; }
  clear() { this.items = []; this.save(); }
  search(q, k = 8) {
    if (!this.bm25) this.bm25 = new Bm25(this.items.map((m) => ({ id: m.id, text: m.text })));
    return this.bm25.search(q, k);
  }
  // What goes into every prompt: newest first, within a character budget.
  promptBlock(budget = 4000, query = '') {
    // Augmented retrieval: the most relevant memories for this message first, then the newest ones.
    const chosen = new Map();
    if (query) for (const h of this.search(query, 12)) chosen.set(h.id, this.items.find((m) => m.id === h.id));
    for (const m of [...this.items].reverse()) { if (chosen.size >= 60) break; if (!chosen.has(m.id)) chosen.set(m.id, m); }
    const out = [];
    let used = 0;
    for (const m of chosen.values()) {
      if (!m) continue;
      if (used + m.text.length > budget) break;
      out.push(`- ${m.text}`);
      used += m.text.length + 3;
    }
    return out.join('\n');
  }
}

// ------------------------------------------------------------------ Skills (/slash commands)
class Skills {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); this.seed(); }
  seed() {
    if (fs.readdirSync(this.dir).length) return;
    const defaults = {
      review: ['Code review', 'Review the code in the workspace (or the files I name): find bugs, risky parts and missing tests. List findings by severity with file:line, then propose fixes. Do not change files unless I say so.'],
      explain: ['Explain simply', 'Explain the topic or code I give you in simple words, with a short example. Then list 3 key points.'],
      plan: ['Make a plan', 'Before doing anything, make a numbered step-by-step plan for my request, with risks and what you need from me. Wait for my OK before executing.'],
      robot: ['Robot demo', 'Run a short safe demo with the Baby Carpathron car: check robot_status, drive forward 1 s at 50, spin 90 degrees left, come back, stop. Report what happened.'],
    };
    for (const [name, [desc, body]] of Object.entries(defaults)) this.save({ name, description: desc, body });
  }
  list() {
    return fs.readdirSync(this.dir).filter((f) => f.endsWith('.md')).map((f) => this.read(f.slice(0, -3))).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }
  read(name) {
    try {
      const raw = fs.readFileSync(path.join(this.dir, `${name}.md`), 'utf8');
      const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      const meta = {};
      if (m) for (const l of m[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
      return { name, description: meta.description || '', body: (m ? m[2] : raw).trim() };
    } catch { return null; }
  }
  save({ name, description, body }) {
    name = String(name || '').toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!name) throw new Error('Skill name required');
    fs.writeFileSync(path.join(this.dir, `${name}.md`), `---\ndescription: ${String(description || '').replace(/\n/g, ' ')}\n---\n${String(body || '').trim()}\n`);
    return this.read(name);
  }
  remove(name) { try { fs.unlinkSync(path.join(this.dir, `${path.basename(name)}.md`)); return true; } catch { return false; } }
}

module.exports = { Bm25, tokenize, chunkText, extractText, Projects, Memory, Skills };
