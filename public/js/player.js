/* Interface joueur : compte, personnalisation, IA et choix en direct pendant la bataille */
(function () {
  'use strict';
  const GD = window.GameData, P = GD.PALETTE;
  if (window.Art && window.Art.setDetail) window.Art.setDetail(true); // même rendu que le stream
  const { api, $, $$, el, toast, heroCanvas, balanceReady, onBalance } = window.UI;

  let me = null;
  let live = null; // dernier état envoyé par le serveur
  let socket = null;
  let authMode = 'login';

  /* ============================== Authentification ============================== */
  // Héros de démonstration (écran de connexion) : un set complet par classe, raretés variées
  const DEMO_SETS = ['rempart', 'arcaniste', 'faucon', 'maitrebete', 'lamenuit', 'moisson'];
  const DEMO_GEAR = DEMO_SETS.map((sid, i) => Object.fromEntries(GD.SLOTS.map((s) => [s, GD.TEMPLATES[`${sid}_${s}`] ? { t: `${sid}_${s}`, r: [3, 2, 1, 5, 2, 4][i] } : null])));
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

  balanceReady.then(() => api('/api/me')).then((d) => start(d.user)).catch(() => $('#auth').classList.remove('hidden'));

  /* ============================== Démarrage ============================== */
  function start(user) {
    me = user;
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    if (me.role === 'admin') $('#hdrAdmin').classList.remove('hidden');
    heroCanvas($('#battleArt'), () => (me ? { cls: me.cls, look: me.look, gear: myGear(), dead: live && live.hero && !live.hero.alive, zombie: live && live.hero && live.hero.zombie } : null));
    heroCanvas($('#gearArt'), () => (me ? { cls: me.cls, look: me.look, gear: myGear() } : null));
    heroCanvas($('#equipArt'), () => (me ? { cls: me.cls, look: me.look, gear: myGear() } : null));
    connect();
    renderAll();
    renderXp({ level: me.level, xp: me.xp, xpNext: me.xpNext, attrPoints: me.attrPoints });
  }

  function setUser(u) { me = u; renderAll(); }

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
    // l'admin a modifié l'équilibrage : on rafraîchit l'affichage (stats, règles, prix…)
    let balT = null;
    onBalance(socket, () => { clearTimeout(balT); balT = setTimeout(async () => { try { setUser((await api('/api/me')).user); } catch (e) { renderAll(); } }, 300); });
    socket.on('state', (s) => { live = s; renderLive(); });
    // notifications (achat, don, échange…)
    socket.on('notify', async (text) => {
      toast(text);
      try { setUser((await api('/api/me')).user); } catch (e) { /* */ }
      if (!$('[data-view="market"]').classList.contains('hidden')) loadMarket();
    });
    socket.on('connect_error', () => {});
  }

  /* ============================== Onglets ============================== */
  $$('#tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
    $$('#tabs [data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    $$('[data-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== b.dataset.tab));
    if (b.dataset.tab === 'ladder') loadLadder();
    if (b.dataset.tab === 'market') loadMarket();
  }));

  function renderAll() {
    const c = GD.CLASSES[me.cls];
    $('#hdrPseudo').textContent = me.pseudo;
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
        el('div', { class: 'stat' }, el('b', {}, '🪙 ' + r.treasury), el('span', { class: 'small muted' }, 'écus de l’équipe'))
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
      $('#voteTimer').textContent = `${Math.max(0, Math.ceil((v.endsAt - Date.now()) / 1000))} s`;
      const sig = JSON.stringify([v.options.map((o) => o.id), v.counts, v.mine, r.treasury]);
      if (sig !== lastVoteSig) {
        lastVoteSig = sig;
        $('#voteOpts').replaceChildren(...v.options.map((o) => {
          const up = GD.UPGRADES[o.id];
          const isSave = o.id === 'save';
          const afford = isSave || !o.cost || o.cost <= r.treasury;
          return el('button', { class: 'option' + (o.id === 'pact' ? ' challenge' : '') + (v.mine === o.id ? ' voted' : ''), disabled: !afford, onclick: () => socket.emit('vote', o.id) },
            el('span', { class: 'icon' }, isSave ? '🪙' : up.icon),
            el('span', { class: 'name' }, isSave ? 'Économiser' : `${up.name}${o.level && !up.revive ? ` (niv. ${o.level + 1})` : ''}`),
            el('span', { class: 'desc' }, isSave ? 'Garder les écus pour plus tard' : up.desc),
            el('span', { class: 'desc', style: 'display:block;margin-top:6px;color:var(--gold)' }, `${o.cost ? '🪙 ' + o.cost + ' écus · ' : ''}${v.counts[o.id] || 0} vote(s)`));
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

    // Carte d'une compétence (passive à rangs, ultime ou maîtrise)
    const node = (n, opts = {}) => {
      const rank = sk[n.id] || 0;
      const unlocked = (!n.requires || sk[n.requires]) && !opts.locked;
      const levelOk = !n.ult || me.level >= PR.ULT_LEVEL;
      const canBuy = pts.free > 0 && unlocked && levelOk && rank < n.max;
      if (n.ult) {
        const S = GD.CLASSES[n.spec];
        return el('div', { class: 'skill ult' + (rank ? ' owned' : '') + (unlocked ? '' : ' locked') },
          el('div', { class: 'skill-name' }, `✨ ${S.ultName}`),
          el('div', { class: 'small' }, S.ultDesc),
          el('div', { class: 'small muted' }, `Ultime · niveau ${PR.ULT_LEVEL} requis · fait devenir ${S.name}.`),
          rank ? el('span', { class: 'chip small' }, 'Débloqué')
            : el('button', { class: 'small primary', disabled: !canBuy, onclick: () => learn(n, S) }, !unlocked ? '🔒' : !levelOk ? `🔒 Niveau ${PR.ULT_LEVEL}` : 'Débloquer (1 pt)'));
      }
      return el('div', { class: 'skill' + (rank ? ' owned' : '') + (unlocked ? '' : ' locked') + (n.mastery ? ' mastery' : '') },
        el('div', { class: 'row', style: 'gap:6px' }, el('span', { class: 'skill-name' }, n.name), el('span', { class: 'spacer' }), el('span', { class: 'chip small' }, `${rank}/${n.max}`)),
        el('div', { class: 'small muted' }, `${bonusLine(n.bonus)} par rang`),
        el('button', { class: 'small' + (canBuy ? ' primary' : ''), disabled: !canBuy, onclick: () => learn(n) }, !unlocked ? '🔒' : rank >= n.max ? 'Max' : '+1'));
    };

    // Habitant : arbre d'initiation + choix de la classe au niveau CLASS_LEVEL
    if (cur.tier === 0) {
      const can = me.level >= PR.CLASS_LEVEL;
      $('#evoHint').replaceChildren(
        el('div', {}, `Tu es « Habitant ». Entraîne-toi dans l’arbre d’initiation, puis choisis ta classe au niveau ${PR.CLASS_LEVEL}. `,
          el('b', { style: 'color:var(--gold)' }, `${pts.free} point(s) de compétence`), ` (1 tous les ${PR.SKILL_EVERY} niveaux).`),
        el('div', { class: 'small muted' }, 'Quand tu choisis ta classe, l’initiation de cette classe est conservée et les points des autres initiations te sont rendus.'));
      tree.className = 'tree skilltree';
      tree.replaceChildren(...GD.BASE_CLASSES.map((base) => {
        const b = GD.CLASSES[base];
        return el('div', { class: 'branch', style: `--bc:${b.color}` },
          el('div', { class: 'cls' }, miniHero(base),
            el('div', {},
              el('div', { class: 'title', style: `color:${b.color}` }, b.name),
              el('div', { class: 'small muted' }, b.desc),
              el('div', { class: 'small muted' }, 'Spécialisations : ' + GD.specsOf(base).map((s) => GD.CLASSES[s].name).join(' ou ')),
              b.leash ? el('div', { class: 'small muted' }, `Reste à moins de ${b.leash} px de la tour.`) : '')),
          el('div', { class: 'skill-col' }, node(GD.SKILLS[`init_${base}`])),
          el('button', { class: 'primary', style: 'margin-top:10px;width:100%', disabled: !can, onclick: () => pickClass(base) }, can ? 'Devenir ' + b.name : `🔒 Niveau ${PR.CLASS_LEVEL}`));
      }));
      return;
    }

    // Classe choisie : initiation + une seule branche de spécialisation
    const base = GD.familyOf(me.cls);
    const started = GD.startedBranch(sk);
    const lossNow = Math.floor(pts.spent * PR.SKILL_RESPEC_LOSS);
    $('#evoHint').replaceChildren(
      el('span', {}, 'Classe : ', el('b', { style: `color:${cur.color}` }, cur.name), ' · '),
      el('b', { style: 'color:var(--gold)' }, `${pts.free} point(s) de compétence`), ` à dépenser (1 tous les ${PR.SKILL_EVERY} niveaux · ${pts.spent} attribué(s)${pts.lost ? ` · ${pts.lost} perdu(s) en reconversion` : ''}).`,
      el('div', { class: 'small muted', style: 'margin-top:4px' }, started
        ? `Voie choisie : ${GD.CLASSES[started].name}. Les autres branches sont bloquées. Ultime au niveau ${PR.ULT_LEVEL}.`
        : `Choisis ta voie : dès que tu places un point dans une branche, l’autre se bloque. Ultime au niveau ${PR.ULT_LEVEL}.`),
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('button', { class: 'small danger', onclick: () => respec(lossNow) }, `🔄 Se reconvertir (perte de ${lossNow} point${lossNow > 1 ? 's' : ''})`)));
    tree.className = 'tree skilltree';
    tree.replaceChildren(
      el('div', { class: 'branch', style: `--bc:${GD.CLASSES[base].color}` },
        el('div', { class: 'title', style: `color:${GD.CLASSES[base].color}` }, `Initiation : ${GD.CLASSES[base].name}`),
        el('div', { class: 'skill-col' }, node(GD.SKILLS[`init_${base}`]))),
      ...GD.specsOf(base).map((spec) => {
        const S = GD.CLASSES[spec];
        const locked = !!started && started !== spec;
        const ids = [1, 2, 3, 4, 5, 'ult', 'mastery'].map((i) => GD.SKILLS[`${spec}_${i}`]);
        return el('div', { class: 'branch' + (started === spec ? ' current' : '') + (locked ? ' branch-locked' : ''), style: `--bc:${S.color}` },
          el('div', { class: 'cls' }, miniHero(spec, 48), el('div', {}, el('div', { class: 'title', style: `color:${S.color}` }, S.name, me.cls === spec ? ' ✓' : '', locked ? ' 🔒' : ''), el('div', { class: 'small muted' }, S.desc))),
          el('div', { class: 'skill-col' }, ...ids.map((n) => node(n, { locked }))));
      }));
  }

  async function learn(n, S) {
    $('#clsError').textContent = '';
    if (n.ult && !confirm(`Débloquer « ${S.ultName} » et devenir ${S.name} ?`)) return;
    try { setUser((await api('/api/me/skill', { body: { id: n.id } })).user); if (n.ult) toast(`Tu es maintenant ${S.name} !`); }
    catch (e) { $('#clsError').textContent = e.message; }
  }

  async function respec(loss) {
    $('#clsError').textContent = '';
    const choices = GD.BASE_CLASSES.map((b, i) => `${i + 1}. ${GD.CLASSES[b].name}`).join('\n');
    const ans = prompt(`Reconversion : ton arbre est remis à zéro et tu perds définitivement ${loss} point(s) de compétence (le quart de tes points attribués).\nTes améliorations d’habitation sont aussi remises à zéro : ${Math.floor(GD.houseSpent(me) * GD.HOUSE_RESPEC_REFUND)} Grêlons te sont remboursés (75 %).\n\nNouvelle classe (laisse vide pour garder ${GD.CLASSES[GD.familyOf(me.cls)].name}) :\n${choices}`, '');
    if (ans === null) return;
    const idx = Number(ans) - 1;
    const cls = GD.BASE_CLASSES[idx] || null;
    if (ans.trim() && !cls) { $('#clsError').textContent = 'Choix invalide.'; return; }
    try { const d = await api('/api/me/respec', { body: { cls } }); setUser(d.user); toast(`Reconversion effectuée (−${d.lost} point${d.lost > 1 ? 's' : ''}${d.refund ? `, +${d.refund} Grêlons remboursés` : ''}).`); }
    catch (e) { $('#clsError').textContent = e.message; }
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
    if (!confirm('Récupérer tous tes points de stat ?')) return;
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
    return el('div', { class: 'inv-item' + (usable || opts.noLock ? '' : ' locked') + (opts.worn ? ' worn' : ''), style: `--rc:${rarColor(it.r)}` },
      itemCanvas(it),
      el('div', { class: 'meta' },
        el('span', { class: 'rtag' }, rarName(it.r)),
        el('b', {}, GD.itemName(it, me.cls)),
        el('span', { class: 'muted' }, statsText(it)),
        el('div', { class: 'muted' }, `Set ${GD.SETS[t.set].name}${t.families ? ' (' + t.families.map((f) => GD.CLASSES[f].name).join(', ') + ')' : ' (toutes classes)'}${usable ? '' : ' · pas pour ta classe'}`),
        ...(opts.lines || []).map((l) => el('div', { class: 'small' }, l))),
      opts.buttons ? el('div', { class: 'btns' }, ...opts.buttons) : '');
  }
  const hail = () => el('span', { class: 'hail', 'aria-hidden': 'true' });
  const fmtPct = (x) => `${Math.round(x * 1000) / 10}%`;

  function wornUids() { return new Set(Object.values(me.equip || {})); }

  // Aperçu du héros portant un objet donné
  function itemCanvas(item, w, h, scale) {
    const cv = el('canvas', { width: w || 48, height: h || 56 });
    const slot = GD.TEMPLATES[item.t].slot;
    const gear = { ...myGear(), [slot]: { t: item.t, r: item.r } };
    heroCanvas(cv, () => ({ cls: me.cls, look: me.look, gear, moving: false }), { scale: scale || 0.95, static: true, y: 0.93 });
    return cv;
  }

  function statsText(item) {
    const st = GD.itemStats(item);
    return Object.entries(st).map(([k, v]) => `+${Math.round(v * 100)}% ${GD.STAT_NAMES[k]}`).join(' · ');
  }
  function bonusLine(b) { return Object.entries(b).map(([k, v]) => `+${Math.round(v * 100)}% ${GD.STAT_NAMES[k]}`).join(', '); }

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
    $('#setInfo').replaceChildren(...(sets.length ? sets.map(([sid, cnt]) => {
      const set = GD.SETS[sid];
      const total = set.families ? 5 : 4;
      return el('div', { style: 'margin-bottom:6px' }, el('b', { style: `color:${set.main === '#2b2433' ? 'var(--text)' : set.main}` }, `Set ${set.name} (${cnt}/${total})`),
        ...Object.entries(set.bonus).map(([need, b]) => el('div', { class: cnt >= need ? '' : 'muted' }, `${cnt >= need ? '✅' : '▫️'} ${need} pièces : ${bonusLine(b)}`)));
    }) : [el('span', { class: 'muted' }, 'Porte plusieurs pièces d’un même set pour obtenir des bonus.')]));

    // inventaire
    const inv = me.inventory.slice().sort((a, b) => b.r - a.r || (b.at || 0) - (a.at || 0));
    $('#invCount').textContent = `${inv.length} objet(s)`;
    $('#invTabs').replaceChildren(...['all', ...GD.SLOTS].map((s) => el('button', { class: 'small' + (s === invFilter ? ' active' : ''), onclick: () => { invFilter = s; renderEquip(); } },
      s === 'all' ? 'Tout' : `${SLOT_ICONS[s]} ${GD.SLOT_NAMES[s]}`)));
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
          isWorn ? el('button', { class: 'small', onclick: () => equip(null, t.slot) }, 'Retirer')
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
  async function recycle(it) {
    if (it.r >= 3 && !confirm(`Recycler cet objet ${rarName(it.r).toLowerCase()} contre ${GD.recycleValue(it.r)} Grêlons ?`)) return;
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
  $('#openIce').addEventListener('click', openIce);

  /* ---------- Animation : le glaçon tremble, se fissure, puis éclate ---------- */
  const SHARDS = [[0, 0, 50, 0], [50, 0, 100, 0], [100, 0, 100, 50], [100, 50, 100, 100], [100, 100, 50, 100], [50, 100, 0, 100], [0, 100, 0, 50], [0, 50, 0, 0]];
  // « Passer l'animation » : les attentes en cours se terminent aussitôt
  let skipIce = false, skipWake = null;
  const sleep = (ms) => (skipIce ? Promise.resolve() : new Promise((r) => { const id = setTimeout(r, ms); skipWake = () => { clearTimeout(id); r(); }; }));
  $('#iceSkip').addEventListener('click', (e) => { e.stopPropagation(); skipIce = true; if (skipWake) skipWake(); });
  let opening = false;

  async function openIce() {
    if (opening || !me.glacons) return;
    opening = true;
    skipIce = false;
    $('#iceSkip').classList.remove('hidden');
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
      el('div', { class: 'small muted' }, `${GD.SLOT_NAMES[t.slot]} · Set ${GD.SETS[t.set].name}`),
      el('div', { class: 'small', style: 'margin:6px 0 12px' }, statsText(item)),
      el('div', { class: 'row', style: 'justify-content:center' },
        usableNow ? el('button', { class: 'primary', onclick: async () => { await equip(item.uid); closeIce(); } }, 'Équiper') : '',
        me.glacons ? el('button', { onclick: () => { opening = false; openIce(); } }, `🧊 Encore (${me.glacons})`) : '',
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
    if (!confirm(`Acheter ${GD.itemName(l.item, me.cls)} pour ${l.price} Grêlons ?`)) return;
    mkAction('/api/market/buy', { id: l.id }, 'Objet acheté ! Il est dans ton inventaire.');
  }
  $('#mkSell').addEventListener('click', () => {
    const it = selectedItem();
    if (!it) { $('#mkFormError').textContent = 'Choisis un objet.'; return; }
    mkAction('/api/market/sell', { uid: it.uid, price: Number($('#mkPrice').value), reservedFor: $('#mkReserved').value.trim() || null }, 'Objet mis en vente 🏪');
  });
  $('#mkGift').addEventListener('click', () => {
    const it = selectedItem(), to = $('#mkGiftTo').value.trim();
    if (!it || !to) { $('#mkFormError').textContent = 'Choisis un objet et un joueur.'; return; }
    if (!confirm(`Offrir ${GD.itemName(it, me.cls)} à ${to} ?`)) return;
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
      sec('🧬 Classes', el('p', {}, `Tout le monde commence Habitant, avec un arbre d’initiation (une compétence liée à chaque classe). Au niveau ${PR.CLASS_LEVEL}, choisis ta classe : son initiation est conservée, les points des autres te sont rendus. Tu gagnes 1 point de compétence tous les ${PR.SKILL_EVERY} niveaux. L’arbre de ta classe a une branche par spécialisation : 5 compétences passives (3 rangs), l’ultime au bout (niveau ${PR.ULT_LEVEL} requis, il te fait devenir la spécialisation), puis une maîtrise. Dès que tu places un point dans une branche, les autres se bloquent. La reconversion remet tout à zéro (changement de classe possible) mais fait perdre ${Math.round(PR.SKILL_RESPEC_LOSS * 100)}% des points attribués.`),
        ul(GD.BASE_CLASSES.map((b) => [el('b', { style: `color:${GD.CLASSES[b].color}` }, GD.CLASSES[b].name), ` → ${GD.specsOf(b).map((s) => `${GD.CLASSES[s].name} (${GD.CLASSES[s].ultName})`).join(' / ')}${GD.CLASSES[b].leash ? ` · reste à moins de ${GD.CLASSES[b].leash} px de la tour` : ''}`]))),
      sec('📊 Niveaux & statistiques', el('p', {}, `Les éliminations et les manches passées rapportent de l’XP. Monter de niveau n’augmente pas directement les statistiques : chaque niveau donne ${PR.POINTS_PER_LEVEL} point de stat à répartir librement (réinitialisation gratuite) et ${PR.GLACONS_PER_LEVEL} glaçon 🧊. Seuls les points de stat et l’équipement renforcent ton héros :`),
        ul(GD.ATTR_IDS.map((a) => `${GD.ATTRIBUTES[a].icon} ${GD.ATTRIBUTES[a].name} : ${GD.ATTRIBUTES[a].desc}`))),
      sec('💰 Monnaies', ul([
        [hail(), el('b', {}, 'Grêlons'), ' : ta monnaie personnelle, gagnée en combattant et conservée entre les parties. Elle sert à acheter des glaçons, et tu en récupères en recyclant des objets.'],
        ['🪙 ', el('b', {}, 'Écus'), ' : le trésor commun de l’équipe pendant une partie (éliminations, récoltes des paysans). Il est dépensé lors des votes.']])),
      sec('🧊 Glaçons', ul([
        `Tu gagnes ${G.PER_WAVE} glaçon pour chaque manche passée avec ton héros en jeu.`,
        ['Un glaçon s’achète ', hail(), `${G.PRICE} Grêlons.`],
        `Chaque glaçon contient 1 objet (arme ou armure) : ${Math.round(G.UNIVERSAL_CHANCE * 100)}% une pièce d’un set universel, ${Math.round((1 - G.UNIVERSAL_CHANCE - G.OTHER_CLASS_CHANCE) * 100)}% une pièce du set de ta famille de classes, ${Math.round(G.OTHER_CLASS_CHANCE * 100)}% une pièce du set d’une autre classe (à échanger ou vendre sur la place marchande). Un habitant n’a pas encore de set : ses ${Math.round((1 - G.UNIVERSAL_CHANCE - G.OTHER_CLASS_CHANCE) * 100)}% vont aux pièces universelles.`,
        ['Recycler un objet rapporte des Grêlons : plus l’objet est rare, plus il en rapporte, au maximum le prix d’un glaçon (', hail(), `${G.PRICE}).`]])),
      sec('🏪 Place marchande', ul([
        'Mets tes objets en vente au prix que tu veux en Grêlons, éventuellement réservés à un joueur précis.',
        'Offre un objet à un autre joueur, ou propose-lui un échange : ton objet (+ des Grêlons si tu veux) contre un des siens.',
        'Un objet en vente ou proposé en échange ne peut pas être porté ni recyclé. Tu peux annuler à tout moment.'])),
      sec('💎 Raretés', el('p', {}, 'La rareté multiplie les bonus de l’objet et change son apparence.'),
        table(['Rareté', 'Probabilité', 'Bonus', 'Recyclage'], [
          ...(me.mysticFound ? GD.RARITIES : visible).map((r) => [el('b', { style: `color:${r.color}` }, r.name), fmtPct(r.p), `×${r.mult}`, [hail(), String(GD.recycleValue(GD.RARITIES.indexOf(r)))]])])),
      sec('🛡️ Sets d’équipement', el('p', {}, 'Il y a 5 emplacements : casque, torse, pantalon, chaussures et arme. Chaque famille de classes a son set (5 pièces, arme comprise), et 3 sets universels (4 pièces) sont portables par toutes les classes. Porter plusieurs pièces d’un même set donne des bonus, quelle que soit leur rareté.'),
        table(['Set', 'Classes', 'Bonus'], Object.values(GD.SETS).map((s) => [el('b', {}, s.name), s.families ? s.families.map((f) => GD.CLASSES[f].name).join(', ') : 'Toutes',
          el('div', {}, ...Object.entries(s.bonus).map(([n, b]) => el('div', {}, `${n} pièces : ${bonusLine(b)}`)))]))),
      sec('🏠 Habitations', ul([
        'Un héros mort ne réapparaît pas : seul un vote « Résurrection » de l’équipe (proposé quand il y a au moins un mort) relève un héros mort au hasard, à 60 % de ses PV. Il continue de gagner les récompenses jusqu’à la fin de la partie.',
        `En bataille, chaque héros a son habitation, du type de sa classe (${GD.BALANCE.BUILDINGS_PER_CLASS} par classe au maximum ; au-delà, elle est partagée et les PV s’additionnent).`,
        'Entre les manches, chaque héros s’y soigne. Si elle est détruite, plus de soin jusqu’à la fin de la partie.',
        `Une reconversion remet les améliorations d’habitation à zéro et rembourse ${Math.round(GD.HOUSE_RESPEC_REFUND * 100)} % des Grêlons dépensés.`,
        'Onglet « Amélioration de bâtiment » : PV, puissance de soin (moyenne des occupants si partagée) et une amélioration spéciale par classe : ' + Object.entries(GD.HOUSE_SPECIALS).map(([f, sp]) => `${sp.icon} ${sp.name} (${GD.CLASSES[f].name})`).join(', ') + '.'])),
      sec('🗳️ Votes d’équipe', el('p', {}, `Toutes les ${voteEvery} manches, pendant l’entracte, les héros votent pour dépenser les écus de l’équipe. L’option la plus votée l’emporte :`),
        ul(Object.values(GD.UPGRADES).map((u) => `${u.icon} ${u.name} : ${u.desc}${u.unlock ? ` (débloqué quand l’équipe a gagné ${u.unlock} écus)` : ''}`).concat(['🪙 Économiser : garder les écus pour plus tard']))),
      // pas de détails sur l'évolution du terrain ni sur les boss : c'est une surprise pour les joueurs
      sec('🌍 Le monde', el('p', {}, 'Le monde autour de la tour ne restera pas longtemps paisible… À vous de découvrir ce qui vous attend.'))
    );
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

  /* ---------- Liaison Twitch ---------- */
  let twitchChannel = 'hyoneko_';
  fetch('/api/info').then((r) => r.json()).then((d) => { if (d.twitch) { twitchChannel = d.twitch; if (me) renderTwitch(); } }).catch(() => {});
  let twitchCode = null;
  function renderTwitch() {
    $('#twitchLink').textContent = `twitch.tv/${twitchChannel}`;
    $('#twitchLink').href = `https://twitch.tv/${twitchChannel}`;
    if (me.twitchName) {
      $('#twitchState').replaceChildren(el('p', {}, '✅ Lié au compte Twitch ', el('b', {}, me.twitchName), '. Tape ', el('b', {}, '!join'), ' dans le chat pour rejoindre une bataille.'),
        el('button', { class: 'small', onclick: async () => { if (confirm('Délier ton compte Twitch ?')) setUser((await api('/api/me/twitch/unlink', { method: 'POST' })).user); } }, 'Délier'));
      return;
    }
    $('#twitchState').replaceChildren(
      twitchCode ? el('p', { class: 'twitch-code' }, 'Tape ', el('b', {}, `!lier ${twitchCode}`), ` dans le chat de `, el('a', { href: `https://twitch.tv/${twitchChannel}`, target: '_blank', rel: 'noopener' }, `twitch.tv/${twitchChannel}`), ' (code valable 10 minutes). Cette page se met à jour toute seule.') : '',
      el('button', { class: 'primary', onclick: async () => { const d = await api('/api/me/twitch/code', { method: 'POST' }); twitchCode = d.code; twitchChannel = d.channel; renderTwitch(); } }, twitchCode ? 'Nouveau code' : '🔗 Lier mon compte Twitch'));
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
