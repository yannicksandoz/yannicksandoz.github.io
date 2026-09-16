/**
 * LA CHAUFFE (chauffe.js) — compiler avec le compte de lumières du dessin.
 *
 * `renderer.compile(sousArbre, caméra, scène)` compte les lampes d'un
 * sous-arbre déjà dans la scène deux fois. La chauffe sort les racines de
 * la scène le temps de l'appel. La suite au nœud vérifie, avec un rendu
 * factice : que pendant l'appel les racines ne sont plus dans la scène
 * mais dans un paquet qui en tient lieu ; que les lampes comptées (scène
 * visible + paquet, comme three) sont celles du dessin ; que tout revient
 * à sa place, dans l'ordre, même si l'appel lève ; et que l'attente passe
 * par `compileAsync`.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { avecPaquet, compilerRacines, attendreProgrammes, lierProgrammes, invitesMasque } from '../engine/src/core/chauffe.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

/** Une scène : lumière de fond, salle courante avec deux lampes, salle voisine invisible avec une lampe, ciel. */
function scene() {
  const s = new THREE.Scene();
  const fond = new THREE.HemisphereLight(); fond.name = 'fond';
  const salle = new THREE.Group(); salle.name = 'salle';
  salle.add(new THREE.PointLight(), new THREE.SpotLight(), new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  const voisine = new THREE.Group(); voisine.name = 'voisine'; voisine.visible = false;
  voisine.add(new THREE.PointLight());
  const ciel = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.ShaderMaterial()); ciel.name = 'ciel';
  s.add(fond, salle, voisine, ciel);
  return { s, fond, salle, voisine, ciel };
}

/** Compte les lumières comme three.compile : la cible visible, puis le sous-arbre s'il en diffère. */
function compteCommeThree(sousArbre, cible) {
  let n = 0;
  cible.traverseVisible((o) => { if (o.isLight) n++; });
  if (sousArbre !== cible) sousArbre.traverseVisible((o) => { if (o.isLight) n++; });
  return n;
}

/** Un rendu factice qui note ses appels et compte comme three. */
function rendu() {
  const appels = [];
  return {
    appels,
    compile(sousArbre, camera, cible) {
      appels.push({ sousArbre, cible, lumieres: compteCommeThree(sousArbre, cible) });
      const materiaux = new Set();
      sousArbre.traverse((o) => { if (o.material) materiaux.add(o.material); });
      return materiaux;   // comme three : l'ensemble des matériaux préparés
    }
  };
}

console.log('\nla chauffe');

test('three compte double les lampes d\'un sous-arbre déjà dans la scène (le mal)', () => {
  const { s, salle } = scene();
  // sans chauffe : 3 lumières visibles dans la scène (fond + 2) + 2 du sous-arbre = 5, le dessin en a 3
  assert.equal(compteCommeThree(salle, s), 5);
  assert.equal(compteCommeThree(s, s), 3);
});

test('pendant l\'appel, les racines sont dans le paquet et plus dans la scène', () => {
  const { s, salle, ciel, fond } = scene();
  let vu = null;
  avecPaquet(s, [salle, ciel], (paquet) => {
    vu = { enfants: s.children.map((o) => o.name), paquet: paquet.children.map((o) => o.name), parents: [salle.parent, ciel.parent, fond.parent] };
  });
  assert.deepEqual(vu.enfants, ['fond', 'voisine']);
  assert.deepEqual(vu.paquet, ['salle', 'ciel']);
  assert.equal(vu.parents[0].name, 'chauffe');
  assert.equal(vu.parents[1].name, 'chauffe');
  assert.equal(vu.parents[2], s);
});

test('après l\'appel, tout est revenu, dans l\'ordre, avec le bon parent', () => {
  const { s, salle, ciel } = scene();
  const avant = [...s.children];
  avecPaquet(s, [ciel, salle], () => {});
  assert.deepEqual(s.children, avant);
  assert.equal(salle.parent, s);
  assert.equal(ciel.parent, s);
});

