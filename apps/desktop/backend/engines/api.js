// "API key" engine: an agent loop over the Meta Model API.
// Two wire formats: the Responses API (/v1/responses: reasoning summaries, function calls as items) and
// Chat Completions (/v1/chat/completions). "auto" uses Responses and falls back to Chat Completions for the rest
// of the session if the endpoint refuses a request. The agent keeps its history in Chat Completions form;
// it is converted to Responses input items for each call (stateless replay, store: false).
'use strict';
const { clip } = require('../tools');

const FALLBACK_MODELS = ['muse-spark-1.3', 'muse-wonder-1.0', 'muse-spark-1.3-contributor', 'muse-spark-1.2', 'muse-spark-1.2-contributor', 'muse-spark-1.1', 'muse-image-1.0', 'sam-3.1', 'muse-voice-transcribe-1.0'];

function friendlyHttpError(status, body) {
  let msg = body;
  try { const j = JSON.parse(body); msg = j.error?.message || j.message || body; } catch {}
  msg = String(msg).slice(0, 400);
  if (status === 401 || status === 403) return `Meta API rejected the key (${status}). Check the API key in Settings. ${msg}`;
  if (status === 404) return `Meta API: model or endpoint not found (404). Pick another model. ${msg}`;
  if (status === 429) return `Meta API rate limit or credit limit reached (429). ${msg}`;
  return `Meta API error ${status}: ${msg}`;
}

class ApiEngine {
  constructor({ getSettings }) { this.getSettings = getSettings; }

  base() { return String(this.getSettings().apiBase || 'https://api.meta.ai/v1').replace(/\/+$/, ''); }
  headers() {
    const key = this.getSettings().apiKey;
    if (!key) throw new Error('No Meta API key. Open Settings → Meta API key, or switch the engine to "Meta account (Muse Code)".');
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  }

