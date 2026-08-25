/**
 * LES RAYONS — le BVH sous les collisions, éprouvé au nœud.
 *
 * Une accélération n'a de valeur que si elle rend LE MÊME RÉSULTAT. Tout ce
 * fichier tient dans cette phrase : on ne mesure la vitesse qu'après avoir
 * prouvé l'égalité, et jamais l'inverse.
 *
 * On vérifie, dans l'ordre :
 *   1. la politique — qui mérite un arbre, qui n'en mérite pas ;
 *   2. L'ÉGALITÉ sur un maillage ordinaire : même point, même distance,
 *      même face qu'avec le balayage de three ;
 *   3. L'ÉGALITÉ SUR UNE MASSE INSTANCIÉE. C'est la vérification qui compte
 *      le plus, parce que c'est celle dont le raisonnement est le plus
 *      fragile : `InstancedMesh` a son propre `raycast`, et l'on pourrait
 *      croire le BVH court-circuité. En vérité three y fabrique un `Mesh`
 *      interne auquel il donne la matrice de chaque instance, puis appelle
 *      SON `raycast` — donc le nôtre. Cela tient à un détail d'implémentation
 *      de three qu'aucune promesse ne protège : si un jour il change, ce
 *      test tombe, et c'est exactement ce qu'on lui demande ;
 *   4. `firstHitOnly` rend bien le PLUS PROCHE, et pas n'importe lequel ;
 *   5. le budget de construction est respecté ;
 *   6. et, pour mémoire, ce que ça fait gagner.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installerRayons, preparerRayons, rayonRapide, meriteUnArbre,
  meriteLaBibliotheque, etatRayons, compterTriangles, oublierRayons,
  MOINS_DE_TRIANGLES }
  from '../engine/src/core/rayons.js';

// La bibliothèque se charge à la demande : ici on la réveille tout de suite,
// une fois, pour pouvoir éprouver ce qu'elle fait. C'est le seul endroit du
// projet qui l'attend — le moteur, lui, ne l'attend jamais (voir rayons.js).
const dispo = await installerRayons(THREE);

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

/** Une grille de N×N quadrilatères : de quoi peser, sans rien d'exotique. */
function grille(n, taille = 20) {
  const g = new THREE.PlaneGeometry(taille, taille, n, n);
  g.rotateX(-Math.PI / 2);          // au sol, comme un plancher
  return g;
}
const materiau = new THREE.MeshBasicMaterial();

/* ------------------------------------------------------- la politique ---- */
titre('qui mérite un arbre');
test('la bibliothèque s’est chargée, et une seule fois', () => {
  // Une double pose ferait de `acceleratedRaycast` son propre repli, donc une
  // récursion infinie au premier maillage sans arbre. Le moteur et l'éditeur
  // importent tous deux ce module : ce n'est pas une hypothèse d'école.
  assert.equal(dispo, true, `état ${etatRayons()}`);
  assert.equal(etatRayons(), 'pret');
  // un second appel ne recharge rien : l'état reste 'pret'
  installerRayons(THREE);
  assert.equal(etatRayons(), 'pret');
});
test('ELLE NE SE RÉVEILLE QUE POUR DU LOURD — le cœur du module', () => {
  // Mesuré au navigateur : la plus grosse cible de la galerie fait DOUZE
  // triangles, et la passe de collision complète du belvédère coûte 0,192 ms.
  // Empaqueter le BVH pour cela, c'était vingt kilo-octets compressés qui ne
  // servent à rien. Le seuil est donc le module : il doit rester très
  // au-dessus de ce que contient une galerie ordinaire.
  const pave = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materiau);
  assert.equal(compterTriangles(pave.geometry), 12);
  assert.equal(meriteLaBibliotheque(Array.from({ length: 60 }, () => pave)), false,
    'soixante pavés ne doivent pas déclencher un téléchargement');
  assert.equal(meriteLaBibliotheque([new THREE.Mesh(grille(60), materiau)]), true,
    'un modèle importé, si');
  assert.ok(MOINS_DE_TRIANGLES >= 1000, `seuil trop bas : ${MOINS_DE_TRIANGLES}`);
});
test('on compte les triangles, indexés ou non', () => {
  const g = grille(4);
  assert.equal(compterTriangles(g), 32);          // 4×4 quads = 32 triangles
  assert.equal(compterTriangles(g.toNonIndexed()), 32);
  assert.equal(compterTriangles(null), 0);
});
test('un petit maillage n’en veut pas', () => {
  const petit = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), materiau);
  assert.equal(meriteUnArbre(petit), false);
});
test('…un gros, si', () => {
  const gros = new THREE.Mesh(grille(40), materiau);   // 3 200 triangles
  assert.ok(compterTriangles(gros.geometry) >= MOINS_DE_TRIANGLES);
  assert.equal(meriteUnArbre(gros), true);
});
test('ce qui n’est pas un maillage est écarté', () => {
  assert.equal(meriteUnArbre(null), false);
  assert.equal(meriteUnArbre(new THREE.Group()), false);
  assert.equal(meriteUnArbre(new THREE.Points(grille(40), materiau)), false);
});
test('on ne bâtit pas deux fois le même arbre', () => {
  const m = new THREE.Mesh(grille(40), materiau);
  assert.equal(preparerRayons([m]), 1);
  assert.equal(meriteUnArbre(m), false);
  assert.equal(preparerRayons([m]), 0);
  oublierRayons(m);
  assert.equal(meriteUnArbre(m), true);   // rendu, il en redemande un
});
test('une géométrie de morphing est laissée tranquille', () => {
  // ses positions bougent à chaque frame : un arbre bâti sur la pose de
  // repos mentirait dès la première animation
  const g = grille(40);
  g.morphAttributes.position = [grille(40).attributes.position];
  assert.equal(meriteUnArbre(new THREE.Mesh(g, materiau)), false);
});

