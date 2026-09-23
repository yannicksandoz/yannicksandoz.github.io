/**
 * Le pont, minuscule : la page sait qu'elle tourne dans l'application, et
 * laquelle. Rien d'autre ne passe — pas de Node dans la page, la galerie
 * reste le site qu'elle est dans un navigateur.
 */
'use strict';
const { contextBridge } = require('electron');

const version = (process.argv.find((a) => a.startsWith('--galerie-version=')) ?? '').split('=')[1] ?? '';

contextBridge.exposeInMainWorld('galerieApp', {
  version,
  plateforme: process.platform
});
