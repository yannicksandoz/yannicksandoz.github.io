import * as THREE from '/home/user/yannicksandoz.github.io/galerie/node_modules/three/build/three.module.js';
import fs from 'node:fs';
import { buildVoxelMesh } from '/home/user/yannicksandoz.github.io/galerie/engine/src/core/voxel.js';
import { buildFloor, buildShell } from '/home/user/yannicksandoz.github.io/galerie/engine/src/core/RoomManager.js';

const DIR = '/home/user/yannicksandoz.github.io/galerie/content';
const room = JSON.parse(fs.readFileSync(`${DIR}/rooms/belvedere.json`, 'utf8'));

const group = new THREE.Group();
const floor = buildFloor(room);       group.add(floor);
const shell = buildShell(room);       group.add(shell);

const walkables = [];
for (const c of floor.children) if (c.isMesh) walkables.push(c);
shell.traverse(o => { if (o.isMesh) walkables.push(o); });

let instTotal = 0;
for (const id of room.works) {
  const cfg = JSON.parse(fs.readFileSync(`${DIR}/works/${id}.json`, 'utf8'));
  if (!cfg.walkable || cfg.model?.type !== 'voxel') continue;
  const m = buildVoxelMesh(cfg.model);
  if (!m) continue;
  m.position.fromArray(cfg.position);
  m.rotation.set(...(cfg.rotation ?? [0,0,0]).map(THREE.MathUtils.degToRad));
  group.add(m);
  walkables.push(m);
  instTotal += m.count;
}
group.updateMatrixWorld(true);
console.log(`walkables: ${walkables.length} objets, dont ${instTotal} instances voxel`);

const DOWN = new THREE.Vector3(0,-1,0);
const EYE = 2.2, CHEST = 1.15;

function frameCost(camPos, groundY, dir, blockedCount) {
  const ground = new THREE.Raycaster(); ground.far = 40;
  const wall = new THREE.Raycaster();
  const o = new THREE.Vector3();
  // 1 rayon sol
  o.set(camPos.x, camPos.y + 0.6, camPos.z);
  ground.set(o, DOWN);
  ground.intersectObjects(walkables, true);
  // N rayons mur
  for (let i = 0; i < blockedCount; i++) {
    o.set(camPos.x, groundY + CHEST, camPos.z);
    wall.set(o, dir);
    wall.far = 0.1 + 0.35;
    wall.intersectObjects(walkables, true);
  }
}

function bench(label, camPos, groundY, dir, blockedCount) {
  for (let i = 0; i < 30; i++) frameCost(camPos, groundY, dir, blockedCount);
  const N = 300;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) frameCost(camPos, groundY, dir, blockedCount);
  const t1 = process.hrtime.bigint();
  console.log(`${label}: ${(Number(t1-t0)/N/1000).toFixed(1)} µs / frame`);
}

const dir = new THREE.Vector3(1,0,0);
// visiteur au milieu de l'escalier r1 (world ~ x 28.5±11, z 10, y montant)
bench('milieu escalier r1, bloqué (3 rayons mur + 1 sol)', new THREE.Vector3(30, 8.2, 10), 6.0, dir, 3);
bench('milieu escalier r1, libre  (1 rayon mur + 1 sol)',  new THREE.Vector3(30, 8.2, 10), 6.0, dir, 1);
bench('centre de la salle, libre  (1 rayon mur + 1 sol)',  new THREE.Vector3(0, 2.2, 30), 0, dir, 1);
bench('centre de la salle, bloqué (3 rayons mur + 1 sol)', new THREE.Vector3(0, 2.2, 30), 0, dir, 3);
bench('sol seul, aucun rayon mur (avant-diff : 1 rayon sol)', new THREE.Vector3(0, 2.2, 30), 0, dir, 0);
