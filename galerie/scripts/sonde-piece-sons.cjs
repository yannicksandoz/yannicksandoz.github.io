// L'ASSISTANT « PIÈCE DEPUIS LES SONS » au navigateur : six sons déposés dans la
// médiathèque (avant toute pièce), l'assistant les coche, propose 3 × 2, on nomme,
// on crée ; la pièce est courante, ses douze objets sont là, les stèles ont un
// cartel, une couleur, une piste ; Ctrl+Z la défait d'un bloc, Ctrl+Maj+Z la rend.
//
//   npm run build:auteur && npx http-server dist-auteur -p 8124 -s &
//   npm run sonde:piece-sons        (PORT=8124 par défaut ; CAPTURES=dossier pour les captures)
//
// Demande Playwright et un Chromium (CHROMIUM=/chemin si besoin).
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8124;
const FICHIERS = ['stele-voix-grave.wav', 'stele-voix-alto.wav', 'marees-basse.wav', 'marees-medium.wav', 'marees-aigu.wav', 'carillon-fenetres.wav'];
let echecs = 0;
const verif = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) echecs++; };
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await nav.newPage({ viewport: { width: 1400, height: 900 }, locale: 'fr-FR' });
  await page.addInitScript(() => { for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) { const g = P.getExtension; P.getExtension = function (n) { return n === 'WEBGL_debug_renderer_info' ? null : g.call(this, n); }; } });
  const bruit = [];
  page.on('pageerror', (e) => bruit.push(`[pageerror] ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|WebGL-|Failed to load resource/.test(m.text())) bruit.push(`[console] ${m.text().slice(0, 200)}`); });
  await page.goto(`http://localhost:${PORT}/index.html?edit`, { waitUntil: 'commit' });
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('#enter-btn').click());
  await page.waitForFunction(() => window.__galerie?.editor?.enabled, null, { timeout: 120000 });
  await page.waitForTimeout(800);

  // 1. six sons dans la médiathèque, sans créer d'objet
  const avant = await page.evaluate(() => ({ rooms: window.__galerie.editor.doc.rooms.length, works: window.__galerie.editor.doc.works.length }));
  const importes = await page.evaluate(async (noms) => {
    const files = [];
    for (const n of noms) {
      const blob = await fetch(`audio/${n}`).then((r) => r.blob());
      files.push(new File([blob], n.replace('stele-', 'archive-'), { type: 'audio/wav' }));
    }
    await window.__galerie.editor.media.handleFiles(files, { asLibrary: true });
    return [...window.__galerie.assetOverrides.keys()].filter((k) => /\.wav$/.test(k));
  }, FICHIERS);
  verif(importes.length === 6, `six sons dans la médiathèque : ${importes.join(', ')}`);
  const apres = await page.evaluate(() => ({ rooms: window.__galerie.editor.doc.rooms.length, works: window.__galerie.editor.doc.works.length }));
  verif(apres.rooms === avant.rooms && apres.works === avant.works, `l'import en médiathèque ne crée rien (${apres.works} œuvres, ${apres.rooms} pièces)`);

  // 2. l'assistant : tout coché, 3 × 2 proposé, aperçu lisible
  await page.evaluate(() => { window.__galerie.editor.ui.assistantPieceSons(); });
  await page.waitForSelector('.ed-assistant-sons', { state: 'attached' });
  const etat = await page.evaluate(() => ({
    coches: [...document.querySelectorAll('input[data-as-son]:checked')].length,
    total: [...document.querySelectorAll('input[data-as-son]')].length,
    neufs: [...document.querySelectorAll('.ed-as-liste > .ed-as-son input[data-as-son]')].length,
    replies: document.querySelector('.ed-as-poses')?.open === false ? [...document.querySelectorAll('.ed-as-poses input[data-as-son]')].length : -1,
    mode: document.querySelector('input[data-as-mode]:checked')?.value,
    grille: document.querySelector('[data-as-grille].actif')?.dataset.asGrille,
    apercu: document.querySelector('[data-as-apercu]').textContent,
    nom: document.querySelector('[data-as-nom]').value,
    creer: !document.querySelector('[data-as-creer]').disabled
  }));
  verif(etat.coches === 6 && etat.neufs === 6 && etat.replies === etat.total - 6, `assistant : ${etat.coches} cochés, ${etat.neufs} jamais posés en tête, ${etat.replies} déjà posés repliés (${etat.total} en tout)`);
  verif(etat.mode === 'grille' && etat.grille === '3x2', `disposition proposée : ${etat.mode} ${etat.grille}`);
  verif(/^6 stèles en grille 3 × 2 — salle de [\d.]+ × [\d.]+ m$/.test(etat.apercu), `aperçu : « ${etat.apercu} »`);
  verif(etat.nom === 'Archives 2', `nom proposé : « ${etat.nom} » (Archives existe déjà)`);
  verif(etat.creer, 'le bouton « Créer la pièce » est actif');

  // 3. un septième son déposé PENDANT que l'assistant est ouvert se coche seul
  await page.evaluate(async () => {
    const blob = await fetch('audio/monolithe-pulse.wav').then((r) => r.blob());
    await window.__galerie.editor.media.handleFiles([new File([blob], 'monolithe-pulse.wav', { type: 'audio/wav' })], { asLibrary: true });
  });
  await page.waitForTimeout(200);
  const sept = await page.evaluate(() => ({
    coches: [...document.querySelectorAll('input[data-as-son]:checked')].length,
    apercu: document.querySelector('[data-as-apercu]').textContent
  }));
  verif(sept.coches === 7 && /grille 3 × 3, 2 place\(s\) libre/.test(sept.apercu), `septième son : ${sept.coches} cochés, aperçu « ${sept.apercu} »`);
  // on le décoche : retour à six
  await page.evaluate(() => { const cb = document.querySelector('input[data-as-son="assets/monolithe-pulse.wav"]'); cb.checked = false; cb.dispatchEvent(new Event('change')); });

  // 4. choisir 2 × 2 puis revenir à 3 × 2, nommer, pas large, créer
  await page.evaluate(() => document.querySelector('[data-as-grille="2x2"]').click());
  const deuxDeux = await page.evaluate(() => document.querySelector('[data-as-apercu]').textContent);
  verif(/en grille 2 × 3/.test(deuxDeux), `2 × 2 pour six sons : rangée déduite, « ${deuxDeux} »`);
  await page.evaluate(() => document.querySelector('[data-as-grille="3x2"]').click());
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/assistant.png` });
  await page.evaluate(() => {
    // le toast vit cinq secondes, la construction de la pièce peut en prendre plus : on le note au vol
    window.__toasts = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('ed-toast')) window.__toasts.push(n.textContent); }).observe(document.body, { childList: true });
    const nom = document.querySelector('[data-as-nom]'); nom.value = 'Mes archives'; nom.dispatchEvent(new Event('input'));
    const pas = document.querySelector('[data-as-pas]'); pas.value = 'large'; pas.dispatchEvent(new Event('change'));
    document.querySelector('[data-as-creer]').click();
  });
  await page.waitForFunction(() => window.__galerie.rooms.current?.config?.id === 'mes-archives-1', null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelector('.ed-toast')?.remove(); });
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/piece-creee.png` });
  const piece = await page.evaluate(() => {
    const app = window.__galerie; const room = app.rooms.current; const cfg = room.config;
    const doc = app.editor.doc;
    const works = cfg.works.map((id) => doc.work(id));
    const steles = works.filter((w) => w.role !== 'decor');
    return {
      id: cfg.id, title: cfg.title, shell: [cfg.shell.width, cfg.shell.depth, cfg.shell.height], texture: [cfg.floor.texture, cfg.shell.texture],
      n: works.length, steles: steles.map((w) => ({ id: w.id, title: w.title, color: w.model.color, stem: w.stems?.[0]?.file, x: w.position[0], z: w.position[2], desc: (w.description || '').slice(0, 40) })),
      decor: works.filter((w) => w.role === 'decor').map((w) => w.title),
      artworks: room.artworks.length, rouges: room.artworks.filter((a) => a.mediaError).map((a) => a.config.id),
      annule: doc.history.prochainAnnule, dirty: doc.dirty
    };
  });
  verif(piece.title === 'Mes archives' && piece.n === 12, `pièce « ${piece.title} » (${piece.id}) : ${piece.n} objets (${piece.steles.length} stèles + ${piece.decor.length} décors : ${piece.decor.join(', ')})`);
  verif(new Set(piece.steles.map((s) => s.color)).size === 6, `six couleurs distinctes : ${piece.steles.map((s) => s.color).join(' ')}`);
  verif(piece.steles.every((s) => s.stem && s.title && s.desc), `cartels et pistes : ${piece.steles.map((s) => `${s.title} ← ${s.stem}`).join(' ; ')}`);
  const xs = piece.steles.map((s) => s.x); const zs = piece.steles.map((s) => s.z);
  verif(new Set(zs).size === 2 && Math.abs(xs[1] - xs[0] - 6) < 1e-6, `grille 3 × 2 au pas large : x ${xs.join('/')} z ${zs.join('/')}`);
  verif(piece.shell[0] >= 22 && piece.shell[1] >= 20, `salle ${piece.shell.join(' × ')} m, sol ${piece.texture[0]}, murs ${piece.texture[1]}`);
  verif(piece.artworks === 12 && piece.rouges.length === 0, `${piece.artworks} objets construits dans la scène, ${piece.rouges.length} en erreur`);
  verif(/pièce « Mes archives » depuis 6 sons/.test(piece.annule), `l'historique nomme le lot : « ${piece.annule} »`);
  const toast = await page.evaluate(() => window.__toasts.join(' | '));
  verif(/Pièce « Mes archives » créée : 6 stèles/.test(toast), `toast : « ${toast.slice(0, 90)} »`);

  // 5. les stèles jouent ? au moins leurs pistes sont chargées
  await page.waitForTimeout(2500);
  const son = await page.evaluate(() => {
    const room = window.__galerie.rooms.current;
    return room.artworks.filter((a) => a.config.role !== 'decor').map((a) => ({ id: a.config.id, stems: (a.stems ?? a._stems ?? []).length, ecoute: !!window.__galerie.signaux?.joue?.(a.config.id) }));
  });
  console.log(`  pistes : ${son.map((s) => `${s.id}:${s.stems}${s.ecoute ? '♪' : ''}`).join(' ')}`);

  // 6. annuler d'un bloc, puis rétablir
  await page.evaluate(() => window.__galerie.editor.annuler());
  await page.waitForTimeout(800);
  const annule = await page.evaluate(() => ({ rooms: window.__galerie.editor.doc.rooms.length, works: window.__galerie.editor.doc.works.length, courante: window.__galerie.rooms.current?.config?.id }));
  verif(annule.rooms === avant.rooms && annule.works === avant.works, `Ctrl+Z : ${annule.rooms} pièces, ${annule.works} œuvres, courante ${annule.courante}`);
  await page.evaluate(() => window.__galerie.editor.retablir());
  await page.waitForTimeout(800);
  const retabli = await page.evaluate(() => ({ rooms: window.__galerie.editor.doc.rooms.length, works: window.__galerie.editor.doc.works.length, existe: !!window.__galerie.editor.doc.rooms.find((r) => r.id === 'mes-archives-1') }));
  verif(retabli.rooms === avant.rooms + 1 && retabli.works === avant.works + 12 && retabli.existe, `Ctrl+Maj+Z : ${retabli.rooms} pièces, ${retabli.works} œuvres`);

  // 7. le volet Pièce et la fiche d'une stèle se rendent dans la nouvelle pièce
  await page.evaluate(async () => { await window.__galerie.rooms.setCurrent('mes-archives-1', { instant: true }); window.__galerie.editor.select(null); });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('button[data-onglet="piece"]')?.click());
  await page.waitForTimeout(300);
  const voletPiece = await page.evaluate(() => document.querySelector('#editor-panel')?.innerHTML.length ?? 0);
  await page.evaluate(() => { const app = window.__galerie; const art = app.rooms.current.artworks.find((a) => a.config.role !== 'decor'); app.editor.select({ type: 'artwork', artwork: art }); });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('button[data-onglet="oeuvre"]')?.click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('button[data-sous-onglet="fiche"]')?.click());
  await page.waitForTimeout(300);
  const fiche = await page.evaluate(() => document.querySelector('#editor-panel')?.innerHTML.length ?? 0);
  verif(voletPiece >= 4000 && fiche >= 800, `volet Pièce ${voletPiece} car., fiche ${fiche} car.`);

  // 8. les deux autres portes : le sélecteur de modèle et le panneau Sons
  await page.evaluate(() => window.__galerie.editor.ui.choisirGabarit());
  await page.waitForTimeout(200);
  const portes = await page.evaluate(() => {
    const carte = !!document.querySelector('[data-gab-sons]');
    const archives = [...document.querySelectorAll('.ed-gab-carte b')].map((b) => b.textContent);
    document.querySelector('[data-dlg-annule]')?.click();
    window.__galerie.editor.ui.sons.toggle();
    const bouton = !!document.querySelector('#sons-panel [data-son="piece"]');
    window.__galerie.editor.ui.sons.hide();
    return { carte, archives, bouton };
  });
  verif(portes.carte && portes.archives.includes('Archives') && portes.bouton, `portes : carte « Depuis les sons » ${portes.carte}, modèle Archives ${portes.archives.includes('Archives')}, bouton du panneau Sons ${portes.bouton} (${portes.archives.join(', ')})`);

  for (const b of bruit) console.log(`    ${b}`);
  console.log(`\n${echecs === 0 && bruit.length === 0 ? '✓' : '✗'} bilan : ${echecs} échec(s), ${bruit.length} erreur(s) de page`);
  await nav.close(); process.exit(echecs || bruit.length ? 1 : 0);
})().catch((e) => { console.error('✗', e); process.exit(1); });
