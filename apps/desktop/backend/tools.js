// Built-in agent tools: files, search, shell (PowerShell on Windows), web, robot.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const MAX_OUT = 30000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', '$RECYCLE.BIN', 'System Volume Information']);

// risk: 'read' (always allowed), 'write' (files), 'exec' (commands), 'robot' (moves hardware), 'external' (MCP / unknown)
const BUILTIN = [
  {
    name: 'list_dir', risk: 'read',
    description: 'List files and folders in a directory. Paths may be relative to the workspace.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path (default: workspace root)' } } },
  },
  {
    name: 'read_file', risk: 'read',
    description: 'Read a text file. Returns numbered lines. Use offset/limit for big files.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', description: '1-based first line' }, limit: { type: 'integer', description: 'max lines (default 400)' } }, required: ['path'] },
  },
  {
    name: 'write_file', risk: 'write',
    description: 'Create or overwrite a file with the given content. Creates folders as needed.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
  {
    name: 'edit_file', risk: 'write',
    description: 'Replace an exact text snippet in a file. old_string must match exactly once unless replace_all is true. Read the file first.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old_string', 'new_string'] },
  },
  {
    name: 'search', risk: 'read',
    description: 'Search file contents with a regular expression (case-insensitive) under a folder. Returns matching lines as path:line: text.',
    parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, file_glob: { type: 'string', description: 'e.g. *.js' } }, required: ['pattern'] },
  },
  {
    name: 'run_command', risk: 'exec',
    description: IS_WIN
      ? 'Run a PowerShell command on this Windows PC and return its output. Runs in the workspace folder unless cwd is given. Non-interactive: never start commands that wait for input.'
      : 'Run a shell command (bash) and return its output. Runs in the workspace folder unless cwd is given.',
    parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeout_seconds: { type: 'integer', description: 'default 120, max 900' } }, required: ['command'] },
  },
  {
    name: 'web_fetch', risk: 'read',
    description: 'Download a web page (http/https) and return its readable text.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'robot_status', risk: 'read',
    description: 'Get Baby Carpathron robot car status (connection, current motor values).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'robot_drive', risk: 'robot',
    description: 'Move the Baby Carpathron 4WD robot car (tank steering). Give a list of steps. Speeds are -100..100 percent per side. Forward = both positive, spin left = left negative/right positive. About 600 ms at speed 60 = 90 degree spin; 1 s at 60 = ~40 cm. Indoors use 40-70. The car always stops at the end.',
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: { type: 'object', properties: { type: { type: 'string', enum: ['drive', 'wait', 'stop'] }, left: { type: 'number' }, right: { type: 'number' }, ms: { type: 'integer' } }, required: ['type'] },
        },
      },
      required: ['steps'],
    },
  },
  {
    name: 'robot_stop', risk: 'read',
    description: 'Immediately stop the robot car.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'robot_look', risk: 'robot',
    description: 'Look in a direction with the robot camera. The camera is fixed to the car, so the car turns its body on the spot (like a robot turning to look), takes a photo you can see, then turns back to face where it was (unless return_to_start is false). Use for "what is on your left/right/behind you".',
    parameters: { type: 'object', properties: { direction: { type: 'string', description: 'left, right, back, front, or degrees clockwise like "45" or "-30"' }, return_to_start: { type: 'boolean' } }, required: ['direction'] },
  },
  {
    name: 'robot_turn', risk: 'robot',
    description: 'Turn the robot car on the spot by an angle (calibrated). Positive = right/clockwise, negative = left. E.g. 90, -90, 180.',
    parameters: { type: 'object', properties: { degrees: { type: 'number' } }, required: ['degrees'] },
  },
  {
    name: 'robot_scan_room', risk: 'robot',
    description: 'Scan the room: the car turns a full circle in steps, photographs every side, and builds a top-down room map (objects, distances, free space) that is shown to the user (also on WhatsApp) and saved to memory. Takes about a minute.',
    parameters: { type: 'object', properties: { steps: { type: 'integer', description: 'number of directions, 4-12 (default 8)' } } },
  },
  {
    name: 'robot_photo', risk: 'read',
    description: 'Take a photo with the robot camera (or the PC webcam if the robot has no camera). The photo is saved, shown to the user (also sent back on WhatsApp) and you can see it.',
    parameters: { type: 'object', properties: { note: { type: 'string', description: 'optional reason, e.g. "look ahead"' } } },
  },
];

const DELEGATE = {
  name: 'delegate', risk: 'read',
  description: 'Orchestrate sub-agents: run 1-4 independent tasks in parallel, each handled by a sub-agent with the same tools (and the same approval rules). Use for work that splits cleanly (e.g. research two topics, write two separate files). Returns each sub-agent\'s final report.',
  parameters: {
    type: 'object',
    properties: { tasks: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, instructions: { type: 'string' } }, required: ['title', 'instructions'] } } },
    required: ['tasks'],
  },
};

