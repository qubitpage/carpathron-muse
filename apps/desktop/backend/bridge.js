// MCP bridge: Muse Code (the "Meta account" engine) starts this small stdio MCP server, and every tool call is
// forwarded to the running Muse Carpathron app. So Muse Code gets the same extra tools as the API engine:
// SSH servers, documents and PDFs, screenshots, web search and research, Arduino, Muse Image, SAM 3.1, robot.
'use strict';
const fs = require('fs');
const https = require('https');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const URL_BASE = process.env.MC_URL || 'https://127.0.0.1:8443';
const TOKEN = process.env.MC_TOKEN || '';
const CONV = process.env.MC_CONV || '';
let ca;
try { ca = fs.readFileSync(process.env.MC_CA); } catch {}

function call(method, p, body, timeoutMs = 3600000) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, URL_BASE);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request(u, {
      method, ca, servername: 'localhost', checkServerIdentity: () => undefined,
      headers: { 'x-mc-token': TOKEN, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': data.length } : {}) },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        try { const j = JSON.parse(txt); if (res.statusCode >= 400) reject(new Error(j.error || `HTTP ${res.statusCode}`)); else resolve(j); }
        catch { reject(new Error(`Bad answer from Muse Carpathron (${res.statusCode})`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const server = new Server({ name: 'carpathron', version: '1.4.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const r = await call('GET', `/api/bridge/tools?conv=${encodeURIComponent(CONV)}`);
    return { tools: r.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters || { type: 'object', properties: {} } })) };
  });
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const r = await call('POST', '/api/bridge/call', { conv: CONV, name: req.params.name, args: req.params.arguments || {} });
      const content = [{ type: 'text', text: String(r.output ?? '') }];
      for (const im of r.images || []) content.push({ type: 'image', data: im.data, mimeType: im.mime || 'image/jpeg' });
      return { content, isError: !!r.isError };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  });
  await server.connect(new StdioServerTransport());
}
main().catch((e) => { process.stderr.write(`carpathron bridge failed: ${e.stack || e.message}\n`); process.exit(1); });
