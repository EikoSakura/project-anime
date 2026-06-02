import { ShardsItemSheet } from "./item-sheet.mjs";
import { _describeChangeKey, formatChangeValue } from "../helpers/effects.mjs";

/**
 * Sheet for the Lineage item type.
 * Features:
 * - Crystal header with portrait, name, and size
 * - Description tab: rich-text editor in a crystal card preview
 * - Details tab: movement modes + innate traits with per-trait Active Effects
 */
export class ShardsLineageSheet extends ShardsItemSheet {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "item-sheet", "lineage-sheet"],
    position: { width: 620, height: 700 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      ...ShardsItemSheet.DEFAULT_OPTIONS.actions,
      addTrait: ShardsLineageSheet.#onAddTrait,
      deleteTrait: ShardsLineageSheet.#onDeleteTrait,
      addTraitEffect: ShardsLineageSheet.#onAddTraitEffect
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: "systems/shards-of-mana/templates/items/lineage/lineage-header.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    description: {
      template: "systems/shards-of-mana/templates/items/lineage/tab-description.hbs",
      scrollable: [""]
    },
    details: {
      template: "systems/shards-of-mana/templates/items/lineage/tab-details.hbs",
      scrollable: [".lineage-details-scroll"]
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "description", group: "primary", icon: "fa-solid fa-book", label: "SHARDS.Lineage.Tabs.Description" },
        { id: "details", group: "primary", icon: "fa-solid fa-list", label: "SHARDS.Lineage.Tabs.Details" }
      ],
      initial: "description",
      labelPrefix: "SHARDS.Lineage.Tabs"
    }
  };

  /* -------------------------------------------- */
  /*  Context Preparation                          */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;

    // Trait count for header badge
    context.traitCount = system.traitCount ?? 0;

    // Movement modes display
    context.movementModes = Object.entries(system.movementModes).map(([key, val]) => ({
      key,
      label: game.i18n.localize(`SHARDS.Movement.${key}`),
      granted: val
    }));

    // Build a map of traitId → [effect display data]
    const traitEffectsMap = new Map();
    for (const effect of this.document.effects) {
      const traitId = effect.flags?.["shards-of-mana"]?.traitId;
      if (!traitId) continue;

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

      const list = traitEffectsMap.get(traitId) ?? [];
      list.push({
        _id: effect.id,
        name: effect.name,
        img: effect.img,
        disabled: effect.disabled,
        tooltip
      });
      traitEffectsMap.set(traitId, list);
    }

    // Innate traits enriched with their linked effects
    context.innateTraits = (system.innateTraits ?? []).map((trait, index) => ({
      ...trait,
      index,
      effects: traitEffectsMap.get(trait.id) ?? []
    }));

    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (["description", "details"].includes(partId)) {
      context.tab = context.tabs?.primary?.[partId] ?? context.tabs?.[partId];
    }
    return context;
  }

  /* -------------------------------------------- */
  /*  Render Hooks                                 */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Ensure the active tab content is visible after render
    const activeTab = this.tabGroups?.primary ?? "description";
    for (const section of this.element.querySelectorAll("[data-group='primary'][data-tab]")) {
      section.classList.toggle("active", section.dataset.tab === activeTab);
    }
  }

  /* -------------------------------------------- */
  /*  Action Handlers                              */
  /* -------------------------------------------- */

  /**
   * Add a new innate trait to the lineage.
   */
  static async #onAddTrait(event, target) {
    const traits = foundry.utils.deepClone(this.document.system.innateTraits ?? []);
    traits.push({
      id: foundry.utils.randomID(),
      name: "New Trait",
      description: ""
    });
    await this.document.update({ "system.innateTraits": traits });
  }

  /**
   * Delete an innate trait and all its linked Active Effects.
   */
  static async #onDeleteTrait(event, target) {
    const idx = Number(target.dataset.traitIndex);
    if (isNaN(idx)) return;
    const traits = foundry.utils.deepClone(this.document.system.innateTraits ?? []);
    const removed = traits.splice(idx, 1)[0];

    // Delete all AEs linked to this trait
    if (removed?.id) {
      const effectIds = this.document.effects
        .filter(e => e.flags?.["shards-of-mana"]?.traitId === removed.id)
        .map(e => e.id);
      if (effectIds.length) {
        await this.document.deleteEmbeddedDocuments("ActiveEffect", effectIds);
      }
    }

    await this.document.update({ "system.innateTraits": traits });
  }

  /**
   * Add an Active Effect linked to a specific innate trait.
   * Opens the Effect Builder with the trait's ID pre-set so every AE
   * created from that session is automatically linked to the trait.
   */
  static #onAddTraitEffect(event, target) {
    const traitId = target.dataset.traitId;
    if (!traitId) return;

    CONFIG.SHARDS.applications.EffectCreator.open(this.document, {
      "shards-of-mana": { traitId }
    });
  }
}
