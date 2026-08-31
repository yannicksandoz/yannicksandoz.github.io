#!/usr/bin/env node
/**
 * Les deux pages STATIQUES de la galerie, générées au build depuis les
 * mêmes JSON que la scène (rooms/ + works/). Ni l'une ni l'autre n'a
 * besoin de JavaScript.
 *
 *  - `liste.html` — LE SEUIL. Ce qu'il y a à visiter : les pièces, le
 *    nombre d'œuvres de chacune. Pas les titres : le catalogue se gagne en
 *    visitant, et une page qui publierait tout d'avance déflorerait la
 *    visite pour qui arrive par un moteur de recherche. C'est aussi le
 *    repli quand WebGL2 manque, et la porte que l'écran d'accueil propose.
 *
 *  - `capacites.html` — CE QUE CET APPAREIL SAIT FAIRE. Une page de
 *    diagnostic, pas de visite : elle interroge le navigateur qui l'ouvre
 *    et l'écrit en clair. Elle existe parce qu'un iPhone n'a PAS de console
 *    — répondre à « est-ce que WebGPU marche chez toi ? » demandait
 *    autrement un Mac, un câble et le Web Inspector de Safari. Une URL
 *    qu'on ouvre au doigt vaut mieux.
 *
 *  - `catalogue.html` — LE CATALOGUE DE L'EXPOSITION. Complet : images,
 *    textes, extraits sonores, crédits obligatoires. Un lien visible y
 *    mène depuis le seuil, sans détour ni culpabilisation : l'expérience
 *    est le chemin par défaut, jamais une prison. Un catalogue s'est
 *    toujours acheté à la boutique — il ne remplace pas la salle, il la
 *    documente, et il rend le travail trouvable et citable.
 *
 * Usage : node scripts/genere-liste.mjs <dossier-de-sortie> (défaut dist)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// La règle du catalogue vit dans le moteur, pas ici : ce script la lit,
// comme le fait le panneau de la visite audio. Une seule vérité sur ce
// qu'est une œuvre et sur ce que dit sa carte.
import { esc, oeuvresDe, sectionHtml } from '../engine/src/core/catalogue.js';
import { collectCredits, collectSources } from '../engine/src/core/credits.js';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENU = process.env.GALERIE_CONTENT || join(RACINE, 'content');
const SORTIE = join(RACINE, process.argv[2] || 'dist');

const lireJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

const roomsIndex = await lireJson(join(CONTENU, 'rooms', 'index.json'));
const rooms = [];
for (const nom of roomsIndex) {
  rooms.push(await lireJson(join(CONTENU, 'rooms', nom)));
}

const works = new Map();
for (const nom of await lireJson(join(CONTENU, 'works', 'index.json'))) {
  const w = await lireJson(join(CONTENU, 'works', nom));
  works.set(w.id, w);
}

/** Ces pages sont écrites en français : elles portent leurs libellés en dur. */
const LIBELLES = {
  voir3d: 'Voir en 3D',
  enSavoirPlus: 'En savoir plus',
  visiter3d: 'visiter en 3D'
};

const habitees = rooms
  .map((r) => ({ room: r, oeuvres: oeuvresDe((r.works ?? []).map((id) => works.get(id))) }))
  .filter(({ oeuvres }) => oeuvres.length);

const toutes = habitees.flatMap(({ oeuvres }) => oeuvres);
const compte = (n) => `${n} œuvre${n > 1 ? 's' : ''}`;

/* --------------------------------------------------------------- style --- */

