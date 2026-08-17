#!/usr/bin/env node
/**
 * Vue LISTE 2D — `liste.html`, généré au build depuis les mêmes JSON que la
 * scène (rooms/ + works/). Une page STATIQUE, sans JavaScript :
 *
 *  - le repli quand WebGL2 manque (l'écran d'accueil y mène) ;
 *  - la voie accessible : texte, images, lecteurs audio natifs ;
 *  - la face indexable de la galerie (les robots ne visitent pas la 3D).
 *
 * Chaque œuvre garde un pont vers la 3D (`./?work=id`) : la liste n'est pas
 * une impasse, c'est une autre porte.
 *
 * Usage : node scripts/genere-liste.mjs <dossier-de-sortie> (défaut dist)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENU = process.env.GALERIE_CONTENT || join(RACINE, 'content');
const SORTIE = join(RACINE, process.argv[2] || 'dist');

const lireJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

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

/** Premier fichier audio d'une œuvre (stem principal), ou null. */
const audioDe = (w) => w.stems?.find((s) => s.file)?.file ?? null;

const carte = (w) => {
  const meta = [w.year, w.technique].filter(Boolean).join(' · ');
  const audio = audioDe(w);
  return `      <article class="oeuvre">
        ${w.image ? `<img src="${esc(w.image)}" alt="${esc(w.title ?? w.id)}" loading="lazy">` : ''}
        <h3>${esc(w.title ?? w.id)}</h3>
        ${meta ? `<p class="meta">${esc(meta)}</p>` : ''}
        ${w.description ? `<p>${esc(w.description)}</p>` : ''}
        ${audio ? `<audio controls preload="none" src="${esc(audio)}"></audio>` : ''}
        <p class="liens">
          <a href="./?work=${encodeURIComponent(w.id)}">Voir en 3D</a>
          ${w.link ? ` · <a href="${esc(w.link)}" target="_blank" rel="noopener noreferrer">En savoir plus</a>` : ''}
        </p>
      </article>`;
};

const sections = rooms.map((r) => {
  const oeuvres = (r.works ?? [])
    .map((id) => works.get(id))
    .filter((w) => w && w.role !== 'decor' && !w.partOf);
  if (!oeuvres.length) return '';
  return `    <section aria-labelledby="salle-${esc(r.id)}">
      <h2 id="salle-${esc(r.id)}">${esc(r.title ?? r.id)}
        <a class="salle-3d" href="./?room=${encodeURIComponent(r.id)}">visiter en 3D</a></h2>
${oeuvres.map(carte).join('\n')}
    </section>`;
}).filter(Boolean).join('\n');

const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Les œuvres de la galerie d'art sonore, en liste : textes, images et extraits audio — la même collection que la visite 3D.">
  <meta name="theme-color" content="#05050a">
  <title>Galerie — les œuvres en liste</title>
  <style>
    :root { --fg: #e8e6f2; --dim: #a09cb8; --accent: #b8a8ff; --bg: #08080f; }
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
    footer { color: var(--dim); font-size: 0.8rem; margin-top: 3rem; }
  </style>
</head>
<body>
  <h1>Galerie</h1>
  <p>Une galerie d'art sonore : en 3D, vos déplacements composent le mixage.
  Cette page en est la version liste — les mêmes œuvres, à lire et à écouter.</p>
  <a class="retour" href="./">← Entrer dans la galerie 3D (casque recommandé)</a>
  <main>
${sections}
  </main>
  <footer>Les extraits audio s'écoutent au casque. La visite 3D propose aussi
  une visite audio guidée, accessible au clavier et au lecteur d'écran.</footer>
</body>
</html>
`;

await writeFile(join(SORTIE, 'liste.html'), html);
const nb = [...works.values()].filter((w) => w.role !== 'decor').length;
console.log(`liste.html : ${nb} œuvres, ${rooms.length} pièces → ${SORTIE}`);
