/* Interface administrateur */
(function () {
  'use strict';
  const GD = window.GameData;
  const { api, $, $$, el, toast, ask, askText } = window.UI;
  const PHASES = { lobby: 'En attente', intermission: 'Entracte', wave: 'Combat', gameover: 'Défaite', victory: 'Victoire' };
  let users = [];
  const GD_CHEAT = { suspect: 10, block: 30 }; // seuils anti-triche (renvoyés par le serveur)

  api('/api/me').then((d) => {
    if (d.user.role !== 'admin') throw new Error('forbidden');
    $('#admin').classList.remove('hidden');
    init();
  }).catch(() => $('#denied').classList.remove('hidden'));

  function init() {
    $$('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act, b.dataset.speed ? { speed: Number(b.dataset.speed) } : undefined)));
    $('#saveSettings').addEventListener('click', saveSettings);
    // liste des classes pour les bots, groupées par famille
    $('#botCls').replaceChildren(el('option', { value: '' }, 'Aléatoire'), el('option', { value: 'habitant' }, 'Paysan'),
      ...GD.BASE_CLASSES.map((b) => el('optgroup', { label: GD.CLASSES[b].name },
        el('option', { value: b }, GD.CLASSES[b].name), ...GD.specsOf(b).map((s) => el('option', { value: s }, '↳ ' + GD.CLASSES[s].name)))));
    // améliorations de tour, par spécialisation (test)
    $('#upgradeId').replaceChildren(...Object.entries(GD.TOWER_SPECS).map(([k, T]) => el('optgroup', { label: T.name },
      ...Object.entries(GD.UPGRADES).filter(([, u]) => u.towerSpec === k || u.tower === k).map(([id, u]) => el('option', { value: id }, `${u.icon} ${u.name}`)))));
    $('#userFilter').addEventListener('input', renderUsers);
    refresh();
    loadUsers();
    loadCheat();
    $('#cheatRefresh').addEventListener('click', loadCheat);
    loadTwitch();
    setInterval(loadTwitch, 5000);
    $('#twSave').addEventListener('click', async () => {
      try { showTwitch(await api('/api/admin/twitch', { body: { channel: $('#twChannel').value, enabled: $('#twEnabled').checked, chatVoteAll: $('#twVoteAll').checked, subGrelons: Number($('#twSubGrelons').value), giftGrelons: Number($('#twGiftGrelons').value) } })); toast('Twitch enregistré'); }
      catch (e) { toast(e.message); }
    });
    $('#twTest').addEventListener('click', async () => {
      try { showTwitch(await api('/api/admin/twitch/test', { body: { user: $('#twTestUser').value, text: $('#twTestMsg').value } })); refresh(); }
      catch (e) { toast(e.message); }
    });
    $$('[data-twsim]').forEach((b) => b.addEventListener('click', async () => {
      if (!$('#twTestUser').value) return toast('Indique un pseudo Twitch');
      try { showTwitch(await api('/api/admin/twitch/test', { body: { user: $('#twTestUser').value, event: b.dataset.twsim, count: 5 } })); setTimeout(loadUsers, 3500); toast('Événement simulé'); }
      catch (e) { toast(e.message); }
    }));
    setInterval(refresh, 2000);
    setInterval(loadUsers, 15000);
    setInterval(loadCheat, 15000);
  }

  let twLoaded = false;
  async function loadTwitch() { try { showTwitch(await api('/api/admin/twitch')); } catch (e) { /* */ } }
  function showTwitch(t) {
    if (!twLoaded) { $('#twChannel').value = t.channel; $('#twEnabled').checked = t.enabled; $('#twVoteAll').checked = t.chatVoteAll; $('#twSubGrelons').value = t.subGrelons; $('#twGiftGrelons').value = t.giftGrelons; twLoaded = true; }
    $('#twStatus').textContent = t.status;
    $('#twLog').replaceChildren(...t.log.map((l) => el('div', {}, `${new Date(l.t).toLocaleTimeString()} · ${l.user} : ${l.text}`)));
  }

  async function act(action, extra) {
    const body = { ...extra };
    if (action === 'start') {
      if (!(await ask('La partie en cours sera remplacée.', { title: 'Lancer une nouvelle partie ?', ok: 'Lancer' }))) return;
      body.wave = Number($('#startWave').value) || 1;
      body.mode = $('#startMode').value;
      body.difficulty = $('#startDiff').value;
    }
    if (action === 'stop' && !(await ask('La partie en cours sera arrêtée.', { title: 'Arrêter la partie ?', ok: 'Arrêter', danger: true }))) return;
    if (action === 'wave') body.wave = Number($('#gotoWave').value) || 1;
    if (action === 'upgrade') body.id = $('#upgradeId').value;
    if (action === 'treasury') body.amount = Number($('#treasuryAmt').value) || 0;
    if (action === 'openJoin') body.seconds = Number($('#joinSeconds').value) || 0;
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
    const jl = r.joinEndsAt ? Math.max(0, Math.ceil((r.joinEndsAt - Date.now()) / 1000)) : null;
    // écran de fin affiché sur le stream : bouton de validation bien visible
    $('#ackEnd').classList.toggle('hidden', r.phase !== 'gameover' && r.phase !== 'victory');
    $('#joinState').textContent = r.canJoin ? `🔓 Inscriptions ouvertes${jl !== null ? ` (${jl} s)` : ' (sans limite)'}` : '🔒 Inscriptions fermées';
    $('#runState').replaceChildren(
      el('div', { class: 'stats3' },
        el('div', { class: 'stat' }, el('b', {}, PHASES[r.phase] + (r.paused ? ' ⏸' : '') + (r.speed > 1 ? ' ⏩x' + r.speed : '')), el('span', { class: 'small muted' }, 'état')),
        el('div', { class: 'stat' }, el('b', {}, `${r.wave}/${r.maxWave}`), el('span', { class: 'small muted' }, `${r.modeName} · ${r.difficultyName} · ${r.era}`)),
        el('div', { class: 'stat' }, el('b', {}, r.mobs), el('span', { class: 'small muted' }, 'ennemis')),
        el('div', { class: 'stat' }, el('b', {}, `${r.tower.hp}`), el('span', { class: 'small muted' }, `PV tour / ${r.tower.max}`)),
        el('div', { class: 'stat' }, el('b', {}, GD.RES_IDS.map((k) => `${GD.RESOURCES[k].icon} ${(r.res || {})[k] || 0}`).join('  ')), el('span', { class: 'small muted' }, 'réserve de l’équipe')),
        el('div', { class: 'stat' }, el('b', {}, r.heroes), el('span', { class: 'small muted' }, 'héros'))
      ),
      el('p', { class: 'small muted' }, 'Améliorations : ' + (Object.entries(r.upgrades).filter(([k, v]) => v && k !== 'pact' && k !== 'revive').map(([k, v]) => `${GD.UPGRADES[k].icon} ${GD.UPGRADES[k].name} ${v}`).join(' · ') || 'aucune'))
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
    ['intermission', 'Entracte entre deux manches (s)', 'number', 1],
    ['joinWindow', 'Durée des inscriptions après le lancement (s, 0 = toute la partie)', 'number', 10],
    ['prepTime', 'Préparation avant la 1re manche (s)', 'number', 5],
    ['voteEvery', 'Vote des viewers toutes les N manches', 'number', 1],
    ['maxHeroes', 'Héros maximum', 'number', 1],
    ['maxAliveMobs', 'Monstres simultanés max', 'number', 10],
    ['autoNext', 'Enchaîner les manches automatiquement', 'checkbox'],
    ['autoRestart', 'Relancer une partie quand l’écran de fin est validé', 'checkbox']
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
      el('tr', {}, el('th', {}, 'Pseudo'), el('th', {}, 'Rôle'), el('th', {}, 'Classe'), el('th', {}, 'Niv.'), el('th', {}, 'Grêlons'), el('th', {}, 'Glaçons'), el('th', {}, 'Énergie'), el('th', {}, 'Record'), el('th', {}, '🛡️'), el('th', {}, 'Actions')),
      ...list.map((u) => el('tr', {},
        el('td', {}, u.pseudo, u.online ? ' 🟢' : '', u.banned ? ' 🚫' : '', u.twitch ? el('div', { class: 'small muted' }, '🟣 ' + u.twitch) : ''),
        el('td', {}, u.role === 'admin' ? '⭐ admin' : 'joueur'),
        el('td', { style: `color:${GD.CLASSES[u.cls].color}` }, GD.CLASSES[u.cls].name),
        el('td', {}, u.level), el('td', {}, u.gold), el('td', {}, u.glacons || 0), el('td', {}, '⚡ ' + (u.energy ?? 0)), el('td', {}, u.stats.bestWave),
        el('td', { title: 'Score anti-triche (alertes)' }, u.cheat ? el('span', { class: 'cheat-score ' + (u.cheat >= GD_CHEAT.block ? 'bloque' : u.cheat >= GD_CHEAT.suspect ? 'suspect' : 'ok') }, u.cheat) : '—'),
        el('td', { class: 'row', style: 'gap:4px' },
          el('button', { class: 'small', onclick: () => giveXp(u) }, '+ XP'),
          el('button', { class: 'small', onclick: () => giveGold(u) }, '+ Grêlons'),
          el('button', { class: 'small', onclick: () => giveIce(u) }, '+ Glaçons'),
          el('button', { class: 'small', onclick: () => giveEnergy(u) }, '+ Énergie ⚡'),
          el('button', { class: 'small', onclick: () => giveEgg(u) }, '🥚 Œuf'),
          el('button', { class: 'small', onclick: () => givePlans(u) }, '📜 Plans'),
          el('button', { class: 'small', onclick: async () => { const g = await askText(`Fixer les Grêlons de ${u.pseudo} à :`, u.gold, { title: 'Grêlons', type: 'number' }); if (g !== null) editUser(u, { gold: Number(g) }); } }, 'Fixer Grêlons'),
          el('button', { class: 'small', onclick: async () => { const l = await askText(`Niveau de ${u.pseudo} :`, u.level, { title: 'Niveau', type: 'number' }); if (l !== null) editUser(u, { level: Number(l) }); } }, 'Niveau'),
          el('button', { class: 'small', onclick: async () => { if (await ask(`Remettre la classe de ${u.pseudo} à « Paysan » ?`, { title: 'Reset de classe', ok: 'Remettre', danger: true })) editUser(u, { resetClass: true }); } }, 'Reset classe'),
          el('button', { class: 'small', onclick: async () => { const p = await askText(`Nouveau mot de passe de ${u.pseudo} (6 caractères min.) :`, '', { title: 'Mot de passe', type: 'password' }); if (p) editUser(u, { password: p }); } }, 'Mot de passe'),
          el('button', { class: 'small danger', onclick: () => editUser(u, { banned: !u.banned }) }, u.banned ? 'Débannir' : 'Bannir'),
          el('button', { class: 'small danger', onclick: () => deleteUser(u) }, 'Supprimer'))))
    );
  }
  /* ---------- Anti-triche ---------- */
  async function loadCheat() {
    try {
      const r = await api('/api/admin/anticheat');
      GD_CHEAT.suspect = r.suspect; GD_CHEAT.block = r.block;
      renderCheat(r);
    } catch (e) { /* */ }
  }
  function renderCheat(r) {
    const when = (t) => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const sus = r.list.filter((x) => x.score >= r.suspect).length;
    $('#cheatCount').textContent = r.list.length ? `${r.list.length} compte(s) · ${sus} suspect(s)` : 'Rien à signaler ✓';
    $('#cheat').replaceChildren(
      el('tr', {}, el('th', {}, 'Pseudo'), el('th', {}, 'Score'), el('th', {}, 'Dernières alertes'), el('th', {}, 'Comptes liés'), el('th', {}, 'Actions')),
      ...(r.list.length ? r.list.map((x) => el('tr', {},
        el('td', {}, x.pseudo, x.online ? ' 🟢' : '', x.banned ? ' 🚫' : ''),
        el('td', {}, el('span', { class: 'cheat-score ' + x.level }, x.score), x.level === 'bloque' ? el('div', { class: 'small' }, '⛔ mini-jeux suspendus') : x.level === 'suspect' ? el('div', { class: 'small' }, '⚠️ suspect') : ''),
        el('td', { class: 'small' }, x.log.length ? el('ul', { class: 'cheat-log' }, ...x.log.slice(0, 6).map((l) => el('li', {}, el('b', {}, r.kinds[l.kind] || l.kind), l.n > 1 ? ` ×${l.n}` : '', ' — ', l.detail, el('span', { class: 'muted' }, ` (${when(l.t)})`)))) : el('span', { class: 'muted' }, 'aucune')),
        el('td', { class: 'small' }, x.linked.length ? x.linked.join(', ') : el('span', { class: 'muted' }, '—')),
        el('td', { class: 'row', style: 'gap:4px' },
          el('button', { class: 'small', onclick: async () => { if (await ask(`Effacer les alertes de ${x.pseudo} ? (ses mini-jeux sont débloqués)`, { title: '🛡️ Anti-triche', ok: 'Effacer' })) { try { await api(`/api/admin/anticheat/${x.id}/clear`, { body: {} }); toast('Alertes effacées'); loadCheat(); loadUsers(); } catch (e) { toast(e.message); } } } }, 'Effacer'),
          el('button', { class: 'small danger', onclick: async () => { await editUser(x, { banned: !x.banned }); loadCheat(); } }, x.banned ? 'Débannir' : 'Bannir'))))
        : [el('tr', {}, el('td', { colspan: 5, class: 'muted' }, 'Aucune alerte ni compte lié.'))]));
  }

  async function giveXp(u) {
    const n = await askText(`Combien d’XP donner à ${u.pseudo} ?`, '500', { title: '+ XP', type: 'number' });
    if (n !== null && Number(n) > 0) editUser(u, { addXp: Number(n) });
  }
  async function giveEgg(u) {
    const z = await askText(`Donner un œuf de familier à ${u.pseudo} (prêt à éclore).\nZone : mine, foret ou champ, suivie du décor 0, 1 ou 2 (ex. « foret:1 »). Ajoute « :incuber » pour garder les ${GD.PETS.INCUBATION_MIN} min d’incubation.`, 'mine:0', { title: '🥚 Œuf (test)' });
    if (!z) return;
    try { const r = await api('/api/admin/users/' + u.id, { body: { giveEgg: z.trim() } }); toast('🥚 ' + r.text); loadUsers(); }
    catch (e) { toast(e.message); }
  }
  async function givePlans(u) {
    const n = await askText(`Combien de plans 📜 du Bastion donner à ${u.pseudo} ? (tirés au hasard parmi ceux qu’il n’a pas, zone par zone ; « tous » pour tout débloquer)`, '3', { title: '+ Plans du Bastion' });
    if (!n) return;
    try { const r = await api('/api/admin/users/' + u.id, { body: { addPlans: n.trim() } }); toast('📜 ' + r.text); loadUsers(); }
    catch (e) { toast(e.message); }
  }
  async function giveEnergy(u) {
    const n = await askText(`Combien d’énergie ⚡ (mini-jeux) donner à ${u.pseudo} ? (négatif pour retirer ; ${GD.MINI.ENERGY_MAX} max en temps normal, 99 pour les tests)`, '3', { title: '+ Énergie', type: 'number' });
    if (n !== null && Number(n)) editUser(u, { addEnergy: Number(n) });
  }
  async function giveIce(u) {
    const n = await askText(`Combien de glaçons 🧊 donner à ${u.pseudo} ? (négatif pour retirer)`, '5', { title: '+ Glaçons', type: 'number' });
    if (n !== null && Number(n)) editUser(u, { addGlacons: Number(n) });
  }
  async function giveGold(u) {
    const n = await askText(`Combien de Grêlons donner à ${u.pseudo} ? (négatif pour retirer)`, '200', { title: '+ Grêlons', type: 'number' });
    if (n !== null && Number(n)) editUser(u, { addGold: Number(n) });
  }
  async function editUser(u, body) {
    try { await api('/api/admin/users/' + u.id, { body }); toast('Modifié ✓'); loadUsers(); }
    catch (e) { toast(e.message); }
  }
  async function deleteUser(u) {
    if (!(await ask(`Le compte « ${u.pseudo} » sera supprimé définitivement.`, { title: 'Supprimer le compte ?', ok: 'Supprimer', danger: true }))) return;
    try { await api('/api/admin/users/' + u.id, { method: 'DELETE' }); loadUsers(); }
    catch (e) { toast(e.message); }
  }
})();
