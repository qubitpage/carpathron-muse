// Fake OpenAI-compatible Meta Model API with streaming + tool calls, driven by keywords.
const http = require('http');
function plan(body) {
  const msgs = body.messages;
  const sys = msgs[0]?.content || '';
  const last = msgs[msgs.length - 1];
  const firstUser = [...msgs].reverse().find((m) => m.role === 'user')?.content || '';
  if (/Plan web research/.test(sys)) return { text: '{"queries":["carpathron robots price","carpathron news"]}' };
  if (/careful research analyst/.test(sys)) return { text: '# Report\n\nRobots are useful [1].\n\n## Sources\n[1] Carpathron — https://example.com/a' };
  if (/long-term memory about the user\. From the exchange/.test(sys)) return { text: '{"facts":["User is building a robot named Baby Carpathron"]}' };
  if (last.role === 'user' && Array.isArray(last.content) && /robot car's camera/.test(last.content[0].text || '')) {
    const heads = last.content.filter((c) => /^Heading/.test(c.text || '')).map((c) => Number(c.text.match(/\d+/)[0]));
    return { text: JSON.stringify({ views: heads.map((h, i) => ({ heading: h, description: i === 0 ? 'a desk' : 'a wall', objects: i === 0 ? [{ name: 'chair', bearing: -10, distance_m: 1.2 }] : [{ name: 'wall', bearing: 0, distance_m: 2 }], free_m: i === 0 ? 1 : 2 })), room: 'small office', summary: 'Chair ahead at 1.2 m, walls around, open space to the right.' }) };
  }
  if (last.role === 'user' && Array.isArray(last.content) && /Reply with JSON only: \{"answer"/.test(last.content[0].text || '')) return { text: '{"answer":"This is a small white robot.","objects":["robot","table"]}' };
  if (last.role === 'user' && Array.isArray(last.content) && /SAM found no/.test(last.content[0].text || '')) return { text: 'No, there is no unicorn here — it is a robot on a table.' };
  if (last.role === 'user' && Array.isArray(last.content)) {
    const img = last.content.find((c) => c.type === 'image_url');
    return { text: `I can see the photo (${img ? img.image_url.url.slice(0, 23) : 'none'}).` };
  }
  if (/loop forever/.test(String(firstUser))) return { tool: ['run_command', { command: 'echo step' }] };
  if (/always fail/.test(String(firstUser))) return { tool: ['read_file', { path: `missing-${msgs.length}.txt` }] };
  if (last.role === 'tool') return { text: `Done. Result: ${String(last.content).slice(0, 80)}` };
  if (/sub-agent of Carpathron/.test(sys)) return { text: `Report for: ${firstUser.slice(0, 30)}` };
  const u = String(last.content);
  if (/^\[Automatic check\]/.test(u)) return { tool: ['task_update', { tasks: [{ title: 'Step A', status: 'done' }, { title: 'Step B', status: 'done' }] }] };
  if (/^\[Automatic self-check/.test(u)) return { text: 'Verified: everything checked.' };
  if (/New message from the user while you were working/.test(u)) return { text: `Got it, also handled: ${u.split('\n').pop().slice(0, 40)}` };
  if (/make tasks/i.test(u)) return { tool: ['task_update', { tasks: [{ title: 'Step A', status: 'in_progress' }, { title: 'Step B', status: 'pending' }] }] };
  if (/medium wait/i.test(u)) return { tool: ['run_command', { command: process.platform === 'win32' ? 'Start-Sleep 6; echo waited' : 'sleep 6; echo waited' }] };
  if (/short wait/i.test(u)) return { tool: ['run_command', { command: process.platform === 'win32' ? 'Start-Sleep 2; echo waited' : 'sleep 2; echo waited' }] };
  if (/fail twice/i.test(u)) return { tool: ['read_file', { path: 'does-not-exist.txt' }] };
  if (/remote list/i.test(u)) return { tool: ['list_dir', { path: '.' }] };
  if (/remote write/i.test(u)) return { tool: ['write_file', { path: 'from-agent.txt', content: 'written over sftp' }] };
  if (/remote run/i.test(u)) return { tool: ['run_command', { command: 'echo remote-$((40+2)) && pwd' }] };
  if (/ssh exec/i.test(u)) return { tool: ['ssh_exec', { server: 'testbox', command: 'echo via-ssh-exec' }] };
  if (/long command/i.test(u)) return { tool: ['run_command', { command: 'sleep 60; echo never', timeout_seconds: 120 }] };
  if (/read the sheet/i.test(u)) return { tool: ['read_document', { path: 'book.xlsx' }] };
  if (/search the web/i.test(u)) return { tool: ['web_search', { query: 'carpathron robots' }] };
  if (/research this/i.test(u)) return { tool: ['deep_research', { question: 'carpathron robots', depth: 'quick' }] };
  if (/draw a logo/i.test(u)) return { tool: ['generate_image', { prompt: 'a robot logo', output_path: 'logo.png' }] };
  if (/find the cup/i.test(u)) return { tool: ['segment_image', { path: 'photo.jpg', prompt: 'cup' }] };
  if (/background job/i.test(u)) return { tool: ['job_start', { command: 'echo job-started; sleep 1; echo job-done' }] };
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
// Responses API agent request (not web search / SAM, which use /v1/responses too)?
function isAgentResponses(j) {
  if (j.model === 'sam-3.1') return false;
  if ((j.tools || []).some((t) => t.type === 'web_search')) return false;
  return true;
}
// Responses input items -> Chat Completions messages (so plan() and the tests read one format).
function fromInput(j) {
  const msgs = [];
  if (j.instructions) msgs.push({ role: 'system', content: j.instructions });
  for (const it of j.input || []) {
    if (it.type === 'function_call') {
      const last = msgs[msgs.length - 1];
      const call = { id: it.call_id, type: 'function', function: { name: it.name, arguments: it.arguments } };
      if (last && last.role === 'assistant' && last.tool_calls) last.tool_calls.push(call);
      else msgs.push({ role: 'assistant', content: '', tool_calls: [call] });
    } else if (it.type === 'function_call_output') msgs.push({ role: 'tool', tool_call_id: it.call_id, content: it.output });
    else if (Array.isArray(it.content)) msgs.push({ role: it.role, content: it.content.map((c) => (c.type === 'input_image' ? { type: 'image_url', image_url: { url: c.image_url } } : { type: 'text', text: c.text })) });
    else msgs.push({ role: it.role, content: it.content });
  }
  return msgs;
}
const opts = { noResponses: false };
let calls = [];
const media = [];
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
    if (req.url.startsWith('/v1/images/')) {
      const j = JSON.parse(b); media.push({ url: req.url, body: j });
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ created: 1, data: [{ b64_json: png }], output_format: j.output_format || 'webp' }));
    }
    if (req.url === '/v1/responses' && isAgentResponses(JSON.parse(b))) {
      const j = JSON.parse(b);
      if (opts.noResponses || /chat-only/.test(j.model)) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"Unknown endpoint /v1/responses"}}'); }
      const chatBody = { model: j.model, messages: fromInput(j), tools: (j.tools || []).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })), stream: j.stream, _wire: 'responses', reasoning: j.reasoning };
      calls.push(chatBody);
      const p = plan(chatBody);
      const out = p.tool
        ? [{ type: 'function_call', id: 'fc_' + calls.length, call_id: 'call_r' + calls.length, name: p.tool[0], arguments: JSON.stringify(p.tool[1]), status: 'completed' }]
        : [{ type: 'message', id: 'msg_' + calls.length, role: 'assistant', content: [{ type: 'output_text', text: p.text, annotations: [] }] }];
      const reasoningItem = { type: 'reasoning', id: 'rs_' + calls.length, summary: [{ type: 'summary_text', text: 'Thinking about the request.' }] };
      const full = { id: 'resp_' + calls.length, object: 'response', status: 'completed', output: [reasoningItem, ...out] };
      const slow = /slow/i.test(JSON.stringify(chatBody.messages[chatBody.messages.length - 1].content));
      if (!j.stream) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(full)); }
      const go = () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const ev = (o) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
        ev({ type: 'response.created', response: { id: full.id, status: 'in_progress', output: [] } });
        ev({ type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: reasoningItem.id, summary: [] } });
        ev({ type: 'response.reasoning_summary_part.added', item_id: reasoningItem.id, output_index: 0, summary_index: 0 });
        ev({ type: 'response.reasoning_summary_text.delta', item_id: reasoningItem.id, output_index: 0, delta: 'Thinking about ' });
        ev({ type: 'response.reasoning_summary_text.delta', item_id: reasoningItem.id, output_index: 0, delta: 'the request.' });
        if (p.tool) {
          const it = out[0]; const args = it.arguments;
          ev({ type: 'response.output_item.added', output_index: 1, item: { ...it, arguments: '' } });
          ev({ type: 'response.function_call_arguments.delta', item_id: it.id, output_index: 1, delta: args.slice(0, 10) });
          ev({ type: 'response.function_call_arguments.delta', item_id: it.id, output_index: 1, delta: args.slice(10) });
          ev({ type: 'response.function_call_arguments.done', item_id: it.id, output_index: 1, arguments: args });
          ev({ type: 'response.output_item.done', output_index: 1, item: it });
        } else {
          ev({ type: 'response.output_item.added', output_index: 1, item: { type: 'message', id: out[0].id, role: 'assistant', content: [] } });
          for (const part of p.text.match(/.{1,12}/gs)) ev({ type: 'response.output_text.delta', item_id: out[0].id, output_index: 1, content_index: 0, delta: part });
        }
        ev({ type: 'response.completed', response: full });
        res.end();
      };
      if (slow) setTimeout(go, 3000); else go();
      return;
    }
    if (req.url === '/v1/responses') {
      const j = JSON.parse(b); media.push({ url: req.url, body: j });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (j.model === 'sam-3.1') {
        const what = (j.input?.[0]?.content || []).find((c) => c.type === 'input_text')?.text || '';
        if (/unicorn|what is this/i.test(what)) return res.end(JSON.stringify({ output_text: '<0f>0' }));
        return res.end(JSON.stringify({ output_text: '<0f>1<|box;x1=10;y1=20;x2=110;y2=220;w=640;h=480;c=0.93|>,<|mask;x=0;y=0;c=0.93;data=2,2,~abc|>' }));
      }
      return res.end(JSON.stringify({ output: [
        { type: 'web_search_call', results: [{ type: 'result', title: 'Carpathron robots', url: 'https://example.com/a', snippet: 'modular robots' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'Carpathron builds robots.', annotations: [{ type: 'url_citation', url: 'https://example.com/b', title: 'B page' }] }] },
      ] }));
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
module.exports = { opts, start: (port) => new Promise((r) => server.listen(port, () => r(server))), calls: () => calls, asr: () => asr, media: () => media };
