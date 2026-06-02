import { prepareConditionDisplay, prepareElementDisplay, prepareConditionResistanceDisplay, prepareEffectsDisplay, transferEffectItem } from "../helpers/effects.mjs";
import { showEffectContextMenu, showEffectTooltip, hideEffectTooltip } from "../helpers/effect-context-menu.mjs";
import { evaluateFormula, buildFormulaContext } from "../helpers/formulas.mjs";
import { rollAttack, rollHealing, rollWeaponAttack } from "../helpers/rolls.mjs";
import { ShardsPreRollDialog } from "../apps/preroll-dialog.mjs";
import { ShardsStatTestDialog } from "../apps/stat-test-dialog.mjs";
import { ManaGridRenderer } from "../apps/grid-renderer.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * Adventurer sheet — status card header + 6 tabbed panels.
 * Crystal/magical UI with dense information display.
 */
export class ShardsAdventurerSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** Transient: current sort order for the Skills tab ("type", "name", "level"). */
  _skillSort = "type";

  /** Transient: tracks which collapsible sections are open (survives re-renders). */
  _openSections = new Set();

  /** Transient: Mana Grid renderer instance (mounted in Build tab). */
  _gridRenderer = null;

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "adv-sheet"],
    position: { width: 880, height: 740 },
    window: {
      resizable: true
    },
    form: { submitOnChange: true },
    actions: {
      openThemePicker: ShardsAdventurerSheet.#onOpenThemePicker,
      rollStat: ShardsAdventurerSheet.#onRollStat,
      deleteItem: ShardsAdventurerSheet.#onDeleteItem,
      editItem: ShardsAdventurerSheet.#onEditItem,
      useItem: ShardsAdventurerSheet.#onUseItem,
      addBond: ShardsAdventurerSheet.#onAddBond,
      deleteBond: ShardsAdventurerSheet.#onDeleteBond,
      setHeartRank: ShardsAdventurerSheet.#onSetHeartRank,
      breakBond: ShardsAdventurerSheet.#onBreakBond,
      restoreBond: ShardsAdventurerSheet.#onRestoreBond,
      openBondActor: ShardsAdventurerSheet.#onOpenBondActor,
      levelUp: ShardsAdventurerSheet.#onLevelUp,
      setPip: ShardsAdventurerSheet.#onSetPip,
      toggleSection: ShardsAdventurerSheet.#onToggleSection,
      browseJobs: ShardsAdventurerSheet.#onBrowseJobs,
      browseEquipment: ShardsAdventurerSheet.#onBrowseEquipment,
      browseManacite: ShardsAdventurerSheet.#onBrowseManacite,
      browseSkills: ShardsAdventurerSheet.#onBrowseSkills,

      absorbManacite: ShardsAdventurerSheet.#onAbsorbManacite,
      createEffect: ShardsAdventurerSheet.#onCreateEffect,
      editEffect: ShardsAdventurerSheet.#onEditEffect,
      toggleEffect: ShardsAdventurerSheet.#onToggleEffect,
      deleteEffect: ShardsAdventurerSheet.#onDeleteEffect,
      sortSkills: ShardsAdventurerSheet.#onSortSkills,
      useSkill: ShardsAdventurerSheet.#onUseSkill,
      postSkillToChat: ShardsAdventurerSheet.#onPostSkillToChat,

      levelSkill: ShardsAdventurerSheet.#onLevelSkill,
      toggleEquip: ShardsAdventurerSheet.#onToggleEquip,
      useWeapon: ShardsAdventurerSheet.#onUseWeapon,
      openSlotBrowser: ShardsAdventurerSheet.#onOpenSlotBrowser,
      grantExperientialSkill: ShardsAdventurerSheet.#onGrantExperientialSkill,
      browseLineage: ShardsAdventurerSheet.#onBrowseLineage,
      removeLineage: ShardsAdventurerSheet.#onRemoveLineage,
      awardXp: ShardsAdventurerSheet.#onAwardXp,
      adjustLimitBreak: ShardsAdventurerSheet.#onAdjustLimitBreak
    }
  };

  /** @override */
  static PARTS = {
    card: {
      template: "systems/shards-of-mana/templates/actors/adventurer/adv-card.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    combat: {
      template: "systems/shards-of-mana/templates/actors/adventurer/tab-combat.hbs",
      scrollable: [""]
    },
    equipment: {
      template: "systems/shards-of-mana/templates/actors/adventurer/tab-equipment.hbs",
      scrollable: [""]
    },
    skills: {
      template: "systems/shards-of-mana/templates/actors/adventurer/tab-skills.hbs",
      scrollable: [""]
    },

    bonds: {
      template: "systems/shards-of-mana/templates/actors/adventurer/tab-bonds.hbs",
      scrollable: [""]
    },
    biography: {
      template: "systems/shards-of-mana/templates/actors/adventurer/tab-biography.hbs",
      scrollable: [""]
    },

    build: {
      template: "systems/shards-of-mana/templates/actors/adventurer/tab-build.hbs",
      scrollable: [""]
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "combat", group: "primary", icon: "fa-solid fa-swords", label: "SHARDS.Tabs.Combat" },
        { id: "build", group: "primary", icon: "fa-solid fa-gem", label: "SHARDS.Grid.Title" },
        { id: "skills", group: "primary", icon: "fa-solid fa-book-sparkles", label: "SHARDS.Tabs.Skills" },
        { id: "equipment", group: "primary", icon: "fa-solid fa-shield", label: "SHARDS.Tabs.Equipment" },
        { id: "bonds", group: "primary", icon: "fa-solid fa-heart", label: "SHARDS.Tabs.Bonds" },
        { id: "biography", group: "primary", icon: "fa-solid fa-book", label: "SHARDS.Tabs.Biography" }
      ],
      initial: "combat",
      labelPrefix: "SHARDS.Tabs"
    }
  };

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;

    context.actor = actor;
    context.system = system;
    context.config = CONFIG.SHARDS;

    // Organize items by type
    context.items = { equipment: [], manacite: [], skill: [], job: [], lineage: [] };
    for (const item of actor.items) {
      if (context.items[item.type]) context.items[item.type].push(item);
    }

    // Active job
    context.activeJob = system.activeJobId
      ? actor.items.get(system.activeJobId) ?? null
      : null;

    // Active job display (card header only — job management moved to Mana Grid)
    context.hasActiveJob = !!context.activeJob;

    // --- Skills tab ---
    context.skillCount = context.items.skill.length;
    context.unabsorbedManacite = context.items.manacite.filter(m => !m.system.absorbed);

    // Build enriched skill data for collapsible tooltips
    const derived = system.derived;
    context.skillCards = context.items.skill.map(item => {
      const sk = item.system;
      const formulaCtx = buildFormulaContext(actor, item);

      // Evaluate formula fields
      const computedPipCost = formulaCtx ? evaluateFormula(sk.pipCost || "0", formulaCtx) : (sk.pipCost || "0");
      const computedMpCost = formulaCtx ? evaluateFormula(sk.mpCost || "0", formulaCtx) : (sk.mpCost || "0");
      const dmgFormula = sk.effectiveFormula || sk.damageFormula || "0";
      const computedDamage = formulaCtx ? evaluateFormula(dmgFormula, formulaCtx) : (dmgFormula || "");
      const computedRange = formulaCtx ? evaluateFormula(sk.range || "0", formulaCtx) : (sk.range || "0");
      const computedCondChance = formulaCtx ? evaluateFormula(sk.conditionChance || "0", formulaCtx) : (sk.conditionChance || "0");

      // Skill rate
      let skillRate = null;
      let allSkillStatLabels = null;
      if (sk.skillStats?.length > 0) {
        allSkillStatLabels = sk.skillStats
          .map(k => game.i18n.localize(CONFIG.SHARDS.stats[k] ?? k.toUpperCase()))
          .join(", ");
        if (formulaCtx) {
          let best = 0;
          for (const statKey of sk.skillStats) {
            const val = formulaCtx[statKey.toUpperCase()] ?? 0;
            if (val > best) best = val;
          }
          skillRate = sk.skillBase + best;
        }
      }

      // Physical vs magical classification (based on defenseType)
      const isPhysical = sk.defenseType === "physical";
      const isMagical = sk.defenseType === "magical";
      const hitStat = isPhysical ? "ACC" : isMagical ? "ACC" : null;
      const dmgStat = isPhysical ? "pDef" : isMagical ? "mDef" : null;

      // Hit/Dmg totals (simplified: ACC is unified, damage is formula-only)
      const totalHit = (derived?.acc != null && skillRate != null) ? skillRate + derived.acc : null;
      const totalDamage = typeof computedDamage === "number" ? computedDamage : null;

      // Labels
      const skillTypeLabel = game.i18n.localize(CONFIG.SHARDS.skillTypes[sk.skillType] ?? sk.skillType ?? "");
      const timingLabel = game.i18n.localize(CONFIG.SHARDS.skillTimings[sk.timing] ?? sk.timing ?? "");
      const damageTypeLabel = sk.damageType ? game.i18n.localize(CONFIG.SHARDS.damageTypes[sk.damageType] ?? sk.damageType) : "";
      const defenseTypeLabel = sk.defenseType && sk.defenseType !== "none"
        ? game.i18n.localize(CONFIG.SHARDS.defenseTypes[sk.defenseType] ?? "") : "";
      const targetLabel = game.i18n.localize(CONFIG.SHARDS.targetTypes[sk.target] ?? sk.target ?? "");
      const areaShapeLabel = sk.areaShape ? game.i18n.localize(CONFIG.SHARDS.areaShapes[sk.areaShape] ?? "") : "";
      const conditionLabel = sk.conditionApplied
        ? game.i18n.localize(CONFIG.SHARDS.conditions[sk.conditionApplied] ?? sk.conditionApplied) : "";

      return {
        _id: item._id,
        name: item.name,
        img: item.img,
        skillLevel: sk.skillLevel,
        source: sk.source,
        originNote: sk.originNote ?? "",
        stackable: !!sk.stackable,
        stackCount: 1,
        skillType: sk.skillType ?? "active",
        isPassive: sk.isPassive,
        skillTypeLabel, timingLabel, damageTypeLabel, defenseTypeLabel,
        targetLabel, areaShapeLabel, conditionLabel,
        conditionChance: typeof computedCondChance === "number" ? computedCondChance : (sk.conditionChance || "0"),
        computedPipCost, computedMpCost, computedDamage,
        skillRate, allSkillStatLabels,
        totalHit, totalDamage,
        hitLabel: isPhysical ? "P.Hit" : isMagical ? "M.Hit" : null,
        dmgLabel: isPhysical ? "P.Dmg" : isMagical ? "M.Dmg" : null,
        hitStat, dmgStat,
        crit: derived.crit,
        range: computedRange,
        showAreaFields: sk.target === "area",
        areaSize: sk.areaSize,
        tags: [...(sk.tags ?? [])],
        powerTier: sk.powerTier ?? "standard",
        autoFormula: !!sk.autoFormula,
        effectiveFormula: sk.effectiveFormula ?? sk.damageFormula ?? "",
        isMaxLevel: sk.isMaxLevel
      };
    });

    // --- Collapse stackable duplicates into grouped cards with a count ---
    {
      const grouped = new Map(); // name → card (first seen)
      const merged = [];
      for (const card of context.skillCards) {
        if (card.stackable) {
          const existing = grouped.get(card.name);
          if (existing) {
            existing.stackCount += 1;
            continue; // skip duplicate — already represented by first card
          }
          grouped.set(card.name, card);
        }
        merged.push(card);
      }
      context.skillCards = merged;
    }

    // --- Skill sorting ---
    context.skillSort = this._skillSort;
    const sortedSkills = [...context.skillCards];
    switch (this._skillSort) {
      case "name":
        sortedSkills.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "level":
        sortedSkills.sort((a, b) => b.skillLevel - a.skillLevel || a.name.localeCompare(b.name));
        break;
      case "type":
      default:
        // No additional sort needed — grouping handles order
        break;
    }

    // --- Skill grouping by type ---
    // Canonical category order: active → reaction → passive → limitBreak
    const categoryOrder = ["active", "reaction", "passive", "limitBreak"];
    const categoryLabels = {};
    const categoryIcons = {
      active: "fa-solid fa-swords",
      reaction: "fa-solid fa-shield-halved",
      passive: "fa-solid fa-circle-nodes",
      limitBreak: "fa-solid fa-burst"
    };
    for (const key of categoryOrder) {
      categoryLabels[key] = game.i18n.localize(CONFIG.SHARDS.skillTypes[key] ?? key);
    }

    if (this._skillSort === "type") {
      // Group by skill type
      const grouped = {};
      for (const key of categoryOrder) grouped[key] = [];
      for (const sk of sortedSkills) {
        const type = sk.skillType ?? "active";
        if (!grouped[type]) grouped[type] = [];
        grouped[type].push(sk);
      }
      // Sort within each group by name
      for (const key of Object.keys(grouped)) {
        grouped[key].sort((a, b) => a.name.localeCompare(b.name));
      }
      context.skillGroups = categoryOrder
        .filter(key => grouped[key]?.length > 0)
        .map(key => ({
          key,
          label: categoryLabels[key],
          icon: categoryIcons[key],
          skills: grouped[key]
        }));
    } else {
      // Flat list — single group with no header
      context.skillGroups = [{
        key: "all",
        label: null,
        icon: null,
        skills: sortedSkills
      }];
    }

    // Combat tab: active + reaction + limitBreak skills (non-passive)
    context.combatSkillCards = context.skillCards.filter(sk => !sk.isPassive);

    // --- Combination readiness detection ---
    // --- GM-only: Exposure Tracker ---
    context.isGM = game.user.isGM;
    if (context.isGM) {
      const thresholds = CONFIG.SHARDS.exposureThresholds ?? {};
      const log = system.exposureLog ?? [];
      context.exposureEntries = [];
      for (const entry of log) {
        const cfg = thresholds[entry.condition];
        if (!cfg) continue;
        const threshold = cfg.threshold ?? 5;
        const reached = entry.count >= threshold;
        const conditionLabel = game.i18n.localize(CONFIG.SHARDS.conditions[entry.condition] ?? entry.condition);
        context.exposureEntries.push({
          condition: entry.condition,
          conditionLabel,
          count: entry.count,
          threshold,
          reached,
          pct: Math.min(100, Math.round((entry.count / threshold) * 100)),
          suggestedSkill: cfg.suggestedSkill ?? ""
        });
      }
      context.hasExposureEntries = context.exposureEntries.length > 0;
    }

    // Equipment cards — enriched data for collapsible cards
    const slotOrder = Object.keys(CONFIG.SHARDS.equipmentSlots);

    // Determine dual-wield state: find all equipped weapon-slot items to label the second as "Offhand"
    const equippedWeaponItems = context.items.equipment.filter(
      i => i.system.slot === "weapon" && i.system.equipped
    );
    const isDualWielding = equippedWeaponItems.length >= 2;

    context.equipmentCards = context.items.equipment.map(item => {
      const sys = item.system;

      // Determine effective slot label: if dual-wielding, the second equipped weapon shows as "Offhand"
      let effectiveSlot = sys.slot;
      let slotLabel = game.i18n.localize(CONFIG.SHARDS.equipmentSlots[sys.slot] ?? sys.slot);
      if (isDualWielding && sys.slot === "weapon" && sys.equipped
          && item._id === equippedWeaponItems[1]._id) {
        slotLabel = game.i18n.localize("SHARDS.Equipment.Offhand");
        effectiveSlot = "offhand";
      }

      // Collect non-zero stat bonuses for display
      const statBonuses = [];
      for (const [key, value] of Object.entries(sys.statBonuses)) {
        if (value !== 0) {
          statBonuses.push({
            key,
            label: game.i18n.localize(CONFIG.SHARDS.stats[key] ?? key.toUpperCase()),
            value,
            displayValue: value > 0 ? `+${value}` : `${value}`
          });
        }
      }

      // Combat stats (relevant for weapons/offhand)
      const combatStats = [];
      const isWeaponSlot = sys.slot === "weapon" || sys.slot === "offhand";
      if (isWeaponSlot) {
        combatStats.push({ label: "Acc", value: sys.baseAccuracy ?? 50, displayValue: `${sys.baseAccuracy ?? 50}%` });
        if (sys.pDmg) combatStats.push({ label: "P.Dmg", value: sys.pDmg, displayValue: sys.pDmg > 0 ? `+${sys.pDmg}` : `${sys.pDmg}` });
        if (sys.mDmg) combatStats.push({ label: "M.Dmg", value: sys.mDmg, displayValue: sys.mDmg > 0 ? `+${sys.mDmg}` : `${sys.mDmg}` });
      }

      // Classification label (weapon group or armor category)
      let classificationLabel = "";
      if (sys.weaponGroup) {
        classificationLabel = game.i18n.localize(CONFIG.SHARDS.weaponGroups[sys.weaponGroup] ?? sys.weaponGroup);
      } else if (sys.armorCategory) {
        classificationLabel = game.i18n.localize(CONFIG.SHARDS.armorCategories[sys.armorCategory] ?? sys.armorCategory);
      }

      // Handedness info (weapons only)
      const handedness = sys.handedness ?? "one-handed";
      const isTwoHanded = sys.isTwoHanded;
      const isOversized = handedness === "oversized";
      const handednessLabel = isWeaponSlot && handedness !== "one-handed"
        ? game.i18n.localize(CONFIG.SHARDS.handedness[handedness] ?? handedness)
        : "";
      const handednessAbbrev = handedness === "two-handed" ? "2H"
        : handedness === "oversized" ? "OS" : "";

      // Oversized warning (equipped + STR not met)
      const oversizedWarning = sys.equipped && isOversized && sys.strRequirement > 0
        && (this.actor.system.stats.str.total ?? 0) < sys.strRequirement;

      return {
        _id: item._id,
        name: item.name,
        img: item.img,
        rank: sys.rank,
        slot: sys.slot,
        effectiveSlot,
        slotLabel,
        equipped: sys.equipped,
        isWeaponSlot,
        classificationLabel,
        statBonuses,
        combatStats,
        properties: [...(sys.properties ?? [])],
        handednessLabel,
        handednessAbbrev,
        isTwoHanded,
        isOversized,
        oversizedWarning,
        hasDetails: statBonuses.length > 0 || combatStats.length > 0 || (sys.properties?.length ?? 0) > 0,
        slotIndex: slotOrder.indexOf(sys.slot)
      };
    });

    // Sort: equipped first, then by slot order, then by name
    context.equipmentCards.sort((a, b) => {
      if (a.equipped !== b.equipped) return a.equipped ? -1 : 1;
      if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
      return a.name.localeCompare(b.name);
    });
    context.equippedCount = context.equipmentCards.filter(c => c.equipped).length;

    // Offhand blocked: a two-handed/oversized weapon is equipped and no Mighty Grip
    const hasMightyGrip = this.actor.system.flags?.mightyGrip;
    const equippedTwoHanded = context.equipmentCards.find(c => c.equipped && c.slot === "weapon" && c.isTwoHanded);
    context.offhandBlocked = !!equippedTwoHanded && !hasMightyGrip;

    // Paperdoll: build slot map for the paperdoll display
    context.equippedBySlot = {
      weapon: null, offhand: null, armor: null, helm: null, accessory1: null, accessory2: null
    };
    for (const card of context.equipmentCards) {
      if (card.equipped) {
        context.equippedBySlot[card.effectiveSlot] = card;
      }
    }

    // Unequipped items for inventory grid
    context.unequippedItems = context.equipmentCards
      .filter(c => !c.equipped)
      .sort((a, b) => {
        if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
        return a.name.localeCompare(b.name);
      });

    // Paperdoll slot descriptors
    const slotIcons = {
      weapon: "fa-solid fa-sword",
      offhand: "fa-solid fa-shield-halved",
      armor: "fa-solid fa-shirt",
      helm: "fa-solid fa-helmet-safety",
      accessory1: "fa-solid fa-ring",
      accessory2: "fa-solid fa-ring"
    };
    const allPaperdollSlots = Object.keys(CONFIG.SHARDS.equipmentSlots).map(slotKey => {
      const equippedItem = context.equippedBySlot[slotKey];
      const isLocked = slotKey === "offhand" && context.offhandBlocked;
      return {
        slotKey,
        slotLabel: game.i18n.localize(CONFIG.SHARDS.equipmentSlots[slotKey]),
        slotIcon: slotIcons[slotKey],
        item: equippedItem,
        isLocked,
        isEmpty: !equippedItem && !isLocked,
        side: ["weapon", "armor", "helm"].includes(slotKey) ? "left" : "right"
      };
    });
    context.leftSlots = allPaperdollSlots.filter(s => s.side === "left");
    context.rightSlots = allPaperdollSlots.filter(s => s.side === "right");
    context.actorImg = this.actor.img;

    // Combat tab: equipped weapons/offhand for display
    context.combatWeapons = context.equipmentCards.filter(c => c.equipped && c.isWeaponSlot);

    // Grid socket summary for Build tab
    const filledSockets = (system.grid?.sockets ?? []).filter(s => !!s.itemId).length;
    const totalSockets = (system.grid?.sockets ?? []).length;
    context.gridSocketSummary = `${filledSockets} / ${totalSockets} socketed`;

    // Lineage display — from the single embedded lineage item (body template card)
    const LineageTE = foundry.applications.ux.TextEditor.implementation;
    context.lineageItems = context.items.lineage;
    for (const sp of context.lineageItems) {
      const spItem = this.actor.items.get(sp._id);
      sp.enrichedDescription = await LineageTE.enrichHTML(
        sp.system.description ?? "",
        { async: true, relativeTo: spItem ?? this.actor }
      );
      sp.hasDescription = !!sp.system.description?.trim();
      sp.isOpen = this._openSections.has(sp._id);
      sp.innateTraits = spItem?.system?.innateTraits ?? [];
    }
    context.lineageDisplay = context.lineageItems[0]?.name
      ?? game.i18n.localize("SHARDS.Adventurer.NoLineage");

    // Grid data for Build tab (passed to renderer in _onRender)
    context.gridData = system.grid ?? { sockets: [] };

    // Derived stats in explicit display order:
    // Row 1: PHIT, PEVA, PDMG, PDEF, PRED, Crit Rate
    // Row 2: MHIT, MEVA, MDMG, MDEF, MRED, Crit Avoidance
    const derivedOrder = ["acc", "eva", "pDef", "mDef", "crit"];
    context.derivedDisplay = derivedOrder.map(key => ({
      key,
      label: game.i18n.localize(CONFIG.SHARDS.derivedStats[key] ?? `SHARDS.Derived.${key}`),
      value: system.derived[key]
    }));

    // Bar percentages (clamped 0–100) and clip-path values (100 - pct)
    context.healthPct = system.health.max > 0
      ? Math.clamp(Math.round((system.health.value / system.health.max) * 100), 0, 100) : 0;
    context.healthClip = 100 - context.healthPct;
    context.manaPct = system.mana.max > 0
      ? Math.clamp(Math.round((system.mana.value / system.mana.max) * 100), 0, 100) : 0;
    context.manaClip = 100 - context.manaPct;
    context.limitBreakPct = system.limitBreak.max > 0
      ? Math.round((system.limitBreak.value / system.limitBreak.max) * 100) : 0;
    context.limitBreakReady = system.limitBreak.max > 0
      && system.limitBreak.value >= system.limitBreak.max;
    // Level-up detection
    context.canLevelUp = system.canLevelUp;
    context.isGM = game.user.isGM;

    // Combined stat + growth rate display for the card (2-col order: left STR/AGI/VIT/PER, right MAG/SPI/LCK/CHM)
    const cardStatOrder = ['str', 'mag', 'agi', 'spi', 'vit', 'lck', 'per', 'chm'];
    context.statCardDisplay = cardStatOrder.map(key => ({
      key,
      abbrev: key,
      value: system.stats[key].total,
      growth: system.growthRates[key],
      growthDisplay: `${system.growthRates[key]}%`
    }));

    // XP bar data for card
    const xpPerLevel = CONFIG.SHARDS.xpPerLevel ?? 500;
    const xpPrevThreshold = (system.level - 1) * xpPerLevel;
    context.xpProgress = system.xpProgress;
    context.xpInBracket = system.xp.total - xpPrevThreshold;
    context.xpPerLevel = xpPerLevel;

    // Growth rate display with tiers
    context.growthRateDisplay = Object.entries(system.growthRates).map(([key, value]) => {
      let tier = "low";
      if (value >= 50) tier = "high";
      else if (value >= 25) tier = "medium";
      return {
        key,
        label: game.i18n.localize(CONFIG.SHARDS.stats[key]),
        value,
        barWidth: Math.min(value / 2, 100),
        tier
      };
    });

    // Growth total validation state
    const grTotal = system.growthRateTotal;
    context.growthTotalState = grTotal === 200 ? "valid" : (grTotal > 200 ? "over" : "under");

    // Level history display
    context.levelHistoryDisplay = (system.levelHistory ?? [])
      .slice()
      .reverse()
      .map(entry => {
        const gainLabels = Object.entries(entry.gains)
          .filter(([_, grew]) => grew)
          .map(([key]) => game.i18n.localize(CONFIG.SHARDS.stats[key]));
        return {
          level: entry.level,
          gainLabels,
          totalGains: gainLabels.length
        };
      });

    // Growth rate bar widths
    context.growthBarWidths = {};
    for (const [key, value] of Object.entries(system.growthRates)) {
      context.growthBarWidths[key] = Math.min(value / 2, 100);
    }

    // Pip dot array
    context.pipArray = Array.from(
      { length: system.pips.max },
      (_, i) => ({ filled: i < system.pips.value, index: i })
    );

    // Death count array
    context.deathArray = Array.from(
      { length: system.deathCounts.max },
      (_, i) => ({ spent: i < (system.deathCounts.max - system.deathCounts.value), index: i })
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

    // Movement modes — alphabetized, with active flag (value > 0 = has it)
    context.movementDisplay = Object.entries(system.movementModes)
      .map(([key, value]) => ({
        key,
        label: game.i18n.localize(`SHARDS.Movement.${key}`),
        value,
        active: value > 0
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // Enriched biography sections
    const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;
    context.enrichedBiography = await TextEditorImpl.enrichHTML(
      system.biography ?? "", { async: true, relativeTo: actor }
    );
    context.enrichedAppearance = await TextEditorImpl.enrichHTML(
      system.appearance ?? "", { async: true, relativeTo: actor }
    );
    context.enrichedPersonality = await TextEditorImpl.enrichHTML(
      system.personality ?? "", { async: true, relativeTo: actor }
    );
    context.isGM = game.user.isGM;

    // Source object for prose-mirror raw values
    if (!context.source) context.source = actor.toObject();

    // Sheet theme
    context.sheetTheme = this.actor.getFlag("shards-of-mana", "sheetTheme") ?? "silver";

    // --- Bonds tab ---
    context.bondCards = (system.bonds ?? []).map((bond, idx) => {
      const archetypeDef = CONFIG.SHARDS.bondArchetypes[bond.archetype]
        ?? CONFIG.SHARDS.bondArchetypes.rival;
      // Ensure rankNotes is always 5 entries, with computed flags
      const rankNotes = Array.from({ length: 5 }, (_, i) => ({
        condition: bond.rankNotes?.[i]?.condition ?? "",
        unlock: bond.rankNotes?.[i]?.unlock ?? "",
        unlocked: i < bond.heartRank,
        rankLabel: i + 1
      }));
      return {
        ...bond,
        _index: idx,
        archetypeIcon: archetypeDef.icon,
        archetypeLabel: game.i18n.localize(archetypeDef.label),
        archetypeColor: archetypeDef.color,
        heartPips: Array.from({ length: 5 }, (_, i) => ({
          rank: i + 1,
          filled: i < bond.heartRank,
          broken: bond.bondBroken
        })),
        rankNotes
      };
    });
    context.bondCount = context.bondCards.length;

    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    // Pass the full tabs group config to the tab-navigation part
    if (partId === "tabs") {
      context.tabs = context.tabs;
    }
    // Pass individual tab state to each tab content part
    const tabIds = ["combat", "build", "skills", "equipment", "bonds", "biography"];
    if (tabIds.includes(partId)) {
      context.tab = context.tabs?.primary?.[partId] ?? context.tabs?.[partId];
    }
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    // Ensure the active tab is always visible after any re-render
    const activeTab = this.tabGroups?.primary ?? "combat";
    const tabs = this.element.querySelectorAll("[data-group='primary'][data-tab]");
    for (const tab of tabs) {
      const isActive = tab.dataset.tab === activeTab;
      tab.classList.toggle("active", isActive);
    }
    // Also set the active nav button
    const navButtons = this.element.querySelectorAll("[data-group='primary'][data-action='tab']");
    for (const btn of navButtons) {
      btn.classList.toggle("active", btn.dataset.tab === activeTab);
    }

    // Restore collapsible section open state across re-renders
    for (const key of this._openSections) {
      const section = this.element.querySelector(`.collapsible-section[data-section="${key}"]`)
        ?? this.element.querySelector(`.collapsible-section[data-item-id="${key}"]`);
      if (section) section.classList.add("open");
    }

    // Mount or refresh Mana Grid renderer
    this.#mountGridRenderer();

    // Apply color theme
    const theme = context.sheetTheme ?? "silver";
    if (theme !== "silver") {
      this.element.dataset.theme = theme;
    } else {
      delete this.element.dataset.theme;
    }

    // Bind right-click context menu on skill cards and combat skill rows
    for (const el of this.element.querySelectorAll(".adv-skill-card[data-item-id], .adv-skill[data-item-id]")) {
      el.addEventListener("contextmenu", this.#onSkillContextMenu.bind(this));
    }


    // Bind right-click context menu on lineage cards
    for (const el of this.element.querySelectorAll(".adv-species-card[data-item-id]")) {
      el.addEventListener("contextmenu", this.#onLineageContextMenu.bind(this));
    }

    // Bind right-click context menu + hover tooltips on paperdoll slots and inventory tiles
    for (const el of this.element.querySelectorAll(".paperdoll-slot[data-item-id], .equip-inv-card[data-item-id]")) {
      el.addEventListener("contextmenu", this.#onEquipmentContextMenu.bind(this));
      el.addEventListener("mouseenter", this.#onEquipmentSlotHover.bind(this));
      el.addEventListener("mouseleave", this.#onEquipmentSlotLeave.bind(this));
    }

    // Right-click context menu + hover tooltips on effect icon cells
    // Bind directly to each cell (cells are replaced by part re-renders)
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

    // Bind right-click context menu on bond cards
    for (const el of this.element.querySelectorAll(".bond-card[data-bond-index]")) {
      el.addEventListener("contextmenu", this.#onBondContextMenu.bind(this));
    }

    // Inject palette button into the title bar, to the LEFT of the header buttons
    const header = this.element.querySelector(".window-header");
    if (header && !header.querySelector(".theme-palette-btn")) {
      const paletteBtn = document.createElement("button");
      paletteBtn.type = "button";
      paletteBtn.className = "theme-palette-btn";
      paletteBtn.title = game.i18n.localize("SHARDS.Theme.ChooseTheme");
      paletteBtn.innerHTML = `<img src="systems/shards-of-mana/icons/palette.svg" alt="" />`;
      paletteBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        ShardsAdventurerSheet.#onOpenThemePicker.call(this, ev, paletteBtn);
      });
      // Find the first button/control in the header (three-dots, globe, close, etc.)
      const firstHeaderBtn = header.querySelector("button, .header-control");
      if (firstHeaderBtn) {
        firstHeaderBtn.before(paletteBtn);
      } else {
        header.appendChild(paletteBtn);
      }
    }

    // Inject Character Creation Wizard button next to the palette button
    if (header && !header.querySelector(".chargen-wizard-btn")) {
      const wizardBtn = document.createElement("button");
      wizardBtn.type = "button";
      wizardBtn.className = "chargen-wizard-btn";
      wizardBtn.title = game.i18n.localize("SHARDS.CharGen.Title");
      wizardBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i>`;
      wizardBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        new CONFIG.SHARDS.applications.CharGenWizard({ actor: this.actor }).render(true);
      });
      const paletteBtn2 = header.querySelector(".theme-palette-btn");
      if (paletteBtn2) {
        paletteBtn2.after(wizardBtn);
      } else {
        const firstBtn = header.querySelector("button, .header-control");
        if (firstBtn) firstBtn.before(wizardBtn);
        else header.appendChild(wizardBtn);
      }
    }

    // Inject Level Up Wizard button after the chargen wizard button
    if (header && !header.querySelector(".levelup-wizard-btn")) {
      const canLevel = this.actor.system.canLevelUp;
      const levelUpBtn = document.createElement("button");
      levelUpBtn.type = "button";
      levelUpBtn.className = `levelup-wizard-btn ${canLevel ? "can-level-up" : "cannot-level"}`;
      levelUpBtn.title = game.i18n.localize("SHARDS.LevelUp.Title");
      levelUpBtn.innerHTML = `<i class="fa-solid fa-arrow-trend-up"></i>`;
      levelUpBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!this.actor.system.canLevelUp) {
          ui.notifications.warn(game.i18n.localize("SHARDS.LevelUp.CannotLevelUpWizard"));
          return;
        }
        new CONFIG.SHARDS.applications.LevelUpWizard({ actor: this.actor }).render(true);
      });
      const chargenBtn = header.querySelector(".chargen-wizard-btn");
      if (chargenBtn) {
        chargenBtn.after(levelUpBtn);
      } else {
        const firstBtn = header.querySelector("button, .header-control");
        if (firstBtn) firstBtn.before(levelUpBtn);
        else header.appendChild(levelUpBtn);
      }
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

  /**
   * Handle clicking the "Use Skill" button on the combat tab.
   * Gathers targets, routes to the appropriate roll function.
   */
  static async #onUseSkill(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = target.closest("[data-item-id]")?.dataset.itemId ?? target.dataset.itemId;
    const skill = this.actor.items.get(itemId);
    if (!skill || skill.type !== "skill") return;

    // Passive skills cannot be "used"
    if (skill.system.timing === "passive") return;

    // Open pre-roll confirmation dialog
    new ShardsPreRollDialog({ actor: this.actor, skill }).render(true);
  }

  /**
   * Handle clicking the "Attack" button on an equipped weapon in the combat tab.
   * Gathers targets and rolls a basic weapon attack.
   */
  static async #onUseWeapon(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = target.closest("[data-item-id]")?.dataset.itemId ?? target.dataset.itemId;
    const weapon = this.actor.items.get(itemId);
    if (!weapon || weapon.type !== "equipment") return;

    // Open pre-roll confirmation dialog for weapon attacks
    new ShardsPreRollDialog({ actor: this.actor, skill: weapon, isWeapon: true }).render(true);
  }

  static async #onAddBond(event, target) {
    // Show archetype picker dialog
    const archetypes = CONFIG.SHARDS.bondArchetypes;
    const keys = Object.keys(archetypes);
    let selectedArchetype = keys[0]; // default to first

    const optionsHtml = Object.entries(archetypes).map(([key, def], idx) => {
      const label = game.i18n.localize(def.label);
      const checked = idx === 0 ? "checked" : "";
      return `<label class="bond-archetype-option${idx === 0 ? " selected" : ""}" data-archetype="${key}">
        <input type="radio" name="archetype" value="${key}" ${checked} />
        <span class="bond-archetype-option__swatch" style="border-color: ${def.color}; color: ${def.color}">
          <i class="${def.icon}"></i>
        </span>
        <span class="bond-archetype-option__label">${label}</span>
      </label>`;
    }).join("");

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("SHARDS.Bonds.ChooseArchetype") },
      content: `<div class="bond-archetype-grid">${optionsHtml}</div>`,
      buttons: [
        { action: "confirm", label: game.i18n.localize("SHARDS.Bonds.Add"), icon: "fa-solid fa-plus" },
        { action: "cancel", label: game.i18n.localize("SHARDS.Cancel"), icon: "fa-solid fa-times" }
      ],
      render: (event, dialog) => {
        for (const radio of dialog.element.querySelectorAll("input[name='archetype']")) {
          radio.addEventListener("change", () => {
            selectedArchetype = radio.value;
            dialog.element.querySelectorAll(".bond-archetype-option").forEach(el =>
              el.classList.toggle("selected", el.querySelector("input").checked)
            );
          });
        }
      }
    });

    if (result !== "confirm") return;

    const bonds = [...this.actor.system.bonds, {
      actorUuid: "",
      img: "icons/svg/mystery-man.svg",
      characterName: "",
      archetype: selectedArchetype,
      heartRank: 0,
      bondBroken: false,
      notes: "",
      rankNotes: [
        { condition: "", unlock: "" },
        { condition: "", unlock: "" },
        { condition: "", unlock: "" },
        { condition: "", unlock: "" },
        { condition: "", unlock: "" }
      ]
    }];
    await this.actor.update({ "system.bonds": bonds });
  }

  static async #onDeleteBond(event, target) {
    const idx = Number(target.closest("[data-bond-index]")?.dataset.bondIndex);
    const bond = this.actor.system.bonds[idx];
    if (!bond) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("SHARDS.Bonds.DeleteTitle") },
      content: `<p>${game.i18n.format("SHARDS.Bonds.DeleteConfirm", { name: bond.characterName || "?" })}</p>`
    });
    if (!confirmed) return;

    const bonds = this.actor.system.bonds.filter((_, i) => i !== idx);
    await this.actor.update({ "system.bonds": bonds });
  }

  static async #onSetHeartRank(event, target) {
    // Bond advancement is GM-only (narrative milestones, no currency cost)
    if (!game.user.isGM) return;

    const idx = Number(target.closest("[data-bond-index]")?.dataset.bondIndex ?? target.dataset.bondIndex);
    const rank = Number(target.dataset.rank);
    const bond = this.actor.system.bonds[idx];
    if (!bond || bond.bondBroken) return;

    const newRank = (rank === bond.heartRank) ? rank - 1 : rank;
    const bonds = foundry.utils.deepClone(this.actor.system.bonds);
    bonds[idx].heartRank = Math.clamp(newRank, 0, 5);
    await this.actor.update({ "system.bonds": bonds });
  }

  static async #onBreakBond(event, target) {
    const idx = Number(target.closest("[data-bond-index]")?.dataset.bondIndex ?? target.dataset.bondIndex);
    const bond = this.actor.system.bonds[idx];
    if (!bond) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("SHARDS.Bonds.BreakTitle") },
      content: `<p>${game.i18n.format("SHARDS.Bonds.BreakConfirm", { name: bond.characterName || "?" })}</p>`
    });
    if (!confirmed) return;

    const bonds = foundry.utils.deepClone(this.actor.system.bonds);
    bonds[idx].bondBroken = true;
    await this.actor.update({ "system.bonds": bonds });
  }

  static async #onRestoreBond(event, target) {
    const idx = Number(target.closest("[data-bond-index]")?.dataset.bondIndex ?? target.dataset.bondIndex);
    const bonds = foundry.utils.deepClone(this.actor.system.bonds);
    if (!bonds[idx]) return;
    bonds[idx].bondBroken = false;
    await this.actor.update({ "system.bonds": bonds });
  }

  static async #onOpenBondActor(event, target) {
    const idx = Number(target.closest("[data-bond-index]")?.dataset.bondIndex ?? target.dataset.bondIndex);
    const bond = this.actor.system.bonds[idx];

    // If linked, open the actor's sheet
    if (bond?.actorUuid) {
      const actor = await fromUuid(bond.actorUuid);
      if (actor) return actor.sheet.render(true);
      else ui.notifications.warn(game.i18n.localize("SHARDS.Bonds.ActorNotFound"));
    }

    // No link — show actor picker to link one
    const candidates = game.actors.filter(a => a.id !== this.actor.id);
    if (!candidates.length) {
      ui.notifications.info(game.i18n.localize("SHARDS.Bonds.NoLinkedActor"));
      return;
    }
    let selectedId = candidates[0].id;
    const listHtml = candidates.map((a, i) => `
      <label class="bond-adv-option">
        <input type="radio" name="linkActor" value="${a.id}" ${i === 0 ? "checked" : ""} />
        <img src="${a.img}" width="32" height="32" />
        <span>${a.name}</span>
      </label>
    `).join("");

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("SHARDS.Bonds.LinkActor") },
      content: `<div class="bond-adv-selection">${listHtml}</div>`,
      buttons: [
        { action: "link", label: game.i18n.localize("SHARDS.Bonds.LinkActor"), icon: "fa-solid fa-link" },
        { action: "cancel", label: game.i18n.localize("SHARDS.Cancel"), icon: "fa-solid fa-times" }
      ],
      render: (event, dialog) => {
        for (const radio of dialog.element.querySelectorAll("input[name='linkActor']")) {
          radio.addEventListener("change", () => { selectedId = radio.value; });
        }
      }
    });

    if (result !== "link") return;
    const linked = game.actors.get(selectedId);
    if (!linked) return;

    const bonds = foundry.utils.deepClone(this.actor.system.bonds);
    bonds[idx].actorUuid = linked.uuid;
    bonds[idx].img = linked.img || "icons/svg/mystery-man.svg";
    if (!bonds[idx].characterName) bonds[idx].characterName = linked.name;
    await this.actor.update({ "system.bonds": bonds });
  }

  /**
   * Level up the adventurer — opens the Level Up Wizard.
   */
  static async #onLevelUp(event, target) {
    const actor = this.actor;
    if (!actor.system.canLevelUp) {
      ui.notifications.warn(game.i18n.localize("SHARDS.LevelUp.CannotLevelUpWizard"));
      return;
    }
    new CONFIG.SHARDS.applications.LevelUpWizard({ actor }).render(true);
  }

  /**
   * Award XP to the adventurer via a dialog with category quick-buttons.
   */
  static async #onAwardXp(event, target) {
    const actor = this.actor;
    const categories = CONFIG.SHARDS.xpAwardCategories;

    // Build category quick-buttons
    const categoryBtns = Object.entries(categories).map(([key, cat]) => {
      const label = game.i18n.localize(cat.label);
      return `<button type="button" class="xp-category-btn" data-category="${key}" data-amount="${cat.amount}" title="${label} (+${cat.amount})">
        <i class="${cat.icon}"></i> ${label} <span class="xp-category-amount">+${cat.amount}</span>
      </button>`;
    }).join("");

    const dialogContent = `
      <div class="xp-award-dialog">
        <div class="xp-award-categories">${categoryBtns}</div>
        <div class="xp-award-custom">
          <label>${game.i18n.localize("SHARDS.XP.CustomAmount")}</label>
          <input type="number" name="xpAmount" value="100" min="1" step="1" autofocus />
        </div>
        <div class="xp-award-note">
          <label>${game.i18n.localize("SHARDS.XP.Note")}</label>
          <input type="text" name="xpNote" placeholder="${game.i18n.localize("SHARDS.XP.Note")}" />
        </div>
      </div>`;

    let selectedAmount = 100;
    let selectedSource = "custom";

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("SHARDS.XP.AwardXP") },
      content: dialogContent,
      buttons: [
        { action: "award", label: game.i18n.localize("SHARDS.XP.Award"), icon: "fa-solid fa-plus" },
        { action: "cancel", label: game.i18n.localize("SHARDS.Cancel"), icon: "fa-solid fa-times" }
      ],
      render: (event, dialog) => {
        const amountInput = dialog.element.querySelector("input[name='xpAmount']");
        // Category quick-buttons populate the amount input
        for (const btn of dialog.element.querySelectorAll(".xp-category-btn")) {
          btn.addEventListener("click", () => {
            const amount = Number(btn.dataset.amount);
            const category = btn.dataset.category;
            if (amount > 0) amountInput.value = amount;
            selectedSource = category;
            // Highlight active category
            dialog.element.querySelectorAll(".xp-category-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
          });
        }
        amountInput.addEventListener("input", () => {
          selectedAmount = Number(amountInput.value);
          // Clear category highlight when manually editing
          dialog.element.querySelectorAll(".xp-category-btn").forEach(b => b.classList.remove("active"));
          selectedSource = "custom";
        });
      }
    });

    if (result !== "award") return;

    // Read final values from the dialog DOM (it's still available before close)
    const dialogEl = document.querySelector(".xp-award-dialog");
    const amount = Number(dialogEl?.querySelector("input[name='xpAmount']")?.value) || selectedAmount;
    const note = dialogEl?.querySelector("input[name='xpNote']")?.value ?? "";

    if (!amount || amount <= 0) {
      ui.notifications.warn(game.i18n.localize("SHARDS.XP.EnterAmount"));
      return;
    }

    const sourceLabel = selectedSource === "custom"
      ? game.i18n.localize("SHARDS.XP.Category.Custom")
      : game.i18n.localize(categories[selectedSource]?.label ?? "SHARDS.XP.Category.Custom");

    // Update XP totals and append to log
    const xpLog = foundry.utils.deepClone(actor.system.xpLog ?? []);
    xpLog.push({
      date: new Date().toLocaleDateString(),
      source: sourceLabel,
      amount,
      note
    });

    await actor.update({
      "system.xp.current": actor.system.xp.current + amount,
      "system.xp.total": actor.system.xp.total + amount,
      "system.xpLog": xpLog
    });

    // XP Siphon — distribute bonus XP to socketed manacite and jobs
    await actor.distributeXpToGrid(amount);

    ui.notifications.info(game.i18n.format("SHARDS.XP.Awarded", { amount, name: actor.name }));
  }

  /**
   * Adjust the Limit Break gauge via a simple input dialog.
   */
  static async #onAdjustLimitBreak(event, target) {
    const actor = this.actor;
    const lb = actor.system.limitBreak;

    const dialogContent = `
      <div class="lb-adjust-dialog">
        <p class="lb-adjust-current">${game.i18n.localize("SHARDS.Adventurer.LimitBreak")}: ${lb.value} / ${lb.max}</p>
        <div class="lb-adjust-row">
          <label>${game.i18n.localize("SHARDS.Adventurer.LimitBreakAmount")}</label>
          <input type="number" name="lbAmount" value="10" step="1" autofocus />
        </div>
      </div>`;

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("SHARDS.Adventurer.AdjustLimitBreak") },
      content: dialogContent,
      buttons: [
        { action: "apply", label: game.i18n.localize("SHARDS.Apply"), icon: "fa-solid fa-check" },
        { action: "cancel", label: game.i18n.localize("SHARDS.Cancel"), icon: "fa-solid fa-times" }
      ]
    });

    if (result !== "apply") return;

    const dialogEl = document.querySelector(".lb-adjust-dialog");
    const amount = Number(dialogEl?.querySelector("input[name='lbAmount']")?.value);
    if (!amount && amount !== 0) return;

    const newValue = Math.clamp(lb.value + amount, 0, lb.max);
    await actor.update({ "system.limitBreak.value": newValue });
  }

  static async #onSetPip(event, target) {
    const idx = Number(target.dataset.pipIndex);
    const currentValue = this.actor.system.pips.value;
    // Click filled pip to reduce, click empty pip to fill up to it
    const newValue = (idx < currentValue) ? idx : idx + 1;
    await this.actor.update({ "system.pips.value": newValue });
  }

  static #onToggleSection(event, target) {
    const section = target.closest(".collapsible-section");
    if (!section) return;
    section.classList.toggle("open");

    // Track open/close state so it persists across re-renders
    const sectionKey = section.dataset.section ?? section.dataset.itemId;
    if (sectionKey) {
      if (section.classList.contains("open")) {
        this._openSections.add(sectionKey);
      } else {
        this._openSections.delete(sectionKey);
      }
    }
  }

  /**
   * Toggle an equipment item's equipped state.
   * Auto-unequips any existing item in the same slot when equipping.
   * Enforces two-handed/oversized weapon restrictions on the offhand slot.
   * Supports dual-wielding: two one-handed weapons can be equipped simultaneously
   * (the second fills the offhand; both keep slot:"weapon" on the item).
   */
  static async #onToggleEquip(event, target) {
    event.stopPropagation(); // Prevent toggleSection from firing
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item || item.type !== "equipment") return;

    const newEquipped = !item.system.equipped;

    if (newEquipped) {
      const slot = item.system.slot;
      const hasMightyGrip = this.actor.system.flags?.mightyGrip;

      // Block equipping offhand if a two-handed/oversized weapon is in the weapon slot (unless Mighty Grip)
      if (slot === "offhand" && !hasMightyGrip) {
        const equippedWeapon = this.actor.items.find(
          i => i.type === "equipment" && i.system.equipped && i.system.slot === "weapon"
        );
        if (equippedWeapon?.system.isTwoHanded) {
          ui.notifications.warn(game.i18n.localize("SHARDS.Equipment.OffhandBlocked"));
          return;
        }
      }

      // Block equipping offhand if dual-wielding (two weapon-slot items already equipped)
      if (slot === "offhand") {
        const equippedWeaponCount = this.actor.items.filter(
          i => i.type === "equipment" && i.system.equipped && i.system.slot === "weapon"
        ).length;
        if (equippedWeaponCount >= 2) {
          ui.notifications.warn(game.i18n.localize("SHARDS.Equipment.OffhandOccupied"));
          return;
        }
      }

      // Dual-wield: equipping a one-handed weapon when the weapon slot is already occupied.
      // Allow both to coexist (max 2 equipped weapons). The second one acts as offhand.
      if (slot === "weapon" && !item.system.isTwoHanded) {
        const equippedWeapons = this.actor.items.filter(
          i => i.type === "equipment" && i.system.equipped && i.system.slot === "weapon" && i._id !== item._id
        );
        if (equippedWeapons.length >= 1) {
          const mainWeapon = equippedWeapons[0];
          if (mainWeapon.system.isTwoHanded && !hasMightyGrip) {
            // Two-handed main weapon blocks dual-wield — replace it
            await mainWeapon.update({ "system.equipped": false });
          } else if (equippedWeapons.length >= 2) {
            // Already dual-wielding — unequip the second one to make room
            await equippedWeapons[1].update({ "system.equipped": false });
          }
          // Also unequip offhand (a dual-wielded weapon replaces the offhand slot)
          const equippedOffhand = this.actor.items.find(
            i => i.type === "equipment" && i.system.equipped && i.system.slot === "offhand"
          );
          if (equippedOffhand && equippedWeapons.length >= 1
              && !(mainWeapon.system.isTwoHanded && !hasMightyGrip)) {
            await equippedOffhand.update({ "system.equipped": false });
          }
          // Equip and return — skip normal slot replacement logic
          await item.update({ "system.equipped": true });
          return;
        }
      }

      // Auto-unequip any existing items in the same slot
      // (use filter to catch dual-wielded weapon pairs)
      const currentlyEquipped = this.actor.items.filter(
        i => i.type === "equipment" && i.system.equipped && i.system.slot === slot && i._id !== item._id
      );
      for (const equipped of currentlyEquipped) {
        await equipped.update({ "system.equipped": false });
      }

      // If equipping a two-handed/oversized weapon, also unequip offhand (unless Mighty Grip)
      if (slot === "weapon" && item.system.isTwoHanded && !hasMightyGrip) {
        const equippedOffhand = this.actor.items.find(
          i => i.type === "equipment" && i.system.equipped && i.system.slot === "offhand"
        );
        if (equippedOffhand) {
          await equippedOffhand.update({ "system.equipped": false });
        }
      }
    }

    await item.update({ "system.equipped": newEquipped });
  }

  static #onSortSkills(event, target) {
    const sort = target.dataset.sort;
    if (!sort) return;
    this._skillSort = sort;
    this.render({ parts: ["skills"] });
  }

  static #onBrowseJobs(event, target) {
    new CONFIG.SHARDS.applications.JobBrowser().render(true);
  }

  static #onBrowseEquipment(event, target) {
    new CONFIG.SHARDS.applications.EquipmentBrowser().render(true);
  }

  static #onOpenSlotBrowser(event, target) {
    const slotKey = target.closest("[data-slot]")?.dataset.slot;
    const browser = new CONFIG.SHARDS.applications.EquipmentBrowser();
    if (slotKey) browser._filters.slot = slotKey;
    browser.render(true);
  }

  static #onBrowseManacite(event, target) {
    new CONFIG.SHARDS.applications.ManaciteBrowser().render(true);
  }

  static #onBrowseSkills(event, target) {
    new CONFIG.SHARDS.applications.SkillBrowser().render(true);
  }


  static #onBrowseLineage(event, target) {
    new CONFIG.SHARDS.applications.LineageBrowser().render(true);
  }

  static async #onRemoveLineage(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    if (!itemId) return;
    const item = this.actor.items.get(itemId);
    if (!item || item.type !== "lineage") return;
    await item.delete();
  }

  /** Open the GM Grant Skill dialog for this adventurer. */
  static #onGrantExperientialSkill(event, target) {
    if (!game.user.isGM) return;
    const dialog = new CONFIG.SHARDS.applications.SkillGrantDialog({ actorId: this.actor.id });
    dialog.render(true);
  }

  /**
   * Absorb a manacite crystal to gain its skill.
   * Creates a new skill item (or advances existing) and marks the manacite as absorbed.
   */
  static async #onAbsorbManacite(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const manacite = this.actor.items.get(itemId);
    if (!manacite || manacite.system.absorbed) return;

    const skillName = manacite.system.skillGranted;
    const grantLevel = manacite.system.skillLevel;

    if (!skillName) {
      ui.notifications.warn("This manacite has no skill assigned.");
      return;
    }

    // Check if actor already has a skill with this name
    const existingSkill = this.actor.items.find(i => i.type === "skill" && i.name === skillName);

    if (existingSkill && !existingSkill.system.stackable) {
      // Non-stackable: advance existing skill
      const currentLevel = existingSkill.system.skillLevel;
      const newLevel = grantLevel > currentLevel
        ? grantLevel
        : Math.min(currentLevel + 1, 10);
      await existingSkill.update({ "system.skillLevel": newLevel });
      ui.notifications.info(`${skillName} advanced to SL ${newLevel}!`);
    } else {
      // Create new skill item
      await this.actor.createEmbeddedDocuments("Item", [{
        name: skillName,
        type: "skill",
        img: manacite.img,
        "system.skillLevel": grantLevel,
        "system.source": "manacite"
      }]);
      ui.notifications.info(`Gained ${skillName} at SL ${grantLevel}!`);
    }

    // Mark manacite as absorbed
    await manacite.update({ "system.absorbed": true });
  }

  /* -------------------------------------------- */
  /*  Skill Chat & Progression Actions             */
  /* -------------------------------------------- */

  /**
   * Post a skill's info card to chat (triggered by clicking the skill image).
   */
  static async #onPostSkillToChat(event, target) {
    event.preventDefault();
    event.stopPropagation();

    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const skill = this.actor.items.get(itemId);
    if (!skill || skill.type !== "skill") return;

    const sk = skill.system;
    const actor = this.actor;
    const formulaCtx = buildFormulaContext(actor, skill);
    const derived = actor.system.derived;

    // Evaluate formula fields
    const computedPipCost = formulaCtx ? evaluateFormula(sk.pipCost || "0", formulaCtx) : (sk.pipCost || "0");
    const computedMpCost = formulaCtx ? evaluateFormula(sk.mpCost || "0", formulaCtx) : (sk.mpCost || "0");
    const computedDamage = formulaCtx ? evaluateFormula(sk.damageFormula || "0", formulaCtx) : (sk.damageFormula || "");
    const computedRange = formulaCtx ? evaluateFormula(sk.range || "0", formulaCtx) : (sk.range || "0");
    const computedCondChance = formulaCtx ? evaluateFormula(sk.conditionChance || "0", formulaCtx) : (sk.conditionChance || "0");

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

    // Hit/Dmg totals (simplified: ACC is unified, damage is formula-only)
    const totalHit = (derived?.acc != null && skillRate != null) ? skillRate + derived.acc : null;
    const totalDamage = typeof computedDamage === "number" ? computedDamage : null;

    // Enrich description
    const TE = foundry.applications.ux.TextEditor.implementation;
    const enrichedDescription = await TE.enrichHTML(sk.description ?? "", {
      async: true, relativeTo: skill
    });

    const templateData = {
      actorImg: actor.img,
      actorName: actor.name,
      actorTheme: actor.getFlag("shards-of-mana", "sheetTheme") ?? "silver",
      skillImg: skill.img,
      skillName: skill.name,
      skillLevel: sk.skillLevel,
      isPassive: sk.skillType === "passive",
      skillTypeLabel: game.i18n.localize(CONFIG.SHARDS.skillTypes[sk.skillType] ?? sk.skillType ?? ""),
      timingLabel: game.i18n.localize(CONFIG.SHARDS.skillTimings[sk.timing] ?? sk.timing ?? ""),
      damageTypeLabel: sk.damageType ? game.i18n.localize(CONFIG.SHARDS.damageTypes[sk.damageType] ?? sk.damageType) : "",
      defenseTypeLabel: sk.defenseType && sk.defenseType !== "none"
        ? game.i18n.localize(CONFIG.SHARDS.defenseTypes[sk.defenseType] ?? "") : "",
      targetLabel: game.i18n.localize(CONFIG.SHARDS.targetTypes[sk.target] ?? sk.target ?? ""),
      conditionLabel: sk.conditionApplied
        ? game.i18n.localize(CONFIG.SHARDS.conditions[sk.conditionApplied] ?? sk.conditionApplied) : "",
      conditionChance: typeof computedCondChance === "number" ? computedCondChance : (sk.conditionChance || "0"),
      computedPipCost,
      computedMpCost,
      computedDamage,
      skillRate,
      totalHit,
      totalDamage,
      range: computedRange,
      enrichedDescription
    };

    const content = await renderTemplate(
      "systems/shards-of-mana/templates/chat/skill-card.hbs",
      templateData
    );

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      flags: { "shards-of-mana": { skillId: skill._id } }
    });
  }


  /**
   * Spend actor XP to increase a skill's level by 1.
   */
  static async #onLevelSkill(event, target) {
    // GM-only manual skill level adjustment (skills normally level via manacite XP siphon)
    if (!game.user.isGM) return;
    event.preventDefault();
    event.stopPropagation();

    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const skill = this.actor.items.get(itemId);
    if (!skill || skill.type !== "skill") return;

    if (skill.system.isMaxLevel) {
      ui.notifications.warn(game.i18n.localize("SHARDS.Skill.AlreadyMaxLevel"));
      return;
    }

    const newLevel = skill.system.skillLevel + 1;
    await skill.update({ "system.skillLevel": newLevel });

    ui.notifications.info(
      game.i18n.format("SHARDS.Skill.LeveledUp", { name: skill.name, level: newLevel })
    );
  }

  /* -------------------------------------------- */
  /*  Drop Handling                                */
  /* -------------------------------------------- */

  /** Accepted item types for drag-drop onto this sheet. */
  static #ACCEPTED_TYPES = new Set(["job", "equipment", "manacite", "skill", "lineage"]);

  /**
   * Override the built-in ActorSheetV2 drop handler to add type filtering
   * and duplicate prevention. The base class auto-binds a single DragDrop
   * to the sheet element, so we only need this one override — no manual
   * DragDrop creation required.
   * @override
   */
  async _onDropItem(event, item) {
    if (!this.actor.isOwner) return null;

    // Effect items: transfer AEs to the actor instead of embedding the item
    if (item.type === "effect") {
      const effectItem = await fromUuid(item.uuid);
      if (effectItem) await transferEffectItem(this.actor, effectItem);
      return null;
    }

    // Only accept known item types
    if (!ShardsAdventurerSheet.#ACCEPTED_TYPES.has(item.type)) return null;

    // If the item already belongs to this actor, delegate to base for sorting
    if (this.actor.uuid === item.parent?.uuid) {
      return super._onDropItem(event, item);
    }

    // Lineage: max 1 per actor
    if (item.type === "lineage") {
      const lineageCount = this.actor.items.filter(i => i.type === "lineage").length;
      if (lineageCount >= 1) {
        ui.notifications.warn(game.i18n.localize("SHARDS.Lineage.MaxLineage"));
        return null;
      }
    }

    // Check for duplicate by name within the same type (stackable skills are exempt)
    const existing = this.actor.items.find(i => i.type === item.type && i.name === item.name);
    if (existing && !(item.type === "skill" && item.system?.stackable)) {
      ui.notifications.warn(game.i18n.localize("SHARDS.Browser.ItemAlreadyOwned"));
      return null;
    }

    // Delegate to the base class for actual embedded document creation
    const result = await super._onDropItem(event, item);
    if (result) {
      ui.notifications.info(game.i18n.format("SHARDS.Browser.ItemAdded", { name: item.name }));
    }
    return result;
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

  /* -------------------------------------------- */
  /*  Skill Context Menu                           */
  /* -------------------------------------------- */

  /**
   * Show a right-click context menu on skill cards / combat skill rows.
   * @param {PointerEvent} event
   */
  #onSkillContextMenu(event) {
    event.preventDefault();
    // Remove any existing context menu
    this.element.querySelector(".skill-context-menu")?.remove();

    const card = event.currentTarget;
    const itemId = card.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;

    // Build the menu
    const menu = document.createElement("div");
    menu.classList.add("skill-context-menu");
    menu.innerHTML = `
      <ul class="skill-context-menu__list">
        <li class="skill-context-menu__item" data-ctx-action="edit">
          <i class="fa-solid fa-pen-to-square"></i> ${game.i18n.localize("SHARDS.Edit")}
        </li>
        <li class="skill-context-menu__item skill-context-menu__item--danger" data-ctx-action="delete">
          <i class="fa-solid fa-trash"></i> ${game.i18n.localize("SHARDS.Delete")}
        </li>
      </ul>
    `;

    // Position relative to the app element
    const appRect = this.element.getBoundingClientRect();
    let x = event.clientX - appRect.left;
    let y = event.clientY - appRect.top;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    this.element.appendChild(menu);

    // Clamp if overflowing
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > appRect.right) {
      x -= (menuRect.right - appRect.right + 4);
      menu.style.left = `${x}px`;
    }
    if (menuRect.bottom > appRect.bottom) {
      y -= (menuRect.bottom - appRect.bottom + 4);
      menu.style.top = `${y}px`;
    }

    // Click handlers
    menu.querySelector('[data-ctx-action="edit"]').addEventListener("click", () => {
      item.sheet.render(true);
      menu.remove();
    });

    menu.querySelector('[data-ctx-action="delete"]').addEventListener("click", async () => {
      menu.remove();
      await item.delete();
    });

    // Dismiss on click elsewhere or right-click elsewhere
    const dismiss = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("click", dismiss, true);
        document.removeEventListener("contextmenu", dismiss, true);
      }
    };
    setTimeout(() => {
      document.addEventListener("click", dismiss, true);
      document.addEventListener("contextmenu", dismiss, true);
    }, 0);
  }

  /* -------------------------------------------- */
  /*  Lineage Context Menu                          */
  /* -------------------------------------------- */

  /**
   * Show a right-click context menu on lineage cards (Edit / Delete).
   * @param {PointerEvent} event
   */
  #onLineageContextMenu(event) {
    event.preventDefault();
    document.querySelector(".trait-context-menu")?.remove();

    const card = event.currentTarget;
    const itemId = card.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;

    const menu = document.createElement("div");
    menu.classList.add("trait-context-menu");
    menu.innerHTML = `
      <div class="trait-ctx-item" data-ctx-action="edit">
        <i class="fa-solid fa-pen-to-square"></i>
        <span>${game.i18n.localize("SHARDS.Edit")}</span>
      </div>
      <hr class="trait-ctx-divider" />
      <div class="trait-ctx-item trait-ctx-item--danger" data-ctx-action="delete">
        <i class="fa-solid fa-trash"></i>
        <span>${game.i18n.localize("SHARDS.Delete")}</span>
      </div>
    `;

    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    menu.querySelector("[data-ctx-action='edit']").addEventListener("click", () => {
      menu.remove();
      item.sheet.render(true);
    });
    menu.querySelector("[data-ctx-action='delete']").addEventListener("click", async () => {
      menu.remove();
      await item.delete();
    });

    const close = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("pointerdown", close);
        document.removeEventListener("keydown", escClose);
      }
    };
    const escClose = (e) => {
      if (e.key === "Escape") {
        menu.remove();
        document.removeEventListener("pointerdown", close);
        document.removeEventListener("keydown", escClose);
      }
    };

    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 4}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 4}px`;
    }

    requestAnimationFrame(() => {
      document.addEventListener("pointerdown", close);
      document.addEventListener("keydown", escClose);
    });
  }

  /* -------------------------------------------- */
  /*  Equipment Context Menu & Tooltip             */
  /* -------------------------------------------- */

  /**
   * Show a right-click context menu on paperdoll slots and inventory tiles.
   * @param {PointerEvent} event
   */
  #onEquipmentContextMenu(event) {
    event.preventDefault();
    document.querySelector(".equip-context-menu")?.remove();
    this.#hideEquipTooltip();

    const el = event.currentTarget;
    const itemId = el.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;

    const isEquipped = item.system.equipped;
    const isWeaponSlot = item.system.slot === "weapon" || item.system.slot === "offhand";

    // Build menu items
    let menuHtml = "";
    if (isEquipped && isWeaponSlot) {
      menuHtml += `
        <div class="equip-ctx-item equip-ctx-item--gold" data-ctx-action="attack">
          <i class="fa-solid fa-dice-d20"></i>
          <span>${game.i18n.localize("SHARDS.Roll.WeaponAttack")}</span>
        </div>`;
    }
    menuHtml += `
      <div class="equip-ctx-item" data-ctx-action="edit">
        <i class="fa-solid fa-pen-to-square"></i>
        <span>${game.i18n.localize("SHARDS.Edit")}</span>
      </div>`;
    if (isEquipped) {
      menuHtml += `
        <div class="equip-ctx-item" data-ctx-action="unequip">
          <i class="fa-regular fa-shield"></i>
          <span>${game.i18n.localize("SHARDS.Equipment.Unequip")}</span>
        </div>`;
    } else {
      menuHtml += `
        <div class="equip-ctx-item" data-ctx-action="equip">
          <i class="fa-solid fa-shield-halved"></i>
          <span>${game.i18n.localize("SHARDS.Equipment.Equip")}</span>
        </div>`;
    }
    menuHtml += `
      <div class="equip-ctx-item equip-ctx-item--danger" data-ctx-action="delete">
        <i class="fa-solid fa-trash"></i>
        <span>${game.i18n.localize("SHARDS.Delete")}</span>
      </div>`;

    const menu = document.createElement("div");
    menu.classList.add("equip-context-menu");
    menu.innerHTML = menuHtml;
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    document.body.appendChild(menu);

    // Clamp to viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 4}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 4}px`;
    }

    // Action handlers
    menu.querySelector("[data-ctx-action='edit']")?.addEventListener("click", () => {
      menu.remove();
      item.sheet.render(true);
    });
    menu.querySelector("[data-ctx-action='attack']")?.addEventListener("click", async () => {
      menu.remove();
      const targets = Array.from(game.user.targets);
      await rollWeaponAttack(this.actor, item, targets);
    });
    menu.querySelector("[data-ctx-action='equip']")?.addEventListener("click", async () => {
      menu.remove();
      // Simulate clicking toggleEquip by directly calling the equip path
      await item.update({ "system.equipped": true });
    });
    menu.querySelector("[data-ctx-action='unequip']")?.addEventListener("click", async () => {
      menu.remove();
      await item.update({ "system.equipped": false });
    });
    menu.querySelector("[data-ctx-action='delete']")?.addEventListener("click", async () => {
      menu.remove();
      await item.delete();
    });

    // Dismiss on click outside or Escape
    const close = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("pointerdown", close);
        document.removeEventListener("keydown", escClose);
      }
    };
    const escClose = (e) => {
      if (e.key === "Escape") {
        menu.remove();
        document.removeEventListener("pointerdown", close);
        document.removeEventListener("keydown", escClose);
      }
    };
    requestAnimationFrame(() => {
      document.addEventListener("pointerdown", close);
      document.addEventListener("keydown", escClose);
    });
  }

  /**
   * Show a tooltip panel on hover over an equipment slot or inventory tile.
   * @param {MouseEvent} event
   */
  #onEquipmentSlotHover(event) {
    this.#hideEquipTooltip();
    const el = event.currentTarget;
    const itemId = el.dataset.itemId;
    if (!itemId) return;

    // Find enriched card data from the last render context
    const item = this.actor.items.get(itemId);
    if (!item) return;
    const sys = item.system;

    // Build tooltip
    const tooltip = document.createElement("div");
    tooltip.classList.add("equip-tooltip-panel");

    const slotLabel = game.i18n.localize(CONFIG.SHARDS.equipmentSlots[sys.slot] ?? sys.slot);
    let classLabel = "";
    if (sys.weaponGroup) classLabel = game.i18n.localize(CONFIG.SHARDS.weaponGroups[sys.weaponGroup] ?? sys.weaponGroup);
    else if (sys.armorCategory) classLabel = game.i18n.localize(CONFIG.SHARDS.armorCategories[sys.armorCategory] ?? sys.armorCategory);
    const slotLine = classLabel ? `${slotLabel} — ${classLabel}` : slotLabel;

    // Combat stats
    let combatHtml = "";
    const isWeapon = sys.slot === "weapon" || sys.slot === "offhand";
    if (isWeapon) {
      const stats = [];
      stats.push(`${sys.baseAccuracy ?? 50}% <small>Acc</small>`);
      if (sys.pDmg) stats.push(`${sys.pDmg > 0 ? "+" : ""}${sys.pDmg} <small>P.Dmg</small>`);
      if (sys.mDmg) stats.push(`${sys.mDmg > 0 ? "+" : ""}${sys.mDmg} <small>M.Dmg</small>`);
      if (stats.length) {
        combatHtml = `<div class="equip-tt-stats">${stats.map(s => `<span class="equip-tt-stat">${s}</span>`).join("")}</div>`;
      }
    }

    // Stat bonuses
    let bonusHtml = "";
    const bonuses = [];
    for (const [key, value] of Object.entries(sys.statBonuses)) {
      if (value !== 0) {
        const label = game.i18n.localize(CONFIG.SHARDS.stats[key] ?? key.toUpperCase());
        bonuses.push(`${value > 0 ? "+" : ""}${value} <small>${label}</small>`);
      }
    }
    if (bonuses.length) {
      bonusHtml = `<div class="equip-tt-stats">${bonuses.map(b => `<span class="equip-tt-stat equip-tt-stat--bonus">${b}</span>`).join("")}</div>`;
    }

    // Properties
    let propsHtml = "";
    if (sys.properties?.length) {
      propsHtml = `<div class="equip-tt-properties">${sys.properties.map(p => `<span class="equip-tt-property">${p}</span>`).join("")}</div>`;
    }

    tooltip.innerHTML = `
      <div class="equip-tt-header">
        <img class="equip-tt-icon" src="${item.img}" width="28" height="28" />
        <div class="equip-tt-info">
          <div class="equip-tt-name">${item.name}</div>
          <div class="equip-tt-slot">${slotLine}</div>
        </div>
        <span class="rank-badge rank-badge--mini" data-rank="${sys.rank}">${sys.rank}</span>
      </div>
      ${combatHtml}${bonusHtml}${propsHtml}
    `;

    document.body.appendChild(tooltip);

    // Position above the hovered element
    const elRect = el.getBoundingClientRect();
    const ttRect = tooltip.getBoundingClientRect();
    let top = elRect.top - ttRect.height - 6;
    let left = elRect.left + (elRect.width / 2) - (ttRect.width / 2);

    // If above the viewport, show below
    if (top < 4) {
      top = elRect.bottom + 6;
    }
    // Clamp horizontal
    if (left < 4) left = 4;
    if (left + ttRect.width > window.innerWidth - 4) {
      left = window.innerWidth - ttRect.width - 4;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  /**
   * Hide the equipment tooltip panel.
   */
  #hideEquipTooltip() {
    document.querySelector(".equip-tooltip-panel")?.remove();
  }

  /**
   * Handle mouseleave — remove tooltip.
   */
  #onEquipmentSlotLeave() {
    this.#hideEquipTooltip();
  }

  /* -------------------------------------------- */
  /*  Theme Picker                                 */
  /* -------------------------------------------- */

  static THEME_PRESETS = [
    { id: "silver",   color: "#8a8a9e", hp: "#d44040", mp: "#4080d4" },
    { id: "crimson",  color: "#9e5555", hp: "#e05030", mp: "#b04820" },
    { id: "emerald",  color: "#559e60", hp: "#40a840", mp: "#20a078" },
    { id: "azure",    color: "#5580b8", hp: "#4090e0", mp: "#5080d8" },
    { id: "violet",   color: "#7858b8", hp: "#9850d8", mp: "#8840d0" },
    { id: "gold",     color: "#a08848", hp: "#d8b840", mp: "#c0a840" },
    { id: "rose",     color: "#a85888", hp: "#d86090", mp: "#9858b8" },
    { id: "obsidian", color: "#444450", hp: "#506070", mp: "#383858" }
  ];

  static async #onOpenThemePicker(event, target) {
    const currentTheme = this.actor.getFlag("shards-of-mana", "sheetTheme") ?? "silver";
    const presets = ShardsAdventurerSheet.THEME_PRESETS;
    let selectedTheme = currentTheme;

    const swatchHtml = presets.map(p => {
      const label = game.i18n.localize(`SHARDS.Theme.${p.id[0].toUpperCase() + p.id.slice(1)}`);
      const active = p.id === currentTheme ? " active" : "";
      return `<button class="theme-swatch${active}" data-theme-id="${p.id}" type="button" title="${label}">
        <span class="theme-swatch__color" style="background: linear-gradient(135deg, ${p.hp} 0%, ${p.color} 50%, ${p.mp} 100%)"></span>
        <span class="theme-swatch__label">${label}</span>
      </button>`;
    }).join("");

    // DialogV2.wait returns the action string of the clicked button, or null if closed
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("SHARDS.Theme.ChooseTheme") },
      content: `<div class="theme-picker-grid">${swatchHtml}</div>`,
      buttons: [
        {
          action: "apply",
          label: "Apply Theme",
          icon: "fa-solid fa-check"
        },
        {
          action: "cancel",
          label: "Cancel",
          icon: "fa-solid fa-times"
        }
      ],
      render: (event, app) => {
        const el = app.element;
        el.querySelectorAll(".theme-swatch").forEach(btn => {
          btn.addEventListener("click", () => {
            selectedTheme = btn.dataset.themeId;
            el.querySelectorAll(".theme-swatch").forEach(s => {
              s.classList.toggle("active", s.dataset.themeId === selectedTheme);
            });
          });
        });
      }
    });

    if (result === "apply" && selectedTheme !== currentTheme) {
      await this.actor.setFlag("shards-of-mana", "sheetTheme", selectedTheme);
    }
  }

  /* -------------------------------------------- */
  /*  Bond Context Menu                           */
  /* -------------------------------------------- */

  #onBondContextMenu(event) {
    event.preventDefault();
    this.element.querySelector(".bond-context-menu")?.remove();

    const card = event.currentTarget;
    const idx = Number(card.dataset.bondIndex);
    const bond = this.actor.system.bonds[idx];
    if (!bond) return;

    const menu = document.createElement("div");
    menu.classList.add("bond-context-menu");

    const items = [];
    if (bond.actorUuid) {
      items.push(`<li class="bond-ctx-item" data-ctx-action="open">
        <i class="fa-solid fa-up-right-from-square"></i> ${game.i18n.localize("SHARDS.Bonds.OpenSheet")}
      </li>`);
    }
    if (!bond.bondBroken) {
      items.push(`<li class="bond-ctx-item" data-ctx-action="break">
        <i class="fa-solid fa-heart-crack"></i> ${game.i18n.localize("SHARDS.Bonds.Break")}
      </li>`);
    } else {
      items.push(`<li class="bond-ctx-item" data-ctx-action="restore">
        <i class="fa-solid fa-heart-circle-plus"></i> ${game.i18n.localize("SHARDS.Bonds.Restore")}
      </li>`);
    }
    items.push(`<hr class="bond-ctx-divider" />`);
    items.push(`<li class="bond-ctx-item bond-ctx-item--danger" data-ctx-action="delete">
      <i class="fa-solid fa-trash"></i> ${game.i18n.localize("SHARDS.Delete")}
    </li>`);

    menu.innerHTML = `<ul class="bond-ctx-list">${items.join("")}</ul>`;

    // Position relative to the app element
    const appRect = this.element.getBoundingClientRect();
    menu.style.left = `${event.clientX - appRect.left}px`;
    menu.style.top = `${event.clientY - appRect.top}px`;
    this.element.appendChild(menu);

    // Clamp to viewport
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4 - appRect.left}px`;
      if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4 - appRect.top}px`;
    });

    // Action handlers
    menu.querySelector("[data-ctx-action='open']")?.addEventListener("click", async () => {
      menu.remove();
      const actor = await fromUuid(bond.actorUuid);
      actor?.sheet?.render(true);
    });
    menu.querySelector("[data-ctx-action='break']")?.addEventListener("click", async () => {
      menu.remove();
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("SHARDS.Bonds.BreakTitle") },
        content: `<p>${game.i18n.format("SHARDS.Bonds.BreakConfirm", { name: bond.characterName || "?" })}</p>`
      });
      if (!confirmed) return;
      const bonds = foundry.utils.deepClone(this.actor.system.bonds);
      bonds[idx].bondBroken = true;
      await this.actor.update({ "system.bonds": bonds });
    });
    menu.querySelector("[data-ctx-action='restore']")?.addEventListener("click", async () => {
      menu.remove();
      const bonds = foundry.utils.deepClone(this.actor.system.bonds);
      bonds[idx].bondBroken = false;
      await this.actor.update({ "system.bonds": bonds });
    });
    menu.querySelector("[data-ctx-action='delete']")?.addEventListener("click", async () => {
      menu.remove();
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("SHARDS.Bonds.DeleteTitle") },
        content: `<p>${game.i18n.format("SHARDS.Bonds.DeleteConfirm", { name: bond.characterName || "?" })}</p>`
      });
      if (!confirmed) return;
      const bonds = this.actor.system.bonds.filter((_, i) => i !== idx);
      await this.actor.update({ "system.bonds": bonds });
    });

    // Dismiss on outside click / escape
    const close = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("pointerdown", close);
        document.removeEventListener("keydown", escClose);
      }
    };
    const escClose = (e) => {
      if (e.key === "Escape") {
        menu.remove();
        document.removeEventListener("pointerdown", close);
        document.removeEventListener("keydown", escClose);
      }
    };
    requestAnimationFrame(() => {
      document.addEventListener("pointerdown", close);
      document.addEventListener("keydown", escClose);
    });
  }

  /* -------------------------------------------- */
  /*  Mana Grid Handlers                           */
  /* -------------------------------------------- */

  /** Mount (or refresh) the Mana Grid renderer into the Build tab. */
  #mountGridRenderer() {
    const mount = this.element.querySelector(".mana-grid-mount");
    if (!mount) return;

    const actor = this.actor;
    const grid = actor.system.grid ?? { sockets: [] };

    // Item lookup helper
    const getItemData = (itemId) => {
      const item = actor.items.get(itemId);
      if (!item) return null;
      return {
        name: item.name,
        img: item.img,
        school: item.system.school ?? "general",
        type: item.type,
        skillLevel: item.system.skillLevel ?? null,
        skillGranted: item.system.skillGranted ?? "",
        rank: item.system.rank ?? "F"
      };
    };

    // School lookup for a job socket
    const getJobSchool = (jobSocketId) => {
      const socket = grid.sockets.find(s => s.id === jobSocketId);
      if (!socket?.itemId) return "general";
      const job = actor.items.get(socket.itemId);
      return job?.system?.school ?? "general";
    };

    // Destroy previous renderer if it exists
    if (this._gridRenderer) {
      this._gridRenderer.destroy();
      this._gridRenderer = null;
    }

    this._gridRenderer = new ManaGridRenderer(mount, {
      grid,
      getItemData,
      getJobSchool,
      onSocketClick: (socket, event) => this.#onGridSocketClick(socket),
      onSocketRightClick: (socket, event) => this.#onGridSocketRightClick(socket)
    });
  }

  /** Handle left-click on a grid socket — open item picker. */
  async #onGridSocketClick(socket) {
    if (!this.actor.isOwner) return;

    if (socket.itemId) {
      // Filled socket: open the item sheet
      const item = this.actor.items.get(socket.itemId);
      if (item) item.sheet.render(true);
      return;
    }

    // Empty socket: show item picker dialog
    const eligibleItems = this.#getEligibleItems(socket);
    if (!eligibleItems.length) {
      ui.notifications.info(game.i18n.localize("SHARDS.Grid.NoEligibleItems"));
      return;
    }

    const title = socket.type === "job"
      ? game.i18n.localize("SHARDS.Grid.SelectJob")
      : game.i18n.localize("SHARDS.Grid.SelectManacite");

    const itemButtons = eligibleItems.map(item => {
      const school = item.system.school ?? "general";
      const schoolColor = CONFIG.SHARDS?.schools?.[school]?.color ?? "#a0a0b0";
      const badge = item.type === "job"
        ? `Rank ${item.system.rank}`
        : `SL ${item.system.skillLevel ?? 1}`;
      return `<button type="button" class="grid-picker-item" data-item-id="${item.id}">
        <img src="${item.img}" width="32" height="32" />
        <span class="grid-picker-name">${item.name}</span>
        <span class="grid-picker-badge" style="color:${schoolColor}">${badge}</span>
      </button>`;
    }).join("");

    const content = `<div class="grid-picker-list">${itemButtons}</div>`;

    let selectedItemId = null;
    await foundry.applications.api.DialogV2.wait({
      window: { title },
      content,
      buttons: [
        { action: "cancel", label: game.i18n.localize("SHARDS.Cancel"), icon: "fa-solid fa-times" }
      ],
      render: (event, dialog) => {
        for (const btn of dialog.element.querySelectorAll(".grid-picker-item")) {
          btn.addEventListener("click", () => {
            selectedItemId = btn.dataset.itemId;
            dialog.close();
          });
        }
      }
    });

    if (!selectedItemId) return;

    await this.actor.socketToGrid(socket.id, selectedItemId);
    ui.notifications.info(
      game.i18n.format("SHARDS.Grid.Socketed", { name: this.actor.items.get(selectedItemId)?.name ?? "?" })
    );
  }

  /** Handle right-click on a filled grid socket — unsocket. */
  async #onGridSocketRightClick(socket) {
    if (!this.actor.isOwner || !socket.itemId) return;

    const item = this.actor.items.get(socket.itemId);
    if (!item) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("SHARDS.Grid.SocketItem") },
      content: `<p>${game.i18n.format("SHARDS.Grid.ConfirmUnsocket", { name: item.name })}</p>`
    });

    if (!confirmed) return;

    await this.actor.unsocketFromGrid(socket.id);
    ui.notifications.info(
      game.i18n.format("SHARDS.Grid.Unsocketed", { name: item.name })
    );
  }

  /** Get eligible items from inventory for a given socket. */
  #getEligibleItems(socket) {
    const actor = this.actor;
    const grid = actor.system.grid ?? { sockets: [] };
    const socketedItemIds = new Set(grid.sockets.filter(s => s.itemId).map(s => s.itemId));

    if (socket.type === "job") {
      // Job sockets accept unsocketed job items
      return actor.items.filter(i =>
        i.type === "job" && !socketedItemIds.has(i.id)
      );
    }

    // Skill and free sockets accept unsocketed manacite items
    let manaciteItems = actor.items.filter(i =>
      i.type === "manacite" && !socketedItemIds.has(i.id)
    );

    // Skill sockets enforce school affinity
    if (socket.type === "skill" && socket.parentJobSocketId) {
      const parentSocket = grid.sockets.find(s => s.id === socket.parentJobSocketId);
      const parentJob = parentSocket?.itemId ? actor.items.get(parentSocket.itemId) : null;
      const jobSchool = parentJob?.system?.school ?? "general";

      if (jobSchool !== "general") {
        manaciteItems = manaciteItems.filter(m => {
          const mSchool = m.system.school ?? "general";
          return mSchool === jobSchool || mSchool === "general";
        });
      }
    }

    return manaciteItems;
  }
}
