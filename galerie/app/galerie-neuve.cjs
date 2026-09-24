/**
 * UNE GALERIE NEUVE — Fichier › Nouvelle galerie…
 *
 * Commencer une galerie demandait de cloner le dépôt et d'en vider le
 * contenu à la main. Ici, l'application crée un dossier de contenu qui
 * tient debout tout seul :
 *
 *   • `rooms/index.json` et `rooms/entree.json` : une première salle,
 *     close, à la charte (lumière clé à 3,5 et 40°, brume légère), avec
 *     son point d'arrivée — le modèle « Salle » de l'éditeur ;
 *   • `works/index.json` vide, `reglages.json` par défaut ;
 *   • les dossiers PARTAGÉS copiés depuis le build (`library/`, `shaders/`,
 *     `textures/`, `LICENCES`, `RIGHTS.md`) : le mobilier, les shaders et
 *     les tuiles que l'éditeur propose, avec leurs licences — sans eux, un
 *     site construit depuis ce dossier n'aurait pas ses socles.
 *
 * Le dossier choisi doit être vide (les fichiers cachés d'un système ne
 * comptent pas) : on ne crée jamais par-dessus une galerie qui existe. Le
 * plan est pur et testé au nœud ; l'écriture ne fait que l'exécuter.
 */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

/** Ce que le build partage avec toute galerie (copié tel quel). */
const PARTAGES = ['library', 'shaders', 'textures', 'LICENCES', 'RIGHTS.md'];
/** Ce qui ne compte pas quand on juge un dossier vide. */
const INVISIBLES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.gitkeep']);

/** La première salle : le modèle « Salle » de l'éditeur, à la charte. */
function salleDEntree(titre) {
  return {
    id: 'entree',
    title: titre || 'Entrée',
    spawn: [0, 2.2, 7],
    regard: [0, 2.0, -6],
    fogColor: '#06060c',
    floor: { size: 30, color: '#15151f', grid: false },
    shell: { width: 26, depth: 20, height: 6.5, color: '#1e1e2e' },
    keyLight: { color: '#c4b8ff', intensity: 3.5, azimuth: 40, elevation: 40 },
    envIntensity: 1,
    works: [],
    portals: []
  };
}

/**
 * Le plan d'une galerie neuve : les fichiers à écrire (chemin relatif,
 * contenu texte) et les dossiers à copier depuis le build. Pur.
 */
function planGalerieNeuve({ titre = 'Entrée' } = {}) {
  const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
  return {
    fichiers: [
      { chemin: 'rooms/index.json', contenu: json(['entree.json']) },
      { chemin: 'rooms/entree.json', contenu: json(salleDEntree(titre)) },
      { chemin: 'works/index.json', contenu: json([]) },
      { chemin: 'reglages.json', contenu: json({ cooldown: 10, style: 'fluide' }) },
      // les sauvegardes d'avant-publication sont des copies entières : hors de git
      { chemin: '.gitignore', contenu: '# Sauvegardes d’avant-publication écrites par l’éditeur : git est déjà l’historique.\n.sauvegardes/\n' }
    ],
    partages: [...PARTAGES]
  };
}

/** Le dossier est-il vide (ou absent) au sens de « rien qui compte » ? */
async function dossierVide(chemin) {
  let entrees;
  try { entrees = await fs.readdir(chemin); } catch (e) {
    if (e.code === 'ENOENT') return true;
    throw e;
  }
  return entrees.every((n) => INVISIBLES.has(n));
}

/**
 * Crée la galerie dans `dossier` (vide ou absent), les partagés copiés
 * depuis `partagesDepuis` (le build, `dist-auteur`). Rend { fichiers,
 * partages } — ce qui a été écrit et copié — ou lève si le dossier n'est
 * pas vide.
 */
async function creerGalerie(dossier, { titre, partagesDepuis } = {}) {
  if (!(await dossierVide(dossier))) throw new Error('Ce dossier n’est pas vide : une galerie neuve se crée dans un dossier vide.');
  const plan = planGalerieNeuve({ titre });
  await fs.mkdir(dossier, { recursive: true });
  for (const f of plan.fichiers) {
    const abs = path.join(dossier, f.chemin);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, f.contenu, 'utf8');
  }
  const copies = [];
  for (const nom of plan.partages) {
    const source = partagesDepuis ? path.join(partagesDepuis, nom) : null;
    if (!source) continue;
    try {
      await fs.cp(source, path.join(dossier, nom), { recursive: true });
      copies.push(nom);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;   // un partagé absent du build : tant pis, pas une faute
    }
  }
  return { fichiers: plan.fichiers.map((f) => f.chemin), partages: copies };
}

module.exports = { planGalerieNeuve, creerGalerie, dossierVide, salleDEntree, PARTAGES };
