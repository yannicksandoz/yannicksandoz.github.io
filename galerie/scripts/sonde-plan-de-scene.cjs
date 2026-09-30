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
    cartes: [...document.querySelectorAll('[data-ps-carte]')].map((c) => ({ ins: c.querySelector('[data-ps-instrument]').value, pistes: [...c.querySelectorAll('.ed-ps-piste .ed-ps-piste-nom')].map((e) => e.placeholder) })),
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
  verif(/^3\/8 voix · 4 pistes$/.test(etat.compte) && /^3 postes, 4 pistes — scène de 10 × 6 m, salle de 16 × 19.2 m\.$/.test(etat.apercu), `compte « ${etat.compte} », aperçu « ${etat.apercu} »`);
  const horsScene = await page.evaluate(() => ({ cache: document.querySelector('[data-ps-hors-scene]').hidden, ecoute: [...document.querySelectorAll('[data-ps-ecouter]')].length }));
  verif(!horsScene.cache && horsScene.ecoute >= 4, `le bloc hors scène se montre (14 sons déjà posés), ${horsScene.ecoute} boutons de pré-écoute`);
  verif(etat.nom === 'Scène' && etat.creer && etat.public, `nom proposé « ${etat.nom} », bouton actif, le public est en bas`);
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/plan-de-scene.png` });

  // 2 bis. REGROUPER à la souris : la piste de voix glissée sur la carte de la batterie la rejoint
  //        (une voix de moins) ; ⇱ la détache à nouveau
  const cheminVoix = await page.evaluate(() => [...document.querySelectorAll('[data-ps-carte]')].find((c) => c.querySelector('[data-ps-instrument]').value === 'voix').querySelector('[data-ps-glisser]').dataset.psGlisser);
  const idBatt = await page.evaluate(() => [...document.querySelectorAll('[data-ps-carte]')].find((c) => c.querySelector('[data-ps-instrument]').value === 'batterie').dataset.psCarte);
  // au repos, la liste des cartes ne doit pas se re-rendre (un glisser en cours serait interrompu)
  const mutations = await page.evaluate(() => new Promise((r) => { let n = 0; const o = new MutationObserver((m) => { n += m.length; }); o.observe(document.querySelector('[data-ps-postes]'), { childList: true }); setTimeout(() => { o.disconnect(); r(n); }, 1500); }));
  verif(mutations === 0, `au repos, la liste des postes ne se re-rend pas (${mutations} mutation(s) en 1,5 s)`);
  await page.evaluate(([chemin, id]) => {
    const dt = new DataTransfer();
    const source = document.querySelector(`[data-ps-glisser="${chemin}"]`);
    const cible = document.querySelector(`[data-ps-carte="${id}"] .ed-ps-carte-tete`);
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    cible.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    window.__cibleVue = document.querySelectorAll('.ed-ps-cible').length;
    cible.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, [cheminVoix, idBatt]);
  await page.waitForTimeout(200);
  const groupe = await page.evaluate((id) => ({ cartes: document.querySelectorAll('[data-ps-carte]').length, pistes: document.querySelectorAll(`[data-ps-carte="${id}"] .ed-ps-piste`).length,
    badge: document.querySelector(`[data-ps-carte="${id}"] .ed-ps-groupe`)?.textContent ?? '', compte: document.querySelector('[data-ps-compte]').textContent, cible: document.querySelectorAll('.ed-ps-cible').length, cibleVue: window.__cibleVue }), idBatt);
  verif(groupe.cartes === 2 && groupe.pistes === 3 && groupe.badge === '3 pistes · 1 voix' && groupe.compte === '2/8 voix · 4 pistes' && groupe.cible === 0 && groupe.cibleVue === 1,
    `glissée sur la batterie (cible marquée au survol, démarquée après) : ${groupe.cartes} postes, la batterie en ${groupe.pistes} pistes « ${groupe.badge} », compte « ${groupe.compte} »`);
  await page.click(`[data-ps-detacher="${cheminVoix}"]`);
  await page.waitForTimeout(200);
  const detache = await page.evaluate(() => ({ cartes: document.querySelectorAll('[data-ps-carte]').length, compte: document.querySelector('[data-ps-compte]').textContent }));
  verif(detache.cartes === 3 && detache.compte === '3/8 voix · 4 pistes', `⇱ détachée : ${detache.cartes} postes, « ${detache.compte} »`);
  // la piste détachée s'ouvre à côté du poste quitté : le placement classique remet chacun à sa place
  await page.click('[data-ps-classique]');
  await page.waitForTimeout(150);

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

  // 3 ter bis. la SALLE taillée par l'auteur, et les COTES du praticable de la batterie
  const tailles = await page.evaluate(() => {
    const salle = document.querySelector('[data-ps-salle="largeur"]');
    const autoAvant = salle.placeholder;
    salle.value = '30'; salle.dispatchEvent(new Event('input'));
    const prof = document.querySelector('[data-ps-salle="profondeur"]'); prof.value = '40'; prof.dispatchEvent(new Event('input'));
    const apercu = document.querySelector('[data-ps-apercu]').textContent;
    const cote = document.querySelector('[data-ps-prat-cote="largeur"]');
    const autoCote = cote?.placeholder;
    if (cote) { cote.value = '4'; cote.dispatchEvent(new Event('change', { bubbles: true })); }
    const h = document.querySelector('[data-ps-prat-cote="hauteur"]');
    if (h) { h.focus(); h.value = '0.8'; h.dispatchEvent(new Event('change', { bubbles: true })); }
    const rect = document.querySelector('[data-ps-equip="praticable"]');
    return { autoAvant, apercu, autoCote, largeurPx: Number(rect?.getAttribute('width')), focus: document.activeElement?.dataset?.psPratCote ?? null,
      hauteur: document.querySelector('[data-ps-prat-cote="hauteur"]')?.value };
  });
  verif(/^auto 18$/.test(tailles.autoAvant) && /salle de 30 × 40 m/.test(tailles.apercu), `la salle : « ${tailles.autoAvant} » puis taillée à 30 × 40 (« ${tailles.apercu.slice(0, 80)} »)`);
  verif(Number(tailles.autoCote) > 0 && tailles.largeurPx > 0 && tailles.hauteur === '0.8' && tailles.focus === 'hauteur',
    `le praticable : auto ${tailles.autoCote} m, réglé à 4 m (${tailles.largeurPx.toFixed(0)} px sur le plan), 0,8 m de haut, le champ garde le focus`);

  // 3 quater. NOMMER une piste, la forme d'onde et sa tête de lecture ; l'onglet VISUEL ; les OPTIONS
  await page.evaluate(() => {
    const nom = document.querySelector('[data-ps-piste-nom="assets/lead-vox.wav"]'); nom.value = 'refrain'; nom.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => { const c = document.querySelector('canvas[data-ps-onde="assets/kick.wav"]'); return c && c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0); }, null, { timeout: 15000 }).catch(() => {});
  const onde = await page.evaluate(() => { const c = document.querySelector('canvas[data-ps-onde="assets/kick.wav"]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return { pixels: n, largeur: c.width }; });
  verif(onde.pixels > 200, `la forme d'onde de kick.wav est dessinée (${onde.pixels} pixels peints)`);
  await page.click('canvas[data-ps-onde="assets/kick.wav"]', { position: { x: 60, y: 9 } });
  await page.waitForFunction(() => (window.__galerie.editor.ui.sons.etatPreEcoute()?.duree ?? 0) > 0, null, { timeout: 5000 }).catch(() => {});
  const lecture = await page.evaluate(() => { const s = window.__galerie.editor.ui.sons; const e = s.etatPreEcoute(); return { lecture: s.enLecture, position: e?.position ?? null, duree: e?.duree ?? null, bouton: document.querySelector('[data-ps-ecouter="assets/kick.wav"]')?.textContent }; });
  verif(lecture.lecture === 'assets/kick.wav' && lecture.position !== null && lecture.bouton === '■', `cliquer l'onde lance la pré-écoute (${lecture.position?.toFixed(2)} s sur ${lecture.duree?.toFixed(2)} s, bouton ■)`);
  await page.evaluate(() => window.__galerie.editor.ui.sons.arreterPreEcoute());
  await page.click('[data-ps-onglet="visuel"]');
  const visuel = await page.evaluate(() => ({ cartes: document.querySelectorAll('.ed-ps-visuel').length, formes: document.querySelector('[data-ps-forme]')?.options.length, lumieres: [...document.querySelector('[data-ps-lumiere]').options].map((o) => o.value).join(','), onglet: document.querySelector('[data-ps-onglet="visuel"]').getAttribute('aria-selected') }));
  verif(visuel.cartes === 3 && visuel.formes >= 7 && visuel.lumieres === 'aucune,fixe,suit' && visuel.onglet === 'true', `onglet Visuel : ${visuel.cartes} cartes, ${visuel.formes} formes, lumières ${visuel.lumieres}`);
  await page.evaluate(() => {
    const idVoix = [...document.querySelectorAll('.ed-ps-visuel')].find((c) => /Léa/.test(c.textContent)).dataset.psCarte;
    const poser = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
    poser(`[data-ps-forme="${idVoix}"]`, 'cylinder'); poser(`[data-ps-lumiere="${idVoix}"]`, 'suit');
    const c = document.querySelector('[data-ps-option="cartels"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true }));
    poser('[data-ps-option="silence"]', '1.5');
  });
  await page.click('[data-ps-onglet="son"]');
  const retour = await page.evaluate(() => ({ nom: document.querySelector('[data-ps-piste-nom="assets/lead-vox.wav"]')?.value, pistes: document.querySelectorAll('.ed-ps-piste .ed-ps-onde').length }));
  verif(retour.nom === 'refrain' && retour.pistes === 4, `retour à l'onglet Son : le nom de piste tient (« ${retour.nom} »), ${retour.pistes} ondes`);

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
  const annuleAvant = await page.evaluate(() => ({ rooms: window.__galerie.editor.doc.rooms.length, works: window.__galerie.editor.doc.works.length }));
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('ed-toast')) window.__toasts.push(n.textContent); }).observe(document.body, { childList: true });
    document.querySelector('[data-ps-creer]').click();
  });
  // « Marées » existe déjà dans la galerie : l'identifiant prend un suffixe libre
  await page.waitForFunction(() => /^marees-\d+$/.test(window.__galerie.rooms.current?.config?.id ?? ''), null, { timeout: 60000, polling: 500 })
    .catch(async () => { console.log('DEBUG création :', await page.evaluate(() => ({ toasts: window.__toasts, piece: window.__galerie.rooms.current?.config?.id, titre: window.__galerie.rooms.current?.config?.title })), bruit.slice(0, 3)); throw new Error('pièce non créée'); });
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
      n: works.length, musiciens: musiciens.map((w) => ({ id: w.id, title: w.title, sync: w.sync, stems: w.stems.map((s) => s.file), noms: w.stems.map((s) => s.nom ?? ''), silences: w.stems.map((s) => s.silence ?? 0), x: w.position[0], y: w.position[1], z: w.position[2], shape: w.model?.shape, emissive: w.model?.emissive, modules: (w.modules ?? []).map((m) => m.type), cartel: w.cartel, groupe: w.groupe })),
      groupesDecor: works.filter((w) => w.role === 'decor').map((w) => `${w.title}:${w.groupe ?? ''}`),
      deplacement: cfg.deplacement, plan: cfg.planDeScene ? { postes: cfg.planDeScene.postes.length, generes: cfg.planDeScene.generes.length, options: cfg.planDeScene.options } : null,
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
  verif(lea?.shape === 'cylinder' && lea.modules.includes('AudioReactive') && lea.emissive > 0.2 && lea.noms[0] === 'refrain', `Léa : forme ${lea?.shape}, lumière qui suit (${lea?.modules.join(',')}, émissif ${lea?.emissive}), piste nommée « ${lea?.noms[0]} »`);
  verif(piece.musiciens.every((m) => m.cartel === false && m.silences.every((s) => s === 1.5)), `cartels retirés, silence d'amorce 1,5 s sur chaque piste`);
  verif(batterie?.groupe === batterie?.id && piece.groupesDecor.includes(`Praticable:${batterie?.id}`) && piece.groupesDecor.includes(`Ampli:${basse?.id}`), `groupes : le praticable suit la batterie, l'ampli suit la basse`);
  verif(piece.deplacement?.vitesse === 0.7 && piece.plan?.postes === 3 && piece.plan.generes === piece.n && piece.plan.options.cartels === false, `la pièce se visite à ${piece.deplacement?.vitesse} de la vitesse, et garde son plan (${piece.plan?.postes} postes, ${piece.plan?.generes} générés)`);

  // 4 bis. cliquer le praticable prend le groupe (batterie + praticable) ; Alt+clic, lui seul
  const grp = await page.evaluate((idBatt) => {
    const ed = window.__galerie.editor;
    const prat = ed.doc.works.find((w) => w.title === 'Praticable' && w.groupe === idBatt);
    ed.select({ type: 'artwork', id: prat.id });
    const tous = [...ed.selIds];
    ed.select({ type: 'artwork', id: prat.id }, { seul: true });
    const seul = [...ed.selIds];
    ed.select(null);
    return { tous, seul, prat: prat.id };
  }, batterie?.id);
  verif(grp.tous.length === 2 && grp.tous.includes(batterie?.id) && grp.seul.length === 1 && grp.seul[0] === grp.prat, `cliquer le praticable sélectionne le groupe (${grp.tous.length} objets) ; seul : ${grp.seul.length}`);

  // 4 ter. ROUVRIR le plan de la pièce, la renommer, la reconstruire sous le même identifiant
  // (la boîte rend une promesse qui ne se résout qu'à sa fermeture : on ne l'attend pas)
  await page.evaluate(() => { window.__galerie.editor.ui.modifierPlanDeScene(window.__galerie.rooms.current.config.id); });
  await page.waitForSelector('.ed-assistant-scene', { timeout: 8000, state: 'attached' }).catch(async () => {
    console.log('DEBUG réouverture :', await page.evaluate(() => { const b = document.querySelector('.ed-assistant-scene'); const f = document.querySelector('.ed-dialogue-fond'); return { fond: !!f, boite: !!b, fondStyle: f ? getComputedStyle(f).display : null, rect: b ? JSON.stringify(b.getBoundingClientRect()) : null, plan: !!window.__galerie.editor.doc.rooms.find((r) => r.id === window.__galerie.rooms.current.config.id)?.planDeScene, piece: window.__galerie.rooms.current.config.id }; }), bruit.slice(0, 4));
  });
  const rouvert = await page.evaluate(() => ({ postes: document.querySelectorAll('[data-ps-poste]').length, bouton: document.querySelector('[data-ps-creer]').textContent.trim(), nom: document.querySelector('[data-ps-nom]').value, cartels: document.querySelector('[data-ps-option="cartels"]').checked, silence: document.querySelector('[data-ps-option="silence"]').value, hors: document.querySelector('[data-ps-hors-scene]').hidden }));
  verif(rouvert.postes === 3 && rouvert.bouton === 'Reconstruire la pièce' && rouvert.nom === 'Marées' && rouvert.cartels === false && rouvert.silence === '1.5', `plan rouvert : ${rouvert.postes} postes, « ${rouvert.bouton} », options gardées (cartels ${rouvert.cartels}, silence ${rouvert.silence})`);
  await page.evaluate(() => { const n = document.querySelector('[data-ps-nom]'); n.value = 'Marées bis'; n.dispatchEvent(new Event('input')); document.querySelector('[data-ps-creer]').click(); });
  await page.waitForFunction((id) => window.__galerie.rooms.current?.config?.id === id && window.__galerie.rooms.current.config.title === 'Marées bis', ID, { timeout: 60000, polling: 500 });
  await page.waitForTimeout(1200);
  const refaite = await page.evaluate((id) => { const doc = window.__galerie.editor.doc; const cfg = doc.rooms.find((r) => r.id === id); return { works: cfg.works.length, titres: cfg.works.map((w) => doc.work(w)?.title).filter(Boolean).length, total: doc.works.length, annule: doc.history.prochainAnnule }; }, ID);
  verif(refaite.works === piece.n && refaite.titres === piece.n && refaite.total === annuleAvant.works + piece.n && /plan de scène de « Marées bis » modifié/.test(refaite.annule), `reconstruite sous « ${ID} » : ${refaite.works} objets (tous vivants), ${refaite.total} œuvres au total, historique « ${refaite.annule} »`);
  await page.evaluate(() => window.__galerie.editor.annuler());
  await page.waitForTimeout(800);
  verif(await page.evaluate((id) => window.__galerie.editor.doc.rooms.find((r) => r.id === id)?.title === 'Marées', ID), 'Ctrl+Z : la pièce d’avant la reconstruction');
  await page.evaluate(() => window.__galerie.editor.retablir());
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__galerie.editor.annuler());
  await page.waitForTimeout(800);

  verif(basse && basse.x > 2 && basse.z < batterie.z + 1, `la basse est à cour, au fond : x ${basse?.x}, z ${basse?.z} (batterie z ${batterie?.z})`);
  const sc = piece.scene;
  verif(sc && sc.scale[0] === 12 && sc.scale[2] === 6 && piece.musiciens.every((m) => m.y > sc.scale[1] && Math.abs(m.z - sc.position[2]) <= 3), `le plateau fait ${sc?.scale.join(' × ')} m et les musiciens sont dessus`);
  const pied = (m, h) => Math.round((m.y - h / 2) * 100) / 100;   // le bas du corps : ce sur quoi il repose
  verif(Math.abs(pied(batterie, 0.95) - 1.3) < 0.02 && Math.abs(pied(basse, 1.75) - 0.5) < 0.02, `la batterie repose à ${pied(batterie, 0.95)} m (praticable réglé à 0,8 m), la basse à ${pied(basse, 1.75)} m (plateau)`);
  verif(piece.shell[0] === 30 && piece.shell[1] === 40 && piece.spawn[2] > sc.position[2] + 3 && piece.regard && piece.regard[2] === sc.position[2], `salle ${piece.shell.join(' × ')} m, entrée z ${piece.spawn[2]} face à la scène (regard z ${piece.regard?.[2]})`);
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
