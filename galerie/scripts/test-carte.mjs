/**
 * Carte et mémoire de visite — les deux morceaux qui se testent sans écran.
 *
 * Le plan est déduit du graphe des portails : on vérifie qu'il pose TOUTES
 * les pièces du contenu réel, qu'aucune ne s'en recouvre une autre, et que
 * deux calculs donnent le même plan — une carte qui bouge d'une visite à
 * l'autre ne serait plus un repère.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planGalerie, empreinte, sortie } from '../engine/src/core/planGalerie.js';
import { migrateRoom } from '../engine/src/core/schema.js';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(name, actual, expected) {
  if (eq(actual, expected)) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failed++;
    console.error(`  ✗ ${name}\n      attendu : ${JSON.stringify(expected)}`
      + `\n      obtenu  : ${JSON.stringify(actual)}`);
  }
}
const vrai = (name, cond, quoi = '') => check(name, cond ? true : `faux — ${quoi}`, true);
const arrondi = (v) => Math.round(v * 100) / 100;

/* ------------------------------------------------------- empreintes --- */
console.log('\nEmpreinte d\'une pièce');
{
  check('coque explicite', empreinte({ shell: { width: 40, depth: 12 } }), { w: 40, d: 12 });
  check('sans coque, le sol fait foi', empreinte({ floor: { size: 30 } }), { w: 30, d: 30 });
  check('sans rien, les valeurs du moteur', empreinte({}), { w: 26, d: 20 });
  check('coque à true', empreinte({ shell: true }), { w: 26, d: 20 });
}

/* ---------------------------------------------------- sens de sortie --- */
console.log('\nSens de sortie d\'un portail');
{
  const t = { w: 30, d: 30 };
  const s = (p) => {
    const u = sortie(p, t);
    return { x: arrondi(u.x), z: arrondi(u.z) };
  };
  // mur nord (z négatif) : la porte regarde vers l'intérieur, on sort au nord
  check('mur nord', s({ position: [0, 0, -15], rotation: [0, 0, 0] }), { x: 0, z: -1 });
  check('mur sud', s({ position: [0, 0, 15], rotation: [0, 180, 0] }), { x: 0, z: 1 });
  check('mur est', s({ position: [15, 0, 0], rotation: [0, -90, 0] }), { x: 1, z: 0 });
  check('mur ouest', s({ position: [-15, 0, 0], rotation: [0, 90, 0] }), { x: -1, z: 0 });
  // sans rotation renseignée (le schéma pose 0), c'est la position qui parle
  check('sans rotation, la position tranche',
    s({ position: [0, 0, 14], rotation: [0, 0, 0] }), { x: 0, z: 1 });
  check('porte au milieu, on croit la rotation',
    s({ position: [0, 0, 0], rotation: [0, 0, 0] }), { x: 0, z: -1 });
}

/* -------------------------------------------- le plan du vrai contenu --- */
console.log('\nPlan de la galerie (contenu réel)');
{
  const dossier = join(racine, 'content', 'rooms');
  const index = JSON.parse(readFileSync(join(dossier, 'index.json'), 'utf8'));
  const noms = Array.isArray(index) ? index : (index.rooms ?? []);
  const rooms = noms.map((n) => migrateRoom(
    JSON.parse(readFileSync(join(dossier, n.endsWith('.json') ? n : `${n}.json`), 'utf8'))));

  vrai('le contenu compte au moins dix pièces', rooms.length >= 10, `${rooms.length}`);

  const plan = planGalerie(rooms, 'entree');
  check('toutes les pièces sont posées', plan.pieces.length, rooms.length);
  vrai('aucune coordonnée n\'est NaN',
    plan.pieces.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)),
    JSON.stringify(plan.pieces.filter((p) => !Number.isFinite(p.x))));

  // deux pièces ne peuvent pas occuper le même sol
  const chevauchements = [];
  for (let i = 0; i < plan.pieces.length; i++) {
    for (let j = i + 1; j < plan.pieces.length; j++) {
      const a = plan.pieces[i], b = plan.pieces[j];
      if (Math.abs(b.x - a.x) < (a.w + b.w) / 2 - 0.01
        && Math.abs(b.z - a.z) < (a.d + b.d) / 2 - 0.01) chevauchements.push([a.id, b.id]);
    }
  }
  check('aucune pièce n\'en recouvre une autre', chevauchements, []);

  // chaque portail du contenu a son trait, une fois et une seule
  const attendues = new Set();
  for (const r of rooms) {
    for (const p of r.portals ?? []) {
      if (!p.to || p.to === r.id || !rooms.some((x) => x.id === p.to)) continue;
      attendues.add(r.id < p.to ? `${r.id}|${p.to}` : `${p.to}|${r.id}`);
    }
  }
  check('un trait par passage, sans doublon',
    plan.portes.map((p) => p.cle).sort(), [...attendues].sort());

  // la carte est un repère : elle doit être la même à chaque calcul
  check('le plan est déterministe',
    planGalerie(rooms, 'entree').pieces, plan.pieces);

  // l'entrée est l'origine du plan
  const entree = plan.pieces.find((p) => p.id === 'entree');
  check('la pièce de départ est à l\'origine', { x: entree?.x, z: entree?.z }, { x: 0, z: 0 });

  vrai('les bornes enveloppent tout',
    plan.bornes.x1 > plan.bornes.x0 && plan.bornes.z1 > plan.bornes.z0,
    JSON.stringify(plan.bornes));
}

