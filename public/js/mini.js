/* Onglet « Mini-jeux » : expéditions solo en temps réel, vues du dessus (caverne, forêt, clairière).
 * La salle est simulée dans la page (shared/expedition.js) ; le serveur valide les rapports et garde l'inventaire.
 * Commandes : ZQSD / flèches, clic gauche = attaquer ou récolter vers la souris, clic droit = bouclier (parade),
 * Maj = sprint, Espace = roulade (invulnérable 1 s), E = compétence, A = potion, F = seau ou charrette, Échap = pause. Sur téléphone : joystick et boutons. */
(function () {
  'use strict';
  const GD = window.GameData, M = GD.MINI, A = window.Art, X = window.Expedition, D = window.MiniDecor;
  const { api, $, el, toast, ask } = window.UI;
  const PT = GD.PETS;
  const AW = M.ARENA.W, AH = M.ARENA.H, TAU = Math.PI * 2, OL = '#120c0a';
  const FONT = 'Nunito, system-ui, sans-serif';

  let state = null, busy = false;
  let G = null; // expédition affichée : salle simulée, entrées, effets, panneaux

  /* ============================== Sons et musique (synthétisés, sans fichier) ==============================
   * Deux volumes réglables (musique, effets) + coupure générale, retenus dans le navigateur.
   * Chaque mini-jeu a sa petite musique en boucle (caverne : mineur et lente ; forêt : flûte folk ; clairière : gaie). */
  const Sound = (() => {
    let ac = null, master = null, sfxBus = null, musBus = null;
    const prefs = { music: 0.5, sfx: 0.8, muted: false };
    const last = {}; // dernier déclenchement de chaque effet (pour ne pas saturer)
    try { Object.assign(prefs, JSON.parse(localStorage.getItem('miniSound') || '{}')); } catch (e) { /* stockage indisponible */ }
    const save = () => { try { localStorage.setItem('miniSound', JSON.stringify(prefs)); } catch (e) { /* */ } };
    function audio() {
      if (!ac) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ac = new C();
        master = ac.createGain(); master.connect(ac.destination);
        sfxBus = ac.createGain(); sfxBus.connect(master);
        musBus = ac.createGain(); musBus.connect(master);
        applyVolumes();
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function applyVolumes() {
      if (!ac) return;
      master.gain.value = prefs.muted ? 0 : 1;
      sfxBus.gain.value = prefs.sfx;
      musBus.gain.value = prefs.music * 0.45;
    }
    // note : fréquence, durée, forme, volume, décalage, glissement de fréquence, sortie
    function tone(c, f, dur, type, vol, when, slide, out) {
      const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + (when || 0);
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(out || sfxBus); o.start(t0); o.stop(t0 + dur + 0.02);
    }
    // bruit filtré (choc, craquement, froissement, percussions)
    function noise(c, dur, vol, when, freq, ftype, out) {
      const n = Math.max(1, Math.floor(c.sampleRate * dur)), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t0 = c.currentTime + (when || 0);
      s.buffer = buf; f.type = ftype || 'bandpass'; f.frequency.value = freq || 1000; g.gain.value = vol;
      s.connect(f).connect(g).connect(out || sfxBus); s.start(t0);
    }
    const r = () => 0.92 + Math.random() * 0.16; // petite variation de hauteur
    const SFX = {
      // récolte
      pierre: (c) => { const p = r(); tone(c, 1900 * p, 0.14, 'triangle', 0.2); tone(c, 2900 * p, 0.07, 'square', 0.04, 0.005); noise(c, 0.07, 0.35, 0, 3500, 'highpass'); },
      bois: (c) => { const p = r(); tone(c, 170 * p, 0.14, 'sine', 0.45, 0, -90); noise(c, 0.1, 0.45, 0, 800 * p, 'bandpass'); noise(c, 0.05, 0.2, 0.03, 2200, 'bandpass'); },
      baies: (c) => { const p = r(); tone(c, 520 * p, 0.08, 'sine', 0.3, 0, 600); noise(c, 0.12, 0.12, 0, 3000, 'bandpass'); },
      gain: (c) => { [784, 988, 1319].forEach((f, i) => tone(c, f, 0.22, 'triangle', 0.13, i * 0.07)); },
      jackpot: (c) => { [659, 784, 988, 1319, 1568].forEach((f, i) => tone(c, f, 0.3, 'triangle', 0.12, i * 0.06)); tone(c, 2093, 0.5, 'sine', 0.06, 0.32); },
      pickup: (c) => { tone(c, 988 * r(), 0.1, 'triangle', 0.1); tone(c, 1319, 0.14, 'triangle', 0.08, 0.06); },
      full: (c) => { tone(c, 180, 0.18, 'square', 0.07); tone(c, 150, 0.22, 'square', 0.07, 0.12); },
      cart: (c) => { noise(c, 0.22, 0.16, 0, 900, 'bandpass'); tone(c, 260, 0.12, 'triangle', 0.08, 0.05); tone(c, 330, 0.12, 'triangle', 0.06, 0.12); },
      // combat
      swing: (c) => { noise(c, 0.12, 0.18, 0, 1800 * r(), 'bandpass'); },
      shoot: (c) => { tone(c, 520 * r(), 0.12, 'triangle', 0.1, 0, -300); noise(c, 0.08, 0.2, 0, 2600, 'highpass'); },
      hit: (c, w) => { const p = r(); noise(c, 0.08, 0.4, w, 1400 * p, 'lowpass'); tone(c, 160 * p, 0.1, 'square', 0.12, w, -60); },
      crit: (c, w) => { noise(c, 0.1, 0.5, w, 2200, 'bandpass'); tone(c, 880, 0.12, 'square', 0.1, w); tone(c, 1320, 0.16, 'triangle', 0.1, (w || 0) + 0.05); },
      skill: (c) => { tone(c, 330, 0.35, 'sawtooth', 0.08, 0, 660); noise(c, 0.25, 0.25, 0.05, 1200, 'bandpass'); tone(c, 990, 0.2, 'triangle', 0.1, 0.18); },
      roll: (c) => { noise(c, 0.24, 0.3, 0, 700, 'bandpass'); tone(c, 200, 0.2, 'sine', 0.14, 0, 240); tone(c, 1046, 0.3, 'triangle', 0.05, 0.12); tone(c, 1568, 0.3, 'sine', 0.035, 0.18); },
      block: (c) => { noise(c, 0.07, 0.3, 0, 2400, 'bandpass'); tone(c, 330, 0.1, 'triangle', 0.1); },
      parry: (c) => { tone(c, 1568, 0.18, 'triangle', 0.16); tone(c, 2093, 0.3, 'sine', 0.1, 0.05); noise(c, 0.08, 0.3, 0, 5000, 'highpass'); },
      breakShield: (c) => { noise(c, 0.3, 0.4, 0, 1800, 'bandpass'); [660, 440, 300].forEach((f, i) => tone(c, f, 0.15, 'square', 0.06, i * 0.06)); },
      potion: (c) => { for (let i = 0; i < 4; i++) tone(c, 400 + i * 140 + Math.random() * 60, 0.09, 'sine', 0.14, i * 0.06, 200); tone(c, 1046, 0.3, 'triangle', 0.08, 0.26); },
      hurt: (c, w) => { tone(c, 240, 0.22, 'sawtooth', 0.12, w, -140); noise(c, 0.1, 0.3, w, 700, 'lowpass'); },
      kill: (c, w) => { tone(c, 300, 0.25, 'square', 0.08, w, -220); noise(c, 0.2, 0.2, w, 500, 'lowpass'); },
      slam: (c) => { tone(c, 70, 0.4, 'sine', 0.4, 0, -30); noise(c, 0.4, 0.4, 0, 300, 'lowpass'); },
      warn: (c) => { tone(c, 880, 0.1, 'square', 0.06); tone(c, 880, 0.1, 'square', 0.06, 0.15); },
      // salles
      room: (c) => { noise(c, 0.25, 0.12, 0, 600, 'lowpass'); tone(c, 196, 0.2, 'triangle', 0.08, 0.05); },
      exit: (c) => { [392, 523, 659, 784].forEach((f, i) => tone(c, f, 0.25, 'triangle', 0.1, i * 0.08)); },
      reinforce: (c) => { [220, 196].forEach((f, i) => tone(c, f, 0.3, 'sawtooth', 0.1, i * 0.18)); noise(c, 0.4, 0.12, 0, 400, 'lowpass'); },
      elite: (c) => { [110, 104, 98].forEach((f, i) => tone(c, f, 0.4, 'sawtooth', 0.12, i * 0.22)); noise(c, 0.6, 0.15, 0, 300, 'lowpass'); },
      victory: (c) => { [523, 659, 784, 1046].forEach((f, i) => tone(c, f, 0.3, 'square', 0.08, i * 0.11)); tone(c, 1046, 0.6, 'triangle', 0.1, 0.44); },
      death: (c) => { [392, 349, 311, 262].forEach((f, i) => tone(c, f, 0.45, 'triangle', 0.13, i * 0.25)); }
    };

    /* ---- musique : séquenceur simple (mélodie + basse + percussions) ---- */
    const N = (n) => 440 * Math.pow(2, (n - 69) / 12); // note MIDI → Hz
    // _ = silence ; chaque thème : tempo, timbres, mélodie (2 × 16 pas), basse (16 pas), motif de percussions
    const _ = null;
    const THEMES = {
      mine: { bpm: 84, lead: 'square', leadVol: 0.05, bass: 'triangle', bassVol: 0.12, hat: 0, kick: 'x...x...x...x.x.',
        mel: [69, _, 72, _, 76, _, 74, 72, 69, _, _, _, 67, _, 69, _, 69, _, 72, _, 77, _, 76, 74, 72, _, 71, _, 69, _, _, _],
        bas: [45, _, _, _, 45, _, _, _, 41, _, _, _, 43, _, _, _] },
      foret: { bpm: 100, lead: 'sine', leadVol: 0.09, bass: 'triangle', bassVol: 0.1, hat: 0.03, kick: 'x.....x...x.....',
        mel: [74, _, 76, 77, 79, _, 77, 76, 74, _, 72, _, 74, _, _, _, 69, _, 72, 74, 76, _, 74, 72, 71, _, 72, 71, 69, _, _, _],
        bas: [50, _, 57, _, 48, _, 55, _, 50, _, 57, _, 45, _, 52, _] },
      champ: { bpm: 124, lead: 'square', leadVol: 0.045, bass: 'square', bassVol: 0.05, hat: 0.04, kick: 'x...x...x...x...',
        mel: [72, _, 76, _, 79, _, 76, _, 81, 79, 76, _, 74, _, 72, _, 74, _, 77, _, 81, _, 79, 77, 76, _, 74, _, 72, _, _, _],
        bas: [48, _, 55, _, 53, _, 55, _, 48, _, 55, _, 50, _, 55, _] }
    };
    let music = null; // { mode, step, next, timer }
    function startMusic(mode) {
      if (music && music.mode === mode) return;
      stopMusic();
      const c = audio();
      if (!c || !THEMES[mode]) return;
      const T = THEMES[mode], step = 60 / T.bpm / 2; // croches
      music = { mode, step: 0, next: c.currentTime + 0.1 };
      music.timer = setInterval(() => {
        // on planifie un peu d'avance (lecture régulière même si la page ralentit)
        while (music && music.next < c.currentTime + 0.25) {
          const i = music.step, w = music.next - c.currentTime;
          const m = T.mel[i % T.mel.length], b = T.bas[i % T.bas.length];
          if (m) tone(c, N(m), step * 1.6, T.lead, T.leadVol, w, 0, musBus);
          if (b) tone(c, N(b), step * 3.5, T.bass, T.bassVol, w, 0, musBus);
          if (T.kick[i % 16] === 'x') tone(c, 110, 0.12, 'sine', 0.18, w, -70, musBus);
          if (T.hat && i % 2 === 1) noise(c, 0.04, T.hat, w, 7000, 'highpass', musBus);
          music.step++; music.next += step;
        }
      }, 60);
    }
    function stopMusic() { if (music) { clearInterval(music.timer); music = null; } }

    return {
      // gap : délai minimal (s) entre deux déclenchements du même effet
      play(k, gap) {
        const now = performance.now() / 1000;
        if (gap && last[k] && now - last[k] < gap) return;
        last[k] = now;
        const c = audio(); if (c && SFX[k] && !prefs.muted) SFX[k](c, 0);
      },
      startMusic, stopMusic,
      musicMode: () => (music ? music.mode : null),
      prefs,
      set(key, v) { prefs[key] = v; save(); applyVolumes(); },
      toggle() { prefs.muted = !prefs.muted; save(); applyVolumes(); return prefs.muted; },
      muted: () => prefs.muted
    };
  })();

  // Réglages du son : coupure + volumes de la musique et des effets
  function soundControls() {
    const slider = (key, label) => el('label', { class: 'mini-vol small' }, label,
      el('input', { type: 'range', min: 0, max: 100, value: Math.round(Sound.prefs[key] * 100), oninput: (e) => { Sound.set(key, e.target.value / 100); if (key === 'sfx') Sound.play('swing'); } }));
    return el('div', { class: 'mini-sound' },
      el('button', { class: 'mini-mute', title: 'Activer / couper tous les sons', onclick: (e) => { e.currentTarget.textContent = Sound.toggle() ? '🔇' : '🔊'; } }, Sound.muted() ? '🔇' : '🔊'),
      slider('music', '🎵 Musique'), slider('sfx', '💥 Effets'));
  }

  /* ============================== Outils ============================== */
  // Couleurs des éclats selon la ressource
  const CHIPS = { pierre: ['#9aa3ae', '#c4cbd4', '#6b7480', '#e8eef5'], bois: ['#d9b07a', '#a8703f', '#e6c08a', '#83532c'], baies: ['#5a4fd6', '#c0306a', '#7a6ae6', '#4f9e3a'] };
  const resIcon = (r) => (GD.RESOURCES[r] || { icon: '?' }).icon;
  const clone = (a) => (a || []).map((x) => ({ ...x }));
  const runKey = (r) => `${r.mode}:${r.seed}`;
  const fmtTime = (ms) => { const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min ${String(s % 60).padStart(2, '0')}`; };
  const fmtMs = (ms) => { const s = Math.ceil(ms / 1000), m = Math.floor(s / 60); return m ? `${m} min ${String(s % 60).padStart(2, '0')}` : `${s} s`; };
  const fmtH = (ms) => { const m = Math.ceil(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
  // « 🪨 45 · 🦴 2 » à partir de totaux { res, tro }
  const totText = (o) => [...Object.entries((o && o.res) || {}).filter(([, n]) => n > 0).map(([k, n]) => `${resIcon(k)} ${n}`),
    ...Object.entries((o && o.tro) || {}).filter(([, n]) => n > 0).map(([k, n]) => `${(M.TROPHIES[k] || { icon: k }).icon} ${n}`)].join(' · ');
  const cartWord = (skin) => (skin === 'seau' ? { icon: '🪣', name: 'Seau', the: 'le seau', of: 'du seau' } : { icon: '🛒', name: 'Charrette', the: 'la charrette', of: 'de la charrette' });
  const isTouch = () => { try { return 'ontouchstart' in window && window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };
  // cases de la poche sécurisée (les plus précieuses du sac, comme au serveur)
  function safeSlots(bag) {
    const val = (s) => (s.t ? (M.TROPHIES[s.t] && M.TROPHIES[s.t].rare ? 1e4 : 1e3) : s.n);
    return new Set(bag.map((s, i) => i).sort((a, b) => val(bag[b]) - val(bag[a])).slice(0, M.BAG.pocket));
  }

  /* ============================== Données ============================== */
  async function load() {
    try { state = (await api('/api/mini')).mini; render(); } catch (e) { /* hors ligne */ }
  }
  // Actions du camp (départ, améliorations, familiers)
  async function send(path, body) {
    if (busy) return;
    busy = true;
    try {
      const r = await api(path, { body });
      state = r.mini;
      if (r.user && window.PlayerApp) window.PlayerApp.setUser(r.user);
      busy = false; render();
    } catch (e) { busy = false; toast(e.message); render(); }
  }

  /* Actions d'expédition : chaque appel emporte le rapport de la salle (monstres tués, opérations sur le sac,
   * PV). Les appels passent l'un après l'autre ; les opérations faites pendant un appel sont rejouées sur
   * l'inventaire renvoyé par le serveur. */
  let queue = Promise.resolve();
  function call(action, extra, opts) {
    const p = queue.then(() => doCall(action, extra, opts || {}));
    queue = p.catch(() => {});
    return p;
  }
  async function doCall(action, extra, opts) {
    const g = G, s = g && g.sim;
    const body = { action, ...(extra || {}) };
    let ops = [];
    if (s && action !== 'close') {
      ops = s.ops.splice(0);
      body.report = { k: [...s.killed], ops, hp: Math.round(s.hero.hp), pets: s.pets.map((p) => Math.max(0, Math.round(p.hp))) };
      g.sentKills = s.killed.size;
    }
    try {
      const r = await api('/api/mini/act', { body });
      if (r.user && window.PlayerApp && ['reward', 'die', 'home', 'close'].includes(action)) window.PlayerApp.setUser(r.user);
      if (G === g && g) applyServer(r.mini, action); else state = r.mini;
      return r;
    } catch (e) {
      if (e.data && e.data.mini) { if (G === g && g) applyServer(e.data.mini, null); else state = e.data.mini; } // rapport pris en compte, action refusée
      else if (s && ops.length) s.ops.unshift(...ops); // pas de réponse : ces opérations repartiront au prochain appel
      if (!opts.silent) toast(e.message);
      throw e;
    }
  }
  // rejoue sur le sac les opérations pas encore envoyées
  function replayOps(bag, cap, ops, room, run) {
    const res = M.MODES[run.mode].res;
    for (const op of ops) {
      if (op[0] === 'h') X.addRes(bag, cap, res, op[2]);
      else if (op[0] === 'p') {
        const mm = /^m(\d+)_(\d+)$/.exec(op[1]);
        if (mm) { const mob = X.mobAt(room, +mm[1]); if (mob && mob.drops[+mm[2]]) X.addTrophy(bag, cap, mob.drops[+mm[2]]); }
        else { const pile = (run.cur.extra || []).find((x) => x.id === op[1]); if (pile) X.addRes(bag, cap, pile.res, op[2]); }
      }
    }
  }
  // Réponse du serveur pendant une expédition
  function applyServer(mini, action) {
    state = mini;
    const run = mini.run;
    if (!run || !G || G.key !== runKey(run)) { render(); return; }
    if (run.state === 'over') { updateLog(); openOver(); return; }
    if (run.room !== G.roomNo) { startRoom(run); updateLog(); return; }
    const s = G.sim, pend = s.ops;
    s.bag.splice(0, s.bag.length, ...clone(run.bag));
    replayOps(s.bag, run.bagCap, pend, G.room, run);
    s.bagCap = run.bagCap;
    if (s.cart) {
      s.cart.items = clone(run.cart.items);
      const here = !run.cart.back;
      if (s.cart.here && !here) cartLeaves();
      s.cart.here = here;
    }
    s.potions = Math.max(0, run.potions - pend.filter((o) => o[0] === 'pot').length);
    s.hero.buff = { dmg: run.buff.dmg || 0, crit: run.buff.crit || 0 };
    if (action === 'reward') {
      s.hero.max = run.max; s.hero.hp = Math.min(run.max, run.hp);
      for (const x of run.cur.extra || []) {
        const left = x.n - ((run.cur.picked || {})[x.id] || 0);
        if (left > 0 && !s.drops.some((d) => d.id === x.id)) s.drops.push({ id: x.id, r: x.res, n: left, x: x.x, y: x.y });
      }
      X.openExit(s);
    }
    if (run.state === 'reward' && G.panel !== 'reward') openReward();
    updateLog();
    if (G.panel === 'cart') renderCart();
  }

  /* ============================== Interface du camp ============================== */
  function render() {
    const root = $('#miniRoot');
    if (!root || !state) return;
    if (state.run) {
      if (!G || G.key !== runKey(state.run)) startGame(state.run);
      else if (G.roomNo !== state.run.room && state.run.state !== 'over') startRoom(state.run);
      root.replaceChildren(header(), runView());
      if (state.run.state === 'over') openOver();
      else Sound.startMusic(state.run.mode);
    } else {
      G = null;
      root.replaceChildren(header(), lobby());
      Sound.stopMusic();
    }
  }

  function header() {
    const bolts = Array.from({ length: state.max }, (_, i) => el('span', { class: 'mini-bolt' + (i < state.energy ? ' on' : '') }, '⚡'));
    const tro = Object.entries(state.trophies || {}).filter(([, n]) => n > 0);
    return el('div', { class: 'panel mini-head' },
      el('div', {}, el('b', {}, 'Énergie '), ...bolts,
        el('span', { class: 'small muted', id: 'miniTimer' }, state.nextIn !== null ? ` · prochaine dans ${fmtTime(state.nextIn)}` : ' · au maximum')),
      el('div', { class: 'mini-res' }, ...GD.RES_IDS.map((k) => el('span', { class: 'chip' }, `${GD.RESOURCES[k].icon} ${state.res[k] || 0} ${GD.RESOURCES[k].name.toLowerCase()}`)),
        ...tro.map(([k, n]) => el('span', { class: 'chip', title: M.TROPHIES[k].name }, `${M.TROPHIES[k].icon} ${n}`))),
      soundControls());
  }

  const statText = (k, v) => (k === 'armor' || k === 'crit' ? `${Math.round(v * 100)} %` : k === 'haste' ? `+${Math.round(v * 100)} %` : String(Math.round(v)));
  function upgradeRow(id) {
    const key = id.split('_')[0], U = M.UPGRADES[key], lvl = state.up[id] || 0;
    const cost = GD.miniUpgradeCost(id, lvl), max = lvl >= U.max;
    const stock = U.trophy ? state.trophies || {} : state.res;
    const ok = !max && cost && GD.canPay(stock, cost);
    let cur = '';
    if (U.stat) cur = statText(U.stat, GD.miniStats(state.up)[U.stat]) + (max ? '' : ` → ${statText(U.stat, GD.miniStats({ ...state.up, [id]: lvl + 1 })[U.stat])}`);
    else if (key === 'sac') cur = `${X.bagCap(state.up)} cases${max ? ' + poche sécurisée' : ` → ${X.bagCap({ ...state.up, sac: lvl + 1 })}${lvl + 1 >= U.max ? ' + poche' : ''}`}`;
    else if (key === 'chariot') cur = `${X.cartCap(state.up)} cases${max ? '' : ` → ${X.cartCap({ ...state.up, chariot: lvl + 1 })}`}`;
    const name = U.perRes ? `${U.name} (${GD.RESOURCES[id.split('_')[1]].icon} ${GD.RESOURCES[id.split('_')[1]].name.toLowerCase()})` : U.name;
    return el('div', { class: 'mini-up' },
      el('span', {}, `${U.icon} ${name} `, cur ? el('b', {}, cur + ' ') : '', el('span', { class: 'small muted' }, `niv. ${lvl}/${U.max} — ${U.desc}`)),
      el('button', { disabled: !ok || busy, title: U.trophy ? 'Payé avec les butins des monstres' : '', onclick: () => send('/api/mini/upgrade', { id }) }, max ? 'Max' : GD.miniCostText(cost)));
  }

  // Vignette d'un mini-jeu : une salle vue du dessus (dessinée une fois)
  const NODE_SC = [0.8, 0.6, 0.82];
  const thumbs = {};
  function thumbCanvas(mode) {
    const c = el('canvas', { class: 'mini-thumb', width: 480, height: 300 });
    requestAnimationFrame(() => {
      if (!thumbs[mode]) {
        const room = X.genRoom(mode, 4242, 1, {}), cv = document.createElement('canvas');
        cv.width = 480; cv.height = 300;
        const x = cv.getContext('2d');
        x.scale(0.5, 0.5); x.drawImage(D.drawRoomBg(room), 0, 0);
        D.drawExit(x, room, 0.5);
        const me = window.PlayerApp && window.PlayerApp.me(), MD = M.MODES[mode];
        const L = room.nodes.map((n) => [n.y, () => { x.save(); x.translate(n.x, n.y + 8); x.scale(NODE_SC[n.k], NODE_SC[n.k]); A.drawResNode(x, n.k, 0, 0, 100, 0.5, n.i); x.restore(); }]);
        room.mobs.forEach((m) => L.push([m.y, () => A.drawMob(x, m.type, m.x, m.y, { size: A.mobFit(m.type, m.r * 3.3, m.r * 3.4), t: 0.3 + m.i, facing: m.x > room.entry.x ? Math.PI : 0 })]));
        L.push([room.cart.y, () => A.drawCart(x, room.cart.x, room.cart.y, { skin: MD.cart, fill: 0.6, res: MD.res, t: 0 })]);
        if (me) L.push([room.entry.y, () => A.drawHero(x, room.entry.x, room.entry.y, { cls: me.cls, look: me.look, gear: window.PlayerApp.myGear(), t: 0, scale: 1.2, facing: 0, moving: false })]);
        L.sort((a, b) => a[0] - b[0]).forEach((e) => e[1]());
        thumbs[mode] = cv;
      }
      c.getContext('2d').drawImage(thumbs[mode], 0, 0);
    });
    return c;
  }

  function lobby() {
    const cards = Object.entries(M.MODES).map(([k, m]) => {
      const R = GD.RESOURCES[m.res], T3 = m.trophies, cw = cartWord(m.cart);
      return el('div', { class: 'panel mini-card' },
        thumbCanvas(k),
        el('h3', {}, `${m.icon} ${m.name}`),
        el('p', { class: 'small' }, m.desc),
        el('p', { class: 'small muted' }, `Rapporte : ${R.icon} ${R.name.toLowerCase()} · butins : ${T3.common.map((t) => `${M.TROPHIES[t].icon} ${M.TROPHIES[t].name.toLowerCase()}`).join(', ')}, ${M.TROPHIES[T3.rare].icon} ${M.TROPHIES[T3.rare].name.toLowerCase()} (rare)`),
        el('p', { class: 'small' }, `🏆 Record : salle ${state.best[k] || 0} · ${cw.icon} ${cw.name} · sortie : ${m.exit === 'hole' ? 'cavité dans le sol' : 'ouverture sur un côté'}`),
        el('button', { class: 'primary', disabled: state.energy < 1 || busy, onclick: () => send('/api/mini/start', { mode: k }) }, `${m.verb} (1 ⚡)`),
        el('div', { class: 'mini-ups' }, ...['luck', 'bounty', 'jackpot', 'fortune'].map((u) => upgradeRow(`${u}_${k}`))));
    });
    const T = state.trophies || {};
    return el('div', {},
      el('div', { class: 'grid three' }, ...cards),
      petsPanel(),
      el('div', { class: 'panel' }, el('h2', {}, 'Améliorations générales'),
        el('h3', { class: 'mini-sub' }, 'Statistiques d’expédition'),
        el('p', { class: 'small muted' }, 'Dans les mini-jeux, ton héros n’utilise pas ses statistiques de bataille : il a ses propres statistiques d’expédition, améliorées ici avec tes ressources.'),
        ...Object.keys(M.UPGRADES).filter((k) => M.UPGRADES[k].stat && !M.UPGRADES[k].trophy).map((k) => upgradeRow(k)),
        el('h3', { class: 'mini-sub' }, 'Vitesse, sac et seau / charrette (butins des monstres)'),
        el('div', { class: 'mini-res' }, ...Object.entries(M.TROPHIES).map(([k, t]) => el('span', { class: 'chip' + ((T[k] || 0) > 0 ? '' : ' muted'), title: `${t.name} (${t.zone ? M.MODES[t.zone].name : 'élites et gardiens, toutes zones'})` }, `${t.icon} ${T[k] || 0} ${t.name.toLowerCase()}${t.rare ? ' ★' : ''}`))),
        upgradeRow('vitesse'), upgradeRow('endurance'), upgradeRow('cadence'), upgradeRow('sac'), upgradeRow('chariot'),
        el('h3', { class: 'mini-sub' }, 'Équipement et récolte'),
        upgradeRow('potion'), ...GD.RES_IDS.map((k) => upgradeRow('harvest_' + k))),
      el('div', { class: 'panel small' }, el('h2', {}, 'Comment ça marche'),
        el('ul', {},
          el('li', {}, `Une expédition coûte 1 ⚡ (1 énergie toutes les ${M.ENERGY_HOURS} h, ${M.ENERGY_MAX} au plus). Tu diriges ton héros en temps réel, vu du dessus, avec ses statistiques d’expédition (et jusqu’à ${PT.ACTIVE_MAX} familiers).`),
          el('li', {}, `Commandes : ZQSD ou flèches pour bouger (Maj pour sprinter) · clic gauche (maintenu) pour attaquer vers la souris ou récolter le point visé · clic droit (maintenu) pour le bouclier · E : compétence · A : potion · Maj : sprint · Espace : roulade (un bond, puis ${M.ROLL.invuln} s d’invulnérabilité, ${M.ROLL.cost} d’endurance) · F : seau / charrette · Échap : pause. Sur téléphone : joystick et boutons.`),
          el('li', {}, `Bouclier : il encaisse les coups avec ses points. Levé juste avant un coup (${Math.round(M.SHIELD.parryWindow * 1000)} ms), c’est une parade parfaite : aucun dégât et le coup est renvoyé (les projectiles repartent vers les monstres).`),
          el('li', {}, `Chaque salle contient des points de récolte et des monstres. La sortie apparaît au bout de ${M.ROOMS.normal.exit} s (une cavité dans la caverne, une ouverture sur un côté ailleurs) ; ${M.REINFORCE.after} s après ton entrée (un peu plus en profondeur), des renforts arrivent toutes les ${M.REINFORCE.every} s, sauf dans les salles d’élite et de gardien. Salles riches (beaucoup de récolte, sortie à ${M.ROOMS.riche.exit} s), salles de repos (fontaine de soin), élite toutes les ${M.ELITE_EVERY} salles et gardien de zone toutes les ${M.BOSS_EVERY} : la sortie ne s’ouvre qu’une fois vaincus, avec une récompense au choix (${Math.round(PT.EGG_CHANCE * 100)} % de chances d’un œuf de familier).`),
          el('li', {}, `Sac : ${M.BAG.base} cases (+${M.BAG.per} par niveau) ; une case = ${M.HARVEST.slot} ressources ou 1 butin de monstre. Vide-le dans le seau (caverne) ou la charrette (forêt, clairière) : ${M.CART.base} cases (+${M.CART.per} par niveau), il ou elle t’attend à un endroit différent de chaque salle (et te rejoint d’une salle à l’autre avec son contenu). « Renvoyer » met son contenu à l’abri à la base (retour ${M.CART.away} salles plus tard) ; « Rentrer » termine l’expédition avec tout, une fois les monstres de départ de la salle éliminés.`),
          el('li', {}, `Si ton héros tombe, tout ce qui n’a pas été renvoyé est perdu (butins compris), sauf ${Math.round(M.DEATH_KEEP * 100)} % des ressources du sac — et la poche sécurisée (sac au niveau max : ses ${M.BAG.pocket} cases les plus précieuses sont gardées).`),
          el('li', {}, 'Les ressources améliorent les statistiques d’expédition et ta récolte en défense de tour ; les butins des monstres agrandissent le sac et le seau / la charrette.'))));
  }

  /* ============================== Familiers ============================== */
  const petSize = (kind) => (PT.KINDS[kind] && PT.KINDS[kind].size) || (GD.MOBS[kind] ? GD.MOBS[kind].size : 13);
  const rarityOf = (r) => GD.RARITIES[r || 0];
  // vignette d'un familier (dessinée une fois)
  function petThumb(kind, stage, w = 96, h = 72) {
    const c = el('canvas', { class: 'pet-thumb', width: w, height: h });
    requestAnimationFrame(() => { const x = c.getContext('2d'); A.drawPet(x, GD.petSprite(kind), w / 2, h - 10, { size: petSize(kind) * 1.4, maxH: h - 22, t: 0.3, facing: 0, stage, moving: false }); });
    return c;
  }
  // Œuf (couleur selon le mini-jeu) ; il tremble quand il est prêt à éclore
  const EGG_COL = { mine: ['#d8d2c4', '#8a8f96'], foret: ['#e8f0d8', '#5aa04a'], champ: ['#efe6f5', '#7a4fd6'] };
  function eggCanvas(e) {
    const c = el('canvas', { class: 'pet-thumb', width: 96, height: 72, 'data-egg': e.id });
    const [base, spot] = EGG_COL[e.mode] || EGG_COL.mine;
    let t = Math.random() * 5;
    (function loop() {
      if (!c.isConnected && t > 6) return;
      t += 1 / 60;
      const x = c.getContext('2d'); x.clearRect(0, 0, 96, 72);
      const ready = c.dataset.ready === '1';
      x.save(); x.translate(48, 62);
      A.shadow(x, 0, 2, 18, 5);
      x.rotate(ready ? Math.sin(t * 14) * 0.12 * (Math.sin(t * 2) > 0.3 ? 1 : 0.2) : Math.sin(t * 1.5) * 0.03);
      x.beginPath(); x.ellipse(0, -24, 17, 23, 0, 0, Math.PI * 2); x.fillStyle = base; x.fill(); x.lineWidth = 2.5; x.strokeStyle = '#120c0a'; x.stroke();
      x.fillStyle = spot; for (const [sx, sy, r] of [[-7, -32, 4], [6, -20, 5], [-4, -12, 3], [8, -36, 3]]) { x.beginPath(); x.arc(sx, sy, r, 0, Math.PI * 2); x.fill(); }
      x.fillStyle = 'rgba(255,255,255,.5)'; x.beginPath(); x.ellipse(-7, -34, 3, 6, -0.4, 0, Math.PI * 2); x.fill();
      if (ready) { x.strokeStyle = '#120c0a'; x.lineWidth = 2; x.beginPath(); x.moveTo(-12, -26); x.lineTo(-5, -21); x.lineTo(1, -27); x.lineTo(7, -21); x.lineTo(13, -26); x.stroke(); }
      x.restore();
      if (ready) { x.save(); x.translate(48, 38); x.globalAlpha = 0.35 + 0.2 * Math.sin(t * 4); A.glow(x, '#ffd23a', 30); x.restore(); }
      requestAnimationFrame(loop);
    })();
    return c;
  }
  async function hatchEgg(id) {
    if (busy) return;
    busy = true;
    try {
      const r = await api('/api/pets/hatch', { body: { id } });
      state = r.mini;
      if (r.user && window.PlayerApp) window.PlayerApp.setUser(r.user);
      busy = false; render(); showHatch(r.hatch);
    } catch (e) { busy = false; toast(e.message); render(); }
  }
  function petsPanel() {
    const P = state.pets || { list: [], active: [] }, me = window.PlayerApp && window.PlayerApp.me();
    const inRun = !!(state.run && state.run.state !== 'over'), fioles = (state.trophies || {}).fiole || 0;
    const toggle = (id) => {
      const on = P.active.includes(id);
      const ids = on ? P.active.filter((x) => x !== id) : [...P.active, id].slice(-PT.ACTIVE_MAX);
      send('/api/pets/active', { ids });
    };
    const mine = P.list.map((p) => {
      const R = rarityOf(p.rarity), K = PT.KINDS[p.kind], on = P.active.includes(p.id), main = P.main === p.id;
      const hpPct = Math.max(0, Math.min(100, (100 * p.hp) / p.max));
      return el('div', { class: 'pet-card' + (on ? ' on' : ''), style: `border-color:${R.color}` },
        petThumb(p.kind, p.stage),
        el('div', { class: 'pet-name' }, el('b', {}, GD.petName(p.kind)), K && K.kennel ? '' : el('span', { class: 'small', style: `color:${R.color}` }, ` ${R.name}`)),
        el('div', { class: 'small muted' }, `Niv. ${p.level}${p.level < PT.MAX_LEVEL ? ` · ${p.xp}/${p.xpNext} XP` : ' (max)'}${p.stage ? ` · ${['', '✨ évolué', '👑 évolution finale'][p.stage]}` : ''}`),
        el('div', { class: 'bar pet-hp' }, el('span', { style: `width:${hpPct}%;background:${p.ko ? '#8a8494' : hpPct > 40 ? '#5cb84a' : '#e2504c'}` })),
        el('div', { class: 'small' }, p.ko ? `💤 Au repos : ${p.hp}/${p.max} PV · prêt dans ${fmtH(p.readyIn)}` : `❤️ ${p.hp}/${p.max} PV`),
        el('ul', { class: 'pet-fx small' }, ...GD.petFxText(p.kind, p.rarity).map((t) => el('li', {}, t))),
        el('div', { class: 'pet-btns' },
          el('button', { class: on ? 'primary' : '', disabled: busy || inRun || (p.ko && !on), title: inRun ? 'Impossible pendant une expédition' : '', onclick: () => toggle(p.id) }, on ? '✓ Actif' : 'Activer'),
          p.hp < p.max || p.ko ? el('button', { disabled: busy || inRun || !(fioles > 0), title: fioles > 0 ? 'Utilise une potion de familier : PV au maximum, fin du repos' : 'Pas de potion de familier (butin rare des élites et des gardiens)', onclick: () => send('/api/pets/heal', { id: p.id }) }, `🧴 Soigner (${fioles})`) : '',
          el('button', { class: main ? 'selected' : '', disabled: busy || p.level < PT.MAIN_LEVEL, title: `Familier principal : t’accompagne à côté de ton héros en défense de tour (niveau ${PT.MAIN_LEVEL} minimum, purement esthétique)`, onclick: () => send('/api/pets/main', { id: main ? null : p.id }) }, main ? '⭐ Principal' : '☆ Principal')));
    });
    const kennel = Object.entries(PT.KINDS).filter(([, K]) => K.kennel).map(([kind, K]) => {
      const owned = P.list.some((p) => p.kind === kind), gold = me ? me.gold || 0 : 0;
      return el('div', { class: 'pet-card shop' + (owned ? ' owned' : '') },
        petThumb(kind, 0),
        el('div', { class: 'pet-name' }, el('b', {}, `${K.icon} ${K.name}`)),
        el('div', { class: 'small muted' }, `❤️ ${GD.petMaxHp(kind, 0)} PV`),
        el('ul', { class: 'pet-fx small' }, ...GD.petFxText(kind, 0).map((t) => el('li', {}, t))),
        el('button', { class: owned ? '' : 'primary', disabled: owned || busy || gold < PT.KENNEL_PRICE,
          onclick: async () => { if (await ask(`Adopter ${K.name} pour ${PT.KENNEL_PRICE} Grêlons ?`, { title: '🐾 Chenil', ok: 'Adopter' })) send('/api/pets/buy', { kind }); } },
        owned ? '✓ Adopté' : `🌨️ ${PT.KENNEL_PRICE} Grêlons`));
    });
    return el('div', { class: 'panel' }, el('h2', {}, '🐾 Familiers'),
      el('p', { class: 'small muted' }, `Jusqu’à ${PT.ACTIVE_MAX} familiers t’accompagnent en expédition : ils te suivent et se battent seuls (l’écureuil et le mulot récoltent les points proches, l’ours porte des cases de sac en plus). Les monstres ont ${Math.round(PT.HIT_CHANCE * 100)} % de chances de les viser. Leurs PV ne remontent qu’avec le temps (${Math.round(PT.REGEN_PER_HOUR * 100)} % par heure) ; un familier K.-O. se repose jusqu’à ${Math.round(PT.REST_PCT * 100)} % de ses PV. Une 🧴 potion de familier (butin rare : ${Math.round(M.DROPS.petPotion.elite * 100)} % des élites, ${Math.round(M.DROPS.petPotion.boss * 100)} % des gardiens) le soigne entièrement, même K.-O. Ils gagnent de l’XP à chaque expédition et évoluent (en apparence) aux niveaux ${PT.EVOLVE.join(' et ')}.`),
      (P.eggs || []).length ? el('h3', { class: 'mini-sub' }, '🥚 Œufs en incubation') : '',
      (P.eggs || []).length ? el('div', { class: 'pet-grid' }, ...P.eggs.map((e) => {
        const M2 = M.MODES[e.mode], dec = M2.decors[e.tier] || M2.decors[0], ready = e.readyIn <= 0, cv = eggCanvas(e);
        cv.dataset.ready = ready ? '1' : '0';
        return el('div', { class: 'pet-card egg' },
          cv,
          el('div', { class: 'pet-name' }, el('b', {}, 'Œuf mystérieux')),
          el('div', { class: 'small muted' }, `${M2.icon} ${M2.name} — ${dec.name}`),
          el('div', { class: 'small', 'data-egg-timer': e.id }, ready ? 'Prêt à éclore !' : `Éclosion dans ${fmtMs(e.readyIn)}`),
          el('button', { class: 'primary', 'data-egg-btn': e.id, disabled: !ready || busy, onclick: () => hatchEgg(e.id) }, '🐣 Faire éclore'));
      })) : '',
      el('h3', { class: 'mini-sub' }, `Mes familiers (${P.active.length}/${PT.ACTIVE_MAX} actifs)`),
      P.list.length ? el('div', { class: 'pet-grid' }, ...mine) : el('p', { class: 'small' }, 'Aucun familier pour l’instant : adopte-en un au chenil, ou trouve un œuf !'),
      el('h3', { class: 'mini-sub' }, '🏠 Chenil'),
      el('div', { class: 'pet-grid' }, ...kennel),
      el('p', { class: 'small muted' }, `🥚 Œufs : une élite ou un gardien vaincu a ${Math.round(PT.EGG_CHANCE * 100)} % de chances de proposer un « Œuf mystérieux ». Il éclot ${PT.INCUBATION_MIN} minutes plus tard (gardé même si tu tombes) et contient un monstre de la zone, avec une rareté (commune = puissance du chenil, puis de plus en plus fort). En double, il devient une meilleure rareté de ton familier, ou des ressources de la zone (${PT.DUP_RES.join(' / ')} selon la rareté).`));
  }

  // Éclosion d'un œuf : fenêtre avec le familier obtenu
  function showHatch(h) {
    const R = rarityOf(h.rarity);
    const c = el('canvas', { width: 220, height: 150, class: 'pet-hatch' });
    let t = 0;
    (function loop() {
      if (!c.isConnected && t > 0.1) return;
      t += 1 / 60;
      const x = c.getContext('2d'); x.clearRect(0, 0, 220, 150);
      x.save(); x.translate(110, 90); A.glow(x, R.color, 50 + Math.sin(t * 3) * 6); x.restore();
      A.drawPet(x, GD.petSprite(h.kind), 110, 128, { size: petSize(h.kind) * 2, maxH: 100, t, facing: 0, moving: false });
      requestAnimationFrame(loop);
    })();
    Sound.play('jackpot');
    const txt = h.result === 'new' ? `${GD.petName(h.kind)} rejoint tes familiers !`
      : h.result === 'upgrade' ? `Ton ${GD.petName(h.kind)} devient ${R.name} !`
        : `Tu as déjà ce familier : il est converti en ${h.amount} ${GD.RESOURCES[h.res].icon} ${GD.RESOURCES[h.res].name.toLowerCase()}.`;
    ask(el('div', { style: 'text-align:center' }, c, el('div', { style: `color:${R.color};font-weight:700` }, `${GD.petName(h.kind)} · ${R.name}`), el('div', {}, txt)),
      { title: '🥚 L’œuf éclot !', ok: 'Super !', noCancel: true });
  }

  /* ============================== Expédition ============================== */
  function startGame(run) {
    const k = Math.min(2, Math.max(1, Math.round((window.devicePixelRatio || 1) * 2) / 2));
    const cv = el('canvas', { class: 'mini-canvas', width: AW * k, height: AH * k });
    const touch = isTouch();
    G = { key: runKey(run), mode: run.mode, cv, ctx: cv.getContext('2d'), k, overlay: el('div', { class: 'mini-overlay hidden' }), t: 0, roomT: 0,
      keys: {}, touch: {}, joy: { x: 0, y: 0 }, mouse: { x: AW / 2, y: AH / 2, in: false }, lastDir: 0, hover: null,
      fx: [], parts: [], floats: [], trail: [], banner: null, shake: 0, flash: 0, fade: 1, panel: null, busy: false,
      lastSync: 0, sentKills: 0, prevBest: (state.best || {})[run.mode] || 0, touchMode: touch, sim: null };
    G.wrap = el('div', { class: 'mini-game' + (touch ? ' touch' : '') }, cv, G.overlay, touchControls());
    bindCanvas(cv);
    startRoom(run);
    try { if (run.state === 'room' && !localStorage.getItem('miniTutoRt')) { localStorage.setItem('miniTutoRt', '1'); openHelp(true); } } catch (e) { /* */ }
  }

  function startRoom(run) {
    const room = X.genRoom(run.mode, run.seed, run.room, run.gen);
    const me = (window.PlayerApp && window.PlayerApp.me()) || {};
    const wasAway = !!(G.sim && G.sim.cart && !G.sim.cart.here);
    const sim = X.createSim({
      room, cls: me.cls || 'habitant', hp: run.hp, max: run.max, dmg: run.dmg, crit: run.crit, armor: run.armor, shield: run.shield, speed: run.speed, haste: run.haste, stamina: run.stamina,
      buff: { dmg: run.buff.dmg || 0, crit: run.buff.crit || 0 }, pets: clone(run.pets), potions: run.potions,
      bag: clone(run.bag), bagCap: run.bagCap,
      cart: { items: clone(run.cart.items), cap: run.cartCap, here: !run.cart.back, skin: run.cart.skin },
      killed: run.cur.killed, harv: run.cur.harv, picked: run.cur.picked, extra: run.cur.extra, rewardDone: run.cur.reward === 'done'
    });
    // salle reprise (page rechargée) : la sortie tient compte du temps déjà passé
    if (room.boss < 0) { sim.exitAt = Math.max(0, room.exitDelay - (run.roomAge || 0) / 1000); if (sim.exitAt <= 0) X.openExit(sim); }
    sim.events.length = 0;
    Object.assign(G, { room, sim, roomNo: run.room, bg: D.drawRoomBg(room, G.k), amb: makeAmbient(run.mode, room.decor), vig: makeVignette(run.mode, room.decor), roomT: 0, fade: 1, fadeOut: 0, exitCalled: false, deadAt: 0, dieCalled: false,
      fx: [], parts: [], floats: [], trail: [], leaving: null, sentKills: sim.killed.size, lastSync: G.t, retryAt: 0 });
    const RT = M.ROOMS[room.type], dec = M.MODES[run.mode].decors[room.decor];
    banner(`Salle ${run.room}`, `${RT.icon} ${RT.name} · ${dec.name} — ${dec.subs[room.sub]}`, 2.4);
    if (wasAway && sim.cart.here) floatTxt(sim.cart.x, sim.cart.y - 50, `${cartWord(run.cart.skin).icon} De retour !`, '#b8ffb0', 17, 2);
    if (G.decorEl) G.decorEl.textContent = decorText(run, room);
    Sound.play(room.type === 'elite' || room.type === 'gardien' ? 'elite' : 'room');
    closePanel(true);
    if (run.state === 'reward') openReward();
    else if (run.state === 'over') openOver();
  }
  const decorText = (run, room) => { const dec = M.MODES[run.mode].decors[room.decor]; return `· ${dec.name} — ${dec.subs[room.sub]}`; };

  function runView() {
    const r = state.run, mode = M.MODES[r.mode];
    G.decorEl = el('span', { class: 'small muted' }, decorText(r, G.room));
    G.logEl = el('ul', { class: 'mini-log small' });
    updateLog();
    return el('div', { class: 'panel mini-run' },
      el('div', { class: 'mini-runbar' },
        el('b', {}, `${mode.icon} ${mode.name}`), G.decorEl,
        el('span', { class: 'small muted' }, `🏆 record : salle ${G.prevBest}`),
        el('span', { class: 'spacer' }),
        el('button', { onclick: () => { if (G.panel === 'help') closePanel(); else if (!G.panel) openHelp(false); } }, '⏸️ Pause · commandes'),
        el('button', { title: 'Plein écran', onclick: fullscreen }, '⛶')),
      G.wrap, G.logEl);
  }
  function updateLog() {
    if (!G || !G.logEl || !state.run) return;
    G.logEl.replaceChildren(...state.run.log.slice().reverse().map((l, i) => el('li', { style: i ? 'opacity:.7' : 'font-weight:700' }, l)));
  }
  function fullscreen() {
    const w = G && G.wrap;
    if (!w) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (w.requestFullscreen) w.requestFullscreen().catch(() => toast('Plein écran indisponible'));
  }

  /* ============================== Panneaux (seau, récompense, pause, fin) ============================== */
  function showOverlay(node) { G.overlay.replaceChildren(node); G.overlay.classList.remove('hidden'); }
  function closePanel(force) {
    if (!G || (G.panel === 'over' && !force)) return;
    G.panel = null;
    G.overlay.classList.add('hidden'); G.overlay.replaceChildren();
    if (G.sim) G.sim.timeScale = 1;
    releaseKeys();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  function toggleCart() {
    if (!G || !G.sim) return;
    if (G.panel === 'cart') return closePanel();
    if (G.panel) return;
    const s = G.sim, run = state.run, cw = cartWord(run.cart.skin), h = s.hero;
    if (!s.cart || !s.cart.here) return floatTxt(h.x, h.y - 70, `${cw.icon} ${cw.name} parti${run.cart.skin === 'seau' ? '' : 'e'} · retour salle ${run.cart.back}`, '#ffd0a0', 15);
    if (!X.nearCart(s)) return floatTxt(h.x, h.y - 70, `Approche-toi ${cw.of}`, '#ffffff', 15);
    G.panel = 'cart'; releaseKeys(); renderCart(); Sound.play('cart');
  }
  function renderCart() {
    if (!G || G.panel !== 'cart') return;
    const s = G.sim, run = state.run, cw = cartWord(run.cart.skin), safe = run.pocket ? safeSlots(s.bag) : new Set();
    const slot = (it, i, onClick, isSafe) => el('button', {
      class: 'mini-slot' + (it && it.t ? ' tro' + (M.TROPHIES[it.t] && M.TROPHIES[it.t].rare ? ' rare' : '') : '') + (isSafe ? ' safe' : ''),
      disabled: !onClick || G.busy, title: it ? (it.t ? M.TROPHIES[it.t].name : `${it.n} ${GD.RESOURCES[it.r].name.toLowerCase()}`) : 'Case vide',
      onclick: onClick ? () => onClick(i) : null
    }, it ? (it.t ? M.TROPHIES[it.t].icon : resIcon(it.r)) : '', it && !it.t ? el('span', { class: 'n' }, String(it.n)) : '');
    const bag = Array.from({ length: s.bagCap }, (_, i) => slot(s.bag[i], i, s.bag[i] ? depositSlot : null, safe.has(i)));
    const cart = Array.from({ length: run.cartCap }, (_, i) => slot(s.cart.items[i], i, null, false));
    showOverlay(el('div', { class: 'mini-panel' },
      el('h3', {}, `${cw.icon} ${cw.name}`),
      el('p', { class: 'small muted' }, `Le temps est ralenti. Clique une case du sac pour la déposer dans ${cw.the}. « Renvoyer » : le contenu ${cw.of} part à l’abri à la base, retour ${M.CART.away} salles plus tard. Sinon, ${cw.the} t’attend dans la salle suivante avec son contenu.`),
      el('div', { class: 'mini-cols' },
        el('div', {}, el('b', {}, `🎒 Sac ${s.bag.length} / ${s.bagCap}`), run.pocket ? el('span', { class: 'small muted' }, ' · cases dorées : poche sécurisée') : '',
          el('div', { class: 'mini-slots' }, ...bag), el('div', { class: 'small muted' }, totText(X.totals(s.bag)) || 'Vide')),
        el('div', {}, el('b', {}, `${cw.icon} ${cw.name} ${s.cart.items.length} / ${run.cartCap}`),
          el('div', { class: 'mini-slots' }, ...cart), el('div', { class: 'small muted' }, totText(X.totals(s.cart.items)) || 'Vide'))),
      el('div', { class: 'mini-panel-btns' },
        el('button', { class: 'primary', disabled: G.busy || !s.bag.length, onclick: () => depositSlot('all') }, '⬇️ Tout déposer'),
        el('button', { disabled: G.busy || !s.cart.items.length, title: `Le contenu est à l’abri ; retour ${M.CART.away} salles plus tard`, onclick: sendCart }, '🚚 Renvoyer'),
        el('button', { disabled: G.busy || X.startMobsLeft(s) > 0, title: X.startMobsLeft(s) ? `Élimine d’abord les monstres de la salle (encore ${X.startMobsLeft(s)})` : 'Termine l’expédition : le sac et son contenu sont mis à l’abri', onclick: goHome }, X.startMobsLeft(s) ? `🏠 Rentrer (${X.startMobsLeft(s)} 👹)` : '🏠 Rentrer'),
        el('span', { class: 'spacer' }),
        el('button', { onclick: () => closePanel() }, 'Fermer (F)'))));
  }
  async function depositSlot(i) {
    if (!G || G.busy) return;
    const g = G;
    g.busy = true; renderCart();
    try { await call('deposit', { slot: i }); Sound.play('cart'); } catch (e) { /* message affiché */ }
    g.busy = false; if (G === g) renderCart();
  }
  async function sendCart() {
    if (!G || G.busy) return;
    const g = G;
    g.busy = true; renderCart();
    try { await call('send'); if (G === g && G.panel === 'cart') closePanel(); } catch (e) { /* message affiché */ }
    g.busy = false; if (G === g) renderCart();
  }
  async function goHome() {
    if (!G || G.busy) return;
    const g = G, cw = cartWord(state.run.cart.skin);
    if (!(await ask(`Rentrer à la base avec ${cw.the} ? L’expédition se termine : le contenu du sac et ${cw.of} est mis à l’abri.`, { title: '🏠 Rentrer', ok: 'Rentrer' }))) return;
    g.busy = true;
    try { await call('home'); } catch (e) { /* message affiché */ }
    g.busy = false;
  }
  // le seau / la charrette repart à la base (animation)
  function cartLeaves() {
    const C = G.sim.cart, run = state.run, cw = cartWord(run.cart.skin);
    G.leaving = { x: C.x, y: C.y, t: 0, a: Math.atan2(C.y > AH / 2 ? 1 : -1, 0.4) };
    banner(`${cw.icon} ${cw.name} renvoyé${run.cart.skin === 'seau' ? '' : 'e'} à la base`, `Contenu à l’abri · retour salle ${run.cart.back}`, 2);
    Sound.play('cart');
  }

  function openReward() {
    const r = state.run, B = G.room.mobs[0];
    G.panel = 'reward'; releaseKeys();
    Sound.play('victory');
    showOverlay(el('div', { class: 'mini-panel' },
      el('h3', {}, B && B.boss ? `👑 Gardien vaincu : ${B.name} !` : `⚔️ Élite vaincue : ${B ? B.name : ''} !`),
      el('p', { class: 'small' }, 'Choisis une récompense (la sortie s’ouvre ensuite) :'),
      el('div', { class: 'mini-rewards' }, ...(r.rewards || []).map((k) => {
        const RW = M.ELITE_REWARDS[k];
        return el('button', { class: 'mini-reward' + (k === 'egg' ? ' egg' : ''), onclick: (e) => pickReward(k, e.currentTarget) }, el('b', {}, `${RW.icon} ${RW.name}`), el('span', { class: 'small' }, RW.desc));
      }))));
  }
  async function pickReward(k, btn) {
    if (!G || G.busy) return;
    const g = G;
    g.busy = true; if (btn) btn.disabled = true;
    try {
      await call('reward', { id: k });
      if (G === g) {
        closePanel();
        if (k === 'egg') { Sound.play('jackpot'); toast(`🥚 Œuf trouvé ! Il éclora dans ${PT.INCUBATION_MIN} min (voir les familiers).`); }
        else Sound.play('gain');
      }
    } catch (e) { if (btn) btn.disabled = false; }
    g.busy = false;
  }

  function openHelp(first) {
    if (!G || !state.run) return;
    G.panel = 'help'; releaseKeys();
    const cw = cartWord(state.run.cart.skin), MD = M.MODES[state.run.mode];
    const li = (k, t) => el('li', {}, el('b', {}, k), ' : ', t);
    showOverlay(el('div', { class: 'mini-panel mini-help' },
      el('h3', {}, first ? '🎮 Bienvenue dans l’expédition !' : '⏸️ Pause'),
      el('ul', { class: 'small' },
        li('ZQSD / flèches', 'se déplacer'),
        li('Maj (maintenue)', `sprint (vitesse ×${String(M.SPRINT.mult).replace('.', ',')}) tant qu’il reste de l’endurance`),
        li('Clic gauche (maintenu)', 'attaquer vers la souris — vise un point de récolte pour récolter'),
        li('Clic droit (maintenu)', 'bouclier ; levé juste avant un coup, c’est une parade parfaite : les dégâts sont renvoyés'),
        li('E', 'compétence de classe'),
        li('A', `potion de soin (${Math.round(M.POTION_HEAL * 100)} % des PV)`),
        li('Espace', `roulade : un bond rapide, puis ${M.ROLL.invuln} s d’invulnérabilité (coûte ${M.ROLL.cost} d’endurance, qui ne remonte pas pendant ce temps)`),
        li('F', `ouvrir ${cw.the} quand tu es à côté (le temps ralentit)`),
        li('Échap', 'pause'),
        G.touchMode ? li('Téléphone', `joystick pour bouger, touche la scène ou ⚔️ pour attaquer, 🔰 bouclier, ✨ compétence, 🧪 potion, ${cw.icon} ${cw.the}`) : ''),
      el('ul', { class: 'small muted' },
        el('li', {}, `La sortie apparaît au bout de ${M.ROOMS.normal.exit} s : ${MD.exit === 'hole' ? 'une cavité dans le sol' : 'une ouverture sur un côté'}. ${M.REINFORCE.after} s après ton entrée (un peu plus en profondeur), des renforts arrivent, sauf dans les salles d’élite et de gardien.`),
        el('li', {}, `Sac : 1 case = ${M.HARVEST.slot} ressources ou 1 butin de monstre. Vide-le dans ${cw.the}, posé${cw.the === 'le seau' ? '' : 'e'} à un endroit au hasard dans chaque salle.`),
        el('li', {}, `« Renvoyer » met le contenu ${cw.of} à l’abri (retour ${M.CART.away} salles plus tard) ; « Rentrer » termine l’expédition, une fois les monstres de la salle éliminés.`),
        el('li', {}, `Si ton héros tombe : tout ce qui n’a pas été renvoyé est perdu, sauf ${Math.round(M.DEATH_KEEP * 100)} % des ressources du sac.`)),
      el('div', { class: 'mini-panel-btns' }, el('span', { class: 'spacer' }), el('button', { class: 'primary', onclick: () => closePanel() }, first ? 'C’est parti !' : 'Reprendre'))));
  }

  function openOver() {
    const r = state.run, o = r && r.over;
    if (!G || !o || G.panel === 'over') return;
    G.panel = 'over'; releaseKeys();
    Sound.stopMusic();
    if (!o.dead) Sound.play('victory');
    const part = (title, tot) => { const t = totText(tot); return t ? el('div', { class: 'small' }, el('b', {}, title), ' ', t) : ''; };
    showOverlay(el('div', { class: 'mini-panel' },
      el('h3', {}, o.dead ? '💀 Ton héros est tombé' : '🏁 De retour à la base !'),
      el('div', { class: 'small' }, `Salle ${o.room} · ${o.kills} monstre${o.kills > 1 ? 's' : ''} vaincu${o.kills > 1 ? 's' : ''} · +${o.xp} XP${o.grelons ? ` · +${o.grelons} 🌨️` : ''}${o.levels ? ` · +${o.levels} niveau${o.levels > 1 ? 'x' : ''} !` : ''}`),
      o.room > G.prevBest ? el('div', { class: 'small', style: 'color:var(--gold)' }, `🏆 Nouveau record de profondeur : salle ${o.room} !`) : '',
      part('Mis à l’abri :', o.banked) || el('div', { class: 'small muted' }, 'Rien n’a été mis à l’abri.'),
      part('Perdu :', o.lost),
      ...(o.petUps || []).map((u) => el('div', { class: 'small', style: 'color:var(--gold)' }, `🐾 ${u.name} passe niveau ${u.level}${u.evolved ? ' et évolue !' : ' !'}`)),
      el('div', { class: 'mini-panel-btns' }, el('span', { class: 'spacer' }), el('button', { class: 'primary', onclick: closeRun }, 'Retour au camp'))));
  }
  async function closeRun() {
    try {
      const r = await api('/api/mini/act', { body: { action: 'close' } });
      state = r.mini;
      if (r.user && window.PlayerApp) window.PlayerApp.setUser(r.user);
    } catch (e) { toast(e.message); return load(); }
    G = null; render();
  }

  /* ============================== Commandes ============================== */
  const KEYMAP = { z: 'up', w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', q: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };
  function releaseKeys() { if (!G) return; G.keys = {}; G.touch = {}; }
  function playing() {
    const v = $('[data-view="mini"]');
    return !!(G && G.cv.isConnected && v && !v.classList.contains('hidden') && state && state.run && state.run.state !== 'over');
  }
  window.addEventListener('keydown', (e) => {
    if (!playing() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return;
    if (document.querySelector('.game-dialog-overlay')) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'p') { e.preventDefault(); if (G.panel === 'cart' || G.panel === 'help') closePanel(); else if (!G.panel) openHelp(false); return; }
    if (k === 'f') { e.preventDefault(); if (!e.repeat) toggleCart(); return; }
    if (k === ' ') { e.preventDefault(); if (!e.repeat && !G.panel) G.keys.roll = true; return; }
    if (G.panel) return;
    if (k === 'shift') { G.keys.sprint = true; return; }
    if (KEYMAP[k]) { G.keys[KEYMAP[k]] = true; e.preventDefault(); return; }
    if (e.repeat) return;
    if (k === 'e') G.keys.skill = true;
    else if (k === 'a') G.keys.potion = true;
  });
  window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); if (!G) return; if (k === 'shift') G.keys.sprint = false; if (KEYMAP[k]) G.keys[KEYMAP[k]] = false; });
  window.addEventListener('blur', releaseKeys);

  function setMouse(e) {
    const b = G.cv.getBoundingClientRect();
    G.mouse.x = ((e.clientX - b.left) / b.width) * AW; G.mouse.y = ((e.clientY - b.top) / b.height) * AH; G.mouse.in = true;
  }
  function overCart() {
    const C = G.sim && G.sim.cart;
    return !!(C && C.here && C.x !== undefined && Math.abs(G.mouse.x - C.x) < 34 && G.mouse.y > C.y - 46 && G.mouse.y < C.y + 12);
  }
  function bindCanvas(cv) {
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    const buttons = (e) => { if (e.pointerType === 'mouse' && G && !G.panel) { G.keys.attack = !!(e.buttons & 1); G.keys.shield = !!(e.buttons & 2); } };
    cv.addEventListener('pointerdown', (e) => {
      if (!G) return;
      setMouse(e); e.preventDefault();
      if (G.panel) return;
      if ((e.pointerType !== 'mouse' || e.button === 0) && overCart() && X.nearCart(G.sim)) { toggleCart(); return; }
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* */ }
      if (e.pointerType === 'mouse') buttons(e);
      else { G.touchPtr = e.pointerId; G.keys.attack = true; } // toucher la scène : attaquer / récolter vers ce point
    });
    cv.addEventListener('pointermove', (e) => { if (!G) return; setMouse(e); buttons(e); });
    const up = (e) => { if (!G) return; buttons(e); if (e.pointerType !== 'mouse' && e.pointerId === G.touchPtr) { G.keys.attack = false; G.touchPtr = null; } };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', (e) => { if (G && e.pointerType === 'mouse' && !e.buttons) G.mouse.in = false; });
  }
  // Contrôles tactiles : joystick + boutons (sous la scène)
  function touchControls() {
    const knob = el('div', { class: 'mini-knob' }), joy = el('div', { class: 'mini-joy' }, knob);
    let jid = null;
    const setJ = (e) => {
      const b = joy.getBoundingClientRect(), R = b.width / 2;
      let dx = e.clientX - (b.left + R), dy = e.clientY - (b.top + R);
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      G.joy.x = dx / R; G.joy.y = dy / R; knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    joy.addEventListener('pointerdown', (e) => { if (!G) return; e.preventDefault(); jid = e.pointerId; try { joy.setPointerCapture(jid); } catch (err) { /* */ } setJ(e); });
    joy.addEventListener('pointermove', (e) => { if (G && e.pointerId === jid) setJ(e); });
    const endJ = (e) => { if (e.pointerId !== jid || !G) return; jid = null; G.joy.x = G.joy.y = 0; knob.style.transform = ''; };
    joy.addEventListener('pointerup', endJ); joy.addEventListener('pointercancel', endJ);
    const hold = (label, key, title) => {
      const b = el('button', { class: 'mini-tbtn', title }, label);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (G && !G.panel) G.touch[key] = true; try { b.setPointerCapture(e.pointerId); } catch (err) { /* */ } });
      const off = () => { if (G) G.touch[key] = false; };
      b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off);
      return b;
    };
    const tap = (label, fn, title) => { const b = el('button', { class: 'mini-tbtn', title }, label); b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (G) fn(); }); return b; };
    return el('div', { class: 'mini-touch' }, joy,
      el('div', { class: 'mini-tbtns' },
        hold('⚔️', 'attack', 'Attaquer / récolter (cible la plus proche)'), hold('🔰', 'shield', 'Bouclier (maintenir)'), hold('🏃', 'sprint', 'Sprint (maintenir)'),
        tap('✨', () => { if (!G.panel) G.keys.skill = true; }, 'Compétence'), tap('🧪', () => { if (!G.panel) G.keys.potion = true; }, 'Potion'),
        tap('🤸', () => { if (!G.panel) G.keys.roll = true; }, 'Roulade'), tap('🛒', toggleCart, 'Seau / charrette'), tap('⏸️', () => { if (G.panel === 'help') closePanel(); else if (!G.panel) openHelp(false); }, 'Pause')));
  }
  // cible survolée par la souris : un monstre ou un point de récolte (on vise ses pieds)
  function hoverTarget() {
    if (!G.mouse.in) return null;
    const s = G.sim, mx = G.mouse.x, my = G.mouse.y;
    let best = null, bd = 1e9;
    for (const m of s.mobs) {
      if (m.dead) continue;
      const hh = m.r * 3.3;
      if (Math.abs(mx - m.x) < m.r * 1.7 + 4 && my > m.y - hh && my < m.y + m.r * 0.7) { const d = Math.hypot(mx - m.x, my - (m.y - hh / 2)); if (d < bd) { bd = d; best = { x: m.x, y: m.y, m }; } }
    }
    if (best) return best;
    for (const n of s.nodes) {
      if (n.left <= 0) continue;
      const hh = nodeH(n);
      if (Math.abs(mx - n.x) < n.r * 1.3 && my > n.y - hh && my < n.y + n.r * 0.7) return { x: n.x, y: n.y, n };
    }
    return null;
  }
  // taille d'un monstre à l'écran : sprite tenu dans (3,3 × rayon) de haut et (3,4 × rayon) de large
  const mobSize = (m) => A.mobFit(m.type, m.r * 3.3, m.r * 3.4);
  const NODE_TOP = [36, 92, 40];
  const nodeH = (n) => NODE_TOP[n.k] * 1.3 * NODE_SC[n.k] * (0.6 + (0.4 * n.left) / Math.max(1, n.amt)) + 10;
  // visée automatique (bouton ⚔️ du téléphone) : monstre proche, sinon point de récolte à portée
  function autoAim() {
    const s = G.sim, h = s.hero;
    let best = null, bd = 1e9;
    for (const m of s.mobs) if (!m.dead) { const d = Math.hypot(m.x - h.x, m.y - h.y); if (d < bd && d < 420) { bd = d; best = m; } }
    if (best && (bd < 190 || s.style !== 'melee')) return { x: best.x, y: best.y };
    for (const n of s.nodes) if (n.left > 0 && Math.hypot(n.x - h.x, n.y - h.y) < M.HERO.harvestReach + n.r) return { x: n.x, y: n.y };
    if (best) return { x: best.x, y: best.y };
    return { x: h.x + Math.cos(G.lastDir) * 90, y: h.y + Math.sin(G.lastDir) * 90 };
  }
  function input() {
    const K = G.keys, T = G.touch;
    const mx = (K.right ? 1 : 0) - (K.left ? 1 : 0) + G.joy.x, my = (K.down ? 1 : 0) - (K.up ? 1 : 0) + G.joy.y;
    if (Math.hypot(mx, my) > 0.2) G.lastDir = Math.atan2(my, mx);
    G.hover = hoverTarget();
    const o = { mx, my, attack: !!(K.attack || T.attack), shield: !!(K.shield || T.shield), sprint: !!(K.sprint || T.sprint), roll: !!K.roll, skill: !!K.skill, potion: !!K.potion };
    if (T.attack || (G.touchMode && (K.skill || T.shield) && !K.attack)) { const p = autoAim(); o.ax = p.x; o.ay = p.y; }
    else if (G.mouse.in) { o.ax = G.hover ? G.hover.x : G.mouse.x; o.ay = G.hover ? G.hover.y : G.mouse.y; }
    return o;
  }

  /* ============================== Boucle de jeu ============================== */
  let lastT = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    if (!G || !G.sim || !G.cv.isConnected) return;
    const view = $('[data-view="mini"]');
    if (!view || view.classList.contains('hidden')) { if (Sound.musicMode()) Sound.stopMusic(); releaseKeys(); return; }
    if (state && state.run && state.run.state !== 'over' && !Sound.musicMode()) Sound.startMusic(state.run.mode);
    update(dt);
    draw(now / 1000, dt);
  }
  requestAnimationFrame(frame);

  function update(dt) {
    const s = G.sim, run = state.run;
    G.t += dt; G.roomT += dt;
    const frozen = !run || run.state === 'over' || G.panel === 'reward' || G.panel === 'help' || G.panel === 'over' || G.fadeOut > 0;
    if (!frozen && !s.dead && !s.exitReached) {
      s.timeScale = G.panel === 'cart' ? 0.2 : 1;
      X.stepSim(s, dt, G.panel ? {} : input());
      G.keys.skill = false; G.keys.potion = false; G.keys.roll = false;
      // traînée de silhouettes pendant le bond d'une roulade
      const hh = s.hero;
      if (hh.rollT > 0) { G.trail.push({ x: hh.x, y: hh.y, face: hh.face, rot: (1 - hh.rollT / M.ROLL.dash) * TAU * (hh.rollDx >= 0 ? 1 : -1), a: 0.42 }); if (G.trail.length > 6) G.trail.shift(); }
    }
    for (const n of s.nodes) if (n.shake > 0) n.shake = Math.max(0, n.shake - dt);
    for (const g of G.trail) g.a -= dt * 2.4;
    G.trail = G.trail.filter((g) => g.a > 0);
    for (const p of s.pets) { // mouvement et orientation des familiers (pour le dessin)
      const dx = p.x - (p._px === undefined ? p.x : p._px), dy = p.y - (p._py === undefined ? p.y : p._py);
      p._mv = Math.hypot(dx, dy) > 0.15; if (dx > 0.15) p._face = 0; else if (dx < -0.15) p._face = Math.PI;
      p._px = p.x; p._py = p.y;
    }
    onEvents(s.events.splice(0));
    G.shake = Math.max(0, G.shake - dt * 30); G.flash = Math.max(0, G.flash - dt * 2);
    if (G.fade > 0 && !G.fadeOut) G.fade = Math.max(0, G.fade - dt * 3);
    if (G.fadeOut > 0) G.fadeOut = Math.min(1, G.fadeOut + dt * 3);
    if (!run || run.state === 'over') return;
    // élite / gardien vaincu : le serveur propose les récompenses
    if (s.needReward && G.t >= G.retryAt) { s.needReward = false; call('sync', null, { silent: true }).catch(() => { s.needReward = true; G.retryAt = G.t + 3; }); }
    // mort : petite pause, puis fin de l'expédition
    if (s.dead && !G.deadAt) G.deadAt = G.t;
    if (G.deadAt && !G.dieCalled && G.t - G.deadAt > 1.5 && G.t >= G.retryAt) {
      G.dieCalled = true;
      call('die', null, { silent: true }).catch(() => { G.dieCalled = false; G.retryAt = G.t + 3; });
    }
    // sortie atteinte : salle suivante
    if (s.exitReached && !G.exitCalled) {
      G.exitCalled = true; G.fadeOut = 0.01; Sound.play('room');
      const g = G;
      call('exit').catch(() => { if (G !== g) return; G.exitCalled = false; G.fadeOut = 0; G.fade = 1; s.exitReached = false; stepBack(s); });
    }
    // synchronisation régulière (le serveur garde la progression si la page se ferme)
    if (!frozen && G.t - G.lastSync > 8 && (s.ops.length || s.killed.size !== G.sentKills)) { G.lastSync = G.t; call('sync', null, { silent: true }).catch(() => {}); }
  }
  // sortie refusée : le héros recule d'un pas
  function stepBack(s) {
    const h = s.hero, e = s.room.exit;
    if (e.kind === 'hole') { const a = Math.atan2(h.y - e.y, h.x - e.x) || 0; h.x = e.x + Math.cos(a) * (e.r + 30); h.y = e.y + Math.sin(a) * (e.r + 30); }
    else { h.x = Math.min(AW - M.ARENA.WALL - 30, Math.max(M.ARENA.WALL + 30, h.x)); h.y = Math.min(AH - M.ARENA.WALL - 30, Math.max(M.ARENA.WALL + 30, h.y)); }
  }

  /* ============================== Effets ============================== */
  function floatTxt(x, y, s, col, size, life) { G.floats.push({ x, y, s, c: col, size: size || 16, t: 0, life: life || 1.1 }); if (G.floats.length > 60) G.floats.shift(); }
  function banner(text, sub, life) { G.banner = { text, sub, t: 0, life: life || 2 }; }
  function chips(x, y, res, n, gold) {
    const cols = gold ? ['#ffd23a', '#fff1a8', ...CHIPS[res]] : CHIPS[res] || CHIPS.pierre;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = 50 + Math.random() * 110;
      G.parts.push({ x, y, z: 6, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, vz: 160 + Math.random() * 160, life: 0.6 + Math.random() * 0.5, t: 0, c: cols[i % cols.length], s: 3 + Math.random() * 3, round: res === 'baies' && i % 2 === 0 });
    }
  }
  function puff(x, y, col, n) {
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = 30 + Math.random() * 90; G.parts.push({ x, y, z: 8, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, vz: 60 + Math.random() * 120, life: 0.4 + Math.random() * 0.4, t: 0, c: col, s: 3 + Math.random() * 4, round: true, soft: true }); }
  }
  const IMPACT = { arrow: '#e8e0d0', bolt: '#c8ccd4', fire: '#ffb02e', fireball: '#ff7a1a', poison: '#7fd13b', frost: '#bfe8ff', ice: '#bfe8ff', orb: '#c9a8ff', holy: '#fff3a0', note: '#ffd34d', charm: '#ff7ad9', flask: '#7fd13b', rock: '#a8a29a' };
  function onEvents(evs) {
    const s = G.sim, h = s.hero;
    for (const e of evs) {
      switch (e.k) {
        case 'dmg': floatTxt(e.x + (Math.random() - 0.5) * 14, e.y, (e.parry ? '↩ ' : '') + e.n + (e.crit ? ' !' : ''), e.parry ? '#ffd23a' : e.crit ? '#ffe066' : e.pet ? '#c8f0a8' : '#ffffff', e.crit ? 24 : e.pet ? 14 : 18, 0.9); Sound.play(e.crit ? 'crit' : 'hit', 0.05); break;
        case 'kill': puff(e.x, e.y - 8, '#efe6d6', e.boss ? 26 : 12); Sound.play('kill', 0.06); if (e.boss) G.shake = 10; break;
        case 'hurt': floatTxt(e.x, e.y - 62, '-' + e.n, '#ff6a5a', 20); G.shake = Math.max(G.shake, 6); G.flash = 0.35; Sound.play('hurt', 0.08); break;
        case 'block': floatTxt(e.x, e.y - 62, '🔰 ' + e.n, '#9fd8ff', 15, 0.8); Sound.play('block', 0.06); break;
        case 'parry': G.fx.push({ k: 'parry', x: e.x, y: e.y - 22, t: 0, life: 0.45 }); floatTxt(e.x, e.y - 74, 'Parade parfaite !', '#ffd23a', 19); G.shake = Math.max(G.shake, 4); Sound.play('parry'); break;
        case 'shieldBreak': floatTxt(e.x, e.y - 74, 'Bouclier brisé !', '#c8d8e8', 16); Sound.play('breakShield'); break;
        case 'guard': floatTxt(e.x, e.y - 62, '🛡️ ' + e.n, '#e8f0b0', 14); break;
        case 'death': Sound.play('death'); puff(e.x, e.y - 20, '#b0a8b8', 20); break;
        case 'roll': for (let i = 0; i < 9; i++) G.parts.push({ x: e.x, y: e.y, z: 2, vx: -Math.cos(e.a) * (40 + Math.random() * 70) + (Math.random() - 0.5) * 50, vy: -Math.sin(e.a) * 30 + (Math.random() - 0.5) * 30, vz: 40 + Math.random() * 60, life: 0.5, t: 0, c: '#e8dcc0', s: 4 + Math.random() * 3, round: true, soft: true }); Sound.play('roll'); break;
        case 'tired': floatTxt(e.x, e.y - 74, 'Pas assez d’endurance', '#ffd0a0', 15, 0.9); Sound.play('full', 0.5); break;
        case 'swing': G.fx.push({ k: 'slash', x: e.x, y: e.y - 18, a: e.a, t: 0, life: 0.18 }); Sound.play('swing', 0.05); break;
        case 'shoot': Sound.play('shoot', e.pet ? 0.25 : 0.06); break;
        case 'mobShoot': Sound.play('shoot', 0.18); break;
        case 'skill': G.fx.push({ k: 'ring', x: e.x, y: e.y, r: e.r || 70, t: 0, life: 0.45, col: e.kind === 'nova' ? '#c9a8ff' : e.kind === 'whirl' ? '#ffffff' : '#ffe9a0', fill: true }); Sound.play('skill'); if (e.kind !== 'volley') G.shake = Math.max(G.shake, 5); break;
        case 'potion': floatTxt(e.x, e.y - 66, `+${Math.round(h.max * M.POTION_HEAL)} PV`, '#7fe07a', 18); for (let i = 0; i < 10; i++) G.parts.push({ x: e.x + (Math.random() - 0.5) * 30, y: e.y, z: 10 + Math.random() * 40, vx: 0, vy: 0, vz: 60 + Math.random() * 60, life: 0.7, t: 0, c: '#7fe07a', s: 4, round: true, float: true }); Sound.play('potion'); break;
        case 'heal': G.parts.push({ x: e.x + (Math.random() - 0.5) * 26, y: e.y, z: 10, vx: 0, vy: 0, vz: 50, life: 0.7, t: 0, c: '#9fffd6', s: 4, round: true, float: true }); break;
        case 'petHeal': floatTxt(e.x, e.y - 66, '+' + e.n + ' PV', '#7fe07a', 15); break;
        case 'pickup': floatTxt(e.x, e.y - 24, e.t ? `+1 ${M.TROPHIES[e.t].icon}` : `+${e.n} ${resIcon(e.r)}`, e.t && M.TROPHIES[e.t].rare ? '#e0b8ff' : '#ffffff', 16); Sound.play(e.t && M.TROPHIES[e.t].rare ? 'jackpot' : 'pickup', 0.08); break;
        case 'bagfull': floatTxt(e.x, e.y - 74, '🎒 Sac plein !', '#ffb0a0', 17); Sound.play('full', 0.8); break;
        case 'harvest': chips(e.x, e.y - 14, e.r, e.pet ? 3 : 7, e.gold); floatTxt(e.x + (Math.random() - 0.5) * 10, e.y - 46, `+${e.n} ${resIcon(e.r)}`, e.gold ? '#ffd23a' : '#ffffff', e.pet ? 13 : 16, 0.9); Sound.play(e.r, 0.04); if (e.gold) Sound.play('gain', 0.3); break;
        case 'depleted': puff(e.x, e.y, '#d8d0c0', 10); break;
        case 'exit': banner(M.MODES[G.mode].exit === 'hole' ? 'Une cavité s’est ouverte !' : 'Un passage s’est ouvert !', M.MODES[G.mode].exit === 'hole' ? 'Saute dedans pour descendre plus loin' : 'Sors par là pour rejoindre la salle suivante', 1.8); Sound.play('exit'); break;
        case 'reinforce': banner('⚠️ Des renforts arrivent !', 'Ne traîne pas trop…', 1.5); Sound.play('reinforce', 2); break;
        case 'telegraph': Sound.play('warn', 0.3); break;
        case 'slam': G.fx.push({ k: 'ring', x: e.x, y: e.y, r: e.r, t: 0, life: 0.5, col: '#ff8a5a', fill: true }); G.shake = Math.max(G.shake, 9); Sound.play('slam'); break;
        case 'petHurt': floatTxt(e.x, e.y - 44, '-' + e.n, '#ffb070', 14, 0.8); if (e.ko) floatTxt(e.x, e.y - 62, 'K.-O.', '#d8d0e0', 15); break;
        case 'petAoe': G.fx.push({ k: 'ring', x: e.x, y: e.y, r: e.r, t: 0, life: 0.35, col: '#c8f0a8' }); break;
        case 'status': floatTxt(e.x, e.y, e.s, '#ffffff', 18, 0.9); break;
        case 'impact': puff(e.x, e.y, IMPACT[e.kind] || '#ffffff', 4); break;
        default: break;
      }
    }
  }

  /* ============================== Ambiance : lumière et particules ============================== */
  // obscurité aux bords (caverne : la torche du héros éclaire autour de lui) ; [opacité, couleur] par décor
  const LIGHT = {
    mine: [[0.45, '10,6,4'], [0.5, '10,6,26'], [0.42, '34,6,2']],
    foret: [[0.34, '6,24,6'], [0.46, '4,18,10'], [0.5, '22,6,34']],
    champ: [[0.05, '90,60,0'], [0.07, '40,50,10'], [0.28, '56,16,56']]
  };
  // vignette fixe des décors en plein air (dessinée une fois par salle)
  function makeVignette(mode, decor) {
    if (mode === 'mine') return null;
    const [a, col] = LIGHT[mode][Math.min(2, decor)], c = document.createElement('canvas');
    c.width = AW / 2; c.height = AH / 2;
    const x = c.getContext('2d'), g = x.createRadialGradient(AW / 4, AH / 4, AH * 0.16, AW / 4, AH / 4, AW * 0.3);
    g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${a})`);
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function drawLight(ctx, t) {
    const h = G.sim.hero;
    if (G.vig) { ctx.drawImage(G.vig, 0, 0, AW, AH); return; }
    const [a, col] = LIGHT.mine[Math.min(2, G.room.decor)], fl = 1 + Math.sin(t * 9) * 0.025 + Math.sin(t * 23) * 0.015;
    if (!G.dark) { G.dark = document.createElement('canvas'); G.dark.width = AW / 2; G.dark.height = AH / 2; }
    const d = G.dark.getContext('2d');
    d.setTransform(0.5, 0, 0, 0.5, 0, 0); d.globalCompositeOperation = 'source-over'; d.clearRect(0, 0, AW, AH);
    const g = d.createRadialGradient(h.x, h.y - 20, 80 * fl, h.x, h.y - 20, 380 * fl);
    g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${a})`);
    d.fillStyle = g; d.fillRect(0, 0, AW, AH);
    const hole = (x, y, r) => { const q = d.createRadialGradient(x, y, r * 0.2, x, y, r); q.addColorStop(0, 'rgba(0,0,0,1)'); q.addColorStop(1, 'rgba(0,0,0,0)'); d.fillStyle = q; d.fillRect(x - r, y - r, 2 * r, 2 * r); };
    d.globalCompositeOperation = 'destination-out';
    const C = G.sim.cart;
    if (C && C.here && C.x !== undefined) hole(C.x + 30, C.y - 26, 130 * fl);
    if (G.sim.exitOpen && G.room.exit.kind === 'hole') hole(G.room.exit.x, G.room.exit.y, 110);
    ctx.drawImage(G.dark, 0, 0, AW, AH);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.07 * fl; glowAt(ctx, h.x, h.y - 24, '#ffb84a', 110); ctx.restore();
  }
  // particules : poussière, éclats de cristal, braises (caverne) ; feuilles, lucioles (forêt) ; pollen, papillons, lucioles (clairière)
  const AMB = { mine: ['dust', 'sparkle', 'ember'], foret: ['leaf', 'leaf', 'firefly'], champ: ['butterfly', 'butterfly', 'firefly'] };
  function makeAmbient(mode, decor) {
    const kind = AMB[mode][Math.min(2, decor)], n = kind === 'butterfly' ? 8 : kind === 'leaf' ? 22 : 34;
    const cols = { leaf: ['#5cb84a', '#e8a04a', '#c97b3a', '#8fd06a'], butterfly: ['#ffd23a', '#ff9fd0', '#ffffff', '#9fd8ff'], sparkle: ['#c9e6ff', '#e0c8ff'] }[kind] || ['#ffffff'];
    return Array.from({ length: n }, (_, i) => ({ kind, x: Math.random() * AW, y: Math.random() * AH, ph: Math.random() * 10, v: 0.5 + Math.random(), c: cols[i % cols.length] }));
  }
  function drawAmbient(ctx, t, dt) {
    for (const p of G.amb || []) {
      const w = Math.sin(t * 1.3 + p.ph);
      ctx.save();
      switch (p.kind) {
        case 'dust': p.x += w * 6 * dt; p.y -= 5 * p.v * dt; ctx.globalAlpha = 0.25 + 0.2 * w; ctx.fillStyle = '#fff4d8'; ctx.fillRect(p.x, p.y, 2, 2); break;
        case 'sparkle': { const k = Math.max(0, Math.sin(t * 2 * p.v + p.ph)); ctx.globalAlpha = k; ctx.fillStyle = p.c; ctx.fillRect(p.x - 1, p.y - 4, 2, 8); ctx.fillRect(p.x - 4, p.y - 1, 8, 2); break; }
        case 'ember': p.y -= 24 * p.v * dt; p.x += w * 12 * dt; ctx.globalAlpha = 0.5 + 0.4 * w; glowAt(ctx, p.x, p.y, '#ff8a2a', 5); ctx.fillStyle = '#ffd23a'; ctx.fillRect(p.x - 1, p.y - 1, 3, 3); break;
        case 'leaf': p.y += 22 * p.v * dt; p.x += (14 + w * 20) * dt; ctx.translate(p.x, p.y); ctx.rotate(t * 2 * p.v + p.ph); ctx.globalAlpha = 0.9; ctx.fillStyle = p.c; ctx.fillRect(-3, -2, 6, 4); ctx.fillStyle = 'rgba(18,12,10,.35)'; ctx.fillRect(-3, 1, 6, 1); break;
        case 'firefly': p.x += Math.cos(t * 0.7 + p.ph) * 16 * dt; p.y += Math.sin(t * 0.9 + p.ph * 1.3) * 14 * dt; ctx.globalAlpha = 0.35 + 0.45 * Math.max(0, Math.sin(t * 3 + p.ph)); glowAt(ctx, p.x, p.y, G.mode === 'foret' ? '#9fffd6' : '#eaff7a', 9); break;
        case 'pollen': p.y -= 7 * p.v * dt; p.x += w * 10 * dt; ctx.globalAlpha = 0.55; ctx.fillStyle = '#fffbe0'; ctx.fillRect(p.x, p.y, 2, 2); break;
        case 'butterfly': {
          p.x += (Math.cos(t * 0.5 + p.ph) * 40) * dt + 10 * dt; p.y += Math.sin(t * 1.7 + p.ph) * 30 * dt;
          const f = Math.abs(Math.sin(t * 14 + p.ph)) * 5 + 1;
          ctx.fillStyle = p.c; ctx.fillRect(p.x - f, p.y - 3, f, 5); ctx.fillRect(p.x + 1, p.y - 3, f, 5);
          ctx.fillStyle = OL; ctx.fillRect(p.x, p.y - 3, 1, 6); break;
        }
        default: break;
      }
      ctx.restore();
      if (p.y < -12) p.y = AH + 10; else if (p.y > AH + 12) p.y = -10;
      if (p.x < -12) p.x = AW + 10; else if (p.x > AW + 12) p.x = -10;
    }
  }

  /* ============================== Dessin ============================== */
  function txt(ctx, s, x, y, size, col, align, lw) {
    ctx.font = `800 ${size}px ${FONT}`; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const w = lw === undefined ? Math.max(3, size / 4.5) : lw;
    if (w > 0) { ctx.lineWidth = w; ctx.strokeStyle = OL; ctx.strokeText(s, x, y); }
    ctx.fillStyle = col; ctx.fillText(s, x, y);
  }
  const textW = (ctx, s, size) => { ctx.font = `800 ${size}px ${FONT}`; return ctx.measureText(s).width; };
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
  function box(ctx, x, y, w, h) { ctx.fillStyle = 'rgba(18,12,10,.6)'; rr(ctx, x, y, w, h, 10); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.stroke(); }
  function bar(ctx, x, y, w, h, pct, col, label) {
    ctx.fillStyle = '#2a1f2b'; rr(ctx, x, y, w, h, h / 2); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = OL; ctx.stroke();
    const p = Math.max(0, Math.min(1, pct || 0));
    if (p > 0) { ctx.fillStyle = col; rr(ctx, x + 2, y + 2, Math.max(h - 4, (w - 4) * p), h - 4, (h - 4) / 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(x + 4, y + 3, Math.max(0, (w - 8) * p), Math.max(1, (h - 6) / 3)); }
    if (label) txt(ctx, label, x + w / 2, y + h / 2 + 0.5, Math.max(9, Math.min(12, h - 2)), '#ffffff', 'center', 2.5);
  }
  const glowAt = (ctx, x, y, col, r) => { ctx.save(); ctx.translate(x, y); A.glow(ctx, col, r); ctx.restore(); };

  function draw(t, dt) {
    const ctx = G.ctx, s = G.sim;
    ctx.setTransform(G.k, 0, 0, G.k, 0, 0);
    ctx.save();
    if (G.shake > 0.3) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
    drawWorld(ctx, t);
    drawEffects(ctx, t, dt);
    drawAmbient(ctx, t, dt);
    ctx.restore();
    drawLight(ctx, t);
    // flash rouge quand le héros est touché
    if (G.flash > 0) { const g = ctx.createRadialGradient(AW / 2, AH / 2, AH * 0.3, AW / 2, AH / 2, AW * 0.62); g.addColorStop(0, 'rgba(255,40,30,0)'); g.addColorStop(1, `rgba(255,40,30,${G.flash * 0.55})`); ctx.fillStyle = g; ctx.fillRect(0, 0, AW, AH); }
    drawHud(ctx, t);
    // bandeau (numéro de salle, sortie, renforts)
    const b = G.banner;
    if (b) {
      b.t += dt;
      if (b.t > b.life) G.banner = null;
      else { ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, b.t * 4, (b.life - b.t) * 3)); txt(ctx, b.text, AW / 2, AH * 0.4, 34, '#f2c14e'); if (b.sub) txt(ctx, b.sub, AW / 2, AH * 0.4 + 34, 17, '#ffffff'); ctx.restore(); }
    }
    // mort
    if (s.dead) { const k = Math.min(1, (G.t - (G.deadAt || G.t)) / 1.2); ctx.fillStyle = `rgba(40,0,0,${0.5 * k})`; ctx.fillRect(0, 0, AW, AH); ctx.globalAlpha = k; txt(ctx, 'Ton héros est tombé…', AW / 2, AH / 2, 36, '#ff8a7a'); ctx.globalAlpha = 1; }
    // fondu entre deux salles
    const f = Math.max(G.fade, G.fadeOut);
    if (f > 0) { ctx.fillStyle = `rgba(10,6,8,${f})`; ctx.fillRect(0, 0, AW, AH); }
  }

  function drawWorld(ctx, t) {
    const s = G.sim, room = G.room, h = s.hero;
    ctx.drawImage(G.bg, 0, 0, AW, AH);
    if (room.fountain) D.drawFountain(ctx, room.fountain, t, s.fountainLeft / M.FOUNTAIN.time);
    if (s.exitOpen) D.drawExit(ctx, room, t);
    else if (room.exit.kind === 'hole' && isFinite(s.exitAt) && s.exitAt - s.t < 2.5) { // le sol se fissure avant l'ouverture
      const k = 1 - Math.max(0, s.exitAt - s.t) / 2.5, e = room.exit;
      ctx.save(); ctx.strokeStyle = 'rgba(20,10,6,.8)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + 0.3; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(a) * e.r * 1.3 * k, e.y + Math.sin(a) * e.r * 0.9 * k); ctx.stroke(); }
      ctx.restore();
    }
    // télégraphes des gardiens au sol
    for (const m of s.mobs) if (!m.dead && m.cast) drawCast(ctx, m);
    // repère de visée au sol
    if (G.hover && !G.panel) { const p = G.hover.m || G.hover.n; ctx.save(); ctx.strokeStyle = G.hover.m ? 'rgba(255,90,70,.9)' : 'rgba(255,230,120,.9)'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, p.r + 6, (p.r + 6) * 0.5, 0, 0, TAU); ctx.stroke(); ctx.restore(); }
    // corps triés par profondeur (y)
    const L = [];
    for (const n of s.nodes) L.push([n.y, () => drawNode(ctx, n, t)]);
    for (const d of s.drops) L.push([d.y, () => drawDrop(ctx, d, t)]);
    if (s.cart && s.cart.here && s.cart.x !== undefined) L.push([s.cart.y, () => drawCartU(ctx, t)]);
    if (G.leaving) L.push([G.leaving.y, () => drawLeaving(ctx, t)]);
    for (const p of s.pets) L.push([p.y, () => drawPetU(ctx, p, t)]);
    for (const m of s.mobs) if (!m.dead) L.push([m.y, () => drawMobU(ctx, m, t)]);
    L.push([h.y, () => drawHeroU(ctx, t)]);
    L.sort((a, b) => a[0] - b[0]);
    for (const e of L) e[1]();
    // projectiles
    for (const q of s.projs) {
      ctx.save();
      if (q.reflected) glowAt(ctx, q.x, q.y, '#ffd23a', 14);
      if (q.scale && q.scale !== 1) { ctx.translate(q.x, q.y); ctx.scale(q.scale, q.scale); A.drawProjectile(ctx, q.kind, 0, 0, Math.atan2(q.vy, q.vx), t); }
      else A.drawProjectile(ctx, q.kind, q.x, q.y, Math.atan2(q.vy, q.vx), t);
      ctx.restore();
    }
  }

  function drawCast(ctx, m) {
    const c = m.cast;
    ctx.save();
    if (c.kind === 'slam') {
      const k = 1 - Math.max(0, c.t) / 0.9;
      ctx.fillStyle = 'rgba(255,60,40,.16)'; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,60,40,.3)'; ctx.beginPath(); ctx.arc(c.x, c.y, c.r * k, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ff5a3a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.stroke();
    } else if (c.kind === 'charge' && c.phase === 0) {
      ctx.translate(m.x, m.y); ctx.rotate(c.a);
      ctx.fillStyle = 'rgba(255,60,40,.2)'; ctx.fillRect(0, -m.r, 300, m.r * 2);
      ctx.strokeStyle = 'rgba(255,90,58,.85)'; ctx.setLineDash([10, 8]); ctx.lineWidth = 2.5; ctx.strokeRect(0, -m.r, 300, m.r * 2);
      ctx.setLineDash([]); A.poly(ctx, [300, -m.r - 8, 330, 0, 300, m.r + 8], '#ff5a3a', 2);
    }
    ctx.restore();
  }

  function drawNode(ctx, n, t) {
    const pct = n.amt ? (100 * n.left) / n.amt : 0, sc = NODE_SC[n.k], sx = n.shake > 0 ? Math.sin(t * 90) * 3 : 0;
    if (n.gold && n.left > 0) { ctx.save(); ctx.globalAlpha = 0.55 + 0.2 * Math.sin(t * 4 + n.i); glowAt(ctx, n.x, n.y - 10, '#ffd23a', 34); ctx.restore(); }
    ctx.save(); ctx.translate(n.x + sx, n.y + 8); ctx.scale(sc, sc); A.drawResNode(ctx, n.k, 0, 0, pct, t, n.i); ctx.restore();
    if (n.gold && n.left > 0) for (let i = 0; i < 3; i++) { const a = t * 2 + i * 2.1 + n.i; ctx.fillStyle = '#fff6b0'; ctx.fillRect(n.x + Math.cos(a) * 22 - 1.5, n.y - 24 + Math.sin(a * 1.3) * 16 - 1.5, 3, 3); }
  }
  function drawDrop(ctx, d, t) {
    const bob = Math.sin(t * 4 + d.x * 0.1) * 2.5;
    A.shadow(ctx, d.x, d.y + 2, 10, 3.5);
    if (d.t) {
      const T = M.TROPHIES[d.t] || { icon: '?' };
      glowAt(ctx, d.x, d.y - 12 + bob, T.rare ? '#c9a0ff' : '#fff3c0', T.rare ? 20 : 14);
      ctx.font = `22px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000'; ctx.fillText(T.icon, d.x, d.y - 12 + bob);
    } else { // tas de ressources (récompense)
      const cols = CHIPS[d.r] || CHIPS.pierre;
      for (let i = 0; i < 9; i++) A.circle(ctx, d.x - 16 + (i % 5) * 8 + (i >= 5 ? 4 : 0), d.y - (i >= 5 ? 8 : 0), 5.5, cols[i % cols.length], 1.4);
      txt(ctx, `×${d.n}`, d.x, d.y - 26 + bob, 13, '#ffffff');
    }
  }
  function drawCartU(ctx, t) {
    const s = G.sim, C = s.cart, run = state.run;
    drawTorch(ctx, C.x + 30, C.y - 2, t);
    A.drawCart(ctx, C.x, C.y, { skin: C.skin, fill: C.items.length / Math.max(1, run.cartCap), res: M.MODES[run.mode].res, t, moving: C.moving });
    if (X.nearCart(s) && !G.panel) {
      const y = C.y - 52 + Math.sin(t * 4) * 2;
      ctx.fillStyle = '#fff8e8'; rr(ctx, C.x - 13, y - 12, 26, 22, 6); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = OL; ctx.stroke();
      txt(ctx, G.touchMode ? '🛒' : 'F', C.x, y, 14, '#120c0a', 'center', 0);
    }
  }
  // petite torche plantée à côté du seau / de la charrette (pour le repérer de loin)
  function drawTorch(ctx, x, y, t) {
    const f = Math.sin(t * 13) * 1.5 + Math.sin(t * 7.3) * 1;
    ctx.save(); ctx.globalAlpha = 0.55 + 0.1 * Math.sin(t * 9); glowAt(ctx, x, y - 26, '#ffb84a', 30 + f * 2); ctx.restore();
    A.shadow(ctx, x, y + 1, 5, 2);
    A.line(ctx, x, y, x, y - 20, '#6b4424', 3);
    A.rrect(ctx, x - 4, y - 24, 8, 6, 2, '#4a3828', 1.5);
    A.poly(ctx, [x - 5, y - 26, x, y - 40 - f, x + 5, y - 26], '#ff8a2a', 1.5);
    A.poly(ctx, [x - 2.5, y - 27, x, y - 34 - f * 0.6, x + 2.5, y - 27], '#ffe27a', 0.01);
  }
  function drawLeaving(ctx, t) {
    const L = G.leaving, run = state.run;
    L.t += 1 / 60; L.x += Math.cos(L.a) * 2.2; L.y += Math.sin(L.a) * 2.2;
    if (L.t > 1.4) { G.leaving = null; return; }
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - L.t / 1.4);
    A.drawCart(ctx, L.x, L.y, { skin: run.cart.skin, fill: 0.8, res: M.MODES[run.mode].res, t, moving: true });
    ctx.restore();
  }
  function drawPetU(ctx, p, t) {
    const info = ((state.pets && state.pets.list) || []).find((q) => q.id === p.id);
    const sx = p.hurt > 0 ? Math.sin(t * 80) * 3 : 0;
    A.drawPet(ctx, GD.petSprite(p.kind), p.x + sx, p.y, { size: A.mobFit(GD.petSprite(p.kind), 40, 54), t: t + p.idx, facing: p._face || 0, stage: GD.petStage(info ? info.level : 1), moving: !!p._mv, attack: p.swing > 0 ? 1 : 0, ko: p.hp <= 0 });
    if (p.hp > 0 && p.hp < p.max) bar(ctx, p.x - 15, p.y - 50, 30, 6, p.hp / p.max, '#5cb84a');
  }
  function drawMobU(ctx, m, t) {
    const h = G.sim.hero, size = mobSize(m), hh = Math.min(m.r * 3.3, size * (A.mobTop(m.type) || 2.2));
    const sx = m.hit > 0 ? Math.sin(t * 90) * 2.5 : 0;
    A.drawMob(ctx, m.type, m.x + sx, m.y, { size, t: t * (m.aggro ? 1 : 0.5) + (m.i + 1) * 0.37 + (m.reinf ? 0.5 : 0), facing: h.x < m.x ? Math.PI : 0, elite: m.elite, boss: m.boss, attack: m.act > 0 || m.wind > 0 ? 1 : 0, frozen: m.frozen > 0 });
    const headY = m.y - hh - 8;
    if (m.elite && !m.boss) { txt(ctx, m.name, m.x, headY - 12, 12, '#f2c14e'); bar(ctx, m.x - 30, headY - 4, 60, 8, m.hp / m.max, '#f2c14e'); }
    else if (!m.boss && m.hp < m.max) bar(ctx, m.x - 17, headY, 34, 6, m.hp / m.max, '#e2504c');
    const st = [m.stun > 0 ? '💫' : '', m.frozen > 0 ? '❄️' : '', m.pdot ? (m.pdot.k === 'burn' ? '🔥' : '☠️') : '', m.mark > 0 ? '🎯' : ''].filter(Boolean).join('');
    if (st) { ctx.font = `13px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000'; ctx.fillText(st, m.x, headY - (m.elite ? 26 : 10)); }
    if (m.wind > 0) txt(ctx, '!', m.x + m.r + 6, headY + 4, 24, '#ff4a3a');
  }
  function drawHeroU(ctx, t) {
    const s = G.sim, h = s.hero, me = window.PlayerApp && window.PlayerApp.me();
    if (h.dead) { A.drawGrave(ctx, h.x, h.y, t); return; }
    const perfect = h.shieldUp && s.t - h.shieldAt <= M.SHIELD.parryWindow;
    const look = me ? { cls: me.cls, look: me.look, gear: window.PlayerApp.myGear(), t, scale: 1.2 } : null;
    const spin = (x, y, rot, sq) => { const cy = y - 26; ctx.translate(x, cy); ctx.rotate(rot); ctx.scale(1, sq); ctx.translate(-x, -cy); };
    // invulnérabilité (roulade) : lueur et anneau au sol qui se vide avec le temps restant
    if (h.invT > 0) {
      const k = h.invT / M.ROLL.invuln;
      ctx.save(); ctx.globalAlpha = 0.28 + 0.14 * Math.sin(t * 12); glowAt(ctx, h.x, h.y - 26, '#9fe8ff', 36); ctx.restore();
      ctx.save(); ctx.lineCap = 'round';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(18,12,10,.45)'; ctx.beginPath(); ctx.ellipse(h.x, h.y + 3, 24, 10, 0, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = '#bff0ff'; ctx.stroke(); ctx.restore();
    }
    // silhouettes laissées par le bond
    if (look) for (const g of G.trail) { ctx.save(); ctx.globalAlpha = g.a; spin(g.x, g.y, g.rot, 0.85); A.drawHero(ctx, g.x, g.y, { ...look, facing: g.face, moving: true }); ctx.restore(); }
    ctx.save();
    if (h.iframes > 0 && Math.floor(t * 30) % 2) ctx.globalAlpha = 0.55;
    if (h.rollT > 0) { const k = 1 - h.rollT / M.ROLL.dash; spin(h.x, h.y, k * TAU * (h.rollDx >= 0 ? 1 : -1), 0.8 + 0.2 * Math.cos(k * TAU)); }
    if (look) A.drawHero(ctx, h.x, h.y, { ...look, facing: h.rollT > 0 ? Math.atan2(h.rollDy, h.rollDx) : h.face, moving: h.moving, attack: h.swing > 0 ? 0.3 : 0 });
    else A.circle(ctx, h.x, h.y - 20, 14, '#f2c14e', 2);
    ctx.restore();
    if (h.invT > 0) for (let i = 0; i < 3; i++) { const a = t * 5 + (i * TAU) / 3, sx = h.x + Math.cos(a) * 20, sy = h.y - 30 + Math.sin(a) * 26; ctx.fillStyle = '#ffffff'; ctx.fillRect(sx - 1, sy - 4, 2, 8); ctx.fillRect(sx - 4, sy - 1, 8, 2); }
    // bouclier levé : arc devant le héros (doré pendant la fenêtre de parade parfaite)
    if (h.shieldUp) {
      const k = h.shield / Math.max(1, h.shieldMax), cy = h.y - 22;
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.2 * k; ctx.fillStyle = perfect ? '#ffe9a0' : '#9fd8ff'; ctx.beginPath(); ctx.arc(h.x, cy, 34, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; ctx.lineCap = 'round';
      ctx.lineWidth = 9; ctx.strokeStyle = OL; ctx.beginPath(); ctx.arc(h.x, cy, 34, h.face - 0.9, h.face + 0.9); ctx.stroke();
      ctx.lineWidth = 5.5; ctx.strokeStyle = perfect ? '#ffd23a' : '#7fd0ff'; ctx.stroke();
      ctx.restore();
    }
    if (h.dot) { ctx.font = `13px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = '#000'; ctx.fillText(h.dot.k === 'burn' ? '🔥' : '☠️', h.x + 16, h.y - 62); }
  }

  function drawEffects(ctx, t, dt) {
    for (let i = G.fx.length - 1; i >= 0; i--) {
      const f = G.fx[i];
      f.t += dt;
      if (f.t > f.life) { G.fx.splice(i, 1); continue; }
      const k = f.t / f.life;
      ctx.save();
      if (f.k === 'ring') {
        const r = f.r * (0.35 + 0.65 * Math.min(1, k * 1.4));
        if (f.fill) { ctx.globalAlpha = 0.25 * (1 - k); ctx.fillStyle = f.col; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.fill(); }
        ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.col; ctx.lineWidth = 2 + 6 * (1 - k); ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.stroke();
      } else if (f.k === 'slash') { // coup d'arme : arc blanc qui balaie devant le héros
        const a0 = f.a - M.HERO.meleeArc, a1 = a0 + 2 * M.HERO.meleeArc * Math.min(1, k * 1.8);
        ctx.globalAlpha = 1 - k * 0.8; ctx.lineCap = 'round';
        ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(18,12,10,.55)'; ctx.beginPath(); ctx.arc(f.x, f.y, M.HERO.meleeRange * 0.72, a0, a1); ctx.stroke();
        ctx.lineWidth = 6; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      } else if (f.k === 'parry') {
        ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 4;
        for (let j = 0; j < 8; j++) { const a = (j / 8) * TAU, r0 = 18 + k * 20, r1 = 30 + k * 34; ctx.beginPath(); ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0); ctx.lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1); ctx.stroke(); }
        glowAt(ctx, f.x, f.y, '#ffe9a0', 30 * (1 - k) + 6);
      }
      ctx.restore();
    }
    // éclats (avec une hauteur simulée : ils sautent puis retombent)
    for (let i = G.parts.length - 1; i >= 0; i--) {
      const p = G.parts[i];
      p.t += dt;
      if (p.t > p.life) { G.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.float) p.z += p.vz * dt;
      else { p.vz -= 900 * dt; p.z += p.vz * dt; if (p.z < 0) { p.z = 0; p.vz *= -0.35; p.vx *= 0.6; p.vy *= 0.6; } }
      ctx.globalAlpha = Math.max(0, Math.min(1, (p.life - p.t) * 3)) * (p.soft ? 0.7 : 1);
      ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(p.x, p.y - p.z, p.s / 2 + 0.5, 0, TAU); ctx.fill(); if (!p.soft) { ctx.strokeStyle = OL; ctx.lineWidth = 1; ctx.stroke(); } }
      else { ctx.fillRect(p.x - p.s / 2, p.y - p.z - p.s / 2, p.s, p.s); ctx.strokeStyle = OL; ctx.lineWidth = 1; ctx.strokeRect(p.x - p.s / 2, p.y - p.z - p.s / 2, p.s, p.s); }
    }
    ctx.globalAlpha = 1;
    // nombres et textes flottants
    for (let i = G.floats.length - 1; i >= 0; i--) {
      const f = G.floats[i];
      f.t += dt;
      if (f.t > f.life) { G.floats.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, Math.min(1, (f.life - f.t) * 3));
      txt(ctx, f.s, f.x, f.y - f.t * 38, f.size, f.c);
    }
    ctx.globalAlpha = 1;
  }

  function drawHud(ctx, t) {
    const s = G.sim, h = s.hero, room = G.room, RT = M.ROOMS[room.type], run = state.run;
    if (!run) return;
    // en haut à gauche : salle (numéro + type), PV, bouclier, potions, compétence, sac
    box(ctx, 10, 10, 300, 112);
    txt(ctx, `Salle ${G.roomNo}`, 22, 29, 19, '#f2c14e', 'left');
    txt(ctx, `${RT.icon} ${RT.name}`, 30 + textW(ctx, `Salle ${G.roomNo}`, 19), 29, 15, room.type === 'gardien' ? '#ff9a8a' : room.type === 'elite' ? '#f2c14e' : room.type === 'riche' ? '#ffe9a0' : room.type === 'repos' ? '#9fffd6' : '#ffffff', 'left');
    bar(ctx, 20, 42, 280, 18, h.hp / h.max, h.hp / h.max > 0.4 ? '#5cb84a' : '#e2504c', `${Math.ceil(h.hp)} / ${h.max} PV`);
    bar(ctx, 20, 64, 280, 14, h.broken > 0 ? 0 : h.shield / Math.max(1, h.shieldMax), h.shieldUp ? '#bfe8ff' : '#5ab4f0', h.broken > 0 ? `Bouclier brisé (${Math.ceil(h.broken)} s)` : `Bouclier ${Math.round(h.shield)} / ${h.shieldMax}`);
    bar(ctx, 20, 81, 280, 11, h.stamina / h.staminaMax, h.sprinting ? '#ffe27a' : h.stamina >= M.ROLL.cost ? '#e8c46a' : '#a8884a');
    const rx = 22 + 276 * Math.min(1, M.ROLL.cost / h.staminaMax); // repère : endurance d'une roulade
    ctx.fillStyle = OL; ctx.fillRect(rx - 1.5, 80, 3, 13); ctx.fillStyle = '#ffffff'; ctx.fillRect(rx - 0.5, 82, 1, 9);
    txt(ctx, `Endurance ${Math.round(h.stamina)} / ${h.staminaMax}`, 294, 87, 9, '#ffffff', 'right', 2.5);
    let x = 22;
    const item = (s1, col) => { txt(ctx, s1, x, 108, 14, col, 'left'); x += textW(ctx, s1, 14) + 16; };
    item(`🧪 ${s.potions} (A)`, s.potions ? '#ffffff' : '#9a90a8');
    item(`✨ ${h.skillCd > 0 ? Math.ceil(h.skillCd) + ' s' : 'prêt (E)'}`, h.skillCd > 0 ? '#b8b0c8' : '#ffe9a0');
    item(`🎒 ${s.bag.length} / ${s.bagCap}`, s.bag.length >= s.bagCap ? '#ff9a8a' : '#ffffff');
    // en haut au centre : la sortie (et les renforts)
    let msg, col = '#ffffff';
    if (s.exitOpen) {
      const left = X.reinfAfter(G.roomNo) - s.t;
      if (room.boss < 0 && left <= 0) { msg = '⚠️ Renforts en approche !'; col = '#ffb0a0'; }
      else if (room.boss < 0 && left <= 10) { msg = `⚠️ Renforts dans ${Math.ceil(left)} s`; col = '#ffd0a0'; }
      else { msg = room.exit.kind === 'hole' ? '➡️ Cavité ouverte : saute dedans !' : '➡️ Passage ouvert !'; col = '#b8ffb0'; }
    } else if (room.boss >= 0) msg = room.type === 'gardien' ? '👑 Vaincs le gardien pour ouvrir la sortie' : '⚔️ Vaincs l’élite pour ouvrir la sortie';
    else msg = `⏳ Sortie dans ${Math.max(1, Math.ceil(s.exitAt - s.t))} s`;
    const mw = textW(ctx, msg, 15) + 28;
    box(ctx, AW / 2 - mw / 2, 10, mw, 30);
    txt(ctx, msg, AW / 2, 26, 15, col);
    // barre du gardien
    const B = room.boss >= 0 ? s.mobs[0] : null;
    if (B && !B.dead && B.boss) bar(ctx, AW / 2 - 150, 46, 300, 18, B.hp / B.max, '#e2504c', `👑 ${B.name} · ${Math.ceil(B.hp)} / ${B.max}`);
    // en haut à droite : seau / charrette et familiers
    const C = s.cart, cw = cartWord(run.cart.skin), pets = s.pets;
    const bh = 54 + pets.length * 20;
    box(ctx, AW - 250, 10, 240, bh);
    txt(ctx, `${cw.icon} ${cw.name} ${C ? C.items.length : 0} / ${run.cartCap}`, AW - 238, 29, 15, '#ffffff', 'left');
    const sub = C && C.here ? (X.nearCart(s) ? (G.touchMode ? '🛒 : ouvrir' : 'F : ouvrir') : 'quelque part dans la salle') : `parti${run.cart.skin === 'seau' ? '' : 'e'} · retour salle ${run.cart.back}`;
    txt(ctx, sub, AW - 238, 49, 12, C && C.here ? '#c8c0d8' : '#ffd0a0', 'left');
    pets.forEach((p, i) => {
      const y = 70 + i * 20;
      txt(ctx, `🐾 ${p.name}`, AW - 238, y, 12, p.hp > 0 ? '#ffffff' : '#9a90a8', 'left');
      if (p.hp > 0) bar(ctx, AW - 120, y - 6, 100, 12, p.hp / p.max, '#5cb84a', `${p.hp}/${p.max}`);
      else txt(ctx, 'K.-O.', AW - 70, y, 12, '#9a90a8');
    });
    // aide des commandes au début de la première salle
    if (G.roomNo === 1 && G.roomT < 15 && !G.panel) {
      const hint = G.touchMode ? 'Joystick : bouger · touche la scène ou ⚔️ : attaquer / récolter · 🔰 : bouclier · ✨ : compétence · 🧪 : potion'
        : 'ZQSD : bouger · Maj : sprint · Espace : roulade · clic gauche : attaquer / récolter · clic droit : bouclier · E : compétence · A : potion · F : seau';
      ctx.save(); ctx.globalAlpha = Math.min(1, (15 - G.roomT) / 2);
      const w2 = textW(ctx, hint, 13) + 24;
      box(ctx, AW / 2 - w2 / 2, AH - 44, w2, 28); txt(ctx, hint, AW / 2, AH - 30, 13, '#ffffff');
      ctx.restore();
    }
  }

  /* ============================== Minuteurs ============================== */
  // Œufs en incubation
  setInterval(() => {
    const eggs = state && state.pets && state.pets.eggs;
    if (!eggs || !eggs.length) return;
    for (const e of eggs) {
      if (e.readyIn <= 0) continue;
      e.readyIn = Math.max(0, e.readyIn - 1000);
      const tm = document.querySelector(`[data-egg-timer="${e.id}"]`);
      if (tm) tm.textContent = e.readyIn > 0 ? `Éclosion dans ${fmtMs(e.readyIn)}` : 'Prêt à éclore !';
      if (e.readyIn <= 0) {
        const bt = document.querySelector(`[data-egg-btn="${e.id}"]`); if (bt) bt.disabled = false;
        const cv = document.querySelector(`[data-egg="${e.id}"]`); if (cv) cv.dataset.ready = '1';
        Sound.play('gain');
      }
    }
  }, 1000);
  // Énergie (au camp seulement : pendant une expédition, la page n'est pas redessinée)
  setInterval(() => {
    if (!state || state.nextIn === null) return;
    state.nextIn -= 1000;
    if (state.nextIn <= 0) { if (!state.run || state.run.state === 'over') load(); return; }
    const tm = $('#miniTimer');
    if (tm) tm.textContent = ` · prochaine dans ${fmtTime(state.nextIn)}`;
  }, 1000);

  // ouverture de l'onglet
  // debug : accès à la partie affichée (captures et tests automatiques)
  window.MiniGames = { open: load, showHatch, debug: () => G };
})();
