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
import { PROJECTANIME, modifierValue, skillEffectKeys, skillDieSpecs, rangeLabel, skillNeedsAccuracy } from "./config.mjs";
import { narrateRule, effectRules } from "./effects.mjs";
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

  // ---- Who/what the Skill hits (a noun, no preposition — clauses add "to" themselves). ----
  const scope = sys.range?.scope;
  let target;
  if (has("burst")) target = N("everyone", { n: mv("burst") });
  else if (has("line")) target = N("line");
  else if (has("mass")) target = N("mass");
  else if (scope === "self") target = N("targetSelf");
  else if (scope === "weapon") target = N("targetWeapon");
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

  // ---- Lead sentence: subject + the core predicate + any inline riders, joined naturally
  // ("This attack deals d8 fire damage to a target within Near and pushes the target 2 spaces away.")
  const subject = hasStrike ? N("subjAttack") : N("subjSkill");
  const firstPred = core.length ? `${joinClauses(core)} ${N("toTarget", { target })}` : N("affects", { target });
  const sentences = [`${subject} ${joinClauses([firstPred, ...riders])}.`];

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
  // The generic Inflict modifier adds an (unspecified) target status when none is authored on an effect.
  if (has("inflict") && !targetStatuses.length) targetStatuses.push(N("aStatus"));

  if (effectClauses.length) sentences.push(N("alsoEffects", { effects: joinClauses(effectClauses) }));
  // "On a hit…" whenever the Skill rolls an Accuracy Check (Strike or an enemy debuff like Hinder);
  // a self/ally Skill simply "applies …" with no roll.
  if (targetStatuses.length) sentences.push(N(skillNeedsAccuracy(sys) ? "onHit" : "applyTarget", { status: boldList(targetStatuses) }));
  if (selfStatuses.length) sentences.push(N("youGain", { status: boldList(selfStatuses) }));

  // ---- Stand-alone modifier sentences. ----
  if (has("drainHP")) sentences.push(N("drainHP"));
  if (has("drainEnergy")) sentences.push(N("drainEnergy"));
  if (has("decay")) sentences.push(N("decay", { dmg: numSpan(1), turns: numSpan(3) }));
  if (has("cleanse")) sentences.push(N("cleanse"));
  if (has("charge")) sentences.push(N("charge"));
  if (has("reflect")) sentences.push(N("reflect"));

  // ---- Closing: action economy / Energy / React trigger. ----
  if (sys.actionType === "passive") sentences.push(N("passiveLine"));
  else if (Number(sys.energyCost) > 0) sentences.push(N("costs", { n: numSpan(sys.energyCost) }));
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
