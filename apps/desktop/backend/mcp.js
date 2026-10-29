// MCP client manager: starts configured MCP servers (stdio or http) and exposes their tools to the agent.
'use strict';
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const safe = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);

// MCP servers that ship inside the app and run on its built-in Node (no Node.js install needed).
const BUILTIN_MCP = {
  filesystem: { pkg: '@modelcontextprotocol/server-filesystem', about: 'Read, write, search and move files in the folders you allow' },
  memory: { pkg: '@modelcontextprotocol/server-memory', about: 'A knowledge graph the agent can store facts in and query' },
  'sequential-thinking': { pkg: '@modelcontextprotocol/server-sequential-thinking', about: 'Step-by-step thinking tool for planning hard problems' },
};
let nodeOnPath;
function hasNode() {
  if (nodeOnPath !== undefined) return nodeOnPath;
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', ['node'], { stdio: 'ignore', windowsHide: true }); nodeOnPath = true; } catch { nodeOnPath = false; }
  return nodeOnPath;
}
// Turns a config entry into something that can be started: built-in servers and "node" without Node.js
// installed run on the app's own runtime (Electron as Node).
function resolveServer(config, { dataDir } = {}) {
  if (config.url) return { ...config };
  const runAsNode = { ELECTRON_RUN_AS_NODE: '1' };
  if (config.builtin) {
    const b = BUILTIN_MCP[config.builtin];
    if (!b) throw new Error(`unknown built-in MCP server "${config.builtin}" (available: ${Object.keys(BUILTIN_MCP).join(', ')})`);
    const entry = path.join(path.dirname(require.resolve(`${b.pkg}/package.json`)), 'dist', 'index.js');
    const env = { ...runAsNode, ...(config.env || {}) };
    let args = Array.isArray(config.args) ? config.args.map(String) : [];
    if (config.builtin === 'filesystem' && !args.length) args = [path.join(os.homedir(), 'MuseCarpathron')];
    if (config.builtin === 'memory' && !env.MEMORY_FILE_PATH && dataDir) env.MEMORY_FILE_PATH = path.join(dataDir, 'mcp-memory.jsonl');
    for (const a of args) if (config.builtin === 'filesystem') { try { fs.mkdirSync(a, { recursive: true }); } catch {} }
    return { command: process.execPath, args: [entry, ...args], env, cwd: config.cwd };
  }
  if (!config.command) throw new Error('missing "command"');
  if (/^node(\.exe)?$/i.test(config.command) && !hasNode()) return { ...config, command: process.execPath, env: { ...runAsNode, ...(config.env || {}) } };
  return { ...config };
}

class McpManager {
  constructor({ log, dataDir }) {
    this.log = log;
    this.dataDir = dataDir;
    this.servers = new Map(); // name -> { client, tools, status, error, config }
  }

  // config: { name: { command, args, env, cwd, url, enabled } }
  async sync(config = {}) {
    const wanted = new Map(Object.entries(config).filter(([, c]) => c && c.enabled !== false));
    for (const [name, s] of this.servers) {
      if (!wanted.has(name) || JSON.stringify(wanted.get(name)) !== JSON.stringify(s.config)) await this.stopOne(name);
    }
    await Promise.all([...wanted].filter(([n]) => !this.servers.has(n)).map(([n, c]) => this.startOne(n, c)));
  }

  async startOne(name, config) {
    const entry = { config, client: null, tools: [], status: 'starting', error: '' };
    this.servers.set(name, entry);
    try {
      const client = new Client({ name: 'muse-carpathron', version: '1.0.0' });
      let transport;
      if (config.url) {
        transport = new StreamableHTTPClientTransport(new URL(config.url), config.headers ? { requestInit: { headers: config.headers } } : undefined);
      } else {
        const r = resolveServer(config, { dataDir: this.dataDir });
        transport = new StdioClientTransport({
          command: r.command,
          args: Array.isArray(r.args) ? r.args.map(String) : [],
          env: { ...process.env, ...(r.env || {}) },
          cwd: r.cwd || undefined,
          stderr: 'pipe',
        });
        let errTail = '';
        transport.stderr?.on('data', (d) => { errTail = (errTail + d).slice(-600); });
        entry.stderrTail = () => errTail;
      }
      await Promise.race([
        client.connect(transport),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 30 s')), 30000)),
      ]);
      const { tools } = await client.listTools();
      entry.client = client;
      entry.tools = tools || [];
      entry.status = 'ready';
      this.log(`MCP "${name}" ready (${entry.tools.length} tools)`);
    } catch (e) {
      entry.status = 'error';
      const tail = entry.stderrTail ? entry.stderrTail().trim() : '';
      entry.error = /ENOENT/.test(e.message) && config.command ? `"${config.command}" was not found on this PC${/^npx|^npm|^node/i.test(config.command) ? ' — install Node.js (nodejs.org) or use a built-in server' : ''}` : e.message + (tail ? ` — ${tail.split('\n').slice(-2).join(' ')}` : '');
      this.log(`MCP "${name}" failed: ${e.message}`);
    }
  }

  async stopOne(name) {
    const s = this.servers.get(name);
    this.servers.delete(name);
    if (s && s.client) { try { await s.client.close(); } catch {} }
  }

  status() {
    return [...this.servers].map(([name, s]) => ({ name, status: s.status, error: s.error, tools: s.tools.map((t) => t.name) }));
  }

  // The configured stdio servers in Muse Code's session format, so Meta-account chats get them too.
  museServers(config = {}) {
    const out = {};
    for (const [name, c] of Object.entries(config)) {
      if (!c || c.enabled === false || c.url) continue;
      try { const r = resolveServer(c, { dataDir: this.dataDir }); out[safe(name)] = { transport: 'stdio', command: r.command, args: (r.args || []).map(String), env: r.env || {}, mode: 'optional' }; }
      catch {}
    }
    return out;
  }

  // Tool specs for the agent: name -> mcp__server__tool
  toolSpecs() {
    const out = [];
    for (const [name, s] of this.servers) {
      if (s.status !== 'ready') continue;
      for (const t of s.tools) {
        out.push({
          name: `mcp__${safe(name)}__${safe(t.name)}`.slice(0, 64),
          risk: t.annotations?.readOnlyHint ? 'read' : 'external',
          description: `[MCP ${name}] ${t.description || t.name}`.slice(0, 1000),
          parameters: t.inputSchema && t.inputSchema.type === 'object' ? t.inputSchema : { type: 'object', properties: {} },
          _mcp: { server: name, tool: t.name },
        });
      }
    }
    return out;
  }

  async call(server, tool, args) {
    const s = this.servers.get(server);
    if (!s || s.status !== 'ready') throw new Error(`MCP server "${server}" is not running`);
    const res = await s.client.callTool({ name: tool, arguments: args || {} }, undefined, { timeout: 300000 });
    const parts = (res.content || []).map((c) => {
      if (c.type === 'text') return c.text;
      if (c.type === 'resource') return c.resource?.text ?? `[resource ${c.resource?.uri}]`;
      if (c.type === 'image') return `[image ${c.mimeType}, ${Math.round((c.data || '').length * 0.75)} bytes]`;
      return `[${c.type}]`;
    });
    if (res.structuredContent && !parts.length) parts.push(JSON.stringify(res.structuredContent));
    const text = parts.join('\n') || '(no output)';
    if (res.isError) throw new Error(text);
    return text;
  }

  async closeAll() { for (const n of [...this.servers.keys()]) await this.stopOne(n); }
}

module.exports = { McpManager, BUILTIN_MCP, resolveServer };
