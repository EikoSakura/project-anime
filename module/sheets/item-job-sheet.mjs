import { ShardsItemSheet } from "./item-sheet.mjs";

/**
 * Sheet for the Job item type.
 * Extends the base ShardsItemSheet with tabbed layout for growth modifiers,
 * rank progression (with inline limit break), mastery bonus, and description.
 */
export class ShardsJobSheet extends ShardsItemSheet {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "item-sheet", "job-sheet"],
    position: { width: 560, height: 580 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      ...ShardsItemSheet.DEFAULT_OPTIONS.actions,
      addSkillAtRank: ShardsJobSheet.#onAddSkillAtRank,
      removeSkillAtRank: ShardsJobSheet.#onRemoveSkillAtRank,
      toggleProficiency: ShardsJobSheet.#onToggleProficiency,
      addPrerequisite: ShardsJobSheet.#onAddPrerequisite,
      removePrerequisite: ShardsJobSheet.#onRemovePrerequisite
    }
  };

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Bind change listeners for skill inputs (no name= attr, manual save)
    const skillInputs = this.element.querySelectorAll(".job-skill-input");
    for (const input of skillInputs) {
      input.addEventListener("change", this.#onSkillInputChange.bind(this));
    }

    // Bind change listeners for prerequisite inputs
    const prereqInputs = this.element.querySelectorAll(
      ".job-prereq-skill-input, .job-prereq-level-input"
    );
    for (const input of prereqInputs) {
      input.addEventListener("change", this.#onPrereqInputChange.bind(this));
    }

    // Set up drag-and-drop on the prerequisite drop zone
    const dropZone = this.element.querySelector(".job-prereq-drop-zone");
    if (dropZone) {
      dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("drag-hover");
      });
      dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("drag-hover");
      });
      dropZone.addEventListener("drop", (e) => {
        dropZone.classList.remove("drag-hover");
        this.#onPrereqDrop(e);
      });
    }

  }

  /** @override */
  static PARTS = {
    header: {
      template: "systems/shards-of-mana/templates/items/job/job-header.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    description: {
      template: "systems/shards-of-mana/templates/items/job/tab-description.hbs",
      scrollable: [""]
    },
    growth: {
      template: "systems/shards-of-mana/templates/items/job/tab-growth.hbs",
      scrollable: [""]
    },
    progression: {
      template: "systems/shards-of-mana/templates/items/job/tab-progression.hbs",
      scrollable: [""]
    },
    mastery: {
      template: "systems/shards-of-mana/templates/items/job/tab-mastery.hbs",
      scrollable: [""]
    },
    effects: {
      template: "systems/shards-of-mana/templates/items/job/tab-effects.hbs",
      scrollable: [""]
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "description", group: "primary", icon: "fa-solid fa-book", label: "SHARDS.Job.Tabs.Description" },
        { id: "growth", group: "primary", icon: "fa-solid fa-chart-bar", label: "SHARDS.Job.Tabs.Growth" },
        { id: "progression", group: "primary", icon: "fa-solid fa-stairs", label: "SHARDS.Job.Tabs.Progression" },
        { id: "mastery", group: "primary", icon: "fa-solid fa-star", label: "SHARDS.Job.Tabs.Mastery" },
        { id: "effects", group: "primary", icon: "fa-solid fa-sparkles", label: "SHARDS.Effects.ActiveEffects" }
      ],
      initial: "description",
      labelPrefix: "SHARDS.Job.Tabs"
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    const system = item.system;

    // School options for dropdown
    context.schoolOptions = Object.entries(CONFIG.SHARDS.schools).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
      selected: system.school === key
    }));

    // Growth rate modifier rows for the Growth tab
    context.growthModRows = Object.entries(CONFIG.SHARDS.stats).map(([key, labelKey]) => {
      const value = system.growthRateModifiers[key];
      return {
        key,
        label: game.i18n.localize(labelKey),
        abbrev: game.i18n.localize(`SHARDS.Stats.${key}`),
        value,
        sign: value > 0 ? "positive" : value < 0 ? "negative" : "neutral",
        barWidth: Math.min(Math.abs(value) / 30 * 100, 100)
      };
    });

    // Rank progression rows — build skills per rank (legacy field, guard for missing)
    const rankList = ["F", "E", "D", "C", "B", "A", "S"];
    const skillsPerRank = system.skillsPerRank ?? [];
    context.rankRows = rankList.map(rank => {
      const skillsEntry = skillsPerRank.find(s => s.rank === rank);
      const skillNames = skillsEntry?.skillNames ?? [];

      return {
        rank,
        isCurrentRank: system.rank === rank,
        isMasteryRank: rank === "S",
        skillNames,
        hasSkills: skillNames.length > 0
      };
    });

    // Mastery growth increase rows
    context.masteryGrowthRows = Object.entries(CONFIG.SHARDS.stats).map(([key, labelKey]) => {
      const value = system.masteryBonus.growthRateIncrease[key];
      return {
        key,
        label: game.i18n.localize(labelKey),
        abbrev: game.i18n.localize(`SHARDS.Stats.${key}`),
        value,
        sign: value > 0 ? "positive" : value < 0 ? "negative" : "neutral",
        barWidth: Math.min(Math.abs(value) / 30 * 100, 100)
      };
    });

    // Enriched Limit Break description (rendered inline in progression tab)
    const TE = foundry.applications.ux.TextEditor.implementation;
    context.enrichedLimitBreakDesc = await TE.enrichHTML(
      system.limitBreak.description ?? "",
      { async: true, relativeTo: item }
    );

    // Proficiency options — weapon groups and armor categories as toggle chips
    const weaponProfs = system.weaponProficiencies;
    context.weaponProfOptions = Object.entries(CONFIG.SHARDS.weaponGroups).map(([key, labelKey]) => ({
      key,
      label: game.i18n.localize(labelKey),
      active: weaponProfs.has(key)
    }));

    const armorProfs = system.armorProficiencies;
    context.armorProfOptions = Object.entries(CONFIG.SHARDS.armorCategories).map(([key, labelKey]) => ({
      key,
      label: game.i18n.localize(labelKey),
      active: armorProfs.has(key)
    }));

    // Category options for dropdown
    context.categoryOptions = Object.entries(CONFIG.SHARDS.jobCategories).map(([key, labelKey]) => ({
      key,
      label: game.i18n.localize(labelKey),
      selected: system.category === key
    }));
    context.categoryLabel = game.i18n.localize(
      CONFIG.SHARDS.jobCategories[system.category] ?? CONFIG.SHARDS.jobCategories.basic
    );
    context.isBasicCategory = system.category === "basic";

    // Prerequisites for the builder
    context.prerequisites = system.prerequisites ?? [];
    context.hasPrerequisites = context.prerequisites.length > 0;

    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    const tabIds = ["growth", "progression", "mastery", "description", "effects"];
    if (tabIds.includes(partId)) {
      context.tab = context.tabs?.primary?.[partId] ?? context.tabs?.[partId];
    }
    return context;
  }

  /* -------------------------------------------- */
  /*  Action Handlers                             */
  /* -------------------------------------------- */

  /**
   * Add an empty skill entry at a specific rank.
   */
  static async #onAddSkillAtRank(event, target) {
    const rank = target.dataset.rank;
    const system = this.document.system;
    const currentSkills = system.skillsPerRank ?? [];
    const existing = currentSkills.find(s => s.rank === rank);
    let skillsPerRank;
    if (existing) {
      skillsPerRank = currentSkills.map(s =>
        s.rank === rank ? { rank, skillNames: [...s.skillNames, ""] } : { ...s }
      );
    } else {
      skillsPerRank = [...currentSkills, { rank, skillNames: [""] }];
    }
    await this.document.update({ "system.skillsPerRank": skillsPerRank });
  }

  /**
   * Remove a skill entry at a specific rank and index.
   */
  static async #onRemoveSkillAtRank(event, target) {
    const rank = target.dataset.rank;
    const skillIndex = Number(target.dataset.skillIndex);
    const system = this.document.system;
    const skillsPerRank = (system.skillsPerRank ?? []).map(s => {
      if (s.rank !== rank) return { ...s };
      const skillNames = s.skillNames.filter((_, i) => i !== skillIndex);
      return { rank, skillNames };
    }).filter(s => s.skillNames.length > 0);
    await this.document.update({ "system.skillsPerRank": skillsPerRank });
  }

  /**
   * Toggle a proficiency value in a SetField (weapon or armor).
   */
  static async #onToggleProficiency(event, target) {
    const field = target.dataset.field;       // "weaponProficiencies" or "armorProficiencies"
    const value = target.dataset.value;       // e.g. "blade", "heavy"
    const current = this.document.system[field];
    const updated = new Set(current);
    if (updated.has(value)) updated.delete(value);
    else updated.add(value);
    await this.document.update({ [`system.${field}`]: [...updated] });
  }

  /**
   * Add an empty prerequisite entry.
   */
  static async #onAddPrerequisite(event, target) {
    const prereqs = [...(this.document.system.prerequisites ?? []), { skillName: "", minLevel: 1 }];
    await this.document.update({ "system.prerequisites": prereqs });
  }

  /**
   * Remove a prerequisite entry by index.
   */
  static async #onRemovePrerequisite(event, target) {
    const idx = Number(target.dataset.prereqIndex);
    const prereqs = (this.document.system.prerequisites ?? []).filter((_, i) => i !== idx);
    await this.document.update({ "system.prerequisites": prereqs });
  }

  /* -------------------------------------------- */
  /*  Manual Input Handlers (bypass submitOnChange)*/
  /* -------------------------------------------- */

  /**
   * Handle change on a skill text input. Saves the skill name directly
   * to the document, bypassing Foundry's broken array path handling.
   */
  async #onSkillInputChange(event) {
    const input = event.currentTarget;
    const rank = input.dataset.rank;
    const skillIndex = Number(input.dataset.skillIndex);
    const newValue = input.value;
    const system = this.document.system;

    const skillsPerRank = (system.skillsPerRank ?? []).map(s => {
      if (s.rank !== rank) return { ...s };
      const skillNames = [...s.skillNames];
      skillNames[skillIndex] = newValue;
      return { rank, skillNames };
    });

    // If no entry exists for this rank yet, create one
    if (!skillsPerRank.find(s => s.rank === rank)) {
      skillsPerRank.push({ rank, skillNames: [newValue] });
    }

    await this.document.update({ "system.skillsPerRank": skillsPerRank });
  }

  /**
   * Handle change on a prerequisite input (skill name or min level).
   * Rebuilds the full prerequisites array to bypass Foundry array path issues.
   */
  async #onPrereqInputChange(event) {
    const input = event.currentTarget;
    const idx = Number(input.dataset.prereqIndex);
    const field = input.dataset.field; // "skillName" or "minLevel"
    const value = field === "minLevel" ? Math.clamp(Number(input.value), 1, 10) : input.value;

    const prereqs = (this.document.system.prerequisites ?? []).map((p, i) => {
      if (i !== idx) return { ...p };
      return { ...p, [field]: value };
    });
    await this.document.update({ "system.prerequisites": prereqs });
  }

  /**
   * Handle a skill item dropped onto the prerequisite drop zone.
   * Extracts the skill name and adds a new prerequisite entry.
   */
  async #onPrereqDrop(event) {
    event.preventDefault();
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }

    // Resolve the dropped document
    if (data.type !== "Item") return;
    const item = await fromUuid(data.uuid);
    if (!item || item.type !== "skill") {
      ui.notifications.warn("Only skill items can be dropped as prerequisites.");
      return;
    }

    // Check for duplicate
    const existing = this.document.system.prerequisites ?? [];
    if (existing.some(p => p.skillName.toLowerCase() === item.name.toLowerCase())) {
      ui.notifications.info(`${item.name} is already a prerequisite.`);
      return;
    }

    const prereqs = [...existing, { skillName: item.name, minLevel: 1 }];
    await this.document.update({ "system.prerequisites": prereqs });
  }
}
