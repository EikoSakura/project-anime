// Data Models
import {
  AdventurerData,
  MonsterData,
  NpcData,
  MerchantData,
  PartyData,
  JobData,
  ManaciteData,
  EquipmentData,

  SkillData,
  EffectItemData,
  LineageData
} from "./module/data/_module.mjs";

// Document Classes
import { ShardsActor, ShardsItem, ShardsCombat, ShardsCombatant } from "./module/documents/_module.mjs";

// Sheet Classes
import {
  ShardsAdventurerSheet,
  ShardsMonsterSheet,
  ShardsNpcSheet,
  ShardsMerchantSheet,
  ShardsPartySheet,
  ShardsItemSheet,
  ShardsJobSheet,
  ShardsSkillSheet,
  ShardsEquipmentSheet,
  ShardsManaciteSheet,

  ShardsEffectItemSheet,
  ShardsLineageSheet,
  ShardsActiveEffectSheet
} from "./module/sheets/_module.mjs";

// App Classes
import {
  ShardsCodexHub,
  ShardsJobBrowser,
  ShardsSkillBrowser,
  ShardsEquipmentBrowser,
  ShardsManaciteBrowser,

  ShardsLineageBrowser,
  ShardsMonsterBrowser,
  ShardsEffectCreator,
  ShardsCharGenWizard,
  ShardsCharGenSettings,
  ShardsLevelUpWizard,
  ShardsEncounterBuilder,
  ShardsQuestCreator,
  ShardsPartyHud,
  ShardsEnemyHud,
  ShardsTokenHud
} from "./module/apps/_module.mjs";

// Helpers
import { SHARDS } from "./module/helpers/config.mjs";
import { preloadHandlebarsTemplates } from "./module/helpers/templates.mjs";
import { activateChatListeners, rollStatTest, rollAttack, rollHealing, rollContest, rollWeaponAttack } from "./module/helpers/rolls.mjs";
import { evaluateFormula, buildFormulaContext } from "./module/helpers/formulas.mjs";
import { ContestDialog } from "./module/apps/contest-dialog.mjs";
import { SkillGrantDialog } from "./module/apps/skill-grant-dialog.mjs";
import { grantExperientialSkill, trackConditionExposure } from "./module/helpers/experience.mjs";
import { activateLootListeners, rollDropTable, postLootCard } from "./module/helpers/drops.mjs";
import { showChatContextMenu } from "./module/helpers/chat-context-menu.mjs";
import { enhanceCombatTracker } from "./module/apps/combat-tracker.mjs";
import { populateRulebook } from "./module/helpers/rulebook.mjs";
import { onControlToken, onPreUpdateToken, onUpdateToken, onDeleteCombat } from "./module/canvas/movement-overlay.mjs";
import { onRefreshToken, clearAllBadges } from "./module/canvas/condition-badges.mjs";
import { onRefreshToken as onRefreshTokenElevation, clearAllElevationMarkers } from "./module/canvas/elevation-markers.mjs";
import { registerElevationKeybindings } from "./module/canvas/elevation-controls.mjs";
import {
  onHoverTokenTargeting, onControlTokenTargeting,
  onRefreshTokenTargeting, onUpdateTokenTargeting,
  clearTargetingLine
} from "./module/canvas/targeting-line.mjs";
import { onRefreshTokenBars, clearAllTokenBars } from "./module/canvas/token-bars.mjs";

/* -------------------------------------------- */
/*  Initialization                              */
/* -------------------------------------------- */

