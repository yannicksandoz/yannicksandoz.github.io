import * as THREE from 'three';
import { TILE, styleTexture, anisotropie, SURFACES, PEINTRES_NOMS }
  from './textures.js';

/**
 * LES MATIÈRES PHOTOGRAPHIQUES — séparées des tuiles procédurales, et
 * c'est un choix de MONTAGE autant que de lisibilité.
 *
 * Ce module importe des fichiers `.jpg` : des imports que seul un bundler
 * sait résoudre. `textures.js`, lui, ne dépend que de code — si bien qu'un
 * module du cœur qui n'a besoin que du procédural (le voxel et son grain,
 * par exemple) reste importable par `node`, donc éprouvable par les suites.
 * La règle a déjà été apprise une fois, sur un `?raw` qui avait fait taire
 * treize suites sans que rien ne rougisse.
 */


import boisMatiere from '../../assets/matieres/bois-matiere.jpg';
import boisRelief from '../../assets/matieres/bois-relief.jpg';
import boisRugosite from '../../assets/matieres/bois-rugosite.jpg';
import briqueMatiere from '../../assets/matieres/brique-matiere.jpg';
import briqueRelief from '../../assets/matieres/brique-relief.jpg';
import briqueRugosite from '../../assets/matieres/brique-rugosite.jpg';
import damierMatiere from '../../assets/matieres/damier-matiere.jpg';
import damierNormale from '../../assets/matieres/damier-normale.jpg';
import herbeMatiere from '../../assets/matieres/herbe-matiere.jpg';
import herbeNormale from '../../assets/matieres/herbe-normale.jpg';

/**
 * Les MATIÈRES : des photographies, mais pliées au contrat des tuiles.
 *
 * Les jeux viennent du dépôt three.js (tag r166, MIT — voir
 * `scripts/rapatrie-matieres.mjs` et `engine/assets/provenance.json`), et
 * l'albédo est DÉSATURÉ à l'import : comme les tuiles procédurales
 * ci-dessus, une matière n'apporte que la lumière qu'elle renvoie — la
 * COULEUR reste celle que la pièce déclare, et un parquet prend la teinte
 * de la salle au lieu de lui imposer son brun. Ce que la photo apporte que
 * 32 texels ne savaient pas dire : le RELIEF (bump) et la RUGOSITÉ, carte
 * par carte — c'est là que la lumière rasante des lanternes se met à
 * accrocher le veinage.
 *
 * `metres` : la taille physique d'une répétition. Les UV du monde comptent
 * en tuiles de TILE mètres ; `repeat = TILE / metres` remet chaque motif à
 * son échelle réelle — des lames de parquet de vingt centimètres, des
 * briques de vingt-cinq.
 */
const MATIERES = {
  bois: {
    matiere: boisMatiere, relief: boisRelief, rugosite: boisRugosite,
    metres: 3.6, creux: 0.35
  },
  'brique-vraie': {
    matiere: briqueMatiere, relief: briqueRelief, rugosite: briqueRugosite,
    metres: 2.8, creux: 0.5
  },
  // le damier de sol des exemples three.js : un hall de galerie. Pas de
  // carte de rugosité — `lisse` donne le scalaire (une pierre polie), et la
  // carte NORMALE (les joints entre dalles) remplace le bump.
  damier: {
    matiere: damierMatiere, normale: damierNormale,
    metres: 2, creux: 0.8, lisse: 0.55
  },
  // l'herbe du terrain : là où la tuile « herbe » disait un pré en huit
  // texels, la photo dit les brins — surtout par sa normale, en lumière
  // rasante. Mate, comme l'herbe.
  'herbe-vraie': {
    matiere: herbeMatiere, normale: herbeNormale,
    metres: 2.4, creux: 0.7
  }
};

const _cacheMatieres = new Map();

