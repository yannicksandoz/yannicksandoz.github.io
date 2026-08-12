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
    const instance = new Klass(artwork, params ?? {}, app);
    // Le nom du type voyage avec l'instance : `constructor.name` disparaît
    // à la minification, ce champ non. C'est ce qui permet à la visite audio
    // de reconnaître un FocusCamera existant plutôt que d'en empiler un.
    instance.moduleType = type;
    return instance;
  }

  has(type) {
    return this._types.has(type);
  }
}

export const registry = new ModuleRegistry();
