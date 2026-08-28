/**
 * POURQUOI LE SCAN NE SE DESSINE PAS — le diagnostic, sur l'appareil.
 *
 * J'ai eu tort deux fois sur cette panne, et les deux fois faute de
 * pouvoir REGARDER. La première explication — Safari refuse une mémoire
 * WebAssembly partagée hors isolation — est morte le jour où
 * `capacites.html` a répondu « acceptée » sur l'iPhone de l'auteur. Une
 * hypothèse qu'on ne peut pas confronter à l'appareil ne vaut rien.
 *
 * Cette page charge donc le VRAI scan, avec la VRAIE bibliothèque, dans le
 * navigateur qui l'ouvre, et raconte chaque étape à voix haute :
 *
 *   1. le contexte WebGL2 existe-t-il, et de quel processeur graphique ;
 *   2. un TÉMOIN — un cube ordinaire — arrive-t-il jusqu'aux pixels. Sans
 *      lui, un « rien de dessiné » à l'étape 6 ne prouverait rien : il
 *      pourrait accuser le scan alors que c'est la lecture du tampon, ou
 *      la toile elle-même, qui ne marche pas ;
 *   3. le fichier arrive-t-il (code HTTP, octets) ;
 *   4. la bibliothèque le décode-t-elle (combien de taches) ;
 *   5. le programme de shader COMPILE-t-il — trois candidats sérieux, et
 *      three.js ne les crie que dans une console que le téléphone n'a pas.
 *      On accroche `renderer.debug.onShaderError` pour les attraper ;
 *   6. et enfin : des pixels changent-ils vraiment ? On rend une image, on
 *      lit le tampon, on compte. C'est la seule question qui compte.
 *
 * Tout ce qui passe par `console.error`, `console.warn`, `onerror` ou une
 * promesse rejetée est recopié en bas de page, mot pour mot. Rien n'est
 * envoyé nulle part.
 *
 * On rend avec un renderer NU — pas le pipeline de la galerie. Si le scan
 * apparaît ici et pas dans la salle, la faute est dans notre pipeline ; s'il
 * n'apparaît ni ici ni là, elle est dans la bibliothèque ou dans le pilote.
 * C'est le partage qu'aucune capture d'écran ne donne.
 */
import * as THREE from 'three';

const journal = [];
const bavarder = (t) => {
  journal.push(t);
  const el = document.getElementById('journal');
  if (el) el.textContent = journal.join('\n');
};

/* On capte AVANT tout le reste : une erreur de chargement de module
 * arriverait sinon dans le vide. */
const aplatir = (a) => a
  .map((x) => (x && x.message) ? x.message : String(x)).join(' ').slice(0, 600);
for (const voie of ['error', 'warn']) {
  const origine = console[voie].bind(console);
  console[voie] = (...a) => { bavarder('· ' + aplatir(a)); origine(...a); };
}
window.addEventListener('error', (e) => bavarder('! ' + (e.message || 'erreur') + ' — '
  + (e.filename || '').split('/').pop() + ':' + (e.lineno ?? '?')));
window.addEventListener('unhandledrejection', (e) => bavarder('! promesse rejetée : '
  + String(e.reason?.message ?? e.reason).slice(0, 400)));

const dire = (id, etat, verdict, note = '') => {
  const li = document.getElementById(id);
  if (!li) return;
  li.className = 'sonde ' + etat;
  li.querySelector('.verdict').textContent = verdict;
  li.querySelector('.note').textContent = note;
};

/** L'URL du scan, telle que le contenu la déclare (works/onde-stationnaire.json). */
const SCAN = 'assets/scans/onde-stationnaire.splat';
/** Le fond : on compte les pixels qui s'en écartent. */
const FOND = 0x101018;

/** Rend quelques images, en laissant le navigateur respirer entre chacune. */
async function rendre(renderer, scene, cam, images) {
  for (let i = 0; i < images; i++) {
    renderer.render(scene, cam);
    await new Promise((r) => requestAnimationFrame(r));
  }
}

