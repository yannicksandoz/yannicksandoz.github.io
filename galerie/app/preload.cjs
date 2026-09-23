/**
 * Le pont, minuscule : la page sait qu'elle tourne dans l'application, et
 * laquelle ; et elle peut lire et écrire dans les dossiers que
 * l'application lui autorise (le dossier de contenu, un dossier d'export
 * choisi dans une boîte native). Rien d'autre ne passe — pas de Node dans
 * la page, la galerie reste le site qu'elle est dans un navigateur.
 *
 * Côté page, editor/state/DossierApp.js habille `galerieApp.dossier` en
 * poignée compatible avec ce que Publication.js attend.
 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const version = (process.argv.find((a) => a.startsWith('--galerie-version=')) ?? '').split('=')[1] ?? '';

contextBridge.exposeInMainWorld('galerieApp', {
  version,
  plateforme: process.platform,
  dossier: {
    /** Le dossier de contenu : { id, nom } ou null. */
    contenu: () => ipcRenderer.invoke('dossier:contenu'),
    /** Une boîte native ; `but` : 'contenu' ou 'export'. { id, nom } ou null. */
    choisir: (but) => ipcRenderer.invoke('dossier:choisir', but),
    lister: (id, rel) => ipcRenderer.invoke('fs:lister', id, rel),
    existe: (id, rel) => ipcRenderer.invoke('fs:existe', id, rel),
    lire: (id, rel) => ipcRenderer.invoke('fs:lire', id, rel),
    ecrire: (id, rel, donnees) => ipcRenderer.invoke('fs:ecrire', id, rel, donnees),
    creerDossier: (id, rel) => ipcRenderer.invoke('fs:creerDossier', id, rel),
    supprimer: (id, rel, recursive) => ipcRenderer.invoke('fs:supprimer', id, rel, recursive)
  }
});
