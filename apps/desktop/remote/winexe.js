// Windows programs by their full path, and a PATH with the Windows system folders first. Some PCs have a broken or
// incomplete PATH ("spawn powershell.exe ENOENT"): then remote control (mouse / keyboard) and commands still work.
'use strict';
const fs = require('fs'); const path = require('path');
const IS_WIN = process.platform === 'win32';
const SR = process.env.SystemRoot || process.env.SYSTEMROOT || process.env.windir || 'C:\\Windows';
const S32 = path.win32.join(SR, 'System32');
const CAND = {
  powershell: [path.win32.join(S32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), path.win32.join(SR, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe')],
  cmd: [process.env.ComSpec, path.win32.join(S32, 'cmd.exe')],
  taskkill: [path.win32.join(S32, 'taskkill.exe')],
  reg: [path.win32.join(S32, 'reg.exe')],
};
function exe(name) {
  if (!IS_WIN) return name;
  for (const c of CAND[name] || []) { try { if (c && fs.existsSync(c)) return c; } catch {} }
  return name + '.exe';
}
function env(extra) {
  const e = { ...process.env, ...(extra || {}) };
  if (!IS_WIN) return e;
  const k = Object.keys(e).find((x) => x.toLowerCase() === 'path') || 'Path';
  const need = [S32, SR, path.win32.join(S32, 'Wbem'), path.win32.join(S32, 'WindowsPowerShell', 'v1.0'), path.win32.join(S32, 'OpenSSH')];
  const cur = String(e[k] || '').split(';').filter(Boolean);
  e[k] = [...need.filter((n) => !cur.some((c) => c.toLowerCase() === n.toLowerCase())), ...cur].join(';');
  return e;
}
module.exports = { exe, env };
