/**
 * LE CARTOUCHE DE MESURE — `?perf=1` : ce que l'image et le son coûtent,
 * lisible sur l'appareil lui-même.
 *
 * Les sondes (scripts/sonde-*.cjs) mesurent en Chromium émulé ; l'iPhone,
 * lui, ne se laisse pas émuler, et c'est là que tout se joue. Ce cartouche
 * s'affiche en bas à gauche quand l'adresse porte `?perf=1`, jamais sinon,
 * et dit toutes les demi-secondes :
 *   • le temps d'image MOYEN et son P95 sur deux secondes (les à-coups se
 *     lisent au p95, pas à la moyenne), et les images par seconde ;
 *   • les appels de rendu et les triangles de l'image entière — toutes
 *     les passes, pas la dernière : on coupe la remise à zéro automatique
 *     de `renderer.info` et on la fait soi-même, une fois par image ;
 *   • les tampons audio décodés et leur poids en mémoire (AudioEngine) ;
 *   • l'état des crans du gouverneur (Quality / crans.js) et la densité ;
 *   • LES PHASES : le JavaScript de chaque étape de la boucle (mise à jour,
 *     audio, lumière, reflets, apparitions, survol, soumission du rendu),
 *     en moyenne, et le total avec son p95. Un iPhone ne se profile pas
 *     depuis ici : si le JavaScript remplit l'image, c'est le processeur
 *     qui retient ; s'il n'en prend qu'un tiers, c'est le GPU.
 * Les mêmes valeurs vont dans `window.__galeriePerf`, pour les sondes.
 *
 * La STATISTIQUE est pure (`Statistiques`) : test-perf l'éprouve.
 */
import { etatDe } from '../core/crans.js';

/** Une fenêtre glissante de durées d'image : moyenne et p95. */
export class Statistiques {
  constructor({ fenetre = 2 } = {}) {
    this.fenetre = fenetre;   // secondes
    this._durees = [];        // [{ t, dt }]
  }

  /** Une image de `dt` secondes s'est terminée à l'instant `t`. */
  ajouter(t, dt) {
    if (!(dt > 0)) return;
    this._durees.push({ t, dt });
    const limite = t - this.fenetre;
    while (this._durees.length && this._durees[0].t < limite) this._durees.shift();
  }

  get n() { return this._durees.length; }

  /** Durée moyenne d'une image, en secondes (0 sans mesure). */
  moyenne() {
    if (!this._durees.length) return 0;
    let s = 0;
    for (const d of this._durees) s += d.dt;
    return s / this._durees.length;
  }

  /** Le p95 : 95 % des images ont duré moins que cela. */
  p95() {
    if (!this._durees.length) return 0;
    const tri = this._durees.map((d) => d.dt).sort((a, b) => a - b);
    return tri[Math.min(tri.length - 1, Math.ceil(0.95 * tri.length) - 1)];
  }
}

