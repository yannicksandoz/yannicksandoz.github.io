/**
 * LA LECTURE PAR FRAGMENTS — la partie pure.
 *
 *   1. le plan : des segments de dix secondes prolongés du chevauchement,
 *      le dernier coupé à la fin ; les chemins sur trois chiffres ;
 *   2. le manifeste : validé phrase par phrase, normalisé ;
 *   3. le chaînage : chaque morceau finit au bord de son segment ou à la
 *      borne de fin, plus la queue de fondu ; la boucle repart à « debut » ;
 *      les fondus additionnent à un sur le chevauchement ;
 *   4. le lecteur, avec un moteur factice : charge d'avance, rend ce qui a
 *      joué, ne tient jamais plus que l'horizon.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { planFragments, cheminFragment, validerManifeste, normaliserManifeste,
  morceauSuivant, programme, bornesFragments, LecteurFragments, HORIZON, chargerManifeste }
  from '../engine/src/core/fragments.js';

let ok = 0, ko = 0;
const test = async (nom, fn) => {
  try { await fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const MANIFESTE = { version: 1, duree: 34.5, segment: 10, chevauchement: 0.1, n: 4,
  formats: { webm: 'assets/x.frag/{i}.webm', m4a: 'assets/x.frag/{i}.m4a' } };

titre('le plan');
await test('34,5 s en segments de 10 : quatre segments, le dernier de 4,5 s', () => {
  const plan = planFragments(34.5, 10, 0.1);
  assert.deepEqual(plan, [
    { i: 0, debut: 0, longueur: 10.1 }, { i: 1, debut: 10, longueur: 10.1 },
    { i: 2, debut: 20, longueur: 10.1 }, { i: 3, debut: 30, longueur: 4.5 }]);
  assert.deepEqual(planFragments(0), []);
  assert.equal(planFragments(10, 10, 0.1).length, 1, 'exactement dix secondes : un segment');
});
await test('les chemins : {i} sur trois chiffres', () => {
  assert.equal(cheminFragment('assets/x.frag/{i}.webm', 7), 'assets/x.frag/007.webm');
  assert.equal(cheminFragment('assets/x.frag/{i}.webm', 123), 'assets/x.frag/123.webm');
});

titre('le manifeste');
await test('sain : aucune phrase ; normalisé en nombres', () => {
  assert.deepEqual(validerManifeste(MANIFESTE), []);
  const n = normaliserManifeste({ ...MANIFESTE, duree: '34.5', chevauchement: undefined });
  assert.equal(n.duree, 34.5);
  assert.equal(n.chevauchement, 0);
});
await test('défauts nommés : durée, segment, formats, compte', () => {
  assert.match(validerManifeste(null)[0], /pas un objet/);
  const d = validerManifeste({ duree: 0, segment: 0, n: 0, formats: { webm: 'x.webm' } });
  assert.ok(d.some((p) => /durée/.test(p)) && d.some((p) => /segment/.test(p)) && d.some((p) => /\{i\}/.test(p)));
  assert.match(validerManifeste({ ...MANIFESTE, n: 3 })[0], /3 segments annoncés, 4 attendus/);
});

titre('le chaînage');
const bornesPleines = bornesFragments({}, MANIFESTE);
await test('sans bornes : morceau après morceau jusqu\'à la fin, puis la boucle à zéro', () => {
  let e = { position: 0, t: 0 };
  const r1 = morceauSuivant(MANIFESTE, bornesPleines, e);
  assert.deepEqual(r1.morceau, { i: 0, offset: 0, duree: 10.1, t: 0, fonduEntree: 0, fonduSortie: 0.1, boucle: false });
  assert.deepEqual(r1.suivant, { position: 10, t: 10 });
  const r4 = morceauSuivant(MANIFESTE, bornesPleines, { position: 30, t: 30 });
  assert.deepEqual(r4.morceau, { i: 3, offset: 0, duree: 4.5, t: 30, fonduEntree: 0.1, fonduSortie: 0, boucle: true });
  assert.deepEqual(r4.suivant, { position: 0, t: 34.5 }, 'la boucle repart au début, sans trou');
});
await test('avec bornes 4,5 → 25 : départ au milieu du premier segment, fin au milieu du troisième', () => {
  const b = bornesFragments({ debut: '0:04.5', fin: 25 }, MANIFESTE);
  assert.deepEqual(b, { debut: 4.5, fin: 25, borne: true });
  const { morceaux, etat } = programme(MANIFESTE, b, undefined, 30);
  assert.deepEqual(morceaux.map((m) => [m.i, m.offset, m.duree, m.t, m.boucle]), [
    [0, 4.5, 5.6, 0, false],   // 4,5 → 10, plus la queue de 0,1
    [1, 0, 10.1, 5.5, false],
    [2, 0, 5.1, 15.5, true],   // 20 → 25, plus la queue, puis la boucle
    [0, 4.5, 5.6, 20.5, false],
    [1, 0, 10.1, 26, false]
  ]);
  assert.equal(etat.position, 20);
  assert.ok(morceaux.every((m, k) => k === 0 ? m.fonduEntree === 0 : m.fonduEntree === 0.1), 'le premier morceau seul entre sans fondu');
});
await test('la ligne de temps est continue : chaque morceau commence où le précédent finit (moins la queue)', () => {
  const { morceaux } = programme(MANIFESTE, bornesPleines, undefined, 100);
  for (let k = 1; k < morceaux.length; k++) {
    const prec = morceaux[k - 1];
    assert.ok(Math.abs((prec.t + prec.duree - prec.fonduSortie) - morceaux[k].t) < 1e-6, `raccord ${k}`);
  }
});
await test('un manifeste sans chevauchement : pas de queue, pas de fondu d\'entrée', () => {
  const m = { ...MANIFESTE, chevauchement: 0 };
  const { morceaux } = programme(m, bornesFragments({}, m), undefined, 25);
  assert.ok(morceaux.every((x) => x.fonduSortie === 0));
  assert.deepEqual(morceaux.map((x) => x.duree), [10, 10, 10]);
});

titre('le lecteur, sur un moteur factice');
/** Un moteur qui décode des tampons de la bonne durée et compte ses usages. */
function moteurFactice() {
  let temps = 0;
  const cache = new Map(); const usages = new Map();
  const noeud = () => ({ connect() {}, disconnect() {} });
  const ctx = {
    get currentTime() { return temps; }, avancer(dt) { temps += dt; },
    createGain: () => ({ ...noeud(), gain: { setValueAtTime() {}, linearRampToValueAtTime() {} } }),
    createBufferSource() {
      const s = { ...noeud(), buffer: null, onended: null, demarre: null, arrete: null,
        start(quand, offset, duree) { s.demarre = { quand, offset, duree }; },
        stop(quand) { s.arrete = quand; } };
      sources.push(s); return s;
    }
  };
  const sources = [];
  return {
    ctx, sources, usages,
    load(url) {
      usages.set(url, (usages.get(url) ?? 0) + 1);
      if (!cache.has(url)) {
        const i = Number(url.match(/(\d{3})\.webm$/)[1]);
        const longueur = planFragments(MANIFESTE.duree, 10, 0.1)[i].longueur;
        cache.set(url, Promise.resolve({ duration: longueur, length: Math.round(longueur * 48000), numberOfChannels: 2 }));
      }
      return cache.get(url);
    },
    release(url) { const r = (usages.get(url) ?? 1) - 1; if (r > 0) usages.set(url, r); else usages.delete(url); },
    residents() { return [...usages.keys()]; }
  };
}
const attendre = () => new Promise((r) => setTimeout(r, 0));

