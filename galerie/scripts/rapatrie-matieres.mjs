/**
 * LE RAPATRIEMENT DES MATIÈRES — un outil de développement, jamais livré.
 *
 * La galerie tient à deux principes qui se disputent : des matériaux RÉELS
 * (un parquet qui accroche la lumière comme du bois, une brique qui a du
 * relief) et AUCUNE dépendance à un serveur tiers au moment de la visite.
 * Ce script les réconcilie : il télécharge une fois, transforme, et écrit
 * des fichiers COMMITÉS dans `engine/assets/` — le build du visiteur ne
 * sait même pas qu'internet existe.
 *
 * Deux sources, licences vérifiées :
 *   • les jeux « hardwood2 » et « brick » du dépôt three.js (tag r166, la
 *     version exacte que la galerie embarque), sous la licence MIT du
 *     projet — © 2010-2024 three.js authors ;
 *   • deux HDRI du paquet npm `@pmndrs/assets` (CC0-1.0), qui rediffuse
 *     des panoramas Poly Haven — installé en dépendance de développement.
 *
 * ET UNE TRANSFORMATION QUI N'EST PAS UNE OPTIMISATION : les albédos sont
 * convertis en NIVEAUX DE GRIS. C'est le contrat des textures de la galerie
 * depuis le premier jour (`textures.js`) — la texture n'apporte que la
 * matière, la COULEUR reste celle que la pièce déclare. Un parquet brun
 * multiplié par le violet d'une salle donnerait de la boue ; un parquet en
 * luminance prend la teinte de la salle comme les tuiles procédurales
 * l'ont toujours fait. Le relief (bump) et la rugosité, eux, passent tels
 * quels — c'est précisément ce que les tuiles de 32 texels ne savaient pas
 * dire. Tout est réduit à 512 texels : à deux mètres la tuile, cela fait
 * 256 texels par mètre, et le fichier reste décent.
 *
 *     node scripts/rapatrie-matieres.mjs
 *
 * `test-matieres.mjs` vérifie les empreintes SHA-256 des fichiers écrits :
 * un rapatriement qui rendrait autre chose se voit.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';

const ici = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ici, '..', 'engine', 'assets');
const TROIS = 'https://raw.githubusercontent.com/mrdoob/three.js/r166/examples/textures';

/**
 * Les cartes, et le TRAITEMENT de chacune :
 *
 *   • `gris` — luminance, avec `moyenne` : l'albédo est NORMALISÉ vers cette
 *     moyenne. La première livraison sortait les gris tels quels : multipliés
 *     par la couleur sombre d'une salle, ils viraient au ciment — le veinage
 *     ne survivait que dans le reflet, exactement l'effet « béton mouillé ».
 *     Ramener la moyenne à 0,62 rend à la couleur de la pièce son autorité :
 *     elle choisit la valeur, la carte ne fait que la moduler ;
 *
 *   • `gris` avec `plancher` — pour la RUGOSITÉ : le jeu three.js du parquet
 *     descend très bas (un vernis), et sur un sol sombre chaque lanterne
 *     devenait une flaque blanche. Le plancher relève le minimum — un
 *     parquet de galerie est ciré, pas laqué ;
 *
 *   • `rgb` — les cartes NORMALES gardent leurs trois canaux : un vecteur
 *     n'est pas une luminance.
 */
const CARTES = [
  ['bois-matiere.jpg', `${TROIS}/hardwood2_diffuse.jpg`, { mode: 'gris', moyenne: 0.62 }],
  ['bois-relief.jpg', `${TROIS}/hardwood2_bump.jpg`, { mode: 'gris' }],
  ['bois-rugosite.jpg', `${TROIS}/hardwood2_roughness.jpg`, { mode: 'gris', plancher: 0.42 }],
  ['brique-matiere.jpg', `${TROIS}/brick_diffuse.jpg`, { mode: 'gris', moyenne: 0.62 }],
  ['brique-relief.jpg', `${TROIS}/brick_bump.jpg`, { mode: 'gris' }],
  ['brique-rugosite.jpg', `${TROIS}/brick_roughness.jpg`, { mode: 'gris', plancher: 0.35 }],
  // le damier de sol des exemples three.js — un hall de galerie classique ;
  // sa carte normale donne le joint entre les dalles
  ['damier-matiere.jpg', `${TROIS}/floors/FloorsCheckerboard_S_Diffuse.jpg`,
    { mode: 'gris', moyenne: 0.62 }],
  // une carte normale se contente de la MOITIÉ de la finesse d'un albédo :
  // elle module une orientation, pas un détail qu'on lit — et à 512 elle
  // pesait plus lourd que la photo qu'elle accompagne
  ['damier-normale.jpg', `${TROIS}/floors/FloorsCheckerboard_S_Normal.jpg`,
    { mode: 'rgb', taille: 256 }],
  // l'herbe du terrain — remplace la tuile « herbe » là où le sol est
  // vraiment un pré ; la normale donne les brins en lumière rasante
  ['herbe-matiere.jpg', `${TROIS}/terrain/grasslight-big.jpg`,
    { mode: 'gris', moyenne: 0.55 }],
  ['herbe-normale.jpg', `${TROIS}/terrain/grasslight-big-nm.jpg`,
    { mode: 'rgb', taille: 256 }]
];

