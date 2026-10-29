// Risk rules that depend on a tool call's arguments (prompt-injection protection).
// "read" tools normally run without asking in Ask mode. These rules turn a call into "external" (needs approval
// in Ask mode) when it could leak secrets: reading credential/app-data locations, or sending data to a URL
// (query string) / reaching loopback, LAN or cloud-metadata addresses.
'use strict';
const os = require('os');
const path = require('path');
const net = require('net');

const HOME = os.homedir();
const norm = (p) => path.resolve(String(p || '')).toLowerCase();

function sensitiveDirs(dataDir) {
  const appData = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
  return [
    dataDir, // this app's data: settings, tokens, chats, keys
    dataDir && path.basename(dataDir) === 'data' ? path.dirname(dataDir) : null, // ...and its app folder (log)
    path.join(appData, 'Muse Carpathron'),
    path.join(HOME, '.ssh'), path.join(HOME, '.aws'), path.join(HOME, '.azure'), path.join(HOME, '.gnupg'),
    path.join(HOME, '.kube'), path.join(HOME, '.docker'), path.join(HOME, '.config', 'gh'), path.join(appData, 'GitHub CLI'),
    path.join(appData, 'Microsoft', 'Credentials'), path.join(local, 'Microsoft', 'Credentials'),
    path.join(appData, 'Microsoft', 'Protect'), path.join(local, 'Google', 'Chrome', 'User Data'),
    path.join(local, 'Microsoft', 'Edge', 'User Data'), path.join(appData, 'Mozilla', 'Firefox', 'Profiles'),
    path.join(local, 'BraveSoftware'),
  ].filter(Boolean).map(norm);
}
const SECRET_FILE = /(^|[\\/])(id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|\.env(\..*)?|\.npmrc|\.netrc|\.pgpass|\.git-credentials|credentials(\.json)?|[^\\/]*\.(pem|key|pfx|p12|kdbx))$/i;

function isSensitivePath(p, { workspace, dataDir } = {}) {
  if (!p) return false;
  const full = norm(path.resolve(workspace || HOME, String(p).replace(/^~(?=$|[\\/])/, HOME)));
  if (SECRET_FILE.test(full)) return true;
  return sensitiveDirs(dataDir).some((d) => full === d || full.startsWith(d + path.sep));
}

function privateHost(host) {
  host = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal') return true;
  if (net.isIPv4(host)) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(host)) return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:');
  return false;
}

// A URL that could carry data out (query string, long path) or reach a private address.
function riskyUrl(u) {
  let url; try { url = new URL(String(u)); } catch { return false; }
  if (!/^https?:$/.test(url.protocol)) return true;
  if (privateHost(url.hostname)) return true;
  if (url.search.length > 1) return true;
  return url.pathname.length > 200;
}

function effectiveRisk(name, args, base, ctx = {}) {
  if (base !== 'read') return base;
  args = args || {};
  switch (name) {
    case 'read_file': case 'list_dir': case 'search':
      return isSensitivePath(args.path || (name === 'read_file' ? '' : '.'), ctx) ? 'external' : base;
    case 'web_fetch': case 'screenshot_page':
      return riskyUrl(args.url) ? 'external' : base;
    case 'browser_view':
      return args.action === 'open' && riskyUrl(args.url) ? 'external' : base;
    case 'computer_view':
      return args.action === 'screenshot' ? 'external' : base; // the screen can show anything: ask once per chat in Ask mode
    default:
      return base;
  }
}

module.exports = { effectiveRisk, isSensitivePath, riskyUrl, privateHost };