/* ----------------------------------------------------- cas dégénérés --- */
console.log('\nPlan : cas dégénérés');
{
  check('sans pièce, un plan vide', planGalerie([]).pieces, []);
  check('une pièce seule tient debout',
    planGalerie([{ id: 'a', title: 'A' }]).pieces,
    [{ id: 'a', titre: 'A', x: 0, z: 0, w: 26, d: 20 }]);
  check('un portail vers l\'inconnu ne casse rien',
    planGalerie([{ id: 'a', portals: [{ to: 'nulle-part', position: [0, 0, -10] }] }]).portes, []);
  const boucle = planGalerie([
    { id: 'a', portals: [{ to: 'b', position: [0, 0, -10], rotation: [0, 0, 0] }] },
    { id: 'b', portals: [{ to: 'a', position: [0, 0, 10], rotation: [0, 180, 0] }] }
  ]);
  check('un aller-retour ne fait qu\'un trait', boucle.portes.length, 1);
  vrai('la voisine du nord est au nord',
    boucle.pieces[1].z < boucle.pieces[0].z, JSON.stringify(boucle.pieces));
  // une pièce qu'aucun portail ne dessert doit tout de même être posée
  const orpheline = planGalerie([{ id: 'a' }, { id: 'seule' }]);
  check('une pièce inatteignable est posée quand même', orpheline.pieces.length, 2);
}

/* ------------------------------------------------- mémoire de visite --- */
console.log('\nMémoire de visite');
{
  // localStorage n'existe pas au nœud : on en pose un, minimal et honnête
  const disque = new Map();
  globalThis.localStorage = {
    getItem: (k) => (disque.has(k) ? disque.get(k) : null),
    setItem: (k, v) => disque.set(k, String(v)),
    removeItem: (k) => disque.delete(k)
  };
  const { Memoire } = await import('../engine/src/core/Memoire.js');

  const m = new Memoire();
  check('une première visite ne se souvient de rien', m.reprise, false);
  check('noter une pièce est nouveau', m.noter('pieces', 'entree'), true);
  check('la renoter ne l\'est plus', m.noter('pieces', 'entree'), false);
  m.noterPorte('labo', 'entree');
  check('une porte se nomme dans l\'ordre', [...m.portes], ['entree|labo']);
  check('la même porte à l\'envers est la même',
    m.noterPorte('entree', 'labo'), false);
  m.noter('oeuvres', 'lune');
  m.noter('jetonsPris', 'entree:0');
  m.setSolde(3);

  const relue = new Memoire();
  check('on revient dans une galerie qui se souvient', relue.reprise, true);
  check('les pièces sont là', [...relue.pieces], ['entree']);
  check('les passages aussi', [...relue.portes], ['entree|labo']);
  check('les œuvres aussi', [...relue.oeuvres], ['lune']);
  check('les jetons ramassés aussi', [...relue.jetonsPris], ['entree:0']);
  check('le solde aussi', relue.jetonsSolde, 3);

  relue.oublier();
  check('« recommencer » efface tout', new Memoire().serialiser(), {
    v: 1, pieces: [], portes: [], oeuvres: [], revelees: [],
    jetons: { solde: 0, pris: [] }
  });

  // une mémoire d'une autre version, ou abîmée, ne doit pas casser la visite
  disque.set('galerie-visite', '{"v":99,"pieces":["x"]}');
  check('une version inconnue est ignorée', [...new Memoire().pieces], []);
  disque.set('galerie-visite', 'ceci n\'est pas du JSON');
  check('une mémoire illisible est ignorée', [...new Memoire().pieces], []);

  // stockage refusé (navigation privée) : la visite continue, sans mémoire
  globalThis.localStorage = {
    getItem: () => { throw new Error('refusé'); },
    setItem: () => { throw new Error('refusé'); },
    removeItem: () => { throw new Error('refusé'); }
  };
  const sansDisque = new Memoire();
  sansDisque.noter('pieces', 'entree');
  check('sans droit d\'écrire, la mémoire vit en RAM', [...sansDisque.pieces], ['entree']);
}

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
