// Hardware development beyond Arduino: Raspberry Pi (Pico / MicroPython, Pi boards over SSH, SD-card imaging),
// NVIDIA (GPU + CUDA on this PC, Jetson boards over SSH), IDE management — plus security checks for public
// servers and domains. Tools are plain commands under the hood, so everything is visible and repeatable.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const tls = require('tls');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const obj = (properties, required = []) => ({ type: 'object', properties, required });

const DEV_TOOLS = [
  { name: 'dev_environment', risk: 'read', description: 'Inventory of the development setup on this PC: IDEs and SDKs (Arduino IDE, VS Code, Thonny, Raspberry Pi Imager, PlatformIO, NVIDIA CUDA / Nsight / SDK Manager, Python, mpremote, esptool, picotool, git, Docker, WSL), NVIDIA GPUs (nvidia-smi), serial ports with the boards on them, Raspberry Pi Pico in BOOTSEL mode, Jetson in recovery mode, and Raspberry Pi / Jetson boards answering on the network. Run it before hardware work.', parameters: obj({ network: { type: 'boolean', description: 'also look for raspberrypi.local / jetson boards on the LAN (default true)' } }) },
  { name: 'dev_install', risk: 'external', description: 'Install a development tool on this PC (Windows uses winget or pip; Windows may ask the user for permission): mpremote, esptool, platformio, thonny, rpi-imager, vscode, python, git, cuda (NVIDIA CUDA Toolkit, large), nsight-systems.', parameters: obj({ tool: { type: 'string', enum: ['mpremote', 'esptool', 'platformio', 'thonny', 'rpi-imager', 'vscode', 'python', 'git', 'cuda', 'nsight-systems'] } }, ['tool']) },
  { name: 'open_ide', risk: 'exec', description: 'Open an IDE / tool on this PC so the user can see or edit (optionally with a file or folder): arduino, vscode, thonny, rpi-imager, nsight-systems, nsight-compute, sdkmanager. To drive the IDE yourself afterwards use computer_view / computer_act.', parameters: obj({ ide: { type: 'string', enum: ['arduino', 'vscode', 'thonny', 'rpi-imager', 'nsight-systems', 'nsight-compute', 'sdkmanager'] }, path: { type: 'string' } }, ['ide']) },
  { name: 'micropython', risk: 'exec', description: 'Work with a MicroPython board (Raspberry Pi Pico / Pico W / Pico 2, ESP32, ESP8266…) over USB with mpremote: devices (list), ls, cat, put (copy a PC file to the board), get, rm, run (run a PC .py file on the board and show the output), exec (run code), install (mip package), reset, version. Install mpremote with dev_install first if missing.', parameters: obj({ action: { type: 'string', enum: ['devices', 'ls', 'cat', 'put', 'get', 'rm', 'run', 'exec', 'install', 'reset', 'version'] }, port: { type: 'string', description: 'e.g. COM5 (default: first board found)' }, path: { type: 'string', description: 'file on the PC (put/run/get target)' }, remote: { type: 'string', description: 'path on the board, e.g. main.py' }, code: { type: 'string' }, package: { type: 'string' }, timeout_seconds: { type: 'integer' } }, ['action']) },
  { name: 'pico_flash', risk: 'external', description: 'Flash a Raspberry Pi Pico / Pico 2 (RP2040 / RP2350) with a .uf2 file: the board must be in BOOTSEL mode (hold BOOTSEL while plugging in USB — it appears as drive RPI-RP2 or RP2350). Use for MicroPython firmware or compiled C/C++/Arduino builds.', parameters: obj({ uf2: { type: 'string', description: 'path of the .uf2 file on this PC' } }, ['uf2']) },
  { name: 'sd_card_image', risk: 'external', description: 'Raspberry Pi SD card / USB drive imaging with Raspberry Pi Imager. action "list" shows removable drives (safe). action "write" ERASES the chosen drive and writes the image: you must pass the disk number AND its serial exactly as listed, and confirm with the user first. Only removable USB/SD drives are allowed, never the system disk.', parameters: obj({ action: { type: 'string', enum: ['list', 'write'] }, image: { type: 'string', description: 'path of the .img / .img.xz / .zip image (download it first, e.g. Raspberry Pi OS Lite)' }, disk: { type: 'integer' }, serial: { type: 'string' } }, ['action']) },
  { name: 'security_check', risk: 'read', description: 'Security check of a public server (over SSH: open ports and what listens on them, firewall, SSH login settings, pending security updates, fail2ban, exposed databases, sudo, docker) and/or a website or domain (HTTPS certificate and expiry, HTTP→HTTPS redirect, security headers, server version leaks, exposed files like /.git, /.env, backups). Use it after deploying or changing anything public, and fix what it reports. Only for servers and domains the user owns or manages.', parameters: obj({ server: { type: 'string', description: 'saved server name (Remote page)' }, url: { type: 'string', description: 'https://example.com or a domain' } }) },
  { name: 'ask_model', risk: 'read', description: 'Ask another Meta Muse model for a second opinion or a specialised job and get its answer as text: e.g. muse-wonder-1.0 for very hard reasoning or a code review, muse-spark-1.3 for a quick check. (For images, objects in photos and audio use generate_image, segment_image and transcribe_audio.) Needs the Meta API key.', parameters: obj({ model: { type: 'string' }, prompt: { type: 'string' }, effort: { type: 'string', enum: ['minimal', 'low', 'medium', 'high', 'max'] } }, ['model', 'prompt']) },
];
const DEV_NAMES = new Set(DEV_TOOLS.map((t) => t.name));

