'use strict';

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const dist = (a, b) => Math.sqrt(dist2(a, b));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const angleDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Grille spatiale pour les requêtes de proximité (monstres nombreux)
class SpatialHash {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(cx, cy) { return cx * 4096 + cy; }
  build(items) {
    this.map.clear();
    for (const it of items) {
      const k = this.key(Math.floor(it.x / this.cell), Math.floor(it.y / this.cell));
      let b = this.map.get(k);
      if (!b) this.map.set(k, (b = []));
      b.push(it);
    }
  }
  query(x, y, r, out = []) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    const r2 = r * r;
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const b = this.map.get(this.key(cx, cy));
      if (!b) continue;
      for (const it of b) if ((it.x - x) ** 2 + (it.y - y) ** 2 <= r2) out.push(it);
    }
    return out;
  }
}

module.exports = { dist2, dist, clamp, rand, pick, angleDiff, shuffle, SpatialHash };