Hooks.once("init", () => {
  console.log("shards-of-mana | Initializing Shards of Mana System");

  // Active Effect configuration — modern mode (AEs stay on items, no copying)
  CONFIG.ActiveEffect.legacyTransferral = false;

  // Store config on the global CONFIG object
  CONFIG.SHARDS = SHARDS;

  // Replace default status effects with Shards condition effects (populates Token HUD)
  CONFIG.statusEffects = SHARDS.conditionEffects;

  // Store app classes on config for access from sheets
  CONFIG.SHARDS.applications = {
    CodexHub: ShardsCodexHub,
    JobBrowser: ShardsJobBrowser,
    SkillBrowser: ShardsSkillBrowser,
    EquipmentBrowser: ShardsEquipmentBrowser,
    ManaciteBrowser: ShardsManaciteBrowser,

    LineageBrowser: ShardsLineageBrowser,
    MonsterBrowser: ShardsMonsterBrowser,
    EffectCreator: ShardsEffectCreator,
    SkillGrantDialog,
    CharGenWizard: ShardsCharGenWizard,
    CharGenSettings: ShardsCharGenSettings,
    LevelUpWizard: ShardsLevelUpWizard,
    EncounterBuilder: ShardsEncounterBuilder,
    QuestCreator: ShardsQuestCreator,
    PartyHud: ShardsPartyHud,
    EnemyHud: ShardsEnemyHud,
    TokenHud: ShardsTokenHud
  };

  // Register Handlebars helpers
  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("join", (arr, sep) => {
    if (!Array.isArray(arr)) return arr ?? "";
    return arr.join(typeof sep === "string" ? sep : ", ");
  });
  Handlebars.registerHelper("or", (a, b) => a || b);
  Handlebars.registerHelper("and", (a, b) => a && b);
  Handlebars.registerHelper("lt", (a, b) => a < b);
  Handlebars.registerHelper("gt", (a, b) => a > b);
  Handlebars.registerHelper("math", (a, op, b) => {
    a = Number(a); b = Number(b);
    switch (op) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": return b !== 0 ? a / b : 0;
      default: return a;
    }
  });

  // Register custom text enricher for [[formula]] double-bracket notation.
  // e.g. [[5 * RANK]] in descriptions resolves to the calculated value.
  // Uses double brackets to avoid conflicts with Foundry's built-in enrichers.
  // Styled like Foundry's inline rolls for a familiar look.
  CONFIG.TextEditor.enrichers.push({
    pattern: /\[\[([A-Za-z0-9_ +\-*/().>=<!?,: ]+)\]\]/g,
    enricher: async (match, options) => {
      const formulaString = match[1].trim();
      if (!formulaString) return null;

      // Skip Foundry's built-in inline rolls (e.g. [[/r 2d6]])
      if (formulaString.startsWith("/")) return null;

      // Get the owning document from enrichHTML's relativeTo option
      const doc = options?.relativeTo;

      // Determine actor and item context from document hierarchy
      let actor = null;
      let item = null;
      if (doc instanceof Item) {
        item = doc;
        actor = doc.parent instanceof Actor ? doc.parent : null;
      } else if (doc instanceof Actor) {
        actor = doc;
      }

      // Fallback actor resolution for world-level items (no parent actor):
      // 1. User's assigned character
      // 2. Currently controlled token's actor
      // This allows formulas to resolve when viewing items in the sidebar/compendium.
      if (!actor && game.ready) {
        actor = game.user?.character ?? canvas?.tokens?.controlled?.[0]?.actor ?? null;
      }

      // Build formula context
      const ctx = buildFormulaContext(actor, item);

      // If no context at all (no actor anywhere), show raw formula
      if (!ctx) {
        const span = document.createElement("span");
        span.className = "shards-formula shards-formula--raw";
        span.textContent = `[[${formulaString}]]`;
        span.title = game.i18n?.localize("SHARDS.Formula.NoContext") ?? "No actor context — assign a character or select a token";
        return span;
      }

      const result = evaluateFormula(formulaString, ctx);
      const span = document.createElement("span");
      span.className = "shards-formula shards-formula--resolved";
      span.title = `${formulaString} = ${result}`;
      span.textContent = typeof result === "number" ? String(result) : `[[${formulaString}]]`;
      return span;
    }
  });

  // Register GM-only Mana's Codex settings menu
  game.settings.registerMenu("shards-of-mana", "codexHub", {
    name: "SHARDS.CodexHub.SettingName",
    label: "SHARDS.CodexHub.SettingLabel",
    hint: "SHARDS.CodexHub.SettingHint",
    icon: "fa-solid fa-book-sparkles",
    type: ShardsCodexHub,
    restricted: true
  });

  // Register require-targeting setting
  game.settings.register("shards-of-mana", "requireTargeting", {
    name: "SHARDS.Settings.RequireTargeting.Name",
    hint: "SHARDS.Settings.RequireTargeting.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  // Register skill visibility setting
  game.settings.register("shards-of-mana", "playersCanViewSkillDetails", {
    name: "SHARDS.Settings.SkillDetails.Name",
    hint: "SHARDS.Settings.SkillDetails.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  // Register Character Creation settings menu (GM only)
  game.settings.registerMenu("shards-of-mana", "chargenSettings", {
    name: "SHARDS.CharGen.SettingName",
    label: "SHARDS.CharGen.SettingLabel",
    hint: "SHARDS.CharGen.SettingHint",
    icon: "fa-solid fa-wand-magic-sparkles",
    type: ShardsCharGenSettings,
    restricted: true
  });

  // Character Creation settings (GM-configurable, hidden from standard config UI)
  game.settings.register("shards-of-mana", "chargenStatPool", {
    scope: "world", config: false, type: Number, default: 40
  });
  game.settings.register("shards-of-mana", "chargenStatCap", {
    scope: "world", config: false, type: Number, default: 25
  });
  game.settings.register("shards-of-mana", "chargenGrowthPool", {
    scope: "world", config: false, type: Number, default: 200
  });
  game.settings.register("shards-of-mana", "chargenGrowthMin", {
    scope: "world", config: false, type: Number, default: 10
  });
  game.settings.register("shards-of-mana", "chargenGrowthMax", {
    scope: "world", config: false, type: Number, default: 60
  });

  game.settings.register("shards-of-mana", "chargenStartingGold", {
    scope: "world", config: false, type: Number, default: 250
  });

  // Register Limit Break gauge fill settings
  game.settings.register("shards-of-mana", "limitBreakDamageFill", {
    name: "SHARDS.Settings.LB.DamageFill.Name",
    hint: "SHARDS.Settings.LB.DamageFill.Hint",
    scope: "world", config: true, type: Number, default: 10
  });
  game.settings.register("shards-of-mana", "limitBreakCritFill", {
    name: "SHARDS.Settings.LB.CritFill.Name",
    hint: "SHARDS.Settings.LB.CritFill.Hint",
    scope: "world", config: true, type: Number, default: 15
  });
  game.settings.register("shards-of-mana", "limitBreakAllyKOFill", {
    name: "SHARDS.Settings.LB.AllyKOFill.Name",
    hint: "SHARDS.Settings.LB.AllyKOFill.Hint",
    scope: "world", config: true, type: Number, default: 25
  });

  // Manacite drop mode setting
  game.settings.register("shards-of-mana", "dropMode", {
    name: "SHARDS.Settings.DropMode.Name",
    hint: "SHARDS.Settings.DropMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      auto: "SHARDS.Settings.DropMode.Auto",
      manual: "SHARDS.Settings.DropMode.Manual"
    },
    default: "auto"
  });

  // --- Party HUD Settings ---
  game.settings.register("shards-of-mana", "partyHudEnabled", {
    name: "SHARDS.Settings.PartyHud.EnabledName",
    hint: "SHARDS.Settings.PartyHud.EnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register("shards-of-mana", "partyHudVisible", {
    name: "SHARDS.Settings.PartyHud.VisibleName",
    hint: "SHARDS.Settings.PartyHud.VisibleHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register("shards-of-mana", "partyHudMode", {
    name: "SHARDS.Settings.PartyHud.ModeName",
    hint: "SHARDS.Settings.PartyHud.ModeHint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      expanded: "SHARDS.Settings.PartyHud.ModeExpanded",
      compact: "SHARDS.Settings.PartyHud.ModeCompact",
      hidden: "SHARDS.Settings.PartyHud.ModeHidden"
    },
    default: "compact"
  });
  game.settings.register("shards-of-mana", "partyHudPosition", {
    scope: "client",
    config: false,
    type: Object,
    default: { left: 15, top: 80 }
  });
  game.settings.register("shards-of-mana", "partyHudPartyId", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  // --- Enemy HUD Settings ---
  game.settings.register("shards-of-mana", "enemyHudEnabled", {
    name: "SHARDS.Settings.EnemyHud.EnabledName",
    hint: "SHARDS.Settings.EnemyHud.EnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register("shards-of-mana", "enemyHudRevealTier", {
    name: "SHARDS.Settings.EnemyHud.RevealTierName",
    hint: "SHARDS.Settings.EnemyHud.RevealTierHint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      hidden: "SHARDS.Settings.EnemyHud.TierHidden",
      basic: "SHARDS.Settings.EnemyHud.TierBasic",
      detailed: "SHARDS.Settings.EnemyHud.TierDetailed",
      full: "SHARDS.Settings.EnemyHud.TierFull"
    },
    default: "basic"
  });
  game.settings.register("shards-of-mana", "enemyHudVisible", {
    name: "SHARDS.Settings.EnemyHud.VisibleName",
    hint: "SHARDS.Settings.EnemyHud.VisibleHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register("shards-of-mana", "enemyHudMode", {
    name: "SHARDS.Settings.EnemyHud.ModeName",
    hint: "SHARDS.Settings.EnemyHud.ModeHint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      expanded: "SHARDS.Settings.EnemyHud.ModeExpanded",
      compact: "SHARDS.Settings.EnemyHud.ModeCompact",
      hidden: "SHARDS.Settings.EnemyHud.ModeHidden"
    },
    default: "compact"
  });
  game.settings.register("shards-of-mana", "enemyHudPosition", {
    scope: "client",
    config: false,
    type: Object,
    default: { right: 15, top: 80 }
  });

  // --- Token HUD Overlay Settings ---
  game.settings.register("shards-of-mana", "tokenHudEnabled", {
    name: "SHARDS.Settings.TokenHud.EnabledName",
    hint: "SHARDS.Settings.TokenHud.EnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register("shards-of-mana", "tokenHudHoverDelay", {
    name: "SHARDS.Settings.TokenHud.HoverDelayName",
    hint: "SHARDS.Settings.TokenHud.HoverDelayHint",
    scope: "client",
    config: true,
    type: Number,
    default: 300,
    range: { min: 0, max: 1000, step: 50 }
  });

  // --- Elevation Settings ---
  game.settings.register("shards-of-mana", "elevationMarkersEnabled", {
    name: "SHARDS.Settings.Elevation.MarkersName",
    hint: "SHARDS.Settings.Elevation.MarkersHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register("shards-of-mana", "elevationStep", {
    name: "SHARDS.Settings.Elevation.StepName",
    hint: "SHARDS.Settings.Elevation.StepHint",
    scope: "world",
    config: true,
    type: Number,
    default: 1,
    range: { min: 1, max: 10, step: 1 }
  });

  // --- Shards Token Bars Setting ---
  game.settings.register("shards-of-mana", "shardsTokenBarsEnabled", {
    name: "SHARDS.Settings.TokenBars.Name",
    hint: "SHARDS.Settings.TokenBars.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      clearAllTokenBars();
      canvas.tokens?.placeables.forEach(t => t.refresh());
    }
  });

  // --- Migration flags (hidden, world-scope) ---
  game.settings.register("shards-of-mana", "speciesTraitMigrated", {
    scope: "world", config: false, type: Boolean, default: false
  });
  game.settings.register("shards-of-mana", "elementResistanceScaleMigrated", {
    scope: "world", config: false, type: Boolean, default: false
  });
  game.settings.register("shards-of-mana", "lineageTreeMigrated", {
    scope: "world", config: false, type: Boolean, default: false
  });
  game.settings.register("shards-of-mana", "xpTotalMigrated", {
    scope: "world", config: false, type: Boolean, default: false
  });
  game.settings.register("shards-of-mana", "combatSimplificationMigrated", {
    scope: "world", config: false, type: Boolean, default: false
  });
  game.settings.register("shards-of-mana", "skillSimplificationMigrated", {
    scope: "world", config: false, type: Boolean, default: false
  });
  game.settings.register("shards-of-mana", "monsterActionsMigrated", {
    scope: "world", config: false, type: Boolean, default: false
  });

  // --- Elevation Keybindings ---
  registerElevationKeybindings();

  // Register custom document classes
  CONFIG.Actor.documentClass = ShardsActor;
  CONFIG.Item.documentClass = ShardsItem;
  CONFIG.Combat.documentClass = ShardsCombat;
  CONFIG.Combatant.documentClass = ShardsCombatant;

  // Register data models
  CONFIG.Actor.dataModels = {
    adventurer: AdventurerData,
    monster: MonsterData,
    npc: NpcData,
    merchant: MerchantData,
    party: PartyData
  };
  CONFIG.Item.dataModels = {
    job: JobData,
    manacite: ManaciteData,
    equipment: EquipmentData,

    skill: SkillData,
    effect: EffectItemData,
    lineage: LineageData
  };

  // Configure trackable token attributes
  CONFIG.Actor.trackableAttributes = {
    adventurer: {
      bar: ["health", "mana"],
      value: ["level"]
    },
    monster: {
      bar: ["health", "mana"],
      value: []
    },
    npc: {
      bar: ["health", "mana"],
      value: []
    },
    merchant: {
      bar: [],
      value: []
    },
    party: {
      bar: [],
      value: []
    }
  };

  // Register Actor sheets
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "shards-of-mana", ShardsAdventurerSheet, {
    types: ["adventurer"],
    makeDefault: true,
    label: "SHARDS.Sheets.Adventurer"
  });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "shards-of-mana", ShardsMonsterSheet, {
    types: ["monster"],
    makeDefault: true,
    label: "SHARDS.Sheets.Monster"
  });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "shards-of-mana", ShardsNpcSheet, {
    types: ["npc"],
    makeDefault: true,
    label: "SHARDS.Sheets.Npc"
  });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "shards-of-mana", ShardsMerchantSheet, {
    types: ["merchant"],
    makeDefault: true,
    label: "SHARDS.Sheets.Merchant"
  });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "shards-of-mana", ShardsPartySheet, {
    types: ["party"],
    makeDefault: true,
    label: "SHARDS.Sheets.Party"
  });

  // Register Item sheets
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, "shards-of-mana", ShardsJobSheet, {
    types: ["job"],
    makeDefault: true,
    label: "SHARDS.Sheets.Job"
  });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, "shards-of-mana", ShardsSkillSheet, {
    types: ["skill"],
    makeDefault: true,
    label: "SHARDS.Sheets.Skill"
  });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, "shards-of-mana", ShardsEquipmentSheet, {
    types: ["equipment"],
    makeDefault: true,
    label: "SHARDS.Sheets.Equipment"
  });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, "shards-of-mana", ShardsManaciteSheet, {
    types: ["manacite"],
    makeDefault: true,
    label: "SHARDS.Sheets.Manacite"
  });

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, "shards-of-mana", ShardsEffectItemSheet, {
    types: ["effect"],
    makeDefault: true,
    label: "SHARDS.Sheets.EffectItem"
  });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, "shards-of-mana", ShardsLineageSheet, {
    types: ["lineage"],
    makeDefault: true,
    label: "SHARDS.Sheets.Lineage"
  });
  // Register Active Effect sheet
  foundry.applications.apps.DocumentSheetConfig.registerSheet(ActiveEffect, "shards-of-mana", ShardsActiveEffectSheet, {
    makeDefault: true,
    label: "SHARDS.Sheets.ActiveEffect"
  });

  // Preload Handlebars templates
  preloadHandlebarsTemplates();

  // Register sidebar button hooks early so they catch the first render
  Hooks.on("renderItemDirectory", _injectCodexButton);
  Hooks.on("renderActorDirectory", _injectCodexButton);
  Hooks.on("renderCompendiumDirectory", _injectCodexButton);

  // Enhanced combat tracker — inject HP bars, pips, conditions, and expandable panels
  Hooks.on("renderCombatTracker", enhanceCombatTracker);

  // Movement range overlay — show/hide on token select, track distance, clear on combat end
  Hooks.on("controlToken", onControlToken);
  Hooks.on("preUpdateToken", onPreUpdateToken);
  Hooks.on("updateToken", onUpdateToken);
  Hooks.on("deleteCombat", onDeleteCombat);

  // Condition magnitude badges on token effect icons
  Hooks.on("refreshToken", onRefreshToken);
  Hooks.on("deleteCombat", clearAllBadges);

  // Elevation markers on tokens with non-zero elevation
  Hooks.on("refreshToken", onRefreshTokenElevation);

  // Targeting line — distance display between controlled and hovered tokens
  Hooks.on("hoverToken", onHoverTokenTargeting);
  Hooks.on("controlToken", onControlTokenTargeting);
  Hooks.on("refreshToken", onRefreshTokenTargeting);
  Hooks.on("updateToken", onUpdateTokenTargeting);
  Hooks.on("canvasReady", clearTargetingLine);

  // --- Shards Token Bars (Log Horizon-style HP/MP) ---
  Hooks.on("refreshToken", onRefreshTokenBars);
  Hooks.on("canvasReady", clearAllTokenBars);

  // --- FF12-Style Token Naming (letter suffixes for duplicate unlinked tokens) ---
  Hooks.on("preCreateToken", _onPreCreateTokenNaming);
  Hooks.on("deleteToken", _onDeleteTokenNaming);

  // --- Token HUD Overlay Hooks ---
  Hooks.on("hoverToken", (token, hovered) => {
    ShardsTokenHud._instance?.onTokenHover(token, hovered);
  });
  Hooks.on("controlToken", (token, controlled) => {
    ShardsTokenHud._instance?.onTokenControl(token, controlled);
  });
  Hooks.on("refreshToken", (token) => {
    ShardsTokenHud._instance?.onTokenRefresh(token);
  });
  Hooks.on("updateToken", (tokenDoc, changes) => {
    ShardsTokenHud._instance?.onTokenUpdate(tokenDoc, changes);
  });
  Hooks.on("canvasReady", () => {
    ShardsTokenHud._instance?.hide();
  });

  // Register "Add as Bond" right-click option in actor sidebar context menu
  Hooks.on("getActorContextOptions", _addBondContextOption);

  // --- Active Effect: inherit parent item icon ---
  Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => {
    const parent = effect.parent;
    if (!(parent instanceof Item)) return;
    // Only override if the icon is a Foundry default or blank
    const defaultIcons = new Set([
      "icons/svg/aura.svg", "icons/svg/upgrade.svg", "icons/svg/downgrade.svg",
      "icons/svg/mystery-man.svg", ""
    ]);
    if (!data.img || defaultIcons.has(data.img)) {
      effect.updateSource({ img: parent.img });
    }
  });

  // --- Party HUD + Enemy HUD + Token HUD Update Hooks ---
  Hooks.on("updateActor", (actor) => {
    ShardsPartyHud._instance?.refreshIfRelevant(actor);
    ShardsEnemyHud._instance?.refreshIfRelevant(actor);
    ShardsTokenHud._instance?.refreshIfRelevant(actor);
  });
  Hooks.on("createActiveEffect", (effect) => {
    const actor = effect.parent;
    if (actor instanceof Actor) {
      ShardsPartyHud._instance?.refreshIfRelevant(actor);
      ShardsEnemyHud._instance?.refreshIfRelevant(actor);
      ShardsTokenHud._instance?.refreshIfRelevant(actor);
    }
  });
  Hooks.on("deleteActiveEffect", (effect) => {
    const actor = effect.parent;
    if (actor instanceof Actor) {
      ShardsPartyHud._instance?.refreshIfRelevant(actor);
      ShardsEnemyHud._instance?.refreshIfRelevant(actor);
      ShardsTokenHud._instance?.refreshIfRelevant(actor);
    }
  });
  Hooks.on("updateUser", () => {
    ShardsPartyHud._instance?.render();
  });
  Hooks.on("updateItem", (item) => {
    const actor = item.parent;
    if (actor instanceof Actor) {
      ShardsPartyHud._instance?.refreshIfRelevant(actor);
      ShardsEnemyHud._instance?.refreshIfRelevant(actor);
      ShardsTokenHud._instance?.refreshIfRelevant(actor);
    }
  });

  // --- Enemy HUD Combat Lifecycle Hooks ---
  Hooks.on("combatStart", () => {
    _tryRenderEnemyHud();
  });
  Hooks.on("createCombatant", () => {
    ShardsEnemyHud._instance?.render();
  });
  Hooks.on("deleteCombatant", () => {
    ShardsEnemyHud._instance?.render();
  });
  Hooks.on("deleteCombat", () => {
    if (ShardsEnemyHud._instance?.rendered) {
      ShardsEnemyHud._instance.close();
    }
  });
  Hooks.on("updateCombat", () => {
    ShardsEnemyHud._instance?.render();
  });
  Hooks.on("updateSetting", (setting) => {
    if (setting.key === "shards-of-mana.enemyHudRevealTier") {
      ShardsEnemyHud._instance?.render();
    }
  });
});

