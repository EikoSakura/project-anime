const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Quest Creator -- a GM tool for creating quests and adding them to a
 * party actor's quest log or generating a formatted JournalEntry.
 *
 * Opened via ShardsQuestCreator.open().
 */
export class ShardsQuestCreator extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {ShardsQuestCreator|null} Singleton instance */
  static #instance = null;

  /**
   * Open (or focus) the Quest Creator.
   * @returns {ShardsQuestCreator}
   */
  static open() {
    if (this.#instance) {
      this.#instance.render(true);
      this.#instance.bringToFront();
      return this.#instance;
    }
    const creator = new this();
    this.#instance = creator;
    creator.render(true);
    return creator;
  }

  /* -------------------------------------------- */

  /** @type {object} Internal form state */
  #state = {
    title: "",
    rank: "F",
    status: "available",
    priority: "normal",
    description: "",
    rewards: "",
    gmNotes: "",
    objectives: [{ text: "", completed: false }],
    output: "party",
    partyActorId: ""
  };

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "shards-quest-creator",
    classes: ["shards-of-mana", "quest-creator"],
    position: { width: 580, height: 520 },
    window: {
      title: "SHARDS.Quest.CreatorTitle",
      resizable: true,
      icon: "fa-solid fa-scroll"
    },
    form: { submitOnChange: false },
    actions: {
      addObjective: ShardsQuestCreator.#onAddObjective,
      removeObjective: ShardsQuestCreator.#onRemoveObjective,
      create: ShardsQuestCreator.#onCreate
    }
  };

  /** @override */
  static PARTS = {
    content: {
      template: "systems/shards-of-mana/templates/apps/quest-creator.hbs",
      scrollable: [".quest-creator-content"]
    }
  };

  /* -------------------------------------------- */
  /*  Lifecycle                                    */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Bind all inputs with data-field to state
    for (const el of this.element.querySelectorAll("[data-field]")) {
      const field = el.dataset.field;
      el.addEventListener("change", () => {
        if (el.type === "radio") {
          this.#state[field] = el.value;
          this.render();
        } else {
          this.#state[field] = el.type === "number" ? Number(el.value) : el.value;
        }
      });
    }

    // Bind objective text inputs
    for (const el of this.element.querySelectorAll("[data-obj-index]")) {
      const idx = Number(el.dataset.objIndex);
      el.addEventListener("change", () => {
        if (this.#state.objectives[idx]) this.#state.objectives[idx].text = el.value;
      });
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    ShardsQuestCreator.#instance = null;
  }

  /* -------------------------------------------- */
  /*  Context Preparation                          */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.state = foundry.utils.deepClone(this.#state);

    // Rank options
    context.rankOptions = Object.entries(CONFIG.SHARDS.ranks).map(([value, labelKey]) => ({
      value,
      label: game.i18n.localize(labelKey),
      selected: value === this.#state.rank
    }));

    // Status options
    context.statusOptions = ["available", "active", "completed", "failed"].map(value => ({
      value,
      label: game.i18n.localize(`SHARDS.Quest.Status.${value.charAt(0).toUpperCase() + value.slice(1)}`),
      selected: value === this.#state.status
    }));

    // Priority options
    context.priorityOptions = ["low", "normal", "high", "urgent"].map(value => ({
      value,
      label: game.i18n.localize(`SHARDS.Quest.Priority.${value.charAt(0).toUpperCase() + value.slice(1)}`),
      selected: value === this.#state.priority
    }));

    // Party actors
    context.partyActors = game.actors.filter(a => a.type === "party").map(a => ({
      id: a.id,
      name: a.name,
      selected: a.id === this.#state.partyActorId
    }));
    if (context.partyActors.length && !this.#state.partyActorId) {
      this.#state.partyActorId = context.partyActors[0].id;
      context.partyActors[0].selected = true;
    }

    return context;
  }

  /* -------------------------------------------- */
  /*  Action Handlers                              */
  /* -------------------------------------------- */

  /**
   * Add a new objective row.
   */
  static #onAddObjective(event, target) {
    this.#state.objectives.push({ text: "", completed: false });
    this.render();
  }

  /**
   * Remove an objective by index.
   */
  static #onRemoveObjective(event, target) {
    const idx = Number(target.closest("[data-index]")?.dataset.index ?? target.dataset.index);
    if (!isNaN(idx) && this.#state.objectives[idx] !== undefined) {
      this.#state.objectives.splice(idx, 1);
      if (this.#state.objectives.length === 0) {
        this.#state.objectives.push({ text: "", completed: false });
      }
      this.render();
    }
  }

  /**
   * Validate and create the quest via the selected output mode.
   */
  static async #onCreate(event, target) {
    // Sync any un-changed inputs before creating
    this.#syncFormState();

    const state = this.#state;

    // Validate title
    if (!state.title.trim()) {
      ui.notifications.warn(game.i18n.localize("SHARDS.Quest.TitleRequired"));
      return;
    }

    // Filter out empty objectives
    const objectives = state.objectives.filter(o => o.text.trim());

    if (state.output === "party") {
      await this.#createPartyQuest(state, objectives);
    } else {
      await this.#createJournalEntry(state, objectives);
    }
  }

  /**
   * Read all current form values into state (in case user hasn't triggered change events).
   */
  #syncFormState() {
    for (const el of this.element.querySelectorAll("[data-field]")) {
      const field = el.dataset.field;
      if (el.type === "radio") {
        if (el.checked) this.#state[field] = el.value;
      } else {
        this.#state[field] = el.type === "number" ? Number(el.value) : el.value;
      }
    }
    for (const el of this.element.querySelectorAll("[data-obj-index]")) {
      const idx = Number(el.dataset.objIndex);
      if (this.#state.objectives[idx]) this.#state.objectives[idx].text = el.value;
    }
  }

  /**
   * Add the quest to a party actor's quest log.
   * @param {object} state
   * @param {object[]} objectives
   */
  static async #createPartyQuest(state, objectives) {
    const party = game.actors.get(state.partyActorId);
    if (!party || party.type !== "party") {
      ui.notifications.warn(game.i18n.localize("SHARDS.Quest.NoPartySelected"));
      return;
    }

    const quest = {
      id: foundry.utils.randomID(),
      title: state.title.trim(),
      description: state.description,
      status: state.status,
      priority: state.priority,
      rewards: state.rewards,
      objectives: objectives.map(o => ({ text: o.text, completed: o.completed })),
      gmNotes: state.gmNotes
    };

    const quests = [...party.system.quests, quest];
    await party.update({ "system.quests": quests });

    ui.notifications.info(game.i18n.format("SHARDS.Quest.Created", { title: state.title.trim() }));
    this.close();
  }

  /**
   * Create a JournalEntry with formatted quest content.
   * @param {object} state
   * @param {object[]} objectives
   */
  static async #createJournalEntry(state, objectives) {
    const content = `<div class="quest-journal-entry">
  <p><strong>${game.i18n.localize("SHARDS.Rank")}:</strong> ${state.rank}</p>
  <p><strong>${game.i18n.localize("SHARDS.Quest.StatusLabel")}:</strong> ${state.status}</p>
  <p><strong>${game.i18n.localize("SHARDS.Quest.PriorityLabel")}:</strong> ${state.priority}</p>
  <h3>${game.i18n.localize("SHARDS.Quest.Description")}</h3>
  <p>${state.description || "&mdash;"}</p>
  <h3>${game.i18n.localize("SHARDS.Quest.Objectives")}</h3>
  <ul>${objectives.map(o => `<li>${o.completed ? "\u2611" : "\u2610"} ${o.text}</li>`).join("")}</ul>
  <h3>${game.i18n.localize("SHARDS.Quest.Rewards")}</h3>
  <p>${state.rewards || "&mdash;"}</p>
</div>`;

    const journal = await JournalEntry.create({
      name: `${game.i18n.localize("SHARDS.Quest.JournalPrefix")}: ${state.title.trim()}`,
      pages: [{
        name: state.title.trim(),
        type: "text",
        text: { content, format: 1 }
      }]
    });
    journal.sheet.render(true);

    ui.notifications.info(game.i18n.format("SHARDS.Quest.JournalCreated", { title: state.title.trim() }));
    this.close();
  }
}
