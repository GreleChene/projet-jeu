/*
 * Écran du stream (à ajouter comme source navigateur dans OBS, 1920×1080).
 * Affiche la bataille en direct à partir des instantanés du serveur.
 */
(function () {
  'use strict';
  const GD = window.GameData, T = window.Terrain, A = window.Art, P = GD.PALETTE;
  const { WORLD, NET, MOBS, MOB_IDS, CLASSES, UPGRADES } = GD;
  const HF = NET.HF, MF = NET.MF;
  const cv = document.getElementById('view');
  const mainCtx = cv.getContext('2d');
  let ctx = mainCtx;

  /* ----------------------------- styles graphiques (à l'essai : /stream?style=...) -----------------------------
   * hd      : ancien rendu (sprites simples), via /stream?style=hd
   * detail  : rendu par défaut — héros détaillés, tour et bâtiments en 3/4, monstres en pixel art
   * pixel   : mêmes sprites, rendu en pixel art ×2, couleurs vives
   * eclat   : mêmes sprites, lueurs et halos lumineux (bloom léger) sur les sorts, projectiles et boss
   */
  const STYLES = {
    hd: {},
    detail: { rich: true, glow: 0.8, scale: 1.08 },
    pixel: { rich: true, px: 2, glow: 1, pixelFont: true, scale: 1.12, nums: 1.3, filter: 'saturate(1.2) contrast(1.05)' },
    eclat: { rich: true, bloom: 0.3, glow: 1.3, scale: 1.08, nums: 1.2, filter: 'saturate(1.15)' }
  };
  const STYLE_ID = new URLSearchParams(location.search).get('style') || 'detail';
  const STYLE = STYLES[STYLE_ID] || STYLES.hd;
  if (STYLE.rich) A.setDetail(true);
  const FONT_T = STYLE.pixelFont ? '"Silkscreen", "Pixelify Sans", monospace' : '"Cinzel", Georgia, serif';
  const FONT_B = STYLE.pixelFont ? '"Pixelify Sans", monospace' : '"Nunito", system-ui, sans-serif';
  const layer = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const PX = STYLE.px || 1;
  const smallW = Math.round(WORLD.W / PX), smallH = Math.round(WORLD.H / PX);
  const smC = PX > 1 ? layer(smallW, smallH) : null, smX = smC && smC.getContext('2d');
  const STYLE_SCALE = STYLE.scale || 1;
  // Échelle d'affichage (purement visuelle) des personnages et des monstres
  // en rendu détaillé (pixel art), héros et monstres sont nettement agrandis pour rester lisibles sur le stream
  const HERO_SCALE = STYLE.rich ? 2.1 : 1.3 * STYLE_SCALE, MOB_SCALE = STYLE.rich ? 1.55 : 1.2 * STYLE_SCALE, GRAVE_SCALE = 1.3 * STYLE_SCALE;
  const HERO_TOP = STYLE.rich ? A.heroTop(HERO_SCALE) : 52;

  /* ----------------------------- mise à l'échelle ----------------------------- */
  function fit() {
    const k = Math.min(window.innerWidth / WORLD.W, window.innerHeight / WORLD.H);
    cv.style.width = WORLD.W * k + 'px';
    cv.style.height = WORLD.H * k + 'px';
  }
  window.addEventListener('resize', fit);
  fit();

  /* ----------------------------- état ----------------------------- */
  let snap = null;
  let roster = new Map();
  const heroes = new Map(), mobs = new Map(), allies = new Map();
  let terrain = null, terrainKey = '';
  let fx = [];
  let feed = [];
  let announce = null;
  let shake = 0;
  let joinUrl = location.host;
  const ambient = [];

  fetch('/api/info').then((r) => r.json()).then((d) => { if (d.publicUrl) joinUrl = d.publicUrl.replace(/^https?:\/\//, ''); }).catch(() => {});

  const socket = io({ transports: ['websocket', 'polling'] });
  // équilibrage modifié en direct par l'admin (tailles des monstres, noms…)
  fetch('/api/balance').then((r) => r.json()).then((d) => GD.applyBalance(d.overrides)).catch(() => {});
  socket.on('balance', (p) => GD.setPath(p.key.split('.'), p.value));
  socket.on('connect', () => socket.emit('watch'));
  socket.on('roster', (r) => { roster = new Map(r.heroes.map((h) => [h.n, h])); });
  socket.on('snap', onSnap);

  function sync(map, list, mk) {
    const seen = new Set();
    for (const row of list) {
      const id = row[0];
      seen.add(id);
      let e = map.get(id);
      if (!e) { e = mk(row); map.set(id, e); }
      if (e.row && row[4] < e.row[4]) e.flash = 0.12; // touché : flash blanc
      e.moving = e.tx !== undefined && Math.hypot(row[2] - e.tx, row[3] - e.ty) > 0.3;
      e.row = row; e.tx = row[2]; e.ty = row[3];
      if (e.x === undefined || Math.abs(e.x - e.tx) > 250 || Math.abs(e.y - e.ty) > 250) { e.x = e.tx; e.y = e.ty; }
    }
    for (const id of map.keys()) if (!seen.has(id)) map.delete(id);
  }

  function onSnap(s) {
    snap = s;
    // héros : [nid, x, y, hp%, flags, facing, lvl]
    const hs = new Set();
    for (const r of s.h) {
      hs.add(r[0]);
      let e = heroes.get(r[0]);
      if (!e) { e = { seed: Math.random() * 10, attackT: 0 }; heroes.set(r[0], e); }
      if (e.x === undefined || Math.abs(e.x - r[1]) > 250 || Math.abs(e.y - r[2]) > 250) { e.x = r[1]; e.y = r[2]; }
      e.moving = e.tx !== undefined && Math.hypot(r[1] - e.tx, r[2] - e.ty) > 0.3;
      e.tx = r[1]; e.ty = r[2]; e.hp = r[3]; e.f = r[4]; e.facing = r[5] / 100; e.lvl = r[6];
      if (e.f & HF.ATTACK && e.attackT <= 0) e.attackT = 1;
    }
    for (const id of heroes.keys()) if (!hs.has(id)) heroes.delete(id);
    sync(mobs, s.m, () => ({ seed: Math.random() * 10, attackT: 0 }));
    sync(allies, s.a, () => ({ seed: Math.random() * 10, attackT: 0 }));
    for (const m of mobs.values()) if (m.row[5] & MF.ATTACK && m.attackT <= 0) m.attackT = 1;
    for (const m of allies.values()) if (m.row[5] & 4 && m.attackT <= 0) m.attackT = 1;
    const key = s.seed + ':' + s.tv;
    if (key !== terrainKey) { terrainKey = key; terrain = A.buildTerrain(s.seed, s.ter); terrain.grid = gridOf(s.seed, s.ter); }
    for (const e of s.e) onEvent(e);
  }

  function gridOf(seed, st) {
    const g = [];
    for (let ty = 0; ty < T.ROWS; ty++) { g[ty] = []; for (let tx = 0; tx < T.COLS; tx++) g[ty][tx] = T.tileBiome(tx, ty, st, seed); }
    return g;
  }
  function biomeAt(x, y) {
    if (!terrain) return 'prairie';
    const r = terrain.grid[Math.floor(y / WORLD.TILE)];
    return (r && r[Math.floor(x / WORLD.TILE)]) || 'prairie';
  }

  /* ----------------------------- effets ----------------------------- */
  function add(o) { o.t = 0; fx.push(o); }
  function burst(x, y, color, n, speed, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      add({ k: 'part', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, dur: 0.5 + Math.random() * 0.4, color, size: size || 3 });
    }
  }

  function onEvent(e) {
    const F = P.fx;
    switch (e[0]) {
      case 'num': add({ k: 'num', x: e[1] + (Math.random() - 0.5) * 14, y: e[2], v: e[3], c: e[4], dur: 0.9 }); break;
      case 'slash': add({ k: 'slash', x: e[1], y: e[2] - 14, a: e[3] / 100, whip: e[4], dur: 0.2 }); break;
      case 'whirl': add({ k: 'ring', x: e[1], y: e[2], r: e[3], color: P.fx.holy, dur: 0.45, w: 10 }); burst(e[1], e[2], P.fx.holy, 12, 160); break;
      case 'cone': add({ k: 'cone', x: e[1], y: e[2] - 12, a: e[3] / 100, r: e[4], dur: 0.6 }); break;
      case 'boom': {
        const col = e[4] === 1 ? F.burn : e[4] === 2 ? F.poison : P.stone[0];
        add({ k: 'ring', x: e[1], y: e[2], r: e[3], color: col, dur: 0.4, w: 14, fill: true });
        burst(e[1], e[2], col, 16, 220, 4);
        if (e[4] === 1) shake = Math.max(shake, 4);
        break;
      }
      case 'slam': {
        const col = e[4] === 2 ? F.poison : e[4] === 1 ? F.burn : '#cfd8e3';
        add({ k: 'ring', x: e[1], y: e[2], r: e[3], color: col, dur: 0.5, w: 18, fill: true });
        burst(e[1], e[2], col, 20, 260, 5);
        shake = Math.max(shake, 8);
        break;
      }
      case 'heal': burst(e[1], e[2] - 20, F.heal, 10, 60); break;
      case 'healring': add({ k: 'ring', x: e[1], y: e[2], r: e[3], color: F.heal, dur: 0.8, w: 8 }); break;
      case 'beam': add({ k: 'beam', x: e[1], y: e[2] - 30, x2: e[3], y2: e[4] - 20, dur: 0.35 }); burst(e[3], e[4] - 20, F.heal, 6, 50); break;
      case 'death': {
        const d = MOBS[MOB_IDS[e[3]]];
        burst(e[1], e[2] - 10, d ? d.color : '#ffffff', e[4] ? 40 : 8, e[4] ? 300 : 120, e[4] ? 6 : 3);
        add({ k: 'puff', x: e[1], y: e[2] - 8, dur: 0.5, r: e[4] ? 60 : 14 });
        if (e[4]) shake = Math.max(shake, 14);
        break;
      }
      case 'hdeath': burst(e[1], e[2] - 14, P.ui.danger, 14, 150); break;
      case 'lvl': add({ k: 'text', x: e[1], y: e[2] - 50, s: 'NIVEAU ' + e[3], color: P.ui.gold, dur: 1.6, size: 22 }); add({ k: 'ring', x: e[1], y: e[2], r: 40, color: P.ui.gold, dur: 0.6, w: 6 }); break;
      case 'coin': add({ k: 'text', x: e[1], y: e[2], s: '+' + e[3] + ' 🪙', color: P.ui.gold, dur: 1.1, size: 15 }); break;
      case 'text': add({ k: 'text', x: e[1], y: e[2], s: e[3], color: e[4], dur: 1.5, size: 18 }); break;
      case 'dash': add({ k: 'dash', x: e[1], y: e[2] - 14, x2: e[3], y2: e[4] - 14, dur: 0.3 }); break;
      case 'puff': add({ k: 'puff', x: e[1], y: e[2] - 10, dur: 0.5, r: 18 }); break;
      case 'ult': {
        add({ k: 'text', x: e[1], y: e[2] - 62, s: e[4], color: '#ffffff', dur: 1.5, size: 20, glow: true });
        const h = heroes.get(e[3]); const info = roster.get(e[3]);
        if (h && info) add({ k: 'ring', x: e[1], y: e[2], r: 46, color: CLASSES[info.cls].color, dur: 0.5, w: 8 });
        break;
      }
      case 'revive': add({ k: 'pillar', x: e[1], y: e[2], color: F.poison, dur: 1.2 }); burst(e[1], e[2] - 20, F.poison, 20, 120); break;
      case 'towerheal': add({ k: 'ring', x: WORLD.CX, y: WORLD.CY, r: 160, color: F.heal, dur: 0.9, w: 10 }); burst(WORLD.CX, WORLD.CY - 80, F.heal, 24, 160); break;
      case 'summon': add({ k: 'ring', x: e[1], y: e[2], r: e[3], color: '#b14cff', dur: 0.6, w: 8 }); break;
      case 'uproot': burst(e[1], e[2], P.wood[1], 10, 180, 4); add({ k: 'puff', x: e[1], y: e[2], dur: 0.6, r: 26 }); shake = Math.max(shake, 6); break;
      case 'bdestroy': burst(e[1], e[2] - 20, P.stone[1], 30, 220, 5); burst(e[1], e[2] - 20, P.biome.fire.accent[0], 16, 160, 4); add({ k: 'puff', x: e[1], y: e[2] - 20, dur: 0.9, r: 50 }); shake = Math.max(shake, 10); break;
      case 'bbuild': burst(e[1], e[2] - 10, P.wood[0], 18, 140, 4); add({ k: 'puff', x: e[1], y: e[2], dur: 0.7, r: 40 }); break;
      case 'bossin': shake = Math.max(shake, 16); add({ k: 'flash', dur: 0.6, color: '#ff3d5a' }); break;
      case 'announce': announce = { title: e[1], sub: e[2], t: 0 }; break;
      case 'feed': feed.push({ text: e[1], t: 0 }); if (feed.length > 7) feed.shift(); break;
    }
  }

  /* ----------------------------- rendu ----------------------------- */
  let last = performance.now(), time = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; time += dt;
    update(dt);
    draw(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function lerpMap(map, dt, k) {
    for (const e of map.values()) {
      const tx = e.tx !== undefined ? e.tx : e.x, ty = e.ty !== undefined ? e.ty : e.y;
      e.x += (tx - e.x) * Math.min(1, dt * k); e.y += (ty - e.y) * Math.min(1, dt * k);
      if (e.attackT > 0) e.attackT -= dt * 4.5;
      if (e.flash > 0) e.flash -= dt;
    }
  }

  function update(dt) {
    lerpMap(heroes, dt, 14); lerpMap(mobs, dt, 12); lerpMap(allies, dt, 12);
    for (const f of fx) {
      f.t += dt;
      if (f.k === 'part') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 400 * dt; }
    }
    fx = fx.filter((f) => f.t < f.dur);
    for (const f of feed) f.t += dt;
    if (announce) { announce.t += dt; if (announce.t > 3.8) announce = null; }
    shake = Math.max(0, shake - dt * 30);
    updateAmbient(dt);
  }

  function updateAmbient(dt) {
    if (!snap) return;
    const st = snap.ter;
    const want = Math.round(70 * (st.mix ? 1 : Math.max(st.frost, st.poison, st.fire)));
    while (ambient.length < want) ambient.push({ x: Math.random() * WORLD.W, y: Math.random() * WORLD.H, s: Math.random(), ph: Math.random() * 6 });
    ambient.length = Math.min(ambient.length, want);
    for (const p of ambient) {
      const b = biomeAt(p.x, p.y);
      p.b = b;
      if (b === 'frost') { p.y += 30 * dt * (0.6 + p.s); p.x += Math.sin(time + p.ph) * 12 * dt; }
      else if (b === 'fire') { p.y -= 40 * dt * (0.6 + p.s); p.x += Math.sin(time * 2 + p.ph) * 10 * dt; }
      else { p.y -= 12 * dt; p.x += Math.sin(time + p.ph) * 18 * dt; }
      if (p.y > WORLD.H + 5) p.y = -5;
      if (p.y < -5) p.y = WORLD.H + 5;
      if (p.x < -5) p.x = WORLD.W + 5;
      if (p.x > WORLD.W + 5) p.x = -5;
    }
  }

  function draw() {
    ctx = mainCtx;
    ctx.save();
    const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    ctx.translate(sx, sy);
    if (terrain) ctx.drawImage(terrain.canvas, 0, 0);
    else { ctx.fillStyle = P.biome.prairie.ground[0]; ctx.fillRect(0, 0, WORLD.W, WORLD.H); }
    if (terrain) A.drawLavaGlow(ctx, terrain.lava, time);
    if (!snap) { ctx.restore(); drawWaiting(); return; }

    drawZones(0);
    // entités triées en profondeur
    const list = [];
    list.push({ y: WORLD.CY + 20, d: () => A.drawTower(ctx, WORLD.CX, WORLD.CY, { t: time, up: snap.up, hp: snap.tw[0] / snap.tw[1] }) });
    // habitations des héros : [type, x, y, PV %, nid du propriétaire]
    for (const [ti, bx, by, hp, , variant] of snap.bd || []) {
      const def = GD.BUILDINGS[ti], fam = GD.CLASSES[def.family];
      list.push({ y: by + 4, d: () => { ctx.save(); ctx.translate(bx, by); ctx.scale(0.82, 0.82); A.drawBuilding(ctx, variant || def.family, 0, 0, { hp: hp / 100, t: time + bx, color: fam ? fam.color : P.ui.gold }); ctx.restore(); } });
    }
    for (const [id, h] of heroes) list.push({ y: h.y, d: () => drawHeroEnt(id, h) });
    for (const m of mobs.values()) list.push({ y: m.y, d: () => drawMobEnt(m, false) });
    for (const m of allies.values()) list.push({ y: m.y, d: () => drawMobEnt(m, true) });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) it.d();

    drawZones(1);
    for (const p of snap.p) A.drawProjectile(ctx, NET.PROJ_KINDS[p[0]], p[1], p[2], p[3] / 100, time);
    if (STYLE.glow) drawGlows();
    drawFx(false);
    ctx.restore();
    post();
    ctx.save();
    ctx.translate(sx, sy);
    drawFx(true);
    drawAmbient();
    drawLabels();
    ctx.restore();
    drawVignette();
    if (STYLE.grain) drawGrain();
    drawHud();
  }

  /* ----------------------------- post-traitement des styles ----------------------------- */
  function post() {
    const W = WORLD.W, H = WORLD.H;
    if (PX > 1) {
      smX.imageSmoothingEnabled = true;
      smX.globalCompositeOperation = 'copy';
      smX.drawImage(cv, 0, 0, smallW, smallH);
      smX.globalCompositeOperation = 'source-over';
      if (STYLE.aberr) aberrate(smC, STYLE.aberr);
      mainCtx.save();
      mainCtx.imageSmoothingEnabled = false;
      if (STYLE.filter) mainCtx.filter = STYLE.filter;
      mainCtx.drawImage(smC, 0, 0, W, H);
      mainCtx.restore();
    } else {
      if (STYLE.bloom) bloom();
      if (STYLE.aberr) aberrate(cv, STYLE.aberr);
      if (STYLE.filter) { mainCtx.save(); mainCtx.filter = STYLE.filter; mainCtx.globalCompositeOperation = 'copy'; mainCtx.drawImage(cv, 0, 0); mainCtx.restore(); }
    }
    if (STYLE.lights) drawLights();
  }

  // Aberration chromatique : le rouge et le bleu sont décalés de part et d'autre
  const abCache = new Map();
  function aberrate(canvas, off) {
    const w = canvas.width, h = canvas.height, key = w + 'x' + h;
    if (!abCache.has(key)) abCache.set(key, [layer(w, h), layer(w, h)]);
    const [r, b] = abCache.get(key);
    const tint = (c, col) => {
      const x = c.getContext('2d');
      x.globalCompositeOperation = 'copy'; x.drawImage(canvas, 0, 0);
      x.globalCompositeOperation = 'multiply'; x.fillStyle = col; x.fillRect(0, 0, w, h);
    };
    tint(r, '#ff0000'); tint(b, '#0000ff');
    const x = canvas.getContext('2d');
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'multiply'; x.fillStyle = '#00ff00'; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'lighter'; x.drawImage(r, off, 0); x.drawImage(b, -off, 0);
    x.restore();
  }

  // Bloom : copie floue et réduite ajoutée par-dessus (les zones claires « bavent » de lumière)
  let bloomC = null;
  function bloom() {
    if (!bloomC) bloomC = layer(WORLD.W / 4, WORLD.H / 4);
    const b = bloomC.getContext('2d');
    b.globalCompositeOperation = 'copy';
    b.filter = 'blur(4px) brightness(0.75) contrast(2.2)';
    b.drawImage(cv, 0, 0, bloomC.width, bloomC.height);
    b.filter = 'none';
    mainCtx.save();
    mainCtx.globalCompositeOperation = 'screen'; mainCtx.globalAlpha = STYLE.bloom;
    mainCtx.drawImage(bloomC, 0, 0, WORLD.W, WORLD.H);
    mainCtx.restore();
  }

  // Obscurité percée par les sources de lumière (tour, héros, projectiles, boss)
  let lightC = null;
  function drawLights() {
    const k = 1 / 8;
    if (!lightC) lightC = layer(WORLD.W * k, WORLD.H * k);
    const l = lightC.getContext('2d');
    l.globalCompositeOperation = 'copy';
    l.fillStyle = 'rgba(6,5,14,0.8)'; l.fillRect(0, 0, lightC.width, lightC.height);
    l.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a) => {
      const g = l.createRadialGradient(x * k, y * k, 0, x * k, y * k, r * k);
      g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.6, `rgba(0,0,0,${a * 0.7})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = g; l.fillRect((x - r) * k, (y - r) * k, r * 2 * k, r * 2 * k);
    };
    hole(WORLD.CX, WORLD.CY, 380 + Math.sin(time * 3) * 8, 1);
    for (const h of heroes.values()) if (!(h.f & HF.DEAD)) hole(h.x, h.y - 20, 190, 0.9);
    for (const p of snap.p) hole(p[1], p[2], 60, 0.7);
    for (const m of mobs.values()) if (m.row[5] & MF.BOSS) hole(m.x, m.y - 30, 200, 0.6);
    for (const z of snap.z) { const kind = NET.ZONE_KINDS[z[0]]; if (kind === 'lava' || kind === 'toxic' || kind === 'fire') hole(z[1], z[2], z[3] * 1.1, 0.55); }
    mainCtx.save();
    mainCtx.imageSmoothingEnabled = true;
    mainCtx.drawImage(lightC, 0, 0, WORLD.W, WORLD.H);
    mainCtx.restore();
  }

  // Grain de pellicule
  let grainC = null;
  function drawGrain() {
    if (!grainC) {
      grainC = layer(256, 256);
      const g = grainC.getContext('2d'), img = g.createImageData(256, 256);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0);
      grainC.pattern = mainCtx.createPattern(grainC, 'repeat');
    }
    mainCtx.save();
    mainCtx.globalAlpha = STYLE.grain; mainCtx.globalCompositeOperation = 'overlay';
    mainCtx.translate(-Math.random() * 256, -Math.random() * 256);
    mainCtx.fillStyle = grainC.pattern; mainCtx.fillRect(0, 0, WORLD.W + 256, WORLD.H + 256);
    mainCtx.restore();
  }

  // Halo lumineux additif sous les projectiles, les élites et les boss (façon « bullet heaven »)
  function drawGlows() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const G = STYLE.glow;
    const halo = (x, y, r, color, a) => {
      r *= G;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, A.rgba(color, a)); g.addColorStop(1, A.rgba(color, 0));
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    const PC = { arrow: '#ffe7a0', bolt: '#9fd3ff', orb: '#c58cff', ice: '#bfe6ff', ballista: '#ffe7a0', fire: '#ff9a3c', frost: '#bfe6ff', poison: '#9dff6a', holy: '#fff3a0', rock: '#d9b98a' };
    for (const p of snap.p) {
      const kind = NET.PROJ_KINDS[p[0]] || '';
      const key = Object.keys(PC).find((k) => kind.includes(k));
      halo(p[1], p[2], 24, key ? PC[key] : '#ffffff', 0.45);
    }
    for (const m of mobs.values()) {
      const f = m.row[5];
      if (f & MF.BOSS) halo(m.x, m.y - 30, 110, '#ff4d6d', 0.18 + 0.06 * Math.sin(time * 3));
      else if (f & MF.ELITE) halo(m.x, m.y - 14, 34, '#ffd34d', 0.22);
    }
    for (const h of heroes.values()) if (h.f & HF.ULT) halo(h.x, h.y - 20, 60, '#ffffff', 0.22);
    halo(WORLD.CX, WORLD.CY - 66, 40, '#ffd76a', 0.35); // fenêtre de la tour
    ctx.restore();
  }

  function drawHeroEnt(id, h) {
    const info = roster.get(id);
    if (!info) return;
    if (h.f & HF.DEAD) { ctx.save(); ctx.translate(h.x, h.y); ctx.scale(GRAVE_SCALE, GRAVE_SCALE); A.drawGrave(ctx, 0, 0, time); ctx.restore(); return; }
    if (h.f & HF.ULT) {
      ctx.save(); ctx.globalAlpha = 0.35 + 0.2 * Math.sin(time * 6);
      ctx.beginPath(); ctx.ellipse(h.x, h.y + 1, HERO_TOP * 0.42, HERO_TOP * 0.16, 0, 0, Math.PI * 2); ctx.fillStyle = CLASSES[info.cls].color; ctx.fill(); ctx.restore();
    }
    A.drawHero(ctx, h.x, h.y, {
      cls: info.cls, look: info.look, gear: info.gear, facing: h.facing, t: time, seed: h.seed, scale: HERO_SCALE, moving: h.moving,
      attack: Math.max(0, h.attackT), zombie: !!(h.f & HF.ZOMBIE), stealth: !!(h.f & HF.STEALTH)
    });
    if (h.f & HF.SHIELD) { ctx.save(); ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.arc(h.x, h.y - HERO_TOP * 0.42, HERO_TOP * 0.56, 0, Math.PI * 2); ctx.strokeStyle = P.fx.frost; ctx.lineWidth = 3; ctx.stroke(); ctx.restore(); }
    if (h.f & HF.FURY && Math.random() < 0.3) fx.push({ k: 'part', x: h.x + (Math.random() - 0.5) * 16, y: h.y - 10, vx: 0, vy: -60, dur: 0.4, t: 0, color: P.fx.burn, size: 3 });
    if (h.f & HF.POISON && Math.random() < 0.15) fx.push({ k: 'part', x: h.x + (Math.random() - 0.5) * 16, y: h.y - 20, vx: 0, vy: -40, dur: 0.5, t: 0, color: P.fx.poison, size: 3 });
    if (h.f & HF.BURN && Math.random() < 0.2) fx.push({ k: 'part', x: h.x + (Math.random() - 0.5) * 16, y: h.y - 20, vx: 0, vy: -70, dur: 0.4, t: 0, color: P.fx.burn, size: 3 });
  }

  function drawMobEnt(m, ally) {
    const r = m.row;
    const type = MOB_IDS[r[1]];
    const d = MOBS[type];
    const f = r[5];
    const elite = !ally && f & MF.ELITE, boss = !ally && f & MF.BOSS;
    const size = d.size * (elite ? 1.3 : 1) * MOB_SCALE;
    A.drawMob(ctx, type, m.x, m.y, { size, t: time, seed: m.seed, facing: r[6] / 100, attack: Math.max(0, m.attackT), elite, boss, frozen: !ally && f & MF.FROZEN });
    if (m.flash > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(0.55, m.flash * 5); ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(m.x, m.y - size * 0.8, size * 0.95, size * 0.85, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (!ally && f & MF.BURN && Math.random() < 0.15) fx.push({ k: 'part', x: m.x, y: m.y - size, vx: 0, vy: -60, dur: 0.4, t: 0, color: P.fx.burn, size: 3 });
    if (!ally && f & MF.POISON && Math.random() < 0.1) fx.push({ k: 'part', x: m.x, y: m.y - size, vx: 0, vy: -40, dur: 0.5, t: 0, color: P.fx.poison, size: 3 });
    if (!ally && f & MF.SLOW) { ctx.fillStyle = A.rgba(P.fx.frost, 0.35); ctx.beginPath(); ctx.ellipse(m.x, m.y, size, size * 0.35, 0, 0, Math.PI * 2); ctx.fill(); }
    if (r[4] < 100 && !boss) bar(m.x - size, m.y - size * A.mobTop(type) - 6, size * 2, 4, r[4] / 100, ally ? P.ui.ok : elite ? P.ui.gold : P.ui.danger);
  }

  // Vignettage léger (pré-calculé) pour donner de la profondeur
  let vignette = null;
  function drawVignette() {
    if (!vignette) {
      vignette = document.createElement('canvas');
      vignette.width = WORLD.W; vignette.height = WORLD.H;
      const v = vignette.getContext('2d');
      const g = v.createRadialGradient(WORLD.CX, WORLD.CY, WORLD.H * 0.45, WORLD.CX, WORLD.CY, WORLD.W * 0.62);
      g.addColorStop(0, 'rgba(20,12,30,0)'); g.addColorStop(1, `rgba(8,4,16,${STYLE.vig || 0.38})`);
      v.fillStyle = g; v.fillRect(0, 0, WORLD.W, WORLD.H);
    }
    ctx.drawImage(vignette, 0, 0);
  }

  function bar(x, y, w, h, k, color) {
    ctx.fillStyle = P.outline; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#3a2f47'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, k)), h);
  }

  // Nom et PV des bâtiments (seulement s'ils sont abîmés, ou pendant l'entracte)
  function drawBuildingLabels() {
    if (!snap || !snap.bd) return;
    for (const [, x, y, hp, owners] of snap.bd) {
      if (hp >= 100 && snap.ph !== 'intermission') continue;
      const names = (owners || []).map((n) => (roster.get(n) || {}).name).filter(Boolean);
      const info = { name: names.length <= 2 ? names.join(' & ') : `${names[0]} & ${names.length - 1} autres` };
      ctx.textAlign = 'center'; ctx.font = `800 11px ${FONT_B}`; ctx.lineWidth = 4; ctx.strokeStyle = P.outline;
      const label = `${info ? info.name : '?'}${hp > 0 ? '' : ' (détruite)'}`;
      ctx.strokeText(label, x, y + 22); ctx.fillStyle = hp > 0 ? '#bfe6ff' : P.ui.danger; ctx.fillText(label, x, y + 22);
      if (hp > 0 && hp < 100) bar(x - 20, y + 26, 40, 4, hp / 100, hp < 30 ? P.ui.danger : '#9fd3ff');
    }
  }

  function drawLabels() {
    drawBuildingLabels();
    ctx.textAlign = 'center';
    ctx.font = `800 13px ${FONT_B}`;
    ctx.lineJoin = 'round';
    for (const [id, h] of heroes) {
      const info = roster.get(id);
      if (!info) continue;
      const dead = h.f & HF.DEAD;
      const y = h.y - (dead ? 38 : HERO_TOP + 12);
      ctx.globalAlpha = dead ? 0.6 : h.f & HF.STEALTH ? 0.45 : 1;
      ctx.lineWidth = 4; ctx.strokeStyle = P.outline;
      ctx.strokeText(info.name, h.x, y);
      ctx.fillStyle = info.bot ? P.ui.muted : '#ffffff';
      ctx.fillText(info.name, h.x, y);
      if (!dead) {
        bar(h.x - 16, y + 4, 32, 4, h.hp / 100, h.f & HF.ZOMBIE ? P.fx.poison : P.ui.ok);
        // pastille de niveau
        ctx.fillStyle = CLASSES[info.cls].color;
        ctx.beginPath(); ctx.arc(h.x - 23, y + 6, 6.5, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = P.outline; ctx.stroke();
        ctx.font = `800 9px ${FONT_B}`; ctx.fillStyle = '#ffffff'; ctx.fillText(h.lvl, h.x - 23, y + 9);
        ctx.font = `800 13px ${FONT_B}`;
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawZones(layer) {
    for (const z of snap.z) {
      const kind = NET.ZONE_KINDS[z[0]];
      const [, x, y, r, t10, x2, y2] = z;
      if (layer === 0 && (kind === 'ice' || kind === 'toxic' || kind === 'lava')) { drawHazard(kind, x, y, r); continue; }
      if (layer === 0 && kind === 'telegraph') {
        ctx.save();
        ctx.globalAlpha = 0.18 + 0.12 * Math.sin(time * 20);
        ctx.fillStyle = P.ui.danger; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.8; ctx.lineWidth = 3; ctx.strokeStyle = P.ui.danger; ctx.setLineDash([12, 8]); ctx.stroke();
        ctx.restore();
      } else if (layer === 0 && kind === 'tline') {
        ctx.save(); ctx.globalAlpha = 0.3; ctx.strokeStyle = P.ui.danger; ctx.lineCap = 'round'; ctx.lineWidth = r * 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
      } else if (layer === 0 && kind === 'poison') {
        ctx.save(); ctx.globalAlpha = Math.min(1, t10 / 10) * 0.35;
        for (let i = 0; i < 5; i++) {
          const a = time * 0.6 + i * 1.3;
          ctx.fillStyle = i % 2 ? P.biome.poison.accent[0] : P.biome.poison.accent[2];
          ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.15, r * 0.7, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      } else if (layer === 1 && kind === 'smoke') {
        ctx.save(); ctx.globalAlpha = Math.min(1, t10 / 10) * 0.55;
        for (let i = 0; i < 9; i++) {
          const a = time * 0.4 + i * 0.7;
          ctx.fillStyle = i % 2 ? '#6b6478' : '#8d8597';
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.55, y - 20 + Math.sin(a * 1.3) * r * 0.3, r * 0.42, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // Zones dangereuses du biome (ellipses posées au sol)
  function drawHazard(kind, x, y, r) {
    const ry = r * 0.6;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
    if (kind === 'ice') {
      const g = ctx.createRadialGradient(x - r * 0.3, y - ry * 0.3, 4, x, y, r);
      g.addColorStop(0, 'rgba(240,250,255,.85)'); g.addColorStop(1, 'rgba(150,205,240,.75)');
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(29,22,38,.55)'; ctx.stroke();
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 5; i++) { const a = i * 1.3 + x; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * ry); ctx.stroke(); }
      ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.4 * Math.sin(time * 3 + x)})`;
      for (let i = 0; i < 4; i++) ctx.fillRect(x + Math.cos(i * 2.1 + x) * r * 0.6, y + Math.sin(i * 2.1 + x) * ry * 0.6, 3, 3);
    } else if (kind === 'toxic') {
      ctx.fillStyle = 'rgba(88,224,31,.42)'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(29,22,38,.55)'; ctx.stroke();
      ctx.clip();
      for (let i = 0; i < 6; i++) {
        const ph = (time * 0.6 + i * 0.37 + x * 0.01) % 1;
        const bx = x + Math.cos(i * 2.4 + x) * r * 0.55, by = y + Math.sin(i * 2.4 + x) * ry * 0.55;
        ctx.globalAlpha = 1 - ph; ctx.strokeStyle = P.biome.poison.accent[1]; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(bx, by, 3 + ph * 7, 0, Math.PI * 2); ctx.stroke();
      }
    } else {
      const k = 0.5 + 0.5 * Math.sin(time * 2 + x * 0.02);
      const g = ctx.createRadialGradient(x, y, 4, x, y, r);
      g.addColorStop(0, `rgba(255,${200 + 40 * k},90,.95)`); g.addColorStop(0.6, 'rgba(255,110,26,.9)'); g.addColorStop(1, 'rgba(120,30,10,.9)');
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#1c1210'; ctx.stroke();
      ctx.clip();
      ctx.fillStyle = 'rgba(28,18,16,.55)';
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(x + Math.cos(i * 1.9 + x) * r * 0.5, y + Math.sin(i * 1.9 + x) * ry * 0.5, r * 0.18, ry * 0.14, i, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }

  function drawFx(textLayer) {
    for (const f of fx) {
      if ((f.k === 'num' || f.k === 'text') !== textLayer) continue;
      const k = f.t / f.dur;
      ctx.save();
      switch (f.k) {
        case 'part':
          ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size); break;
        case 'num': {
          ctx.globalAlpha = 1 - k * k;
          const size = Math.round((f.c === 1 ? 22 : f.c === 2 ? 16 : 14) * (STYLE.nums || 1));
          ctx.font = `900 ${size}px ${FONT_B}`; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = P.outline;
          const y = f.y - k * 30;
          const s = (f.c === 2 ? '+' : f.c >= 3 ? '-' : '') + f.v;
          ctx.strokeText(s, f.x, y);
          ctx.fillStyle = f.c === 1 ? P.fx.crit : f.c === 2 ? P.fx.heal : f.c === 3 ? P.fx.burn : f.c === 4 ? P.fx.poison : '#ffffff';
          ctx.fillText(s, f.x, y); break;
        }
        case 'text': {
          ctx.globalAlpha = 1 - Math.max(0, k - 0.6) / 0.4;
          ctx.font = `900 ${f.size}px ${FONT_T}`; ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.strokeStyle = P.outline;
          const y = f.y - k * 24;
          ctx.strokeText(f.s, f.x, y); ctx.fillStyle = f.color; ctx.fillText(f.s, f.x, y); break;
        }
        case 'slash': {
          ctx.globalAlpha = 1 - k; ctx.translate(f.x, f.y); ctx.rotate(f.a);
          ctx.strokeStyle = f.whip ? '#f3ead7' : '#ffffff'; ctx.lineWidth = 4 * (1 - k) + 1;
          ctx.beginPath(); ctx.arc(0, 0, 26, -0.9 + k * 0.6, 0.9 + k * 0.6); ctx.stroke(); break;
        }
        case 'ring': {
          ctx.globalAlpha = (1 - k) * 0.9;
          if (f.fill) { ctx.fillStyle = A.rgba(f.color, 0.25 * (1 - k)); ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r * k, f.r * k * 0.6, 0, 0, Math.PI * 2); ctx.fill(); }
          ctx.strokeStyle = f.color; ctx.lineWidth = f.w * (1 - k) + 1;
          ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r * (0.3 + 0.7 * k), f.r * (0.3 + 0.7 * k) * 0.6, 0, 0, Math.PI * 2); ctx.stroke(); break;
        }
        case 'cone': {
          ctx.globalAlpha = (1 - k) * 0.6; ctx.translate(f.x, f.y);
          const g = ctx.createRadialGradient(0, 0, 10, 0, 0, f.r);
          g.addColorStop(0, '#ffffff'); g.addColorStop(1, A.rgba(P.fx.frost, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, f.r * (0.4 + 0.6 * k), f.a - 0.62, f.a + 0.62); ctx.closePath(); ctx.fill(); break;
        }
        case 'beam': {
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = P.fx.heal; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x2, f.y2); ctx.stroke(); break;
        }
        case 'dash': {
          ctx.globalAlpha = (1 - k) * 0.8; ctx.strokeStyle = P.fx.shadow; ctx.lineWidth = 10 * (1 - k); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x2, f.y2); ctx.stroke(); break;
        }
        case 'puff': {
          ctx.globalAlpha = (1 - k) * 0.6; ctx.fillStyle = '#d8d0e0';
          for (let i = 0; i < 5; i++) { const a = i * 1.26; ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * f.r * k, f.y + Math.sin(a) * f.r * k * 0.6, f.r * 0.5 * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill(); }
          break;
        }
        case 'pillar': {
          ctx.globalAlpha = (1 - k) * 0.6; ctx.fillStyle = f.color; ctx.fillRect(f.x - 14, f.y - 140, 28, 140); break;
        }
        case 'flash': ctx.globalAlpha = (1 - k) * 0.25; ctx.fillStyle = f.color; ctx.fillRect(0, 0, WORLD.W, WORLD.H); break;
      }
      ctx.restore();
    }
  }

  function drawAmbient() {
    ctx.save();
    for (const p of ambient) {
      if (p.b === 'prairie') continue;
      if (p.b === 'frost') { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(p.x, p.y, 2 + p.s * 2, 2 + p.s * 2); }
      else if (p.b === 'poison') { ctx.fillStyle = A.rgba(P.biome.poison.accent[0], 0.5 + 0.3 * Math.sin(time * 3 + p.ph)); ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 + p.s * 2, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.fillStyle = A.rgba(P.biome.fire.accent[1], 0.5 + 0.4 * Math.sin(time * 5 + p.ph)); ctx.fillRect(p.x, p.y, 2 + p.s * 2, 2 + p.s * 2); }
    }
    ctx.restore();
  }

  /* ----------------------------- interface (HUD) ----------------------------- */
  function panel(x, y, w, h, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 0.88 : alpha;
    A.rrect(ctx, x, y, w, h, 12, P.ui.panel, 3);
    ctx.restore();
    ctx.strokeStyle = P.ui.border; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x + 4, y + 4, w - 8, h - 8, 9) : ctx.rect(x + 4, y + 4, w - 8, h - 8); ctx.stroke();
  }
  function text(s, x, y, size, color, align, font) {
    ctx.font = `${font === 'b' ? 800 : 900} ${size}px ${font === 'b' ? FONT_B : FONT_T}`;
    ctx.textAlign = align || 'left';
    ctx.lineWidth = Math.max(3, size / 5); ctx.strokeStyle = P.outline; ctx.lineJoin = 'round';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color || P.ui.text; ctx.fillText(s, x, y);
  }

  function drawHud() {
    const s = snap;
    if (!s) return;
    const era = { name: s.era || GD.eraOfWave(Math.max(1, s.w)).name };
    const mi = s.mi || { maxWave: 100, mode: 'classic', difficulty: 'normal' };
    // bandeau central
    panel(WORLD.CX - 330, 14, 660, 104);
    const title = s.ph === 'lobby' ? 'EN ATTENTE' : `MANCHE ${s.w} / ${mi.maxWave}`;
    if (s.ph !== 'lobby' && (mi.mode !== 'classic' || mi.difficulty !== 'normal')) {
      const D = GD.DIFFICULTIES[mi.difficulty] || {};
      era.name += `  ·  ${mi.mode === 'quick' ? '⚡ Partie rapide' : 'Classique'} · ${D.name || ''}`;
    }
    text(title, WORLD.CX, 54, 32, P.ui.gold, 'center');
    text(s.ph === 'lobby' ? 'Préparez vos héros !' : era.name + (s.pact === 1 ? '  ·  💀 PACTE DE SANG' : ''), WORLD.CX, 78, 16, s.pact === 1 ? P.ui.danger : P.ui.muted, 'center', 'b');
    bar(WORLD.CX - 300, 90, 600, 16, s.tw[0] / s.tw[1], s.tw[0] / s.tw[1] < 0.3 ? P.ui.danger : P.ui.ok);
    text(`🏰 ${s.tw[0]} / ${s.tw[1]}`, WORLD.CX, 104, 13, '#ffffff', 'center', 'b');
    if (s.ph === 'wave') text(`👹 ${s.left}`, WORLD.CX + 310, 54, 18, P.ui.text, 'right', 'b');
    // écus de l'équipe + améliorations
    panel(14, 14, 300, 104);
    text(`🪙 ${s.tr} écus`, 34, 50, 24, P.ui.gold, 'left', 'b');
    text('Trésor de l’équipe', 34, 70, 12, P.ui.muted, 'left', 'b');
    let ux = 34;
    for (const [id, lvl] of Object.entries(s.up)) {
      if (!lvl || id === 'pact' || id === 'revive') continue;
      ctx.font = `18px ${FONT_B}`; ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.fillText(UPGRADES[id].icon, ux, 102);
      text(String(lvl), ux + 22, 104, 12, P.ui.gold, 'left', 'b');
      ux += 36;
    }
    // journal
    let fy = 30;
    for (const f of feed.slice(-6)) {
      const a = Math.max(0, 1 - Math.max(0, f.t - 10) / 2);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      text(f.text, WORLD.W - 20, fy, 15, '#ffffff', 'right', 'b');
      fy += 22;
    }
    ctx.globalAlpha = 1;
    // appel à rejoindre
    if (s.jn) {
      // inscriptions ouvertes : appel bien visible
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      panel(14, WORLD.H - 92, 560, 78);
      ctx.save(); ctx.globalAlpha = 0.25 + 0.25 * pulse; A.rrect(ctx, 14, WORLD.H - 92, 560, 78, 12, P.ui.gold, 0.01); ctx.restore();
      text('⚔️ Tape !join dans le chat pour rejoindre !', 32, WORLD.H - 60, 21, P.ui.gold, 'left', 'b');
      text(`${s.jn > 0 ? `Inscriptions ouvertes encore ${s.jn} s` : 'Inscriptions ouvertes'} · compte à lier sur ${joinUrl} · ${heroes.size} héros`, 32, WORLD.H - 32, 14, P.ui.text, 'left', 'b');
    } else {
      panel(14, WORLD.H - 70, 470, 56);
      text(s.ph === 'lobby' ? `⚔️ Crée ton héros : ${joinUrl}` : '🔒 Inscriptions fermées', 32, WORLD.H - 44, 17, P.ui.text, 'left', 'b');
      text(`${heroes.size} héros en jeu`, 32, WORLD.H - 24, 13, P.ui.muted, 'left', 'b');
    }
    // boss
    if (s.bosses.length) {
      const w = 520, n = s.bosses.length;
      s.bosses.forEach((b, i) => {
        const y = WORLD.H - 54 - (n - 1 - i) * 46;
        const d = MOBS[MOB_IDS[b[0]]];
        panel(WORLD.CX - w / 2 - 16, y - 26, w + 32, 44);
        text(d.name, WORLD.CX, y - 6, 16, '#ff8fa0', 'center');
        bar(WORLD.CX - w / 2, y + 2, w, 9, b[1] / 1000, '#e2504c');
      });
    }
    if (s.ph === 'intermission' && s.vote) drawVote(s);
    if (s.ph === 'gameover' || s.ph === 'victory') {
      ctx.fillStyle = 'rgba(21,17,28,0.55)'; ctx.fillRect(0, 0, WORLD.W, WORLD.H);
      text(s.ph === 'victory' ? 'VICTOIRE !' : 'LA TOUR EST TOMBÉE', WORLD.CX, WORLD.CY - 20, 72, s.ph === 'victory' ? P.ui.gold : P.ui.danger, 'center');
      text(`Manche atteinte : ${s.w}`, WORLD.CX, WORLD.CY + 30, 26, P.ui.text, 'center', 'b');
    }
    if (s.ph === 'lobby') {
      text('La bataille n’a pas encore commencé', WORLD.CX, WORLD.CY + 200, 30, '#ffffff', 'center');
      text(`Crée ton héros sur ${joinUrl}`, WORLD.CX, WORLD.CY + 236, 22, P.ui.gold, 'center', 'b');
    }
    if (s.ps) text('⏸ PAUSE', WORLD.CX, WORLD.CY - 260, 48, '#ffffff', 'center');
    if (announce) {
      const k = announce.t;
      const a = k < 0.3 ? k / 0.3 : k > 3 ? 1 - (k - 3) / 0.8 : 1;
      const sc = k < 0.3 ? 0.7 + k : 1;
      ctx.save(); ctx.globalAlpha = Math.max(0, a);
      ctx.translate(WORLD.CX, WORLD.CY - 250); ctx.scale(sc, sc);
      text(announce.title, 0, 0, 60, P.ui.gold, 'center');
      if (announce.sub) text(announce.sub, 0, 40, 24, '#ffffff', 'center', 'b');
      ctx.restore();
    }
  }

  function drawVote(s) {
    const opts = s.vote.o;
    const total = Math.max(1, Object.values(s.vote.c).reduce((a, b) => a + b, 0));
    const w = 230, gap = 14, W = opts.length * (w + gap) - gap;
    const x0 = WORLD.CX - W / 2, y0 = WORLD.H - 230;
    panel(x0 - 20, y0 - 56, W + 40, 196);
    text(`VOTE · tape !1, !2… dans le chat · ${s.timer}s`, WORLD.CX, y0 - 22, 22, P.ui.gold, 'center');
    opts.forEach((o, i) => {
      const x = x0 + i * (w + gap);
      const up = UPGRADES[o];
      const name = o === 'save' ? 'Économiser' : up.name;
      const icon = o === 'save' ? '🪙' : up.icon;
      const cost = s.vote.cost[o];
      const afford = !cost || cost <= s.tr;
      ctx.globalAlpha = afford ? 1 : 0.45;
      A.rrect(ctx, x, y0, w, 120, 10, o === 'pact' ? '#3a1f2a' : P.ui.panel2, 2);
      ctx.font = `32px ${FONT_B}`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(icon, x + 34, y0 + 48);
      text(name, x + 64, y0 + 34, 17, '#ffffff', 'left', 'b');
      text(`!${i + 1}`, x + w - 12, y0 + 24, 16, '#bf94ff', 'right', 'b');
      text(cost ? `🪙 ${cost} écus` : o === 'pact' ? 'Récompenses ×2' : 'Garder les écus', x + 64, y0 + 56, 13, cost ? P.ui.gold : P.ui.muted, 'left', 'b');
      const n = s.vote.c[o] || 0;
      bar(x + 14, y0 + 84, w - 28, 12, n / total, o === 'pact' ? P.ui.danger : P.ui.accent);
      text(`${n} vote${n > 1 ? 's' : ''}`, x + w / 2, y0 + 112, 13, P.ui.text, 'center', 'b');
      ctx.globalAlpha = 1;
    });
  }

  function drawWaiting() {
    text('Connexion au serveur…', WORLD.CX, WORLD.CY, 40, '#ffffff', 'center');
  }
})();
