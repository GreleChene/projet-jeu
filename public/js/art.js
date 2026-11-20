/*
 * Direction artistique unique du jeu : tous les visuels (stream, aperçu joueur, admin)
 * passent par ce module. Style : aplats, contour sombre unique, ombre portée douce,
 * proportions « chibi ». Toutes les couleurs viennent de GameData.PALETTE.
 */
(function () {
  'use strict';
  const GD = window.GameData;
  const T = window.Terrain;
  const P = GD.PALETTE;
  const OL = P.outline;
  const TAU = Math.PI * 2;

  /* ------------------------------ primitives ------------------------------ */
  function shade(hex, k) {
    // k > 0 éclaircit, k < 0 assombrit
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = k < 0 ? 0 : 255, p = Math.abs(k);
    r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function fillStroke(ctx, fill, lw) {
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = lw || 2; ctx.strokeStyle = OL; ctx.stroke();
  }
  function circle(ctx, x, y, r, fill, lw) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); fillStroke(ctx, fill, lw); }
  function ellipse(ctx, x, y, rx, ry, fill, lw, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU); fillStroke(ctx, fill, lw); }
  function rrect(ctx, x, y, w, h, r, fill, lw) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    fillStroke(ctx, fill, lw);
  }
  function poly(ctx, pts, fill, lw) {
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath(); fillStroke(ctx, fill, lw);
  }
  function line(ctx, x1, y1, x2, y2, color, w) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.lineCap = 'round'; ctx.lineWidth = w + 3; ctx.strokeStyle = OL; ctx.stroke();
    ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke();
  }
  function shadow(ctx, x, y, rx, ry) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fillStyle = P.shadow; ctx.fill();
  }
  function eyes(ctx, x, y, gap, r, color) {
    ctx.fillStyle = color || OL;
    ctx.beginPath(); ctx.arc(x - gap, y, r, 0, TAU); ctx.arc(x + gap, y, r, 0, TAU); ctx.fill();
  }

  /* ------------------------------ armes ------------------------------ */
  function drawWeapon(ctx, weapon, color, swing) {
    // dessiné dans le repère de la main (pointe vers +x)
    ctx.save();
    ctx.rotate(-0.9 + swing * 1.8);
    const W = P.wood, S = P.stone;
    switch (weapon) {
      case 'club': line(ctx, 0, 0, 14, 0, W[1], 3); circle(ctx, 15, 0, 3.5, W[0]); break;
      case 'sword': line(ctx, -2, 0, 4, 0, W[2], 3); line(ctx, 4, -4, 4, 4, P.ui.gold, 2); line(ctx, 5, 0, 20, 0, '#e8eef5', 3); break;
      case 'hammer': line(ctx, -2, 0, 16, 0, W[1], 3); rrect(ctx, 13, -6, 7, 12, 2, P.ui.gold); break;
      case 'lance': line(ctx, -6, 0, 24, 0, W[0], 2.5); poly(ctx, [24, -3, 32, 0, 24, 3], '#e8eef5', 1.5); poly(ctx, [6, -4, 10, 0, 6, 4], color, 1.2); break;
      case 'staff': line(ctx, -4, 0, 16, 0, W[1], 2.5); circle(ctx, 18, 0, 4.5, color); circle(ctx, 17, -1.5, 1.5, '#ffffff', 0.01); break;
      case 'whip': ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(10, -10 + swing * 20, 22, 2); ctx.lineWidth = 2; ctx.strokeStyle = W[2]; ctx.stroke(); line(ctx, -2, 0, 4, 0, W[1], 3); break;
      case 'scythe': line(ctx, -4, 0, 16, 0, W[2], 2.5); ctx.beginPath(); ctx.moveTo(16, 0); ctx.quadraticCurveTo(14, -12, 4, -14); ctx.quadraticCurveTo(12, -8, 13, 0); fillStroke(ctx, '#d8dde3', 1.5); break;
      case 'bow': case 'longbow': {
        const L = weapon === 'longbow' ? 15 : 11;
        ctx.beginPath(); ctx.arc(-2, 0, L, -1.1, 1.1); ctx.lineWidth = 4.5; ctx.strokeStyle = OL; ctx.stroke(); ctx.lineWidth = 2.5; ctx.strokeStyle = W[0]; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-2 + Math.cos(-1.1) * L, Math.sin(-1.1) * L); ctx.lineTo(-2 - swing * 6, 0); ctx.lineTo(-2 + Math.cos(1.1) * L, Math.sin(1.1) * L); ctx.lineWidth = 1; ctx.strokeStyle = '#f3ead7'; ctx.stroke();
        break;
      }
      case 'crossbow': line(ctx, -4, 0, 12, 0, W[1], 3.5); ctx.beginPath(); ctx.arc(14, 0, 8, -1.4 + Math.PI, 1.4 + Math.PI, true); ctx.lineWidth = 4; ctx.strokeStyle = OL; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = S[0]; ctx.stroke(); break;
      case 'daggers': line(ctx, -1, 0, 3, 0, W[2], 3); poly(ctx, [3, -2.5, 13, 0, 3, 2.5], '#e8eef5', 1.2); break;
      case 'pitchfork': line(ctx, -4, 0, 16, 0, W[0], 2.5); line(ctx, 16, -5, 16, 5, S[1], 1.5); for (const o of [-5, 0, 5]) line(ctx, 16, o, 22, o, S[0], 1.2); break;
      case 'axe': line(ctx, -2, 0, 16, 0, W[1], 3); ctx.beginPath(); ctx.moveTo(12, -1); ctx.quadraticCurveTo(22, -10, 20, 2); ctx.lineTo(12, 3); fillStroke(ctx, '#d8dde3', 1.5); break;
      case 'pickaxe': line(ctx, -2, 0, 16, 0, W[1], 3); ctx.beginPath(); ctx.moveTo(16, -10); ctx.quadraticCurveTo(22, 0, 16, 10); ctx.lineWidth = 5; ctx.strokeStyle = OL; ctx.stroke(); ctx.lineWidth = 3; ctx.strokeStyle = S[0]; ctx.stroke(); break;
    }
    ctx.restore();
  }

  /* ------------------------------ héros ------------------------------ */
  /**
   * o = { cls, look:{cape,skin,hair}, equip:{head,body}, facing, t, attack(0..1), zombie, stealth, scale, seed }
   */
  function drawHero(ctx, x, y, o) {
    const c = GD.CLASSES[o.cls] || GD.CLASSES.habitant;
    const look = o.look || { cape: 0, skin: 1, hair: 0 };
    const head = GD.ARMORS[(o.equip || {}).head] || GD.ARMORS.head_none;
    const body = GD.ARMORS[(o.equip || {}).body] || GD.ARMORS.body_tunic;
    const s = o.scale || 1;
    const t = o.t || 0;
    const cape = P.capes[look.cape % P.capes.length];
    let skin = P.skin[look.skin % P.skin.length];
    if (o.zombie) skin = '#9bc27a';
    const hair = P.hair[look.hair % P.hair.length];
    const bodyTier = GD.ARMOR_TIERS[Math.max(0, body.tier)];
    const flip = Math.cos(o.facing || 0) < 0 ? -1 : 1;
    const bob = Math.sin(t * 9 + (o.seed || 0)) * 1.2;
    const swing = o.attack > 0 ? Math.sin((1 - o.attack) * Math.PI) : 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    if (o.stealth) ctx.globalAlpha = 0.35;
    shadow(ctx, 0, 2, 12, 4);
    ctx.scale(flip, 1);
    ctx.translate(0, bob * 0.5);

    // cape
    poly(ctx, [-6, -20, 6, -20, 9, -2, -11, -2 + Math.sin(t * 6) * 1.5], shade(cape, -0.15));
    // jambes
    const step = Math.sin(t * 9 + (o.seed || 0)) * 2;
    rrect(ctx, -6, -6 + step * 0.3, 5, 7, 2, P.wood[2], 1.5);
    rrect(ctx, 1, -6 - step * 0.3, 5, 7, 2, P.wood[2], 1.5);
    // bouclier (dans le dos)
    if (c.shield) { circle(ctx, -9, -11, 6, c.color); circle(ctx, -9, -11, 2, P.ui.gold, 1); }
    // corps / armure
    const bodyCol = body.tier <= 0 ? cape : bodyTier.color;
    rrect(ctx, -8, -20, 16, 15, 5, bodyCol);
    if (body.tier >= 2) { ctx.fillStyle = rgba(OL, 0.18); for (let i = -5; i <= 5; i += 3.3) ctx.fillRect(i, -18, 1.2, 11); }
    if (body.tier >= 3) { circle(ctx, -7, -18, 3.5, bodyTier.trim, 1.5); circle(ctx, 7, -18, 3.5, bodyTier.trim, 1.5); }
    // ceinture + écusson de classe (repère visuel)
    ctx.fillStyle = OL; ctx.fillRect(-8, -9, 16, 2.5);
    circle(ctx, 1, -14, 3, c.color, 1.5);
    if (body.tier === 4) circle(ctx, 1, -14, 1.4, bodyTier.trim, 0.01);
    // tête
    const hy = -28;
    circle(ctx, 0, hy, 8.5, skin);
    if (head.tier < 0 || head.tier === 0) {
      // cheveux
      ctx.beginPath(); ctx.arc(0, hy - 1, 8.5, Math.PI * 1.05, Math.PI * 1.95); ctx.lineTo(4, hy - 4); ctx.lineTo(-8, hy - 1); ctx.closePath(); fillStroke(ctx, hair, 1.5);
    }
    eyes(ctx, 3.5, hy + 0.5, 0.01, 1.4);
    ctx.fillStyle = OL; ctx.fillRect(5.5, hy - 0.8, 1.6, 2.6);
    ctx.fillRect(2, hy - 0.8, 1.6, 2.6);
    if (o.zombie) { ctx.fillStyle = '#5c7a3d'; ctx.fillRect(-4, hy + 2, 3, 2); }
    drawHelmet(ctx, head, hy, cape);
    // main + arme
    ctx.save();
    ctx.translate(8, -13);
    drawWeapon(ctx, c.weapon, c.color, swing);
    circle(ctx, 0, 0, 3, skin, 1.5);
    ctx.restore();
    if (c.weapon === 'daggers') { ctx.save(); ctx.translate(-8, -12); ctx.scale(-1, 1); drawWeapon(ctx, 'daggers', c.color, 1 - swing); ctx.restore(); }
    ctx.restore();
  }

  function drawHelmet(ctx, head, hy, cape) {
    if (head.tier < 0) return;
    const tier = GD.ARMOR_TIERS[head.tier];
    switch (head.tier) {
      case 0: // capuche
        ctx.beginPath(); ctx.arc(0, hy - 1, 10, Math.PI * 0.95, Math.PI * 2.05); ctx.lineTo(10, hy + 4); ctx.lineTo(7, hy + 1); ctx.arc(0, hy, 7.5, 0, Math.PI, true); ctx.lineTo(-10, hy + 4); ctx.closePath();
        fillStroke(ctx, shade(cape, -0.25), 1.8); break;
      case 1: // cuir
        ctx.beginPath(); ctx.arc(0, hy - 1, 9.5, Math.PI, TAU); ctx.closePath(); fillStroke(ctx, tier.color, 1.8);
        ctx.fillStyle = tier.trim; ctx.fillRect(-9.5, hy - 2.5, 19, 2.5); break;
      case 2: // fer + nasal
        ctx.beginPath(); ctx.arc(0, hy - 1, 9.8, Math.PI, TAU); ctx.closePath(); fillStroke(ctx, tier.color, 1.8);
        rrect(ctx, 3.5, hy - 2, 2.5, 7, 1, tier.trim, 1); break;
      case 3: // heaume
        rrect(ctx, -9.5, hy - 11, 19, 18, 5, tier.color, 1.8);
        ctx.fillStyle = OL; ctx.fillRect(1, hy - 1.5, 9, 2.2);
        poly(ctx, [-2, hy - 11, 0, hy - 17, 2, hy - 11], tier.trim, 1.2); break;
      case 4: // couronne runique
        poly(ctx, [-8, hy - 6, -8, hy - 13, -4, hy - 9, 0, hy - 15, 4, hy - 9, 8, hy - 13, 8, hy - 6], tier.color, 1.6);
        circle(ctx, 0, hy - 8.5, 1.8, tier.trim, 1); break;
    }
  }

  function drawGrave(ctx, x, y, t) {
    ctx.save(); ctx.translate(x, y);
    shadow(ctx, 0, 2, 10, 3.5);
    ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-7, -12); ctx.arc(0, -12, 7, Math.PI, TAU); ctx.lineTo(7, 0); ctx.closePath();
    fillStroke(ctx, P.stone[1]);
    ctx.fillStyle = OL; ctx.fillRect(-0.8, -15, 1.6, 8); ctx.fillRect(-3.5, -12.5, 7, 1.6);
    ctx.restore();
  }

  /* ------------------------------ monstres ------------------------------ */
  const MOB_SHAPES = {
    goblin(ctx, c, s, t, a, d) {
      rrect(ctx, -s * 0.5, -s * 0.9, s, s * 0.9, s * 0.3, shade(c, -0.1));
      poly(ctx, [-s * 0.55, -s * 1.35, -s * 1.2, -s * 1.6, -s * 0.5, -s * 1.1], c, 1.5);
      poly(ctx, [s * 0.55, -s * 1.35, s * 1.2, -s * 1.6, s * 0.5, -s * 1.1], c, 1.5);
      circle(ctx, 0, -s * 1.25, s * 0.62, c);
      eyes(ctx, s * 0.25, -s * 1.3, s * 0.2, s * 0.12, '#f7e463');
      if (d.bow) { ctx.save(); ctx.translate(s * 0.6, -s * 0.6); drawWeapon(ctx, 'bow', c, a); ctx.restore(); }
      else { ctx.save(); ctx.translate(s * 0.6, -s * 0.6); ctx.scale(0.7, 0.7); drawWeapon(ctx, 'daggers', c, a); ctx.restore(); }
    },
    wolf(ctx, c, s, t, a) {
      const leg = Math.sin(t * 14) * s * 0.15;
      for (const lx of [-0.55, -0.2, 0.25, 0.55]) rrect(ctx, lx * s - s * 0.1, -s * 0.45 + (lx > 0 ? leg : -leg), s * 0.22, s * 0.5, 2, shade(c, -0.25), 1.5);
      poly(ctx, [-s * 0.9, -s * 0.75, -s * 1.5, -s * 1.1 + Math.sin(t * 8) * 2, -s * 0.9, -s * 0.5], shade(c, -0.1), 1.5);
      ellipse(ctx, 0, -s * 0.7, s * 0.95, s * 0.45, c);
      ctx.save(); ctx.translate(s * 0.85 + a * 4, -s * 0.95);
      poly(ctx, [-s * 0.15, -s * 0.35, s * 0.05, -s * 0.75, s * 0.2, -s * 0.3], shade(c, -0.15), 1.5);
      ellipse(ctx, 0, 0, s * 0.42, s * 0.36, c);
      ellipse(ctx, s * 0.38, s * 0.1, s * 0.25, s * 0.15, shade(c, 0.2), 1.5);
      eyes(ctx, s * 0.12, -s * 0.08, 0.01, s * 0.07, '#f7e463');
      ctx.restore();
    },
    boar(ctx, c, s, t, a) {
      for (const lx of [-0.5, 0.45]) rrect(ctx, lx * s - s * 0.12, -s * 0.4, s * 0.24, s * 0.42, 2, shade(c, -0.3), 1.5);
      ellipse(ctx, 0, -s * 0.65, s * 0.95, s * 0.6, c);
      ctx.fillStyle = shade(c, -0.3); ctx.beginPath(); ctx.ellipse(-s * 0.1, -s * 1.1, s * 0.6, s * 0.15, 0, 0, TAU); ctx.fill();
      ellipse(ctx, s * 0.95 + a * 5, -s * 0.6, s * 0.3, s * 0.26, shade(c, 0.25), 1.5);
      poly(ctx, [s * 0.8, -s * 0.45, s * 1.15, -s * 0.85, s * 0.95, -s * 0.4], '#f3ead7', 1.2);
      eyes(ctx, s * 0.62, -s * 0.85, 0.01, s * 0.08);
    },
    golem(ctx, c, s, t, a) {
      const arm = a * s * 0.4;
      rrect(ctx, -s * 1.05, -s * 1.1 + arm, s * 0.45, s * 0.85, s * 0.15, shade(c, -0.15));
      rrect(ctx, s * 0.6, -s * 1.1 - arm, s * 0.45, s * 0.85, s * 0.15, shade(c, -0.15));
      rrect(ctx, -s * 0.4, -s * 0.45, s * 0.3, s * 0.45, 3, shade(c, -0.25));
      rrect(ctx, s * 0.1, -s * 0.45, s * 0.3, s * 0.45, 3, shade(c, -0.25));
      rrect(ctx, -s * 0.7, -s * 1.3, s * 1.4, s * 0.95, s * 0.2, c);
      rrect(ctx, -s * 0.35, -s * 1.7, s * 0.7, s * 0.5, s * 0.15, shade(c, 0.1));
      eyes(ctx, s * 0.05, -s * 1.47, s * 0.14, s * 0.07, '#ffffff');
      poly(ctx, [-s * 0.4, -s * 1.3, -s * 0.25, -s * 1.65, -s * 0.1, -s * 1.3], shade(c, 0.35), 1.2);
    },
    wisp(ctx, c, s, t) {
      ctx.save();
      ctx.globalAlpha *= 0.35; circle(ctx, 0, -s * 1.2, s * 1.2, c, 0.01); ctx.globalAlpha /= 0.35;
      const w = Math.sin(t * 6) * s * 0.15;
      ctx.beginPath(); ctx.moveTo(-s * 0.7, -s * 1.2); ctx.arc(0, -s * 1.2, s * 0.7, Math.PI, TAU);
      ctx.lineTo(s * 0.7, -s * 0.5); ctx.quadraticCurveTo(s * 0.35, -s * 0.2 + w, 0, -s * 0.5); ctx.quadraticCurveTo(-s * 0.35, -s * 0.2 - w, -s * 0.7, -s * 0.5); ctx.closePath();
      fillStroke(ctx, shade(c, 0.1));
      eyes(ctx, 0, -s * 1.25, s * 0.25, s * 0.12);
      ctx.restore();
    },
    treant(ctx, c, s, t, a) {
      const W = P.wood;
      rrect(ctx, -s * 0.5, -s * 0.4, s * 0.35, s * 0.42, 3, W[2]);
      rrect(ctx, s * 0.15, -s * 0.4, s * 0.35, s * 0.42, 3, W[2]);
      rrect(ctx, -s * 0.45, -s * 1.4, s * 0.9, s * 1.1, s * 0.2, W[1]);
      line(ctx, -s * 0.4, -s * 1.1, -s * 1.1, -s * 1.5 + a * s * 0.5, W[1], s * 0.15);
      line(ctx, s * 0.4, -s * 1.1, s * 1.1, -s * 1.5 - a * s * 0.5, W[1], s * 0.15);
      circle(ctx, -s * 0.55, -s * 1.85, s * 0.55, shade(c, -0.1));
      circle(ctx, s * 0.55, -s * 1.85, s * 0.55, shade(c, -0.1));
      circle(ctx, 0, -s * 2.15, s * 0.7, c);
      eyes(ctx, 0, -s * 1.05, s * 0.18, s * 0.09, '#f7e463');
    },
    crawler(ctx, c, s, t, a) {
      for (let i = 3; i >= 0; i--) {
        const x = -i * s * 0.45, y = -s * 0.45 + Math.sin(t * 10 + i) * s * 0.08;
        circle(ctx, x, y, s * (0.5 - i * 0.06), i % 2 ? shade(c, -0.15) : c);
        poly(ctx, [x - s * 0.1, y - s * 0.4, x, y - s * 0.75, x + s * 0.1, y - s * 0.4], P.biome.poison.accent[3], 1);
      }
      eyes(ctx, s * 0.2, -s * 0.55, s * 0.13, s * 0.08, P.biome.poison.accent[0]);
    },
    toad(ctx, c, s, t, a) {
      ellipse(ctx, 0, -s * 0.55, s * 1.0, s * 0.62 + a * 2, c);
      ellipse(ctx, 0, -s * 0.4, s * 0.6, s * 0.3, shade(c, 0.3), 1.2);
      circle(ctx, -s * 0.35, -s * 1.1, s * 0.28, c); circle(ctx, s * 0.35, -s * 1.1, s * 0.28, c);
      eyes(ctx, 0, -s * 1.12, s * 0.35, s * 0.12, '#f7e463');
      ctx.beginPath(); ctx.moveTo(-s * 0.4, -s * 0.72); ctx.quadraticCurveTo(0, -s * 0.55, s * 0.4, -s * 0.72); ctx.lineWidth = 1.5; ctx.strokeStyle = OL; ctx.stroke();
    },
    shroom(ctx, c, s, t, a) {
      const sq = 1 + a * 0.15;
      rrect(ctx, -s * 0.35, -s * 0.8, s * 0.7, s * 0.8, s * 0.2, '#efe3c8');
      eyes(ctx, 0, -s * 0.45, s * 0.15, s * 0.08);
      ctx.beginPath(); ctx.ellipse(0, -s * 0.85, s * 0.9 * sq, s * 0.6 / sq, 0, Math.PI, TAU); ctx.closePath(); fillStroke(ctx, c);
      ctx.fillStyle = '#f3ead7';
      for (const [px, py, r] of [[-0.4, -1.05, 0.13], [0.2, -1.2, 0.1], [0.5, -0.98, 0.09]]) { ctx.beginPath(); ctx.arc(px * s, py * s, r * s, 0, TAU); ctx.fill(); }
    },
    zombie(ctx, c, s, t, a) {
      const lean = Math.sin(t * 3) * 0.05;
      ctx.rotate(lean);
      rrect(ctx, -s * 0.35, -s * 0.5, s * 0.28, s * 0.5, 3, '#4a3b5e', 1.5); rrect(ctx, s * 0.07, -s * 0.5, s * 0.28, s * 0.5, 3, '#4a3b5e', 1.5);
      rrect(ctx, -s * 0.55, -s * 1.35, s * 1.1, s * 0.9, s * 0.25, '#6e6679');
      line(ctx, s * 0.4, -s * 1.15, s * 1.1, -s * 1.0 - a * s * 0.3, c, s * 0.18);
      circle(ctx, s * 0.1, -s * 1.6, s * 0.42, c);
      eyes(ctx, s * 0.25, -s * 1.62, s * 0.13, s * 0.07, '#f7e463');
    },
    spider(ctx, c, s, t, a) {
      ctx.lineWidth = 2; ctx.strokeStyle = OL;
      for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) {
        const k = Math.sin(t * 16 + i * 1.7) * s * 0.1;
        ctx.beginPath(); ctx.moveTo(0, -s * 0.5); ctx.lineTo(sd * s * 0.8, -s * (0.9 - i * 0.25) + k); ctx.lineTo(sd * s * 1.1, -s * (0.1 - i * 0.12)); ctx.stroke();
      }
      circle(ctx, -s * 0.45, -s * 0.6, s * 0.55, c);
      circle(ctx, s * 0.3, -s * 0.5, s * 0.36, shade(c, 0.15));
      eyes(ctx, s * 0.42, -s * 0.58, s * 0.1, s * 0.06, P.biome.poison.accent[0]);
      ctx.fillStyle = P.biome.poison.accent[0]; ctx.fillRect(-s * 0.5, -s * 0.9, s * 0.15, s * 0.4);
    },
    imp(ctx, c, s, t, a) {
      const fl = Math.sin(t * 18) * s * 0.2;
      poly(ctx, [-s * 0.2, -s * 1.0, -s * 1.1, -s * 1.5 + fl, -s * 0.8, -s * 0.7], shade(c, -0.3), 1.5);
      ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 0.4); ctx.quadraticCurveTo(-s * 1.0, -s * 0.2, -s * 0.9, -s * 0.8); ctx.lineWidth = 2; ctx.strokeStyle = OL; ctx.stroke();
      rrect(ctx, -s * 0.4, -s * 1.0, s * 0.8, s * 0.95, s * 0.3, c);
      circle(ctx, 0, -s * 1.3, s * 0.48, c);
      poly(ctx, [-s * 0.35, -s * 1.6, -s * 0.5, -s * 2.0, -s * 0.12, -s * 1.7], '#f3ead7', 1.2);
      poly(ctx, [s * 0.35, -s * 1.6, s * 0.5, -s * 2.0, s * 0.12, -s * 1.7], '#f3ead7', 1.2);
      eyes(ctx, s * 0.15, -s * 1.32, s * 0.14, s * 0.08, '#ffd76a');
    },
    salamander(ctx, c, s, t, a) {
      const w = Math.sin(t * 8) * s * 0.2;
      ctx.beginPath(); ctx.moveTo(-s * 0.5, -s * 0.5); ctx.quadraticCurveTo(-s * 1.2, -s * 0.3 + w, -s * 1.6, -s * 0.7 - w);
      ctx.lineWidth = s * 0.35 + 3; ctx.strokeStyle = OL; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineWidth = s * 0.35; ctx.strokeStyle = shade(c, -0.1); ctx.stroke();
      ellipse(ctx, 0, -s * 0.5, s * 0.8, s * 0.38, c);
      for (let i = -2; i <= 1; i++) poly(ctx, [i * s * 0.25 - s * 0.1, -s * 0.8, i * s * 0.25, -s * 1.15 - Math.sin(t * 12 + i) * 3, i * s * 0.25 + s * 0.1, -s * 0.8], P.biome.fire.accent[1], 1.2);
      ellipse(ctx, s * 0.8 + a * 4, -s * 0.6, s * 0.38, s * 0.28, c);
      eyes(ctx, s * 0.9, -s * 0.7, 0.01, s * 0.08, '#ffd76a');
    },
    hound(ctx, c, s, t, a) {
      MOB_SHAPES.wolf(ctx, c, s, t, a);
      for (let i = 0; i < 4; i++) poly(ctx, [-s * 0.5 + i * s * 0.3, -s * 1.05, -s * 0.35 + i * s * 0.3, -s * 1.5 - Math.sin(t * 14 + i) * 4, -s * 0.2 + i * s * 0.3, -s * 1.05], P.biome.fire.accent[i % 3], 1);
    },
    elemental(ctx, c, s, t, a) {
      ctx.save(); ctx.globalAlpha *= 0.3; circle(ctx, 0, -s, s * 1.3, c, 0.01); ctx.restore();
      for (let i = 0; i < 5; i++) {
        const fx = (i - 2) * s * 0.35, fh = s * (1.9 + Math.sin(t * 10 + i * 1.3) * 0.25 - Math.abs(i - 2) * 0.3);
        poly(ctx, [fx - s * 0.3, -s * 0.8, fx, -fh, fx + s * 0.3, -s * 0.8], i % 2 ? P.biome.fire.accent[1] : c, 1.5);
      }
      rrect(ctx, -s * 0.75, -s * 1.1, s * 1.5, s * 1.05, s * 0.4, '#2a1b17');
      ctx.strokeStyle = P.biome.fire.accent[0]; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-s * 0.5, -s * 0.5); ctx.lineTo(-s * 0.1, -s * 0.8); ctx.lineTo(s * 0.3, -s * 0.4); ctx.stroke();
      line(ctx, -s * 0.7, -s * 0.8, -s * 1.2, -s * 0.5 + a * s * 0.4, '#2a1b17', s * 0.25);
      line(ctx, s * 0.7, -s * 0.8, s * 1.2, -s * 0.5 - a * s * 0.4, '#2a1b17', s * 0.25);
      eyes(ctx, 0, -s * 0.85, s * 0.25, s * 0.1, P.biome.fire.accent[3]);
    },
    mother(ctx, c, s, t, a) {
      ctx.lineWidth = 4; ctx.strokeStyle = OL;
      for (let i = 0; i < 6; i++) {
        const lx = (i - 2.5) * s * 0.3, k = Math.sin(t * 4 + i) * s * 0.12;
        line(ctx, lx * 0.6, -s * 0.6, lx * 1.4 + k, 0, '#6b5a7a', s * 0.12);
      }
      rrect(ctx, -s * 0.4, -s * 1.0, s * 0.8, s * 0.6, s * 0.2, '#e8dcc0');
      ctx.beginPath(); ctx.ellipse(0, -s * 0.95, s * 1.1, s * 0.75, 0, Math.PI, TAU); ctx.closePath(); fillStroke(ctx, c, 3);
      ctx.fillStyle = P.biome.poison.accent[3];
      for (const [px, py, r] of [[-0.6, -1.15, 0.13], [-0.1, -1.45, 0.16], [0.45, -1.2, 0.12], [0.75, -1.0, 0.08]]) { ctx.beginPath(); ctx.arc(px * s, py * s, r * s, 0, TAU); ctx.fill(); }
      eyes(ctx, 0, -s * 0.72, s * 0.2, s * 0.07, P.biome.poison.accent[0]);
    },
    skeleton(ctx, c, s, t, a) {
      line(ctx, -s * 0.2, -s * 0.5, -s * 0.25, 0, c, 2); line(ctx, s * 0.2, -s * 0.5, s * 0.25, 0, c, 2);
      rrect(ctx, -s * 0.4, -s * 1.15, s * 0.8, s * 0.7, s * 0.2, c);
      ctx.fillStyle = OL; for (let i = 0; i < 3; i++) ctx.fillRect(-s * 0.3, -s * 1.0 + i * s * 0.17, s * 0.6, 1.2);
      circle(ctx, 0, -s * 1.45, s * 0.42, c);
      eyes(ctx, s * 0.1, -s * 1.47, s * 0.14, s * 0.1);
      ctx.save(); ctx.translate(s * 0.45, -s * 0.8); ctx.scale(0.7, 0.7); drawWeapon(ctx, 'sword', c, a); ctx.restore();
    }
  };

  function drawMob(ctx, type, x, y, o) {
    const d = GD.MOBS[type];
    if (!d) return;
    const s = o.size || d.size;
    const t = o.t || 0;
    ctx.save();
    ctx.translate(x, y);
    shadow(ctx, 0, 1, s * 1.1, s * 0.38);
    if (o.boss || o.elite) {
      ctx.save();
      ctx.globalAlpha = 0.25 + Math.sin(t * 5) * 0.1;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 1.5, s * 0.55, 0, 0, TAU);
      ctx.fillStyle = o.boss ? '#ff3d5a' : P.ui.gold; ctx.fill();
      ctx.restore();
    }
    const flip = Math.cos(o.facing || 0) < 0 ? -1 : 1;
    ctx.scale(flip, 1);
    if (o.frozen) ctx.globalAlpha = 0.85;
    const bob = Math.abs(Math.sin(t * 8 + (o.seed || 0))) * s * 0.06;
    ctx.translate(0, -bob);
    (MOB_SHAPES[d.shape] || MOB_SHAPES.goblin)(ctx, d.color, s, t + (o.seed || 0), o.attack || 0, d);
    if (o.frozen) { ctx.globalAlpha = 0.45; rrect(ctx, -s, -s * 2, s * 2, s * 2, 4, P.fx.frost, 1); }
    ctx.restore();
    if (o.boss) drawCrown(ctx, x, y - s * (d.shape === 'treant' ? 2.9 : d.shape === 'mother' ? 1.9 : 2.2), Math.max(8, s * 0.3));
  }

  function drawCrown(ctx, x, y, r) {
    poly(ctx, [x - r, y, x - r, y - r * 0.9, x - r * 0.5, y - r * 0.4, x, y - r * 1.1, x + r * 0.5, y - r * 0.4, x + r, y - r * 0.9, x + r, y], P.ui.gold, 1.6);
  }

  /* ------------------------------ tour ------------------------------ */
  function drawTower(ctx, x, y, o) {
    const S = P.stone;
    const t = o.t || 0;
    const up = o.up || {};
    const hp = o.hp === undefined ? 1 : o.hp;
    ctx.save();
    ctx.translate(x, y);
    shadow(ctx, 0, 30, 92, 26);
    // remparts (amélioration)
    if (up.walls > 0) {
      const n = 14;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        if (Math.sin(a) < -0.2) continue; // seulement l'avant
        rrect(ctx, Math.cos(a) * 92 - 9, Math.sin(a) * 40 + 18, 18, 16, 3, S[1], 1.8);
      }
    }
    // infirmerie : tente
    if (up.infirmary > 0) {
      poly(ctx, [-120, 20, -96, -12, -72, 20], '#f3ead7');
      ctx.fillStyle = P.ui.danger; ctx.fillRect(-99, 2, 6, 14); ctx.fillRect(-103, 6, 14, 6);
    }
    // forge
    if (up.forge > 0) {
      rrect(ctx, 76, 4, 26, 16, 3, S[2]);
      rrect(ctx, 80, -2, 18, 8, 2, '#3c3546');
      ctx.fillStyle = rgba(P.biome.fire.accent[0], 0.6 + Math.sin(t * 8) * 0.3); ctx.fillRect(82, 10, 14, 5);
    }
    // corps de la tour
    ctx.beginPath(); ctx.moveTo(-58, 20); ctx.lineTo(-48, -110); ctx.lineTo(48, -110); ctx.lineTo(58, 20);
    ctx.quadraticCurveTo(0, 40, -58, 20); ctx.closePath(); fillStroke(ctx, S[0], 3);
    // pierres
    ctx.fillStyle = rgba(OL, 0.22);
    for (let row = 0; row < 7; row++) {
      const yy = 10 - row * 17, w = 56 - row * 1.4;
      ctx.fillRect(-w, yy, w * 2, 1.6);
      for (let i = -3; i <= 3; i++) ctx.fillRect(i * 16 + (row % 2) * 8, yy - 16, 1.6, 16);
    }
    // ombre latérale
    ctx.beginPath(); ctx.moveTo(20, -110); ctx.lineTo(48, -110); ctx.lineTo(58, 20); ctx.quadraticCurveTo(40, 28, 24, 30); ctx.closePath(); ctx.fillStyle = rgba(OL, 0.18); ctx.fill();
    // porte
    ctx.beginPath(); ctx.moveTo(-14, 30); ctx.lineTo(-14, 6); ctx.arc(0, 6, 14, Math.PI, TAU); ctx.lineTo(14, 30); ctx.closePath(); fillStroke(ctx, P.wood[2], 2.5);
    // fenêtre lumineuse
    ctx.beginPath(); ctx.moveTo(-6, -56); ctx.lineTo(-6, -66); ctx.arc(0, -66, 6, Math.PI, TAU); ctx.lineTo(6, -56); ctx.closePath(); fillStroke(ctx, '#ffd76a', 2);
    // créneaux
    rrect(ctx, -60, -126, 120, 20, 3, S[1], 3);
    for (let i = -2; i <= 2; i++) rrect(ctx, i * 24 - 8, -140, 16, 16, 2, S[1], 2.5);
    // baliste
    if (up.ballista > 0) {
      rrect(ctx, -20, -152, 40, 10, 3, P.wood[1]);
      line(ctx, -26, -150, 26, -150, P.wood[0], 3);
      line(ctx, 0, -158, 0, -142, S[3], 2);
    }
    // toit
    poly(ctx, [-34, -138, 0, -205, 34, -138], '#7a2e3a', 3);
    // drapeau
    line(ctx, 0, -205, 0, -232, P.wood[2], 2);
    const wave = Math.sin(t * 4) * 3;
    poly(ctx, [0, -232, 22, -228 + wave, 0, -220], up.banner > 0 ? P.ui.gold : P.capes[0], 1.6);
    // autel arcanique
    if (up.shrine > 0) {
      ctx.save(); ctx.globalAlpha = 0.5 + Math.sin(t * 3) * 0.3;
      circle(ctx, 0, -175, 8 + Math.sin(t * 3) * 2, P.ui.accent, 0.01); ctx.restore();
      poly(ctx, [0, -186, 6, -175, 0, -164, -6, -175], '#c9a8ff', 1.5);
    }
    // catapulte
    if (up.catapult > 0) {
      rrect(ctx, -110, -18, 34, 12, 3, P.wood[1]);
      line(ctx, -93, -18, -75, -44, P.wood[0], 3); circle(ctx, -74, -46, 5, S[2]);
      circle(ctx, -104, -5, 5, P.wood[2]); circle(ctx, -82, -5, 5, P.wood[2]);
    }
    // dégâts : fissures et feu
    if (hp < 0.66) {
      ctx.strokeStyle = OL; ctx.lineWidth = 2.5; ctx.beginPath();
      ctx.moveTo(-40, -90); ctx.lineTo(-30, -70); ctx.lineTo(-36, -50); ctx.moveTo(30, -20); ctx.lineTo(22, -2); ctx.lineTo(30, 10); ctx.stroke();
    }
    if (hp < 0.33) {
      for (let i = 0; i < 3; i++) {
        const fx = -30 + i * 30, fh = 14 + Math.sin(t * 12 + i) * 5;
        poly(ctx, [fx - 7, -110, fx, -110 - fh, fx + 7, -110], P.biome.fire.accent[i % 2], 1.5);
      }
    }
    ctx.restore();
  }

  /* ------------------------------ projectiles ------------------------------ */
  function drawProjectile(ctx, kind, x, y, a, t) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    const F = P.fx;
    switch (kind) {
      case 'arrow': case 'ballista': {
        const L = kind === 'ballista' ? 22 : 14;
        line(ctx, -L, 0, 0, 0, P.wood[0], kind === 'ballista' ? 2.5 : 1.6);
        poly(ctx, [0, -3, 6, 0, 0, 3], '#e8eef5', 1.2);
        poly(ctx, [-L, 0, -L - 4, -3, -L + 3, 0, -L - 4, 3], '#f3ead7', 1); break;
      }
      case 'bolt': line(ctx, -10, 0, 0, 0, P.stone[2], 2.5); poly(ctx, [0, -3.5, 6, 0, 0, 3.5], '#e8eef5', 1.2); break;
      case 'orb': glow(ctx, '#c9a8ff', 9); circle(ctx, 0, 0, 5, '#8e44ad', 1.5); break;
      case 'holy': glow(ctx, F.holy, 9); circle(ctx, 0, 0, 5, F.heal, 1.5); break;
      case 'ice': case 'frost': glow(ctx, F.frost, 9); poly(ctx, [-8, 0, 0, -4, 8, 0, 0, 4], '#e8f6ff', 1.5); break;
      case 'fire': glow(ctx, F.burn, 10); circle(ctx, 0, 0, 5, '#ffb02e', 1.5); break;
      case 'poison': glow(ctx, F.poison, 9); circle(ctx, 0, 0, 5, '#58e01f', 1.5); break;
      case 'fireball': glow(ctx, F.burn, 26); circle(ctx, 0, 0, 14, '#ff7a1a', 2.5); circle(ctx, 3, -3, 6, '#ffd76a', 0.01); break;
      case 'rock': ctx.rotate(t * 8); rrect(ctx, -8, -7, 16, 14, 5, P.stone[1], 2); break;
    }
    ctx.restore();
  }
  function glow(ctx, color, r) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.6);
    g.addColorStop(0, rgba(color, 0.8)); g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, TAU); ctx.fill();
  }

  /* ------------------------------ terrain ------------------------------ */
  const BIOME_ORDER = ['prairie', 'frost', 'poison', 'fire'];

  function buildTerrain(seed, st) {
    const W = GD.WORLD.W, H = GD.WORLD.H, TS = GD.WORLD.TILE;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const grid = [];
    for (let ty = 0; ty < T.ROWS; ty++) { grid[ty] = []; for (let tx = 0; tx < T.COLS; tx++) grid[ty][tx] = T.tileBiome(tx, ty, st, seed); }

    // 1. sol : couche par couche avec des bords organiques (« blobs »)
    ctx.fillStyle = P.biome.prairie.ground[0]; ctx.fillRect(0, 0, W, H);
    for (const b of BIOME_ORDER) {
      const G = P.biome[b].ground;
      for (let ty = 0; ty < T.ROWS; ty++) for (let tx = 0; tx < T.COLS; tx++) {
        if (grid[ty][tx] !== b) continue;
        const h = T.valueNoise(tx / 3.2, ty / 3.2, seed + 3);
        ctx.fillStyle = G[Math.min(G.length - 1, Math.floor(h * G.length))];
        ctx.fillRect(tx * TS, ty * TS, TS, TS);
        // débordement arrondi sur les voisins de couches inférieures
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const n = grid[ty + dy] && grid[ty + dy][tx + dx];
          return n && BIOME_ORDER.indexOf(n) < BIOME_ORDER.indexOf(b);
        });
        if (edge) {
          for (let k = 0; k < 3; k++) {
            const ox = (T.hash2(tx, ty, seed + 20 + k) - 0.5) * TS * 0.9, oy = (T.hash2(tx, ty, seed + 30 + k) - 0.5) * TS * 0.9;
            ctx.beginPath(); ctx.arc(tx * TS + TS / 2 + ox, ty * TS + TS / 2 + oy, TS * (0.45 + T.hash2(tx, ty, seed + 40 + k) * 0.3), 0, TAU); ctx.fill();
          }
        }
      }
    }
    // 2. texture (petits points)
    for (let ty = 0; ty < T.ROWS; ty++) for (let tx = 0; tx < T.COLS; tx++) {
      const b = grid[ty][tx];
      for (let k = 0; k < 5; k++) {
        const hx = T.hash2(tx * 7 + k, ty, seed + 50), hy = T.hash2(tx, ty * 7 + k, seed + 60);
        ctx.fillStyle = k % 2 ? rgba(P.biome[b].dark, 0.25) : 'rgba(255,255,255,0.08)';
        ctx.fillRect(tx * TS + hx * TS, ty * TS + hy * TS, 3, 2);
      }
    }
    // chemin de terre autour de la tour
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#9b7a52';
    ctx.beginPath(); ctx.ellipse(GD.WORLD.CX, GD.WORLD.CY + 10, 150, 95, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    // 3. rivières de lave
    const lava = [];
    if (st.fire > 0 || st.mix) {
      for (const r of T.lavaRivers(seed)) {
        for (let i = 1; i < r.pts.length; i++) {
          const [x1, y1] = r.pts[i - 1], [x2, y2] = r.pts[i];
          const tx = Math.floor(x2 / TS), ty = Math.floor(y2 / TS);
          if (!grid[ty] || grid[ty][tx] !== 'fire') continue;
          lava.push([x1, y1, x2, y2, r.w]);
        }
      }
      for (const [x1, y1, x2, y2, w] of lava) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineCap = 'round'; ctx.lineWidth = w + 6; ctx.strokeStyle = '#1c1210'; ctx.stroke(); }
      for (const [x1, y1, x2, y2, w] of lava) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineWidth = w; ctx.strokeStyle = '#ff5a1a'; ctx.stroke(); }
    }

    // 4. points de récolte
    for (const n of T.resourceNodes(seed)) drawNode(ctx, n);

    // 5. décor (trié par y pour le chevauchement)
    const decor = [];
    for (let ty = 0; ty < T.ROWS; ty++) for (let tx = 0; tx < T.COLS; tx++) {
      const d = T.tileDecor(tx, ty, seed);
      if (d) decor.push({ ...d, b: grid[ty][tx], x: (tx + 0.5) * TS + d.ox, y: (ty + 0.5) * TS + d.oy });
    }
    decor.sort((a, b) => a.y - b.y);
    for (const d of decor) drawDecor(ctx, d, st);
    return { canvas: cv, lava };
  }

  function drawNode(ctx, n) {
    const x = n.x, y = n.y;
    if (n.type === 'field') {
      rrect(ctx, x - 26, y - 14, 52, 28, 6, '#8a6a3a', 2);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
        const sx = x - 19 + i * 13, sy = y - 6 + j * 12;
        line(ctx, sx, sy + 2, sx, sy - 9, '#d9b84a', 1.5);
        ellipse(ctx, sx, sy - 10, 2.5, 4, '#f2d36b', 1);
      }
    } else if (n.type === 'tree') {
      shadow(ctx, x, y + 2, 20, 6);
      rrect(ctx, x - 5, y - 22, 10, 24, 3, P.wood[1]);
      circle(ctx, x - 10, y - 30, 13, '#3f8f3a'); circle(ctx, x + 10, y - 30, 13, '#3f8f3a'); circle(ctx, x, y - 42, 15, '#4ea845');
      rrect(ctx, x + 10, y - 6, 16, 8, 3, P.wood[0], 1.5);
    } else {
      shadow(ctx, x, y + 2, 22, 6);
      poly(ctx, [x - 22, y, x - 14, y - 22, x + 4, y - 28, x + 20, y - 12, x + 22, y], P.stone[1], 2);
      poly(ctx, [x - 8, y - 14, x - 3, y - 22, x + 2, y - 14], '#6ec6ff', 1.2);
      poly(ctx, [x + 8, y - 8, x + 12, y - 15, x + 15, y - 8], P.ui.gold, 1.2);
    }
  }

  function drawDecor(ctx, d, st) {
    const { x, y, v, b } = d;
    if (d.kind === 'small') {
      if (b === 'prairie') {
        if (v < 0.5) { for (let i = -1; i <= 1; i++) { ctx.strokeStyle = '#3f7f2a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + i * 3, y); ctx.lineTo(x + i * 4.5, y - 7); ctx.stroke(); } }
        else { const A = P.biome.prairie.accent; circle(ctx, x, y - 2, 3, A[Math.floor(v * 10) % A.length], 1.2); }
      } else if (b === 'frost') {
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(x, y, 7 + v * 6, 3, 0, 0, TAU); ctx.fill();
        if (v > 0.7) poly(ctx, [x - 3, y, x, y - 9, x + 3, y], '#bfe6ff', 1.2);
      } else if (b === 'poison') {
        if (v < 0.5) { ctx.fillStyle = rgba(P.biome.poison.accent[0], 0.45); ctx.beginPath(); ctx.ellipse(x, y, 9, 4, 0, 0, TAU); ctx.fill(); }
        else { rrect(ctx, x - 1.5, y - 6, 3, 6, 1, '#e8dcc0', 1); ctx.beginPath(); ctx.ellipse(x, y - 6, 5, 3.5, 0, Math.PI, TAU); ctx.closePath(); fillStroke(ctx, P.biome.poison.accent[3], 1.2); }
      } else {
        ctx.strokeStyle = rgba(P.biome.fire.accent[0], 0.8); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x - 2, y - 3); ctx.lineTo(x + 3, y + 1); ctx.lineTo(x + 8, y - 2); ctx.stroke();
      }
      return;
    }
    if (d.kind === 'rock') {
      const col = b === 'frost' ? '#a9c4da' : b === 'poison' ? '#4a5a3a' : b === 'fire' ? '#2a2030' : P.stone[1];
      shadow(ctx, x, y + 1, 12, 4);
      poly(ctx, [x - 12, y, x - 8, y - 11, x + 3, y - 14, x + 11, y - 6, x + 12, y], col, 2);
      if (b === 'poison') poly(ctx, [x - 2, y - 8, x, y - 18, x + 3, y - 8], P.biome.poison.accent[0], 1.2);
      if (b === 'fire') { ctx.strokeStyle = P.biome.fire.accent[0]; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 6, y - 4); ctx.lineTo(x, y - 9); ctx.lineTo(x + 5, y - 5); ctx.stroke(); }
      return;
    }
    // arbres
    if (b === 'prairie') {
      shadow(ctx, x, y + 2, 18, 6);
      rrect(ctx, x - 4, y - 18, 8, 20, 3, P.wood[1]);
      const g = v < 0.5 ? '#4ea845' : '#5cb84a';
      circle(ctx, x - 9, y - 24, 11, shade(g, -0.12)); circle(ctx, x + 9, y - 24, 11, shade(g, -0.12)); circle(ctx, x, y - 34, 13, g);
      if (v > 0.8) { circle(ctx, x - 4, y - 32, 2.5, '#e2504c', 1); circle(ctx, x + 6, y - 26, 2.5, '#e2504c', 1); }
    } else if (b === 'frost') {
      if (st.uprooted) {
        // trou laissé par l'arbre déraciné
        ctx.fillStyle = '#5e3a1f'; ctx.beginPath(); ctx.ellipse(x, y, 14, 6, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = OL; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = P.wood[1]; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x - 16, y - 4); ctx.moveTo(x + 8, y + 1); ctx.lineTo(x + 15, y - 2); ctx.stroke();
        return;
      }
      shadow(ctx, x, y + 2, 16, 5);
      rrect(ctx, x - 3, y - 8, 6, 10, 2, P.wood[2]);
      const g = '#2f6b4a';
      poly(ctx, [x - 16, y - 6, x, y - 26, x + 16, y - 6], g); poly(ctx, [x - 13, y - 18, x, y - 38, x + 13, y - 18], shade(g, 0.08)); poly(ctx, [x - 9, y - 30, x, y - 48, x + 9, y - 30], shade(g, 0.15));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 5, y - 46, 10, 3); ctx.fillRect(x - 10, y - 32, 7, 3); ctx.fillRect(x + 3, y - 20, 9, 3);
    } else if (b === 'poison') {
      shadow(ctx, x, y + 2, 14, 5);
      ctx.lineCap = 'round';
      line(ctx, x, y, x, y - 30, '#3a2e3e', 5);
      line(ctx, x, y - 18, x - 12, y - 30, '#3a2e3e', 3); line(ctx, x, y - 24, x + 11, y - 36, '#3a2e3e', 3);
      circle(ctx, x - 12, y - 31, 3, P.biome.poison.accent[0], 1); circle(ctx, x + 11, y - 37, 3, P.biome.poison.accent[0], 1);
    } else {
      shadow(ctx, x, y + 2, 12, 4);
      rrect(ctx, x - 6, y - 14, 12, 16, 3, '#2a1b17');
      ctx.fillStyle = P.biome.fire.accent[0]; ctx.fillRect(x - 3, y - 12, 2, 4); ctx.fillRect(x + 1, y - 7, 2, 3);
    }
  }

  // Couche animée (lave pulsante)
  function drawLavaGlow(ctx, lava, t) {
    if (!lava || !lava.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const [x1, y1, x2, y2, w] of lava) {
      const k = 0.5 + 0.5 * Math.sin(t * 2 + x1 * 0.02 + y1 * 0.015);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.lineWidth = w * 0.45; ctx.strokeStyle = rgba('#ffd76a', 0.35 + 0.5 * k); ctx.stroke();
    }
    ctx.restore();
  }

  window.Art = { shade, rgba, circle, ellipse, rrect, poly, line, shadow, glow, drawHero, drawGrave, drawMob, drawTower, drawProjectile, drawCrown, buildTerrain, drawLavaGlow, drawWeapon };
})();