function chargerCarte(url, metres, albedo = false) {
  const tex = new THREE.TextureLoader().load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // une photo se filtre en linéaire — le NEAREST des tuiles pixel-art
  // ferait scintiller le veinage ; les mipmaps restent, pour le lointain
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropie();
  // L'ALBÉDO D'UNE PHOTO EST EN sRGB, ET LE DIRE CHANGE TOUT.
  //
  // Les tuiles procédurales sont peintes en valeurs linéaires : leur
  // NoColorSpace est juste. Une photographie, elle, est encodée en sRGB —
  // la lire comme linéaire éclaircit chaque texel d'environ 1,8, et c'est
  // exactement ce qui délavait les parquets : un brun sombre déclaré par la
  // pièce ressortait en ciment mouillé, la couleur perdait son autorité.
  // Le relief, la rugosité et la normale, eux, sont des DONNÉES et non des
  // couleurs : ils restent hors de tout espace colorimétrique.
  tex.colorSpace = albedo ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.repeat.set(TILE / metres, TILE / metres);
  return tex;
}

/**
 * Les cartes d'une matière réelle — ou null si le style est une tuile
 * procédurale (ou inconnu). Chargées au premier usage, partagées ensuite :
 * toutes les salles au sol de bois regardent les trois mêmes textures.
 */
export function styleMatiere(style) {
  const m = MATIERES[style];
  if (!m || typeof document === 'undefined') return null;
  if (_cacheMatieres.has(style)) return _cacheMatieres.get(style);
  const jeu = {
    map: chargerCarte(m.matiere, m.metres, true),
    // le relief parle bump OU normale — jamais les deux : une matière
    // photographiée vient avec l'un ou l'autre, et les mélanger doublerait
    // le grain sans rien dire de plus
    bumpMap: m.relief ? chargerCarte(m.relief, m.metres) : null,
    bumpScale: m.creux,
    normalMap: m.normale ? chargerCarte(m.normale, m.metres) : null,
    normalScale: m.creux,
    roughnessMap: m.rugosite ? chargerCarte(m.rugosite, m.metres) : null,
    // sans carte de rugosité, `lisse` donne le scalaire (défaut : mate)
    roughness: m.lisse ?? 1
  };
  _cacheMatieres.set(style, jeu);
  return jeu;
}

/**
 * Styles offerts par l'éditeur (l'ordre est celui du menu) : les tuiles
 * procédurales d'abord, puis les matières réelles. « brique » procédurale
 * garde son nom historique ; la matière photographique s'appelle
 * « brique-vraie » pour que les pièces existantes ne changent pas de peau
 * sans qu'on le leur demande.
 */
export const TEXTURE_STYLES = [...PEINTRES_NOMS, ...Object.keys(MATIERES)];

/**
 * LE JEU DE CARTES D'UN STYLE, quel qu'il soit — l'entrée unique pour tout
 * ce qui n'est ni sol ni mur : primitives, portails, mobilier.
 *
 * Sol et murs interrogeaient `styleTexture` et `styleMatiere` séparément,
 * puis recomposaient à la main le relief, la rugosité et le métal. Les
 * primitives, elles, ne demandaient que l'albédo — et c'est pour cela
 * qu'un banc, une lanterne ou une marche du belvédère restaient des
 * aplats de plastique à côté d'un mur qui, lui, avait du grain.
 *
 * Ici, un seul appel rend tout : la carte, son relief (une tuile
 * procédurale sert de bump à elle-même), sa rugosité et son métal — pris
 * dans SURFACES pour les tuiles, dans la matière pour les photographies.
 * `echelle` multiplie la répétition demandée par l'objet.
 *
 * Rend `null` si le style est inconnu : l'appelant garde son aplat.
 */
export function jeuDeSurface(style, echelle = 1) {
  if (!style) return null;
  const matiere = styleMatiere(style);
  if (matiere) {
    return {
      map: matiere.map,
      bumpMap: matiere.bumpMap,
      bumpScale: matiere.bumpScale,
      normalMap: matiere.normalMap,
      normalScale: matiere.normalScale,
      roughnessMap: matiere.roughnessMap,
      roughness: matiere.roughness,
      metalness: null,           // une photo ne décide pas du métal
      metres: MATIERES[style].metres / echelle
    };
  }
  const map = styleTexture(style);
  if (!map) return null;
  const s = SURFACES[style] ?? { creux: 0.2, rugosite: 0.8, metal: 0.05, metres: TILE };
  return {
    map,
    bumpMap: map,                // la tuile EST son propre relief
    bumpScale: s.creux,
    normalMap: null,
    normalScale: null,
    roughnessMap: null,
    roughness: s.rugosite,
    metalness: s.metal,
    metres: s.metres / echelle
  };
}
