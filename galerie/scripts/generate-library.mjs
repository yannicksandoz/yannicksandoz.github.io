/**
 * Fabrique la bibliothèque 3D livrée avec le moteur.
 *
 * Chaque pièce est décrite une seule fois, par une liste de volumes simples,
 * et cette description sert deux fois : elle est exportée en GLB (le modèle
 * que l'éditeur insère) et projetée en élévation frontale SVG (la vignette
 * du panneau). Une seule source de vérité, donc pas de vignette qui ment
 * sur ce qu'elle annonce.
 *
 * Le mobilier de galerie est volontairement neutre : socles, cimaises,
 * colonnes. Ce sont des supports pour VOS œuvres, pas des œuvres.
 *
 *   node scripts/generate-library.mjs
 *
 * Les fichiers produits vont dans content/library/ et sont versionnés :
 * ce script n'a besoin d'être relancé que si l'on modifie le catalogue.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// GLTFExporter écrit son binaire via un Blob relu par un FileReader, qui
// n'existe pas dans Node. Quatre lignes suffisent à le remplacer.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); });
  }
};

const THREE = await import('three');
const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'content', 'library');

/* ------------------------------------------------------------- catalogue --- */

const STONE = '#b9b7c4';
const PALE = '#d6d4dd';
const DARK = '#4a4857';
const WOOD = '#a98d6b';
const GLASS = '#9fd8e8';

/**
 * `parts` : volumes axés sur les axes, en mètres, `pos` au centre du volume.
 * L'origine de chaque pièce est au sol, centrée horizontalement — comme
 * `fitModel` l'attend, ce qui évite les objets qui flottent ou s'enfoncent.
 */
const CATALOGUE = [
  {
    id: 'socle-haut', name: 'Socle haut', tags: ['socle', 'support'],
    description: "Socle d'exposition à hauteur d'œil.",
    parts: [
      { shape: 'box', size: [0.6, 1.05, 0.6], pos: [0, 0.525, 0], color: PALE },
      { shape: 'box', size: [0.7, 0.05, 0.7], pos: [0, 1.075, 0], color: STONE }
    ]
  },
  {
    id: 'socle-bas', name: 'Socle bas', tags: ['socle', 'support'],
    description: 'Socle large pour un objet posé au sol.',
    parts: [
      { shape: 'box', size: [0.95, 0.42, 0.95], pos: [0, 0.21, 0], color: PALE },
      { shape: 'box', size: [1.05, 0.05, 1.05], pos: [0, 0.445, 0], color: STONE }
    ]
  },
  {
    id: 'vitrine', name: 'Vitrine', tags: ['socle', 'support', 'verre'],
    description: 'Socle surmonté d’un capot transparent.',
    parts: [
      { shape: 'box', size: [0.8, 0.9, 0.8], pos: [0, 0.45, 0], color: PALE },
      { shape: 'box', size: [0.72, 0.8, 0.72], pos: [0, 1.3, 0], color: GLASS, opacity: 0.22 }
    ]
  },
  {
    id: 'cimaise', name: 'Cimaise', tags: ['cloison', 'mur'],
    description: 'Cloison autoportante pour accrocher des œuvres.',
    parts: [
      { shape: 'box', size: [3, 2.6, 0.12], pos: [0, 1.38, 0], color: PALE },
      { shape: 'box', size: [3, 0.08, 0.55], pos: [0, 0.04, 0], color: DARK }
    ]
  },
  {
    id: 'colonne', name: 'Colonne', tags: ['architecture'],
    description: 'Colonne à base et chapiteau.',
    parts: [
      { shape: 'cylinder', size: [0.52, 0.12, 0.52], pos: [0, 0.06, 0], color: STONE },
      { shape: 'cylinder', size: [0.34, 2.5, 0.34], pos: [0, 1.37, 0], color: PALE },
      { shape: 'cylinder', size: [0.52, 0.14, 0.52], pos: [0, 2.69, 0], color: STONE }
    ]
  },
  {
    id: 'arche', name: 'Arche', tags: ['architecture', 'passage'],
    description: 'Passage à encadrer — utile devant un portail.',
    parts: [
      { shape: 'box', size: [0.35, 2.2, 0.5], pos: [-1, 1.1, 0], color: PALE },
      { shape: 'box', size: [0.35, 2.2, 0.5], pos: [1, 1.1, 0], color: PALE },
      { shape: 'box', size: [2.35, 0.35, 0.5], pos: [0, 2.375, 0], color: STONE }
    ]
  },
  {
    id: 'banc', name: 'Banc', tags: ['mobilier', 'assise'],
    description: 'Banc de contemplation.',
    parts: [
      { shape: 'box', size: [1.8, 0.09, 0.45], pos: [0, 0.45, 0], color: WOOD },
      { shape: 'box', size: [0.08, 0.45, 0.4], pos: [-0.75, 0.225, 0], color: DARK },
      { shape: 'box', size: [0.08, 0.45, 0.4], pos: [0.75, 0.225, 0], color: DARK }
    ]
  },
  {
    id: 'cube-assise', name: 'Cube d’assise', tags: ['mobilier', 'assise'],
    description: 'Pouf cubique, à multiplier.',
    parts: [
      { shape: 'box', size: [0.6, 0.42, 0.6], pos: [0, 0.21, 0], color: DARK }
    ]
  },
  {
    id: 'cadre', name: 'Cadre vide', tags: ['accrochage'],
    description: 'Cadre à poser devant un mur ou une œuvre.',
    parts: [
      { shape: 'box', size: [1.5, 0.1, 0.08], pos: [0, 1.95, 0], color: DARK },
      { shape: 'box', size: [1.5, 0.1, 0.08], pos: [0, 0.85, 0], color: DARK },
      { shape: 'box', size: [0.1, 1.2, 0.08], pos: [-0.7, 1.4, 0], color: DARK },
      { shape: 'box', size: [0.1, 1.2, 0.08], pos: [0.7, 1.4, 0], color: DARK }
    ]
  },
  {
    id: 'estrade', name: 'Estrade', tags: ['support', 'sol'],
    description: 'Plateforme basse avec une marche.',
    parts: [
      { shape: 'box', size: [3, 0.25, 2], pos: [0, 0.125, 0], color: PALE },
      { shape: 'box', size: [3, 0.12, 0.5], pos: [0, 0.06, 1.25], color: STONE }
    ]
  }
];