/**
 * Combien de pixels s'écartent du fond, en pourcentage de l'image.
 * `preserveDrawingBuffer` est indispensable : sans lui, le tampon est
 * recyclé après la présentation et l'on ne lit que du noir.
 */
function partDessinee(renderer) {
  const gl = renderer.getContext();
  const l = renderer.domElement.width, h = renderer.domElement.height;
  const px = new Uint8Array(l * h * 4);
  gl.readPixels(0, 0, l, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const r0 = (FOND >> 16) & 255, v0 = (FOND >> 8) & 255, b0 = FOND & 255;
  let differents = 0;
  for (let i = 0; i < px.length; i += 4) {
    // on tolère largement : la conversion de l'espace colorimétrique déplace
    // le fond de quelques unités selon les navigateurs
    if (Math.abs(px[i] - r0) + Math.abs(px[i + 1] - v0) + Math.abs(px[i + 2] - b0) > 24) {
      differents++;
    }
  }
  return (differents / (l * h)) * 100;
}

async function diagnostiquer() {
  // ---------------------------------------------------------------- 1 ---
  const toile = document.getElementById('vue');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: toile, antialias: false,
      // sans cela, lire le tampon après le rendu rend du noir
      preserveDrawingBuffer: true
    });
  } catch (e) {
    dire('gl', 'non', 'impossible', String(e.message).slice(0, 200));
    return;
  }
  const gl = renderer.getContext();
  let nom = '';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (ext) nom = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
  dire('gl', 'oui', renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1 seulement',
    `${nom || 'processeur non déclaré'} · texture max `
    + `${gl.getParameter(gl.MAX_TEXTURE_SIZE)} px · flottantes `
    + (gl.getExtension('OES_texture_float_linear') ? 'filtrables' : 'non filtrables'));

  // LE SUSPECT NUMÉRO UN : un shader qui refuse de compiler. three.js ne le
  // dit qu'à la console ; on l'attrape et on l'écrit sur la page.
  let shaderFautif = null;
  renderer.debug.onShaderError = (ctx, programme, vertex, fragment) => {
    const journalGL = (s) => (ctx.getShaderInfoLog(s) || '').trim().slice(0, 400);
    shaderFautif = [ctx.getProgramInfoLog(programme), journalGL(vertex), journalGL(fragment)]
      .filter(Boolean).join(' | ').slice(0, 600) || 'refus sans message';
    dire('shader', 'non', 'refusé', shaderFautif);
    bavarder('!! shader refusé : ' + shaderFautif);
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOND);
  const cam = new THREE.PerspectiveCamera(55, 1 / 0.62, 0.1, 100);
  cam.position.set(0, 0.6, 4.5);
  cam.lookAt(0, 0, 0);
  renderer.setSize(toile.clientWidth || 320,
    Math.round((toile.clientWidth || 320) * 0.62), false);

  // ---------------------------------------------------------------- 2 ---
  // LE TÉMOIN. Un cube blanc, aucun rapport avec les scans. S'il ne compte
  // pas de pixels, ce n'est pas le scan qui est en cause : c'est la toile
  // ou la lecture du tampon, et tout ce qui suit serait à jeter.
  const temoin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.6, 1.6),
    new THREE.MeshBasicMaterial({ color: 0x8a7fd6 })
  );
  scene.add(temoin);
  await rendre(renderer, scene, cam, 3);
  const partTemoin = partDessinee(renderer);
  scene.remove(temoin);
  temoin.geometry.dispose();
  temoin.material.dispose();
  if (partTemoin > 1) {
    dire('temoin', 'oui', `${partTemoin.toFixed(1)} % de l’image`,
      'la toile dessine et le tampon se relit : la mesure du bas est fiable.');
  } else {
    dire('temoin', 'non', 'rien de dessiné',
      'même un cube ordinaire n’arrive pas aux pixels — la panne n’a alors '
      + 'rien à voir avec les scans, et les étapes suivantes ne prouvent rien.');
  }

  // ---------------------------------------------------------------- 3 ---
  try {
    const r = await fetch(SCAN);
    if (!r.ok) {
      dire('fichier', 'non', `HTTP ${r.status}`, SCAN);
      return;
    }
    const octets = (await r.arrayBuffer()).byteLength;
    dire('fichier', 'oui', `${(octets / 1024).toFixed(0)} ko`,
      `${SCAN} · type « ${r.headers.get('content-type') || 'non déclaré'} »`);
  } catch (e) {
    dire('fichier', 'non', 'inaccessible', String(e.message).slice(0, 200));
    return;
  }

  // ---------------------------------------------------------------- 4 ---
  let groupe = null;
  const t0 = performance.now();
  try {
    const { creerScan } = await import('./core/scans.js');
    groupe = await creerScan(SCAN, { taille: [4, 1.4, 4] });
    let maille = null;
    groupe.traverse((o) => { if (typeof o.getSplatCount === 'function') maille = o; });
    const n = maille?.getSplatCount?.() ?? 0;
    const ms = Math.round(performance.now() - t0);
    if (n > 0) {
      dire('decode', 'oui', `${n.toLocaleString('fr')} taches`,
        `la bibliothèque a lu le fichier en ${ms} ms`);
    } else {
      dire('decode', 'non', 'aucune tache',
        'le fichier est lu mais vide, ou le décodage a échoué en silence');
    }
  } catch (e) {
    // `scans.js` rattache la cause que la bibliothèque efface : on la dit,
    // car c'est elle qui nomme la panne, jamais le message d'enveloppe.
    const cause = e?.cause ? ` [${e.cause.message ?? e.cause}]` : '';
    dire('decode', 'non', 'échec', (String(e?.message ?? e) + cause).slice(0, 400));
    bavarder('!! chargement du scan : ' + String(e?.message ?? e) + cause);
    return;
  }

  // ---------------------------------------------------------------- 5-6 -
  // Soixante images de vingt et un mille taches, c'est long sur un
  // téléphone : sans ces deux lignes, la page a l'air figée juste avant de
  // répondre à la seule question qui compte, et l'on referme trop tôt.
  dire('shader', 'info', 'en cours…', 'on rend soixante images');
  dire('pixels', 'info', 'en cours…', 'patientez, c’est la dernière étape');
  scene.add(groupe);
  // le tri des taches se fait sur quelques images, et il passe par un
  // worker : on laisse largement le temps aux allers-retours
  await rendre(renderer, scene, cam, 60);
  if (!shaderFautif) dire('shader', 'oui', 'compilé', 'aucun refus signalé');

  // LA SEULE QUESTION QUI COMPTE : des pixels ont-ils changé ?
  const part = partDessinee(renderer);
  if (part > 0.5) {
    dire('pixels', 'oui', `${part.toFixed(1)} % de l’image`,
      'le scan SE DESSINE ici. S’il reste invisible dans la salle, la faute '
      + 'est dans le pipeline de la galerie, pas dans la bibliothèque.');
  } else if (partTemoin > 1) {
    dire('pixels', 'non', 'rien de dessiné',
      'le témoin est passé, les taches sont décodées, et pourtant rien '
      + 'n’arrive à l’écran : la faute est dans la bibliothèque ou dans le '
      + 'pilote. Le message ci-dessous, s’il y en a un, dit lequel.');
  } else {
    dire('pixels', 'non', 'rien de dessiné',
      'mais le témoin non plus : la lecture du tampon n’est pas fiable sur '
      + 'cet appareil. Fiez-vous à l’image ci-dessus, pas à ce chiffre.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  diagnostiquer().catch((e) => bavarder('! ' + String(e?.message ?? e)));
});
