/**
 * LA TOOLBOX DE VISITE ET LE MENU REGROUPÉ — éprouvés au nœud.
 *
 *   1. la toolbox existe, montée dans les DEUX entrées 3D (accueil et lien
 *      profond), avec ses cinq gestes — et rien d'elle ne dépend de
 *      l'éditeur (elle part au build Visiteur) ;
 *   2. la capture d'écran rend UNE frame AVANT de lire le canevas — le
 *      tampon WebGL n'est pas conservé (preserveDrawingBuffer: false),
 *      lire sans peindre donne une image noire ;
 *   3. couper le son passe par le gain du bus maître (la visite continue,
 *      rien n'est suspendu) et l'état choisi avant le premier geste
 *      survit à la naissance du contexte ;
 *   4. la dérive publie son état (galerie:derive) — le bouton de la
 *      toolbox suit la réalité, pas le dernier clic ;
 *   5. le menu est rangé en trois groupes, ses réglages sont à plat, et
 *      « Vue liste (2D) » porte l'habit commun des entrées (le lien nu
 *      d'avant était invisible) ;
 *   6. chaque libellé de la toolbox existe dans les deux langues.
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
const src = (p) => readFileSync(join(ici, '..', 'engine', 'src', p), 'utf8');

const toolbox = src('ui/Toolbox.js');
const menu = src('ui/VisitMenu.js');
const main = src('main.js');
const audio = src('core/AudioEngine.js');
const derive = src('core/Derive.js');
const css = src('style.css');
const i18n = src('core/i18n.js');

titre('la toolbox : cinq gestes, montée aux deux entrées');
test('les cinq boutons existent', () => {
  for (const id of ['tb-fullscreen', 'tb-carte', 'tb-capture', 'tb-derive', 'tb-son']) {
    assert.ok(toolbox.includes(`id="${id}"`), `bouton ${id} absent`);
  }
});
test('rôle toolbar + aria-pressed sur les bascules', () => {
  assert.ok(toolbox.includes("setAttribute('role', 'toolbar')"));
  assert.ok(toolbox.includes('aria-pressed'));
});
test('plein écran conditionné à fullscreenEnabled (absent sur iPhone)', () => {
  assert.ok(toolbox.indexOf('fullscreenEnabled') < toolbox.indexOf('tb-fullscreen'));
});
test('montée dans les deux entrées 3D de main.js', () => {
  assert.ok(main.includes("import { mountToolbox } from './ui/Toolbox.js'"));
  assert.equal(main.split('mountToolbox(app)').length - 1, 2,
    'une entrée 3D sans toolbox (lien profond OU accueil)');
});
test('rien de l\'éditeur : imports limités à i18n, Carte, Derive', () => {
  const imports = [...toolbox.matchAll(/import\s*(?:\{[^}]*\}\s*from\s*)?\(?['"]([^'"]+)['"]/g)]
    .map((m) => m[1]);
  for (const i of imports) {
    assert.ok(['../core/i18n.js', './Carte.js', '../core/Derive.js'].includes(i),
      `import inattendu : ${i}`);
  }
});

titre('la capture : peindre d\'abord, lire ensuite');
test('composer.render() PRÉCÈDE toBlob dans _capturer', () => {
  const corps = toolbox.slice(toolbox.indexOf('_capturer()'));
  const rend = corps.indexOf('composer.render()');
  const lit = corps.indexOf('toBlob');
  assert.ok(rend > -1 && lit > -1 && rend < lit,
    'le tampon doit être frais au moment de la lecture');
});
test('le PNG reste sur la machine : ancre de téléchargement, pas de réseau', () => {
  assert.ok(toolbox.includes('a.download'));
  assert.ok(!toolbox.includes('fetch(') && !toolbox.includes('XMLHttpRequest'));
});

titre('couper le son : au gain du maître, sans rien suspendre');
test('couperLeSon écrit le gain du bus maître (rampe, pas de clic)', () => {
  const corps = audio.slice(audio.indexOf('couperLeSon('));
  assert.ok(corps.includes('setTargetAtTime'));
  assert.ok(!corps.slice(0, corps.indexOf('\n  }')).includes('suspend'),
    'couper n\'est pas suspendre : tout continue de jouer');
});
test('choisi avant le premier geste, l\'état survit à unlock()', () => {
  assert.ok(audio.includes('this.master.gain.value = this.sonCoupe ? 0 : 1'));
});

titre('l’interrupteur silencieux de l’iPhone');
test('la session audio est déclarée « playback » AVANT l’AudioContext', () => {
  // Sans cette déclaration, l'interrupteur latéral d'un iPhone coupe toute
  // la Web Audio : dans une galerie où le son EST l'œuvre, le visiteur
  // croirait la pièce muette. La catégorie est lue à la CRÉATION du
  // contexte — posée après, elle ne mord plus.
  const pose = audio.indexOf('jouerMalgreLeSilencieux()');
  const contexte = audio.indexOf('this.ctx = new AC()');
  assert.ok(pose > 0, 'la déclaration de session a disparu');
  assert.ok(contexte > 0);
  assert.ok(pose < contexte,
    'la catégorie doit être posée AVANT la création de l’AudioContext');
  assert.ok(audio.includes("session.type = 'playback'"),
    'seule « playback » passe l’interrupteur silencieux');
});
test('l’absence de l’API ne casse rien, et l’échec non plus', () => {
  // Firefox et Chrome n'ont pas navigator.audioSession : la fonction doit
  // rester muette. Et un navigateur qui expose l'objet sans accepter la
  // valeur ne doit surtout pas empêcher le son de démarrer.
  assert.ok(/navigator\?\.audioSession/.test(audio), 'accès optionnel attendu');
  assert.ok(audio.includes("'type' in session"), 'présence testée avant écriture');
  const corps = audio.slice(audio.indexOf('function jouerMalgreLeSilencieux'),
    audio.indexOf('export class AudioEngine'));
  assert.ok(/try\s*\{/.test(corps) && /catch/.test(corps),
    'l’écriture doit être protégée');
});
test('aucun repli folklorique par élément <audio> muet', () => {
  // Ce dépôt s'est déjà fait avoir deux fois par des contournements qui ne
  // mordaient plus en silence. On n'en ajoute pas un troisième que rien ne
  // prouve : si quelqu'un en écrit un, qu'il le mesure sur un vrai iOS.
  const corps = audio.slice(audio.indexOf('function jouerMalgreLeSilencieux'),
    audio.indexOf('export class AudioEngine'));
  assert.ok(!/createElement\(['"](audio|video)/.test(corps),
    'repli non mesuré : à prouver sur appareil avant de l’ajouter');
});

titre('la dérive publie son état');
test('galerie:derive émis à chaque peinture d\'état', () => {
  assert.ok(derive.includes("new CustomEvent('galerie:derive'"));
});
test('la toolbox s\'y abonne (elle suit la réalité, pas le clic)', () => {
  assert.ok(toolbox.includes("addEventListener('galerie:derive'"));
});

titre('le menu : trois groupes, réglages à plat');
test('Visite / Affichage / Aide et mémoire', () => {
  for (const g of ['menu.groupe.visite', 'menu.groupe.affichage', 'menu.groupe.systeme']) {
    assert.ok(menu.includes(`t('${g}')`), `groupe ${g} absent`);
  }
});
test('l\'accordéon Réglages a disparu : minimap et FPS à plat, mémoire pliée', () => {
  assert.ok(!menu.includes('vm-settings'), 'l\'ancien accordéon traîne encore');
  assert.ok(menu.includes('id="vm-memoire"') && menu.includes('vm-memoire-panel'));
  assert.ok(menu.includes('id="vm-minimap"') && menu.includes('id="vm-fps"'));
});
test('« Vue liste (2D) » porte l\'habit commun des entrées', () => {
  assert.ok(css.includes('.vm-panel li > a'), 'le lien doit s\'habiller comme les boutons');
  assert.ok(!/#vm-liste\s*\{/.test(css),
    'une règle #vm-liste (spécificité d\'ID) écraserait l\'habit commun');
});
test('la croix de fermeture est toujours là', () => {
  assert.ok(menu.includes('id="vm-x"'));
});

titre('i18n : chaque libellé dans les deux langues');
test('clés tb.* et menu.groupe.* présentes deux fois (fr + en)', () => {
  for (const cle of ['tb.label', 'tb.carte', 'tb.capture', 'tb.capture.faite',
    'tb.derive', 'tb.derive.stop', 'tb.son.couper', 'tb.son.rendre',
    'menu.groupe.visite', 'menu.groupe.affichage', 'menu.groupe.systeme']) {
    const n = i18n.split(`'${cle}':`).length - 1;
    assert.equal(n, 2, `${cle} : ${n} définition(s), 2 attendues`);
  }
});

console.log(`\n${ok} ✓  ${ko} ✗`);
process.exit(ko ? 1 : 0);