/** Le nombre, lisible : 410 000 → « 410 k », 1 234 567 → « 1,2 M ». */
export function compact(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)} k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} k`;
  return String(Math.round(n));
}

/** Les crans en un mot chacun : ce qui est coupé se lit d'un coup d'œil. */
export function texteCrans(etat) {
  if (!etat) return '';
  const mots = [];
  mots.push(`msaa ${etat.msaa ?? 0}`);
  mots.push(etat.gtao ? 'gtao' : 'gtao·off');
  mots.push(etat.ombres ? 'ombres' : 'ombres·off');
  if (etat.isf !== undefined) mots.push(`isf ${etat.isf}`);
  if (etat.etendues !== undefined) mots.push(`étendues ${etat.etendues}`);
  if (etat.apparitions === false) mots.push('apparitions·off');
  if (etat.grain === false) mots.push('grain·off');
  if (etat.bloom === false) mots.push('bloom·off');
  mots.push(`×${Number(etat.pixelRatio ?? 1).toFixed(2).replace(/\.?0+$/, '')}`);
  return mots.join(' · ');
}

/** Les phases en une ligne : le total et son p95, puis chaque étape. */
export const PHASES = ['maj', 'audio', 'lumiere', 'reflets', 'vistas', 'survol', 'rendu'];
const NOMS = { maj: 'maj', audio: 'audio', lumiere: 'lumière', reflets: 'reflets', vistas: 'apparitions', survol: 'survol', rendu: 'rendu' };
export function textePhases(moyennes, total, p95) {
  if (!moyennes) return '';
  const f = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const parts = PHASES.filter((k) => Number.isFinite(moyennes[k])).map((k) => `${NOMS[k]} ${f(moyennes[k])}`);
  return `js ${f(total)} ms · p95 ${f(p95)} · ${parts.join(' · ')}`;
}

/** `?perf=1` dans l'adresse ? (`?banc=1` l'implique : le banc a besoin du cartouche) */
export function perfDemande(search = '') {
  try { const q = new URLSearchParams(search); return q.get('perf') === '1' || q.get('banc') === '1'; } catch { return false; }
}

/** `?banc=1` : le banc d'essai, qui enchaîne les variantes tout seul. */
export function bancDemande(search = '') {
  try { return new URLSearchParams(search).get('banc') === '1'; } catch { return false; }
}

/**
 * LE BANC D'ESSAI — `?banc=1` : sur l'appareil lui-même, chaque variante
 * de l'image se mesure à son tour, sans rien demander à personne.
 *
 * Un iPhone ne se profile pas depuis le poste de travail, et demander au
 * visiteur dix captures avec dix adresses n'est pas une mesure. Ici, le
 * banc coupe UNE chose à la fois — la densité, l'affûtage, le bloom, les
 * lignes de lumière, les lampes, l'anticrénelage, le liseré, la poussière
 * — la laisse s'installer (les programmes se recompilent, les fondus
 * passent), mesure trois secondes d'images, la remet, et passe à la
 * suivante. Le tableau se remplit dans le cartouche ; à la fin, une seule
 * capture dit ce que chaque chose coûte VRAIMENT sur cet appareil, dans
 * cette salle, à cet endroit. C'est ce tableau qui décide des réglages,
 * pas une intuition sur ce qu'un GPU de téléphone devrait aimer.
 *
 * Chaque variante : { id, nom, poser(app) → remettre(), attente? }.
 *
 * EN ALTERNANCE AVEC LE TÉMOIN. Une première version mesurait le témoin
 * une fois, en tête ; sur un iPhone, quarante secondes de GPU à fond le
 * réchauffent et tout ce qui vient après le témoin paraît plus lent — le
 * banc affichait « +0,5 » à toutes les variantes, y compris « sans
 * lampes », mesurée −2,7 le matin. Ici chaque variante est précédée de SON
 * témoin, mesuré dans les mêmes secondes, et c'est à lui qu'elle se
 * compare : la dérive de la machine s'annule entre deux mesures voisines.
 * Le changement de densité recrée toutes les cibles de rendu : il a droit
 * à une attente plus longue avant qu'on ne le mesure.
 */
export const ATTENTE_BANC = 1.5;   // secondes : le temps que la variante s'installe
export const MESURE_BANC = 3;      // secondes de mesure par variante
export const VARIANTES_BANC = [
  { id: 'temoin', nom: 'témoin', poser: () => () => {} },
  { id: 'densite1', nom: 'densité ×1', attente: 4, poser: (app) => {
    const avant = app.quality.profile.pixelRatio; const nettete = app.sortie.nettete;
    app.quality._poserDensite(app, 1);
    return () => { app.quality._poserDensite(app, avant); app.sortie.nettete = nettete; app.quality.profile.nettete = nettete; };
  } },
  { id: 'nettete', nom: 'sans affûtage', poser: (app) => { const v = app.sortie.nettete; app.sortie.nettete = 0; return () => { app.sortie.nettete = v; }; } },
  { id: 'bloom', nom: 'sans bloom', poser: (app) => { const v = app.sortie.bloomActif; app.sortie.bloomActif = false; return () => { app.sortie.bloomActif = v; }; } },
  { id: 'lignes', nom: 'sans lignes', poser: (app) => { const v = app.quality.profile.lignesProches; app.setBudgetLignes(0); return () => { app.setBudgetLignes(v); }; } },
  { id: 'lampes', nom: 'sans lampes', poser: (app) => {
    const p = app.quality.profile; const v = p.lampesProches;
    p.lampesProches = { points: 0, cones: 0 };
    return () => { p.lampesProches = v; };
  } },
  { id: 'msaa', nom: 'sans msaa', poser: (app) => { const v = app.scenePass?.cible?.samples ?? 0; app.setMsaa(0); return () => { app.setMsaa(v); }; } },
  { id: 'survol', nom: 'sans liseré', poser: (app) => { const f = app._viserSurvol; app._viserSurvol = () => {}; app.survol?.viser(null); return () => { app._viserSurvol = f; }; } },
  { id: 'poussiere', nom: 'sans poussière', poser: (app) => { const d = app.dust; if (!d) return () => {}; const v = d.visible; d.visible = false; return () => { d.visible = v; }; } }
];

/**
 * Le tableau du banc, une ligne par variante mesurée : moyenne et p95 en
 * ms, et l'écart à SON témoin (mesuré juste avant elle).
 */
export function texteBanc(resultats, encours = null) {
  const lignes = [];
  for (const r of resultats) {
    const ecart = Number.isFinite(r.temoinMs) ? ` (${r.ms <= r.temoinMs ? '−' : '+'}${Math.abs(r.temoinMs - r.ms).toFixed(1)} vs ${r.temoinMs.toFixed(1)})` : '';
    lignes.push(`${r.nom} ${r.ms.toFixed(1)} · p95 ${r.p95.toFixed(1)}${ecart}`);
  }
  if (encours) lignes.push(`… ${encours}`);
  return lignes.join('<br>');
}

/**
 * Lance le banc : une variante après l'autre, les résultats dans
 * `poignee.banc` et `window.__galerieBanc`, le tableau dans le cartouche.
 */
export function lancerBanc(app, poignee, { variantes = VARIANTES_BANC, attente = ATTENTE_BANC, mesure = MESURE_BANC,
  horloge = (typeof performance !== 'undefined' ? () => performance.now() : null) } = {}) {
  const resultats = [];
  poignee.banc = resultats;
  // la liste réelle : chaque variante précédée de son témoin (le premier
  // témoin de la liste tient lieu de témoin à la première variante)
  const etapes = [];
  for (const v of variantes) {
    if (v.id !== 'temoin' && etapes[etapes.length - 1]?.id !== 'temoin') etapes.push({ id: 'temoin', nom: 'témoin', poser: () => () => {}, muet: true });
    etapes.push(v);
  }
  let i = 0; let remettre = null; let phase = 'attente'; let depuis = 0;
  let stats = null; let dernierTemoin = null;
  const suivante = () => {
    if (i >= etapes.length) { poignee.encours = 'banc terminé'; poignee.peindre(); off(); return; }
    const v = etapes[i];
    try { remettre = v.poser(app); } catch (e) { console.warn('[galerie] banc :', v.id, e?.message ?? e); remettre = () => {}; }
    phase = 'attente'; depuis = 0; stats = new Statistiques({ fenetre: mesure + 1 });
    poignee.encours = `${v.nom} (${i + 1}/${etapes.length})`;
  };
  let precedent = 0;
  const off = app.onUpdate((dtBoucle) => {
    if (!stats) return;
    // le temps réel, comme le cartouche (voir `tick`) — au nœud, sans
    // horloge fine, le dt de la boucle suffit
    const maintenant = horloge ? horloge() : 0;
    const dt = precedent && maintenant ? (maintenant - precedent) / 1000 : dtBoucle;
    precedent = maintenant;
    depuis += dt;
    const v = etapes[i];
    if (phase === 'attente') { if (depuis >= (v.attente ?? attente)) { phase = 'mesure'; depuis = 0; } return; }
    stats.ajouter(depuis, dt);
    if (depuis < mesure) return;
    const mesureFaite = { ms: stats.moyenne() * 1000, p95: stats.p95() * 1000 };
    if (v.id === 'temoin') {
      dernierTemoin = mesureFaite;
      // le premier témoin s'affiche ; les suivants ne servent qu'à leur variante
      if (!v.muet) resultats.push({ id: v.id, nom: v.nom, ...mesureFaite });
    } else {
      resultats.push({ id: v.id, nom: v.nom, ...mesureFaite, temoinMs: dernierTemoin?.ms, temoinP95: dernierTemoin?.p95 });
    }
    if (typeof window !== 'undefined') window.__galerieBanc = resultats;
    try { remettre?.(); } catch (e) { console.warn('[galerie] banc : remise', v.id, e?.message ?? e); }
    i++; suivante(); poignee.peindre();
  });
  suivante();
  return { get resultats() { return resultats; }, arreter: off };
}

export function mountPerf(app) {
  if (app._perf) return app._perf;
  const el = document.createElement('div');
  el.id = 'perf-cartouche';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);

  const info = app.renderer?.info;
  const autoResetAvant = info ? info.autoReset : true;
  if (info) info.autoReset = false;   // on compte l'image ENTIÈRE, toutes passes

  const stats = new Statistiques();
  // les phases de l'image précédente (App les chronomètre tant que
  // `app.phases` existe) : une fenêtre par étape, une pour le total
  const statsPhases = Object.fromEntries(PHASES.map((k) => [k, new Statistiques()]));
  const statsJs = new Statistiques();
  app.phases = {};
  let horloge = 0; let depuis = 0; let appels = 0; let triangles = 0;
  // LE TEMPS RÉEL entre deux images, pas le `dt` de la boucle : celui-ci
  // est borné à 100 ms (une image qui a duré une seconde ne fait pas
  // sauter les animations d'une seconde), et une mesure bornée ment sur
  // les à-coups — c'est justement eux qu'on veut voir au p95
  let precedent = 0;
  const tick = (dtBoucle) => {
    const maintenant = performance.now();
    const dt = precedent ? (maintenant - precedent) / 1000 : dtBoucle;
    precedent = maintenant;
    horloge += dt;
    stats.ajouter(horloge, dt);
    let js = 0;
    for (const k of PHASES) {
      const v = app.phases[k];
      if (Number.isFinite(v)) { statsPhases[k].ajouter(horloge, v / 1000); js += v; }
      app.phases[k] = 0;
    }
    if (js > 0) statsJs.ajouter(horloge, js / 1000);
    if (info) {
      // ce que l'image PRÉCÉDENTE a coûté (la boucle appelle ceci avant le rendu)
      appels = info.render.calls; triangles = info.render.triangles;
      info.reset();
    }
    depuis += dt;
    if (depuis < 0.5) return;
    depuis = 0;
    peindre();
  };
  const peindre = () => {
    const ms = stats.moyenne() * 1000; const p95 = stats.p95() * 1000;
    const fps = ms > 0 ? 1000 / ms : 0;
    const audio = app.audio?.bilan?.() ?? { tampons: 0, octets: 0 };
    const etat = app.quality ? etatDe(app.quality.profile, app) : null;
    const salle = app.rooms?.current?.config?.id ?? '—';
    const phases = Object.fromEntries(PHASES.map((k) => [k, statsPhases[k].moyenne() * 1000]));
    const js = statsJs.moyenne() * 1000; const jsP95 = statsJs.p95() * 1000;
    const mesure = {
      ms: Math.round(ms * 10) / 10, p95: Math.round(p95 * 10) / 10, fps: Math.round(fps),
      appels, triangles, tampons: audio.tampons, pcmMo: Math.round(audio.octets / 1048576 * 10) / 10,
      profil: app.quality?.profile?.tier ?? '', crans: etat, salle,
      js: Math.round(js * 10) / 10, jsP95: Math.round(jsP95 * 10) / 10, phases
    };
    window.__galeriePerf = mesure;
    el.innerHTML = `<b>${mesure.ms.toFixed(1)} ms</b> · p95 ${mesure.p95.toFixed(1)} ms · ${mesure.fps} fps
      <br>${compact(appels)} appels · ${compact(triangles)} tri · ${salle}
      <br>audio ${audio.tampons} tampon${audio.tampons > 1 ? 's' : ''} · ${mesure.pcmMo} Mo PCM
      <br>${mesure.profil} · ${texteCrans(etat)}
      <br>${textePhases(phases, js, jsP95)}${poignee.banc ? '<br>' + texteBanc(poignee.banc, poignee.encours) : ''}`;
    el.classList.toggle('perf-lent', p95 > 33);
  };
  // la poignée AVANT le premier `peindre` : il la lit (le banc)
  let off = null;
  const poignee = {
    el, stats, peindre, encours: null, banc: null,
    dispose() {
      off?.();
      app.phases = null;
      if (info) info.autoReset = autoResetAvant;
      el.remove();
      delete window.__galeriePerf;
      app._perf = null;
    }
  };
  app._perf = poignee;
  off = app.onUpdate(tick);
  peindre();
  if (bancDemande(typeof location !== 'undefined' ? location.search : '')) lancerBanc(app, poignee);
  return poignee;
}
