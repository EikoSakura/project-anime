const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Character Creation Wizard — an 8-step guided flow for building adventurer characters.
 * All wizard data lives in transient #state; the actor is only written on finalize.
 */
export class ShardsCharGenWizard extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {Actor} The actor being created/edited. */
  #actor;

  /** @type {number} Current step index (0-7). */
  #step = 0;

  /** Transient wizard state — never touches the actor until finalize(). */
  #state = {};

  /** Step definitions. */
  static STEPS = [
    { id: "identity",  icon: "fa-solid fa-id-card",         label: "SHARDS.CharGen.Step.Identity" },
    { id: "lineage",   icon: "fa-solid fa-dna",             label: "SHARDS.CharGen.Step.Lineage" },
    { id: "stats",     icon: "fa-solid fa-chart-bar",        label: "SHARDS.CharGen.Step.Stats" },
    { id: "growth",    icon: "fa-solid fa-arrow-trend-up",   label: "SHARDS.CharGen.Step.Growth" },
    { id: "job",       icon: "fa-solid fa-briefcase",        label: "SHARDS.CharGen.Step.Job" },
    { id: "equipment", icon: "fa-solid fa-shield",           label: "SHARDS.CharGen.Step.Equipment" },
    { id: "biography", icon: "fa-solid fa-book",             label: "SHARDS.CharGen.Step.Biography" },
    { id: "review",    icon: "fa-solid fa-check-circle",     label: "SHARDS.CharGen.Step.Review" }
  ];

  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "chargen-wizard"],
    position: { width: 720, height: 640 },
    window: {
      title: "SHARDS.CharGen.Title",
      resizable: true,
      icon: "fa-solid fa-wand-magic-sparkles"
    },
    form: { submitOnChange: false },
    actions: {
      nextStep:        ShardsCharGenWizard.#onNextStep,
      prevStep:        ShardsCharGenWizard.#onPrevStep,
      goToStep:        ShardsCharGenWizard.#onGoToStep,
      finalize:        ShardsCharGenWizard.#onFinalize,
      browseLineage:   ShardsCharGenWizard.#onBrowseLineage,
      removeLineage:   ShardsCharGenWizard.#onRemoveLineage,
      browseJobs:      ShardsCharGenWizard.#onBrowseJobs,
      browseEquipment: ShardsCharGenWizard.#onBrowseEquipment,
      removeJob:       ShardsCharGenWizard.#onRemoveJob,
      removeEquipment: ShardsCharGenWizard.#onRemoveEquipment,
      incrementStat:   ShardsCharGenWizard.#onIncrementStat,
      decrementStat:   ShardsCharGenWizard.#onDecrementStat,
      incrementGrowth: ShardsCharGenWizard.#onIncrementGrowth,
      decrementGrowth: ShardsCharGenWizard.#onDecrementGrowth,
    }
  };

  static PARTS = {
    shell: {
      template: "systems/shards-of-mana/templates/apps/chargen/chargen-shell.hbs",
      scrollable: [".chargen-step-content"]
    }
  };

  /* -------------------------------------------- */
  /*  Constructor                                 */
  /* -------------------------------------------- */

  constructor({ actor } = {}) {
    const uniqueId = `shards-chargen-wizard-${actor?.id ?? "new"}`;
    super({ id: uniqueId });
    this.#actor = actor;
    this.#state = this.#buildDefaultState();
    if (actor) this.#initializeFromActor(actor);
  }

  get title() {
    const base = game.i18n.localize("SHARDS.CharGen.Title");
    return this.#actor ? `${base}: ${this.#actor.name}` : base;
  }

  /* -------------------------------------------- */
  /*  State Initialization                        */
  /* -------------------------------------------- */

  #buildDefaultState() {
    const stats = {};
    const growthRates = {};
    for (const key of Object.keys(CONFIG.SHARDS.stats)) {
      stats[key] = 10;
      growthRates[key] = 25;
    }
    return {
      name: "",
      personalDetails: {
        age: "", height: "", weight: "", pronouns: "", gender: "",
        hairColor: "", eyeColor: "", skinTone: "", build: "", distinguishingFeatures: ""
      },
      selectedLineage: [],
      chosenSize: null,
      stats,
      growthRates,
      selectedJob: null,
      selectedEquipment: [],
      appearance: "",
      personality: "",
      biography: ""
    };
  }

  /**
   * Pre-populate state from an existing actor (for re-creation).
   * Items are NOT pre-populated — they are selection-based choices.
   */
  #initializeFromActor(actor) {
    const sys = actor.system;
    this.#state.name = actor.name ?? "";
    for (const key of Object.keys(CONFIG.SHARDS.stats)) {
      this.#state.stats[key] = sys.stats?.[key]?.base ?? 10;
      this.#state.growthRates[key] = sys.growthRates?.[key] ?? 25;
    }
    if (sys.personalDetails) {
      for (const key of Object.keys(this.#state.personalDetails)) {
        this.#state.personalDetails[key] = sys.personalDetails[key] ?? "";
      }
    }
    this.#state.appearance = sys.appearance ?? "";
    this.#state.personality = sys.personality ?? "";
    this.#state.biography = sys.biography ?? "";
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const step = this.#step;
    const stepDef = ShardsCharGenWizard.STEPS[step];

    // GM settings
    const settings = {
      statPool: game.settings.get("shards-of-mana", "chargenStatPool"),
      statCap: game.settings.get("shards-of-mana", "chargenStatCap"),
      growthPool: game.settings.get("shards-of-mana", "chargenGrowthPool"),
      growthMin: game.settings.get("shards-of-mana", "chargenGrowthMin"),
      growthMax: game.settings.get("shards-of-mana", "chargenGrowthMax"),
      startingGold: game.settings.get("shards-of-mana", "chargenStartingGold")
    };
    context.settings = settings;

    // Step navigation
    context.steps = ShardsCharGenWizard.STEPS.map((s, i) => ({
      ...s,
      localizedLabel: game.i18n.localize(s.label),
      index: i,
      number: i + 1,
      current: i === step,
      completed: i < step,
      accessible: i <= step
    }));
    context.currentStep = step;
    context.currentStepId = stepDef.id;
    context.currentStepLabel = game.i18n.localize(stepDef.label);
    context.stepNumber = step + 1;
    context.totalSteps = ShardsCharGenWizard.STEPS.length;
    context.isFirstStep = step === 0;
    context.isLastStep = step === ShardsCharGenWizard.STEPS.length - 1;
    context.isReviewStep = stepDef.id === "review";

    // State data
    context.state = foundry.utils.deepClone(this.#state);
    context.config = CONFIG.SHARDS;

    // Step-specific computed data
    switch (stepDef.id) {
      case "identity":
        break;

      case "lineage": {
        context.lineageCount = this.#state.selectedLineage.length;
        context.maxLineage = 1;
        // Lineages are body templates — enrich with innate traits for display
        if (this.#state.selectedLineage.length) {
          const sp = this.#state.selectedLineage[0];
          sp._innateTraits = sp.system?.innateTraits ?? [];
          sp._lineageIndex = 0;
        }
        break;
      }

      case "stats": {
        const baseTotal = Object.keys(CONFIG.SHARDS.stats).length * 10;
        const currentTotal = Object.values(this.#state.stats).reduce((s, v) => s + v, 0);
        context.statPool = settings.statPool;
        context.statCap = settings.statCap;
        context.remainingPoints = settings.statPool - (currentTotal - baseTotal);
        context.statEntries = Object.entries(CONFIG.SHARDS.stats).map(([key, labelKey]) => ({
          key,
          label: game.i18n.localize(labelKey),
          value: this.#state.stats[key],
          min: 10,
          max: settings.statCap,
          barPct: Math.floor(((this.#state.stats[key] - 10) / Math.max(settings.statCap - 10, 1)) * 100)
        }));
        break;
      }

      case "growth": {
        const currentTotal = Object.values(this.#state.growthRates).reduce((s, v) => s + v, 0);
        context.growthPool = settings.growthPool;
        context.remainingGrowth = settings.growthPool - currentTotal;
        context.growthEntries = Object.entries(CONFIG.SHARDS.stats).map(([key, labelKey]) => ({
          key,
          label: game.i18n.localize(labelKey),
          value: this.#state.growthRates[key],
          min: settings.growthMin,
          max: settings.growthMax,
          barPct: Math.floor((this.#state.growthRates[key] / Math.max(settings.growthMax, 1)) * 100)
        }));
        break;
      }

      case "equipment": {
        const spent = this.#state.selectedEquipment.reduce((s, e) => s + (e.goldValue ?? 0), 0);
        context.startingGold = settings.startingGold;
        context.spentGold = spent;
        context.remainingGold = settings.startingGold - spent;
        break;
      }

      case "review":
        context.summary = this.#buildReviewSummary(settings);
        break;
    }

    // Theme from actor
    context.sheetTheme = this.#actor?.getFlag("shards-of-mana", "sheetTheme") ?? "silver";

    return context;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);

    // Apply actor theme
    const theme = context.sheetTheme ?? "silver";
    if (theme !== "silver") {
      this.element.dataset.theme = theme;
    } else {
      delete this.element.dataset.theme;
    }

    // Bind form inputs to transient state
    this.#bindFormInputs();

    // Set up drag-drop for receiving items from browsers
    this.#setupDragDrop();
  }

  /* -------------------------------------------- */
  /*  Form Input Binding                          */
  /* -------------------------------------------- */

  #bindFormInputs() {
    for (const input of this.element.querySelectorAll("[data-chargen-field]")) {
      const field = input.dataset.chargenField;
      input.addEventListener("change", () => {
        const raw = input.value;
        const value = (input.type === "number" || input.dataset.chargenNumeric !== undefined)
          ? Number(raw) : raw;
        this.#setStateValue(field, value);
      });
    }
    for (const textarea of this.element.querySelectorAll("[data-chargen-textarea]")) {
      const field = textarea.dataset.chargenTextarea;
      textarea.addEventListener("change", () => {
        this.#setStateValue(field, textarea.value);
      });
    }
  }

  #setStateValue(dotPath, value) {
    const parts = dotPath.split(".");
    let obj = this.#state;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
  }

  #captureCurrentStepInputs() {
    for (const input of this.element.querySelectorAll("[data-chargen-field]")) {
      const field = input.dataset.chargenField;
      const raw = input.value;
      const value = (input.type === "number" || input.dataset.chargenNumeric !== undefined)
        ? Number(raw) : raw;
      this.#setStateValue(field, value);
    }
    for (const textarea of this.element.querySelectorAll("[data-chargen-textarea]")) {
      const field = textarea.dataset.chargenTextarea;
      this.#setStateValue(field, textarea.value);
    }
  }

  /* -------------------------------------------- */
  /*  Drag-Drop                                   */
  /* -------------------------------------------- */

  #setupDragDrop() {
    const dd = new DragDrop({
      dropSelector: ".chargen-step-content",
      callbacks: { drop: this.#onDrop.bind(this) }
    });
    dd.bind(this.element);
  }

  async #onDrop(event) {
    const data = TextEditor.getDragEventData(event);
    if (data.type !== "Item") return;
    const item = await fromUuid(data.uuid);
    if (!item) return;
    const stepId = ShardsCharGenWizard.STEPS[this.#step].id;

    switch (item.type) {
      case "lineage":
        if (stepId === "lineage") this.#addLineage(item);
        break;
      case "job":
        if (stepId === "job") {
          this.#state.selectedJob = this.#itemToSelection(item);
          this.render();
        }
        break;
      case "equipment":
        if (stepId === "equipment") this.#addEquipment(item);
        break;
    }
  }

  /* -------------------------------------------- */
  /*  Public API for Browser Integration          */
  /* -------------------------------------------- */

  /**
   * Called by Codex browsers opened in wizard mode.
   * Adds the item to the current step's selection.
   * @param {Item} item
   */
  addItemFromBrowser(item) {
    const stepId = ShardsCharGenWizard.STEPS[this.#step].id;
    switch (item.type) {
      case "lineage":
        if (stepId !== "lineage") {
          ui.notifications.warn(game.i18n.localize("SHARDS.CharGen.WrongStepLineage"));
          return;
        }
        this.#addLineage(item);
        break;
      case "job":
        if (stepId !== "job") {
          ui.notifications.warn(game.i18n.localize("SHARDS.CharGen.WrongStepJob"));
          return;
        }
        this.#state.selectedJob = this.#itemToSelection(item);
        this.render();
        break;
      case "equipment":
        if (stepId !== "equipment") {
          ui.notifications.warn(game.i18n.localize("SHARDS.CharGen.WrongStepEquipment"));
          return;
        }
        this.#addEquipment(item);
        break;
    }
  }

  /* -------------------------------------------- */
  /*  Item Selection Helpers                      */
  /* -------------------------------------------- */

  #itemToSelection(item) {
    return {
      uuid: item.uuid,
      name: item.name,
      img: item.img,
      goldValue: item.system.goldValue ?? 0,
      system: item.system.toObject ? item.system.toObject() : foundry.utils.deepClone(item.system)
    };
  }

  #addLineage(item) {
    if (this.#state.selectedLineage.length >= 1) {
      ui.notifications.warn(game.i18n.localize("SHARDS.Lineage.MaxLineage"));
      return;
    }
    this.#state.selectedLineage = [this.#itemToSelection(item)];
    this.render();
  }

  #addEquipment(item) {
    const startingGold = game.settings.get("shards-of-mana", "chargenStartingGold");
    const goldValue = item.system.goldValue ?? 0;
    const currentSpent = this.#state.selectedEquipment.reduce((s, e) => s + (e.goldValue ?? 0), 0);
    if (currentSpent + goldValue > startingGold) {
      ui.notifications.warn(game.i18n.localize("SHARDS.CharGen.Validation.OverBudget"));
      return;
    }
    this.#state.selectedEquipment.push(this.#itemToSelection(item));
    this.render();
  }

  /* -------------------------------------------- */
  /*  Step Validation                             */
  /* -------------------------------------------- */

  #validateStep(stepIndex) {
    const stepId = ShardsCharGenWizard.STEPS[stepIndex].id;

    switch (stepId) {
      case "identity":
        if (!this.#state.name.trim()) {
          ui.notifications.warn(game.i18n.localize("SHARDS.CharGen.Validation.NameRequired"));
          return false;
        }
        return true;

      case "lineage":
        if (this.#state.selectedLineage.length === 0) {
          ui.notifications.warn(game.i18n.localize("SHARDS.CharGen.Validation.LineageRequired"));
          return false;
        }
        if (this.#state.selectedLineage.length > 1) {
          ui.notifications.warn(game.i18n.localize("SHARDS.Lineage.MaxLineage"));
          return false;
        }
        return true;

      case "stats": {
        const baseTotal = Object.keys(CONFIG.SHARDS.stats).length * 10;
        const currentTotal = Object.values(this.#state.stats).reduce((s, v) => s + v, 0);
        const pool = game.settings.get("shards-of-mana", "chargenStatPool");
        const remaining = pool - (currentTotal - baseTotal);
        if (remaining !== 0) {
          ui.notifications.warn(game.i18n.format("SHARDS.CharGen.Validation.StatsRemaining", { remaining: Math.abs(remaining) }));
          return false;
        }
        const cap = game.settings.get("shards-of-mana", "chargenStatCap");
        for (const [key, val] of Object.entries(this.#state.stats)) {
          if (val > cap) {
            ui.notifications.warn(game.i18n.format("SHARDS.CharGen.Validation.StatOverCap", {
              stat: game.i18n.localize(CONFIG.SHARDS.stats[key]), cap
            }));
            return false;
          }
        }
        return true;
      }

      case "growth": {
        const currentTotal = Object.values(this.#state.growthRates).reduce((s, v) => s + v, 0);
        const pool = game.settings.get("shards-of-mana", "chargenGrowthPool");
        const remaining = pool - currentTotal;
        if (remaining !== 0) {
          ui.notifications.warn(game.i18n.format("SHARDS.CharGen.Validation.GrowthRemaining", { remaining: Math.abs(remaining) }));
          return false;
        }
        return true;
      }

      case "job":
        if (!this.#state.selectedJob) {
          ui.notifications.warn(game.i18n.localize("SHARDS.CharGen.Validation.JobRequired"));
          return false;
        }
        return true;

      case "equipment": {
        const budget = game.settings.get("shards-of-mana", "chargenStartingGold");
        const spent = this.#state.selectedEquipment.reduce((s, e) => s + (e.goldValue ?? 0), 0);
        if (spent > budget) {
          ui.notifications.warn(game.i18n.localize("SHARDS.CharGen.Validation.OverBudget"));
          return false;
        }
        return true;
      }

      case "biography":
      case "review":
        return true;
    }
    return true;
  }

  /* -------------------------------------------- */
  /*  Review Summary                              */
  /* -------------------------------------------- */

  #buildReviewSummary(settings) {
    const state = this.#state;
    const lineageName = state.selectedLineage[0]?.name ?? "";
    const baseTotal = Object.keys(CONFIG.SHARDS.stats).length * 10;
    const statTotal = Object.values(state.stats).reduce((s, v) => s + v, 0);
    const growthTotal = Object.values(state.growthRates).reduce((s, v) => s + v, 0);
    const spent = state.selectedEquipment.reduce((s, e) => s + (e.goldValue ?? 0), 0);

    return {
      name: state.name,
      lineageName,
      lineageItem: state.selectedLineage[0] ?? null,
      personalDetails: state.personalDetails,
      stats: Object.entries(CONFIG.SHARDS.stats).map(([key, labelKey]) => ({
        key,
        label: game.i18n.localize(labelKey),
        value: state.stats[key]
      })),
      statPointsUsed: statTotal - baseTotal,
      statPool: settings.statPool,
      growthRates: Object.entries(CONFIG.SHARDS.stats).map(([key, labelKey]) => ({
        key,
        label: game.i18n.localize(labelKey),
        value: state.growthRates[key]
      })),
      growthTotal,
      growthPool: settings.growthPool,
      job: state.selectedJob,
      equipment: state.selectedEquipment,
      goldSpent: spent,
      remainingGold: settings.startingGold - spent,
      startingGold: settings.startingGold,
      appearance: state.appearance,
      personality: state.personality,
      biography: state.biography
    };
  }

  /* -------------------------------------------- */
  /*  Navigation Actions                          */
  /* -------------------------------------------- */

  static #onNextStep(event, target) {
    this.#captureCurrentStepInputs();
    if (!this.#validateStep(this.#step)) return;
    this.#step = Math.min(this.#step + 1, ShardsCharGenWizard.STEPS.length - 1);
    this.render();
  }

  static #onPrevStep(event, target) {
    this.#captureCurrentStepInputs();
    this.#step = Math.max(this.#step - 1, 0);
    this.render();
  }

  static #onGoToStep(event, target) {
    const targetStep = Number(target.dataset.step);
    if (targetStep > this.#step) return; // Can only jump backwards
    this.#captureCurrentStepInputs();
    this.#step = targetStep;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Browse Actions                              */
  /* -------------------------------------------- */

  static #onBrowseLineage(event, target) {
    const browser = new CONFIG.SHARDS.applications.LineageBrowser();
    browser._wizardRef = this;
    browser.render(true);
  }

  static #onBrowseJobs(event, target) {
    const browser = new CONFIG.SHARDS.applications.JobBrowser();
    browser._wizardRef = this;
    browser.render(true);
  }

  static #onBrowseEquipment(event, target) {
    const browser = new CONFIG.SHARDS.applications.EquipmentBrowser();
    browser._wizardRef = this;
    browser.render(true);
  }

  /* -------------------------------------------- */
  /*  Remove Actions                              */
  /* -------------------------------------------- */

  static #onRemoveLineage(event, target) {
    const uuid = target.dataset.uuid;
    const idx = this.#state.selectedLineage.findIndex(s => s.uuid === uuid);
    if (idx >= 0) {
      this.#state.selectedLineage.splice(idx, 1);
    }
    this.render();
  }

  static #onRemoveJob(event, target) {
    this.#state.selectedJob = null;
    this.render();
  }

  static #onRemoveEquipment(event, target) {
    const index = Number(target.dataset.index);
    this.#state.selectedEquipment.splice(index, 1);
    this.render();
  }

  /* -------------------------------------------- */
  /*  Stat Increment/Decrement                    */
  /* -------------------------------------------- */

  static #onIncrementStat(event, target) {
    const key = target.dataset.stat;
    const cap = game.settings.get("shards-of-mana", "chargenStatCap");
    const pool = game.settings.get("shards-of-mana", "chargenStatPool");
    const baseTotal = Object.keys(CONFIG.SHARDS.stats).length * 10;
    const currentTotal = Object.values(this.#state.stats).reduce((s, v) => s + v, 0);
    const remaining = pool - (currentTotal - baseTotal);
    if (this.#state.stats[key] < cap && remaining > 0) {
      this.#state.stats[key]++;
      this.render();
    }
  }

  static #onDecrementStat(event, target) {
    const key = target.dataset.stat;
    if (this.#state.stats[key] > 10) {
      this.#state.stats[key]--;
      this.render();
    }
  }

  /* -------------------------------------------- */
  /*  Growth Increment/Decrement                  */
  /* -------------------------------------------- */

  static #onIncrementGrowth(event, target) {
    const key = target.dataset.stat;
    const max = game.settings.get("shards-of-mana", "chargenGrowthMax");
    const pool = game.settings.get("shards-of-mana", "chargenGrowthPool");
    const currentTotal = Object.values(this.#state.growthRates).reduce((s, v) => s + v, 0);
    const remaining = pool - currentTotal;
    if (this.#state.growthRates[key] < max && remaining > 0) {
      const increment = Math.min(5, remaining, max - this.#state.growthRates[key]);
      this.#state.growthRates[key] += increment;
      this.render();
    }
  }

  static #onDecrementGrowth(event, target) {
    const key = target.dataset.stat;
    const min = game.settings.get("shards-of-mana", "chargenGrowthMin");
    if (this.#state.growthRates[key] > min) {
      this.#state.growthRates[key] -= 5;
      if (this.#state.growthRates[key] < min) this.#state.growthRates[key] = min;
      this.render();
    }
  }

  /* -------------------------------------------- */
  /*  Finalize — Apply to Actor                   */
  /* -------------------------------------------- */

  static async #onFinalize(event, target) {
    this.#captureCurrentStepInputs();

    // Validate all steps
    for (let i = 0; i < ShardsCharGenWizard.STEPS.length - 1; i++) {
      if (!this.#validateStep(i)) {
        this.#step = i;
        this.render();
        return;
      }
    }

    const actor = this.#actor;
    if (!actor) return;

    // Warn about overwriting if actor has existing data
    const hasExistingData = actor.items.size > 0 || actor.system.level > 1;
    if (hasExistingData) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("SHARDS.CharGen.OverwriteTitle") },
        content: game.i18n.localize("SHARDS.CharGen.OverwriteWarning"),
        yes: { label: game.i18n.localize("SHARDS.CharGen.OverwriteConfirm") },
        no: { label: game.i18n.localize("SHARDS.Cancel") }
      });
      if (!confirmed) return;
    }

    // Delete existing items of the types we're about to create
    const existingItemIds = actor.items
      .filter(i => ["job", "equipment", "lineage"].includes(i.type))
      .map(i => i.id);
    if (existingItemIds.length) {
      await actor.deleteEmbeddedDocuments("Item", existingItemIds);
    }

    // Build actor update
    const spent = this.#state.selectedEquipment.reduce((s, e) => s + (e.goldValue ?? 0), 0);
    const startingGold = game.settings.get("shards-of-mana", "chargenStartingGold");
    const updateData = {
      name: this.#state.name,
      "system.level": 1,
      "system.xp.current": 0,
      "system.xp.total": 0,
      "system.gold": startingGold - spent,
      "system.appearance": this.#state.appearance,
      "system.personality": this.#state.personality,
      "system.biography": this.#state.biography
    };

    // Stats
    for (const key of Object.keys(CONFIG.SHARDS.stats)) {
      updateData[`system.stats.${key}.base`] = this.#state.stats[key];
    }

    // Growth rates
    for (const key of Object.keys(CONFIG.SHARDS.stats)) {
      updateData[`system.growthRates.${key}`] = this.#state.growthRates[key];
    }

    // Personal details
    for (const [key, value] of Object.entries(this.#state.personalDetails)) {
      updateData[`system.personalDetails.${key}`] = value;
    }

    await actor.update(updateData);

    // Create embedded items
    const itemsToCreate = [];

    // Lineage (auto-grant hooks in actor.mjs will handle creating granted items)
    for (const lineage of this.#state.selectedLineage) {
      const lineageItem = await fromUuid(lineage.uuid);
      if (lineageItem) itemsToCreate.push(lineageItem.toObject());
    }

    // Job
    if (this.#state.selectedJob) {
      const jobItem = await fromUuid(this.#state.selectedJob.uuid);
      if (jobItem) itemsToCreate.push(jobItem.toObject());
    }

    // Equipment
    for (const equip of this.#state.selectedEquipment) {
      const equipItem = await fromUuid(equip.uuid);
      if (equipItem) {
        const obj = equipItem.toObject();
        obj.system.equipped = true;
        itemsToCreate.push(obj);
      }
    }

    if (itemsToCreate.length) {
      await actor.createEmbeddedDocuments("Item", itemsToCreate);
    }

    // Socket the starting job into the first available job socket on the grid
    const createdJob = actor.items.find(i => i.type === "job");
    if (createdJob) {
      const jobSocket = actor.system.grid?.sockets?.find(s => s.type === "job" && !s.itemId);
      if (jobSocket) {
        await actor.socketToGrid(jobSocket.id, createdJob.id);
      } else {
        // Fallback: set activeJobId directly if grid isn't ready yet
        await actor.update({ "system.activeJobId": createdJob.id });
      }
    }

    // Lineages are simple templates — no choices to apply; traits/resistances
    // are applied passively via the lineage item's data in prepareDerivedData.

    ui.notifications.info(game.i18n.format("SHARDS.CharGen.Complete", { name: actor.name }));
    this.close();
  }
}
