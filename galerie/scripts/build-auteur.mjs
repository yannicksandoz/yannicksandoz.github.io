/**
 * LE BUILD AUTEUR, PORTABLE — `GALERIE_EDITOR=1 vite build` est une syntaxe
 * de shell POSIX ; `npm run` passe par cmd.exe sur Windows, qui l'ignore
 * (« 'GALERIE_EDITOR' is not recognized »). La variable se pose ici, en
 * Node, puis Vite construit dans dist-auteur/ et la liste se génère.
 * Lancer avec : npm run build:auteur
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const env = { ...process.env, GALERIE_EDITOR: '1' };
const vite = join(racine, 'node_modules', 'vite', 'bin', 'vite.js');

const etape = (args) => {
  const r = spawnSync(process.execPath, args, { cwd: racine, env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
etape([vite, 'build', '--outDir', 'dist-auteur']);
etape([join(ici, 'genere-liste.mjs'), 'dist-auteur']);
