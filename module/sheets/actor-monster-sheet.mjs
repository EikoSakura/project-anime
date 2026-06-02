import { prepareConditionDisplay, prepareElementDisplay, prepareConditionResistanceDisplay, prepareEffectsDisplay, transferEffectItem } from "../helpers/effects.mjs";
import { showEffectContextMenu, showEffectTooltip, hideEffectTooltip } from "../helpers/effect-context-menu.mjs";
import { evaluateFormula, buildFormulaContext } from "../helpers/formulas.mjs";
import { rollAttack, rollHealing } from "../helpers/rolls.mjs";
import { rollDropTable, postLootCard } from "../helpers/drops.mjs";
import { ShardsPreRollDialog } from "../apps/preroll-dialog.mjs";
import { ShardsStatTestDialog } from "../apps/stat-test-dialog.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * Monster sheet — status card header + 4 tabbed panels.
 */
export class ShardsMonsterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "monster-sheet"],
    position: { width: 780, height: 680 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollStat: ShardsMonsterSheet.#onRollStat,
      deleteItem: ShardsMonsterSheet.#onDeleteItem,
      editItem: ShardsMonsterSheet.#onEditItem,
      useItem: ShardsMonsterSheet.#onUseItem,
      addSkill: ShardsMonsterSheet.#onAddSkill,
      postSkillToChat: ShardsMonsterSheet.#onPostSkillToChat,
      addDrop: ShardsMonsterSheet.#onAddDrop,
      deleteDrop: ShardsMonsterSheet.#onDeleteDrop,
      testDrops: ShardsMonsterSheet.#onTestDrops,
      rollDrops: ShardsMonsterSheet.#onRollDrops,
      addBehavior: ShardsMonsterSheet.#onAddBehavior,
      deleteBehavior: ShardsMonsterSheet.#onDeleteBehavior,
      toggleSection: ShardsMonsterSheet.#onToggleSection,
      createEffect: ShardsMonsterSheet.#onCreateEffect,
      editEffect: ShardsMonsterSheet.#onEditEffect,
      toggleEffect: ShardsMonsterSheet.#onToggleEffect,
      deleteEffect: ShardsMonsterSheet.#onDeleteEffect,
      useSkill: ShardsMonsterSheet.#onUseSkill
    }
  };

  /** @override */
  static PARTS = {
    card: {
      template: "systems/shards-of-mana/templates/actors/monster/monster-card.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    combat: {
      template: "systems/shards-of-mana/templates/actors/monster/tab-combat.hbs",
      scrollable: [""]
    },
    skills: {
      template: "systems/shards-of-mana/templates/actors/monster/tab-skills.hbs",
      scrollable: [""]
    },
    drops: {
      template: "systems/shards-of-mana/templates/actors/monster/tab-drops.hbs",
      scrollable: [""]
    },
    biography: {
      template: "systems/shards-of-mana/templates/actors/monster/tab-biography.hbs",
      scrollable: [""]
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "combat", group: "primary", icon: "fa-solid fa-swords", label: "SHARDS.Tabs.Combat" },
        { id: "skills", group: "primary", icon: "fa-solid fa-bolt", label: "SHARDS.Tabs.Skills" },
        { id: "drops", group: "primary", icon: "fa-solid fa-gem", label: "SHARDS.Tabs.Drops" },
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
    context.items = { equipment: [], manacite: [], trait: [], skill: [], job: [] };
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

    // --- Monster Skill Cards ---
    const derived = system.derived;
    context.monsterSkills = context.items.skill.map(item => {
      const sk = item.system;
      const formulaCtx = buildFormulaContext(actor, item);

      const computedPipCost = formulaCtx ? evaluateFormula(sk.pipCost || "0", formulaCtx) : (sk.pipCost || "0");
      const computedMpCost = formulaCtx ? evaluateFormula(sk.mpCost || "0", formulaCtx) : (sk.mpCost || "0");
      const dmgFormula = sk.effectiveFormula || sk.damageFormula || "0";
      const computedDamage = formulaCtx ? evaluateFormula(dmgFormula, formulaCtx) : (dmgFormula || "");
      const computedCondChance = formulaCtx ? evaluateFormula(sk.conditionChance || "0", formulaCtx) : (sk.conditionChance || "0");

      const isPhysical = sk.defenseType === "physical";
      const isMagical = sk.defenseType === "magical";

      // Skill rate
      let skillRate = null;
      if (sk.skillStats?.length > 0 && formulaCtx) {
        let best = 0;
        for (const statKey of sk.skillStats) {
          const val = formulaCtx[statKey.toUpperCase()] ?? 0;
          if (val > best) best = val;
        }
        skillRate = sk.skillBase + best;
      }

      const totalHit = (derived?.acc != null && skillRate != null) ? skillRate + derived.acc : null;
      const totalDamage = typeof computedDamage === "number" ? computedDamage : null;

      const skillTypeLabel = game.i18n.localize(CONFIG.SHARDS.skillTypes[sk.skillType] ?? sk.skillType ?? "");
      const damageTypeLabel = sk.damageType ? game.i18n.localize(CONFIG.SHARDS.damageTypes[sk.damageType] ?? sk.damageType) : "";
      const conditionLabel = sk.conditionApplied
        ? game.i18n.localize(CONFIG.SHARDS.conditions[sk.conditionApplied] ?? sk.conditionApplied) : "";

      return {
        _id: item._id,
        name: item.name,
        img: item.img,
        skillLevel: sk.skillLevel,
        skillType: sk.skillType ?? "active",
        isPassive: sk.isPassive,
        skillTypeLabel, damageTypeLabel, conditionLabel,
        conditionChance: typeof computedCondChance === "number" ? computedCondChance : (sk.conditionChance || "0"),
        computedPipCost, computedMpCost, computedDamage,
        totalHit, totalDamage,
        pierce: sk.pierce,
        baseAccuracy: sk.baseAccuracy,
        powerTier: sk.powerTier ?? "standard"
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    // Rank options for drop table rank dropdowns
    context.rankOptions = Object.entries(CONFIG.SHARDS.ranks).map(([value, label]) => ({
      value,
      label: game.i18n.localize(label)
    }));

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
    const tabIds = ["combat", "skills", "drops", "biography"];
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

  /* -------------------------------------------- */
  /*  Action Handlers                             */
  /* -------------------------------------------- */

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

  static async #onAddSkill(event, target) {
    const itemData = {
      name: game.i18n.localize("SHARDS.Monster.NewSkill"),
      type: "skill",
      system: {
        skillType: "active",
        timing: "action",
        autoFormula: true,
        powerTier: "standard",
        baseAccuracy: 50
      }
    };
    await this.actor.createEmbeddedDocuments("Item", [itemData]);
  }

  static async #onPostSkillToChat(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="skill-chat-post"><img src="${item.img}" width="24" height="24" /><strong>${item.name}</strong></div><p>${item.system.description ?? ""}</p>`
    });
  }

  static async #onAddDrop(event, target) {
    const dropTable = [...this.actor.system.dropTable, {
      manaciteName: "", manaciteRank: "", dropChance: 10, quantity: 1
    }];
    await this.actor.update({ "system.dropTable": dropTable });
  }

  static async #onDeleteDrop(event, target) {
    const idx = Number(target.dataset.dropIndex);
    const dropTable = this.actor.system.dropTable.filter((_, i) => i !== idx);
    await this.actor.update({ "system.dropTable": dropTable });
  }

  static async #onTestDrops(event, target) {
    const results = await rollDropTable(this.actor);
    await postLootCard(this.actor, results, { testMode: true });
  }

  static async #onRollDrops(event, target) {
    const results = await rollDropTable(this.actor);
    if (results.gold > 0 || results.successfulDrops.length > 0) {
      await postLootCard(this.actor, results);
    } else {
      ui.notifications.info(
        game.i18n.format("SHARDS.Drops.SystemVoiceNoDrops", { monster: this.actor.name })
      );
    }
    await this.actor.update({ "system.dropsRolled": true });
  }

  static async #onAddBehavior(event, target) {
    const behaviorPriority = [...this.actor.system.behaviorPriority, ""];
    await this.actor.update({ "system.behaviorPriority": behaviorPriority });
  }

  static async #onDeleteBehavior(event, target) {
    const idx = Number(target.dataset.behaviorIndex);
    const behaviorPriority = this.actor.system.behaviorPriority.filter((_, i) => i !== idx);
    await this.actor.update({ "system.behaviorPriority": behaviorPriority });
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
