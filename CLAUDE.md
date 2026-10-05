# Règles pour Claude Code — dépôt public du site (yannicksandoz.github.io)

La galerie 3D vit dans `galerie/` ; l'éditeur est un sous-module privé
(`galerie/engine/src/editor`, dépôt yr0-editor) qui a son propre CLAUDE.md.
Répondre en français.

## Argent : ne jamais rien déclencher qui coûte sans demande explicite

- **Ne jamais déclencher d'action pouvant coûter de l'argent sans demande
  EXPLICITE de Yannick** : lancer un workflow, pousser un tag ou une
  modification qui déclenche une CI payante, ajouter un runner, activer un
  service payant. Les minutes GitHub Actions ne comptent que dans le dépôt
  privé (yr0-editor) ; ce dépôt-ci est public, son déploiement Pages est
  gratuit.
- **Même sur demande explicite : AVANT d'agir, annoncer le coût estimé**
  (durée moyenne des derniers runs × tarif : Linux 0,006 $/min, Windows
  0,010 $/min, macOS 0,062 $/min — à revérifier en cas de doute ; dans le
  quota gratuit, macOS compte ×10 et Windows ×2) **et attendre une
  confirmation explicite.** En cas de doute sur le coût : demander.
- L'application auteur se construit **en local** (`npm run app:mac`, dans
  `galerie/`), jamais par CI par défaut. Le workflow privé « Application
  auteur » n'existe qu'à la demande, gardé par le mot `je-paie` ; le test
  `scripts/test-workflows-cout.mjs` échoue si un job macOS/Windows redevient
  déclenchable autrement.

## À la fin de toute session qui modifie du code

- **Dire explicitement si l'application doit être reconstruite, pourquoi,
  et rappeler la commande** (`npm run app:mac`). Elle doit l'être après un
  changement de `galerie/engine/`, `galerie/app/`, du sous-module éditeur,
  des partagés du build (`galerie/content/library`, `shaders`, `textures`),
  d'Electron ou des dépendances (`package.json`, `package-lock.json`).
- **Si seul le contenu a changé** (`content/works`, `rooms`, `audio`,
  `assets`, réglages), **dire que non** — l'application sert le dossier de
  contenu en direct — et rappeler qu'un `git push` suffit pour que le site
  public le voie (gratuit).
- Voir « Quand reconstruire l'application » dans `galerie/README.md`.

## Conduite du dépôt

- Aucune clé d'API dans le dépôt, jamais ; aucun jeton dans l'application.
- Rien de l'éditeur dans la version visiteur (`npm run check` le garde).
- Les tests Node (`npm test`) n'importent pas de module qui dépend du
  bundler ; un test qui touche à l'éditeur est sauté quand le sous-module
  est absent.
- Commiter l'éditeur d'abord, puis ce dépôt avec le pointeur du sous-module.
- Pas de pull request, pas de fusion vers master ni de publication sans
  que Yannick le dise.
