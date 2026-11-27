/* Onglet « Bastion » : défense de tour solo sur une carte en cases, générée au hasard à chaque partie.
 * La page joue (shared/bastion.js) : les actions de construction sont appliquées tout de suite et envoyées au serveur,
 * qui applique les mêmes ; chaque vague est rejouée par le serveur (capacités comprises) et son résultat fait foi.
 * Commandes : clic sur une case = construire / défricher / voir un bâtiment · Espace = lancer la vague (ou pause)
 * · 1, 2, 3 = vitesse · Z = afficher toutes les zones d'attaque · Échap = annuler. Sur téléphone : toucher. */
(function () {
  'use strict';
  const GD = window.GameData, B = GD.BASTION, BS = window.Bastion, A = window.Art, BA = window.BastionArt;
  const { api, $, el, toast, ask } = window.UI;
  const CELL = BA.CELL, COLS = B.COLS, ROWS = B.ROWS, DT = B.TICK, OL = '#120c0a', TAU = Math.PI * 2;
  const MW = COLS * CELL, MH = ROWS * CELL, FONT = 'Nunito, system-ui, sans-serif';

  let S = null;        // état du serveur (accueil, plans, partie)
  let V = null;        // partie affichée
  let busy = false, ladder = null, ladderZone = 'mine', atelierCat = 'attaque';
  let queue = Promise.resolve(); // requêtes envoyées une par une, dans l'ordre
  const enqueue = (fn) => (queue = queue.then(fn).catch((e) => console.warn('Bastion', e)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (v) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1).replace('.', ','));
  const pct = (v) => `${Math.round(v * 100)} %`;
  const resIcon = (k) => B.RES[k].icon;
  const costText = (cost) => GD.bastionCostText(cost);
  const visible = () => { const v = $('[data-view="bastion"]'); return v && !v.classList.contains('hidden'); };

  /* ============================== Sons (synthétisés) ============================== */
  const Sound = (() => {
    let ac = null, muted = false;
    const last = {};
    try { muted = localStorage.getItem('bastionMute') === '1'; } catch (e) { /* stockage indisponible */ }
    function audio() {
      if (muted) return null;
      if (!ac) { const Ctor = window.AudioContext || window.webkitAudioContext; if (!Ctor) return null; ac = new Ctor(); }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(c, f, dur, type, vol, when, slide) {
      const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + (when || 0);
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function noise(c, dur, vol, when, freq, type) {
      const n = Math.max(1, Math.floor(c.sampleRate * dur)), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t0 = c.currentTime + (when || 0);
      s.buffer = buf; f.type = type || 'bandpass'; f.frequency.value = freq || 1000; g.gain.value = vol;
      s.connect(f).connect(g).connect(c.destination); s.start(t0);
    }
    const SFX = {
      arrow: (c) => { noise(c, 0.06, 0.12, 0, 3200, 'highpass'); tone(c, 700, 0.06, 'triangle', 0.03, 0, -300); },
      rock: (c) => { noise(c, 0.12, 0.18, 0, 400, 'lowpass'); },
      orb: (c) => { tone(c, 660, 0.14, 'sine', 0.05, 0, 440); },
      bolt: (c) => { noise(c, 0.05, 0.08, 0, 2400, 'highpass'); },
      boom: (c) => { tone(c, 90, 0.25, 'sine', 0.22, 0, -40); noise(c, 0.25, 0.25, 0, 500, 'lowpass'); },
      kill: (c) => { tone(c, 420, 0.1, 'square', 0.03, 0, -200); tone(c, 1320, 0.08, 'triangle', 0.03, 0.03); },
      leak: (c) => { tone(c, 160, 0.35, 'sawtooth', 0.1, 0, -60); noise(c, 0.3, 0.2, 0, 300, 'lowpass'); },
      build: (c) => { noise(c, 0.08, 0.25, 0, 900, 'bandpass'); noise(c, 0.08, 0.2, 0.09, 700, 'bandpass'); tone(c, 330, 0.12, 'triangle', 0.06, 0.05); },
      upgrade: (c) => { [523, 659, 784].forEach((f, i) => tone(c, f, 0.16, 'triangle', 0.07, i * 0.06)); },
      sell: (c) => { [784, 659, 523].forEach((f, i) => tone(c, f, 0.12, 'triangle', 0.05, i * 0.05)); },
      clear: (c) => { noise(c, 0.2, 0.25, 0, 700, 'bandpass'); tone(c, 200, 0.15, 'square', 0.04, 0.05, -80); },
      wave: (c) => { [392, 392, 523].forEach((f, i) => tone(c, f, 0.22, 'square', 0.05, i * 0.16)); },
      boss: (c) => { [110, 104, 98].forEach((f, i) => tone(c, f, 0.4, 'sawtooth', 0.1, i * 0.22)); noise(c, 0.6, 0.12, 0, 300, 'lowpass'); },
      end: (c) => { [523, 659, 784, 1046].forEach((f, i) => tone(c, f, 0.22, 'triangle', 0.07, i * 0.08)); },
      lose: (c) => { [392, 330, 262, 196].forEach((f, i) => tone(c, f, 0.35, 'triangle', 0.08, i * 0.18)); },
      abil: (c) => { tone(c, 330, 0.35, 'sawtooth', 0.06, 0, 660); noise(c, 0.3, 0.2, 0.05, 1200, 'bandpass'); },
      error: (c) => { tone(c, 180, 0.15, 'square', 0.05); }
    };
    return {
      play(name) {
        const now = performance.now();
        if (last[name] && now - last[name] < 45) return;
        last[name] = now;
        const c = audio();
        if (c && SFX[name]) try { SFX[name](c); } catch (e) { /* audio indisponible */ }
      },
      toggle() { muted = !muted; try { localStorage.setItem('bastionMute', muted ? '1' : '0'); } catch (e) { /* */ } return muted; },
      get muted() { return muted; }
    };
  })();

  /* ============================== Chargement et synchronisation ============================== */
  async function load() {
    try { const r = await api('/api/bastion'); S = r.bastion; render(); }
    catch (e) { const root = $('#bastionRoot'); if (root) root.replaceChildren(el('div', { class: 'panel error' }, e.message)); }
  }
  const runKey = (run) => run.zone + ':' + run.G.seed;
  // Réponse complète du serveur (accueil, fin de vague, fin de partie)
  function applyState(st, user, checkSync) {
    S = st;
    if (user && window.PlayerApp) window.PlayerApp.setUser(user);
    const run = S.run;
    if (!run || !V || V.key !== runKey(run)) { render(); return; }
    // nouvelles entrées du journal (gardien vaincu, œuf, remboursement, victoire)
    for (const line of run.log.slice(V.logSeen)) toast(line);
    V.logSeen = run.log.length;
    if (run.G.phase !== 'wave') {
      const mine = V.G;
      V.G = BS.clone(run.G);
      for (const op of V.pending) BS.act(V.G, op); // actions pas encore envoyées
      if (checkSync && !V.pending.length && JSON.stringify(mine) !== JSON.stringify(V.G)) console.warn('Bastion : état local différent de celui du serveur, resynchronisé');
      V.acked = run.nops;
    }
    V.staticKey = ''; hudCache = '';
    const ab = $('#bsAtelierBtn'); if (ab) ab.textContent = `📜 ${S.plans}`;
    if (run.over) { showOver(); return; }
    if (run.G.phase === 'won') showWon();
    renderPanel(); renderBars();
  }
  function failSync(e) {
    toast(e.message || 'Erreur');
    Sound.play('error');
    if (e.data && e.data.bastion) { S = e.data.bastion; V = null; render(); } else load();
  }
  async function send(path, body) {
    if (busy) return;
    busy = true;
    try { const r = await api(path, { body }); busy = false; applyState(r.bastion, r.user); }
    catch (e) { busy = false; toast(e.message); if (e.data && e.data.bastion) { S = e.data.bastion; render(); } }
  }

  /* ============================== Rendu de l'onglet ============================== */
  function render() {
    const root = $('#bastionRoot');
    if (!root || !S) return;
    const run = S.run;
    if (run) {
      if (!V || V.key !== runKey(run)) startView(run);
      root.replaceChildren(gameView());
      hudCache = '';
      fitCanvas();
      if (!V.raf) V.raf = requestAnimationFrame(loop);
      renderPanel(); renderBars();
      if (run.over) showOver(); else if (run.G.phase === 'won') showWon();
    } else {
      V = null;
      root.replaceChildren(lobby());
      if (!ladder) loadLadder();
    }
  }

  /* ------------------------------ accueil ------------------------------ */
  const thumbs = {};
  function thumbCanvas(zone) {
    const c = el('canvas', { class: 'bs-thumb', width: 480, height: 270 });
    requestAnimationFrame(() => {
      if (!thumbs[zone]) {
        const map = BS.genMap(zone, 20240 + zone.length), G = { zone, cells: map.cells, path: map.path, castle: { ...map.castle, lvl: 2, hp: B.CASTLE.hp[1] }, b: [] };
        const cv = document.createElement('canvas'); cv.width = MW; cv.height = MH;
        const x = cv.getContext('2d');
        BA.drawGround(x, G);
        const items = [];
        for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) { const v = G.cells[r * COLS + cc]; if (v >= 2 && v <= 4) items.push([r, () => BA.drawObstacle(x, v, cc, r, zone)]); }
        items.push([G.castle.r + 1, () => BA.drawCastle(x, G, 0)]);
        // quelques bâtiments et monstres pour l'ambiance
        const demo = [['archers', 2], ['mage', 3], ['catapulte', 1], ['marche', 2]];
        let k = 0;
        for (const [pc, pr] of G.path.slice(6)) for (const [dc, dr] of [[0, -1], [0, 1]]) {
          const cc = pc + dc, rr = pr + dr;
          if (k >= demo.length || BS.cellAt(G, cc, rr) !== 0 || G.b.some((b) => b.c === cc && b.r === rr) || (k && Math.abs(cc - G.b[k - 1].c) < 3)) continue;
          const b = { id: k, t: demo[k][0], c: cc, r: rr, lvl: demo[k][1], spec: null };
          G.b.push(b); items.push([rr, () => BA.drawBuilding(x, b, 0)]); k++;
        }
        const geo = BS.geo(G), mobs = B.ZONES[zone].roster;
        [mobs.normal[0], mobs.rapide[0], (mobs.volant || mobs.blinde)[0]].forEach((mk, i) => {
          const m = { d: 3 + i * 1.6, fly: false, seg: 0 }; BS.place(geo, m);
          items.push([m.y, () => A.drawMob(x, mk, m.x * CELL, m.y * CELL + 14, { size: A.mobFit(mk, 44, 50), t: 0.4 + i, facing: 0 })]);
        });
        items.sort((a, b2) => a[0] - b2[0]).forEach((it) => it[1]());
        thumbs[zone] = cv;
      }
      c.getContext('2d').drawImage(thumbs[zone], 0, 0, 480, 270);
    });
    return c;
  }

  function lobby() {
    const hail = '🌨️';
    const cards = Object.entries(B.ZONES).map(([k, Z]) => {
      const open = S.open[k], best = S.best[k] || 0, wins = S.wins[k] || 0;
      const roles = Object.keys(Z.roster).map((r) => B.ROLES[r].icon + ' ' + B.ROLES[r].name.toLowerCase()).join(', ');
      return el('div', { class: 'panel bs-card' + (open ? '' : ' locked') },
        thumbCanvas(k),
        el('h3', {}, `${Z.icon} ${Z.name}`),
        el('p', { class: 'small' }, Z.desc),
        el('p', { class: 'small muted' }, `Monstres : ${roles}. Gardiens aux manches 10, 20 et 30.`),
        el('p', { class: 'small' }, `🏆 Record : ${best ? `${best} manche${best > 1 ? 's' : ''}` : '—'} · victoires : ${wins}${Z.xp > 1 ? ` · XP ×${String(Z.xp).replace('.', ',')}` : ''}`),
        open ? el('button', { class: 'primary', disabled: busy || (S.gold || 0) < B.PRICE, onclick: () => startGame(k) }, `Lancer une partie (${B.PRICE} ${hail})`)
          : el('p', { class: 'small bs-lock' }, `🔒 Gagne une partie dans la zone « ${B.ZONES[Z.unlock].name} » pour débloquer cette zone.`));
    });
    return el('div', {},
      el('div', { class: 'panel bs-head' },
        el('div', {}, el('h2', { style: 'margin:0' }, '🏰 Bastion'), el('p', { class: 'small muted', style: 'margin:4px 0 0' }, 'Défense de tour solo : une carte différente à chaque partie, des bâtiments à placer, améliorer et combiner entre les vagues.')),
        el('div', { class: 'mini-res' },
          el('span', { class: 'chip gold' }, `${hail} ${S.gold} Grêlons`),
          el('span', { class: 'chip' }, `📜 ${S.plans} plan${S.plans > 1 ? 's' : ''}`),
          el('span', { class: 'chip' }, `🎮 ${S.games} partie${S.games > 1 ? 's' : ''}`))),
      el('div', { class: 'grid three' }, ...cards),
      atelier(),
      el('div', { class: 'panel' }, el('h2', {}, '🏆 Meilleurs bastions'), el('nav', { class: 'tabs', id: 'bsLadderTabs' }), el('div', { class: 'table-wrap' }, el('table', { id: 'bsLadder' }))),
      rulesPanel());
  }
  async function startGame(zone) {
    if (busy) return;
    if (!(await ask(`Une partie coûte ${B.PRICE} Grêlons (remboursés si tu atteins la manche ${B.REFUND_WAVE}). Lancer une partie dans la zone « ${B.ZONES[zone].name} » ?`, { title: '🏰 Nouvelle partie', ok: 'C’est parti !' }))) return;
    Sound.play('wave');
    send('/api/bastion/start', { zone });
  }

  // Atelier des plans : débloquer des bâtiments et des spécialisations
  function atelier() {
    const cats = Object.entries(B.CATS);
    const tabs = el('nav', { class: 'tabs' }, ...cats.map(([k, c]) => el('button', { class: atelierCat === k ? 'active' : '', onclick: () => { atelierCat = k; refreshAtelier(); } }, `${c.icon} ${c.name}`)));
    const unlocked = (key) => !GD.bastionPlanCost(key) || S.unlocked.includes(key);
    const list = Object.entries(B.BUILDINGS).filter(([, T]) => T.cat === atelierCat).map(([t, T]) => {
      const own = unlocked(t);
      const status = !T.plan ? el('span', { class: 'chip ok' }, 'De base') : own ? el('span', { class: 'chip ok' }, '✓ Débloqué')
        : el('button', { class: 'small primary', disabled: busy || S.plans < T.plan, onclick: () => unlockKey(t) }, `Débloquer (${T.plan} 📜)`);
      const specs = Object.entries(T.specs).map(([s, sp]) => {
        const key = `${t}/${s}`, have = S.unlocked.includes(key);
        return el('div', { class: 'bs-spec' + (have ? ' on' : '') },
          el('span', {}, `${sp.icon} `, el('b', {}, sp.name), el('span', { class: 'small muted' }, ` — ${sp.desc}`)),
          have ? el('span', { class: 'chip ok small' }, '✓') : el('button', { class: 'small', disabled: busy || !own || S.plans < 1, title: own ? '' : 'Débloque d’abord le bâtiment', onclick: () => unlockKey(key) }, '1 📜'));
      });
      return el('div', { class: 'bs-atelier-item' + (own ? '' : ' locked') },
        el('div', { class: 'bs-atelier-top' }, BA.iconCanvas(t, 3, null, 56), el('div', { class: 'bs-atelier-txt' }, el('b', {}, `${T.icon} ${T.name}`), el('div', { class: 'small muted' }, T.desc)), status),
        el('div', { class: 'small muted' }, 'Spécialisations (niveau 4, tour principale niveau 3) :'), ...specs);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'row' }, el('h2', { style: 'margin:0' }, '📜 Atelier des plans'), el('span', { class: 'spacer' }), el('span', { class: 'chip' }, `📜 ${S.plans} plan${S.plans > 1 ? 's' : ''} · ${S.plansTotal} gagné${S.plansTotal > 1 ? 's' : ''} en tout`)),
      el('p', { class: 'small muted' }, `Les plans se gagnent au Bastion : ${B.PLANS.boss.mine} par gardien vaincu (manches 10, 20, 30… ; ${B.PLANS.boss.champ} dans la clairière) et ${B.PLANS.firstWin} pour la première victoire dans une zone. Un bâtiment débloqué l’est pour toutes les parties, même celle en cours.`),
      tabs, el('div', { class: 'bs-atelier' }, ...list));
  }

  // l'atelier est affiché à l'accueil, ou par-dessus la carte pendant une partie
  function refreshAtelier() { if (V && $('#bsOverlay') && !$('#bsOverlay').classList.contains('hidden') && V.atelier) openAtelier(); else render(); }
  function openAtelier() {
    if (!V) return;
    V.atelier = true;
    overlay([atelier(), el('div', { class: 'mini-panel-btns' }, el('span', { class: 'spacer' }), el('button', { class: 'primary', onclick: () => { V.atelier = false; $('#bsOverlay').classList.add('hidden'); renderPanel(); } }, 'Fermer'))], true);
  }
  function unlockKey(key) {
    if (busy) return;
    busy = true;
    if (V) { clearTimeout(flushTimer); enqueue(flushOps); }
    enqueue(async () => {
      try {
        const r = await api('/api/bastion/unlock', { body: { key } });
        busy = false;
        S = r.bastion;
        if (r.user && window.PlayerApp) window.PlayerApp.setUser(r.user);
        if (V && S.run) V.G.unlocked = S.run.G.unlocked.slice();
        toast('📜 Débloqué !'); Sound.play('upgrade');
        if (V && V.atelier) { openAtelier(); const btn = $('#bsAtelierBtn'); if (btn) btn.textContent = `📜 ${S.plans}`; renderPanel(); }
        else render();
      } catch (e) { busy = false; toast(e.message); }
    });
  }

  async function loadLadder() {
    try { ladder = (await api('/api/bastion/ladder')).ladder; renderLadder(); } catch (e) { /* hors ligne */ }
  }
  function renderLadder() {
    const tabs = $('#bsLadderTabs'), table = $('#bsLadder');
    if (!tabs || !table || !ladder) return;
    tabs.replaceChildren(...Object.entries(B.ZONES).map(([k, Z]) => el('button', { class: ladderZone === k ? 'active' : '', onclick: () => { ladderZone = k; renderLadder(); } }, `${Z.icon} ${Z.name}`)));
    const rows = ladder[ladderZone] || [];
    table.replaceChildren(el('tr', {}, el('th', {}, '#'), el('th', {}, 'Joueur'), el('th', {}, 'Manches survécues'), el('th', {}, 'Victoires')),
      ...(rows.length ? rows.map((r, i) => el('tr', {}, el('td', {}, String(i + 1)), el('td', {}, r.pseudo, r.title ? el('span', { class: 'small muted' }, ` « ${r.title} »`) : ''), el('td', {}, String(r.wave)), el('td', {}, String(r.wins))))
        : [el('tr', {}, el('td', { colspan: 4, class: 'muted' }, 'Personne n’a encore défendu cette zone.'))]));
  }

  function rulesPanel() {
    return el('div', { class: 'panel small' }, el('h2', {}, 'Comment ça marche'),
      el('ul', {},
        el('li', {}, `Une partie coûte ${B.PRICE} Grêlons ; atteindre la manche ${B.REFUND_WAVE} (survivre aux ${B.REFUND_WAVE - 1} premières) les rembourse. Survivre à la manche ${B.WIN_WAVE}, c’est la victoire : la zone suivante se débloque, et tu peux continuer en mode infini.`),
        el('li', {}, 'La carte est tirée au hasard à chaque partie : un chemin mène de l’entrée (à gauche) à ta tour principale (à droite), entouré d’herbe, d’arbres, de rochers et de filons d’or.'),
        el('li', {}, 'Entre deux vagues, prends tout ton temps : construis, améliore (3 niveaux, puis une spécialisation au choix), vends (remboursé en entier tant que la vague suivante n’a pas commencé, 70 % ensuite), défriche un arbre ou un rocher (contre de l’or) et améliore la tour principale : plus de PV, un tir plus fort, un territoire plus grand, des bâtiments de plus haut niveau et des capacités à lancer pendant les vagues.'),
        el('li', {}, 'Les bâtiments d’attaque frappent dans leur zone d’attaque (affichée quand tu les choisis). Les bâtiments de support ralentissent, révèlent les camouflés, bloquent le chemin ou soignent ; la production donne du bois et de la pierre, la richesse de l’or, après chaque vague.'),
        el('li', {}, 'Synergies : deux bâtiments qui se touchent (côté commun) se renforcent — bannière et phare pour les tours voisines, scierie et arbres, carrière et rochers, marché entouré de commerces, fermes et tavernes pour les casernes… Les liens actifs sont affichés sur la carte.'),
        el('li', {}, 'Monstres : normaux, rapides, blindés (armure : la magie l’ignore), volants (droit vers la tour, hors de portée des catapultes), séparateurs, soigneurs et camouflés (il faut un phare). Un gardien toutes les 10 manches. Chaque monstre qui atteint la tour lui fait perdre des PV.'),
        el('li', {}, `Récompenses : de l’XP pour ton héros à chaque manche gagnée (versée en fin de partie), des plans pour l’atelier et parfois un œuf de familier (${Math.round(B.EGG_CHANCE * 100)} %) à chaque gardien vaincu. Les ressources de la partie (or, bois, pierre) disparaissent à la fin : le Bastion ne rapporte pas de ressources des mini-jeux.`),
        el('li', {}, 'Commandes : clic sur une case · Espace : lancer la vague (pendant une vague : pause) · 1, 2, 3 : vitesse · Z : afficher toutes les zones d’attaque · Échap : annuler.')));
  }

  /* ------------------------------ vue de la partie ------------------------------ */
  function startView(run) {
    V = {
      key: runKey(run), G: BS.clone(run.G), acked: run.nops, pending: [], speed: V ? V.speed : 1, paused: false,
      sel: null, hover: null, targeting: null, abilQueue: [], ev: [], fx: [], texts: [], prev: new Map(), prevP: new Map(), face: new Map(), projStart: new Map(),
      acc: 0, t: 0, last: 0, shake: 0, banner: null, ending: false, zones: false, logSeen: run.log.length, staticKey: '', raf: 0, panelKey: ''
    };
    if (V.G.phase === 'wave') resumeWave(run);
  }
  // Partie reprise pendant une vague : la vague est rejouée jusqu'au moment où elle en était (capacités comprises)
  function resumeWave(run) {
    const abil = run.abil || [];
    const target = Math.max(abil.length ? abil[abil.length - 1][3] : 0, Math.floor(run.elapsed / 1000 / DT));
    let ai = 0;
    while (V.G.phase === 'wave' && V.G.W.tick < target) {
      while (ai < abil.length && abil[ai][3] === V.G.W.tick) { const a = abil[ai++]; BS.useAbility(V.G, a[0], a[1], a[2]); }
      BS.step(V.G);
    }
    if (V.G.phase !== 'wave') onWaveEnd();
    else toast('Vague reprise');
  }

  function gameView() {
    const run = S.run, Z = B.ZONES[run.zone];
    const canvas = el('canvas', { class: 'bs-canvas', width: MW, height: MH });
    V.canvas = canvas; V.ctx = canvas.getContext('2d');
    canvas.addEventListener('mousemove', (e) => { V.hover = cellFromEvent(e); V.mouse = posFromEvent(e); });
    canvas.addEventListener('mouseleave', () => { V.hover = null; V.mouse = null; });
    canvas.addEventListener('click', (e) => onCellClick(cellFromEvent(e)));
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); });
    const top = el('div', { class: 'bs-top' },
      el('b', { class: 'bs-zone' }, `${Z.icon} ${Z.name}`),
      el('span', { class: 'chip', id: 'bsWave' }), el('span', { class: 'chip gold', id: 'bsOr' }), el('span', { class: 'chip', id: 'bsBois' }), el('span', { class: 'chip', id: 'bsPierre' }),
      el('div', { class: 'bs-hp' }, el('span', { class: 'small' }, '🏰'), el('div', { class: 'bar' }, el('span', { id: 'bsHpBar' }), el('div', { class: 'label', id: 'bsHpLabel' }))),
      el('span', { class: 'spacer' }),
      el('button', { class: 'small', title: 'Afficher toutes les zones d’attaque (Z)', onclick: () => { V.zones = !V.zones; renderBars(); }, id: 'bsZonesBtn' }, '👁️ Zones'),
      el('button', { class: 'small', title: 'Atelier : débloquer des bâtiments avec tes plans', onclick: openAtelier, id: 'bsAtelierBtn' }, `📜 ${S.plans}`),
      el('button', { class: 'small', title: 'Son', id: 'bsMute', onclick: () => { Sound.toggle(); renderBars(); } }, Sound.muted ? '🔇' : '🔊'),
      el('button', { class: 'small', title: 'Abandonner la partie', onclick: abandon }, '🏳️'));
    const bottom = el('div', { class: 'bs-bottom', id: 'bsBottom' });
    return el('div', { class: 'bs-game' },
      el('div', { class: 'panel bs-wrap' }, top,
        el('div', { class: 'bs-stage' }, canvas, el('div', { class: 'bs-panel', id: 'bsPanel' }), el('div', { class: 'mini-overlay hidden', id: 'bsOverlay' })),
        bottom));
  }
  function fitCanvas() { /* la taille d’affichage suit le CSS (16:9) */ }
  function posFromEvent(e) {
    const r = V.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * MW, y: ((e.clientY - r.top) / r.height) * MH };
  }
  function cellFromEvent(e) {
    const p = posFromEvent(e);
    const c = Math.floor(p.x / CELL), r = Math.floor(p.y / CELL);
    return BS.inside(c, r) ? { c, r } : null;
  }
  const isCastle = (G, c, r) => c >= G.castle.c && c <= G.castle.c + 1 && r >= G.castle.r && r <= G.castle.r + 1;

  function onCellClick(cell) {
    if (!V || !cell) return;
    const G = V.G;
    if (V.targeting) { // capacité visée
      V.abilQueue.push({ id: V.targeting, c: cell.c, r: cell.r });
      V.targeting = null; renderBars(); return;
    }
    const b = BS.bAt(G, cell.c, cell.r);
    if (isCastle(G, cell.c, cell.r)) V.sel = { kind: 'castle' };
    else if (b) V.sel = { kind: 'b', id: b.id };
    else V.sel = { kind: 'cell', c: cell.c, r: cell.r, build: V.sel && V.sel.kind === 'cell' && V.sel.c === cell.c && V.sel.r === cell.r ? V.sel.build : null };
    renderPanel();
  }
  function cancel() {
    if (!V) return;
    if (V.targeting) { V.targeting = null; renderBars(); return; }
    V.sel = null; renderPanel();
  }

  /* ------------------------------ actions ------------------------------ */
  let flushTimer = 0;
  function doOp(op, sound) {
    if (!V) return false;
    if (V.ending) { toast('Validation de la manche en cours…'); return false; }
    const err = BS.act(V.G, op);
    if (err) { toast(err); Sound.play('error'); return false; }
    V.pending.push(op);
    clearTimeout(flushTimer); flushTimer = setTimeout(() => enqueue(flushOps), 350);
    Sound.play(sound || 'build');
    V.staticKey = '';
    renderPanel(); renderBars();
    return true;
  }
  async function flushOps() {
    if (!V || !V.pending.length) return;
    const v = V, ops = v.pending.splice(0), from = v.acked;
    try { const r = await api('/api/bastion/act', { body: { action: 'ops', from, ops } }); if (V === v) v.acked = r.nops; }
    catch (e) { if (V === v) failSync(e); }
  }
  function launchWave() {
    if (!V || V.G.phase !== 'build' || V.ending) return;
    clearTimeout(flushTimer);
    const v = V, ops = v.pending.splice(0);
    const err = BS.launch(v.G);
    if (err) { toast(err); return; }
    v.acc = 0; v.paused = false; v.sel = v.sel && v.sel.kind === 'cell' ? null : v.sel;
    const boss = v.G.W.q.some((s) => s.role === 'boss');
    v.banner = { text: `Manche ${v.G.W.w}${boss ? ' — un gardien approche !' : ''}`, t0: v.t, boss };
    Sound.play(boss ? 'boss' : 'wave');
    enqueue(async () => { try { const r = await api('/api/bastion/act', { body: { action: 'launch', from: v.acked, ops } }); if (V === v) v.acked = r.nops; } catch (e) { if (V === v) failSync(e); } });
    renderPanel(); renderBars();
  }
  function sendAbility(a) {
    const v = V;
    enqueue(async () => { try { await api('/api/bastion/act', { body: { action: 'ability', a } }); } catch (e) { if (V === v) toast(e.message); } });
  }
  // Fin de la vague dans la page : le serveur la rejoue et renvoie le résultat officiel
  function onWaveEnd() {
    const v = V;
    if (!v || v.ending) return;
    v.ending = true;
    const G = v.G;
    if (G.phase === 'over') { Sound.play('lose'); v.shake = 1.5; }
    else {
      Sound.play('end');
      const L = G.last;
      if (L) v.banner = { text: `Manche ${L.w} gagnée !`, sub: `+${L.gold + (L.inc ? L.inc.or : 0)} 🪙${L.inc && L.inc.bois ? ` · +${L.inc.bois} 🪵` : ''}${L.inc && L.inc.pierre ? ` · +${L.inc.pierre} 🪨` : ''}${L.heal > 0 ? ` · +${L.heal} PV` : ''}`, t0: v.t };
    }
    renderPanel(); renderBars();
    enqueue(async () => {
      for (;;) {
        try {
          const r = await api('/api/bastion/act', { body: { action: 'end' } });
          if (V !== v) return;
          v.ending = false;
          applyState(r.bastion, r.user, true);
          return;
        } catch (e) {
          if (e.status === 409 && e.data && e.data.wait) { await sleep(Math.min(6000, e.data.wait + 250)); continue; }
          if (V === v) { v.ending = false; failSync(e); }
          return;
        }
      }
    });
  }
  async function abandon() {
    if (!V || !S.run || S.run.over) return;
    const inf = V.G.infinite;
    if (!(await ask(inf ? 'Terminer la partie (mode infini) ? Tes récompenses sont gardées.' : 'Abandonner la partie ? Les manches déjà gagnées comptent (XP, record) ; une vague en cours est perdue.', { title: inf ? '🏁 Terminer' : '🏳️ Abandonner', ok: inf ? 'Terminer' : 'Abandonner', danger: !inf }))) return;
    clearTimeout(flushTimer);
    enqueue(flushOps);
    await queue;
    send('/api/bastion/act', { action: 'abandon' });
  }

  /* ------------------------------ boucle ------------------------------ */
  function loop(now) {
    if (!V || !V.canvas || !V.canvas.isConnected) { if (V) V.raf = 0; return; }
    // onglet caché : la partie se met en pause
    if (!visible()) { V.last = now; V.raf = requestAnimationFrame(loop); return; }
    const dt = Math.min(0.1, V.last ? (now - V.last) / 1000 : 0);
    V.last = now; V.t += dt;
    const G = V.G;
    if (G.phase === 'wave' && !V.paused && !V.ending) {
      V.acc += dt * V.speed;
      let n = 0;
      while (V.acc >= DT && G.phase === 'wave' && n++ < 16) { tick(); V.acc -= DT; }
      if (G.phase !== 'wave') onWaveEnd();
    }
    V.shake = Math.max(0, V.shake - dt * 2);
    draw();
    hud();
    V.raf = requestAnimationFrame(loop);
  }
  function tick() {
    const G = V.G, W = G.W;
    V.prev = new Map(W.mobs.map((m) => [m.id, [m.x, m.y]]));
    V.prevP = new Map(W.proj.map((p) => [p.id, [p.x, p.y]]));
    for (const q of V.abilQueue.splice(0)) {
      const tickNo = W.tick, err = BS.useAbility(G, q.id, q.c, q.r, V.ev);
      if (err) { toast(err); Sound.play('error'); } else { sendAbility([q.id, q.c, q.r, tickNo]); Sound.play('abil'); }
    }
    BS.step(G, V.ev);
    for (const e of V.ev) onEvent(e);
    V.ev.length = 0;
  }
  // Effets visuels et sons des événements de la simulation
  function onEvent(e) {
    const t = V.t, X = (v) => v * CELL;
    switch (e[0]) {
      case 'shot': Sound.play(e[2] === 'rock' ? 'rock' : e[2] === 'orb' ? 'orb' : e[2] === 'bolt' ? 'bolt' : 'arrow'); break;
      case 'boom': V.fx.push({ k: 'boom', x: X(e[1]), y: X(e[2]), r: X(e[3]), t0: t, dur: 0.45 }); Sound.play('boom'); break;
      case 'hit': if (e[4]) V.texts.push({ text: 'Critique !', x: X(e[1]), y: X(e[2]) - 30, col: '#ffd34d', t0: t, dur: 0.8 }); V.fx.push({ k: 'spark', x: X(e[1]), y: X(e[2]), t0: t, dur: 0.2, col: e[3] === 'orb' ? '#c9a8ff' : '#fff8e8' }); break;
      case 'chain': V.fx.push({ k: 'chain', x: X(e[1]), y: X(e[2]), x2: X(e[3]), y2: X(e[4]), t0: t, dur: 0.25 }); break;
      case 'kill': V.fx.push({ k: 'puff', x: X(e[2]), y: X(e[3]), t0: t, dur: 0.4, big: e[6] }); V.texts.push({ text: `+${e[4]} 🪙`, x: X(e[2]), y: X(e[3]) - 26, col: '#ffd34d', t0: t, dur: 0.9 }); Sound.play('kill'); if (e[6]) { V.banner = { text: 'Gardien vaincu !', t0: t }; Sound.play('end'); } break;
      case 'leak': V.shake = Math.min(1.5, V.shake + 0.5); V.texts.push({ text: `−${e[2]} PV`, x: (V.G.castle.c + 1) * CELL, y: V.G.castle.r * CELL + 20, col: '#ff6a5a', t0: t, dur: 1.1 }); Sound.play('leak'); break;
      case 'heal': V.fx.push({ k: 'ring', x: X(e[1]), y: X(e[2]), r: 1.5 * CELL, col: '#7cff8a', t0: t, dur: 0.5 }); break;
      case 'stomp': V.fx.push({ k: 'ring', x: X(e[1]), y: X(e[2]), r: X(e[3]), col: '#d9a95f', t0: t, dur: 0.6, w: 6 }); Sound.play('boom'); break;
      case 'summon': V.fx.push({ k: 'ring', x: X(e[1]), y: X(e[2]), r: 0.9 * CELL, col: '#c26bff', t0: t, dur: 0.5 }); break;
      case 'rebirth': V.fx.push({ k: 'ring', x: X(e[1]), y: X(e[2]), r: 1.6 * CELL, col: '#ff7a1a', t0: t, dur: 0.8, w: 8 }); V.texts.push({ text: 'Renaissance !', x: X(e[1]), y: X(e[2]) - 50, col: '#ff7a1a', t0: t, dur: 1.4 }); break;
      case 'abil': V.fx.push({ k: 'abil', id: e[1], x: X(e[2]), y: X(e[3]), r: X(e[4]), t0: t, dur: e[1] === 'colere' ? 0.9 : 0.7 }); break;
      case 'bar': { const b = BS.byId(V.G, e[1]); if (b) V.texts.push({ text: 'Barricade détruite', x: X(b.c + 0.5), y: X(b.r), col: '#ff9a6a', t0: t, dur: 1.4 }); Sound.play('boom'); break; }
      case 'spawn': if (e[2]) { V.banner = { text: '👑 Le gardien arrive !', t0: t, boss: true }; Sound.play('boss'); } break;
      case 'enrage': V.banner = { text: 'Les monstres s’énervent !', t0: t }; break;
    }
  }

  /* ------------------------------ dessin ------------------------------ */
  let staticCv = null;
  function staticLayer() {
    const G = V.G, key = G.cells.join('') + ':' + G.castle.lvl + ':' + G.zone;
    if (staticCv && V.staticKey === key) return staticCv;
    V.staticKey = key;
    staticCv = staticCv || document.createElement('canvas');
    staticCv.width = MW; staticCv.height = MH;
    const x = staticCv.getContext('2d');
    BA.drawGround(x, G);
    // hors du territoire : assombri et hachuré, bordure dorée
    const inT = (c, r) => BS.inside(c, r) && BS.inTerritory(G, c, r);
    x.save();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (inT(c, r)) continue;
      const onPath = G.cells[r * COLS + c] === BS.CHEMIN;
      x.fillStyle = onPath ? 'rgba(28,20,40,.14)' : 'rgba(28,20,40,.26)'; x.fillRect(c * CELL, r * CELL, CELL, CELL);
      if (onPath) continue;
      x.save(); x.beginPath(); x.rect(c * CELL, r * CELL, CELL, CELL); x.clip();
      x.strokeStyle = 'rgba(28,20,40,.16)'; x.lineWidth = 3;
      for (let k = -CELL; k < CELL; k += 16) { x.beginPath(); x.moveTo(c * CELL + k, r * CELL + CELL); x.lineTo(c * CELL + k + CELL, r * CELL); x.stroke(); }
      x.restore();
    }
    x.restore();
    x.fillStyle = '#ffd34d';
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!inT(c, r)) continue;
      if (BS.inside(c - 1, r) && !inT(c - 1, r)) x.fillRect(c * CELL - 2, r * CELL, 4, CELL);
      if (BS.inside(c + 1, r) && !inT(c + 1, r)) x.fillRect(c * CELL + CELL - 2, r * CELL, 4, CELL);
      if (BS.inside(c, r - 1) && !inT(c, r - 1)) x.fillRect(c * CELL, r * CELL - 2, CELL, 4);
      if (BS.inside(c, r + 1) && !inT(c, r + 1)) x.fillRect(c * CELL, r * CELL + CELL - 2, CELL, 4);
    }
    return staticCv;
  }

  function rangeOf(G, b, s) {
    if (!s) return null;
    if (s.dmg) return { r: s.range, col: '255,255,255' };
    if (s.soldiers) return { r: s.range, col: '255,200,120' };
    if (b.t === 'givre') return { r: s.range, col: '159,211,255' };
    if (b.t === 'phare') return { r: s.reveal, col: '255,215,106' };
    if (b.t === 'sanctuaire') return { r: s.range, col: '124,255,138' };
    if (b.t === 'taverne') return { r: s.range, col: '255,211,77' };
    return null;
  }
  // zone d'attaque : disque + cases du chemin couvertes
  function drawZone(ctx, G, b, s, strong) {
    const R = rangeOf(G, b, s);
    if (!R) return;
    const cx = (b.c + 0.5) * CELL, cy = (b.r + 0.5) * CELL, rr = R.r * CELL;
    ctx.save();
    for (const [pc, pr] of G.path) if ((pc - b.c) ** 2 + (pr - b.r) ** 2 <= R.r * R.r) { ctx.fillStyle = `rgba(${R.col},${strong ? 0.26 : 0.12})`; ctx.fillRect(pc * CELL + 4, pr * CELL + 4, CELL - 8, CELL - 8); }
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU);
    ctx.fillStyle = `rgba(${R.col},${strong ? 0.12 : 0.05})`; ctx.fill();
    ctx.setLineDash([10, 8]); ctx.lineWidth = strong ? 3 : 2; ctx.strokeStyle = `rgba(${R.col},${strong ? 0.85 : 0.45})`; ctx.stroke();
    ctx.setLineDash([]);
    if (s.soldiers) { const pi = BS.rallyCell(G, b, s.range); if (pi >= 0) { const [pc, pr] = G.path[pi]; ctx.strokeStyle = '#ffc878'; ctx.lineWidth = 4; ctx.strokeRect(pc * CELL + 6, pr * CELL + 6, CELL - 12, CELL - 12); } }
    ctx.restore();
  }
  const SYN_ICON = { dmg: ['⚔', '#ff6a5a'], range: ['◎', '#5bb0ff'], rate: ['⚡', '#ffd34d'], soldierHp: ['♥', '#ff7ab0'], soldierDmg: ['⚔', '#ffb070'], respawn: ['↻', '#7cff8a'], prod: ['+', '#ffd34d'], cap: ['+', '#ffd34d'], heal: ['♥', '#7cff8a'], obst: ['+', '#9be07a'] };
  function drawLinks(ctx, G, focusId) {
    for (const L of BS.synLinks(G)) {
      const b = BS.byId(G, L.to);
      if (!b) continue;
      const x = ((b.c + L.c) / 2 + 0.5) * CELL, y = ((b.r + L.r) / 2 + 0.5) * CELL;
      const [ch, col] = SYN_ICON[L.fx] || ['+', '#fff'];
      const strong = focusId && (focusId === b.id || (BS.bAt(G, L.c, L.r) || {}).id === focusId);
      ctx.save();
      ctx.globalAlpha = focusId && !strong ? 0.45 : 1;
      ctx.translate(x + (L.c < b.c ? 6 : L.c > b.c ? -6 : 0), y + (L.r < b.r ? 6 : L.r > b.r ? -6 : 0));
      ctx.fillStyle = OL; ctx.beginPath(); ctx.arc(0, 0, strong ? 11 : 9, 0, TAU); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, strong ? 8.5 : 6.5, 0, TAU); ctx.fill();
      ctx.fillStyle = OL; ctx.font = `bold ${strong ? 12 : 10}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, 0, 1);
      ctx.restore();
    }
  }
  function lerp(map, id, x, y, a) { const p = map.get(id); return p ? [p[0] + (x - p[0]) * a, p[1] + (y - p[1]) * a] : [x, y]; }
  const mobSizeCache = new Map();
  function mobSize(k, boss, child) {
    const key = k + (boss ? 'b' : child ? 'c' : '');
    if (!mobSizeCache.has(key)) mobSizeCache.set(key, boss ? A.mobFit(k, 96, 110) : child ? A.mobFit(k, 28, 34) : A.mobFit(k, 46, 54));
    return mobSizeCache.get(key);
  }

  function draw() {
    const ctx = V.ctx, G = V.G, W = G.W, t = V.t, a = Math.min(1, V.acc / DT);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(staticLayer(), 0, 0);
    // case survolée et sélection
    const selB = V.sel && V.sel.kind === 'b' ? BS.byId(G, V.sel.id) : null;
    if (V.hover && !V.targeting) { ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(V.hover.c * CELL, V.hover.r * CELL, CELL, CELL); }
    if (V.sel && V.sel.kind === 'cell') { ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 4; ctx.strokeRect(V.sel.c * CELL + 2, V.sel.r * CELL + 2, CELL - 4, CELL - 4); }
    if (selB) { ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 4; ctx.strokeRect(selB.c * CELL + 2, selB.r * CELL + 2, CELL - 4, CELL - 4); }
    if (V.sel && V.sel.kind === 'castle') { ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 4; ctx.strokeRect(G.castle.c * CELL + 2, G.castle.r * CELL + 2, CELL * 2 - 4, CELL * 2 - 4); }
    // zones d'attaque
    const statsOf = (b, i) => (W && W.bs[i]) || BS.stats(G, b);
    if (V.zones) G.b.forEach((b, i) => drawZone(ctx, G, b, statsOf(b, i), false));
    if (selB) drawZone(ctx, G, selB, statsOf(selB, G.b.indexOf(selB)), true);
    else if (V.hover && !V.sel && !V.targeting) { const hb = BS.bAt(G, V.hover.c, V.hover.r); if (hb) drawZone(ctx, G, hb, statsOf(hb, G.b.indexOf(hb)), true); }
    if (V.sel && V.sel.kind === 'castle') { const cs = BS.castleStats(G); ctx.save(); ctx.beginPath(); ctx.arc((G.castle.c + 1) * CELL, (G.castle.r + 1) * CELL, cs.range * CELL, 0, TAU); ctx.setLineDash([10, 8]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.stroke(); ctx.restore(); }
    let ghost = null;
    if (V.sel && V.sel.kind === 'cell' && V.sel.build && G.phase === 'build') {
      ghost = { id: -1, t: V.sel.build, c: V.sel.c, r: V.sel.r, lvl: 1, spec: null };
      const pv = BS.preview(G, ghost.t, ghost.c, ghost.r);
      drawZone(ctx, G, ghost, pv.stats, true);
    }
    // objets triés par profondeur
    const items = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const v = G.cells[r * COLS + c]; if (v >= 2 && v <= 4 && !BS.bAt(G, c, r)) items.push([r + 0.9, () => BA.drawObstacle(ctx, v, c, r, G.zone)]); }
    items.push([G.castle.r + 1.95, () => BA.drawCastle(ctx, G, t, V.shake)]);
    G.b.forEach((b, i) => items.push([b.r + 0.95, () => {
      if (b.t === 'barricade' && b.hp <= 0) { ctx.globalAlpha = 0.35; BA.drawBuilding(ctx, b, t); ctx.globalAlpha = 1; return; }
      const stunned = W && W.bst[i] > 0;
      BA.drawBuilding(ctx, b, t);
      if (stunned) for (let k = 0; k < 3; k++) { const an = t * 5 + (k * TAU) / 3; BA.star(ctx, (b.c + 0.5) * CELL + Math.cos(an) * 18, b.r * CELL - 6 + Math.sin(an) * 6, '#ffd34d'); }
      if (b.t === 'barricade') { const mx = statsOf(b, i).hp; if (b.hp < mx) hpBar(ctx, (b.c + 0.5) * CELL, b.r * CELL + 14, 44, b.hp / mx, '#d9a95f'); }
    }]));
    if (ghost) items.push([ghost.r + 0.95, () => { ctx.globalAlpha = 0.6; BA.drawBuilding(ctx, ghost, t); ctx.globalAlpha = 1; }]);
    if (W) {
      for (const m of W.mobs) {
        const [mx, my] = lerp(V.prev, m.id, m.x, m.y, a);
        items.push([my + (m.fly ? 0.5 : 0.25), () => drawMob(ctx, m, mx, my, t)]);
      }
      const g = BS.geo(G);
      for (const so of W.sol) {
        if (so.dead > 0) continue;
        const p = { d: so.rally, seg: 0, fly: false }; BS.place(g, p);
        let sx = p.x + (so.k - 1) * 0.24, sy = p.y + 0.18 - (so.k % 2) * 0.22;
        const m = so.eng ? W.mobs.find((o) => o.id === so.eng) : null;
        if (m) { const [mx, my] = lerp(V.prev, m.id, m.x, m.y, a); sx = mx - 0.32; sy = my + 0.05 + (so.k % 2) * 0.1; }
        items.push([sy + 0.2, () => {
          const B0 = G.b[so.bi];
          BA.drawSoldier(ctx, sx * CELL, sy * CELL + 16, { t, facing: m && m.x < sx ? Math.PI : 0, attack: m ? Math.max(0, Math.sin(t * 6 + so.id)) : 0, knight: B0 && B0.spec === 'chevaliers', seed: so.id });
          if (so.hp < so.max) hpBar(ctx, sx * CELL, sy * CELL - 30, 26, so.hp / so.max, '#6cc86a');
        }]);
      }
    }
    items.sort((p, q) => p[0] - q[0]).forEach((it) => it[1]());
    // liens de synergie (par-dessus les bâtiments)
    if (ghost) G.b.push(ghost);
    drawLinks(ctx, G, selB ? selB.id : ghost ? -1 : null);
    if (ghost) G.b.pop();
    // projectiles
    if (W) for (const p of W.proj) {
      const [px, py] = lerp(V.prevP, p.id, p.x, p.y, a);
      if (!V.projStart.has(p.id)) V.projStart.set(p.id, [p.x, p.y]);
      const st = V.projStart.get(p.id), trav = Math.hypot(px - st[0], py - st[1]), rem = Math.hypot(p.ex - px, p.ey - py);
      const prog = trav / (trav + rem || 1);
      const lift = p.k === 'rock' ? Math.sin(Math.PI * prog) * 46 : 10;
      const pp = V.prevP.get(p.id) || [px - 0.01, py];
      const ang = Math.atan2(py - pp[1], px - pp[0]);
      A.drawProjectile(ctx, p.k === 'orb' ? 'orb' : p.k, px * CELL, py * CELL - lift - 14, ang, t);
    }
    if (V.projStart.size > 300) V.projStart.clear();
    drawFx(ctx, t);
    // capacité visée : cercle sous la souris
    if (V.targeting && V.mouse) {
      const Ab = B.ABILITIES[V.targeting], c = Math.floor(V.mouse.x / CELL), r = Math.floor(V.mouse.y / CELL);
      ctx.save(); ctx.beginPath(); ctx.arc((c + 0.5) * CELL, (r + 0.5) * CELL, Ab.radius * CELL, 0, TAU);
      ctx.fillStyle = 'rgba(255,120,60,.18)'; ctx.fill(); ctx.setLineDash([8, 6]); ctx.lineWidth = 3; ctx.strokeStyle = '#ff9a6a'; ctx.stroke(); ctx.restore();
    }
    // bandeau (début / fin de vague, gardien)
    if (V.banner) {
      const k = (t - V.banner.t0) / 2.4;
      if (k > 1) V.banner = null;
      else {
        const al = Math.min(1, k * 6, (1 - k) * 4);
        ctx.save(); ctx.globalAlpha = al;
        ctx.fillStyle = V.banner.boss ? 'rgba(120,20,30,.78)' : 'rgba(18,12,10,.62)';
        ctx.fillRect(0, MH / 2 - 54, MW, V.banner.sub ? 104 : 84);
        ctx.font = `900 46px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 8; ctx.strokeStyle = OL; ctx.strokeText(V.banner.text, MW / 2, MH / 2 - 14); ctx.fillStyle = V.banner.boss ? '#ffb0a0' : '#ffd34d'; ctx.fillText(V.banner.text, MW / 2, MH / 2 - 14);
        if (V.banner.sub) { ctx.font = `800 26px ${FONT}`; ctx.lineWidth = 6; ctx.strokeText(V.banner.sub, MW / 2, MH / 2 + 28); ctx.fillStyle = '#fff8e8'; ctx.fillText(V.banner.sub, MW / 2, MH / 2 + 28); }
        ctx.restore();
      }
    }
    if (V.paused && G.phase === 'wave') {
      ctx.fillStyle = 'rgba(18,12,10,.35)'; ctx.fillRect(0, 0, MW, MH);
      ctx.font = `900 54px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 8; ctx.strokeStyle = OL; ctx.strokeText('Pause', MW / 2, MH / 2); ctx.fillStyle = '#fff8e8'; ctx.fillText('Pause', MW / 2, MH / 2);
    }
    if (V.ending) { ctx.font = `800 20px ${FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.lineWidth = 5; ctx.strokeStyle = OL; ctx.strokeText('Validation de la manche…', MW - 14, 12); ctx.fillStyle = '#fff8e8'; ctx.fillText('Validation de la manche…', MW - 14, 12); }
  }
  function hpBar(ctx, x, y, w, f, col) {
    ctx.fillStyle = OL; ctx.fillRect(Math.round(x - w / 2) - 2, Math.round(y) - 2, w + 4, 8);
    ctx.fillStyle = '#3a2a30'; ctx.fillRect(Math.round(x - w / 2), Math.round(y), w, 4);
    ctx.fillStyle = col; ctx.fillRect(Math.round(x - w / 2), Math.round(y), Math.max(0, Math.round(w * Math.max(0, Math.min(1, f)))), 4);
  }
  function drawMob(ctx, m, mx, my, t) {
    const x = mx * CELL, y = my * CELL + (m.fly ? -18 : 14);
    const prev = V.prev.get(m.id);
    if (prev && Math.abs(mx - prev[0]) > 0.001) V.face.set(m.id, mx < prev[0] ? Math.PI : 0);
    const facing = V.face.get(m.id) || 0, size = mobSize(m.k, m.boss, m.child);
    ctx.save();
    if (m.stealth && !m.seen) ctx.globalAlpha = 0.33;
    if (m.fly) A.shadow(ctx, x, my * CELL + 22, size * 0.9, size * 0.3);
    if (m.aSlow > 0) { ctx.save(); ctx.globalAlpha *= 0.5; ctx.beginPath(); ctx.ellipse(x, y + 2, size * 1.3, size * 0.45, 0, 0, TAU); ctx.fillStyle = '#9fd3ff'; ctx.fill(); ctx.restore(); }
    A.drawMob(ctx, m.k, x, y, { size, t: t + m.id * 0.37, facing, boss: m.boss, attack: m.blk ? Math.max(0, Math.sin(t * 7 + m.id)) : 0, frozen: m.stunT > 0.7, seed: m.id });
    ctx.restore();
    const top = y - size * A.mobTop(m.k) - 10;
    if (m.hp < m.max) hpBar(ctx, x, top, m.boss ? 70 : 34, m.hp / m.max, m.boss ? '#ff5a6a' : '#7cff6a');
    if (m.stunT > 0 && m.stunT <= 0.7) for (let k = 0; k < 2; k++) { const an = t * 6 + k * Math.PI; BA.star(ctx, x + Math.cos(an) * 12, top - 8 + Math.sin(an) * 3, '#ffd34d'); }
    if (m.burnT > 0) { ctx.fillStyle = Math.floor(t * 10) % 2 ? '#ff7a1a' : '#ffd76a'; ctx.fillRect(x - 6, top + 8, 4, 6); ctx.fillRect(x + 4, top + 12, 4, 5); }
    if (m.markT > 0) { ctx.strokeStyle = '#c26bff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y - size, size * 0.9, 0, TAU); ctx.stroke(); }
  }
  function drawFx(ctx, t) {
    V.fx = V.fx.filter((f) => t - f.t0 <= f.dur);
    for (const f of V.fx) {
      const k = (t - f.t0) / (f.dur || 1);
      ctx.save();
      if (f.k === 'boom') { ctx.globalAlpha = 1 - k; ctx.fillStyle = '#d9c4a0'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + k * 0.7), 0, TAU); ctx.fill(); ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 4; ctx.stroke(); }
      else if (f.k === 'spark') { ctx.globalAlpha = 1 - k; ctx.fillStyle = f.col || '#fff'; for (let i = 0; i < 4; i++) { const an = i * 1.57 + 0.4; ctx.fillRect(f.x + Math.cos(an) * k * 16 - 2, f.y - 14 + Math.sin(an) * k * 16 - 2, 4, 4); } }
      else if (f.k === 'puff') { ctx.globalAlpha = 0.8 * (1 - k); ctx.fillStyle = '#fff8e8'; for (let i = 0; i < 6; i++) { const an = i * 1.05; ctx.fillRect(f.x + Math.cos(an) * k * (f.big ? 50 : 24) - 4, f.y + Math.sin(an) * k * (f.big ? 30 : 14) - 4, 8, 8); } }
      else if (f.k === 'chain') { ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(f.x, f.y - 16); const mx = (f.x + f.x2) / 2 + 10, my = (f.y + f.y2) / 2 - 26; ctx.lineTo(mx, my); ctx.lineTo(f.x2, f.y2 - 16); ctx.stroke(); }
      else if (f.k === 'ring') { ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.col; ctx.lineWidth = f.w || 4; ctx.beginPath(); ctx.ellipse(f.x, f.y + 10, f.r * (0.3 + 0.7 * k), f.r * (0.3 + 0.7 * k) * 0.55, 0, 0, TAU); ctx.stroke(); }
      else if (f.k === 'abil') drawAbilityFx(ctx, f, k, t);
      ctx.restore();
    }
    V.texts = V.texts.filter((x) => t - x.t0 <= x.dur);
    ctx.font = `900 18px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const x of V.texts) {
      const k = (t - x.t0) / x.dur;
      ctx.globalAlpha = Math.min(1, (1 - k) * 2);
      ctx.lineWidth = 5; ctx.strokeStyle = OL; ctx.strokeText(x.text, x.x, x.y - k * 28); ctx.fillStyle = x.col; ctx.fillText(x.text, x.x, x.y - k * 28);
    }
    ctx.globalAlpha = 1;
  }
  function drawAbilityFx(ctx, f, k, t) {
    if (f.id === 'pluie') {
      ctx.strokeStyle = '#f3ead7'; ctx.lineWidth = 3;
      for (let i = 0; i < 14; i++) { const ax = f.x + Math.sin(i * 7.3) * f.r * 0.8, ay = f.y + Math.cos(i * 3.1) * f.r * 0.5, fall = ((k * 2 + i * 0.13) % 1) * 90; ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.moveTo(ax - 6, ay - 90 + fall); ctx.lineTo(ax, ay - 70 + fall); ctx.stroke(); }
    } else if (f.id === 'gel') {
      ctx.globalAlpha = 0.6 * (1 - k); ctx.fillStyle = '#bfe6ff'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.5 + k * 0.5), 0, TAU); ctx.fill();
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; for (let i = 0; i < 6; i++) { const an = i * 1.047; ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + Math.cos(an) * f.r * k, f.y + Math.sin(an) * f.r * k); ctx.stroke(); }
    } else if (f.id === 'colere') {
      if (k < 0.45) { const kk = k / 0.45; A.drawProjectile(ctx, 'meteor', f.x - 200 * (1 - kk), f.y - 320 * (1 - kk), Math.atan2(320, 200), t); }
      else { const kk = (k - 0.45) / 0.55; ctx.globalAlpha = 1 - kk; ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + kk * 0.8), 0, TAU); ctx.fill(); ctx.fillStyle = '#ffd76a'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.2 + kk * 0.4), 0, TAU); ctx.fill(); }
    } else if (f.id === 'reparation') {
      ctx.globalAlpha = 1 - k; ctx.fillStyle = '#7cff8a';
      for (let i = 0; i < 10; i++) { const an = i * 0.63; ctx.fillRect(f.x + Math.cos(an) * 70 - 3, f.y - 40 - k * 60 + Math.sin(an) * 20, 6, 6); }
    }
  }

  /* ------------------------------ barres (haut et bas) ------------------------------ */
  let hudCache = '';
  function hud() {
    if (!V) return;
    const G = V.G, max = BS.castleMax(G);
    const key = [G.wave, G.phase, Math.floor(G.res.or), G.res.bois, G.res.pierre, Math.ceil(G.castle.hp), max, G.W ? G.W.mobs.length : -1, V.speed, V.paused, V.ending].join('|');
    // recharges des capacités (affichées chaque dixième de seconde)
    if (G.W) for (const id of Object.keys(B.ABILITIES)) { const btn = $(`#bsAb_${id}`); if (!btn) continue; const left = Math.max(0, ((G.W.abil[id] || 0) - G.W.tick) * DT); const lab = btn.querySelector('.cd'); if (lab) lab.textContent = left > 0 ? `${Math.ceil(left)} s` : ''; btn.classList.toggle('cooling', left > 0); }
    if (key === hudCache) return;
    hudCache = key;
    const set = (id, txt) => { const e = $('#' + id); if (e && e.textContent !== txt) e.textContent = txt; };
    set('bsWave', G.phase === 'wave' ? `⚔️ Manche ${G.W.w}${G.infinite ? '' : ` / ${B.WIN_WAVE}`} · ${G.W.mobs.length + (G.W.q.length - G.W.qi)} monstres` : `🏁 Manche ${G.wave}${G.infinite ? ' (infini)' : ` / ${B.WIN_WAVE}`}`);
    set('bsOr', `${resIcon('or')} ${Math.floor(G.res.or)}`); set('bsBois', `${resIcon('bois')} ${G.res.bois}`); set('bsPierre', `${resIcon('pierre')} ${G.res.pierre}`);
    const bar = $('#bsHpBar'); if (bar) bar.style.width = `${Math.max(0, (G.castle.hp / max) * 100)}%`;
    set('bsHpLabel', `${Math.max(0, Math.ceil(G.castle.hp))} / ${max} PV`);
    renderBars();
  }
  function renderBars() {
    const bottom = $('#bsBottom');
    if (!bottom || !V) return;
    const G = V.G, wave = G.phase === 'wave';
    const zb = $('#bsZonesBtn'); if (zb) zb.classList.toggle('selected', V.zones);
    const mb = $('#bsMute'); if (mb) mb.textContent = Sound.muted ? '🔇' : '🔊';
    const k = [G.phase, G.wave, G.castle.lvl, V.speed, V.paused, V.ending, V.targeting].join('|');
    if (bottom.dataset.k === k) return;
    bottom.dataset.k = k;
    const speeds = el('div', { class: 'bs-speeds' }, ...B.SPEEDS.map((s) => el('button', { class: 'small' + (V.speed === s ? ' selected' : ''), onclick: () => { V.speed = s; renderBars(); } }, `×${s}`)),
      el('button', { class: 'small', disabled: !wave, onclick: () => { V.paused = !V.paused; renderBars(); } }, V.paused ? '▶️ Reprendre' : '⏸️ Pause'));
    const abil = Object.entries(B.ABILITIES).map(([id, Ab]) => {
      const ok = G.castle.lvl >= Ab.level;
      return el('button', { class: 'small bs-ab' + (V.targeting === id ? ' selected' : ''), id: `bsAb_${id}`, disabled: !ok || !wave || V.ending, title: ok ? Ab.desc : `Tour principale niveau ${Ab.level}`, onclick: () => useAbility(id) },
        `${Ab.icon} ${ok ? Ab.name : `niv. ${Ab.level}`}`, el('span', { class: 'cd' }));
    });
    const launch = G.phase === 'build'
      ? el('button', { class: 'primary bs-launch', disabled: V.ending, onclick: launchWave, title: 'Espace' }, `⚔️ Lancer la manche ${G.wave + 1}`)
      : el('span', { class: 'small muted' }, wave ? (V.targeting ? '🎯 Clique sur la carte pour viser (clic droit : annuler)' : 'Espace : pause · 1, 2, 3 : vitesse') : '');
    bottom.replaceChildren(launch, G.phase === 'build' ? wavePreviewEl(G) : '', el('div', { class: 'bs-abils' }, ...abil), speeds);
  }
  // Prochaine vague : monstres (vignettes), types et gardien
  const mobIcons = new Map();
  function mobIcon(k, boss) {
    const key = k + (boss ? '!' : '');
    if (!mobIcons.has(key)) {
      const c = document.createElement('canvas'); c.width = 34; c.height = 34;
      A.drawMob(c.getContext('2d'), k, 17, 31, { size: A.mobFit(k, 28, 30), t: 0.3, facing: 0 });
      mobIcons.set(key, c);
    }
    const out = document.createElement('canvas'); out.width = 34; out.height = 34; out.getContext('2d').drawImage(mobIcons.get(key), 0, 0);
    return out;
  }
  function wavePreviewEl(G) {
    const list = BS.wavePreview(G);
    return el('div', { class: 'bs-preview', title: 'Prochaine vague' },
      ...list.map((x) => el('span', { class: 'bs-pmob' + (x.role === 'boss' ? ' boss' : ''), title: `${GD.MOBS[x.k] ? GD.MOBS[x.k].name : x.k} — ${x.role === 'boss' ? 'Gardien' : B.ROLES[x.role].name} : ${x.role === 'boss' ? 'un gardien' : B.ROLES[x.role].desc}` },
        mobIcon(x.k, x.role === 'boss'), el('span', { class: 'small' }, x.role === 'boss' ? '👑' : `${B.ROLES[x.role].icon}×${x.n}`))));
  }
  function useAbility(id) {
    if (!V || !V.G.W) return;
    const Ab = B.ABILITIES[id];
    if ((V.G.W.abil[id] || 0) > V.G.W.tick) { toast('Capacité en recharge'); return; }
    if (Ab.target) { V.targeting = V.targeting === id ? null : id; renderBars(); }
    else V.abilQueue.push({ id, c: 0, r: 0 });
  }

  /* ------------------------------ panneau de sélection ------------------------------ */
  function renderPanel() {
    const panel = $('#bsPanel');
    if (!panel || !V) return;
    const G = V.G, sel = V.sel;
    // le panneau se place du côté opposé à la case choisie
    const col = sel ? (sel.kind === 'cell' ? sel.c : sel.kind === 'b' ? (BS.byId(G, sel.id) || { c: 0 }).c : G.castle.c) : COLS;
    panel.classList.toggle('left', col >= COLS / 2);
    panel.classList.toggle('hidden', !sel);
    if (!sel) { panel.replaceChildren(); return; }
    const close = el('button', { class: 'small bs-close', onclick: cancel, title: 'Fermer (Échap)' }, '✕');
    let body;
    if (sel.kind === 'castle') body = castlePanel(G);
    else if (sel.kind === 'b') { const b = BS.byId(G, sel.id); if (!b) { V.sel = null; panel.classList.add('hidden'); return; } body = buildingPanel(G, b); }
    else body = cellPanel(G, sel);
    panel.replaceChildren(close, ...[].concat(body));
  }
  const costEl = (G, cost) => el('span', { class: 'bs-cost' }, ...Object.entries(cost || {}).filter(([, n]) => n > 0).map(([k, n]) => el('span', { class: (G.res[k] || 0) >= n ? '' : 'bad' }, `${resIcon(k)} ${n} `)));
  const synText = (s, b) => {
    const v = s.v, T = B.BUILDINGS[b.t];
    switch (s.fx) {
      case 'dmg': return `+${pct(v)} de dégâts`; case 'range': return `+${fmt(v)} case de zone`; case 'rate': return `+${pct(v)} de vitesse d’attaque`;
      case 'soldierHp': return `+${pct(v)} de PV des soldats`; case 'soldierDmg': return `+${pct(v)} de dégâts des soldats`; case 'respawn': return `soldats de retour ${pct(v)} plus vite`;
      case 'prod': return `+${pct(v)} de production`; case 'cap': return `+${pct(v)} de plafond d’intérêts`; case 'heal': return `+${pct(v)} de soins`;
      case 'obst': { const L = T.lv[b.lvl - 1]; return `+${L.perObstacle || 0} ${resIcon(Object.keys(L.prod || { bois: 1 })[0])}`; }
    }
    return '';
  };
  function statLines(G, b, s) {
    const out = [];
    if (s.dmg) {
      out.push(`⚔️ ${fmt(s.dmg)} dégâts · ${fmt(1 / s.cd)} tir${1 / s.cd >= 2 ? 's' : ''}/s · zone ${fmt(s.range)} cases`);
      out.push(`${s.air ? '🪽 Sol et airs' : '🦶 Sol seulement'}${s.magic ? ' · ✨ magique (ignore l’armure)' : s.pierce ? ' · perforant (ignore l’armure)' : ''}${s.splash ? ` · 💥 explosion ${fmt(s.splash)} case` : ''}`);
      if (s.crit) out.push(`🎯 ${pct(s.crit)} de critiques (×${fmt(s.critMul)})`);
      if (s.burn) out.push(`🔥 brûlure : +${pct(s.burn)} des dégâts sur ${s.burnDur} s`);
      if (s.stun) out.push(`💫 étourdit ${fmt(s.stun)} s`);
      if (s.chain) out.push(`⚡ rebondit sur ${s.chain} monstres (${pct(s.chainMul)})`);
      if (s.mark) out.push(`🔮 marque : +${pct(s.mark)} de dégâts subis (${s.markDur} s)`);
    }
    if (s.soldiers) { out.push(`🛡️ ${s.soldiers} soldats · ${s.shp} PV · ${fmt(s.sdmg)} dégâts/s${s.sarmor ? ` · −${pct(s.sarmor)} de dégâts subis` : ''}`); out.push(`↻ retour ${fmt(s.respawn)} s après une chute · zone ${fmt(s.range)} cases`); if (BS.rallyCell(G, b, s.range) < 0) out.push('⚠️ Trop loin du chemin : aucun soldat ne peut s’y poster'); }
    if (b.t === 'givre') out.push(`❄️ ralentit de ${pct(s.slow)} · zone ${fmt(s.range)} cases${s.dps ? ` · ${s.dps} dégâts/s` : ''}${s.freezeEvery ? ` · gèle ${s.freeze} s toutes les ${s.freezeEvery} s` : ''}`);
    if (b.t === 'phare') out.push(`🗼 révèle les camouflés : zone ${fmt(s.reveal)} cases${s.vuln ? ` · +${pct(s.vuln)} de dégâts subis dans sa zone` : ''}`);
    if (b.t === 'sanctuaire') out.push(`⛪ soigne ${fmt(s.heal)} PV/s (soldats, barricades) · zone ${fmt(s.range)} · tour principale +${s.castleHeal} PV après chaque vague${s.castleRegen ? ` et +${s.castleRegen} PV/s pendant les vagues` : ''}`);
    if (b.t === 'barricade') out.push(`🧱 ${Math.max(0, Math.round(b.hp === undefined ? s.hp : b.hp))} / ${s.hp} PV${s.thorns ? ` · pieux : ${s.thorns} dégâts/s` : ''}`);
    if (b.t === 'ferme') out.push(`🌾 tour principale : +${s.castleHeal} PV après chaque vague`);
    if (b.t === 'taverne') out.push(`🍺 +${s.bounty} ${resIcon('or')} par monstre vaincu dans sa zone (${fmt(s.range)} cases)`);
    if (b.t === 'banque') out.push(`🏦 intérêts : ${pct(s.rate)} de l’or gardé, ${s.cap} ${resIcon('or')} au plus`);
    if (s.prod) out.push(`📦 après chaque vague : ${costText(s.prod)}`);
    return out;
  }
  function synBlock(G, b, s, given) {
    const rows = [];
    for (const x of s.syn) { const from = BS.bAt(G, x.c, x.r); rows.push(el('li', {}, `🔗 ${x.name} : ${synText(x, b)}`, el('span', { class: 'muted' }, from ? ` (${B.BUILDINGS[from.t].name})` : ''))); }
    for (const x of given || []) { const to = BS.bAt(G, x.c, x.r); if (to) rows.push(el('li', {}, `➡️ donne à ${B.BUILDINGS[to.t].name} : ${synText(x, to)}`)); }
    return rows.length ? el('ul', { class: 'bs-syn' }, ...rows) : el('p', { class: 'small muted' }, 'Aucune synergie : place-le contre des bâtiments complémentaires (côté commun).');
  }

  function buildingPanel(G, b) {
    const T = B.BUILDINGS[b.t], i = G.b.indexOf(b), s = (G.W && G.W.bs[i]) || BS.stats(G, b), wave = G.phase !== 'build';
    const out = [
      el('div', { class: 'bs-ph' }, BA.iconCanvas(b.t, b.lvl, b.spec, 52), el('div', {}, el('h3', {}, `${T.icon} ${T.name}`), el('div', { class: 'small muted' }, `${B.CATS[T.cat].icon} ${B.CATS[T.cat].name} · niveau ${b.lvl}${b.spec ? ` · ${T.specs[b.spec].icon} ${T.specs[b.spec].name}` : ''}`))),
      el('p', { class: 'small' }, T.desc),
      el('ul', { class: 'bs-stats' }, ...statLines(G, b, s).map((l) => el('li', {}, l))),
      el('h4', {}, 'Synergies'), synBlock(G, b, s, BS.synergiesGiven(G, b))
    ];
    if (wave) { out.push(el('p', { class: 'small muted' }, 'Pendant la vague : regarde, et utilise les capacités de la tour principale.')); return out; }
    if (b.lvl < 3) {
      const err = BS.upgradeError(G, b), nb = { ...b, lvl: b.lvl + 1 };
      const ns = BS.stats(G, nb);
      const diff = statLines(G, nb, ns)[0];
      out.push(el('div', { class: 'bs-act' }, el('div', { class: 'small' }, `Niveau ${b.lvl + 1} : ${diff || ''}`),
        el('button', { class: 'primary', disabled: !!err, title: err || '', onclick: () => doOp(['u', b.id], 'upgrade') }, `⬆️ Améliorer `, costEl(G, GD.bastionCost(b.t, b.lvl + 1))),
        err && err !== 'Pas assez de ressources' ? el('div', { class: 'small bs-err' }, err) : ''));
    } else if (!b.spec) {
      out.push(el('h4', {}, 'Spécialisation (niveau 4)'));
      for (const [k, sp] of Object.entries(T.specs)) {
        const err = BS.specError(G, b, k);
        out.push(el('div', { class: 'bs-act' }, el('div', { class: 'small' }, `${sp.icon} `, el('b', {}, sp.name), ` — ${sp.desc}`),
          el('button', { disabled: !!err, title: err || '', onclick: () => doOp(['s', b.id, k], 'upgrade') }, 'Choisir ', costEl(G, GD.bastionCost(b.t, 4))),
          err && err !== 'Pas assez de ressources' ? el('div', { class: 'small bs-err' }, err) : ''));
      }
    }
    const back = BS.sellValue(b);
    out.push(el('div', { class: 'bs-act' }, el('button', { class: 'small', onclick: () => { doOp(['x', b.id], 'sell'); V.sel = null; renderPanel(); } }, '💰 Vendre (', costText(back) || 'rien', ')')));
    return out;
  }

  function castlePanel(G) {
    const C = B.CASTLE, L = G.castle.lvl, cs = BS.castleStats(G), max = BS.castleMax(G);
    const out = [
      el('h3', {}, `${C.icon} ${C.name} — niveau ${L}`),
      el('ul', { class: 'bs-stats' },
        el('li', {}, `❤️ ${Math.ceil(G.castle.hp)} / ${max} PV`),
        el('li', {}, `🏹 tire sur tout ce qui approche : ${cs.dmg} dégâts · zone ${fmt(cs.range)} cases (révèle les camouflés)`),
        el('li', {}, `🗺️ territoire : ${BS.territory(G)} cases autour de la tour · bâtiments jusqu’au niveau ${BS.bldgMax(G) >= 4 ? '3 + spécialisation' : BS.bldgMax(G)}`),
        el('li', {}, `✨ capacités : ${Object.values(B.ABILITIES).filter((a) => a.level <= L).map((a) => `${a.icon} ${a.name}`).join(', ') || 'aucune (niveau 2)'}`))
    ];
    if (G.phase !== 'build') return out;
    if (L < C.hp.length) {
      const err = BS.castleUpError(G), n = L;
      const gains = [`+${C.hp[n] - C.hp[n - 1]} PV`, `dégâts ${C.dmg[n - 1]} → ${C.dmg[n]}`, `territoire ${C.territory[n - 1]} → ${C.territory[n] >= 16 ? 'toute la carte' : C.territory[n]}`];
      if (C.bldgMax[n] > C.bldgMax[n - 1]) gains.push(C.bldgMax[n] >= 4 ? 'spécialisations' : `bâtiments niveau ${C.bldgMax[n]}`);
      const ab = Object.values(B.ABILITIES).find((a) => a.level === n + 1);
      if (ab) gains.push(`capacité ${ab.icon} ${ab.name}`);
      out.push(el('div', { class: 'bs-act' }, el('div', { class: 'small' }, `Niveau ${n + 1} : ${gains.join(' · ')}`),
        el('button', { class: 'primary', disabled: !!err, onclick: () => doOp(['c'], 'upgrade') }, '⬆️ Améliorer ', costEl(G, C.cost[n]))));
    }
    out.push(el('div', { class: 'bs-act' }, el('button', { disabled: G.castle.hp >= max || !BS.canPay(G.res, C.repair.cost), onclick: () => doOp(['r'], 'upgrade') }, `🔨 Réparer +${C.repair.hp} PV `, costEl(G, C.repair.cost))));
    return out;
  }

  function cellPanel(G, sel) {
    const { c, r } = sel, cell = BS.cellAt(G, c, r), inT = BS.inTerritory(G, c, r);
    const NAMES = ['Herbe', 'Chemin', G.zone === 'mine' ? 'Champignon géant' : 'Arbre', 'Rocher', 'Filon d’or'];
    const out = [el('h3', {}, `${['🌱', '🟫', G.zone === 'mine' ? '🍄' : '🌳', '🪨', '💎'][cell] || ''} ${NAMES[cell] || 'Case'}`)];
    if (G.phase !== 'build') { out.push(el('p', { class: 'small muted' }, 'On construit entre deux vagues.')); return out; }
    if (!inT) { out.push(el('p', { class: 'small' }, `Hors du territoire : améliore la tour principale pour l’agrandir (rayon actuel : ${BS.territory(G)} cases).`)); return out; }
    if (cell === BS.ARBRE || cell === BS.ROCHER) {
      const Cl = cell === BS.ARBRE ? B.CLEAR.arbre : B.CLEAR.rocher;
      out.push(el('p', { class: 'small' }, cell === BS.ARBRE ? `Une scierie qui touche ${G.zone === 'mine' ? 'ce champignon' : 'cet arbre'} produit plus de bois.` : 'Une carrière qui touche ce rocher produit plus de pierre.'));
      out.push(el('div', { class: 'bs-act' }, el('button', { class: 'primary', disabled: (G.res.or || 0) < Cl.cost, onclick: () => { if (doOp(['d', c, r], 'clear')) { V.sel = { kind: 'cell', c, r, build: null }; renderPanel(); } } }, `🪓 Défricher : ${resIcon('or')} ${Cl.cost} → +${costText(Cl.gain)}`)));
      return out;
    }
    if (cell === BS.CHEMIN) out.push(el('p', { class: 'small muted' }, 'Les monstres suivent ce chemin jusqu’à ta tour. Seule une barricade peut s’y construire.'));
    if (cell === BS.FILON) out.push(el('p', { class: 'small muted' }, 'Un filon d’or : seule une mine d’or peut s’y construire.'));
    // bâtiments possibles ici (le choix s'affiche en haut ; un deuxième clic sur le même bâtiment le construit)
    const build = (t) => { if (doOp(['b', t, c, r])) { const nb = BS.bAt(V.G, c, r); V.sel = nb ? { kind: 'b', id: nb.id } : null; renderPanel(); } };
    if (sel.build) {
      const t = sel.build, T = B.BUILDINGS[t], pv = BS.preview(G, t, c, r), err = BS.canBuild(G, t, c, r);
      out.push(el('div', { class: 'bs-detail' },
        el('div', { class: 'bs-ph' }, BA.iconCanvas(t, 1, null, 44), el('div', {}, el('b', {}, `${T.icon} ${T.name}`), el('div', { class: 'small muted' }, T.desc))),
        el('ul', { class: 'bs-stats' }, ...statLines(G, { t, c, r, lvl: 1, spec: null, hp: T.lv[0].hp }, pv.stats).map((l) => el('li', {}, l))),
        synBlock(G, { t, c, r, lvl: 1 }, pv.stats, pv.given),
        el('button', { class: 'primary', disabled: !!err, onclick: () => build(t) }, '🔨 Construire ', costEl(G, GD.bastionCost(t, 1))),
        err ? el('div', { class: 'small bs-err' }, err) : ''));
    }
    const types = Object.entries(B.BUILDINGS).filter(([, T]) => (cell === BS.CHEMIN ? T.path : cell === BS.FILON ? T.filon : !T.path && !T.filon));
    const rows = [], locked = [];
    for (const [cat, Cat] of Object.entries(B.CATS)) {
      const list = types.filter(([t, T]) => T.cat === cat && BS.isUnlocked(G, t));
      locked.push(...types.filter(([t, T]) => T.cat === cat && !BS.isUnlocked(G, t)).map(([, T]) => T.name));
      if (!list.length) continue;
      rows.push(el('div', { class: 'bs-cat small' }, `${Cat.icon} ${Cat.name}`));
      for (const [t, T] of list) {
        const err = BS.canBuild(G, t, c, r), pv = BS.preview(G, t, c, r), syn = pv.stats.syn.length + pv.given.length;
        rows.push(el('button', { class: 'bs-opt' + (sel.build === t ? ' selected' : '') + (err ? ' dim' : ''), title: err || T.desc, onclick: () => { if (sel.build === t && !err) build(t); else { V.sel = { kind: 'cell', c, r, build: t }; renderPanel(); } } },
          BA.iconCanvas(t, 1, null, 34), el('span', { class: 'bs-opt-name' }, T.name), syn ? el('span', { class: 'bs-syn-n', title: 'Synergies avec les voisins' }, `🔗${syn}`) : '', costEl(G, GD.bastionCost(t, 1))));
      }
    }
    if (rows.length) out.push(el('div', { class: 'bs-opts' }, ...rows));
    if (locked.length) out.push(el('p', { class: 'small muted' }, `🔒 À débloquer dans l’atelier (📜) : ${locked.join(', ')}.`));
    return out;
  }

  /* ------------------------------ fin de partie ------------------------------ */
  function overlay(content, wide) {
    const o = $('#bsOverlay');
    if (!o) return;
    o.replaceChildren(el('div', { class: 'mini-panel' + (wide ? ' bs-wide' : '') }, ...content));
    o.classList.remove('hidden');
  }
  function showWon() {
    const run = S.run;
    overlay([
      el('h3', {}, '🏆 Victoire !'),
      el('p', {}, `Ton bastion a tenu ${B.WIN_WAVE} manches dans la zone « ${B.ZONES[run.zone].name} ».`),
      el('p', { class: 'small muted' }, 'Tu peux continuer en mode infini (les vagues deviennent de plus en plus dures, ton record compte pour le classement) ou terminer la partie et recevoir tes récompenses.'),
      el('div', { class: 'mini-panel-btns' },
        el('button', { class: 'primary', onclick: () => { $('#bsOverlay').classList.add('hidden'); send('/api/bastion/act', { action: 'continue' }); } }, '♾️ Continuer (mode infini)'),
        el('button', { onclick: () => send('/api/bastion/act', { action: 'victory' }) }, '🏁 Terminer la partie'))
    ]);
  }
  function showOver() {
    const o = S.run.over, line = (icon, label, value) => el('div', { class: 'reward-line' }, el('span', {}, `${icon} ${label}`), el('b', {}, value));
    const title = o.won ? '🏆 Partie terminée — victoire !' : o.reason === 'lost' ? '💥 La tour principale est tombée' : '🏳️ Partie abandonnée';
    overlay([
      el('h3', {}, title),
      el('p', {}, `Ton bastion a tenu ${o.wave} manche${o.wave > 1 ? 's' : ''}${o.reason === 'lost' ? ` (tombé à la manche ${o.lostAt}${o.won ? ', en mode infini' : ''})` : ''}.`),
      el('div', { class: 'reward-list' },
        line('✨', 'Expérience', `+${o.xp} XP`), o.levels ? line('⬆️', 'Niveaux gagnés', `+${o.levels}`) : '',
        line('📜', 'Plans', `+${o.plans}`), o.eggs ? line('🥚', 'Œufs de familier', `+${o.eggs}`) : '',
        line('🌨️', 'Grêlons', o.refunded ? `${B.PRICE} remboursés` : 'non remboursés'),
        line('💀', 'Monstres vaincus', String(o.kills)), line('🔨', 'Bâtiments construits', String(o.built)), line('🔗', 'Synergies (au plus)', String(o.syn))),
      el('div', { class: 'mini-panel-btns' }, el('span', { class: 'spacer' }), el('button', { class: 'primary', onclick: () => { V = null; send('/api/bastion/act', { action: 'close' }); } }, 'Retour au Bastion'))
    ]);
  }

  /* ------------------------------ clavier ------------------------------ */
  document.addEventListener('keydown', (e) => {
    if (!V || !visible() || !V.canvas || !V.canvas.isConnected) return;
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (document.querySelector('.game-dialog-overlay')) return;
    const G = V.G;
    if (e.code === 'Space') { e.preventDefault(); if (G.phase === 'build') launchWave(); else if (G.phase === 'wave') { V.paused = !V.paused; renderBars(); } }
    else if (e.key === 'Escape') cancel();
    else if (['1', '2', '3'].includes(e.key)) { V.speed = B.SPEEDS[Number(e.key) - 1] || 1; renderBars(); }
    else if (e.key === 'z' || e.key === 'Z') { V.zones = !V.zones; renderBars(); }
  });

  window.BastionGame = { open: load, debug: () => V };
})();
