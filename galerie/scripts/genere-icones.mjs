/**
 * LES ICÔNES DE L'ÉDITEUR — vendorées depuis Lucide, à la génération.
 *
 * Lucide (https://lucide.dev, licence ISC, © 2026 Lucide Icons and
 * Contributors ; une partie des icônes vient de Feather, MIT, © Cole Bemis)
 * remplace les émojis de la barre d'outils : un émoji change de dessin d'une
 * plateforme à l'autre — 🧱 n'est pas la même brique sous Windows, macOS et
 * Android — quand un trait SVG est le même partout, se teinte à la couleur
 * du texte (`currentColor`) et reste net à toutes les densités d'écran.
 *
 * On ne prend PAS la bibliothèque au bundle : `lucide-static` (dépendance de
 * DÉVELOPPEMENT) fournit un fichier SVG par icône, ce script recopie les
 * tracés de la POIGNÉE d'icônes utilisées dans un module généré et committé
 * — `engine/src/editor/icones.js` — qui n'a aucune dépendance. Le test
 * `test-icones.mjs` régénère et compare octet à octet, comme le lettrage.
 *
 *   node scripts/genere-icones.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(ici, '..', 'node_modules', 'lucide-static', 'icons');
const CIBLE = join(ici, '..', 'engine', 'src', 'editor', 'icones.js');

/**
 * Les icônes retenues — la barre d'outils, et rien d'autre. Chaque nom est
 * un fichier de `lucide-static/icons/`. Ajouter une icône, c'est ajouter
 * une ligne ici puis relancer le script.
 */
export const NOMS = [
  'box', 'grid-3x3', 'scissors',                      // modes
  'plus',                                             // le menu Ajouter
  'blocks', 'pizza', 'music', 'volume-2', 'headphones',
  'folder', 'folder-open', 'link', 'download', 'upload', 'camera',
  'move', 'rotate-cw', 'scaling', 'magnet',           // gizmos
  'copy', 'trash-2', 'undo-2', 'redo-2',
  'cloud-upload', 'sparkles', 'circle-help', 'x'
];

/** Extrait le CONTENU d'un SVG Lucide (les tracés, sans l'enveloppe). */
export function extraireTraces(svg) {
  const corps = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1,
    svg.lastIndexOf('</svg>'));
  // les fichiers sont indentés pour l'œil ; le module, lui, est compact
  return corps.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
}

/** Produit le texte du module généré. */
export function genererModule() {
  const traces = {};
  for (const nom of NOMS) {
    traces[nom] = extraireTraces(
      readFileSync(join(SOURCE, `${nom}.svg`), 'utf8'));
  }
  const lignes = Object.entries(traces)
    .map(([n, t]) => `  ${JSON.stringify(n)}: ${JSON.stringify(t)}`)
    .join(',\n');
  return `/**
 * LES ICÔNES — générées par scripts/genere-icones.mjs, ne pas éditer à la
 * main : toute retouche serait écrasée à la prochaine génération, et le
 * test de dérive échouerait avant.
 *
 * Tracés extraits de Lucide (https://lucide.dev), licence ISC :
 *
 *   Copyright (c) 2026 Lucide Icons and Contributors
 *
 *   Permission to use, copy, modify, and/or distribute this software for
 *   any purpose with or without fee is hereby granted, provided that the
 *   above copyright notice and this permission notice appear in all
 *   copies.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL
 *   WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED
 *   WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
 *   AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL
 *   DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR
 *   PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
 *   TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 *   PERFORMANCE OF THIS SOFTWARE.
 *
 * Certaines icônes dérivent de Feather (MIT, © 2013-présent Cole Bemis) —
 * la liste exacte est dans la LICENSE de lucide-static. Ce module est un
 * outil d'AUTEUR : il ne part jamais dans le build Visiteur.
 */

/** Le crédit, en chaîne : il survit à la minification du build Auteur. */
export const CREDIT_LUCIDE
  = 'Icônes : Lucide (lucide.dev) — ISC — © Lucide Icons and Contributors';

const TRACES = {
${lignes}
};

/**
 * Une icône en SVG inline, teintée par \`currentColor\` : elle suit la
 * couleur du texte du bouton, survol et état actif compris.
 */
export function icone(nom, taille = 15) {
  const t = TRACES[nom];
  if (!t) return '';
  return \`<svg class="ic" xmlns="http://www.w3.org/2000/svg" width="\${taille}"\`
    + \` height="\${taille}" viewBox="0 0 24 24" fill="none"\`
    + \` stroke="currentColor" stroke-width="2" stroke-linecap="round"\`
    + \` stroke-linejoin="round" aria-hidden="true">\${t}</svg>\`;
}

export const ICONES_DISPONIBLES = Object.keys(TRACES);
`;
}

// exécuté directement : on écrit ; importé par le test : on ne touche à rien
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const texte = genererModule();
  writeFileSync(CIBLE, texte);
  console.log(`${CIBLE} : ${NOMS.length} icônes, ${texte.length} caractères`);
}
