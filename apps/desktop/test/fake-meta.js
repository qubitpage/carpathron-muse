// Fake OpenAI-compatible Meta Model API with streaming + tool calls, driven by keywords.
const http = require('http');
function plan(body) {
  const msgs = body.messages;
  const sys = msgs[0]?.content || '';
  const last = msgs[msgs.length - 1];
  const firstUser = [...msgs].reverse().find((m) => m.role === 'user')?.content || '';
  if (/long-term memory about the user\. From the exchange/.test(sys)) return { text: '{"facts":["User is building a robot named Baby Carpathron"]}' };
  if (last.role === 'user' && Array.isArray(last.content) && /robot car's camera/.test(last.content[0].text || '')) {
    const heads = last.content.filter((c) => /^Heading/.test(c.text || '')).map((c) => Number(c.text.match(/\d+/)[0]));
    return { text: JSON.stringify({ views: heads.map((h, i) => ({ heading: h, description: i === 0 ? 'a desk' : 'a wall', objects: i === 0 ? [{ name: 'chair', bearing: -10, distance_m: 1.2 }] : [{ name: 'wall', bearing: 0, distance_m: 2 }], free_m: i === 0 ? 1 : 2 })), room: 'small office', summary: 'Chair ahead at 1.2 m, walls around, open space to the right.' }) };
  }
  if (last.role === 'user' && Array.isArray(last.content)) {
    const img = last.content.find((c) => c.type === 'image_url');
    return { text: `I can see the photo (${img ? img.image_url.url.slice(0, 23) : 'none'}).` };
  }
  if (last.role === 'tool') return { text: `Done. Result: ${String(last.content).slice(0, 80)}` };
  if (/sub-agent of Muse Carpathron/.test(sys)) return { text: `Report for: ${firstUser.slice(0, 30)}` };
  const u = String(last.content);
  if (/write hello/i.test(u)) return { tool: ['write_file', { path: 'hello.txt', content: 'hi from agent' }] };
  if (/run echo/i.test(u)) return { tool: ['run_command', { command: 'echo agent-ran' }] };
  if (/please remember/i.test(u)) return { tool: ['memory_save', { fact: 'User favorite color is green' }] };
  if (/delegate/i.test(u)) return { tool: ['delegate', { tasks: [{ title: 'A', instructions: 'task alpha' }, { title: 'B', instructions: 'task beta' }] }] };
  if (/use mcp/i.test(u)) return { tool: ['mcp__echo__shout', { text: 'hello mcp' }] };
  if (/search project/i.test(u)) return { tool: ['knowledge_search', { query: 'zebra secret' }] };
  if (/old chats/i.test(u)) return { tool: ['search_chats', { query: 'pineapple' }] };
  if (/take a photo/i.test(u)) return { tool: ['robot_photo', { note: 'test' }] };
  if (/drive robot/i.test(u)) return { tool: ['robot_drive', { steps: [{ type: 'drive', left: 50, right: 50, ms: 300 }, { type: 'stop' }] }] };
  return { text: `Hello from fake Muse. You said: ${u.slice(0, 60)}. Memory in prompt: ${/favorite color/.test(sys) ? 'yes' : 'no'}` };
}
let calls = [];
const asr = [];
const server = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer test-key') { res.writeHead(401); return res.end('{"error":{"message":"bad key"}}'); }
    if (req.url.startsWith('/v1/asr/transcribe')) {
      asr.push(b.length);
      const ok = /muse-voice-transcribe-1\.0/.test(b) && b.includes('RIFF') && b.includes('WAVE') && /multipart\/form-data/.test(req.headers['content-type'] || '');
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(ok ? { sessionId: 's1', transcript: 'Look left', audioDurationMs: 1000, turns: [] } : { error: { message: 'bad request' } }));
    }
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'muse-spark-1.3' }, { id: 'muse-spark-test' }] })); }
    const body = JSON.parse(b);
    calls.push(body);
    const p = plan(body);
    const slow = /slow/i.test(String(body.messages[body.messages.length - 1].content));
    if (!body.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const message = p.tool ? { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: p.tool[0], arguments: JSON.stringify(p.tool[1]) } }] } : { role: 'assistant', content: p.text };
      return res.end(JSON.stringify({ choices: [{ message }] }));
    }
    const go = () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const ev = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    if (p.tool) {
      const args = JSON.stringify(p.tool[1]);
      ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + calls.length, function: { name: p.tool[0], arguments: '' } }] } }] });
      ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(0, 10) } }] } }] });
      ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(10) } }] } }] });
    } else {
      for (const part of p.text.match(/.{1,12}/gs)) ev({ choices: [{ delta: { content: part } }] });
    }
    res.end('data: [DONE]\n\n');
    };
    if (slow) setTimeout(go, 3000); else go();
  });
});
module.exports = { start: (port) => new Promise((r) => server.listen(port, () => r(server))), calls: () => calls, asr: () => asr };
