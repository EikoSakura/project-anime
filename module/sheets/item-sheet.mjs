import { showEffectContextMenu, showEffectTooltip, hideEffectTooltip } from "../helpers/effect-context-menu.mjs";
import { _describeChangeKey, formatChangeValue } from "../helpers/effects.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Shared base sheet for all Shards of Mana item types.
 * Extends ApplicationV2 via HandlebarsApplicationMixin + ItemSheetV2.
 * Provides effect management actions and rank cycling inherited by all item subclasses.
 */
export class ShardsItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "item-sheet"],
    position: { width: 520, height: 480 },
    window: {
      resizable: true
    },
    form: {
      submitOnChange: true
    },
    actions: {
      createEffect: ShardsItemSheet.#onCreateEffect,
      editEffect: ShardsItemSheet.#onEditEffect,
      toggleEffect: ShardsItemSheet.#onToggleEffect,
      deleteEffect: ShardsItemSheet.#onDeleteEffect,
      cycleRank: ShardsItemSheet.#onCycleRank
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: "systems/shards-of-mana/templates/items/parts/item-header.hbs"
    },
    body: {
      template: "systems/shards-of-mana/templates/items/item-body.hbs",
      scrollable: [""]
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    const system = item.system;

    context.item = item;
    context.system = system;
    context.systemFields = system.schema.fields;

    // Enrich description HTML
    const TE = foundry.applications.ux.TextEditor.implementation;
    context.enrichedDescription = await TE.enrichHTML(
      system.description ?? "",
      { async: true, relativeTo: item }
    );

    // Config data for dropdowns
    context.config = CONFIG.SHARDS;

    // Active Effects on this item
    context.effects = [];
    for (const effect of item.effects) {
      // Classify effect type — manual override first, then auto-detect
      let effectType = "neutral";
      const manualType = effect.flags?.["shards-of-mana"]?.effectType;
      if (manualType === "buff" || manualType === "debuff") {
        effectType = manualType;
      } else if (effect.changes?.length) {
        let pos = 0, neg = 0;
        for (const c of effect.changes) {
          // Boolean condition immunities are always buffs
          if (c.key.startsWith("system.conditionResistances.") && String(c.value) === "true") {
            pos++; continue;
          }
          const v = Number(c.value);
          if (v === 0) continue;
          if (v > 0) pos++; else neg++;
        }
        if (pos > 0 && neg === 0) effectType = "buff";
        else if (neg > 0 && pos === 0) effectType = "debuff";
      }

      // Duration badge
      let durationBadge = null;
      if (effect.isTemporary) {
        const d = effect.duration;
        if (d.rounds) durationBadge = `${d.rounds}R`;
        else if (d.turns) durationBadge = `${d.turns}T`;
        else if (d.seconds) durationBadge = `${d.seconds}s`;
      }

      // Build tooltip from changes
      let tooltip = "";
      if (effect.changes?.length) {
        const parts = [];
        for (const c of effect.changes) {
          const label = _describeChangeKey(c.key);
          if (!label) continue;
          parts.push(`${label} ${formatChangeValue(c)}`);
        }
        tooltip = parts.join(", ");
      }

      context.effects.push({
        _id: effect.id,
        name: effect.name,
        img: effect.img,
        disabled: effect.disabled,
        isTemporary: effect.isTemporary,
        duration: effect.duration,
        sourceName: item.name,
        effectType,
        durationBadge,
        tooltip
      });
    }

    // Cache for tooltip lookups in hover handler
    this.#effectsDisplayCache = context.effects;

    return context;
  }

  /* -------------------------------------------- */
  /*  Scroll Preservation                          */
  /* -------------------------------------------- */

  /** @type {object[]} Cached effects display data for tooltip lookups */
  #effectsDisplayCache = [];

  /** @type {Map<string, number>} */
  #scrollPositions = new Map();

  /** @override */
  async _preRender(context, options) {
    await super._preRender(context, options);
    this.#scrollPositions.clear();
    if (!this.element) return;
    // Capture every scrollable element's position
    for (const el of this.element.querySelectorAll("*")) {
      if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) {
        const key = el.dataset.tab || el.id || el.getAttribute("class") || el.tagName;
        this.#scrollPositions.set(key, el.scrollTop);
      }
    }
  }

  /* -------------------------------------------- */
  /*  Render Hooks                                 */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Restore scroll positions after the DOM has settled
    if (this.#scrollPositions.size > 0) {
      requestAnimationFrame(() => {
        for (const el of this.element.querySelectorAll("*")) {
          if (el.scrollHeight > el.clientHeight) {
            const key = el.dataset.tab || el.id || el.getAttribute("class") || el.tagName;
            const saved = this.#scrollPositions.get(key);
            if (saved != null) el.scrollTop = saved;
          }
        }
      });
    }

    // Attach right-click listener for reverse rank cycling
    for (const el of this.element.querySelectorAll('[data-action="cycleRank"]')) {
      el.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.#cycleRankDirection(-1);
      });
    }

    // Effect icon grid: bind right-click context menu + hover tooltip
    // directly to each cell on every render (cells get replaced by part re-renders)
    for (const cell of this.element.querySelectorAll(".effect-icon-cell[data-effect-id]")) {
      cell.addEventListener("contextmenu", (event) => {
        this.#onEffectContextMenu(event, cell);
      });
      cell.addEventListener("mouseenter", (event) => {
        this.#onEffectHover(event, cell);
      });
      cell.addEventListener("mouseleave", () => {
        hideEffectTooltip();
      });
    }
  }

  /* -------------------------------------------- */
  /*  Effect Context Menu & Tooltip                */
  /* -------------------------------------------- */

  #onEffectContextMenu(event, cell) {
    event.preventDefault();
    const effectId = cell.dataset.effectId;
    const effect = this.document.effects.get(effectId);
    if (!effect) return;
    hideEffectTooltip();
    showEffectContextMenu(event, effect, this.element);
  }

  #onEffectHover(event, cell) {
    const effectId = cell.dataset.effectId;
    const effectData = this.#effectsDisplayCache.find(e => e._id === effectId);
    if (!effectData) return;
    showEffectTooltip(event, effectData, this.element);
  }

  /* -------------------------------------------- */
  /*  Rank Cycling                                 */
  /* -------------------------------------------- */

  /**
   * Cycle the item's rank forward or backward.
   * @param {number} direction  1 for forward, -1 for backward
   */
  #cycleRankDirection(direction) {
    const ranks = Object.keys(CONFIG.SHARDS.ranks);
    const current = this.document.system.rank;
    const idx = ranks.indexOf(current);
    if (idx < 0) return;
    const newIdx = (idx + direction + ranks.length) % ranks.length;
    this.document.update({ "system.rank": ranks[newIdx] });
  }

  /**
   * Click handler: cycle rank forward (or backward if shift-held).
   */
  static #onCycleRank(event, target) {
    const direction = event.shiftKey ? -1 : 1;
    this.#cycleRankDirection(direction);
  }

  /* -------------------------------------------- */
  /*  Effect Handlers                              */
  /* -------------------------------------------- */

  static #onCreateEffect(event, target) {
    CONFIG.SHARDS.applications.EffectCreator.open(this.document);
  }

  static #onEditEffect(event, target) {
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId;
    const effect = this.document.effects.get(effectId);
    if (effect) effect.sheet.render(true);
  }

  static async #onToggleEffect(event, target) {
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId;
    const effect = this.document.effects.get(effectId);
    if (effect) await effect.update({ disabled: !effect.disabled });
  }

  static async #onDeleteEffect(event, target) {
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId;
    const effect = this.document.effects.get(effectId);
    if (effect) await effect.delete();
  }
}