const STYLE = `    :root { --fg: #e8e6f2; --dim: #a09cb8; --accent: #b8a8ff; --bg: #08080f; }
    .sondes { list-style: none; padding: 0; }
    .sonde { border-left: 3px solid var(--dim); padding: .6rem 0 .6rem .9rem;
      margin: .9rem 0; }
    .sonde b { display: block; }
    .sonde .verdict { font-size: 1.25rem; }
    .sonde .note { display: block; color: var(--dim); font-size: .9rem;
      margin-top: .2rem; }
    .sonde.oui { border-left-color: #7fd6a0; }
    .sonde.oui .verdict { color: #7fd6a0; }
    .sonde.non { border-left-color: #e08a8a; }
    .sonde.non .verdict { color: #e08a8a; }
    .sonde.info { border-left-color: var(--accent); }
    .sonde.info .verdict { color: var(--accent); }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--bg); color: var(--fg);
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      line-height: 1.6; padding: 2.5rem 1.2rem 4rem;
      max-width: 46rem; margin: 0 auto;
    }
    h1 { font-weight: 300; letter-spacing: 0.14em; font-size: 1.7rem; }
    .retour { display: inline-block; margin: 0.8rem 0 2rem; color: var(--accent); }
    a { color: var(--accent); }
    a:hover, a:focus-visible { color: var(--fg); }
    section { margin-bottom: 2.8rem; }
    h2 {
      font-weight: 300; letter-spacing: 0.1em; font-size: 1.15rem;
      border-bottom: 1px solid rgba(255,255,255,0.12);
      padding-bottom: 0.4rem; margin-bottom: 1.2rem;
    }
    .salle-3d { font-size: 0.72rem; letter-spacing: 0.06em; margin-left: 0.8rem; }
    .oeuvre { margin-bottom: 1.8rem; }
    .oeuvre img { max-width: 100%; border-radius: 0.4rem; margin-bottom: 0.6rem; }
    h3 { font-weight: 400; font-size: 1rem; letter-spacing: 0.06em; }
    .meta { color: var(--accent); font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; }
    .oeuvre p { color: var(--dim); font-size: 0.9rem; margin-top: 0.3rem; }
    audio { width: 100%; margin-top: 0.6rem; }
    .liens { font-size: 0.85rem; }
    .salles { list-style: none; }
    .salles li { margin: 0.5rem 0; }
    .salles .nb { color: var(--dim); font-size: 0.85rem; margin-left: 0.5rem; }
    .tout {
      display: inline-block; margin-top: 1.4rem; padding: 0.55rem 1.2rem;
      border: 1px solid rgba(184,168,255,0.4); border-radius: 2rem;
      font-size: 0.9rem;
    }
    .credits { color: var(--dim); font-size: 0.85rem; }
    .credits p { margin: 0.5rem 0; }
    footer { color: var(--dim); font-size: 0.8rem; margin-top: 3rem; }`;

const page = ({ titre, description, corps }) => `<!doctype html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${esc(description)}">
  <meta name="theme-color" content="#05050a">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2305050a'/%3E%3Cpath d='M16 6 26 16 16 26 6 16Z' fill='none' stroke='%23ffb050' stroke-width='2.4' stroke-linejoin='round'/%3E%3C/svg%3E">
  <title>${esc(titre)}</title>
  <style>
${STYLE}
  </style>
</head>
<body>
${corps}
</body>
</html>
`;

/* ------------------------------------------------------------ le seuil --- */

const sallesListe = habitees.map(({ room, oeuvres }) =>
  `      <li><a href="./?room=${encodeURIComponent(room.id)}">${esc(room.title ?? room.id)}</a>
        <span class="nb">${compte(oeuvres.length)}</span></li>`).join('\n');

const seuil = page({
  titre: "Galerie — ce qu'il y a à visiter",
  description: "Une galerie d'art sonore : les pièces à visiter, en 3D ou "
    + "à l'oreille. Les œuvres se découvrent sur place.",
  corps: `  <h1>Galerie</h1>
  <p>Une galerie d'art sonore : en 3D, vos déplacements composent le mixage.
  Une visite audio, entièrement au clavier, en propose l'équivalent à l'oreille.</p>
  <a class="retour" href="./">← Entrer dans la galerie (casque recommandé)</a>
  <main>
    <section aria-labelledby="salles">
      <h2 id="salles">${habitees.length} pièces, ${compte(toutes.length)}</h2>
      <ul class="salles">
${sallesListe}
      </ul>
    </section>
    <p>Les œuvres ne sont pas nommées ici : elles se découvrent en visitant,
    et c'est une part du plaisir. Si vous préférez tout lire d'un coup —
    presse, recherche, ou simple curiosité — le catalogue complet est là.</p>
    <a class="tout" href="catalogue.html">Afficher le catalogue complet</a>
  </main>
  <footer>Les extraits audio s'écoutent au casque. La visite audio est
  accessible au clavier et au lecteur d'écran.</footer>`
});

