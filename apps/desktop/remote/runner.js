// Carpathron Remote — runs a command on THIS computer for a remote technician (or the AI technician working for
// them), after the person here allowed it. Windows: PowerShell (or cmd); Linux: bash. Output is streamed back.
// "admin" asks Windows for administrator rights (UAC prompt on this screen, someone here must click Yes) or Linux
// for root (pkexec prompt). Runs with this user's rights otherwise. Main process only.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const MAX_OUT = 200000;
const running = new Map(); // rid -> { child, timer }

const PS_PRE = "$ProgressPreference='SilentlyContinue'; try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}\n";
const enc = (s) => Buffer.from(String(s), 'utf16le').toString('base64');

function tmpFile(ext, text) {
  const dir = path.join(os.tmpdir(), 'carpathron-remote'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, crypto.randomBytes(8).toString('hex') + ext); if (text != null) fs.writeFileSync(f, text); return f;
}

/**
 * run({ rid, shell: 'powershell'|'cmd'|'bash', script, admin, timeout (s) }, onOut(text)) → Promise<{ code, ms, timedOut, truncated }>
 */
function run(req, onOut) {
  const t0 = Date.now();
  const timeout = Math.max(5, Math.min(3600, Number(req.timeout) || 120)) * 1000;
  let shell = req.shell || (IS_WIN ? 'powershell' : 'bash');
  if (!IS_WIN) shell = 'bash';
  if (IS_WIN && !['powershell', 'cmd'].includes(shell)) shell = 'powershell';
  const script = String(req.script || '');
  let file = '', outFile = '', cmd, args, stdin = null;
  if (req.admin) {
    if (IS_WIN) {
      // elevated copy, output into a file (an elevated process cannot write into our pipes)
      file = tmpFile(shell === 'cmd' ? '.cmd' : '.ps1', shell === 'cmd' ? '@echo off\r\n' + script : '﻿' + PS_PRE + script);
      outFile = tmpFile('.txt', '');
      const inner = shell === 'cmd'
        ? `& cmd.exe /d /c "\`"${file}\`" > \`"${outFile}\`" 2>&1"; exit $LASTEXITCODE`
        : `& { & '${file}' *> '${outFile}' }; exit $(if ($?) { 0 } else { 1 })`;
      const outer = `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${enc(inner)}'; exit $p.ExitCode`;
      cmd = 'powershell.exe'; args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc(outer)];
    } else {
      file = tmpFile('.sh', script); cmd = 'pkexec'; args = ['bash', file];
    }
  } else if (IS_WIN && shell === 'cmd') {
    file = tmpFile('.cmd', '@echo off\r\nchcp 65001 >nul\r\n' + script); cmd = 'cmd.exe'; args = ['/d', '/c', file];
  } else if (IS_WIN) {
    cmd = 'powershell.exe'; args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', enc(PS_PRE + script)];
  } else { cmd = 'bash'; args = ['-s']; stdin = script; }

  return new Promise((resolve) => {
    let size = 0, truncated = false, timedOut = false, done = false;
    const emit = (d) => { if (!d) return; const s = String(d); if (size >= MAX_OUT) { truncated = true; return; } size += s.length; try { onOut(s); } catch {} };
    let child;
    try { child = spawn(cmd, args, { windowsHide: true, cwd: os.homedir(), env: { ...process.env, TERM: 'dumb', DEBIAN_FRONTEND: 'noninteractive' } }); }
    catch (e) { return resolve({ code: -1, ms: 0, error: e.message }); }
    const timer = setTimeout(() => { timedOut = true; kill(req.rid); }, timeout);
    running.set(req.rid, { child, timer });
    child.stdout.on('data', emit); child.stderr.on('data', emit);
    child.on('error', (e) => emit(`\n[could not start ${cmd}: ${e.message}]\n`));
    if (stdin != null) { child.stdin.end(stdin); } else { try { child.stdin.end(); } catch {} }
    child.on('close', (code) => {
      if (done) return; done = true;
      clearTimeout(timer); running.delete(req.rid);
      if (outFile) { try { emit(fs.readFileSync(outFile, 'utf8').replace(/^﻿/, '')); } catch {} }
      for (const f of [file, outFile]) if (f) { try { fs.unlinkSync(f); } catch {} }
      if (req.admin && IS_WIN && code === 1223) emit('\n[administrator rights were refused at the UAC prompt]\n');
      if (req.admin && !IS_WIN && (code === 126 || code === 127)) emit('\n[root rights were refused or pkexec is not available]\n');
      resolve({ code: timedOut ? -2 : code, ms: Date.now() - t0, timedOut, truncated });
    });
  });
}

function kill(rid) {
  const r = running.get(rid); if (!r) return false;
  try {
    if (IS_WIN) spawn('taskkill', ['/pid', String(r.child.pid), '/t', '/f'], { windowsHide: true });
    else r.child.kill('SIGKILL');
  } catch {}
  return true;
}
const killAll = () => { for (const rid of [...running.keys()]) kill(rid); };

module.exports = { run, kill, killAll, count: () => running.size };
