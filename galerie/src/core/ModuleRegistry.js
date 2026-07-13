/**
 * Registre des modules de comportement. Chaque module est une classe
 * (voir src/modules/Module.js) enregistrée sous un nom de type, référencé
 * par le champ "modules" des fichiers de configuration d'œuvres.
 *
 * Pour ajouter un module :
 *   import { registry } from './core/ModuleRegistry.js';
 *   registry.register('MonModule', MonModule);
 */
class ModuleRegistry {
  constructor() {
    this._types = new Map();
  }

  register(type, klass) {
    this._types.set(type, klass);
  }

  create(type, artwork, params, app) {
    const Klass = this._types.get(type);
    if (!Klass) {
      console.warn(`[galerie] Module inconnu « ${type} » (œuvre ${artwork.config.id}) — ignoré.`);
      return null;
    }
    return new Klass(artwork, params ?? {}, app);
  }

  has(type) {
    return this._types.has(type);
  }
}

export const registry = new ModuleRegistry();
