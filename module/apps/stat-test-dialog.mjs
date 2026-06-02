/**
 * Pre-roll dialog for stat tests.
 * Shows the stat being tested, a modifier input, and conditional effect toggles.
 * Players can activate situational bonuses before confirming the roll.
 */
import { rollStatTest } from "../helpers/rolls.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class ShardsStatTestDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {Actor} */
  #actor;
  /** @type {string} */
  #statKey;
  /** @type {Map<string, boolean>} */
  #toggledEffects = new Map();

  static DEFAULT_OPTIONS = {
    id: "shards-stat-test-dialog",
    classes: ["shards-of-mana", "stat-test-dialog"],
    window: {
      title: "SHARDS.StatTest.Title",
      resizable: false
    },
    position: { width: 380, height: "auto" },
    actions: {
      confirmRoll: ShardsStatTestDialog.#onConfirm,
      cancelRoll: ShardsStatTestDialog.#onCancel,
      toggleConditional: ShardsStatTestDialog.#onToggleConditional
    }
  };

  static PARTS = {
    form: {
      template: "systems/shards-of-mana/templates/apps/stat-test-dialog.hbs"
    }
  };

  /**
   * @param {object} options
   * @param {Actor} options.actor - The actor making the test
   * @param {string} options.statKey - The stat key (str, agi, etc.)
   */
  constructor({ actor, statKey } = {}) {
    super();
    this.#actor = actor;
    this.#statKey = statKey;
  }

  /** @override */
  get title() {
    const statLabel = game.i18n.localize(`SHARDS.Stats.${this.#statKey.charAt(0).toUpperCase() + this.#statKey.slice(1)}`);
    return `${statLabel} ${game.i18n.localize("SHARDS.StatTest.Title")}`;
  }

  /** @override */
  async _prepareContext() {
    const actor = this.#actor;
    const statKey = this.#statKey;
    const statLabel = game.i18n.localize(`SHARDS.Stats.${statKey.charAt(0).toUpperCase() + statKey.slice(1)}`);
    const statTotal = actor.system.statTotal(statKey);

    // Collect conditional effects from this actor
    const conditionalEffects = this.#collectConditionalEffects(actor, statKey);

    // Compute bonus from toggled conditional effects
    let conditionalBonus = 0;
    for (const ce of conditionalEffects) {
      if (ce.toggled) conditionalBonus += ce.bonus;
    }

    return {
      actor: {
        name: actor.name,
        img: actor.img
      },
      statKey,
      statLabel,
      statTotal,
      conditionalBonus,
      adjustedTotal: statTotal + conditionalBonus,
      conditionalEffects,
      hasConditionals: conditionalEffects.length > 0,
      theme: actor.getFlag("shards-of-mana", "sheetTheme") ?? "silver"
    };
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
   * Collect all conditional AEs on the actor, extracting their bonus values.
   * For stat tests, we look for changes that target `system.stats.{statKey}.bonus`.
   * We also include non-stat-specific conditional effects (for general use).
   * @param {Actor} actor
   * @param {string} statKey
   * @returns {object[]}
   */
  #collectConditionalEffects(actor, statKey) {
    const results = [];
    const targetKey = `system.stats.${statKey}.bonus`;

    for (const effect of ShardsStatTestDialog.#iterateAllEffects(actor)) {
      if (!effect.flags?.["shards-of-mana"]?.conditional) continue;

      // Find the bonus value from changes targeting this stat
      let bonus = 0;
      let isRelevant = false;
      for (const change of effect.changes) {
        if (change.key === targetKey) {
          bonus += Number(change.value) || 0;
          isRelevant = true;
        }
      }

      // Include all conditional effects — relevant ones show their bonus,
      // non-relevant ones are shown but with 0 bonus (user can still toggle)
      const label = effect.flags["shards-of-mana"].conditionalLabel || "";
      const toggled = this.#toggledEffects.get(effect.id) ?? false;

      results.push({
        id: effect.id,
        name: effect.name,
        img: effect.img || "icons/svg/aura.svg",
        label,
        bonus,
        isRelevant,
        bonusStr: bonus > 0 ? `+${bonus}` : bonus < 0 ? `${bonus}` : "",
        toggled
      });
    }

    return results;
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static #onToggleConditional(event, target) {
    const effectId = target.dataset.effectId;
    if (!effectId) return;
    const current = this.#toggledEffects.get(effectId) ?? false;
    this.#toggledEffects.set(effectId, !current);
    this.render();
  }

  static async #onConfirm(event, target) {
    const form = this.element.querySelector(".stat-test-form");
    const modifier = Number(form?.querySelector("[name='modifier']")?.value) || 0;

    // Sum up toggled conditional bonuses from ALL effect sources
    let conditionalBonus = 0;
    for (const effect of ShardsStatTestDialog.#iterateAllEffects(this.#actor)) {
      if (!effect.flags?.["shards-of-mana"]?.conditional) continue;
      if (!this.#toggledEffects.get(effect.id)) continue;

      const targetKey = `system.stats.${this.#statKey}.bonus`;
      for (const change of effect.changes) {
        if (change.key === targetKey) {
          conditionalBonus += Number(change.value) || 0;
        }
      }
    }

    const totalModifier = modifier + conditionalBonus;
    await rollStatTest(this.#actor, this.#statKey, { modifier: totalModifier });
    this.close();
  }

  static async #onCancel() {
    this.close();
  }
}
