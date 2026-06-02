/**
 * Shared helper functions for Active Effect display preparation.
 * Extracts common condition/element/effect context logic used by all actor sheets.
 */

export const NEGATIVE_KEYS = [
  "poison", "burn", "stun", "blind", "silence",
  "slow", "root", "weaken", "downed"
];
const NEGATIVE_SET = new Set(NEGATIVE_KEYS);

const POSITIVE_KEYS = [
  "haste", "regen", "refresh", "guard",
  "berserk", "reflect", "undying"
];
const POSITIVE_SET = new Set(POSITIVE_KEYS);

/**
 * Build condition display arrays from actor system data.
 * @param {object} system - The actor's system data (post-prepareDerivedData)
 * @returns {{ negativeConditions: object[], positiveConditions: object[], activeConditions: object[], hasActiveConditions: boolean }}
 */
export function prepareConditionDisplay(system) {
  const negativeConditions = NEGATIVE_KEYS.map(key => {
    const resist = system.conditionResistances?.[key] ?? false;
    const resistCategory = resist ? "immune" : "";
    return {
      key,
      label: game.i18n.localize(`SHARDS.Condition.${key}`),
      value: system.conditions[key],
      active: system.conditions[key] > 0,
      resist,
      resistCategory
    };
  }).sort((a, b) => a.label.localeCompare(b.label));

  const positiveConditions = POSITIVE_KEYS.map(key => ({
    key,
    label: game.i18n.localize(`SHARDS.Condition.${key}`),
    value: system.conditions[key],
    active: system.conditions[key] > 0
  })).sort((a, b) => a.label.localeCompare(b.label));

  const activeConditions = [
    ...negativeConditions.filter(c => c.active).map(c => ({
      ...c, type: "negative",
      desc: game.i18n.localize(`SHARDS.ConditionDesc.${c.key}`)
    })),
    ...positiveConditions.filter(c => c.active).map(c => ({
      ...c, type: "positive",
      desc: game.i18n.localize(`SHARDS.ConditionDesc.${c.key}`)
    }))
  ].sort((a, b) => a.label.localeCompare(b.label));

  return {
    negativeConditions,
    positiveConditions,
    activeConditions,
    hasActiveConditions: activeConditions.length > 0
  };
}

/**
 * Category label keys for element resistances.
 */
const ELEMENT_CATEGORY_LABELS = {
  normal: "SHARDS.Element.Normal",
  weak: "SHARDS.Element.Weak",
  resist: "SHARDS.Element.Resist",
  immune: "SHARDS.Element.Immune",
  absorb: "SHARDS.Element.Absorb"
};

/**
 * Build element resistance display data from actor system data.
 * Returns both the full sorted list and a filtered notable-only list.
 * @param {object} system - The actor's system data
 * @returns {{ elementDisplay: object[], notableElements: object[], hasNotableElements: boolean }}
 */