  async listModels() {
    try {
      const res = await fetch(`${this.base()}/models`, { headers: this.headers(), signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      const ids = (j.data || j.models || []).map((m) => m.id || m.modelId).filter(Boolean);
      if (ids.length) return ids.map((id) => ({ id, label: id }));
    } catch {}
    return FALLBACK_MODELS.map((id) => ({ id, label: id }));
  }

  // One model call. Streams text through onText. Returns { content, reasoning, toolCalls: [{id,name,arguments}] }
  async complete({ model, messages, tools, signal: outer, onText, onReasoning, effort }) {
    // Our own abort: user Stop, or no answer from Meta in time.
    const ctl = new AbortController();
    let timedOut = '';
    const onOuter = () => ctl.abort();
    if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', onOuter, { once: true }); }
    let timer = setTimeout(() => { timedOut = 'Meta API did not answer within 90 seconds.'; ctl.abort(); }, 90000);
    const idle = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = 'Meta API stopped sending data for 120 seconds.'; ctl.abort(); }, 120000); };
    try {
      try {
        return await this._complete({ model, messages, tools, signal: ctl.signal, onText, onReasoning, idle, effort });
      } catch (e) {
        if (effort && /reasoning|effort|400/i.test(e.message) && !ctl.signal.aborted) return await this._complete({ model, messages, tools, signal: ctl.signal, onText, onReasoning, idle });
        throw e;
      }
    } catch (e) {
      if (timedOut && !(outer && outer.aborted)) throw new Error(`${timedOut} Check your internet connection and try again.`);
      if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(String(e.message) + String(e.cause && e.cause.code))) throw new Error(`Cannot reach the Meta API at ${this.base()} (${(e.cause && e.cause.code) || e.message}). Check your internet connection.`);
      throw e;
    } finally {
      clearTimeout(timer);
      if (outer) outer.removeEventListener('abort', onOuter);
    }
  }

  wire() {
    const w = this.getSettings().apiWire || 'auto';
    if (w === 'chat' || w === 'responses') return w;
    return this.responsesBroken ? 'chat' : 'responses';
  }

  async _complete(args) {
    if (this.wire() === 'chat') return this._completeChat(args);
    try {
      const r = await this._completeResponses(args);
      if (r.content || r.toolCalls.length || r.reasoning) return r;
      if (args.signal.aborted) return r;
      // An empty answer from /responses: ask again through Chat Completions once.
      return await this._completeChat(args);
    } catch (e) {
      if (args.signal.aborted || !e.wireRefused || (this.getSettings().apiWire === 'responses')) throw e;
      this.responsesBroken = true; // remember for this session
      this.onWireFallback?.(e.message);
      return this._completeChat(args);
    }
  }

  async _completeResponses({ model, messages, tools, signal, onText, onReasoning, idle, effort }) {
    const { instructions, input } = toResponsesInput(messages);
    const body = { model, input, stream: true, store: false };
    if (instructions) body.instructions = instructions;
    if (tools && tools.length) {
      body.tools = tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters }));
      body.tool_choice = 'auto';
    }
    const send = (b) => fetch(`${this.base()}/responses`, { method: 'POST', headers: this.headers(), body: JSON.stringify(b), signal });
    body.reasoning = effort ? { effort, summary: 'auto' } : { summary: 'auto' };
    let res = await send(body);
    if (!res.ok && res.status === 400) { // maybe this model takes no reasoning options: once more without them
      const txt = await res.text();
      if (/reason|summary|effort/i.test(txt)) { delete body.reasoning; res = await send(body); }
      else { const e = new Error(friendlyHttpError(400, txt)); e.wireRefused = true; throw e; }
    }
    if (!res.ok) {
      const txt = await res.text();
      const e = new Error(friendlyHttpError(res.status, txt));
      e.wireRefused = [400, 404, 405, 415, 422, 501].includes(res.status);
      throw e;
    }
    idle();
    const type = res.headers.get('content-type') || '';
    if (!type.includes('event-stream')) {
      const j = await res.json();
      const r = fromResponsesOutput(j);
      if (r.content) onText?.(r.content);
      if (r.reasoning) onReasoning?.(r.reasoning);
      return r;
    }
    let content = '', reasoning = '', final = null;
    const calls = new Map(); // output_index -> { id, name, arguments }
    const byItem = new Map(); // item id -> output_index
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      idle();
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        switch (ev.type) {
          case 'response.output_text.delta':
            if (ev.delta) { content += ev.delta; onText?.(ev.delta); }
            break;
          case 'response.reasoning_summary_text.delta':
            if (ev.delta) { reasoning += ev.delta; onReasoning?.(ev.delta); }
            break;
          case 'response.reasoning_summary_part.added':
            if (reasoning) { reasoning += '\n\n'; onReasoning?.('\n\n'); }
            break;
          case 'response.output_item.added':
          case 'response.output_item.done': {
            const it = ev.item || {};
            if (it.type !== 'function_call') break;
            const i = ev.output_index ?? calls.size;
            const c = calls.get(i) || { id: '', name: '', arguments: '' };
            c.id = it.call_id || c.id || it.id || '';
            c.name = it.name || c.name;
            if (ev.type === 'response.output_item.done' && typeof it.arguments === 'string') c.arguments = it.arguments;
            else if (!c.arguments && typeof it.arguments === 'string') c.arguments = it.arguments;
            calls.set(i, c);
            if (it.id) byItem.set(it.id, i);
            break;
          }
          case 'response.function_call_arguments.delta': {
            const i = ev.output_index ?? byItem.get(ev.item_id);
            const c = calls.get(i) || { id: '', name: '', arguments: '' };
            c.arguments += ev.delta || '';
            calls.set(i, c);
            break;
          }
          case 'response.function_call_arguments.done': {
            const i = ev.output_index ?? byItem.get(ev.item_id);
            const c = calls.get(i);
            if (c && typeof ev.arguments === 'string') c.arguments = ev.arguments;
            break;
          }
          case 'response.completed':
          case 'response.incomplete':
            final = ev.response || null;
            break;
          case 'response.failed':
          case 'error': {
            const err = ev.response?.error || ev.error || ev;
            throw new Error(`Meta API: ${err.message || JSON.stringify(err).slice(0, 300)}`);
          }
          default: break;
        }
      }
    }
    let toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    if (final && Array.isArray(final.output)) {
      // The final response is authoritative (complete arguments, text if no deltas were sent).
      const f = fromResponsesOutput(final);
      if (!content && f.content) { content = f.content; onText?.(f.content); }
      if (!reasoning && f.reasoning) { reasoning = f.reasoning; onReasoning?.(f.reasoning); }
      if (f.toolCalls.length) toolCalls = f.toolCalls;
    }
    return { content, reasoning, toolCalls: toolCalls.filter((c) => c.name).map((c, i) => ({ ...c, arguments: c.arguments || '{}', id: c.id || `call_${Date.now()}_${i}` })) };
  }

  async _completeChat({ model, messages, tools, signal, onText, onReasoning, idle, effort }) {
    const body = { model, messages, stream: true };
    if (effort) body.reasoning_effort = effort;
    if (tools && tools.length) {
      body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = 'auto';
    }
    let res = await fetch(`${this.base()}/chat/completions`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    if (!res.ok) {
      const txt = await res.text();
      // Some deployments refuse streaming: retry once without it.
      if (res.status === 400 && /stream/i.test(txt)) {
        body.stream = false;
        res = await fetch(`${this.base()}/chat/completions`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
        if (!res.ok) throw new Error(friendlyHttpError(res.status, await res.text()));
      } else throw new Error(friendlyHttpError(res.status, txt));
    }
    idle();
    const type = res.headers.get('content-type') || '';
    if (!type.includes('event-stream')) {
      const j = await res.json();
      const m = j.choices?.[0]?.message || {};
      const content = Array.isArray(m.content) ? m.content.map((c) => c.text || '').join('') : (m.content || '');
      if (content) onText?.(content);
      if (m.reasoning_content) onReasoning?.(m.reasoning_content);
      return {
        content,
        reasoning: m.reasoning_content || '',
        toolCalls: (m.tool_calls || []).map((c) => ({ id: c.id, name: c.function?.name, arguments: c.function?.arguments || '{}' })),
      };
    }
    // SSE stream
    let content = '', reasoning = '';
    const calls = [];
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      idle();
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        if (j.error) throw new Error(`Meta API: ${j.error.message || JSON.stringify(j.error)}`);
        const d = j.choices?.[0]?.delta;
        if (!d) continue;
        const dc = Array.isArray(d.content) ? d.content.map((c) => c.text || '').join('') : d.content;
        if (typeof dc === 'string' && dc) { content += dc; onText?.(dc); }
        const r = d.reasoning_content || d.reasoning;
        if (typeof r === 'string' && r) { reasoning += r; onReasoning?.(r); }
        for (const tc of d.tool_calls || []) {
          const i = tc.index ?? calls.length;
          if (!calls[i]) calls[i] = { id: '', name: '', arguments: '' };
          if (tc.id) calls[i].id = tc.id;
          if (tc.function?.name) calls[i].name += tc.function.name;
          if (tc.function?.arguments) calls[i].arguments += tc.function.arguments;
        }
      }
    }
    return { content, reasoning, toolCalls: calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` })) };
  }
}

// Chat Completions history -> Responses API input items.
function toResponsesInput(messages) {
  const input = [];
  let instructions = '';
  const text = (c) => (Array.isArray(c) ? c.map((p) => p.text || '').join('') : String(c ?? ''));
  messages.forEach((m, i) => {
    if (m.role === 'system') {
      if (i === 0 || !input.length) instructions += (instructions ? '\n\n' : '') + text(m.content);
      else input.push({ role: 'system', content: text(m.content) });
      return;
    }
    if (m.role === 'user') {
      if (Array.isArray(m.content)) {
        input.push({ role: 'user', content: m.content.map((p) => {
          if (p.type === 'image_url') return { type: 'input_image', image_url: p.image_url?.url || p.image_url };
          if (p.type === 'input_image' || p.type === 'input_text') return p;
          return { type: 'input_text', text: p.text || '' };
        }) });
      } else input.push({ role: 'user', content: String(m.content ?? '') });
      return;
    }
    if (m.role === 'assistant') {
      const t = text(m.content);
      if (t) input.push({ role: 'assistant', content: t });
      for (const c of m.tool_calls || []) input.push({ type: 'function_call', call_id: c.id, name: c.function?.name || c.name, arguments: c.function?.arguments || c.arguments || '{}' });
      return;
    }
    if (m.role === 'tool') input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: text(m.content) });
  });
  return { instructions, input };
}

// Responses API result (non-streaming, or the final "response.completed" object) -> { content, reasoning, toolCalls }
function fromResponsesOutput(j) {
  let content = '', reasoning = '';
  const toolCalls = [];
  for (const o of j.output || []) {
    if (o.type === 'message') for (const c of o.content || []) { if (c.type === 'output_text' || c.text) content += c.text || ''; }
    else if (o.type === 'reasoning') reasoning += (o.summary || []).map((x) => x.text || '').filter(Boolean).join('\n\n');
    else if (o.type === 'function_call') toolCalls.push({ id: o.call_id || o.id, name: o.name, arguments: o.arguments || '{}' });
  }
  if (!content && typeof j.output_text === 'string') content = j.output_text;
  return { content, reasoning, toolCalls };
}

// Rough token count of a request (JSON characters / 3.5).
const estTokens = (x) => Math.ceil((typeof x === 'string' ? x.length : JSON.stringify(x).length) / 3.5);

// Keeps a request under the model's context budget. Muse models take 1,048,576 tokens, so long jobs keep their
// full history; only when the budget is reached the oldest tool outputs are shortened, then the oldest turns are
// dropped (the system prompt and the latest turns always stay).
function compactHistory(llm, budgetTokens = 700000) {
  repairToolPairs(llm);
  const budget = Math.floor(budgetTokens * 3.5); // characters
  let size = JSON.stringify(llm).length;
  if (size <= budget) return;
  for (let i = 0; i < llm.length && size > budget * 0.9; i++) {
    const m = llm[i];
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 400) {
      size -= m.content.length - 60;
      m.content = '[older tool output removed to save space]';
    }
  }
  if (size <= budget) return;
  // Still too big: drop whole old turns (a user message up to the next user message), never the last 4 turns.
  const userIdx = llm.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i > 0);
  const keepFrom = userIdx.length > 4 ? userIdx[userIdx.length - 4] : (userIdx[0] || 1);
  let cut = 1;
  while (size > budget && cut < keepFrom) {
    const next = userIdx.find((i) => i > cut) || keepFrom;
    const removed = llm.slice(cut, Math.min(next, keepFrom));
    if (!removed.length) break;
    size -= JSON.stringify(removed).length;
    cut = Math.min(next, keepFrom);
  }
  if (cut > 1) llm.splice(1, cut - 1, { role: 'user', content: '[Earlier parts of this conversation were removed to fit the model context. Ask the user if you need details from them.]' });
  repairToolPairs(llm);
}

function repairToolPairs(llm) {
  // Every assistant tool call must be followed by its tool result, or the API rejects the request.
  for (let i = 0; i < llm.length; i++) {
    const m = llm[i];
    if (m.role !== 'assistant' || !m.tool_calls) continue;
    const have = new Set();
    for (let j = i + 1; j < llm.length && llm[j].role === 'tool'; j++) have.add(llm[j].tool_call_id);
    let at = i + 1;
    while (at < llm.length && llm[at].role === 'tool') at++;
    const missing = m.tool_calls.filter((c) => !have.has(c.id)).map((c) => ({ role: 'tool', tool_call_id: c.id, content: '(no result — interrupted)' }));
    if (missing.length) llm.splice(at, 0, ...missing);
  }
  // A tool result whose call was removed (old turns dropped) is not allowed either.
  const known = new Set();
  for (let i = 0; i < llm.length; i++) {
    const m = llm[i];
    if (m.role === 'assistant' && m.tool_calls) for (const c of m.tool_calls) known.add(c.id);
    if (m.role === 'tool' && !known.has(m.tool_call_id)) { llm.splice(i, 1); i--; }
  }
}

module.exports = { ApiEngine, compactHistory, estTokens, toResponsesInput, fromResponsesOutput, FALLBACK_MODELS, clip };
