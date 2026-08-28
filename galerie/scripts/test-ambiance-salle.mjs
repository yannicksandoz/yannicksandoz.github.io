/**
 * LA SONDE D'AMBIANCE, ÉPROUVÉE.
 *
 * Une projection sur harmoniques sphériques se trompe silencieusement :
 * un facteur de normalisation oublié ne fait pas planter, il assombrit ou
 * surexpose, et l'on met des semaines à s'en apercevoir. On la confronte
 * donc à des configurations dont on CONNAÎT la réponse — une lampe au
 * zénith doit donner une dominante verticale, un halo isotrope ne doit
 * donner aucune direction — et à la fonction qu'elle est censée résumer.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { majAmbiance, orienterAmbiance, oublierAmbiance, uniformesAmbiance,
  ALBEDO_REBOND } from '../engine/src/core/ambiance-salle.js';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

/** Une salle jouet : une coque déclarée et des lampes qu'on pose. */
function salle(lampes = [], shell = { width: 10, depth: 10, height: 4 }) {
  const group = new THREE.Group();
  for (const l of lampes) group.add(l);
  return { group, config: { shell } };
}
const ponctuelle = (x, y, z, couleur = 0xffffff, i = 10) => {
  const l = new THREE.PointLight(new THREE.Color(couleur), i);
  l.position.set(x, y, z);
  return l;
};
/** La caméra identité : espace vue = espace monde. */
const camIdentite = () => {
  const c = new THREE.PerspectiveCamera();
  c.updateMatrixWorld(true);
  return c;
};
const lu = () => {
  const u = uniformesAmbiance();
  return {
    c0: u.uAmbianceC0.value, cx: u.uAmbianceCx.value,
    cy: u.uAmbianceCy.value, cz: u.uAmbianceCz.value
  };
};
/** E(n) reconstruit depuis les uniformes, comme le fait le shader. */
const E = (n) => {
  const { c0, cx, cy, cz } = lu();
  return Math.max(0, c0.r + cx.r * n.x + cy.r * n.y + cz.r * n.z);
};

titre('ce que la sonde sait de la direction');
test('une lampe au zénith donne une dominante verticale', () => {
  const s = salle([ponctuelle(0, 6, 0)]);
  const r = majAmbiance(s, []);
  orienterAmbiance(camIdentite());
  assert.ok(r.lampes === 1, 'la lampe doit être vue');
  // le haut reçoit franchement plus que le bas
  const haut = E(new THREE.Vector3(0, 1, 0));
  const bas = E(new THREE.Vector3(0, -1, 0));
  assert.ok(haut > bas * 3, `haut ${haut.toFixed(4)} contre bas ${bas.toFixed(4)}`);
  assert.ok(Math.abs(r.dominante[1] - 1) < 0.05,
    `dominante ${JSON.stringify(r.dominante)} au lieu de la verticale`);
});
test('une lampe de côté donne une dominante latérale', () => {
  const s = salle([ponctuelle(6, 1.6, 0)]);
  const r = majAmbiance(s, []);
  orienterAmbiance(camIdentite());
  assert.ok(E(new THREE.Vector3(1, 0, 0)) > E(new THREE.Vector3(-1, 0, 0)) * 2);
  assert.ok(Math.abs(r.dominante[0]) > 0.8, JSON.stringify(r.dominante));
});
test('un halo isotrope est bien plus neutre qu’une lampe unique', () => {
  // Six lampes aux six faces contre une seule au zénith. On compare
  // l'ANISOTROPIE |c|/c₀ des deux : le halo doit être franchement plus
  // neutre. Un absolu serait faux — la sonde échantillonne en cinq points,
  // et hors du centre six lampes ne sont plus symétriques ; le résidu est
  // une conséquence du maillage, pas un défaut.
  //
  // C'est ce test qui a attrapé `Vector3.transformDirection`, laquelle
  // NORMALISE : l'ordre 1 remontait à 0,99 au lieu de 0,03.
  const anisotropie = () => {
    const { c0, cx, cy, cz } = lu();
    return Math.hypot(cx.r, cy.r, cz.r) / Math.max(c0.r, 1e-9);
  };
  const d = 6, lampes = [];
  for (const [x, y, z] of [[d, 0, 0], [-d, 0, 0], [0, d, 0], [0, -d, 0], [0, 0, d], [0, 0, -d]]) {
    lampes.push(ponctuelle(x, y, z));
  }
  majAmbiance(salle(lampes), []);
  orienterAmbiance(camIdentite());
  const halo = anisotropie();
  assert.ok(lu().c0.r > 0, 'un halo éclaire');

  majAmbiance(salle([ponctuelle(0, d, 0)]), []);
  orienterAmbiance(camIdentite());
  const seule = anisotropie();
  assert.ok(halo < seule / 5,
    `halo ${halo.toFixed(3)} contre lampe seule ${seule.toFixed(3)}`);
});

