// MCP client manager: starts configured MCP servers (stdio or http) and exposes their tools to the agent.
'use strict';
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const safe = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);

class McpManager {
  constructor({ log }) {
    this.log = log;
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
        if (!config.command) throw new Error('missing "command"');
        transport = new StdioClientTransport({
          command: config.command,
          args: Array.isArray(config.args) ? config.args.map(String) : [],
          env: { ...process.env, ...(config.env || {}) },
          cwd: config.cwd || undefined,
          stderr: 'pipe',
        });
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
      entry.error = e.message;
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

module.exports = { McpManager };
