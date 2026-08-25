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

/** Les six cartes, et le nom qu'elles portent chez nous. */
const CARTES = [
  ['bois-matiere.jpg', `${TROIS}/hardwood2_diffuse.jpg`, true],
  ['bois-relief.jpg', `${TROIS}/hardwood2_bump.jpg`, true],
  ['bois-rugosite.jpg', `${TROIS}/hardwood2_roughness.jpg`, true],
  ['brique-matiere.jpg', `${TROIS}/brick_diffuse.jpg`, true],
  ['brique-relief.jpg', `${TROIS}/brick_bump.jpg`, true],
  ['brique-rugosite.jpg', `${TROIS}/brick_roughness.jpg`, true]
];

/** Les deux environnements, depuis le paquet CC0 de pmndrs. */
const ENVIRONNEMENTS = [
  ['aube.exr', 'dawn.exr.js'],
  ['appartement.exr', 'apartment.exr.js']
];

const CIBLE = 512;

/** Luminance Rec.709, réduction en boîte vers CIBLE, JPEG gris qualité 82. */
function transformer(octets) {
  const src = jpeg.decode(octets, { useTArray: true, maxMemoryUsageInMB: 1024 });
  const facteur = Math.max(1, Math.round(Math.max(src.width, src.height) / CIBLE));
  const w = Math.floor(src.width / facteur);
  const h = Math.floor(src.height / facteur);
  const sortie = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let somme = 0;
      for (let dy = 0; dy < facteur; dy++) {
        for (let dx = 0; dx < facteur; dx++) {
          const i = ((((y * facteur) + dy) * src.width) + (x * facteur) + dx) * 4;
          somme += (0.2126 * src.data[i]) + (0.7152 * src.data[i + 1])
            + (0.0722 * src.data[i + 2]);
        }
      }
      const v = Math.round(somme / (facteur * facteur));
      const o = ((y * w) + x) * 4;
      sortie[o] = sortie[o + 1] = sortie[o + 2] = v;
      sortie[o + 3] = 255;
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

  for (const [nom, url] of CARTES) {
    const brut = await telecharger(url);
    const fait = transformer(brut);
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
