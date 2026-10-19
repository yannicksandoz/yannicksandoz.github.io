// LA VISITE DE BOUT EN BOUT, dans le navigateur — ce que les tests Node ne
// voient pas : l'accueil, le choix du mode, la mémoire qui s'écrit (ou pas),
// le menu et son focus, la carte, les jetons, la dérive, puis le retour du
// visiteur (reprise, visite guidée, lien profond). Sur le build VISITEUR.
//
//   npm run build && npx http-server dist -p 8123 -s &
//   PORT=8123 node scripts/sonde-visite.cjs
//
// Demande Playwright et un Chromium (CHROMIUM=/chemin si besoin). Les
// cadences mesurées sont celles d'un rendu logiciel sans carte graphique
// (une à trois images par seconde ici) : un repère d'une fois à l'autre,
// pas une promesse pour un téléphone — d'où les attentes d'état larges.
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8123;
const URL_BASE = `http://localhost:${PORT}/index.html`;
let echecs = 0;
const verif = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) echecs++; };
const info = (msg) => console.log(`  · ${msg}`);
const dodo = (ms) => new Promise((r) => setTimeout(r, ms));

/** Images par seconde du moteur et du navigateur sur `ms` millisecondes. */
async function cadence(page, etiquette, ms = 1500) {
  const c = await page.evaluate((ms) => new Promise((resolve) => {
    let n = 0; let raf = 0; const t0 = performance.now();
    const off = window.__galerie.onUpdate(() => { n++; });
    const tick = () => { raf++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    setTimeout(() => {
      off?.();
      const s = (performance.now() - t0) / 1000;
      resolve({ fps: n / s, raf: raf / s, hidden: document.hidden });
    }, ms + 100);
  }), ms);
  info(`cadence ${etiquette} : ${c.fps.toFixed(0)} images/s de moteur, ${c.raf.toFixed(0)} rAF/s${c.hidden ? ', page cachée' : ''}`);
  return c;
}

/** Attend qu'une zone live dise quelque chose qui ressemble à `motif` (les annonces passent par rAF, lent ici). */
async function attendreLive(page, selecteur, motif, ms = 20000) {
  const ok = await page.waitForFunction(([sel, src]) => new RegExp(src, 'i').test(document.querySelector(sel)?.textContent ?? ''), [selecteur, motif.source], { timeout: ms }).then(() => true).catch(() => false);
  const texte = await page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', selecteur);
  return { ok, texte };
}

/** La mémoire de visite telle qu'elle est sur le disque du navigateur. */
const memoire = (page) => page.evaluate(() => {
  const brut = localStorage.getItem('galerie-visite');
  return brut ? JSON.parse(brut) : null;
});

async function ouvrir(contexte, query = '') {
  const page = await contexte.newPage();
  const bruit = [];
  page.on('pageerror', (e) => bruit.push(`[pageerror] ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|WebGL-|Failed to load resource|Autoplay/.test(m.text())) bruit.push(`[console] ${m.text().slice(0, 200)}`); });
  const t0 = Date.now();
  await page.goto(`${URL_BASE}${query}`, { waitUntil: 'commit' });
  return { page, bruit, t0 };
}

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const contexte = await nav.newContext({ viewport: { width: 960, height: 600 }, locale: 'fr-FR' });
  await contexte.addInitScript(() => { for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) { const g = P.getExtension; P.getExtension = function (n) { return n === 'WEBGL_lose_context' ? null : g.call(this, n); }; } });

  /* ─────────────────────────────── 1. première venue, visite libre ─── */
  console.log('\n— première venue, visite libre');
  let { page, bruit, t0 } = await ouvrir(contexte);
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  info(`accueil prêt en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const accueil = await page.evaluate(() => ({
    reprise: document.querySelector('#enter-reprise')?.hidden,
    guidee: !!document.querySelector('#enter-guidee'),
    audio: !!document.querySelector('#enter-audio'),
    compte: document.querySelector('#enter-compte')?.textContent.trim() ?? '',
    piece: window.__galerie?.rooms?.current?.config.id ?? null
  }));
  verif(accueil.reprise === true, 'première venue : la ligne « dernière visite » reste cachée');
  verif(accueil.guidee && accueil.audio, 'l’accueil propose la visite guidée et la visite audio');
  verif(/\d/.test(accueil.compte), `l’accueil compte ce qu’il y a à trouver : « ${accueil.compte} »`);
  verif(accueil.piece !== null, `la scène est bâtie derrière l’accueil (pièce ${accueil.piece})`);
  verif((await memoire(page)) === null, 'rien n’est écrit dans la mémoire AVANT le choix du mode (la scène bâtie n’a rien noté)');

  await page.click('#enter-btn', { force: true });
  await page.waitForFunction(() => window.__galerie?.modeVisite === 'libre' && window.__galerie.rooms?.current, null, { timeout: 60000 });
  await dodo(600);
  const entree = await page.evaluate(() => window.__galerie.rooms.current.config.id);
  let m = await memoire(page);
  verif(m && m.pieces?.includes(entree) && m.derniere === entree, `entré en visite libre : la mémoire note la pièce d’arrivée « ${entree} »`);
  const compagnons = await page.evaluate(() => ({
    badge: !!document.querySelector('#progress-badge'),
    menu: !!document.querySelector('#room-menu-btn') && !document.querySelector('#room-badge')?.hidden,
    jetons: window.__galerie.jetons?.total ?? 0, solde: window.__galerie.jetons?.compte ?? -1,
    titre: document.querySelector('#room-badge-name')?.textContent.trim() ?? ''
  }));
  verif(compagnons.badge, 'le badge de progression est là');
  verif(compagnons.menu && compagnons.titre, `le badge de pièce dit où l’on est : « ${compagnons.titre} »`);
  verif(compagnons.jetons > 0 && compagnons.solde === 0, `${compagnons.jetons} jetons posés dans la galerie, solde 0 au départ`);
  await cadence(page, 'à l’entrée');

  // marcher : une autre pièce, par le moteur (le clavier est éprouvé ailleurs)
  await page.evaluate(() => window.__galerie.rooms.setCurrent('bibliotheque', { instant: true }));
  await page.waitForFunction(() => window.__galerie.rooms.current?.config.id === 'bibliotheque', null, { timeout: 30000 });
  await dodo(400);
  m = await memoire(page);
  const titreBiblio = await page.evaluate(() => document.querySelector('#room-badge-name')?.textContent.trim());
  verif(m.pieces.includes('bibliotheque') && m.derniere === 'bibliotheque', 'une pièce traversée entre dans la mémoire et devient la dernière');
  verif(titreBiblio && titreBiblio !== compagnons.titre, `le badge suit : « ${titreBiblio} »`);
  const annonce = await attendreLive(page, '#annonces', /biblioth/);
  verif(annonce.ok, `la zone d’annonces (lecteur d’écran) dit la pièce franchie : « ${annonce.texte} »`);

  // un jeton ramassé : le solde monte, la mémoire le retient
  const jeton = await page.evaluate(() => {
    const j = window.__galerie.jetons;
    const [roomId, liste] = [...j._meshes.entries()].find(([, l]) => l.length) ?? [];
    if (!liste) return { erreur: 'aucun jeton posé' };
    const cle = liste[0].cle;
    j.ramasser(cle);
    return { roomId, cle, solde: j.compte };
  });
  await dodo(300);
  m = await memoire(page);
  verif(!jeton.erreur && jeton.solde === 1 && m.jetons?.solde === 1 && m.jetons.pris.includes(jeton.cle), `un jeton ramassé (${jeton.cle}) : solde 1, mémorisé`);

  /* le menu : ouverture, focus, Échap au clavier, fermeture au pointeur */
  // le menu est un morceau chargé à la demande : la première ouverture attend son import
  await page.click('#room-menu-btn', { force: true });
  await page.waitForFunction(() => window.__galerie.visitMenu?.open, null, { timeout: 30000 });
  await dodo(150);
  const menuOuvert = await page.evaluate(() => ({
    visible: !document.querySelector('#vm-title')?.closest('[hidden]') && !!document.querySelector('#vm-title'),
    focus: document.activeElement?.id, scene: document.getElementById('app')?.getAttribute('aria-hidden')
  }));
  verif(menuOuvert.visible && menuOuvert.focus === 'vm-derive', `le menu s’ouvre, focus sur sa première entrée (${menuOuvert.focus})`);
  verif(menuOuvert.scene === 'true', 'la scène est cachée aux lecteurs d’écran pendant le menu');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__galerie.visitMenu?.open, null, { timeout: 30000 });
  await dodo(100);
  const apresEchap = await page.evaluate(() => ({ focus: document.activeElement?.id }));
  verif(apresEchap.focus === 'room-menu-btn', `Échap referme le menu et rend le focus au bouton qui l’a ouvert (${apresEchap.focus})`);
  await page.click('#room-menu-btn', { force: true });
  const rouvert = await page.waitForFunction(() => window.__galerie.visitMenu?.open, null, { timeout: 30000 }).then(() => true).catch(() => false);
  if (!rouvert) {
    const etat = await page.evaluate(() => { const b = document.querySelector('#room-menu-btn'); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { dessus: e?.id || `${e?.tagName}.${e?.className}`, inert: b.closest('[inert]') !== null, hidden: b.closest('[hidden]') !== null, focus: document.activeElement?.id, rect: [r.x, r.y, r.width, r.height].map(Math.round) }; });
    verif(false, `le menu se rouvre au clic — non : ${JSON.stringify(etat)}`);
    await page.evaluate(() => window.__galerie.visitMenu?.show?.());
    await dodo(200);
  }
  await page.click('#vm-close', { force: true });
  await page.waitForFunction(() => !window.__galerie.visitMenu?.open, null, { timeout: 30000 });
  await dodo(100);
  const apresClic = await page.evaluate(() => document.activeElement === document.body || document.activeElement === null);
  verif(apresClic, 'fermé au pointeur : le clavier retourne à la scène (aucun bouton gardé en focus)');
  await cadence(page, 'après le menu');

  /* la carte, depuis le menu */
  await page.click('#room-menu-btn', { force: true });
  await page.waitForFunction(() => window.__galerie.visitMenu?.open, null, { timeout: 30000 });
  await page.click('#vm-rooms', { force: true });
  await dodo(150);
  await page.click('#vm-plan', { force: true });
  await page.waitForFunction(() => window.__galerie._cartePleine?.ouverte, null, { timeout: 30000 }).catch(() => {});
  await dodo(300);
  const carte = await page.evaluate(() => {
    const c = window.__galerie._cartePleine;
    return { ouverte: !!c?.ouverte, svg: !!c?.el?.querySelector('svg'), pieces: c?.el?.querySelectorAll('[data-room], .ca-piece, g[id]').length ?? 0, focusDedans: !!c?.el?.contains(document.activeElement) };
  });
  verif(carte.ouverte && carte.svg, 'la carte s’ouvre depuis le menu, avec son plan');
  verif(carte.focusDedans, 'le focus est dans la carte');
  await page.keyboard.press('Escape');
  await dodo(300);
  verif(await page.evaluate(() => !window.__galerie._cartePleine?.ouverte), 'Échap referme la carte');
  await cadence(page, 'après la carte');
  await page.evaluate(() => { window.__galerie.visitMenu?.hide?.(); });
  await dodo(200);

  /* la dérive : avec un jeton en poche et des œuvres inconnues, elle porte */
  const derive = await page.evaluate(async () => {
    const d = window.__galerie.derive;
    if (!d) return { erreur: 'pas de dérive montée' };
    const ok = d.demarrer();
    await new Promise((r) => setTimeout(r, 1500));
    const pendant = { active: d.active, locked: window.__galerie.controls.locked };
    d.arreter();
    return { ok, pendant, apres: { active: d.active } };
  });
  verif(!derive.erreur && derive.ok && derive.pendant.active && derive.pendant.locked, 'la dérive démarre et prend la caméra');
  // la main se rend à la fin du travelling en cours, pas dans l'instant
  const rendue = await page.waitForFunction(() => !window.__galerie.controls.locked, null, { timeout: 30000 }).then(() => true).catch(() => false);
  verif(derive.apres && !derive.apres.active && rendue, 'arrêtée, elle rend la main (après le travelling en cours)');

  /* la cadence, en passant */
  // sans carte graphique, le conteneur rend une image par seconde ou deux :
  // on vérifie que la boucle VIT, la cadence elle-même n'est qu'un repère
  const fin = await cadence(page, 'après la dérive (rendu logiciel)', 4000);
  verif(fin.fps > 0, 'la boucle tourne');
  const finSession1 = (await memoire(page)).derniere;
  info(`la session s’achève dans « ${finSession1} »`);
  verif(bruit.length === 0, bruit.length ? `console propre — non : ${bruit.slice(0, 3).join(' | ')}` : 'console propre (aucune erreur de page)');
  await page.close();

  /* ───────────────────────────── 2. le retour : reprise, visite guidée ─── */
  console.log('\n— le retour : la reprise, puis la visite guidée qui n’écrit rien');
  ({ page, bruit } = await ouvrir(contexte));
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  const reprise = await page.evaluate(() => ({ cachee: document.querySelector('#enter-reprise')?.hidden, texte: document.querySelector('#enter-reprise')?.textContent.trim() ?? '' }));
  verif(reprise.cachee === false && reprise.texte.length > 10, `l’accueil dit la dernière visite : « ${reprise.texte} »`);
  const avantChoix = await memoire(page);
  verif(avantChoix.derniere === finSession1, `bâtir la scène n’a pas écrasé la dernière pièce (toujours « ${finSession1} »)`);
  const nbPieces = avantChoix.pieces.length;
  await page.click('#enter-guidee', { force: true });
  await page.waitForFunction(() => window.__galerie?.modeVisite === 'guidee', null, { timeout: 60000 });
  const cibleGuidee = finSession1 === 'labo' ? 'archives' : 'labo';
  await page.evaluate((id) => window.__galerie.rooms.setCurrent(id, { instant: true }), cibleGuidee);
  await page.waitForFunction((id) => window.__galerie.rooms.current?.config.id === id, cibleGuidee, { timeout: 30000 });
  await dodo(400);
  const guidee = await page.evaluate(() => ({ ouverte: !!window.__galerie.memoire?.ouverte, derive: !!window.__galerie.derive?.active }));
  m = await memoire(page);
  verif(guidee.ouverte, 'visite guidée : la mémoire ouverte est en place');
  verif(m.derniere === finSession1 && !m.pieces.includes(cibleGuidee) && m.pieces.length === nbPieces, `visite guidée : rien ne s’écrit dans la mémoire de la visite libre (« ${cibleGuidee} » n’y entre pas)`);
  verif(guidee.derive, 'la visite guidée porte dès l’entrée');
  verif(bruit.length === 0, bruit.length ? `console propre — non : ${bruit.slice(0, 3).join(' | ')}` : 'console propre');
  await page.close();

  /* ─────────────────────────── 3. ?mode=guidee et le lien profond ─── */
  console.log('\n— ?mode=guidee, puis un lien profond');
  ({ page } = await ouvrir(contexte, '?mode=guidee'));
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  await dodo(300);
  m = await memoire(page);
  verif(m.derniere === finSession1 && m.pieces.length === nbPieces, `?mode=guidee : la scène bâtie ne touche pas la mémoire libre (${m.pieces.length} pièces, dernière ${m.derniere})`);
  await page.close();

  ({ page, bruit } = await ouvrir(contexte, '?room=jardin'));
  await page.waitForFunction(() => window.__galerie?.rooms?.current?.config.id === 'jardin' && !document.querySelector('#enter-screen'), null, { timeout: 240000 });
  await dodo(1600);
  m = await memoire(page);
  const lien = await page.evaluate(() => ({ mode: window.__galerie.modeVisite, piece: window.__galerie.rooms.current.config.id, accueil: !!document.querySelector('#enter-screen') }));
  verif(lien.piece === 'jardin' && !lien.accueil && lien.mode === 'libre', 'lien profond : on arrive dans le jardin, sans écran d’accueil, en visite libre');
  verif(m.derniere === 'jardin' && m.pieces.includes('jardin'), 'lien profond : la pièce d’arrivée est notée une fois entré');
  verif(bruit.length === 0, bruit.length ? `console propre — non : ${bruit.slice(0, 3).join(' | ')}` : 'console propre');
  await page.close();

  /* ───────────────────────── 4. la visite audio : l'oreille s'oriente ─── */
  console.log('\n— la visite audio : ?mode=audio, repères, pivot, où suis-je, Échap');
  ({ page, bruit } = await ouvrir(contexte, '?room=phare-01&mode=audio'));
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  await dodo(800);
  const accueilAudio = await page.evaluate(() => ({ accueil: !!document.querySelector('#enter-screen'), focus: document.activeElement?.id, piece: window.__galerie.rooms.current?.config.id }));
  verif(accueilAudio.accueil && accueilAudio.focus === 'enter-audio', `?mode=audio : l’accueil reste et le focus est sur « Visite audio » (${accueilAudio.focus})`);
  verif(accueilAudio.piece === 'phare-01', 'le lien profond a posé la visite dans le phare 01');
  // un clic programmatique : Playwright attendrait sinon une « navigation » que le fil principal, lent ici, ne confirme pas
  await page.evaluate(() => document.querySelector('#enter-audio').click());
  await page.waitForFunction(() => window.__galerie.audioTour?.active, null, { timeout: 90000 });
  const arrivee = await attendreLive(page, '#at-live', /jeton|passage/);
  const panneau = await page.evaluate(() => {
    const boutons = [...document.querySelectorAll('#at-works button')];
    return { n: boutons.length, ou: boutons.map((b) => b.querySelector('.at-ou')?.textContent ?? ''),
      portes: [...document.querySelectorAll('#at-doors button')].map((b) => b.textContent),
      pref: localStorage.getItem('galerie-visite-audio'), outils: !!document.querySelector('#at-ou') };
  });
  verif(panneau.n > 0 && panneau.ou.every((o) => /—.+,\s(\d+ m|tout près)/.test(o)), `chaque œuvre dit où elle est : « ${panneau.ou[0]} »`);
  // un passage porté par une œuvre (module Portail) n'a pas de porte dessinée, donc pas de repère : « some », pas « every »
  verif(panneau.portes.length > 0 && panneau.portes.some((p) => /,\s(\d+ m|tout près)/.test(p)), `les passages dessinés aussi : « ${panneau.portes[0]} »`);
  verif(arrivee.ok, `l’arrivée résume l’espace : « ${arrivee.texte} »`);
  verif(panneau.pref === '1' && panneau.outils, 'le choix de la visite audio est mémorisé ; les outils d’orientation sont là');
  await page.focus('#at-title');
  await page.keyboard.press('Shift+ArrowRight');
  const pivot = await attendreLive(page, '#at-live', /huitième de tour à droite/);
  verif(pivot.ok, `Maj + droite pivote : « ${pivot.texte} »`);
  await page.keyboard.press('i');
  const ou = await attendreLive(page, '#at-live', /plus proches/);
  verif(ou.ok && /découverte|jeton|passage/.test(ou.texte), `« Où suis-je ? » : « ${ou.texte.slice(0, 140)} »`);
  await page.focus('#at-quit');
  await page.keyboard.press('Escape');
  await dodo(300);
  const apresEchap2 = await page.evaluate(() => ({ focus: document.activeElement?.id, actif: window.__galerie.audioTour?.active }));
  verif(apresEchap2.focus === 'at-title' && apresEchap2.actif, `Échap depuis « Quitter » remonte à l’en-tête sans quitter (${apresEchap2.focus})`);
  verif(bruit.length === 0, bruit.length ? `console propre — non : ${bruit.slice(0, 3).join(' | ')}` : 'console propre');
  await page.close();

  await nav.close();
  console.log(`\n${echecs ? `${echecs} échec(s)` : 'tout est vert'}`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('✗ sonde interrompue :', e); process.exit(2); });
