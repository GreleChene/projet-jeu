/* Son de tout le site (synthétisé, sans fichier) : un seul réglage pour la page joueur, les mini-jeux et le Bastion.
 * - un bouton 🔊 en haut de la page : coupure générale, volume de la musique, volume des effets (retenus par le navigateur) ;
 * - une petite musique d'ambiance douce sur tous les onglets, remplacée par la musique d'un jeu quand on y joue ;
 * - de petits bruitages d'interface (changement d'onglet).
 * Les modules de jeu utilisent les mêmes sorties : GameAudio.ctx(), sfxOut(), musicOut(), et le séquenceur playMusic / stopMusic.
 * Thème musical : { bpm, lead, leadVol, bass, bassVol, mel (croches), bas (croches), kick / snare (motifs de 16), hat, bell, pad, padVol }. */
(function () {
  'use strict';
  const prefs = { music: 0.5, sfx: 0.8, muted: false };
  try {
    const saved = localStorage.getItem('gameSound') || localStorage.getItem('bastionSound') || localStorage.getItem('miniSound');
    Object.assign(prefs, JSON.parse(saved || '{}'));
  } catch (e) { /* stockage indisponible */ }
  const save = () => { try { localStorage.setItem('gameSound', JSON.stringify(prefs)); } catch (e) { /* */ } };
  const listeners = new Set();

  let ac = null, master = null, sfxBus = null, musBus = null;
  function ctx() {
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
    musBus.gain.value = prefs.music * 0.42;
  }
  // note : fréquence, durée, forme, volume, décalage, glissement de fréquence, sortie
  function tone(c, f, dur, type, vol, when, slide, out) {
    const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + Math.max(0, when || 0);
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.04, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out || sfxBus); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(c, dur, vol, when, freq, type, out) {
    const n = Math.max(1, Math.floor(c.sampleRate * dur)), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t0 = c.currentTime + Math.max(0, when || 0);
    s.buffer = buf; f.type = type || 'bandpass'; f.frequency.value = freq || 1000; g.gain.value = vol;
    s.connect(f).connect(g).connect(out || sfxBus); s.start(t0);
  }

  /* ---- bruitages d'interface ---- */
  const last = {};
  const UI_SFX = {
    tab: (c) => { tone(c, 880, 0.07, 'triangle', 0.05); tone(c, 1320, 0.09, 'sine', 0.035, 0.04); },
    open: (c) => { tone(c, 660, 0.08, 'sine', 0.04); tone(c, 990, 0.1, 'sine', 0.03, 0.05); },
    toggle: (c) => { tone(c, 1046, 0.06, 'triangle', 0.04); }
  };
  function sfx(name) {
    const now = performance.now();
    if (last[name] && now - last[name] < 45) return;
    last[name] = now;
    if (prefs.muted) return;
    const c = ctx();
    if (c && UI_SFX[name]) try { UI_SFX[name](c); } catch (e) { /* audio indisponible */ }
  }

  /* ---- musique : un seul séquenceur ; un jeu prend la main, sinon l'ambiance douce ---- */
  const N = (n) => 440 * Math.pow(2, (n - 69) / 12); // note MIDI → Hz
  const _ = null;
  // Ambiance de la page : petit air « chill », lent et doux (accords tenus, piano doux, balais)
  const CHILL = { bpm: 72, lead: 'sine', leadVol: 0.045, bass: 'triangle', bassVol: 0.07, kick: 'x.......x.......', snare: '....x.......x...', snareVol: 0.03, hat: 0.008, pad: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]], padVol: 0.018,
    mel: [76, _, _, 79, _, 76, 74, _, 72, _, _, _, 74, _, 76, _, 72, _, _, 74, _, 72, 69, _, 67, _, _, _, _, _, 69, _, 71, _, _, 72, _, 74, 76, _, 77, _, 76, _, 74, _, _, _, 74, _, _, 72, _, 71, 69, _, 67, _, _, _, _, _, _, _],
    bas: [48, _, _, _, _, _, 55, _, 45, _, _, _, _, _, 52, _, 41, _, _, _, _, _, 48, _, 43, _, _, _, 47, _, 50, _] };
  let wanted = null;   // musique demandée par un jeu { key, theme, boss }
  let ambient = false; // l'ambiance démarre au premier geste (règle des navigateurs)
  let cur = null;      // { key, step, next, timer }
  function startSeq(key, T, boss) {
    const c = ctx();
    if (!c) return;
    const step = 60 / T.bpm / 2;
    cur = { key, step: 0, next: c.currentTime + 0.12 };
    const me = cur;
    cur.timer = setInterval(() => {
      while (cur === me && me.next < c.currentTime + 0.25) {
        const i = me.step, w = me.next - c.currentTime, k = i % 16;
        const m = T.mel[i % T.mel.length], b = T.bas[i % T.bas.length];
        if (m) {
          tone(c, N(m), step * 1.7, T.lead, T.leadVol, w, 0, musBus);
          if (T.bell && i % 4 === 0) tone(c, N(m + 24), step * 3, 'sine', T.bell, w + step * 0.5, 0, musBus);
          if (T.counter !== false && i % 4 === 2) tone(c, N(m + 4), step * 1.2, 'sine', T.leadVol * 0.5, w, 0, musBus);
        }
        if (b) tone(c, N(b), step * 3.2, T.bass, T.bassVol, w, 0, musBus);
        if (T.pad && i % 8 === 0) for (const n of T.pad[(i / 8) % T.pad.length]) tone(c, N(n), step * 8, 'sine', T.padVol || 0.02, w, 0, musBus);
        if (T.kick && T.kick[k] === 'x') tone(c, 110, 0.13, 'sine', T.kickVol || 0.18, w, -70, musBus);
        if (T.snare && T.snare[k] === 'x') noise(c, 0.1, T.snareVol || 0.12, w, 1800, 'bandpass', musBus);
        if (T.hat && i % 2 === 1) noise(c, 0.035, T.hat, w, 7000, 'highpass', musBus);
        if (boss && k % 8 === 0) tone(c, N(b || T.bas[0] || 33) / 2, step * 6, 'sawtooth', 0.05, w, 0, musBus);
        me.step++; me.next += step;
      }
    }, 60);
  }
  function stopSeq() { if (cur) { clearInterval(cur.timer); cur = null; } }
  function refresh() {
    const target = wanted || (ambient && !document.hidden ? { key: 'ambiance', theme: CHILL } : null);
    if (!target) { stopSeq(); return; }
    if (cur && cur.key === target.key) return;
    stopSeq();
    startSeq(target.key, target.theme, target.boss);
  }
  // un jeu demande sa musique (clé unique : changer de clé change de morceau)
  function playMusic(key, theme, boss) {
    if (!theme) return;
    if (wanted && wanted.key === key) return;
    wanted = { key, theme, boss: !!boss };
    refresh();
  }
  // arrête la musique d'un jeu (clés qui commencent par prefix) : l'ambiance reprend
  function stopMusic(prefix) {
    if (wanted && (!prefix || wanted.key.startsWith(prefix))) { wanted = null; refresh(); }
  }
  const musicKey = () => (cur ? cur.key : null);
  document.addEventListener('visibilitychange', refresh);
  const startAmbient = () => { if (!ambient) { ambient = true; refresh(); } };
  window.addEventListener('pointerdown', startAmbient, { capture: true });
  window.addEventListener('keydown', startAmbient, { capture: true });

  /* ---- réglages ---- */
  function set(key, v) { prefs[key] = v; save(); applyVolumes(); listeners.forEach((f) => f()); }
  function toggle() { prefs.muted = !prefs.muted; save(); applyVolumes(); listeners.forEach((f) => f()); return prefs.muted; }
  const icon = () => (prefs.muted ? '🔇' : '🔊');
  // bloc de réglages (coupure + deux curseurs), pour le menu du haut de page ou un panneau de jeu
  function controls() {
    const mk = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); } e.append(...kids); return e; };
    const btn = mk('button', { class: 'mini-mute', type: 'button', title: 'Activer / couper tous les sons', onclick: () => { toggle(); btn.textContent = icon(); } }, icon());
    const slider = (key, label) => mk('label', { class: 'mini-vol small' }, label,
      mk('input', { type: 'range', min: 0, max: 100, value: Math.round(prefs[key] * 100), oninput: (e) => { set(key, e.target.value / 100); if (key === 'sfx') sfx('toggle'); } }));
    return mk('div', { class: 'mini-sound' }, btn, slider('music', '🎵 Musique'), slider('sfx', '💥 Effets'));
  }
  // bouton du haut de page : ouvre un petit menu
  function initHeader() {
    const b = document.getElementById('hdrSound');
    if (!b) return;
    const pop = document.createElement('div');
    pop.className = 'sound-pop hidden';
    pop.append(controls());
    b.after(pop);
    b.textContent = icon();
    listeners.add(() => { b.textContent = icon(); });
    b.addEventListener('click', (e) => { e.stopPropagation(); const open = pop.classList.toggle('hidden') === false; if (open) { pop.replaceChildren(controls()); sfx('open'); } });
    document.addEventListener('click', (e) => { if (!pop.contains(e.target) && e.target !== b) pop.classList.add('hidden'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHeader); else initHeader();

  window.GameAudio = {
    ctx, sfxOut: () => (ctx(), sfxBus), musicOut: () => (ctx(), musBus), tone, noise, sfx,
    playMusic, stopMusic, musicKey, prefs, set, toggle, muted: () => prefs.muted, icon, controls,
    onChange: (f) => listeners.add(f)
  };
})();
