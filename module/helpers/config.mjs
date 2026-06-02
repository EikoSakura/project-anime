/**
 * Shards of Mana system configuration constants.
 */
export const SHARDS = {};

/**
 * Core stat abbreviations and labels.
 * @enum {string}
 */
SHARDS.stats = {
  str: "SHARDS.Stats.Str",
  agi: "SHARDS.Stats.Agi",
  vit: "SHARDS.Stats.Vit",
  mag: "SHARDS.Stats.Mag",
  spi: "SHARDS.Stats.Spi",
  per: "SHARDS.Stats.Per",
  lck: "SHARDS.Stats.Lck",
  chm: "SHARDS.Stats.Chm"
};

/**
 * Derived stat labels.
 * @enum {string}
 */
SHARDS.derivedStats = {
  acc: "SHARDS.Derived.Acc",
  eva: "SHARDS.Derived.Eva",
  pDef: "SHARDS.Derived.PDef",
  mDef: "SHARDS.Derived.MDef",
  crit: "SHARDS.Derived.Crit"
};

/**
 * Rank progression: F -> E -> D -> C -> B -> A -> S
 * @enum {string}
 */
SHARDS.ranks = {
  F: "SHARDS.Ranks.F",
  E: "SHARDS.Ranks.E",
  D: "SHARDS.Ranks.D",
  C: "SHARDS.Ranks.C",
  B: "SHARDS.Ranks.B",
  A: "SHARDS.Ranks.A",
  S: "SHARDS.Ranks.S"
};

/**
 * Rank order for comparison (higher = better).
 * @type {Object<string, number>}
 */
SHARDS.rankOrder = {
  F: 0,
  E: 1,
  D: 2,
  C: 3,
  B: 4,
  A: 5,
  S: 6
};

/**
 * Schools / affinities for Jobs and Manacite.
 * Determines which skill sockets a Manacite can be placed in on the Mana Grid.
 * @type {Object<string, {label: string, color: string, icon: string}>}
 */
SHARDS.schools = {
  martial:  { label: "SHARDS.School.Martial",  color: "#e05050", icon: "fa-solid fa-sword" },
  arcane:   { label: "SHARDS.School.Arcane",   color: "#7060e0", icon: "fa-solid fa-hat-wizard" },
  divine:   { label: "SHARDS.School.Divine",    color: "#e8d060", icon: "fa-solid fa-sun" },
  nature:   { label: "SHARDS.School.Nature",    color: "#50b850", icon: "fa-solid fa-leaf" },
  rogue:    { label: "SHARDS.School.Rogue",     color: "#60c0c0", icon: "fa-solid fa-mask" },
  general:  { label: "SHARDS.School.General",   color: "#a0a0b0", icon: "fa-solid fa-circle-nodes" }
};

/**
 * Job categories and their localization keys.
 * @enum {string}
 */
SHARDS.jobCategories = {
  basic: "SHARDS.Job.Category.Basic",
  advanced: "SHARDS.Job.Category.Advanced",
  hybrid: "SHARDS.Job.Category.Hybrid",
  special: "SHARDS.Job.Category.Special"
};

/**
 * Job category colors for badge rendering (reference; actual colors in CSS via data-category).
 * @type {Object<string, string>}
 */
SHARDS.jobCategoryColors = {
  basic: "#4CAF50",
  advanced: "#42A5F5",
  hybrid: "#8b6fe0",
  special: "#d4a843"
};

/**
 * Pip counts by Job Rank.
 * @type {Object<string, number>}
 */
SHARDS.pipsByRank = {
  F: 2,
  E: 2,
  D: 3,
  C: 3,
  B: 4,
  A: 4,
  S: 5
};

/**
 * Equipment slot types.
 * @enum {string}
 */
SHARDS.equipmentSlots = {
  weapon: "SHARDS.Equipment.Weapon",
  offhand: "SHARDS.Equipment.Offhand",
  helm: "SHARDS.Equipment.Helm",
  armor: "SHARDS.Equipment.Armor",
  accessory1: "SHARDS.Equipment.Accessory1",
  accessory2: "SHARDS.Equipment.Accessory2"
};

/**
 * Weapon groups.
 * @enum {string}
 */
