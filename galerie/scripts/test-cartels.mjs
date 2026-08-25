/**
 * LES CARTELS — ce que les étiquettes disent, éprouvé au nœud.
 *
 * Le dessin (troika, SDF, worker) ne se teste qu'au navigateur ; ce qui se
 * teste ici est ce qui DÉCIDE : quel texte porte une porte, de quelle
 * couleur, et — la vérification qui vaut le détour — si la police préchargée
 * couvre bien tous les noms de salle du contenu réel. Un glyphe absent du
 * préchargement, c'est un mot qui apparaît une frame après les autres, et
 * personne ne s'en aperçoit avant de le voir sur un vrai contenu.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import * as zlib from 'node:zlib';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { texteEtiquette, encreEtiquette, glyphesManquants,
  GLYPHES_COURANTS, ENCRE, ENCRE_FINI }
  from '../engine/src/core/cartels-reglages.js';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

/* ------------------------------------------------------------ le texte -- */
titre('ce qu’une porte annonce');
test('sans bilan, le nom seul', () => {
  assert.equal(texteEtiquette('Jardin sec', null), 'Jardin sec');
  assert.equal(texteEtiquette('Jardin sec', undefined), 'Jardin sec');
});
test('avec un bilan, le nom puis le compte', () => {
  assert.equal(texteEtiquette('Archives', { vues: 1, total: 4 }),
    'Archives\n• 1 / 4');
});
test('une salle vide n’annonce pas « 0 / 0 »', () => {
  // une porte qui annonce un compte nul ne renseigne sur rien et salit le
  // linteau : on n'écrit que le nom
  assert.equal(texteEtiquette('Couloir', { vues: 0, total: 0 }), 'Couloir');
  assert.equal(texteEtiquette('Couloir', { total: 'beaucoup' }), 'Couloir');
});
test('un compte incohérent est ramené dans ses bornes', () => {
  assert.equal(texteEtiquette('X', { vues: 9, total: 3 }), 'X\n• 3 / 3');
  assert.equal(texteEtiquette('X', { vues: -2, total: 3 }), 'X\n• 0 / 3');
});
test('un nom manquant ne laisse pas de ligne vide', () => {
  assert.equal(texteEtiquette(null, { vues: 1, total: 2 }), '• 1 / 2');
  assert.equal(texteEtiquette('   ', null), '');
});

titre('et de quelle couleur');
test('violet tant qu’il reste à trouver', () => {
  assert.equal(encreEtiquette({ vues: 1, total: 4 }), ENCRE);
  assert.equal(encreEtiquette(null), ENCRE);
});
test('vert quand tout est trouvé', () => {
  assert.equal(encreEtiquette({ vues: 4, total: 4 }), ENCRE_FINI);
  assert.equal(encreEtiquette({ vues: 5, total: 4 }), ENCRE_FINI);
});
test('une salle vide reste violette, pas « finie »', () => {
  assert.equal(encreEtiquette({ vues: 0, total: 0 }), ENCRE);
});

/* ---------------------------------------------------------- les glyphes -- */
titre('la police préchargée couvre le contenu');
test('les caractères de nos propres étiquettes y sont', () => {
  assert.deepEqual(glyphesManquants(texteEtiquette('Élan à côté', { vues: 12, total: 30 })), []);
  assert.deepEqual(glyphesManquants('• / 0123456789'), []);
});
test('un caractère vraiment absent est bien signalé', () => {
  // sans quoi le contrôle ci-dessous ne prouverait rien
  assert.deepEqual(glyphesManquants('漢'), ['漢']);
  assert.deepEqual(glyphesManquants('a漢b漢'), ['漢']);
});
test('le retour à la ligne n’est pas un glyphe manquant', () => {
  assert.deepEqual(glyphesManquants('a\nb'), []);
});
test('AUCUN NOM DE SALLE DU CONTENU RÉEL n’en sort', () => {
  // La vérification qui vaut le détour. Un glyphe hors du préchargement
  // n'échoue pas : il apparaît une frame plus tard, dans un worker, et l'on
  // ne le voit que sur le vrai contenu — jamais dans un test synthétique.
  const ici = dirname(fileURLToPath(import.meta.url));
  const salles = join(ici, '..', 'content', 'rooms');
  if (!existsSync(salles)) { console.log('    (pas de content/rooms — sauté)'); return; }
  const noms = [];
  for (const f of readdirSync(salles).filter((n) => n.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(salles, f), 'utf8'));
    if (j.label) noms.push(j.label);
    for (const p of j.portals ?? []) if (p.label) noms.push(p.label);
  }
  assert.ok(noms.length > 0, 'aucun nom lu : le contrôle ne prouverait rien');
  const absents = new Map();
  for (const n of noms) {
    const m = glyphesManquants(texteEtiquette(n, { vues: 1, total: 9 }));
    if (m.length) absents.set(n, m);
  }
  assert.equal(absents.size, 0,
    [...absents].map(([n, m]) => `« ${n} » → ${m.join('')}`).join(', '));
  console.log(`    (${noms.length} noms de salles et de portes vérifiés)`);
});
test('le jeu de glyphes n’a pas de doublon', () => {
  assert.equal(new Set(GLYPHES_COURANTS).size, GLYPHES_COURANTS.length);
});

