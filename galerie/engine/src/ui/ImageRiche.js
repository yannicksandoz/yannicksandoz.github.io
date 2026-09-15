/**
 * L'IMAGE ENRICHIE — le choix du visiteur, et la proposition à l'arrivée.
 *
 * L'image est UNIQUE : la même pour tous, celle qui tient sur un téléphone
 * (Quality.js). Ce qu'elle a laissé — les ombres, l'occlusion ambiante,
 * quatre échantillons, huit sources étendues, la sonde de reflets vivante —
 * n'est pas perdu : c'est l'image ENRICHIE, au choix du visiteur (menu →
 * Réglages), mémorisée sur l'appareil, et PROPOSÉE à l'arrivée quand la
 * machine se montre à l'aise.
 *
 * « À l'aise » est une MESURE, pas une supposition sur le matériel : six
 * secondes de suite au-dessus de la cadence visée de l'écran, sur l'image
 * unique que le visiteur regarde déjà (Quality.aLaMarge). Un GPU
 * manifestement faible, un téléphone, un mode économe, une image déjà
 * enrichie, ou un « plus tard » déjà dit : pas de proposition.
 *
 * Basculer RECHARGE la page, dans la même salle et le même mode de visite :
 * le renderer, les cartes d'ombre et la sonde de reflets se créent pour un
 * profil, ils ne se remontent pas à chaud. La mémoire de visite, elle, ne
 * bouge pas.
 */
import { ecrireRiche, ecrireEconome } from '../core/crans.js';
import { t } from '../core/i18n.js';

export const CLE_PROPOSE = 'galerie-riche-propose';
const ATTENTE_MAX = 120;   // secondes : passé cela, on ne propose plus

const stockage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

/** Recharge la galerie dans la même salle, le même mode, avec ou sans l'image enrichie. */
export function basculerImageRiche(app, actif) {
  ecrireRiche(actif, stockage());
  if (actif) ecrireEconome(false, stockage());   // les deux ne se cumulent pas
  const url = new URL(window.location.href);
  for (const k of ['profil', 'riche', 'eco', 'work']) url.searchParams.delete(k);
  const salle = app.rooms?.current?.config?.id;
  if (salle) url.searchParams.set('room', salle);
  if (app.modeVisite === 'guidee') url.searchParams.set('mode', 'guidee');
  window.location.href = url.toString();
}

/** Faut-il seulement y penser ? (pur : test-image-riche) */
export function proposable({ isMobile, riche, econome, gpuFaible, dejaPropose, force }) {
  return !isMobile && !riche && !econome && !gpuFaible && !dejaPropose && !force;
}

/**
 * Attend que la machine se montre à l'aise, puis propose, une fois, en
 * bandeau discret. Rend une poignée { dispose }, ou null si rien à proposer.
 */
export function proposerImageRiche(app) {
  const q = app.quality;
  if (!q) return null;
  let dejaPropose = false;
  try { dejaPropose = stockage()?.getItem(CLE_PROPOSE) === '1'; } catch { /* stockage refusé */ }
  if (!proposable({ isMobile: q.isMobile, riche: q.riche, econome: q.econome, gpuFaible: q.gpuFaible, dejaPropose, force: q.force })) return null;

  let attendu = 0; let off = null; let bandeau = null;
  const noter = () => { try { stockage()?.setItem(CLE_PROPOSE, '1'); } catch { /* refusé : on reproposera */ } };
  const montrer = () => {
    bandeau = document.createElement('div');
    bandeau.id = 'proposition-riche';
    bandeau.setAttribute('role', 'status');
    bandeau.innerHTML = `<span>${t('riche.propose')}</span>
      <button type="button" data-riche-oui>${t('riche.activer')}</button>
      <button type="button" data-riche-non class="secondaire">${t('riche.plustard')}</button>`;
    document.body.appendChild(bandeau);
    bandeau.querySelector('[data-riche-oui]').addEventListener('click', () => { noter(); basculerImageRiche(app, true); });
    bandeau.querySelector('[data-riche-non]').addEventListener('click', () => { noter(); poignee.dispose(); });
  };
  const tick = (dt) => {
    attendu += dt;
    if (q.aLaMarge(6)) { off?.(); off = null; montrer(); return; }
    if (attendu > ATTENTE_MAX) { off?.(); off = null; }
  };
  off = app.onUpdate(tick);
  const poignee = {
    dispose() { off?.(); off = null; bandeau?.remove(); bandeau = null; },
    get bandeau() { return bandeau; }
  };
  app._propositionRiche = poignee;
  return poignee;
}
