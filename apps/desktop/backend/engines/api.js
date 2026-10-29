// "API key" engine: an agent loop over the Meta Model API (OpenAI-compatible chat/completions with tool calling).
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

  async _complete({ model, messages, tools, signal, onText, onReasoning, idle, effort }) {
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

// Keeps the request under a size budget by blanking the oldest tool outputs.
function compactHistory(llm, budget = 350000) {
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
  let size = JSON.stringify(llm).length;
  for (let i = 0; i < llm.length && size > budget; i++) {
    const m = llm[i];
    if (m.role === 'tool' && m.content.length > 400) {
      size -= m.content.length - 60;
      m.content = '[older tool output removed to save space]';
    }
  }
}

module.exports = { ApiEngine, compactHistory, FALLBACK_MODELS, clip };