/* -------------------------------------------------------- le catalogue --- */

const sections = habitees
  .map(({ room, oeuvres }) => sectionHtml(room, oeuvres, LIBELLES))
  .join('\n');

// Sur TOUTES les configurations, décor compris : une pierre empruntée se
// cite comme une œuvre empruntée. L'obligation suit l'objet, pas son rôle
// — et l'écran de crédits de la visite 3D compte pareil.
const tousLesObjets = [...works.values()];
const credits = collectCredits(tousLesObjets);
const sources = collectSources(tousLesObjets);
const MENTIONS = {
  polypizza: { label: 'Modèles fournis par Poly Pizza', url: 'https://poly.pizza' }
};

// Citer est une obligation, pas une politesse : les crédits figurent aussi
// dans le catalogue statique, sans quoi une consultation sans JavaScript
// montrerait des œuvres empruntées sans nommer personne.
const lignesSources = sources.map((s) => {
  const m = MENTIONS[s];
  return m
    ? `      <p><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.label)}</a></p>`
    : '';
}).filter(Boolean).join('\n');

const lignesCredits = credits.map((c) => {
  const qui = esc(c.author || 'auteur non précisé');
  const nom = c.sourceUrl
    ? `<a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">${qui}</a>`
    : qui;
  return `      <p><b>${nom}</b>${c.license ? ` — ${esc(c.license)}` : ''}`
    + `<br>${esc(c.titles.join(', '))}</p>`;
}).join('\n');

const blocCredits = (credits.length || sources.length)
  ? `\n    <section class="credits" aria-labelledby="credits">
      <h2 id="credits">Crédits</h2>
${[lignesSources, lignesCredits].filter(Boolean).join('\n')}
    </section>`
  : '';

const catalogue = page({
  titre: "Galerie — catalogue de l'exposition",
  description: "Le catalogue complet de la galerie d'art sonore : textes, "
    + 'images et extraits audio de toutes les œuvres.',
  corps: `  <h1>Catalogue</h1>
  <p>Toutes les œuvres de la galerie, à lire et à écouter. La visite, elle,
  se fait sur place — chaque œuvre y renvoie.</p>
  <a class="retour" href="./">← Entrer dans la galerie (casque recommandé)</a>
  <main>
${sections}${blocCredits}
  </main>
  <footer>Les extraits audio s'écoutent au casque. La visite audio est
  accessible au clavier et au lecteur d'écran.</footer>`
});

/* --------------------------------------------------- les capacités --- */

/*
 * On n'affiche que ce qui SERT à décider quelque chose, et chaque ligne dit
 * à quoi elle sert. Une page de diagnostic qui aligne trente drapeaux ne se
 * lit pas ; celle-ci répond à quatre questions qu'on s'est vraiment posées.
 */