await test('précharger décode le premier segment sans le garder tenu', async () => {
  const engine = moteurFactice();
  const l = new LecteurFragments({ engine, manifeste: MANIFESTE, motif: 'assets/x.frag/{i}.webm', cfg: {}, destination: engine.ctx.createGain() });
  const b = await l.precharger();
  assert.equal(b.duration, 10.1);
  assert.equal(l.residents(), 0);
});
await test('démarrer programme l\'horizon, pas plus ; les sources partent aux bons instants', async () => {
  const engine = moteurFactice();
  const l = new LecteurFragments({ engine, manifeste: MANIFESTE, motif: 'assets/x.frag/{i}.webm', cfg: {}, destination: engine.ctx.createGain() });
  l.demarrer(1);
  for (let k = 0; k < 6; k++) await attendre();
  const departs = engine.sources.map((s) => s.demarre);
  // t = 0 et t = 10 tiennent sous l'horizon de 12 s ; t = 20 non
  assert.deepEqual(departs.map((d) => [d.quand, d.offset, d.duree]), [[1, 0, 10.1], [11, 0, 10.1]]);
  assert.equal(l.residents(), 2, 'deux segments tenus, pas la pièce');
  // le temps passe : la planification suivante ajoute le troisième
  engine.ctx.avancer(10);
  l._planifier();
  for (let k = 0; k < 6; k++) await attendre();
  assert.equal(engine.sources.length, 3);
  assert.equal(engine.sources[2].demarre.quand, 21);
  // un morceau fini rend son segment
  engine.sources[0].onended();
  assert.equal(l.residents(), 2);
  assert.ok(!engine.residents().includes('assets/x.frag/000.webm'));
  l.liberer();
  assert.equal(l.residents(), 0);
  assert.deepEqual(engine.residents(), [], 'plus rien au cache du moteur');
  assert.ok(engine.sources.slice(1).every((s) => s.arrete !== null), 'les sources en cours sont arrêtées');
});
await test('en retard sur le réseau : le morceau rattrape en sautant ce qui est passé', async () => {
  const engine = moteurFactice();
  const l = new LecteurFragments({ engine, manifeste: MANIFESTE, motif: 'assets/x.frag/{i}.webm', cfg: {}, destination: engine.ctx.createGain() });
  l.demarrer(0);
  engine.ctx.avancer(2.5); // le temps que le premier segment arrive
  for (let k = 0; k < 6; k++) await attendre();
  const d = engine.sources[0].demarre;
  assert.deepEqual([d.quand, d.offset, +d.duree.toFixed(3)], [2.5, 2.5, 7.6]);
  l.liberer();
});
await test('arrêter puis redémarrer : la piste repart du début de ses bornes', async () => {
  const engine = moteurFactice();
  const l = new LecteurFragments({ engine, manifeste: MANIFESTE, motif: 'assets/x.frag/{i}.webm', cfg: { debut: 4.5 }, destination: engine.ctx.createGain() });
  l.demarrer(0);
  for (let k = 0; k < 6; k++) await attendre();
  l.arreter(3);
  assert.ok(engine.sources.every((s) => s.arrete === 3));
  assert.equal(l.position(), null);
  engine.ctx.avancer(5);
  l.demarrer(5);
  for (let k = 0; k < 6; k++) await attendre();
  const dernier = engine.sources[engine.sources.length - 1].demarre;
  assert.ok(engine.sources.some((s) => s.demarre.quand === 5 && s.demarre.offset === 4.5), `redépart à 4,5 s : ${JSON.stringify(dernier)}`);
  l.liberer();
});
await test('chargerManifeste : un manifeste faux lève une phrase, un bon revient normalisé', async () => {
  await assert.rejects(chargerManifeste('x.json', async () => ({ duree: 0 })), /manifeste x\.json : durée/);
  const m = await chargerManifeste('x.json', async () => MANIFESTE);
  assert.equal(m.n, 4);
  assert.equal(HORIZON, 12);
});

console.log(`\n${ko ? '✗' : '✓'} test-fragments : ${ok} ok, ${ko} ko`);
if (ko) process.exit(1);
