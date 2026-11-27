/* Interface joueur : compte, personnalisation, IA et choix en direct pendant la bataille */
(function () {
  'use strict';
  const GD = window.GameData, P = GD.PALETTE;
  const { api, $, $$, el, toast, heroCanvas, ask } = window.UI;

  let me = null;
  let live = null; // dernier état envoyé par le serveur
  let socket = null;
  let authMode = 'login';

  /* ============================== Authentification ============================== */
  // Héros de démonstration (écran de connexion) : un set complet par classe, raretés variées
  const DEMO_SETS = ['rempart', 'arcaniste', 'faucon', 'maitrebete', 'lamenuit', 'barde'];
  const DEMO_GEAR = DEMO_SETS.map((sid, i) => Object.fromEntries(GD.SLOTS.map((s) => [s, GD.TEMPLATES[`${sid}_${s}`] ? { t: `${sid}_${s}`, r: [3, 2, 1, 5, 2, 4][i] } : null])));
  (function authArt() {
    const cv = $('#authArt');
    const ctx = cv.getContext('2d');
    const specs = ['paladin', 'glace', 'arclong', 'necromancien', 'ombre', 'troubadour'];
    let t = 0;
    (function loop() {
      t += 1 / 60;
      ctx.clearRect(0, 0, cv.width, cv.height);
      specs.forEach((cls, i) => {
        window.Art.drawHero(ctx, 25 + i * 38, 120 + (i % 2) * 14, {
          cls, look: { cape: i * 2, skin: i % 5, hair: i }, gear: DEMO_GEAR[i],
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
    heroCanvas($('#battleArt'), () => (me ? { cls: me.cls, look: me.look, gear: myGear(), mounted: isMounted(), dead: live && live.hero && !live.hero.alive, zombie: live && live.hero && live.hero.zombie } : null));
    heroCanvas($('#gearArt'), () => (me ? { cls: me.cls, look: me.look, gear: myGear(), mounted: isMounted() } : null));
    heroCanvas($('#equipArt'), () => (me ? { cls: me.cls, look: me.look, gear: myGear(), mounted: isMounted() } : null));
    // le chevalier monte à cheval une fois son ultime débloqué
    function isMounted() { return !!(me && GD.CLASSES[me.cls] && GD.CLASSES[me.cls].mount && GD.ultUnlocked(me.skills, me.cls)); }
    connect();
    renderAll();
    renderXp({ level: me.level, xp: me.xp, xpNext: me.xpNext, attrPoints: me.attrPoints });
  }

  function setUser(u) { me = u; renderAll(); if (window.BastionGame && window.BastionGame.userChanged) window.BastionGame.userChanged(); }
  // accès pour l'onglet Mini-jeux (mini.js)
  window.PlayerApp = { me: () => me, myGear: () => myGear(), setUser: (u) => setUser(u) };

  // Équipement porté { slot: {t, r} } à partir de l'inventaire
  function myGear() {
    const out = {};
    for (const s of GD.SLOTS) {
      const it = me.equip && me.equip[s] && me.inventory.find((x) => x.uid === me.equip[s]);
      out[s] = it ? { t: it.t, r: it.r } : null;
    }
    return out;
  }

  function connect() {
    socket = io({ transports: ['websocket', 'polling'] });
    socket.on('state', (s) => { live = s; renderLive(); });
    // notifications (achat, don, échange…)
    socket.on('notify', async (text) => {
      toast(text);
      try { setUser((await api('/api/me')).user); } catch (e) { /* */ }
      if (!$('[data-view="market"]').classList.contains('hidden')) loadMarket();
    });
    // fin de partie : récapitulatif des récompenses
    socket.on('runEnd', (r) => {
      const line = (icon, label, v) => el('div', { class: 'reward-line' }, el('span', {}, typeof icon === 'string' ? icon + ' ' : icon, label), el('b', {}, v));
      UI.ask(el('div', {},
        el('p', {}, r.won ? 'Victoire ! Les trois fléaux sont vaincus.' : `La tour est tombée à la manche ${r.wave}.`),
        el('div', { class: 'reward-list' },
          line('⚔️', 'Monstres éliminés', String(r.kills)),
          r.harvest ? line('🧺', 'Récolte', GD.RES_IDS.map((k) => `${GD.RESOURCES[k].icon} ${r.harvest[k] || 0}`).join('  ')) : '',
          line('✨', 'Expérience', '+' + r.xp + ' XP'),
          line(hail(), ' Grêlons', '+' + r.gold),
          line('🧊', 'Glaçons', '+' + r.glacons),
          r.levels ? line('⬆️', 'Niveaux gagnés', '+' + r.levels) : '')),
        { title: r.won ? '🏆 Récompenses de la victoire' : '🎁 Récompenses de la partie', ok: 'Super !', noCancel: true });
    });
    socket.on('connect_error', () => {});
  }

  /* ============================== Onglets ============================== */
  $$('#tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
    if (window.GameAudio && !b.classList.contains('active')) window.GameAudio.sfx('tab');
    $$('#tabs [data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    $$('[data-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== b.dataset.tab));
    if (b.dataset.tab === 'ladder') loadLadder();
    if (b.dataset.tab === 'ach') { markAchSeen(); renderAch(); }
    if (b.dataset.tab === 'market') loadMarket();
    if (b.dataset.tab === 'mini' && window.MiniGames) window.MiniGames.open();
    if (b.dataset.tab === 'bastion' && window.BastionGame) window.BastionGame.open();
  }));

  function renderAll() {
    const c = GD.CLASSES[me.cls];
    $('#hdrPseudo').replaceChildren(me.pseudo, me.title ? el('span', { class: 'hdr-title' }, ` « ${me.title} »`) : '');
    $('#hdrLevel').textContent = `Niv. ${me.level}`;
    $('#heroCls').textContent = c.name;
    $('#heroCls').style.color = c.color;
    renderClasses();
    renderAttrs();
    renderGear();
    renderEquip();
    renderHouse();
    renderRules();
    renderMarket();
    renderAI();
    renderStats();
    renderAch();
  }

  /* ============================== Bataille ============================== */
  $('#joinBtn').addEventListener('click', () => {
    $('#joinError').textContent = '';
    socket.emit('join', (r) => { if (r && r.error) $('#joinError').textContent = r.error; });
  });

  const PHASES = { lobby: 'En attente du lancement', intermission: 'Entracte', wave: 'Combat en cours', gameover: 'Défaite', victory: 'Victoire !' };

  let lastVoteSig = '';
  function renderLive() {
    if (!live || !me) return;
    const r = live.run, h = live.hero;
    if (live.profile) renderXp(live.profile);
    // infos de partie
    const info = $('#runInfo');
    info.replaceChildren(
      el('div', { class: 'stats3' },
        el('div', { class: 'stat' }, el('b', {}, r.wave || '—'), el('span', { class: 'small muted' }, 'manche')),
        el('div', { class: 'stat' }, el('b', {}, r.heroes), el('span', { class: 'small muted' }, 'héros')),
        el('div', { class: 'stat' }, el('b', {}, GD.RES_IDS.map((k) => `${GD.RESOURCES[k].icon} ${(r.res || {})[k] || 0}`).join('  ')), el('span', { class: 'small muted' }, 'réserve de l’équipe'))
      ),
      el('p', {}, `${PHASES[r.phase] || r.phase}${r.paused ? ' (pause)' : ''}${r.phase === 'intermission' ? ` · prochaine manche dans ${r.timer}s` : ''}${r.phase === 'wave' ? ` · ${r.mobs} ennemis` : ''}`),
      r.phase !== 'lobby' ? el('p', { class: 'small' }, `${r.modeName} · ${(GD.DIFFICULTIES[r.difficulty] || {}).icon || ''} ${r.difficultyName} · manche ${r.wave}/${r.maxWave}`) : '',
      el('p', { class: 'small muted' }, r.era + (r.phase !== 'lobby' && !r.voting ? ` · prochain vote après la manche ${r.nextVote}` : '')),
      el('label', {}, 'Tour'),
      el('div', { class: 'bar' + (r.tower.hp / r.tower.max < 0.3 ? ' red' : '') }, el('span', { style: `width:${(100 * r.tower.hp) / r.tower.max}%` }), el('div', { class: 'label' }, `${r.tower.hp} / ${r.tower.max}`)),
      r.pact ? el('p', { style: 'color:var(--danger)' }, r.pact === 'active' ? '💀 Pacte de sang actif : récompenses ×2' : '💀 Pacte de sang à la prochaine manche') : ''
    );
    // héros
    $('#notInRun').classList.toggle('hidden', !!h);
    $('#lockBanner').classList.toggle('hidden', !h);
    if (!h) {
      // le bouton n'apparaît que lorsqu'une bataille est lancée et que les inscriptions sont ouvertes
      $('#joinBtn').classList.toggle('hidden', !r.canJoin);
      const left = r.joinEndsAt ? Math.max(0, Math.ceil((r.joinEndsAt - Date.now()) / 1000)) : null;
      $('#joinMsg').textContent = r.phase === 'lobby' ? '⏳ Aucune bataille en cours : le bouton apparaîtra quand l’admin en lancera une.'
        : r.canJoin ? `Les inscriptions sont ouvertes${left !== null ? ` encore ${left} s` : ''} ! (ou tape !join dans le chat Twitch)`
        : r.phase === 'gameover' || r.phase === 'victory' ? 'La bataille est terminée.' : '🔒 Les inscriptions pour cette bataille sont fermées. Rendez-vous à la prochaine !';
    }
    $('#inRun').classList.toggle('hidden', !h);
    if (h) {
      $('#hpBar').style.width = `${(100 * h.hp) / h.maxHp}%`;
      $('#hpBar').style.background = h.zombie ? P.fx.poison : '';
      $('#hpLabel').textContent = `${h.hp} / ${h.maxHp}`;
      $('#ultWrap').classList.toggle('hidden', !h.hasUlt);
      $('#ultBar').style.width = `${h.ult * 100}%`;
      $('#ultName').textContent = GD.CLASSES[me.cls].ultName ? `— ${GD.CLASSES[me.cls].ultName}${h.ult >= 1 ? ' (PRÊT)' : ''}` : '';
      const st = [];
      if (!h.alive) st.push('☠️ Mort — seul un vote « Résurrection » de l’équipe peut te relever (tu gagnes quand même les récompenses jusqu’à la fin)');
      if (h.zombie) st.push('🧟 Zombie (perd 1% PV/s)');
      const BN = { fury: '⚔️ Fureur', shield: '🛡️ Bouclier', swift: '💨 Célérité', rapid: '🏹 Rafale', stealth: '👻 Invisible', beast: '🐺 Meute' };
      for (const [k, v] of Object.entries(h.buffs)) if (BN[k]) st.push(`${BN[k]} ${v}s`);
      const SN = { poison: '🟢 Empoisonné', burn: '🔥 Brûlé', slow: '❄️ Ralenti', freeze: '🧊 Gelé' };
      for (const s of h.status) if (SN[s]) st.push(SN[s]);
      if (h.building) st.push(h.building.hp > 0 ? `🏠 ${h.building.name}${h.building.shared > 1 ? ` (partagée à ${h.building.shared})` : ''} : ${h.building.hp}/${h.building.max} PV${h.resting ? ' (repos, soin en cours)' : ''}` : `🔥 ${h.building.name} détruite : plus de soin entre les manches`);
      $('#heroStatus').textContent = st.join(' · ') || `Dégâts ${h.dmg} · Armure ${h.armor}%`;
      $('#sKills').textContent = h.kills; $('#sXp').textContent = h.xp; $('#sGold').textContent = h.gold + (h.glacons ? ` · ${h.glacons} 🧊` : '');
    }
    // vote d'équipe
    const v = live.vote;
    $('#voteBox').classList.toggle('hidden', !v || !h);
    if (v && h) {
      $('#voteTimer').textContent = v.endsAt ? `${Math.max(0, Math.ceil((v.endsAt - Date.now()) / 1000))} s` : 'jusqu’au début de la manche suivante';
      const sig = JSON.stringify([v.options.map((o) => o.id), v.counts, v.mine, r.res]);
      if (sig !== lastVoteSig) {
        lastVoteSig = sig;
        $('#voteOpts').replaceChildren(...v.options.map((o) => {
          const up = GD.UPGRADES[o.id];
          const paid = o.cost && Object.keys(o.cost).length > 0;
          const afford = o.afford !== false;
          return el('button', { class: 'option' + (o.id === 'pact' ? ' challenge' : '') + (v.mine === o.id ? ' voted' : ''), disabled: !afford, onclick: () => socket.emit('vote', o.id) },
            el('span', { class: 'icon' }, isSave ? '🪙' : up.icon),
            el('span', { class: 'name' }, isSave ? 'Économiser' : `${up.name}${o.level && !up.revive ? ` (niv. ${o.level + 1})` : ''}`),
            el('span', { class: 'desc' }, up.desc),
            el('span', { class: 'desc', style: 'display:block;margin-top:6px;color:var(--gold)' }, `${paid ? GD.costText(o.cost) + ' · ' : ''}${v.counts[o.id] || 0} vote(s)`));
        }));
      }
    }
  }
  setInterval(() => { if (live) renderLive(); }, 1000);

  // Barre d'XP de l'onglet Bataille (mise à jour en direct)
  function renderXp(p) {
    if (me && p.glacons !== undefined && p.glacons !== me.glacons && !opening) {
      if (p.glacons > me.glacons) toast(`🧊 +${p.glacons - me.glacons} glaçon (manche passée) !`);
      me.glacons = p.glacons;
      renderEquip();
    }
    const pct = Math.min(100, (100 * p.xp) / p.xpNext);
    $('#bXpBar').style.width = `${pct}%`;
    $('#bXpLabel').textContent = `${p.xp} / ${p.xpNext} XP`;
    $('#bXpLvl').textContent = `niveau ${p.level}` + (p.attrPoints ? ` · ${p.attrPoints} point(s) de stat à répartir` : '');
    $('#xpBar').style.width = `${pct}%`;
    $('#xpLabel').textContent = `${p.xp} / ${p.xpNext} XP`;
    if (me && p.level !== me.level) {
      me.level = p.level; me.xp = p.xp; me.xpNext = p.xpNext; me.attrPoints = p.attrPoints;
      $('#hdrLevel').textContent = `Niv. ${me.level}`;
      api('/api/me').then((d) => setUser(d.user)).catch(() => {});
      toast(`Niveau ${p.level} ! +${GD.PROGRESSION.POINTS_PER_LEVEL} point de stat et +${GD.PROGRESSION.GLACONS_PER_LEVEL} glaçon 🧊`);
    }
  }

  /* ============================== Classes ============================== */
  function miniHero(cls, size) {
    const cv = el('canvas', { width: size || 56, height: size || 56 });
    heroCanvas(cv, () => ({ cls, look: me.look, gear: myGear() }), { scale: (size || 56) / 52, static: true, y: 0.92 });
    return cv;
  }

  let selSkill = null; // compétence affichée dans le détail de l’arbre
  let selOpen = false; // bulle d'action ouverte à côté de la pastille sélectionnée
  let popTimer = null;
  // ferme la bulle sans reconstruire l'arbre
  function closePop() {
    clearTimeout(popTimer);
    selOpen = false;
    const pop = document.querySelector('#classTree .tpop');
    if (pop) pop.remove();
  }
  // Zoom de l'arbre en étoile : null = ajusté à la largeur
  const TREE_BOARD = 1480;
  let treeZoom = null, keptZoom = null;
  const fitZoom = () => { const w = ($('#classTree .tboard-wrap') || {}).clientWidth || 0; return w ? Math.min(1, (w - 4) / TREE_BOARD) : 0.75; };
  function applyTreeZoom() {
    const wrap = $('#classTree .tboard-wrap');
    if (!wrap) return;
    const z = treeZoom || fitZoom();
    const sizer = wrap.firstChild, board = sizer.firstChild;
    sizer.style.width = `${TREE_BOARD * z}px`; sizer.style.height = `${TREE_BOARD * z}px`;
    board.style.transform = `scale(${z})`;
  }
  // Infobulle de l'arbre (au survol à la souris)
  let tipEl = null;
  function tipped(node, title, text, foot, color, id) {
    node.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || treeDrag.moved || (selOpen && selSkill === id)) return; // la bulle d'action est déjà ouverte
      tipEl ||= document.body.appendChild(el('div', { class: 'ttip hidden' }));
      tipEl.replaceChildren(el('b', { style: `color:${color || 'var(--gold)'}` }, title), el('div', {}, text), foot ? el('div', { class: 'tiny muted', style: 'margin-top:4px' }, foot) : '');
      tipEl.classList.remove('hidden');
      moveTip(e);
    });
    node.addEventListener('pointermove', moveTip);
    node.addEventListener('pointerleave', () => tipEl && tipEl.classList.add('hidden'));
    return node;
  }
  function moveTip(e) {
    if (!tipEl) return;
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = e.clientX + 16, y = e.clientY + 16;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 16;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - 16;
    tipEl.style.left = `${Math.max(8, x)}px`; tipEl.style.top = `${Math.max(8, y)}px`;
  }
  // Glisser sur l'arbre (clic maintenu) pour le déplacer quand il est zoomé
  const treeDrag = { on: false, moved: false };
  function enableTreeDrag(wrap) {
    wrap.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      Object.assign(treeDrag, { on: true, moved: false, x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop });
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!treeDrag.on) return;
      const dx = e.clientX - treeDrag.x, dy = e.clientY - treeDrag.y;
      if (!treeDrag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      if (!treeDrag.moved) { treeDrag.moved = true; wrap.classList.add('dragging'); wrap.setPointerCapture(e.pointerId); if (tipEl) tipEl.classList.add('hidden'); }
      wrap.scrollLeft = treeDrag.sl - dx; wrap.scrollTop = treeDrag.st - dy;
      // la page défile aussi quand l'arbre est déjà au bord (mode « Ajuster »)
      if (!wrap.classList.contains('zoomed')) window.scrollBy(0, -(e.movementY || 0));
    });
    const end = () => { treeDrag.on = false; wrap.classList.remove('dragging'); setTimeout(() => { treeDrag.moved = false; }, 0); };
    wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
    // un glissement ne doit pas sélectionner la pastille sous le curseur
    wrap.addEventListener('click', (e) => { if (treeDrag.moved) { e.stopPropagation(); e.preventDefault(); } }, true);
  }
  function setTreeZoom(z) { treeZoom = z === null ? null : Math.max(0.25, Math.min(1.6, z)); renderClasses(); }
  // réajuste l'arbre quand la largeur change (ou quand l'onglet devient visible)
  if (window.ResizeObserver) new ResizeObserver(() => { if (treeZoom === null) applyTreeZoom(); }).observe(document.getElementById('classTree'));
  // Description et passifs d'une classe (infobulles de l'arbre)
  function passiveBlock(cls) {
    const L = GD.passiveLines(cls);
    return L.length ? 'Passif :\n' + L.map((l) => '• ' + l).join('\n') : 'Aucun passif : uniquement ses statistiques et son arme.';
  }
  function classInfo(cls) { return `${GD.CLASSES[cls].desc}\n\n${passiveBlock(cls)}`; }
  function renderClasses() {
    const PR = GD.PROGRESSION;
    const cur = GD.CLASSES[me.cls];
    const need = PR.xpForLevel(me.level);
    $('#lvlChip').textContent = `Niveau ${me.level}`;
    $('#xpBar').style.width = `${(100 * me.xp) / need}%`;
    $('#xpLabel').textContent = `${me.xp} / ${need} XP`;
    const tree = $('#classTree');
    const pts = GD.skillPoints(me);
    const sk = me.skills || {};
    $('#skillBadge').textContent = pts.free || '';

    const base = GD.familyOf(me.cls);
    const started = GD.startedBranch(sk);
    const lossNow = Math.floor(pts.spent * PR.SKILL_RESPEC_LOSS);

    // État d'une compétence (mêmes règles que le serveur)
    const stateOf = (n) => {
      const rank = sk[n.id] || 0;
      let reason = '';
      if (n.core) { /* toujours disponible */ }
      else if (n.init) {
        if (cur.tier === 0) { if (me.level < PR.CLASS_LEVEL) reason = `Niveau ${PR.CLASS_LEVEL} requis`; }
        else if (n.base !== base) reason = 'Branche bloquée';
      } else {
        if (cur.tier === 0 || n.base !== base) reason = cur.tier === 0 ? `Entre d’abord dans la branche ${GD.CLASSES[n.base].name}` : 'Branche bloquée';
        else if (started && started !== n.spec) reason = 'Branche bloquée';
        else if (n.step === 1 && (sk[`init_${n.base}`] || 0) < GD.SKILL_MAX_RANK) reason = `${GD.SKILLS[`init_${n.base}`].name} ${GD.SKILL_MAX_RANK}/${GD.SKILL_MAX_RANK} requis`;
        else if (n.ult && me.level < PR.ULT_LEVEL) reason = `Niveau ${PR.ULT_LEVEL} requis`;
      }
      if (!reason && n.requires && (sk[n.requires] || 0) < GD.requiredRank(n.requires)) reason = GD.SKILLS[n.requires].ult ? 'Débloque d’abord l’ultime' : `${GD.requiredRank(n.requires)} points requis dans « ${GD.SKILLS[n.requires].name} »`;
      if (!reason && rank >= n.max) reason = 'Rang maximum';
      if (!reason && pts.free < 1) reason = 'Pas de point libre';
      return { rank, can: !reason, reason };
    };
    const nodeTitle = (n) => (n.ult ? `${GD.CLASSES[n.spec].ultName} (ultime)` : n.name);
    const nodeText = (n) => (n.ult ? GD.CLASSES[n.spec].ultDesc : n.summon ? GD.summonText(n) : `${bonusLine(n.bonus)} par rang${n.post ? ' (améliore l’ultime)' : ''}`);

    // Pastille d'une compétence dans l'arbre (cliquer = voir le détail)
    const dot = (n) => {
      const st = stateOf(n);
      const cls = 'tnode' + (n.ult ? ' tult' : '') + (n.post ? ' tpost' : '') + (n.summon ? ' tsummon' : '') + (n.init ? ' tinit' : '') + (n.core ? ' tcore' : '')
        + (st.rank ? ' owned' : '') + (st.can ? ' can' : '') + (selSkill === n.id ? ' sel' : '');
      const label = n.ult ? '✨' : n.summon ? `${GD.SUMMONS[n.summon].icon}${st.rank ? st.rank : ''}` : `${st.rank}/${n.max}`;
      const bc = n.spec ? GD.CLASSES[n.spec].color : n.init ? GD.CLASSES[n.base].color : GD.CLASSES.habitant.color;
      if (n.ult) {
        const S = GD.CLASSES[n.spec];
        // seul le nom de l'ultime reste affiché ; son effet apparaît au survol
        return tipped(el('button', { class: cls, onclick: () => { selSkill = n.id; selOpen = true; renderClasses(); } },
          el('b', {}, `✨ ${S.ultName}`), el('em', {}, st.rank ? 'Débloqué' : `Niveau ${PR.ULT_LEVEL}`)), `✨ ${S.ultName}`, S.ultDesc, st.rank ? 'Débloqué' : st.reason || `Ultime · niveau ${PR.ULT_LEVEL}`, S.color, n.id);
      }
      return tipped(el('button', { class: cls, style: `--bc:${bc}`, 'data-sk': n.id, onclick: () => { selSkill = n.id; selOpen = true; renderClasses(); } }, label), nodeTitle(n), nodeText(n), `${st.rank}/${n.max}${st.reason && !st.can ? ' · ' + st.reason : ''}`, n.spec ? GD.CLASSES[n.spec].color : n.init ? GD.CLASSES[n.base].color : GD.CLASSES.habitant.color, n.id);
    };

    // Détail de la compétence sélectionnée
    if (!selSkill || !GD.SKILLS[selSkill]) selSkill = 'core_1';
    const sel = GD.SKILLS[selSkill], selSt = stateOf(sel);
    const entering = (sel.init && cur.tier === 0) || (sel.spec && cur.tier === 1);
    const who = sel.spec ? GD.CLASSES[sel.spec] : sel.init ? GD.CLASSES[sel.base] : GD.CLASSES.habitant;
    const actionBtn = () => el('button', { class: 'small' + (selSt.can ? ' primary' : ''), disabled: !selSt.can, onclick: () => learn(sel) }, selSt.can ? (entering ? `Devenir ${GD.CLASSES[sel.spec || sel.base].name} (+1)` : sel.ult ? 'Débloquer (1 pt)' : '+1') : `🔒 ${selSt.reason}`);
    // Indications générales
    $('#evoHint').replaceChildren(
      el('span', {}, 'Classe : ', el('b', { style: `color:${cur.color}` }, cur.name), ' · '),
      el('b', { style: 'color:var(--gold)' }, `${pts.free} point(s) de compétence`), ` à dépenser (1 tous les ${PR.SKILL_EVERY} niveaux · ${pts.spent} attribué(s)${pts.lost ? ` · ${pts.lost} perdu(s) en reconversion, récupérables avec un 📜 Parchemin de mémoire` : ''}).`,
      el('div', { class: 'small muted', style: 'margin-top:4px' }, `Le Paysan est au centre. Une branche par classe (dès le niveau ${PR.CLASS_LEVEL}), puis une sous-branche par spécialisation (ultime au niveau ${PR.ULT_LEVEL}). Dès qu’un point est placé dans une branche, les autres se grisent. Clique sur une pastille pour voir son effet.`),
      Object.keys(sk).length ? el('div', { class: 'row', style: 'margin-top:8px' },
        el('button', { class: 'small danger', onclick: () => respec(lossNow) }, `🔄 Se reconvertir (perte de ${lossNow} point${lossNow > 1 ? 's' : ''})`)) : '');

    // Arbre en étoile : le Paysan au centre, les classes tout autour, les sous-branches qui rayonnent vers l'extérieur
    const BOARD = TREE_BOARD, CX = BOARD / 2, CY = BOARD / 2;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', BOARD); svg.setAttribute('height', BOARD); svg.setAttribute('class', 'tlines');
    const at = (r, deg) => [CX + Math.cos((deg * Math.PI) / 180) * r, CY + Math.sin((deg * Math.PI) / 180) * r];
    const link = (a, b, color, on, dim) => {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', a[0]); l.setAttribute('y1', a[1]); l.setAttribute('x2', b[0]); l.setAttribute('y2', b[1]);
      l.setAttribute('stroke', on ? color : '#4a3b5e'); l.setAttribute('stroke-width', on ? 5 : 3); l.setAttribute('stroke-linecap', 'round');
      if (dim) l.setAttribute('opacity', '0.35');
      svg.append(l);
    };
    const place = (node, p, extra) => { node.style.left = `${p[0]}px`; node.style.top = `${p[1]}px`; if (extra) node.classList.add(...extra.split(' ').filter(Boolean)); return node; };
    const items = [];
    const pos = {}; // position de chaque pastille (pour la bulle d'action)
    const R_CLASS = 160, R_LABEL = 245, R_NODES = [300, 344, 388, 432, 476], R_ULT = 552, R_POST = [632, 678];
    const P0 = GD.CLASSES.habitant;
    items.push(place(tipped(el('div', { class: 'tcenter' + (cur.tier === 0 ? ' here' : '') },
      miniHero('habitant', 48),
      el('div', { class: 'title', style: `color:${P0.color}` }, P0.name),
      dot(GD.SKILLS.core_1)), P0.name, classInfo('habitant'), null, P0.color), [CX, CY]));
    pos.core_1 = [CX, CY + 42];
    GD.BASE_CLASSES.forEach((b, k) => {
      const B = GD.CLASSES[b];
      const a0 = -90 + k * (360 / GD.BASE_CLASSES.length);
      const rowLocked = cur.tier > 0 && base !== b;
      const initOwned = (sk[`init_${b}`] || 0) > 0;
      link([CX, CY], at(R_CLASS, a0), B.color, initOwned, rowLocked);
      items.push(place(tipped(el('div', { class: 'tcls' + (base === b ? ' here' : ''), style: `--bc:${B.color}` },
        miniHero(b, 40),
        el('div', { class: 'tname', style: `color:${B.color}` }, B.name, base === b ? ' ✓' : '', rowLocked ? ' 🔒' : ''),
        dot(GD.SKILLS[`init_${b}`])), B.name, classInfo(b), null, B.color), at(R_CLASS, a0), rowLocked ? 'tlocked' : ''));
      { const c0 = at(R_CLASS, a0); pos[`init_${b}`] = [c0[0], c0[1] + 34]; }
      GD.specsOf(b).forEach((spec, j) => {
        const S = GD.CLASSES[spec];
        const a = a0 + (j - 1) * 21;
        const laneLocked = rowLocked || (base === b && started && started !== spec);
        const lk = laneLocked ? 'tlocked' : '';
        const ids = [1, 2, 3, 4, 5].map((n) => GD.SKILLS[`${spec}_${n}`]);
        let prev = at(R_CLASS + 34, a0);
        link(prev, at(R_LABEL - 18, a), S.color, (sk[ids[0].id] || 0) > 0, laneLocked);
        items.push(place(tipped(el('div', { class: 'tlbl' + (me.cls === spec ? ' here' : ''), style: `color:${S.color}` }, S.name, me.cls === spec ? ' ✓' : '', laneLocked ? ' 🔒' : ''), S.name, classInfo(spec), null, S.color), at(R_LABEL, a), lk));
        prev = at(R_LABEL + 16, a);
        ids.forEach((n, m) => {
          const p = at(R_NODES[m], a);
          link(prev, p, S.color, (sk[n.id] || 0) > 0, laneLocked);
          items.push(place(dot(n), p, lk));
          pos[n.id] = p;
          prev = p;
        });
        const ult = GD.SKILLS[`${spec}_ult`];
        const pu = at(R_ULT, a);
        link(prev, pu, S.color, (sk[ult.id] || 0) > 0, laneLocked);
        // compétences d'après-ultime, au bout de la sous-branche
        let pp = pu;
        [1, 2].map((k) => GD.SKILLS[`${spec}_u${k}`]).filter(Boolean).forEach((n, m) => {
          const p = at(R_POST[m], a);
          link(pp, p, S.color, (sk[n.id] || 0) > 0, laneLocked);
          items.push(place(dot(n), p, lk));
          pos[n.id] = p; pp = p;
        });
        const card = el('div', { class: 'tultcard', style: `--bc:${S.color}` }, dot(ult));
        items.push(place(card, pu, lk));
        pos[ult.id] = [pu[0] + 40, pu[1]];
      });
    });
    // bulle d'action à côté de la pastille cliquée : nom, rang et bouton pour y dépenser un point
    if (selOpen && pos[selSkill]) {
      const [px, py] = pos[selSkill];
      const pop = el('div', { class: 'tpop' + (px > CX + 250 ? ' left' : ''), style: `left:${px}px;top:${py}px;--bc:${who.color}` },
        el('button', { class: 'tpop-x', title: 'Fermer', onclick: () => closePop() }, '✕'),
        el('div', { class: 'tpop-head' }, el('b', { style: `color:${who.color}` }, nodeTitle(sel)), el('span', { class: 'chip small' }, sel.ult ? (selSt.rank ? 'Débloqué' : 'Ultime') : `${selSt.rank}/${sel.max}`)),
        el('div', { class: 'tiny', style: 'margin:4px 0 6px' }, nodeText(sel)),
        sel.init || sel.step === 1 ? el('div', { class: 'tiny muted', style: 'margin-bottom:6px' }, `Le premier point fait devenir ${who.name} et grise les autres branches.`) : '',
        sel.init || sel.step === 1 ? el('div', { class: 'tiny', style: 'margin-bottom:6px' }, passiveBlock(sel.spec || sel.base)) : '',
        actionBtn());
      items.push(pop);
      // la bulle se referme toute seule quand la souris s'en éloigne (et de sa pastille)
      const keepOpen = () => clearTimeout(popTimer);
      const leave = (e) => { if (e.pointerType === 'mouse') { clearTimeout(popTimer); popTimer = setTimeout(closePop, 450); } };
      pop.addEventListener('pointerenter', keepOpen); pop.addEventListener('pointerleave', leave);
      setTimeout(() => {
        const d = tree.querySelector(`.tboard [data-sk="${selSkill}"]`);
        if (d) { d.addEventListener('pointerenter', keepOpen); d.addEventListener('pointerleave', leave); }
      }, 0);
    }
    const board = el('div', { class: 'tboard', style: `width:${BOARD}px;height:${BOARD}px` }, svg, ...items);
    const sizer = el('div', { class: 'tsizer' }, board);
    const wrap = el('div', { class: 'tboard-wrap' + (treeZoom === null ? '' : ' zoomed') }, sizer);
    const zoomBar = el('div', { class: 'row tzoom' },
      el('span', { class: 'small muted' }, 'Zoom :'),
      el('button', { class: 'small', onclick: () => setTreeZoom((treeZoom || fitZoom()) / 1.25) }, '−'),
      el('button', { class: 'small' + (treeZoom === null ? ' primary' : ''), onclick: () => setTreeZoom(null) }, 'Ajuster'),
      el('button', { class: 'small', onclick: () => setTreeZoom((treeZoom || fitZoom()) * 1.25) }, '+'),
      el('span', { class: 'small muted' }, 'Survole une pastille pour voir son effet, clique dessus pour y placer un point. Maintiens le clic pour déplacer l’arbre.'));
    // garde la position de défilement de l'arbre zoomé quand on sélectionne une pastille
    const old = tree.querySelector('.tboard-wrap');
    const keep = old ? [old.scrollLeft, old.scrollTop] : null;
    // pendant la reconstruction, la page ne doit pas sauter (la pastille cliquée reste sous la souris)
    const pageY = window.scrollY;
    if (tree.offsetHeight) tree.style.minHeight = `${tree.offsetHeight}px`;
    tree.className = 'sktree';
    tree.replaceChildren(zoomBar, wrap);
    enableTreeDrag(wrap);
    if (tipEl) tipEl.classList.add('hidden');
    applyTreeZoom();
    if (keep && treeZoom === keptZoom) { wrap.scrollLeft = keep[0]; wrap.scrollTop = keep[1]; }
    keptZoom = treeZoom;
    tree.style.minHeight = '';
    if (Math.abs(window.scrollY - pageY) > 1) window.scrollTo(0, pageY);
  }

  async function learn(n) {
    $('#clsError').textContent = '';
    const cur = GD.CLASSES[me.cls];
    const PR = GD.PROGRESSION;
    const target = n.init && cur.tier === 0 ? n.base : n.spec && cur.tier === 1 ? n.spec : null;
    if (target) {
      const T = GD.CLASSES[target];
      if (!(await ask(`Placer ce point fait de toi un ${T.name}. Les autres branches seront grisées.\nTu pourras changer plus tard (reconversion), mais tu perdras ${Math.round(PR.SKILL_RESPEC_LOSS * 100)} % des points de compétence attribués et tes améliorations d’habitation seront remises à zéro (${Math.round(GD.HOUSE_RESPEC_REFUND * 100)} % des Grêlons remboursés).`, { title: `Devenir ${T.name} ?`, ok: `Devenir ${T.name}` }))) return;
    } else if (n.ult && !(await ask(`Débloquer l’ultime « ${GD.CLASSES[n.spec].ultName} » ?`, { title: '✨ Ultime' }))) return;
    try {
      setUser((await api('/api/me/skill', { body: { id: n.id } })).user);
      if (target) toast(`Tu es maintenant ${GD.CLASSES[target].name} !`);
    } catch (e) { $('#clsError').textContent = e.message; }
  }

  async function respec(loss) {
    $('#clsError').textContent = '';
    const refund = Math.floor(GD.houseSpent(me) * GD.HOUSE_RESPEC_REFUND);
    const ok = await ask(
      `• Tu perds DÉFINITIVEMENT ${loss} point(s) de compétence (${Math.round(GD.PROGRESSION.SKILL_RESPEC_LOSS * 100)}\u00a0% des points que tu as attribués).\n`
      + '• Ton arbre de compétences est remis à zéro.\n'
      + `• Tes améliorations d’habitation sont remises à zéro (${refund} Grêlons remboursés, ${Math.round(GD.HOUSE_RESPEC_REFUND * 100)}\u00a0%).\n`
      + '• Tu redeviens Paysan, au centre de l’arbre, et tu choisis à nouveau ta branche (tu peux reprendre la même).\n\n'
      + 'Confirmer la reconversion ?', { title: '⚠️ Reconversion', ok: 'Se reconvertir', danger: true });
    if (!ok) return;
    try {
      const d = await api('/api/me/respec', { method: 'POST' });
      setUser(d.user);
      toast(`Reconversion effectuée (−${d.lost} point${d.lost > 1 ? 's' : ''}${d.refund ? `, +${d.refund} Grêlons remboursés` : ''}). Choisis ta nouvelle classe.`);
      // retour à l'écran de choix de classe
      $$('#tabs [data-tab]').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'hero'));
      $$('[data-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== 'hero'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { $('#clsError').textContent = e.message; }
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
    const st = GD.computeStats({ cls: me.cls, level: me.level, gear: myGear(), attrs: me.attrs });
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
    if (!(await ask('Tous tes points de stat te seront rendus, à répartir à nouveau.', { title: 'Récupérer tes points de stat ?' }))) return;
    try { setUser((await api('/api/me/attrs/reset', { method: 'POST' })).user); } catch (e) { toast(e.message); }
  });

  /* ============================== Apparence & armurerie ============================== */
  function swatches(box, colors, key) {
    box.replaceChildren(...colors.map((c, i) => el('button', {
      class: 'swatch' + (me.look[key] === i ? ' sel' : ''), style: `background:${c}`, title: c, 'aria-label': `${key} ${i + 1}`,
      onclick: () => saveLook({ [key]: i })
    })));
  }

  async function saveLook(patch) {
    me.look = { ...me.look, ...patch };
    renderGear();
    try { setUser((await api('/api/me/look', { method: 'PUT', body: me.look })).user); } catch (e) { toast(e.message); }
  }
  // Une vignette (portrait du héros) par option de visage
  function faceOptions(box, key) {
    const names = GD.LOOK_OPTIONS[key];
    box.replaceChildren(...names.map((name, i) => {
      const cv = el('canvas', { width: 68, height: 68 });
      const look = { ...me.look, [key]: i };
      if (key !== 'eyes') look.eyes = me.look.eyes;
      window.Art.heroPortrait(cv.getContext('2d'), 68, 68, { cls: me.cls, look, gear: key === 'hairStyle' ? {} : myGear() });
      return el('button', { class: 'face-opt' + (me.look[key] === i ? ' sel' : ''), title: name, onclick: () => saveLook({ [key]: i }) }, cv, el('span', {}, name));
    }));
  }
  function renderGear() {
    swatches($('#swCape'), P.capes, 'cape');
    swatches($('#swSkin'), P.skin, 'skin');
    swatches($('#swHair'), P.hair, 'hair');
    faceOptions($('#optHair'), 'hairStyle');
    faceOptions($('#optEyes'), 'eyes');
    faceOptions($('#optNose'), 'nose');
    faceOptions($('#optMouth'), 'mouth');
  }

  /* ============================== Équipement & glaçons ============================== */
  const SLOT_ICONS = { head: '⛑️', body: '🦺', legs: '👖', feet: '👢', weapon: '🗡️' };
  let invFilter = 'all';
  const R = (i) => GD.RARITIES[i] || GD.RARITIES[0];
  // La rareté secrète reste « ??? » tant que le joueur ne l'a pas trouvée
  const rarName = (r) => (GD.RARITIES[r] && GD.RARITIES[r].hidden && !me.mysticFound ? '???' : R(r).name);
  const rarColor = (r) => (GD.RARITIES[r] && GD.RARITIES[r].hidden && !me.mysticFound ? '#a596b8' : R(r).color);
  const LOCK_LABEL = { 'vente': '🏪 En vente', 'échange': '🔄 Proposé en échange' };

  // Carte d'objet réutilisable (inventaire, place marchande)
  function itemCard(it, opts = {}) {
    const t = GD.TEMPLATES[it.t], usable = GD.canUse(it.t, me.cls);
    return el('div', { class: 'inv-item' + (usable || t.consumable || opts.noLock ? '' : ' locked') + (opts.worn ? ' worn' : ''), style: `--rc:${rarColor(it.r)}` },
      itemCanvas(it),
      el('div', { class: 'meta' },
        el('span', { class: 'rtag' }, rarName(it.r)),
        el('b', {}, GD.itemName(it, me.cls)),
        el('span', { class: 'muted' }, statsText(it)),
        t.consumable ? el('div', { class: 'muted' }, 'Objet à usage unique')
          : el('div', { class: 'muted' }, `Set ${GD.SETS[t.set].name}${t.families ? ' (' + t.families.map((f) => GD.CLASSES[f].name).join(', ') + ')' : ' (toutes classes)'}${usable ? '' : ' · pas pour ta classe'}`),
        ...(opts.lines || []).map((l) => el('div', { class: 'small' }, l))),
      opts.buttons ? el('div', { class: 'btns' }, ...opts.buttons) : '');
  }
  const hail = () => el('span', { class: 'hail', 'aria-hidden': 'true' });
  const fmtPct = (x) => `${Math.round(x * 1000) / 10}%`;

  function wornUids() { return new Set(Object.values(me.equip || {})); }

  // Aperçu du héros portant un objet donné
  function itemCanvas(item, w, h, scale) {
    const cv = el('canvas', { width: w || 48, height: h || 56 });
    const tpl = GD.TEMPLATES[item.t];
    if (tpl.consumable) {
      const W = w || 48, H = h || 56, dpr = window.devicePixelRatio || 1;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      const c = cv.getContext('2d');
      c.scale(dpr, dpr);
      c.font = `${Math.round(Math.min(W, H) * 0.7)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(tpl.icon || '✨', W / 2, H / 2 + 2);
      return cv;
    }
    const slot = tpl.slot;
    const gear = { ...myGear(), [slot]: { t: item.t, r: item.r } };
    heroCanvas(cv, () => ({ cls: me.cls, look: me.look, gear, moving: false }), { scale: scale || 0.95, static: true, y: 0.93 });
    return cv;
  }

  function statsText(item) {
    if (GD.TEMPLATES[item.t].consumable) return GD.TEMPLATES[item.t].desc;
    const st = GD.itemStats(item);
    return Object.entries(st).map(([k, v]) => `+${Math.round(v * 100)}% ${GD.STAT_NAMES[k]}`).join(' · ');
  }
  function bonusLine(b) { return Object.entries(b).map(([k, v]) => GD.bonusText(k, v)).join(', '); }

  function renderGold() {
    $('#hdrGold').replaceChildren(hail(), `${me.gold} Grêlons`);
    $('#eqGold').replaceChildren(hail(), `${me.gold} Grêlons`);
  }

  function renderEquip() {
    renderGold();
    const n = me.glacons || 0;
    $('#iceCount').textContent = n;
    $('#iceBadge').textContent = n;
    $('#iceBadge').classList.toggle('hidden', !n);
    $('#openIce').disabled = !n;
    // ouverture sans animation : débloquée après GLACONS.FAST_OPEN_AFTER glaçons ouverts
    const need = GD.GLACONS.FAST_OPEN_AFTER, done = me.glaconsOpened || 0;
    $('#openIceFast').disabled = !n || done < need;
    $('#openIceFast').title = done < need ? `Disponible après ${need} glaçons ouverts (${done}/${need})` : 'Ouvre le glaçon sans l’animation';
    $('#openIceFast').replaceChildren(done < need ? `🔒 Sans animation (${done}/${need})` : '⏭️ Ouvrir sans animation');
    const P1 = GD.GLACONS.PRICE;
    $('#buyIce1').replaceChildren('Acheter 1 · ', hail(), String(P1));
    $('#buyIce5').replaceChildren('Acheter 5 · ', hail(), String(P1 * 5));
    $('#buyIce1').disabled = me.gold < P1;
    $('#buyIce5').disabled = me.gold < P1 * 5;

    // objets portés
    const gear = myGear();
    $('#slots').replaceChildren(...GD.SLOTS.map((s) => {
      const it = gear[s];
      if (!it) return el('div', { class: 'slot empty' }, el('span', { class: 'ic' }, SLOT_ICONS[s]), GD.SLOT_NAMES[s], el('div', { class: 'muted' }, 'vide'));
      return el('div', { class: 'slot', style: `--rc:${rarColor(it.r)}`, title: 'Cliquer pour retirer', onclick: () => equip(null, s) },
        el('span', { class: 'ic' }, SLOT_ICONS[s]), el('div', { class: 'rtag' }, rarName(it.r)), GD.itemName(it, me.cls));
    }));
    // bonus de set
    const sb = GD.setBonuses(gear);
    const sets = Object.entries(sb.count);
    $('#setInfo').replaceChildren(...(sets.filter(([sid]) => Object.keys(GD.SETS[sid].bonus).length).length ? sets.filter(([sid]) => Object.keys(GD.SETS[sid].bonus).length).map(([sid, cnt]) => {
      const set = GD.SETS[sid];
      const total = GD.setSize(sid);
      return el('div', { style: 'margin-bottom:6px' }, el('b', { style: `color:${set.main === '#2b2433' ? 'var(--text)' : set.main}` }, `Set ${set.name} (${cnt}/${total})`),
        ...Object.entries(set.bonus).map(([need, b]) => el('div', { class: cnt >= need ? '' : 'muted' }, `${cnt >= need ? '✅' : '▫️'} ${need} pièces : ${bonusLine(b)}`)));
    }) : [el('span', { class: 'muted' }, 'Porte plusieurs pièces d’un même set pour obtenir des bonus.')]));

    // inventaire
    const inv = me.inventory.slice().sort((a, b) => b.r - a.r || (b.at || 0) - (a.at || 0));
    $('#invCount').textContent = `${inv.length} objet(s)`;
    $('#invTabs').replaceChildren(...['all', ...GD.SLOTS, 'consumable'].map((s) => el('button', { class: 'small' + (s === invFilter ? ' active' : ''), onclick: () => { invFilter = s; renderEquip(); } },
      s === 'all' ? 'Tout' : s === 'consumable' ? '📜 Parchemins' : `${SLOT_ICONS[s]} ${GD.SLOT_NAMES[s]}`)));
    const worn = wornUids();
    const list = inv.filter((it) => invFilter === 'all' || GD.TEMPLATES[it.t].slot === invFilter);
    $('#invList').replaceChildren(...(list.length ? list.map((it) => {
      const t = GD.TEMPLATES[it.t], usable = GD.canUse(it.t, me.cls), isWorn = worn.has(it.uid);
      const lock = (me.locked || {})[it.uid];
      const val = GD.recycleValue(it.r);
      return itemCard(it, {
        worn: isWorn,
        lines: lock ? [LOCK_LABEL[lock]] : [],
        buttons: lock ? [el('button', { class: 'small', onclick: () => goMarket() }, 'Voir')] : [
          t.consumable ? el('button', { class: 'small primary', disabled: !me.skillLost, title: me.skillLost ? '' : 'Aucun point de compétence perdu', onclick: () => useItem(it) }, 'Utiliser')
            : isWorn ? el('button', { class: 'small', onclick: () => equip(null, t.slot) }, 'Retirer')
              : el('button', { class: 'small primary', disabled: !usable, onclick: () => equip(it.uid) }, 'Équiper'),
          isWorn ? '' : el('button', { class: 'small', title: `Recycler contre ${val} Grêlons`, onclick: () => recycle(it) }, '♻️ ', hail(), String(val)),
          isWorn ? '' : el('button', { class: 'small', onclick: () => goMarket(it.uid) }, '🏪')]
      });
    }) : [el('p', { class: 'muted' }, 'Aucun objet. Brise un glaçon pour en obtenir !')]));
  }

  async function equip(uid, slot) {
    $('#invError').textContent = '';
    try { setUser((await api('/api/me/equip', { method: 'PUT', body: uid ? { uid } : { uid: null, slot } })).user); }
    catch (e) { $('#invError').textContent = e.message; }
  }
  async function useItem(it) {
    $('#invError').textContent = '';
    if (!(await ask(`Utiliser ce ${GD.TEMPLATES[it.t].name} pour récupérer 1 point de compétence perdu en reconversion ?`, { title: '📜 Parchemin de mémoire', ok: 'Utiliser' }))) return;
    try { setUser((await api('/api/inventory/use', { body: { uid: it.uid } })).user); toast('📜 +1 point de compétence récupéré !'); }
    catch (e) { $('#invError').textContent = e.message; }
  }
  async function recycle(it) {
    if (it.r >= 3 && !(await ask(`Recycler cet objet ${rarName(it.r).toLowerCase()} contre ${GD.recycleValue(it.r)} Grêlons ?`, { title: '♻️ Recyclage', ok: 'Recycler', danger: true }))) return;
    try {
      const d = await api('/api/inventory/recycle', { body: { uid: it.uid } });
      setUser(d.user);
      toast(`♻️ +${d.gain} Grêlons`);
    }
    catch (e) { $('#invError').textContent = e.message; }
  }
  async function buyIce(n) {
    $('#iceError').textContent = '';
    try { setUser((await api('/api/glacons/buy', { body: { n } })).user); toast(`🧊 +${n} glaçon${n > 1 ? 's' : ''}`); }
    catch (e) { $('#iceError').textContent = e.message; }
  }
  $('#buyIce1').addEventListener('click', () => buyIce(1));
  $('#buyIce5').addEventListener('click', () => buyIce(5));
  $('#openIce').addEventListener('click', () => openIce());
  $('#openIceFast').addEventListener('click', () => openIce(true));

  /* ---------- Animation : le glaçon tremble, se fissure, puis éclate ---------- */
  const SHARDS = [[0, 0, 50, 0], [50, 0, 100, 0], [100, 0, 100, 50], [100, 50, 100, 100], [100, 100, 50, 100], [50, 100, 0, 100], [0, 100, 0, 50], [0, 50, 0, 0]];
  // « Passer l'animation » : les attentes en cours se terminent aussitôt
  let skipIce = false, skipWake = null;
  const sleep = (ms) => (skipIce ? Promise.resolve() : new Promise((r) => { const id = setTimeout(r, ms); skipWake = () => { clearTimeout(id); r(); }; }));
  $('#iceSkip').addEventListener('click', (e) => { e.stopPropagation(); skipIce = true; if (skipWake) skipWake(); });
  let opening = false, lastFast = false;

  async function openIce(fast) {
    if (opening || !me.glacons) return;
    opening = true;
    skipIce = !!fast; lastFast = !!fast;
    // le bouton « Passer l'animation » n'apparaît qu'après GLACONS.FAST_OPEN_AFTER glaçons ouverts
    $('#iceSkip').classList.toggle('hidden', (me.glaconsOpened || 0) < GD.GLACONS.FAST_OPEN_AFTER);
    $('#iceError').textContent = '';
    const modal = $('#iceModal'), stage = $('#iceStage'), reveal = $('#iceReveal');
    stage.className = 'ice-stage';
    stage.querySelectorAll('.shard').forEach((x) => x.remove());
    reveal.classList.add('hidden');
    modal.classList.remove('hidden');
    let res;
    try { res = await api('/api/glacons/open', { method: 'POST' }); }
    catch (e) { modal.classList.add('hidden'); $('#iceError').textContent = e.message; opening = false; $('#iceSkip').classList.add('hidden'); return; }
    const item = res.item, rar = R(item.r);
    // la lueur intérieure trahit la rareté… le suspense monte avec elle
    modal.style.setProperty('--glow', item.r >= 5 ? '#ff7ad9' : rar.color);
    await sleep(250);
    stage.classList.add('charging');
    if (item.r >= 3) stage.classList.add('hard');
    await sleep(1500 + item.r * 250);
    // éclatement
    stage.classList.add('broken');
    for (const [x1, y1, x2, y2] of SHARDS) {
      const sh = el('div', { class: 'shard' });
      sh.style.clipPath = `polygon(50% 48%, ${x1}% ${y1}%, ${x2}% ${y2}%)`;
      stage.append(sh);
      const cx = (50 + x1 + x2) / 3 - 50, cy = (48 + y1 + y2) / 3 - 48;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        sh.style.transform = `translate(${cx * 6}px, ${cy * 6 + 40}px) rotate(${(Math.random() - 0.5) * 220}deg) scale(.6)`;
        sh.style.opacity = '0';
      }));
    }
    const fl = el('div', { class: 'flash' });
    document.body.append(fl);
    setTimeout(() => fl.remove(), 700);
    if (navigator.vibrate) navigator.vibrate(item.r >= 4 ? [80, 40, 160] : 60);
    await sleep(450);
    // révélation de l'objet
    $('#iceSkip').classList.add('hidden');
    setUser(res.user);
    const t = GD.TEMPLATES[item.t];
    const usableNow = GD.canUse(item.t, me.cls);
    reveal.className = 'reveal' + (item.r >= 5 ? ' mystic' : '');
    reveal.style.setProperty('--rc', rar.color);
    reveal.replaceChildren(
      el('div', { class: 'rar' }, item.r >= 5 ? '✦ MYSTIQUE ✦' : rar.name.toUpperCase()),
      item.r >= 5 ? el('div', { class: 'small', style: 'color:#ff7ad9' }, 'Tu as découvert une rareté secrète !') : '',
      itemCanvas(item, 120, 130, 2.3),
      el('h3', { style: 'margin:.2em 0' }, GD.itemName(item, me.cls)),
      el('div', { class: 'small muted' }, t.consumable ? 'Objet à usage unique · à utiliser depuis l’inventaire' : `${GD.SLOT_NAMES[t.slot]} · Set ${GD.SETS[t.set].name}`),
      el('div', { class: 'small', style: 'margin:6px 0 12px' }, statsText(item)),
      el('div', { class: 'row', style: 'justify-content:center' },
        usableNow ? el('button', { class: 'primary', onclick: async () => { await equip(item.uid); closeIce(); } }, 'Équiper') : '',
        me.glacons ? el('button', { onclick: () => { opening = false; openIce(lastFast); } }, `🧊 Encore (${me.glacons})`) : '',
        el('button', { onclick: closeIce }, 'Fermer')));
    opening = false;
  }
  function closeIce() { $('#iceModal').classList.add('hidden'); opening = false; }
  $('#iceModal').addEventListener('click', (e) => { if (e.target.id === 'iceModal' && !opening) closeIce(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !opening) closeIce(); });

  /* ============================== Place marchande ============================== */
  let market = { listings: [], trades: [] };
  let mkFilter = 'all';
  let showcase = null; // objets d'un autre joueur (pour un échange)
  let wantUid = null;

  function goMarket(uid) {
    $$('#tabs [data-tab]').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'market'));
    $$('[data-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== 'market'));
    loadMarket().then(() => { if (uid) { $('#mkItem').value = uid; renderMkPreview(); } });
  }

  async function loadMarket() {
    try { market = await api('/api/market'); } catch (e) { return; }
    renderMarket();
  }

  function renderMarket() {
    if (!me) return;
    $('#mkGold').replaceChildren(hail(), `${me.gold} Grêlons`);
    $('#tradeBadge').textContent = me.incomingTrades || '';
    $('#tradeBadge').classList.toggle('hidden', !me.incomingTrades);
    // filtres
    const F = { all: 'Tout', mine: 'Pour ma classe', ...Object.fromEntries(GD.SLOTS.map((s) => [s, `${SLOT_ICONS[s]} ${GD.SLOT_NAMES[s]}`])) };
    $('#mkFilters').replaceChildren(...Object.entries(F).map(([k, v]) => el('button', { class: 'small' + (k === mkFilter ? ' active' : ''), onclick: () => { mkFilter = k; renderMarket(); } }, v)));
    const others = market.listings.filter((l) => !l.mine && l.item && (mkFilter === 'all' || (mkFilter === 'mine' ? GD.canUse(l.item.t, me.cls) : GD.TEMPLATES[l.item.t].slot === mkFilter)));
    $('#mkList').replaceChildren(...(others.length ? others.map((l) => itemCard(l.item, {
      noLock: true,
      lines: [`Vendu par ${l.seller}${l.reservedFor ? ' · 🔒 réservé pour toi' : ''}`],
      buttons: [el('button', { class: 'small primary', disabled: me.gold < l.price, onclick: () => buyListing(l) }, hail(), String(l.price))]
    })) : [el('p', { class: 'muted' }, 'Aucune annonce pour le moment.')]));
    // mes annonces
    const mine = market.listings.filter((l) => l.mine && l.item);
    $('#mkMine').replaceChildren(...(mine.length ? mine.map((l) => itemCard(l.item, {
      noLock: true,
      lines: [[hail(), `${l.price} Grêlons`, l.reservedFor ? ` · réservé à ${l.reservedFor}` : '']],
      buttons: [el('button', { class: 'small', onclick: () => mkAction('/api/market/cancel', { id: l.id }, 'Annonce retirée') }, 'Retirer')]
    })) : [el('p', { class: 'muted small' }, 'Aucun objet en vente.')]));
    // échanges
    const tr = market.trades;
    $('#mkTrades').replaceChildren(...(tr.length ? tr.map((t) => el('div', { class: 'panel', style: 'padding:10px;margin-bottom:8px' },
      el('div', { class: 'small' }, t.incoming ? `🔄 ${t.from} te propose :` : `🔄 Ta proposition à ${t.to} :`),
      el('div', { class: 'inv' }, t.give ? itemCard(t.give, { noLock: true, lines: [t.incoming ? 'Tu reçois' : 'Tu donnes'] }) : '', t.want ? itemCard(t.want, { noLock: true, lines: [t.incoming ? 'Tu donnes' : 'Tu reçois'] }) : ''),
      t.gold ? el('div', { class: 'small' }, '+ ', hail(), `${t.gold} Grêlons ${t.incoming ? 'pour toi' : 'de ta part'}`) : '',
      el('div', { class: 'row', style: 'margin-top:6px' }, ...(t.incoming
        ? [el('button', { class: 'small primary', onclick: () => mkAction(`/api/market/trade/${t.id}/accept`, {}, 'Échange réalisé ✅') }, 'Accepter'),
          el('button', { class: 'small danger', onclick: () => mkAction(`/api/market/trade/${t.id}/refuse`, {}, 'Échange refusé') }, 'Refuser')]
        : [el('button', { class: 'small', onclick: () => mkAction(`/api/market/trade/${t.id}/cancel`, {}, 'Proposition annulée') }, 'Annuler')]))
    )) : [el('p', { class: 'muted small' }, 'Aucun échange en cours.')]));
    // sélection de mes objets (hors objets portés, en vente ou en échange)
    const cur = $('#mkItem').value;
    const free = me.inventory.filter((it) => !wornUids().has(it.uid) && !(me.locked || {})[it.uid]).sort((a, b) => b.r - a.r);
    $('#mkItem').replaceChildren(el('option', { value: '' }, free.length ? '— Choisir un objet —' : 'Aucun objet disponible (retire les objets portés)'),
      ...free.map((it) => el('option', { value: it.uid }, `[${rarName(it.r)}] ${GD.itemName(it, me.cls)}${GD.canUse(it.t, me.cls) ? '' : ' (autre classe)'}`)));
    if (free.some((it) => it.uid === cur)) $('#mkItem').value = cur;
    renderMkPreview();
    renderShowcase();
  }

  function selectedItem() { return me.inventory.find((it) => it.uid === $('#mkItem').value) || null; }
  function renderMkPreview() {
    const it = selectedItem();
    $('#mkPreview').replaceChildren(it ? itemCard(it, { noLock: true }) : '');
    $('#mkTrade').disabled = !it || !wantUid;
  }
  $('#mkItem').addEventListener('change', renderMkPreview);

  function renderShowcase() {
    if (!showcase) { $('#mkShowcase').replaceChildren(); return; }
    $('#mkShowcase').replaceChildren(...(showcase.items.length ? showcase.items.map((it) => itemCard(it, {
      noLock: true,
      buttons: [el('button', { class: 'small' + (wantUid === it.uid ? ' primary' : ''), onclick: () => { wantUid = it.uid; renderShowcase(); renderMkPreview(); } }, wantUid === it.uid ? '✔ Choisi' : 'Choisir')]
    })) : [el('p', { class: 'muted small' }, `${showcase.pseudo} n’a aucun objet disponible à l’échange.`)]));
  }

  async function mkAction(url, body, okMsg) {
    $('#mkError').textContent = ''; $('#mkFormError').textContent = '';
    try { const d = await api(url, { body }); if (d.user) setUser(d.user); toast(okMsg); await loadMarket(); return true; }
    catch (e) { $('#mkError').textContent = e.message; $('#mkFormError').textContent = e.message; return false; }
  }
  async function buyListing(l) {
    if (!(await ask(`Acheter ${GD.itemName(l.item, me.cls)} pour ${l.price} Grêlons ?`, { title: '🏪 Achat', ok: 'Acheter' }))) return;
    mkAction('/api/market/buy', { id: l.id }, 'Objet acheté ! Il est dans ton inventaire.');
  }
  $('#mkSell').addEventListener('click', () => {
    const it = selectedItem();
    if (!it) { $('#mkFormError').textContent = 'Choisis un objet.'; return; }
    mkAction('/api/market/sell', { uid: it.uid, price: Number($('#mkPrice').value), reservedFor: $('#mkReserved').value.trim() || null }, 'Objet mis en vente 🏪');
  });
  $('#mkGift').addEventListener('click', async () => {
    const it = selectedItem(), to = $('#mkGiftTo').value.trim();
    if (!it || !to) { $('#mkFormError').textContent = 'Choisis un objet et un joueur.'; return; }
    if (!(await ask(`Offrir ${GD.itemName(it, me.cls)} à ${to} ?`, { title: '🎁 Cadeau', ok: 'Offrir' }))) return;
    mkAction('/api/market/gift', { uid: it.uid, to }, `🎁 Objet offert à ${to} !`);
  });
  $('#mkLoadShowcase').addEventListener('click', async () => {
    $('#mkFormError').textContent = '';
    wantUid = null;
    try { showcase = await api('/api/players/' + encodeURIComponent($('#mkTradeTo').value.trim()) + '/items'); }
    catch (e) { showcase = null; $('#mkFormError').textContent = e.message; }
    renderShowcase(); renderMkPreview();
  });
  $('#mkTrade').addEventListener('click', async () => {
    const it = selectedItem();
    if (!it || !wantUid || !showcase) return;
    const ok = await mkAction('/api/market/trade', { give: it.uid, want: wantUid, to: showcase.pseudo, gold: Number($('#mkTradeGold').value) || 0 }, `🔄 Proposition envoyée à ${showcase.pseudo}`);
    if (ok) { showcase = null; wantUid = null; renderShowcase(); }
  });

  /* ============================== Amélioration de bâtiment ============================== */
  (function houseArt() {
    const cv = $('#houseArt');
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = cv.width, h = cv.height;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px';
    let t = 0;
    (function loop() {
      t += 1 / 60;
      if (me && !$('[data-view="house"]').classList.contains('hidden')) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const fam = GD.familyOf(me.cls);
        ctx.save(); ctx.translate(w / 2, h * 0.78); ctx.scale(1.9, 1.9);
        const v = GD.BUILDING_VARIANTS[me.cls];
        window.Art.drawBuilding(ctx, v ? v.key : fam, 0, 0, { hp: 1, t, color: GD.CLASSES[fam].color });
        ctx.restore();
        window.Art.drawHero(ctx, w / 2 + 70, h * 0.86, { cls: me.cls, look: me.look, gear: myGear(), t, scale: 1.4, moving: false, facing: Math.PI });
      }
      requestAnimationFrame(loop);
    })();
  })();

  function renderHouse() {
    const fam = GD.familyOf(me.cls);
    const def = GD.BUILDING_VARIANTS[me.cls] || GD.BUILDINGS.find((b) => b.family === fam) || GD.BUILDINGS[1];
    const hs = GD.houseOf(me);
    $('#houseTitle').textContent = `Mon habitation : ${def.name}`;
    $('#houseGold').replaceChildren(hail(), `${me.gold} Grêlons`);
    $('#houseStats').replaceChildren(
      el('div', { class: 'stat' }, el('b', {}, Math.round(GD.houseHp(me))), el('span', { class: 'small muted' }, '🧱 PV')),
      el('div', { class: 'stat' }, el('b', {}, `${Math.round(GD.houseHeal(me) * 100)}%`), el('span', { class: 'small muted' }, '🛏️ soin / s')),
      el('div', { class: 'stat' }, el('b', {}, hs.special[fam] || 0), el('span', { class: 'small muted' }, `${GD.HOUSE_SPECIALS[fam].icon} ${GD.HOUSE_SPECIALS[fam].name}`)));
    const card = (key, upg, lvl, nowTxt, nextTxt) => {
      const max = lvl >= upg.max;
      const cost = GD.houseCost(upg, lvl);
      return el('div', { class: 'attr' },
        el('span', { class: 'ico' }, upg.icon),
        el('div', { class: 'info' },
          el('div', {}, upg.name, ' ', el('span', { class: 'chip small' }, `niv. ${lvl}/${upg.max}`)),
          el('div', { class: 'small muted' }, `Actuel : ${nowTxt}`),
          max ? '' : el('div', { class: 'small' }, `Suivant : ${nextTxt}`)),
        max ? el('span', { class: 'chip small' }, 'Max')
          : el('button', { class: 'primary', disabled: me.gold < cost, onclick: () => buyHouse(key, upg.name) }, hail(), String(cost)));
    };
    const U = GD.HOUSE_UPGRADES, S = GD.HOUSE_SPECIALS[fam];
    const sl = hs.special[fam] || 0;
    $('#houseUpgrades').replaceChildren(
      card('hp', U.hp, hs.hp, U.hp.desc(U.hp.per * hs.hp), U.hp.desc(U.hp.per * (hs.hp + 1))),
      card('heal', U.heal, hs.heal, U.heal.desc(U.heal.per * hs.heal), U.heal.desc(U.heal.per * (hs.heal + 1))),
      card('special', S, sl, sl ? S.desc(fam === 'archer' ? sl : S.per * sl) : 'aucun effet', S.desc(fam === 'archer' ? sl + 1 : S.per * (sl + 1))),
      el('p', { class: 'small muted' }, 'Améliorations spéciales de tes autres classes : ' + (Object.entries(hs.special).filter(([f, v]) => v && f !== fam).map(([f, v]) => `${GD.HOUSE_SPECIALS[f].name} ${v}`).join(', ') || 'aucune')));
  }

  async function buyHouse(key, name) {
    $('#houseError').textContent = '';
    try { setUser((await api('/api/me/house', { body: { key } })).user); toast(`🏠 ${name} amélioré !`); }
    catch (e) { $('#houseError').textContent = e.message; }
  }

  /* ============================== Règles ============================== */
  function renderRules() {
    const PR = GD.PROGRESSION, G = GD.GLACONS;
    const voteEvery = (live && live.run && live.run.voteEvery) || 2;
    const sec = (title, ...kids) => el('div', { class: 'panel' }, el('h2', {}, title), ...kids);
    const ul = (items) => el('ul', {}, ...items.map((x) => el('li', {}, ...[].concat(x))));
    const table = (head, rows) => el('div', { class: 'table-wrap' }, el('table', {}, el('tr', {}, ...head.map((h) => el('th', {}, h))), ...rows.map((r) => el('tr', {}, ...r.map((c) => el('td', {}, c))))));
    const visible = GD.RARITIES.filter((r) => !r.hidden);
    $('#rules').replaceChildren(
      sec('🏰 Le but du jeu', el('p', {}, 'Une tour se dresse au centre de l’écran. Des vagues de monstres arrivent de tous les bords : si la tour (200 PV au départ) tombe, la partie est perdue. Il y a 100 manches à survivre.'),
        el('p', {}, 'Quand tu rejoins une bataille, la classe, les statistiques, les compétences, l’équipement et l’habitation de ton héros sont figés jusqu’à la fin de la partie (l’apparence et l’IA restent modifiables). Toutes les récompenses de la partie (XP, Grêlons, glaçons) sont versées à la fin de la partie, ou quand ton héros la quitte.'),
        el('p', {}, 'Ton héros se bat tout seul grâce à son IA. Toi, tu choisis sa classe, ses statistiques, son équipement et son comportement depuis ce site, et tu votes avec l’équipe.')),
      sec('⚡ Modes et difficultés', ul([
        `Classique : ${GD.MODES.classic.waves} manches.`,
        `Partie rapide : ${GD.MODES.quick.waves} manches, vote d’équipe à chaque manche, une seule zone dangereuse à la fois ; récompenses ×${GD.MODES.quick.rewards}.`,
        ...Object.values(GD.DIFFICULTIES).map((d) => `${d.icon} ${d.name} : monstres ×${d.mobHp} PV, ×${d.mobDmg} dégâts, ×${d.mobCount} nombre ; récompenses (XP, Grêlons) ×${d.rewards}.`),
        'L’admin choisit le mode et la difficulté au lancement de chaque partie.'])),
      sec('🧬 Classes', el('p', {}, `Tout le monde commence Paysan, au centre de l’arbre de compétences. Tu gagnes 1 point de compétence tous les ${PR.SKILL_EVERY} niveaux. Dès le niveau ${PR.CLASS_LEVEL}, place un point dans la branche d’une classe pour la devenir ; quand son initiation est à ${GD.SKILL_MAX_RANK}/${GD.SKILL_MAX_RANK}, place un point dans une sous-branche pour devenir cette spécialisation (5 compétences, puis l’ultime au niveau ${PR.ULT_LEVEL} et 2 compétences qui l’améliorent). Pour débloquer une compétence, il faut au moins 2 points dans la précédente. Les classes à invocations débloquent leurs créatures dans l’arbre : ${GD.SUMMON_CAP} invocations au plus, ${GD.SUMMON_CAP_MAX} avec la compétence d’après-ultime. Dès qu’un point est placé dans une branche, les autres sont grisées : la reconversion remet l’arbre à zéro (${Math.round(PR.SKILL_RESPEC_LOSS * 100)} % des points perdus).`),
        ul(GD.BASE_CLASSES.map((b) => [el('b', { style: `color:${GD.CLASSES[b].color}` }, GD.CLASSES[b].name), ` → ${GD.specsOf(b).map((s) => `${GD.CLASSES[s].name} (${GD.CLASSES[s].ultName})`).join(' / ')}${GD.CLASSES[b].leash ? ` · reste à moins de ${GD.CLASSES[b].leash} px de la tour` : ''}`]))),
      sec('📊 Niveaux & statistiques', el('p', {}, `Les éliminations et les manches passées rapportent de l’XP. Monter de niveau n’augmente pas directement les statistiques : chaque niveau donne ${PR.POINTS_PER_LEVEL} point de stat à répartir librement (réinitialisation gratuite) et ${PR.GLACONS_PER_LEVEL} glaçon 🧊. Seuls les points de stat et l’équipement renforcent ton héros :`),
        ul(GD.ATTR_IDS.map((a) => `${GD.ATTRIBUTES[a].icon} ${GD.ATTRIBUTES[a].name} : ${GD.ATTRIBUTES[a].desc}`))),
      sec('💰 Monnaies', ul([
        [hail(), el('b', {}, 'Grêlons'), ' : ta monnaie personnelle, gagnée en combattant et conservée entre les parties. Elle sert à acheter des glaçons, et tu en récupères en recyclant des objets.'],
        ['🪨🪵🫐 ', el('b', {}, 'Ressources (pierre, bois, baies)'), ` : en bataille, les héros récoltent automatiquement près des rochers, arbres et buissons de la carte (réserve de l’équipe, dépensée lors des votes ; la posture d’IA « Priorité à la récolte » s’y consacre). Une amélioration coûte la ressource principale de la tour (bois : attaque, pierre : défense, baies : soin) + 1/3 d’une autre ; la tour de mage demande deux ressources équilibrées. Dans les mini-jeux, elles vont sur ton compte.`]])),
      sec('🎲 Mini-jeux', ul([
        `Trois expéditions solo en temps réel, vues du dessus : ${Object.values(GD.MINI.MODES).map((m) => `${m.icon} ${m.name} (${GD.RESOURCES[m.res].icon} ${GD.RESOURCES[m.res].name.toLowerCase()})`).join(', ')}.`,
        `1 ⚡ par expédition ; 1 énergie toutes les ${GD.MINI.ENERGY_HOURS} h (${GD.MINI.ENERGY_MAX} au plus).`,
        'Commandes : ZQSD ou flèches (Maj : sprint) · clic gauche (maintenu) : attaquer vers la souris, ou récolter le point visé · clic droit (maintenu) : bouclier · E : compétence · A : potion · Espace : roulade (1 s d’invulnérabilité, 50 d’endurance) · F : seau / charrette · Échap : pause. Sur téléphone : joystick et boutons.',
        `Bouclier : il encaisse les coups avec ses points ; levé juste avant un coup, c’est une parade parfaite qui renvoie les dégâts (et les projectiles).`,
        `Chaque salle a ses points de récolte et ses monstres. La sortie apparaît au bout de ${GD.MINI.ROOMS.normal.exit} s (une cavité dans la caverne, une ouverture sur un côté ailleurs) ; ${GD.MINI.REINFORCE.after} s après l’entrée dans la salle (un peu plus en profondeur), des renforts arrivent toutes les ${GD.MINI.REINFORCE.every} s, sauf dans les salles d’élite et de gardien. Élite toutes les ${GD.MINI.ELITE_EVERY} salles, gardien de zone toutes les ${GD.MINI.BOSS_EVERY} : la sortie s’ouvre une fois vaincus, avec une récompense au choix.`,
        `Sac : ${GD.MINI.BAG.base} cases (1 case = ${GD.MINI.HARVEST.slot} ressources ou 1 butin de monstre). Vide-le dans le seau (caverne) ou la charrette (forêt, clairière), posé à un endroit au hasard de chaque salle ; « Renvoyer » met son contenu à l’abri (retour ${GD.MINI.CART.away} salles plus tard), « Rentrer » termine l’expédition (une fois les monstres de départ de la salle éliminés). Mort : tout le non-renvoyé est perdu, sauf ${Math.round(GD.MINI.DEATH_KEEP * 100)} % des ressources du sac.`,
        'Statistiques propres aux mini-jeux (PV, dégâts, armure, critique, bouclier ; vitesse et vitesse d’attaque avec les butins des monstres), améliorées avec les ressources ; le sac et le seau / la charrette s’agrandissent avec les butins des monstres. Une amélioration « Récolteur » par ressource augmente aussi ta récolte en défense de tour.',
        `🐾 Familiers : jusqu’à ${GD.PETS.ACTIVE_MAX} te suivent et se battent seuls. Adopte-les au chenil (${GD.PETS.KENNEL_PRICE} Grêlons) ou trouve un œuf (${Math.round(GD.PETS.EGG_CHANCE * 100)} % des récompenses d’élite et de gardien) : un monstre de la zone, avec une rareté. Leurs PV remontent avec le temps ; K.-O., ils se reposent jusqu’à ${Math.round(GD.PETS.REST_PCT * 100)} %. Niveau ${GD.PETS.MAIN_LEVEL} : ton familier principal te suit sur le stream.`])),
      sec('🏰 Bastion', ul([
        `Tower defense solo : une carte en cases générée au hasard à chaque partie (ta tour principale au milieu, un chemin toujours différent depuis un bord), des vagues de monstres, et entre deux vagues tout le temps qu’il faut pour construire. Une partie coûte ${GD.BASTION.PRICE} Grêlons, remboursés si tu atteins la manche ${GD.BASTION.REFUND_WAVE} ; survivre à la manche ${GD.BASTION.WIN_WAVE} = victoire (zone suivante débloquée, puis mode infini au choix).`,
        `Zones, de plus en plus difficiles : ${Object.values(GD.BASTION.ZONES).map((z) => `${z.icon} ${z.name}`).join(', puis ')} (chacune débloquée par une victoire dans la précédente), un gardien toutes les 10 manches.`,
        'Bâtiments d’attaque (avec leur zone d’attaque), de support, de production (bois, pierre) et de richesse (or) : 3 niveaux, puis une spécialisation au choix. Défricher un arbre ou un rocher coûte de l’or. La tour principale tire sur une grande zone et s’améliore : PV, tir, territoire constructible, niveau des bâtiments et capacités à lancer pendant les vagues.',
        'Synergies : deux bâtiments qui partagent un côté se renforcent (bannière ou phare et tours, scierie et arbres, carrière et rochers, marché entouré de commerces…).',
        `Plans : chaque zone a les siens ; chaque gardien vaincu en lâche un, tiré au hasard parmi ceux que tu n’as pas encore (jamais de doublon). Récompenses aussi : XP à chaque manche gagnée (versée en fin de partie) et ${Math.round(GD.BASTION.EGG_CHANCE * 100)} % de chances d’un œuf de familier par gardien. Le Bastion ne rapporte pas de ressources des mini-jeux.`,
        'Sur téléphone : plein écran en paysage (la carte est tournée si le téléphone reste en portrait) ; pince pour zoomer, glisse pour te déplacer.',
        'Une mélodie par zone (calme pendant la construction, rythmée pendant les vagues) et des bruitages pour chaque action ; volumes réglables avec le bouton 🔊.'])),
      sec('🏅 Succès et titres', ul([
        `${GD.ACHIEVEMENTS.length} succès en ${Object.keys(GD.ACH_CATS).length} catégories : ${Object.values(GD.ACH_CATS).map((c) => `${c.icon} ${c.name.toLowerCase()}`).join(', ')}.`,
        'Chaque succès débloque un titre (par exemple « Mangeur de glaçons » pour 500 glaçons ouverts). Équipe-le dans l’onglet Succès : il s’affiche au-dessus de ton héros sur le stream, dans le classement et en haut de ta page.',
        'Certains succès restent secrets tant que tu ne les as pas débloqués.'])),
      sec('🧊 Glaçons', ul([
        `Tu gagnes ${G.PER_WAVE} glaçon pour chaque manche passée avec ton héros en jeu.`,
        ['Un glaçon s’achète ', hail(), `${G.PRICE} Grêlons.`],
        `Chaque glaçon contient 1 objet (arme ou armure) : ${Math.round(G.UNIVERSAL_CHANCE * 100)}% une pièce d’un set universel, ${Math.round((1 - G.UNIVERSAL_CHANCE - G.OTHER_CLASS_CHANCE) * 100)}% une pièce du set de ta famille de classes, ${Math.round(G.OTHER_CLASS_CHANCE * 100)}% une pièce du set d’une autre classe (à échanger ou vendre sur la place marchande). Un habitant n’a pas encore de set : ses ${Math.round((1 - G.UNIVERSAL_CHANCE - G.OTHER_CLASS_CHANCE) * 100)}% vont aux pièces universelles. Un glaçon sur ${Math.round(1 / G.SCROLL_CHANCE)} environ contient à la place un 📜 Parchemin de mémoire, qui rend 1 point de compétence perdu en reconversion (vendable et échangeable).`,
        ['Recycler un objet rapporte des Grêlons : plus l’objet est rare, plus il en rapporte, au maximum le prix d’un glaçon (', hail(), `${G.PRICE}).`]])),
      sec('🏪 Place marchande', ul([
        'Mets tes objets en vente au prix que tu veux en Grêlons, éventuellement réservés à un joueur précis.',
        'Offre un objet à un autre joueur, ou propose-lui un échange : ton objet (+ des Grêlons si tu veux) contre un des siens.',
        'Un objet en vente ou proposé en échange ne peut pas être porté ni recyclé. Tu peux annuler à tout moment.'])),
      sec('💎 Raretés', el('p', {}, 'La rareté multiplie les bonus de l’objet et change son apparence.'),
        table(['Rareté', 'Probabilité', 'Bonus', 'Recyclage'], [
          ...(me.mysticFound ? GD.RARITIES : visible).map((r) => [el('b', { style: `color:${r.color}` }, r.name), fmtPct(r.p), `×${r.mult}`, [hail(), String(GD.recycleValue(GD.RARITIES.indexOf(r)))]])])),
      sec('🛡️ Sets d’équipement', el('p', {}, 'Il y a 5 emplacements : casque, torse, pantalon, chaussures et arme. Chaque famille de classes a son set (5 pièces, arme comprise), et 3 sets universels (5 pièces, arme comprise) sont portables par toutes les classes : leur arme prend la forme de l’arme de ta classe. L’Habitant a aussi ses propres armes (Milicien, Pèlerin). Porter plusieurs pièces d’un même set donne des bonus, quelle que soit leur rareté.'),
        table(['Set', 'Classes', 'Bonus'], Object.values(GD.SETS).map((s) => [el('b', {}, s.name), s.families ? s.families.map((f) => GD.CLASSES[f].name).join(', ') : 'Toutes',
          el('div', {}, ...(Object.keys(s.bonus).length ? Object.entries(s.bonus).map(([n, b]) => el('div', {}, `${n} pièces : ${bonusLine(b)}`)) : [el('span', { class: 'muted' }, 'Arme seule')]))]))),
      sec('🏠 Habitations', ul([
        'Un héros mort ne réapparaît pas : seul un vote « Résurrection » de l’équipe (proposé quand il y a au moins un mort) relève un héros mort au hasard, à 60 % de ses PV. Il continue de gagner les récompenses jusqu’à la fin de la partie.',
        `En bataille, chaque héros a son habitation, du type de sa classe (${GD.BALANCE.BUILDINGS_PER_CLASS} par classe au maximum ; au-delà, elle est partagée et les PV s’additionnent).`,
        'Entre les manches, chaque héros s’y soigne. Si elle est détruite, plus de soin jusqu’à la fin de la partie.',
        `Une reconversion remet les améliorations d’habitation à zéro et rembourse ${Math.round(GD.HOUSE_RESPEC_REFUND * 100)} % des Grêlons dépensés.`,
        'Onglet « Amélioration de bâtiment » : PV, puissance de soin (moyenne des occupants si partagée) et une amélioration spéciale par classe : ' + Object.entries(GD.HOUSE_SPECIALS).map(([f, sp]) => `${sp.icon} ${sp.name} (${GD.CLASSES[f].name})`).join(', ') + '.'])),
      sec('🗳️ Votes d’équipe', el('p', {}, `Toutes les ${voteEvery} manches, pendant la manche, les héros (et le chat Twitch) votent pour dépenser les ressources de l’équipe (🪨 pierre, 🪵 bois, 🫐 baies, récoltées sur la carte). Le vote reste ouvert pendant l’entracte ; l’option la plus votée est appliquée au début de la manche suivante :`),
        el('p', {}, 'Le premier vote choisit la spécialisation de la tour (gratuit). Ensuite, chaque vote propose 2 de ses 8 améliorations, le Pacte de sang et « Économiser » (+ la Résurrection s’il y a un mort).'),
        ...Object.entries(GD.TOWER_SPECS).map(([k, T]) => el('div', {}, el('b', { style: `color:${T.color}` }, `${T.icon} ${T.name}`), ` — ${T.desc}`,
          ul(Object.values(GD.UPGRADES).filter((u) => u.tower === k).map((u) => `${u.icon} ${u.name} : ${u.desc} (${u.max} niv.)`)))),
        ul([`${GD.UPGRADES.pact.icon} ${GD.UPGRADES.pact.name} : ${GD.UPGRADES.pact.desc}`, `${GD.UPGRADES.nature.icon} ${GD.UPGRADES.nature.name} (proposée au hasard quand la carte a été récoltée) : ${GD.UPGRADES.nature.desc}`, `${GD.UPGRADES.revive.icon} ${GD.UPGRADES.revive.name} : ${GD.UPGRADES.revive.desc} (coûte des baies)`])),
      // pas de détails sur l'évolution du terrain ni sur les boss : c'est une surprise pour les joueurs
      sec('🌍 Le monde', el('p', {}, 'Le monde autour de la tour ne restera pas longtemps paisible… À vous de découvrir ce qui vous attend.'))
    );
  }

  /* ============================== IA ============================== */
  const AI_TITLES = { stance: '🗺️ Posture', target: '🎯 Cible prioritaire', ult: '✨ Utilisation de l’ultime' };
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
      setUser((await api('/api/me/ai', { method: 'PUT', body: { [key]: val } })).user);
      $('#aiNotice').textContent = 'IA mise à jour ✓';
      setTimeout(() => ($('#aiNotice').textContent = ''), 1500);
    } catch (e) { toast(e.message); }
  }

  /* ============================== Classement & compte ============================== */
  async function loadLadder() {
    const { top } = await api('/api/leaderboard');
    $('#ladder').replaceChildren(
      el('tr', {}, el('th', {}, '#'), el('th', {}, 'Pseudo'), el('th', {}, 'Classe'), el('th', {}, 'Niveau'), el('th', {}, 'Meilleure manche'), el('th', {}, 'Éliminations')),
      ...top.map((u, i) => el('tr', {}, el('td', {}, i + 1), el('td', {}, u.pseudo, u.title ? el('div', { class: 'tiny ach-title' }, `« ${u.title} »`) : ''), el('td', { style: `color:${GD.CLASSES[u.cls].color}` }, GD.CLASSES[u.cls].name), el('td', {}, u.level), el('td', {}, u.bestWave), el('td', {}, u.kills)))
    );
  }

  /* ---------- Liaison Twitch ---------- */
  let twitchChannel = 'hyoneko_';
  fetch('/api/info').then((r) => r.json()).then((d) => { if (d.twitch) { twitchChannel = d.twitch; if (me) renderTwitch(); } renderSubRewards(d); }).catch(() => {});
  // Onglet Compte : ce que rapportent les abonnements Twitch
  function renderSubRewards(d) {
    const sub = d.subGrelons || 0, gift = d.giftGrelons || 0;
    const row = (icon, label, amount, note) => el('div', { class: 'reward-line' }, el('span', {}, `${icon} ${label}`, note ? el('div', { class: 'tiny muted' }, note) : ''), el('b', {}, hail(), ` ${amount} Grêlons`));
    const glaces = (n) => Math.floor(n / GD.GLACONS.PRICE);
    $('#subRewards').replaceChildren(el('div', { class: 'reward-list' },
      row('⭐', 'Abonnement palier 1 ou Prime', sub, `Réabonnements compris · soit ${glaces(sub)} glaçon(s)`),
      row('⭐⭐', 'Abonnement palier 2', sub * 2, '×2'),
      row('⭐⭐⭐', 'Abonnement palier 3', sub * 5, '×5'),
      row('🎁', 'Abonnement offert à quelqu’un', gift, 'Par abonnement offert, pour celui qui l’offre (même multiplicateur selon le palier)')),
      el('p', { class: 'small muted', style: 'margin-top:8px' }, 'Pas encore lié ? Tes Grêlons sont mis de côté et versés dès que tu lies ton compte Twitch ci-dessus (!lier CODE). Les dons anonymes ne rapportent rien.'));
  }
  let twitchCode = null;
  function renderTwitch() {
    $('#twitchLink').textContent = `twitch.tv/${twitchChannel}`;
    $('#twitchLink').href = `https://twitch.tv/${twitchChannel}`;
    if (me.twitchName) {
      $('#twitchState').replaceChildren(el('p', {}, '✅ Lié au compte Twitch ', el('b', {}, me.twitchName), '. Tape ', el('b', {}, '!join'), ' dans le chat pour rejoindre une bataille.'),
        el('button', { class: 'small', onclick: async () => { if (await ask('Ton compte ne sera plus lié à ton pseudo Twitch.', { title: 'Délier ton compte Twitch ?', ok: 'Délier', danger: true })) setUser((await api('/api/me/twitch/unlink', { method: 'POST' })).user); } }, 'Délier'));
      return;
    }
    $('#twitchState').replaceChildren(
      twitchCode ? el('p', { class: 'twitch-code' }, 'Tape ', el('b', {}, `!lier ${twitchCode}`), ` dans le chat de `, el('a', { href: `https://twitch.tv/${twitchChannel}`, target: '_blank', rel: 'noopener' }, `twitch.tv/${twitchChannel}`), ' (code valable 10 minutes). Cette page se met à jour toute seule.') : '',
      el('button', { class: 'primary', onclick: async () => { const d = await api('/api/me/twitch/code', { method: 'POST' }); twitchCode = d.code; twitchChannel = d.channel; renderTwitch(); } }, twitchCode ? 'Nouveau code' : '🔗 Lier mon compte Twitch'));
  }

  /* ============================== Succès et titres ============================== */
  // Succès déjà vus (pastille de l'onglet), retenus dans le navigateur
  let achFilter = 'tous';
  const achSeenKey = () => `achSeen:${me.id}`;
  function achSeen() { try { return new Set(JSON.parse(localStorage.getItem(achSeenKey()) || '[]')); } catch (e) { return new Set(); } }
  function markAchSeen() { if (!me || !me.ach) return; try { localStorage.setItem(achSeenKey(), JSON.stringify(Object.keys(me.ach.done))); } catch (e) { /* */ } }
  const fmtN = (n) => String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
  async function setTitle(id) {
    try { setUser((await api('/api/me/title', { body: { id } })).user); toast(id ? 'Titre équipé ✓' : 'Titre retiré'); } catch (e) { toast(e.message); }
  }
  function renderAch() {
    const root = $('#achRoot');
    if (!root || !me || !me.ach) return;
    const S = me.ach, all = GD.ACHIEVEMENTS, done = S.done || {}, n = Object.keys(done).length;
    // pastille : succès débloqués pas encore vus (la première fois, tout est considéré comme vu)
    let known = true;
    try { known = localStorage.getItem(achSeenKey()) !== null; } catch (e) { /* stockage indisponible */ }
    if (!known) markAchSeen();
    const seen = achSeen(), visible = !$('[data-view="ach"]').classList.contains('hidden');
    const fresh = visible ? 0 : Object.keys(done).filter((id) => !seen.has(id)).length;
    $('#achBadge').textContent = fresh; $('#achBadge').classList.toggle('hidden', !fresh);
    if (visible) setTimeout(markAchSeen, 0); // onglet ouvert : les nouveaux succès sont vus (surlignés une fois)
    const cur = S.title && all.find((a) => a.id === S.title);
    const card = (a) => {
      const ok = !!done[a.id], hidden = a.hidden && !ok, v = S.v[a.stat] || 0, pct = Math.max(0, Math.min(100, (100 * v) / a.goal));
      const worn = S.title === a.id;
      return el('div', { class: 'ach-card' + (ok ? ' done' : '') + (hidden ? ' secret' : '') + (ok && !seen.has(a.id) ? ' fresh' : '') },
        el('div', { class: 'ach-icon' }, hidden ? '❔' : a.icon),
        el('div', { class: 'ach-body' },
          el('b', {}, hidden ? 'Succès secret' : a.name),
          el('div', { class: 'small muted' }, hidden ? '???' : a.desc),
          ok ? el('div', { class: 'tiny muted' }, `✓ Débloqué le ${new Date(done[a.id]).toLocaleDateString('fr-FR')}`)
            : el('div', { class: 'ach-prog' }, el('div', { class: 'bar' }, el('span', { style: `width:${pct}%` })), el('span', { class: 'tiny muted' }, `${fmtN(Math.min(v, a.goal))} / ${fmtN(a.goal)}`)),
          el('div', { class: 'ach-title-line' },
            el('span', { class: 'ach-title' + (ok ? '' : ' locked') }, hidden ? '🏷️ « ??? »' : `🏷️ « ${a.title} »`),
            ok ? el('button', { class: 'small' + (worn ? ' primary' : ''), onclick: () => setTitle(worn ? null : a.id) }, worn ? '✓ Équipé' : 'Équiper') : '')));
    };
    const keep = (a) => (achFilter === 'faits' ? !!done[a.id] : achFilter === 'afaire' ? !done[a.id] : true);
    const filterBtn = (k, label) => el('button', { class: 'small' + (achFilter === k ? ' selected' : ''), onclick: () => { achFilter = k; renderAch(); } }, label);
    root.replaceChildren(
      el('div', { class: 'panel' },
        el('h2', {}, '🏅 Succès et titres'),
        el('div', { class: 'row ach-head' },
          el('div', { class: 'ach-count' }, el('b', {}, `${n} / ${all.length}`), el('span', { class: 'small muted' }, ' succès débloqués'),
            el('div', { class: 'bar gold' }, el('span', { style: `width:${(100 * n) / all.length}%` }))),
          el('span', { class: 'spacer' }),
          el('div', {}, el('span', { class: 'small muted' }, 'Titre affiché : '), cur ? el('b', { class: 'ach-title' }, `« ${cur.title} »`) : el('span', { class: 'muted' }, 'aucun'),
            cur ? el('button', { class: 'small', style: 'margin-left:8px', onclick: () => setTitle(null) }, 'Retirer') : '')),
        el('p', { class: 'small muted' }, 'Chaque succès débloque un titre. Le titre équipé s’affiche au-dessus de ton héros sur le stream, dans le classement et en haut de ta page.'),
        el('div', { class: 'row' }, filterBtn('tous', 'Tous'), filterBtn('faits', '✓ Débloqués'), filterBtn('afaire', 'À débloquer'))),
      ...Object.entries(GD.ACH_CATS).map(([cat, C]) => {
        const list = all.filter((a) => a.cat === cat), got = list.filter((a) => done[a.id]).length, shown = list.filter(keep);
        if (!shown.length) return '';
        return el('div', { class: 'panel' }, el('h3', { class: 'ach-cat' }, `${C.icon} ${C.name}`, el('span', { class: 'small muted' }, ` · ${got} / ${list.length}`)),
          el('div', { class: 'ach-grid' }, ...shown.map(card)));
      }));
  }

  function renderStats() {
    renderTwitch();
    const s = me.stats;
    $('#myStats').replaceChildren(...[['Parties', s.runs], ['Meilleure manche', s.bestWave], ['Éliminations', s.kills], ['Boss vaincus', s.bossKills], ['Morts', s.deaths], ['Grêlons 🧊', me.gold]]
      .map(([k, v]) => el('div', { class: 'stat' }, el('b', {}, v), el('span', { class: 'small muted' }, k))));
  }

  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#pwError').textContent = ''; $('#pwOk').textContent = '';
    try { await api('/api/me/password', { body: { current: $('#pwCur').value, next: $('#pwNew').value } }); $('#pwOk').textContent = 'Mot de passe modifié ✓'; e.target.reset(); }
    catch (err) { $('#pwError').textContent = err.message; }
  });

  // rafraîchit le profil (XP, Grêlons) régulièrement pendant la bataille
  setInterval(async () => {
    if (!me || document.hidden) return;
    try {
      const d = await api('/api/me');
      const changed = d.user.level !== me.level || d.user.cls !== me.cls;
      me = d.user;
      if (!changed) renderEquip();
      if (!changed) renderAttrs();
      $('#hdrLevel').textContent = `Niv. ${me.level}`;
      $('#xpBar').style.width = `${(100 * me.xp) / me.xpNext}%`;
      $('#xpLabel').textContent = `${me.xp} / ${me.xpNext} XP`;
      if (changed) renderAll();
    } catch (e) { /* hors ligne */ }
  }, 5000);
})();