export function prepareElementDisplay(system) {
  const tierCategories = { "-1": "weak", 0: "normal", 1: "resist", 2: "immune", 3: "absorb" };
  const all = Object.entries(system.elementResistances).map(([key, value]) => {
    const category = tierCategories[value] ?? "normal";
    const isNormal = category === "normal";
    const tierLabels = CONFIG.SHARDS?.resistanceTiers;
    const categoryLabel = tierLabels
      ? game.i18n.localize(tierLabels[category] ?? ELEMENT_CATEGORY_LABELS[category])
      : game.i18n.localize(ELEMENT_CATEGORY_LABELS[category]);
    return {
      key,
      label: game.i18n.localize(`SHARDS.DamageType.${key.charAt(0).toUpperCase() + key.slice(1)}`),
      value,
      category,
      categoryLabel,
      isNormal
    };
  }).sort((a, b) => {
    if (a.key === "physical") return -1;
    if (b.key === "physical") return 1;
    if (a.key === "magical") return (b.key === "physical") ? 1 : -1;
    if (b.key === "magical") return (a.key === "physical") ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  const notable = all.filter(e => !e.isNormal);
  return {
    elementDisplay: all,
    notableElements: notable,
    hasNotableElements: notable.length > 0
  };
}

/**
 * Category label keys for condition resistances (boolean: normal or immune).
 */
const CONDITION_RES_CATEGORY_LABELS = {
  normal: "SHARDS.Element.Normal",
  immune: "SHARDS.Element.Immune"
};

/**
 * Build condition resistance display data from actor system data.
 * Only includes the 9 negative conditions. Resistances are booleans (immune or not).
 * @param {object} system - The actor's system data
 * @returns {{ conditionResistanceDisplay: object[], notableConditionResistances: object[], hasNotableConditionResistances: boolean }}
 */
export function prepareConditionResistanceDisplay(system) {
  if (!system.conditionResistances) {
    return { conditionResistanceDisplay: [], notableConditionResistances: [], hasNotableConditionResistances: false };
  }
  const all = NEGATIVE_KEYS.map(key => {
    const value = system.conditionResistances[key] ?? false;
    const category = value ? "immune" : "normal";
    const isNormal = !value;
    const categoryLabel = game.i18n.localize(CONDITION_RES_CATEGORY_LABELS[category]);
    return {
      key,
      label: game.i18n.localize(`SHARDS.Condition.${key}`),
      value,
      category,
      categoryLabel,
      isNormal
    };
  }).sort((a, b) => a.label.localeCompare(b.label));

  const notable = all.filter(e => !e.isNormal);
  return {
    conditionResistanceDisplay: all,
    notableConditionResistances: notable,
    hasNotableConditionResistances: notable.length > 0
  };
}

/**
 * Build active effects display array from an actor.
 * Resolves localization keys in effect names and generates human-readable tooltips.
 * @param {Actor} actor - The actor document
 * @returns {object[]} Array of effect display objects
 */
export function prepareEffectsDisplay(actor) {
  const effects = [];
  // Use actor.effects instead of allApplicableEffects() — the latter
  // skips disabled effects, which we still need to display (greyed out).
  for (const effect of actor.effects) {
    const resolvedName = game.i18n.localize(effect.name);
    const tooltip = _buildEffectTooltip(effect);
    const effectType = _classifyEffectType(effect);
    const durationBadge = _buildDurationBadge(effect);

    effects.push({
      _id: effect.id,
      name: resolvedName,
      img: effect.img,
      disabled: effect.disabled,
      isTemporary: effect.isTemporary,
      duration: effect.duration,
      origin: effect.origin,
      sourceName: effect.sourceName,
      isCondition: effect.statuses?.size > 0,
      parentId: effect.parent?.id,
      tooltip,
      effectType,
      durationBadge
    });
  }
  return effects;
}

/**
 * Build a human-readable tooltip describing an effect's changes.
 * @param {ActiveEffect} effect
 * @returns {string}
 */
function _buildEffectTooltip(effect) {
  if (!effect.changes?.length) return "";
  const parts = [];
  for (const change of effect.changes) {
    const label = _describeChangeKey(change.key);
    if (!label) continue;
    parts.push(`${label} ${formatChangeValue(change)}`);
  }
  return parts.join(", ");
}

/**
 * Format an AE change's value with the appropriate mode prefix.
 * Modes: 2=Add (+/-), 3=Downgrade (min), 4=Upgrade (max), 5=Override (=)
 * @param {object} change - An AE change object { key, mode, value }
 * @returns {string}
 */
export function formatChangeValue(change) {
  const val = Number(change.value);
  const mode = Number(change.mode);

  switch (mode) {
    case 5: // OVERRIDE
      return `= ${change.value}`;
    case 4: // UPGRADE (take higher)
      return `max ${change.value}`;
    case 3: // DOWNGRADE (take lower)
      return `min ${change.value}`;
    case 2: // ADD
    default: {
      const sign = val >= 0 ? "+" : "";
      return `${sign}${change.value}`;
    }
  }
}

/**
 * Convert an AE change key to a human-readable label.
 * @param {string} key - e.g. "system.stats.str.bonus", "system.derived.acc"
 * @returns {string}
 */
export function _describeChangeKey(key) {
  if (key.startsWith("system.stats.") && key.endsWith(".bonus")) {
    const stat = key.replace("system.stats.", "").replace(".bonus", "");
    return game.i18n.localize(CONFIG.SHARDS?.stats?.[stat] ?? stat.toUpperCase());
  }
  if (key.startsWith("system.derived.")) {
    const derived = key.replace("system.derived.", "");
    return game.i18n.localize(CONFIG.SHARDS?.derivedStats?.[derived] ?? derived);
  }
  if (key.startsWith("system.elementResistances.")) {
    const elem = key.replace("system.elementResistances.", "");
    const capitalized = elem.charAt(0).toUpperCase() + elem.slice(1);
    return game.i18n.localize(`SHARDS.DamageType.${capitalized}`) + " Res.";
  }
  if (key.startsWith("system.conditionResistances.")) {
    const cond = key.replace("system.conditionResistances.", "");
    return game.i18n.localize(`SHARDS.Condition.${cond}`) + " Immunity";
  }
  if (key.startsWith("system.conditions.")) {
    const cond = key.replace("system.conditions.", "");
    return game.i18n.localize(`SHARDS.Condition.${cond}`);
  }
  if (key === "system.size") return game.i18n.localize("SHARDS.Size");
  if (key === "system.mov") return "MOV";
  if (key === "system.health.max") return "HP Max";
  if (key === "system.mana.max") return "MP Max";
  if (key === "system.flags.mightyGrip") {
    return game.i18n.localize("SHARDS.EffectCreator.MightyGripDesc");
  }
  if (key === "system.flags.undead") {
    return game.i18n.localize("SHARDS.EffectCreator.UndeadDesc");
  }
  return "";
}

/**
 * Classify an effect as buff, debuff, or neutral.
 * Respects manual override via flags["shards-of-mana"].effectType.
 * @param {ActiveEffect} effect
 * @returns {"buff"|"debuff"|"neutral"}
 */
function _classifyEffectType(effect) {
  // Manual override takes priority
  const manual = effect.flags?.["shards-of-mana"]?.effectType;
  if (manual === "buff" || manual === "debuff") return manual;

  // Check status conditions first
  if (effect.statuses?.size) {
    for (const statusId of effect.statuses) {
      if (NEGATIVE_SET.has(statusId)) return "debuff";
      if (POSITIVE_SET.has(statusId)) return "buff";
    }
  }

  // Classify by changes — positive stat bonuses = buff, negative = debuff
  if (effect.changes?.length) {
    let positive = 0;
    let negative = 0;
    for (const change of effect.changes) {
      // Condition resistances are booleans — "true" means immune (buff)
      if (change.key.startsWith("system.conditionResistances.")) {
        if (String(change.value) === "true") positive++;
        continue;
      }
      const val = Number(change.value);
      if (val === 0) continue;
      // Element resistances: + = more resistant (buff), - = more vulnerable (debuff)
      if (val > 0) positive++;
      else negative++;
    }
    if (positive > 0 && negative === 0) return "buff";
    if (negative > 0 && positive === 0) return "debuff";
  }

  return "neutral";
}

/**
 * Build a compact duration badge string for display on effect icons.
 * @param {ActiveEffect} effect
 * @returns {string|null} e.g. "3R", "2T", or null for permanent
 */
function _buildDurationBadge(effect) {
  if (!effect.isTemporary) return null;
  const d = effect.duration;
  if (d.rounds) return `${d.rounds}R`;
  if (d.turns) return `${d.turns}T`;
  if (d.seconds) return `${d.seconds}s`;
  return null;
}

/**
 * Transfer Active Effects from an effect-type item onto a target actor.
 * The item is NOT embedded — only its AEs are copied to the actor.
 * @param {Actor} actor - The receiving actor
 * @param {Item} effectItem - The effect-type item to transfer from
 * @returns {Promise<ActiveEffect[]|null>} Created effects or null
 */
export async function transferEffectItem(actor, effectItem) {
  const effectsData = effectItem.effects.map(ae => {
    const data = ae.toObject();
    delete data._id;
    return data;
  });
  if (!effectsData.length) {
    ui.notifications.warn(game.i18n.localize("SHARDS.EffectItem.NoEffects"));
    return null;
  }
  const created = await actor.createEmbeddedDocuments("ActiveEffect", effectsData);
  ui.notifications.info(game.i18n.format("SHARDS.EffectItem.Applied", {
    name: effectItem.name,
    count: effectsData.length
  }));
  return created;
}
