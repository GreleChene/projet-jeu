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
  /* Mode « détaillé » : volumes éclairés (lumière en haut à gauche), reflets, yeux brillants,
   * accessoires supplémentaires. Activé par Art.setDetail(true). */
  let RICH = false;
  function setDetail(on) { RICH = !!on; }
  // Les dégradés sont mis en cache (mêmes coordonnées locales + même couleur = même objet)
  const gradCache = new Map();
  function volume(ctx, fill, x0, y0, x1, y1) {
    const key = fill + '|' + Math.round(x0) + '|' + Math.round(y0) + '|' + Math.round(x1) + '|' + Math.round(y1);
    let g = gradCache.get(key);
    if (!g) {
      if (gradCache.size > 6000) gradCache.clear();
      g = ctx.createLinearGradient(x0, y0, x0 + (x1 - x0) * 0.45, y1);
      g.addColorStop(0, shade(fill, 0.26)); g.addColorStop(0.42, fill); g.addColorStop(1, shade(fill, -0.3));
      gradCache.set(key, g);
    }
    return g;
  }
  function fillStroke(ctx, fill, lw, bb) {
    ctx.fillStyle = RICH && bb && typeof fill === 'string' && fill[0] === '#' && (bb[3] - bb[1]) > 3 ? volume(ctx, fill, bb[0], bb[1], bb[2], bb[3]) : fill;
    ctx.fill();
    ctx.lineWidth = lw || 2; ctx.strokeStyle = OL; ctx.stroke();
  }
  function circle(ctx, x, y, r, fill, lw) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); fillStroke(ctx, fill, lw, [x - r, y - r, x + r, y + r]);
    if (RICH && r > 3.5 && lw !== 0.01) { ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.ellipse(x - r * 0.35, y - r * 0.42, r * 0.32, r * 0.22, -0.6, 0, TAU); ctx.fill(); }
  }
  function ellipse(ctx, x, y, rx, ry, fill, lw, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU); fillStroke(ctx, fill, lw, [x - rx, y - ry, x + rx, y + ry]); }
  function rrect(ctx, x, y, w, h, r, fill, lw) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    fillStroke(ctx, fill, lw, [x, y, x + w, y + h]);
  }
  function poly(ctx, pts, fill, lw) {
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    let x0 = pts[0], y0 = pts[1], x1 = pts[0], y1 = pts[1];
    for (let i = 2; i < pts.length; i += 2) {
      ctx.lineTo(pts[i], pts[i + 1]);
      if (pts[i] < x0) x0 = pts[i]; if (pts[i] > x1) x1 = pts[i]; if (pts[i + 1] < y0) y0 = pts[i + 1]; if (pts[i + 1] > y1) y1 = pts[i + 1];
    }
    ctx.closePath(); fillStroke(ctx, fill, lw, [x0, y0, x1, y1]);
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
    if (RICH && r >= 1.2) {
      // yeux détaillés : contour sombre, iris (couleur) et reflet blanc
      for (const ex of gap > 0.05 ? [x - gap, x + gap] : [x]) {
        ctx.fillStyle = OL; ctx.beginPath(); ctx.arc(ex, y, r * 1.45, 0, TAU); ctx.fill();
        ctx.fillStyle = color && color !== OL ? color : '#f3ead7'; ctx.beginPath(); ctx.arc(ex, y, r * 1.05, 0, TAU); ctx.fill();
        if (!color || color === OL) { ctx.fillStyle = OL; ctx.beginPath(); ctx.arc(ex + r * 0.25, y, r * 0.6, 0, TAU); ctx.fill(); }
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(ex - r * 0.3, y - r * 0.35, Math.max(0.6, r * 0.38), 0, TAU); ctx.fill();
      }
      return;
    }
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
  /* ==================================================================================
   * HÉROS EN PIXEL ART — assemblé à la volée : corps, visage personnalisé (yeux, nez, bouche,
   * coiffure, peau), équipement (style + rareté), arme de classe. Regard vers la droite.
   * Chaque combinaison est mise en cache par image d'animation.
   * ================================================================================== */
  const HW = 34, HH = 38, Y0 = 4; // grille ; Y0 = marge en haut pour chapeaux et armes levées
  function pixGrid() {
    const g = new Array(HW * HH).fill(null);
    const P2 = {
      px(x, y, c) { x = Math.round(x); y = Math.round(y); if (c && x >= 0 && y >= 0 && x < HW && y < HH) g[y * HW + x] = c; },
      rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P2.px(x + i, y + j, c); },
      line(x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1; for (let i = 0; i <= n; i++) P2.px(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c); },
      get(x, y) { return x >= 0 && y >= 0 && x < HW && y < HH ? g[y * HW + x] : null; },
      g
    };
    return P2;
  }
  function heroGearKey(eq) { return GD.SLOTS.map((s) => (eq[s] ? eq[s].t + ':' + eq[s].r : '-')).join(','); }

  // frame : 0 repos, 1 et 2 marche, 3 attaque
  function buildHeroPixels(o, eq, frame) {
    const G = pixGrid(), Y = Y0;
    const c = GD.CLASSES[o.cls] || GD.CLASSES.habitant;
    const L = GD.sanitizeLook(o.look);
    const head = piece(eq.head), body = piece(eq.body), legs = piece(eq.legs), feet = piece(eq.feet);
    const wTier = eq.weapon ? GD.RARITIES[eq.weapon.r].shape : 0;
    const cape = P.capes[L.cape];
    const skin = o.zombie ? '#9bc27a' : P.skin[L.skin], skD = shade(skin, -0.2), skL = shade(skin, 0.18);
    const hair = P.hair[L.hair], haD = shade(hair, -0.3), haL = shade(hair, 0.25);
    const dark = '#1a1214';
    const atk = frame === 3;
    const lo = frame === 1 ? -1 : frame === 2 ? 1 : 0; // décalage des jambes

    // ---- cape (derrière)
    const capeC = shade(cape, -0.15);
    for (let y = Y + 15; y <= Y + 26; y++) { const w = 2 + Math.floor((y - Y - 15) / 3); G.rect(10 - w, y, w + 1, 1, y % 3 ? capeC : shade(capeC, -0.15)); }
    // ---- bouclier dans le dos
    if (c.shield) {
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (i * i + j * j <= 10) G.px(7 + i, Y + 19 + j, i * i + j * j >= 7 ? shade(c.color, -0.3) : c.color);
      G.px(7, Y + 19, P.ui.gold); G.px(6, Y + 17, shade(c.color, 0.35));
    }
    // ---- bras arrière
    const sleeve = body.tier ? (body.style === 'heavy' ? body.main : shade(body.main, -0.1)) : shade(cape, -0.05);
    G.rect(10, Y + 16, 2, 5, shade(sleeve, -0.2)); G.rect(10, Y + 21, 2, 2, skD);
    // ---- jambes et bottes
    const pants = legs.tier ? legs.main : '#5e3a1f', pantsD = shade(pants, -0.25);
    G.rect(12 + lo, Y + 23, 2, 5, pantsD); G.rect(15 - lo, Y + 23, 2, 5, pants);
    if (legs.style === 'heavy' && legs.tier >= 2) { G.px(15 - lo, Y + 25, legs.trim); G.px(16 - lo, Y + 25, legs.trim); }
    if (legs.rune) G.px(16 - lo, Y + 24, '#2fd6e0');
    const boot = feet.tier ? feet.main : '#3c2a1e', bootD = shade(boot, -0.3);
    const bootH = feet.tier >= 2 && feet.style !== 'cloth' ? 3 : 2;
    G.rect(11 + lo, Y + 30 - bootH, 4, bootH, bootD); G.rect(14 - lo, Y + 30 - bootH, 4, bootH, boot);
    G.rect(11 + lo, Y + 29, 4, 1, shade(bootD, -0.2)); G.rect(14 - lo, Y + 29, 4, 1, shade(boot, -0.35));
    if (feet.tier >= 3) { G.px(15 - lo, Y + 28 - bootH + 1, feet.trim); G.px(16 - lo, Y + 28 - bootH + 1, feet.trim); }
    if (feet.rune) G.px(16 - lo, Y + 28, '#2fd6e0');
    // ---- torse selon le style d'armure
    const tun = body.tier ? body.main : cape, tunD = shade(tun, -0.22), tunL = shade(tun, 0.2);
    const st = body.style, t = body.tier;
    if (t && st === 'cloth') {
      // robe longue qui couvre le haut des jambes
      for (let y = Y + 15; y <= Y + 27; y++) { const ex = Math.floor((y - Y - 15) / 4); G.rect(11 - ex, y, 7 + ex * 2, 1, y > Y + 25 ? tunD : tun); }
      G.rect(11, Y + 27, 7 + 6, 1, body.trim); G.line(14, Y + 16, 14, Y + 26, body.trim);
      if (t >= 2) { G.px(13, Y + 16, body.trim); G.px(15, Y + 16, body.trim); }
      if (t >= 3) { G.px(12, Y + 20, body.trim); G.px(16, Y + 23, body.trim); }
    } else {
      G.rect(11, Y + 15, 7, 8, tun);
      G.rect(17, Y + 15, 1, 8, tunD); G.rect(11, Y + 15, 1, 6, tunL);
      if (t && st === 'heavy') {
        G.rect(12, Y + 16, 5, 1, tunL); G.px(14, Y + 17, tunD); G.px(14, Y + 18, tunD);
        if (t >= 2) { G.rect(10, Y + 15, 3, 2, tunL); G.rect(16, Y + 15, 3, 2, tun); G.px(18, Y + 16, tunD); }
        if (t >= 3) { G.px(12, Y + 19, body.trim); G.px(13, Y + 20, body.trim); G.px(15, Y + 20, body.trim); G.px(16, Y + 19, body.trim); G.px(14, Y + 21, body.trim); }
      } else if (t && st === 'leather') {
        G.line(11, Y + 15, 17, Y + 21, body.trim);
        if (t >= 2) { G.rect(12, Y + 18, 5, 1, tunD); }
        if (t >= 3) { G.rect(10, Y + 15, 2, 2, body.trim); G.rect(17, Y + 15, 2, 2, body.trim); }
      } else if (t && st === 'worker') {
        G.rect(11, Y + 15, 7, 8, t === 1 ? tun : '#e8dcc0');
        if (t >= 2) { G.rect(12, Y + 17, 5, 6, tun); G.px(12, Y + 16, body.trim); G.px(16, Y + 16, body.trim); G.rect(13, Y + 19, 3, 2, tunD); }
      } else if (t) {
        for (let y = Y + 17; y < Y + 22; y += 2) G.rect(12, y, 5, 1, tunD);
      }
    }
    if (!(t && st === 'cloth')) { G.rect(11, Y + 22, 7, 1, dark); G.px(14, Y + 22, P.ui.gold); }
    // écusson de classe
    G.rect(13, Y + 18, 2, 2, c.color); G.px(13, Y + 18, shade(c.color, 0.4));
    if (body.rune) { G.px(15, Y + 17, '#2fd6e0'); G.px(12, Y + 21, '#2fd6e0'); }
    // ---- cou et tête
    G.rect(13, Y + 14, 3, 1, skD);
    G.rect(10, Y + 5, 10, 9, skin); G.rect(11, Y + 4, 8, 1, skin); G.rect(11, Y + 14, 7, 0, skin);
    G.rect(11, Y + 13, 8, 1, skin);
    G.rect(19, Y + 6, 1, 7, skD); G.rect(11, Y + 13, 8, 1, skD); G.px(11, Y + 5, skL); G.px(12, Y + 5, skL);
    G.rect(11, Y + 9, 1, 2, skD); // oreille
    // ---- cheveux (cachés par certains casques)
    const hidesHair = head.tier > 0 && !(head.style === 'leather' && head.tier === 1) && !(head.style === 'cloth' && head.tier === 4);
    if (!hidesHair) {
      const hs = L.hairStyle;
      if (hs === 2) { G.rect(8, Y + 6, 3, 11, haD); G.rect(9, Y + 6, 2, 10, hair); }
      if (hs !== 3) {
        G.rect(10, Y + 3, 10, 3, hair); G.rect(11, Y + 2, 8, 1, hair);
        G.rect(10, Y + 6, 2, 3, hair); G.rect(10, Y + 9, 1, 2, haD);
        G.rect(12, Y + 6, 3, 1, hair); G.px(16, Y + 6, hair); G.px(18, Y + 6, hair);
        G.rect(11, Y + 2, 4, 1, haL); G.px(10, Y + 4, haL);
        G.rect(10, Y + 5, 10, 1, hair); G.rect(19, Y + 4, 1, 2, haD);
      }
      if (hs === 1) { for (const x of [10, 12, 14, 16, 18]) { G.px(x, Y + 1, hair); G.px(x + 1, Y + 1, haD); G.px(x, Y, hair); } G.px(11, Y - 1, hair); G.px(15, Y - 1, hair); }
      if (hs === 3) {
        G.rect(10, Y + 4, 10, 2, haD); G.rect(10, Y + 6, 1, 3, haD);
        G.rect(13, Y - 2, 4, 6, hair); G.rect(14, Y - 3, 2, 1, hair); G.rect(13, Y - 2, 1, 6, haL);
      }
      if (hs === 4) { G.rect(12, Y - 1, 5, 3, hair); G.rect(13, Y - 2, 3, 1, hair); G.px(13, Y - 1, haL); G.rect(12, Y + 1, 5, 1, haD); }
    }
    // ---- yeux (colonnes 14 et 17)
    const E = L.eyes, ey = Y + 8;
    for (const ex of [14, 17]) {
      if (E === 0) { G.rect(ex, ey, 1, 2, dark); }
      else if (E === 1) { G.rect(ex, ey, 2, 2, dark); G.px(ex, ey, '#ffffff'); }
      else if (E === 2) { G.rect(ex, ey + 1, 2, 1, dark); }
      else if (E === 3) { G.rect(ex, ey, 1, 2, dark); G.px(ex - 1, ey - 1, ex === 14 ? null : dark); G.line(ex - 1, ey - 2, ex + 1, ey - 1, haD); }
      else { G.rect(ex, ey - 1, 2, 3, '#ffffff'); G.rect(ex + 1, ey, 1, 2, '#3a8fd8'); G.px(ex + 1, ey + 1, dark); }
    }
    // ---- nez (bord droit du visage)
    const N = L.nose, ny = Y + 10;
    if (N === 0) G.px(19, ny, skD);
    else if (N === 1) { G.px(20, ny - 1, skin); G.px(20, ny, skin); G.px(21, ny, skD); }
    else if (N === 2) { G.rect(19, ny - 1, 2, 2, skin); G.px(20, ny, skD); G.px(19, ny + 1, skD); }
    else if (N === 3) { G.px(20, ny - 1, skin); G.px(19, ny, skD); }
    // ---- bouche
    const M = o.attack > 0.2 && L.mouth !== 2 ? 2 : L.mouth, my = Y + 11;
    if (M === 0) { G.px(14, my, dark); G.rect(15, my + 1, 2, 1, dark); G.px(17, my, dark); }
    else if (M === 1) { G.rect(15, my + 1, 3, 1, dark); }
    else if (M === 2) { G.rect(15, my, 2, 2, '#4a1a24'); }
    else if (M === 3) { G.rect(14, my, 4, 2, '#4a1a24'); G.rect(14, my, 4, 1, '#ffffff'); G.px(16, my + 1, '#d9506a'); }
    else { G.rect(14, my + 1, 4, 1, dark); G.px(16, my + 2, '#ffffff'); }
    if (o.zombie) { G.px(12, Y + 11, '#5c7a3d'); G.px(13, Y + 12, '#5c7a3d'); }
    // ---- couvre-chef
    drawHeadgearPx(G, head, Y, cape);
    // ---- bras avant + arme
    const hx = 19, hy = Y + 19;
    if (!atk) { G.rect(18, Y + 16, 2, 3, sleeve); G.rect(19, Y + 18, 2, 2, skin); }
    else { G.rect(18, Y + 16, 4, 2, sleeve); G.rect(21, Y + 16, 2, 2, skin); }
    drawWeaponPx(G, c.weapon, atk ? 22 : hx + 1, atk ? Y + 16 : hy - 1, atk, wTier, c.color);
    if (c.weapon === 'daggers') drawWeaponPx(G, 'daggers', 10, Y + 22, false, wTier, c.color);
    return G.g;
  }

  function drawHeadgearPx(G, head, Y, cape) {
    const st = head.style, t = head.tier;
    if (!t) return;
    const M = st === 'common' ? shade(cape, -0.25) : head.main, Md = shade(M, -0.28), Ml = shade(M, 0.22), T = head.trim;
    const hood = () => {
      G.rect(9, Y + 2, 12, 4, M); G.rect(10, Y + 1, 10, 1, M); G.rect(9, Y + 6, 3, 9, M); G.rect(19, Y + 6, 2, 4, M);
      G.rect(9, Y + 13, 4, 2, Md); G.rect(10, Y + 2, 5, 1, Ml); G.rect(9, Y + 6, 1, 8, Md);
    };
    if (st === 'common' || (st === 'cloth' && t === 1) || (st === 'leather' && t >= 2)) {
      hood();
      if (st === 'leather' && t >= 3) { G.line(9, Y + 1, 6, Y - 2, '#f3ead7'); G.px(7, Y - 2, '#f3ead7'); }
      if (st === 'leather' && t === 4) { G.rect(13, Y + 10, 7, 2, '#2b2433'); G.px(17, Y + 10, '#2fd6e0'); }
      return;
    }
    if (st === 'heavy') {
      // casques ouverts : le visage (yeux, nez, bouche) reste toujours visible
      G.rect(10, Y + 2, 10, 4, M); G.rect(11, Y + 1, 8, 1, M); G.rect(11, Y + 2, 4, 1, Ml); G.rect(10, Y + 5, 10, 1, Md);
      if (t >= 2) { G.rect(10, Y + 6, 2, 6, M); G.px(10, Y + 11, Md); G.rect(19, Y + 6, 1, 3, M); G.px(19, Y + 6, T); } // couvre-nuque + nasal fin
      if (t >= 3) { G.rect(9, Y + 4, 12, 1, Md); G.rect(12, Y + 6, 1, 3, M); G.rect(10, Y + 12, 3, 1, Md); G.px(20, Y + 5, Md); } // bord, garde-joue arrière
      if (t === 3) { G.rect(14, Y - 2, 2, 3, T); G.px(13, Y - 1, T); G.px(16, Y - 1, T); }
      if (t >= 4) { for (const x of [10, 13, 16, 19]) { G.px(x, Y, P.ui.gold); G.px(x, Y - 1, P.ui.gold); } G.rect(10, Y + 1, 10, 1, P.ui.gold); G.px(14, Y, '#2fd6e0'); }
      return;
    }
    if (st === 'cloth') {
      if (t <= 3) {
        G.rect(7, Y + 5, 16, 1, M); G.rect(8, Y + 6, 14, 1, Md);
        const h = t === 2 ? 6 : 9;
        for (let i = 0; i < h; i++) { const w = Math.max(1, 9 - Math.floor(i * 9 / h)); G.rect(15 - Math.floor(w / 2) - Math.floor(i / 3), Y + 4 - i, w, 1, i % 4 === 3 ? Ml : M); }
        G.rect(10, Y + 4, 10, 1, T);
        if (t === 3) { G.px(13, Y, T); G.px(14, Y - 2, T); }
      } else { G.rect(10, Y + 4, 10, 1, P.ui.gold); G.px(14, Y + 3, '#2fd6e0'); G.px(15, Y + 3, '#2fd6e0'); G.px(14, Y + 2, '#2fd6e0'); }
      return;
    }
    if (st === 'leather') { // bandeau
      G.rect(10, Y + 6, 10, 2, M); G.rect(7, Y + 7, 3, 1, M); G.px(6, Y + 8, M); G.px(15, Y + 6, Ml);
      return;
    }
    if (st === 'worker') {
      if (t === 1) { G.rect(6, Y + 5, 18, 1, '#e2c56a'); G.rect(10, Y + 2, 10, 3, '#e2c56a'); G.rect(10, Y + 4, 10, 1, '#b23a48'); G.rect(11, Y + 1, 8, 1, '#e2c56a'); G.rect(7, Y + 6, 16, 1, '#b8983a'); }
      else if (t === 2) { G.rect(10, Y + 2, 10, 4, M); G.rect(11, Y + 1, 8, 1, M); G.rect(18, Y + 5, 4, 1, Md); G.px(14, Y, '#f3ead7'); }
      else {
        const hc = t === 4 ? P.ui.gold : M;
        G.rect(10, Y + 2, 10, 4, hc); G.rect(11, Y + 1, 8, 1, hc); G.rect(8, Y + 5, 14, 1, shade(hc, -0.2)); G.rect(11, Y + 2, 3, 1, shade(hc, 0.3));
        G.rect(17, Y + 2, 3, 2, '#3c3546'); G.px(20, Y + 2, t === 4 ? '#2fd6e0' : '#ffd76a'); G.px(21, Y + 2, t === 4 ? '#2fd6e0' : '#ffd76a');
      }
    }
  }

  // Armes en pixels. (x, y) = main ; atk = arme pointée vers l'avant, sinon levée.
  function drawWeaponPx(G, w, x, y, atk, tier, col) {
    const M = GD.WEAPON_METAL[tier] || GD.WEAPON_METAL[0], Md = shade(M, -0.35), W = tier >= 4 ? '#c99a3a' : tier === 3 ? '#e0c79a' : '#8a5a30', Wd = shade(W, -0.3);
    const gold = tier >= 2 ? P.ui.gold : '#5e3a1f';
    // direction : levée = vers le haut-droite, attaque = vers la droite
    const dx = atk ? 1 : 0.5, dy = atk ? 0 : -1;
    const along = (k, ox, oy, c) => G.px(x + dx * k + (ox || 0), y + dy * k + (oy || 0), c);
    const shaft = (a, b, c) => { for (let k = a; k <= b; k++) along(k, 0, 0, c); };
    const L = 1 + Math.floor(tier / 2);
    switch (w) {
      case 'club': shaft(0, 6, W); along(7, 0, 0, Wd); along(7, 1, 0, W); along(8, 0, 0, W); along(8, 1, 0, Wd); break;
      case 'sword': shaft(-1, 0, Wd); along(1, atk ? 0 : -1, atk ? -1 : 0, gold); along(1, atk ? 0 : 1, atk ? 1 : 0, gold); along(1, 0, 0, gold); for (let k = 2; k <= 9 + L; k++) { along(k, 0, 0, M); along(k, atk ? 0 : 1, atk ? 1 : 0, Md); } break;
      case 'hammer': shaft(-1, 7, W); for (let i = -2; i <= 2; i++) { along(8, atk ? 0 : i, atk ? i : 0, tier ? M : P.ui.gold); along(9, atk ? 0 : i, atk ? i : 0, Md); } break;
      case 'lance': shaft(-3, 11, W); along(12, 0, 0, M); along(13, 0, 0, M); along(14 + L, 0, 0, Md); along(12, atk ? 0 : 1, atk ? 1 : 0, Md); along(4, atk ? 0 : 1, atk ? 1 : 0, col); break;
      case 'staff': shaft(-3, 8, W); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (i * i + j * j < 2) along(10, i, j, tier >= 4 ? '#2fd6e0' : col); along(10, 0, 0, '#ffffff'); if (tier >= 2) { along(9, -1, 0, gold); along(9, 1, 0, gold); } break;
      case 'whip': shaft(0, 2, '#3a2433'); for (let k = 3; k <= 12; k++) G.px(x + k * (atk ? 1 : 0.6), y + (atk ? Math.round(Math.sin(k) * 1.5) : -k * 0.5 + (k > 8 ? (k - 8) : 0)), k % 2 ? W : Wd); break;
      case 'scythe': shaft(-2, 9, tier >= 3 ? '#3a2e3e' : Wd); for (let k = 0; k < 6 + L; k++) G.px(x + dx * 9 - k + (atk ? 0 : 0), y + dy * 9 + Math.floor(k * k / 8) + (atk ? -k * 0.3 : 0), k % 2 ? M : Md); break;
      case 'bow': case 'longbow': {
        const h = (w === 'longbow' ? 9 : 7) + L;
        for (let j = -h; j <= h; j++) { const bx = Math.round(Math.sqrt(Math.max(0, 1 - (j * j) / (h * h))) * 3); G.px(x + 1 + bx, y + j, j % 3 ? W : Wd); }
        G.line(x + 1, y - h, x + 1, y + h, '#f3ead7'); if (atk) G.line(x - 2, y, x + 6, y, '#d8dde3');
        if (tier >= 2) { G.px(x + 1, y - h, gold); G.px(x + 1, y + h, gold); }
        break;
      }
      case 'crossbow': shaft(-2, 5, W); for (let i = -3; i <= 3; i++) G.px(x + dx * 5 + (atk ? -Math.abs(i) * 0.5 : i), y + dy * 5 + (atk ? i : Math.abs(i) * 0.5), tier ? M : '#8d8597'); break;
      case 'daggers': along(0, 0, 0, Wd); for (let k = 1; k <= 4 + L; k++) along(k, 0, 0, k === 1 ? gold : M); break;
      case 'pitchfork': shaft(-3, 9, W); for (let i = -2; i <= 2; i += 2) for (let k = 10; k <= 12 + L; k++) along(k, atk ? 0 : i, atk ? i : 0, tier ? M : '#8d8597'); for (let i = -2; i <= 2; i++) along(10, atk ? 0 : i, atk ? i : 0, tier ? M : '#8d8597'); break;
      case 'axe': shaft(-1, 8, W); for (let k = 6; k <= 9; k++) for (let i = 1; i <= 3 + (k === 7 || k === 8 ? 1 : 0); i++) along(k, atk ? 0 : i, atk ? -i : 0, i > 2 ? M : Md); break;
      case 'pickaxe': shaft(-1, 8, W); for (let i = -4; i <= 4; i++) along(9 - Math.abs(i) * 0.3, atk ? 0 : i, atk ? i : 0, tier ? M : '#8d8597'); break;
      default: shaft(0, 6, W);
    }
    if (tier >= 4) { G.px(x + dx * 6 + 1, y + dy * 6, '#2fd6e0'); }
  }

  const HERO_CACHE = new Map();
  function heroPixelCanvas(o, eq, frame, p) {
    const L = GD.sanitizeLook(o.look);
    const key = o.cls + '|' + Object.values(L).join('.') + '|' + heroGearKey(eq) + '|' + frame + '|' + p + '|' + (o.zombie ? 1 : 0) + '|' + (o.attack > 0.2 ? 1 : 0);
    let c = HERO_CACHE.get(key);
    if (c) return c;
    if (HERO_CACHE.size > 1500) HERO_CACHE.clear();
    const g = buildHeroPixels(o, eq, frame);
    const lo = document.createElement('canvas'); lo.width = HW + 2; lo.height = HH + 2;
    const x = lo.getContext('2d'), img = x.createImageData(HW + 2, HH + 2), D = img.data;
    const at = (i, j) => (i >= 1 && j >= 1 && i <= HW && j <= HH ? g[(j - 1) * HW + (i - 1)] : null);
    for (let j = 0; j < HH + 2; j++) for (let i = 0; i < HW + 2; i++) {
      let col = at(i, j);
      if (!col && (at(i + 1, j) || at(i - 1, j) || at(i, j + 1) || at(i, j - 1))) col = '#120c0a';
      if (!col) continue;
      const n = parseInt(col.slice(1), 16), k = (j * (HW + 2) + i) * 4;
      D[k] = (n >> 16) & 255; D[k + 1] = (n >> 8) & 255; D[k + 2] = n & 255; D[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    c = document.createElement('canvas'); c.width = (HW + 2) * p; c.height = (HH + 2) * p;
    const cx = c.getContext('2d'); cx.imageSmoothingEnabled = false; cx.drawImage(lo, 0, 0, c.width, c.height);
    HERO_CACHE.set(key, c);
    return c;
  }
  // Pieds en (x, y). Ligne des semelles : Y0 + 29 (+1 pour le contour).
  function drawHeroPixel(ctx, x, y, o) {
    const eq = GD.gearFor(o.cls, o.gear);
    const s = o.scale || 1, p = Math.max(1, Math.round(s * 1.45)), t = o.t || 0;
    const moving = o.moving === undefined ? true : o.moving;
    const frame = o.attack > 0.2 ? 3 : moving ? 1 + (Math.floor(t * 7 + (o.seed || 0)) % 2) : 0;
    const c = heroPixelCanvas(o, eq, frame, p);
    const flip = Math.cos(o.facing || 0) < 0 ? -1 : 1;
    const bob = moving && frame === 2 ? -p : 0;
    const mythic = Object.values(eq).some((it) => it && it.r >= 5);
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (o.stealth) ctx.globalAlpha = 0.35;
    shadow(ctx, 0, 1, 7 * p, 2.4 * p);
    if (mythic) { ctx.save(); ctx.globalAlpha *= 0.35 + 0.15 * Math.sin(t * 4); ctx.translate(0, -14 * p); glow(ctx, '#2fd6e0', 12 * p); ctx.restore(); }
    ctx.scale(flip, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, -15 * p, -(Y0 + 31) * p + bob);
    ctx.restore();
  }
  // Portrait (tête et épaules) pour les vignettes de personnalisation
  function heroPortrait(ctx, w, h, o) {
    const eq = GD.gearFor(o.cls, o.gear || {});
    const p = Math.max(1, Math.floor(Math.min(w / 15, h / 17)));
    const c = heroPixelCanvas({ ...o, moving: false }, eq, 0, p);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, 8 * p, (Y0 - 2) * p, 15 * p, 17 * p, Math.round((w - 15 * p) / 2), Math.round((h - 17 * p) / 2), 15 * p, 17 * p);
  }

  function drawHero(ctx, x, y, o) {
    if (RICH) return drawHeroPixel(ctx, x, y, o);
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
    const sleeve = body.tier ? (body.style === 'heavy' ? body.main : shade(body.main, -0.08)) : shade(cape, -0.1);
    const glove = (body.style === 'heavy' && body.tier >= 2) ? body.main : skin;
    // ---- bras arrière (détaillé)
    if (RICH && c.weapon !== 'daggers') {
      const ba = moving ? -step * 0.25 : Math.sin(t * 2 + (o.seed || 0)) * 0.05;
      ctx.save(); ctx.translate(-6, -19); ctx.rotate(0.35 + ba);
      rrect(ctx, -2.6, -1, 5.2, 9, 2.5, shade(sleeve, -0.18), 1.5);
      circle(ctx, 0, 9, 2.7, shade(glove, -0.12), 1.4);
      ctx.restore();
    }
    // ---- torse
    drawTorso(ctx, body, cape, c);
    // ---- tête
    const hy = -29;
    if (RICH) { ctx.fillStyle = 'rgba(29,22,38,.25)'; ctx.beginPath(); ctx.ellipse(0, hy + 8, 6, 2.2, 0, 0, TAU); ctx.fill(); }
    const hatHidesHair = head.tier > 0 && !(head.style === 'leather' && head.tier === 1);
    const hairStyle = (look.hair + (o.seed ? 0 : 0)) % 3;
    circle(ctx, 0, hy, 8.5, skin);
    if (!RICH) { ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.arc(-2.5, hy - 3, 3.5, 0, TAU); ctx.fill(); }
    if (RICH) {
      // oreille
      ellipse(ctx, -4.6, hy + 1.2, 1.8, 2.4, shade(skin, -0.06), 1.1);
      ctx.fillStyle = rgba(shade(skin, -0.35), 0.6); ctx.beginPath(); ctx.arc(-4.5, hy + 1.4, 0.8, 0, TAU); ctx.fill();
    }
    if (!hatHidesHair) {
      if (RICH) {
        // coiffure courte : 0 frange droite, 1 frange en mèches, 2 raie sur le côté
        ctx.beginPath(); ctx.arc(0, hy - 1, 9, Math.PI * 0.98, Math.PI * 2.02);
        if (hairStyle === 1) { ctx.lineTo(8, hy - 3); ctx.lineTo(6.5, hy - 1.5); ctx.lineTo(5, hy - 4); ctx.lineTo(3, hy - 2); ctx.lineTo(1, hy - 4.5); ctx.lineTo(-5, hy + 3); ctx.lineTo(-9, hy + 2); }
        else if (hairStyle === 2) { ctx.lineTo(8, hy - 5); ctx.quadraticCurveTo(2, hy - 8, 0, hy - 3); ctx.lineTo(-5, hy + 3); ctx.lineTo(-9, hy + 2); }
        else { ctx.lineTo(8, hy - 3); ctx.quadraticCurveTo(4, hy - 6, 1, hy - 3); ctx.lineTo(-5, hy + 3); ctx.lineTo(-9, hy + 2); }
        ctx.closePath(); fillStroke(ctx, hair, 1.5, [-9, hy - 10, 9, hy + 2]);
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, hy - 1, 6.5, Math.PI * 1.2, Math.PI * 1.55); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(0, hy - 1, 8.5, Math.PI * 1.05, Math.PI * 1.95); ctx.lineTo(4, hy - 4); ctx.lineTo(-8, hy - 1); ctx.closePath(); fillStroke(ctx, hair, 1.5);
      }
    }
    if (RICH) {
      // visage : yeux avec reflet, sourcils, joues, bouche
      const blink = (t * 0.7 + (o.seed || 0) * 0.13) % 4 < 0.08;
      for (const ex of [2.2, 5.9]) {
        if (blink) { ctx.fillStyle = OL; ctx.fillRect(ex - 1.1, hy + 0.5, 2.3, 0.9); continue; }
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(ex, hy + 0.7, 1.25, 1.75, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = OL; ctx.beginPath(); ctx.ellipse(ex + 0.35, hy + 0.95, 0.9, 1.3, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.fillRect(ex - 0.1, hy + 0.1, 0.7, 0.7);
      }
      ctx.strokeStyle = shade(hair, -0.2); ctx.lineWidth = 0.9; ctx.beginPath();
      ctx.moveTo(1.1, hy - 1.8); ctx.lineTo(3.2, hy - 2.2); ctx.moveTo(4.9, hy - 2.2); ctx.lineTo(7, hy - 1.8); ctx.stroke();
      ctx.fillStyle = 'rgba(236,110,110,.35)'; ctx.beginPath(); ctx.ellipse(0.8, hy + 3.3, 1.4, 0.9, 0, 0, TAU); ctx.ellipse(7.3, hy + 3.3, 1.1, 0.9, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = shade(skin, -0.45); ctx.lineWidth = 0.9; ctx.beginPath();
      if (o.attack > 0.2) { ctx.fillStyle = '#5a2030'; ctx.ellipse(4.2, hy + 4.6, 1.2, 0.9, 0, 0, TAU); ctx.fill(); }
      else { ctx.arc(4.2, hy + 3.4, 1.4, 0.35, Math.PI - 0.35); ctx.stroke(); }
    } else {
      ctx.fillStyle = OL; ctx.fillRect(5.5, hy - 0.8, 1.6, 2.6); ctx.fillRect(2, hy - 0.8, 1.6, 2.6);
    }
    if (o.zombie) { ctx.fillStyle = '#5c7a3d'; ctx.fillRect(-4, hy + 2, 3, 2); }
    drawHeadgear(ctx, head, hy, cape, t);
    // ---- bras avant + main + arme
    if (RICH) {
      ctx.save(); ctx.translate(4, -19);
      const ang = Math.atan2(5, 4);
      ctx.rotate(ang - Math.PI / 2);
      rrect(ctx, -2.6, -1, 5.2, 7.5, 2.5, sleeve, 1.5);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(8, -14);
    drawWeapon(ctx, c.weapon, c.color, swing, wTier);
    circle(ctx, 0, 0, 3, glove, 1.5);
    ctx.restore();
    if (c.weapon === 'daggers') { ctx.save(); ctx.translate(-8, -13); ctx.scale(-1, 1); drawWeapon(ctx, 'daggers', c.color, 1 - swing, wTier); ctx.restore(); }
    ctx.restore();
    ctx.restore();
  }
  const A_shade = (h, k) => shade(h, k);

  function drawFoot(ctx, lx, fy, feet, skin) {
    const st = feet.style, t = feet.tier;
    if (!t) { rrect(ctx, lx - 0.5, fy, 6.5, 3, 1.5, '#3c2a1e', 1.2); if (RICH) { ctx.fillStyle = '#7a5a40'; ctx.fillRect(lx + 0.5, fy + 0.4, 3, 0.9); } return; }
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
    if (st !== 'cloth' || !t) {
      ctx.fillStyle = OL; ctx.fillRect(-8, -9.5, 16, 2.5);
      if (RICH) { ctx.fillStyle = '#7a5532'; ctx.fillRect(-7.5, -9, 15, 1.5); rrect(ctx, 2.5, -10.3, 4, 3.6, 0.8, P.ui.gold, 1); }
    }
    if (RICH) {
      // col et plis
      ctx.strokeStyle = 'rgba(29,22,38,.35)'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(-3, -21); ctx.lineTo(0, -18); ctx.lineTo(3, -21); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-5, -12); ctx.lineTo(-4, -16); ctx.stroke();
    }
    circle(ctx, 1, -15, 3, c.color, 1.5);
    if (RICH) { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(0, -16.5, 1.2, 1.2); }
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
        // heaume ouvert : le visage reste visible
        ctx.beginPath(); ctx.arc(0, hy - 1, 10.5, Math.PI, TAU); ctx.lineTo(10.5, hy + 1); ctx.lineTo(1, hy + 1); ctx.lineTo(-3, hy + 7); ctx.lineTo(-10.5, hy + 7); ctx.closePath(); fillStroke(ctx, M, 1.8);
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

  /* Lueur ronde (cœur clair + halo) — utilisée par les bâtiments et les effets */
  function glowDot(ctx, x, y, r, col, k) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * (k || 3));
    g.addColorStop(0, rgba(col, 0.75)); g.addColorStop(0.35, rgba(col, 0.25)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * (k || 3), 0, TAU); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.25, r * 0.45, 0, TAU); ctx.fill();
  }  function glowEye(ctx, x, y, r, col) { glowDot(ctx, x, y, r, col, 2.3); }

  // hauteur visuelle d'un monstre (en tailles) pour placer la barre de vie et la couronne de boss
  function mobTop(type) { const d = GD.MOBS[type]; if (!d || !RICH) return 2.2; const ps = pixelSprite(type); return ps ? ps.sp.h + (ps.sp.float ? 0.2 : 0) : 2.2; }

  /* ------------------------------ monstres en pixel art ------------------------------
   * Données dans sprites.js (générées par tools/pixelart). Chaque sprite est agrandi d'un facteur
   * entier (pixels nets), avec un contour sombre automatique, puis mis en cache. */
  // identifiant du monstre -> sprite[:variante de palette]
  const PX_MAP = {
    gobelin: 'goblin', gobelin_archer: 'goblin_archer', loup: 'wolf', loup_neige: 'wolf:snow', loup_alpha: 'wolf:alpha', ally_wolf: 'wolf:ally',
    sanglier: 'boar', sanglier_geant: 'boar:giant', ally_bear: 'bear', golem_glace: 'golem', golem_ancien: 'golem:ancient', golem_obsidienne: 'golem:obsidian',
    yeti: 'yeti', esprit_givre: 'ghost', sorciere_givre: 'witch', liche_putride: 'lich', phenix_noir: 'phoenix', treant: 'treant', treant_colossal: 'treant:colossal',
    rampant: 'crawler', crapaud: 'toad', crapaud_roi: 'toad:king', champignon: 'shroom', champignon_titan: 'shroom:titan', mutant: 'zombie', abomination: 'zombie:abomination',
    araignee: 'spider', araignee_reine: 'spider:queen', diablotin: 'imp', seigneur_diablotin: 'imp:lord', salamandre: 'salamander', salamandre_ancienne: 'salamander:ancient',
    chien_infernal: 'hound', cerbere: 'cerberus', elementaire: 'elemental', geant_magma: 'elemental:magma', mere_spore: 'mother', ally_skeleton: 'skeleton'
  };
  const PX_CACHE = new Map();
  function pixelSprite(type) {
    const S = window.PixelSprites || {};
    const [k, v] = (PX_MAP[type] || type).split(':');
    const sp = S[k];
    if (!sp) return null;
    return { key: k + (v ? ':' + v : ''), sp, pal: v && sp.variants && sp.variants[v] ? { ...sp.pal, ...sp.variants[v] } : sp.pal };
  }
  function pixelCanvas(key, sp, pal, fi, p) {
    const ck = key + '|' + fi + '|' + p;
    let c = PX_CACHE.get(ck);
    if (c) return c;
    if (PX_CACHE.size > 1500) PX_CACHE.clear();
    const rows = sp.frames[fi], H = rows.length, W = Math.max(...rows.map((r) => r.length));
    const lo = document.createElement('canvas'); lo.width = W + 2; lo.height = H + 2;
    const x = lo.getContext('2d'), img = x.createImageData(W + 2, H + 2), D = img.data;
    const solid = (i, j) => { const r = rows[j - 1]; if (!r) return false; const ch = r[i - 1]; return ch !== undefined && ch !== ' ' && ch !== '.'; };
    const set = (i, j, hex) => { const n = parseInt(hex.slice(1), 16), o = (j * (W + 2) + i) * 4; D[o] = (n >> 16) & 255; D[o + 1] = (n >> 8) & 255; D[o + 2] = n & 255; D[o + 3] = 255; };
    for (let j = 0; j < H + 2; j++) for (let i = 0; i < W + 2; i++) {
      if (solid(i, j)) set(i, j, pal[rows[j - 1][i - 1]] || '#ff00ff');
      else if (solid(i + 1, j) || solid(i - 1, j) || solid(i, j + 1) || solid(i, j - 1)) set(i, j, '#120c0a');
    }
    x.putImageData(img, 0, 0);
    c = document.createElement('canvas'); c.width = (W + 2) * p; c.height = (H + 2) * p;
    const cx = c.getContext('2d'); cx.imageSmoothingEnabled = false; cx.drawImage(lo, 0, 0, c.width, c.height);
    c.p = p;
    PX_CACHE.set(ck, c);
    return c;
  }
  function drawPixelMob(ctx, ps, s, t, a) {
    const sp = ps.sp, rows = sp.frames[0].length;
    const p = Math.max(2, Math.round(s * sp.h / rows));
    const fi = a > 0.3 && sp.atk !== undefined ? sp.atk : sp.walk[Math.floor(t * 6) % sp.walk.length];
    const c = pixelCanvas(ps.key, sp, ps.pal, fi, p);
    const fy = sp.float ? Math.round(Math.sin(t * 2.5) * 2) * p - 3 * p : 0;
    ctx.drawImage(c, -Math.round(c.width / 2), -c.height + p + fy);
  }

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
    const ps = RICH && pixelSprite(type);
    if (ps) drawPixelMob(ctx, ps, s, t + (o.seed || 0), o.attack || 0);
    else (MOB_SHAPES[d.shape] || MOB_SHAPES.goblin)(ctx, d.color, s, t + (o.seed || 0), o.attack || 0, d);
    if (o.frozen) { ctx.globalAlpha = 0.45; rrect(ctx, -s, -s * 2, s * 2, s * 2, 4, P.fx.frost, 1); }
    ctx.restore();
    if (o.boss) drawCrown(ctx, x, y - s * (RICH ? mobTop(type) + 0.15 : d.shape === 'treant' ? 2.9 : d.shape === 'mother' ? 1.9 : 2.2), Math.max(8, s * 0.3));
  }

  function drawCrown(ctx, x, y, r) {
    poly(ctx, [x - r, y, x - r, y - r * 0.9, x - r * 0.5, y - r * 0.4, x, y - r * 1.1, x + r * 0.5, y - r * 0.4, x + r, y - r * 0.9, x + r, y], P.ui.gold, 1.6);
  }

  /* ------------------------------ tour ------------------------------ */
  const TOWER_CACHE = new Map();
  function drawTower(ctx, x, y, o) {
    if (!RICH) return drawTowerRaw(ctx, x, y, o);
    const t = o.t || 0, hp = o.hp === undefined ? 1 : o.hp;
    const TP = TAU / 2, TN = 12, f = Math.floor(((t % TP) + TP) % TP / TP * TN);
    const sc = o.scale || 1;
    const key = JSON.stringify(o.up || {}) + '|' + (hp < 0.33 ? 2 : hp < 0.66 ? 1 : 0) + '|' + f + '|' + sc;
    let c = TOWER_CACHE.get(key);
    if (!c) {
      if (TOWER_CACHE.size > 120) TOWER_CACHE.clear();
      c = document.createElement('canvas'); c.width = Math.ceil(300 * sc); c.height = Math.ceil(330 * sc);
      const x2 = c.getContext('2d'); x2.scale(sc, sc);
      drawTowerRaw(x2, 150, 270, { ...o, t: (f + 0.5) / TN * TP });
      TOWER_CACHE.set(key, c);
    }
    ctx.drawImage(c, Math.round(x - 150 * sc), Math.round(y - 270 * sc));
  }
  function drawTowerRaw(ctx, x, y, o) {
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
    if (RICH) {
      // appareillage : chaque pierre a sa teinte, joints sombres, arêtes claires, mousse au pied
      ctx.save();
      ctx.beginPath(); ctx.moveTo(-58, 20); ctx.lineTo(-48, -110); ctx.lineTo(48, -110); ctx.lineTo(58, 20); ctx.quadraticCurveTo(0, 40, -58, 20); ctx.closePath(); ctx.clip();
      for (let row = 0; row < 9; row++) {
        const yy = 22 - row * 15;
        for (let i = -5; i <= 4; i++) {
          const bx = i * 14 + (row % 2) * 7, k = T.hash2(i + 9, row, 77);
          ctx.fillStyle = shade(S[0], (k - 0.5) * 0.22);
          ctx.fillRect(bx + 1, yy - 14, 12, 13);
          ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(bx + 1, yy - 14, 12, 2);
          ctx.fillStyle = 'rgba(29,22,38,.22)'; ctx.fillRect(bx + 1, yy - 3, 12, 2);
        }
      }
      // éclairage de volume : bord gauche éclairé, droit dans l'ombre
      const lg = ctx.createLinearGradient(-58, 0, 58, 0);
      lg.addColorStop(0, 'rgba(255,240,210,.22)'); lg.addColorStop(0.35, 'rgba(255,240,210,0)'); lg.addColorStop(0.65, 'rgba(29,22,38,0)'); lg.addColorStop(1, 'rgba(29,22,38,.38)');
      ctx.fillStyle = lg; ctx.fillRect(-60, -112, 120, 150);
      // mousse et lierre
      ctx.fillStyle = '#4f8f3a';
      for (let i = 0; i < 9; i++) { const mx = -54 + i * 13, my = 18 - T.hash2(i, 3, 5) * 10; ctx.beginPath(); ctx.ellipse(mx, my, 7, 4, 0, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = '#3f7f2a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-44, 14); ctx.quadraticCurveTo(-52, -20, -40, -48); ctx.quadraticCurveTo(-34, -64, -42, -78); ctx.stroke();
      ctx.fillStyle = '#5cb84a';
      for (const [lx, ly] of [[-48, -6], [-44, -30], [-41, -52], [-38, -66], [-46, -20]]) { ctx.beginPath(); ctx.ellipse(lx, ly, 3.5, 2.2, 0.6, 0, TAU); ctx.fill(); }
      ctx.restore();
      // soubassement
      for (let i = -4; i <= 4; i++) rrect(ctx, i * 14 - 7, 18 + Math.abs(i) * -0.6, 14, 9, 3, shade(S[1], T.hash2(i, 1, 9) * 0.1 - 0.05), 1.6);
    } else {
      ctx.fillStyle = rgba(OL, 0.22);
      for (let row = 0; row < 7; row++) {
        const yy = 10 - row * 17, w = 56 - row * 1.4;
        ctx.fillRect(-w, yy, w * 2, 1.6);
        for (let i = -3; i <= 3; i++) ctx.fillRect(i * 16 + (row % 2) * 8, yy - 16, 1.6, 16);
      }
    }
    // ombre latérale
    ctx.beginPath(); ctx.moveTo(20, -110); ctx.lineTo(48, -110); ctx.lineTo(58, 20); ctx.quadraticCurveTo(40, 28, 24, 30); ctx.closePath(); ctx.fillStyle = rgba(OL, 0.18); ctx.fill();
    // porte
    if (RICH) {
      // arche de pierre, planches, ferrures et clous
      ctx.beginPath(); ctx.moveTo(-18, 30); ctx.lineTo(-18, 6); ctx.arc(0, 6, 18, Math.PI, TAU); ctx.lineTo(18, 30); ctx.closePath(); fillStroke(ctx, S[1], 2.5, [-18, -12, 18, 30]);
      ctx.beginPath(); ctx.moveTo(-13, 30); ctx.lineTo(-13, 6); ctx.arc(0, 6, 13, Math.PI, TAU); ctx.lineTo(13, 30); ctx.closePath(); fillStroke(ctx, P.wood[1], 2.2, [-13, -7, 13, 30]);
      ctx.strokeStyle = rgba(OL, 0.45); ctx.lineWidth = 1.2;
      for (const px of [-6.5, 0, 6.5]) { ctx.beginPath(); ctx.moveTo(px, -6); ctx.lineTo(px, 30); ctx.stroke(); }
      ctx.fillStyle = '#3c3546'; ctx.fillRect(-13, 4, 26, 3); ctx.fillRect(-13, 20, 26, 3);
      ctx.fillStyle = '#c9c2d3'; for (const px of [-10, -3, 4, 10]) { ctx.fillRect(px, 4.8, 1.5, 1.5); ctx.fillRect(px, 20.8, 1.5, 1.5); }
      circle(ctx, 8, 13, 2, P.ui.gold, 1);
    } else {
      ctx.beginPath(); ctx.moveTo(-14, 30); ctx.lineTo(-14, 6); ctx.arc(0, 6, 14, Math.PI, TAU); ctx.lineTo(14, 30); ctx.closePath(); fillStroke(ctx, P.wood[2], 2.5);
    }
    // fenêtre lumineuse
    if (RICH) {
      ctx.save(); ctx.translate(0, -62); ctx.globalAlpha = 0.6 + 0.15 * Math.sin(t * 3); glow(ctx, '#ffd76a', 12); ctx.restore();
      ctx.beginPath(); ctx.moveTo(-9, -54); ctx.lineTo(-9, -66); ctx.arc(0, -66, 9, Math.PI, TAU); ctx.lineTo(9, -54); ctx.closePath(); fillStroke(ctx, S[2], 2);
    }
    ctx.beginPath(); ctx.moveTo(-6, -56); ctx.lineTo(-6, -66); ctx.arc(0, -66, 6, Math.PI, TAU); ctx.lineTo(6, -56); ctx.closePath(); fillStroke(ctx, '#ffd76a', 2);
    if (RICH) {
      ctx.strokeStyle = OL; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(0, -72); ctx.lineTo(0, -56); ctx.moveTo(-6, -63); ctx.lineTo(6, -63); ctx.stroke();
      // bannières suspendues
      for (const bx of [-34, 34]) {
        const wv = Math.sin(t * 2.5 + bx) * 1.5;
        rrect(ctx, bx - 8, -102, 16, 3, 1, P.wood[2], 1.2);
        poly(ctx, [bx - 7, -100, bx + 7, -100, bx + 7 + wv * 0.3, -70, bx + wv, -76, bx - 7 + wv * 0.3, -70], up.banner > 0 ? P.ui.gold : '#b5413a', 1.6);
        poly(ctx, [bx, -94, bx + 4, -88, bx, -82, bx - 4, -88], up.banner > 0 ? '#b5413a' : P.ui.gold, 1.1);
      }
      // torches de part et d'autre de la porte
      for (const tx of [-28, 28]) {
        rrect(ctx, tx - 2, -2, 4, 12, 1, P.wood[2], 1.3);
        rrect(ctx, tx - 4, -5, 8, 4, 1, '#3c3546', 1.2);
        const fh = 9 + Math.sin(t * 14 + tx) * 2;
        ctx.save(); ctx.translate(tx, -9); glow(ctx, '#ffb02e', 9); ctx.restore();
        poly(ctx, [tx - 4, -5, tx, -5 - fh, tx + 4, -5], '#ff7a1a', 1.2);
        poly(ctx, [tx - 2, -5, tx, -5 - fh * 0.6, tx + 2, -5], '#ffd76a', 0.01);
      }
    }
    // créneaux
    rrect(ctx, -60, -126, 120, 20, 3, S[1], 3);
    if (RICH) { ctx.fillStyle = rgba(OL, 0.3); for (let i = -4; i <= 4; i++) ctx.fillRect(i * 13, -124, 1.5, 16); ctx.fillStyle = 'rgba(29,22,38,.35)'; ctx.fillRect(-58, -109, 116, 3); for (let i = -4; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * 13 - 4, -106); ctx.lineTo(i * 13, -101); ctx.lineTo(i * 13 + 4, -106); ctx.fill(); } }
    for (let i = -2; i <= 2; i++) rrect(ctx, i * 24 - 8, -140, 16, 16, 2, S[1], 2.5);
    // baliste
    if (up.ballista > 0) {
      rrect(ctx, -20, -152, 40, 10, 3, P.wood[1]);
      line(ctx, -26, -150, 26, -150, P.wood[0], 3);
      line(ctx, 0, -158, 0, -142, S[3], 2);
    }
    // toit (seulement dans l'ancien rendu ; en rendu détaillé la tour est couronnée de ses créneaux)
    if (!RICH) poly(ctx, [-34, -138, 0, -205, 34, -138], '#7a2e3a', 3);
    // drapeau (au sommet du toit, ou planté sur les créneaux en rendu détaillé)
    const fb = RICH ? -140 : -205;
    line(ctx, 0, fb, 0, fb - 27, P.wood[2], 2);
    const wave = Math.sin(t * 4) * 3;
    poly(ctx, [0, fb - 27, 22, fb - 23 + wave, 0, fb - 15], up.banner > 0 ? P.ui.gold : P.capes[0], 1.6);
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

  /* ------------------------------ bâtiments redessinés (mode détaillé) ------------------------------
   * Vue 3/4 : façade face à l'écran, mur latéral droit en perspective (fuyante vers le haut à droite). */
  const SK = 0.5; // pente de la perspective
  function quad(ctx, pts, fill, lw) { poly(ctx, pts, fill, lw === undefined ? 2 : lw); }
  // dessine sur le plan du mur latéral (u le long du mur, v vertical) d'une boîte dont l'arête avant droite est en x
  function onSide(ctx, x, fn) { ctx.save(); ctx.transform(1, -SK, 0, 1, x, 0); fn(); ctx.restore(); }
  // lignes de tuiles sur un pan de toit (ridge -> eave, extrudé de (dx, dy))
  function shingles(ctx, a, b, dx, dy, col, n) {
    ctx.save();
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] + dx, a[1] + dy); ctx.lineTo(b[0] + dx, b[1] + dy); ctx.lineTo(b[0], b[1]); ctx.closePath(); ctx.clip();
    ctx.strokeStyle = rgba(shade(col, -0.55), 0.6); ctx.lineWidth = 1.3;
    for (let i = 1; i <= n; i++) {
      const k = i / (n + 0.5), px = a[0] + (b[0] - a[0]) * k, py = a[1] + (b[1] - a[1]) * k;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + dx, py + dy); ctx.stroke();
      // découpe des tuiles
      const m = Math.max(3, Math.round(Math.hypot(dx, dy) / 6));
      for (let j = 0; j < m; j++) { const q = (j + (i % 2) * 0.5) / m; ctx.beginPath(); ctx.moveTo(px + dx * q, py + dy * q); ctx.lineTo(px + dx * q + (b[0] - a[0]) / (n + 0.5), py + dy * q + (b[1] - a[1]) / (n + 0.5)); ctx.stroke(); }
    }
    ctx.restore();
  }
  /**
   * Maison à pignon : façade [x0, x0+w] x [-h, 0], profondeur d, toit de hauteur rh.
   * Renvoie des repères pour décorer.
   */
  function gableHouse(ctx, o) {
    const { x0, w, h, d } = o, rh = o.rh, ov = o.ov === undefined ? 4 : o.ov;
    const dx = d, dy = -d * SK, x1 = x0 + w, xm = x0 + w / 2;
    // mur latéral
    quad(ctx, [x1, 0, x1 + dx, dy, x1 + dx, -h + dy, x1, -h], shade(o.wall, -0.22));
    if (o.sideFn) onSide(ctx, x1, o.sideFn);
    // façade
    quad(ctx, [x0, 0, x1, 0, x1, -h, x0, -h], o.wall);
    if (o.frontFn) { ctx.save(); ctx.beginPath(); ctx.rect(x0, -h, w, h); ctx.clip(); o.frontFn(); ctx.restore(); }
    // pan gauche (visible au-dessus du pignon), pignon, pan droit
    quad(ctx, [x0 - ov, -h + ov * 0.5, xm, -h - rh, xm + dx, -h - rh + dy, x0 - ov + dx, -h + ov * 0.5 + dy], shade(o.roof, 0.12));
    quad(ctx, [x0, -h, xm, -h - rh, x1, -h], o.gable || o.wall);
    if (o.gableFn) o.gableFn(xm, -h - rh);
    const ra = [xm, -h - rh], rb = [x1 + ov, -h + ov * 0.5];
    quad(ctx, [ra[0], ra[1], ra[0] + dx, ra[1] + dy, rb[0] + dx, rb[1] + dy, rb[0], rb[1]], o.roof);
    if (o.tiles !== false) shingles(ctx, ra, rb, dx, dy, o.roof, o.rows || 4);
    // bordures du pignon
    line(ctx, x0 - ov, -h + ov * 0.5, xm, -h - rh, shade(o.roof, -0.25), 2.5);
    line(ctx, xm, -h - rh, x1 + ov, -h + ov * 0.5, shade(o.roof, -0.25), 2.5);
    return { x0, x1, xm, h, dx, dy, top: -h - rh };
  }
  // boîte à toit plat (caserne, plate-forme)
  function box(ctx, x0, w, h, d, col, y) {
    y = y || 0;
    const dx = d, dy = -d * SK, x1 = x0 + w;
    quad(ctx, [x1, y, x1 + dx, y + dy, x1 + dx, y - h + dy, x1, y - h], shade(col, -0.22));
    quad(ctx, [x0, y - h, x1, y - h, x1 + dx, y - h + dy, x0 + dx, y - h + dy], shade(col, 0.15));
    quad(ctx, [x0, y, x1, y, x1, y - h, x0, y - h], col);
  }
  function door(ctx, x, w, h, col, arch) {
    ctx.beginPath();
    if (arch) { ctx.moveTo(x, 0); ctx.lineTo(x, -h + w / 2); ctx.arc(x + w / 2, -h + w / 2, w / 2, Math.PI, TAU); ctx.lineTo(x + w, 0); }
    else { ctx.rect(x, -h, w, h); }
    ctx.closePath(); fillStroke(ctx, col, 2, [x, -h, x + w, 0]);
    ctx.strokeStyle = rgba(OL, 0.4); ctx.lineWidth = 1;
    for (let i = x + w / 3; i < x + w - 1; i += w / 3) { ctx.beginPath(); ctx.moveTo(i, -h + (arch ? w * 0.2 : 0)); ctx.lineTo(i, 0); ctx.stroke(); }
    circle(ctx, x + w * 0.78, -h * 0.45, 1.4, P.ui.gold, 0.8);
  }
  function win(ctx, x, y, w, h, t, lit) {
    if (lit !== false) { ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.globalAlpha = 0.4 + 0.1 * Math.sin(t * 3 + x); glow(ctx, '#ffcf5a', Math.max(w, h) * 0.9); ctx.restore(); }
    rrect(ctx, x - 1.5, y - 1.5, w + 3, h + 3, 1, P.wood[2], 1.4);
    rrect(ctx, x, y, w, h, 1, lit === false ? '#2b2433' : '#ffd76a', 1);
    ctx.strokeStyle = P.wood[2]; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
  }
  function logEnds(ctx, pts, r) { for (const [x, y] of pts) { circle(ctx, x, y, r, '#c99a5b', 1.3); ctx.strokeStyle = rgba('#7a5532', 0.8); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, TAU); ctx.stroke(); } }
  function hay(ctx, x, y) { rrect(ctx, x - 8, y - 9, 16, 9, 3, '#e2c56a', 1.5); ctx.strokeStyle = 'rgba(150,110,40,.6)'; ctx.lineWidth = 1; for (let i = -5; i <= 5; i += 3) { ctx.beginPath(); ctx.moveTo(x + i, y - 8); ctx.lineTo(x + i + 1, y - 1); ctx.stroke(); } ctx.fillStyle = '#a0522d'; ctx.fillRect(x - 8, y - 6, 16, 1.4); }
  function fence(ctx, x0, x1, y) { for (let x = x0; x <= x1; x += 8) line(ctx, x, y, x, y - 9, P.wood[1], 2); line(ctx, x0, y - 6, x1, y - 6, P.wood[0], 1.6); line(ctx, x0, y - 2.5, x1, y - 2.5, P.wood[0], 1.6); }
  function banner(ctx, x, y, col, t) {
    line(ctx, x, y, x, y - 30, P.wood[2], 1.8);
    const wv = Math.sin(t * 4 + x) * 2;
    poly(ctx, [x, y - 30, x + 15, y - 27 + wv, x + 13, y - 22 + wv * 0.6, x + 15, y - 17 + wv, x, y - 19], col, 1.3);
  }

  const BLD_CACHE = new Map();
  function drawBuildingRich(ctx, family, t, o) {
    const W = P.wood, S = P.stone, col = o.color || P.ui.gold;
    switch (family) {
      case 'paysan': { // ferme : grange + silo
        // silo derrière à droite
        const sx = 24;
        rrect(ctx, sx, -62, 18, 56, 3, '#c9c2b2', 2);
        ctx.save(); ctx.beginPath(); ctx.rect(sx, -62, 18, 56); ctx.clip();
        const g = ctx.createLinearGradient(sx, 0, sx + 18, 0); g.addColorStop(0, 'rgba(255,255,255,.3)'); g.addColorStop(1, 'rgba(29,22,38,.3)'); ctx.fillStyle = g; ctx.fillRect(sx, -62, 18, 56);
        ctx.strokeStyle = 'rgba(29,22,38,.3)'; ctx.lineWidth = 1; for (let y = -54; y < -6; y += 8) { ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx + 18, y); ctx.stroke(); }
        ctx.restore();
        ctx.beginPath(); ctx.moveTo(sx, -62); ctx.arc(sx + 9, -62, 9, Math.PI, TAU); ctx.closePath(); fillStroke(ctx, '#8a3a32', 2, [sx, -71, sx + 18, -62]);
        banner(ctx, sx + 9, -71, col, t);
        gableHouse(ctx, {
          x0: -38, w: 44, h: 30, d: 18, rh: 22, wall: '#b5413a', roof: '#6b3b33', rows: 4,
          frontFn: () => {
            ctx.strokeStyle = 'rgba(29,22,38,.28)'; ctx.lineWidth = 1.1; for (let x = -34; x < 6; x += 5) { ctx.beginPath(); ctx.moveTo(x, -30); ctx.lineTo(x, 0); ctx.stroke(); }
            rrect(ctx, -26, -22, 20, 22, 1, '#8a2f2a', 2);
            ctx.strokeStyle = '#f3ead7'; ctx.lineWidth = 2.2; ctx.strokeRect(-26, -22, 20, 22);
            ctx.beginPath(); ctx.moveTo(-26, -22); ctx.lineTo(-6, 0); ctx.moveTo(-6, -22); ctx.lineTo(-26, 0); ctx.moveTo(-16, -22); ctx.lineTo(-16, 0); ctx.stroke();
          },
          gableFn: (xm, top) => { rrect(ctx, xm - 5, top + 9, 10, 9, 1, '#3a2418', 1.5); ctx.strokeStyle = '#f3ead7'; ctx.lineWidth = 1.6; ctx.strokeRect(xm - 5, top + 9, 10, 9); ctx.fillStyle = '#e2c56a'; ctx.fillRect(xm - 4, top + 14, 8, 3); },
          sideFn: () => { ctx.strokeStyle = 'rgba(29,22,38,.3)'; ctx.lineWidth = 1; for (let u = 4; u < 18; u += 5) { ctx.beginPath(); ctx.moveTo(u, 0); ctx.lineTo(u, -30); ctx.stroke(); } }
        });
        hay(ctx, 14, 6); hay(ctx, 22, 2); fence(ctx, -46, -40, 8);
        circle(ctx, -42, 2, 4, '#ff8a1a', 1.3); ctx.fillStyle = '#3f7f2a'; ctx.fillRect(-42.5, -3.5, 1.5, 2.5);
        break;
      }
      case 'mine': { // mine : colline rocheuse facettée
        quad(ctx, [-44, 6, -40, -18, -26, -40, -6, -48, 16, -46, 34, -32, 46, -10, 48, 6], S[2]);
        quad(ctx, [-40, -18, -26, -40, -6, -48, -12, -26, -30, -12], S[1], 1.5);
        quad(ctx, [-6, -48, 16, -46, 34, -32, 14, -26, -2, -28], shade(S[1], 0.1), 1.5);
        quad(ctx, [34, -32, 46, -10, 48, 6, 26, 6, 22, -14], shade(S[2], -0.12), 1.5);
        ctx.fillStyle = '#4f8f3a'; for (const [mx, my, r] of [[-20, -38, 8], [8, -47, 9], [36, -28, 6]]) { ctx.beginPath(); ctx.ellipse(mx, my, r, r * 0.4, -0.2, 0, TAU); ctx.fill(); }
        for (const [gx, gy, gc] of [[-30, -22, '#6ec6ff'], [-34, -16, '#6ec6ff'], [30, -14, '#c58cff'], [24, -36, '#f2c14e']]) { poly(ctx, [gx, gy - 6, gx + 3, gy, gx, gy + 2, gx - 3, gy], gc, 1); ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(gx - 1, gy - 4, 1.2, 2); }
        // entrée étayée
        ctx.beginPath(); ctx.moveTo(-14, 6); ctx.lineTo(-14, -18); ctx.lineTo(14, -18); ctx.lineTo(14, 6); ctx.closePath();
        const tg = ctx.createLinearGradient(0, -18, 0, 6); tg.addColorStop(0, '#05030a'); tg.addColorStop(1, '#2b2233'); ctx.fillStyle = tg; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = OL; ctx.stroke();
        line(ctx, -15, 6, -13, -20, W[1], 4); line(ctx, 15, 6, 13, -20, W[1], 4); line(ctx, -19, -21, 19, -21, W[0], 4.5);
        line(ctx, -13, -14, -6, -20, W[2], 2); line(ctx, 13, -14, 6, -20, W[2], 2);
        rrect(ctx, -7, -31, 14, 7, 1.5, W[0], 1.4); ctx.fillStyle = OL; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('⚒', 0, -25.5);
        ctx.save(); ctx.translate(16, -16); glow(ctx, '#ffb02e', 8 + Math.sin(t * 9) * 0.8); ctx.restore();
        line(ctx, 16, -20, 16, -24, '#3c3546', 1); rrect(ctx, 13.5, -19, 5, 6, 1.5, '#ffd76a', 1.1);
        // rails et wagonnet
        for (let i = 0; i < 6; i++) rrect(ctx, -10 + i * 8, 4 - i * 0.2, 3, 5, 0.8, W[2], 0.9);
        line(ctx, -12, 5, 40, 3.5, '#8d8597', 1.2); line(ctx, -12, 8.5, 40, 7, '#8d8597', 1.2);
        quad(ctx, [24, -8, 42, -8, 40, 2, 26, 2], '#5a5560', 1.6);
        poly(ctx, [25, -8, 29, -14, 33, -10, 37, -15, 41, -8], '#f2c14e', 1.1); ctx.fillStyle = '#9a8a6a'; ctx.fillRect(28, -11, 3, 2);
        circle(ctx, 28, 3, 2.6, '#3c3546', 1); circle(ctx, 38, 3, 2.6, '#3c3546', 1);
        line(ctx, -34, 4, -28, -10, W[1], 1.8); poly(ctx, [-33, -12, -25, -10, -27, -7], '#9aa0a8', 1);
        banner(ctx, -40, -18, col, t);
        break;
      }
      case 'scierie': { // scierie : cabane en rondins + appentis de sciage
        // appentis à droite (derrière)
        quad(ctx, [14, 6, 44, 6, 44, -18, 14, -18], shade(W[1], -0.3), 1.6);
        quad(ctx, [10, -18, 50, -18, 46, -28, 14, -30], W[2], 2);
        for (const px of [16, 42]) line(ctx, px, 6, px, -18, W[1], 2.5);
        rrect(ctx, 18, -6, 22, 5, 1, W[0], 1.4);
        ctx.save(); ctx.translate(29, -6); ctx.rotate(t * 6);
        circle(ctx, 0, 0, 7, '#d8dde3', 1.4); ctx.fillStyle = OL; for (let i = 0; i < 10; i++) { ctx.rotate(TAU / 10); ctx.fillRect(6.5, -1, 2.5, 2); }
        ctx.restore(); circle(ctx, 29, -6, 1.8, S[2], 0.8);
        ctx.fillStyle = '#e8c88a'; ctx.beginPath(); ctx.ellipse(32, 4, 9, 2.2, 0, 0, TAU); ctx.fill();
        gableHouse(ctx, {
          x0: -40, w: 40, h: 28, d: 14, rh: 18, wall: '#9a6a3c', roof: '#5a3a22', rows: 3,
          frontFn: () => { ctx.strokeStyle = 'rgba(29,22,38,.4)'; ctx.lineWidth = 1.3; for (let y = -24; y < 0; y += 5) { ctx.beginPath(); ctx.moveTo(-40, y); ctx.lineTo(0, y); ctx.stroke(); } },
          sideFn: () => { ctx.strokeStyle = 'rgba(29,22,38,.4)'; ctx.lineWidth = 1.2; for (let y = -24; y < 0; y += 5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(14, y); ctx.stroke(); } }
        });
        logEnds(ctx, [[-41, -24], [-41, -19], [-41, -14], [-41, -9], [-41, -4]], 2.4);
        door(ctx, -32, 11, 19, W[2]);
        win(ctx, -15, -20, 9, 8, t);
        // pile de grumes
        logEnds(ctx, [[-50, 2], [-44, 2], [-47, -4]], 3.6);
        ctx.save(); ctx.translate(-12, 4); ctx.rotate(-0.4); line(ctx, 0, 0, 0, -12, W[0], 2); ctx.restore(); poly(ctx, [-15, -8, -8, -11, -9, -6], '#9aa0a8', 1);
        banner(ctx, -40, -28, col, t);
        break;
      }
      case 'habitant': { // chaumière à colombages
        rrect(ctx, 6, -60, 9, 18, 1.5, S[1], 1.8);
        for (let i = 0; i < 3; i++) { ctx.save(); ctx.globalAlpha = 0.35 - i * 0.1; circle(ctx, 10 + Math.sin(t + i) * 3, -68 - i * 9 - ((t * 8) % 9), 4 + i * 2, '#e8e2f0', 0.01); ctx.restore(); }
        gableHouse(ctx, {
          x0: -32, w: 40, h: 26, d: 16, rh: 24, ov: 7, wall: '#efe3c8', roof: '#d9b85a', rows: 5,
          frontFn: () => {
            ctx.strokeStyle = '#5a3a22'; ctx.lineWidth = 2.4;
            ctx.beginPath(); ctx.moveTo(-32, -14); ctx.lineTo(8, -14); ctx.moveTo(-22, -26); ctx.lineTo(-22, 0); ctx.moveTo(-2, -26); ctx.lineTo(-2, 0); ctx.moveTo(-32, -26); ctx.lineTo(-22, -14); ctx.moveTo(8, -26); ctx.lineTo(-2, -14); ctx.stroke();
          },
          gableFn: (xm, top) => { ctx.strokeStyle = '#5a3a22'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xm, top + 4); ctx.lineTo(xm, top + 24); ctx.stroke(); win(ctx, xm - 4, top + 12, 8, 7, t); },
          sideFn: () => { ctx.strokeStyle = '#5a3a22'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(16, -14); ctx.moveTo(8, 0); ctx.lineTo(8, -26); ctx.stroke(); }
        });
        door(ctx, -17, 10, 15, W[1], true);
        win(ctx, -29, -11, 7, 7, t);
        rrect(ctx, -31, -4, 11, 3.5, 1, W[1], 1.1);
        for (let i = 0; i < 3; i++) circle(ctx, -28 + i * 3.5, -5.5, 1.8, P.biome.prairie.accent[i], 0.8);
        fence(ctx, 14, 34, 8);
        for (let i = 0; i < 4; i++) { ctx.fillStyle = '#3f7f2a'; ctx.fillRect(-40 + i * 4, 2, 1.2, 5); circle(ctx, -39.4 + i * 4, 1, 2, P.biome.prairie.accent[(i + 1) % 4], 0.8); }
        break;
      }
      case 'mage': { // tour des mages : cylindre, toit conique, cristal flottant, cercle runique
        ctx.save(); ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 2);
        ctx.strokeStyle = '#c9a8ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 4, 34, 11, 0, 0, TAU); ctx.stroke();
        ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(0, 4, 28, 8.5, 0, 0, TAU); ctx.stroke();
        ctx.fillStyle = '#c9a8ff'; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + t * 0.4; ctx.fillRect(Math.cos(a) * 31 - 1.5, 4 + Math.sin(a) * 9.8 - 1.5, 3, 3); }
        ctx.restore();
        const cyl = (y0, y1, r, c) => {
          ctx.beginPath(); ctx.moveTo(-r, y1); ctx.lineTo(-r, y0); ctx.ellipse(0, y0, r, r * 0.3, 0, Math.PI, TAU, true); ctx.lineTo(r, y1); ctx.ellipse(0, y1, r, r * 0.3, 0, 0, Math.PI); ctx.closePath();
          const g = ctx.createLinearGradient(-r, 0, r, 0); g.addColorStop(0, shade(c, 0.2)); g.addColorStop(0.35, c); g.addColorStop(1, shade(c, -0.4));
          ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = OL; ctx.stroke();
        };
        cyl(-76, 2, 17, '#5b6fa8');
        ctx.save(); ctx.beginPath(); ctx.rect(-17, -76, 34, 80); ctx.clip();
        ctx.strokeStyle = 'rgba(29,22,38,.3)'; ctx.lineWidth = 1.1;
        for (let y = -68; y < 2; y += 8) { ctx.beginPath(); ctx.ellipse(0, y, 17, 5, 0, 0, Math.PI); ctx.stroke(); }
        ctx.restore();
        cyl(-44, -40, 20, '#4a5a8c');
        rrect(ctx, -6, -20, 12, 22, 6, W[2], 2);
        for (const [wx, wy] of [[-4, -36], [-4, -62]]) { ctx.save(); ctx.translate(wx + 4, wy + 6); glow(ctx, '#c9a8ff', 8); ctx.restore(); rrect(ctx, wx, wy, 8, 12, 4, '#e0ccff', 1.6); }
        // toit conique
        ctx.beginPath(); ctx.moveTo(-23, -76); ctx.quadraticCurveTo(-6, -92, 3, -122); ctx.quadraticCurveTo(8, -92, 23, -76); ctx.ellipse(0, -76, 23, 6, 0, 0, Math.PI); ctx.closePath();
        const rg = ctx.createLinearGradient(-23, 0, 23, 0); rg.addColorStop(0, '#8a6bc8'); rg.addColorStop(0.4, '#6b4fa0'); rg.addColorStop(1, '#3a2a60');
        ctx.fillStyle = rg; ctx.fill(); ctx.lineWidth = 2.4; ctx.strokeStyle = OL; ctx.stroke();
        ctx.fillStyle = '#ffd76a'; for (const [sx2, sy2] of [[-10, -84], [6, -96], [-2, -106], [12, -82]]) { ctx.fillRect(sx2 - 0.8, sy2 - 2.5, 1.6, 5); ctx.fillRect(sx2 - 2.5, sy2 - 0.8, 5, 1.6); }
        // cristal flottant
        const fy = -136 + Math.sin(t * 2) * 3;
        ctx.save(); ctx.translate(3, fy); glow(ctx, '#c9a8ff', 14); ctx.restore();
        poly(ctx, [3, fy - 9, 8, fy, 3, fy + 9, -2, fy], '#e6d4ff', 1.5);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(1.5, fy - 5, 1.5, 4);
        for (let i = 0; i < 3; i++) { const a = t * 2 + i * 2.1; ctx.fillStyle = '#ffffff'; ctx.fillRect(3 + Math.cos(a) * 12, fy + Math.sin(a) * 4, 2, 2); }
        banner(ctx, -20, -40, col, t);
        break;
      }
      case 'eleveur': { // étable : box ouverts, enclos, abreuvoir
        fence(ctx, -50, -26, 8);
        rrect(ctx, -48, -4, 18, 6, 2, W[1], 1.4); ctx.fillStyle = '#6ec6ff'; ctx.fillRect(-46, -3, 14, 2);
        gableHouse(ctx, {
          x0: -26, w: 52, h: 28, d: 16, rh: 18, wall: '#8a5a32', roof: '#4f6b3a', rows: 3,
          frontFn: () => {
            ctx.strokeStyle = 'rgba(29,22,38,.3)'; ctx.lineWidth = 1.1; for (let x = -22; x < 26; x += 5) { ctx.beginPath(); ctx.moveTo(x, -28); ctx.lineTo(x, 0); ctx.stroke(); }
            for (const bx of [-20, 4]) {
              rrect(ctx, bx, -20, 18, 20, 1, '#2b2028', 1.8);
              rrect(ctx, bx, -9, 18, 9, 1, W[0], 1.6);
              ctx.strokeStyle = OL; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(bx, -9); ctx.lineTo(bx + 18, 0); ctx.stroke();
            }
            // têtes d'animaux (cheval, vache)
            ellipse(ctx, -11, -14, 5, 4, '#8a5a3a', 1.4); ellipse(ctx, -6, -12, 3.5, 2.6, '#a87a5a', 1.2); poly(ctx, [-14, -17, -13, -22, -11, -17], '#8a5a3a', 1); eyes(ctx, -10, -15, 0.01, 1.1);
            ellipse(ctx, 13, -14, 5.5, 4.5, '#f3ead7', 1.4); ctx.fillStyle = '#2b2433'; ctx.beginPath(); ctx.ellipse(11, -16, 2.5, 2, 0, 0, TAU); ctx.fill(); ellipse(ctx, 17, -12, 3, 2.4, '#e8a0a8', 1.1); poly(ctx, [9, -18, 7, -21, 11, -18], '#d8d0c0', 0.9); eyes(ctx, 14, -15.5, 0.01, 1.1);
          },
          gableFn: (xm, top) => { rrect(ctx, xm - 6, top + 7, 12, 9, 1, '#2b2028', 1.4); ctx.fillStyle = '#e2c56a'; ctx.fillRect(xm - 5, top + 12, 10, 3); },
          sideFn: () => { ctx.strokeStyle = 'rgba(29,22,38,.3)'; ctx.lineWidth = 1; for (let u = 4; u < 16; u += 5) { ctx.beginPath(); ctx.moveTo(u, 0); ctx.lineTo(u, -28); ctx.stroke(); } }
        });
        hay(ctx, 34, 6);
        banner(ctx, 30, -26, col, t);
        break;
      }
      case 'archer': { // tour de guet sur pilotis
        const legs = [[-16, 4], [14, 4], [-8, -4], [22, -4]];
        for (const [lx, ly] of legs.slice(2)) line(ctx, lx, ly, lx + (lx < 0 ? 5 : -5), -50, shade(W[1], -0.2), 3.5);
        line(ctx, -8, -10, 20, -40, W[2], 1.8); line(ctx, 20, -10, -8, -40, W[2], 1.8);
        for (const [lx, ly] of legs.slice(0, 2)) line(ctx, lx, ly, lx + (lx < 0 ? 5 : -5), -46, W[1], 4);
        line(ctx, -14, -8, 12, -38, W[2], 2); line(ctx, 12, -8, -14, -38, W[2], 2);
        line(ctx, -14, -24, 12, -24, W[2], 2);
        // échelle
        line(ctx, 18, 6, 10, -44, W[0], 1.6); line(ctx, 24, 6, 16, -44, W[0], 1.6);
        for (let i = 0; i < 7; i++) { const k = i / 7; line(ctx, 18 - k * 8, 6 - k * 50, 24 - k * 8, 6 - k * 50, W[0], 1.2); }
        // plate-forme et parapet
        box(ctx, -24, 44, 6, 12, W[2], -46);
        box(ctx, -24, 44, 12, 12, W[0], -52);
        ctx.strokeStyle = 'rgba(29,22,38,.35)'; ctx.lineWidth = 1.1; for (let x = -20; x < 20; x += 5) { ctx.beginPath(); ctx.moveTo(x, -64); ctx.lineTo(x, -52); ctx.stroke(); }
        // archer de garde (silhouette) et toit en pyramide
        circle(ctx, -4, -70, 4, '#e2ab7f', 1.2); rrect(ctx, -8, -67, 8, 5, 2, '#27ae60', 1);
        for (const px of [-22, 18]) line(ctx, px, -62, px + 3, -84, W[2], 2.2);
        quad(ctx, [-30, -82, 0, -108, 6, -102, -14, -78], '#2e7a4a');
        quad(ctx, [0, -108, 32, -84, 26, -74, -14, -78], '#2e9e57');
        shingles(ctx, [0, -108], [32, -84], -14, 6, '#2e9e57', 3);
        line(ctx, 0, -108, 32, -84, '#226b3e', 2);
        banner(ctx, 0, -108, col, t);
        // cible
        line(ctx, -34, 6, -34, -8, W[2], 2); line(ctx, -40, 6, -34, -8, W[2], 1.6);
        circle(ctx, -34, -14, 8, '#f3ead7', 1.6); circle(ctx, -34, -14, 5.5, '#e2504c', 1.1); circle(ctx, -34, -14, 2.5, '#f2c14e', 1);
        line(ctx, -42, -20, -35, -15, W[0], 1); poly(ctx, [-44, -22, -42, -18, -46, -19], '#f3ead7', 0.8);
        break;
      }
      case 'assassin': { // repaire : cabane sombre drapée
        gableHouse(ctx, {
          x0: -32, w: 40, h: 24, d: 14, rh: 20, wall: '#3a3040', roof: '#231b2a', rows: 3,
          frontFn: () => { ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1.1; for (let x = -30; x < 8; x += 5) { ctx.beginPath(); ctx.moveTo(x, -24); ctx.lineTo(x + 1, 0); ctx.stroke(); } },
          gableFn: (xm, top) => { glowEye(ctx, xm - 2.5, top + 13, 1.4, '#c58cff'); glowEye(ctx, xm + 2.5, top + 13, 1.4, '#c58cff'); }
        });
        // tenture violette déchirée sur la façade
        poly(ctx, [-34, -26, 10, -26, 8, -18, 4, -22, -2, -16, -8, -21, -14, -15, -20, -21, -26, -16, -34, -19], '#5b4a7a', 1.4);
        door(ctx, -18, 11, 17, '#1d1626');
        // dague peinte sur la porte
        ctx.save(); ctx.translate(-12.5, -10); ctx.rotate(-Math.PI / 2); ctx.scale(0.55, 0.55); drawWeapon(ctx, 'daggers', col, 0.5); ctx.restore();
        win(ctx, -29, -14, 7, 6, t, false);
        // lanterne violette, caisses, corbeau
        line(ctx, 10, -20, 16, -20, '#3c3546', 1.2); line(ctx, 16, -20, 16, -16, '#3c3546', 1);
        ctx.save(); ctx.translate(16, -12); glow(ctx, '#b36bff', 7 + Math.sin(t * 5)); ctx.restore(); rrect(ctx, 13.5, -16, 5, 7, 1.5, '#d9b8ff', 1.1);
        for (const [cx, cy, k] of [[24, 6, 0], [32, 6, 0.06], [27, -3, -0.06]]) { rrect(ctx, cx - 5, cy - 9, 10, 9, 1, shade(W[1], k - 0.25), 1.3); ctx.strokeStyle = rgba(OL, 0.5); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 5, cy - 9); ctx.lineTo(cx + 5, cy); ctx.stroke(); }
        ellipse(ctx, -6, -46, 5, 3.5, '#151018', 1.2); circle(ctx, -2, -49, 2.6, '#151018', 1); poly(ctx, [0, -49, 3.5, -48, 0, -47.5], '#e2c56a', 0.6); ctx.fillStyle = '#ff3a3a'; ctx.fillRect(-2, -50, 1, 1);
        poly(ctx, [-11, -45, -15, -42, -10, -44], '#151018', 0.8);
        break;
      }
      case 'soldat': default: { // caserne : fortin crénelé avec herse
        box(ctx, -38, 64, 32, 16, S[0]);
        ctx.save(); ctx.beginPath(); ctx.rect(-38, -32, 64, 32); ctx.clip();
        for (let r = 0; r < 4; r++) for (let i = -5; i <= 4; i++) { ctx.fillStyle = shade(S[0], T.hash2(i + 7, r, 13) * 0.18 - 0.09); ctx.fillRect(i * 8 + (r % 2) * 4 - 1, -32 + r * 8 + 1, 7, 7); }
        ctx.restore();
        onSide(ctx, 26, () => { ctx.fillStyle = 'rgba(29,22,38,.25)'; for (let r = 0; r < 4; r++) ctx.fillRect(0, -32 + r * 8, 16, 1.2); });
        // créneaux façade et côté
        for (let i = 0; i < 6; i++) rrect(ctx, -38 + i * 11.6, -40, 8, 8, 1, S[1], 1.6);
        for (let i = 0; i < 3; i++) { const u = 3 + i * 5; quad(ctx, [26 + u, -32 - u * SK, 26 + u + 3.5, -32 - (u + 3.5) * SK, 26 + u + 3.5, -40 - (u + 3.5) * SK, 26 + u, -40 - u * SK], shade(S[1], -0.2), 1.3); }
        // porte voûtée + herse
        ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-18, -14); ctx.arc(-6, -14, 12, Math.PI, TAU); ctx.lineTo(6, 0); ctx.closePath(); fillStroke(ctx, '#1d1626', 2);
        ctx.save(); ctx.clip(); ctx.strokeStyle = '#8d8597'; ctx.lineWidth = 1.6;
        for (let x = -16; x < 6; x += 4) { ctx.beginPath(); ctx.moveTo(x, -28); ctx.lineTo(x, -4); ctx.stroke(); }
        for (let y = -22; y < 0; y += 5) { ctx.beginPath(); ctx.moveTo(-18, y); ctx.lineTo(6, y); ctx.stroke(); }
        ctx.restore();
        // bannières aux couleurs du propriétaire
        for (const bx of [-30, 12]) { rrect(ctx, bx - 1, -31, 12, 2.5, 1, W[2], 1); poly(ctx, [bx, -29, bx + 10, -29, bx + 10, -12, bx + 5, -15, bx, -12], col, 1.3); poly(ctx, [bx + 5, -26, bx + 8, -22, bx + 5, -18, bx + 2, -22], P.ui.gold, 0.9); }
        // torche
        ctx.save(); ctx.translate(-22, -24); glow(ctx, '#ffb02e', 7); ctx.restore(); poly(ctx, [-24, -21, -22, -28 - Math.sin(t * 14) * 1.5, -20, -21], '#ff7a1a', 1);
        // râtelier et mannequin
        for (const wx of [32, 38]) line(ctx, wx, 6, wx, -14, W[1], 1.5);
        poly(ctx, [30, -14, 32, -22, 34, -14], '#d8dde3', 1); poly(ctx, [36, -14, 38, -24, 40, -14], '#d8dde3', 1); line(ctx, 29, -4, 41, -4, W[2], 1.5);
        line(ctx, -46, 6, -46, -14, W[1], 2); line(ctx, -52, -8, -40, -8, W[1], 2); circle(ctx, -46, -18, 4, '#d9b85a', 1.3); rrect(ctx, -50, -14, 8, 9, 2, '#d9b85a', 1.2);
        break;
      }
    }
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
    if (RICH) {
      // pré-rendu par étape d'animation (12 images par cycle de ~1,6 s)
      const BP = TAU / 4, BN = 12, f = Math.floor(((t % BP) + BP) % BP / BP * BN);
      const key = family + '|' + (o.color || '') + '|' + f;
      let c = BLD_CACHE.get(key);
      if (!c) {
        if (BLD_CACHE.size > 600) BLD_CACHE.clear();
        c = document.createElement('canvas'); c.width = 140; c.height = 210;
        const x = c.getContext('2d'); x.translate(70, 186);
        drawBuildingRich(x, family, (f + 0.5) / BN * BP, o);
        BLD_CACHE.set(key, c);
      }
      ctx.drawImage(c, -70, -186);
      if (hp < 0.5) { ctx.strokeStyle = OL; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-20, -24); ctx.lineTo(-12, -14); ctx.lineTo(-16, -4); ctx.moveTo(18, -26); ctx.lineTo(12, -16); ctx.stroke(); }
      if (hp < 0.3) for (let i = 0; i < 2; i++) poly(ctx, [-12 + i * 22, -28, -6 + i * 22, -40 - Math.sin(t * 12 + i) * 5, 0 + i * 22, -28], P.biome.fire.accent[i], 1.3);
      ctx.restore();
      return;
    }
    switch (family) {
      case 'paysan': // ferme : grange rouge
        rrect(ctx, -30, -30, 60, 36, 3, '#b5413a', 2.5);
        poly(ctx, [-36, -28, 0, -54, 36, -28], '#7a2e2a', 2.5);
        rrect(ctx, -10, -18, 20, 24, 2, '#f3ead7', 2);
        ctx.strokeStyle = '#b5413a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-8, -16); ctx.lineTo(8, 4); ctx.moveTo(8, -16); ctx.lineTo(-8, 4); ctx.stroke();
        rrect(ctx, 26, -8, 16, 14, 4, '#e2c56a', 1.8); // botte de foin
        flag(-30, -30, o.color);
        break;
      case 'mine': { // mine : butte rocheuse, entrée étayée, wagonnet de minerai
        poly(ctx, [-40, 6, -32, -26, -12, -40, 12, -42, 32, -26, 40, 6], S[1], 2.5);
        poly(ctx, [-26, -18, -10, -32, 6, -30], S[0], 1.5);
        ctx.beginPath(); ctx.moveTo(-13, 6); ctx.lineTo(-13, -14); ctx.arc(0, -14, 13, Math.PI, 0); ctx.lineTo(13, 6); ctx.closePath(); fillStroke(ctx, '#1d1626', 2);
        line(ctx, -15, 6, -15, -16, W[1], 3); line(ctx, 15, 6, 15, -16, W[1], 3); line(ctx, -17, -17, 17, -17, W[1], 3);
        line(ctx, 14, 8, 46, 8, S[2], 1.5);
        rrect(ctx, 24, -6, 18, 11, 2, W[2], 1.6);
        poly(ctx, [26, -6, 30, -12, 35, -8, 40, -12, 41, -6], '#f2c14e', 1.2);
        circle(ctx, 28, 6, 2.5, S[3], 1); circle(ctx, 38, 6, 2.5, S[3], 1);
        circle(ctx, 0, -40, 3, '#ffd76a', 1.2); // lanterne
        break;
      }
      case 'scierie': { // scierie : cabane en rondins, tas de bûches, lame de scie
        rrect(ctx, -30, -30, 50, 36, 3, W[0], 2.5);
        ctx.strokeStyle = 'rgba(29,22,38,.35)'; ctx.lineWidth = 1.4;
        for (let y = -24; y < 6; y += 6) { ctx.beginPath(); ctx.moveTo(-29, y); ctx.lineTo(19, y); ctx.stroke(); }
        poly(ctx, [-36, -28, -5, -50, 26, -28], W[2], 2.5);
        rrect(ctx, -12, -16, 14, 22, 2, W[2], 2);
        for (const [lx, ly] of [[28, 2], [38, 2], [33, -7]]) { circle(ctx, lx, ly, 5, '#c99a5b', 1.6); circle(ctx, lx, ly, 2, W[1], 0.01); }
        ctx.save(); ctx.translate(-30, -6); ctx.rotate(t * 2);
        circle(ctx, 0, 0, 8, '#d8dde3', 1.6);
        ctx.fillStyle = OL; for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.fillRect(7, -1, 3, 2); }
        ctx.restore();
        circle(ctx, -30, -6, 2, S[2], 1);
        break;
      }
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
    for (const n of T.resourceNodes(seed)) {
      if (!RICH) { drawNode(ctx, n); continue; }
      ctx.save(); ctx.translate(n.x, n.y); ctx.scale(1.5, 1.5); drawNode(ctx, { ...n, x: 0, y: 0 }); ctx.restore();
    }

    // 5. décor (trié par y pour le chevauchement)
    const decor = [];
    for (let ty = 0; ty < T.ROWS; ty++) for (let tx = 0; tx < T.COLS; tx++) {
      const d = T.tileDecor(tx, ty, seed);
      if (d) decor.push({ ...d, b: grid[ty][tx], x: (tx + 0.5) * TS + d.ox, y: (ty + 0.5) * TS + d.oy });
    }
    decor.sort((a, b) => a.y - b.y);
    // en rendu détaillé, arbres et rochers sont agrandis pour rester à l'échelle des personnages
    const DK = RICH ? { tree: 1.55, rock: 1.5, small: 1.3 } : null;
    for (const d of decor) {
      if (!DK) { drawDecor(ctx, d, st); continue; }
      ctx.save(); ctx.translate(d.x, d.y); const k = DK[d.kind] || 1.3; ctx.scale(k, k);
      drawDecor(ctx, { ...d, x: 0, y: 0 }, st);
      ctx.restore();
    }
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

  window.Art = { setDetail, mobTop, heroPortrait, heroTop: (s) => 29 * Math.max(1, Math.round(s * 1.45)), drawBuilding, shade, rgba, circle, ellipse, rrect, poly, line, shadow, glow, drawHero, drawGrave, drawMob, drawTower, drawProjectile, drawCrown, buildTerrain, drawLavaGlow, drawWeapon };
})();