/* -------------------------------------------- */
/*  Ready                                       */
/* -------------------------------------------- */

Hooks.once("ready", async () => {
  console.log("shards-of-mana | System Ready");

  // Expose public API on game.shards for macros and external use
  game.shards = {
    rollStatTest,
    rollAttack,
    rollHealing,
    rollContest,
    rollWeaponAttack,
    rollDropTable,
    postLootCard,
    contestDialog: () => new ContestDialog().render(true),
    grantExperientialSkill,
    skillGrantDialog: (opts) => new SkillGrantDialog(opts).render(true),
    encounterBuilder: () => new ShardsEncounterBuilder().render(true),
    questCreator: () => ShardsQuestCreator.open()
  };

  // The sidebar tabs may have already rendered before hooks were registered.
  // Manually inject into any already-rendered sidebar tabs.
  _injectIntoExistingSidebar();

  // --- Render Party HUD ---
  if (game.settings.get("shards-of-mana", "partyHudEnabled")
      && game.settings.get("shards-of-mana", "partyHudVisible")) {
    const hud = ShardsPartyHud.getInstance();
    game.shards.partyHud = hud;
    hud.render(true);
  }

  // --- Render Enemy HUD (if combat already active on load) ---
  if (game.combat?.started) {
    _tryRenderEnemyHud();
  }

  // --- Initialize Token HUD Overlay (singleton, renders on demand) ---
  if (game.settings.get("shards-of-mana", "tokenHudEnabled")) {
    game.shards.tokenHud = ShardsTokenHud.getInstance();
  }

  // --- Migrations (GM only) ---
  if (game.user.isGM) {
    await _migrateRemoveTechniques();
    await _migrateRemoveSouls();
    await _migrateBondsSchema();
    await _migrateSpeciesTraitsToItems();
    await _migrateElementResistanceScale();
    await _migrateXpTotal();
    await _migrateCombatSimplification();
    await _migrateSkillSimplification();
    await _migrateMonsterActionsToSkills();
  }

  // --- Populate rulebook compendium (GM only, first load) ---
  populateRulebook();

  // --- Sync token sizes on world load ---
  // _syncTokenSize can't fire during initial preparation (game.ready is false),
  // so force a sync for all actors that have a computed size.
  if (game.user.isGM) {
    for (const actor of game.actors) {
      if (actor.system.size != null) actor._syncTokenSize();
    }
  }
});

