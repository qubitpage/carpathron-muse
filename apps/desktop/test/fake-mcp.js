// Minimal real MCP server (stdio) used by the tests.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const server = new McpServer({ name: 'echo', version: '1.0.0' });
server.tool('shout', 'Return the text in upper case', { text: z.string() }, async ({ text }) => ({ content: [{ type: 'text', text: String(text).toUpperCase() + '!!' }] }));
server.connect(new StdioServerTransport());