/* ---------------------------------------------------------- l'égalité ---- */
titre('le BVH rend EXACTEMENT le même résultat');

/** Tire un rayon vertical en (x, z) sur une liste de cibles. */
function sonder(cibles, x, z, rapide = false) {
  const r = new THREE.Raycaster();
  if (rapide) rayonRapide(r);
  r.far = 100;
  r.set(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
  return r.intersectObjects(cibles, true);
}

test('sur un maillage ordinaire : même point, même distance, même normale', () => {
  // CE QUI CHANGE, ET QU'IL FAUT SAVOIR : bâtir un arbre RÉORDONNE l'index
  // de la géométrie — c'est ainsi qu'un BVH range ses triangles en feuilles.
  // Le `faceIndex` d'un impact n'est donc plus le même NUMÉRO qu'avant. Ce
  // n'est pas une erreur : c'est le même triangle, au même endroit, avec la
  // même normale — et c'est la normale que l'éditeur lit (`VoxelMode`), pas
  // le numéro. Le rendu ne s'en aperçoit pas non plus, l'ordre des triangles
  // ne lui important pas. Mais qui voudrait un jour indexer QUELQUE CHOSE par
  // `faceIndex` doit le lire ici plutôt que de le découvrir.
  const g = grille(40);                               // 3 200 triangles
  const nu = new THREE.Mesh(g.clone(), materiau);     // sans arbre
  const arbre = new THREE.Mesh(g.clone(), materiau);  // avec
  nu.updateMatrixWorld(true);
  arbre.updateMatrixWorld(true);
  preparerRayons([arbre], 1000);
  assert.ok(arbre.geometry.boundsTree, 'arbre non bâti');
  let compares = 0;
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 4; j++) {
      const x = i * 1.13, z = j * 0.97;   // hors du réseau, pour tomber
      const a = sonder([nu], x, z)[0];    // à l'intérieur des triangles
      const b = sonder([arbre], x, z)[0];
      assert.equal(!!a, !!b, `présence différente en ${x},${z}`);
      if (!a) continue;
      assert.ok(Math.abs(a.distance - b.distance) < 1e-9, 'distance');
      assert.ok(a.point.distanceTo(b.point) < 1e-9, 'point');
      assert.ok(a.face.normal.distanceTo(b.face.normal) < 1e-9, 'normale');
      compares++;
    }
  }
  assert.ok(compares > 60, `seulement ${compares} comparaisons`);
});

test('…et l’index est bien réordonné, comme annoncé ci-dessus', () => {
  // On l'AFFIRME plutôt que de le subir : si une version future de la
  // bibliothèque cessait de réordonner, ce test tomberait et l'on saurait
  // que le commentaire du dessus a cessé d'être vrai.
  const g = grille(40);
  const avant = Array.from(g.index.array.slice(0, 64));
  preparerRayons([new THREE.Mesh(g, materiau)], 1000);
  const apres = Array.from(g.index.array.slice(0, 64));
  assert.notDeepEqual(avant, apres);
  assert.equal(g.index.count, 40 * 40 * 6, 'aucun triangle ne doit disparaître');
});