SHARDS.weaponGroups = {
  bows: "SHARDS.WeaponGroup.Bows",
  chains: "SHARDS.WeaponGroup.Chains",
  clubs: "SHARDS.WeaponGroup.Clubs",
  firearms: "SHARDS.WeaponGroup.Firearms",
  heavy: "SHARDS.WeaponGroup.Heavy",
  instruments: "SHARDS.WeaponGroup.Instruments",
  longBlades: "SHARDS.WeaponGroup.LongBlades",
  natural: "SHARDS.WeaponGroup.Natural",
  polearms: "SHARDS.WeaponGroup.Polearms",
  shields: "SHARDS.WeaponGroup.Shields",
  shortBlades: "SHARDS.WeaponGroup.ShortBlades",
  staves: "SHARDS.WeaponGroup.Staves",
  throwing: "SHARDS.WeaponGroup.Throwing",
  tomes: "SHARDS.WeaponGroup.Tomes",
  unarmed: "SHARDS.WeaponGroup.Unarmed",
  wands: "SHARDS.WeaponGroup.Wands"
};

/**
 * Weapon handedness types.
 * @enum {string}
 */
SHARDS.handedness = {
  "one-handed": "SHARDS.Equipment.OneHanded",
  "two-handed": "SHARDS.Equipment.TwoHanded",
  "oversized": "SHARDS.Equipment.Oversized"
};

/**
 * Armor categories.
 * @enum {string}
 */
SHARDS.armorCategories = {
  clothing: "SHARDS.ArmorCategory.Clothing",
  light: "SHARDS.ArmorCategory.Light",
  heavy: "SHARDS.ArmorCategory.Heavy",
  shields: "SHARDS.ArmorCategory.Shields"
};

// Trait categories removed — traits are now freeform.
// Lineages are a separate item type — see LineageData.

/**
 * Target types (skills, monster actions).
 * @enum {string}
 */
SHARDS.targetTypes = {
  self: "SHARDS.Target.Self",
  single: "SHARDS.Target.Single",
  area: "SHARDS.Target.Area",
  field: "SHARDS.Target.Field"
};

/**
 * Damage types.
 * @enum {string}
 */
SHARDS.damageTypes = {
  physical: "SHARDS.DamageType.Physical",
  fire: "SHARDS.DamageType.Fire",
  ice: "SHARDS.DamageType.Ice",
  lightning: "SHARDS.DamageType.Lightning",
  wind: "SHARDS.DamageType.Wind",
  earth: "SHARDS.DamageType.Earth",
  water: "SHARDS.DamageType.Water",
  light: "SHARDS.DamageType.Light",
  dark: "SHARDS.DamageType.Dark",
  plant: "SHARDS.DamageType.Plant",
  poison: "SHARDS.DamageType.Poison",
  healing: "SHARDS.DamageType.Healing",
  buff: "SHARDS.DamageType.Buff"
};

/**
 * Conditions that can affect combatants.
 * @enum {string}
 */
SHARDS.conditions = {
  // Negative (9)
  poison: "SHARDS.Condition.poison",
  burn: "SHARDS.Condition.burn",
  stun: "SHARDS.Condition.stun",
  blind: "SHARDS.Condition.blind",
  silence: "SHARDS.Condition.silence",
  slow: "SHARDS.Condition.slow",
  root: "SHARDS.Condition.root",
  weaken: "SHARDS.Condition.weaken",
  downed: "SHARDS.Condition.downed",
  // Positive (7)
  regen: "SHARDS.Condition.regen",
  refresh: "SHARDS.Condition.refresh",
  haste: "SHARDS.Condition.haste",
  guard: "SHARDS.Condition.guard",
  reflect: "SHARDS.Condition.reflect",
  undying: "SHARDS.Condition.undying",
  berserk: "SHARDS.Condition.berserk"
};

/**
 * Movement modes.
 * @enum {string}
 */
SHARDS.movementModes = {
  walk: "SHARDS.Movement.Walk",
  fly: "SHARDS.Movement.Fly",
  swim: "SHARDS.Movement.Swim",
  climb: "SHARDS.Movement.Climb",
  burrow: "SHARDS.Movement.Burrow",
  teleport: "SHARDS.Movement.Teleport"
};

/**
 * Difficulty modifiers for d100 stat tests.
 * @type {Object<string, number>}
 */