/* ------------------------------------------------------------------ GLB --- */

function buildPart(part) {
  const [w, h, d] = part.size;
  const geometry = part.shape === 'cylinder'
    ? new THREE.CylinderGeometry(w / 2, d / 2, h, 24)
    : new THREE.BoxGeometry(w, h, d);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(part.color),
    roughness: part.opacity ? 0.1 : 0.78,
    metalness: 0.04,
    transparent: Boolean(part.opacity),
    opacity: part.opacity ?? 1
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.fromArray(part.pos);
  return mesh;
}

async function exportGlb(item) {
  const group = new THREE.Group();
  group.name = item.id;
  for (const part of item.parts) group.add(buildPart(part));
  const buffer = await new GLTFExporter().parseAsync(group, { binary: true });
  return Buffer.from(buffer);
}

/* ------------------------------------------------------------------ SVG --- */

/** Élévation frontale : chaque volume devient un rectangle, x et y réels. */
function buildSvg(item) {
  const bounds = item.parts.reduce((b, p) => ({
    minX: Math.min(b.minX, p.pos[0] - p.size[0] / 2),
    maxX: Math.max(b.maxX, p.pos[0] + p.size[0] / 2),
    maxY: Math.max(b.maxY, p.pos[1] + p.size[1] / 2)
  }), { minX: Infinity, maxX: -Infinity, maxY: 0 });

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY;
  const pad = Math.max(width, height) * 0.12;
  const vbW = width + pad * 2;
  const vbH = height + pad * 2;

  // les volumes du fond d'abord : un z plus grand est plus loin de l'œil
  const ordered = [...item.parts].sort((a, b) => (b.pos[2] ?? 0) - (a.pos[2] ?? 0));
  const rects = ordered.map((p) => {
    const x = p.pos[0] - p.size[0] / 2 - bounds.minX + pad;
    const y = height - (p.pos[1] + p.size[1] / 2) + pad;
    const rx = p.shape === 'cylinder' ? Math.min(p.size[0], p.size[1]) * 0.14 : 0.012;
    return `<rect x="${r(x)}" y="${r(y)}" width="${r(p.size[0])}" height="${r(p.size[1])}"`
      + ` rx="${r(rx)}" fill="${p.color}" fill-opacity="${p.opacity ?? 1}"`
      + ` stroke="#1b1b28" stroke-width="0.012"/>`;
  }).join('');

  // repère de sol : sans lui, un objet bas flotte au milieu de la vignette
  const ground = `<line x1="${r(pad * 0.3)}" y1="${r(height + pad)}"`
    + ` x2="${r(vbW - pad * 0.3)}" y2="${r(height + pad)}"`
    + ` stroke="#6a6a8c" stroke-width="0.02" stroke-dasharray="0.06 0.05"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(vbW)} ${r(vbH)}"`
    + ` role="img" aria-label="${item.name}">${rects}${ground}</svg>\n`;
}

function r(v) {
  return Math.round(v * 1000) / 1000;
}

/* ----------------------------------------------------------------- écrit --- */

await mkdir(join(OUT, 'models'), { recursive: true });
await mkdir(join(OUT, 'thumbs'), { recursive: true });

const items = [];
for (const item of CATALOGUE) {
  const glb = await exportGlb(item);
  await writeFile(join(OUT, 'models', `${item.id}.glb`), glb);
  await writeFile(join(OUT, 'thumbs', `${item.id}.svg`), buildSvg(item));
  // `fit` normalise la PLUS GRANDE dimension, pas la hauteur (voir fitModel) :
  // prendre la hauteur rabougrissait tout ce qui est plus large que haut —
  // un banc de 1,8 m se posait à 50 cm.
  const extent = Math.max(...item.parts.flatMap((p) => [
    Math.abs(p.pos[0]) * 2 + p.size[0],
    p.pos[1] + p.size[1] / 2,
    Math.abs(p.pos[2]) * 2 + p.size[2]
  ]));
  items.push({
    id: item.id,
    name: item.name,
    description: item.description,
    tags: item.tags,
    url: `library/models/${item.id}.glb`,
    thumbnail: `library/thumbs/${item.id}.svg`,
    fit: Math.round(extent * 100) / 100, // inséré à sa taille réelle
    author: 'Galerie',
    license: 'CC0-1.0',
    sourceUrl: 'https://github.com/yannicksandoz/yannicksandoz.github.io',
    // `source` marque l'origine d'un modèle. L'export exige une attribution
    // complète pour tout modèle qui en porte une — y compris celui-ci, bien
    // que CC0 n'oblige à rien : une règle sans exception est une règle qu'on
    // n'oublie pas d'appliquer.
    source: 'library'
  });
  console.log(`  ${item.id.padEnd(14)} ${String(glb.length).padStart(6)} o`);
}

await writeFile(join(OUT, 'index.json'), `${JSON.stringify({
  name: 'Mobilier de galerie',
  description: 'Supports neutres livrés avec le moteur — domaine public (CC0).',
  items
}, null, 2)}\n`);

console.log(`\n${items.length} pièces écrites dans content/library/`);