/* -------------------------------------------- */
/*  FF12-Style Token Naming                     */
/* -------------------------------------------- */

/**
 * Extract a single-letter suffix from a token name given a base name.
 * e.g., "Goblin C" with baseName "Goblin" → "C"; "Goblin" → null
 */
function _getTokenSuffix(tokenName, baseName) {
  if (!tokenName.startsWith(baseName + " ")) return null;
  const suffix = tokenName.slice(baseName.length + 1);
  return (suffix.length === 1 && suffix >= "A" && suffix <= "Z") ? suffix : null;
}

/**
 * When placing an unlinked token, auto-append letter suffixes (A, B, C…)
 * if duplicates of the same actor already exist on the scene.
 * The first existing token is retroactively renamed to "A".
 */
function _onPreCreateTokenNaming(tokenDoc, data, options, userId) {
  if (tokenDoc.actorLink) return;

  const baseName = tokenDoc.actor?.name ?? tokenDoc.name;
  const existing = canvas.scene.tokens.filter(t =>
    !t.actorLink && t.actorId === tokenDoc.actorId
  );

  if (existing.length === 0) return;

  // Collect suffix letters already in use
  const usedLetters = new Set();
  for (const t of existing) {
    const letter = _getTokenSuffix(t.name, baseName);
    if (letter) usedLetters.add(letter);
  }

  // If exactly 1 existing token has no suffix yet, retroactively rename it to "A"
  if (existing.length === 1 && usedLetters.size === 0) {
    existing[0].update({ name: `${baseName} A` });
    usedLetters.add("A");
  }

  // Find the next available letter
  let nextLetter = "";
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!usedLetters.has(letter)) {
      nextLetter = letter;
      break;
    }
  }
  if (!nextLetter) nextLetter = `${existing.length + 1}`;

  tokenDoc.updateSource({ name: `${baseName} ${nextLetter}` });
}

/**
 * When an unlinked token is deleted and only one duplicate remains,
 * strip its letter suffix back to the plain base name.
 */
function _onDeleteTokenNaming(tokenDoc) {
  if (tokenDoc.actorLink) return;
  const baseName = tokenDoc.actor?.name;
  if (!baseName) return;

  const remaining = canvas.scene.tokens.filter(t =>
    !t.actorLink && t.actorId === tokenDoc.actorId && t.id !== tokenDoc.id
  );

  if (remaining.length === 1) {
    const t = remaining[0];
    if (_getTokenSuffix(t.name, baseName)) {
      t.update({ name: baseName });
    }
  }
}

/**
 * Render the Enemy HUD if conditions are met (enabled, visible, tier not hidden for players).
 */
function _tryRenderEnemyHud() {
  if (!game.settings.get("shards-of-mana", "enemyHudEnabled")) return;
  if (!game.settings.get("shards-of-mana", "enemyHudVisible")) return;

  // For players: check if tier is not "hidden"
  if (!game.user.isGM) {
    const tier = game.settings.get("shards-of-mana", "enemyHudRevealTier");
    if (tier === "hidden") return;
  }

  const hud = ShardsEnemyHud.getInstance();
  game.shards.enemyHud = hud;
  hud.render(true);
}

/**
 * One-time migration: delete any world-level or embedded items whose type is
 * "technique" (removed during the Technique → Skill system pivot).
 * Invalid-type items fail validation and land in collection.invalidDocumentIds.
 * We try getInvalid() first; if that fails we fall back to raw deleteDocuments().
 */
async function _migrateRemoveTechniques() {
  let deleted = 0;

  // World-level invalid items
  for (const id of game.items.invalidDocumentIds) {
    try {
      // Try to get the invalid doc to check its type
      const doc = game.items.getInvalid(id);
      if (doc?.type === "technique") {
        console.log(`shards-of-mana | Migration: deleting stale world technique "${doc.name}" [${id}]`);
        await doc.delete();
        deleted++;
      }
    } catch (e) {
      // getInvalid may fail for type-invalid docs — fall back to raw delete
      console.log(`shards-of-mana | Migration: force-deleting invalid world item [${id}]`);
      try {
        await Item.deleteDocuments([id]);
        deleted++;
      } catch (e2) {
        console.warn(`shards-of-mana | Could not delete invalid world item ${id}:`, e2);
      }
    }
  }

  // Embedded invalid items on actors
  for (const actor of game.actors) {
    for (const id of actor.items.invalidDocumentIds) {
      try {
        const doc = actor.items.getInvalid(id);
        if (doc?.type === "technique") {
          console.log(`shards-of-mana | Migration: deleting stale technique "${doc.name}" from actor "${actor.name}"`);
          await doc.delete();
          deleted++;
        }
      } catch (e) {
        console.log(`shards-of-mana | Migration: force-deleting invalid embedded item [${id}] on "${actor.name}"`);
        try {
          await actor.deleteEmbeddedDocuments("Item", [id]);
          deleted++;
        } catch (e2) {
          console.warn(`shards-of-mana | Could not delete invalid embedded item ${id} on "${actor.name}":`, e2);
        }
      }
    }
  }

  if (deleted) {
    console.log(`shards-of-mana | Migration complete: removed ${deleted} stale technique item(s)`);
  }
}

/**
 * One-time migration: delete any world-level or embedded items whose type is
 * "soul" (removed during the Mana Grid refactor).
 */
async function _migrateRemoveSouls() {
  let deleted = 0;

  // World-level invalid items
  for (const id of game.items.invalidDocumentIds) {
    try {
      const doc = game.items.getInvalid(id);
      if (doc?.type === "soul") {
        console.log(`shards-of-mana | Migration: deleting stale world soul "${doc.name}" [${id}]`);
        await doc.delete();
        deleted++;
      }
    } catch (e) {
      console.log(`shards-of-mana | Migration: force-deleting invalid world item [${id}]`);
      try {
        await Item.deleteDocuments([id]);
        deleted++;
      } catch (e2) {
        console.warn(`shards-of-mana | Could not delete invalid world item ${id}:`, e2);
      }
    }
  }

  // Embedded invalid items on actors
  for (const actor of game.actors) {
    for (const id of actor.items.invalidDocumentIds) {
      try {
        const doc = actor.items.getInvalid(id);
        if (doc?.type === "soul") {
          console.log(`shards-of-mana | Migration: deleting stale soul "${doc.name}" from actor "${actor.name}"`);
          await doc.delete();
          deleted++;
        }
      } catch (e) {
        console.log(`shards-of-mana | Migration: force-deleting invalid embedded item [${id}] on "${actor.name}"`);
        try {
          await actor.deleteEmbeddedDocuments("Item", [id]);
          deleted++;
        } catch (e2) {
          console.warn(`shards-of-mana | Could not delete invalid embedded item ${id} on "${actor.name}":`, e2);
        }
      }
    }
  }

  if (deleted) {
    console.log(`shards-of-mana | Migration complete: removed ${deleted} stale soul item(s)`);
  }
}

/* -------------------------------------------- */
/*  Chat — Roll Card Button Listeners            */
/* -------------------------------------------- */

Hooks.on("renderChatMessageHTML", (message, html) => {
  if (html instanceof HTMLElement) {
    activateChatListeners(html);
    activateLootListeners(html);
    _activateExperienceListeners(html);

    // Chat card right-click context menu (reroll)
    const card = html.querySelector?.(".shards-chat-card") ?? (html.matches?.(".shards-chat-card") ? html : null);
    if (card) {
      card.addEventListener("contextmenu", (event) => {
        showChatContextMenu(event, message);
      });

      // Theme fallback for cards missing data-theme (e.g. older messages)
      if (!card.dataset.theme) {
        const speakerId = message.speaker?.actor;
        if (speakerId) {
          const actor = game.actors.get(speakerId);
          if (actor) {
            card.dataset.theme = actor.getFlag("shards-of-mana", "sheetTheme") ?? "silver";
          }
        }
      }
    }
  }
});

/**
 * Bind click listeners for experiential skill grant buttons in chat messages.
 * @param {HTMLElement} html
 */
function _activateExperienceListeners(html) {
  for (const btn of html.querySelectorAll("[data-action='open-skill-grant']")) {
    btn.addEventListener("click", () => {
      new SkillGrantDialog({
        actorId: btn.dataset.actorId,
        skillName: btn.dataset.skillName,
        originNote: btn.dataset.originNote
      }).render(true);
    });
  }
}

/* -------------------------------------------- */
/*  Exposure Tracking — Condition Hook          */
/* -------------------------------------------- */

