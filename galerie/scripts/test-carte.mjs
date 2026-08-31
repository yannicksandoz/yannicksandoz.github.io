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
  // sans coque, l'étendue MEUBLÉE fait foi : le terrain de 64 m sous un
  // chemin de 2 × 20 m ne doit plus dessiner un carré géant
  check('sans coque, l\'étendue meublée borne le terrain',
    empreinte({ floor: { size: 64 } }, [[0, -10], [2, 10]]), { w: 12, d: 30 });
  check('la coque ignore les œuvres',
    empreinte({ shell: { width: 40, depth: 12 } }, [[0, -30], [0, 30]]),
    { w: 40, d: 12 });
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

  // Les six faces du cube sont des SATELLITES : leurs portes d'Escher ne
  // disent rien à plat, elles se rangent donc en anneau autour du belvédère
  // — près de lui, et dans l'ordre de leurs titres en tournant à l'écran.
  const belv = plan.pieces.find((p) => p.id === 'belvedere');
  const faces = plan.pieces.filter((p) => /^face-\d$/.test(p.id));
  vrai('les six faces sont posées', faces.length === 6, `${faces.length}`);
  if (belv && faces.length === 6) {
    const rayons = faces.map((f) => Math.hypot(f.x - belv.x, f.z - belv.z));
    vrai('toutes les faces orbitent près du belvédère',
      Math.max(...rayons) < 90, JSON.stringify(rayons.map(arrondi)));
    const TAU = Math.PI * 2;
    const depuisNord = [1, 2, 3, 4, 5, 6].map((n) => {
      const f = faces.find((p) => p.id === `face-${n}`);
      return (Math.atan2(f.z - belv.z, f.x - belv.x) + TAU / 4 + TAU) % TAU;
    });
    check('les faces se suivent comme une horloge',
      depuisNord.map(arrondi), [...depuisNord].sort((a, b) => a - b).map(arrondi));
  }

  // Chaque porte porte son CHEMIN, et aucun chemin ne traverse une salle
  // étrangère : un trait qui barre une pièce se lit comme une porte qui
  // n'existe pas.
  vrai('chaque porte a son chemin',
    plan.portes.every((p) => Array.isArray(p.chemin) && p.chemin.length >= 2),
    JSON.stringify(plan.portes.filter((p) => !p.chemin?.length).map((p) => p.cle)));
  const traversees = [];
  for (const porte of plan.portes) {
    for (let s = 0; s < porte.chemin.length - 1; s++) {
      const [x0, z0] = porte.chemin[s], [x1, z1] = porte.chemin[s + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0)));
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
        for (const p of plan.pieces) {
          if (p.id === porte.a || p.id === porte.b) continue;
          if (Math.abs(x - p.x) < p.w / 2 - 1 && Math.abs(z - p.z) < p.d / 2 - 1) {
            traversees.push(`${porte.cle} traverse ${p.id}`);
          }
        }
      }
    }
  }
  check('aucun chemin ne traverse une salle', [...new Set(traversees)], []);

  // L'empreinte meublée sur le vrai contenu : l'allée redevient une allée
  // (un chemin étroit, pas le carré de 64 m de son terrain)
  const dossierOeuvres = join(racine, 'content', 'works');
  const positions = {};
  for (const r of rooms) {
    positions[r.id] = (r.works ?? []).map((wid) => {
      try {
        const w = JSON.parse(readFileSync(join(dossierOeuvres, `${wid}.json`), 'utf8'));
        const p = w.position ?? [0, 0, 0];
        return [Number(p[0]) || 0, Number(p[2]) || 0];
      } catch { return null; }
    }).filter(Boolean);
  }
  const plan2 = planGalerie(rooms, 'entree', { oeuvres: positions });
  const allee = plan2.pieces.find((p) => p.id === 'allee');
  vrai('l\'allée meublée est une allée, pas un terrain',
    allee && allee.w <= 20 && allee.d <= 32 && allee.d > allee.w,
    JSON.stringify(allee));
  const archives2 = plan2.pieces.find((p) => p.id === 'archives');
  check('une pièce à coque garde sa coque',
    { w: archives2?.w, d: archives2?.d }, { w: 26, d: 20 });
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

  // une grappe de feuilles s'accroche en anneau à son moyeu, sans se toucher
  const grappe = planGalerie([
    { id: 'x', title: 'X', portals: [{ to: 'hub', position: [0, 0, 10], rotation: [0, 180, 0] }] },
    { id: 'hub', title: 'Hub', portals: [
      { to: 'x', position: [0, 0, -10], rotation: [0, 0, 0] },
      { to: 'f1', position: [0, 0, 0] },
      { to: 'f2', position: [0, 0, 0] },
      { to: 'f3', position: [0, 0, 0] }] },
    { id: 'f1', title: 'F 1', portals: [{ to: 'hub', position: [0, 0, 0] }] },
    { id: 'f2', title: 'F 2', portals: [{ to: 'hub', position: [0, 0, 0] }] },
    { id: 'f3', title: 'F 3', portals: [{ to: 'hub', position: [0, 0, 0] }] }
  ], 'x');
  const hub = grappe.pieces.find((p) => p.id === 'hub');
  const fs = grappe.pieces.filter((p) => /^f\d$/.test(p.id));
  vrai('les trois feuilles orbitent leur moyeu',
    fs.every((f) => Math.hypot(f.x - hub.x, f.z - hub.z) < 60),
    JSON.stringify(fs));
  vrai('aucune feuille n\'en recouvre une autre',
    fs.every((a) => fs.every((b) => a === b
      || Math.abs(a.x - b.x) >= (a.w + b.w) / 2 - 0.01
      || Math.abs(a.z - b.z) >= (a.d + b.d) / 2 - 0.01)),
    JSON.stringify(fs));
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
