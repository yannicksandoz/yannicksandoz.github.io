/**
 * LE GÉNÉRATEUR DU LETTRAGE — de la police livrée aux textures de Slug.
 *
 * Lit l'Inter du dépôt (`@fontsource/inter`, SIL OFL 1.1), en extrait les
 * courbes quadratiques des glyphes du jeu courant, bâtit les bandes de
 * l'algorithme Slug (Eric Lengyel, MIT OU Apache-2.0 — voir
 * `lettrage-reglages.js` pour le crédit complet) et écrit le tout dans
 * `engine/src/core/lettrage-inter.js` : un module de DONNÉES, sans un octet
 * de code, que le navigateur transforme en deux textures.
 *
 * À relancer après tout changement de police ou du jeu de glyphes :
 *
 *     node scripts/genere-lettrage.mjs
 *
 * Le fichier produit est COMMITÉ : le build du visiteur ne dépend d'aucune
 * étape de génération, et `test-lettrage.mjs` régénère puis compare — un
 * fichier qui divergerait de sa source ferait échouer la chaîne.
 *
 * Tout est en UNITÉS DE FONTE (entières) : le fichier reste petit et exact,
 * et c'est le navigateur qui divise par `unitesParEm` en remplissant les
 * textures.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ouvrirWoff, lireHead, lireHhea, lireOS2, lireCmap, lireHmtx,
  lireContours, lireCrenage } from './lettres-ttf.mjs';
import { GLYPHES_COURANTS } from '../engine/src/core/cartels-reglages.js';
import { contourEnCourbes }
  from '../engine/src/core/lettrage-reglages.js';

const ici = dirname(fileURLToPath(import.meta.url));
const POLICE = join(ici, '..', 'node_modules', '@fontsource', 'inter',
  'files', 'inter-latin-300-normal.woff');
const SORTIE = join(ici, '..', 'engine', 'src', 'core', 'lettrage-inter.js');

export function genererLettrage(cheminPolice = POLICE) {
  const { tables } = ouvrirWoff(readFileSync(cheminPolice));
  const head = lireHead(tables);
  const hhea = lireHhea(tables);
  const os2 = lireOS2(tables);
  const versGlyphe = lireCmap(tables);
  const avanceDe = lireHmtx(tables, hhea.nbMetriques);
  const crenageDe = lireCrenage(tables);

  // On n'écrit dans le fichier que les COURBES et les AVANCES : les bandes,
  // l'emballage en textures et les boîtes se recalculent au chargement par
  // les mêmes fonctions pures (`lettrage-reglages.js`). Une seule vérité
  // d'empaquetage — et un fichier moitié moins lourd, qui ne transporte ni
  // bourrage ni redondance.
  const jeu = [...GLYPHES_COURANTS];
  const manquants = [];
  const formes = {};                   // id de glyphe → courbes, à plat
  const glyphes = {};                  // caractère → { avance, forme }
  for (const c of jeu) {
    const id = versGlyphe(c.codePointAt(0));
    if (id === 0) { manquants.push(c); continue; }
    if (formes[id] === undefined) {
      const courbes = [];
      for (const contour of lireContours(tables, head.formatLoca, id)) {
        for (const q of contourEnCourbes(contour)) courbes.push(...q);
      }
      formes[id] = courbes;
    }
    glyphes[c] = { avance: avanceDe(id), forme: id };
  }
  if (manquants.length) {
    throw new Error(`la police ne couvre pas : ${manquants.join(' ')}`);
  }

  // le crénage, restreint au jeu : les paires non nulles seulement
  const crenage = {};
  for (const a of jeu) {
    for (const b of jeu) {
      const v = crenageDe(versGlyphe(a.codePointAt(0)), versGlyphe(b.codePointAt(0)));
      if (v !== 0) crenage[a + b] = v;
    }
  }

  return {
    upm: head.unitesParEm,
    metriques: {
      ascendant: hhea.ascendant,
      descendant: hhea.descendant,
      hauteurCapitales: os2.hauteurCapitales
    },
    formes,
    glyphes,
    crenage
  };
}

/* --------------------------------------------------------- l'écriture -- */

const executeDirectement = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];

if (executeDirectement) {
  const d = genererLettrage();
  const nbCourbes = Object.values(d.glyphes).length;
  const texte = `/**
 * LES LETTRES D'INTER, PRÊTES POUR LE SHADER — fichier GÉNÉRÉ, ne pas
 * éditer : \`node scripts/genere-lettrage.mjs\` le refait depuis la police.
 *
 * Contenu : les courbes quadratiques et les bandes de l'algorithme Slug
 * (Eric Lengyel, MIT OU Apache-2.0, brevet au domaine public — Slug shader
 * code Copyright 2017 by Eric Lengyel), extraites de la police Inter de
 * Rasmus Andersson (SIL OFL 1.1). Unités de fonte entières ; le navigateur
 * divise par \`upm\` en remplissant les textures. Voir \`lettrage.js\`.
 */
export const LETTRAGE = ${JSON.stringify(d)};
`;
  writeFileSync(SORTIE, texte);
  const ko = (texte.length / 1024).toFixed(1);
  console.log(`✓ ${SORTIE}`);
  const totalCourbes = Object.values(d.formes)
    .reduce((s, f) => s + (f.length / 6), 0);
  console.log(`  ${nbCourbes} caractères, ${Object.keys(d.formes).length} formes,`
    + ` ${totalCourbes} courbes,`
    + ` ${Object.keys(d.crenage).length} paires de crénage — ${ko} ko`);
}