function run(cmd, args, { timeoutMs = 60000, cwd, signal, shell = false } = {}) {
  return new Promise((resolve) => {
    let out = '', child;
    try { child = spawn(cmd, args, { cwd, windowsHide: true, shell }); } catch (e) { resolve({ code: -1, out: e.message }); return; }
    const t = setTimeout(() => { try { child.kill(); } catch {} out += '\n[timed out]'; }, timeoutMs);
    const onAbort = () => { try { child.kill(); } catch {} };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: /ENOENT/.test(e.message) ? 'not found' : e.message }); });
    child.on('close', (code) => { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); resolve({ code, out: out.trim() }); });
  });
}
const ps = (script, opts) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], opts);
const exists = (p) => { try { return fs.statSync(p).isFile() || fs.statSync(p).isDirectory(); } catch { return false; } };
const firstLine = (s) => String(s || '').split('\n')[0].trim();

function knownPaths() {
  const PF = process.env.ProgramFiles || 'C:\\Program Files', PF86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', LAD = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return {
    arduino: [path.join(LAD, 'Programs', 'Arduino IDE', 'Arduino IDE.exe'), path.join(PF, 'Arduino IDE', 'Arduino IDE.exe'), path.join(PF86, 'Arduino', 'arduino.exe')],
    vscode: [path.join(LAD, 'Programs', 'Microsoft VS Code', 'Code.exe'), path.join(PF, 'Microsoft VS Code', 'Code.exe')],
    thonny: [path.join(LAD, 'Programs', 'Thonny', 'thonny.exe'), path.join(PF, 'Thonny', 'thonny.exe'), path.join(PF86, 'Thonny', 'thonny.exe')],
    'rpi-imager': [path.join(PF86, 'Raspberry Pi Imager', 'rpi-imager.exe'), path.join(PF, 'Raspberry Pi Imager', 'rpi-imager.exe')],
    'nsight-systems': globDir(path.join(PF, 'NVIDIA Corporation'), /^Nsight Systems/, ['host-windows-x64', 'nsys-ui.exe']),
    'nsight-compute': globDir(path.join(PF, 'NVIDIA Corporation'), /^Nsight Compute/, ['ncu-ui.exe']),
    sdkmanager: ['/usr/bin/sdkmanager'],
  };
}
function globDir(base, re, rest) { try { return fs.readdirSync(base).filter((d) => re.test(d)).sort().reverse().map((d) => path.join(base, d, ...rest)); } catch { return []; } }
const findIde = (ide) => (knownPaths()[ide] || []).find(exists) || '';

