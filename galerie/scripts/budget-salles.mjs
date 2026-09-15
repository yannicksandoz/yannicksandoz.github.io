/**
 * LE BUDGET DES SALLES, sur le contenu — les mêmes règles que l'éditeur
 * (core/budget-salle.js), pesées sur les fichiers du dossier de contenu.
 *
 *   node scripts/budget-salles.mjs [dossier]     (défaut : content, ou GALERIE_CONTENT)
 *
 * Exporte aussi `mesurerDossier` pour le garde-fou du build, qui pèse dist/.
 * Les durées : lues dans l'en-tête des WAV et dans les manifestes de
 * fragments ; les autres formats (mp3, m4a, webm) restent « inconnus » ici
 * — l'éditeur, lui, les demande au navigateur.
 */
import { readdirSync, readFileSync, statSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { budgetsGalerie, texteBudgets, dureeWav, BUDGET } from '../engine/src/core/budget-salle.js';

/** Les chemins de fichiers de `dossier`, relatifs, avec leur poids. */
function peser(dossier) {
  const octets = new Map();
  const marcher = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const chemin = join(d, e.name); const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) marcher(chemin, r);
      else octets.set(r, statSync(chemin).size);
    }
  };
  marcher(dossier, '');
  return octets;
}

function lireEnteteWav(chemin) {
  const fd = openSync(chemin, 'r');
  try { const b = new Uint8Array(44); readSync(fd, b, 0, 44, 0); return b; } finally { closeSync(fd); }
}

/**
 * Mesure un dossier de contenu (ou un build) : { octets, durees }, où un
 * manifeste de fragments pèse la SOMME de ses segments dans le premier
 * format déclaré, et dure ce que dit son manifeste.
 */
export function mesurerDossier(dossier) {
  const octets = peser(dossier);
  const durees = new Map();
  for (const [chemin, o] of octets) {
    if (/\.wav$/i.test(chemin)) durees.set(chemin, dureeWav(o, lireEnteteWav(join(dossier, chemin))));
    if (/\.fragments\.json$/i.test(chemin)) {
      try {
        const m = JSON.parse(readFileSync(join(dossier, chemin), 'utf8'));
        if (Number.isFinite(m.duree)) durees.set(chemin, m.duree);
        const motif = Object.values(m.formats ?? {})[0];
        if (motif && Number.isFinite(m.n)) {
          let total = 0;
          for (let i = 0; i < m.n; i++) total += octets.get(motif.replace('{i}', String(i).padStart(3, '0'))) ?? octets.get(motif.replace('{i}', String(i))) ?? 0;
          octets.set(chemin, total);
        }
      } catch { /* manifeste illisible : reste inconnu */ }
    }
  }
  return { octets, durees };
}

/** Les documents d'un dossier de contenu ou de build (combinés, ou un par un). */
export function lireDocuments(dossier, genre) {
  const d = join(dossier, genre);
  if (!existsSync(d)) return [];
  const combine = join(d, `${genre}.json`);
  if (existsSync(combine)) return JSON.parse(readFileSync(combine, 'utf8'));
  return readdirSync(d).filter((n) => n.endsWith('.json') && n !== 'index.json')
    .map((n) => ({ id: n.slice(0, -5), ...JSON.parse(readFileSync(join(d, n), 'utf8')) }));
}

export function budgetsDuDossier(dossier) {
  const rooms = lireDocuments(dossier, 'rooms');
  const works = lireDocuments(dossier, 'works');
  return budgetsGalerie(rooms, works, mesurerDossier(dossier));
}

if (process.argv[1] && process.argv[1].endsWith('budget-salles.mjs')) {
  const dossier = process.argv[2] ?? process.env.GALERIE_CONTENT ?? 'content';
  const budgets = budgetsDuDossier(dossier);
  console.log(texteBudgets(budgets, BUDGET));
  const ecarts = budgets.flatMap((b) => b.ecarts.map((e) => `${b.salle} : ${e.texte}`));
  if (ecarts.length) { console.log(`\n✗ ${ecarts.length} écart(s) :`); for (const e of ecarts) console.log(`   ${e}`); process.exit(1); }
  console.log('\n✓ chaque salle tient sur un téléphone.');
}
