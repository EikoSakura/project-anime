import { evaluateFormula, buildFormulaContext } from "../helpers/formulas.mjs";
import { rollAttack, rollBuff, rollHealing, rollWeaponAttack } from "../helpers/rolls.mjs";
import { placeAoETemplate, cleanupAoETemplates } from "../helpers/aoe-templates.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

/**
 * Pre-roll confirmation dialog for skills and weapon attacks.
 * Shows targets, range validation, resource costs, and condition warnings.
 * Players can add/remove targets via Foundry's native targeting while the dialog is open.
 */
export class ShardsPreRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {Actor} */
  #actor;
  /** @type {Item} */
  #skill;
  /** @type {boolean} */
  #isWeapon;
  /** @type {Map<string, boolean>} Toggle state for conditional effects */
  #toggledEffects = new Map();
  /** @type {string[]} MeasuredTemplate IDs created by AoE placement */
  #aoeTemplateIds = [];

  static DEFAULT_OPTIONS = {
    id: "shards-preroll-dialog",
    classes: ["shards-of-mana", "preroll-dialog"],
    window: {
      title: "SHARDS.PreRoll.Title",
      resizable: false
    },
    position: { width: 460, height: "auto" },
    actions: {
      confirmRoll: ShardsPreRollDialog.#onConfirm,
      cancelRoll: ShardsPreRollDialog.#onCancel,
      clearTargets: ShardsPreRollDialog.#onClearTargets,
      displayOnly: ShardsPreRollDialog.#onDisplayOnly,
      refreshTargets: ShardsPreRollDialog.#onRefreshTargets,
      toggleConditional: ShardsPreRollDialog.#onToggleConditional,
      placeTemplate: ShardsPreRollDialog.#onPlaceTemplate
    }
  };

  static PARTS = {
    form: {
      template: "systems/shards-of-mana/templates/apps/preroll-dialog.hbs"
    }
  };

  /**
   * @param {object} options
   * @param {Actor} options.actor - The actor using the skill/weapon
   * @param {Item} options.skill - The skill or weapon item
   * @param {boolean} [options.isWeapon=false] - Whether this is a basic weapon attack
   */
  constructor({ actor, skill, isWeapon = false } = {}) {
    super();
    this.#actor = actor;
    this.#skill = skill;
    this.#isWeapon = isWeapon;
  }

  /** @override */
  get title() {
    return this.#skill?.name ?? game.i18n.localize("SHARDS.PreRoll.Title");
  }

  /** @override */
  async _prepareContext() {
    const actor = this.#actor;
    const skill = this.#skill;
    const sk = skill.system;
    const system = actor.system;
    const isWeapon = this.#isWeapon;

    // --- Compute costs ---
    const formulaCtx = isWeapon ? null : buildFormulaContext(actor, skill);
    let pipCost, mpCost;
    if (isWeapon) {
      pipCost = 1;
      mpCost = 0;
    } else {
      const rawPip = evaluateFormula(sk.pipCost || "0", formulaCtx);
      const rawMp = evaluateFormula(sk.mpCost || "0", formulaCtx);
      pipCost = typeof rawPip === "number" ? Math.max(Math.floor(rawPip), 0) : 0;
      mpCost = typeof rawMp === "number" ? Math.max(Math.floor(rawMp), 0) : 0;
    }

    // --- Resource check ---
    const hasEnoughPips = system.pips.value >= pipCost;
    const hasEnoughMp = system.mana.value >= mpCost;
    const resourcesOk = hasEnoughPips && hasEnoughMp;

    // --- Condition checks ---
    const cond = system.conditions;
    const isStunned = cond.stun > 0;
    const isDowned = cond.downed > 0;
    const isSilenced = cond.silence > 0 && !isWeapon && sk.defenseType === "magical";
    const canAct = !isStunned && !isDowned && !isSilenced;

    // --- Limit Break check ---
    const isLimitBreak = !isWeapon && sk.timing === "limitBreak";
    const lbReady = actor.type === "adventurer" ? system.limitBreak.value >= 100 : true;
    const lbBlocked = isLimitBreak && !lbReady;

    // --- Target info ---
    const actorToken = actor.getActiveTokens()[0] ?? null;
    const isSelf = !isWeapon && sk.target === "self";
    const isField = !isWeapon && sk.target === "field";
    const range = isWeapon ? 1 : (formulaCtx ? evaluateFormula(sk.range || "0", formulaCtx) : Number(sk.range) || 0);

    let currentTargets;
    if (isSelf) {
      currentTargets = actorToken ? [actorToken] : [];
    } else {
      currentTargets = Array.from(game.user.targets);
    }

    const targets = currentTargets.map(token => {
      const distance = this.#calculateDistance(actorToken, token);
      const inRange = range === 0 || distance === null || distance <= range;
      return {
        name: token.actor?.name ?? token.name,
        img: token.actor?.img ?? token.document?.texture?.src ?? "icons/svg/mystery-man.svg",
        tokenId: token.id,
        distance,
        distanceLabel: distance !== null ? `${distance} sq` : "—",
        inRange,
        isSelf: token.actor?.id === actor.id
      };
    });

    const hasTargets = targets.length > 0;
    const allInRange = targets.every(t => t.inRange);
    const needsTargets = !isSelf && !isField;

    // --- Skill display info ---
    const areaShape = isWeapon ? "" : (sk.areaShape || "");
    const areaSize = isWeapon ? 0 : (sk.areaSize || 0);
    const hasArea = areaShape && areaSize > 0;

    // --- AoE template placement ---
    const aoeFilter = isWeapon ? "all" : (sk.aoeFilter || "all");
    const aoeFilterOptions = Object.entries(CONFIG.SHARDS.aoeFilters ?? {}).map(([key, loc]) => ({
      key,
      label: game.i18n.localize(loc),
      selected: key === aoeFilter
    }));
    const isAoE = hasArea && !isWeapon;
    const hasCanvas = !!canvas?.scene;

    // Can confirm?
    const canConfirm = canAct && resourcesOk && !lbBlocked && (hasTargets || !needsTargets);

    // Collect conditional effects
    const conditionalEffects = this.#collectConditionalEffects(actor);

    return {
      actor: {
        name: actor.name,
        img: actor.img,
        pips: system.pips,
        mana: system.mana,
        isAdventurer: actor.type === "adventurer",
        limitBreak: actor.type === "adventurer" ? system.limitBreak : null
      },
      conditionalEffects,
      hasConditionals: conditionalEffects.length > 0,
      skill: {
        name: skill.name,
        img: skill.img,
        timing: isWeapon ? "action" : sk.timing,
        timingLabel: isWeapon
          ? game.i18n.localize(CONFIG.SHARDS.skillTimings.action)
          : game.i18n.localize(CONFIG.SHARDS.skillTimings[sk.timing] ?? sk.timing),
        damageType: isWeapon ? "physical" : sk.damageType,
        damageTypeLabel: isWeapon
          ? game.i18n.localize(CONFIG.SHARDS.damageTypes.physical)
          : game.i18n.localize(CONFIG.SHARDS.damageTypes[sk.damageType] ?? sk.damageType),
        defenseType: isWeapon ? "physical" : sk.defenseType,
        target: isWeapon ? "single" : sk.target,
        targetLabel: isWeapon
          ? game.i18n.localize(CONFIG.SHARDS.targetTypes.single)
          : game.i18n.localize(CONFIG.SHARDS.targetTypes[sk.target] ?? sk.target)
      },
      isWeapon,
      pipCost,
      mpCost,
      hasEnoughPips,
      hasEnoughMp,
      resourcesOk,
      range,
      rangeLabel: range === 0
        ? game.i18n.localize("SHARDS.PreRoll.Melee")
        : `${range} sq`,
      hasArea,
      areaShape: hasArea ? game.i18n.localize(CONFIG.SHARDS.areaShapes[areaShape] ?? areaShape) : "",
      areaSize,
      targets,
      hasTargets,
      allInRange,
      needsTargets,
      isSelf,
      isField,
      // AoE template
      isAoE,
      aoeFilter,
      aoeFilterOptions,
      hasCanvas,
      // Condition warnings
      isStunned,
      isDowned,
      isSilenced,
      canAct,
      // Limit break
      isLimitBreak,
      lbReady,
      lbBlocked,
      // Can roll?
      canConfirm,
      theme: actor.getFlag("shards-of-mana", "sheetTheme") ?? "silver"
    };
  }

  /**
   * Calculate grid distance between two tokens.
   * @param {Token|null} from
   * @param {Token} to
   * @returns {number|null}
   */
  #calculateDistance(from, to) {
    if (!from || !to || !canvas.grid) return null;
    try {
      const ray = new Ray(from.center, to.center);
      const distance = canvas.grid.measurePath([{ ray }]);
      return Math.round(distance.distance);
    } catch {
      return null;
    }
  }

  /**
   * Gather current targets for the roll.
   * @returns {Token[]}
   */
  #gatherTargets() {
    const sk = this.#skill.system;
    if (!this.#isWeapon && sk.target === "self") {
      const selfTokens = this.#actor.getActiveTokens();
      return selfTokens.length ? [selfTokens[0]] : [];
    }
    return Array.from(game.user.targets);
  }

  /**
   * Iterate ALL effects on the actor — direct actor effects AND
   * transferring item effects (which stay on items in modern mode).
   * @param {Actor} actor
   * @yields {ActiveEffect}
   */
  static *#iterateAllEffects(actor) {
    for (const effect of actor.effects) yield effect;
    for (const item of actor.items) {
      for (const effect of item.effects) {
        if (effect.transfer) yield effect;
      }
    }
  }

  /**
   * Collect all conditional AEs on the actor for display as toggles.
   * Shows all conditional effects with a summary of their changes.
   * @param {Actor} actor
   * @returns {object[]}
   */
  #collectConditionalEffects(actor) {
    const results = [];
    for (const effect of ShardsPreRollDialog.#iterateAllEffects(actor)) {
      if (!effect.flags?.["shards-of-mana"]?.conditional) continue;

      const label = effect.flags["shards-of-mana"].conditionalLabel || "";
      const toggled = this.#toggledEffects.get(effect.id) ?? false;

      // Build a summary of all changes for display
      const bonusParts = [];
      for (const change of effect.changes) {
        const val = Number(change.value) || 0;
        if (!val) continue;
        // Extract a readable key name from the change key
        const keyParts = change.key.split(".");
        const shortKey = keyParts[keyParts.length - 1] === "bonus"
          ? keyParts[keyParts.length - 2]?.toUpperCase()
          : keyParts[keyParts.length - 1]?.toUpperCase();
        const sign = val > 0 ? "+" : "";
        bonusParts.push(`${sign}${val} ${shortKey}`);
      }

      results.push({
        id: effect.id,
        name: effect.name,
        img: effect.img || "icons/svg/aura.svg",
        label,
        bonusSummary: bonusParts.join(", "),
        toggled
      });
    }
    return results;
  }

  // --- Actions ---

  static #onToggleConditional(event, target) {
    const effectId = target.dataset.effectId;
    if (!effectId) return;
    const current = this.#toggledEffects.get(effectId) ?? false;
    this.#toggledEffects.set(effectId, !current);
    this.render();
  }

  static async #onPlaceTemplate(event, target) {
    const actor = this.#actor;
    const skill = this.#skill;
    const sk = skill.system;
    const actorToken = actor.getActiveTokens()[0];
    if (!actorToken) {
      ui.notifications.warn(game.i18n.localize("SHARDS.AoE.NoToken"));
      return;
    }

    // Read filter from the dropdown
    const filterSelect = this.element.querySelector("[name='aoeFilter']");
    const filter = filterSelect?.value ?? sk.aoeFilter ?? "all";

    // Clean up any previously placed templates
    if (this.#aoeTemplateIds.length) {
      await cleanupAoETemplates(this.#aoeTemplateIds);
      this.#aoeTemplateIds = [];
    }

    // Minimize the dialog while the user places the template
    this.minimize();

    const result = await placeAoETemplate(actorToken, {
      shape: sk.areaShape,
      size: sk.areaSize,
      filter
    });

    // Restore the dialog
    this.maximize();

    if (!result) {
      // User cancelled placement
      this.render();
      return;
    }

    this.#aoeTemplateIds = result.templateIds;
    // Targets have been auto-set via game.user.targets by placeAoETemplate
    this.render();
  }

  static async #onConfirm(event, target) {
    const actor = this.#actor;
    const skill = this.#skill;
    const targets = this.#gatherTargets();

    // Temporarily enable selected conditional AEs so they apply during the roll
    // Must iterate ALL effects (actor + item transfers) to find conditionals
    const enabledEffects = [];
    for (const effect of ShardsPreRollDialog.#iterateAllEffects(actor)) {
      if (!effect.flags?.["shards-of-mana"]?.conditional) continue;
      if (!this.#toggledEffects.get(effect.id)) continue;
      enabledEffects.push(effect);
    }

    // Temporarily allow conditional effects through the AE pipeline
    if (enabledEffects.length) {
      for (const effect of enabledEffects) {
        effect._conditionalActive = true;
      }
      actor.prepareData();
    }

    try {
      if (this.#isWeapon) {
        await rollWeaponAttack(actor, skill, targets);
      } else if (skill.system.damageType === "healing") {
        await rollHealing(actor, skill, targets);
      } else if (skill.system.damageType === "buff") {
        await rollBuff(actor, skill, targets);
      } else {
        await rollAttack(actor, skill, targets);
      }
    } finally {
      // Restore: clear temporary activation and re-prepare data
      if (enabledEffects.length) {
        for (const effect of enabledEffects) {
          delete effect._conditionalActive;
        }
        actor.prepareData();
      }
    }

    // Schedule AoE template cleanup after a short delay so players can see the area
    if (this.#aoeTemplateIds.length) {
      const ids = [...this.#aoeTemplateIds];
      this.#aoeTemplateIds = [];
      setTimeout(() => cleanupAoETemplates(ids), 5000);
    }

    this.close();
  }

  static async #onCancel() {
    if (this.#aoeTemplateIds.length) {
      await cleanupAoETemplates(this.#aoeTemplateIds);
      this.#aoeTemplateIds = [];
    }
    this.close();
  }

  static async #onClearTargets() {
    // Clear all targets for the current user
    for (const t of game.user.targets) {
      t.setTarget(false, { releaseOthers: false });
    }
    this.render();
  }

  static async #onDisplayOnly() {
    const actor = this.#actor;
    const skill = this.#skill;

    if (this.#isWeapon) {
      await rollWeaponAttack(actor, skill, []);
    } else if (skill.system.damageType === "healing") {
      await rollHealing(actor, skill, []);
    } else {
      await rollAttack(actor, skill, []);
    }

    this.close();
  }

  static async #onRefreshTargets() {
    this.render();
  }
}
