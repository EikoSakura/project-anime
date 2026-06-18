/**
 * Project: Anime — auto-written Skill rules description.
 *
 * Turns a Skill's mechanics + Active Effects into a FLOWING PARAGRAPH that reads like a real game
 * description ("This attack deals d8 fire damage to a target within Near, pushing the target 2
 * spaces away. Costs 4 Energy."). Plain numbers (dice, ranges, Energy, modifier values) are wrapped
 * in `.pa-rules-num`; SP-bought IMPROVEMENTS (Sharpen Accuracy/Damage, Lower Energy) in
 * `.pa-rules-improve` — so both pop out. Shown on the Skill's sheet (View tab) and its chat card;
 * the typed `system.description` stays FLAVOR, and an optional `system.rulesOverride` replaces this
 * auto text. Pure + synchronous — safe during render. Sentence templates live under
 * `PROJECTANIME.Skill.narr.*`; per-effect-rule clauses come from effects.mjs `narrateRule`.
 */
import { PROJECTANIME, modifierValue, skillEffectKeys, skillDieSpecs, rangeLabel, skillNeedsAccuracy, skillTarget, skillDuration, skillEvasionAttr, skillEvasionKeys, skillEvasionLabel, auraAudience, isSelfCenteredArea } from "./config.mjs";
import { narrateRule, effectRules, bolsterHinderRules, hasAuthoredAttributeEffect, hinderStatusIds } from "./effects.mjs";
import { elementLabel } from "./elements.mjs";

const numSpan = (v) => `<span class="pa-rules-num">${v}</span>`;
const impSpan = (v) => `<span class="pa-rules-improve">${v}</span>`;
const loc = (k, d) => (k ? (d ? game.i18n.format(k, d) : game.i18n.localize(k)) : "");
/** Localize/format a `PROJECTANIME.Skill.narr.*` template. */
const N = (k, d) => loc(`PROJECTANIME.Skill.narr.${k}`, d);

/** Wrap dice (d8), signed integers, and percents in the number color. Plain text only. */
function colorizeNumbers(s) {
  return String(s ?? "").replace(/(\bd\d+\b|[+\-−]?\d+%?)/g, (m) => numSpan(m));
}

