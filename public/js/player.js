/* Interface joueur : compte, personnalisation, IA et choix en direct pendant la bataille */
(function () {
  'use strict';
  const GD = window.GameData, P = GD.PALETTE;
  const { api, $, $$, el, toast, heroCanvas } = window.UI;

  let me = null;
  let live = null; // dernier état envoyé par le serveur
  let socket = null;
  let authMode = 'login';

  /* ============================== Authentification ============================== */
  const demo = { cls: 'habitant', look: { cape: 0, skin: 1, hair: 0 }, equip: { head: 'head_none', body: 'body_tunic' } };
  (function authArt() {
    const cv = $('#authArt');
    const ctx = cv.getContext('2d');
    const specs = ['paladin', 'glace', 'arclong', 'necromancien', 'ombre', 'mineur'];
    let t = 0;
    (function loop() {
      t += 1 / 60;
      ctx.clearRect(0, 0, cv.width, cv.height);
      specs.forEach((cls, i) => {
        window.Art.drawHero(ctx, 25 + i * 38, 120 + (i % 2) * 14, {
          cls, look: { cape: i * 2, skin: i % 5, hair: i }, equip: { head: ['head_great', 'head_hood', 'head_leather', 'head_rune', 'head_hood', 'head_iron'][i], body: ['body_plate', 'body_tunic', 'body_leather', 'body_rune', 'body_leather', 'body_mail'][i] },
          t: t + i, facing: 0, scale: 1.5
        });
      });
      if (!$('#auth').classList.contains('hidden')) requestAnimationFrame(loop);
    })();
  })();

  $$('[data-auth]').forEach((b) => b.addEventListener('click', () => {
    authMode = b.dataset.auth;
    $$('[data-auth]').forEach((x) => x.classList.toggle('active', x === b));
    $('#authSubmit').textContent = authMode === 'login' ? 'Se connecter' : 'Créer mon héros';
    $('#password').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    $('#authError').textContent = '';
  }));

  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#authError').textContent = '';
    try {
      const d = await api(authMode === 'login' ? '/api/login' : '/api/register', { body: { pseudo: $('#pseudo').value.trim(), password: $('#password').value } });
      start(d.user);
    } catch (err) { $('#authError').textContent = err.message; }
  });

  $('#logout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  });

  api('/api/me').then((d) => start(d.user)).catch(() => $('#auth').classList.remove('hidden'));

  /* ============================== Démarrage ============================== */
  function start(user) {
    me = user;
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    if (me.role === 'admin') $('#hdrAdmin').classList.remove('hidden');
    heroCanvas($('#battleArt'), () => (me ? { cls: me.cls, look: me.look, equip: me.equip, dead: live && live.hero && !live.hero.alive, zombie: live && live.hero && live.hero.zombie } : null));
    heroCanvas($('#gearArt'), () => (me ? { cls: me.cls, look: me.look, equip: me.equip } : null));
    connect();
    renderAll();
  }

  function setUser(u) { me = u; renderAll(); }

  function connect() {
    socket = io({ transports: ['websocket', 'polling'] });
    socket.on('state', (s) => { live = s; renderLive(); });
    socket.on('connect_error', () => {});
  }

  /* ============================== Onglets ============================== */
  $$('#tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
    $$('#tabs [data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    $$('[data-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== b.dataset.tab));
    if (b.dataset.tab === 'ladder') loadLadder();
  }));

  function renderAll() {
    const c = GD.CLASSES[me.cls];
    $('#hdrPseudo').textContent = me.pseudo;
    $('#hdrLevel').textContent = `Niv. ${me.level}`;
    $('#hdrGold').textContent = `${me.gold} écus`;
    $('#heroCls').textContent = c.name;
    $('#heroCls').style.color = c.color;
    renderClasses();
    renderAttrs();
    renderGear();
    renderAI();
    renderStats();
  }

  /* ============================== Bataille ============================== */
  $('#joinBtn').addEventListener('click', () => {
    $('#joinError').textContent = '';
    socket.emit('join', (r) => { if (r && r.error) $('#joinError').textContent = r.error; });
  });
  $('#leaveBtn').addEventListener('click', () => { if (confirm('Retirer ton héros de la bataille ?')) socket.emit('leave'); });

  const PHASES = { lobby: 'En attente du lancement', intermission: 'Entracte', wave: 'Combat en cours', gameover: 'Défaite', victory: 'Victoire !' };

  let lastChoiceId = null, lastVoteSig = '';
  function renderLive() {
    if (!live || !me) return;
    const r = live.run, h = live.hero;
    // infos de partie
    const info = $('#runInfo');
    info.replaceChildren(
      el('div', { class: 'stats3' },
        el('div', { class: 'stat' }, el('b', {}, r.wave || '—'), el('span', { class: 'small muted' }, 'manche')),
        el('div', { class: 'stat' }, el('b', {}, r.heroes), el('span', { class: 'small muted' }, 'héros')),
        el('div', { class: 'stat' }, el('b', {}, r.treasury), el('span', { class: 'small muted' }, 'richesse'))
      ),
      el('p', {}, `${PHASES[r.phase] || r.phase}${r.paused ? ' (pause)' : ''}${r.phase === 'intermission' ? ` · prochaine manche dans ${r.timer}s` : ''}${r.phase === 'wave' ? ` · ${r.mobs} ennemis` : ''}`),
      el('p', { class: 'small muted' }, r.era + (r.phase !== 'lobby' && !r.voting ? ` · prochain vote après la manche ${r.nextVote}` : '')),
      el('label', {}, 'Tour'),
      el('div', { class: 'bar' + (r.tower.hp / r.tower.max < 0.3 ? ' red' : '') }, el('span', { style: `width:${(100 * r.tower.hp) / r.tower.max}%` }), el('div', { class: 'label' }, `${r.tower.hp} / ${r.tower.max}`)),
      r.pact ? el('p', { style: 'color:var(--danger)' }, r.pact === 'active' ? '💀 Pacte de sang actif : récompenses ×2' : '💀 Pacte de sang à la prochaine manche') : ''
    );
    // héros
    $('#notInRun').classList.toggle('hidden', !!h);
    $('#inRun').classList.toggle('hidden', !h);
    if (h) {
      $('#hpBar').style.width = `${(100 * h.hp) / h.maxHp}%`;
      $('#hpBar').style.background = h.zombie ? P.fx.poison : '';
      $('#hpLabel').textContent = `${h.hp} / ${h.maxHp}`;
      $('#ultWrap').classList.toggle('hidden', !h.hasUlt);
      $('#ultBar').style.width = `${h.ult * 100}%`;
      $('#ultName').textContent = GD.CLASSES[me.cls].ultName ? `— ${GD.CLASSES[me.cls].ultName}${h.ult >= 1 ? ' (PRÊT)' : ''}` : '';
      const st = [];
      if (!h.alive) st.push(`☠️ Mort — retour dans ${h.respawn}s`);
      if (h.zombie) st.push('🧟 Zombie (perd 1% PV/s)');
      const BN = { fury: '⚔️ Fureur', shield: '🛡️ Bouclier', swift: '💨 Célérité', rapid: '🏹 Rafale', stealth: '👻 Invisible', beast: '🐺 Meute' };
      for (const [k, v] of Object.entries(h.buffs)) if (BN[k]) st.push(`${BN[k]} ${v}s`);
      const SN = { poison: '🟢 Empoisonné', burn: '🔥 Brûlé', slow: '❄️ Ralenti', freeze: '🧊 Gelé' };
      for (const s of h.status) if (SN[s]) st.push(SN[s]);
      if (h.challenge) st.push('💀 Défi en cours (récompenses ×2)');
      $('#heroStatus').textContent = st.join(' · ') || `Dégâts ${h.dmg} · Armure ${h.armor}%`;
      $('#sKills').textContent = h.kills; $('#sXp').textContent = h.xp; $('#sGold').textContent = h.gold;
    }
    // choix personnel
    const ch = live.choice;
    $('#choiceBox').classList.toggle('hidden', !ch);
    if (ch) {
      $('#choiceTimer').textContent = `${Math.max(0, Math.ceil((ch.expires - Date.now()) / 1000))} s`;
      if (ch.id !== lastChoiceId) {
        lastChoiceId = ch.id;
        if (navigator.vibrate) navigator.vibrate(120);
        $('#choiceOpts').replaceChildren(...ch.options.map((o) => {
          const d = GD.PERSONAL_CHOICES[o];
          return el('button', { class: 'option' + (o === 'challenge' ? ' challenge' : ''), onclick: () => { socket.emit('choose', { id: ch.id, option: o }); $('#choiceBox').classList.add('hidden'); toast(`${d.icon} ${d.name} !`); } },
            el('span', { class: 'icon' }, d.icon), el('span', { class: 'name' }, d.name), el('span', { class: 'desc' }, d.desc));
        }));
      }
    }
    // vote d'équipe
    const v = live.vote;
    $('#voteBox').classList.toggle('hidden', !v || !h);
    if (v && h) {
      $('#voteTimer').textContent = `${Math.max(0, Math.ceil((v.endsAt - Date.now()) / 1000))} s`;
      const sig = JSON.stringify([v.options.map((o) => o.id), v.counts, v.mine, r.treasury]);
      if (sig !== lastVoteSig) {
        lastVoteSig = sig;
        $('#voteOpts').replaceChildren(...v.options.map((o) => {
          const up = GD.UPGRADES[o.id];
          const isSave = o.id === 'save';
          const afford = isSave || !o.cost || o.cost <= r.treasury;
          return el('button', { class: 'option' + (o.id === 'pact' ? ' challenge' : '') + (v.mine === o.id ? ' voted' : ''), disabled: !afford, onclick: () => socket.emit('vote', o.id) },
            el('span', { class: 'icon' }, isSave ? '💰' : up.icon),
            el('span', { class: 'name' }, isSave ? 'Économiser' : `${up.name}${o.level ? ` (niv. ${o.level + 1})` : ''}`),
            el('span', { class: 'desc' }, isSave ? 'Garder la richesse pour plus tard' : up.desc),
            el('span', { class: 'desc', style: 'display:block;margin-top:6px;color:var(--gold)' }, `${o.cost ? o.cost + ' 💰 · ' : ''}${v.counts[o.id] || 0} vote(s)`));
        }));
      }
    }
  }
  setInterval(() => { if (live) renderLive(); }, 1000);

  /* ============================== Classes ============================== */
  function miniHero(cls, size) {
    const cv = el('canvas', { width: size || 56, height: size || 56 });
    heroCanvas(cv, () => ({ cls, look: me.look, equip: me.equip }), { scale: (size || 56) / 52, static: true, y: 0.92 });
    return cv;
  }

  function renderClasses() {
    const PR = GD.PROGRESSION;
    const cur = GD.CLASSES[me.cls];
    const need = PR.xpForLevel(me.level);
    $('#lvlChip').textContent = `Niveau ${me.level}`;
    $('#xpBar').style.width = `${(100 * me.xp) / need}%`;
    $('#xpLabel').textContent = `${me.xp} / ${need} XP`;
    $('#evoHint').textContent = cur.tier === 0
      ? `Tu es « Habitant ». Au niveau ${PR.CLASS_LEVEL}, choisis une classe. Au niveau ${PR.SPEC_LEVEL}, une spécialisation avec un ultime.`
      : cur.tier === 1 ? `Classe : ${cur.name}. Spécialisation possible au niveau ${PR.SPEC_LEVEL}.` : `Spécialisation : ${cur.name}. Ultime : ${cur.ultName}.`;
    const tree = $('#classTree');
    tree.replaceChildren(...GD.BASE_CLASSES.map((base) => {
      const b = GD.CLASSES[base];
      const isCur = me.cls === base || GD.CLASSES[me.cls].parent === base;
      const canBase = cur.tier === 0 && me.level >= PR.CLASS_LEVEL;
      const card = el('div', { class: 'branch' + (isCur ? ' current' : '') },
        el('div', { class: 'cls' + (me.cls === base || GD.CLASSES[me.cls].parent === base ? ' owned' : '') },
          miniHero(base),
          el('div', {},
            el('div', { class: 'title', style: `color:${b.color}` }, b.name),
            el('div', { class: 'small muted' }, b.desc),
            b.leash ? el('div', { class: 'small muted' }, `Reste à moins de ${b.leash} px de la tour.`) : '',
            cur.tier === 0 ? el('button', { class: 'small primary', style: 'margin-top:6px', disabled: !canBase, onclick: () => pickClass(base) }, canBase ? 'Devenir ' + b.name : `Niveau ${PR.CLASS_LEVEL}`) : ''
          )
        ),
        el('div', { class: 'specs' }, ...GD.specsOf(base).map((sid) => {
          const s = GD.CLASSES[sid];
          const can = me.cls === base && me.level >= PR.SPEC_LEVEL;
          return el('div', { class: 'cls' + (me.cls === sid ? ' owned' : '') },
            miniHero(sid, 48),
            el('div', {},
              el('div', { class: 'title', style: `color:${s.color}` }, s.name, me.cls === sid ? ' ✓' : ''),
              el('div', { class: 'small muted' }, s.desc),
              el('div', { class: 'ult' }, `Ultime — ${s.ultName} : ${s.ultDesc}`),
              me.cls === base ? el('button', { class: 'small primary', style: 'margin-top:6px', disabled: !can, onclick: () => pickClass(sid) }, can ? 'Se spécialiser' : `Niveau ${PR.SPEC_LEVEL}`) : ''
            ));
        }))
      );
      return card;
    }));
  }

  async function pickClass(cls) {
    $('#clsError').textContent = '';
    if (!confirm(`Devenir ${GD.CLASSES[cls].name} ? Ce choix est définitif.`)) return;
    try { setUser((await api('/api/me/class', { body: { cls } })).user); toast(`Tu es maintenant ${GD.CLASSES[cls].name} !`); }
    catch (e) { $('#clsError').textContent = e.message; }
  }

  /* ============================== Statistiques ============================== */
  function renderAttrs() {
    const pts = me.attrPoints || 0;
    $('#ptsChip').textContent = `${pts} point${pts > 1 ? 's' : ''} disponible${pts > 1 ? 's' : ''}`;
    $('#ptsBadge').textContent = pts;
    $('#ptsBadge').classList.toggle('hidden', !pts);
    $('#attrList').replaceChildren(...GD.ATTR_IDS.map((id) => {
      const a = GD.ATTRIBUTES[id];
      return el('div', { class: 'attr' },
        el('span', { class: 'ico' }, a.icon),
        el('div', { class: 'info' }, el('div', {}, a.name), el('div', { class: 'small muted' }, a.desc)),
        el('span', { class: 'val' }, me.attrs[id] || 0),
        el('button', { class: 'primary', disabled: !pts, title: '+1', onclick: () => spend(id, 1) }, '+1'),
        pts >= 5 ? el('button', { class: 'small', onclick: () => spend(id, 5) }, '+5') : '');
    }));
    const st = GD.computeStats({ cls: me.cls, level: me.level, equip: me.equip, attrs: me.attrs });
    const rows = [
      ['❤️', 'PV max', st.maxHp],
      ['⚔️', 'Dégâts', Math.round(st.dmg * 10) / 10],
      ['🛡️', 'Défense', `${Math.round(st.armor * 100)}%`],
      ['🌀', 'Attaques / s', (1 / st.cd).toFixed(2)],
      ['👟', 'Déplacement', Math.round(st.speed)],
      ['🎯', 'Critique', `${Math.round(st.crit * 100)}%`],
      ['🏹', 'Portée', st.range],
      ['📈', 'Niveau', me.level]
    ];
    $('#derived').replaceChildren(...rows.map(([i, k, v]) => el('div', { class: 'stat' }, el('b', {}, v), el('span', { class: 'small muted' }, `${i} ${k}`))));
  }

  async function spend(attr, n) {
    $('#attrError').textContent = '';
    try { setUser((await api('/api/me/attrs', { body: { attr, n } })).user); }
    catch (e) { $('#attrError').textContent = e.message; }
  }
  $('#attrReset').addEventListener('click', async () => {
    if (!confirm('Récupérer tous tes points de stat ?')) return;
    try { setUser((await api('/api/me/attrs/reset', { method: 'POST' })).user); } catch (e) { toast(e.message); }
  });

  /* ============================== Apparence & armurerie ============================== */
  function swatches(box, colors, key) {
    box.replaceChildren(...colors.map((c, i) => el('button', {
      class: 'swatch' + (me.look[key] === i ? ' sel' : ''), style: `background:${c}`, title: c, 'aria-label': `${key} ${i + 1}`,
      onclick: async () => { const look = { ...me.look, [key]: i }; me.look = look; renderGear(); setUser((await api('/api/me/look', { method: 'PUT', body: look })).user); }
    })));
  }

  function itemCanvas(id) {
    const a = GD.ARMORS[id];
    const cv = el('canvas', { width: 44, height: 50 });
    const equip = { ...me.equip, [a.slot]: id };
    heroCanvas(cv, () => ({ cls: me.cls, look: me.look, equip }), { scale: 0.95, static: true, y: 0.94 });
    return cv;
  }

  function renderGear() {
    swatches($('#swCape'), P.capes, 'cape');
    swatches($('#swSkin'), P.skin, 'skin');
    swatches($('#swHair'), P.hair, 'hair');
    $('#shopGold').textContent = `${me.gold} écus`;
    for (const slot of ['head', 'body']) {
      const ids = Object.keys(GD.ARMORS).filter((id) => GD.ARMORS[id].slot === slot);
      $(slot === 'head' ? '#shopHead' : '#shopBody').replaceChildren(...ids.map((id) => {
        const a = GD.ARMORS[id];
        const owned = me.owned.includes(id);
        const equipped = me.equip[slot] === id;
        const tier = GD.ARMOR_TIERS[Math.max(0, a.tier)];
        return el('div', { class: 'item' },
          itemCanvas(id),
          el('div', { class: 'meta' },
            el('div', {}, a.tier >= 0 ? el('span', { class: 'tier-dot', style: `background:${tier.color}` }) : '', a.name),
            el('div', { class: 'muted small' }, a.hp || a.armor ? `+${Math.round(a.hp * 100)}% PV · +${Math.round(a.armor * 100)}% armure` : 'Aucun bonus')),
          equipped ? el('span', { class: 'chip small' }, 'Équipé')
            : owned ? el('button', { class: 'small', onclick: () => equipItem(id) }, 'Équiper')
            : el('button', { class: 'small primary', disabled: me.gold < a.price, onclick: () => buy(id) }, `${a.price} écus`));
      }));
    }
  }

  async function buy(id) {
    $('#shopError').textContent = '';
    try { setUser((await api('/api/shop/buy', { body: { item: id } })).user); toast(`${GD.ARMORS[id].name} acheté !`); }
    catch (e) { $('#shopError').textContent = e.message; }
  }
  async function equipItem(id) {
    try { setUser((await api('/api/me/equip', { method: 'PUT', body: { item: id } })).user); }
    catch (e) { $('#shopError').textContent = e.message; }
  }

  /* ============================== IA ============================== */
  const AI_TITLES = { stance: '🗺️ Posture', target: '🎯 Cible prioritaire', retreat: '🏳️ Retraite vers la tour', ult: '✨ Utilisation de l’ultime' };
  function renderAI() {
    const O = GD.AI_OPTIONS;
    $('#aiForm').replaceChildren(...Object.keys(O).map((key) => el('div', {},
      el('h3', {}, AI_TITLES[key]),
      el('div', { class: 'radio-group' }, ...Object.entries(O[key]).map(([val, label]) => el('label', {},
        el('input', { type: 'radio', name: 'ai_' + key, value: val, checked: String(me.ai[key]) === String(val), onchange: () => saveAI(key, val) }), label)))
    )));
  }
  async function saveAI(key, val) {
    try {
      setUser((await api('/api/me/ai', { method: 'PUT', body: { [key]: key === 'retreat' ? Number(val) : val } })).user);
      $('#aiNotice').textContent = 'IA mise à jour ✓';
      setTimeout(() => ($('#aiNotice').textContent = ''), 1500);
    } catch (e) { toast(e.message); }
  }

  /* ============================== Classement & compte ============================== */
  async function loadLadder() {
    const { top } = await api('/api/leaderboard');
    $('#ladder').replaceChildren(
      el('tr', {}, el('th', {}, '#'), el('th', {}, 'Pseudo'), el('th', {}, 'Classe'), el('th', {}, 'Niveau'), el('th', {}, 'Meilleure manche'), el('th', {}, 'Éliminations')),
      ...top.map((u, i) => el('tr', {}, el('td', {}, i + 1), el('td', {}, u.pseudo), el('td', { style: `color:${GD.CLASSES[u.cls].color}` }, GD.CLASSES[u.cls].name), el('td', {}, u.level), el('td', {}, u.bestWave), el('td', {}, u.kills)))
    );
  }

  function renderStats() {
    const s = me.stats;
    $('#myStats').replaceChildren(...[['Parties', s.runs], ['Meilleure manche', s.bestWave], ['Éliminations', s.kills], ['Boss vaincus', s.bossKills], ['Morts', s.deaths], ['Écus', me.gold]]
      .map(([k, v]) => el('div', { class: 'stat' }, el('b', {}, v), el('span', { class: 'small muted' }, k))));
  }

  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#pwError').textContent = ''; $('#pwOk').textContent = '';
    try { await api('/api/me/password', { body: { current: $('#pwCur').value, next: $('#pwNew').value } }); $('#pwOk').textContent = 'Mot de passe modifié ✓'; e.target.reset(); }
    catch (err) { $('#pwError').textContent = err.message; }
  });

  // rafraîchit le profil (XP, écus) régulièrement pendant la bataille
  setInterval(async () => {
    if (!me || document.hidden) return;
    try {
      const d = await api('/api/me');
      const changed = d.user.level !== me.level || d.user.cls !== me.cls;
      const goldChanged = d.user.gold !== me.gold;
      me = d.user;
      if (goldChanged && !changed) renderGear();
      if (!changed) renderAttrs();
      $('#hdrLevel').textContent = `Niv. ${me.level}`;
      $('#hdrGold').textContent = `${me.gold} écus`;
      $('#shopGold').textContent = `${me.gold} écus`;
      $('#xpBar').style.width = `${(100 * me.xp) / me.xpNext}%`;
      $('#xpLabel').textContent = `${me.xp} / ${me.xpNext} XP`;
      if (changed) { renderAll(); toast(`Niveau ${me.level} ! +1 point de stat à répartir`); }
    } catch (e) { /* hors ligne */ }
  }, 5000);
})();
