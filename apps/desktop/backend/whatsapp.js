// Control Muse Carpathron from a phone over WhatsApp.
//  - Personal WhatsApp: pair like WhatsApp Web with a QR code (unofficial, Baileys). Use "Message yourself" or an allowed number.
//  - WhatsApp Business Cloud API (official, Meta): webhook + Graph API sending. Needs a public URL (Cloudflare tunnel helper included).
// Only the owner's own chat and numbers in the allow-list can control the app.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const voice = require('./voice');

const HELP = [
  '*Muse Carpathron* — commands:',
  '/new — start a new chat',
  '/stop — stop the current task',
  '/mode ask|auto|full|plan — approval mode',
  '/status — what is running',
  '',
  '*Robot*',
  '/photo — take a picture and send it here',
  '/drive forward|back|left|right [seconds] — move the car (e.g. /drive forward 2)',
  '/f  /b  /l  /r — short moves (1 s)   /robot stop — stop',
  '/look left|right|back — the car turns to look, sends the photo, turns back',
  '/turn 90 — turn on the spot (degrees, minus = left)',
  '/scan — scan the room: the car turns around, photographs every side and sends back a map',
  'Or just write: "drive forward 1 meter and take a photo"',
  '',
  '*Voice* 🎤 — send a voice note: "forward two seconds", "stop", "look left", "take a photo", "scan the room",',
  'or any longer request — it is transcribed and done like a typed message (English and 24 other languages).',
  '',
  '/remember <fact> — save to memory',
  'yes / no — answer an approval request',
  'Anything else is sent to the agent.',
].join('\n');

const digits = (s) => String(s || '').replace(/\D/g, '');
const BOT_MARK = '🤖 ';

class WhatsApp {
  constructor({ store, agent, emit, log, dataDir }) {
    this.store = store;
    this.agent = agent;
    this.emit = emit;
    this.log = log;
    this.dataDir = dataDir;
    this.authDir = path.join(dataDir, 'whatsapp-auth');
    this.personal = { status: 'off', qr: null, me: null, sock: null };
    this.cloud = { status: 'off', tunnelUrl: '', tunnel: null };
    this.sentIds = new Set();
    this.chatFor = new Map(); // "channel:number" -> reply fn (for approval prompts)
  }

  cfg() { return this.store.settings.whatsapp; }
  status() {
    return {
      personal: { status: this.personal.status, qr: this.personal.qr, me: this.personal.me },
      cloud: { status: this.cloud.status, tunnelUrl: this.cloud.tunnelUrl, webhookPath: '/whatsapp/webhook' },
      allowed: this.cfg().allowed,
    };
  }
  _changed() { this.emit('wa:status', this.status()); }

  isAllowed(number) {
    // Exact match on the full international number (digits only, country code included, no leading 00 or +).
    const n = digits(number).replace(/^00/, '');
    return n.length >= 8 && this.cfg().allowed.some((a) => digits(a).replace(/^00/, '') === n);
  }

  // ------------------------------------------------------------ shared command handling
  convFor(key) {
    const map = this.store.settings.whatsapp.conversations || {};
    let conv = map[key] && this.store.get(map[key]);
    if (!conv) {
      const quest = key.startsWith('quest:');
      conv = this.store.createConversation({ title: quest ? 'Quest headset' : `WhatsApp ${key.split(':')[1] || ''}`.trim(), source: 'whatsapp' });
      if (quest) { conv.mode = 'ask'; this.store.touch(conv); } // voice from the headset never runs actions without approval
      this.store.settings.whatsapp.conversations = { ...map, [key]: conv.id };
      this.store.saveSettings();
      this.emit('conv:update', { id: conv.id, title: conv.title, updatedAt: conv.updatedAt, source: 'whatsapp' });
    }
    return conv;
  }