/** Join clauses naturally: "a", "a and b", "a, b, and c". */
function joinClauses(arr) {
  const a = arr.filter(Boolean);
  if (a.length <= 1) return a.join("");
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`;
}

/** Bold + naturally-join a list of status names. */
function boldList(arr) {
  return joinClauses(arr.map((s) => `<strong>${s}</strong>`));
}

/** The auto rules write-up for a Skill, as an HTML `<div class="skill-rules">`. "" for non-Skills. */
export function skillRulesHTML(item) {
  const sys = item?.system;
  if (!sys || item.type !== "skill") return "";
  const cfg = PROJECTANIME;
  const mods = sys.modifiers ?? [];
  const has = (m) => mods.includes(m);
  const actor = item.actor ?? null;
  const attrName = (slot) => loc(cfg.attributes[sys.attributes?.[slot]] ?? "");
  // The damage/heal amount: the resolved die size if on an actor, else "your <Attr> die".
  const dmgAmount = (slot) => {
    const size = actor?.system?.attributes?.[sys.attributes?.[slot]]?.value;
    return size ? numSpan("d" + size) : N("yourDie", { attr: `<strong>${attrName(slot)}</strong>` });
  };
  const mv = (k) => numSpan(modifierValue(item, k));
  const condLabel = (id) => { const c = (cfg.statusConditions ?? []).find((x) => x.id === id); return c ? loc(c.name) : id; };

  // ---- Who/what the Skill hits (a noun, no preposition — clauses add "to" themselves). The
  // explicit Target (rules v0.01) names the single-target noun: "an enemy" / "an ally (not
  // yourself)" / "a creature"; area Skills keep their crowd nouns (the Target already filters
  // who the area catches at use). ----
  const scope = sys.range?.scope;
  const tgt = skillTarget(sys);
  let target;
  if (has("burst")) target = N(isSelfCenteredArea(sys) ? "everyoneSelf" : "everyone", { n: mv("burst") });
  else if (has("line")) target = N("line");
  else if (has("mass")) target = N("mass");
  else if (scope === "self" || tgt === "self") target = N("targetSelf");
  else if (scope === "weapon") target = N("targetWeapon");
  else if (tgt === "foe") target = N("targetFoe", { range: colorizeNumbers(rangeLabel(sys.range)) });
  else if (tgt === "ally") target = N("targetAlly", { range: colorizeNumbers(rangeLabel(sys.range)) });
  else target = N("targetWithin", { range: colorizeNumbers(rangeLabel(sys.range)) });

  // ---- Core action clause(s): one per die-Effect slot (Strike → damage, Mend → healing). ----
  const core = [];
  let hasStrike = false;
  for (const ds of skillDieSpecs(sys)) {
    if (ds.effect === "strike") {
      hasStrike = true;
      const t = ds.damageType ? elementLabel(ds.damageType) : "";
      core.push(t ? N("deals", { dmg: dmgAmount(ds.damageAttr), type: t }) : N("dealsPlain", { dmg: dmgAmount(ds.damageAttr) }));
    } else if (ds.effect === "mend") {
      core.push(N("restores", { dmg: dmgAmount(ds.damageAttr) }));
    }
  }

  // ---- Inline attack riders (woven into the lead sentence). ----
  const riders = [];
  if (has("pierce")) riders.push(N("pierce"));
  if (has("push")) riders.push(N("push", { n: mv("push") }));
  if (has("pull")) riders.push(N("pull", { n: mv("pull") }));
  if (has("chain")) riders.push(N("chain", { n: mv("chain") }));
  // The Move Modifier repositions the target up to the Skill's Rank in tiles (grown by Tune a
  // Modifier), in a direction the user chooses — its value reads like Push/Pull's.
  if (has("move")) riders.push(N("moveMod", { n: mv("move") }));

  // ---- Lead sentence: subject + the core predicate + any inline riders, joined naturally
  // ("This attack deals d8 fire damage to a target within Near and pushes the target 2 spaces away.")
  // The Passive carrier Effect (rules v0.01) has no action of its own — its lead just says its
  // Modifiers run continuously; their stand-alone sentences below carry the substance.
  const subject = hasStrike ? N("subjAttack") : N("subjSkill");
  const firstPred = core.length ? `${joinClauses(core)} ${N("toTarget", { target })}` : N("affects", { target });
  const sentences = sys.effect === "passive"
    ? [N("passiveCarrier")]
    : [`${subject} ${joinClauses([firstPred, ...riders])}.`];

  // ---- Rules text for the v0.01 Effect catalog — one sentence block per Effect slot. These are
  // the doc's own mechanics, condensed; the numbers that scale (Animate's Energy locks, Steal's
  // rank gate) read from the Skill so the text is always current. ----
  for (const eff of skillEffectKeys(sys)) {
    switch (eff) {
      case "animate": {
        const cost = Number(sys.energyCost) || 0;
        const lock = (mult) => numSpan(Math.max(1, Math.floor(cost * mult)));
        sentences.push(N("animate"));
        sentences.push(N("animateTiers", { minion: lock(0.5), standard: lock(1), elite: lock(2), solo: lock(3) }));
        break;
      }
      case "companion":
        sentences.push(N("companion"));
        break;
      case "conjure":
        sentences.push(N("conjure"));
        break;
      case "disguise":
        sentences.push(N("disguise"));
        break;
      case "elementalControl": {
        // The element is free text (any element the player imagined, untied to the Damage Types).
        const el = (sys.controlElement ?? "").trim();
        sentences.push(el ? N("elementalControlTyped", { element: `<strong>${foundry.utils.escapeHTML(el)}</strong>` }) : N("elementalControl"));
        break;
      }
      case "gate":
        sentences.push(N("gate"));
        break;
      case "illusion":
        sentences.push(N("illusion"));
        break;
      case "steal":
        sentences.push((Number(sys.rank) || 1) >= 3 ? N("stealEquipped") : N("steal"));
        break;
      case "telepathy":
        sentences.push(N("telepathy"));
        break;
      case "vanish":
        sentences.push(N("vanish"));
        break;
      case "sense":
        // The doc's anti-Vanish clause rides every Sense Skill.
        sentences.push(N("senseVanish"));
        break;
    }
  }

  // ---- Active Effects: split conditions (by scope) from buffs/debuffs (narrateRule). ----
  const effectClauses = [];
  const targetStatuses = [];
  const selfStatuses = [];
  for (const e of item.effects ?? []) {
    if (e.disabled) continue;
    const perEffect = [];
    for (const rule of effectRules(e)) {
      if (rule?.type === "condition") {
        if (rule.status) (rule.scope === "target" ? targetStatuses : selfStatuses).push(condLabel(rule.status));
        continue;
      }
      const phrase = narrateRule(rule);
      if (phrase) perEffect.push(colorizeNumbers(phrase));
    }
    if (perEffect.length) {
      let clause = joinClauses(perEffect);
      if (e.isTemporary && e.duration?.label) clause += ` ${N("forDuration", { duration: colorizeNumbers(e.duration.label) })}`;
      effectClauses.push(clause);
    }
  }
  // Auto Bolster/Hinder: the Attribute changes the Skill raises/lowers (synthesized when the
  // designer didn't author their own attribute effect) read like authored buffs/debuffs.
  if (!hasAuthoredAttributeEffect(item)) {
    const auto = [];
    for (const mode of skillEffectKeys(sys)) {
      for (const rule of bolsterHinderRules(item, mode)) {
        const phrase = narrateRule(rule);
        if (phrase) auto.push(colorizeNumbers(phrase));
      }
    }
    if (auto.length) effectClauses.push(joinClauses(auto));
  }
  // A Hinder Skill's chosen Statuses are inflicted on a hit (its built-in counterpart to Inflict).
  for (const id of hinderStatusIds(item)) targetStatuses.push(condLabel(id));
  // The Inflict Modifier's chosen Status (Lingering gets its own damage sentence below); a still-
  // unchosen Inflict falls back to the generic placeholder.
  if (has("inflict") && sys.inflictStatus !== "decay") {
    if (sys.inflictStatus) {
      // A pool-choice Status (Barrier/Regen, or a Curse that blocks one pool's recovery) names
      // the chosen Hit Points / Energy pool inline.
      const poolSuffix = (cfg.poolChoiceStatuses ?? []).includes(sys.inflictStatus)
        ? ` (${loc(cfg.damagePools[sys.inflictPool === "energy" ? "energy" : "hp"])})` : "";
      targetStatuses.push(condLabel(sys.inflictStatus) + poolSuffix);
    } else if (!targetStatuses.length) targetStatuses.push(N("aStatus"));
  }

  if (effectClauses.length) sentences.push(N("alsoEffects", { effects: joinClauses(effectClauses) }));
  // Skill Evasion (rules v0.01): the defender rebuilds Evasion around the named Attribute — for
  // a pair ("Mind or Charm"), around whichever of the two is better.
  const seAttr = skillEvasionAttr(sys);
  if (seAttr && skillNeedsAccuracy(sys)) {
    const key = skillEvasionKeys(seAttr).length > 1 ? "skillEvasionLinePair" : "skillEvasionLine";
    sentences.push(N(key, { attr: `<strong>${skillEvasionLabel(seAttr)}</strong>` }));
  }
  // "On a hit…" whenever the Skill rolls an Accuracy Check (Strike or an enemy debuff like Weaken);
  // a self/ally Skill simply "applies …" with no roll.
  if (targetStatuses.length) sentences.push(N(skillNeedsAccuracy(sys) ? "onHit" : "applyTarget", { status: boldList(targetStatuses) }));
  if (selfStatuses.length) sentences.push(N("youGain", { status: boldList(selfStatuses) }));

  // ---- Stand-alone modifier sentences. A PASSIVE drain rides the bearer's basic attacks
  // (rules: "If this Skill is Passive, your basic attacks gain this effect"). ----
  const passiveDrain = sys.actionType === "passive";
  if (has("drainHP")) sentences.push(N(passiveDrain ? "drainHPPassive" : "drainHP"));
  if (has("drainEnergy")) sentences.push(N(passiveDrain ? "drainEnergyPassive" : "drainEnergy"));
  if (has("inflict") && sys.inflictStatus === "decay") {
    const decayEl = sys.decayType ? elementLabel(sys.decayType) : "";
    sentences.push(decayEl
      ? N("decayTyped", { dmg: numSpan(1), element: `<strong>${decayEl}</strong>` })
      : N("decay", { dmg: numSpan(1) }));
  }
  if (has("cleanse")) sentences.push(N("cleanse"));
  if (has("charge")) sentences.push(N("charge"));
  if (has("protection")) sentences.push(N("protection", { n: numSpan("+" + modifierValue(item, "protection")) }));
  // The Affinity Modifiers are multi-take — one granted-affinity sentence per take.
  if (has("affinityDamage")) {
    for (const t of sys.affinityDamages ?? []) {
      if (!t?.type) continue;
      sentences.push(N("affinityGrant", {
        thing: `<strong>${elementLabel(t.type)}</strong>`,
        level: `<strong>${loc(cfg.affinityLevels[t.level] ?? "")}</strong>`
      }));
    }
  }
  // Status affinities only ever grant Immune (no Resist/Absorb ladder).
  if (has("affinityStatus")) {
    for (const id of sys.affinityStatusIds ?? []) {
      if (!id) continue;
      sentences.push(N("affinityGrant", {
        thing: `<strong>${condLabel(id)}</strong>`,
        level: `<strong>${loc(cfg.affinityLevels.immune)}</strong>`
      }));
    }
  }
  if (has("analyze")) {
    sentences.push(N("analyze", { category: `<strong>${loc(cfg.analyzeCategories[sys.analyzeCategory] ?? "")}</strong>` }));
  }
  if (has("banish")) sentences.push(N("banish"));
  if (has("infuse")) {
    const thing = sys.infuseKind === "status"
      ? (sys.infuseStatus ? condLabel(sys.infuseStatus) : loc(cfg.infuseKinds.status))
      : (sys.infuseElement ? elementLabel(sys.infuseElement) : loc(cfg.infuseKinds.element));
    sentences.push(N("infuse", { thing: `<strong>${thing}</strong>` }));
  }
  if (has("manifest")) sentences.push(N("manifest"));
  if (has("nullify")) sentences.push(N("nullify"));
  if (has("reequip")) sentences.push(N(sys.reequipHeavy ? "reequipHeavy" : "reequip"));

  // ---- Closing: duration / action economy / Energy / Aura field / React trigger. ----
  // Duration (rules v0.01): Channeled always announces its upkeep; Scene / Standard only when the
  // Skill leaves something behind to time (an attribute change, authored effects, or an aura) —
  // an instant Strike doesn't need "lasts 2 turns" noise.
  if (sys.actionType !== "passive" && sys.effect !== "passive") {
    const LASTING_EFFECTS = ["bolster", "hinder", "transform", "vanish", "disguise", "illusion", "telepathy", "gate", "conjure"];
    const lasting = skillEffectKeys(sys).some((e) => LASTING_EFFECTS.includes(e))
      || (item.effects ?? []).some((e) => !e.disabled && effectRules(e).length) || has("aura");
    const dur = skillDuration(sys);
    if (dur === "channeled") sentences.push(N("channeledLine", { n: numSpan(1) }));
    else if (lasting && dur === "scene") sentences.push(N("sceneLine"));
    else if (lasting && dur === "standard") sentences.push(N("durationTurns", { n: numSpan(sys.effectDuration ?? cfg.standardDurationTurns) }));
  }
  if (sys.actionType === "passive") sentences.push(N("passiveLine", { n: numSpan(sys.passiveEnergyTax ?? Math.floor((Number(sys.baseEnergy) || 0) / 2)) }));
  else if (Number(sys.energyCost) > 0) sentences.push(N("costs", { n: numSpan(sys.energyCost) }));
  // Aura: the field applies the Skill's effect(s) to its audience nearby — the Skill's Target
  // decides who (Ally → you and allies; Foe → enemies only, never you; Any → everyone).
  if (has("aura")) {
    const audience = auraAudience(sys);
    const key = audience === "foe" ? "auraLineEnemy" : audience === "any" ? "auraLineAny" : "auraLineAlly";
    sentences.push(N(key, { n: numSpan(modifierValue(item, "aura")) }));
  }
  if (sys.actionType === "react" && sys.trigger) sentences.push(N("reactLine", { trigger: `<strong>${loc(cfg.triggers[sys.trigger])}</strong>` }));

  // ---- Improvements (SP-bought refinements), as a trailing line in the improvement color. ----
  const imps = [];
  if (sys.accuracyMod) imps.push(`${loc("PROJECTANIME.Skill.field.accuracyMod")} ${impSpan("+" + sys.accuracyMod)}`);
  if (sys.damageMod && cfg.dieEffects.includes(sys.effect)) {
    imps.push(`${loc(sys.effect === "mend" ? "PROJECTANIME.Skill.field.healMod" : "PROJECTANIME.Skill.field.damageMod")} ${impSpan("+" + sys.damageMod)}`);
  }
  if (sys.energyReduction) imps.push(`${loc("PROJECTANIME.Skill.auto.energyLowered")} ${impSpan("−" + sys.energyReduction)}`);

  let html = `<p>${sentences.join(" ")}</p>`;
  if (imps.length) html += `<p class="pa-rules-improve-line">${N("improved", { list: imps.join(", ") })}</p>`;
  return `<div class="skill-rules">${html}</div>`;
}
