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
  const ctx = cv.getContext('2d');
  const FONT_T = '"Cinzel", Georgia, serif';
  const FONT_B = '"Nunito", system-ui, sans-serif';
  // Échelle d'affichage (purement visuelle) des personnages et des monstres
  const HERO_SCALE = 1.3, MOB_SCALE = 1.2;

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
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    if (terrain) ctx.drawImage(terrain.canvas, 0, 0);
    else { ctx.fillStyle = P.biome.prairie.ground[0]; ctx.fillRect(0, 0, WORLD.W, WORLD.H); }
    if (terrain) A.drawLavaGlow(ctx, terrain.lava, time);
    if (!snap) { ctx.restore(); drawWaiting(); return; }

    drawZones(0);
    // entités triées en profondeur
    const list = [];
    list.push({ y: WORLD.CY + 20, d: () => A.drawTower(ctx, WORLD.CX, WORLD.CY, { t: time, up: snap.up, hp: snap.tw[0] / snap.tw[1] }) });
    for (const [id, h] of heroes) list.push({ y: h.y, d: () => drawHeroEnt(id, h) });
    for (const m of mobs.values()) list.push({ y: m.y, d: () => drawMobEnt(m, false) });
    for (const m of allies.values()) list.push({ y: m.y, d: () => drawMobEnt(m, true) });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) it.d();

    drawZones(1);
    for (const p of snap.p) A.drawProjectile(ctx, NET.PROJ_KINDS[p[0]], p[1], p[2], p[3] / 100, time);
    drawFx();
    drawAmbient();
    drawLabels();
    drawVignette();
    ctx.restore();
    drawHud();
  }

  function drawHeroEnt(id, h) {
    const info = roster.get(id);
    if (!info) return;
    if (h.f & HF.DEAD) { ctx.save(); ctx.translate(h.x, h.y); ctx.scale(HERO_SCALE, HERO_SCALE); A.drawGrave(ctx, 0, 0, time); ctx.restore(); return; }
    if (h.f & HF.ULT) {
      ctx.save(); ctx.globalAlpha = 0.35 + 0.2 * Math.sin(time * 6);
      ctx.beginPath(); ctx.ellipse(h.x, h.y + 1, 21, 8, 0, 0, Math.PI * 2); ctx.fillStyle = CLASSES[info.cls].color; ctx.fill(); ctx.restore();
    }
    A.drawHero(ctx, h.x, h.y, {
      cls: info.cls, look: info.look, equip: info.equip, facing: h.facing, t: time, seed: h.seed, scale: HERO_SCALE, moving: h.moving,
      attack: Math.max(0, h.attackT), zombie: !!(h.f & HF.ZOMBIE), stealth: !!(h.f & HF.STEALTH)
    });
    if (h.f & HF.SHIELD) { ctx.save(); ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.arc(h.x, h.y - 21, 28, 0, Math.PI * 2); ctx.strokeStyle = P.fx.frost; ctx.lineWidth = 3; ctx.stroke(); ctx.restore(); }
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
    if (r[4] < 100 && !boss) bar(m.x - size, m.y - size * 2.2 - 6, size * 2, 4, r[4] / 100, ally ? P.ui.ok : elite ? P.ui.gold : P.ui.danger);
  }

  // Vignettage léger (pré-calculé) pour donner de la profondeur
  let vignette = null;
  function drawVignette() {
    if (!vignette) {
      vignette = document.createElement('canvas');
      vignette.width = WORLD.W; vignette.height = WORLD.H;
      const v = vignette.getContext('2d');
      const g = v.createRadialGradient(WORLD.CX, WORLD.CY, WORLD.H * 0.45, WORLD.CX, WORLD.CY, WORLD.W * 0.62);
      g.addColorStop(0, 'rgba(20,12,30,0)'); g.addColorStop(1, 'rgba(20,12,30,0.38)');
      v.fillStyle = g; v.fillRect(0, 0, WORLD.W, WORLD.H);
    }
    ctx.drawImage(vignette, 0, 0);
  }

  function bar(x, y, w, h, k, color) {
    ctx.fillStyle = P.outline; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#3a2f47'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, k)), h);
  }

  function drawLabels() {
    ctx.textAlign = 'center';
    ctx.font = `800 13px ${FONT_B}`;
    ctx.lineJoin = 'round';
    for (const [id, h] of heroes) {
      const info = roster.get(id);
      if (!info) continue;
      const dead = h.f & HF.DEAD;
      const y = h.y - (dead ? 38 : 64);
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

  function drawFx() {
    for (const f of fx) {
      const k = f.t / f.dur;
      ctx.save();
      switch (f.k) {
        case 'part':
          ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size); break;
        case 'num': {
          ctx.globalAlpha = 1 - k * k;
          const size = f.c === 1 ? 22 : f.c === 2 ? 16 : 14;
          ctx.font = `900 ${size}px ${FONT_B}`; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = P.outline;
          const y = f.y - k * 30;
          const s = (f.c === 2 ? '+' : '') + f.v;
          ctx.strokeText(s, f.x, y);
          ctx.fillStyle = f.c === 1 ? P.fx.crit : f.c === 2 ? P.fx.heal : '#ffffff';
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
    const era = GD.eraOfWave(Math.max(1, s.w));
    // bandeau central
    panel(WORLD.CX - 330, 14, 660, 104);
    const title = s.ph === 'lobby' ? 'EN ATTENTE' : `MANCHE ${s.w}`;
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
      if (!lvl || id === 'pact') continue;
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
    panel(14, WORLD.H - 70, 470, 56);
    text(`⚔️ Rejoins la défense : ${joinUrl}`, 32, WORLD.H - 44, 17, P.ui.text, 'left', 'b');
    text(`${heroes.size} héros en jeu`, 32, WORLD.H - 24, 13, P.ui.muted, 'left', 'b');
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
    text(`VOTE DE L’ÉQUIPE · ${s.timer}s`, WORLD.CX, y0 - 22, 22, P.ui.gold, 'center');
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
