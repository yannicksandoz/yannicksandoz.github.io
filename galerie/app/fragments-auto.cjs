/**
 * LA FRAGMENTATION AUTOMATIQUE — les sons longs, découpés par l'application
 * elle-même, sans que l'auteur y pense.
 *
 * scripts/fragmente-sons.py fait ce travail à la main, avec ffmpeg : des
 * SEGMENTS de dix secondes (plus un court chevauchement) dans deux formats
 * (Opus/WebM, AAC/MP4) et un manifeste `x.fragments.json` que la piste nomme
 * (`"fragments"`, voir engine/src/core/fragments.js). Ici, la même règle,
 * en Node, appelée par l'application à la PUBLICATION : chaque piste dont le
 * fichier pèse au moins un mégaoctet (ou dure plus d'une minute) est
 * fragmentée dans le dossier de contenu, et la page reçoit le manifeste à
 * écrire dans le JSON de l'œuvre. Idempotent : des segments plus récents
 * que la source ne sont pas refaits.
 *
 * ffmpeg reste exigé — une application de bureau ne réencode pas l'Opus et
 * l'AAC seule, et l'on ne l'embarque pas (licence). Il est cherché dans le
 * PATH, puis aux endroits où Homebrew et MacPorts le posent : une
 * application lancée du Finder n'a pas le PATH du terminal.
 *
 * Les fonctions PURES (le plan de découpe, le choix des pistes, la
 * recherche du binaire sur une liste de candidats) sont testées au nœud ;
 * l'exécution de ffmpeg est isolée dans `encoder`, remplaçable.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const VERSION = 1;
const SEGMENT = 10;
const CHEVAUCHEMENT = 0.1;
const OPUS = '64k';
const AAC = '96k';
/** À partir de quoi une piste est « longue » : un mégaoctet, ou une minute. */
const SEUIL_OCTETS = 1048576;
const SEUIL_SECONDES = 60;
const ENCODABLES = new Set(['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.aif', '.aiff', '.m4a', '.webm']);

/** Le même découpage que fragments.js et fragmente-sons.py : [{ i, debut, longueur }]. */
function planFragments(duree, segment = SEGMENT, chevauchement = CHEVAUCHEMENT) {
  const out = [];
  if (!(duree > 0) || !(segment > 0)) return out;
  for (let i = 0; i * segment < duree; i++) {
    const debut = i * segment;
    out.push({ i, debut, longueur: Math.round(Math.min(segment + chevauchement, duree - debut) * 1000) / 1000 });
  }
  return out;
}

/** Faut-il fragmenter cette piste ? `{ file, fragments, octets, duree }` → raison, ou null. */
function aFragmenter({ file, fragments, octets, duree }) {
  if (fragments) return null;                                   // déjà fait
  if (typeof file !== 'string' || !ENCODABLES.has(path.extname(file).toLowerCase())) return null;
  if (Number(octets) >= SEUIL_OCTETS) return `${(octets / 1048576).toFixed(1)} Mo`;
  if (Number(duree) >= SEUIL_SECONDES) return `${Math.round(duree)} s`;
  return null;
}

/** Les chemins que la piste et son manifeste prendront, relatifs au dossier de contenu. */
function cheminsDe(file) {
  const base = file.replace(/\.[^./]+$/, '');
  return { dossier: `${base}.frag`, manifeste: `${base}.fragments.json` };
}

/** Le manifeste que le moteur lit. */
function manifeste(duree, n, dossier, { segment = SEGMENT, chevauchement = CHEVAUCHEMENT } = {}) {
  return {
    version: VERSION, duree: Math.round(duree * 1000) / 1000, segment, chevauchement, n,
    formats: { webm: `${dossier}/{i}.webm`, m4a: `${dossier}/{i}.m4a` }
  };
}

/** Le premier candidat exécutable : `FFMPEG`, le PATH, puis les emplacements connus. */
function trouverBinaire({ env = process.env, existe = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }, plateforme = process.platform } = {}) {
  const nom = plateforme === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidats = [];
  if (env.FFMPEG) candidats.push(env.FFMPEG);
  for (const d of String(env.PATH ?? '').split(path.delimiter)) if (d) candidats.push(path.join(d, nom));
  candidats.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/local/bin/ffmpeg', '/usr/bin/ffmpeg',
    'C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe');
  return candidats.find((c) => existe(c)) ?? null;
}

const CONSEIL = 'ffmpeg est introuvable : installez-le (macOS : brew install ffmpeg ; Windows : ffmpeg.org, puis C:\\ffmpeg\\bin) '
  + 'ou indiquez son chemin dans la variable FFMPEG. Sans lui, les sons longs partent entiers.';

/** ffmpeg, en promesse. */
function lancer(ff, args, { timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(ff, args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').split('\n').filter(Boolean).slice(-1)[0] || 'ffmpeg a échoué'));
      else resolve({ stdout, stderr });
    });
  });
}

