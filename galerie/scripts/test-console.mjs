/**
 * Test de la table de mixage : Console6, porté d'Airwindows.
 *
 * Deux propriétés font toute la valeur du procédé, et deux seulement :
 *   1. sur UNE tranche, décoder ce qu'on a encodé rend EXACTEMENT le signal
 *      de départ — sans quoi la console serait un effet, pas une table ;
 *   2. à PLUSIEURS, la somme se serre au lieu de s'empiler, sans jamais
 *      sortir de l'unité.
 * Le reste — monotonie, symétrie, silence — est ce qui garantit qu'aucun
 * artefact ne se glisse dans le fil.
 *
 * Lancer avec : npm test
 */
import { encoder, decoder, normaliserConsole, CONSOLE_DEFAUTS }
  from '../engine/src/core/Console.js';

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

console.log('\nune tranche seule : la console est transparente');
{
  let pire = 0;
  for (let i = -1000; i <= 1000; i++) {
    const x = i / 1000;
    pire = Math.max(pire, Math.abs(decoder(encoder(x)) - x));
  }
  // Le décodage est la réciproque EXACTE de l'encodage : ce qui reste est
  // l'arrondi de la virgule flottante, pas un écart de conception.
  vrai('décoder ce qu’on encode rend le signal intact', pire < 1e-9,
    `écart maximal ${pire.toExponential(2)}`);

  check('le zéro reste le zéro', [encoder(0), decoder(0)], [0, 0]);
  check('l’unité reste l’unité', [encoder(1), decoder(1)], [1, 1]);
  check('…et son opposé aussi', [encoder(-1), decoder(-1)], [-1, -1]);
}

console.log('\nsymétrie : la console ne déplace pas l’image stéréo');
{
  let pire = 0;
  for (let i = 1; i <= 1000; i++) {
    const x = i / 1000;
    pire = Math.max(pire, Math.abs(encoder(-x) + encoder(x)));
    pire = Math.max(pire, Math.abs(decoder(-x) + decoder(x)));
  }
  vrai('encodage et décodage sont impairs', pire < 1e-12,
    `asymétrie maximale ${pire.toExponential(2)}`);
}

console.log('\nrien ne sort de l’unité');
{
  let dehors = 0;
  for (const x of [-9, -4, -1.5, -1, 0, 1, 1.5, 4, 9, 1e6]) {
    if (Math.abs(encoder(x)) > 1) dehors++;
    if (Math.abs(decoder(x)) > 1) dehors++;
  }
  check('même très au-delà, tout reste borné à ±1', dehors, 0);
  // Un NaN dans le fil audio rend TOUTE la session muette : on vérifie que
  // la formule n'en fabrique pas là où sqrt pourrait déraper.
  let nan = 0;
  for (let i = -2000; i <= 2000; i++) {
    if (!Number.isFinite(encoder(i / 1000))) nan++;
    if (!Number.isFinite(decoder(i / 1000))) nan++;
  }
  check('aucune valeur non finie', nan, 0);
}

console.log('\nmonotonie : pas de repli, pas de distorsion parasite');
{
  let fautes = 0;
  let precedentE = encoder(-1);
  let precedentD = decoder(-1);
  for (let i = -999; i <= 1000; i++) {
    const e = encoder(i / 1000);
    const d = decoder(i / 1000);
    if (e < precedentE - 1e-12) fautes++;
    if (d < precedentD - 1e-12) fautes++;
    precedentE = e; precedentD = d;
  }
  check('les deux courbes montent toujours', fautes, 0);
}

/* ------------------------------------------------- la somme d'une table --- */

/**
 * Ce que donne la table : atténuation d'attaque, encodage, somme, décodage,
 * puis restitution de l'attaque. C'est exactement le chemin du graphe audio.
 */
const table = (amplitudes, attaque = CONSOLE_DEFAUTS.attaque) =>
  decoder(amplitudes.reduce((total, a) => total + encoder(a * attaque), 0)) / attaque;
const addition = (amplitudes) => amplitudes.reduce((t, a) => t + a, 0);

console.log('\nà plusieurs : ce que la table fait vraiment');
{
  // 1) la somme s'OUVRE : quelques sources moyennes ressortent un peu plus
  //    fort que leur addition. C'est le « ça respire » de Console.
  const chargee = new Array(6).fill(0.15);
  vrai('quelques sources moyennes : la somme s’ouvre',
    table(chargee) > addition(chargee),
    `table ${table(chargee).toFixed(2)} contre addition ${addition(chargee).toFixed(2)}`);
  vrai('…mais raisonnablement (moins de +6 dB)',
    table(chargee) < addition(chargee) * 2,
    `×${(table(chargee) / addition(chargee)).toFixed(2)}`);

  // 2) la somme est BORNÉE : c'est là, et seulement là, que les sources se
  //    font de la place.
  const quinze = new Array(15).fill(0.2);
  vrai('quinze sources : la table borne la somme',
    table(quinze) <= 1.0001 + 1e-9,
    `table ${table(quinze).toFixed(2)} contre addition ${addition(quinze).toFixed(2)}`);
  vrai('…là où l’addition, elle, déborde franchement', addition(quinze) > 2.5,
    addition(quinze).toFixed(2));

  // 3) tout bas — une galerie où l'on est loin de tout — la table ne doit
  //    RIEN changer d'audible.
  const discret = [0.02, 0.03, 0.01];
  vrai('tout bas, la table se confond avec l’addition',
    Math.abs(table(discret) - addition(discret)) < 0.01,
    `${table(discret).toFixed(4)} contre ${addition(discret).toFixed(4)}`);
}

console.log('\nl’attaque : d’une addition pure à la table de Chris');
{
  const sources = new Array(8).fill(0.25);
  const douce = table(sources, 0.05);
  const forte = table(sources, 1);
  vrai('attaque minimale : la table s’efface (à 5 % près)',
    Math.abs(douce - addition(sources)) / addition(sources) < 0.05,
    `${douce.toFixed(3)} contre ${addition(sources).toFixed(3)}`);
  vrai('attaque maximale : la somme est ramenée au plafond',
    forte <= 1.0001, forte.toFixed(3));

  // Ce qui ne doit JAMAIS changer avec l'attaque : une source seule.
  let pire = 0;
  for (const attaque of [0.05, 0.25, 0.5, 0.75, 1]) {
    for (const x of [0.05, 0.2, 0.5, 0.9]) {
      pire = Math.max(pire, Math.abs(table([x], attaque) - x));
    }
  }
  vrai('une source seule reste transparente à toute attaque', pire < 1e-9,
    `écart maximal ${pire.toExponential(2)}`);
}

console.log('\nréglages');
{
  check('les défauts', normaliserConsole(undefined), CONSOLE_DEFAUTS);
  // Éteinte d'office : c'est une couleur, elle se choisit à l'oreille.
  check('la table est livrée éteinte', CONSOLE_DEFAUTS.actif, false);
  check('on l’allume explicitement', normaliserConsole({ actif: true }).actif, true);
  check('une attaque hors bornes est ramenée',
    [normaliserConsole({ attaque: 9 }).attaque, normaliserConsole({ attaque: 0 }).attaque],
    [1, 0.05]);
  check('une attaque illisible retombe sur le défaut',
    normaliserConsole({ attaque: 'fort' }).attaque, CONSOLE_DEFAUTS.attaque);
  check('un JSON douteux ne l’allume pas par accident',
    normaliserConsole({ actif: 0 }).actif, false);
}

console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed ? 1 : 0);