/* ------------------------------------------------- et surtout : le CDN -- */
/**
 * LA VÉRIFICATION QUI PROTÈGE LA PROMESSE DE LA GALERIE.
 *
 * Troika embarque `@unicode-font-resolver` : quand un caractère n'est PAS
 * couvert par la police qu'on lui donne, il va chercher une police de repli
 * sur `cdn.jsdelivr.net` — et si l'on redirige cette adresse vers une adresse
 * locale qui échoue, son code retombe sur le CDN d'origine. On ne peut donc
 * pas le lui interdire ; on peut seulement ne jamais lui présenter un
 * caractère qu'Inter ne connaît pas. Lu dans sa source, c'est exact : sans
 * caractère non couvert, la liste de replis reste vide et AUCUNE requête
 * n'est émise.
 *
 * Cette promesse ne vaut donc que si l'on connaît la couverture RÉELLE de
 * notre fichier de police. On la lit ici, dans le `.woff` livré, table
 * `cmap` comprise. C'est trente lignes, et cela remplace une supposition par
 * un fait.
 */
function couvertureWoff(chemin) {
  const buf = readFileSync(chemin);
  assert.equal(buf.toString('latin1', 0, 4), 'wOFF', 'pas un fichier woff');
  const nbTables = buf.readUInt16BE(12);
  const { inflateSync } = zlib;
  let cmap = null;
  for (let i = 0; i < nbTables; i++) {
    const e = 44 + (i * 20);
    const tag = buf.toString('latin1', e, e + 4);
    if (tag !== 'cmap') continue;
    const offset = buf.readUInt32BE(e + 4);
    const compLength = buf.readUInt32BE(e + 8);
    const origLength = buf.readUInt32BE(e + 12);
    const brut = buf.subarray(offset, offset + compLength);
    cmap = compLength < origLength ? inflateSync(brut) : brut;
    break;
  }
  assert.ok(cmap, 'aucune table cmap');

  // on prend le premier sous-tableau au format 4 (BMP, Unicode ou Windows)
  const nbSous = cmap.readUInt16BE(2);
  let sous = -1;
  for (let i = 0; i < nbSous; i++) {
    const o = cmap.readUInt32BE(4 + (i * 8) + 4);
    if (cmap.readUInt16BE(o) === 4) { sous = o; break; }
  }
  assert.ok(sous >= 0, 'aucun sous-tableau cmap au format 4');

  const segX2 = cmap.readUInt16BE(sous + 6);
  const seg = segX2 / 2;
  const fins = sous + 14;
  const debuts = fins + segX2 + 2;
  const deltas = debuts + segX2;
  const decalages = deltas + segX2;
  const couvert = new Set();
  for (let s = 0; s < seg; s++) {
    const fin = cmap.readUInt16BE(fins + (s * 2));
    const debut = cmap.readUInt16BE(debuts + (s * 2));
    if (debut === 0xffff) continue;
    const delta = cmap.readInt16BE(deltas + (s * 2));
    const decalage = cmap.readUInt16BE(decalages + (s * 2));
    for (let c = debut; c <= fin && c !== 0x10000; c++) {
      let glyphe;
      if (decalage === 0) {
        glyphe = (c + delta) & 0xffff;
      } else {
        const p = decalages + (s * 2) + decalage + ((c - debut) * 2);
        if (p + 1 >= cmap.length) continue;
        glyphe = cmap.readUInt16BE(p);
        if (glyphe !== 0) glyphe = (glyphe + delta) & 0xffff;
      }
      if (glyphe !== 0) couvert.add(c);
    }
  }
  return couvert;
}

titre('rien ne peut partir vers un CDN de polices');
test('INTER COUVRE TOUT CE QUE L’ON AFFICHE — glyphes préchargés', () => {
  const ici = dirname(fileURLToPath(import.meta.url));
  const police = join(ici, '..', 'node_modules', '@fontsource', 'inter',
    'files', 'inter-latin-300-normal.woff');
  if (!existsSync(police)) { console.log('    (police absente — sauté)'); return; }
  const couvert = couvertureWoff(police);
  assert.ok(couvert.size > 200, `couverture illisible : ${couvert.size} glyphes`);
  const absents = [...GLYPHES_COURANTS].filter((c) => !couvert.has(c.codePointAt(0)));
  assert.deepEqual(absents, [], `hors d’Inter : ${absents.join('')}`);
  console.log(`    (${couvert.size} points de code dans le fichier livré)`);
});
test('…et tous les noms de salles et de portes du contenu', () => {
  const ici = dirname(fileURLToPath(import.meta.url));
  const police = join(ici, '..', 'node_modules', '@fontsource', 'inter',
    'files', 'inter-latin-300-normal.woff');
  const salles = join(ici, '..', 'content', 'rooms');
  if (!existsSync(police) || !existsSync(salles)) {
    console.log('    (police ou contenu absent — sauté)'); return;
  }
  const couvert = couvertureWoff(police);
  const fautifs = [];
  for (const f of readdirSync(salles).filter((n) => n.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(salles, f), 'utf8'));
    for (const nom of [j.label, ...(j.portals ?? []).map((p) => p.label)]) {
      for (const c of String(nom ?? '')) {
        if (c !== '\n' && !couvert.has(c.codePointAt(0))) fautifs.push(`${nom} → ${c}`);
      }
    }
  }
  assert.deepEqual(fautifs, [], fautifs.join(', '));
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
