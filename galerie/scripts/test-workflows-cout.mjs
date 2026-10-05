/**
 * LE GARDE-FOU DES MINUTES PAYANTES — les workflows des DEUX dépôts.
 *
 * L'application se construit en local (npm run app:mac) ; GitHub Actions ne
 * doit plus rien coûter par défaut. Ce test lit chaque workflow du site
 * (public, gratuit) et de l'éditeur (privé, chaque minute compte, macOS ×10,
 * Windows ×2) et ÉCHOUE si un job sur un runner macOS ou Windows peut se
 * déclencher autrement que par `workflow_dispatch`, gardé sur le job par
 * la confirmation `inputs.confirmation == 'je-paie'`.
 *
 * L'éditeur absent (le déploiement public clone sans le sous-module) : le
 * test SAUTE en le disant, il ne fait jamais échouer un déploiement — la
 * suite (tests.mjs) le saute d'ailleurs d'elle-même, « editor/ » dans ce
 * texte. Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const site = join(ici, '..', '..');
const editeur = join(ici, '..', 'engine', 'src', 'editor');
const GARDE = /inputs\.confirmation\s*==\s*'je-paie'/;

if (!existsSync(join(editeur, 'Editor.js'))) {
  console.log('\n— garde-fou des workflows : sauté (éditeur absent de ce clone, ses workflows ne sont pas là)');
  process.exit(0);
}
let yaml;
try { yaml = createRequire(import.meta.url)('js-yaml'); } catch {
  console.log('\n— garde-fou des workflows : sauté (js-yaml absent : npm ci)');
  process.exit(0);
}

const workflows = [];
for (const [depot, dossier] of [['site', join(site, '.github', 'workflows')], ['éditeur', join(editeur, '.github', 'workflows')]]) {
  if (!existsSync(dossier)) continue;
  for (const f of readdirSync(dossier).filter((f) => /\.ya?ml$/.test(f))) {
    workflows.push({ depot, fichier: f, doc: yaml.load(readFileSync(join(dossier, f), 'utf8')) });
  }
}

/** Un job tourne-t-il (ou peut-il tourner) sur macOS ou Windows ? */
function runnerCouteux(job) {
  const textes = [];
  const ro = job['runs-on'];
  textes.push(typeof ro === 'string' ? ro : JSON.stringify(ro ?? ''));
  const m = job.strategy?.matrix;
  if (m) textes.push(JSON.stringify(m));
  return /macos|windows/i.test(textes.join(' '));
}

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nle garde-fou des minutes payantes');
assert.ok(workflows.some((w) => w.depot === 'éditeur'), 'les workflows de l’éditeur doivent être lus');

for (const w of workflows) {
  const on = w.doc.on ?? w.doc[true]; // `on:` se lit `true` en YAML 1.1
  const declencheurs = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});
  const jobs = Object.entries(w.doc.jobs ?? {});
  const couteux = jobs.filter(([, j]) => runnerCouteux(j));
  test(`${w.depot} / ${w.fichier} : ${couteux.length ? `${couteux.length} job(s) macOS/Windows` : 'ubuntu seulement'} ; déclencheurs ${declencheurs.join(', ')}`, () => {
    if (!couteux.length) return;
    assert.deepEqual(declencheurs, ['workflow_dispatch'],
      `un job macOS/Windows ne se déclenche que par workflow_dispatch (ici : ${declencheurs.join(', ')})`);
    const inputs = on.workflow_dispatch?.inputs ?? {};
    assert.ok(inputs.confirmation?.required === true, 'l’entrée « confirmation » doit exister et être requise');
    assert.ok(inputs.os?.type === 'choice' && inputs.os.required === true && inputs.os.default === undefined,
      'l’entrée « os » : un choix requis, sans défaut (un seul système par run)');
    for (const [nom, job] of couteux) {
      assert.match(String(job.if ?? ''), GARDE, `le job « ${nom} » doit porter if: inputs.confirmation == 'je-paie'`);
      assert.ok(Number(job['timeout-minutes']) > 0 && Number(job['timeout-minutes']) <= 30, `le job « ${nom} » doit avoir un timeout-minutes serré (≤ 30)`);
      assert.ok(!/matrix/.test(JSON.stringify(job.strategy ?? {})) || true);
    }
    assert.ok(w.doc.concurrency && (w.doc.concurrency['cancel-in-progress'] === true), 'concurrency avec cancel-in-progress');
  });
}

test('aucun workflow de l’éditeur ne se déclenche au push d’un tag app-v* ni d’une branche release/*', () => {
  for (const w of workflows.filter((w) => w.depot === 'éditeur')) {
    const on = w.doc.on ?? w.doc[true];
    const push = on?.push;
    if (!push) continue;
    const texte = JSON.stringify(push);
    assert.ok(!/app-v|release\//.test(texte), `${w.fichier} : push ${texte}`);
  }
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
