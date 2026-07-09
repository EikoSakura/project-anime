/**
 * Project: Anime — LEGACY auto-written Technique rules description (rules doc Version 2).
 *
 * ⚠ Retired as a live render path: descriptions are hand-authored Codex prose (helpers/prose.mjs),
 * locked behind the PF2e-style pencil editor. This module survives ONLY for the one-time
 * `proseDescriptionsV1` migration, which seeds a blank Technique's description from the last auto
 * write-up (as editable markup) so no existing content goes blank. Delete this file — and the
 * `PROJECTANIME.Skill.narr.*` lang block it reads — in a future dead-code sweep once worlds have
 * migrated. Do NOT import it anywhere else.
 *
 * Sentence templates live under `PROJECTANIME.Skill.narr.*`; per-effect-rule clauses come
 * from effects.mjs `narrateRule`.
 */
import {
  PROJECTANIME, modifierValue, skillEffectKeys, skillDieSpecs, rangeLabel, skillNeedsAccuracy,
  skillTarget, skillDuration, auraAudience, isSelfCenteredArea, techniqueEnergyCost, modifierTakes
} from "./config.mjs";
import { narrateRule, effectRules, bolsterHinderRules, hasAuthoredAttributeEffect } from "./effects.mjs";

const numSpan = (v) => `<span class="pa-rules-num">${v}</span>`;
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