Hooks.on("createActiveEffect", async (effect, options, userId) => {
  if (!game.user.isGM) return;
  const actor = effect.parent;
  if (!actor || actor.type !== "adventurer") return;
  const statuses = effect.statuses;
  if (!statuses?.size) return;
  for (const statusId of statuses) {
    if (CONFIG.SHARDS.exposureThresholds?.[statusId]) {
      await trackConditionExposure(actor, statusId);
    }
  }
});

/* -------------------------------------------- */
/*  Combat — Effect Expiry & DoT/HoT            */
/* -------------------------------------------- */

/**
 * When combat advances (round or turn), expire timed effects and process
 * start-of-turn effects (poison, burn, regen, refresh) for the active combatant.
 */
Hooks.on("updateCombat", async (combat, update, options, userId) => {
  // Only the GM processes this to avoid duplicate updates
  if (!game.user.isGM) return;
  if (!("round" in update || "turn" in update)) return;

  // --- Expire timed effects on all combatants ---
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor) continue;
    const expiredIds = [];
    for (const effect of actor.allApplicableEffects()) {
      if (!effect.isTemporary) continue;
      const remaining = effect.duration.remaining;
      if (remaining !== null && remaining <= 0) {
        expiredIds.push(effect.id);
      }
    }
    if (expiredIds.length) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", expiredIds);
    }
  }

  // --- Start-of-turn processing ---
  const currentCombatant = combat.combatants.get(combat.current?.combatantId);
  if (!currentCombatant?.actor) return;

  const actor = currentCombatant.actor;
  const sys = actor.system;
  if (!sys.conditions) return;

  const updates = {};
  const messages = [];

  // --- Pip Reset at turn start ---
  if (sys.pips && sys.pips.value !== sys.pips.max) {
    updates["system.pips.value"] = sys.pips.max;
    messages.push(game.i18n.format("SHARDS.Combat.PipsRestored", { max: sys.pips.max }));
  }

  // --- Movement Reset ---
  if (currentCombatant.resetMovement) {
    await currentCombatant.resetMovement();
  }

  // --- Death Save (downed adventurers) ---
  if (actor.type === "adventurer" && sys.conditions.downed > 0) {
    const vitTarget = Math.max(actor.system.statTotal("vit"), 1);
    const deathRoll = new Roll("1d100");
    await deathRoll.evaluate();

    const passed = deathRoll.total <= vitTarget;

    if (!passed) {
      const newDC = Math.max(0, sys.deathCounts.value - 1);
      await actor.update({ "system.deathCounts.value": newDC });

      if (newDC <= 0) {
        messages.push(`<span class="shards-death-alert">${game.i18n.format("SHARDS.Combat.PermanentDeath", { name: actor.name })}</span>`);
      } else {
        messages.push(game.i18n.format("SHARDS.Combat.DeathSaveFail", {
          name: actor.name, roll: deathRoll.total, target: vitTarget,
          remaining: newDC, max: sys.deathCounts.max
        }));
      }
    } else {
      messages.push(game.i18n.format("SHARDS.Combat.DeathSavePass", {
        name: actor.name, roll: deathRoll.total, target: vitTarget
      }));
    }
  }

  // --- DoT/HoT Processing ---
  let currentHp = sys.health.value;

  // Poison DoT
  if (sys.conditions.poison > 0) {
    const dmg = sys.conditions.poison;
    currentHp = Math.max(0, currentHp - dmg);
    messages.push(game.i18n.format("SHARDS.Combat.PoisonDamage", { name: actor.name, dmg }));
  }

  // Burn DoT
  if (sys.conditions.burn > 0) {
    const dmg = sys.conditions.burn;
    currentHp = Math.max(0, currentHp - dmg);
    messages.push(game.i18n.format("SHARDS.Combat.BurnDamage", { name: actor.name, dmg }));
  }

  // Regen HoT — heals 10% of max HP per tick (min 1).
  // Creatures at 0 HP do not regenerate (they are downed/dying).
  if (sys.conditions.regen > 0 && currentHp > 0) {
    const heal = Math.max(1, Math.floor(sys.health.max * 10 / 100));
    currentHp = Math.min(sys.health.max, currentHp + heal);
    messages.push(game.i18n.format("SHARDS.Combat.RegenHeal", { name: actor.name, heal }));
  }

  if (currentHp !== sys.health.value) {
    updates["system.health.value"] = currentHp;
  }

  // Refresh (MP regen)
  if (sys.conditions.refresh > 0) {
    const restore = sys.conditions.refresh;
    const newMp = Math.min(sys.mana.max, sys.mana.value + restore);
    if (newMp !== sys.mana.value) {
      updates["system.mana.value"] = newMp;
      messages.push(game.i18n.format("SHARDS.Combat.RefreshRestore", { name: actor.name, restore }));
    }
  }

  if (Object.keys(updates).length) {
    await actor.update(updates);
  }

  // Post turn-start summary to chat using crystal-themed card
  if (messages.length) {
    const theme = actor.getFlag("shards-of-mana", "sheetTheme") ?? "silver";
    const templateData = {
      actorName: actor.name,
      actorImg: actor.img ?? "icons/svg/mystery-man.svg",
      round: combat.round,
      theme,
      messages
    };
    const content = await renderTemplate(
      "systems/shards-of-mana/templates/chat/turn-start.hbs",
      templateData
    );
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
  }
});

/* -------------------------------------------- */
/*  Sidebar — Mana's Codex Button               */
/* -------------------------------------------- */

/**
 * Inject the "Mana's Codex" button into a sidebar tab's footer.
 * Works for Items, Actors, and Compendium sidebar tabs.
 * @param {Application} app - The sidebar directory application
 * @param {HTMLElement} element - The application's root HTML element
 */