titre('ce que la sonde sait de la couleur');
test('une lampe rouge ne verdit pas la salle', () => {
  majAmbiance(salle([ponctuelle(0, 6, 0, 0xff0000)]), []);
  orienterAmbiance(camIdentite());
  const { c0 } = lu();
  assert.ok(c0.r > 0.0001, 'le rouge passe');
  assert.ok(c0.g < c0.r * 0.02 && c0.b < c0.r * 0.02,
    `fuite de couleur : ${c0.r.toFixed(5)} / ${c0.g.toFixed(5)} / ${c0.b.toFixed(5)}`);
});

titre('le rebond est un rebond');
test('l’albédo reste celui d’une seule réflexion', () => {
  // la sonde ajoute ce qu'une salle RENVOIE, pas ce qu'elle reçoit. Au-delà
  // d'un demi, on éclairerait deux fois — et personne ne le verrait venir.
  assert.ok(ALBEDO_REBOND > 0 && ALBEDO_REBOND <= 0.5,
    `albédo ${ALBEDO_REBOND} : ce n'est plus un rebond`);
});
test('doubler les lampes double la sonde — la loi reste linéaire', () => {
  majAmbiance(salle([ponctuelle(0, 6, 0, 0xffffff, 10)]), []);
  orienterAmbiance(camIdentite());
  const simple = lu().c0.r;
  majAmbiance(salle([ponctuelle(0, 6, 0, 0xffffff, 20)]), []);
  orienterAmbiance(camIdentite());
  const double = lu().c0.r;
  assert.ok(Math.abs(double / simple - 2) < 1e-6,
    `rapport ${(double / simple).toFixed(4)} au lieu de 2`);
});

titre('ce que le budget éteint, la sonde le reprend');
test('une lampe éteinte par le budget compte pour son éclairement ENTIER', () => {
  // c'est le correctif : `budgetLampes` éteint la plupart des cônes sur
  // téléphone, et la sonde les IGNORAIT — cinquante-trois des cinquante-six
  // cônes du labo étaient purement supprimés. Une lampe que le shader ne
  // verra jamais doit peser 1, pas ALBEDO_REBOND.
  const vue = ponctuelle(0, 6, 0);
  majAmbiance(salle([vue]), []);
  orienterAmbiance(camIdentite());
  const avec = lu().c0.r;

  const eteinte = ponctuelle(0, 6, 0);
  eteinte.visible = false;          // exactement ce que fait le budget
  majAmbiance(salle([eteinte]), []);
  orienterAmbiance(camIdentite());
  const sans = lu().c0.r;

  assert.ok(sans > 0, 'une lampe éteinte par le budget ne doit PAS disparaître');
  assert.ok(Math.abs(sans / avec - 1 / ALBEDO_REBOND) < 1e-6,
    `rapport ${(sans / avec).toFixed(3)} au lieu de ${(1 / ALBEDO_REBOND).toFixed(3)}`);
});
test('une lampe d’une BRANCHE masquée reste éteinte', () => {
  // la distinction qui fait tout : le budget masque la lampe elle-même,
  // le contenu masque un ancêtre. La seconde n'éclaire vraiment rien.
  const l = ponctuelle(0, 6, 0);
  const branche = new THREE.Group();
  branche.visible = false;
  branche.add(l);
  const g = new THREE.Group();
  g.add(branche);
  const r = majAmbiance({ group: g, config: { shell: { width: 10, depth: 10, height: 4 } } }, []);
  orienterAmbiance(camIdentite());
  assert.equal(r.lampes, 0, 'un décor masqué n’éclaire pas');
  assert.equal(lu().c0.r, 0);
});
test('la somme reste continue au passage de la frontière', () => {
  // une lampe qui bascule passe de « direct par pixel + rebond » à « sonde
  // entière » : les deux totaux doivent rester du même ordre, sinon on
  // verrait un saut de clarté en marchant.
  const vue = ponctuelle(0, 6, 0);
  majAmbiance(salle([vue]), []);
  orienterAmbiance(camIdentite());
  const rebond = lu().c0.r;
  const eteinte = ponctuelle(0, 6, 0);
  eteinte.visible = false;
  majAmbiance(salle([eteinte]), []);
  orienterAmbiance(camIdentite());
  const entiere = lu().c0.r;
  // la sonde seule vaut 4× le rebond seul : c'est l'énergie que le shader
  // apportait en direct, rendue à la sonde. Jamais davantage.
  assert.ok(entiere > rebond && entiere <= rebond / ALBEDO_REBOND + 1e-9,
    `${entiere.toFixed(5)} contre ${rebond.toFixed(5)}`);
});

