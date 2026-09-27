/**
 * LES TABLES LTC DE `RectAreaLight`, EN BINAIRE.
 *
 * three.js embarque les deux tables de la BRDF pré-intégrée (LTC_MAT_1 et
 * LTC_MAT_2, 64 × 64 × 4 valeurs chacune) sous forme de LITTÉRAUX
 * JavaScript : 246 ko de texte dans le paquet principal, 100 ko gzip — un
 * tiers du paquet — pour 64 ko de données une fois converties en demi-
 * flottants, ce que `RectAreaLightUniformsLib.init()` fait de toute façon.
 * Ce script fait la conversion une fois, ici, et écrit `engine/assets/
 * ltc.bin` : les deux tables en demi-flottants, l'une après l'autre, petit-
 * boutiste. Le moteur (core/primitives.js) le charge par `fetch` et refait
 * les textures que `init()` aurait faites.
 *
 * Provenance : three r166 (MIT), d'après https://github.com/selfshadow/
 * ltc_code — notée dans engine/assets/provenance.json.
 *
 *   node scripts/genere-ltc.mjs
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { UniformsLib } from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const CIBLE = join(ICI, '..', 'engine', 'assets', 'ltc.bin');
const PROVENANCE = join(ICI, '..', 'engine', 'assets', 'provenance.json');

RectAreaLightUniformsLib.init();
const h1 = UniformsLib.LTC_HALF_1.image.data;
const h2 = UniformsLib.LTC_HALF_2.image.data;
if (!(h1 instanceof Uint16Array) || h1.length !== 64 * 64 * 4 || h2.length !== 64 * 64 * 4) {
  throw new Error('tables LTC inattendues : la version de three a changé');
}
const octets = Buffer.alloc((h1.length + h2.length) * 2);
h1.forEach((v, i) => octets.writeUInt16LE(v, i * 2));
h2.forEach((v, i) => octets.writeUInt16LE(v, (h1.length + i) * 2));
writeFileSync(CIBLE, octets);

const version = JSON.parse(readFileSync(join(ICI, '..', 'node_modules', 'three', 'package.json'), 'utf8')).version;
const provenance = JSON.parse(readFileSync(PROVENANCE, 'utf8'));
provenance['ltc.bin'] = {
  source: `three ${version}, examples/jsm/lights/RectAreaLightUniformsLib.js (LTC_MAT_1 puis LTC_MAT_2, demi-flottants petit-boutistes)`,
  sha256: createHash('sha256').update(octets).digest('hex'),
  octets: octets.length
};
writeFileSync(PROVENANCE, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`ltc.bin : ${octets.length} octets (three ${version})`);