SHARDS.difficultyModifiers = {
  easy: 20,
  normal: 0,
  hard: -20,
  severe: -40,
  extreme: -60
};

/* -------------------------------------------- */
/*  Combat Formula Constants                    */
/* -------------------------------------------- */

/**
 * BRP-style combat resolution constants.
 * Hit%  = baseAccuracy + (ACC - target.EVA) × HIT_SCALAR
 * Stat test% = STAT_TEST_BASE + (stat - STAT_BASELINE) × STAT_TEST_SCALAR + difficulty
 * Crit% = CRIT_BASE + attackerCrit
 * @type {Object<string, number>}
 */
SHARDS.combatFormula = {
  HIT_SCALAR: 3,        // Each point of (ACC - EVA) differential = ±3% hit
  HIT_FLOOR: 5,         // Minimum hit chance %
  HIT_CEILING: 95,      // Maximum hit chance %
  CRIT_BASE: 5,         // Base crit chance %
  CRIT_FLOOR: 1,        // Minimum crit chance %
  CRIT_CEILING: 30,     // Maximum crit chance %
  DMG_FLOOR_PCT: 10,    // Minimum % of pre-defense damage that always gets through
  STAT_TEST_BASE: 50,   // Base % for stat tests (50 = coin flip at baseline stat)
  STAT_BASELINE: 10,    // The "average" stat value (matches base stat initial value)
  STAT_TEST_SCALAR: 2,  // Each stat point above baseline = +2% on stat tests
  UNARMED_ACCURACY: 40  // Default base accuracy for unarmed/improvised attacks
};

/**
 * Manacite types.
 * @enum {string}
 */
SHARDS.manaciteTypes = {
  standard: "SHARDS.Manacite.Standard",
  monster: "SHARDS.Manacite.Monster"
};

/**
 * Skill type classifications (simplified: 4 types).
 * active = combat, spells, utility abilities.
 * passive = always-on effects.
 * reaction = triggered responses.
 * limitBreak = ultimate abilities gated by limit gauge.
 * @enum {string}
 */
SHARDS.skillTypes = {
  active: "SHARDS.Skill.Type.Active",
  passive: "SHARDS.Skill.Type.Passive",
  reaction: "SHARDS.Skill.Type.Reaction",
  limitBreak: "SHARDS.Skill.Type.LimitBreak"
};

/**
 * Skill timing (action economy).
 * @enum {string}
 */
SHARDS.skillTimings = {
  action: "SHARDS.Skill.Timing.Action",
  reaction: "SHARDS.Skill.Timing.Reaction",
  passive: "SHARDS.Skill.Timing.Passive",
  limitBreak: "SHARDS.Skill.Timing.LimitBreak"
};

/**
 * Power tiers for auto-formula generation.
 * statMultiplier scales the stat contribution, slMultiplier scales SL contribution.
 * @enum {{ label: string, statMultiplier: number, slMultiplier: number }}
 */
SHARDS.powerTiers = {
  weak:        { label: "SHARDS.PowerTier.Weak",        statMultiplier: 0.5, slMultiplier: 2 },
  standard:    { label: "SHARDS.PowerTier.Standard",    statMultiplier: 1.0, slMultiplier: 4 },
  strong:      { label: "SHARDS.PowerTier.Strong",      statMultiplier: 1.5, slMultiplier: 6 },
  devastating: { label: "SHARDS.PowerTier.Devastating", statMultiplier: 2.0, slMultiplier: 8 }
};

/**
 * Skill creation templates — pre-built presets that fill all fields at once.
 * GMs pick a template, customize name/element, and the skill is ready.
 * @type {Object<string, {label: string, icon: string, data: object}>}
 */
