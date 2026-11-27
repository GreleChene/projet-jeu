/* Décors des mini-jeux, vus du dessus : sol, murs (roche, arbres, haies), 3 décors × 6 sous-décors par mini-jeu,
 * sorties (cavité au sol, ouverture dans un côté) et fontaine des salles de repos. */
(function () {
  'use strict';
  const GD = window.GameData, A = window.Art, MA = GD.MINI.ARENA;
  const W = MA.W, H = MA.H, WL = MA.WALL;
  const PAL = {
    mine: [
      { floor: ['#8a6a4a', '#7a5a3e'], speck: '#5e4430', wall: '#4a3828', hi: '#6b5240', kind: 'rock' },
      { floor: ['#5a5480', '#4a4466'], speck: '#3a3456', wall: '#2a2440', hi: '#4a4466', kind: 'rock' },
      { floor: ['#4a2a22', '#3a2018'], speck: '#2a140e', wall: '#1e0c0a', hi: '#3a1c18', kind: 'rock' }
    ],
    foret: [
      { floor: ['#4f8a3a', '#447a33'], speck: '#33612a', wall: '#1f4a22', hi: '#2f6b2a', kind: 'trees' },
      { floor: ['#3f6e34', '#355f2e'], speck: '#28502a', wall: '#14351a', hi: '#24522a', kind: 'trees' },
      { floor: ['#4a4a38', '#3a3a2c'], speck: '#2a2a20', wall: '#2a2228', hi: '#3a3030', kind: 'dead' }
    ],
    champ: [
      { floor: ['#c4de72', '#b4d264'], speck: '#98bc4e', wall: '#5aa04a', hi: '#7cc45a', kind: 'fence' },
      { floor: ['#a8d66c', '#98ca5e'], speck: '#7cb24c', wall: '#4f8a3a', hi: '#6ab84a', kind: 'fence' },
      { floor: ['#b8a65e', '#a89650'], speck: '#8a7a40', wall: '#6a6a3a', hi: '#8a8a4a', kind: 'fence', tint: 'rgba(255,140,80,.13)' }
    ]
  };
  const pal = (mode, decor) => PAL[mode][Math.min(2, decor)];

  // petits outils de dessin vus du dessus
  const glowAt = (c, x, y, col, r) => { c.save(); c.translate(x, y); A.glow(c, col, r); c.restore(); };
  const blob = (c, x, y, rx, ry, col, a) => { c.save(); if (a !== undefined) c.globalAlpha = a; c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); c.restore(); };
  const rock = (c, x, y, r, col) => { A.circle(c, x, y, r, col, 2); blob(c, x - r * 0.3, y - r * 0.35, r * 0.35, r * 0.25, 'rgba(255,255,255,.25)'); };
  const shard = (c, x, y, s, col) => { for (const [dx, dy, k] of [[0, 0, 1], [-s * 0.5, s * 0.2, 0.7], [s * 0.5, s * 0.3, 0.6]]) A.poly(c, [x + dx, y + dy - s * k, x + dx + s * 0.3 * k, y + dy, x + dx, y + dy + s * 0.35 * k, x + dx - s * 0.3 * k, y + dy], col, 1.5); };
  const canopy = (c, x, y, r, col) => { blob(c, x + 4, y + 6, r, r * 0.8, 'rgba(0,0,0,.25)'); A.circle(c, x, y, r, col, 2.5); blob(c, x - r * 0.3, y - r * 0.3, r * 0.45, r * 0.35, 'rgba(255,255,255,.18)'); };
  const plank = (c, x, y, w, h, col) => A.rrect(c, x, y, w, h, 2, col, 1.5);
  // point au hasard près des murs (le centre reste libre pour jouer)
  const edge = (R, m) => { m = m || 70; const side = Math.floor(R() * 4); const t = R(); if (side === 0) return { x: WL + 20 + t * (W - 2 * WL - 40), y: WL + 10 + R() * m }; if (side === 1) return { x: WL + 20 + t * (W - 2 * WL - 40), y: H - WL - 10 - R() * m }; if (side === 2) return { x: WL + 10 + R() * m, y: WL + 20 + t * (H - 2 * WL - 40) }; return { x: W - WL - 10 - R() * m, y: WL + 20 + t * (H - 2 * WL - 40) }; };
  const anywhere = (R) => ({ x: WL + 30 + R() * (W - 2 * WL - 60), y: WL + 30 + R() * (H - 2 * WL - 60) });
  const corner = (R, k) => [{ x: WL + 60, y: WL + 55 }, { x: W - WL - 60, y: WL + 55 }, { x: WL + 60, y: H - WL - 55 }, { x: W - WL - 60, y: H - WL - 55 }][k === undefined ? Math.floor(R() * 4) : k];
  const n = (R, a, b) => a + Math.floor(R() * (b - a + 1));

  // 3 décors × 6 sous-décors par mini-jeu (même ordre que GD.MINI.MODES[mode].decors)
  const PROPS = {
    mine: [
      [ // Galeries de terre
        (c, R) => { for (let i = 0; i < 6; i++) { const p = edge(R, 30); plank(c, p.x - 30, p.y - 5, 60, 10, '#a8703f'); } }, // entrée étayée : poutres
        (c, R) => { for (let i = 0; i < 6; i++) { const p = edge(R, 20); glowAt(c, p.x, p.y, '#ffb84a', 40); A.rrect(c, p.x - 6, p.y - 8, 12, 16, 3, '#ffd76a', 2); } }, // lanternes
        (c, R) => { const y = H * (0.3 + R() * 0.4); for (const dy of [-10, 10]) A.line(c, WL, y + dy, W - WL, y + dy, '#8a8a92', 2.5); for (let x = WL + 10; x < W - WL; x += 34) plank(c, x, y - 15, 8, 30, '#6b4a2a'); }, // rails
        (c, R) => { for (let i = 0; i < 3; i++) { const p = edge(R, 40); A.rrect(c, p.x - 22, p.y - 14, 44, 28, 4, '#6a6e78', 2); for (let k = 0; k < 4; k++) rock(c, p.x - 12 + k * 8, p.y - 2, 6, '#9aa3ae'); } }, // wagonnets
        (c) => { c.fillStyle = 'rgba(30,20,12,.5)'; c.fillRect(WL, WL, W - 2 * WL, 40); c.fillRect(WL, H - WL - 40, W - 2 * WL, 40); }, // boyau étroit
        (c, R) => { for (let i = 0; i < 7; i++) { const p = edge(R, 50); for (let k = 0; k < 4; k++) rock(c, p.x + (R() - 0.5) * 34, p.y + (R() - 0.5) * 24, 7 + R() * 8, '#8a7a6a'); } } // éboulis
      ],
      [ // Cavernes de cristal
        (c, R) => { for (let i = 0; i < 8; i++) { const p = edge(R, 40); glowAt(c, p.x, p.y, '#b48cff', 30); shard(c, p.x, p.y, 16 + R() * 10, '#b48cff'); } },
        (c, R) => { const p = corner(R); blob(c, p.x, p.y, 120, 70, '#3a6ab8'); blob(c, p.x - 20, p.y - 10, 70, 30, 'rgba(160,210,255,.4)'); },
        (c, R) => { for (let i = 0; i < 14; i++) { const p = edge(R, 60); A.circle(c, p.x, p.y, 8 + R() * 8, '#6a6488', 2); blob(c, p.x - 2, p.y - 3, 3, 3, '#a8a0c8'); } },
        (c, R) => { const p = corner(R); A.circle(c, p.x, p.y, 60, '#2a2440', 3); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; shard(c, p.x + Math.cos(a) * 44, p.y + Math.sin(a) * 44, 12, i % 2 ? '#7fd6ff' : '#b48cff'); } },
        (c, R) => { const y = R() < 0.5 ? WL + 30 : H - WL - 30; c.fillStyle = '#0e0a18'; c.fillRect(WL, y - 22, W - 2 * WL, 44); const x = W * (0.3 + R() * 0.4); plank(c, x - 40, y - 26, 80, 52, '#6a6488'); }, // pont de pierre
        (c, R) => { c.strokeStyle = 'rgba(127,214,255,.7)'; c.lineWidth = 4; for (let i = 0; i < 5; i++) { let p = anywhere(R); c.beginPath(); c.moveTo(p.x, p.y); for (let k = 0; k < 5; k++) { p = { x: p.x + (R() - 0.5) * 120, y: p.y + (R() - 0.5) * 80 }; c.lineTo(p.x, p.y); } c.stroke(); } }
      ],
      [ // Profondeurs de magma
        (c, R) => { const x = R() < 0.5 ? WL + 30 : W - WL - 30; glowAt(c, x, H / 2, '#ff6a1a', 160); c.fillStyle = '#ff6a1a'; c.fillRect(x - 18, WL, 36, H - 2 * WL); c.fillStyle = '#ffd23a'; for (let y = WL; y < H - WL; y += 40) c.fillRect(x - 4, y, 8, 18); },
        (c, R) => { const p = corner(R); A.rrect(c, p.x - 30, p.y - 14, 60, 28, 4, '#4a4a56', 2.5); for (let i = 0; i < 3; i++) { const q = edge(R, 30); A.circle(c, q.x, q.y, 16, '#5a3a32', 2.5); } },
        (c, R) => { for (let i = 0; i < 10; i++) { const p = edge(R, 50); shard(c, p.x, p.y, 14 + R() * 10, '#1a1420'); } },
        (c, R) => { for (let i = 0; i < 4; i++) { const p = edge(R, 60); glowAt(c, p.x, p.y, '#ff8a3a', 50); A.circle(c, p.x, p.y, 12, '#3a1810', 2); blob(c, p.x, p.y, 6, 6, '#ffb03a'); } },
        (c, R) => { const p = corner(R); A.rrect(c, p.x - 34, p.y - 30, 68, 60, 6, '#5a2e26', 3); A.rrect(c, p.x - 20, p.y - 20, 40, 34, 4, '#8a3a2a', 2); A.poly(c, [p.x - 20, p.y - 30, p.x - 10, p.y - 44, p.x, p.y - 30, p.x + 10, p.y - 44, p.x + 20, p.y - 30], '#f2c14e', 2); },
        (c, R) => { const p = corner(R); glowAt(c, p.x, p.y, '#ff5a1a', 120); blob(c, p.x, p.y, 90, 60, '#120808'); }
      ]
    ],
    foret: [
      [ // Sous-bois
        (c, R) => { for (let i = 0; i < 6; i++) { const p = anywhere(R); blob(c, p.x, p.y, 60 + R() * 40, 40 + R() * 20, 'rgba(255,250,200,.18)'); } },
        (c, R) => { c.strokeStyle = '#b89a6a'; c.lineWidth = 34; c.lineCap = 'round'; c.beginPath(); c.moveTo(WL, H * (0.3 + R() * 0.4)); c.bezierCurveTo(W * 0.35, R() * H, W * 0.65, R() * H, W - WL, H * (0.3 + R() * 0.4)); c.stroke(); },
        (c, R) => { c.strokeStyle = '#6fc6ef'; c.lineWidth = 30; c.lineCap = 'round'; c.beginPath(); const x0 = W * (0.25 + R() * 0.5); c.moveTo(x0, WL); c.bezierCurveTo(x0 + 120, H * 0.35, x0 - 120, H * 0.65, x0 + 40, H - WL); c.stroke(); c.strokeStyle = 'rgba(212,242,255,.6)'; c.lineWidth = 4; c.stroke(); },
        (c, R) => { const p = corner(R); A.circle(c, p.x, p.y, 44, '#8a5e38', 3); for (const r of [32, 22, 12]) { c.strokeStyle = '#a8703f'; c.lineWidth = 2; c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.stroke(); } },
        (c, R) => { for (let k = 0; k < 2; k++) { const p = anywhere(R); for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; A.circle(c, p.x + Math.cos(a) * 46, p.y + Math.sin(a) * 30, 6, i % 2 ? '#e2504c' : '#c97b3a', 1.5); } } },
        (c, R) => { const p = corner(R); A.rrect(c, p.x - 40, p.y - 32, 80, 64, 4, '#6b3b33', 3); A.line(c, p.x - 40, p.y, p.x + 40, p.y, '#4a2a22', 3); }
      ],
      [ // Forêt profonde
        (c, R) => { for (let i = 0; i < 6; i++) { const p = edge(R, 30); canopy(c, p.x, p.y, 40 + R() * 16, '#2f6b3a'); } },
        (c, R) => { for (let i = 0; i < 7; i++) { const p = anywhere(R); blob(c, p.x, p.y, 120, 40, 'rgba(240,245,240,.16)'); } },
        (c, R) => { for (let i = 0; i < 4; i++) { const p = edge(R, 80); blob(c, p.x, p.y, 70, 40, '#3a5a3a'); for (let k = 0; k < 5; k++) A.line(c, p.x - 50 + k * 22, p.y - 10, p.x - 48 + k * 22, p.y - 30, '#5a8a3a', 2); } },
        (c, R) => { c.lineCap = 'round'; for (let i = 0; i < 6; i++) { const p = edge(R, 40), q = anywhere(R); c.strokeStyle = '#120c0a'; c.lineWidth = 14; c.beginPath(); c.moveTo(p.x, p.y); c.quadraticCurveTo((p.x + q.x) / 2 + 40, (p.y + q.y) / 2, q.x, q.y); c.stroke(); c.strokeStyle = '#6b4424'; c.lineWidth = 9; c.stroke(); } },
        (c, R) => { for (let i = 0; i < 6; i++) { const p = edge(R, 50); A.rrect(c, p.x - 18, p.y - 18, 36, 36, 3, '#a8a29a', 2.5); blob(c, p.x - 4, p.y - 4, 8, 6, 'rgba(255,255,255,.25)'); } },
        (c, R) => { const p = corner(R); for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; A.circle(c, p.x + Math.cos(a) * 50, p.y + Math.sin(a) * 40, 11, '#8a8f96', 2); } }
      ],
      [ // Bois maudit
        (c, R) => { c.lineCap = 'round'; for (let i = 0; i < 8; i++) { const p = edge(R, 40); for (let k = 0; k < 4; k++) { const a = R() * Math.PI * 2; A.line(c, p.x, p.y, p.x + Math.cos(a) * 36, p.y + Math.sin(a) * 36, '#3a2a22', 3); } } },
        (c) => { c.strokeStyle = 'rgba(240,240,250,.55)'; c.lineWidth = 1.2; for (const [x, y] of [[WL, WL], [W - WL, WL], [WL, H - WL], [W - WL, H - WL]]) { for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * 110, y + Math.sin(a) * 110); c.stroke(); } for (let q = 1; q < 5; q++) { c.beginPath(); c.arc(x, y, q * 22, 0, Math.PI * 2); c.stroke(); } } },
        (c, R) => { for (let i = 0; i < 10; i++) { const p = anywhere(R); glowAt(c, p.x, p.y, '#9fffd6', 18); blob(c, p.x, p.y, 3, 3, '#e0fff2'); } },
        (c, R) => { for (let i = 0; i < 8; i++) { const p = edge(R, 60); A.rrect(c, p.x - 10, p.y - 16, 20, 30, 6, '#7a7880', 2); A.line(c, p.x, p.y - 10, p.x, p.y + 4, '#4a4850', 2); A.line(c, p.x - 6, p.y - 5, p.x + 6, p.y - 5, '#4a4850', 2); } },
        (c, R) => { const p = edge(R, 40); A.rrect(c, p.x - 90, p.y - 20, 180, 40, 18, '#5a3a22', 3); blob(c, p.x - 80, p.y, 12, 14, '#1a120c'); },
        (c, R) => { const p = corner(R); glowAt(c, p.x, p.y, '#ff6aa8', 70); A.circle(c, p.x, p.y, 34, '#3a2a30', 3); A.circle(c, p.x, p.y, 10, '#ff6aa8', 2); }
      ]
    ],
    champ: [
      [ // Champs ensoleillés
        (c, R) => { for (let i = 0; i < 5; i++) { const p = edge(R, 40); A.rrect(c, p.x - 40, p.y - 14, 80, 28, 12, '#3f8a3a', 2.5); for (let k = 0; k < 5; k++) A.circle(c, p.x - 30 + k * 15, p.y - 4 + (k % 2) * 6, 3.5, '#3a2a6a', 1); } },
        (c, R) => { for (let i = 0; i < 6; i++) { const p = edge(R, 50); A.circle(c, p.x, p.y, 22, '#e8c46a', 2.5); c.strokeStyle = '#c9a04a'; c.lineWidth = 1.5; c.beginPath(); c.arc(p.x, p.y, 12, 0, Math.PI * 2); c.stroke(); } },
        (c, R) => { const p = anywhere(R); A.line(c, p.x - 30, p.y, p.x + 30, p.y, '#6b4424', 5); A.line(c, p.x, p.y - 20, p.x, p.y + 30, '#6b4424', 5); A.circle(c, p.x, p.y - 22, 10, '#e8c46a', 2); A.rrect(c, p.x - 10, p.y - 10, 20, 18, 3, '#c0392b', 2); },
        (c, R) => { const p = corner(R); A.circle(c, p.x, p.y, 30, '#efe6d2', 3); for (let k = 0; k < 4; k++) { const a = 0.4 + (k * Math.PI) / 2; A.line(c, p.x, p.y, p.x + Math.cos(a) * 70, p.y + Math.sin(a) * 70, '#ffffff', 9); } A.circle(c, p.x, p.y, 7, '#8a5a2e', 2); },
        (c, R) => { for (let i = 0; i < 4; i++) { const p = edge(R, 40); A.rrect(c, p.x - 14, p.y - 12, 28, 24, 4, '#e8b83a', 2); for (let k = 0; k < 4; k++) blob(c, p.x + (R() - 0.5) * 60, p.y + (R() - 0.5) * 50, 2, 2, '#ffd23a'); } },
        (c, R) => { for (let i = 0; i < 5; i++) { const p = edge(R, 40); canopy(c, p.x, p.y, 30, '#5cb84a'); for (let k = 0; k < 5; k++) A.circle(c, p.x + (R() - 0.5) * 40, p.y + (R() - 0.5) * 40, 4, '#e2504c', 1); } }
      ],
      [ // Collines sauvages
        (c, R) => { for (let i = 0; i < 7; i++) { const p = edge(R, 50); A.circle(c, p.x, p.y, 20, '#4f7a3a', 2.5); c.strokeStyle = '#2f4a22'; c.lineWidth = 1.5; for (let k = 0; k < 8; k++) { const a = R() * Math.PI * 2; c.beginPath(); c.moveTo(p.x + Math.cos(a) * 16, p.y + Math.sin(a) * 16); c.lineTo(p.x + Math.cos(a) * 26, p.y + Math.sin(a) * 26); c.stroke(); } } },
        (c, R) => { for (let i = 0; i < 7; i++) { const p = edge(R, 50); rock(c, p.x, p.y, 16 + R() * 10, '#8d8f96'); blob(c, p.x - 4, p.y - 8, 12, 6, '#5cb84a'); } },
        (c, R) => { const cols = ['#ff9fd0', '#ffffff', '#ffd23a', '#c9a0ff', '#e2504c']; for (let i = 0; i < 90; i++) { const p = anywhere(R); blob(c, p.x, p.y, 3, 3, cols[i % 5]); } },
        (c, R) => { const y = H * (0.3 + R() * 0.4); c.fillStyle = '#6fc6ef'; c.fillRect(WL, y - 18, W - 2 * WL, 36); const x = W * (0.3 + R() * 0.4); plank(c, x - 30, y - 26, 60, 52, '#a8703f'); },
        (c, R) => { const p = corner(R); A.rrect(c, p.x - 50, p.y - 38, 100, 76, 4, '#9a3a32', 3); A.line(c, p.x - 50, p.y, p.x + 50, p.y, '#5a2a22', 3); },
        (c, R) => { const p = corner(R); A.circle(c, p.x, p.y, 30, '#9a9ca4', 3); A.circle(c, p.x, p.y, 18, '#1a1a22', 2); }
      ],
      [ // Vallée crépusculaire
        (c) => { const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'rgba(255,170,90,.25)'); g.addColorStop(1, 'rgba(120,70,140,.2)'); c.fillStyle = g; c.fillRect(0, 0, W, H); },
        (c, R) => { for (let i = 0; i < 10; i++) { const p = edge(R, 60); A.circle(c, p.x, p.y, 12, '#ff8a1a', 2); A.line(c, p.x, p.y - 12, p.x + 2, p.y - 18, '#3f7f2a', 3); } },
        (c, R) => { for (let i = 0; i < 4; i++) { const p = edge(R, 30); canopy(c, p.x, p.y, 44, '#3f6a32'); for (let k = 0; k < 8; k++) A.circle(c, p.x + (R() - 0.5) * 60, p.y + (R() - 0.5) * 60, 4, k % 2 ? '#5a4fd6' : '#c0306a', 1); } },
        (c, R) => { const p = corner(R); A.circle(c, p.x, p.y, 40, '#7a7470', 3); A.circle(c, p.x, p.y, 26, '#5a5450', 2); },
        (c, R) => { for (let i = 0; i < 16; i++) { const p = anywhere(R); glowAt(c, p.x, p.y, '#eaff7a', 10); } },
        (c, R) => { const p = corner(R); A.rrect(c, p.x - 40, p.y - 24, 80, 48, 4, '#8a8f96', 3); glowAt(c, p.x, p.y, '#ffd27a', 40); }
      ]
    ]
  };

  // Murs : roche (caverne), arbres (forêt), arbres morts (bois maudit), haies (clairière)
  function walls(c, P, R) {
    c.fillStyle = P.wall;
    c.fillRect(0, 0, W, WL); c.fillRect(0, H - WL, W, WL); c.fillRect(0, 0, WL, H); c.fillRect(W - WL, 0, WL, H);
    const along = (step, fn) => { for (let x = 0; x <= W; x += step) { fn(x, WL - 6); fn(x, H - WL + 6); } for (let y = 0; y <= H; y += step) { fn(WL - 6, y); fn(W - WL + 6, y); } };
    if (P.kind === 'rock') along(34, (x, y) => rock(c, x + (R() - 0.5) * 10, y + (R() - 0.5) * 8, 16 + R() * 8, P.hi));
    else if (P.kind === 'trees') {
      const along2 = (step, off, fn) => { for (let x = 0; x <= W; x += step) { fn(x, WL - off); fn(x, H - WL + off); } for (let y = 0; y <= H; y += step) { fn(WL - off, y); fn(W - WL + off, y); } };
      along2(46, 22, (x, y) => canopy(c, x + (R() - 0.5) * 14, y + (R() - 0.5) * 10, 32 + R() * 10, R() < 0.5 ? P.wall : A.shade(P.wall, -0.15)));
      along2(38, 0, (x, y) => canopy(c, x + (R() - 0.5) * 12, y + (R() - 0.5) * 10, 22 + R() * 8, R() < 0.5 ? P.hi : P.wall));
    }
    else if (P.kind === 'dead') along(46, (x, y) => { A.circle(c, x, y, 10, '#3a2a22', 2); for (let k = 0; k < 3; k++) { const a = R() * Math.PI * 2; A.line(c, x, y, x + Math.cos(a) * 26, y + Math.sin(a) * 26, '#3a2a22', 3); } });
    else { // haie basse fleurie, puis clôture en bois (piquets et deux traverses) côté pré
      along(26, (x, y) => { A.circle(c, x, y - 8, 15 + R() * 4, P.hi, 2); if (R() < 0.4) blob(c, x + (R() - 0.5) * 12, y - 8 + (R() - 0.5) * 10, 3, 3, ['#ff9fd0', '#ffffff', '#ffd23a'][Math.floor(R() * 3)]); });
      const wood = '#b07a44', I = WL + 4;
      for (const yy of [I, H - I]) { A.line(c, I, yy - 4, W - I, yy - 4, wood, 3); A.line(c, I, yy + 4, W - I, yy + 4, wood, 3); }
      for (const xx of [I, W - I]) { A.line(c, xx - 4, I, xx - 4, H - I, wood, 3); A.line(c, xx + 4, I, xx + 4, H - I, wood, 3); }
      for (let x = I; x <= W - I; x += 32) for (const yy of [I, H - I]) A.rrect(c, x - 4, yy - 10, 8, 18, 2, '#8a5e38', 1.8);
      for (let y = I + 32; y < H - I; y += 32) for (const xx of [I, W - I]) A.rrect(c, xx - 4, y - 10, 8, 18, 2, '#8a5e38', 1.8);
    }
  }

  // Fond d'une salle (mis en cache par la page) : room = résultat de Expedition.genRoom ; scale = finesse (écrans haute densité)
  // Sol en pixel art : grandes plaques (bruit lissé) découpées en pixels de 8 px, avec un tramage aux bordures
  function floor(c, P, R) {
    const S = 8, Gd = 72, gw = Math.ceil(W / Gd) + 2, gh = Math.ceil(H / Gd) + 2, g = [];
    for (let i = 0; i < gw * gh; i++) g.push(R());
    const sm = (t) => t * t * (3 - 2 * t);
    const at = (x, y) => {
      const gx = x / Gd, gy = y / Gd, x0 = Math.floor(gx), y0 = Math.floor(gy), u = sm(gx - x0), v = sm(gy - y0);
      const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], d = g[(y0 + 1) * gw + x0], e = g[(y0 + 1) * gw + x0 + 1];
      return a + (b - a) * u + (d - a) * v + (a - b - d + e) * u * v;
    };
    const shades = [A.shade(P.floor[0], 0.06), P.floor[0], P.floor[1], A.shade(P.floor[1], -0.07)];
    for (let y = 0; y < H; y += S) for (let x = 0; x < W; x += S) {
      const v = at(x + S / 2, y + S / 2) * 4.6 - 0.3 + (((x / S + y / S) & 1) ? 0.16 : -0.16);
      c.fillStyle = shades[Math.max(0, Math.min(3, Math.floor(v)))]; c.fillRect(x, y, S, S);
    }
  }
  // Détails du sol, pixel par pixel (3 px) : cailloux et fissures, touffes d'herbe, fleurs, feuilles mortes
  function floorDetails(c, P, R) {
    const px = (x, y, col) => { c.fillStyle = col; c.fillRect(Math.round(x / 3) * 3, Math.round(y / 3) * 3, 3, 3); };
    const dark = A.shade(P.floor[1], -0.25), light = A.shade(P.floor[0], 0.22);
    if (P.kind === 'rock') {
      for (let i = 0; i < 90; i++) { const p = anywhere(R), w = R() < 0.3 ? 2 : 1; for (let a = 0; a <= w; a++) px(p.x + a * 3, p.y, P.speck); px(p.x, p.y - 3, light); px(p.x + w * 3 + 3, p.y + 3, dark); }
      for (let i = 0; i < 12; i++) { let p = anywhere(R); for (let k = 0; k < 9; k++) { px(p.x, p.y, dark); p = { x: p.x + (R() < 0.5 ? 3 : -3) * (R() < 0.7 ? 1 : 0) + 3, y: p.y + (R() < 0.5 ? 3 : 0) }; } }
      return;
    }
    if (P.kind === 'fence') { // pré tondu : bandes alternées plus claires
      c.fillStyle = 'rgba(255,255,220,.07)';
      for (let x = WL; x < W - WL; x += 96) c.fillRect(x, WL, 48, H - 2 * WL);
      for (let i = 0; i < 40; i++) { const p = anywhere(R); for (let k = 0; k < 4; k++) { px(p.x + k * 3, p.y - (k % 2) * 3, '#e8c46a'); px(p.x + k * 3, p.y - 6 - (k % 2) * 3, '#f5dc8a'); } } // touffes de blé
    }
    if (P.kind === 'trees') {
      for (let i = 0; i < 26; i++) { const p = anywhere(R); for (let k = 0; k < 7; k++) px(p.x + (R() - 0.5) * 24, p.y + (R() - 0.5) * 16, A.shade(P.floor[1], -0.12)); } // mousse
      for (let i = 0; i < 22; i++) { const p = anywhere(R), col = A.shade(P.hi, 0.1); for (let k = 0; k < 5; k++) { px(p.x - k * 3, p.y - k * 3, col); px(p.x + k * 3, p.y - k * 3, col); px(p.x - k * 3 - 3, p.y - k * 3 + 3, col); px(p.x + k * 3 + 3, p.y - k * 3 + 3, col); } } // fougères
      for (let i = 0; i < 10; i++) { const p = anywhere(R); px(p.x, p.y + 3, '#efe6d6'); px(p.x - 3, p.y, '#e2504c'); px(p.x, p.y, '#e2504c'); px(p.x + 3, p.y, '#e2504c'); px(p.x, p.y - 3, '#ffffff'); } // champignons
    }
    const grassD = A.shade(P.floor[1], -0.18), grassL = A.shade(P.floor[0], 0.18);
    for (let i = 0; i < 170; i++) { // touffes d'herbe
      const p = anywhere(R);
      px(p.x - 3, p.y, grassD); px(p.x, p.y, grassD); px(p.x + 3, p.y, grassD);
      px(p.x - 3, p.y - 3, grassD); px(p.x, p.y - 6, grassL); px(p.x + 3, p.y - 3, grassD);
    }
    if (P.kind === 'dead') { for (let i = 0; i < 60; i++) { const p = anywhere(R); px(p.x, p.y, '#5a4a40'); px(p.x + 3, p.y, '#3a2e28'); } return; }
    const flowers = P.kind === 'fence' ? ['#ffffff', '#ffd23a', '#ff9fd0', '#c9a0ff', '#e2504c', '#5ab4f0'] : ['#ffffff', '#d9b07a'];
    for (let i = 0; i < (P.kind === 'fence' ? 140 : 14); i++) { // petites fleurs (croix de 4 pixels autour d'un cœur jaune)
      const p = anywhere(R), col = flowers[Math.floor(R() * flowers.length)];
      px(p.x - 3, p.y, col); px(p.x + 3, p.y, col); px(p.x, p.y - 3, col); px(p.x, p.y + 3, col); px(p.x, p.y, '#ffb02e');
    }
    if (P.kind === 'trees') for (let i = 0; i < 130; i++) { const p = anywhere(R), col = ['#c97b3a', '#e8a04a', '#8a5e38'][i % 3]; px(p.x, p.y, col); px(p.x + 3, p.y + 3, A.shade(col, -0.2)); }
  }
  // Profondeur des murs : face intérieure du mur du haut et ombres portées sur les quatre côtés
  function wallDepth(c, P) {
    const face = A.shade(P.wall, -0.15);
    c.fillStyle = face; c.fillRect(WL - 6, WL - 2, W - 2 * WL + 12, 14);
    c.fillStyle = A.shade(P.wall, 0.12); for (let x = WL; x < W - WL; x += 12) c.fillRect(x, WL - 2, 6, 3);
    c.fillStyle = 'rgba(0,0,0,.18)'; for (let x = WL + 6; x < W - WL; x += 24) c.fillRect(x, WL + 2, 3, 10);
    const side = (x0, y0, x1, y1, w) => { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(0,0,0,.32)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; return g; };
    side(0, WL + 12, 0, WL + 46); c.fillRect(WL, WL + 12, W - 2 * WL, 34);
    side(WL, 0, WL + 22, 0); c.fillRect(WL, WL, 22, H - 2 * WL);
    side(W - WL, 0, W - WL - 22, 0); c.fillRect(W - WL - 22, WL, 22, H - 2 * WL);
    side(0, H - WL, 0, H - WL - 14); c.fillRect(WL, H - WL - 14, W - 2 * WL, 14);
  }

  // Fond d'une salle (mis en cache par la page) : room = résultat de Expedition.genRoom ; scale = finesse (écrans haute densité)
  function drawRoomBg(room, scale) {
    const k = scale || 1, cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    const c = cv.getContext('2d'), P = pal(room.mode, room.decor);
    c.scale(k, k);
    const R = window.Terrain.mulberry32(((room.seed | 0) ^ Math.imul(room.room + 1, 7919)) | 0);
    floor(c, P, R);
    floorDetails(c, P, R);
    const f = PROPS[room.mode][Math.min(2, room.decor)][room.sub];
    if (f) f(c, R, P);
    wallDepth(c, P);
    if (P.kind === 'trees') {
      for (let i = 0; i < 46; i++) { const p = edge(R, 40); blob(c, p.x, p.y, 40 + R() * 40, 26 + R() * 22, 'rgba(6,24,6,.2)'); }
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) { const x0 = 120 + R() * (W - 240); c.fillStyle = 'rgba(255,240,170,.05)'; c.beginPath(); c.moveTo(x0, WL); c.lineTo(x0 + 70, WL); c.lineTo(x0 + 230, H - WL); c.lineTo(x0 + 130, H - WL); c.fill(); }
      c.restore();
    }
    walls(c, P, R);
    if (P.tint) { c.fillStyle = P.tint; c.fillRect(0, 0, W, H); }
    return cv;
  }

  // Sortie : cavité au sol (caverne) ou ouverture dans un côté (forêt, clairière), dessinée une fois ouverte
  function drawExit(c, room, t) {
    const e = room.exit, P = pal(room.mode, room.decor);
    if (e.kind === 'hole') {
      glowAt(c, e.x, e.y, '#ffe9a0', 50 + Math.sin(t * 3) * 6);
      A.ellipse(c, e.x, e.y, e.r + 8, (e.r + 8) * 0.7, '#3a2a1a', 3);
      const g = c.createRadialGradient(e.x, e.y, 2, e.x, e.y, e.r);
      g.addColorStop(0, '#000000'); g.addColorStop(1, '#2a1a10');
      c.fillStyle = g; c.beginPath(); c.ellipse(e.x, e.y, e.r, e.r * 0.7, 0, 0, Math.PI * 2); c.fill();
      for (let i = 0; i < 6; i++) { const a = t * 2 + (i / 6) * Math.PI * 2; blob(c, e.x + Math.cos(a) * e.r * 0.6, e.y + Math.sin(a) * e.r * 0.42, 2, 2, '#ffe9a0'); }
      return;
    }
    const hw = e.w / 2;
    c.save();
    c.fillStyle = P.floor[0];
    if (e.side === 'n') c.fillRect(e.x - hw, 0, e.w, WL + 6);
    if (e.side === 's') c.fillRect(e.x - hw, H - WL - 6, e.w, WL + 6);
    if (e.side === 'w') c.fillRect(0, e.y - hw, WL + 6, e.w);
    if (e.side === 'e') c.fillRect(W - WL - 6, e.y - hw, WL + 6, e.w);
    const horiz = e.side === 'n' || e.side === 's';
    if (P.kind === 'fence') { // portail ouvert : deux gros piquets et les battants rabattus
      const ends = horiz ? [[e.x - hw, e.side === 'n' ? WL + 4 : H - WL - 4], [e.x + hw, e.side === 'n' ? WL + 4 : H - WL - 4]] : [[e.side === 'w' ? WL + 4 : W - WL - 4, e.y - hw], [e.side === 'w' ? WL + 4 : W - WL - 4, e.y + hw]];
      for (const [x, y] of ends) A.rrect(c, x - 6, y - 14, 12, 24, 3, '#8a5e38', 2);
      const [a0, a1] = ends;
      A.line(c, a0[0], a0[1], a0[0] + (horiz ? 10 : 30) * (horiz ? 1 : (e.side === 'w' ? 1 : -1)), a0[1] + (horiz ? 30 * (e.side === 'n' ? 1 : -1) : 10), '#b07a44', 4);
      A.line(c, a1[0], a1[1], a1[0] + (horiz ? -10 : 30 * (e.side === 'w' ? 1 : -1)), a1[1] + (horiz ? 30 * (e.side === 'n' ? 1 : -1) : -10), '#b07a44', 4);
    } else if (P.kind === 'trees' || P.kind === 'dead') { // chemin de terre qui s'enfonce dans les arbres
      c.fillStyle = '#8a6a44';
      if (horiz) c.fillRect(e.x - 26, e.side === 'n' ? 0 : H - WL - 10, 52, WL + 10); else c.fillRect(e.side === 'w' ? 0 : W - WL - 10, e.y - 26, WL + 10, 52);
    }
    // flèches qui montrent la sortie
    const dir = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[e.side];
    const bx = e.side === 'w' ? WL + 20 : e.side === 'e' ? W - WL - 20 : e.x, by = e.side === 'n' ? WL + 20 : e.side === 's' ? H - WL - 20 : e.y;
    glowAt(c, bx, by, '#ffe9a0', 40);
    for (let k = 0; k < 3; k++) {
      const o = ((t * 30 + k * 14) % 42) - 6, px = bx + dir[0] * o, py = by + dir[1] * o, a = Math.atan2(dir[1], dir[0]);
      c.save(); c.translate(px, py); c.rotate(a); c.globalAlpha = 0.9 - k * 0.25;
      A.poly(c, [-6, -10, 6, 0, -6, 10, -2, 0], '#fff6c0', 1.5); c.restore();
    }
    c.restore();
  }

  // Fontaine des salles de repos
  // left : part du soin qui reste (1 = pleine, 0 = tarie)
  function drawFountain(c, f, t, left) {
    const k0 = left === undefined ? 1 : Math.max(0, Math.min(1, left));
    A.shadow(c, f.x + 4, f.y + 8, f.r + 4, f.r * 0.5);
    A.circle(c, f.x, f.y, f.r, '#a6aab2', 3);
    A.circle(c, f.x, f.y, f.r - 8, k0 > 0 ? '#6fc6ef' : '#7a7470', 2);
    if (k0 <= 0) return;
    for (let i = 0; i < 3; i++) { const k = (t * 1.4 + i / 3) % 1; c.strokeStyle = `rgba(220,245,255,${(1 - k) * k0})`; c.lineWidth = 2; c.beginPath(); c.arc(f.x, f.y, 4 + k * (f.r - 10), 0, Math.PI * 2); c.stroke(); }
    c.save(); c.globalAlpha = k0; glowAt(c, f.x, f.y, '#9fffd6', 30 + Math.sin(t * 2) * 4); c.restore();
  }

  window.MiniDecor = { drawRoomBg, drawExit, drawFountain, palette: pal };
})();
