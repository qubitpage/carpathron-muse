// Unit test of the personal WhatsApp message filter with a fake socket.
const assert = require('assert');
const { WhatsApp } = require('../backend/whatsapp');
const logs = [], handled = [], sent = [];
const store = { settings: { whatsapp: { allowed: ['+40 711 111 111'], personal: {}, cloud: {} } } };
const wa = new WhatsApp({ store, agent: {}, emit: () => {}, log: (t) => logs.push(t), dataDir: '/tmp' });
wa.handle = async (ch, num, text, reply) => { handled.push([num, text]); await reply('ok'); };
const sock = { user: { id: '40774077860:5@s.whatsapp.net', lid: '123456789012345:5@lid' }, authState: { creds: { me: {} } }, sendMessage: async (jid, m) => { sent.push([jid, m.text]); return { key: { id: 'bot' + sent.length } }; } };
const now = Math.floor(Date.now() / 1000);
const m = (key, message, ts = now) => ({ key: { id: Math.random().toString(36), ...key }, message, messageTimestamp: ts });
(async () => {
  await wa._onPersonalMessage(sock, m({ remoteJid: '40774077860@s.whatsapp.net', fromMe: true }, { conversation: '/help' }), 'notify');
  await wa._onPersonalMessage(sock, m({ remoteJid: '123456789012345@lid', fromMe: true }, { extendedTextMessage: { text: 'via lid' } }), 'append');
  await wa._onPersonalMessage(sock, m({ remoteJid: '123456789012345@lid', fromMe: true }, { ephemeralMessage: { message: { conversation: 'ephemeral' } } }), 'notify');
  await wa._onPersonalMessage(sock, m({ remoteJid: '40799999999@s.whatsapp.net', fromMe: true }, { conversation: 'to a friend' }), 'notify');
  await wa._onPersonalMessage(sock, m({ remoteJid: '40722222222@s.whatsapp.net', fromMe: false }, { conversation: 'stranger' }), 'notify');
  await wa._onPersonalMessage(sock, m({ remoteJid: '999@lid', senderPn: '40711111111@s.whatsapp.net', fromMe: false }, { conversation: 'allowed friend' }), 'notify');
  await wa._onPersonalMessage(sock, m({ remoteJid: '40774077860@s.whatsapp.net', fromMe: true }, { conversation: '🤖 bot echo' }), 'notify');
  assert.deepStrictEqual(handled.map((h) => h[1]), ['/help', 'via lid', 'ephemeral', 'allowed friend']);
  assert.ok(logs.some((l) => /another chat/.test(l)) && logs.some((l) => /not in allowed/.test(l)));
  console.log('WhatsApp personal filter: OK', handled.length, 'handled,', logs.filter((l) => /ignored/.test(l)).length, 'ignored');
})().catch((e) => { console.error(e); process.exit(1); });
