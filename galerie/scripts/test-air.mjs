/**
 * Test de l'air : la distance dans le timbre, et le rapport direct/réverbe.
 *
 * Deux lois de physique, pas du DSP emprunté — mais des lois qui décident de
 * ce qu'on entend, donc à éprouver comme le reste. Ce qui compte : qu'elles
 * soient MONOTONES (plus loin ne doit jamais sonner plus proche), bornées
 * des deux côtés, et neutres quand on ne demande rien.
 *
 * Lancer avec : npm test
 */
import { coupureAir, compensationReverb, normaliserAir, AIR_DEFAUTS, PLANCHER }
  from '../engine/src/core/air-reglages.js';

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
function vrai(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

console.log('\nla coupure suit la distance');
{
  const d = AIR_DEFAUTS;
  vrai('tout près, l’air ne fait rien', coupureAir(0, d) >= 19999,
    `${Math.round(coupureAir(0, d))} Hz`);
  // la loi : à `distance` mètres, l'aigu tombe à la moitié de 20 kHz
  vrai(`à ${d.distance} m, la coupure est à ~10 kHz`,
    Math.abs(coupureAir(d.distance, d) - 10000) < 200,
    `${Math.round(coupureAir(d.distance, d))} Hz`);
  vrai(`à ${d.distance * 3} m, à ~5 kHz`,
    Math.abs(coupureAir(d.distance * 3, d) - 5000) < 200,
    `${Math.round(coupureAir(d.distance * 3, d))} Hz`);

  // MONOTONE : c'est la propriété qui fait qu'on entend une distance et non
  // un artefact. Un seul repli et s'éloigner sonnerait « plus proche ».
  let fautes = 0;
  let precedent = coupureAir(0, d);
  for (let m = 0.5; m <= 200; m += 0.5) {
    const f = coupureAir(m, d);
    if (f > precedent + 1e-9) fautes++;
    precedent = f;
  }
  check('elle ne remonte jamais quand on s’éloigne', fautes, 0);

  vrai('elle ne descend pas sous le plancher',
    coupureAir(5000, d) >= PLANCHER, `${Math.round(coupureAir(5000, d))} Hz`);
  vrai('…et jamais au-dessus du plafond', coupureAir(0, d) <= 20000);
}

console.log('\non peut la doser, et l’éteindre');
{
  const loin = 36;
  const pleine = coupureAir(loin, { intensite: 1 });
  const demie = coupureAir(loin, { intensite: 0.5 });
  const nulle = coupureAir(loin, { intensite: 0 });
  vrai('à intensité nulle, aucun effet', nulle >= 19999, `${Math.round(nulle)} Hz`);
  vrai('à demi-intensité, entre les deux',
    demie > pleine && demie < nulle,
    `${Math.round(pleine)} < ${Math.round(demie)} < ${Math.round(nulle)}`);
  // le dosage se fait en OCTAVES : à mi-chemin de 20 k vers 5 k, l'oreille
  // attend 10 k (une octave), pas 12,5 k (la moyenne arithmétique)
  vrai('…et le dosage est musical, pas arithmétique',
    Math.abs(demie - Math.sqrt(pleine * 20000)) < 50,
    `${Math.round(demie)} contre ${Math.round(Math.sqrt(pleine * 20000))}`);
  vrai('coupé, l’air ne fait rien non plus',
    coupureAir(loin, { actif: false }) >= 19999);
}

console.log('\nle rapport direct/réverbe suit la distance');
{
  const d = AIR_DEFAUTS;
  check('tout près, rien à rattraper', compensationReverb(1, d), 1);
  vrai('plus loin, le départ remonte', compensationReverb(0.25, d) > 1,
    `×${compensationReverb(0.25, d).toFixed(2)}`);
  vrai('…et plus on est loin, plus il remonte',
    compensationReverb(0.1, d) > compensationReverb(0.5, d),
    `${compensationReverb(0.1, d).toFixed(2)} contre ${compensationReverb(0.5, d).toFixed(2)}`);

  // BORNÉ : sans cela, une œuvre presque inaudible remplirait la pièce de sa
  // seule queue, et une atténuation tendant vers zéro ferait diverger.
  vrai('la compensation est bornée', compensationReverb(1e-9, d) <= 8,
    `×${compensationReverb(1e-9, d)}`);
  check('une atténuation impossible ne casse rien',
    [compensationReverb(0, d), compensationReverb(NaN, d),
      compensationReverb(-1, d)], [1, 1, 1]);

  check('à zéro, l’ancien comportement revient : rapport figé',
    compensationReverb(0.1, { reverbDistance: 0 }), 1);
  vrai('à moitié, la compensation est partielle',
    compensationReverb(0.1, { reverbDistance: 0.5 })
      < compensationReverb(0.1, { reverbDistance: 1 }),
    `${compensationReverb(0.1, { reverbDistance: 0.5 }).toFixed(2)}`);
}

console.log('\nréglages');
{
  check('les défauts se relisent', normaliserAir(undefined), AIR_DEFAUTS);
  check('les valeurs sont bornées',
    [normaliserAir({ distance: 0 }).distance, normaliserAir({ distance: 9999 }).distance,
      normaliserAir({ intensite: 5 }).intensite,
      normaliserAir({ reverbDistance: -2 }).reverbDistance],
    [1, 200, 1, 0]);
  check('une valeur illisible retombe sur le défaut',
    normaliserAir({ distance: 'loin' }).distance, AIR_DEFAUTS.distance);
  check('on l’éteint explicitement', normaliserAir({ actif: false }).actif, false);
}

console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed ? 1 : 0);