test('même si l\'appel lève', () => {
  const { s, salle } = scene();
  const avant = [...s.children];
  assert.throws(() => avecPaquet(s, [salle], () => { throw new Error('pilote'); }), /pilote/);
  assert.deepEqual(s.children, avant);
  assert.equal(salle.parent, s);
});

test('une racine qui n\'est pas un enfant direct de la scène est ignorée ; rien à sortir = fn(null)', () => {
  const { s, salle } = scene();
  const lampe = salle.children[0];
  let recu = 'jamais';
  avecPaquet(s, [lampe, null], (p) => { recu = p; });
  assert.equal(recu, null);
  assert.equal(lampe.parent, salle);
});

test('compilerRacines : le compte de lumières est celui du dessin', () => {
  const { s, salle, ciel } = scene();
  const r = rendu();
  const cam = new THREE.PerspectiveCamera();
  compilerRacines(r, s, [salle, ciel], cam);
  assert.equal(r.appels.length, 1);
  assert.equal(r.appels[0].cible, s);
  assert.equal(r.appels[0].sousArbre.name, 'chauffe');
  // fond (dans la scène) + point + cône (dans le paquet) = 3, comme au dessin
  assert.equal(r.appels[0].lumieres, 3);
  // la voisine invisible ne compte pas
  s.children.find((o) => o.name === 'voisine').visible = true;
  r.appels.length = 0;
  compilerRacines(r, s, [salle], cam);
  assert.equal(r.appels[0].lumieres, 4);
});

test('compilerRacines : rend les matériaux compilés (ce que compile rend), ou null', () => {
  const { s, salle } = scene();
  const r = rendu();
  const cam = new THREE.PerspectiveCamera();
  const materiaux = compilerRacines(r, s, [salle], cam);
  assert.ok(materiaux instanceof Set);
  assert.equal(materiaux.size, 1);
  assert.equal(salle.parent, s);
  assert.equal(compilerRacines(null, s, [salle], cam), null);
  assert.equal(compilerRacines(rendu(), null, [salle], cam), null);
  assert.equal(compilerRacines(rendu(), s, [salle], null), null);
  assert.equal(compilerRacines(rendu(), s, [salle.children[0]], cam), null);
});

/** Un rendu factice pour l'attente : chaque matériau est prêt après `n` sondes. */
function renduAttente({ extension = true, prets = new Map(), disposes = new Set() } = {}) {
  const sondes = new Map();
  return {
    sondes,
    extensions: { has: (nom) => extension && nom === 'KHR_parallel_shader_compile' },
    properties: { get: (m) => disposes.has(m) ? undefined : { currentProgram: { isReady: () => { const n = (sondes.get(m) ?? 0) + 1; sondes.set(m, n); return n > (prets.get(m) ?? 0); } } } }
  };
}

const attendreTous = (...ps) => Promise.all(ps);
const tests = [];
const testAsync = (nom, fn) => tests.push(fn().then(() => { ok++; console.log(`  ✓ ${nom}`); }, (e) => { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); }));

testAsync('attendreProgrammes : sans extension de liaison parallèle, rien à attendre (false, tout de suite)', async () => {
  const m = new THREE.MeshStandardMaterial();
  assert.equal(await attendreProgrammes(renduAttente({ extension: false }), [m]), false);
  assert.equal(await attendreProgrammes(renduAttente(), []), false);
  assert.equal(await attendreProgrammes(null, [m]), false);
});

testAsync('attendreProgrammes : sonde jusqu\'à ce que chaque programme soit prêt, puis true', async () => {
  const a = new THREE.MeshStandardMaterial(); const b = new THREE.MeshBasicMaterial();
  const r = renduAttente({ prets: new Map([[a, 2], [b, 0]]) });
  assert.equal(await attendreProgrammes(r, new Set([a, b]), { pas: 1 }), true);
  assert.equal(r.sondes.get(a), 3);
  assert.equal(r.sondes.get(b), 1);   // prêt à la première sonde, plus jamais sondé
});