SHARDS.skillTemplates = {
  basicStrike: {
    label: "SHARDS.SkillTemplate.BasicStrike",
    icon: "icons/svg/sword.svg",
    data: {
      skillType: "active", timing: "action", target: "single",
      damageType: "physical", defenseType: "physical",
      skillStats: ["str"], powerTier: "standard", autoFormula: true,
      baseAccuracy: 80, pipCost: "2", mpCost: "0"
    }
  },
  magicBolt: {
    label: "SHARDS.SkillTemplate.MagicBolt",
    icon: "icons/svg/lightning.svg",
    data: {
      skillType: "active", timing: "action", target: "single",
      damageType: "", defenseType: "magical",
      skillStats: ["mag"], powerTier: "standard", autoFormula: true,
      baseAccuracy: 75, pipCost: "2", mpCost: "SL"
    }
  },
  aoeBurst: {
    label: "SHARDS.SkillTemplate.AoeBurst",
    icon: "icons/svg/explosion.svg",
    data: {
      skillType: "active", timing: "action", target: "area",
      areaShape: "burst", areaSize: 2, aoeFilter: "all",
      damageType: "", defenseType: "magical",
      skillStats: ["mag"], powerTier: "standard", autoFormula: true,
      baseAccuracy: 70, pipCost: "3", mpCost: "SL + 2"
    }
  },
  aoeLine: {
    label: "SHARDS.SkillTemplate.AoeLine",
    icon: "icons/svg/lightning.svg",
    data: {
      skillType: "active", timing: "action", target: "area",
      areaShape: "line", areaSize: 4, aoeFilter: "enemies",
      damageType: "", defenseType: "magical",
      skillStats: ["mag"], powerTier: "standard", autoFormula: true,
      baseAccuracy: 70, pipCost: "3", mpCost: "SL + 2"
    }
  },
  aoeCross: {
    label: "SHARDS.SkillTemplate.AoeCross",
    icon: "icons/svg/explosion.svg",
    data: {
      skillType: "active", timing: "action", target: "area",
      areaShape: "cross", areaSize: 3, aoeFilter: "all",
      damageType: "", defenseType: "magical",
      skillStats: ["mag"], powerTier: "strong", autoFormula: true,
      baseAccuracy: 65, pipCost: "4", mpCost: "SL + 3"
    }
  },
  heal: {
    label: "SHARDS.SkillTemplate.Heal",
    icon: "icons/svg/regen.svg",
    data: {
      skillType: "active", timing: "action", target: "single",
      damageType: "healing", defenseType: "none",
      skillStats: ["spi"], powerTier: "standard", autoFormula: true,
      baseAccuracy: null, pipCost: "3", mpCost: "SL + 1"
    }
  },
  buff: {
    label: "SHARDS.SkillTemplate.Buff",
    icon: "icons/svg/upgrade.svg",
    data: {
      skillType: "active", timing: "action", target: "single",
      damageType: "buff", defenseType: "none",
      skillStats: [], powerTier: "standard", autoFormula: false,
      baseAccuracy: null, pipCost: "3", mpCost: "SL",
      buffDuration: "SL", damageFormula: ""
    }
  },
  condition: {
    label: "SHARDS.SkillTemplate.Condition",
    icon: "icons/svg/daze.svg",
    data: {
      skillType: "active", timing: "action", target: "single",
      damageType: "", defenseType: "magical",
      skillStats: [], powerTier: "weak", autoFormula: true,
      baseAccuracy: 70, pipCost: "2", mpCost: "SL",
      conditionChance: "50"
    }
  },
  passiveBoost: {
    label: "SHARDS.SkillTemplate.PassiveBoost",
    icon: "icons/svg/aura.svg",
    data: {
      skillType: "passive", timing: "passive", target: "self",
      damageType: "", defenseType: "none",
      skillStats: [], powerTier: "standard", autoFormula: false,
      baseAccuracy: null, pipCost: "0", mpCost: "0", damageFormula: ""
    }
  },
  quickReaction: {
    label: "SHARDS.SkillTemplate.QuickReaction",
    icon: "icons/svg/shield.svg",
    data: {
      skillType: "reaction", timing: "reaction", target: "self",
      damageType: "", defenseType: "none",
      skillStats: [], powerTier: "standard", autoFormula: false,
      baseAccuracy: null, pipCost: "1", mpCost: "0", damageFormula: ""
    }
  }
};

/**
 * Area of effect shapes.
 * @enum {string}
 */
SHARDS.areaShapes = {
  burst: "SHARDS.Skill.Area.Burst",
  line: "SHARDS.Skill.Area.Line",
  cross: "SHARDS.Skill.Area.Cross"
};

/**
 * AoE disposition filters — who gets targeted within a measured template.
 * @enum {string}
 */
SHARDS.aoeFilters = {
  all: "SHARDS.AoE.Filter.All",
  enemies: "SHARDS.AoE.Filter.Enemies",
  allies: "SHARDS.AoE.Filter.Allies"
};

