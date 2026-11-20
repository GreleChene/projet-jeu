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
    if (action === 'bots') body.count = Number($('#botCount').value) || 1;
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
        el('div', { class: 'stat' }, el('b', {}, r.treasury), el('span', { class: 'small muted' }, 'richesse')),
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
        el('td', {}, el('button', { class: 'small danger', onclick: () => act('kick', { id: h.id }) }, 'Retirer'))))
    );
    if (!settingsLoaded) { settingsLoaded = true; renderSettings(d.settings); }
  }

  const SETTINGS = [
    ['difficulty', 'Difficulté (×)', 'number', 0.1],
    ['intermission', 'Durée de l’entracte / vote (s)', 'number', 1],
    ['voteEvery', 'Vote des viewers toutes les N manches', 'number', 1],
    ['choiceInterval', 'Choix personnel toutes les (s)', 'number', 1],
    ['choiceDuration', 'Temps pour choisir (s)', 'number', 1],
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
      el('tr', {}, el('th', {}, 'Pseudo'), el('th', {}, 'Rôle'), el('th', {}, 'Classe'), el('th', {}, 'Niv.'), el('th', {}, 'Écus'), el('th', {}, 'Record'), el('th', {}, 'Actions')),
      ...list.map((u) => el('tr', {},
        el('td', {}, u.pseudo, u.online ? ' 🟢' : '', u.banned ? ' 🚫' : ''),
        el('td', {}, u.role === 'admin' ? '⭐ admin' : 'joueur'),
        el('td', { style: `color:${GD.CLASSES[u.cls].color}` }, GD.CLASSES[u.cls].name),
        el('td', {}, u.level), el('td', {}, u.gold), el('td', {}, u.stats.bestWave),
        el('td', { class: 'row', style: 'gap:4px' },
          el('button', { class: 'small', onclick: () => { const g = prompt('Écus :', u.gold); if (g !== null) editUser(u, { gold: Number(g) }); } }, 'Écus'),
          el('button', { class: 'small', onclick: () => { const l = prompt('Niveau :', u.level); if (l !== null) editUser(u, { level: Number(l) }); } }, 'Niveau'),
          el('button', { class: 'small', onclick: () => confirm('Remettre la classe à « Habitant » ?') && editUser(u, { resetClass: true }) }, 'Reset classe'),
          el('button', { class: 'small', onclick: () => { const p = prompt('Nouveau mot de passe (6 caractères min.) :'); if (p) editUser(u, { password: p }); } }, 'Mot de passe'),
          el('button', { class: 'small danger', onclick: () => editUser(u, { banned: !u.banned }) }, u.banned ? 'Débannir' : 'Bannir'),
          el('button', { class: 'small danger', onclick: () => deleteUser(u) }, 'Supprimer'))))
    );
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
