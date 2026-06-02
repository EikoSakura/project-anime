const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * GM settings form for Character Creation rules.
 * Manages stat pool, growth pool, gold budget, etc.
 */
export class ShardsCharGenSettings extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "shards-chargen-settings",
    classes: ["shards-of-mana", "chargen-settings"],
    position: { width: 620, height: "auto" },
    window: {
      title: "SHARDS.CharGen.SettingsTitle",
      resizable: false,
      icon: "fa-solid fa-wand-magic-sparkles"
    },
    form: {
      handler: ShardsCharGenSettings.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    },
    actions: {
      resetDefaults: ShardsCharGenSettings.#onResetDefaults
    }
  };

  static PARTS = {
    form: {
      template: "systems/shards-of-mana/templates/apps/chargen/chargen-settings.hbs"
    }
  };

  /** Default values for all chargen settings. */
  static DEFAULTS = {
    chargenStatPool: 40,
    chargenStatCap: 25,
    chargenGrowthPool: 200,
    chargenGrowthMin: 10,
    chargenGrowthMax: 60,
    chargenStartingGold: 250
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.statPool = game.settings.get("shards-of-mana", "chargenStatPool");
    context.statCap = game.settings.get("shards-of-mana", "chargenStatCap");
    context.growthPool = game.settings.get("shards-of-mana", "chargenGrowthPool");
    context.growthMin = game.settings.get("shards-of-mana", "chargenGrowthMin");
    context.growthMax = game.settings.get("shards-of-mana", "chargenGrowthMax");
    context.startingGold = game.settings.get("shards-of-mana", "chargenStartingGold");
    return context;
  }

  /**
   * Handle form submission — write each setting.
   */
  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    await game.settings.set("shards-of-mana", "chargenStatPool", Number(data.statPool) || 40);
    await game.settings.set("shards-of-mana", "chargenStatCap", Number(data.statCap) || 25);
    await game.settings.set("shards-of-mana", "chargenGrowthPool", Number(data.growthPool) || 200);
    await game.settings.set("shards-of-mana", "chargenGrowthMin", Number(data.growthMin) || 10);
    await game.settings.set("shards-of-mana", "chargenGrowthMax", Number(data.growthMax) || 60);
    await game.settings.set("shards-of-mana", "chargenStartingGold", Number(data.startingGold) || 250);
    ui.notifications.info(game.i18n.localize("SHARDS.CharGen.SettingsSaved"));
  }

  /**
   * Reset all fields to default values.
   */
  static #onResetDefaults(event, target) {
    const form = this.element.querySelector("form") ?? this.element;
    const defaults = ShardsCharGenSettings.DEFAULTS;
    const fields = {
      statPool: defaults.chargenStatPool,
      statCap: defaults.chargenStatCap,
      growthPool: defaults.chargenGrowthPool,
      growthMin: defaults.chargenGrowthMin,
      growthMax: defaults.chargenGrowthMax,
      startingGold: defaults.chargenStartingGold
    };
    for (const [name, value] of Object.entries(fields)) {
      const input = form.querySelector(`[name="${name}"]`);
      if (input) input.value = value;
    }
  }
}