/**
 * Mapping from Shards area shapes to Foundry MeasuredTemplate types.
 * Cross is handled specially as two perpendicular rays.
 * @type {Object<string, string>}
 */
SHARDS.areaShapeToTemplateType = {
  burst: "circle",
  line: "ray",
  cross: "ray"
};

/**
 * Defense types for skill resolution.
 * @enum {string}
 */
SHARDS.defenseTypes = {
  physical: "SHARDS.Skill.Defense.Physical",
  magical: "SHARDS.Skill.Defense.Magical",
  none: "SHARDS.Skill.Defense.None"
};

/* -------------------------------------------- */
/*  Constellation Tree System                    */
/* -------------------------------------------- */

// SP economy removed — skills level via manacite XP siphon, bonds via GM award

/**
 * SP cost to advance a skill from SL N to SL N+1.
 * Index = current skill level; value = SP cost to reach the next level.
 * Total cost to max (SL 1 → 5): 10 SP.
 * @type {number[]}
 */
SHARDS.skillLevelCosts = [0, 1, 2, 3, 4];

/**
 * Maximum skill level.
 * @type {number}
 */
SHARDS.skillLevelMax = 5;

/**
 * Cumulative XP thresholds for Manacite skill level advancement.
 * Index = target SL (SL 1 = 0 XP, SL 2 = 50 cumulative, etc.)
 * @type {number[]}
 */
SHARDS.manaciteXpThresholds = [0, 0, 50, 150, 350, 750];

/**
 * Fraction of earned adventurer XP that each socketed item (manacite/job) absorbs.
 * This is bonus XP — adventurer XP is NOT reduced.
 * @type {number}
 */
SHARDS.manaciteXpSiphonRate = 0.10;

/**
 * Cumulative XP thresholds for Job rank advancement via XP siphon.
 * Ranks: F(start) → E → D → C → B → A → S
 * @type {Object<string, number>}
 */
SHARDS.jobXpThresholds = {
  E: 200,
  D: 700,
  C: 1700,
  B: 3700,
  A: 7700,
  S: 15700
};

/**
 * Adventurer levels at which new job sockets unlock on the Mana Grid.
 * @type {number[]}
 */
SHARDS.gridJobSocketLevels = [1, 10, 20];

/**
 * Number of skill sockets that branch from a job socket, by job rank.
 * @type {Object<string, number>}
 */
SHARDS.gridSkillSocketsByJobRank = {
  F: 1, E: 2, D: 2, C: 3, B: 3, A: 4, S: 5
};

/**
 * Number of free sockets (any-school) available by adventurer level.
 * Returns a count: 1 at level 1, +1 every 5 levels.
 * @param {number} level
 * @returns {number}
 */
SHARDS.gridFreeSocketsByLevel = function(level) {
  return Math.max(1, 1 + Math.floor((level - 1) / 5));
};

/**
 * Constellation tree node types with display info.
 * @enum {{ label: string, icon: string, color: string }}
 */
SHARDS.nodeTypes = {
  innate:      { label: "SHARDS.Tree.NodeType.Innate",       icon: "fa-solid fa-dna",             color: "#e8eaf0" },
  talent:      { label: "SHARDS.Tree.NodeType.Talent",       icon: "fa-solid fa-gem",             color: "#ffd040" },
  skill:       { label: "SHARDS.Tree.NodeType.Skill",        icon: "fa-solid fa-burst",           color: "#00d4a0" },
  growth:      { label: "SHARDS.Tree.NodeType.Growth",       icon: "fa-solid fa-arrow-trend-up",  color: "#4CAF50" },
  elemental:   { label: "SHARDS.Tree.NodeType.Elemental",    icon: "fa-solid fa-shield-halved",   color: "#e05070" },
  passive:     { label: "SHARDS.Tree.NodeType.Passive",      icon: "fa-solid fa-circle-dot",      color: "#42A5F5" },
  proficiency: { label: "SHARDS.Tree.NodeType.Proficiency",  icon: "fa-solid fa-star",            color: "#ff9800" },
  movement:    { label: "SHARDS.Tree.NodeType.Movement",     icon: "fa-solid fa-person-running",  color: "#8b6fe0" },
  form:        { label: "SHARDS.Tree.NodeType.Form",         icon: "fa-solid fa-diamond",         color: "#d4a843" },
  job:         { label: "SHARDS.Tree.NodeType.Job",          icon: "fa-solid fa-briefcase",       color: "#e8806a" }
};

