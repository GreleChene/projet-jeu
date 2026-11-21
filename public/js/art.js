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
  function mix(a, b, k) {
    const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    const c = (sh) => Math.round(((x >> sh) & 255) * (1 - k) + ((y >> sh) & 255) * k);
    return '#' + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
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
  // tier 0 = arme de départ ; 1-4 = armes achetées (métal plus brillant, taille, runes)
  function drawWeapon(ctx, weapon, color, swing, tier) {
    tier = tier || 0;
    const M = GD.WEAPON_METAL[tier] || GD.WEAPON_METAL[0];
    const W = P.wood, S = P.stone;
    const wood = tier >= 4 ? '#c99a3a' : tier === 3 ? '#e0c79a' : W[1];
    const guard = tier >= 2 ? P.ui.gold : W[2];
    const k = 1 + 0.07 * tier;
    ctx.save();
    ctx.rotate(-0.9 + swing * 1.8);
    ctx.scale(k, k);
    if (tier >= 4) { ctx.save(); ctx.globalAlpha = 0.35; ctx.translate(14, 0); glow(ctx, '#2fd6e0', 9); ctx.restore(); }
    switch (weapon) {
      case 'club': line(ctx, 0, 0, 14, 0, W[1], 3); circle(ctx, 15, 0, 3.5, W[0]); break;
      case 'sword':
        line(ctx, -2, 0, 4, 0, W[2], 3); line(ctx, 4, -4.5, 4, 4.5, guard, 2);
        ctx.beginPath(); ctx.moveTo(5, -2.2); ctx.lineTo(19 + tier, -1.6); ctx.lineTo(23 + tier, 0); ctx.lineTo(19 + tier, 1.6); ctx.lineTo(5, 2.2); ctx.closePath(); fillStroke(ctx, M, 1.4);
        ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(7, -0.6); ctx.lineTo(18 + tier, -0.6); ctx.stroke();
        break;
      case 'hammer': line(ctx, -2, 0, 16, 0, wood, 3); rrect(ctx, 12, -7, 9, 14, 2, tier ? M : P.ui.gold); rrect(ctx, 14.5, -3, 4, 6, 1, guard, 1); break;
      case 'lance': line(ctx, -6, 0, 24, 0, wood, 2.5); poly(ctx, [24, -3.5, 33 + tier, 0, 24, 3.5], M, 1.5); poly(ctx, [6, -4, 11, 0, 6, 4], color, 1.2); break;
      case 'staff':
        line(ctx, -4, 0, 16, 0, wood, 2.5);
        if (tier >= 2) { ctx.beginPath(); ctx.arc(18, 0, 6.5, 0.6, -0.6 + TAU); ctx.lineWidth = 2.5; ctx.strokeStyle = OL; ctx.stroke(); ctx.lineWidth = 1.2; ctx.strokeStyle = guard; ctx.stroke(); }
        ctx.save(); ctx.translate(18, 0); glow(ctx, color, 5 + tier); ctx.restore();
        circle(ctx, 18, 0, 4.5 + tier * 0.4, tier >= 4 ? '#2fd6e0' : color); circle(ctx, 17, -1.5, 1.5, '#ffffff', 0.01); break;
      case 'whip':
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(10, -10 + swing * 20, 22 + tier * 2, 2); ctx.lineWidth = 2 + tier * 0.3; ctx.strokeStyle = tier >= 3 ? '#3a2433' : W[2]; ctx.stroke();
        if (tier >= 2) { ctx.fillStyle = M; for (const q of [0.4, 0.7]) ctx.fillRect(10 * q * 2 - 1, -5 + swing * 10 * q, 2, 2); }
        line(ctx, -2, 0, 4, 0, guard, 3); break;
      case 'scythe': line(ctx, -4, 0, 16, 0, tier >= 3 ? '#3a2e3e' : W[2], 2.5); ctx.beginPath(); ctx.moveTo(16, 0); ctx.quadraticCurveTo(14, -13 - tier, 3, -15 - tier); ctx.quadraticCurveTo(12, -8, 13, 0); fillStroke(ctx, M, 1.5); break;
      case 'bow': case 'longbow': {
        const L = (weapon === 'longbow' ? 15 : 11) + tier;
        ctx.beginPath(); ctx.arc(-2, 0, L, -1.1, 1.1); ctx.lineWidth = 4.5; ctx.strokeStyle = OL; ctx.stroke(); ctx.lineWidth = 2.5; ctx.strokeStyle = wood; ctx.stroke();
        if (tier >= 2) { circle(ctx, -2 + Math.cos(-1.1) * L, Math.sin(-1.1) * L, 1.8, guard, 1); circle(ctx, -2 + Math.cos(1.1) * L, Math.sin(1.1) * L, 1.8, guard, 1); }
        ctx.beginPath(); ctx.moveTo(-2 + Math.cos(-1.1) * L, Math.sin(-1.1) * L); ctx.lineTo(-2 - swing * 6, 0); ctx.lineTo(-2 + Math.cos(1.1) * L, Math.sin(1.1) * L); ctx.lineWidth = 1; ctx.strokeStyle = '#f3ead7'; ctx.stroke();
        break;
      }
      case 'crossbow': line(ctx, -4, 0, 12, 0, wood, 3.5); ctx.beginPath(); ctx.arc(14, 0, 8 + tier * 0.6, -1.4 + Math.PI, 1.4 + Math.PI, true); ctx.lineWidth = 4; ctx.strokeStyle = OL; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = tier ? M : S[0]; ctx.stroke(); break;
      case 'daggers':
        line(ctx, -1, 0, 3, 0, W[2], 3);
        if (tier >= 2) { ctx.beginPath(); ctx.moveTo(3, -2.5); ctx.quadraticCurveTo(10, -4, 14 + tier, 0); ctx.quadraticCurveTo(9, 1, 3, 2.5); ctx.closePath(); fillStroke(ctx, M, 1.2); }
        else poly(ctx, [3, -2.5, 13 + tier, 0, 3, 2.5], M, 1.2);
        break;
      case 'pitchfork': line(ctx, -4, 0, 16, 0, wood, 2.5); line(ctx, 16, -5, 16, 5, tier ? M : S[1], 1.5); for (const o of [-5, 0, 5]) line(ctx, 16, o, 22 + tier, o, tier ? M : S[0], 1.2); break;
      case 'axe': line(ctx, -2, 0, 16, 0, wood, 3); ctx.beginPath(); ctx.moveTo(12, -1); ctx.quadraticCurveTo(22 + tier, -10 - tier, 20 + tier, 2); ctx.lineTo(12, 3); fillStroke(ctx, M, 1.5); break;
      case 'pickaxe': line(ctx, -2, 0, 16, 0, wood, 3); ctx.beginPath(); ctx.moveTo(16, -10 - tier); ctx.quadraticCurveTo(22 + tier, 0, 16, 10 + tier); ctx.lineWidth = 5; ctx.strokeStyle = OL; ctx.stroke(); ctx.lineWidth = 3; ctx.strokeStyle = tier ? M : S[0]; ctx.stroke(); break;
    }
    ctx.restore();
  }

  /* ------------------------------ héros ------------------------------ */
  // Pour un objet équipé {t, r} : { style, tier (niveau de forme 1-4 selon la rareté), main, trim, rune }
  function piece(item) {
    const L = GD.itemLook(item);
    if (!L) return { style: 'common', tier: 0 };
    return { ...L, tier: L.shape };
  }
  function runeDot(ctx, x, y) { circle(ctx, x, y, 1.5, '#2fd6e0', 0.8); }

  /**
   * o = { cls, look:{cape,skin,hair}, gear:{head,body,legs,feet,weapon: {t, r}}, facing, t, attack(0..1),
   *       moving, zombie, stealth, scale, seed }
   */
  function drawHero(ctx, x, y, o) {
    const c = GD.CLASSES[o.cls] || GD.CLASSES.habitant;
    const look = o.look || { cape: 0, skin: 1, hair: 0 };
    const eq = GD.gearFor(o.cls, o.gear);
    const head = piece(eq.head), body = piece(eq.body), legs = piece(eq.legs), feet = piece(eq.feet);
    const wTier = eq.weapon ? GD.RARITIES[eq.weapon.r].shape : 0;
    const mythic = Object.values(eq).some((it) => it && it.r >= 5);
    const s = o.scale || 1;
    const t = o.t || 0;
    const cape = P.capes[look.cape % P.capes.length];
    let skin = P.skin[look.skin % P.skin.length];
    if (o.zombie) skin = '#9bc27a';
    const hair = P.hair[look.hair % P.hair.length];
    const flip = Math.cos(o.facing || 0) < 0 ? -1 : 1;
    const moving = o.moving === undefined ? true : o.moving;
    const ph = t * 10 + (o.seed || 0);
    const bob = moving ? Math.abs(Math.sin(ph)) * -1.6 : Math.sin(t * 2 + (o.seed || 0)) * 0.5;
    const step = moving ? Math.sin(ph) * 2.2 : 0;
    const swing = o.attack > 0 ? Math.sin((1 - o.attack) * Math.PI) : 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    if (o.stealth) ctx.globalAlpha = 0.35;
    shadow(ctx, 0, 2, 12, 4);
    if (mythic) { ctx.save(); ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 4); ctx.translate(0, -14); glow(ctx, '#2fd6e0', 16); ctx.restore(); }
    ctx.scale(flip, 1);

    // ---- jambes (pantalon) + chaussures
    const pantsCol = legs.tier ? legs.main : P.wood[2];
    for (const [lx, d] of [[-6, 1], [1, -1]]) {
      const ly = -7 + step * 0.35 * d;
      rrect(ctx, lx, ly, 5, 7, 2, pantsCol, 1.5);
      if (legs.style === 'heavy' && legs.tier >= 2) circle(ctx, lx + 2.5, ly + 2, 1.8, legs.trim, 1);
      if (legs.style === 'worker' && legs.tier >= 2) { ctx.fillStyle = legs.trim; ctx.fillRect(lx + 1, ly, 1.2, 3); }
      if (legs.rune) runeDot(ctx, lx + 2.5, ly + 2.5);
      drawFoot(ctx, lx, ly + 5.5, feet, skin);
    }
    // ---- cape
    ctx.save();
    ctx.translate(0, bob);
    const capeWave = Math.sin(t * 6 + (o.seed || 0)) * (moving ? 2.2 : 0.8);
    poly(ctx, [-6, -21, 6, -21, 8, -4, -11 - (moving ? 2 : 0), -3 + capeWave], A_shade(cape, -0.18));
    // bouclier dans le dos
    if (c.shield) { circle(ctx, -9, -12, 6.5, c.color); circle(ctx, -9, -12, 2.2, P.ui.gold, 1); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(-10.5, -14, 2.5, 0, TAU); ctx.fill(); }
    // ---- torse
    drawTorso(ctx, body, cape, c);
    // ---- tête
    const hy = -29;
    circle(ctx, 0, hy, 8.5, skin);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.arc(-2.5, hy - 3, 3.5, 0, TAU); ctx.fill();
    const hatHidesHair = head.tier > 0 && !(head.style === 'leather' && head.tier === 1);
    if (!hatHidesHair) {
      ctx.beginPath(); ctx.arc(0, hy - 1, 8.5, Math.PI * 1.05, Math.PI * 1.95); ctx.lineTo(4, hy - 4); ctx.lineTo(-8, hy - 1); ctx.closePath(); fillStroke(ctx, hair, 1.5);
    }
    ctx.fillStyle = OL; ctx.fillRect(5.5, hy - 0.8, 1.6, 2.6); ctx.fillRect(2, hy - 0.8, 1.6, 2.6);
    if (o.zombie) { ctx.fillStyle = '#5c7a3d'; ctx.fillRect(-4, hy + 2, 3, 2); }
    drawHeadgear(ctx, head, hy, cape, t);
    // ---- main + arme
    ctx.save();
    ctx.translate(8, -14);
    drawWeapon(ctx, c.weapon, c.color, swing, wTier);
    circle(ctx, 0, 0, 3, (body.style === 'heavy' && body.tier >= 2) ? body.main : skin, 1.5);
    ctx.restore();
    if (c.weapon === 'daggers') { ctx.save(); ctx.translate(-8, -13); ctx.scale(-1, 1); drawWeapon(ctx, 'daggers', c.color, 1 - swing, wTier); ctx.restore(); }
    ctx.restore();
    ctx.restore();
  }
  const A_shade = (h, k) => shade(h, k);

  function drawFoot(ctx, lx, fy, feet, skin) {
    const st = feet.style, t = feet.tier;
    if (!t) { rrect(ctx, lx - 0.5, fy, 6.5, 3, 1.5, '#3c2a1e', 1.2); return; }
    switch (st) {
      case 'heavy': rrect(ctx, lx - 1, fy - 1, 7.5, 4, 1.5, feet.main, 1.3); if (t >= 3) { ctx.fillStyle = feet.trim; ctx.fillRect(lx + 1, fy, 3.5, 1); } break;
      case 'cloth':
        if (t === 1) { rrect(ctx, lx - 0.5, fy + 0.5, 6.5, 2.5, 1, skin, 1); ctx.fillStyle = P.wood[2]; ctx.fillRect(lx, fy + 1, 5.5, 1); }
        else { rrect(ctx, lx - 0.5, fy, 7, 3, 1.5, feet.main, 1.2); if (t >= 3) { poly(ctx, [lx + 6.5, fy, lx + 8.5, fy - 1.5, lx + 6.5, fy + 2], feet.main, 1); } } break;
      case 'leather': rrect(ctx, lx - 0.5, fy - 2.5, 6.5, 5.5, 1.5, feet.main, 1.2); ctx.fillStyle = feet.trim; ctx.fillRect(lx, fy - 1, 5.5, 1); break;
      case 'worker': rrect(ctx, lx - 1, fy - (t === 1 ? 0 : 2), 7.5, t === 1 ? 3.5 : 5.5, 2, t === 1 ? P.wood[0] : feet.main, 1.3); break;
      default: rrect(ctx, lx - 0.5, fy - 1.5, 6.5, 4.5, 1.5, P.wood[1], 1.2);
    }
    if (feet.rune) runeDot(ctx, lx + 3, fy + 1);
  }

  function drawTorso(ctx, body, cape, c) {
    const st = body.style, t = body.tier;
    if (!t || st === 'common') {
      rrect(ctx, -8, -21, 16, 15, 5, t ? body.main : cape);
      if (t) { ctx.fillStyle = 'rgba(0,0,0,.18)'; for (let i = -18; i < -8; i += 3) ctx.fillRect(-7, i, 14, 1); }
    } else if (st === 'heavy') {
      rrect(ctx, -8.5, -21, 17, 15, 5, body.main);
      ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(-0.6, -20, 1.2, 12);
      if (t === 2) { ctx.fillStyle = 'rgba(0,0,0,.2)'; for (let i = -6; i <= 6; i += 3) for (let j = -19; j < -9; j += 3) ctx.fillRect(i, j + (i % 2 ? 1.5 : 0), 1.3, 1.3); }
      if (t >= 2) { circle(ctx, -8, -19, 4, body.main, 1.6); circle(ctx, 8, -19, 4, body.main, 1.6); }
      if (t >= 3) { ctx.strokeStyle = body.trim; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(0, -9); ctx.lineTo(6, -12); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-6, -19, 3, 6);
    } else if (st === 'cloth') {
      // robe longue qui descend sur les jambes
      ctx.beginPath(); ctx.moveTo(-7, -21); ctx.lineTo(7, -21); ctx.lineTo(10, -3); ctx.quadraticCurveTo(0, -1, -10, -3); ctx.closePath(); fillStroke(ctx, body.main);
      ctx.strokeStyle = body.trim; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-9.5, -4.2); ctx.quadraticCurveTo(0, -2.2, 9.5, -4.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -21); ctx.lineTo(0, -4); ctx.stroke();
      if (t >= 2) { ctx.fillStyle = body.trim; ctx.beginPath(); ctx.arc(0, -19, 2.4, 0, Math.PI); ctx.fill(); }
      if (t >= 3) { ctx.fillStyle = body.trim; for (const [sx, sy] of [[-4, -14], [4, -10], [-3, -8]]) ctx.fillRect(sx, sy, 1.5, 1.5); }
    } else if (st === 'leather') {
      rrect(ctx, -8, -21, 16, 15, 5, body.main);
      ctx.strokeStyle = body.trim; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-7, -20); ctx.lineTo(6, -9); ctx.stroke();
      if (t >= 2) { ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(-7, -17, 14, 1.2); ctx.fillRect(-7, -13, 14, 1.2); }
      if (t >= 3) { poly(ctx, [-9, -21, -4, -21, -6, -15], body.trim, 1.2); poly(ctx, [9, -21, 4, -21, 6, -15], body.trim, 1.2); }
    } else if (st === 'worker') {
      rrect(ctx, -8, -21, 16, 15, 5, t === 1 ? body.main : '#e8dcc0');
      if (t >= 2) {
        rrect(ctx, -6, -18, 12, 13, 3, body.main, 1.5);
        ctx.fillStyle = body.trim; ctx.fillRect(-5.5, -20.5, 1.5, 3); ctx.fillRect(4, -20.5, 1.5, 3);
        rrect(ctx, -2.5, -14, 5, 3.5, 1, A_shade(body.main, -0.2), 1);
      }
    }
    if (body.rune) { runeDot(ctx, 0, -15); ctx.save(); ctx.globalAlpha = 0.25; ctx.translate(0, -14); glow(ctx, '#2fd6e0', 8); ctx.restore(); }
    // ceinture + écusson de classe (repère visuel commun à tous)
    if (st !== 'cloth' || !t) { ctx.fillStyle = OL; ctx.fillRect(-8, -9.5, 16, 2.5); }
    circle(ctx, 1, -15, 3, c.color, 1.5);
  }

  function drawHeadgear(ctx, head, hy, cape, t) {
    const st = head.style, tier = head.tier;
    if (!tier) return;
    const M = head.main, T = head.trim;
    if (st === 'common') {
      ctx.beginPath(); ctx.arc(0, hy - 1, 10, Math.PI * 0.95, Math.PI * 2.05); ctx.lineTo(10, hy + 4); ctx.lineTo(7, hy + 1); ctx.arc(0, hy, 7.5, 0, Math.PI, true); ctx.lineTo(-10, hy + 4); ctx.closePath();
      fillStroke(ctx, shade(cape, -0.25), 1.8); return;
    }
    if (st === 'heavy') {
      if (tier === 1) { ctx.beginPath(); ctx.arc(0, hy - 1, 9.6, Math.PI, TAU); ctx.closePath(); fillStroke(ctx, M, 1.8); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(-9.6, hy - 2.5, 19.2, 2); }
      else if (tier === 2) { ctx.beginPath(); ctx.arc(0, hy - 1, 10, Math.PI, TAU); ctx.lineTo(10, hy + 5); ctx.lineTo(7, hy + 5); ctx.lineTo(7, hy - 1); ctx.lineTo(-7, hy - 1); ctx.lineTo(-7, hy + 5); ctx.lineTo(-10, hy + 5); ctx.closePath(); fillStroke(ctx, M, 1.8); rrect(ctx, 3.5, hy - 2, 2.5, 7, 1, T, 1); }
      else {
        rrect(ctx, -9.5, hy - 11, 19, 18, 5, M, 1.8);
        ctx.fillStyle = OL; ctx.fillRect(1, hy - 1.5, 9, 2.2);
        ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-7, hy - 9, 3, 7);
        if (tier === 3) poly(ctx, [-2, hy - 11, 0, hy - 17, 2, hy - 11], T, 1.2);
        else { poly(ctx, [-7, hy - 10, -7, hy - 17, -3, hy - 13, 0, hy - 19, 3, hy - 13, 7, hy - 17, 7, hy - 10], P.ui.gold, 1.4); runeDot(ctx, 0, hy - 13); }
      }
      return;
    }
    if (st === 'cloth') {
      if (tier === 1) { ctx.beginPath(); ctx.arc(0, hy - 1, 10, Math.PI * 0.95, Math.PI * 2.05); ctx.lineTo(10, hy + 4); ctx.lineTo(7, hy + 1); ctx.arc(0, hy, 7.5, 0, Math.PI, true); ctx.lineTo(-10, hy + 4); ctx.closePath(); fillStroke(ctx, M, 1.8); }
      else if (tier <= 3) {
        const h = tier === 2 ? 16 : 22;
        ellipse(ctx, 0, hy - 5, 13, 3.5, M, 1.8);
        ctx.beginPath(); ctx.moveTo(-7, hy - 6); ctx.quadraticCurveTo(-2, hy - h * 0.6, -1 - Math.sin(t * 2) * 2, hy - 6 - h); ctx.quadraticCurveTo(3, hy - h * 0.5, 7, hy - 6); ctx.closePath(); fillStroke(ctx, M, 1.8);
        ctx.fillStyle = T; ctx.fillRect(-6.5, hy - 8.5, 13, 2);
        if (tier === 3) { ctx.fillStyle = T; ctx.fillRect(-2, hy - 15, 1.6, 1.6); ctx.fillRect(1, hy - 19, 1.6, 1.6); }
      } else {
        // diadème runique + cheveux visibles
        ctx.beginPath(); ctx.arc(0, hy - 1, 8.5, Math.PI * 1.05, Math.PI * 1.95); ctx.lineTo(4, hy - 4); ctx.lineTo(-8, hy - 1); ctx.closePath(); fillStroke(ctx, '#e8e2cf', 1.5);
        ctx.strokeStyle = P.ui.gold; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, hy, 8.8, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
        poly(ctx, [0, hy - 13, 2.5, hy - 9.5, 0, hy - 6, -2.5, hy - 9.5], '#2fd6e0', 1.2);
      }
      return;
    }
    if (st === 'leather') {
      if (tier === 1) { ctx.fillStyle = M; ctx.fillRect(-8.6, hy - 5, 17.2, 3); ctx.strokeStyle = OL; ctx.lineWidth = 1.2; ctx.strokeRect(-8.6, hy - 5, 17.2, 3); poly(ctx, [-8, hy - 4, -13, hy - 1 + Math.sin(t * 6) * 1.5, -12, hy - 5], M, 1.2); }
      else {
        ctx.beginPath(); ctx.arc(0, hy - 1, 10, Math.PI * 0.95, Math.PI * 2.05); ctx.lineTo(10, hy + 4); ctx.lineTo(7, hy + 1); ctx.arc(0, hy, 7.5, 0, Math.PI, true); ctx.lineTo(-10, hy + 4); ctx.closePath(); fillStroke(ctx, M, 1.8);
        if (tier >= 3) poly(ctx, [-6, hy - 9, -14, hy - 16, -9, hy - 8], '#f3ead7', 1.2); // plume
        if (tier === 4) { rrect(ctx, 0.5, hy + 0.5, 9, 4.5, 2, '#2b2433', 1.2); runeDot(ctx, 5, hy + 2.7); }
      }
      return;
    }
    if (st === 'worker') {
      if (tier === 1) { ellipse(ctx, 0, hy - 5, 14, 3.5, '#e2c56a', 1.6); ctx.beginPath(); ctx.arc(0, hy - 5, 7.5, Math.PI, TAU); ctx.closePath(); fillStroke(ctx, '#e2c56a', 1.6); ctx.fillStyle = '#b23a48'; ctx.fillRect(-7.3, hy - 7.5, 14.6, 2); }
      else if (tier === 2) { ctx.beginPath(); ctx.arc(0, hy - 1.5, 9.5, Math.PI, TAU); ctx.closePath(); fillStroke(ctx, M, 1.8); circle(ctx, 0, hy - 12, 2.6, '#f3ead7', 1.2); }
      else {
        ctx.beginPath(); ctx.arc(0, hy - 1, 10, Math.PI, TAU); ctx.closePath(); fillStroke(ctx, tier === 4 ? '#f2c14e' : M, 1.8);
        ellipse(ctx, 0, hy - 1, 12, 2.2, tier === 4 ? '#f2c14e' : M, 1.4);
        rrect(ctx, 3, hy - 8, 5, 4, 1, '#3c3546', 1); circle(ctx, 7.5, hy - 6, 2, tier === 4 ? '#2fd6e0' : '#ffd76a', 1);
        ctx.save(); ctx.globalAlpha = 0.35; ctx.translate(11, hy - 6); glow(ctx, tier === 4 ? '#2fd6e0' : '#ffd76a', 6); ctx.restore();
      }
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

  /* ------------------------------ bâtiments de classe ------------------------------ */
  // o = { hp (0..1), t, color (couleur de la classe) }
  function drawBuilding(ctx, family, x, y, o) {
    const t = o.t || 0, hp = o.hp === undefined ? 1 : o.hp;
    const W = P.wood, S = P.stone;
    ctx.save();
    ctx.translate(x, y);
    shadow(ctx, 0, 6, 44, 13);
    if (hp <= 0) { drawRuins(ctx, t); ctx.restore(); return; }
    const flag = (fx, fy, col) => {
      line(ctx, fx, fy, fx, fy - 20, W[2], 1.6);
      poly(ctx, [fx, fy - 20, fx + 13, fy - 16 + Math.sin(t * 4 + fx) * 1.5, fx, fy - 12], col, 1.3);
    };
    switch (family) {
      case 'paysan': // ferme : grange rouge
        rrect(ctx, -30, -30, 60, 36, 3, '#b5413a', 2.5);
        poly(ctx, [-36, -28, 0, -54, 36, -28], '#7a2e2a', 2.5);
        rrect(ctx, -10, -18, 20, 24, 2, '#f3ead7', 2);
        ctx.strokeStyle = '#b5413a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-8, -16); ctx.lineTo(8, 4); ctx.moveTo(8, -16); ctx.lineTo(-8, 4); ctx.stroke();
        rrect(ctx, 26, -8, 16, 14, 4, '#e2c56a', 1.8); // botte de foin
        flag(-30, -30, o.color);
        break;
      case 'habitant': { // chaumière + fumée
        rrect(ctx, -26, -26, 52, 32, 4, '#e8dcc0', 2.5);
        ctx.beginPath(); ctx.moveTo(-34, -22); ctx.quadraticCurveTo(0, -60, 34, -22); ctx.closePath(); fillStroke(ctx, '#d9b85a', 2.5);
        ctx.strokeStyle = 'rgba(29,22,38,.25)'; ctx.lineWidth = 1.2;
        for (let i = -24; i <= 24; i += 8) { ctx.beginPath(); ctx.moveTo(i, -25); ctx.lineTo(i * 0.5, -44); ctx.stroke(); }
        rrect(ctx, 14, -52, 8, 16, 2, S[1], 1.8);
        for (let i = 0; i < 3; i++) { ctx.save(); ctx.globalAlpha = 0.35 - i * 0.1; circle(ctx, 18 + Math.sin(t + i) * 3, -60 - i * 9 - ((t * 8) % 9), 4 + i * 2, '#d8d0e0', 0.01); ctx.restore(); }
        rrect(ctx, -7, -14, 14, 20, 6, W[1], 2);
        rrect(ctx, -22, -18, 9, 9, 2, '#ffd76a', 1.6);
        break;
      }
      case 'mage': // tour des mages fine, toit violet, orbe lumineux
        rrect(ctx, -16, -64, 32, 70, 6, '#5b6fa8', 2.5);
        ctx.fillStyle = 'rgba(29,22,38,.2)'; for (let i = 0; i < 4; i++) ctx.fillRect(-15, -54 + i * 15, 30, 1.6);
        poly(ctx, [-22, -62, 0, -100, 22, -62], '#6b4fa0', 2.5);
        ctx.save(); ctx.translate(0, -106); glow(ctx, '#c9a8ff', 10 + Math.sin(t * 3) * 2); ctx.restore();
        circle(ctx, 0, -106, 5, '#c9a8ff', 1.6);
        rrect(ctx, -6, -40, 12, 16, 6, '#ffd76a', 1.8);
        rrect(ctx, -8, -12, 16, 18, 7, W[2], 2);
        break;
      case 'eleveur': // étable ouverte + barrière
        rrect(ctx, -32, -30, 64, 36, 3, W[0], 2.5);
        ctx.fillStyle = 'rgba(29,22,38,.2)'; for (let i = -28; i < 32; i += 8) ctx.fillRect(i, -28, 1.5, 32);
        poly(ctx, [-38, -28, -30, -48, 30, -48, 38, -28], W[2], 2.5);
        rrect(ctx, -14, -20, 28, 26, 3, '#3a2e3e', 2);
        for (const fx of [-44, 32]) { line(ctx, fx, 6, fx + 12, 6, W[1], 2); line(ctx, fx, -2, fx + 12, -2, W[1], 2); line(ctx, fx, -6, fx, 8, W[2], 2); line(ctx, fx + 12, -6, fx + 12, 8, W[2], 2); }
        flag(30, -48, o.color);
        break;
      case 'archer': // tour de guet en bois sur pilotis
        for (const lx of [-18, 14]) line(ctx, lx, 6, lx + (lx < 0 ? 6 : -6), -46, W[1], 3.5);
        line(ctx, -14, -10, 10, -30, W[2], 2); line(ctx, 10, -10, -14, -30, W[2], 2);
        rrect(ctx, -24, -62, 48, 16, 3, W[0], 2.5);
        for (let i = -20; i <= 16; i += 9) rrect(ctx, i, -72, 6, 10, 1, W[0], 1.6);
        poly(ctx, [-28, -70, 0, -96, 28, -70], '#2e9e57', 2.5);
        flag(0, -96, o.color);
        break;
      case 'assassin': // repaire : tente sombre
        poly(ctx, [-38, 6, 0, -52, 38, 6], '#2b2433', 2.5);
        poly(ctx, [-8, 6, 0, -22, 8, 6], '#120d18', 2);
        ctx.strokeStyle = o.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-20, -20); ctx.lineTo(20, -20); ctx.stroke();
        line(ctx, 0, -52, 0, -62, W[2], 2);
        poly(ctx, [0, -62, 12, -58 + Math.sin(t * 3) * 1.5, 0, -54], '#5b4a7a', 1.3);
        circle(ctx, -28, 2, 3, '#ffd76a', 1); // lanterne
        break;
      case 'soldat': // caserne en pierre crénelée
      default:
        rrect(ctx, -36, -34, 72, 40, 3, S[0], 2.5);
        ctx.fillStyle = 'rgba(29,22,38,.2)';
        for (let r = 0; r < 3; r++) for (let i = -34; i < 34; i += 12) ctx.fillRect(i + (r % 2) * 6, -30 + r * 12, 10, 1.4);
        for (let i = -34; i <= 26; i += 12) rrect(ctx, i, -44, 8, 10, 1, S[1], 1.8);
        rrect(ctx, -10, -16, 20, 22, 9, W[2], 2);
        for (const sx of [-24, 24]) { circle(ctx, sx, -18, 6, o.color, 1.8); circle(ctx, sx, -18, 2, P.ui.gold, 1); }
        flag(-36, -44, o.color);
        break;
    }
    // dégâts : fissures et flammes
    if (hp < 0.5) {
      ctx.strokeStyle = OL; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(-20, -24); ctx.lineTo(-12, -14); ctx.lineTo(-16, -4); ctx.moveTo(18, -26); ctx.lineTo(12, -16); ctx.stroke();
    }
    if (hp < 0.3) {
      for (let i = 0; i < 2; i++) poly(ctx, [-12 + i * 22, -28, -6 + i * 22, -40 - Math.sin(t * 12 + i) * 5, 0 + i * 22, -28], P.biome.fire.accent[i], 1.3);
    }
    ctx.restore();
  }

  function drawRuins(ctx, t) {
    const S = P.stone, W = P.wood;
    poly(ctx, [-34, 6, -26, -8, -12, -4, -4, -14, 10, -6, 22, -12, 34, 6], S[2], 2.5);
    rrect(ctx, -22, -6, 12, 8, 2, S[1], 1.6);
    rrect(ctx, 8, -4, 14, 7, 2, S[0], 1.6);
    line(ctx, -14, -2, 6, -22, '#2a1b17', 3);
    line(ctx, 14, 0, 26, -16, '#2a1b17', 3);
    for (let i = 0; i < 3; i++) {
      ctx.save(); ctx.globalAlpha = 0.28 - i * 0.07;
      circle(ctx, -4 + Math.sin(t * 0.8 + i) * 6, -24 - i * 14 - ((t * 10) % 14), 7 + i * 3, '#6b6478', 0.01);
      ctx.restore();
    }
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

    // 1. sol : une couleur par tuile, agrandie avec lissage (dégradés doux, plus de damier)
    const tileCol = (tx, ty) => {
      const G = P.biome[grid[ty][tx]].ground;
      const f = T.valueNoise(tx / 3.2, ty / 3.2, seed + 3) * (G.length - 1);
      return mix(G[Math.floor(f)], G[Math.min(G.length - 1, Math.ceil(f))], f - Math.floor(f));
    };
    const small = document.createElement('canvas');
    small.width = T.COLS; small.height = T.ROWS;
    const sctx = small.getContext('2d');
    for (let ty = 0; ty < T.ROWS; ty++) for (let tx = 0; tx < T.COLS; tx++) { sctx.fillStyle = tileCol(tx, ty); sctx.fillRect(tx, ty, 1, 1); }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, T.COLS * TS, T.ROWS * TS);
    // bords organiques (« blobs ») des couches de biome qui envahissent les autres
    for (const b of BIOME_ORDER) {
      for (let ty = 0; ty < T.ROWS; ty++) for (let tx = 0; tx < T.COLS; tx++) {
        if (grid[ty][tx] !== b) continue;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const n = grid[ty + dy] && grid[ty + dy][tx + dx];
          return n && BIOME_ORDER.indexOf(n) < BIOME_ORDER.indexOf(b);
        });
        if (!edge) continue;
        ctx.fillStyle = tileCol(tx, ty);
        for (let k = 0; k < 3; k++) {
          const ox = (T.hash2(tx, ty, seed + 20 + k) - 0.5) * TS * 0.9, oy = (T.hash2(tx, ty, seed + 30 + k) - 0.5) * TS * 0.9;
          ctx.beginPath(); ctx.arc(tx * TS + TS / 2 + ox, ty * TS + TS / 2 + oy, TS * (0.45 + T.hash2(tx, ty, seed + 40 + k) * 0.3), 0, TAU); ctx.fill();
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

    // lumière chaude autour de la tour + ombre douce venant du haut
    const lg = ctx.createRadialGradient(GD.WORLD.CX, GD.WORLD.CY, 40, GD.WORLD.CX, GD.WORLD.CY, 620);
    lg.addColorStop(0, 'rgba(255,236,190,0.16)'); lg.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
    const sg = ctx.createLinearGradient(0, 0, 0, H);
    sg.addColorStop(0, 'rgba(20,12,30,0.10)'); sg.addColorStop(0.4, 'rgba(20,12,30,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);

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

  window.Art = { drawBuilding, shade, rgba, circle, ellipse, rrect, poly, line, shadow, glow, drawHero, drawGrave, drawMob, drawTower, drawProjectile, drawCrown, buildTerrain, drawLavaGlow, drawWeapon };
})();
