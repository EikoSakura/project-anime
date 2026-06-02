const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Level Up Wizard — a multi-step guided flow for leveling up adventurer characters.
 * Supports multi-level-up sessions with growth rate rolling, rank advancement,
 * and a single summary chat card. All changes are transient until finalize.
 */
export class ShardsLevelUpWizard extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {Actor} The adventurer being leveled up. */
  #actor;

  /** @type {number} Current step index (0-3). */
  #step = 0;

  /** @type {number} Highest step reached (for navigation gating). */
  #maxStep = 0;

  /** Transient wizard state — never touches the actor until finalize(). */
  #state = {};

  /** Step definitions. */
  static STEPS = [
    { id: "overview",  icon: "fa-solid fa-scroll",        label: "SHARDS.LevelUp.Step.Overview" },
    { id: "growth",    icon: "fa-solid fa-dice-d20",       label: "SHARDS.LevelUp.Step.Growth" },
    { id: "summary",   icon: "fa-solid fa-chart-line",     label: "SHARDS.LevelUp.Step.Summary" },
    { id: "finalize",  icon: "fa-solid fa-check-double",   label: "SHARDS.LevelUp.Step.Finalize" }
  ];

  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "levelup-wizard"],
    position: { width: 640, height: 560 },
    window: {
      title: "SHARDS.LevelUp.Title",
      resizable: true,
      icon: "fa-solid fa-arrow-trend-up"
    },
    form: { submitOnChange: false },
    actions: {
      nextStep:      ShardsLevelUpWizard.#onNextStep,
      prevStep:      ShardsLevelUpWizard.#onPrevStep,
      goToStep:      ShardsLevelUpWizard.#onGoToStep,
      beginLevelUp:  ShardsLevelUpWizard.#onBeginLevelUp,
      rollGrowth:    ShardsLevelUpWizard.#onRollGrowth,
      continueLevel: ShardsLevelUpWizard.#onContinueLevel,
      finalize:      ShardsLevelUpWizard.#onFinalize
    }
  };

  static PARTS = {
    shell: {
      template: "systems/shards-of-mana/templates/apps/levelup/levelup-shell.hbs",
      scrollable: [".levelup-step-content"]
    }
  };

  /* -------------------------------------------- */
  /*  Constructor                                 */
  /* -------------------------------------------- */

  constructor({ actor } = {}) {
    const uniqueId = `shards-levelup-wizard-${actor?.id ?? "unknown"}`;
    super({ id: uniqueId });
    this.#actor = actor;
    this.#state = this.#buildDefaultState();
  }

  get title() {
    const base = game.i18n.localize("SHARDS.LevelUp.Title");
    return this.#actor ? `${base}: ${this.#actor.name}` : base;
  }

  /* -------------------------------------------- */
  /*  State Initialization                        */
  /* -------------------------------------------- */

  #buildDefaultState() {
    const system = this.#actor.system;
    const statKeys = Object.keys(CONFIG.SHARDS.stats);
    const maxLevels = system.maxLevelFromXp - system.level;

    return {
      // Snapshot of actor at wizard open
      originalLevel: system.level,
      originalRank: system.adventurerRank,
      originalStats: Object.fromEntries(statKeys.map(k => [k, system.stats[k].base])),

      // Accumulated changes
      currentLevel: system.level,
      currentRank: system.adventurerRank,
      statGains: Object.fromEntries(statKeys.map(k => [k, 0])),

      // Per-level roll records
      levelResults: [],

      // Tracking
      levelsGained: 0,
      maxAvailableLevels: maxLevels,
      rankChanged: false,
      finalRank: system.adventurerRank,

      // Growth roll step state
      growthRollPhase: "pending", // "pending" | "complete"
      currentLevelRolls: null
    };
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const step = this.#step;
    const stepDef = ShardsLevelUpWizard.STEPS[step];
    const system = this.#actor.system;

    // Step navigation
    context.steps = ShardsLevelUpWizard.STEPS.map((s, i) => ({
      ...s,
      localizedLabel: game.i18n.localize(s.label),
      index: i,
      number: i + 1,
      current: i === step,
      completed: i < step,
      accessible: i <= this.#maxStep && i <= step
    }));
    context.currentStep = step;
    context.currentStepId = stepDef.id;
    context.currentStepLabel = game.i18n.localize(stepDef.label);
    context.stepNumber = step + 1;
    context.totalSteps = ShardsLevelUpWizard.STEPS.length;

    // Step flags for footer buttons
    context.isOverviewStep = stepDef.id === "overview";
    context.isGrowthStep = stepDef.id === "growth";
    context.isSummaryStep = stepDef.id === "summary";
    context.isFinalizeStep = stepDef.id === "finalize";
    context.showBackButton = stepDef.id === "summary" || stepDef.id === "finalize";

    // State data (deep clone for safety)
    context.state = foundry.utils.deepClone(this.#state);

    // Actor info
    context.actorName = this.#actor.name;
    context.actorImg = this.#actor.img;
    context.lineage = system.lineage ?? "";

    // Active job
    const activeJob = this.#actor.items.get(system.activeJobId);
    if (activeJob) {
      context.activeJob = {
        name: activeJob.name,
        img: activeJob.img,
        rank: activeJob.system.rank
      };
    }

    // Can begin level-up
    context.canBeginLevelUp = this.#state.maxAvailableLevels > 0;

    // Theme from actor
    context.sheetTheme = this.#actor.getFlag("shards-of-mana", "sheetTheme") ?? "silver";

    // Step-specific data
    switch (stepDef.id) {
      case "overview": {
        context.growthRateDisplay = Object.entries(CONFIG.SHARDS.stats).map(([key, labelKey]) => ({
          key,
          label: game.i18n.localize(labelKey),
          value: system.growthRates[key],
          barPct: Math.min(system.growthRates[key] / 2, 100) // 200% max = 100% bar
        }));
        context.xpTotal = system.xp.total;
        context.xpPerLevel = CONFIG.SHARDS.xpPerLevel ?? 500;
        context.maxLevelFromXp = system.maxLevelFromXp;
        context.levelsAvailable = Math.max(0, system.maxLevelFromXp - system.level);
        break;
      }

      case "growth": {
        context.currentLevelTarget = this.#state.currentLevel + 1;
        context.totalLevelsThisSession = this.#state.levelsGained + 1;
        context.canLevelAgain = this.#state.maxAvailableLevels > 0;

        // Current level results
        if (this.#state.currentLevelRolls) {
          const lastResult = this.#state.levelResults[this.#state.levelResults.length - 1];
          context.currentLevelGains = lastResult?.totalGains ?? 0;
          context.currentLevelRankAdvanced = lastResult?.rankAdvanced ?? false;
          context.currentLevelOldRank = lastResult?.oldRank ?? null;
          context.currentLevelNewRank = lastResult?.newRank ?? null;
        }
        break;
      }

      case "summary":
      case "finalize": {
        context.statComparison = Object.entries(CONFIG.SHARDS.stats).map(([key, labelKey]) => {
          const before = this.#state.originalStats[key];
          const gain = this.#state.statGains[key];
          return {
            key,
            label: game.i18n.localize(labelKey),
            before,
            after: before + gain,
            gain,
            gained: gain > 0
          };
        });
        context.totalStatGains = Object.values(this.#state.statGains).reduce((s, v) => s + v, 0);
        break;
      }
    }

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
  }

  /* -------------------------------------------- */
  /*  Growth Rolls                                 */
  /* -------------------------------------------- */

  /**
   * Roll d100 for each of 8 stats against the actor's growth rates.
   * @returns {Promise<Array<{key, label, roll, displayRoll, growthRate, passed}>>}
   */
  async #performGrowthRolls() {
    const system = this.#actor.system;
    const statKeys = Object.keys(CONFIG.SHARDS.stats);
    const results = [];

    for (const key of statKeys) {
      const growthRate = system.growthRates[key];
      const roll = await new Roll("1d100").evaluate();
      const passed = roll.total <= growthRate;

      results.push({
        key,
        label: game.i18n.localize(CONFIG.SHARDS.stats[key]),
        roll: roll.total,
        displayRoll: String(roll.total).padStart(2, "0"),
        growthRate,
        passed
      });
    }

    return results;
  }

  /**
   * Process a single level-up using roll results. Updates transient state only.
   * @param {Array} rollResults - Output from #performGrowthRolls()
   */
  #processLevelUp(rollResults) {
    const state = this.#state;
    state.currentLevel += 1;
    state.levelsGained += 1;

    const gains = {};
    let totalGains = 0;
    for (const result of rollResults) {
      gains[result.key] = result.passed;
      if (result.passed) {
        state.statGains[result.key] += 1;
        totalGains += 1;
      }
    }

    // Check rank advancement
    const rankThresholds = CONFIG.SHARDS.adventurerRankThresholds;
    let newRank = state.currentRank;
    for (const [rank, threshold] of Object.entries(rankThresholds)) {
      if (state.currentLevel >= threshold) newRank = rank;
    }
    const rankAdvanced = newRank !== state.currentRank;
    const oldRank = state.currentRank;
    if (rankAdvanced) {
      state.currentRank = newRank;
      state.rankChanged = true;
      state.finalRank = newRank;
    }

    // Record this level's results
    state.levelResults.push({
      level: state.currentLevel,
      rolls: Object.fromEntries(rollResults.map(r => [r.key, r.roll])),
      growthRates: Object.fromEntries(rollResults.map(r => [r.key, r.growthRate])),
      gains,
      totalGains,
      rankAdvanced,
      newRank: rankAdvanced ? game.i18n.localize(CONFIG.SHARDS.ranks[newRank]) : null,
      oldRank: rankAdvanced ? game.i18n.localize(CONFIG.SHARDS.ranks[oldRank]) : null,
      rollResults
    });

    // Update remaining available levels (gated by XP)
    const xpPerLevel = CONFIG.SHARDS.xpPerLevel ?? 500;
    const maxFromXp = 1 + Math.floor(this.#actor.system.xp.total / xpPerLevel);
    state.maxAvailableLevels = maxFromXp - state.currentLevel;
  }

  /* -------------------------------------------- */
  /*  Navigation Actions                          */
  /* -------------------------------------------- */

  static #onNextStep(event, target) {
    if (this.#step < ShardsLevelUpWizard.STEPS.length - 1) {
      this.#step += 1;
      this.#maxStep = Math.max(this.#maxStep, this.#step);
      this.render();
    }
  }

  static #onPrevStep(event, target) {
    // Only allow going back to summary from finalize, never back into growth
    const currentId = ShardsLevelUpWizard.STEPS[this.#step].id;
    if (currentId === "finalize") {
      this.#step = 2; // summary
      this.render();
    } else if (currentId === "summary") {
      // Don't go back to growth — rolls are irreversible
      // Stay on summary
    }
  }

  static #onGoToStep(event, target) {
    const targetStep = Number(target.dataset.step);
    // Only allow jumping backward to completed steps, not into growth
    if (targetStep >= this.#step) return;
    const targetId = ShardsLevelUpWizard.STEPS[targetStep].id;
    if (targetId === "growth") return; // Never re-enter growth step
    this.#step = targetStep;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Level Up Actions                             */
  /* -------------------------------------------- */

  static #onBeginLevelUp(event, target) {
    if (this.#state.maxAvailableLevels <= 0) {
      ui.notifications.warn(game.i18n.localize("SHARDS.LevelUp.CannotLevelUpWizard"));
      return;
    }
    this.#step = 1; // growth step
    this.#maxStep = Math.max(this.#maxStep, 1);
    this.#state.growthRollPhase = "pending";
    this.#state.currentLevelRolls = null;
    this.render();
  }

  static async #onRollGrowth(event, target) {
    const rollResults = await this.#performGrowthRolls();
    this.#state.currentLevelRolls = rollResults;
    this.#processLevelUp(rollResults);
    this.#state.growthRollPhase = "complete";
    this.render();
  }

  static #onContinueLevel(event, target) {
    if (this.#state.maxAvailableLevels <= 0) {
      ui.notifications.warn(game.i18n.localize("SHARDS.LevelUp.CannotLevelUpWizard"));
      return;
    }
    this.#state.growthRollPhase = "pending";
    this.#state.currentLevelRolls = null;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Finalize — Apply to Actor                    */
  /* -------------------------------------------- */

  static async #onFinalize(event, target) {
    const actor = this.#actor;
    const state = this.#state;

    if (state.levelsGained === 0) {
      ui.notifications.warn(game.i18n.localize("SHARDS.LevelUp.CannotLevelUpWizard"));
      return;
    }

    // 1. Build actor update object
    const updateData = {
      "system.level": state.currentLevel
    };

    // 2. Apply accumulated stat gains
    for (const [key, gain] of Object.entries(state.statGains)) {
      if (gain > 0) {
        updateData[`system.stats.${key}.base`] = state.originalStats[key] + gain;
      }
    }

    // 3. Rank advancement
    if (state.rankChanged) {
      updateData["system.adventurerRank"] = state.finalRank;
    }

    // 4. Append level history entries
    const existingHistory = actor.system.levelHistory;
    const newHistoryEntries = state.levelResults.map(lr => ({
      level: lr.level,
      gains: lr.gains,
      rolls: lr.rolls,
      timestamp: Date.now()
    }));
    updateData["system.levelHistory"] = [...existingHistory, ...newHistoryEntries];

    // 5. Apply the update
    await actor.update(updateData);

    // 5.5. Recalculate Mana Grid (may add new job/free sockets at new level)
    if (typeof actor.recalculateGrid === "function") {
      await actor.recalculateGrid();
    }

    // 6. Post summary chat card
    const statKeys = Object.keys(CONFIG.SHARDS.stats);
    const templateData = {
      actorName: actor.name,
      actorImg: actor.img,
      actorTheme: actor.getFlag("shards-of-mana", "sheetTheme") ?? "silver",
      originalLevel: state.originalLevel,
      newLevel: state.currentLevel,
      levelsGained: state.levelsGained,
      statGains: statKeys
        .map(key => ({
          label: game.i18n.localize(CONFIG.SHARDS.stats[key]),
          gain: state.statGains[key]
        }))
        .filter(s => s.gain > 0),
      totalStatGains: Object.values(state.statGains).reduce((s, v) => s + v, 0),
      rankChanged: state.rankChanged,
      originalRank: state.rankChanged
        ? game.i18n.localize(CONFIG.SHARDS.ranks[state.originalRank])
        : null,
      newRank: state.rankChanged
        ? game.i18n.localize(CONFIG.SHARDS.ranks[state.finalRank])
        : null,
      levelResults: state.levelResults.map(lr => ({
        level: lr.level,
        totalGains: lr.totalGains,
        rankAdvanced: lr.rankAdvanced,
        newRank: lr.newRank
      }))
    };

    const content = await renderTemplate(
      "systems/shards-of-mana/templates/chat/levelup-summary.hbs",
      templateData
    );
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content
    });

    // 7. Notify and close
    ui.notifications.info(game.i18n.format("SHARDS.LevelUp.Complete", {
      name: actor.name,
      levels: state.levelsGained,
      newLevel: state.currentLevel
    }));

    this.close();
  }
}