/**
 * Default SP cost per node type.
 * @type {Object<string, number>}
 */
SHARDS.nodeCostDefaults = {
  innate: 0,
  talent: 1,
  skill: 2,
  growth: 1,
  elemental: 1,
  passive: 1,
  proficiency: 1,
  movement: 1,
  form: 0,
  job: 1
};

/**
 * Grant types for tree nodes with display labels.
 * @enum {string}
 */
SHARDS.grantTypes = {
  skill: "SHARDS.Tree.Grant.Skill",
  activeEffect: "SHARDS.Tree.Grant.ActiveEffect",
  proficiency: "SHARDS.Tree.Grant.Proficiency",
  job: "SHARDS.Tree.Grant.Job"
};

/**
 * NPC disposition values.
 * @enum {string}
 */
SHARDS.dispositions = {
  friendly: "SHARDS.Npc.Disposition.Friendly",
  neutral: "SHARDS.Npc.Disposition.Neutral",
  hostile: "SHARDS.Npc.Disposition.Hostile",
  unknown: "SHARDS.Npc.Disposition.Unknown"
};

/**
 * Merchant restock intervals.
 * @enum {string}
 */
SHARDS.restockIntervals = {
  none: "SHARDS.Merchant.Restock.None",
  daily: "SHARDS.Merchant.Restock.Daily",
  weekly: "SHARDS.Merchant.Restock.Weekly",
  manual: "SHARDS.Merchant.Restock.Manual"
};

/**
 * Element resistance tiers.
 * Stored as integers: -1 = weak, 0 = normal, 1 = resist, 2 = immune, 3 = absorb.
 * @type {Object<number, {label: string, multiplier: number, css: string}>}
 */
SHARDS.resistanceTiers = {
  "-1": { label: "SHARDS.Resistance.Weak",   multiplier: 1.5, css: "weak" },
  "0":  { label: "SHARDS.Resistance.Normal", multiplier: 1.0, css: "normal" },
  "1":  { label: "SHARDS.Resistance.Resist", multiplier: 0.5, css: "resist" },
  "2":  { label: "SHARDS.Resistance.Immune", multiplier: 0.0, css: "immune" },
  "3":  { label: "SHARDS.Resistance.Absorb", multiplier: -1.0, css: "absorb" }
};

/**
 * Resistance tier integer values for convenient reference.
 * @enum {number}
 */
SHARDS.RESISTANCE = {
  WEAK: -1,
  NORMAL: 0,
  RESIST: 1,
  IMMUNE: 2,
  ABSORB: 3
};

/* -------------------------------------------- */
/*  Bond Archetypes                             */
/* -------------------------------------------- */

/**
 * Defined bond archetypes, each with a localization label, icon, and accent color.
 * Inspired by Re:Fantazio Royal Virtues.
 * @enum {{ label: string, icon: string, color: string }}
 */
SHARDS.bondArchetypes = {
  rival:    { label: "SHARDS.Bonds.Archetype.Rival",    icon: "fa-solid fa-khanda",          color: "#d44040" },
  mentor:   { label: "SHARDS.Bonds.Archetype.Mentor",   icon: "fa-solid fa-hat-wizard",      color: "#c4a24e" },
  beloved:  { label: "SHARDS.Bonds.Archetype.Beloved",  icon: "fa-solid fa-heart",           color: "#e070a0" },
  sworn:    { label: "SHARDS.Bonds.Archetype.Sworn",    icon: "fa-solid fa-shield-halved",   color: "#4080d4" },
  kindred:  { label: "SHARDS.Bonds.Archetype.Kindred",  icon: "fa-solid fa-people-arrows",   color: "#40b070" },
  shadow:   { label: "SHARDS.Bonds.Archetype.Shadow",   icon: "fa-solid fa-mask",            color: "#8b6fe0" },
  muse:     { label: "SHARDS.Bonds.Archetype.Muse",     icon: "fa-solid fa-feather-pointed", color: "#40c4c8" },
  guardian: { label: "SHARDS.Bonds.Archetype.Guardian",  icon: "fa-solid fa-chess-rook",      color: "#8a8a9e" }
};

