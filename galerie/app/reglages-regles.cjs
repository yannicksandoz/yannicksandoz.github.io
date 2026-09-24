/**
 * LES RÈGLES DES RÉGLAGES DE L'APPLICATION — pures, testées au nœud.
 *
 *   • les GALERIES RÉCENTES : les dossiers de contenu adoptés, du plus
 *     récent au plus ancien, sans doublon, huit au plus — le menu Fichier
 *     les propose, un clic et l'application change de galerie ;
 *   • la COMPARAISON DE VERSIONS : « 1.0.0-beta.2 » est plus récente que
 *     « 1.0.0-beta.1 », « 1.0.0 » l'est plus que toute pré-version, et un
 *     texte qui n'est pas une version ne l'emporte jamais. La version de
 *     référence est celle du `package.json` du dépôt public (lisible sans
 *     jeton) ; les binaires, eux, vivent dans une Release privée ;
 *   • UN DOSSIER DE GALERIE se reconnaît à son index (`rooms/index.json`
 *     ou `works/index.json`) : c'est ce qui permet d'ouvrir un dossier
 *     déposé sur l'application, ou passé en argument, sans se tromper.
 */
'use strict';

const RECENTS_MAX = 8;

/** `chemin` en tête de `liste`, sans doublon, bornée à `max`. */
function noterRecent(liste, chemin, max = RECENTS_MAX) {
  if (!chemin) return Array.isArray(liste) ? [...liste] : [];
  const reste = (Array.isArray(liste) ? liste : []).filter((c) => c && c !== chemin);
  return [chemin, ...reste].slice(0, Math.max(0, max));
}

/** Les composantes d'une version « 1.2.3-beta.4 » : [[1,2,3], ['beta', 4]] ou null. */
function analyser(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v ?? '').trim());
  if (!m) return null;
  const pre = m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : null;
  return { nombres: [Number(m[1]), Number(m[2]), Number(m[3])], pre };
}

/** `a` est-elle strictement plus récente que `b` ? (semver, sans les métadonnées) */
function plusRecente(a, b) {
  const va = analyser(a), vb = analyser(b);
  if (!va) return false;
  if (!vb) return true;
  for (let i = 0; i < 3; i++) {
    if (va.nombres[i] !== vb.nombres[i]) return va.nombres[i] > vb.nombres[i];
  }
  // même triplet : une version finale bat une pré-version
  if (!va.pre && !vb.pre) return false;
  if (!va.pre) return true;
  if (!vb.pre) return false;
  const n = Math.max(va.pre.length, vb.pre.length);
  for (let i = 0; i < n; i++) {
    const x = va.pre[i], y = vb.pre[i];
    if (x === undefined) return false;   // le plus court est le plus ancien
    if (y === undefined) return true;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x > y;
    if (typeof x === 'number') return false;   // un nombre passe avant un mot
    if (typeof y === 'number') return true;
    return x > y;
  }
  return false;
}

/** Un dossier est une galerie s'il a un index d'œuvres ou de pièces. */
function estUneGalerie(chemin, existe) {
  if (!chemin) return false;
  return ['rooms/index.json', 'works/index.json'].some((f) => existe(`${chemin}/${f}`));
}

module.exports = { noterRecent, plusRecente, analyser, estUneGalerie, RECENTS_MAX };
