'use strict';
/*
 * Captures d'écran automatiques (pour vérifier un changement visuel sans lancer OBS).
 * Lance un serveur temporaire (port et base de données à part), puis Chromium via Playwright.
 *
 *   node tools/captures.js stream [--manche=3] [--bots=8] [--classes=chevalier,dompteur] [--niveau=20]
 *       → captures/stream-calme.png (préparation) puis captures/stream-vague.png (pendant la vague)
 *   node tools/captures.js joueur [--onglet=hero] [--niveau=35] [--classe=glace] [--mobile]
 *       → captures/joueur-<onglet>.png (page entière)
 *
 * Playwright doit être installé (npm i -D playwright puis npx playwright install chromium, si besoin).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'captures');
const A = {};
for (const a of process.argv.slice(3)) { const m = /^--([^=]+)=?(.*)$/.exec(a); if (m) A[m[1]] = m[2] === '' ? true : m[2]; }
const mode = process.argv[2];
const PORT = Number(A.port || 3290);
const U = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `tdv-captures-${PORT}.json`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Playwright est introuvable : npm i -D playwright'); process.exit(1); }

function startServer() {
  return spawn('node', ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_FILE: DB }, stdio: 'ignore' });
}

(async () => {
  if (!['stream', 'joueur'].includes(mode)) { console.log('Usage : node tools/captures.js stream|joueur [options] (voir l’en-tête du fichier)'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  if (fs.existsSync(DB)) fs.unlinkSync(DB);
  let srv = startServer();
  await wait(1500);
  const browser = await chromium.launch();
  try {
    if (mode === 'stream') {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const req = ctx.request;
      await req.post(U + '/api/login', { data: { pseudo: 'admin', password: 'Malachene' } });
      await req.post(U + '/api/admin/game/start', { data: { wave: Number(A.manche || 3) } });
      const classes = A.classes ? String(A.classes).split(',') : [null];
      const n = Number(A.bots || 8);
      for (let i = 0; i < n; i++) await req.post(U + '/api/admin/game/bots', { data: { count: 1, cls: classes[i % classes.length], level: Number(A.niveau || 20) } });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('Erreur de page :', e.message));
      await p.goto(U + '/stream');
      await p.waitForTimeout(3000);
      await p.screenshot({ path: path.join(OUT, 'stream-calme.png') });
      await req.post(U + '/api/admin/game/next');
      await p.waitForTimeout(Number(A.attente || 5000));
      await p.screenshot({ path: path.join(OUT, 'stream-vague.png') });
      console.log('écrit : captures/stream-calme.png, captures/stream-vague.png');
    } else {
      const ctx = await browser.newContext(A.mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 900 } });
      await ctx.request.post(U + '/api/register', { data: { pseudo: 'Capture', password: 'motdepasse1' } });
      // niveau et classe réglés directement dans la base (serveur arrêté)
      srv.kill('SIGTERM'); await wait(800);
      const data = JSON.parse(fs.readFileSync(DB, 'utf8'));
      const u = Object.values(data.users).find((x) => x.pseudo === 'Capture');
      u.level = Number(A.niveau || 35);
      if (A.classe) u.cls = A.classe;
      fs.writeFileSync(DB, JSON.stringify(data));
      srv = startServer(); await wait(1500);
      await ctx.request.post(U + '/api/login', { data: { pseudo: 'Capture', password: 'motdepasse1' } });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('Erreur de page :', e.message));
      await p.goto(U + '/'); await p.waitForTimeout(1200);
      const tab = A.onglet || 'battle';
      await p.click(`[data-tab="${tab}"]`); await p.waitForTimeout(700);
      const file = path.join(OUT, `joueur-${tab}${A.mobile ? '-mobile' : ''}.png`);
      await p.screenshot({ path: file, fullPage: true });
      console.log('écrit :', path.relative(ROOT, file));
    }
  } finally {
    await browser.close();
    srv.kill('SIGTERM');
  }
})().catch((e) => { console.error(e); process.exit(1); });
