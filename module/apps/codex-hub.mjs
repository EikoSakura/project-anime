const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Mana's Codex — Hub launcher for all item type browsers.
 * Accessible from Settings > System Settings (GM only).
 * Displays a card grid with one launcher card per item type.
 */
export class ShardsCodexHub extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "shards-codex-hub",
    classes: ["shards-of-mana", "codex-hub"],
    position: { width: 460, height: "auto" },
    window: {
      title: "SHARDS.CodexHub.Title",
      resizable: false,
      icon: "fa-solid fa-book-sparkles"
    },
    actions: {
      openBrowser: ShardsCodexHub.#onOpenBrowser
    }
  };

  /** @override */
  static PARTS = {
    main: {
      template: "systems/shards-of-mana/templates/apps/codex-hub.hbs"
    }
  };

  /**
   * Browser entries for the hub grid.
   * @type {object[]}
   */
  static BROWSERS = [
    {
      key: "JobBrowser",
      label: "SHARDS.CodexHub.Jobs",
      description: "SHARDS.CodexHub.JobsDesc",
      icon: "fa-solid fa-briefcase"
    },
    {
      key: "SkillBrowser",
      label: "SHARDS.CodexHub.Skills",
      description: "SHARDS.CodexHub.SkillsDesc",
      icon: "fa-solid fa-book-sparkles"
    },
    {
      key: "EquipmentBrowser",
      label: "SHARDS.CodexHub.Equipment",
      description: "SHARDS.CodexHub.EquipmentDesc",
      icon: "fa-solid fa-shield-halved"
    },
    {
      key: "ManaciteBrowser",
      label: "SHARDS.CodexHub.Manacite",
      description: "SHARDS.CodexHub.ManaciteDesc",
      icon: "fa-solid fa-gem"
    },
    {
      key: "LineageBrowser",
      label: "SHARDS.CodexHub.Lineage",
      description: "SHARDS.CodexHub.LineageDesc",
      icon: "fa-solid fa-dna"
    },
    {
      key: "MonsterBrowser",
      label: "SHARDS.CodexHub.Monsters",
      description: "SHARDS.CodexHub.MonstersDesc",
      icon: "fa-solid fa-dragon"
    },
    {
      key: "EncounterBuilder",
      label: "SHARDS.CodexHub.Encounter",
      description: "SHARDS.CodexHub.EncounterDesc",
      icon: "fa-solid fa-swords",
      gmOnly: true
    },
    {
      key: "QuestCreator",
      label: "SHARDS.CodexHub.Quest",
      description: "SHARDS.CodexHub.QuestDesc",
      icon: "fa-solid fa-scroll",
      gmOnly: true
    }
  ];

  /* -------------------------------------------- */
  /*  Context                                      */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.browsers = this.constructor.BROWSERS
      .filter(b => !b.gmOnly || game.user.isGM)
      .map(b => ({
        ...b,
        label: game.i18n.localize(b.label),
        description: game.i18n.localize(b.description)
      }));
    context.isGM = game.user.isGM;
    return context;
  }

  /* -------------------------------------------- */
  /*  Action Handlers                              */
  /* -------------------------------------------- */

  /**
   * Open the selected browser app.
   */
  static #onOpenBrowser(event, target) {
    const browserKey = target.dataset.browserKey;
    const BrowserClass = CONFIG.SHARDS.applications[browserKey];
    if (!BrowserClass) return;
    // Support singleton apps with a static open() method
    if (typeof BrowserClass.open === "function") {
      BrowserClass.open();
    } else {
      new BrowserClass().render(true);
    }
  }
}
