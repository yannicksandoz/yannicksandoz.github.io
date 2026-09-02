/**
 * ISF → three.js : le convertisseur, jugé sur les VRAIS shaders de
 * l'auteur (content/shaders/*.fs) et sur les cas de refus.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extraireISF, validerISF, entreesDe, fragmentDe, valeursDe,
  envelopperCalque, MODES_FONDU } from '../engine/src/core/isf.js';

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

console.log('\nLes shaders de l\'auteur, tels quels');
{
  const dossier = join(racine, 'content', 'shaders');
  const fichiers = readdirSync(dossier).filter((f) => f.endsWith('.fs'));
  vrai('au moins trois shaders au contenu', fichiers.length >= 3, `${fichiers.length}`);
  for (const f of fichiers) {
    const source = readFileSync(join(dossier, f), 'utf8');
    const r = fragmentDe(source);
    vrai(`${f} : convertible sans réserve`, r && r.problemes.length === 0,
      JSON.stringify(r?.problemes));
    vrai(`${f} : des entrées réglables`, r.entrees.length > 0, `${r.entrees.length}`);
    // chaque entrée doit être déclarée en uniform dans le fragment
    const manquantes = r.entrees.filter((e) =>
      !r.fragment.includes(`uniform ${e.glsl} ${e.nom};`));
    check(`${f} : chaque entrée a son uniform`, manquantes.map((e) => e.nom), []);
    vrai(`${f} : les conventions ISF sont déclarées`,
      r.fragment.includes('uniform float TIME;')
      && r.fragment.includes('uniform vec2 RENDERSIZE;')
      && r.fragment.includes('varying vec2 isf_FragNormCoord;'), 'préambule');
    // le corps de l'auteur est INTACT (au marqueur v1 près)
    const corps = extraireISF(source).corps
      .replace(/\bvv_FragNormCoord\b/g, 'isf_FragNormCoord');
    vrai(`${f} : le corps de l'auteur est intact`, r.fragment.endsWith(corps), 'corps modifié');
  }
}

console.log('\nEn-tête et entrées');
{
  const src = `/*{
    "ISFVSN": "2",
    "INPUTS": [
      { "NAME": "vitesse", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.0, "MAX": 3.0 },
      { "NAME": "teinte",  "TYPE": "color", "DEFAULT": [0.2, 0.4, 0.6, 1.0] },
      { "NAME": "actif",   "TYPE": "bool",  "DEFAULT": true },
      { "NAME": "centre",  "TYPE": "point2D", "DEFAULT": [0.5, 0.5] },
      { "NAME": "mode",    "TYPE": "long",  "DEFAULT": 2 },
      { "NAME": "declic",  "TYPE": "event" }
    ]
  }*/
  void main() { gl_FragColor = vec4(vv_FragNormCoord, 0.0, 1.0); }`;
  const isf = extraireISF(src);
  vrai('l\'en-tête se lit', isf && isf.meta.ISFVSN === '2', JSON.stringify(isf?.meta));
  const entrees = entreesDe(isf.meta);
  check('cinq entrées utilisables (event ignoré)',
    entrees.map((e) => `${e.nom}:${e.glsl}`),
    ['vitesse:float', 'teinte:vec4', 'actif:bool', 'centre:vec2', 'mode:float']);
  const r = fragmentDe(src);
  vrai('vv_FragNormCoord (ISF v1) devient le varying v2',
    r.fragment.includes('vec4(isf_FragNormCoord, 0.0, 1.0)')
    && !r.fragment.includes('vv_FragNormCoord'), 'alias v1');

  const valeurs = valeursDe(entrees, { vitesse: 9, teinte: [1, 0, 0], actif: 0 });
  check('un réglage se borne à MIN..MAX', valeurs.vitesse, 3);
  check('une couleur à trois canaux gagne son alpha', valeurs.teinte, [1, 0, 0, 1]);
  check('un bool accepte un nombre', valeurs.actif, false);
  check('sans réglage, le défaut', valeurs.centre, [0.5, 0.5]);
}

console.log('\nCe que la v1 refuse, en le disant');
{
  check('pas d\'en-tête : refus net', extraireISF('void main(){}'), null);
  const multi = { PASSES: [{ TARGET: 'a' }, {}], INPUTS: [] };
  vrai('multi-passes signalé', validerISF(multi).some((p) => p.includes('passes')),
    JSON.stringify(validerISF(multi)));
  const image = { INPUTS: [{ NAME: 'inputImage', TYPE: 'image' }] };
  vrai('entrée image signalée', validerISF(image).some((p) => p.includes('image')),
    JSON.stringify(validerISF(image)));
  const r = fragmentDe(`/*{ "INPUTS": [{ "NAME": "img", "TYPE": "image" }] }*/ void main(){}`);
  vrai('fragmentDe rend les problèmes au lieu d\'un fragment',
    !r.fragment && r.problemes.length === 1, JSON.stringify(r));
}

console.log('\nLes calques : un shader posé sur un autre');
{
  const base = fragmentDe(`/*{ "INPUTS": [{ "NAME": "v", "TYPE": "float", "DEFAULT": 1 }] }*/
void main(void) { gl_FragColor = vec4(v); }`).fragment;
  const calque = envelopperCalque(base);
  vrai('la main de l\'auteur est renommée', calque.includes('void isf_calque_main()')
    && !/\bvoid\s+main\s*\(\s*void\s*\)/.test(calque), calque.slice(-300));
  vrai('une main de composition la rappelle', /void main\(\) \{\s*isf_calque_main\(\);/.test(calque));
  vrai('opacité et mode déclarés en uniforms',
    calque.includes('uniform float isf_opacite;') && calque.includes('uniform int isf_mode;'));
  vrai('les entrées de l\'auteur restent déclarées', calque.includes('uniform float v;'));
  check('sans main reconnaissable : null', envelopperCalque('float f() { return 1.0; }'), null);
  check('les quatre modes ont un numéro', Object.keys(MODES_FONDU), ['normal', 'ajouter', 'ecran', 'multiplier']);
  // les vrais shaders de l'auteur s'enveloppent tous
  const dossier = join(racine, 'content', 'shaders');
  for (const f of readdirSync(dossier).filter((x) => x.endsWith('.fs'))) {
    const r = fragmentDe(readFileSync(join(dossier, f), 'utf8'));
    vrai(`${f} : utilisable en calque`, Boolean(envelopperCalque(r.fragment)));
  }
}

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed) process.exit(1);