/** La durée d'un fichier, lue dans « ffmpeg -i » (pas de ffprobe requis). */
async function dureeDe(ff, source) {
  let sortie = '';
  try { await lancer(ff, ['-hide_banner', '-i', source]); } catch (e) { sortie = e.message; }
  // ffmpeg sort en erreur sans sortie demandée : la durée est dans stderr
  const r = await new Promise((resolve) => execFile(ff, ['-hide_banner', '-i', source], { windowsHide: true }, (err, so, se) => resolve(se || sortie)));
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r);
  if (!m) throw new Error(`durée introuvable : ${path.basename(source)}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function aJour(absManifeste, absDossier, source, n) {
  try {
    const t = fs.statSync(source).mtimeMs;
    if (fs.statSync(absManifeste).mtimeMs < t) return false;
    for (let i = 0; i < n; i++) {
      for (const ext of ['webm', 'm4a']) {
        if (fs.statSync(path.join(absDossier, `${String(i).padStart(3, '0')}.${ext}`)).mtimeMs < t) return false;
      }
    }
    return true;
  } catch { return false; }
}

/**
 * Fragmente une piste : `{ contenu, file }` → `{ file, manifeste, n, duree, refait }`.
 * `encoder(ff, source, debut, longueur, cible, args)` est remplaçable (tests).
 */
async function fragmenterPiste({ contenu, file, ff, segment = SEGMENT, chevauchement = CHEVAUCHEMENT, opus = OPUS, aac = AAC,
  encoder = defautEncoder, duree: dureeConnue = null, surProgres = null }) {
  const source = path.join(contenu, file);
  if (!fs.existsSync(source)) throw new Error(`${file} introuvable dans le dossier de contenu`);
  const { dossier, manifeste: relManifeste } = cheminsDe(file);
  const absDossier = path.join(contenu, dossier);
  const absManifeste = path.join(contenu, relManifeste);
  const duree = Number(dureeConnue) > 0 ? Number(dureeConnue) : await dureeDe(ff, source);
  const decoupe = planFragments(duree, segment, chevauchement);
  if (aJour(absManifeste, absDossier, source, decoupe.length)) {
    return { file, manifeste: relManifeste, n: decoupe.length, duree, refait: false };
  }
  fs.mkdirSync(absDossier, { recursive: true });
  let fait = 0;
  for (const { i, debut, longueur } of decoupe) {
    const nom = String(i).padStart(3, '0');
    await encoder(ff, source, debut, longueur, path.join(absDossier, `${nom}.webm`),
      ['-c:a', 'libopus', '-b:a', opus, '-vbr', 'on', '-application', 'audio']);
    await encoder(ff, source, debut, longueur, path.join(absDossier, `${nom}.m4a`),
      ['-c:a', 'aac', '-b:a', aac, '-movflags', '+faststart']);
    fait++;
    surProgres?.(fait, decoupe.length);
  }
  fs.writeFileSync(absManifeste, `${JSON.stringify(manifeste(duree, decoupe.length, dossier, { segment, chevauchement }), null, 2)}\n`);
  return { file, manifeste: relManifeste, n: decoupe.length, duree, refait: true };
}

function defautEncoder(ff, source, debut, longueur, cible, args) {
  return lancer(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source,
    '-ss', debut.toFixed(3), '-t', longueur.toFixed(3), '-vn', ...args, cible]);
}

/**
 * Le lot : `pistes` = [{ file, fragments, duree }] (ce que la page sait) ;
 * chaque piste est pesée sur le disque, retenue ou non (aFragmenter), puis
 * fragmentée. → { faits: [...], ignorees: n, erreurs: [{ file, message }], ffmpeg }
 */
async function fragmenterLot({ contenu, pistes, ff = trouverBinaire(), encoder = defautEncoder, surProgres = null }) {
  const retenues = [];
  for (const p of pistes ?? []) {
    let octets = 0;
    try { octets = fs.statSync(path.join(contenu, p.file)).size; } catch { continue; }
    const raison = aFragmenter({ file: p.file, fragments: p.fragments, octets, duree: p.duree });
    if (raison) retenues.push({ ...p, raison });
  }
  if (!retenues.length) return { faits: [], ignorees: (pistes ?? []).length, erreurs: [], ffmpeg: Boolean(ff) };
  if (!ff) return { faits: [], ignorees: (pistes ?? []).length, erreurs: [], ffmpeg: false, aFaire: retenues.map((p) => p.file), conseil: CONSEIL };
  const faits = [];
  const erreurs = [];
  let k = 0;
  for (const p of retenues) {
    k++;
    try {
      faits.push(await fragmenterPiste({ contenu, file: p.file, ff, encoder, duree: p.duree,
        surProgres: (fait, total) => surProgres?.({ piste: k, pistes: retenues.length, file: p.file, fait, total }) }));
    } catch (e) { erreurs.push({ file: p.file, message: e?.message ?? String(e) }); }
  }
  return { faits, ignorees: (pistes ?? []).length - retenues.length, erreurs, ffmpeg: true };
}

module.exports = { planFragments, aFragmenter, cheminsDe, manifeste, trouverBinaire, fragmenterPiste, fragmenterLot,
  SEGMENT, CHEVAUCHEMENT, SEUIL_OCTETS, SEUIL_SECONDES, CONSEIL };
