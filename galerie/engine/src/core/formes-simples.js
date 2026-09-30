/**
 * LES FORMES SIMPLES qu'un auteur choisit à la main — inspecteur (Apparence)
 * et plan de scène (Visuel). Un module PUR, sans three : le plan de scène
 * se teste au nœud et ne doit rien importer qui passe par le bundler.
 * Les clés sont celles de core/primitives.js (PRIMITIVES).
 */
export const FORMES_SIMPLES = [
  ['box', 'Cube'], ['cylinder', 'Cylindre'], ['sphere', 'Sphère'], ['cone', 'Cône'],
  ['torus', 'Tore'], ['galet', 'Galet'], ['ruban', 'Ruban'], ['plane', 'Plan']
];