  // Direct robot moves without the AI (fast and free). Returns a plan or null.
  static drivePlan(lower) {
    const short = { '/f': 'forward', '/b': 'back', '/l': 'left', '/r': 'right' };
    let dir, secs = 1;
    if (short[lower]) dir = short[lower];
    const m = lower.match(/^\/drive\s+(forward|fwd|back|backward|left|right)\s*([\d.]+)?\s*s?$/);
    if (m) { dir = m[1]; secs = Math.min(5, Math.max(0.2, Number(m[2]) || 1)); }
    if (!dir) return null;
    const v = { forward: [60, 60], fwd: [60, 60], back: [-60, -60], backward: [-60, -60], left: [-60, 60], right: [60, -60] }[dir];
    const ms = dir === 'left' || dir === 'right' ? Math.round(secs * 600) : Math.round(secs * 1000);
    return { label: dir, steps: [{ type: 'drive', left: v[0], right: v[1], ms }, { type: 'stop' }] };
  }

  // Saves a photo / video / file received on WhatsApp so the agent can see or read it.
  saveMedia(buf, mime, name) {
    const ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'application/pdf': '.pdf', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg', 'audio/aac': '.aac', 'audio/wav': '.wav' })[String(mime || '').split(';')[0]] || path.extname(String(name || '')) || '.bin';
    const dir = path.join(this.dataDir || require('os').tmpdir(), 'attachments', new Date().toISOString().slice(0, 10));
    fs.mkdirSync(dir, { recursive: true });
    const safe = path.basename(String(name || 'whatsapp')).replace(/[<>:"/\\|?*]/g, '_').replace(/\.[^.]+$/, '') || 'whatsapp';
    const file = path.join(dir, `${Date.now().toString(36)}-${safe}${ext}`);
    fs.writeFileSync(file, buf);
    const m = String(mime || '').split(';')[0] || 'application/octet-stream';
    if (/^(image|video|audio)\//.test(m)) this.agent.shown?.add(path.resolve(file));
    return { name: path.basename(file), path: file, mime: m, text: '' };
  }

  async handle(channel, number, text, reply, sendImage, attachments = []) {
    text = String(text || '').trim();
    if (!text && !attachments.length) return;
    const key = `${channel}:${digits(number)}`;
    this.chatFor.set(key, reply);
    let conv = this.convFor(key);
    const lower = text.toLowerCase();
    const pending = this.agent.pendingApprovals(conv.id);

    if (pending.length && /^(y|yes|da|ok|approve|allow|n|no|nu|deny)$/i.test(lower)) {
      const p = pending[0];
      const approve = /^(y|yes|da|ok|approve|allow)$/i.test(lower);
      const choice = p.choices.find((c) => !!c.approve === approve);
      this.agent.decide(p.approvalId, choice ? choice.id : approve, 'whatsapp');
      return reply(approve ? '✅ Approved.' : '⛔ Denied.');
    }
    if (lower === '/help' || lower === 'help') return reply(HELP);
    if (lower === '/new') {
      const map = { ...(this.store.settings.whatsapp.conversations || {}) };
      delete map[key];
      this.store.settings.whatsapp.conversations = map;
      this.store.saveSettings();
      conv = this.convFor(key);
      return reply('🆕 New chat started.');
    }
    if (lower === '/stop') { const ok = await this.agent.stop(conv.id); return reply(ok ? '⏹ Stopped.' : 'Nothing is running.'); }
    if (lower === '/status') return reply(this.agent.isRunning(conv.id) ? '⏳ Working on your last message.' : '💤 Idle. Mode: ' + (conv.mode || this.store.settings.mode));
    if (lower === '/robot stop' || lower === '/stop robot') { this.agent.robot.stop('whatsapp'); return reply('🛑 Robot stopped.'); }
    const plan = WhatsApp.drivePlan(lower);
    if (plan) {
      await reply(`🚗 Driving ${plan.label}…`);
      const r = await this.agent.robot.runPlan(plan.steps, 'whatsapp');
      return reply(r.completed ? `✅ Done (${this.agent.robot.status().state === 'online' ? 'real car' : 'simulation — no car connected'}).` : `⏹ ${r.reason || 'Stopped'}`);
    }
    const lk = lower.match(/^\/look\s+(left|right|back|behind|front|-?\d{1,3})$/);
    if (lk) {
      if (!this.agent.mapper) return reply('Not available.');
      await reply(`👀 Looking ${lk[1]}…`);
      try {
        const ph = await this.agent.mapper.look(lk[1], { source: 'whatsapp' });
        if (sendImage) await sendImage(ph.buffer, `👀 ${lk[1]} · ${new Date().toLocaleTimeString()}`);
      } catch (e) { await reply(`👀 ${e.message}`); }
      return;
    }
    if (/^\/turn\s+-?\d{1,3}$/.test(lower)) {
      try { this.agent.mapper.needCar(); await this.agent.mapper.turn(Number(lower.split(/\s+/)[1]), 'whatsapp'); return reply('↻ Turned.'); }
      catch (e) { return reply(`↻ ${e.message}`); }
    }
    if (lower === '/scan' || lower === '/map' || lower === 'scan room') {
      if (!this.agent.mapper) return reply('Room scan is not available.');
      await reply('🗺️ Scanning the room: the car turns around in steps and photographs every side (about a minute)…');
      try {
        const r = await this.agent.mapper.scan({ source: 'whatsapp' });
        if (sendImage && r.png) await sendImage(r.png, `🗺️ Room map · ${r.photos.length} directions`, 'image/png');
        if (sendImage && r.collage) await sendImage(r.collage, '📷 What the car saw (from the start direction, turning right)');
        await this.replyLong(reply, r.summary);
      } catch (e) { await reply(`🗺️ ${e.message}`); }
      return;
    }
    if (lower === '/photo' || lower === '/pic') {
      try {
        const ph = await this.agent.camera.capture();
        if (sendImage) await sendImage(ph.buffer, `📷 ${ph.source} · ${new Date().toLocaleTimeString()}`);
        else await reply(`📷 Saved ${ph.path}`);
      } catch (e) { await reply(`📷 ${e.message}`); }
      return;
    }
    const mm = lower.match(/^\/mode\s+(ask|auto|full|plan)$/);
    if (mm) {
      // Only this phone chat changes; the PC's own chats keep their mode. The Quest app always asks on the PC.
      if (channel === 'quest') return reply('The headset always asks for approval on the PC.');
      conv.mode = mm[1]; this.store.touch(conv);
      return reply(`Mode for this chat set to *${mm[1]}*.`);
    }
    if (this.agent.isRunning(conv.id)) return reply('⏳ Still working on the previous message. Send /stop to cancel it.');

    await reply('⏳ Working on it…');
    try {
      if (attachments.length) await reply(`📎 Got ${attachments.map((a) => a.mime.startsWith('image/') ? 'the photo' : a.mime.startsWith('audio/') ? 'the audio' : a.name).join(', ')} — looking at it…`);
      const answer = await this.agent.send(conv.id, text, { from: 'whatsapp', attachments });
      await this.replyLong(reply, answer || '(done)');
      const c = this.store.get(conv.id);
      for (const img of (c && c.turnImages) || []) {
        try {
          const buf = fs.readFileSync(img);
          if (sendImage) await sendImage(buf, `📷 ${path.basename(img)}`);
        } catch (e) { this.log(`WhatsApp: could not send photo: ${e.message}`); }
      }
    } catch (e) {
      await reply(`⚠️ ${e.message}`);
    }
  }

  async replyLong(reply, text) {
    const s = String(text);
    for (let i = 0; i < s.length && i < 16000; i += 3500) await reply(s.slice(i, i + 3500));
  }

  // Forward approval requests of WhatsApp chats to the phone.
  onEvent(event, data) {
    if (event !== 'approval:new' || data.source !== 'whatsapp') return;
    const map = this.store.settings.whatsapp.conversations || {};
    const key = Object.keys(map).find((k) => map[k] === data.convId);
    const reply = key && this.chatFor.get(key);
    if (reply) reply(`🔐 *Approval needed*\n${data.summary}\n\n${String(data.detail || '').slice(0, 1200)}\n\nReply *yes* or *no*.`).catch(() => {});
  }

  // Voice note -> text (Meta Muse Voice Transcribe). Short robot phrases become quick commands.
  async voiceText(download, mime, reply) {
    try {
      const buf = await download();
      const s = this.store.settings;
      const heard = await voice.transcribe(buf, { apiKey: s.apiKey, apiBase: s.apiBase, mime: mime || 'audio/ogg' });
      if (!heard) { await reply('🎤 I could not hear any words in that voice note. Try again a bit closer to the microphone.'); return null; }
      const cmd = voice.voiceToCommand(heard);
      this.log(`WhatsApp voice: "${heard.slice(0, 80)}"${cmd ? ` -> ${cmd}` : ''}`);
      await reply(`🎤 _${heard}_${cmd ? `  →  ${cmd}` : ''}`);
      return cmd || heard;
    } catch (e) {
      this.log(`WhatsApp voice error: ${e.message}`);
      await reply(`🎤 ${e.message}`);
      return null;
    }
  }

  // ------------------------------------------------------------ personal WhatsApp (QR pairing)
  async startPersonal() {
    // The Microsoft Store version ships only the official WhatsApp Business Cloud API (Store policy: no unofficial
    // clients). process.windowsStore is true when Electron runs from an MSIX/AppX package.
    if (process.windowsStore || process.env.MC_STORE_BUILD === '1') {
      this.personal.status = 'not available in the Microsoft Store version — use WhatsApp Business (Cloud API) below';
      this._changed();
      return;
    }
    if (this.personal.sock) return;
    const baileys = require('@whiskeysockets/baileys');
    const makeWASocket = baileys.default;
    const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = baileys;
    const QRCode = require('qrcode');
    const pino = require('pino');
    fs.mkdirSync(this.authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch {}
    this.personal.status = 'connecting';
    this._changed();
    const sock = makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      browser: Browsers.windows('Muse Carpathron'),
      logger: pino({ level: 'warn' }, { write: (line) => {
        this._libLogs = (this._libLogs || 0) + 1;
        if (this._libLogs > 60) return;
        try { const j = JSON.parse(line); this.log(`WhatsApp library: ${j.msg || ''} ${j.err ? (j.err.message || '') : ''}`.trim().slice(0, 300)); } catch { this.log(`WhatsApp library: ${String(line).slice(0, 300)}`); }
      } }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    this.personal.sock = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (u) => {
      if (u.qr) {
        this.personal.status = 'scan';
        this.personal.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 280 });
        this._changed();
      }
      if (u.connection === 'open') {
        this.personal.status = 'connected';
        this.personal.qr = null;
        this.personal.me = { id: sock.user?.id, lid: sock.user?.lid, name: sock.user?.name };
        this.log(`WhatsApp connected as ${digits(sock.user?.id?.split(':')[0])}`);
        this._changed();
      }
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        this.personal.sock = null;
        if (code === DisconnectReason.loggedOut) {
          fs.rmSync(this.authDir, { recursive: true, force: true });
          this.personal.status = 'off';
          this.personal.me = null;
          this.log('WhatsApp logged out.');
          this._changed();
        } else if (this.cfg().personal.enabled) {
          this.personal.status = 'reconnecting';
          this._changed();
          setTimeout(() => this.startPersonal().catch((e) => this.log(`WhatsApp: ${e.message}`)), 3000);
        } else {
          this.personal.status = 'off';
          this._changed();
        }
      }
    });
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      this._events = (this._events || 0) + 1;
      if (this._events <= 40) {
        const m0 = messages[0] || {};
        const kind = String(m0.key?.remoteJid || '').split('@')[1] || '?';
        this.log(`WhatsApp event: ${messages.length} message(s), type=${type}, chat=@${kind}, fromMe=${!!m0.key?.fromMe}, content=${Object.keys(m0.message || {}).join(',') || 'none'}`);
      }
      for (const msg of messages) {
        // "append" = messages you sent from your own phone, synced to this linked PC. Only take fresh ones.
        if (type !== 'notify') {
          const ts = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp ?? 0) * 1000;
          if (!ts || Date.now() - ts > 120000) continue;
        }
        try { await this._onPersonalMessage(sock, msg, type); } catch (e) { this.log(`WhatsApp message error: ${e.message}`); }
      }
    });
  }

  _ignore(reason, msg) {
    this._ignored = (this._ignored || 0) + 1;
    if (this._ignored <= 30) this.log(`WhatsApp: ignored a message (${reason}) chat=${String(msg.key?.remoteJid || '').replace(/^(\d{4})\d+/, '$1…')}`);
  }

  async _onPersonalMessage(sock, msg, type) {
    const baileys = require('@whiskeysockets/baileys');
    const jid = msg.key?.remoteJid || '';
    if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter') || jid.endsWith('@broadcast')) return;
    const id = msg.key.id;
    this.seenIds = this.seenIds || new Set();
    if (this.sentIds.has(id) || this.seenIds.has(id)) return;
    this.seenIds.add(id);
    if (this.seenIds.size > 1000) this.seenIds.delete(this.seenIds.values().next().value);
    const content = baileys.normalizeMessageContent(msg.message) || {};
    const text = content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || content.videoMessage?.caption || content.documentMessage?.caption || '';
    const doc = content.documentMessage;
    const audio = content.audioMessage || (doc && /^audio\//.test(doc.mimetype || '') ? doc : null);
    const visual = content.imageMessage || content.videoMessage || (doc && !audio ? doc : null);
    if (!text && !audio && !visual) return this._ignore('no text', msg);
    if (text.startsWith(BOT_MARK.trim())) return;
    const user = (j) => digits(String(j || '').split('@')[0].split(':')[0]);
    const creds = sock.authState?.creds?.me || {};
    const me = [...new Set([user(sock.user?.id), user(sock.user?.lid), user(creds.id), user(creds.lid)].filter(Boolean))];
    const chatUsers = [user(jid), user(msg.key.remoteJidAlt), user(msg.key.senderPn)].filter(Boolean);
    let number;
    if (msg.key.fromMe) {
      // only your own "Message yourself" chat, never your chats with other people
      if (!chatUsers.some((u) => me.includes(u))) return this._ignore('your message in another chat', msg);
      number = user(sock.user?.id) || me[0];
    } else {
      number = user(msg.key.senderPn || msg.key.participantPn || msg.key.remoteJidAlt) || user(jid);
      if (!this.isAllowed(number)) return this._ignore('number not in allowed list', msg);
    }
    this.log(`WhatsApp: command received (${type}) from ${number.slice(0, 4)}…`);
    const remember = (sent) => { if (sent?.key?.id) { this.sentIds.add(sent.key.id); if (this.sentIds.size > 500) this.sentIds.delete(this.sentIds.values().next().value); } };
    const reply = async (t) => remember(await sock.sendMessage(jid, { text: BOT_MARK + t }));
    const sendImage = async (buf, caption, mimetype) => remember(await sock.sendMessage(jid, { image: buf, caption: BOT_MARK + (caption || ''), ...(mimetype ? { mimetype } : {}) }));
    const download = async () => baileys.downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
    if (!text && audio) {
      const said = await this.voiceText(download, audio.mimetype, reply);
      if (said) await this.handle('wa', number, said, reply, sendImage);
      return;
    }
    if (visual) {
      try {
        const att = this.saveMedia(await download(), visual.mimetype, visual.fileName || (content.imageMessage ? 'photo' : content.videoMessage ? 'video' : 'file'));
        if (att.mime.startsWith('application/') || att.mime.startsWith('text/')) { try { att.text = await require('./knowledge').extractText(att.path); } catch {} }
        return await this.handle('wa', number, text, reply, sendImage, [att]);
      } catch (e) { await reply(`📎 Could not download the file: ${e.message}`); return; }
    }
    await this.handle('wa', number, text, reply, sendImage);
  }

  // Sends a message to your own "Message yourself" chat to prove the link works.
  async sendSelfTest() {
    const sock = this.personal.sock;
    if (!sock || this.personal.status !== 'connected') throw new Error('Personal WhatsApp is not connected.');
    const me = String(sock.user?.id || '').split(':')[0].split('@')[0];
    const jid = `${me}@s.whatsapp.net`;
    const sent = await sock.sendMessage(jid, { text: `${BOT_MARK}Muse Carpathron is connected ✅\nReply in this chat with /help` });
    if (sent?.key?.id) this.sentIds.add(sent.key.id);
    this.log(`WhatsApp: test message sent to your own chat (${me.slice(0, 4)}…)`);
    return true;
  }

  async stopPersonal({ logout = false } = {}) {
    const sock = this.personal.sock;
    this.personal.sock = null;
    if (sock) {
      try { if (logout) await sock.logout(); else sock.end(undefined); } catch {}
    }
    if (logout) fs.rmSync(this.authDir, { recursive: true, force: true });
    this.personal.status = 'off';
    this.personal.qr = null;
    if (logout) this.personal.me = null;
    this._changed();
  }

  // ------------------------------------------------------------ WhatsApp Business Cloud API
  cloudVerify(query) {
    const c = this.cfg().cloud;
    if (query['hub.mode'] === 'subscribe' && c.verifyToken && query['hub.verify_token'] === c.verifyToken) return String(query['hub.challenge'] || '');
    return null;
  }

  cloudSignatureOk(rawBody, header) {
    const secret = this.cfg().cloud.appSecret;
    if (!secret) return false; // required: without it anyone who can reach the webhook could pose as Meta
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(String(header || '')), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async cloudReceive(body) {
    const c = this.cfg().cloud;
    if (!c.enabled) return;
    for (const entry of body.entry || []) {
      for (const ch of entry.changes || []) {
        const v = ch.value || {};
        if (c.phoneNumberId && v.metadata?.phone_number_id && v.metadata.phone_number_id !== c.phoneNumberId) continue;
        for (const m of v.messages || []) {
          if (!['text', 'audio', 'image', 'video', 'document'].includes(m.type)) continue;
          if (!this.isAllowed(m.from)) { this.log(`WhatsApp Cloud: ignored message from non-allowed ${m.from}`); continue; }
          const reply = (t) => this.cloudSend(m.from, t);
          const sendImage = (buf, caption, mime) => this.cloudSendImage(m.from, buf, caption, mime);
          const run = async () => {
            let text = m.text?.body || '';
            const media = m[m.type] && m.type !== 'text' ? m[m.type] : null;
            const isAudio = m.type === 'audio' || (m.type === 'document' && /^audio\//.test(media?.mime_type || ''));
            if (isAudio) text = await this.voiceText(() => this.cloudDownload(media?.id), media?.mime_type, reply);
            else if (media) {
              const att = this.saveMedia(await this.cloudDownload(media.id), media.mime_type, media.filename || m.type);
              if (att.mime.startsWith('application/') || att.mime.startsWith('text/')) { try { att.text = await require('./knowledge').extractText(att.path); } catch {} }
              return this.handle('cloud', m.from, media.caption || '', reply, sendImage, [att]);
            }
            if (text) await this.handle('cloud', m.from, text, reply, sendImage);
          };
          run().catch((e) => this.log(`WhatsApp Cloud: ${e.message}`));
        }
      }
    }
  }

  async cloudSend(to, text) {
    const c = this.cfg().cloud;
    if (!c.accessToken || !c.phoneNumberId) throw new Error('WhatsApp Cloud API is not configured');
    const res = await fetch(`https://graph.facebook.com/${c.graphVersion || 'v21.0'}/${c.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: digits(to), type: 'text', text: { body: BOT_MARK + text, preview_url: false } }),
    });
    if (!res.ok) throw new Error(`Graph API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  // Downloads received media (voice notes) from the Graph API.
  async cloudDownload(mediaId) {
    const c = this.cfg().cloud;
    if (!mediaId) throw new Error('voice note without media id');
    const g = `https://graph.facebook.com/${c.graphVersion || 'v21.0'}`;
    const meta = await fetch(`${this.cloudGraphBase || g}/${mediaId}`, { headers: { Authorization: `Bearer ${c.accessToken}` } });
    if (!meta.ok) throw new Error(`Graph media ${meta.status}`);
    const { url } = await meta.json();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${c.accessToken}` } });
    if (!res.ok) throw new Error(`Graph media download ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async cloudSendImage(to, buf, caption, mime = 'image/jpeg') {
    const c = this.cfg().cloud;
    const base = `https://graph.facebook.com/${c.graphVersion || 'v21.0'}/${c.phoneNumberId}`;
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    form.append('file', new Blob([buf], { type: mime }), mime === 'image/png' ? 'map.png' : 'photo.jpg');
    const up = await fetch(`${base}/media`, { method: 'POST', headers: { Authorization: `Bearer ${c.accessToken}` }, body: form });
    if (!up.ok) throw new Error(`Graph media upload ${up.status}: ${(await up.text()).slice(0, 200)}`);
    const { id } = await up.json();
    const res = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: digits(to), type: 'image', image: { id, caption: BOT_MARK + (caption || '') } }),
    });
    if (!res.ok) throw new Error(`Graph API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  // Optional public URL for the webhook through a Cloudflare quick tunnel (needs cloudflared installed).
  startTunnel(port) {
    if (this.cloud.tunnel) return;
    const bin = this.cfg().cloud.cloudflaredPath || 'cloudflared';
    const p = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `https://localhost:${port}`, '--no-tls-verify'], { windowsHide: true });
    this.cloud.tunnel = p;
    this.cloud.status = 'starting tunnel';
    this._changed();
    const onData = (d) => {
      const m = d.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !this.cloud.tunnelUrl) { this.cloud.tunnelUrl = m[0]; this.cloud.status = 'tunnel ready'; this._changed(); }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => { this.cloud.status = `tunnel error: ${e.code === 'ENOENT' ? 'cloudflared not installed' : e.message}`; this.cloud.tunnel = null; this._changed(); });
    p.on('exit', () => { this.cloud.tunnel = null; this.cloud.tunnelUrl = ''; if (!/error/.test(this.cloud.status)) this.cloud.status = 'off'; this._changed(); });
  }
  stopTunnel() { if (this.cloud.tunnel) { try { this.cloud.tunnel.kill(); } catch {} } }

  async applySettings() {
    const c = this.cfg();
    if (c.personal.enabled && !this.personal.sock) this.startPersonal().catch((e) => { this.personal.status = `error: ${e.message}`; this._changed(); });
    if (!c.personal.enabled && this.personal.sock) await this.stopPersonal();
    this.cloud.status = c.cloud.enabled ? (this.cloud.tunnelUrl ? 'tunnel ready' : 'webhook waiting') : 'off';
    this._changed();
  }

  async close() { this.stopTunnel(); if (this.personal.sock) { try { this.personal.sock.end(undefined); } catch {} } }
}

module.exports = { WhatsApp, digits };