function _injectCodexButton(app, element) {
  // element is the application root in v13 ApplicationV2
  const footer = element.querySelector(".directory-footer");
  if (!footer || footer.querySelector(".mana-codex-sidebar-btn")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "mana-codex-sidebar-btn";
  button.innerHTML = `<i class="fa-solid fa-book-sparkles"></i> ${game.i18n.localize("SHARDS.CodexHub.SidebarButton")}`;
  button.addEventListener("click", () => {
    new CONFIG.SHARDS.applications.CodexHub().render(true);
  });
  footer.appendChild(button);
}

/**
 * Manually inject the Codex button into sidebar tabs that already rendered
 * before hooks were registered (handles race condition with init/ready timing).
 */
function _injectIntoExistingSidebar() {
  // In v13, sidebar tab instances are on ui directly: ui.items, ui.actors, ui.compendium
  const sidebarTabs = [ui.items, ui.actors, ui.compendium];
  for (const tab of sidebarTabs) {
    if (tab?.element) {
      _injectCodexButton(tab, tab.element);
    }
  }
}

/* -------------------------------------------- */
/*  Bond Sidebar "Add as Bond" Context Menu     */
/* -------------------------------------------- */

/**
 * Add "Add as Bond" option to Foundry's built-in actor directory context menu.
 * V13 hook: getActorContextOptions(application, menuItems)
 * Only shown when the user owns at least one adventurer.
 * @param {ApplicationV2} app   The ActorDirectory instance
 * @param {Array} options       The context menu options array to push into
 */
function _addBondContextOption(app, options) {
  options.push({
    name: game.i18n.localize("SHARDS.Bonds.AddAsBond"),
    icon: '<i class="fa-solid fa-heart"></i>',
    condition: (li) => {
      return game.actors.some(a => a.type === "adventurer" && a.isOwner);
    },
    callback: async (li) => {
      const actorId = li.dataset.entryId ?? li.dataset.documentId;
      const targetActor = game.actors.get(actorId);
      if (!targetActor) return;
      const myAdventurers = game.actors.filter(a =>
        a.type === "adventurer" && a.isOwner
      );
      if (!myAdventurers.length) return;
      await _handleAddAsBond(targetActor, myAdventurers);
    }
  });
}

/**
 * Handle the "Add as Bond" flow: select adventurer (if multiple), pick archetype, create bond.
 * @param {Actor} targetActor  The actor to bond with
 * @param {Actor[]} myAdventurers  The user's owned adventurer actors
 */
async function _handleAddAsBond(targetActor, myAdventurers) {
  // Step 1: pick which adventurer gets the bond
  let adventurer;
  if (myAdventurers.length === 1) {
    adventurer = myAdventurers[0];
  } else {
    let selectedAdvId = myAdventurers[0].id;
    const optionsHtml = myAdventurers.map((a, idx) => `
      <label class="bond-adv-option">
        <input type="radio" name="adventurer" value="${a.id}" ${idx === 0 ? "checked" : ""} />
        <img src="${a.img}" width="32" height="32" />
        <span>${a.name}</span>
      </label>
    `).join("");

    const advResult = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("SHARDS.Bonds.SelectAdventurer") },
      content: `<div class="bond-adv-selection">${optionsHtml}</div>`,
      buttons: [
        { action: "confirm", label: game.i18n.localize("SHARDS.Bonds.Add"), icon: "fa-solid fa-plus" },
        { action: "cancel", label: game.i18n.localize("SHARDS.Cancel") }
      ],
      render: (event, dialog) => {
        for (const radio of dialog.element.querySelectorAll("input[name='adventurer']")) {
          radio.addEventListener("change", () => { selectedAdvId = radio.value; });
        }
      }
    });
    if (advResult !== "confirm") return;
    adventurer = game.actors.get(selectedAdvId);
    if (!adventurer) return;
  }

  // Step 2: check for duplicate bond
  const existingBond = adventurer.system.bonds.find(b => b.actorUuid === targetActor.uuid);
  if (existingBond) {
    ui.notifications.warn(game.i18n.format("SHARDS.Bonds.AlreadyBonded", { name: targetActor.name }));
    return;
  }

  // Step 3: pick archetype
  const archetypes = CONFIG.SHARDS.bondArchetypes;
  const archKeys = Object.keys(archetypes);
  let selectedArchetype = archKeys[0];

  const archOptionsHtml = Object.entries(archetypes).map(([key, def], idx) => {
    const label = game.i18n.localize(def.label);
    return `<label class="bond-archetype-option${idx === 0 ? " selected" : ""}" data-archetype="${key}">
      <input type="radio" name="archetype" value="${key}" ${idx === 0 ? "checked" : ""} />
      <span class="bond-archetype-option__swatch" style="border-color: ${def.color}; color: ${def.color}">
        <i class="${def.icon}"></i>
      </span>
      <span class="bond-archetype-option__label">${label}</span>
    </label>`;
  }).join("");

  const archResult = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("SHARDS.Bonds.ChooseArchetype") },
    content: `<div class="bond-archetype-grid">${archOptionsHtml}</div>`,
    buttons: [
      { action: "confirm", label: game.i18n.localize("SHARDS.Bonds.Add"), icon: "fa-solid fa-plus" },
      { action: "cancel", label: game.i18n.localize("SHARDS.Cancel") }
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
  if (archResult !== "confirm") return;

  // Step 4: create bond entry
  const bonds = [...adventurer.system.bonds, {
    actorUuid: targetActor.uuid,
    img: targetActor.img || "icons/svg/mystery-man.svg",
    characterName: targetActor.name,
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
  await adventurer.update({ "system.bonds": bonds });
  ui.notifications.info(game.i18n.format("SHARDS.Bonds.BondForged", {
    name: targetActor.name, adventurer: adventurer.name
  }));
}

/* -------------------------------------------- */
/*  Bond Data Migration                         */
/* -------------------------------------------- */

/**
 * Migrate old-format bonds (flat condition/unlocks) to the new schema
 * with rankNotes array, actorUuid, img, bondBroken, and notes fields.
 */
async function _migrateBondsSchema() {
  const validArchetypes = new Set(Object.keys(CONFIG.SHARDS.bondArchetypes));

  for (const actor of game.actors) {
    if (actor.type !== "adventurer") continue;
    const bonds = actor.system.bonds;
    if (!bonds?.length) continue;

    // Check if migration is needed: look for old-format bonds (no rankNotes field)
    const needsMigration = bonds.some(b => !Array.isArray(b.rankNotes));
    if (!needsMigration) continue;

    const migrated = bonds.map(bond => {
      // Already migrated
      if (Array.isArray(bond.rankNotes)) return bond;

      const archetype = validArchetypes.has(bond.archetype) ? bond.archetype : "rival";
      const hr = bond.heartRank ?? 0;

      // Place old condition/unlocks at the appropriate rankNotes index
      const targetIdx = Math.max(hr - 1, 0);
      const rankNotes = Array.from({ length: 5 }, (_, i) => ({
        condition: (i === targetIdx && bond.condition) ? bond.condition : "",
        unlock: (i === targetIdx && bond.unlocks) ? bond.unlocks : ""
      }));

      return {
        actorUuid: bond.actorUuid ?? "",
        img: bond.img ?? "icons/svg/mystery-man.svg",
        characterName: bond.characterName ?? "",
        archetype,
        heartRank: hr,
        bondBroken: bond.bondBroken ?? false,
        notes: bond.notes ?? "",
        rankNotes
      };
    });

    await actor.update({ "system.bonds": migrated }, { noHook: true });
    console.log(`shards-of-mana | Migrated bonds for ${actor.name}`);
  }
}

/* -------------------------------------------- */
/*  Species Trait → Lineage Item Migration      */
/* -------------------------------------------- */

/**
 * One-time migration: convert embedded traits with `isSpecies: true` into
 * lineage items on their parent actors. The old trait is deleted and a new
 * lineage item is created with matching name, img, and description.
 *
 * Grants (baseGrants/realizedGrants) will be empty — they need manual
 * configuration since the old trait had no grant references.
 */
async function _migrateSpeciesTraitsToItems() {
  if (game.settings.get("shards-of-mana", "speciesTraitMigrated")) return;

  let migrated = 0;

  for (const actor of game.actors) {
    if (actor.type !== "adventurer") continue;

    // Find embedded traits with the legacy isSpecies flag.
    // Check _source since migrateData() strips the field from the model.
    const lineageTraits = actor.items.filter(i => {
      if (i.type !== "trait") return false;
      return i._source?.system?.isSpecies === true;
    });

    if (!lineageTraits.length) continue;

    // Create lineage items from the old traits
    const lineageData = lineageTraits.map(t => ({
      type: "lineage",
      name: t.name,
      img: t.img,
      system: {
        description: t.system.description ?? "",
        size: t._source?.system?.size ?? 1
      }
    }));

    // Delete old traits, then create lineage items
    const traitIds = lineageTraits.map(t => t.id);
    await actor.deleteEmbeddedDocuments("Item", traitIds, { noHook: true });
    await actor.createEmbeddedDocuments("Item", lineageData, { noHook: true });

    migrated += lineageTraits.length;
    console.log(`shards-of-mana | Migrated ${lineageTraits.length} trait(s) → lineage item(s) for ${actor.name}`);
  }

  // Mark migration as complete
  if (migrated > 0) {
    console.log(`shards-of-mana | Lineage trait migration complete: ${migrated} item(s) converted`);
  }
  await game.settings.set("shards-of-mana", "speciesTraitMigrated", true);
}

/* -------------------------------------------- */
/*  Element Resistance Scale Migration           */
/* -------------------------------------------- */

/**
 * Migrate element resistances from the old scale (100 = normal, 0 = immune, <0 = absorb)
 * to the new player-facing scale (0 = normal, 100 = immune, >100 = absorb).
 * Conversion: newValue = 100 - oldValue
 */
async function _migrateElementResistanceScale() {
  if (game.settings.get("shards-of-mana", "elementResistanceScaleMigrated")) return;

  let migrated = 0;
  const ELEMENT_KEYS = [
    "physical", "fire", "ice", "lightning", "wind", "earth",
    "water", "light", "dark", "plant", "poison", "magical"
  ];

  // --- Migrate actors (all types that have elementResistances) ---
  for (const actor of game.actors) {
    const resistances = actor.system.elementResistances;
    if (!resistances) continue;

    const updates = {};
    let needsUpdate = false;

    for (const el of ELEMENT_KEYS) {
      const oldVal = resistances[el];
      if (oldVal == null) continue;
      const newVal = 100 - oldVal;
      if (newVal !== oldVal) {
        updates[`system.elementResistances.${el}`] = newVal;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await actor.update(updates, { noHook: true });
      migrated++;
      console.log(`shards-of-mana | Migrated element resistances for actor "${actor.name}"`);
    }

    // --- Migrate embedded lineage items on this actor ---
    for (const item of actor.items) {
      if (item.type !== "lineage") continue;
      const specRes = item.system.elementResistances;
      if (!specRes) continue;

      const itemUpdates = {};
      let itemNeedsUpdate = false;

      for (const el of ELEMENT_KEYS) {
        const oldVal = specRes[el];
        if (oldVal == null) continue;
        const newVal = 100 - oldVal;
        if (newVal !== oldVal) {
          itemUpdates[`system.elementResistances.${el}`] = newVal;
          itemNeedsUpdate = true;
        }
      }

      if (itemNeedsUpdate) {
        await item.update(itemUpdates, { noHook: true });
        console.log(`shards-of-mana | Migrated element resistances for embedded lineage "${item.name}" on "${actor.name}"`);
      }
    }
  }

  // --- Migrate world-level lineage items ---
  for (const item of game.items) {
    if (item.type !== "lineage") continue;
    const specRes = item.system.elementResistances;
    if (!specRes) continue;

    const updates = {};
    let needsUpdate = false;

    for (const el of ELEMENT_KEYS) {
      const oldVal = specRes[el];
      if (oldVal == null) continue;
      const newVal = 100 - oldVal;
      if (newVal !== oldVal) {
        updates[`system.elementResistances.${el}`] = newVal;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await item.update(updates, { noHook: true });
      migrated++;
      console.log(`shards-of-mana | Migrated element resistances for world lineage "${item.name}"`);
    }
  }

  // Mark migration as complete
  if (migrated > 0) {
    console.log(`shards-of-mana | Element resistance scale migration complete: ${migrated} document(s) converted`);
    ui.notifications.info(`Shards of Mana: Migrated element resistances to new scale (${migrated} documents updated).`);
  }
  await game.settings.set("shards-of-mana", "elementResistanceScaleMigrated", true);
}

/* -------------------------------------------- */
/*  XP Total Back-Fill Migration                 */
/* -------------------------------------------- */

/**
 * One-time migration: back-fill xp.total for existing adventurers above level 1
 * who have 0 total XP. Sets xp.total = (level - 1) * xpPerLevel so they are not
 * locked out of leveling by the new XP-gated system.
 */
async function _migrateXpTotal() {
  if (game.settings.get("shards-of-mana", "xpTotalMigrated")) return;

  let migrated = 0;
  const xpPerLevel = CONFIG.SHARDS.xpPerLevel ?? 500;

  for (const actor of game.actors) {
    if (actor.type !== "adventurer") continue;
    if (actor.system.level <= 1) continue;
    if (actor.system.xp.total > 0) continue;

    const backfilledTotal = (actor.system.level - 1) * xpPerLevel;
    await actor.update({
      "system.xp.total": backfilledTotal,
      "system.xp.current": Math.max(actor.system.xp.current, backfilledTotal)
    }, { noHook: true });
    migrated++;
    console.log(`shards-of-mana | Back-filled XP total for "${actor.name}" (Lv.${actor.system.level} → ${backfilledTotal} XP)`);
  }

  if (migrated > 0) {
    console.log(`shards-of-mana | XP total migration complete: ${migrated} adventurer(s) updated`);
    ui.notifications.info(`Shards of Mana: Back-filled XP totals for ${migrated} adventurer(s).`);
  }
  await game.settings.set("shards-of-mana", "xpTotalMigrated", true);
}

/* -------------------------------------------- */
/*  Combat Simplification Migration              */
/* -------------------------------------------- */

/**
 * One-time migration for the combat simplification overhaul:
 * - Element resistances: percentage (0-100+) → tier (-1 to 3)
 * - Condition resistances: percentage → boolean immunity
 * - Conditions: 25 → 16 (merge/remove old conditions)
 * - Active Effects: rewrite change keys for new derived stats
 * - Equipment: migrate oversized penalties from pHit/mHit/pEva/mEva to acc/eva
 */
async function _migrateCombatSimplification() {
  if (game.settings.get("shards-of-mana", "combatSimplificationMigrated")) return;

  let migrated = 0;

  // --- Helper: convert percentage element resistance to tier ---
  function percentToTier(val) {
    if (val == null || val === 0) return 0;        // Normal
    if (val < 0) return -1;                         // Weak
    if (val > 0 && val < 100) return 1;             // Resist
    if (val === 100) return 2;                      // Immune
    if (val > 100) return 3;                        // Absorb
    return 0;
  }

  // --- Helper: convert percentage condition resistance to boolean ---
  function percentToImmune(val) {
    return val >= 100;
  }

  // --- Condition key mapping: old → new ---
  const CONDITION_MAP = {
    freeze: "stun", shatter: "weaken", hex: null,
    drench: null, exhaust: "slow",
    ward: "guard", bulwark: "guard", valor: null, focus: null, veil: null
  };

  // --- AE change key mapping: old derived stat → new ---
  const AE_KEY_MAP = {
    "system.derived.pHit": "system.derived.acc",
    "system.derived.mHit": "system.derived.acc",
    "system.derived.pEva": "system.derived.eva",
    "system.derived.mEva": "system.derived.eva",
    "system.derived.pDmg": null,  // removed
    "system.derived.mDmg": null,  // removed
    "system.derived.cAvo": null   // removed
  };

  // --- Keys to delete from AE changes ---
  const DELETE_AE_PREFIXES = [
    "system.flags.bonusWeaponElementDamage",
    "system.flags.bonusMagicElementDamage",
    "system.flags.retaliationDamage",
    "system.flags.elementPierce",
    "system.flags.pierceResistance",
    "system.flags.onMeleeHitCondition",
    "system.flags.onMagicHitCondition",
    "system.flags.onMeleeHitPush",
    "system.flags.onMeleeHitPull",
    "system.flags.onMagicHitPush",
    "system.flags.onMagicHitPull",
    "system.flags.packTactics",
    "system.flags.regenBonus"
  ];

  const ELEMENT_KEYS = [
    "physical", "magical", "fire", "ice", "lightning", "wind",
    "earth", "water", "light", "dark", "plant", "poison"
  ];

  const OLD_NEGATIVE_CONDITIONS = [
    "poison", "burn", "freeze", "drench", "blind", "silence",
    "slow", "stun", "root", "shatter", "hex", "exhaust", "downed"
  ];

  // --- Migrate an AE changes array, returns cleaned array ---
  function migrateAEChanges(changes) {
    if (!Array.isArray(changes)) return changes;
    const result = [];
    for (const change of changes) {
      const key = change.key;
      // Delete removed flag keys
      if (DELETE_AE_PREFIXES.some(p => key.startsWith(p))) continue;
      // Map old derived stat keys
      if (AE_KEY_MAP[key] !== undefined) {
        if (AE_KEY_MAP[key] === null) continue; // removed stat
        change.key = AE_KEY_MAP[key];
      }
      // Map old condition keys in conditions schema
      if (key.startsWith("system.conditions.")) {
        const condKey = key.replace("system.conditions.", "");
        if (CONDITION_MAP[condKey] !== undefined) {
          if (CONDITION_MAP[condKey] === null) continue;
          change.key = `system.conditions.${CONDITION_MAP[condKey]}`;
        }
      }
      // Map old condition resistance keys
      if (key.startsWith("system.conditionResistances.")) {
        const condKey = key.replace("system.conditionResistances.", "");
        if (CONDITION_MAP[condKey] !== undefined) {
          if (CONDITION_MAP[condKey] === null) continue;
          change.key = `system.conditionResistances.${CONDITION_MAP[condKey]}`;
        }
      }
      result.push(change);
    }
    return result;
  }

  // --- Migrate a single actor ---
  async function migrateActor(actor) {
    const updates = {};
    let needsUpdate = false;

    // Element resistances: percent → tier
    const elemRes = actor.system.elementResistances;
    if (elemRes) {
      for (const el of ELEMENT_KEYS) {
        const oldVal = elemRes[el];
        if (oldVal == null) continue;
        // Skip if already in tier range (-1 to 3) — likely already migrated
        if (oldVal >= -1 && oldVal <= 3 && Number.isInteger(oldVal)) continue;
        const tier = percentToTier(oldVal);
        updates[`system.elementResistances.${el}`] = tier;
        needsUpdate = true;
      }
    }

    // Condition resistances: percent → boolean
    const condRes = actor.system.conditionResistances;
    if (condRes) {
      for (const cond of OLD_NEGATIVE_CONDITIONS) {
        const oldVal = condRes[cond];
        if (oldVal == null) continue;
        // Map old conditions
        let targetCond = cond;
        if (CONDITION_MAP[cond] !== undefined) {
          if (CONDITION_MAP[cond] === null) continue;
          targetCond = CONDITION_MAP[cond];
        }
        const isImmune = percentToImmune(oldVal);
        if (isImmune) {
          updates[`system.conditionResistances.${targetCond}`] = true;
          needsUpdate = true;
        }
      }
    }

    // Conditions: merge old → new
    const conditions = actor.system.conditions;
    if (conditions) {
      for (const [oldKey, newKey] of Object.entries(CONDITION_MAP)) {
        if (conditions[oldKey] && conditions[oldKey] > 0 && newKey) {
          updates[`system.conditions.${newKey}`] = Math.max(
            conditions[newKey] ?? 0, conditions[oldKey]
          );
          needsUpdate = true;
        }
      }
    }

    if (needsUpdate) {
      await actor.update(updates, { noHook: true });
      migrated++;
    }

    // Migrate Active Effects on this actor
    for (const effect of actor.effects) {
      const oldChanges = effect.changes;
      const newChanges = migrateAEChanges(foundry.utils.deepClone(oldChanges));
      if (JSON.stringify(oldChanges) !== JSON.stringify(newChanges)) {
        await effect.update({ changes: newChanges }, { noHook: true });
        migrated++;
      }
    }

    // Migrate Active Effects on embedded items
    for (const item of actor.items) {
      for (const effect of item.effects) {
        const oldChanges = effect.changes;
        const newChanges = migrateAEChanges(foundry.utils.deepClone(oldChanges));
        if (JSON.stringify(oldChanges) !== JSON.stringify(newChanges)) {
          await effect.update({ changes: newChanges }, { noHook: true });
          migrated++;
        }
      }

      // Migrate equipment oversized penalties
      if (item.type === "equipment" && item.system.oversizedPenalties) {
        const pen = item.system.oversizedPenalties;
        if (pen.pHit != null || pen.mHit != null || pen.pEva != null || pen.mEva != null) {
          const accPenalty = Math.min(pen.pHit ?? 0, pen.mHit ?? 0);
          const evaPenalty = Math.min(pen.pEva ?? 0, pen.mEva ?? 0);
          await item.update({
            "system.oversizedPenalties.acc": accPenalty,
            "system.oversizedPenalties.eva": evaPenalty
          }, { noHook: true });
          migrated++;
        }
      }

      // Migrate lineage element/condition resistances on embedded lineage items
      if (item.type === "lineage") {
        await migrateLineageResistances(item);
      }
    }
  }

  // --- Migrate lineage/species resistance fields ---
  async function migrateLineageResistances(item) {
    const updates = {};
    let needsUpdate = false;

    const elemRes = item.system.elementResistances;
    if (elemRes) {
      for (const el of ELEMENT_KEYS) {
        const oldVal = elemRes[el];
        if (oldVal == null || (oldVal >= -1 && oldVal <= 3)) continue;
        updates[`system.elementResistances.${el}`] = percentToTier(oldVal);
        needsUpdate = true;
      }
    }

    const condRes = item.system.conditionResistances;
    if (condRes) {
      for (const cond of OLD_NEGATIVE_CONDITIONS) {
        const oldVal = condRes[cond];
        if (oldVal == null) continue;
        let targetCond = cond;
        if (CONDITION_MAP[cond] !== undefined) {
          if (CONDITION_MAP[cond] === null) continue;
          targetCond = CONDITION_MAP[cond];
        }
        if (percentToImmune(oldVal)) {
          updates[`system.conditionResistances.${targetCond}`] = true;
          needsUpdate = true;
        }
      }
    }

    if (needsUpdate) {
      await item.update(updates, { noHook: true });
      migrated++;
    }
  }

  // --- Run migration on all world actors ---
  for (const actor of game.actors) {
    try {
      await migrateActor(actor);
    } catch (err) {
      console.error(`shards-of-mana | Failed to migrate actor "${actor.name}":`, err);
    }
  }

  // --- Run migration on world-level lineage items ---
  for (const item of game.items) {
    if (item.type !== "lineage") continue;
    try {
      await migrateLineageResistances(item);
      // Migrate AEs on world items
      for (const effect of item.effects) {
        const oldChanges = effect.changes;
        const newChanges = migrateAEChanges(foundry.utils.deepClone(oldChanges));
        if (JSON.stringify(oldChanges) !== JSON.stringify(newChanges)) {
          await effect.update({ changes: newChanges }, { noHook: true });
          migrated++;
        }
      }
    } catch (err) {
      console.error(`shards-of-mana | Failed to migrate lineage "${item.name}":`, err);
    }
  }

  // --- Migrate AEs on all world-level items (non-lineage) ---
  for (const item of game.items) {
    if (item.type === "lineage") continue;
    try {
      for (const effect of item.effects) {
        const oldChanges = effect.changes;
        const newChanges = migrateAEChanges(foundry.utils.deepClone(oldChanges));
        if (JSON.stringify(oldChanges) !== JSON.stringify(newChanges)) {
          await effect.update({ changes: newChanges }, { noHook: true });
          migrated++;
        }
      }
    } catch (err) {
      console.error(`shards-of-mana | Failed to migrate item "${item.name}":`, err);
    }
  }

  if (migrated > 0) {
    console.log(`shards-of-mana | Combat simplification migration complete: ${migrated} document(s) updated`);
    ui.notifications.info(`Shards of Mana: Combat simplification migration complete (${migrated} documents updated).`);
  }
  await game.settings.set("shards-of-mana", "combatSimplificationMigrated", true);
}

/* -------------------------------------------- */
/*  Skill Simplification Migration              */
/* -------------------------------------------- */

/**
 * One-time migration for the skill simplification overhaul:
 * - Map old skillType values (combat, utility, magic, spell) to new types (active, passive, reaction, limitBreak)
 * - Set autoFormula: false on all existing skills (preserve their custom formulas)
 * - Set powerTier: "standard" on all existing skills
 * - Remove magicRequirement data
 * - Update timing: "magic" → "passive"
 */
async function _migrateSkillSimplification() {
  if (game.settings.get("shards-of-mana", "skillSimplificationMigrated")) return;

  let migrated = 0;

  // Map old skill types to new
  const typeMap = {
    combat: "active",
    utility: "active",
    magic: "passive",
    spell: "active"
    // active, passive, reaction, limitBreak already correct
  };

  const timingMap = {
    magic: "passive"
    // action, reaction, passive, limitBreak already correct
  };

  /**
   * Migrate a single skill item's system data.
   * @param {Item} skill
   * @returns {object|null} Update data or null if no migration needed
   */
  function buildSkillUpdate(skill) {
    if (skill.type !== "skill") return null;
    const sys = skill.system;
    const updates = {};
    let needsUpdate = false;

    // Migrate skillType
    const newType = typeMap[sys.skillType];
    if (newType) {
      updates["system.skillType"] = newType;
      needsUpdate = true;
    }

    // Migrate timing
    const newTiming = timingMap[sys.timing];
    if (newTiming) {
      updates["system.timing"] = newTiming;
      needsUpdate = true;
    }

    // Special case: utility skills with timing "action" stay as timing "action" but become "active"
    // Magic skills with timing "magic" become passive with timing "passive"

    // Set autoFormula to false (preserve existing manual formulas)
    if (sys.autoFormula === undefined || sys.autoFormula === true) {
      updates["system.autoFormula"] = false;
      needsUpdate = true;
    }

    // Set powerTier if missing
    if (!sys.powerTier) {
      updates["system.powerTier"] = "standard";
      needsUpdate = true;
    }

    return needsUpdate ? updates : null;
  }

  // --- Migrate world-level skill items ---
  for (const item of game.items) {
    const updates = buildSkillUpdate(item);
    if (updates) {
      await item.update(updates);
      migrated++;
    }
  }

  // --- Migrate embedded skills on all actors ---
  for (const actor of game.actors) {
    for (const item of actor.items) {
      const updates = buildSkillUpdate(item);
      if (updates) {
        await item.update(updates);
        migrated++;
      }
    }
  }

  if (migrated > 0) {
    console.log(`shards-of-mana | Skill simplification migration complete: ${migrated} skill(s) updated`);
    ui.notifications.info(`Shards of Mana: Skill simplification migration complete (${migrated} skills updated).`);
  }
  await game.settings.set("shards-of-mana", "skillSimplificationMigrated", true);
}

/**
 * Phase 2 Migration: Convert inline monster actions to skill items.
 * For each monster with an `actions` array on its source data, create embedded
 * skill items and clear the old actions array.
 */
async function _migrateMonsterActionsToSkills() {
  if (game.settings.get("shards-of-mana", "monsterActionsMigrated")) return;

  let monstersUpdated = 0;
  let skillsCreated = 0;

  // Map damage types that imply magical defense
  const magicalElements = new Set([
    "magical", "fire", "ice", "lightning", "wind", "earth", "water", "light", "dark", "plant", "poison"
  ]);

  for (const actor of game.actors) {
    if (actor.type !== "monster") continue;

    // Read raw source data to get old actions (schema no longer defines them)
    const sourceActions = actor._source?.system?.actions;
    if (!Array.isArray(sourceActions) || sourceActions.length === 0) continue;

    // Build skill items from each action
    const skillItems = sourceActions.map(action => {
      const isMagical = magicalElements.has(action.type);
      const defenseType = isMagical ? "magical" : "physical";

      // Map conditionName (free text) to condition key if possible
      let conditionKey = "";
      if (action.conditionName) {
        const normalized = action.conditionName.trim().toLowerCase();
        const validConditions = Object.keys(CONFIG.SHARDS.conditions ?? {});
        conditionKey = validConditions.find(c => c === normalized) ?? "";
      }

      return {
        name: action.name || "Unnamed Action",
        type: "skill",
        img: "icons/svg/sword.svg",
        system: {
          skillType: "active",
          timing: "action",
          defenseType,
          damageType: action.type || "physical",
          baseAccuracy: action.baseAccuracy ?? 50,
          pierce: !!action.pierce,
          conditionApplied: conditionKey,
          conditionChance: String(action.conditionChance ?? 0),
          description: action.effect || "",
          autoFormula: true,
          powerTier: "standard",
          skillLevel: 1,
          target: "single",
          skillStats: isMagical ? ["mag"] : ["str"]
        }
      };
    });

    try {
      await actor.createEmbeddedDocuments("Item", skillItems);
      skillsCreated += skillItems.length;

      // Clear old actions from source data
      await actor.update({ "system.actions": [] }, { noHook: true });
      monstersUpdated++;
    } catch (err) {
      console.warn(`shards-of-mana | Failed to migrate actions for monster "${actor.name}":`, err);
    }
  }

  if (monstersUpdated > 0) {
    console.log(`shards-of-mana | Monster actions migration complete: ${monstersUpdated} monster(s), ${skillsCreated} skill(s) created`);
    ui.notifications.info(`Shards of Mana: Monster skill migration complete (${monstersUpdated} monsters, ${skillsCreated} skills created).`);
  }
  await game.settings.set("shards-of-mana", "monsterActionsMigrated", true);
}
