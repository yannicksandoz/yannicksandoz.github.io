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
// DEPUIS `console-reglages.js`, PAS DEPUIS `Console.js`. Le second charge la
// source du worklet de la sept en `?raw` — une affaire de bundler, que le
// nœud ne sait pas résoudre : l'import cassait la chaîne entière dès que la
// sept est arrivée. C'est justement pourquoi tout ce qui décide de quelque
// chose vit dans un `*-reglages.js` séparé.
import { encoder, decoder, normaliserConsole, CONSOLE_DEFAUTS }
  from '../engine/src/core/console-reglages.js';

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

/* LA CHAÎNE DE TESTS DOIT POUVOIR TOURNER SANS EMPAQUETEUR.
 *
 * Ce contrôle-ci existe parce que la panne a déjà eu lieu : `Console.js` a
 * gagné un `import … from './console7-worklet.js?raw'` en accueillant la
 * sept, et comme ce test-là importait `Console.js`, la chaîne ENTIÈRE s'est
 * arrêtée net au neuvième script sur vingt-deux — sans une seule croix, juste
 * une SyntaxError du nœud, qu'on ne voit pas si l'on ne regarde que le
 * décompte final. Treize suites ne tournaient plus.
 *
 * La règle est donc vérifiée plutôt que rappelée : un test n'importe que des
 * `*-reglages.js`. Ce qui décide de quelque chose vit là ; ce qui a besoin
 * du navigateur reste au navigateur. */
console.log('\nla chaîne tourne au nœud, sans empaqueteur');
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ici = dirname(fileURLToPath(import.meta.url));
  const coeur = join(ici, '..', 'engine', 'src', 'core');
  // Deux façons de dépendre de l'empaqueteur, et le nœud butе sur les deux :
  // la source d'un worklet chargée en TEXTE (`?raw`), et un FICHIER importé
  // pour son URL (la police des cartels, `.woff`). La seconde est arrivée
  // après la première ; le contrôle les cherche donc par la forme de
  // l'import et non par une liste de suffixes qu'il faudrait tenir à jour.
  const EMPAQUETEUR = /^import .*(\?raw'|\.(woff2?|ttf|otf|png|jpe?g|svg|glb|hdr|mp3|wav)')/m;
  const teintes = new Set(readdirSync(coeur)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => EMPAQUETEUR.test(readFileSync(join(coeur, f), 'utf8'))));
  vrai('des modules dépendent bien de l’empaqueteur', teintes.size > 0);
  const fautifs = [];
  for (const f of readdirSync(ici).filter((n) => /^test-.*\.mjs$/.test(n))) {
    const src = readFileSync(join(ici, f), 'utf8');
    for (const m of src.matchAll(/['"]\.\.\/engine\/src\/core\/([\w-]+\.js)['"]/g)) {
      if (teintes.has(m[1])) fautifs.push(`${f} → ${m[1]}`);
    }
  }
  vrai('aucun test n’importe un module que le nœud ne sait pas résoudre',
    fautifs.length === 0, fautifs.join(', '));
}

console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed ? 1 : 0);
