/**
 * LE FORMAT D'UN SON, choisi au chargement.
 *
 * L'ambiance du banc de l'entrée pesait 7,6 Mo — un MP3 à 184 kb/s de cinq
 * minutes que TOUT visiteur téléchargeait dès le pas de la porte (le son ne
 * part qu'après le geste d'entrée), en même temps que les onze autres
 * pistes de la salle d'arrivée et de ses voisines. Le même son en Opus à
 * 64 kb/s tient en 3 Mo, sans différence à l'oreille sur une nappe ; en AAC
 * à 96 kb/s, en 4. Mais aucun des deux n'est lu partout :
 * Opus (dans WebM) par Chrome, Firefox, Edge, Android ; AAC (dans MP4) par
 * Safari et iOS d'abord. D'où trois fichiers côte à côte et UN choix ici.
 *
 * Le JSON d'une piste garde son `file` (le fichier d'origine, celui que
 * l'éditeur montre et que les crédits citent) et reçoit des `formats` :
 *
 *   "file": "assets/x.mp3",
 *   "formats": { "webm": "assets/x.webm", "m4a": "assets/x.m4a" }
 *
 * `choisirSource` est PURE : elle reçoit la piste et un prédicat de support
 * (« ce navigateur lit-il ce type ? »), rend le chemin à charger. La
 * détection réelle (`supportAudio`) passe par `canPlayType`, que le
 * décodage WebAudio suit en pratique. Sans `formats`, ou sans support :
 * le fichier d'origine — rien ne casse, on paie juste le poids d'avant.
 *
 * Voir scripts/encode-sons.py, qui produit les fichiers et écrit `formats`.
 */

/** Les formats connus, par ordre de préférence, et le type qui les teste. */
export const FORMATS = [
  { cle: 'webm', type: 'audio/webm; codecs="opus"' },
  { cle: 'm4a', type: 'audio/mp4; codecs="mp4a.40.2"' }
];

/**
 * Le chemin à charger pour une piste.
 * @param {object} stem  la config de la piste ({ file, formats? })
 * @param {(type: string) => boolean} supporte  « ce type est-il lisible ? »
 */
export function choisirSource(stem, supporte) {
  const formats = stem?.formats;
  if (formats && typeof formats === 'object' && typeof supporte === 'function') {
    for (const f of FORMATS) {
      const chemin = formats[f.cle];
      if (typeof chemin === 'string' && chemin && supporte(f.type)) return chemin;
    }
  }
  return stem?.file ?? null;
}

/**
 * Le prédicat de support du navigateur courant, mémorisé par type. Sans
 * DOM (tests, visite sans WebGL en repli), rien n'est supporté : on charge
 * le fichier d'origine.
 */
export function supportAudio() {
  const memo = new Map();
  let sonde = null;
  try { sonde = typeof document !== 'undefined' ? document.createElement('audio') : null; } catch { sonde = null; }
  return (type) => {
    if (memo.has(type)) return memo.get(type);
    let ok = false;
    try {
      const r = sonde?.canPlayType?.(type) ?? '';
      // « probably » ou « maybe » : les deux valent oui — un « maybe » sur
      // Opus/WebM est ce que répond Chrome, qui le lit très bien
      ok = r === 'probably' || r === 'maybe';
    } catch { ok = false; }
    memo.set(type, ok);
    return ok;
  };
}

/**
 * Charger le chemin choisi, et si LUI échoue (réseau, ou un « maybe » de
 * `canPlayType` que le décodeur dément), recharger le fichier d'origine.
 * Un repli ne se tente que s'il change quelque chose : origine absente ou
 * identique au choix, l'erreur remonte telle quelle.
 *
 * @param {(url: string) => Promise<any>} charger  fetch + décodage
 * @param {string} choisi   le chemin retenu par `choisirSource`
 * @param {string|null} origine  le `file` de la piste, résolu
 * @param {(erreur: any) => void} [avertir]  appelé avant le repli
 * @returns {Promise<{ buffer: any, url: string }>}  ce qui a marché, et d'où
 */
export async function chargerAvecRepli(charger, choisi, origine, avertir) {
  try {
    return { buffer: await charger(choisi), url: choisi };
  } catch (erreur) {
    if (!origine || origine === choisi) throw erreur;
    avertir?.(erreur);
    return { buffer: await charger(origine), url: origine };
  }
}
