import { prepareConditionDisplay, prepareElementDisplay, prepareConditionResistanceDisplay, prepareEffectsDisplay, transferEffectItem } from "../helpers/effects.mjs";
import { showEffectContextMenu, showEffectTooltip, hideEffectTooltip } from "../helpers/effect-context-menu.mjs";
import { rollAttack, rollHealing } from "../helpers/rolls.mjs";
import { ShardsPreRollDialog } from "../apps/preroll-dialog.mjs";
import { ShardsStatTestDialog } from "../apps/stat-test-dialog.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * NPC sheet — simplified status card + 3 tabs.
 */
export class ShardsNpcSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "npc-sheet"],
    position: { width: 720, height: 660 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollStat: ShardsNpcSheet.#onRollStat,
      deleteItem: ShardsNpcSheet.#onDeleteItem,
      editItem: ShardsNpcSheet.#onEditItem,
      useItem: ShardsNpcSheet.#onUseItem,
      toggleSection: ShardsNpcSheet.#onToggleSection,
      createEffect: ShardsNpcSheet.#onCreateEffect,
      editEffect: ShardsNpcSheet.#onEditEffect,
      toggleEffect: ShardsNpcSheet.#onToggleEffect,
      deleteEffect: ShardsNpcSheet.#onDeleteEffect,
      useSkill: ShardsNpcSheet.#onUseSkill
    }
  };

  /** @override */
  static PARTS = {
    card: {
      template: "systems/shards-of-mana/templates/actors/npc/npc-card.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    combat: {
      template: "systems/shards-of-mana/templates/actors/npc/tab-combat.hbs",
      scrollable: [""]
    },
    inventory: {
      template: "systems/shards-of-mana/templates/actors/npc/tab-inventory.hbs",
      scrollable: [""]
    },
    biography: {
      template: "systems/shards-of-mana/templates/actors/npc/tab-biography.hbs",
      scrollable: [""]
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "combat", group: "primary", icon: "fa-solid fa-swords", label: "SHARDS.Tabs.Combat" },
        { id: "inventory", group: "primary", icon: "fa-solid fa-suitcase", label: "SHARDS.Tabs.Inventory" },
        { id: "biography", group: "primary", icon: "fa-solid fa-book", label: "SHARDS.Tabs.Biography" }
      ],
      initial: "combat",
      labelPrefix: "SHARDS.Tabs"
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;

    context.actor = actor;
    context.system = system;
    context.config = CONFIG.SHARDS;

    // Items by type
    context.items = { equipment: [], manacite: [], skill: [], job: [] };
    for (const item of actor.items) {
      if (context.items[item.type]) context.items[item.type].push(item);
    }

    // Bar percentages and clip values
    context.healthPct = system.health.max > 0
      ? Math.clamp(Math.round((system.health.value / system.health.max) * 100), 0, 100) : 0;
    context.healthClip = 100 - context.healthPct;
    context.manaPct = system.mana.max > 0
      ? Math.clamp(Math.round((system.mana.value / system.mana.max) * 100), 0, 100) : 0;
    context.manaClip = 100 - context.manaPct;

    // Pip array
    context.pipArray = Array.from(
      { length: system.pips.max },
      (_, i) => ({ filled: i < system.pips.value, index: i })
    );

    // Conditions, element resistances, condition resistances, and effects — shared helpers
    Object.assign(context, prepareConditionDisplay(system));
    Object.assign(context, prepareElementDisplay(system));
    Object.assign(context, prepareConditionResistanceDisplay(system));
    context.effects = prepareEffectsDisplay(actor);

    // Merged resistance count for the combined Resistances section
    const nElem = context.notableElements?.length ?? 0;
    const nCond = context.notableConditionResistances?.length ?? 0;
    context.notableResistanceCount = nElem + nCond;
    context.hasAnyNotableResistances = (nElem + nCond) > 0;

    // Enriched biography
    const TE = foundry.applications.ux.TextEditor.implementation;
    context.enrichedBiography = await TE.enrichHTML(
      system.biography, { async: true, relativeTo: actor }
    );

    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    const tabIds = ["combat", "inventory", "biography"];
    if (tabIds.includes(partId)) {
      context.tab = context.tabs?.primary?.[partId] ?? context.tabs?.[partId];
    }
    return context;
  }

  /* -------------------------------------------- */
  /*  Drop Handlers                               */
  /* -------------------------------------------- */

  /** @override */
  async _onDropItem(event, item) {
    if (!this.actor.isOwner) return null;
    // Effect items: transfer AEs to the actor instead of embedding the item
    if (item.type === "effect") {
      const effectItem = await fromUuid(item.uuid);
      if (effectItem) await transferEffectItem(this.actor, effectItem);
      return null;
    }
    return super._onDropItem(event, item);
  }

  /* -------------------------------------------- */
  /*  Render Hooks                                */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    // Right-click context menu + hover tooltips on effect icon cells
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

  static #onRollStat(event, target) {
    const stat = target.dataset.stat;
    if (!stat) return;
    new ShardsStatTestDialog({ actor: this.actor, statKey: stat }).render(true);
  }

  static #onDeleteItem(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) item.delete();
  }

  static #onEditItem(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) item.sheet.render(true);
  }

  static #onUseItem(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) item.roll();
  }

  static async #onUseSkill(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = target.closest("[data-item-id]")?.dataset.itemId ?? target.dataset.itemId;
    const skill = this.actor.items.get(itemId);
    if (!skill || skill.type !== "skill") return;

    if (skill.system.timing === "passive") return;

    new ShardsPreRollDialog({ actor: this.actor, skill }).render(true);
  }

  static #onToggleSection(event, target) {
    const section = target.closest(".collapsible-section");
    if (section) section.classList.toggle("open");
  }

  /* -------------------------------------------- */
  /*  Effect Handlers                              */
  /* -------------------------------------------- */

  static #onCreateEffect(event, target) {
    CONFIG.SHARDS.applications.EffectCreator.open(this.actor);
  }

  static #onEditEffect(event, target) {
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId;
    if (!effectId) return;
    const effect = this.actor.effects.get(effectId);
    if (effect) effect.sheet.render(true);
  }

  static async #onToggleEffect(event, target) {
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId;
    if (!effectId) return;
    const effect = this.actor.effects.get(effectId);
    if (effect) await effect.update({ disabled: !effect.disabled });
  }

  static async #onDeleteEffect(event, target) {
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId;
    if (!effectId) return;
    const effect = this.actor.effects.get(effectId);
    if (effect) await effect.delete();
  }

  /* -------------------------------------------- */
  /*  Effect Context Menu & Tooltip                */
  /* -------------------------------------------- */

  #onEffectContextMenu(event, cell) {
    event.preventDefault();
    const effectId = cell.dataset.effectId;
    const effect = this.actor.effects.get(effectId);
    if (!effect) return;
    hideEffectTooltip();
    showEffectContextMenu(event, effect, this.element);
  }

  #onEffectHover(event, cell) {
    const effectId = cell.dataset.effectId;
    const effects = prepareEffectsDisplay(this.actor);
    const effectData = effects.find(e => e._id === effectId);
    if (!effectData) return;
    showEffectTooltip(event, effectData, this.element);
  }
}
