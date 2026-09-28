// L'ASSISTANT « PLAN DE SCÈNE » au navigateur : les pistes d'un morceau déposées
// dans la médiathèque, l'assistant les monte sur scène à leur place (la batterie
// en deux fichiers fait UN poste), on glisse un poste sur le plan, on nomme le
// morceau, on crée ; la pièce est courante, la scène et les musiciens sont là,
// chaque musicien porte la clé `sync` de la pièce, l'entrée regarde la scène ;
// Ctrl+Z la défait d'un bloc. Puis : les trois portes (menu, sélecteur, panneau
// Sons) et le champ « groupe en phase » de l'inspecteur.
//
//   npm run build:auteur && npx http-server dist-auteur -p 8124 -s &
//   npm run sonde:plan-de-scene        (PORT=8124 par défaut ; CAPTURES=dossier pour les captures)
//
// Demande Playwright et un Chromium (CHROMIUM=/chemin si besoin).
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8124;
// des fichiers du dépôt, renommés comme des stems : deux de batterie, une basse, une voix
const PISTES = [['stele-voix-grave.wav', 'Kick.wav'], ['stele-voix-alto.wav', 'Snare.wav'], ['marees-basse.wav', 'Bass DI.wav'], ['marees-aigu.wav', 'Lead Vox.wav']];
let echecs = 0;
const verif = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) echecs++; };
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await nav.newPage({ viewport: { width: 1400, height: 900 }, locale: 'fr-FR' });
  await page.addInitScript(() => { for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) { const g = P.getExtension; P.getExtension = function (n) { return n === 'WEBGL_lose_context' ? null : g.call(this, n); }; } });
  const bruit = [];
  page.on('pageerror', (e) => bruit.push(`[pageerror] ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|WebGL-|Failed to load resource/.test(m.text())) bruit.push(`[console] ${m.text().slice(0, 200)}`); });
  await page.goto(`http://localhost:${PORT}/index.html?edit`, { waitUntil: 'commit' });
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('#enter-btn').click());
  await page.waitForFunction(() => window.__galerie?.editor?.enabled, null, { timeout: 120000 });
  await page.waitForTimeout(800);

  // 1. quatre pistes dans la médiathèque, sans créer d'objet
  const avant = await page.evaluate(() => ({ rooms: window.__galerie.editor.doc.rooms.length, works: window.__galerie.editor.doc.works.length }));
  const importes = await page.evaluate(async (pistes) => {
    const files = [];
    for (const [src, nom] of pistes) {
      const blob = await fetch(`audio/${src}`).then((r) => r.blob());
      files.push(new File([blob], nom, { type: 'audio/wav' }));
    }
    await window.__galerie.editor.media.handleFiles(files, { asLibrary: true });
    return [...window.__galerie.assetOverrides.keys()].filter((k) => /\.wav$/.test(k));
  }, PISTES);
  verif(importes.length === 4, `quatre pistes dans la médiathèque : ${importes.join(', ')}`);
  const apres = await page.evaluate(() => ({ rooms: window.__galerie.editor.doc.rooms.length, works: window.__galerie.editor.doc.works.length }));
  verif(apres.rooms === avant.rooms && apres.works === avant.works, `l'import en médiathèque ne crée rien (${apres.works} œuvres, ${apres.rooms} pièces)`);

  // 2. l'assistant : trois postes (la batterie regroupe kick et snare), la voix devant, la batterie au fond
  await page.evaluate(() => { window.__galerie.editor.ui.assistantPlanDeScene(); });
  await page.waitForSelector('.ed-assistant-scene', { state: 'attached' });
  const etat = await page.evaluate(() => ({
    postes: [...document.querySelectorAll('[data-ps-poste]')].map((g) => ({ id: g.dataset.psPoste, aria: g.getAttribute('aria-label'), t: g.getAttribute('transform') })),
    cartes: [...document.querySelectorAll('[data-ps-carte]')].map((c) => ({ ins: c.querySelector('[data-ps-instrument]').value, pistes: [...c.querySelectorAll('.ed-ps-piste .ed-as-son-nom')].map((e) => e.textContent) })),
    ecartes: [...document.querySelectorAll('[data-ps-ecartes] > .ed-ps-piste')].length,
    poses: document.querySelector('.ed-ps-poses')?.open === false ? [...document.querySelectorAll('.ed-ps-poses [data-ps-monter]')].length : -1,
    compte: document.querySelector('[data-ps-compte]').textContent,
    apercu: document.querySelector('[data-ps-apercu]').textContent,
    nom: document.querySelector('[data-ps-nom]').value,
    creer: !document.querySelector('[data-ps-creer]').disabled,
    public: !!document.querySelector('.ed-ps-public'),
    pictos: [...document.querySelectorAll('[data-ps-poste] .ed-ps-picto')].length,
    equip: [...document.querySelectorAll('[data-ps-equip]')].map((e) => e.dataset.psEquip).sort(),
    praticables: [...document.querySelectorAll('[data-ps-praticable]:checked')].length
  }));
  verif(etat.pictos === 3 && etat.equip.join(',') === 'ampli,praticable,retour' && etat.praticables === 1, `pictogrammes ${etat.pictos}, équipement ${etat.equip.join(', ')}, ${etat.praticables} praticable (la batterie)`);
  const batt = etat.cartes.find((c) => c.ins === 'batterie');
  verif(etat.cartes.length === 3 && batt && batt.pistes.length === 2, `trois postes, la batterie en deux pistes : ${etat.cartes.map((c) => `${c.ins}(${c.pistes.join('+')})`).join(' ; ')}`);
  verif(etat.cartes.some((c) => c.ins === 'basse') && etat.cartes.some((c) => c.ins === 'voix'), 'basse et voix devinées au nom');
  verif(etat.ecartes === 0 && etat.poses > 0, `rien hors scène (${etat.ecartes}) ; les ${etat.poses} sons déjà posés dans la galerie attendent, repliés`);
  const y = (t) => Number(t.match(/translate\([\d.]+ ([\d.]+)\)/)[1]);
  const pVoix = etat.postes.find((p) => /Voix/.test(p.aria)); const pBatt = etat.postes.find((p) => /Batterie/.test(p.aria));
  verif(pVoix && pBatt && y(pVoix.t) > y(pBatt.t), `sur le plan, la voix (${y(pVoix.t)}) est plus bas — côté public — que la batterie (${y(pBatt.t)})`);
  verif(/^3 · 4 pistes$/.test(etat.compte) && /^3 postes, 4 pistes — scène de 10 × 6 m, salle de 16 × 19.2 m\.$/.test(etat.apercu), `compte « ${etat.compte} », aperçu « ${etat.apercu} »`);
  const horsScene = await page.evaluate(() => ({ cache: document.querySelector('[data-ps-hors-scene]').hidden, ecoute: [...document.querySelectorAll('[data-ps-ecouter]')].length }));
  verif(!horsScene.cache && horsScene.ecoute >= 4, `le bloc hors scène se montre (14 sons déjà posés), ${horsScene.ecoute} boutons de pré-écoute`);
  verif(etat.nom === 'Scène' && etat.creer && etat.public, `nom proposé « ${etat.nom} », bouton actif, le public est en bas`);
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/plan-de-scene.png` });

  // 3. glisser la basse à cour (à droite), au fond ; élargir la scène ; corriger un instrument ; nommer
  const idBasse = await page.evaluate(() => [...document.querySelectorAll('[data-ps-poste]')].find((g) => /Basse/.test(g.getAttribute('aria-label'))).dataset.psPoste);
  const boite = await page.evaluate((id) => {
    const g = document.querySelector(`[data-ps-poste="${id}"] circle`).getBoundingClientRect();
    const s = document.querySelector('[data-ps-svg]').getBoundingClientRect();
    return { x: g.left + g.width / 2, y: g.top + g.height / 2, sx: s.left, sy: s.top, sw: s.width, sh: s.height };
  }, idBasse);
  await page.mouse.move(boite.x, boite.y);
  await page.mouse.down();
  await page.mouse.move(boite.sx + boite.sw * 0.85, boite.sy + boite.sh * 0.2, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => {
    const l = document.querySelector('[data-ps-largeur]'); l.value = '12'; l.dispatchEvent(new Event('input'));
    const carte = [...document.querySelectorAll('[data-ps-carte]')].find((c) => c.querySelector('[data-ps-instrument]').value === 'voix');
    const nom = carte.querySelector('[data-ps-poste-nom]'); nom.value = 'Léa'; nom.dispatchEvent(new Event('input', { bubbles: true }));
    const n = document.querySelector('[data-ps-nom]'); n.value = 'Marées'; n.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(150);
  const bouge = await page.evaluate((id) => {
    const g = document.querySelector(`[data-ps-poste="${id}"]`);
    return { t: g.getAttribute('transform'), aria: g.getAttribute('aria-label'), apercu: document.querySelector('[data-ps-apercu]').textContent,
      lea: [...document.querySelectorAll('[data-ps-poste] .ed-ps-nom')].map((e) => e.textContent) };
  }, idBasse);
  const [, bx, by] = bouge.t.match(/translate\(([\d.]+) ([\d.]+)\)/).map(Number);
  verif(bx > 400 && by < 120, `la basse glissée à cour, au fond : (${bx}, ${by})`);
  verif(/scène de 12 × 6 m, salle de 18 × 19.2 m/.test(bouge.apercu) && bouge.lea.includes('Léa'), `scène élargie et voix nommée : « ${bouge.apercu} », ${bouge.lea.join(' / ')}`);

  // 3 ter. l'équipement suit le poste glissé ; cliquer le nom d'une carte n'efface pas le champ
  const suivi = await page.evaluate((id) => {
    const xy = (el) => el.getAttribute('transform').match(/translate\(([\d.]+) ([\d.]+)\)/).slice(1).map(Number);
    const [gx, gy] = xy(document.querySelector(`[data-ps-poste="${id}"]`));
    const [ax, ay] = xy(document.querySelector('[data-ps-equip="ampli"]'));
    const nom = document.querySelector('[data-ps-carte] [data-ps-poste-nom]');
    nom.focus(); nom.click();
    return { d: Math.hypot(gx - ax, gy - ay), focus: document.activeElement === nom, selection: nom.closest('[data-ps-carte]').classList.contains('actif') };
  }, idBasse);
  // collée au fond, la basse n'a pas de place derrière elle : l'ampli est à côté, à moins d'un mètre
  verif(suivi.d < 60 && suivi.focus && suivi.selection, `l'ampli a suivi la basse (à ${suivi.d.toFixed(0)} px) ; le champ cliqué garde le focus, sa carte est sélectionnée`);

  // 3 bis. le plan exporté : un SVG autonome, noir sur blanc, titré du morceau
  const svg = await page.evaluate(() => new Promise((resoudre) => {
    const clic = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = async function () {
      HTMLAnchorElement.prototype.click = clic;
      const texte = await fetch(this.href).then((r) => r.text());
      resoudre({ nom: this.download, texte });
    };
    document.querySelector('[data-ps-svg-export]').click();
  }));
  verif(svg.nom === 'plan-de-scene-marées.svg' && /^<\?xml/.test(svg.texte) && /Marées — plan de scène/.test(svg.texte) && /AVANT-SCÈNE · PUBLIC/.test(svg.texte) && (svg.texte.match(/ed-ps-picto/g) ?? []).length === 3 && /fill="#fff"/.test(svg.texte) && !/tabindex|data-ps-/.test(svg.texte),
    `plan exporté « ${svg.nom }» : ${svg.texte.length} car., titré, trois pictogrammes, noir sur blanc`);

  // 4. créer
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('ed-toast')) window.__toasts.push(n.textContent); }).observe(document.body, { childList: true });
    document.querySelector('[data-ps-creer]').click();
  });
  // « Marées » existe déjà dans la galerie : l'identifiant prend un suffixe libre
  await page.waitForFunction(() => window.__galerie.rooms.current?.config?.title === 'Marées' && /^marees-\d+$/.test(window.__galerie.rooms.current.config.id), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelector('.ed-toast')?.remove(); });
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/scene-creee.png` });
  const piece = await page.evaluate(() => {
    const app = window.__galerie; const room = app.rooms.current; const cfg = room.config;
    const doc = app.editor.doc;
    const works = cfg.works.map((id) => doc.work(id));
    const musiciens = works.filter((w) => w.role !== 'decor');
    const cam = app.camera.position;
    return {
      id: cfg.id, title: cfg.title, shell: [cfg.shell.width, cfg.shell.depth, cfg.shell.height], spawn: cfg.spawn, regard: cfg.regard,
      n: works.length, musiciens: musiciens.map((w) => ({ id: w.id, title: w.title, sync: w.sync, stems: w.stems.map((s) => s.file), x: w.position[0], y: w.position[1], z: w.position[2], shape: w.model?.shape })),
      decor: works.filter((w) => w.role === 'decor').map((w) => w.title),
      scene: works.find((w) => w.title === 'Scène'),
      artworks: room.artworks.length, rouges: room.artworks.filter((a) => a.mediaError).map((a) => a.config.id),
      annule: doc.history.prochainAnnule, cam: [cam.x, cam.y, cam.z]
    };
  });
  verif(piece.title === 'Marées' && piece.musiciens.length === 3 && piece.n === 3 + piece.decor.length && piece.decor.length === 10, `pièce « ${piece.title} » (${piece.id}) : ${piece.musiciens.length} musiciens + ${piece.decor.length} décors (${piece.decor.join(', ')})`);
  verif(['Praticable', 'Ampli', 'Retour'].every((t) => piece.decor.includes(t)), 'praticable, ampli et retour construits en décor');
  verif(piece.musiciens.every((m) => m.sync === piece.id), `chaque musicien porte sync = « ${piece.musiciens[0]?.sync} »`);
  const ID = piece.id;
  const lea = piece.musiciens.find((m) => m.title === 'Léa'); const basse = piece.musiciens.find((m) => /Basse/.test(m.title)); const batterie = piece.musiciens.find((m) => /Batterie/.test(m.title));
  verif(lea && lea.stems.length === 1 && batterie && batterie.stems.length === 2 && batterie.shape === 'box', `Léa (${lea?.stems.join(', ')}), batterie ${batterie?.shape} en ${batterie?.stems.length} pistes`);
  verif(basse && basse.x > 2 && basse.z < batterie.z + 1, `la basse est à cour, au fond : x ${basse?.x}, z ${basse?.z} (batterie z ${batterie?.z})`);
  const sc = piece.scene;
  verif(sc && sc.scale[0] === 12 && sc.scale[2] === 6 && piece.musiciens.every((m) => m.y > sc.scale[1] && Math.abs(m.z - sc.position[2]) <= 3), `le plateau fait ${sc?.scale.join(' × ')} m et les musiciens sont dessus`);
  const pied = (m, h) => Math.round((m.y - h / 2) * 100) / 100;   // le bas du corps : ce sur quoi il repose
  verif(Math.abs(pied(batterie, 0.95) - 0.9) < 0.02 && Math.abs(pied(basse, 1.75) - 0.5) < 0.02, `la batterie repose à ${pied(batterie, 0.95)} m (praticable), la basse à ${pied(basse, 1.75)} m (plateau)`);
  verif(piece.shell[0] === 18 && piece.spawn[2] > sc.position[2] + 3 && piece.regard && piece.regard[2] === sc.position[2], `salle ${piece.shell.join(' × ')} m, entrée z ${piece.spawn[2]} face à la scène (regard z ${piece.regard?.[2]})`);
  verif(Math.abs(piece.cam[2] - piece.spawn[2]) < 0.5 && piece.artworks === piece.n && piece.rouges.length === 0, `la caméra est à l'entrée (z ${piece.cam[2].toFixed(1)}), ${piece.artworks} objets construits, ${piece.rouges.length} en erreur`);
  verif(/pièce « Marées » depuis un plan de scène \(3 musiciens\)/.test(piece.annule), `l'historique nomme le lot : « ${piece.annule} »`);
  const toast = await page.evaluate(() => window.__toasts.join(' | '));
  verif(/Pièce « Marées » créée : 3 musiciens sur une scène de 12 × 6 m/.test(toast), `toast : « ${toast.slice(0, 110)} »`);

  // 5. les pistes jouent en phase : même premier départ pour les trois
  await page.waitForTimeout(3000);
  const phase = await page.evaluate(() => {
    const room = window.__galerie.rooms.current;
    return room.artworks.filter((a) => a.config.role !== 'decor').map((a) => ({ id: a.config.id, actif: a._stemsActive, depart: a._premierDepart }));
  });
  const departs = new Set(phase.filter((p) => p.actif).map((p) => p.depart));
  verif(phase.filter((p) => p.actif).length === 3 && departs.size === 1, `trois musiciens actifs, un seul premier départ partagé : ${phase.map((p) => `${p.id}:${p.actif ? p.depart?.toFixed(2) : '–'}`).join(' ')}`);

  // 6. annuler d'un bloc, puis rétablir
  await page.evaluate(() => window.__galerie.editor.annuler());
  await page.waitForTimeout(800);
  const annule = await page.evaluate(() => ({ rooms: window.__galerie.editor.doc.rooms.length, works: window.__galerie.editor.doc.works.length }));
  verif(annule.rooms === avant.rooms && annule.works === avant.works, `Ctrl+Z : ${annule.rooms} pièces, ${annule.works} œuvres`);
  await page.evaluate(() => window.__galerie.editor.retablir());
  await page.waitForTimeout(800);
  const retabli = await page.evaluate((id) => ({ rooms: window.__galerie.editor.doc.rooms.length, existe: !!window.__galerie.editor.doc.rooms.find((r) => r.id === id) }), ID);
  verif(retabli.rooms === avant.rooms + 1 && retabli.existe, `Ctrl+Maj+Z : ${retabli.rooms} pièces`);

  // 7. l'inspecteur : le champ « groupe en phase » d'un musicien, et sa modification
  await page.evaluate(async (id) => { await window.__galerie.rooms.setCurrent(id, { instant: true }); }, ID);
  await page.waitForTimeout(800);
  await page.evaluate(() => { const app = window.__galerie; const art = app.rooms.current.artworks.find((a) => a.config.role !== 'decor'); app.editor.select({ type: 'artwork', artwork: art }); });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('button[data-onglet="oeuvre"]')?.click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('button[data-sous-onglet="son"]')?.click());
  await page.waitForTimeout(300);
  const champ = await page.evaluate(() => {
    const input = document.querySelector('#editor-panel input[data-f="sync"]');
    if (!input) return null;
    const avant = input.value;
    input.value = `${avant}-b`; input.dispatchEvent(new Event('input'));
    const app = window.__galerie; const id = app.editor.selectedArtwork.config.id;
    return { avant, apres: app.editor.doc.work(id).sync };
  });
  verif(champ && champ.avant === ID && champ.apres === `${ID}-b`, `inspecteur : sync « ${champ?.avant} » → « ${champ?.apres} »`);

  // 8. les trois portes : le menu Ajouter, le sélecteur de modèle, le panneau Sons
  await page.evaluate(() => window.__galerie.editor.ui.choisirGabarit());
  await page.waitForTimeout(200);
  const portes = await page.evaluate(() => {
    const carte = !!document.querySelector('[data-gab-assistant="scene"]');
    document.querySelector('[data-dlg-annule]')?.click();
    window.__galerie.editor.ui.sons.toggle();
    const bouton = !!document.querySelector('#sons-panel [data-son-assistant="scene"]');
    window.__galerie.editor.ui.sons.hide();
    return { carte, bouton };
  });
  verif(portes.carte && portes.bouton, `les portes : carte du sélecteur ${portes.carte}, bouton du panneau Sons ${portes.bouton}`);

  console.log(bruit.length ? `bruit : ${bruit.join(' ; ')}` : 'aucune erreur de page');
  await nav.close();
  console.log(echecs ? `\n${echecs} échec(s)` : '\ntout est passé');
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
