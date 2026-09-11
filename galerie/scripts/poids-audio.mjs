/**
 * LE POIDS DU SON PUBLIÉ — les règles, pures, partagées par le garde-fou du
 * build (check-visitor-build.mjs) et sa suite de tests (test-poids.mjs).
 *
 * Trois règles, et un rapport :
 *   1. un MASTER (wav, aiff, flac) au-dessus d'un mégaoctet ne part jamais
 *      en ligne — c'est une copie d'écoute que l'on publie, jamais l'original ;
 *   2. aucun fichier audio au-dessus du PLAFOND (8 Mo) : à ce poids-là il
 *      fallait encoder (encode-sons.py) ou fragmenter (fragmente-sons.py) ;
 *   3. une piste qui a ses fragments ne publie ni son `file` ni ses
 *      `formats` entiers ; une piste qui a ses `formats` ne publie pas un
 *      `file` lourd à côté — l'original ne sert plus qu'à l'éditeur.
 * Et un manifeste de fragments nommé par une piste doit exister.
 *
 * `fichiers` : [{ chemin, octets }] relatifs à la racine du build ;
 * `works` / `rooms` : les documents combinés, tels que le build les écrit.
 */

export const MASTERS = /\.(wav|aiff?|flac)$/i;
export const AUDIO = /\.(wav|aiff?|flac|mp3|ogg|oga|opus|webm|m4a|aac)$/i;
export const SEUIL_MASTER = 1 * 1048576;
export const SEUIL_ORIGINAL = 1 * 1048576;
export const PLAFOND = 8 * 1048576;

const Mo = (o) => `${(o / 1048576).toFixed(1)} Mo`;

/** Les pistes de tout le contenu : `{ ou, piste }` pour chaque stem d'œuvre et chaque ambiance. */
export function toutesLesPistes(works = [], rooms = []) {
  const out = [];
  for (const w of works ?? []) for (const s of w?.stems ?? []) out.push({ ou: w.id ?? '?', piste: s });
  for (const r of rooms ?? []) for (const a of r?.ambience ?? []) out.push({ ou: r.id ?? '?', piste: a });
  return out;
}

export function auditerPoids({ fichiers = [], works = [], rooms = [], seuilMaster = SEUIL_MASTER,
  seuilOriginal = SEUIL_ORIGINAL, plafond = PLAFOND } = {}) {
  const erreurs = [];
  const parChemin = new Map(fichiers.map((f) => [normaliser(f.chemin), f.octets]));
  const audio = fichiers.filter((f) => AUDIO.test(f.chemin));

  // 1. et 2. — les fichiers eux-mêmes
  for (const f of audio) {
    if (MASTERS.test(f.chemin) && f.octets > seuilMaster) {
      erreurs.push(`master publié : ${f.chemin} (${Mo(f.octets)}) — encodez-le (encode-sons.py) ou fragmentez-le (fragmente-sons.py)`);
    } else if (f.octets > plafond) {
      erreurs.push(`fichier audio trop lourd : ${f.chemin} (${Mo(f.octets)}, plafond ${Mo(plafond)})`);
    }
  }

  // 3. — les pistes contre ce qui est publié
  for (const { ou, piste } of toutesLesPistes(works, rooms)) {
    if (!piste || typeof piste !== 'object') continue;
    const original = normaliser(piste.file);
    const formats = piste.formats && typeof piste.formats === 'object'
      ? Object.values(piste.formats).map(normaliser).filter(Boolean) : [];
    if (piste.fragments) {
      const manifeste = normaliser(piste.fragments);
      if (!parChemin.has(manifeste)) erreurs.push(`${ou} : manifeste de fragments absent du build : ${piste.fragments}`);
      if (original && parChemin.has(original)) {
        erreurs.push(`${ou} : original publié avec ses fragments : ${piste.file} (${Mo(parChemin.get(original))})`);
      }
      for (const f of formats) {
        if (parChemin.has(f)) erreurs.push(`${ou} : fichier entier publié avec ses fragments : ${f}`);
      }
    } else if (formats.length && original && parChemin.has(original)
      && parChemin.get(original) > seuilOriginal && formats.every((f) => parChemin.has(f))) {
      erreurs.push(`${ou} : original lourd publié à côté de ses formats : ${piste.file} (${Mo(parChemin.get(original))})`);
    }
  }

  return { erreurs, rapport: rapportPoids(audio) };
}

/** Le poids par format, et le total. */
export function rapportPoids(audio) {
  const parFormat = {};
  let total = 0;
  for (const f of audio) {
    const ext = (f.chemin.match(/\.([a-z0-9]+)$/i)?.[1] ?? '?').toLowerCase();
    const r = parFormat[ext] ??= { n: 0, octets: 0 };
    r.n++; r.octets += f.octets; total += f.octets;
  }
  return { parFormat, total, n: audio.length };
}

/** Une ligne par format, lisible dans un journal de build. */
export function texteRapport(rapport) {
  const lignes = Object.entries(rapport.parFormat).sort((a, b) => b[1].octets - a[1].octets)
    .map(([ext, r]) => `   ${ext.padEnd(6)} ${String(r.n).padStart(4)} fichier(s) ${Mo(r.octets).padStart(9)}`);
  return [`audio publié : ${rapport.n} fichier(s), ${Mo(rapport.total)}`, ...lignes].join('\n');
}

/** Un chemin de contenu, sans « ./ » ni barre de tête, ni requête. */
export function normaliser(chemin) {
  if (typeof chemin !== 'string') return null;
  const p = chemin.split(/[?#]/)[0].replace(/^\.?\/+/, '');
  return p || null;
}