const SONDE = `
const dire = (id, etat, valeur, note) => {
  const li = document.getElementById(id);
  li.className = 'sonde ' + etat;
  li.querySelector('.verdict').textContent = valeur;
  if (note) li.querySelector('.note').textContent = note;
};

// 1. WebGPU — décide si la migration du moteur vaut le voyage
(async () => {
  if (!navigator.gpu) return dire('gpu', 'non', 'non disponible',
    'Le moteur reste sur WebGL2.');
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return dire('gpu', 'non', 'refusé par l\\'appareil',
      'navigator.gpu existe, mais aucun adaptateur n\\'est accordé.');
    dire('gpu', 'oui', 'disponible',
      'Le tri des splats sur GPU et l\\'éclairage en clusters deviennent possibles.');
  } catch (e) { dire('gpu', 'non', 'erreur', String(e.message || e).slice(0, 120)); }
})();

// 2. WebGL2 — le socle actuel ; sans lui, la galerie 3D ne s'ouvre pas
(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) return dire('webgl', 'non', 'absent', 'La visite audio reste ouverte.');
  let nom = '';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (ext) nom = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
  dire('webgl', 'oui', 'présent', nom || 'processeur graphique non déclaré');
})();

// 3. Mémoire WASM partagée
//
// On a longtemps cru que c'était ELLE qui rendait les scans invisibles :
// hors contexte isolé, certains navigateurs refusent d'allouer une mémoire
// WebAssembly partagée, et le worker de tri meurt sans un mot. Cette sonde
// a démenti l'explication sur l'iPhone de l'auteur — « acceptée », et le
// scan reste pourtant invisible. Le contournement de scan-memoire.js est
// donc utile ailleurs, mais il ne soigne pas cette panne-là. Le vrai
// diagnostic se fait sur scan.html, qui charge le scan pour de bon.
//
// (Pas d'accent grave dans ce commentaire : il vit à l'intérieur du
// gabarit qui devient le script de la page.)
(() => {
  let partagee = false;
  try {
    new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    partagee = true;
  } catch (e) { partagee = false; }
  const isole = Boolean(window.crossOriginIsolated);
  if (partagee) {
    dire('wasm', 'oui', 'acceptée',
      isole ? 'Contexte isolé.' : 'Hors isolation, ce navigateur la tolère.');
  } else {
    dire('wasm', 'info', 'refusée hors isolation',
      'Le contournement de scan-memoire.js sert ici — mais il n\\'explique '
      + 'pas tout : voir scan.html.');
  }
})();

// 4. Le profil que la galerie choisirait sur cet appareil
(() => {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const mobile = coarse || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  dire('profil', 'info', mobile ? 'téléphone / tablette' : 'bureau',
    mobile
      ? 'Corniches en lignes analytiques, sonde d\\'ambiance, pas d\\'ombres portées.'
      : 'Sources étendues, ombres portées, occlusion ambiante.');
})();
`;

const capacites = page({
  titre: 'Galerie — ce que cet appareil sait faire',
  description: "Diagnostic : ce que le navigateur qui ouvre cette page sait "
    + 'faire, et ce que la galerie en déduit.',
  corps: `  <h1>Ce que cet appareil sait faire</h1>
  <p>Cette page n'est pas une visite : elle interroge le navigateur qui
  l'ouvre et l'écrit en clair. Elle existe parce qu'un téléphone n'a pas de
  console — et qu'une question technique ne devrait pas demander un câble.</p>
  <main>
    <ul class="sondes">
      <li id="gpu" class="sonde attente"><b>WebGPU</b>
        <span class="verdict">…</span><span class="note"></span></li>
      <li id="webgl" class="sonde attente"><b>WebGL2</b>
        <span class="verdict">…</span><span class="note"></span></li>
      <li id="wasm" class="sonde attente"><b>Mémoire WebAssembly partagée</b>
        <span class="verdict">…</span><span class="note"></span></li>
      <li id="profil" class="sonde attente"><b>Profil retenu</b>
        <span class="verdict">…</span><span class="note"></span></li>
    </ul>
  </main>
  <p>Un scan gaussien reste invisible chez vous ? <a href="./scan.html">La page
  qui le charge étape par étape</a> dit où ça casse.</p>
  <a class="retour" href="./">← Entrer dans la galerie</a>
  <footer>Rien n'est envoyé nulle part : tout est lu et affiché ici même.</footer>
  <script>${SONDE}</script>`
});

await writeFile(join(SORTIE, 'capacites.html'), capacites);
await writeFile(join(SORTIE, 'liste.html'), seuil);
await writeFile(join(SORTIE, 'catalogue.html'), catalogue);
console.log(`liste.html (seuil) + catalogue.html + capacites.html : ${toutes.length} œuvres, `
  + `${habitees.length} pièces habitées sur ${rooms.length} → ${SORTIE}`);
