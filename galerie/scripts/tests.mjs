/**
 * LA SUITE — tous les scripts/test-*.mjs, l'un après l'autre, et un bilan.
 *
 * Longtemps `npm test` fut une chaîne de cinquante « && » dans package.json :
 * un test oublié n'y entrait jamais, et l'ordre y était un accident. Ici,
 * chaque fichier `test-*.mjs` du dossier est de la suite par le seul fait
 * d'exister, dans l'ordre alphabétique.
 *
 * Certains tests éprouvent l'ÉDITEUR (le sous-module privé). En CI, le
 * dépôt est cloné sans lui — c'est voulu, voir deploy.yml — et ces tests
 * n'ont rien à importer : ils sont SAUTÉS, et dits sautés. Un test qui
 * importe l'éditeur se reconnaît à son texte (« editor/ »), pas à une liste
 * à entretenir.
 *
 *   npm test                 toute la suite
 *   npm test -- crans poids  seulement ceux dont le nom contient un mot
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const filtres = process.argv.slice(2);
const editeurPresent = existsSync(join(ICI, '..', 'engine', 'src', 'editor', 'Editor.js'));

const tests = readdirSync(ICI)
  .filter((f) => /^test-.*\.mjs$/.test(f))
  .sort()
  .filter((f) => !filtres.length || filtres.some((m) => f.includes(m)));

let passes = 0; let sautes = 0; const echecs = [];
const t0 = Date.now();
for (const f of tests) {
  const source = readFileSync(join(ICI, f), 'utf8');
  if (!editeurPresent && /['"][^'"]*editor\//.test(source)) {
    sautes++;
    console.log(`\n— ${f} : sauté (éditeur absent de ce clone)`);
    continue;
  }
  const r = spawnSync(process.execPath, [join(ICI, f)], { stdio: 'inherit' });
  if (r.status === 0) passes++;
  else echecs.push(f);
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`${tests.length} suite(s) en ${((Date.now() - t0) / 1000).toFixed(1)} s : `
  + `${passes} ✓${sautes ? `, ${sautes} sautée(s)` : ''}${echecs.length ? `, ${echecs.length} ✗` : ''}`);
for (const f of echecs) console.log(`   ✗ ${f}`);
process.exit(echecs.length ? 1 : 0);
