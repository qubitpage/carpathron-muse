const { _electron: electron } = require(process.env.PW || 'playwright');
const fs = require('fs'), os = require('os'), path = require('path');
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-el-'));
  const app = await electron.launch({ executablePath: require('path').join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${ud}`, '--no-sandbox'], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } });
  const win = await app.firstWindow();
  await win.waitForTimeout(4000);
  const foot = await win.textContent('#sideFoot');
  console.log('footer:', foot);
  await win.screenshot({ path: process.argv[2] + '/electron.png' });
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