async function devEnvironment(args, ctx) {
  const lines = [];
  const ver = async (label, cmd, a = ['--version']) => { const r = await run(cmd, a, { timeoutMs: 15000, shell: IS_WIN && !/\.exe$/i.test(cmd) }); lines.push(`${r.code === 0 ? '✓' : '·'} ${label}: ${r.code === 0 ? firstLine(r.out) : 'not installed'}`); return r.code === 0; };
  lines.push('## IDEs and tools');
  for (const [k, label] of [['arduino', 'Arduino IDE'], ['vscode', 'VS Code'], ['thonny', 'Thonny (MicroPython IDE)'], ['rpi-imager', 'Raspberry Pi Imager'], ['nsight-systems', 'NVIDIA Nsight Systems'], ['nsight-compute', 'NVIDIA Nsight Compute']]) {
    const p = findIde(k); lines.push(`${p ? '✓' : '·'} ${label}: ${p || 'not installed'}`);
  }
  const { findArduinoCli } = require('./xtools');
  const cli = findArduinoCli(ctx.dataDir, ctx.settings && ctx.settings.arduinoCli);
  lines.push(`${cli ? '✓' : '·'} arduino-cli: ${cli || 'not found (arduino_setup downloads it)'}`);
  await ver('Python', IS_WIN ? 'python' : 'python3');
  await ver('mpremote (MicroPython)', IS_WIN ? 'python' : 'python3', ['-m', 'mpremote', 'version']);
  await ver('esptool', IS_WIN ? 'python' : 'python3', ['-m', 'esptool', 'version']);
  await ver('PlatformIO', 'pio');
  await ver('picotool', 'picotool', ['version']);
  await ver('git', 'git');
  await ver('Docker', 'docker');
  if (IS_WIN) { const w = await run('wsl.exe', ['--status'], { timeoutMs: 10000 }); lines.push(`${w.code === 0 ? '✓' : '·'} WSL: ${w.code === 0 ? 'available (needed for NVIDIA SDK Manager / Jetson flashing on Windows)' : 'not set up'}`); }
  lines.push('', '## NVIDIA');
  const smi = await run('nvidia-smi', ['--query-gpu=name,driver_version,memory.total,utilization.gpu,temperature.gpu', '--format=csv,noheader'], { timeoutMs: 15000 });
  lines.push(smi.code === 0 ? smi.out.split('\n').map((l) => `✓ GPU: ${l.trim()}`).join('\n') : '· No NVIDIA GPU / driver found (nvidia-smi)');
  const nvcc = await run('nvcc', ['--version'], { timeoutMs: 15000 });
  lines.push(nvcc.code === 0 ? `✓ CUDA Toolkit: ${(nvcc.out.match(/release [\d.]+/) || [''])[0]}` : '· CUDA Toolkit: not installed (dev_install cuda)');
  lines.push('', '## Connected boards');
  if (IS_WIN) {
    const r = await ps("Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\(COM\\d+\\)' -or $_.DeviceID -match 'VID_2E8A|VID_0955|VID_10C4|VID_1A86|VID_303A|VID_0403|VID_2341' } | ForEach-Object { $_.Name + ' | ' + $_.DeviceID }", { timeoutMs: 20000 });
    const devs = r.out.split('\n').map((l) => l.trim()).filter(Boolean);
    const tag = (l) => /VID_2E8A/i.test(l) ? ' ← Raspberry Pi (Pico/RP2040/RP2350)' : /VID_0955/i.test(l) ? ' ← NVIDIA Jetson (recovery/USB mode)' : /VID_303A/i.test(l) ? ' ← Espressif ESP32 (native USB)' : /VID_10C4|VID_1A86/i.test(l) ? ' ← USB-serial (CP210x/CH340: ESP32, ESP32-CAM, Arduino clones)' : /VID_2341/i.test(l) ? ' ← Arduino' : '';
    lines.push(devs.length ? devs.map((l) => `- ${l}${tag(l)}`).join('\n') : '- no serial / dev boards detected');
    const drv = await ps("Get-Volume | Where-Object { $_.FileSystemLabel -match 'RPI-RP2|RP2350' } | ForEach-Object { $_.DriveLetter + ': ' + $_.FileSystemLabel }", { timeoutMs: 15000 });
    if (drv.out.trim()) lines.push(`- Pico in BOOTSEL mode on drive ${drv.out.trim()} (use pico_flash with a .uf2)`);
  } else {
    const r = await run('sh', ['-c', 'ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null; lsusb 2>/dev/null | grep -Ei "2e8a|0955|10c4|1a86|303a|2341"'], { timeoutMs: 10000 });
    lines.push(r.out ? r.out.split('\n').map((l) => `- ${l}`).join('\n') : '- no serial / dev boards detected');
  }
  if (args.network !== false) {
    lines.push('', '## Boards on the network');
    const names = ['raspberrypi.local', 'raspberrypi', 'jetson.local', 'jetson-nano.local', 'nvidia.local', 'pi.local'];
    const found = [];
    await Promise.all(names.map(async (n) => {
      const r = IS_WIN ? await run('ping', ['-n', '1', '-w', '1200', n], { timeoutMs: 5000 }) : await run('ping', ['-c', '1', '-W', '1', n], { timeoutMs: 5000 });
      const ip = (r.out.match(/\[?(\d+\.\d+\.\d+\.\d+)\]?/) || [])[1];
      if (r.code === 0 && ip) found.push(`- ${n} → ${ip} (add it on the Remote page or with ssh_save_server, user usually "pi" / your Imager user; Jetson default user is the one set at first boot)`);
    }));
    lines.push(found.length ? found.join('\n') : '- none answered by name (they may use other hostnames; check your router, or the board\'s IP)');
  }
  return lines.join('\n');
}