test('SUR UNE MASSE INSTANCIÉE aussi — la vérification qui compte', () => {
  // Le raisonnement de `rayons.js` : three fabrique un Mesh interne par
  // instance et appelle son raycast. Si cela cessait d'être vrai, le BVH
  // raycasterait la géométrie de base à la matrice de l'objet — donc au
  // mauvais endroit — et TOUTES les collisions du labyrinthe deviendraient
  // fausses, en silence. On ne fait pas confiance, on mesure.
  const g = grille(40, 2);            // 3 200 triangles : au-dessus du seuil
  const faire = () => {
    const im = new THREE.InstancedMesh(g.clone(), materiau, 9);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        // chaque instance à une HAUTEUR différente : si la matrice
        // d'instance était ignorée, tous les impacts tomberaient au même y
        m.makeTranslation(i * 3, 1 + (k * 0.5), j * 3);
        im.setMatrixAt(k++, m);
      }
    }
    im.instanceMatrix.needsUpdate = true;
    im.updateMatrixWorld(true);
    im.computeBoundingSphere();
    return im;
  };
  const nu = faire();
  const arbre = faire();
  preparerRayons([{ isMesh: true, geometry: arbre.geometry }], 1000);
  assert.ok(arbre.geometry.boundsTree, 'arbre non bâti');

  let touches = 0, hauteurs = new Set();
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const x = i * 3 + 0.31, z = j * 3 - 0.27;
      const a = sonder([nu], x, z);
      const b = sonder([arbre], x, z);
      assert.equal(a.length, b.length, `nombre d’impacts en ${x},${z}`);
      if (!a.length) continue;
      assert.ok(Math.abs(a[0].distance - b[0].distance) < 1e-9, 'distance');
      assert.equal(a[0].instanceId, b[0].instanceId, 'instance');
      assert.equal(b[0].object, arbre, 'l’objet rendu doit être la masse');
      hauteurs.add(b[0].point.y.toFixed(3));
      touches++;
    }
  }
  assert.equal(touches, 9, `${touches} instances touchées sur 9`);
  assert.ok(hauteurs.size > 1,
    'toutes les instances au même y : la matrice d’instance est ignorée');
});

test('firstHitOnly rend bien le PLUS PROCHE', () => {
  // trois plans empilés : le rayon descend, il doit sortir celui du dessus
  const cibles = [];
  for (const y of [0, 4, 8]) {
    const m = new THREE.Mesh(grille(40, 30), materiau);
    m.position.y = y;
    m.updateMatrixWorld(true);
    cibles.push(m);
  }
  preparerRayons(cibles, 1000);
  const lent = sonder(cibles, 0.37, -0.21, false);
  const vif = sonder(cibles, 0.37, -0.21, true);
  assert.equal(lent.length, 3, 'le rayon complet doit voir les trois plans');
  assert.equal(vif.length, 3, 'un impact par cible, le plus proche de chacune');
  assert.ok(Math.abs(lent[0].distance - vif[0].distance) < 1e-9);
  assert.ok(Math.abs(vif[0].point.y - 8) < 1e-6, `y = ${vif[0].point.y}`);
});

/* ------------------------------------------------------------ le coût ---- */
titre('le coût, et ce qu’il rapporte');
test('le budget de construction est respecté', () => {
  const lourds = [];
  for (let i = 0; i < 40; i++) lourds.push(new THREE.Mesh(grille(60), materiau));
  const faits = preparerRayons(lourds, 0);   // budget nul : un seul, puis stop
  assert.equal(faits, 1, `${faits} arbres bâtis pour un budget nul`);
  assert.ok(lourds.slice(1).some((m) => !m.geometry.boundsTree),
    'tout a été bâti malgré le budget');
});
test('et il rend le même résultat plus vite', () => {
  const g = grille(160);                     // ~51 000 triangles
  const nu = new THREE.Mesh(g.clone(), materiau);
  const arbre = new THREE.Mesh(g.clone(), materiau);
  nu.updateMatrixWorld(true);
  arbre.updateMatrixWorld(true);
  preparerRayons([arbre], 5000);
  const chrono = (cible, rapide) => {
    const t = performance.now();
    for (let i = 0; i < 200; i++) sonder([cible], (i % 17) * 0.53 - 4, 0.31, rapide);
    return performance.now() - t;
  };
  chrono(nu, false); chrono(arbre, true);    // on chauffe le JIT
  const lent = chrono(nu, false);
  const vif = chrono(arbre, true);
  console.log(`  · 200 rayons sur ${compterTriangles(g)} triangles :`
    + ` ${lent.toFixed(1)} ms sans arbre, ${vif.toFixed(1)} ms avec`
    + ` — ×${(lent / Math.max(vif, 1e-6)).toFixed(1)}`);
  assert.ok(vif < lent, `${vif.toFixed(1)} ms contre ${lent.toFixed(1)} ms`);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