/** The auto rules write-up for a Technique, as an HTML `<div class="skill-rules">`. "" otherwise. */
export function skillRulesHTML(item) {
  const sys = item?.system;
  if (!sys || item.type !== "skill") return "";
  const cfg = PROJECTANIME;
  const mods = sys.modifiers ?? [];
  const has = (m) => mods.includes(m);
  const mv = (k) => numSpan(modifierValue(item, k));
  const condLabel = (id) => { const c = (cfg.statusConditions ?? []).find((x) => x.id === id); return c ? loc(c.name) : id; };
  const poolName = (p) => loc(cfg.damagePools[p === "energy" ? "energy" : "hp"]);
  const totalCost = Number(sys.totalCost) || techniqueEnergyCost(sys);
  const isCompanion = sys.effect === "companion";
  const passive = sys.actionType === "passive" || isCompanion;

  // ---- Who/what the Technique hits (a noun, no preposition — clauses add "to" themselves).
  // The explicit Target (the free Target Modifiers) names the single-target noun; area
  // Modifiers keep their crowd nouns (the Target filters who the area catches at use). ----
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

  // ---- Core action clause(s), one per Strike/Heal slot (rules: Technique Damage / Heal):
  // a weapon-range Strike deals the weapon's Damage with Threshold; any other range marks 1
  // hit box, no Threshold. Heal clears 1 box of the pool chosen at creation. ----
  const core = [];
  let hasStrike = false;
  for (const ds of skillDieSpecs(sys)) {
    if (ds.effect === "strike") {
      hasStrike = true;
      core.push(scope === "weapon" ? N("strikeWeapon") : N("strikeBox", { n: numSpan(1) }));
    } else if (ds.effect === "mend") {
      core.push(N("mendBox", { n: numSpan(1), pool: poolName(ds.damagePool) }));
    }
  }

  // ---- Inline riders (woven into the lead sentence): the scaled movement/leap Modifiers. ----
  const riders = [];
  if (has("chain")) riders.push(N("chain", { n: mv("chain") }));
  if (has("move")) riders.push(N("move", { n: mv("move") }));
  if (has("reposition")) riders.push(N("reposition", { n: mv("reposition") }));

  // ---- Lead sentence: subject + the core predicate + any inline riders, joined naturally.
  // The legacy always-on "None" carrier has no action of its own — its Modifiers carry it. ----
  const subject = hasStrike ? N("subjAttack") : N("subjSkill");
  const firstPred = core.length ? `${joinClauses(core)} ${N("toTarget", { target })}` : N("affects", { target });
  const sentences = (sys.effect === "passive" && sys.actionType === "passive")
    ? [N("passiveCarrier")]
    : [`${subject} ${joinClauses([firstPred, ...riders])}.`];

  // ---- The V2 Effect catalog — one doc-literal line per Effect slot. Empower / Weaken /
  // Transform read through the attribute narration below (their picks drive the exact text). ----
  for (const eff of skillEffectKeys(sys)) {
    switch (eff) {
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
      case "sense":
        sentences.push(N("sense", { n: numSpan(cfg.inherentRangeTiles?.sense ?? 5) }));
        break;
      case "steal":
        sentences.push(N("steal"));
        break;
      case "telepathy":
        sentences.push(N("telepathy"));
        break;
      case "vanish":
        sentences.push(N("vanish"));
        break;
      case "hinder":
        // Weaken is contested by a non-willing creature (rules: Opposing Techniques).
        sentences.push(N("contests"));
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
  // Auto Empower/Weaken/Transform: the Attribute steps the Technique applies (synthesized when
  // the designer didn't author their own attribute effect) read like authored buffs/debuffs.
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
  // The Inflict Modifiers' chosen Statuses (a Cursed Severe names its blocked pool inline);
  // a still-unchosen Inflict falls back to the generic placeholder.
  if (has("inflict")) {
    if (sys.inflictStatus) targetStatuses.push(condLabel(sys.inflictStatus));
    else if (!targetStatuses.length) targetStatuses.push(N("aStatus"));
  }
  if (has("inflictSevere") && sys.inflictSevereStatus) {
    const poolSuffix = (cfg.poolChoiceStatuses ?? []).includes(sys.inflictSevereStatus)
      ? ` (${poolName(sys.inflictPool)})` : "";
    targetStatuses.push(condLabel(sys.inflictSevereStatus) + poolSuffix);
  }

  if (effectClauses.length) sentences.push(N("alsoEffects", { effects: joinClauses(effectClauses) }));
  // "On a hit…" whenever the Technique rolls to hit; a self/ally Technique simply applies.
  if (targetStatuses.length) sentences.push(N(skillNeedsAccuracy(sys) ? "onHit" : "applyTarget", { status: boldList(targetStatuses) }));
  if ((has("inflict") || has("inflictSevere")) && targetStatuses.length) {
    sentences.push(N("inflictLasts", { n: numSpan(2) }));
  }
  if (selfStatuses.length) sentences.push(N("youGain", { status: boldList(selfStatuses) }));

  // ---- Stand-alone Modifier sentences (V2 catalog). ----
  if (has("analyze")) {
    sentences.push(N("analyze", { category: `<strong>${loc(cfg.analyzeCategories[sys.analyzeCategory] ?? "")}</strong>` }));
  }
  if (has("barrier")) sentences.push(N("barrier", { n: numSpan(totalCost) }));
  if (has("charge")) sentences.push(N("charge"));
  if (has("cleanse")) sentences.push(N("cleanse"));
  if (has("cover")) sentences.push(N("cover"));
  if (has("custom")) sentences.push(N("customMod"));
  if (has("devour")) sentences.push(N("devour"));
  if (has("disarm")) sentences.push(N("disarm"));
  if (has("drain")) sentences.push(N("drain", { n: numSpan(1), pool: poolName(sys.drainPool) }));
  if (has("link")) sentences.push(N("link"));
  if (has("manifest")) {
    // Name the bound Passive when the Technique lives on an actor that still knows it.
    const bound = item?.actor?.items?.get?.(sys.manifestSkillId);
    sentences.push(bound ? N("manifestNamed", { name: `<strong>${bound.name}</strong>` }) : N("manifest"));
  }
  if (has("nullify")) sentences.push(N("nullify"));
  if (has("potent")) sentences.push(N("potent", { n: numSpan(modifierTakes("potent", sys)) }));
  if (has("protection")) sentences.push(N("protection", { n: numSpan("+" + (cfg.protectionGuard ?? 1)) }));
  if (has("reequip")) sentences.push(N("reequip"));
  if (has("reflect")) sentences.push(N("reflect"));
  if (has("regen")) sentences.push(N("regen", { n: numSpan(cfg.regenHeal ?? 1) }));
  if (has("retaliation")) sentences.push(N("retaliation", { dmg: numSpan(cfg.retaliationDamage ?? 1) }));
  if (has("waypoint")) sentences.push(N("waypoint"));

  // ---- Closing: duration / Energy / Aura field / React trigger / per-Conflict limit. ----
  // Duration: Channeled always announces its upkeep; Scene / Standard only when the Technique
  // leaves something behind to time — an instant Strike doesn't need "lasts 2 rounds" noise.
  // A Standing Passive has no Duration (it waits on its condition); a Sustained one is always
  // active, so its Duration line is skipped too.
  if (!passive) {
    const LASTING_EFFECTS = [...(cfg.durationEffects ?? []), "illusion", "gate", "conjure"];
    const LASTING_MODS = ["protection", "regen", "retaliation", "barrier", "aura", "infuse"];
    const lasting = skillEffectKeys(sys).some((e) => LASTING_EFFECTS.includes(e))
      || (item.effects ?? []).some((e) => !e.disabled && effectRules(e).length)
      || LASTING_MODS.some((m) => has(m));
    const dur = skillDuration(sys);
    if (dur === "channeled") sentences.push(N("channeledLine", { n: numSpan(1) }));
    else if (lasting && dur === "scene") sentences.push(N("sceneLine"));
    else if (lasting && dur === "standard") sentences.push(N("durationTurns", { n: numSpan(sys.effectDuration ?? cfg.standardDurationTurns) }));
  }
  // Energy: a Passive LOCKS boxes equal to its total cost (Companion's lock lifts at home);
  // an Action/React pays per use.
  if (isCompanion) sentences.push(N("companionLock", { n: numSpan(totalCost) }));
  else if (passive) sentences.push(N(sys.passiveMode === "standing" ? "passiveStanding" : "passiveSustained", { n: numSpan(totalCost) }));
  else if (Number(sys.energyCost) > 0) sentences.push(N("costs", { n: numSpan(sys.energyCost) }));
  // Aura: the field applies the Technique's effect(s) to its audience nearby — the Target
  // decides who (Ally → you and allies; Foe → enemies only, never you; Any → everyone).
  if (has("aura")) {
    const audience = auraAudience(sys);
    const key = audience === "foe" ? "auraLineEnemy" : audience === "any" ? "auraLineAny" : "auraLineAlly";
    sentences.push(N(key, { n: numSpan(modifierValue(item, "aura")) }));
  }
  if (sys.actionType === "react" && sys.trigger) sentences.push(N("reactLine", { trigger: `<strong>${loc(cfg.triggers[sys.trigger] ?? "") || foundry.utils.escapeHTML(sys.trigger)}</strong>` }));
  if (Number(sys.usesPerConflict) > 0) sentences.push(N("perConflict", { n: numSpan(sys.usesPerConflict) }));

  return `<div class="skill-rules"><p>${sentences.join(" ")}</p></div>`;
}


/** The auto rules rendered as editable Codex-prose markup (the migration seed): highlight
 *  spans become `…`/~…~ markers, everything else drops to plain text. "" when nothing to seed. */
export function autoRulesToMarkup(item) {
  const html = skillRulesHTML(item);
  if (!html) return "";
  return html
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<span class="pa-rules-improve">([\s\S]*?)<\/span>/gi, (_m, t) => `~${t}~`)
    .replace(/<span class="pa-rules-num">([\s\S]*?)<\/span>/gi, (_m, t) => "`" + t + "`")
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, (_m, t) => "`" + t + "`")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim();
}
