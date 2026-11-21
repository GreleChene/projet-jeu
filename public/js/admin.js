/* Interface administrateur */
(function () {
  'use strict';
  const GD = window.GameData;
  const { api, $, $$, el, toast } = window.UI;
  const PHASES = { lobby: 'En attente', intermission: 'Entracte', wave: 'Combat', gameover: 'Défaite', victory: 'Victoire' };
  let users = [];

  api('/api/me').then((d) => {
    if (d.user.role !== 'admin') throw new Error('forbidden');
    $('#admin').classList.remove('hidden');
    init();
  }).catch(() => $('#denied').classList.remove('hidden'));

  function init() {
    $$('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
    $('#saveSettings').addEventListener('click', saveSettings);
    // liste des classes pour les bots, groupées par famille
    $('#botCls').replaceChildren(el('option', { value: '' }, 'Aléatoire'), el('option', { value: 'habitant' }, 'Habitant'),
      ...GD.BASE_CLASSES.map((b) => el('optgroup', { label: GD.CLASSES[b].name },
        el('option', { value: b }, GD.CLASSES[b].name), ...GD.specsOf(b).map((s) => el('option', { value: s }, '↳ ' + GD.CLASSES[s].name)))));
    $('#userFilter').addEventListener('input', renderUsers);
    refresh();
    loadUsers();
    setInterval(refresh, 2000);
    setInterval(loadUsers, 15000);
  }

  async function act(action, extra) {
    const body = { ...extra };
    if (action === 'start') {
      if (!confirm('Lancer une nouvelle partie ? La partie en cours sera remplacée.')) return;
      body.wave = Number($('#startWave').value) || 1;
    }
    if (action === 'stop' && !confirm('Arrêter la partie en cours ?')) return;
    if (action === 'wave') body.wave = Number($('#gotoWave').value) || 1;
    if (action === 'treasury') body.amount = Number($('#treasuryAmt').value) || 0;
    if (action === 'bots') { body.count = Number($('#botCount').value) || 1; body.cls = $('#botCls').value || null; body.level = Number($('#botLevel').value) || null; }
    if (action === 'announce') { body.text = $('#annTitle').value; body.sub = $('#annSub').value; }
    try { await api('/api/admin/game/' + action, { body }); refresh(); }
    catch (e) { toast(e.message); }
  }

  let settingsLoaded = false;
  async function refresh() {
    let d;
    try { d = await api('/api/admin/state'); } catch (e) { return; }
    const r = d.run;
    $('#runState').replaceChildren(
      el('div', { class: 'stats3' },
        el('div', { class: 'stat' }, el('b', {}, PHASES[r.phase] + (r.paused ? ' ⏸' : '')), el('span', { class: 'small muted' }, 'état')),
        el('div', { class: 'stat' }, el('b', {}, r.wave), el('span', { class: 'small muted' }, r.era)),
        el('div', { class: 'stat' }, el('b', {}, r.mobs), el('span', { class: 'small muted' }, 'ennemis')),
        el('div', { class: 'stat' }, el('b', {}, `${r.tower.hp}`), el('span', { class: 'small muted' }, `PV tour / ${r.tower.max}`)),
        el('div', { class: 'stat' }, el('b', {}, '🪙 ' + r.treasury), el('span', { class: 'small muted' }, 'écus de l’équipe')),
        el('div', { class: 'stat' }, el('b', {}, r.heroes), el('span', { class: 'small muted' }, 'héros'))
      ),
      el('p', { class: 'small muted' }, 'Améliorations : ' + (Object.entries(r.upgrades).filter(([k, v]) => v && k !== 'pact').map(([k, v]) => `${GD.UPGRADES[k].icon} ${GD.UPGRADES[k].name} ${v}`).join(' · ') || 'aucune'))
    );
    $('#feed').replaceChildren(...d.feed.slice().reverse().map((f) => el('div', {}, `${new Date(f.t).toLocaleTimeString()} — ${f.text}`)));
    $('#heroCount').textContent = `${d.heroes.length} héros`;
    $('#heroes').replaceChildren(
      el('tr', {}, el('th', {}, 'Nom'), el('th', {}, 'Classe'), el('th', {}, 'Niv.'), el('th', {}, 'PV'), el('th', {}, 'Élim.'), el('th', {}, 'Statut'), el('th', {}, '')),
      ...d.heroes.map((h) => el('tr', {},
        el('td', {}, h.name, h.bot ? ' 🤖' : ''),
        el('td', { style: `color:${GD.CLASSES[h.cls].color}` }, GD.CLASSES[h.cls].name),
        el('td', {}, h.level), el('td', {}, `${h.hp}/${h.maxHp}`), el('td', {}, h.kills),
        el('td', {}, h.alive ? 'en vie' : '☠️', h.bot ? '' : h.online ? ' · 🟢' : ' · ⚪'),
        el('td', { class: 'row', style: 'gap:4px' },
          h.bot ? '' : el('button', { class: 'small', onclick: () => giveXp({ id: h.id, pseudo: h.name }) }, '+ XP'),
          h.bot ? '' : el('button', { class: 'small', onclick: () => giveGold({ id: h.id, pseudo: h.name }) }, '+ Grêlons'),
          h.bot ? '' : el('button', { class: 'small', onclick: () => giveIce({ id: h.id, pseudo: h.name }) }, '+ 🧊'),
          el('button', { class: 'small danger', onclick: () => act('kick', { id: h.id }) }, 'Retirer'))))
    );
    if (!settingsLoaded) { settingsLoaded = true; renderSettings(d.settings); }
  }

  const SETTINGS = [
    ['difficulty', 'Difficulté (×)', 'number', 0.1],
    ['intermission', 'Durée de l’entracte / vote (s)', 'number', 1],
    ['voteEvery', 'Vote des viewers toutes les N manches', 'number', 1],
    ['maxHeroes', 'Héros maximum', 'number', 1],
    ['maxAliveMobs', 'Monstres simultanés max', 'number', 10],
    ['autoNext', 'Enchaîner les manches automatiquement', 'checkbox'],
    ['autoRestart', 'Relancer une partie après une défaite', 'checkbox']
  ];
  function renderSettings(s) {
    $('#settings').replaceChildren(...SETTINGS.map(([k, label, type, step]) => el('div', {},
      el('label', { for: 'set_' + k }, label),
      type === 'checkbox'
        ? el('input', { id: 'set_' + k, type, checked: !!s[k], style: 'width:auto' })
        : el('input', { id: 'set_' + k, type, step, value: s[k] }))));
  }
  async function saveSettings() {
    const body = {};
    for (const [k, , type] of SETTINGS) body[k] = type === 'checkbox' ? $('#set_' + k).checked : Number($('#set_' + k).value);
    try { await api('/api/admin/game/settings', { body }); $('#setNotice').textContent = 'Enregistré ✓'; setTimeout(() => ($('#setNotice').textContent = ''), 1500); }
    catch (e) { toast(e.message); }
  }

  async function loadUsers() {
    try { users = (await api('/api/admin/users')).users; renderUsers(); } catch (e) { /* */ }
  }
  function renderUsers() {
    const q = $('#userFilter').value.trim().toLowerCase();
    const list = users.filter((u) => !q || u.pseudo.toLowerCase().includes(q)).sort((a, b) => b.level - a.level);
    $('#users').replaceChildren(
      el('tr', {}, el('th', {}, 'Pseudo'), el('th', {}, 'Rôle'), el('th', {}, 'Classe'), el('th', {}, 'Niv.'), el('th', {}, 'Grêlons'), el('th', {}, 'Glaçons'), el('th', {}, 'Record'), el('th', {}, 'Actions')),
      ...list.map((u) => el('tr', {},
        el('td', {}, u.pseudo, u.online ? ' 🟢' : '', u.banned ? ' 🚫' : ''),
        el('td', {}, u.role === 'admin' ? '⭐ admin' : 'joueur'),
        el('td', { style: `color:${GD.CLASSES[u.cls].color}` }, GD.CLASSES[u.cls].name),
        el('td', {}, u.level), el('td', {}, u.gold), el('td', {}, u.glacons || 0), el('td', {}, u.stats.bestWave),
        el('td', { class: 'row', style: 'gap:4px' },
          el('button', { class: 'small', onclick: () => giveXp(u) }, '+ XP'),
          el('button', { class: 'small', onclick: () => giveGold(u) }, '+ Grêlons'),
          el('button', { class: 'small', onclick: () => giveIce(u) }, '+ Glaçons'),
          el('button', { class: 'small', onclick: () => { const g = prompt(`Fixer les Grêlons de ${u.pseudo} à :`, u.gold); if (g !== null) editUser(u, { gold: Number(g) }); } }, 'Fixer Grêlons'),
          el('button', { class: 'small', onclick: () => { const l = prompt('Niveau :', u.level); if (l !== null) editUser(u, { level: Number(l) }); } }, 'Niveau'),
          el('button', { class: 'small', onclick: () => confirm('Remettre la classe à « Habitant » ?') && editUser(u, { resetClass: true }) }, 'Reset classe'),
          el('button', { class: 'small', onclick: () => { const p = prompt('Nouveau mot de passe (6 caractères min.) :'); if (p) editUser(u, { password: p }); } }, 'Mot de passe'),
          el('button', { class: 'small danger', onclick: () => editUser(u, { banned: !u.banned }) }, u.banned ? 'Débannir' : 'Bannir'),
          el('button', { class: 'small danger', onclick: () => deleteUser(u) }, 'Supprimer'))))
    );
  }
  function giveXp(u) {
    const n = prompt(`Combien d’XP donner à ${u.pseudo} ?`, '500');
    if (n !== null && Number(n) > 0) editUser(u, { addXp: Number(n) });
  }
  function giveIce(u) {
    const n = prompt(`Combien de glaçons 🧊 donner à ${u.pseudo} ? (négatif pour retirer)`, '5');
    if (n !== null && Number(n)) editUser(u, { addGlacons: Number(n) });
  }
  function giveGold(u) {
    const n = prompt(`Combien de Grêlons donner à ${u.pseudo} ? (négatif pour retirer)`, '200');
    if (n !== null && Number(n)) editUser(u, { addGold: Number(n) });
  }
  async function editUser(u, body) {
    try { await api('/api/admin/users/' + u.id, { body }); toast('Modifié ✓'); loadUsers(); }
    catch (e) { toast(e.message); }
  }
  async function deleteUser(u) {
    if (!confirm(`Supprimer définitivement le compte « ${u.pseudo} » ?`)) return;
    try { await api('/api/admin/users/' + u.id, { method: 'DELETE' }); loadUsers(); }
    catch (e) { toast(e.message); }
  }
})();

/* ======================= Onglet « Équilibrage » : stats du jeu modifiables en direct ======================= */
(function () {
  'use strict';
  const { api, $, $$, el, toast } = window.UI;
  let groups = [];
  let loaded = false;
  const openState = {};

  $$('#adminTabs [data-atab]').forEach((b) => b.addEventListener('click', () => {
    $$('#adminTabs [data-atab]').forEach((x) => x.classList.toggle('active', x === b));
    $$('[data-aview]').forEach((v) => v.classList.toggle('hidden', v.dataset.aview !== b.dataset.atab));
    if (b.dataset.atab === 'balance' && !loaded) load();
  }));
  $('#balFilter').addEventListener('input', render);
  $('#balResetAll').addEventListener('click', async () => {
    const mods = groups.flatMap((g) => (g.type === 'table' ? g.rows.flatMap((r) => r.cells) : g.fields)).filter((c) => c.mod);
    if (!mods.length) { toast('Aucune valeur modifiée.'); return; }
    if (!confirm(`Remettre les ${mods.length} valeur(s) modifiée(s) à leur valeur d’origine ?`)) return;
    for (const c of mods) await api('/api/admin/balance', { body: { key: c.k, reset: true } }).catch(() => {});
    await load();
    toast('Équilibrage réinitialisé');
  });

  async function load() {
    try { groups = (await api('/api/admin/balance')).groups; loaded = true; render(); }
    catch (e) { $('#balError').textContent = e.message; }
  }

  const fmt = (v) => (v === null || v === undefined ? '' : String(+Number(v).toFixed(6)));

  function input(c) {
    const inp = el('input', { class: 'num' + (c.mod ? ' mod' : ''), type: 'number', step: 'any', min: '0', value: fmt(c.v), title: `Origine : ${fmt(c.d) || 'vide'}`, 'aria-label': c.k });
    const rst = el('button', { class: 'small rst' + (c.mod ? ' on' : ''), title: `Remettre ${fmt(c.d) || 'vide'}` }, '↺');
    const save = async (reset) => {
      $('#balError').textContent = '';
      try {
        const r = await api('/api/admin/balance', { body: reset ? { key: c.k, reset: true } : { key: c.k, value: inp.value === '' ? null : Number(inp.value) } });
        c.v = r.value === undefined ? null : r.value;
        c.mod = !reset;
        inp.value = fmt(c.v);
        inp.className = 'num saved' + (c.mod ? ' mod' : '');
        rst.classList.toggle('on', c.mod);
        setTimeout(() => inp.classList.toggle('saved', false), 900);
        $('#balNotice').textContent = `✓ ${c.k} = ${fmt(c.v) || 'vide'} (appliqué en direct)`;
      } catch (e) { inp.classList.add('bad'); $('#balError').textContent = e.message; }
    };
    inp.addEventListener('change', () => save(false));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    rst.addEventListener('click', () => save(true));
    return [inp, rst];
  }

  function render() {
    const q = $('#balFilter').value.trim().toLowerCase();
    const match = (s) => !q || String(s).toLowerCase().includes(q);
    $('#balGroups').replaceChildren(...groups.map((g) => {
      let body;
      if (g.type === 'table') {
        const rows = g.rows.filter((r) => match(r.label) || match(g.title) || match(r.id));
        if (!rows.length) return '';
        body = el('div', { class: 'table-wrap' }, el('table', { class: 'bal' },
          el('tr', {}, el('th', {}, ''), ...g.cols.map((c) => el('th', {}, c.label))),
          ...rows.map((r) => el('tr', {}, el('td', {}, r.label), ...r.cells.map((c) => el('td', {}, el('div', { class: 'cell' }, ...input(c))))))));
      } else {
        const fields = g.fields.filter((f) => match(f.label) || match(g.title) || match(f.k));
        if (!fields.length) return '';
        body = el('div', { class: 'bal-fields' }, ...fields.map((f) => el('div', { class: 'bal-field' }, el('label', {}, f.label), ...input(f))));
      }
      if (g.id === 'rarities') {
        const sum = g.rows.reduce((a, r) => a + (Number(r.cells[0].v) || 0), 0);
        body = el('div', {}, body, el('p', { class: 'small', style: `color:${Math.abs(sum - 1) < 1e-6 ? 'var(--ok)' : 'var(--danger)'}` }, `Total des probabilités : ${(sum * 100).toFixed(2)} %`));
      }
      const d = el('details', { class: 'panel bal', open: q ? true : !!openState[g.id] }, el('summary', {}, g.title), g.note ? el('p', { class: 'small muted' }, g.note) : '', body);
      d.addEventListener('toggle', () => { if (!q) openState[g.id] = d.open; });
      return d;
    }));
  }
})();