/* -------------------------------------------- */
/*  XP & Progression System                     */
/* -------------------------------------------- */

/**
 * XP required per level (flat).
 * @type {number}
 */
SHARDS.xpPerLevel = 500;

/**
 * XP award categories with default amounts and icons.
 * @type {Object<string, {label: string, icon: string, amount: number}>}
 */
SHARDS.xpAwardCategories = {
  session:    { label: "SHARDS.XP.Category.Session",    icon: "fa-solid fa-calendar-check",    amount: 100 },
  quest:     { label: "SHARDS.XP.Category.Quest",      icon: "fa-solid fa-scroll",            amount: 0   },
  milestone: { label: "SHARDS.XP.Category.Milestone",  icon: "fa-solid fa-flag-checkered",    amount: 250 },
  conviction:{ label: "SHARDS.XP.Category.Conviction", icon: "fa-solid fa-fire-flame-curved",  amount: 50  },
  discovery: { label: "SHARDS.XP.Category.Discovery",  icon: "fa-solid fa-compass",           amount: 50  }
};

/**
 * Level thresholds for adventurer rank advancement.
 * @type {Object<string, number>}
 */
SHARDS.adventurerRankThresholds = {
  F: 1,
  E: 10,
  D: 20,
  C: 30,
  B: 45,
  A: 60,
  S: 80
};

/* -------------------------------------------- */
/*  Active Effect Mode Shorthand                */
/* -------------------------------------------- */

const ADD = 2;  // CONST.ACTIVE_EFFECT_MODES.ADD

/**
 * Helper: build a change entry for condition flag + optional stat modifications.
 * @param {string} conditionKey
 * @param {Array<{key: string, value: number}>} [extras=[]] Additional changes
 * @returns {object[]}
 */
function _conditionChanges(conditionKey, extras = []) {
  return [
    { key: `system.conditions.${conditionKey}`, mode: ADD, value: "1" },
    ...extras.map(e => ({ key: e.key, mode: ADD, value: String(e.value) }))
  ];
}

/* -------------------------------------------- */
/*  Condition Effect Configurations              */
/* -------------------------------------------- */

/**
 * Status effect definitions for all 16 conditions.
 * Registered as CONFIG.statusEffects in the init hook.
 * Each entry populates the Token HUD and creates an ActiveEffect with
 * the appropriate changes when toggled.
 * @type {object[]}
 */
