/* Utilitaires communs aux pages joueur et admin */
(function () {
  'use strict';
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: opts.body ? { 'content-type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin'
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* vide */ }
    if (!res.ok) { const err = new Error(data.error || 'Erreur ' + res.status); err.status = res.status; throw err; }
    return data;
  }
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  function toast(msg) {
    const t = el('div', { class: 'toast' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 2500);
  }
  /**
   * Fenêtre de dialogue au style du jeu.
   * ask(texte, { title, ok, cancel, danger }) -> Promise<boolean>
   * askText(texte, valeurParDéfaut, { title, ok, type }) -> Promise<string | null>
   */
  function dialog(text, opts, withInput, def) {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const input = withInput ? el('input', { type: opts.type || 'text', value: def === undefined || def === null ? '' : String(def) }) : null;
      const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus) prev.focus(); resolve(v); };
      const okBtn = el('button', { class: opts.danger ? 'danger' : 'primary', onclick: () => close(withInput ? input.value : true) }, opts.ok || (withInput ? 'Valider' : 'Confirmer'));
      const cancelBtn = el('button', { onclick: () => close(withInput ? null : false) }, opts.cancel || 'Annuler');
      const box = el('div', { class: 'panel game-dialog', role: 'dialog', 'aria-modal': 'true' },
        opts.title ? el('h2', {}, opts.title) : '',
        el('div', { class: 'game-dialog-text' }, text),
        input || '',
        el('div', { class: 'row game-dialog-actions' }, el('span', { class: 'spacer' }), opts.noCancel ? '' : cancelBtn, okBtn));
      const overlay = el('div', { class: 'modal game-dialog-overlay' }, box);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(withInput ? null : false); });
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(withInput ? null : false); }
        else if (e.key === 'Enter' && (withInput ? document.activeElement === input : true)) { e.preventDefault(); okBtn.click(); }
      }
      document.addEventListener('keydown', onKey, true);
      document.body.append(overlay);
      (input || okBtn).focus();
      if (input) input.select();
    });
  }
  const ask = (text, opts) => dialog(text, opts || {}, false);
  const askText = (text, def, opts) => dialog(text, opts || {}, true, def);
  // Petit portrait de héros animé dans un canvas
  function heroCanvas(canvas, getOpts, opts = {}) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width, h = canvas.height;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    let t = Math.random() * 10;
    function frame() {
      t += 1 / 60;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const o = getOpts();
      if (o) {
        if (o.dead) window.Art.drawGrave(ctx, w / 2, h * 0.82);
        else window.Art.drawHero(ctx, w / 2, h * (opts.y || 0.82), { facing: 0, ...o, t, scale: opts.scale || 3 });
      }
      if (!opts.static) requestAnimationFrame(frame);
    }
    frame();
  }
  window.UI = { api, $, $$, el, toast, heroCanvas, ask, askText };
})();