const INSTALL = {
  mpremote: { pip: 'mpremote' }, esptool: { pip: 'esptool' }, platformio: { pip: 'platformio' },
  thonny: { winget: 'AivarAnnamaa.Thonny' }, 'rpi-imager': { winget: 'RaspberryPiFoundation.RaspberryPiImager' }, vscode: { winget: 'Microsoft.VisualStudioCode' },
  python: { winget: 'Python.Python.3.12' }, git: { winget: 'Git.Git' }, cuda: { winget: 'Nvidia.CUDA' }, 'nsight-systems': { winget: 'Nvidia.NsightSystems' },
};
async function devInstall(args, ctx) {
  const it = INSTALL[args.tool];
  if (!it) throw new Error(`unknown tool ${args.tool}`);
  if (it.pip) {
    const py = IS_WIN ? 'python' : 'python3';
    const r = await run(py, ['-m', 'pip', 'install', '--user', '--upgrade', it.pip], { timeoutMs: 900000, signal: ctx.signal });
    if (r.code !== 0 && /not found|No module named pip/i.test(r.out)) throw new Error(`Python is needed first (dev_install python). ${r.out.slice(-300)}`);
    return `${r.code === 0 ? '✓ Installed' : '✕ Failed'} ${it.pip} with pip.\n${r.out.slice(-1500)}`;
  }
  if (!IS_WIN) throw new Error(`Install ${args.tool} with your package manager on this OS.`);
  ctx.status && ctx.status(`Installing ${args.tool} with winget (Windows may ask for permission)…`);
  const r = await run('winget', ['install', '--id', it.winget, '-e', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'], { timeoutMs: 3600000, signal: ctx.signal });
  const ok = r.code === 0 || /already installed|Successfully installed/i.test(r.out);
  return `${ok ? '✓' : '✕'} ${args.tool} (${it.winget}): ${ok ? 'installed' : 'failed'}.\n${r.out.slice(-1500)}${ok ? '\nNew programs may need the app (or a new shell) to see them on PATH.' : ''}`;
}

function openIde(args, ctx) {
  const target = args.path ? (path.isAbsolute(args.path) ? args.path : path.join(ctx.workspace, args.path)) : null;
  if (args.ide === 'vscode') {
    const p = findIde('vscode') || 'code';
    // "code" is a .cmd script that needs a shell: refuse paths with shell characters in that case.
    if (p === 'code' && target && /[&|<>^"%!`$;\r\n]/.test(target)) throw new Error('That path has characters that cannot be passed safely to VS Code. Rename the folder or open it from VS Code.');
    spawn(p, target ? [target] : [], { detached: true, stdio: 'ignore', shell: p === 'code' }).unref();
    return `Opened VS Code${target ? ` with ${target}` : ''}.`;
  }
  const p = findIde(args.ide);
  if (!p) return `${args.ide} was not found on this PC. Install it with dev_install (${args.ide === 'sdkmanager' ? 'NVIDIA SDK Manager runs on Ubuntu — on Windows use WSL2 with Ubuntu, or a Linux PC' : `tool "${args.ide}"`}).`;
  spawn(p, target ? [target] : [], { detached: true, stdio: 'ignore' }).unref();
  return `Opened ${args.ide}${target ? ` with ${target}` : ''}. Use computer_view / computer_act to work in it.`;
}

async function micropython(args, ctx) {
  const py = IS_WIN ? 'python' : 'python3';
  const base = ['-m', 'mpremote'];
  const conn = args.port ? ['connect', args.port] : [];
  const local = (p) => (path.isAbsolute(p) ? p : path.join(ctx.workspace, p));
  let a;
  switch (args.action) {
    case 'devices': a = ['devs']; break;
    case 'version': a = [...conn, 'exec', 'import sys; print(sys.implementation, sys.version, sys.platform)']; break;
    case 'ls': a = [...conn, 'fs', 'ls', args.remote ? `:${args.remote}` : ':']; break;
    case 'cat': a = [...conn, 'fs', 'cat', `:${args.remote || 'main.py'}`]; break;
    case 'put': if (!args.path) throw new Error('path is needed'); a = [...conn, 'fs', 'cp', local(args.path), `:${args.remote || path.basename(args.path)}`]; break;
    case 'get': if (!args.remote) throw new Error('remote is needed'); a = [...conn, 'fs', 'cp', `:${args.remote}`, local(args.path || path.basename(args.remote))]; break;
    case 'rm': if (!args.remote) throw new Error('remote is needed'); a = [...conn, 'fs', 'rm', `:${args.remote}`]; break;
    case 'run': if (!args.path) throw new Error('path of the .py file is needed'); a = [...conn, 'run', local(args.path)]; break;
    case 'exec': if (!args.code) throw new Error('code is needed'); a = [...conn, 'exec', args.code]; break;
    case 'install': if (!args.package) throw new Error('package is needed'); a = [...conn, 'mip', 'install', args.package]; break;
    case 'reset': a = [...conn, 'reset']; break;
    default: throw new Error(`unknown action ${args.action}`);
  }
  const r = await run(py, [...base, ...a], { timeoutMs: Math.min(600, Number(args.timeout_seconds) || 60) * 1000, cwd: ctx.workspace, signal: ctx.signal });
  if (/No module named mpremote/i.test(r.out)) return 'mpremote is not installed. Run dev_install with tool "mpremote" first.';
  if (/no device found|failed to access/i.test(r.out)) return `${r.out}\nNo MicroPython board answered. Check the USB cable (data, not charge-only), that MicroPython is flashed (pico_flash with the MicroPython .uf2), and close Thonny/serial monitors that hold the port.`;
  return `${r.code === 0 ? '' : `[exit code ${r.code}]\n`}${r.out || '(no output)'}`;
}

async function picoFlash(args, ctx) {
  const uf2 = path.isAbsolute(args.uf2) ? args.uf2 : path.join(ctx.workspace, args.uf2);
  if (!exists(uf2) || !/\.uf2$/i.test(uf2)) throw new Error(`Not a .uf2 file: ${uf2}`);
  let drive = '';
  if (IS_WIN) {
    const r = await ps("(Get-Volume | Where-Object { $_.FileSystemLabel -match 'RPI-RP2|RP2350' } | Select-Object -First 1).DriveLetter", { timeoutMs: 15000 });
    if (r.out.trim()) drive = `${r.out.trim()}:\\`;
  } else {
    for (const b of ['/media', '/run/media', '/Volumes']) { try { for (const u of fs.readdirSync(b)) for (const v of [path.join(b, u), ...((() => { try { return fs.readdirSync(path.join(b, u)).map((x) => path.join(b, u, x)); } catch { return []; } })())]) if (/RPI-RP2|RP2350/.test(path.basename(v))) drive = v; } catch {} }
  }
  if (!drive) return 'No Pico in BOOTSEL mode was found. Unplug the Pico, hold the BOOTSEL button, plug it in again (a drive called RPI-RP2 or RP2350 appears), then run pico_flash again.';
  fs.copyFileSync(uf2, path.join(drive, path.basename(uf2)));
  return `Copied ${path.basename(uf2)} to ${drive}. The Pico reboots into the new firmware by itself (the drive disappears). For MicroPython check it with micropython action "version".`;
}

async function sdCard(args, ctx) {
  if (!IS_WIN) throw new Error('SD card imaging from the app is available on Windows; on Linux/macOS use Raspberry Pi Imager directly.');
  const list = await ps("Get-Disk | Where-Object { ($_.BusType -eq 'USB' -or $_.BusType -eq 'SD' -or $_.BusType -eq 'MMC') -and -not $_.IsSystem -and -not $_.IsBoot } | ForEach-Object { '' + $_.Number + '|' + $_.FriendlyName + '|' + $_.SerialNumber + '|' + [math]::Round($_.Size/1GB,1) + ' GB|' + $_.BusType }", { timeoutMs: 20000 });
  const disks = list.out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [n, name, serial, size, bus] = l.split('|'); return { n: Number(n), name, serial: (serial || '').trim(), size, bus }; });
  if (args.action === 'list') return disks.length ? 'Removable drives you could image (system disks are never listed):\n' + disks.map((d) => `- disk ${d.n}: ${d.name} — ${d.size} (${d.bus}) serial "${d.serial}"`).join('\n') + '\nTo write: confirm with the user which drive will be ERASED, then call write with disk and serial.' : 'No removable USB / SD drives found. Insert the SD card (in a USB reader) and try again.';
  const d = disks.find((x) => x.n === Number(args.disk));
  if (!d) throw new Error(`Disk ${args.disk} is not a removable USB/SD drive. Run action "list" first.`);
  if (!args.serial || String(args.serial).trim() !== d.serial) throw new Error(`The serial does not match disk ${d.n} ("${d.serial}"). Pass the exact serial from "list" — this protects against erasing the wrong drive.`);
  const img = path.isAbsolute(args.image || '') ? args.image : path.join(ctx.workspace, args.image || '');
  if (!exists(img)) throw new Error(`Image not found: ${img}`);
  const imager = findIde('rpi-imager');
  if (!imager) return 'Raspberry Pi Imager is not installed. Run dev_install with tool "rpi-imager" first.';
  ctx.status && ctx.status(`Writing ${path.basename(img)} to ${d.name} (Windows will ask for permission)…`);
  // rpi-imager needs administrator rights to write a raw disk: start it elevated (the user clicks Yes)
  const r = await ps(`$p = Start-Process -FilePath '${imager.replace(/'/g, "''")}' -ArgumentList '--cli','--enable-writing-system-drives:false','"${img.replace(/'/g, "''")}"','\\\\.\\PhysicalDrive${d.n}' -Verb RunAs -Wait -PassThru; $p.ExitCode`, { timeoutMs: 3600000, signal: ctx.signal });
  const code = Number(firstLine(r.out));
  return code === 0 ? `✓ Wrote ${path.basename(img)} to disk ${d.n} (${d.name}). Eject it safely before removing.` : `✕ Raspberry Pi Imager reported exit code ${firstLine(r.out) || r.code}. ${r.out.slice(-500)}`;
}

// ------------------------------------------------------------------ security checks
const SERVER_CHECK = `
echo "== OS"; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"); uname -r
echo "== LISTENING"; (ss -tulpnH 2>/dev/null || netstat -tulpn 2>/dev/null) | awk '{print $1, $5, $7}' | sort -u | head -60
echo "== FIREWALL"; (sudo -n ufw status 2>/dev/null || ufw status 2>/dev/null) | head -20; (sudo -n firewall-cmd --state 2>/dev/null && sudo -n firewall-cmd --list-all 2>/dev/null | head -20); (sudo -n iptables -S 2>/dev/null | head -15)
echo "== SSHD"; (sudo -n sshd -T 2>/dev/null || sshd -T 2>/dev/null) | grep -Ei '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|permitemptypasswords|kbdinteractiveauthentication|x11forwarding|maxauthtries) ' ; grep -Ei '^\\s*(PermitRootLogin|PasswordAuthentication)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | head
echo "== UPDATES"; (apt list --upgradable 2>/dev/null | grep -c -i security) 2>/dev/null; (apt list --upgradable 2>/dev/null | tail -n +2 | wc -l); (dnf -q check-update --security 2>/dev/null | wc -l)
echo "== AUTOUPDATES"; (dpkg -l unattended-upgrades 2>/dev/null | grep -c '^ii'); (systemctl is-enabled dnf-automatic.timer 2>/dev/null)
echo "== FAIL2BAN"; (systemctl is-active fail2ban 2>/dev/null || echo inactive)
echo "== SUDO_NOPASSWD"; (sudo -n grep -rhE 'NOPASSWD' /etc/sudoers /etc/sudoers.d 2>/dev/null | grep -v '^#' | head -5)
echo "== USERS_SHELL"; awk -F: '$7 ~ /(bash|sh|zsh)$/ {print $1}' /etc/passwd | tr '\\n' ' '; echo
echo "== DOCKER"; (docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | head -20)
echo "== WEBROOT"; for d in /var/www /usr/share/nginx/html /srv/www; do [ -d "$d" ] && find "$d" -maxdepth 4 \\( -name '.env' -o -name '.git' -o -name '*.sql' -o -name '*.bak' -o -name '*.zip' -o -name 'id_rsa*' \\) 2>/dev/null | head -10; done
echo "== DISK"; df -h / | tail -1
echo "== REBOOT"; [ -f /var/run/reboot-required ] && echo required || echo no
`;
function analyseServer(out) {
  const sec = {};
  let cur = null;
  for (const l of out.split('\n')) { const m = l.match(/^== (\w+)/); if (m) { cur = m[1]; sec[cur] = []; } else if (cur && l.trim()) sec[cur].push(l.trim()); }
  const f = [];
  const add = (lvl, msg, fix) => f.push(`${lvl} ${msg}${fix ? `\n   → ${fix}` : ''}`);
  const listen = (sec.LISTENING || []).join('\n');
  const pub = (sec.LISTENING || []).filter((l) => /(^|\s)(0\.0\.0\.0|\*|\[::\]|::):\d+/.test(l));
  const risky = { 3306: 'MySQL', 5432: 'PostgreSQL', 6379: 'Redis', 27017: 'MongoDB', 9200: 'Elasticsearch', 11211: 'Memcached', 5984: 'CouchDB', 2375: 'Docker API (unencrypted!)', 8080: 'HTTP alt / admin', 9000: 'admin panel / PHP-FPM', 5000: 'dev server', 3000: 'dev server' };
  for (const [port, name] of Object.entries(risky)) if (pub.some((l) => new RegExp(`:${port}\\b`).test(l))) add(Number(port) === 2375 || Number(port) === 6379 || Number(port) === 27017 ? '✗' : '⚠', `${name} listens on all interfaces (port ${port})`, 'bind it to 127.0.0.1 or block the port in the firewall unless it must be public');
  if (pub.length) add('ℹ', `Public listening ports: ${[...new Set(pub.map((l) => (l.match(/:(\d+)\s/) || [])[1]).filter(Boolean))].sort((a, b) => a - b).join(', ')}`);
  const fw = (sec.FIREWALL || []).join('\n');
  if (!fw || /Status: inactive/i.test(fw) || (/not running/i.test(fw) && !/-A /.test(fw))) add('✗', 'No active firewall found (ufw / firewalld / iptables)', 'e.g. ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable');
  else add('✓', 'Firewall is active');
  const ssh = (sec.SSHD || []).join('\n').toLowerCase();
  if (/permitrootlogin yes/.test(ssh)) add('✗', 'SSH allows root login with a password', 'PermitRootLogin prohibit-password (or no) in /etc/ssh/sshd_config, then systemctl reload ssh');
  else if (/permitrootlogin (prohibit-password|without-password|no)/.test(ssh)) add('✓', 'SSH root login restricted');
  if (/passwordauthentication yes/.test(ssh)) add('⚠', 'SSH password login is enabled', 'use SSH keys (Remote → Install key) then set PasswordAuthentication no');
  else if (/passwordauthentication no/.test(ssh)) add('✓', 'SSH password login disabled (keys only)');
  if (/permitemptypasswords yes/.test(ssh)) add('✗', 'SSH permits empty passwords', 'PermitEmptyPasswords no');
  if (!ssh) add('ℹ', 'Could not read the SSH server settings (needs sudo without password, or run the check as root)');
  const up = (sec.UPDATES || []).map(Number).filter((n) => !isNaN(n));
  if (up[0] > 0) add('✗', `${up[0]} security updates pending`, 'apt update && apt upgrade (or dnf upgrade --security)');
  else if (up[1] > 0) add('⚠', `${up[1]} package updates pending`, 'apt update && apt upgrade');
  else add('✓', 'No pending package updates found');
  if (!(sec.AUTOUPDATES || []).some((l) => /^1$|enabled/.test(l))) add('⚠', 'Automatic security updates are not set up', 'apt install unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades');
  if ((sec.FAIL2BAN || []).some((l) => /^active/.test(l))) add('✓', 'fail2ban is running');
  else add('⚠', 'fail2ban is not running (no brute-force protection for SSH)', 'apt install fail2ban && systemctl enable --now fail2ban');
  if ((sec.SUDO_NOPASSWD || []).length) add('ℹ', `sudo without password configured: ${sec.SUDO_NOPASSWD.join(' ; ').slice(0, 200)}`);
  if ((sec.DOCKER || []).some((l) => /0\.0\.0\.0:\d+->/.test(l))) add('⚠', `Docker publishes ports on all interfaces: ${(sec.DOCKER || []).filter((l) => /0\.0\.0\.0/.test(l)).join(' ; ').slice(0, 300)}`, 'publish as 127.0.0.1:PORT:PORT behind a reverse proxy, or firewall them (Docker bypasses ufw!)');
  if ((sec.WEBROOT || []).length) add('✗', `Sensitive files inside a web root: ${sec.WEBROOT.join(', ').slice(0, 300)}`, 'move them out of the web root or deny access in the web server');
  if ((sec.REBOOT || []).includes('required')) add('⚠', 'A reboot is required to finish updates');
  const disk = (sec.DISK || [])[0] || '';
  const pct = Number((disk.match(/(\d+)%/) || [])[1]);
  if (pct >= 90) add('⚠', `Disk almost full (${pct}%)`, 'clean logs/old releases or grow the disk');
  return { findings: f, os: (sec.OS || []).join(' '), listen };
}

async function securityCheck(args, ctx) {
  if (!args.server && !args.url) throw new Error('Give a server (saved name) and/or a url / domain.');
  const out = [];
  if (args.server) {
    if (!ctx.remote) throw new Error('Remote servers are not available here.');
    const s = ctx.remote.need(args.server);
    ctx.status && ctx.status(`Security check of ${s.name}…`);
    const r = await ctx.remote.exec(s.id, SERVER_CHECK, { timeoutMs: 120000, signal: ctx.signal });
    const raw = typeof r === 'string' ? r : (r.stdout || r.out || '') + (r.stderr ? `\n${r.stderr}` : '');
    const a = analyseServer(raw);
    out.push(`## Server ${s.name} (${s.username}@${s.host}) — ${a.os || 'unknown OS'}`, ...a.findings);
  }
  if (args.url) {
    let u = String(args.url).trim();
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    const url = new URL(u);
    ctx.status && ctx.status(`Security check of ${url.host}…`);
    out.push('', `## Website ${url.origin}`);
    // certificate
    if (url.protocol === 'https:') {
      try {
        const cert = await new Promise((resolve, reject) => {
          const sock = tls.connect({ host: url.hostname, port: Number(url.port) || 443, servername: url.hostname, rejectUnauthorized: false, timeout: 10000 }, () => { const c = sock.getPeerCertificate(); const ok = sock.authorized; const err = sock.authorizationError; const proto = sock.getProtocol(); sock.end(); resolve({ c, ok, err, proto }); });
          sock.on('error', reject); sock.on('timeout', () => { sock.destroy(new Error('timeout')); });
        });
        const days = Math.round((new Date(cert.c.valid_to) - Date.now()) / 86400000);
        if (!cert.ok) out.push(`✗ HTTPS certificate is not trusted: ${cert.err}`);
        else out.push(`✓ HTTPS certificate trusted (${cert.c.issuer && (cert.c.issuer.O || cert.c.issuer.CN)}), ${cert.proto}`);
        out.push(days < 0 ? `✗ Certificate EXPIRED ${-days} days ago` : days < 14 ? `⚠ Certificate expires in ${days} days → check auto-renewal (certbot renew --dry-run)` : `✓ Certificate valid for ${days} more days`);
        if (/TLSv1(\.0|\.1)?$/.test(cert.proto || '')) out.push('⚠ Old TLS version negotiated → allow only TLS 1.2+');
      } catch (e) { out.push(`✗ No HTTPS on ${url.hostname}:${url.port || 443} (${e.message}) → set up a certificate (e.g. certbot)`); }
    }
    const get = async (p, opts = {}) => { try { return await fetch(new URL(p, url), { redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Muse-Carpathron-security-check' }, ...opts }); } catch (e) { return { status: 0, headers: new Headers(), error: e.message, text: async () => '' }; } };
    // http → https
    const plain = await get(`http://${url.host}/`);
    if (plain.status >= 300 && plain.status < 400 && /^https:/i.test(plain.headers.get('location') || '')) out.push('✓ HTTP redirects to HTTPS');
    else if (plain.status) out.push(`⚠ HTTP does not redirect to HTTPS (status ${plain.status}) → add a 301 redirect`);
    const home = await get(url.pathname || '/');
    if (!home.status) out.push(`✗ Site did not answer: ${home.error}`);
    else {
      const h = home.headers;
      const want = { 'strict-transport-security': 'HSTS', 'content-security-policy': 'Content-Security-Policy', 'x-content-type-options': 'X-Content-Type-Options: nosniff', 'x-frame-options': 'X-Frame-Options (or CSP frame-ancestors)', 'referrer-policy': 'Referrer-Policy' };
      const missing = Object.entries(want).filter(([k]) => !h.get(k) && !(k === 'x-frame-options' && /frame-ancestors/i.test(h.get('content-security-policy') || ''))).map(([, v]) => v);
      out.push(missing.length ? `⚠ Missing security headers: ${missing.join(', ')}` : '✓ Security headers present');
      const server = h.get('server') || '', powered = h.get('x-powered-by') || '';
      if (/\d/.test(server) || powered) out.push(`⚠ Server reveals versions (${[server, powered].filter(Boolean).join(', ')}) → server_tokens off / expose_php Off / remove X-Powered-By`);
      const cookies = h.getSetCookie ? h.getSetCookie() : [];
      const weak = cookies.filter((c) => !/;\s*secure/i.test(c) || !/;\s*httponly/i.test(c));
      if (weak.length) out.push(`⚠ ${weak.length} cookie(s) without Secure/HttpOnly → set both flags (and SameSite)`);
    }
    const probes = ['/.git/HEAD', '/.env', '/.DS_Store', '/backup.zip', '/backup.sql', '/db.sql', '/wp-config.php.bak', '/phpinfo.php', '/server-status', '/.htpasswd', '/config.json', '/.vscode/sftp.json'];
    const exposed = [];
    await Promise.all(probes.map(async (p) => {
      const r = await get(p);
      if (r.status !== 200) return;
      const body = (await r.text().catch(() => '')).slice(0, 400);
      const real = (p === '/.git/HEAD' && /^ref:/.test(body)) || (p === '/.env' && /=/.test(body) && !/<html/i.test(body)) || (p === '/phpinfo.php' && /phpinfo|PHP Version/i.test(body)) || (p === '/server-status' && /Apache Server Status/i.test(body)) || (/\.(zip|sql|bak|DS_Store|htpasswd|json)$/.test(p) && !/<html/i.test(body) && body.length > 0);
      if (real) exposed.push(p);
    }));
    out.push(exposed.length ? `✗ Publicly readable: ${exposed.join(', ')} → remove them or deny access in the web server NOW (they can leak source code, passwords or data)` : '✓ No common sensitive files exposed');
  }
  const bad = out.filter((l) => l.startsWith('✗')).length, warn = out.filter((l) => l.startsWith('⚠')).length;
  return `${out.join('\n')}\n\nSummary: ${bad} critical, ${warn} warnings. Fix the ✗ items first, then the ⚠ ones, and run security_check again to confirm.`;
}

async function askModel(args, ctx) {
  if (!ctx.api) throw new Error('The Meta API engine is not available.');
  const model = String(args.model || '').trim();
  if (!model) throw new Error('model is needed');
  const models = require('./models');
  const kind = models.capsFor(model).kind;
  if (kind && kind !== 'chat') throw new Error(`${model} is not a text model (${kind}). Use ${kind === 'image' ? 'generate_image' : kind === 'segment' ? 'segment_image' : 'transcribe_audio'} instead.`);
  ctx.status && ctx.status(`Asking ${model}…`);
  const res = await ctx.api.complete({ model, effort: args.effort, messages: [{ role: 'system', content: 'You are consulted by another AI agent (Carpathron Robotics & Coding). Answer precisely. Say clearly when you are not sure; never invent facts.' }, { role: 'user', content: String(args.prompt || '') }], tools: [], signal: ctx.signal, onText: () => {} });
  return `${model} answered:\n\n${res.content || '(empty answer)'}`;
}

async function execDev(name, args, ctx) {
  switch (name) {
    case 'dev_environment': return devEnvironment(args || {}, ctx);
    case 'dev_install': return devInstall(args, ctx);
    case 'open_ide': return openIde(args, ctx);
    case 'micropython': return micropython(args, ctx);
    case 'pico_flash': return picoFlash(args, ctx);
    case 'sd_card_image': return sdCard(args, ctx);
    case 'security_check': return securityCheck(args, ctx);
    case 'ask_model': return askModel(args, ctx);
    default: throw new Error(`unknown tool ${name}`);
  }
}

module.exports = { DEV_TOOLS, DEV_NAMES, execDev, analyseServer, SERVER_CHECK, securityCheck };
