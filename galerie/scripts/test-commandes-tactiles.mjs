/**
 * LES COMMANDES DU POUCE — ce que la barre du bas doit tenir.
 *
 *   1. le bouton course existe, il est étiqueté dans les deux langues, et
 *      il ne s'offre qu'au doigt (`(pointer: coarse)`) — à côté d'un
 *      clavier qui a Maj, il n'aurait aucun sens ;
 *   2. maintenu, il vaut EXACTEMENT Maj : la même expression, le même
 *      facteur — sans quoi les deux entrées divergeraient en silence ;
 *   3. il se relâche à la perte du doigt ET à la perte de focus, sinon on
 *      revient d'un appel téléphonique en courant sans le savoir ;
 *   4. il ne se range PAS dans l'axe des pastilles crédits/pourboire (qui
 *      vivent à `right: 1rem`) — mesuré, il les recouvrait de 32 × 35 px ;
 *   5. la leçon d'ordre de source : `style.css` contient DEUX blocs
 *      `@media (max-width: 640px)`. À spécificité égale c'est l'ordre qui
 *      tranche, donc une surcharge de `#derive-barre` doit être écrite
 *      APRÈS la règle qu'elle corrige. Écrite avant, elle ne s'applique
 *      jamais — et le chevauchement avec le joystick reste entier.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const ici = dirname(fileURLToPath(import.meta.url));
const lire = (...p) => readFileSync(join(ici, '..', ...p), 'utf8');

const css = lire('engine', 'src', 'style.css');
const controles = lire('engine', 'src', 'controls', 'Controls.js');
const html = lire('index.html');
const i18n = lire('engine', 'src', 'core', 'i18n.js');

titre('le bouton course : présent, étiqueté, tactile seulement');
test('le bouton est dans la page, à côté du joystick', () => {
  assert.ok(/id="sprint"/.test(html), '#sprint absent de index.html');
});
test('il porte une étiquette accessible traduite', () => {
  assert.ok(html.includes('aria-label:sprint.label'),
    'le bouton doit tirer son aria-label de l\'i18n');
  const n = i18n.split("'sprint.label':").length - 1;
  assert.equal(n, 2, `sprint.label : ${n} définition(s), 2 attendues (fr + en)`);
});
test('il ne se montre que sur un pointeur grossier', () => {
  assert.ok(/pointer:\s*coarse/.test(controles),
    'sans ce test, le bouton apparaîtrait à côté d\'un clavier qui a Maj');
});

titre('maintenu, il vaut Maj — la même course, pas une seconde');
test('une seule expression décide du facteur, et elle lit les deux entrées', () => {
  const m = controles.match(/const boost =([\s\S]{0,180}?);/);
  assert.ok(m, 'aucune expression `const boost = …` trouvée');
  const expr = m[1];
  assert.ok(expr.includes('ShiftLeft') && expr.includes('ShiftRight'),
    'le clavier doit rester dans la même expression');
  assert.ok(expr.includes('_sprintTactile'),
    'le bouton doit rester dans la même expression');
  assert.ok(/2\.2\s*:\s*1/.test(expr), 'le facteur mesuré est ×2,2');
});
test('un seul facteur dans tout le module (pas de valeur jumelle)', () => {
  const n = (controles.match(/2\.2\s*:\s*1/g) ?? []).length;
  assert.equal(n, 1, `${n} facteurs de course : deux vérités divergeraient`);
});

titre('il se relâche toujours');
test('perte du doigt (up, cancel) et perte de focus', () => {
  for (const ev of ['pointerup', 'pointercancel', 'blur']) {
    assert.ok(controles.includes(ev), `aucun relâchement sur ${ev}`);
  }
});
test('le glissement de page ne coupe pas la course', () => {
  assert.ok(/#sprint\s*\{[^}]*touch-action:\s*none/s.test(css),
    'sans touch-action: none, le premier pixel de glissement interrompt tout');
});

titre('la barre du bas : personne ne marche sur personne');
test('le bouton course s\'écarte de la colonne crédits / pourboire', () => {
  const bloc = css.match(/#sprint\s*\{([^}]*)\}/s);
  assert.ok(bloc, 'règle #sprint introuvable');
  const droite = bloc[1].match(/right:\s*calc\(([\d.]+)rem/);
  assert.ok(droite, '#sprint doit poser son bord droit en calc(...rem + safe-area)');
  assert.ok(+droite[1] >= 4,
    `right: ${droite[1]}rem — les pastilles occupent right 1rem sur 2,4rem de large,`
    + ' un bouton plus près les recouvre (mesuré 32 × 35 px)');
});
test('les surcharges petit écran de la barre de dérive sont écrites APRÈS sa définition', () => {
  const def = css.indexOf('#derive-barre {');
  assert.ok(def >= 0, 'définition de #derive-barre introuvable');
  const surcharge = css.indexOf('#derive-barre {', def + 1);
  assert.ok(surcharge > def,
    'aucune surcharge de #derive-barre après sa définition — à spécificité'
    + ' égale, une règle écrite plus haut ne s\'applique jamais');
  // …et cette surcharge doit bien vivre dans un bloc petit écran
  const avant = css.slice(0, surcharge);
  const media = avant.lastIndexOf('@media (max-width: 640px)');
  assert.ok(media > def, 'la surcharge doit être dans un @media petit écran postérieur');
});

console.log(`\n${ok} ✓  ${ko} ✗`);
process.exit(ko ? 1 : 0);
