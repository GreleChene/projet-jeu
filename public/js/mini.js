/* Onglet « Mini-jeux » : expéditions solo tour par tour (mine, forêt, champ de baies) */
(function () {
  'use strict';
  const GD = window.GameData, M = GD.MINI, A = window.Art;
  const { api, $, el, toast } = window.UI;
  const W = 800, H = 340, G = 252; // scène : largeur, hauteur, ligne du sol
  const HERO_X = 170, MOB_X0 = 470;

  let state = null, prev = null, target = 0, busy = false;
  const floaters = []; // nombres et textes flottants
  let heroAnim = 0, mobAnim = 0, shake = 0;
  let heroX = HERO_X;      // position du héros (il va jusqu'au butin pour le récolter)
  let harvestFx = null;    // animation de récolte en cours { t, kind, amount, jackpot, sent }
  const parts = [];        // éclats (pierre, copeaux, baies) et étincelles
  const flyers = [];       // icônes de ressources qui s'envolent vers le compteur
  const LOOT_X = 560;

  /* ============================== Sons (synthétisés, sans fichier) ============================== */
  const Sound = (() => {
    let ac = null;
    let muted = false;
    try { muted = localStorage.getItem('miniMute') === '1'; } catch (e) { /* stockage indisponible */ }
    function audio() {
      if (!ac) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ac = new C(); }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    // note : fréquence, durée, forme, volume, décalage, glissement de fréquence
    function tone(c, f, dur, type, vol, when, slide) {
      const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + (when || 0);
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    }
    // bruit filtré (choc, craquement, froissement)
    function noise(c, dur, vol, when, freq, ftype) {
      const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t0 = c.currentTime + (when || 0);
      s.buffer = buf; f.type = ftype || 'bandpass'; f.frequency.value = freq || 1000; g.gain.value = vol;
      s.connect(f).connect(g).connect(c.destination); s.start(t0);
    }
    const SFX = {
      // pioche sur la pierre : « tink » métallique + éclats
      pierre: (c) => { const p = 0.9 + Math.random() * 0.2; tone(c, 1900 * p, 0.14, 'triangle', 0.2); tone(c, 2900 * p, 0.07, 'square', 0.04, 0.005); noise(c, 0.07, 0.35, 0, 3500, 'highpass'); },
      // hache dans le bois : coup sourd + craquement
      bois: (c) => { const p = 0.9 + Math.random() * 0.2; tone(c, 170 * p, 0.14, 'sine', 0.45, 0, -90); noise(c, 0.1, 0.45, 0, 800 * p, 'bandpass'); noise(c, 0.05, 0.2, 0.03, 2200, 'bandpass'); },
      // cueillette : « pop » + froissement de feuilles
      baies: (c) => { const p = 0.9 + Math.random() * 0.25; tone(c, 520 * p, 0.08, 'sine', 0.3, 0, 600); noise(c, 0.12, 0.12, 0, 3000, 'bandpass'); },
      // ressources ramassées : petit carillon
      gain: (c) => { [784, 988, 1319].forEach((f, i) => tone(c, f, 0.22, 'triangle', 0.13, i * 0.07)); },
      // coup de chance : arpège doré
      jackpot: (c) => { [659, 784, 988, 1319, 1568].forEach((f, i) => tone(c, f, 0.3, 'triangle', 0.12, i * 0.06)); tone(c, 2093, 0.5, 'sine', 0.06, 0.32); }
    };
    return {
      play(k) { if (muted) return; const c = audio(); if (c && SFX[k]) SFX[k](c); },
      toggle() { muted = !muted; try { localStorage.setItem('miniMute', muted ? '1' : '0'); } catch (e) { /* */ } return muted; },
      muted: () => muted
    };
  })();

  // Couleurs des éclats selon la ressource
  const CHIPS = { pierre: ['#9aa3ae', '#c4cbd4', '#6b7480', '#e8eef5'], bois: ['#d9b07a', '#a8703f', '#e6c08a', '#83532c'], baies: ['#5a4fd6', '#c0306a', '#7a6ae6', '#4f9e3a'] };
  function burstAt(x, y, res, n, power) {
    const cols = CHIPS[res];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = (120 + Math.random() * 200) * (power || 1);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.7 + Math.random() * 0.5, t: 0, c: cols[i % cols.length], s: 3 + Math.random() * 4, round: res === 'baies' && i % 2 === 0 });
    }
  }

  // Récolte animée : le héros va au butin, frappe 3 fois (sons + éclats), le butin éclate et les icônes s'envolent
  function startHarvest() {
    const r = state.run;
    if (!r || !r.loot || harvestFx || busy) return;
    const res = M.MODES[r.mode].res;
    harvestFx = { t: 0, res, kind: GD.RES_IDS.indexOf(res), amount: r.loot.amount, jackpot: r.loot.jackpot, hits: 0, sent: false };
    render();
  }
  function stepHarvest(dt) {
    const f = harvestFx;
    if (!f) { heroX += (HERO_X - heroX) * Math.min(1, dt * 6); return; }
    f.t += dt;
    const reach = LOOT_X - 95;
    if (f.t < 0.35) heroX = HERO_X + (reach - HERO_X) * (f.t / 0.35);
    else heroX = reach;
    const strikes = [0.5, 0.85, 1.2];
    while (f.hits < strikes.length && f.t >= strikes[f.hits]) {
      f.hits++;
      heroAnim = 0.25; f.shake = 0.25;
      Sound.play(f.res);
      burstAt(LOOT_X - 10, G - 30, f.res, 10 + f.hits * 3, 1);
    }
    if (f.t >= 1.45 && !f.sent) {
      f.sent = true;
      burstAt(LOOT_X, G - 30, f.res, 34, 1.5);
      shake = 4;
      const n = Math.min(14, Math.max(4, f.amount));
      for (let i = 0; i < n; i++) flyers.push({ x0: LOOT_X + (Math.random() - 0.5) * 60, y0: G - 40 - Math.random() * 30, t: -i * 0.05, icon: GD.RESOURCES[f.res].icon, last: i === n - 1 });
      if (f.jackpot) { Sound.play('jackpot'); for (let i = 0; i < 24; i++) parts.push({ x: LOOT_X, y: G - 60, vx: (Math.random() - 0.5) * 420, vy: -Math.random() * 380, life: 1.2, t: 0, c: i % 2 ? '#ffd23a' : '#fff6b0', s: 4, star: true }); }
      act('take');
    }
    if (f.t >= 1.9) harvestFx = null;
  }

  /* ============================== Données ============================== */
  async function load() {
    try { state = (await api('/api/mini')).mini; render(); } catch (e) { /* hors ligne */ }
  }
  async function send(path, body) {
    if (busy) return;
    busy = true;
    try {
      const r = await api(path, { body });
      prev = state; state = r.mini;
      if (r.user && window.PlayerApp) window.PlayerApp.setUser(r.user);
      animate(prev && prev.run, state.run);
      render();
    } catch (e) { toast(e.message); }
    busy = false;
  }
  const act = (action, extra) => send('/api/mini/act', { action, target, ...(extra || {}) });

  // Nombres flottants et animations à partir de la différence entre deux états
  function animate(a, b) {
    if (!a || !b || a.room !== b.room) return;
    (b.mobs || []).forEach((m, i) => {
      const o = a.mobs && a.mobs[i];
      if (o && m.hp < o.hp) { floaters.push({ x: mobX(i, b.mobs.length), y: G - 70, s: '−' + (o.hp - m.hp), c: '#ffe066', t: 0 }); heroAnim = 0.3; }
    });
    if (b.hp < a.hp) { floaters.push({ x: HERO_X, y: G - 90, s: '−' + (a.hp - b.hp), c: '#ff6a5a', t: 0 }); mobAnim = 0.3; shake = 6; }
    if (b.hp > a.hp) floaters.push({ x: HERO_X, y: G - 90, s: '+' + (b.hp - a.hp), c: '#7fe07a', t: 0 });
    if (b.got > a.got) floaters.push({ x: W / 2, y: G - 120, s: `+${b.got - a.got} ${resIcon(b.mode)}`, c: '#ffffff', t: 0 });
  }

  const resIcon = (mode) => GD.RESOURCES[M.MODES[mode].res].icon;
  const mobX = (i, n) => MOB_X0 + (n === 1 ? 140 : i * (260 / Math.max(1, n - 1)));
  const fmtTime = (ms) => { const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min ${String(s % 60).padStart(2, '0')}`; };

  /* ============================== Interface ============================== */
  function render() {
    const root = $('#miniRoot');
    if (!root || !state) return;
    root.replaceChildren(header(), state.run ? runView() : lobby());
  }

  function header() {
    const bolts = Array.from({ length: state.max }, (_, i) => el('span', { class: 'mini-bolt' + (i < state.energy ? ' on' : '') }, '⚡'));
    return el('div', { class: 'panel mini-head' },
      el('div', {}, el('b', {}, 'Énergie '), ...bolts,
        el('span', { class: 'small muted', id: 'miniTimer' }, state.nextIn !== null ? ` · prochaine dans ${fmtTime(state.nextIn)}` : ' · au maximum')),
      el('div', { class: 'mini-res' }, ...GD.RES_IDS.map((k) => el('span', { class: 'chip' }, `${GD.RESOURCES[k].icon} ${state.res[k] || 0} ${GD.RESOURCES[k].name.toLowerCase()}`))));
  }

  function upgradeRow(id) {
    const key = id.split('_')[0], U = M.UPGRADES[key], lvl = state.up[id] || 0;
    const cost = GD.miniUpgradeCost(id, lvl), max = lvl >= U.max;
    const ok = !max && GD.canPay(state.res, cost);
    return el('div', { class: 'mini-up' },
      el('span', {}, `${U.icon} ${U.perRes ? `${U.name} (${GD.RESOURCES[id.split('_')[1]].icon} ${GD.RESOURCES[id.split('_')[1]].name.toLowerCase()})` : U.name} `, el('span', { class: 'small muted' }, `niv. ${lvl}/${U.max} — ${U.desc}`)),
      el('button', { disabled: !ok, onclick: () => send('/api/mini/upgrade', { id }) }, max ? 'Max' : GD.costText(cost)));
  }

  function lobby() {
    const cards = Object.entries(M.MODES).map(([k, m]) => el('div', { class: 'panel mini-card' },
      el('canvas', { class: 'mini-thumb', width: 320, height: 120, 'data-mode': k }),
      el('h3', {}, `${m.icon} ${m.name}`),
      el('p', { class: 'small' }, m.desc),
      el('p', { class: 'small muted' }, `Rapporte : ${GD.RESOURCES[m.res].icon} ${GD.RESOURCES[m.res].name} · record : salle ${state.best[k] || 0}`),
      el('button', { class: 'primary', disabled: state.energy < 1, onclick: () => send('/api/mini/start', { mode: k }) }, `${m.verb} (1 ⚡)`),
      el('div', { class: 'mini-ups' }, ...['luck', 'bounty', 'jackpot', 'fortune'].map((u) => upgradeRow(`${u}_${k}`)))));
    const wrap = el('div', {},
      el('div', { class: 'grid three' }, ...cards),
      el('div', { class: 'panel' }, el('h2', {}, 'Améliorations générales'),
        upgradeRow('potion'), ...GD.RES_IDS.map((k) => upgradeRow('harvest_' + k))),
      el('div', { class: 'panel small' }, el('h2', {}, 'Comment ça marche'),
        el('ul', {},
          el('li', {}, `Une expédition coûte 1 ⚡ (1 énergie toutes les ${M.ENERGY_HOURS} h, ${M.ENERGY_MAX} au plus). Combat au tour par tour avec les statistiques réelles de ton héros.`),
          el('li', {}, 'Chaque salle contient du butin ou des monstres ; chaque monstre tué rapporte 1 ressource et de l’XP. Plus tu descends, plus le butin est gros… et les monstres coriaces.'),
          el('li', {}, `Toutes les ${M.ELITE_EVERY} salles, un monstre d’élite garde la salle : choisis ensuite une récompense (force, PV, Grêlons, ressources…).`),
          el('li', {}, `Toutes les ${M.ESCAPE_EVERY} salles : remonte avec ton butin ou continue. Si ton héros tombe, tu perds ${Math.round(M.DEATH_LOSS * 100)} % des ressources de l’expédition (l’XP est gardée).`),
          el('li', {}, 'Les ressources améliorent les mini-jeux et ta récolte de chaque ressource en défense de tour.'))));
    requestAnimationFrame(() => wrap.querySelectorAll('canvas.mini-thumb').forEach((c) => {
      const x = c.getContext('2d'); x.save(); x.scale(c.width / W, c.width / W); x.translate(0, -40);
      drawScene(x, c.dataset.mode, 0, 0, 1, 1); x.restore();
    }));
    return wrap;
  }

  let sceneCv = null;
  function runView() {
    const r = state.run, mode = M.MODES[r.mode], dec = mode.decors[r.decor];
    sceneCv = el('canvas', { class: 'mini-scene', width: W, height: H });
    sceneCv.addEventListener('click', (e) => {
      const b = sceneCv.getBoundingClientRect(), x = ((e.clientX - b.left) / b.width) * W;
      (r.mobs || []).forEach((m, i) => { if (m.hp > 0 && Math.abs(x - mobX(i, r.mobs.length)) < 50) target = i; });
    });
    const hpPct = Math.max(0, (100 * r.hp) / r.max);
    const buffs = [r.buff.dmg ? `⚔️ +${Math.round(r.buff.dmg * 100)} %` : '', r.buff.hp ? `❤️ +${Math.round(r.buff.hp * 100)} %` : '', r.buff.crit ? `🎯 +${Math.round(r.buff.crit * 100)} %` : ''].filter(Boolean).join(' · ');
    const info = el('div', { class: 'mini-info' },
      el('div', {}, el('button', { class: 'mini-mute', title: 'Activer / couper les sons', onclick: (e) => { e.currentTarget.textContent = Sound.toggle() ? '🔇' : '🔊'; } }, Sound.muted() ? '🔇' : '🔊'), ' ', el('b', {}, `${mode.icon} Salle ${r.room}`), el('span', { class: 'small muted' }, ` · ${dec.name} — ${dec.subs[r.sub]}`)),
      el('div', { class: 'mini-hp' }, el('span', { class: 'small' }, `❤️ ${r.hp} / ${r.max}`), el('div', { class: 'bar' }, el('span', { style: `width:${hpPct}%;background:${hpPct > 40 ? '#5cb84a' : '#e2504c'}` }))),
      el('div', { class: 'small' }, `${resIcon(r.mode)} ${r.got} · ✨ ${r.xp} XP · 🧪 ${r.potions}${r.grelons ? ` · 🌨️ ${r.grelons}` : ''}${buffs ? ' · ' + buffs : ''}${r.dot ? ` · ${r.dot.kind === 'burn' ? '🔥 brûlure' : '☠️ poison'}` : ''}`));
    return el('div', { class: 'panel' }, info, el('div', { class: 'mini-scene-wrap' }, sceneCv), actions(r),
      el('ul', { class: 'mini-log small' }, ...r.log.slice().reverse().map((l, i) => el('li', { style: i ? 'opacity:.7' : 'font-weight:700' }, l))));
  }

  function actions(r) {
    const B = (label, fn, opts = {}) => el('button', { class: opts.cls || '', disabled: !!opts.disabled || busy, title: opts.title || '', onclick: fn }, label);
    const box = el('div', { class: 'mini-actions' });
    if (r.state === 'fight') {
      box.append(
        B('⚔️ Attaquer', () => act('attack'), { cls: 'primary' }),
        B(r.aoe ? `✨ Explosion arcanique${r.skillCd ? ` (${r.skillCd})` : ''}` : `✨ Coup puissant${r.skillCd ? ` (${r.skillCd})` : ''}`, () => act('skill'), { disabled: r.skillCd > 0, title: r.aoe ? '120 % des dégâts à tous les ennemis' : '220 % des dégâts à la cible' }),
        B('🛡️ Se protéger', () => act('defend'), { title: 'Dégâts reçus divisés par 2 ce tour, +5 % de PV' }),
        B(`🧪 Potion (${r.potions})`, () => act('potion'), { disabled: r.potions <= 0, title: `Soigne ${Math.round(M.POTION_HEAL * 100)} % des PV` }));
      if (r.mobs.filter((m) => m.hp > 0).length > 1) box.append(el('span', { class: 'small muted' }, 'Clique sur un monstre pour le cibler.'));
    } else if (r.state === 'loot') box.append(B(`🧺 Récolter ${r.loot.amount} ${resIcon(r.mode)}${r.loot.jackpot ? ` (coup de chance ×${String(r.loot.jackpot).replace('.', ',')} !)` : ''}`, startHarvest, { cls: 'primary', disabled: !!harvestFx }));
    else if (r.state === 'cleared') box.append(B('➡️ Salle suivante', () => act('next'), { cls: 'primary' }));
    else if (r.state === 'choice') {
      box.append(el('div', { class: 'small' }, `Point de remontée : rentre avec ${r.got} ${resIcon(r.mode)} et ${r.xp} XP, ou continue (si ton héros tombe, ${Math.round(M.DEATH_LOSS * 100)} % des ressources sont perdues).`),
        B('⬆️ Remonter avec le butin', () => act('leave'), { cls: 'primary' }), B('⬇️ Continuer à descendre', () => act('continue'), { cls: 'danger' }));
    } else if (r.state === 'reward') {
      box.append(el('div', { class: 'small' }, 'Élite vaincue ! Choisis une récompense :'),
        ...r.rewards.map((k) => { const R = M.ELITE_REWARDS[k]; return el('button', { class: 'mini-reward', disabled: busy, onclick: () => act('reward', { id: k }) }, el('b', {}, `${R.icon} ${R.name}`), el('span', { class: 'small' }, R.desc)); }));
    } else if (r.state === 'over') {
      const o = r.over;
      box.append(el('div', {}, el('b', {}, o.dead ? '💀 Ton héros est tombé' : '🏁 Expédition terminée'),
        el('div', { class: 'small' }, `Salle ${o.room} · ${o.kills} monstres · +${o.banked} ${resIcon(r.mode)}${o.lost ? ` (${o.lost} perdus)` : ''} · +${o.xp} XP${o.grelons ? ` · +${o.grelons} 🌨️` : ''}${o.levels ? ` · +${o.levels} niveau(x) !` : ''}`)),
        B('Retour au camp', () => act('close'), { cls: 'primary' }));
    }
    return box;
  }

  /* ============================== Scène ============================== */
  function frame() {
    requestAnimationFrame(frame);
    const view = $('[data-view="mini"]');
    if (!view || view.classList.contains('hidden') || !sceneCv || !state || !state.run || !sceneCv.isConnected) return;
    const ctx = sceneCv.getContext('2d'), r = state.run, t = performance.now() / 1000;
    heroAnim = Math.max(0, heroAnim - 1 / 60); mobAnim = Math.max(0, mobAnim - 1 / 60); shake = Math.max(0, shake - 0.4);
    stepHarvest(1 / 60);
    ctx.save();
    ctx.translate((Math.random() - 0.5) * shake, 0);
    drawScene(ctx, r.mode, r.decor, r.sub, t, r.room);
    const me = window.PlayerApp && window.PlayerApp.me();
    // héros
    if (r.state === 'over' && r.over.dead) A.drawGrave(ctx, HERO_X, G + 6);
    else if (me) A.drawHero(ctx, heroX + (heroAnim > 0 ? 18 * Math.sin((heroAnim / 0.3) * Math.PI) : 0), G + 6, { cls: me.cls, look: me.look, gear: window.PlayerApp.myGear(), t, scale: 2.2, facing: 0, moving: Math.abs(heroX - HERO_X) > 2 && Math.abs(heroX - (LOOT_X - 95)) > 2, attack: heroAnim });
    // butin
    const hf = harvestFx;
    if (r.loot || (hf && !hf.sent)) {
      const kind = GD.RES_IDS.indexOf(M.MODES[r.mode].res);
      // le butin tremble à chaque coup et rétrécit au fil de la récolte
      const pct = hf ? Math.max(25, 100 - hf.hits * 25) : 100;
      const sk = hf && hf.shake > 0 ? (hf.shake -= 1 / 60, Math.sin(t * 90) * 5) : 0;
      if ((r.loot && r.loot.jackpot) || (hf && hf.jackpot)) { ctx.save(); ctx.translate(LOOT_X, G - 40); A.glow(ctx, '#ffd23a', 46 + Math.sin(t * 4) * 6); ctx.restore(); }
      ctx.save(); ctx.translate(LOOT_X + sk, G + 8); ctx.scale(1.8, 1.8); A.drawResNode(ctx, kind, 0, 0, pct, t, r.room); ctx.restore();
    } else if (hf && hf.sent) {
      const kind = GD.RES_IDS.indexOf(M.MODES[r.mode].res);
      ctx.save(); ctx.translate(LOOT_X, G + 8); ctx.scale(1.8, 1.8); ctx.globalAlpha = Math.max(0, 1 - (hf.t - 1.45) * 2); A.drawResNode(ctx, kind, 0, 0, 0, t, r.room); ctx.restore();
    }
    // monstres
    (r.mobs || []).forEach((m, i) => {
      const x = mobX(i, r.mobs.length);
      if (m.hp <= 0) return;
      const d = GD.MOBS[m.type], s = (d.size || 14) * (m.elite ? 2.4 : 1.9);
      A.drawMob(ctx, m.type, x - (mobAnim > 0 ? 14 * Math.sin((mobAnim / 0.3) * Math.PI) : 0), G + 6, { t: t + i, facing: Math.PI, size: s, elite: m.elite, attack: mobAnim > 0 ? 1 : 0 });
      const top = G + 6 - s * (A.mobTop(m.type) + 0.35) - 16;
      A.rrect(ctx, x - 34, top, 68, 7, 3, '#2a1f22', 1.5);
      A.rrect(ctx, x - 33, top + 1, Math.max(0, 66 * m.hp / m.max), 5, 2, m.elite ? '#f2c14e' : '#e2504c', 0.01);
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#120c0a'; ctx.lineWidth = 3;
      ctx.strokeText(m.name, x, top - 5); ctx.fillText(m.name, x, top - 5);
      if (i === target && r.mobs.filter((q) => q.hp > 0).length > 1) { ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.moveTo(x - 7, top - 30); ctx.lineTo(x + 7, top - 30); ctx.lineTo(x, top - 21); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    });
    // éclats de récolte (gravité) et étoiles du coup de chance
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.t += 1 / 60;
      if (p.t > p.life) { parts.splice(i, 1); continue; }
      p.vy += 700 / 60; p.x += p.vx / 60; p.y += p.vy / 60;
      if (p.y > G + 14 && !p.star) { p.y = G + 14; p.vy *= -0.35; p.vx *= 0.6; }
      ctx.globalAlpha = Math.min(1, (p.life - p.t) * 3);
      ctx.fillStyle = p.c;
      if (p.round || p.star) { ctx.beginPath(); ctx.arc(p.x, p.y, p.s / 2 + 0.5, 0, Math.PI * 2); ctx.fill(); if (p.round) { ctx.strokeStyle = '#120c0a'; ctx.lineWidth = 1; ctx.stroke(); } }
      else { ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); ctx.strokeStyle = '#120c0a'; ctx.lineWidth = 1; ctx.strokeRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); }
      ctx.globalAlpha = 1;
    }
    // icônes de ressources qui s'envolent vers le compteur (en haut à gauche) ; carillon à l'arrivée
    for (let i = flyers.length - 1; i >= 0; i--) {
      const f = flyers[i]; f.t += 1 / 60;
      if (f.t < 0) continue;
      const k = Math.min(1, f.t / 0.7), e = k * k * (3 - 2 * k);
      const x = f.x0 + (40 - f.x0) * e, y = f.y0 + (24 - f.y0) * e - Math.sin(k * Math.PI) * 90;
      ctx.font = `${Math.round(22 - 8 * k)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
      ctx.fillText(f.icon, x, y); ctx.textBaseline = 'alphabetic';
      if (k >= 1) { flyers.splice(i, 1); if (f.last) Sound.play('gain'); }
    }
    // nombres flottants
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i]; f.t += 1 / 60;
      if (f.t > 1.2) { floaters.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - f.t / 1.2; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#120c0a'; ctx.fillStyle = f.c;
      ctx.strokeText(f.s, f.x, f.y - f.t * 40); ctx.fillText(f.s, f.x, f.y - f.t * 40); ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (target >= (r.mobs || []).length || (r.mobs[target] && r.mobs[target].hp <= 0)) target = Math.max(0, (r.mobs || []).findIndex((m) => m.hp > 0));
  }
  requestAnimationFrame(frame);

  // Minuteur d'énergie
  setInterval(() => {
    if (!state || state.nextIn === null) return;
    state.nextIn -= 1000;
    if (state.nextIn <= 0) return load();
    const tm = $('#miniTimer');
    if (tm) tm.textContent = ` · prochaine dans ${fmtTime(state.nextIn)}`;
  }, 1000);

  /* ============================== Décors ==============================
   * 3 mini-jeux × 3 décors (selon la profondeur) × 6 sous-décors. Fond + sol du décor, puis l'élément du sous-décor. */
  const DECOR_BASE = {
    mine: [
      { back: ['#6b5240', '#4a372a'], ground: '#7a5a3e', dots: '#5e4430', rock: '#8a6a50' },
      { back: ['#3a3360', '#221e3e'], ground: '#4a4466', dots: '#3a3456', rock: '#5a5480' },
      { back: ['#3a1c18', '#1e0c0a'], ground: '#4a2a22', dots: '#2e1612', rock: '#5a2e26' }
    ],
    foret: [
      { sky: ['#bfe6ff', '#e6f6ff'], ground: '#6fbf55', dots: '#5aa845', tree: '#4ea845' },
      { sky: ['#8fb8a8', '#cfe2d6'], ground: '#4f8f45', dots: '#3f7f3a', tree: '#2f6b3a' },
      { sky: ['#4a3f5a', '#7a6a7a'], ground: '#4a4a32', dots: '#3a3a26', tree: '#3a3030' }
    ],
    champ: [
      { sky: ['#8fd0ff', '#dff3ff'], ground: '#9fd26a', dots: '#86c050', hill: '#8cc85a' },
      { sky: ['#a8d8f0', '#e8f6ff'], ground: '#7fbf5a', dots: '#6aa848', hill: '#6aa84a' },
      { sky: ['#ff9a6a', '#6a4a8a'], ground: '#6a8a4a', dots: '#566f3c', hill: '#4a6a3a' }
    ]
  };
  function rng(seed) { return window.Terrain.mulberry32(seed | 0); }

  function drawScene(ctx, mode, decor, sub, t, room) {
    const B = DECOR_BASE[mode][decor], R = rng((room || 1) * 97 + decor * 13 + sub);
    // fond
    const top = B.back || B.sky;
    const g = ctx.createLinearGradient(0, 0, 0, G);
    g.addColorStop(0, mode === 'mine' ? top[1] : top[0]); g.addColorStop(1, mode === 'mine' ? top[0] : top[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (mode === 'mine') {
      // paroi rocheuse : blocs
      for (let i = 0; i < 40; i++) { const x = R() * W, y = R() * (G - 20); A.rrect(ctx, x, y, 30 + R() * 40, 16 + R() * 18, 6, A.rgba(B.rock, 0.5), 0.01); }
      ctx.fillStyle = A.rgba('#000000', 0.25); ctx.fillRect(0, 0, W, 26);
    } else if (mode === 'foret') {
      // troncs et feuillages au loin
      for (let i = 0; i < 9; i++) {
        const x = i * 95 + R() * 40, w = 18 + R() * 14;
        A.rrect(ctx, x, 40, w, G - 40, 4, A.shade(B.tree, -0.45), 0.01);
        ctx.fillStyle = A.rgba(B.tree, 0.85); ctx.beginPath(); ctx.arc(x + w / 2, 40, 55 + R() * 20, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      // collines
      ctx.fillStyle = A.shade(B.hill, 0.12); ctx.beginPath(); ctx.ellipse(200, G + 10, 330, 90, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = B.hill; ctx.beginPath(); ctx.ellipse(640, G + 10, 300, 70, 0, Math.PI, 0); ctx.fill();
    }
    // sol
    ctx.fillStyle = B.ground; ctx.fillRect(0, G - 6, W, H - G + 6);
    ctx.fillStyle = A.shade(B.ground, -0.18); ctx.fillRect(0, G - 6, W, 4);
    for (let i = 0; i < 70; i++) { ctx.fillStyle = A.rgba(B.dots, 0.8); ctx.fillRect(R() * W, G + R() * (H - G), 4, 2); }
    // élément du sous-décor
    const f = FEATURES[mode][decor][sub];
    if (f) f(ctx, t, R, B);
    // voile sombre dans les profondeurs (mine) et le bois maudit
    if ((mode === 'mine' && decor > 0) || (mode === 'foret' && decor === 2)) {
      const v = ctx.createRadialGradient(W / 2, G - 40, 120, W / 2, G - 40, 520);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    }
  }

  // petits outils de dessin des décors
  const glowAt = (ctx, x, y, c, r) => { ctx.save(); ctx.translate(x, y); A.glow(ctx, c, r); ctx.restore(); };
  const crystal = (ctx, x, y, h, c) => { A.poly(ctx, [x - h * 0.25, y, x - h * 0.18, y - h * 0.7, x, y - h, x + h * 0.2, y - h * 0.65, x + h * 0.25, y], c, 2); A.poly(ctx, [x, y - h, x + h * 0.2, y - h * 0.65, x + h * 0.05, y], A.shade(c, 0.25), 0.01); };
  const tree = (ctx, x, y, s, trunk, leaf) => { A.rrect(ctx, x - 6 * s, y - 50 * s, 12 * s, 50 * s, 3, trunk, 2); A.circle(ctx, x, y - 62 * s, 28 * s, leaf, 2); A.circle(ctx, x - 18 * s, y - 50 * s, 18 * s, A.shade(leaf, -0.1), 2); A.circle(ctx, x + 18 * s, y - 50 * s, 18 * s, A.shade(leaf, -0.1), 2); };
  const deadTree = (ctx, x, y, s) => { A.line(ctx, x, y, x, y - 110 * s, '#3a2a22', 8 * s); A.line(ctx, x, y - 70 * s, x - 34 * s, y - 100 * s, '#3a2a22', 4 * s); A.line(ctx, x, y - 85 * s, x + 30 * s, y - 120 * s, '#3a2a22', 4 * s); A.line(ctx, x - 20 * s, y - 88 * s, x - 30 * s, y - 120 * s, '#3a2a22', 3 * s); };
  const lantern = (ctx, x, y, t) => { A.line(ctx, x, 26, x, y - 10, '#3a2a22', 1.5); glowAt(ctx, x, y, '#ffb84a', 26 + Math.sin(t * 3 + x) * 3); A.rrect(ctx, x - 7, y - 10, 14, 18, 3, '#ffd76a', 2); };
  const stone = (ctx, x, y, w, h, c) => A.poly(ctx, [x - w / 2, y, x - w * 0.4, y - h * 0.7, x - w * 0.1, y - h, x + w * 0.35, y - h * 0.8, x + w / 2, y], c, 2.5);
  const flower = (ctx, x, y, c) => { A.line(ctx, x, y, x, y - 10, '#3f7f2a', 1.4); A.circle(ctx, x, y - 12, 3.5, c, 1.2); };

  const FEATURES = {
    mine: [
      [ // Galeries de terre
        (ctx) => { for (const x of [60, 330, 620]) { A.rrect(ctx, x, 60, 16, G - 60, 2, '#8a5a2e', 2.5); A.rrect(ctx, x + 120, 60, 16, G - 60, 2, '#8a5a2e', 2.5); A.rrect(ctx, x - 8, 48, 152, 16, 2, '#a8703f', 2.5); } },
        (ctx, t) => { for (const x of [110, 300, 500, 690]) lantern(ctx, x, 110 + (x % 3) * 12, t); },
        (ctx) => { for (const y of [G + 22, G + 48]) A.line(ctx, 0, y, W, y, '#8a8a92', 3); for (let x = 10; x < W; x += 40) A.rrect(ctx, x, G + 16, 10, 40, 1, '#6b4a2a', 1.4); },
        (ctx) => { A.rrect(ctx, 300, G - 50, 120, 48, 4, '#6a6e78', 2.5); for (let i = 0; i < 5; i++) A.circle(ctx, 318 + i * 21, G - 54, 12, '#9aa3ae', 2); A.circle(ctx, 325, G, 12, '#3a3a42', 2); A.circle(ctx, 395, G, 12, '#3a3a42', 2); },
        (ctx) => { for (const s of [0, 1]) { const x0 = s ? W : 0, d = s ? -1 : 1; A.poly(ctx, [x0, 0, x0 + d * 150, 0, x0 + d * 100, 120, x0 + d * 140, G, x0, G], '#3a2a20', 2.5); } },
        (ctx, t, R) => { for (let i = 0; i < 9; i++) stone(ctx, 560 + R() * 200, G + 2, 40 + R() * 40, 30 + R() * 40, '#8a7a6a'); for (let i = 0; i < 6; i++) { ctx.fillStyle = 'rgba(200,180,150,.6)'; ctx.fillRect(600 + R() * 150, ((t * 60 + i * 50) % G), 3, 3); } }
      ],
      [ // Cavernes de cristal
        (ctx, t, R) => { for (let i = 0; i < 7; i++) crystal(ctx, 40 + i * 120 + R() * 30, G, 60 + R() * 70, '#b48cff'); glowAt(ctx, 400, 150, '#b48cff', 120); },
        (ctx, t) => { ctx.fillStyle = '#3a6ab8'; ctx.beginPath(); ctx.ellipse(420, G + 40, 300, 34, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#120c0a'; ctx.lineWidth = 2.5; ctx.stroke(); for (let i = 0; i < 4; i++) A.line(ctx, 240 + i * 100 + Math.sin(t + i) * 8, G + 40, 280 + i * 100 + Math.sin(t + i) * 8, G + 40, '#9fd0ff', 2); },
        (ctx, t, R) => { for (let i = 0; i < 10; i++) { const x = R() * W, h = 40 + R() * 80; A.poly(ctx, [x - 14, G, x, G - h, x + 14, G], '#6a6488', 2); A.poly(ctx, [x - 10, 0, x, h * 0.8, x + 10, 0], '#5a5478', 2); } },
        (ctx) => { A.circle(ctx, 620, 130, 90, '#4a4466', 3); A.circle(ctx, 620, 130, 64, '#2a2440', 2); for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; crystal(ctx, 620 + Math.cos(a) * 60, 130 + Math.sin(a) * 60 + 14, 26, i % 2 ? '#7fd6ff' : '#b48cff'); } },
        (ctx) => { ctx.fillStyle = '#0e0a18'; ctx.fillRect(250, G - 6, 300, H - G + 6); A.poly(ctx, [230, G - 4, 570, G - 4, 540, G + 26, 400, G + 6, 260, G + 26], '#6a6488', 2.5); },
        (ctx, t) => { ctx.strokeStyle = A.rgba('#7fd6ff', 0.6 + 0.3 * Math.sin(t * 2)); ctx.lineWidth = 4; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(i * 180, 30); for (let k = 1; k < 6; k++) ctx.lineTo(i * 180 + k * 30 + Math.sin(k * 3 + i) * 20, 30 + k * 40); ctx.stroke(); } }
      ],
      [ // Profondeurs de magma
        (ctx, t) => { const y = G + 34; ctx.fillStyle = '#ff6a1a'; ctx.fillRect(0, y, W, 26); ctx.fillStyle = '#ffd23a'; for (let x = 0; x < W; x += 50) ctx.fillRect((x + t * 30) % W, y + 8, 20, 4); glowAt(ctx, 400, y, '#ff6a1a', 200); },
        (ctx) => { A.rrect(ctx, 560, G - 40, 70, 18, 3, '#4a4a56', 2.5); A.rrect(ctx, 580, G - 22, 30, 22, 2, '#3a3a46', 2); A.rrect(ctx, 80, 80, 40, G - 80, 3, '#5a3a32', 2.5); A.poly(ctx, [200, G, 200, 120, 230, 140, 240, G], '#5a3a32', 2.5); },
        (ctx, t, R) => { for (let i = 0; i < 8; i++) { const x = 30 + i * 105, h = 50 + R() * 90; A.poly(ctx, [x - 18, G, x - 6, G - h, x + 10, G - h * 0.7, x + 20, G], '#1a1420', 2); A.line(ctx, x - 4, G - h * 0.8, x + 2, G - h * 0.4, '#8a7aa8', 1.5); } },
        (ctx, t) => { const g = ctx.createLinearGradient(380, 0, 440, 0); g.addColorStop(0, 'rgba(255,120,40,0)'); g.addColorStop(0.5, 'rgba(255,150,60,.55)'); g.addColorStop(1, 'rgba(255,120,40,0)'); ctx.fillStyle = g; ctx.fillRect(360, 0, 100, G); for (let i = 0; i < 12; i++) { ctx.fillStyle = '#ffb03a'; ctx.fillRect(390 + Math.sin(i * 7) * 25, G - ((t * 70 + i * 40) % G), 3, 3); } },
        (ctx) => { A.rrect(ctx, 600, G - 120, 90, 120, 6, '#5a2e26', 3); A.rrect(ctx, 590, G - 40, 110, 40, 4, '#6a3a30', 3); A.poly(ctx, [610, G - 120, 620, G - 150, 635, G - 125, 645, G - 155, 655, G - 125, 670, G - 150, 680, G - 120], '#f2c14e', 2); },
        (ctx, t) => { ctx.fillStyle = '#120808'; ctx.fillRect(260, G - 6, 280, H - G + 6); glowAt(ctx, 400, H, '#ff5a1a', 160 + Math.sin(t * 2) * 10); }
      ]
    ],
    foret: [
      [ // Sous-bois
        (ctx, t) => { ctx.fillStyle = 'rgba(255,250,200,.25)'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(150 + i * 160, 0); ctx.lineTo(190 + i * 160, 0); ctx.lineTo(260 + i * 160, G); ctx.lineTo(200 + i * 160, G); ctx.closePath(); ctx.fill(); } },
        (ctx) => { ctx.fillStyle = '#b89a6a'; ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(330, G); ctx.lineTo(470, G); ctx.lineTo(W, H); ctx.fill(); for (const x of [90, 700]) stone(ctx, x, G + 10, 50, 30, '#7fae5a'); },
        (ctx, t) => { ctx.fillStyle = '#6fc6ef'; ctx.beginPath(); ctx.moveTo(0, G + 40); ctx.bezierCurveTo(250, G + 10, 500, G + 70, W, G + 30); ctx.lineTo(W, G + 60); ctx.bezierCurveTo(500, G + 100, 250, G + 40, 0, G + 70); ctx.fill(); for (let i = 0; i < 6; i++) A.line(ctx, (i * 140 + t * 40) % W, G + 50, (i * 140 + t * 40) % W + 20, G + 50, '#d4f2ff', 2); },
        (ctx) => { A.rrect(ctx, 590, G - 70, 120, 74, 10, '#8a5e38', 3); A.ellipse(ctx, 650, G - 70, 60, 14, '#d9b07a', 2.5); ctx.strokeStyle = '#a8703f'; ctx.lineWidth = 1.5; for (const r of [40, 25, 10]) { ctx.beginPath(); ctx.ellipse(650, G - 70, r, r * 0.23, 0, 0, Math.PI * 2); ctx.stroke(); } },
        (ctx) => { for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, x = 400 + Math.cos(a) * 120, y = G + 30 + Math.sin(a) * 26; A.rrect(ctx, x - 3, y - 12, 6, 12, 2, '#f1ead6', 1.4); ctx.beginPath(); ctx.ellipse(x, y - 12, 10, 7, 0, Math.PI, 0); ctx.closePath(); ctx.fillStyle = i % 2 ? '#e2504c' : '#c97b3a'; ctx.fill(); ctx.strokeStyle = '#120c0a'; ctx.lineWidth = 1.6; ctx.stroke(); } },
        (ctx) => { A.rrect(ctx, 580, G - 90, 150, 90, 4, '#8a5e38', 3); A.poly(ctx, [565, G - 88, 655, G - 150, 745, G - 88], '#6b3b33', 3); A.rrect(ctx, 640, G - 50, 30, 50, 3, '#4a2e18', 2); A.rrect(ctx, 600, G - 70, 24, 20, 2, '#ffe98a', 2); }
      ],
      [ // Forêt profonde
        (ctx) => { for (const x of [60, 640]) { A.rrect(ctx, x, 0, 90, G + 6, 8, '#5a3a22', 3); for (let k = 0; k < 4; k++) A.line(ctx, x + 20 + k * 18, 20, x + 16 + k * 18, G, '#4a2e18', 2); } },
        (ctx, t) => { for (let i = 0; i < 4; i++) { ctx.fillStyle = 'rgba(240,245,240,.35)'; ctx.beginPath(); ctx.ellipse((i * 260 + t * 15) % (W + 300) - 150, G - 20 - i * 25, 220, 22, 0, 0, Math.PI * 2); ctx.fill(); } },
        (ctx, t) => { ctx.fillStyle = '#3a5a3a'; ctx.beginPath(); ctx.ellipse(420, G + 44, 330, 36, 0, 0, Math.PI * 2); ctx.fill(); for (let i = 0; i < 14; i++) A.line(ctx, 120 + i * 45, G + 30, 122 + i * 45 + Math.sin(t + i) * 3, G - 10, '#5a8a3a', 2); },
        (ctx) => { ctx.lineCap = 'round'; for (let i = 0; i < 4; i++) { ctx.strokeStyle = '#120c0a'; ctx.lineWidth = 22; ctx.beginPath(); ctx.arc(200 + i * 160, G + 30, 70, Math.PI, 0); ctx.stroke(); ctx.strokeStyle = '#6b4424'; ctx.lineWidth = 16; ctx.stroke(); } },
        (ctx) => { for (const [x, h] of [[90, 140], [200, 80], [610, 160], [720, 60]]) { A.rrect(ctx, x - 22, G - h, 44, h, 2, '#a8a29a', 2.5); A.rrect(ctx, x - 28, G - h - 10, 56, 12, 2, '#bab4aa', 2); } A.rrect(ctx, 330, G - 14, 90, 16, 2, '#a8a29a', 2); },
        (ctx, t) => { for (let i = 0; i < 6; i++) { const a = Math.PI + (i / 5) * Math.PI, x = 400 + Math.cos(a) * 280, y = G + 10 + Math.sin(a) * 40; A.rrect(ctx, x - 16, y - 80, 32, 80, 6, '#8a8f96', 2.5); ctx.fillStyle = A.rgba('#9fe8ff', 0.4 + 0.3 * Math.sin(t * 2 + i)); ctx.fillRect(x - 4, y - 60, 8, 8); } }
      ],
      [ // Bois maudit
        (ctx) => { deadTree(ctx, 80, G, 1.3); deadTree(ctx, 680, G, 1.5); deadTree(ctx, 330, G, 0.8); },
        (ctx) => { for (const [x, y, r] of [[0, 0, 140], [W, 0, 120], [640, 120, 60]]) { ctx.strokeStyle = 'rgba(240,240,250,.7)'; ctx.lineWidth = 1.2; for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.stroke(); } for (let q = 1; q < 5; q++) { ctx.beginPath(); ctx.arc(x, y, (r * q) / 5, 0, Math.PI * 2); ctx.stroke(); } } },
        (ctx, t) => { for (let i = 0; i < 6; i++) { const x = 100 + i * 120 + Math.sin(t + i) * 20, y = 90 + Math.cos(t * 1.3 + i) * 30; glowAt(ctx, x, y, '#9fffd6', 18); A.circle(ctx, x, y, 5, '#e0fff2', 0.01); } },
        (ctx) => { for (const [x, h] of [[70, 50], [160, 40], [620, 56], [720, 44], [260, 34]]) { ctx.beginPath(); ctx.moveTo(x - 16, G + 6); ctx.lineTo(x - 16, G - h + 16); ctx.arc(x, G - h + 16, 16, Math.PI, 0); ctx.lineTo(x + 16, G + 6); ctx.closePath(); ctx.fillStyle = '#7a7880'; ctx.fill(); ctx.strokeStyle = '#120c0a'; ctx.lineWidth = 2.5; ctx.stroke(); A.line(ctx, x, G - h + 10, x, G - h + 30, '#4a4850', 2); A.line(ctx, x - 7, G - h + 17, x + 7, G - h + 17, '#4a4850', 2); } },
        (ctx) => { A.rrect(ctx, 500, G - 60, 280, 62, 30, '#5a3a22', 3); A.ellipse(ctx, 510, G - 29, 22, 28, '#1a120c', 2.5); },
        (ctx, t) => { A.rrect(ctx, 620, 40, 80, G - 40, 10, '#3a2a30', 3); glowAt(ctx, 660, 140, '#ff6aa8', 60 + Math.sin(t * 2) * 8); A.circle(ctx, 660, 140, 14, '#ff6aa8', 2); }
      ]
    ],
    champ: [
      [ // Champs ensoleillés
        (ctx, t, R) => { for (let i = 0; i < 7; i++) { const x = i * 120 + 40; A.ellipse(ctx, x, G - 20, 60, 34, '#3f8a3a', 2.5); for (let k = 0; k < 5; k++) A.circle(ctx, x - 40 + R() * 80, G - 36 + R() * 24, 3.5, '#3a2a6a', 1); } },
        (ctx) => { for (const x of [110, 640, 740]) { A.ellipse(ctx, x, G - 30, 46, 38, '#e8c46a', 2.5); ctx.strokeStyle = '#c9a04a'; ctx.lineWidth = 1.5; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(x + k * 12, G - 64); ctx.lineTo(x + k * 14, G + 4); ctx.stroke(); } } },
        (ctx, t) => { const x = 660; A.line(ctx, x, G, x, G - 130, '#6b4424', 5); A.line(ctx, x - 50, G - 90 + Math.sin(t) * 2, x + 50, G - 90 - Math.sin(t) * 2, '#6b4424', 4); A.rrect(ctx, x - 20, G - 100, 40, 46, 4, '#c0392b', 2.5); A.circle(ctx, x, G - 118, 15, '#e8c46a', 2); A.poly(ctx, [x - 24, G - 128, x + 24, G - 128, x, G - 150], '#8a5a2e', 2); },
        (ctx, t) => { A.poly(ctx, [600, G - 20, 620, G - 150, 660, G - 150, 680, G - 20], '#efe6d2', 2.5); for (let k = 0; k < 4; k++) { const a = t * 0.8 + (k * Math.PI) / 2; A.line(ctx, 640, G - 150, 640 + Math.cos(a) * 70, G - 150 + Math.sin(a) * 70, '#ffffff', 6); } A.circle(ctx, 640, G - 150, 6, '#8a5a2e', 2); },
        (ctx, t) => { for (const x of [600, 680]) { A.rrect(ctx, x - 22, G - 50, 44, 50, 6, '#e8b83a', 2.5); for (let k = 1; k < 4; k++) A.line(ctx, x - 20, G - 50 + k * 12, x + 20, G - 50 + k * 12, '#c99a24', 1.5); } for (let i = 0; i < 5; i++) { const x = 640 + Math.sin(t * 3 + i * 2) * 60, y = G - 90 + Math.cos(t * 4 + i) * 20; A.circle(ctx, x, y, 3, '#ffd23a', 1); } },
        (ctx, t, R) => { for (const x of [80, 260, 640]) { tree(ctx, x, G, 1, '#8a5a2e', '#5cb84a'); for (let k = 0; k < 5; k++) A.circle(ctx, x - 25 + R() * 50, G - 75 + R() * 30, 4, '#e2504c', 1); } }
      ],
      [ // Collines sauvages
        (ctx, t, R) => { for (let i = 0; i < 6; i++) { const x = 50 + i * 145; A.ellipse(ctx, x, G - 16, 50, 26, '#4f7a3a', 2.5); ctx.strokeStyle = '#2f4a22'; ctx.lineWidth = 1.5; for (let k = 0; k < 8; k++) { const a = R() * Math.PI; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 40, G - 16 - Math.sin(a) * 20); ctx.lineTo(x + Math.cos(a) * 52, G - 16 - Math.sin(a) * 30); ctx.stroke(); } } },
        (ctx, t, R) => { for (let i = 0; i < 5; i++) { const x = 60 + i * 170 + R() * 30; stone(ctx, x, G + 4, 70, 50 + R() * 30, '#8d8f96'); ctx.fillStyle = '#5cb84a'; ctx.beginPath(); ctx.ellipse(x - 6, G - 36, 22, 8, 0, 0, Math.PI * 2); ctx.fill(); } },
        (ctx, t, R) => { const cols = ['#ff9fd0', '#ffffff', '#ffd23a', '#c9a0ff', '#e2504c']; for (let i = 0; i < 60; i++) flower(ctx, R() * W, G + 6 + R() * (H - G - 10), cols[i % 5]); },
        (ctx, t) => { ctx.fillStyle = '#6fc6ef'; ctx.fillRect(0, G + 30, W, 30); A.rrect(ctx, 250, G + 18, 300, 14, 3, '#a8703f', 2.5); for (let x = 260; x < 550; x += 40) A.rrect(ctx, x, G + 30, 8, 30, 1, '#6b4424', 1.5); },
        (ctx) => { A.rrect(ctx, 560, G - 110, 180, 110, 4, '#9a3a32', 3); A.poly(ctx, [545, G - 108, 650, G - 180, 755, G - 108], '#5a3a32', 3); A.poly(ctx, [640, G - 108, 700, G - 60, 690, G - 108], '#2a1a16', 2); A.rrect(ctx, 620, G - 60, 50, 60, 2, '#4a2e18', 2.5); },
        (ctx) => { A.ellipse(ctx, 640, G - 10, 50, 16, '#8d8f96', 2.5); A.rrect(ctx, 590, G - 50, 100, 42, 4, '#9a9ca4', 2.5); A.ellipse(ctx, 640, G - 50, 50, 12, '#1a1a22', 2); A.line(ctx, 596, G - 50, 596, G - 110, '#6b4424', 4); A.line(ctx, 684, G - 50, 684, G - 110, '#6b4424', 4); A.poly(ctx, [580, G - 104, 640, G - 140, 700, G - 104], '#8a3a32', 2.5); }
      ],
      [ // Vallée crépusculaire
        (ctx) => { glowAt(ctx, 600, G - 30, '#ffd27a', 110); A.circle(ctx, 600, G - 30, 60, '#ffb24a', 2.5); },
        (ctx, t, R) => { for (let i = 0; i < 8; i++) { const x = 40 + i * 100 + R() * 20, y = G + 10 + R() * 40; A.ellipse(ctx, x, y, 22, 16, '#ff8a1a', 2.5); A.line(ctx, x, y - 16, x + 3, y - 24, '#3f7f2a', 3); } },
        (ctx, t, R) => { for (const x of [100, 680]) { A.circle(ctx, x, G - 60, 70, '#3f6a32', 3); for (let k = 0; k < 12; k++) A.circle(ctx, x - 50 + R() * 100, G - 100 + R() * 80, 5, k % 2 ? '#5a4fd6' : '#c0306a', 1.2); } },
        (ctx) => { A.rrect(ctx, 600, G - 190, 90, 190, 4, '#7a7470', 3); A.poly(ctx, [600, G - 190, 620, G - 210, 640, G - 196, 660, G - 214, 690, G - 190], '#7a7470', 2.5); A.rrect(ctx, 632, G - 140, 20, 30, 8, '#1a1418', 2); },
        (ctx, t) => { for (let i = 0; i < 14; i++) { const x = (i * 63 + Math.sin(t + i) * 30) % W, y = 60 + ((i * 37) % (G - 80)) + Math.cos(t * 1.4 + i) * 12; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 4 + i); glowAt(ctx, x, y, '#eaff7a', 8); ctx.globalAlpha = 1; } },
        (ctx, t) => { A.rrect(ctx, 590, G - 60, 120, 60, 4, '#8a8f96', 3); A.rrect(ctx, 580, G - 70, 140, 14, 3, '#a6aab2', 2.5); for (const x of [610, 650, 690]) A.circle(ctx, x, G - 78, 7, ['#7a4fd6', '#a8703f', '#9aa3ae'][(x / 40) % 3 | 0], 1.6); glowAt(ctx, 650, G - 90, '#ffd27a', 40 + Math.sin(t * 2) * 6); }
      ]
    ]
  };

  // ouverture de l'onglet
  window.MiniGames = { open: load, drawScene };
})();
