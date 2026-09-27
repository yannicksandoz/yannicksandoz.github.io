# yannicksandoz.github.io

Le site de Yannick Sandoz, en deux parties, déployées ensemble sur GitHub
Pages par `.github/workflows/deploy.yml` :

- **le blog**, à la racine — un site [Jekyll](https://jekyllrb.com) bâti sur
  le thème `github/personal-website` (`_config.yml`, `_layouts/`, `_posts/`…) ;
- **la galerie**, sous [`/galerie/`](https://yannicksandoz.github.io/galerie/)
  — une galerie d'art sonore en trois dimensions, à visiter dans le
  navigateur : des pièces reliées par des portails, des œuvres spatialisées
  en binaural, un mix qui se compose en marchant. Vite, three.js, Web Audio,
  sans backend ni service tiers.

Toute la documentation de la galerie est dans
[`galerie/README.md`](galerie/README.md) : le
[démarrage](galerie/README.md#démarrage) (`npm run dev`, `npm run build`,
`npm test`), l'expérience visiteur, la façon de décrire une œuvre et une
pièce, l'éditeur (dans un dépôt privé, sous-module) et l'application auteur.
Le déploiement construit le build Visiteur seul, lance la suite de tests et
deux garde-fous (rien de l'éditeur dans ce qui est publié, poids du build
sous ses seuils), puis assemble blog et galerie.

## License

**This repository does not have a single licence.** It combines components
under different terms, and the MIT licence below covers **only the Jekyll
theme** this site is derived from — never the `galerie/` directory.

| Location | Licence |
|---|---|
| Jekyll theme (`_config.yml`, `_data/`, `_includes/`, `_layouts/`, `_posts/`, `_sass/`, `assets/`, `index.html`) | [MIT](LICENSE-theme-MIT.txt) — © 2019 GitHub |
| `galerie/` except `content/` (`engine/`, `app/`, `scripts/`, `index.html`, `scan.html`, `vite.config.js` — exact list in the licence) | **Proprietary — all rights reserved**, © Yannick Sandoz. See [`galerie/engine/LICENSE`](galerie/engine/LICENSE) |
| `galerie/content/` | All rights reserved. See [`galerie/content/RIGHTS.md`](galerie/content/RIGHTS.md) |
| `galerie/content/library/` | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain) |

The full map is in [`LICENSE.txt`](LICENSE.txt); third-party components are
listed in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

### Commercial licence

The gallery engine is proprietary. No right of use, reproduction,
modification or redistribution is granted by default. For any use, a
commercial licence is available from Yannick Sandoz, the rights holder.

Contact: **yannicksandoz@gmail.com**

Please state: the intended use, the product or deployment context, the
organisation concerned and its size, and the scope you need. Reply within
about ten days. FR / EN.
