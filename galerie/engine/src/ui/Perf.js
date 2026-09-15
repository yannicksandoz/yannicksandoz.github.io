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
 *   • l'état des crans du gouverneur (Quality / crans.js) et la densité.
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

/** `?perf=1` dans l'adresse ? */
export function perfDemande(search = '') {
  try { return new URLSearchParams(search).get('perf') === '1'; } catch { return false; }
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
  let horloge = 0; let depuis = 0; let appels = 0; let triangles = 0;
  const tick = (dt) => {
    horloge += dt;
    stats.ajouter(horloge, dt);
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
    const mesure = {
      ms: Math.round(ms * 10) / 10, p95: Math.round(p95 * 10) / 10, fps: Math.round(fps),
      appels, triangles, tampons: audio.tampons, pcmMo: Math.round(audio.octets / 1048576 * 10) / 10,
      profil: app.quality?.profile?.tier ?? '', crans: etat, salle
    };
    window.__galeriePerf = mesure;
    el.innerHTML = `<b>${mesure.ms.toFixed(1)} ms</b> · p95 ${mesure.p95.toFixed(1)} ms · ${mesure.fps} fps
      <br>${compact(appels)} appels · ${compact(triangles)} tri · ${salle}
      <br>audio ${audio.tampons} tampon${audio.tampons > 1 ? 's' : ''} · ${mesure.pcmMo} Mo PCM
      <br>${mesure.profil} · ${texteCrans(etat)}`;
    el.classList.toggle('perf-lent', p95 > 33);
  };
  const off = app.onUpdate(tick);
  peindre();

  const poignee = {
    el, stats,
    dispose() {
      off?.();
      if (info) info.autoReset = autoResetAvant;
      el.remove();
      delete window.__galeriePerf;
      app._perf = null;
    }
  };
  app._perf = poignee;
  return poignee;
}
