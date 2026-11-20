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

  api('/api/me').then((d) => start(d.user)).catch(() => $('#auth').classList.remove('hidden'));

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
    $('#heroCls').textContent = c.name;
    $('#heroCls').style.color = c.color;
    renderClasses();
    renderAttrs();
    renderGear();
    renderEquip();
    renderRules();
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
      $('#heroStatus').textContent = st.join(' · ') || `Dégâts ${h.dmg} · Armure ${h.armor}%`;
      $('#sKills').textContent = h.kills; $('#sXp').textContent = h.xp; $('#sGold').textContent = h.gold;
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
            el('span', { class: 'name' }, isSave ? 'Économiser' : `${up.name}${o.level ? ` (niv. ${o.level + 1})` : ''}`),
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
      toast(`Niveau ${p.level} ! +1 point de stat à répartir`);
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
      onclick: async () => { const look = { ...me.look, [key]: i }; me.look = look; renderGear(); setUser((await api('/api/me/look', { method: 'PUT', body: look })).user); }
    })));
  }

  function renderGear() {
    swatches($('#swCape'), P.capes, 'cape');
    swatches($('#swSkin'), P.skin, 'skin');
    swatches($('#swHair'), P.hair, 'hair');
  }

  /* ============================== Équipement & glaçons ============================== */
  const SLOT_ICONS = { head: '⛑️', body: '🦺', legs: '👖', feet: '👢', weapon: '🗡️' };
  let invFilter = 'all';
  const R = (i) => GD.RARITIES[i] || GD.RARITIES[0];
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
      return el('div', { class: 'slot', style: `--rc:${R(it.r).color}`, title: 'Cliquer pour retirer', onclick: () => equip(null, s) },
        el('span', { class: 'ic' }, SLOT_ICONS[s]), el('div', { class: 'rtag' }, R(it.r).name), GD.itemName(it, me.cls));
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
      return el('div', { class: 'inv-item' + (usable ? '' : ' locked') + (isWorn ? ' worn' : ''), style: `--rc:${R(it.r).color}` },
        itemCanvas(it),
        el('div', { class: 'meta' },
          el('span', { class: 'rtag' }, R(it.r).name),
          el('b', {}, GD.itemName(it, me.cls)),
          el('span', { class: 'muted' }, statsText(it)),
          el('div', { class: 'muted' }, `Set ${GD.SETS[t.set].name}${t.families ? '' : ' (toutes classes)'}${usable ? '' : ' · pas pour ta classe'}`)),
        el('div', { class: 'btns' },
          isWorn ? el('button', { class: 'small', onclick: () => equip(null, t.slot) }, 'Retirer')
            : el('button', { class: 'small primary', disabled: !usable, onclick: () => equip(it.uid) }, 'Équiper'),
          isWorn ? '' : el('button', { class: 'small', title: `Recycler contre ${R(it.r).recycle} Grêlons`, onclick: () => recycle(it) }, '♻️ ', String(R(it.r).recycle))));
    }) : [el('p', { class: 'muted' }, 'Aucun objet. Brise un glaçon pour en obtenir !')]));
  }

  async function equip(uid, slot) {
    $('#invError').textContent = '';
    try { setUser((await api('/api/me/equip', { method: 'PUT', body: uid ? { uid } : { uid: null, slot } })).user); }
    catch (e) { $('#invError').textContent = e.message; }
  }
  async function recycle(it) {
    if (it.r >= 3 && !confirm(`Recycler cet objet ${R(it.r).name.toLowerCase()} contre ${R(it.r).recycle} Grêlons ?`)) return;
    try { const d = await api('/api/inventory/recycle', { body: { uid: it.uid } }); setUser(d.user); toast(`♻️ +${d.gain} Grêlons`); }
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
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let opening = false;

  async function openIce() {
    if (opening || !me.glacons) return;
    opening = true;
    $('#iceError').textContent = '';
    const modal = $('#iceModal'), stage = $('#iceStage'), reveal = $('#iceReveal');
    stage.className = 'ice-stage';
    stage.querySelectorAll('.shard').forEach((x) => x.remove());
    reveal.classList.add('hidden');
    modal.classList.remove('hidden');
    let res;
    try { res = await api('/api/glacons/open', { method: 'POST' }); }
    catch (e) { modal.classList.add('hidden'); $('#iceError').textContent = e.message; opening = false; return; }
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
    setUser(res.user);
    const t = GD.TEMPLATES[item.t];
    const usableNow = GD.canUse(item.t, me.cls);
    reveal.className = 'reveal' + (item.r >= 5 ? ' mystic' : '');
    reveal.style.setProperty('--rc', rar.color);
    reveal.replaceChildren(
      el('div', { class: 'rar' }, item.r >= 5 ? '✦ MYSTIQUE ✦' : rar.name.toUpperCase()),
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

  /* ============================== Règles ============================== */
  function renderRules() {
    const PR = GD.PROGRESSION, G = GD.GLACONS;
    const voteEvery = (live && live.run && live.run.voteEvery) || 2;
    const sec = (title, ...kids) => el('div', { class: 'panel' }, el('h2', {}, title), ...kids);
    const ul = (items) => el('ul', {}, ...items.map((x) => el('li', {}, ...[].concat(x))));
    const table = (head, rows) => el('div', { class: 'table-wrap' }, el('table', {}, el('tr', {}, ...head.map((h) => el('th', {}, h))), ...rows.map((r) => el('tr', {}, ...r.map((c) => el('td', {}, c))))));
    const visible = GD.RARITIES.filter((r) => !r.hidden);
    const hidden = GD.RARITIES.filter((r) => r.hidden);
    $('#rules').replaceChildren(
      sec('🏰 Le but du jeu', el('p', {}, 'Une tour se dresse au centre de l’écran. Des vagues de monstres arrivent de tous les bords : si la tour (200 PV au départ) tombe, la partie est perdue. Il y a 100 manches à survivre.'),
        el('p', {}, 'Ton héros se bat tout seul grâce à son IA. Toi, tu choisis sa classe, ses statistiques, son équipement et son comportement depuis ce site, et tu votes avec l’équipe.')),
      sec('🧬 Classes', el('p', {}, `Tout le monde commence Habitant. Au niveau ${PR.CLASS_LEVEL}, choisis une classe. Au niveau ${PR.SPEC_LEVEL}, choisis une spécialisation qui débloque un ultime. Ces choix sont définitifs.`),
        ul(GD.BASE_CLASSES.map((b) => [el('b', { style: `color:${GD.CLASSES[b].color}` }, GD.CLASSES[b].name), ` → ${GD.specsOf(b).map((s) => `${GD.CLASSES[s].name} (${GD.CLASSES[s].ultName})`).join(' / ')}${GD.CLASSES[b].leash ? ` · reste à moins de ${GD.CLASSES[b].leash} px de la tour` : ''}`]))),
      sec('📊 Niveaux & statistiques', el('p', {}, `Les éliminations et les manches passées rapportent de l’XP. Chaque niveau donne ${PR.POINTS_PER_LEVEL} point de stat, à répartir librement (réinitialisation gratuite) :`),
        ul(GD.ATTR_IDS.map((a) => `${GD.ATTRIBUTES[a].icon} ${GD.ATTRIBUTES[a].name} : ${GD.ATTRIBUTES[a].desc}`))),
      sec('💰 Monnaies', ul([
        [hail(), el('b', {}, 'Grêlons'), ' : ta monnaie personnelle, gagnée en combattant et conservée entre les parties. Elle sert à acheter des glaçons, et tu en récupères en recyclant des objets.'],
        ['🪙 ', el('b', {}, 'Écus'), ' : le trésor commun de l’équipe pendant une partie (éliminations, récoltes des paysans). Il est dépensé lors des votes.']])),
      sec('🧊 Glaçons', ul([
        `Tu gagnes ${G.PER_WAVE} glaçon pour chaque manche passée avec ton héros en jeu.`,
        ['Un glaçon s’achète ', hail(), `${G.PRICE} Grêlons.`],
        `Chaque glaçon contient 1 objet (arme ou armure) utilisable par ta classe actuelle : ${Math.round(G.CLASS_SET_CHANCE * 100)}% de chances d’obtenir une pièce du set de ta famille de classes, ${100 - Math.round(G.CLASS_SET_CHANCE * 100)}% une pièce d’un set universel. Un habitant ne reçoit que des pièces universelles.`,
        'Les objets en double ou inutiles se recyclent contre des Grêlons.'])),
      sec('💎 Raretés', el('p', {}, 'La rareté multiplie les bonus de l’objet et change son apparence.'),
        table(['Rareté', 'Probabilité', 'Bonus', 'Recyclage'], [
          ...visible.map((r) => [el('b', { style: `color:${r.color}` }, r.name), fmtPct(r.p), `×${r.mult}`, [hail(), String(r.recycle)]]),
          ...hidden.map((r) => [el('b', { style: 'color:var(--muted)' }, '???'), fmtPct(r.p), '???', '???'])]),
        el('p', { class: 'small muted' }, 'Une rareté secrète existe… À toi de la découvrir.')),
      sec('🛡️ Sets d’équipement', el('p', {}, 'Il y a 5 emplacements : casque, torse, pantalon, chaussures et arme. Chaque famille de classes a son set (5 pièces, arme comprise), et 3 sets universels (4 pièces) sont portables par toutes les classes. Porter plusieurs pièces d’un même set donne des bonus, quelle que soit leur rareté.'),
        table(['Set', 'Classes', 'Bonus'], Object.values(GD.SETS).map((s) => [el('b', {}, s.name), s.families ? s.families.map((f) => GD.CLASSES[f].name).join(', ') : 'Toutes',
          el('div', {}, ...Object.entries(s.bonus).map(([n, b]) => el('div', {}, `${n} pièces : ${bonusLine(b)}`)))]))),
      sec('🗳️ Votes d’équipe', el('p', {}, `Toutes les ${voteEvery} manches, pendant l’entracte, les héros votent pour dépenser les écus de l’équipe. L’option la plus votée l’emporte :`),
        ul(Object.values(GD.UPGRADES).map((u) => `${u.icon} ${u.name} : ${u.desc}${u.unlock ? ` (débloqué quand l’équipe a gagné ${u.unlock} écus)` : ''}`).concat(['🪙 Économiser : garder les écus pour plus tard']))),
      sec('🌍 Le monde', ul([
        'Manches 1 à 30 : la prairie gèle peu à peu depuis les bords (un boss toutes les 5 manches). À la manche 30, les arbres se déracinent et le Tréant colossal apparaît.',
        'Manches 31 à 60 : la corruption verte et des monstres empoisonneurs. Boss final : La Mère-Spore.',
        'Manches 61 à 90 : les terres brûlées, la lave et les monstres de feu. Boss final : le Géant de magma.',
        'Manches 91 à 100 : le chaos, tous les terrains mélangés. Manche 100 : les trois grands boss en même temps.']))
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

  function renderStats() {
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
