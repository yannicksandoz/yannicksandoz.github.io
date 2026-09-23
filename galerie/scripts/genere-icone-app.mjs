/**
 * L'ICÔNE DE L'APPLICATION AUTEUR — dessinée ici, sans bibliothèque.
 *
 * Un carré aux angles doux, nuit de la galerie (#05050a), trois anneaux
 * concentriques de la couleur d'accent — le son qui rayonne d'une œuvre,
 * tel que l'éditeur dessine les sphères de portée — et un point clair au
 * centre. 1024 × 1024, PNG encodé à la main (zlib du nœud, filtre nul) :
 * electron-builder en tire l'icns du Mac, l'ico de Windows et l'icône
 * Linux. Lancer : npm run app:icone → app/icone.png
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const N = 1024;
const FOND = [5, 5, 10];
const ACCENT = [159, 140, 255];
const CLAIR = [230, 226, 245];
const VERT = [124, 232, 168];

const pixels = Buffer.alloc(N * N * 4);
const rayonCoin = 200;
const c = N / 2;

const melange = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const dansCarre = (x, y) => {
  // distance signée au carré arrondi (marge de 40 px)
  const m = 40;
  const dx = Math.max(Math.abs(x - c) - (c - m - rayonCoin), 0);
  const dy = Math.max(Math.abs(y - c) - (c - m - rayonCoin), 0);
  return Math.hypot(dx, dy) - rayonCoin;
};
// un anneau : rayon, épaisseur, couleur
const anneaux = [[150, 22, CLAIR], [280, 20, ACCENT], [400, 18, melange(ACCENT, VERT, 0.6)]];

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    const d = dansCarre(x + 0.5, y + 0.5);
    const couverture = Math.max(0, Math.min(1, 0.5 - d));   // anticrénelage au bord
    if (couverture <= 0) continue;
    let couleur = FOND;
    const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
    // le point du centre
    if (r < 46) couleur = melange(FOND, CLAIR, Math.min(1, 46 - r));
    for (const [rayon, ep, teinte] of anneaux) {
      const e = Math.abs(r - rayon) - ep / 2;
      if (e < 0.5) couleur = melange(couleur, teinte, Math.min(1, 0.5 - e));
    }
    pixels[i] = couleur[0]; pixels[i + 1] = couleur[1]; pixels[i + 2] = couleur[2];
    pixels[i + 3] = Math.round(255 * couverture);
  }
}

/* ---- PNG : signature, IHDR, IDAT (filtre 0 par ligne), IEND ---- */
const crcTable = new Int32Array(256).map((_, n) => {
  let cr = n;
  for (let k = 0; k < 8; k++) cr = cr & 1 ? 0xedb88320 ^ (cr >>> 1) : cr >>> 1;
  return cr;
});
const crc32 = (buf) => {
  let cr = -1;
  for (const b of buf) cr = crcTable[(cr ^ b) & 0xff] ^ (cr >>> 8);
  return (cr ^ -1) >>> 0;
};
const bloc = (type, donnees) => {
  const t = Buffer.from(type, 'ascii');
  const long = Buffer.alloc(4); long.writeUInt32BE(donnees.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, donnees])));
  return Buffer.concat([long, t, donnees, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8 bits, RGBA
const brut = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) {
  brut[y * (N * 4 + 1)] = 0;
  pixels.copy(brut, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  bloc('IHDR', ihdr), bloc('IDAT', deflateSync(brut, { level: 9 })), bloc('IEND', Buffer.alloc(0))
]);
const sortie = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'icone.png');
writeFileSync(sortie, png);
console.log(`${sortie} : ${N}×${N}, ${(png.length / 1024).toFixed(0)} ko`);
