/**
 * L'ONDE STATIONNAIRE — un scan gaussien de démonstration, fabriqué au lieu
 * d'être capturé.
 *
 * Le type d'œuvre « scan » affiche du splatting gaussien : des dizaines de
 * milliers de taches ellipsoïdales orientées, le format des captures
 * photogrammétriques modernes (Polycam, Luma, 3DGS). Pour éprouver le
 * moteur sans embarquer un vrai scan de plusieurs dizaines de mégaoctets,
 * on FABRIQUE une pièce : une membrane circulaire figée en pleine vibration
 * — des ondes concentriques, l'amplitude qui décroît vers le bord, la
 * couleur qui va du violet de la galerie à l'or des ventres — et une pluie
 * de particules fines au-dessus des ventres, comme du sable de Chladni
 * quitté par la plaque. C'est une œuvre de démonstration : remplacez-la
 * par votre propre capture.
 *
 * Format `.splat` (celui d'antimatter15, lu par GaussianSplats3D) : 32
 * octets par tache — position (3 × float32), échelle (3 × float32),
 * couleur (4 × uint8 RGBA), rotation (4 × uint8, quaternion recentré).
 * Toutes nos taches sont ISOTROPES (échelles égales) : leur rotation ne
 * change rien, on écrit l'identité — et l'on est immunisé contre toute
 * ambiguïté d'ordre des composantes du quaternion.
 *
 *     node scripts/genere-scan-demo.mjs
 *
 * DÉTERMINISTE (PRNG semé) : `test-scans.mjs` régénère et compare octet à
 * octet — le fichier commité ne peut pas dériver de son code.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const SORTIE = join(ici, '..', 'content', 'assets', 'scans');

/** mulberry32 — le même PRNG que les textures procédurales. */
function prng(graine) {
  let a = graine >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function genererOnde() {
  const alea = prng(432);
  const taches = [];

  // le violet de la galerie et l'or de ses lanternes. Une tache gaussienne
  // est ÉMISSIVE — sa couleur est de la lumière, pas une surface — et des
  // milliers se superposent : on travaille SOMBRE, l'accumulation fera le
  // reste. Une première version à pleine intensité rendait un dôme blanc.
  const violet = [0x30 / 255, 0x24 / 255, 0x66 / 255];
  const or = [0.55, 0.42, 0.18];
  const mele = (t) => violet.map((v, i) => v + ((or[i] - v) * t));

  // LA MEMBRANE : un disque de rayon 2, y = ondes concentriques amorties
  const RAYON = 2.0;
  const K = 9.5;                       // nombre d'onde : ~3 anneaux
  const NB_MEMBRANE = 18000;
  for (let n = 0; n < NB_MEMBRANE; n++) {
    // aire uniforme sur le disque : r = R·√u
    const r = RAYON * Math.sqrt(alea());
    const a = alea() * Math.PI * 2;
    const amortie = 1 - (r / RAYON) * 0.85;
    const phase = Math.cos(K * r);
    const y = 0.32 * phase * amortie;
    const x = r * Math.cos(a);
    const z = r * Math.sin(a);
    // l'épaisseur de la nappe : un léger duvet autour de la surface
    const duvet = (alea() - 0.5) * 0.03;
    const t = Math.abs(phase) * amortie;             // 0 au nœud, 1 au ventre
    const [cr, cg, cb] = mele(t);
    const taille = 0.016 + (alea() * 0.012);
    taches.push({
      x, y: y + duvet, z,
      s: taille,
      r: cr, g: cg, b: cb,
      a: 0.28 + (t * 0.3)
    });
  }

  // LE SABLE DE CHLADNI : des grains fins au-dessus des ventres, qui
  // montent en s'éteignant — la vibration rendue visible
  const NB_SABLE = 4000;
  let poses = 0;
  while (poses < NB_SABLE) {
    const r = RAYON * Math.sqrt(alea());
    const a = alea() * Math.PI * 2;
    const amortie = 1 - (r / RAYON) * 0.85;
    const ventre = Math.abs(Math.cos(K * r)) * amortie;
    if (alea() > ventre * ventre) continue;          // rejet : les nœuds restent nus
    const h = alea();
    const y = 0.32 * amortie + 0.05 + (h * h * 0.9 * ventre);
    const [cr, cg, cb] = mele(0.6 + (0.4 * ventre));
    taches.push({
      x: r * Math.cos(a) + ((alea() - 0.5) * 0.06),
      y,
      z: r * Math.sin(a) + ((alea() - 0.5) * 0.06),
      s: 0.006 + (alea() * 0.008),
      r: cr, g: cg, b: cb,
      a: (1 - h) * 0.45
    });
    poses++;
  }

  // l'écriture : 32 octets par tache
  const tampon = Buffer.alloc(taches.length * 32);
  for (let i = 0; i < taches.length; i++) {
    const t = taches[i];
    const o = i * 32;
    tampon.writeFloatLE(t.x, o);
    tampon.writeFloatLE(t.y, o + 4);
    tampon.writeFloatLE(t.z, o + 8);
    tampon.writeFloatLE(t.s, o + 12);
    tampon.writeFloatLE(t.s, o + 16);
    tampon.writeFloatLE(t.s, o + 20);
    tampon.writeUInt8(Math.round(t.r * 255), o + 24);
    tampon.writeUInt8(Math.round(t.g * 255), o + 25);
    tampon.writeUInt8(Math.round(t.b * 255), o + 26);
    tampon.writeUInt8(Math.round(t.a * 255), o + 27);
    // quaternion identité, recentré sur 128 : (w, x, y, z) = (1, 0, 0, 0)
    tampon.writeUInt8(255, o + 28);
    tampon.writeUInt8(128, o + 29);
    tampon.writeUInt8(128, o + 30);
    tampon.writeUInt8(128, o + 31);
  }
  return tampon;
}

const executeDirectement = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];

if (executeDirectement) {
  mkdirSync(SORTIE, { recursive: true });
  const octets = genererOnde();
  writeFileSync(join(SORTIE, 'onde-stationnaire.splat'), octets);
  console.log(`✓ onde-stationnaire.splat — ${octets.length / 32} taches,`
    + ` ${(octets.length / 1024).toFixed(0)} ko`);
}
