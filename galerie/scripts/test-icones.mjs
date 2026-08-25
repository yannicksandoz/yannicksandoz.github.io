/**
 * LES ICÔNES LUCIDE — vendorées, éprouvées au nœud.
 *
 *   1. le module généré est EXACTEMENT ce que son générateur produit —
 *      régénéré et comparé, comme le lettrage et le scan de démonstration ;
 *   2. chaque icône que la barre d'outils demande existe — une faute de
 *      frappe dans un nom rendrait un bouton muet sans erreur ;
 *   3. le crédit ISC vit dans une CHAÎNE (il survit à la minification), et
 *      le garde-fou du build Visiteur connaît l'empreinte ;
 *   4. la source est une dépendance de DÉVELOPPEMENT, sous ISC — rien de
 *      Lucide ne part au bundle autrement que par le module généré.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genererModule, NOMS } from './genere-icones.mjs';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const ici = dirname(fileURLToPath(import.meta.url));
const MODULE = join(ici, '..', 'engine', 'src', 'editor', 'icones.js');
const commite = readFileSync(MODULE, 'utf8');

titre('le module généré dit la vérité');
test('régénérer rend EXACTEMENT le fichier commité', () => {
  assert.equal(commite, genererModule(),
    'icones.js diverge : relancer genere-icones.mjs');
});
test('chaque tracé est du SVG de trait, teinté par currentColor', () => {
  assert.ok(commite.includes('stroke="currentColor"'));
  assert.ok(!commite.includes('fill="#'), 'aucune couleur en dur');
});

titre('la barre demande des icônes qui existent');
test('tous les noms passés à icone() sont dans la liste générée', () => {
  const ui = readFileSync(join(ici, '..', 'engine', 'src', 'editor',
    'EditorUI.js'), 'utf8');
  const demandes = [...ui.matchAll(/icone\('([a-z0-9-]+)'\)/g)]
    .map((m) => m[1]);
  assert.ok(demandes.length >= 20, `seulement ${demandes.length} appels`);
  for (const nom of demandes) {
    assert.ok(NOMS.includes(nom), `« ${nom} » absent de genere-icones.mjs`);
  }
});
test('…et plus aucun émoji de plateforme dans la barre', () => {
  const ui = readFileSync(join(ici, '..', 'engine', 'src', 'editor',
    'EditorUI.js'), 'utf8');
  const barre = ui.slice(ui.indexOf('_buildToolbar'), ui.indexOf('const acts'));
  for (const emoji of ['🧱', '🍕', '🎵', '🔊', '🎧', '📁', '📂', '🔗', '📸', '🗑']) {
    assert.ok(!barre.includes(emoji), `émoji ${emoji} encore dans la barre`);
  }
});

titre('le crédit et le garde-fou');
test('le crédit ISC est une chaîne, avec lucide.dev', () => {
  assert.ok(commite.includes('CREDIT_LUCIDE'));
  assert.ok(commite.includes('lucide.dev'));
  assert.ok(commite.includes('Permission to use, copy, modify'),
    'le texte ISC doit voyager avec les tracés');
});
test('le garde-fou du build Visiteur connaît l’empreinte', () => {
  const garde = readFileSync(join(ici, 'check-visitor-build.mjs'), 'utf8');
  assert.ok(garde.includes("'lucide.dev'"));
});

titre('la source est déclarée, en ISC, côté développement');
test('lucide-static est une devDependency', () => {
  const p = JSON.parse(readFileSync(join(ici, '..', 'package.json'), 'utf8'));
  assert.ok(p.devDependencies['lucide-static'],
    'lucide-static absent des devDependencies');
  assert.ok(!p.dependencies?.['lucide-static'],
    'lucide-static n’a rien à faire dans les dépendances de production');
  const lib = JSON.parse(readFileSync(join(ici, '..', 'node_modules',
    'lucide-static', 'package.json'), 'utf8'));
  assert.equal(lib.license, 'ISC');
});
test('…et créditée dans les avis tiers', () => {
  const avis = readFileSync(join(ici, '..', '..', 'THIRD-PARTY-NOTICES.md'),
    'utf8');
  assert.ok(avis.includes('Lucide'));
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