titre('les segments comptent autant que les lampes');
test('une ligne de lumière nourrit la sonde', () => {
  const ligne = {
    a: new THREE.Vector3(-5, 5, -5), b: new THREE.Vector3(5, 5, -5),
    face: new THREE.Vector3(0, -1, 0), couleur: new THREE.Color(1, 1, 1)
  };
  majAmbiance(salle([]), [ligne]);
  orienterAmbiance(camIdentite());
  assert.ok(lu().c0.r > 0, 'une salle sans lampe mais avec corniche s’éclaire');
});
test('une corniche qui regarde ailleurs ne compte pas', () => {
  // la face du segment : tournée vers le haut, elle n'éclaire pas le sol
  const vers = (fy) => ({
    a: new THREE.Vector3(-5, 5, -5), b: new THREE.Vector3(5, 5, -5),
    face: new THREE.Vector3(0, fy, 0), couleur: new THREE.Color(1, 1, 1)
  });
  majAmbiance(salle([]), [vers(-1)]);
  orienterAmbiance(camIdentite());
  const versLeBas = lu().c0.r;
  majAmbiance(salle([]), [vers(1)]);
  orienterAmbiance(camIdentite());
  const versLeHaut = lu().c0.r;
  assert.ok(versLeBas > versLeHaut * 2,
    `bas ${versLeBas.toFixed(5)} contre haut ${versLeHaut.toFixed(5)}`);
});

titre('le repère');
test('l’ordre 1 tourne avec la caméra, l’ordre 0 non', () => {
  majAmbiance(salle([ponctuelle(0, 6, 0)]), []);
  orienterAmbiance(camIdentite());
  const droite = { c0: lu().c0.r, cy: lu().cy.r };
  // une caméra couchée sur le flanc : la verticale du monde devient un axe
  // latéral de la vue, donc l'ordre 1 doit migrer de cy vers cx
  const cam = new THREE.PerspectiveCamera();
  cam.rotation.z = Math.PI / 2;
  cam.updateMatrixWorld(true);
  orienterAmbiance(cam);
  assert.ok(Math.abs(lu().c0.r - droite.c0) < 1e-9, 'l’ordre 0 est invariant');
  assert.ok(Math.abs(lu().cx.r) > Math.abs(droite.cy) * 0.9,
    'la verticale doit passer dans l’axe latéral de la vue');
});
test('oublier une salle remet tout à zéro', () => {
  majAmbiance(salle([ponctuelle(0, 6, 0)]), []);
  orienterAmbiance(camIdentite());
  assert.ok(lu().c0.r > 0);
  oublierAmbiance();
  orienterAmbiance(camIdentite());
  const { c0, cx, cy, cz } = lu();
  for (const c of [c0, cx, cy, cz]) {
    assert.ok(c.r === 0 && c.g === 0 && c.b === 0, 'un résidu de salle précédente');
  }
});
test('une salle sans groupe ne fait pas exploser le calcul', () => {
  assert.equal(majAmbiance(null, []), null);
  assert.equal(majAmbiance({}, []), null);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
if (ko) process.exitCode = 1;
