/**
 * Shared helper for building Effect Creator target groups and resolving
 * composite target values to/from Active Effect change keys.
 *
 * Used by both EffectCreatorApp and ConstellationEditor so the categorized
 * dropdown and the underlying key mapping stay in sync.
 */

/* ============================= */
/*  Build Target Groups          */
/* ============================= */

/**
 * Build optgroup-structured dropdown options for effect target selectors.
 * Returns an array of { group, options[] } where each option has { value, label }.
 * The `value` is a composite string like "stat.str" or "element.fire".
 * @returns {{ group: string, options: { value: string, label: string }[] }[]}
 */
export function buildEffectTargetGroups() {
  const groups = [];

  // Stats
  groups.push({
    group: game.i18n.localize("SHARDS.EffectCreator.CatStat"),
    options: Object.keys(CONFIG.SHARDS.stats).map(key => ({
      value: `stat.${key}`,
      label: game.i18n.localize(`SHARDS.Stats.${key}`)
    }))
  });

  // Growth Rates
  groups.push({
    group: game.i18n.localize("SHARDS.EffectCreator.CatGrowthRate"),
    options: Object.keys(CONFIG.SHARDS.stats).map(key => ({
      value: `growthRate.${key}`,
      label: game.i18n.localize(`SHARDS.Stats.${key}`)
    }))
  });

  // Derived Stats (includes Max HP / Max MP)
  const derivedOptions = [
    { value: "hpmp.hp", label: game.i18n.localize("SHARDS.Derived.MaxHp") },
    { value: "hpmp.mp", label: game.i18n.localize("SHARDS.Derived.MaxMp") },
    ...Object.entries(CONFIG.SHARDS.derivedStats).map(([key, label]) => ({
      value: `derived.${key}`,
      label: game.i18n.localize(label)
    }))
  ];
  groups.push({
    group: game.i18n.localize("SHARDS.DerivedStats"),
    options: derivedOptions
  });

  // Elements — handled as tier-based toggles in the Effect Creator flags section.

  // Movement
  groups.push({
    group: game.i18n.localize("SHARDS.EffectCreator.CatMovement"),
    options: [
      { value: "movement.mov", label: game.i18n.localize("SHARDS.EffectCreator.MovSpeed") },
      { value: "size.size", label: game.i18n.localize("SHARDS.Size") }
    ]
  });

  return groups;
}

/* ============================= */
/*  Resolve: Composite → AE Key */
/* ============================= */

/**
 * Given a composite target value (e.g. "stat.str"), return the Active Effect
 * change key and mode.
 * @param {string} compositeValue  e.g. "stat.str", "element.fire", "hpmp.hp"
 * @returns {{ key: string, mode: number }|null}  null if unrecognized
 */
export function resolveEffectTarget(compositeValue) {
  if (!compositeValue) return null;

  const dotIdx = compositeValue.indexOf(".");
  if (dotIdx < 0) return null;

  const category = compositeValue.slice(0, dotIdx);
  const targetKey = compositeValue.slice(dotIdx + 1);

  switch (category) {
    case "stat":
      return { key: `system.stats.${targetKey}.bonus`, mode: 2 };
    case "growthRate":
      return { key: `system.growthRates.${targetKey}`, mode: 2 };
    case "element":
      return { key: `system.elementResistances.${targetKey}`, mode: 2 };
    case "derived":
      return { key: `system.derived.${targetKey}`, mode: 2 };
    case "movement":
      return { key: "system.mov", mode: 2 };
    case "size":
      return { key: "system.size", mode: 5 }; // OVERRIDE
    case "hpmp":
      return { key: targetKey === "hp" ? "system.health.max" : "system.mana.max", mode: 2 };
    default:
      return null;
  }
}

/* ============================= */
/*  Reverse: AE Key → Composite */
/* ============================= */

/**
 * Reverse-map an Active Effect change key back to its composite target value.
 * Returns null if the key doesn't match any known pattern — caller can fall
 * back to a "Custom" display.
 * @param {string} aeKey  e.g. "system.stats.str.bonus"
 * @returns {string|null}  e.g. "stat.str" or null
 */
export function reverseEffectTarget(aeKey) {
  if (!aeKey) return null;

  // system.stats.{stat}.bonus → stat.{stat}
  const statMatch = aeKey.match(/^system\.stats\.(\w+)\.bonus$/);
  if (statMatch) return `stat.${statMatch[1]}`;

  // system.growthRates.{stat} → growthRate.{stat}
  const growthMatch = aeKey.match(/^system\.growthRates\.(\w+)$/);
  if (growthMatch) return `growthRate.${growthMatch[1]}`;

  // system.elementResistances.{elem} → element.{elem}
  const elemMatch = aeKey.match(/^system\.elementResistances\.(\w+)$/);
  if (elemMatch) return `element.${elemMatch[1]}`;

  // system.derived.{key} → derived.{key}
  const derivedMatch = aeKey.match(/^system\.derived\.(\w+)$/);
  if (derivedMatch) return `derived.${derivedMatch[1]}`;

  // system.health.max / system.mana.max → hpmp.hp / hpmp.mp
  if (aeKey === "system.health.max") return "hpmp.hp";
  if (aeKey === "system.mana.max") return "hpmp.mp";

  // system.mov → movement.mov
  if (aeKey === "system.mov") return "movement.mov";

  // system.size → size.size
  if (aeKey === "system.size") return "size.size";

  return null;
}

/**
 * Given an AE key, find a human-readable label from the target groups.
 * Falls back to the raw key if not found.
 * @param {string} aeKey  e.g. "system.stats.str.bonus"
 * @returns {string}
 */
export function labelForAEKey(aeKey) {
  const composite = reverseEffectTarget(aeKey);
  if (!composite) return aeKey;

  const groups = buildEffectTargetGroups();
  for (const g of groups) {
    for (const opt of g.options) {
      if (opt.value === composite) return opt.label;
    }
  }
  return aeKey;
}