function resolvePath(ws, p) {
  if (!p) return ws;
  p = String(p).replace(/^~(?=$|[\\/])/, require('os').homedir());
  return path.resolve(ws, p);
}

function clip(s, n = MAX_OUT) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + `\n… [truncated ${s.length - n} characters]` : s;
}

function globToRegex(g) {
  return new RegExp('^' + g.split('').map((c) => (c === '*' ? '.*' : c === '?' ? '.' : /[.+^${}()|[\]\\]/.test(c) ? '\\' + c : c)).join('') + '$', 'i');
}

async function walk(dir, onFile, state = { files: 0 }) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (state.stop) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(full, onFile, state); }
    else if (e.isFile()) { if (++state.files > 20000) { state.stop = true; return; } await onFile(full, state); }
  }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/tr)[^>]*>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (IS_WIN) { try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch {} }
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } }
}

function runCommand(command, cwd, timeoutMs, signal) {
  return new Promise((resolve) => {
    const args = IS_WIN
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; ${command}`]
      : ['-lc', command];
    const child = spawn(IS_WIN ? 'powershell.exe' : 'bash', args, { cwd, windowsHide: true, detached: !IS_WIN, env: process.env });
    let out = '';
    const add = (d) => { if (out.length < MAX_OUT * 2) out += d.toString('utf8'); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const onAbort = () => killTree(child);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => { clearTimeout(t); resolve(`Failed to start: ${e.message}`); });
    child.on('close', (code) => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
      let res = clip(out.trim() || '(no output)');
      if (timedOut) res += `\n[stopped after ${Math.round(timeoutMs / 1000)} s timeout]`;
      else if (signal?.aborted) res += '\n[stopped by user]';
      else res += `\n[exit code ${code}]`;
      resolve(res);
    });
  });
}

async function execBuiltin(name, args, ctx) {
  const ws = ctx.workspace;
  switch (name) {
    case 'list_dir': {
      const dir = resolvePath(ws, args.path);
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const lines = [];
      for (const e of entries.slice(0, 500)) {
        if (e.isDirectory()) lines.push(`[dir]  ${e.name}`);
        else {
          let size = '';
          try { size = ` (${(await fsp.stat(path.join(dir, e.name))).size} bytes)`; } catch {}
          lines.push(`       ${e.name}${size}`);
        }
      }
      if (entries.length > 500) lines.push(`… ${entries.length - 500} more`);
      return `${dir}\n${lines.join('\n') || '(empty)'}`;
    }
    case 'read_file': {
      const file = resolvePath(ws, args.path);
      const st = await fsp.stat(file);
      if (st.size > 20 * 1024 * 1024) return `File is too large to read (${st.size} bytes).`;
      const buf = await fsp.readFile(file);
      if (buf.subarray(0, 8000).includes(0)) return `Binary file (${st.size} bytes), not shown.`;
      const lines = buf.toString('utf8').split(/\r?\n/);
      const start = Math.max(1, Number(args.offset) || 1);
      const limit = Math.min(2000, Math.max(1, Number(args.limit) || 400));
      const slice = lines.slice(start - 1, start - 1 + limit).map((l, i) => `${String(start + i).padStart(5)}  ${l}`);
      let res = slice.join('\n');
      if (start - 1 + limit < lines.length) res += `\n… (${lines.length} lines total; continue with offset=${start + limit})`;
      return clip(res);
    }
    case 'write_file': {
      const file = resolvePath(ws, args.path);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, String(args.content ?? ''), 'utf8');
      return `Wrote ${Buffer.byteLength(String(args.content ?? ''))} bytes to ${file}`;
    }
    case 'edit_file': {
      const file = resolvePath(ws, args.path);
      const text = await fsp.readFile(file, 'utf8');
      const oldS = String(args.old_string ?? '');
      if (!oldS) throw new Error('old_string is empty');
      const count = text.split(oldS).length - 1;
      if (count === 0) throw new Error('old_string was not found in the file. Read the file and copy the text exactly.');
      if (count > 1 && !args.replace_all) throw new Error(`old_string matches ${count} places; add more surrounding text or set replace_all.`);
      const out = args.replace_all ? text.split(oldS).join(String(args.new_string)) : text.replace(oldS, () => String(args.new_string));
      await fsp.writeFile(file, out, 'utf8');
      return `Edited ${file} (${args.replace_all ? count : 1} replacement${count > 1 && args.replace_all ? 's' : ''})`;
    }
    case 'search': {
      let re;
      try { re = new RegExp(String(args.pattern), 'i'); } catch (e) { throw new Error(`Bad regex: ${e.message}`); }
      const root = resolvePath(ws, args.path);
      const g = args.file_glob ? globToRegex(String(args.file_glob)) : null;
      const hits = [];
      await walk(root, async (file, state) => {
        if (g && !g.test(path.basename(file))) return;
        let st; try { st = await fsp.stat(file); } catch { return; }
        if (st.size > 2 * 1024 * 1024) return;
        let text; try { text = await fsp.readFile(file, 'utf8'); } catch { return; }
        if (text.includes('\u0000')) return;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            hits.push(`${path.relative(root, file) || path.basename(file)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
            if (hits.length >= 200) { state.stop = true; return; }
          }
        }
      });
      return hits.length ? hits.join('\n') + (hits.length >= 200 ? '\n… (stopped at 200 matches)' : '') : 'No matches.';
    }
    case 'run_command': {
      const cwd = resolvePath(ws, args.cwd);
      const t = Math.min(900, Math.max(1, Number(args.timeout_seconds) || 120)) * 1000;
      return runCommand(String(args.command), cwd, t, ctx.signal);
    }
    case 'web_fetch': {
      const url = String(args.url || '');
      if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are allowed.');
      const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Mozilla/5.0 MuseCarpathron/1.0' } });
      const type = res.headers.get('content-type') || '';
      const body = await res.text();
      const text = /html/i.test(type) ? htmlToText(body) : body;
      return clip(`HTTP ${res.status} ${type}\n\n${text}`, 20000);
    }
    case 'robot_photo': {
      const ph = await ctx.camera.capture();
      if (ctx.onPhoto) ctx.onPhoto(ph);
      return `Photo taken with the ${ph.source} and saved to ${ph.path}`;
    }
    case 'robot_look': {
      if (!ctx.mapper) throw new Error('not available');
      const ph = await ctx.mapper.look(args.direction, { comeBack: args.return_to_start !== false });
      if (ctx.onPhoto) ctx.onPhoto(ph);
      return `Turned ${ph.degrees}° (${ph.direction}), took a photo (${ph.path})${args.return_to_start !== false && ph.degrees ? ' and turned back' : ''}. You can see the photo.`;
    }
    case 'robot_turn': {
      if (!ctx.mapper) throw new Error('not available');
      ctx.mapper.needCar();
      return JSON.stringify(await ctx.mapper.turn(args.degrees));
    }
    case 'robot_scan_room': {
      if (!ctx.mapper) throw new Error('not available');
      const r = await ctx.mapper.scan({ steps: args.steps });
      if (ctx.onPhoto && r.png) ctx.onPhoto({ path: path.join(r.dir, 'map.png'), buffer: r.png, source: 'room map', mime: 'image/png', noVision: true });
      return clip(r.summary, 6000);
    }
    case 'robot_status':
      return JSON.stringify(ctx.robot.status());
    case 'robot_stop':
      ctx.robot.stop('agent');
      return 'Robot stopped.';
    case 'robot_drive': {
      const steps = Array.isArray(args.steps) ? args.steps : [];
      if (!steps.length) throw new Error('steps is empty');
      const r = await ctx.robot.runPlan(steps, 'ai');
      return JSON.stringify(r);
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

// One-line human summary for approvals and tool cards
function describeCall(name, args) {
  const a = args || {};
  switch (name) {
    case 'write_file': return `Write file ${a.path} (${String(a.content ?? '').length} chars)`;
    case 'edit_file': return `Edit file ${a.path}`;
    case 'run_command': return `Run: ${a.command}`;
    case 'robot_photo': return 'Take a photo';
    case 'robot_look': return `Look ${a.direction} (the car turns${a.return_to_start === false ? '' : ' and comes back'})`;
    case 'robot_turn': return `Turn the car ${a.degrees}°`;
    case 'robot_scan_room': return `Scan the room (${a.steps || 8} directions, car turns a full circle)`;
    case 'robot_drive': return `Drive robot: ${(a.steps || []).map((s) => (s.type === 'drive' ? `L${s.left}/R${s.right} ${s.ms}ms` : s.type)).join(', ')}`;
    case 'read_file': return `Read ${a.path}`;
    case 'list_dir': return `List ${a.path || 'workspace'}`;
    case 'search': return `Search "${a.pattern}"${a.path ? ' in ' + a.path : ''}`;
    case 'web_fetch': return `Fetch ${a.url}`;
    case 'delegate': return `Delegate ${(a.tasks || []).length} task(s): ${(a.tasks || []).map((t) => t.title).join(', ')}`;
    default: return `${name} ${clip(JSON.stringify(a), 300)}`;
  }
}

module.exports = { BUILTIN, DELEGATE, execBuiltin, describeCall, clip, runCommand, IS_WIN };