/** Les deux environnements, depuis le paquet CC0 de pmndrs. */
const ENVIRONNEMENTS = [
  ['aube.exr', 'dawn.exr.js'],
  ['appartement.exr', 'apartment.exr.js']
];

const CIBLE = 512;

/**
 * Réduction en boîte vers CIBLE, puis selon le mode :
 *   gris — luminance Rec.709, normalisation de moyenne, plancher éventuel ;
 *   rgb  — les trois canaux, tels quels (cartes normales).
 * JPEG qualité 82 dans les deux cas.
 */
function transformer(octets,
  { mode = 'gris', moyenne = null, plancher = 0, taille = CIBLE } = {}) {
  const src = jpeg.decode(octets, { useTArray: true, maxMemoryUsageInMB: 1024 });
  const facteur = Math.max(1, Math.round(Math.max(src.width, src.height) / taille));
  const w = Math.floor(src.width / facteur);
  const h = Math.floor(src.height / facteur);
  const sortie = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < facteur; dy++) {
        for (let dx = 0; dx < facteur; dx++) {
          const i = ((((y * facteur) + dy) * src.width) + (x * facteur) + dx) * 4;
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2];
        }
      }
      const n = facteur * facteur;
      const o = ((y * w) + x) * 4;
      if (mode === 'rgb') {
        sortie[o] = Math.round(r / n);
        sortie[o + 1] = Math.round(g / n);
        sortie[o + 2] = Math.round(b / n);
      } else {
        const v = Math.round(((0.2126 * r) + (0.7152 * g) + (0.0722 * b)) / n);
        sortie[o] = sortie[o + 1] = sortie[o + 2] = v;
      }
      sortie[o + 3] = 255;
    }
  }
  if (mode === 'gris' && moyenne !== null) {
    // normalisation multiplicative : le CONTRASTE relatif de la carte reste,
    // seule sa valeur moyenne rejoint la cible
    let somme = 0;
    for (let i = 0; i < w * h; i++) somme += sortie[i * 4];
    const gain = (moyenne * 255) / Math.max(1, somme / (w * h));
    for (let i = 0; i < w * h; i++) {
      const v = Math.min(255, Math.round(sortie[i * 4] * gain));
      sortie[i * 4] = sortie[(i * 4) + 1] = sortie[(i * 4) + 2] = v;
    }
  }
  if (mode === 'gris' && plancher > 0) {
    // r' = plancher + (1 − plancher) · r : le maximum ne bouge pas
    for (let i = 0; i < w * h; i++) {
      const v = Math.round((plancher * 255) + ((1 - plancher) * sortie[i * 4]));
      sortie[i * 4] = sortie[(i * 4) + 1] = sortie[(i * 4) + 2] = v;
    }
  }
  return Buffer.from(jpeg.encode({ data: sortie, width: w, height: h }, 82).data);
}

async function telecharger(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} : ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const executeDirectement = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];

if (executeDirectement) {
  mkdirSync(join(RACINE, 'matieres'), { recursive: true });
  mkdirSync(join(RACINE, 'environnements'), { recursive: true });
  const empreintes = {};

  for (const [nom, url, options] of CARTES) {
    const brut = await telecharger(url);
    const fait = transformer(brut, options);
    const chemin = join(RACINE, 'matieres', nom);
    writeFileSync(chemin, fait);
    empreintes[`matieres/${nom}`] = {
      source: url,
      sha256: createHash('sha256').update(fait).digest('hex'),
      octets: fait.length
    };
    console.log(`✓ matieres/${nom} — ${(fait.length / 1024).toFixed(0)} ko`
      + ` (source ${(brut.length / 1024).toFixed(0)} ko)`);
  }

  for (const [nom, module] of ENVIRONNEMENTS) {
    const js = readFileSync(join(ici, '..', 'node_modules', '@pmndrs', 'assets',
      'hdri', module), 'utf8');
    const b64 = js.match(/base64,([A-Za-z0-9+/=]+)/)?.[1];
    if (!b64) throw new Error(`pas de base64 dans ${module}`);
    const exr = Buffer.from(b64, 'base64');
    const chemin = join(RACINE, 'environnements', nom);
    writeFileSync(chemin, exr);
    empreintes[`environnements/${nom}`] = {
      source: `npm:@pmndrs/assets/hdri/${module} (CC0, Poly Haven)`,
      sha256: createHash('sha256').update(exr).digest('hex'),
      octets: exr.length
    };
    console.log(`✓ environnements/${nom} — ${(exr.length / 1024).toFixed(0)} ko`);
  }

  writeFileSync(join(RACINE, 'provenance.json'),
    `${JSON.stringify(empreintes, null, 2)}\n`);
  console.log('✓ provenance.json');
}