testAsync('attendreProgrammes : un matériau disposé pendant l\'attente est tenu pour prêt (pas de « isReady of undefined »)', async () => {
  const a = new THREE.MeshStandardMaterial();
  const r = renduAttente({ disposes: new Set([a]) });
  assert.equal(await attendreProgrammes(r, [a], { pas: 1 }), true);
});

testAsync('attendreProgrammes : au délai, false — la salle s\'ouvre de toute façon', async () => {
  const a = new THREE.MeshStandardMaterial();
  let t = 0; const horloge = () => (t += 30);
  const r = renduAttente({ prets: new Map([[a, 1e9]]) });
  assert.equal(await attendreProgrammes(r, [a], { pas: 1, delai: 100, horloge }), false);
  assert.ok(r.sondes.get(a) <= 5, `${r.sondes.get(a)} sondes`);
});

test('invitesMasque : un maillage provisoire par maillage détourable, même géométrie, même matrice, même nature', () => {
  const masque = new THREE.MeshBasicMaterial();
  const oeuvre = new THREE.Group();
  const socle = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  socle.position.set(1, 2, 3); socle.scale.x = -1;
  const paves = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 5);
  const splats = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); splats.userData.horsSurvol = true;
  const lutin = new THREE.Sprite(new THREE.SpriteMaterial());
  oeuvre.add(socle, paves, splats, lutin);
  oeuvre.updateMatrixWorld(true);
  const invites = invitesMasque([oeuvre, null], masque);
  assert.equal(invites.length, 2);
  assert.equal(invites[0].geometry, socle.geometry);
  assert.equal(invites[0].material, masque);
  assert.ok(invites[0].matrixWorld.equals(socle.matrixWorld));
  assert.ok(invites[1].isInstancedMesh);
  assert.equal(invites[1].parent, null);
  assert.deepEqual(invitesMasque([oeuvre], null), []);
});

test('compilerRacines : les invités entrent dans le paquet le temps de l\'appel et en ressortent sans parent', () => {
  const { s, salle } = scene();
  const masque = new THREE.MeshBasicMaterial();
  const invites = invitesMasque([salle], masque);
  assert.equal(invites.length, 1);
  const r = rendu();
  const materiaux = compilerRacines(r, s, [salle], new THREE.PerspectiveCamera(), { invites });
  assert.ok(materiaux.has(masque));
  assert.equal(r.appels[0].sousArbre.children.includes(invites[0]), false);   // remis à zéro après l'appel
  assert.equal(invites[0].parent, null);
  assert.equal(salle.parent, s);
});

test('lierProgrammes : chaque variante de chaque matériau fait sa vérification de premier usage, un programme mort n\'arrête rien', () => {
  const a = new THREE.MeshStandardMaterial(); const b = new THREE.MeshBasicMaterial(); const c = new THREE.MeshBasicMaterial();
  let lies = 0;
  const programme = () => ({ getUniforms: () => { lies++; } });
  const mort = { getUniforms: () => { throw new Error('mort'); } };
  const props = new Map([
    [a, { programs: new Map([['k1', programme()], ['k2', programme()]]) }],
    [b, { currentProgram: programme() }]
  ]);
  const r = { properties: { get: (m) => props.get(m) } };
  props.get(a).programs.set('k3', mort);
  assert.equal(lierProgrammes(r, [a, b, c]), 3);
  assert.equal(lies, 3);
  assert.equal(lierProgrammes(null, [a]), 0);
});

testAsync('attendreProgrammes lie ce qui reste après l\'attente, même au délai', async () => {
  const a = new THREE.MeshStandardMaterial();
  let lies = 0;
  const r = renduAttente({ prets: new Map([[a, 1e9]]) });
  const props = r.properties.get(a); props.currentProgram.getUniforms = () => { lies++; };
  r.properties.get = () => props;
  let t = 0;
  assert.equal(await attendreProgrammes(r, [a], { pas: 1, delai: 50, horloge: () => (t += 30) }), false);
  assert.equal(lies, 1);
});

await attendreTous(...tests);

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);
