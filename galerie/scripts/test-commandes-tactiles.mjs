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
const utils = lire('engine', 'src', 'core', 'utils.js');
const ui = lire('engine', 'src', 'ui', 'UI.js');

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
test('il ne se montre que sur un pointeur grossier — et LA décision est unique', () => {
  assert.ok(/pointer:\s*coarse/.test(utils),
    'le test du pointeur vit dans utils.pointeurGrossier()');
  assert.ok(!/pointer:\s*coarse/.test(controles) && !/pointer:\s*coarse/.test(ui),
    'personne d\'autre ne re-teste matchMedia : trois copies finissaient'
    + ' par diverger');
  for (const src of [controles, ui]) {
    assert.ok(src.includes('pointeurGrossier('), 'chacun passe par le prédicat partagé');
  }
});
test('l\'aide d\'accueil tactile mentionne la course', () => {
  for (const cle of ['hint.touch', 'enter.tip.touch']) {
    for (const morceau of i18n.split(`'${cle}':`).slice(1)) {
      const ligne = morceau.slice(0, 200);
      assert.ok(/courir|run/i.test(ligne),
        `${cle} ne dit rien de la course — seul le chevron la laisse deviner`);
    }
  }
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
test('un second contact ne vole ni la course ni le manche', () => {
  // sprint : `doigt` déjà pris → le pointerdown suivant est ignoré, sinon
  // le relâchement du second contact coupait la course sous le pouce
  assert.ok(controles.includes('if (doigt !== null) return;'),
    'garde multi-pointeur absente du bouton course');
  assert.ok(controles.includes('if (activeId !== null) return;'),
    'garde multi-pointeur absente du joystick');
});
test('le clavier court aussi : maintenir Espace ou Entrée', () => {
  // le bouton s'annonce au lecteur d'écran (aria-label) : il doit répondre
  // à autre chose qu'un pointeur tenu
  assert.ok(controles.includes("addEventListener('keydown'")
    && controles.includes("addEventListener('keyup'"),
    'aucun maintien clavier sur le bouton course');
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
test('petit écran : crédits et pourboire quittent le coin… pour le menu', () => {
  // les pastilles disparaissent — mais seulement parce que le menu offre
  // les deux mêmes chemins : « Crédits & sources » et « Terminer la visite »
  const menu = lire('engine', 'src', 'ui', 'VisitMenu.js');
  const masque = css.indexOf('#credits-corner, #tipjar-corner { display: none; }');
  assert.ok(masque >= 0, 'les pastilles de coin doivent se cacher sur petit écran');
  assert.ok(masque > css.indexOf('#credits-corner {')
    && masque > css.indexOf('#tipjar-corner {'),
    'le masquage doit suivre les définitions (ordre de source)');
  assert.ok(menu.includes('vm-credits'), 'aucune entrée Crédits dans le menu');
  const n = i18n.split("'menu.credits':").length - 1;
  assert.equal(n, 2, `menu.credits : ${n} définition(s), 2 attendues (fr + en)`);
});
test('petit écran : la course reprend le coin laissé libre', () => {
  const coin = css.indexOf('#sprint { right: calc(1.1rem');
  assert.ok(coin >= 0, 'pas de surcharge de coin pour #sprint');
  assert.ok(coin > css.indexOf('#sprint {'),
    'la surcharge doit suivre la définition (ordre de source)');
});
test('le pictogramme est une silhouette qui court, pas un chevron', () => {
  const bouton = html.slice(html.indexOf('id="sprint"'), html.indexOf('id="sprint"') + 800);
  assert.ok(bouton.includes('<circle'), 'la tête du coureur manque');
  assert.ok(!/M4 6l6 6/.test(bouton), 'le double chevron illisible est revenu');
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
