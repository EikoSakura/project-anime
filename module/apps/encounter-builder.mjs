const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Encounter Builder — GM tool for planning and creating monster encounters.
 * Calculates difficulty based on party composition and provides
 * recommendations for encounter construction.
 */
export class ShardsEncounterBuilder extends HandlebarsApplicationMixin(ApplicationV2) {

  /** Transient encounter state — not persisted. */
  #state = {
    partySize: 4,
    partyRank: "F",
    difficulty: "standard",
    roster: []
  };

  /* -------------------------------------------- */
  /*  Default Options                              */
  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "shards-encounter-builder",
    classes: ["shards-of-mana", "encounter-builder"],
    position: { width: 680, height: 600 },
    window: {
      title: "SHARDS.Encounter.Title",
      resizable: true,
      icon: "fa-solid fa-dragon"
    },
    actions: {
      addFromBrowser: ShardsEncounterBuilder.#onAddFromBrowser,
      removeMonster: ShardsEncounterBuilder.#onRemoveMonster,
      clearRoster: ShardsEncounterBuilder.#onClearRoster,
      createEncounter: ShardsEncounterBuilder.#onCreateEncounter
    }
  };

  /** @override */
  static PARTS = {
    content: {
      template: "systems/shards-of-mana/templates/apps/encounter-builder.hbs",
      scrollable: [".encounter-roster-list"]
    }
  };

  /* -------------------------------------------- */
  /*  Lifecycle                                    */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Bind form inputs to transient state
    this.#bindFormInputs();

    // Set up drag-drop for receiving monster actors
    this.#setupDragDrop();
  }

  /* -------------------------------------------- */
  /*  Form Input Binding                           */
  /* -------------------------------------------- */

  #bindFormInputs() {
    for (const input of this.element.querySelectorAll("[data-field]")) {
      const field = input.dataset.field;
      input.addEventListener("change", () => {
        const value = input.type === "number" ? Number(input.value) : input.value;
        this.#state[field] = value;
        this.render();
      });
    }
  }

  /* -------------------------------------------- */
  /*  Drag-Drop                                    */
  /* -------------------------------------------- */

  #setupDragDrop() {
    const dd = new DragDrop({
      dropSelector: ".encounter-builder-content",
      callbacks: { drop: this.#onDrop.bind(this) }
    });
    dd.bind(this.element);
  }

  async #onDrop(event) {
    const data = TextEditor.getDragEventData(event);
    if (data.type !== "Actor") return;
    const actor = await fromUuid(data.uuid);
    if (!actor || actor.type !== "monster") {
      ui.notifications.warn(game.i18n.localize("SHARDS.Encounter.OnlyMonsters"));
      return;
    }
    this.addMonsterFromBrowser(actor);
  }

  /* -------------------------------------------- */
  /*  Context Preparation                          */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = this.#state;

    context.state = foundry.utils.deepClone(state);
    context.config = CONFIG.SHARDS;

    // Build rank dropdown options
    context.rankOptions = Object.entries(CONFIG.SHARDS.ranks).map(([value, labelKey]) => ({
      value,
      label: game.i18n.localize(labelKey),
      selected: value === state.partyRank
    }));

    // Build difficulty dropdown options
    const difficulties = {
      easy: "SHARDS.Encounter.Easy",
      standard: "SHARDS.Encounter.Standard",
      hard: "SHARDS.Encounter.Hard",
      deadly: "SHARDS.Encounter.Deadly"
    };
    context.difficultyOptions = Object.entries(difficulties).map(([value, labelKey]) => ({
      value,
      label: game.i18n.localize(labelKey),
      selected: value === state.difficulty
    }));

    // Generate suggestion text
    context.suggestion = this.#buildSuggestion(state);

    // Roster data
    context.roster = state.roster;

    // Difficulty assessment
    if (state.roster.length) {
      const assessment = this.#assessDifficulty(state);
      context.assessmentLabel = game.i18n.localize(`SHARDS.Encounter.Assessment.${assessment.level}`);
      context.assessmentClass = assessment.level;
    }

    return context;
  }

  /* -------------------------------------------- */
  /*  Suggestion Logic                             */
  /* -------------------------------------------- */

  /**
   * Build a text suggestion for encounter composition based on party config.
   * @param {object} state
   * @returns {string}
   */
  #buildSuggestion(state) {
    const { partySize, partyRank, difficulty } = state;
    const rankOrder = CONFIG.SHARDS.rankOrder;
    const rankKeys = Object.keys(rankOrder);
    const currentIdx = rankOrder[partyRank];

    const rankBelow = currentIdx > 0 ? rankKeys[currentIdx - 1] : partyRank;
    const rankAbove = currentIdx < rankKeys.length - 1 ? rankKeys[currentIdx + 1] : partyRank;
    const rankTwoAbove = currentIdx < rankKeys.length - 2 ? rankKeys[currentIdx + 2] : rankAbove;

    let suggestion;
    switch (difficulty) {
      case "easy": {
        const optA = `${Math.max(1, Math.floor(partySize * 0.5))}--${Math.min(2, partySize)} Rank ${partyRank}`;
        const optB = `${Math.min(3, partySize)} Rank ${rankBelow}`;
        suggestion = game.i18n.format("SHARDS.Encounter.SuggestionEasy", { optionA: optA, optionB: optB });
        break;
      }
      case "standard": {
        const count = partySize;
        suggestion = game.i18n.format("SHARDS.Encounter.SuggestionStandard", { count, rank: partyRank });
        break;
      }
      case "hard": {
        const count = partySize;
        suggestion = game.i18n.format("SHARDS.Encounter.SuggestionHard", {
          count, rank: partyRank, eliteRank: rankAbove
        });
        break;
      }
      case "deadly": {
        const count = Math.ceil(partySize * 1.5);
        suggestion = game.i18n.format("SHARDS.Encounter.SuggestionDeadly", {
          count, rank: partyRank, bossRank: rankTwoAbove
        });
        break;
      }
    }
    return suggestion;
  }

  /* -------------------------------------------- */
  /*  Difficulty Assessment                        */
  /* -------------------------------------------- */

  /**
   * Assess the difficulty of the current roster versus the party configuration.
   * @param {object} state
   * @returns {{level: string, ratio: number}}
   */
  #assessDifficulty(state) {
    const rankOrder = CONFIG.SHARDS.rankOrder;
    const partyPower = state.partySize * (rankOrder[state.partyRank] + 1);
    const rosterPower = state.roster.reduce((sum, m) => sum + ((rankOrder[m.rank] ?? 0) + 1), 0);
    const ratio = rosterPower / Math.max(partyPower, 1);

    let level;
    if (ratio < 0.5) level = "trivial";
    else if (ratio < 0.8) level = "easy";
    else if (ratio < 1.2) level = "standard";
    else if (ratio < 1.6) level = "hard";
    else level = "deadly";

    return { level, ratio };
  }

  /* -------------------------------------------- */
  /*  Public API — Monster Browser Integration     */
  /* -------------------------------------------- */

  /**
   * Add a monster actor to the encounter roster.
   * Called by the MonsterBrowser when opened from this tool.
   * @param {Actor} actor  A monster-type actor document
   */
  addMonsterFromBrowser(actor) {
    this.#state.roster.push({
      uuid: actor.uuid,
      name: actor.name,
      img: actor.img ?? "icons/svg/mystery-man.svg",
      rank: actor.system.rank ?? "F",
      hp: actor.system.health?.max ?? 10
    });
    this.render();
  }

  /* -------------------------------------------- */
  /*  Action Handlers                              */
  /* -------------------------------------------- */

  /**
   * Open the Monster Browser for adding monsters.
   */
  static #onAddFromBrowser(event, target) {
    const browser = new CONFIG.SHARDS.applications.MonsterBrowser();
    browser._encounterBuilderRef = this;
    browser.render(true);
  }

  /**
   * Remove a monster from the roster by index.
   */
  static #onRemoveMonster(event, target) {
    const index = Number(target.dataset.index);
    if (Number.isInteger(index) && index >= 0 && index < this.#state.roster.length) {
      this.#state.roster.splice(index, 1);
      this.render();
    }
  }

  /**
   * Clear the entire roster.
   */
  static #onClearRoster(event, target) {
    this.#state.roster = [];
    this.render();
  }

  /**
   * Create world actors from the roster and optionally add them to combat.
   */
  static async #onCreateEncounter(event, target) {
    const roster = this.#state.roster;
    if (!roster.length) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("SHARDS.Encounter.CreateTitle") },
      content: `<p>${game.i18n.format("SHARDS.Encounter.CreateConfirm", { count: roster.length })}</p>`,
      yes: { label: game.i18n.localize("SHARDS.Encounter.Create") }
    });
    if (!confirmed) return;

    // Track name counts for numbering duplicates
    const nameCounts = {};
    const created = [];

    for (const entry of roster) {
      const source = await fromUuid(entry.uuid);
      if (!source) continue;

      // Create a copy in the world
      const actorData = source.toObject();

      // Number duplicates
      nameCounts[entry.name] = (nameCounts[entry.name] ?? 0) + 1;
      if (nameCounts[entry.name] > 1 || roster.filter(r => r.name === entry.name).length > 1) {
        actorData.name = `${actorData.name} ${nameCounts[entry.name]}`;
      }

      const actor = await Actor.create(actorData, { renderSheet: false });
      created.push(actor);
    }

    ui.notifications.info(game.i18n.format("SHARDS.Encounter.Created", { count: created.length }));

    // Optionally add to an active combat encounter
    if (game.combat && created.length) {
      const addToCombat = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("SHARDS.Encounter.AddToCombatTitle") },
        content: `<p>${game.i18n.localize("SHARDS.Encounter.AddToCombatPrompt")}</p>`,
        yes: { label: game.i18n.localize("SHARDS.Encounter.AddToCombat") }
      });
      if (addToCombat) {
        const combatants = created.map(a => ({ actorId: a.id }));
        await game.combat.createEmbeddedDocuments("Combatant", combatants);
      }
    }

    this.#state.roster = [];
    this.render();
  }
}