SHARDS.conditionEffects = [
  // ---- Negative Conditions (9) ----
  {
    id: "poison",
    name: "SHARDS.Condition.poison",
    img: "icons/svg/poison.svg",
    statuses: ["poison"],
    changes: _conditionChanges("poison")
  },
  {
    id: "burn",
    name: "SHARDS.Condition.burn",
    img: "icons/svg/fire.svg",
    statuses: ["burn"],
    changes: _conditionChanges("burn")
  },
  {
    id: "stun",
    name: "SHARDS.Condition.stun",
    img: "icons/svg/stoned.svg",
    statuses: ["stun"],
    changes: _conditionChanges("stun")
  },
  {
    id: "blind",
    name: "SHARDS.Condition.blind",
    img: "icons/svg/blind.svg",
    statuses: ["blind"],
    changes: _conditionChanges("blind", [
      { key: "system.derived.acc", value: -10 }
    ])
  },
  {
    id: "silence",
    name: "SHARDS.Condition.silence",
    img: "icons/svg/silenced.svg",
    statuses: ["silence"],
    changes: _conditionChanges("silence")
  },
  {
    id: "slow",
    name: "SHARDS.Condition.slow",
    img: "icons/svg/clockwork.svg",
    statuses: ["slow"],
    changes: _conditionChanges("slow", [
      { key: "system.derived.eva", value: -5 },
      { key: "system.mov", value: -2 }
    ])
  },
  {
    id: "root",
    name: "SHARDS.Condition.root",
    img: "icons/svg/net.svg",
    statuses: ["root"],
    changes: _conditionChanges("root")
  },
  {
    id: "weaken",
    name: "SHARDS.Condition.weaken",
    img: "icons/svg/falling.svg",
    statuses: ["weaken"],
    changes: _conditionChanges("weaken", [
      { key: "system.derived.pDef", value: -5 },
      { key: "system.derived.mDef", value: -5 }
    ])
  },
  {
    id: "downed",
    name: "SHARDS.Condition.downed",
    img: "icons/svg/falling.svg",
    statuses: ["downed"],
    changes: _conditionChanges("downed")
  },

  // ---- Positive Conditions (7) ----
  {
    id: "regen",
    name: "SHARDS.Condition.regen",
    img: "icons/svg/regen.svg",
    statuses: ["regen"],
    changes: _conditionChanges("regen")
  },
  {
    id: "refresh",
    name: "SHARDS.Condition.refresh",
    img: "icons/svg/daze.svg",
    statuses: ["refresh"],
    changes: _conditionChanges("refresh")
  },
  {
    id: "haste",
    name: "SHARDS.Condition.haste",
    img: "icons/svg/wing.svg",
    statuses: ["haste"],
    changes: _conditionChanges("haste", [
      { key: "system.derived.eva", value: 5 },
      { key: "system.mov", value: 2 }
    ])
  },
  {
    id: "guard",
    name: "SHARDS.Condition.guard",
    img: "icons/svg/shield.svg",
    statuses: ["guard"],
    changes: _conditionChanges("guard", [
      { key: "system.derived.pDef", value: 5 },
      { key: "system.derived.mDef", value: 5 }
    ])
  },
  {
    id: "reflect",
    name: "SHARDS.Condition.reflect",
    img: "icons/svg/holy-shield.svg",
    statuses: ["reflect"],
    changes: _conditionChanges("reflect")
  },
  {
    id: "undying",
    name: "SHARDS.Condition.undying",
    img: "icons/svg/angel.svg",
    statuses: ["undying"],
    changes: _conditionChanges("undying")
  },
  {
    id: "berserk",
    name: "SHARDS.Condition.berserk",
    img: "icons/svg/sword.svg",
    statuses: ["berserk"],
    changes: _conditionChanges("berserk", [
      { key: "system.stats.str.bonus", value: 5 },
      { key: "system.stats.mag.bonus", value: 5 },
      { key: "system.derived.pDef", value: -3 },
      { key: "system.derived.mDef", value: -3 }
    ])
  }
];

/* -------------------------------------------- */
/*  Party System                                */
/* -------------------------------------------- */

/**
 * Cosmetic party roles — no mechanical effect.
 * @enum {{ label: string, icon: string, color: string }}
 */
SHARDS.partyRoles = {
  tank:    { label: "SHARDS.Party.Role.Tank",    icon: "fa-solid fa-shield-halved",     color: "#4080d4" },
  healer:  { label: "SHARDS.Party.Role.Healer",  icon: "fa-solid fa-heart-pulse",       color: "#40b060" },
  dps:     { label: "SHARDS.Party.Role.DPS",      icon: "fa-solid fa-crosshairs",        color: "#d44040" },
  support: { label: "SHARDS.Party.Role.Support",  icon: "fa-solid fa-hand-holding-heart", color: "#8b6fe0" },
  scout:   { label: "SHARDS.Party.Role.Scout",    icon: "fa-solid fa-eye",               color: "#40c4c8" }
};

/**
 * Quest status definitions.
 * @enum {{ label: string, icon: string, color: string }}
 */
SHARDS.questStatuses = {
  active:    { label: "SHARDS.Party.QuestStatus.Active",    icon: "fa-solid fa-circle-play",  color: "#8b6fe0" },
  completed: { label: "SHARDS.Party.QuestStatus.Completed", icon: "fa-solid fa-circle-check", color: "#40b060" },
  failed:    { label: "SHARDS.Party.QuestStatus.Failed",    icon: "fa-solid fa-circle-xmark", color: "#d44040" }
};

/**
 * Quest priority levels.
 * @enum {{ label: string, icon: string }}
 */
SHARDS.questPriorities = {
  low:      { label: "SHARDS.Party.Priority.Low",      icon: "fa-solid fa-arrow-down" },
  normal:   { label: "SHARDS.Party.Priority.Normal",   icon: "" },
  high:     { label: "SHARDS.Party.Priority.High",     icon: "fa-solid fa-arrow-up" },
  critical: { label: "SHARDS.Party.Priority.Critical", icon: "fa-solid fa-triangle-exclamation" }
};
