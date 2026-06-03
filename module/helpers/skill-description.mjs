/**
 * Project: Anime — auto-written Skill rules description.
 *
 * Builds a human-readable, COLORED rules summary from a Skill's mechanics + Active Effects so a
 * player never has to write the rules by hand. Plain numbers (dice, ranges, Energy, modifier
 * values, effect values) are wrapped in `.pa-rules-num`; SP-bought IMPROVEMENTS (Sharpen
 * Accuracy/Damage, Lower Energy, a tuned modifier above its base) in `.pa-rules-improve` — so both
 * pop out of the prose. Shown on the Skill's sheet (View tab) and its chat card; the player's typed
 * `system.description` stays as FLAVOR, and an optional `system.rulesOverride` replaces this auto
 * text. Pure + synchronous (reads only in-memory data) — safe to call during render.
 */
import { PROJECTANIME, modifierValue, skillEffectKeys, rangeLabel } from "./config.mjs";
import { summarizeRules } from "./effects.mjs";
import { elementLabel } from "./elements.mjs";

const L = (k, data) => (k ? (data ? game.i18n.format(k, data) : game.i18n.localize(k)) : "");
const numSpan = (v) => `<span class="pa-rules-num">${v}</span>`;
const impSpan = (v) => `<span class="pa-rules-improve">${v}</span>`;

/** Wrap dice (d8), signed/unsigned integers, and percents in the number color. Operates on PLAIN
 *  text only (localized descriptions / rule summaries) — never on HTML we've already built. */
function colorizeNumbers(s) {
  return String(s ?? "").replace(/(\bd\d+\b|[+\-−]?\d+%?)/g, (m) => numSpan(m));
}

/**
 * The auto rules write-up for a Skill, as an HTML string (a `<div class="skill-rules">`). Returns
 * "" for a non-Skill. Callers decide override-vs-auto; this always produces the AUTO text.
 */
export function skillRulesHTML(item) {
  const sys = item?.system;
  if (!sys || item.type !== "skill") return "";
  const cfg = PROJECTANIME;
  const lines = [];

  // --- Lead: action type · rank · Energy (or "Always active" for a Passive). ---
  const rank = cfg.skillRanks[sys.rank] ?? {};
  const bits = [L(cfg.actionTypes[sys.actionType])];
  if (rank.label) bits.push(`${rank.stars ?? ""} ${L(rank.label)}`.trim());
  if (sys.actionType === "passive") bits.push(L("PROJECTANIME.Skill.auto.alwaysActive"));
  else if (Number(sys.energyCost) > 0) bits.push(`${numSpan(sys.energyCost)} ${L("PROJECTANIME.Stat.energy")}`);
  lines.push(`<p class="pa-rules-lead">${bits.filter(Boolean).join(" · ")}</p>`);

  if (sys.actionType === "react" && sys.trigger) {
    lines.push(`<p>${L("PROJECTANIME.Skill.field.trigger")}: <strong>${L(cfg.triggers[sys.trigger])}</strong></p>`);
  }

  // --- One rules sentence per Effect slot (reuses the authored effectDesc copy). ---
  for (const eff of skillEffectKeys(sys)) {
    const name = L(cfg.skillEffects[eff]);
    const desc = L(`PROJECTANIME.Skill.effectDesc.${eff}`);
    lines.push(desc ? `<p><strong>${name}.</strong> ${colorizeNumbers(desc)}</p>` : `<p><strong>${name}.</strong></p>`);
  }

  // --- Specs: range · accuracy pair · damage/heal die (its size if the Skill is on an actor). ---
  const attrName = (slot) => L(cfg.attributes[sys.attributes?.[slot]] ?? "");
  const specs = [
    `${L("PROJECTANIME.Skill.field.range")}: ${colorizeNumbers(rangeLabel(sys.range))}`,
    `${L("PROJECTANIME.Skill.auto.accuracy")}: ${attrName("attrA")} + ${attrName("attrB")}`
  ];
  if (cfg.dieEffects.includes(sys.effect)) {
    const dieKey = sys.effect === "mend" ? "PROJECTANIME.Skill.field.healDie" : "PROJECTANIME.Skill.field.damageDie";
    let dieTxt = `${L(dieKey)}: ${attrName(sys.damageAttr)}`;
    const dieSize = item.actor?.system?.attributes?.[sys.attributes?.[sys.damageAttr]]?.value;
    if (dieSize) dieTxt += ` (${numSpan("d" + dieSize)})`;
    if (sys.damageType && cfg.damageEffects.includes(sys.effect)) dieTxt += ` · ${elementLabel(sys.damageType)}`;
    specs.push(dieTxt);
  }
  lines.push(`<p class="pa-rules-specs">${specs.join(" · ")}</p>`);

  // --- Improvements (SP-bought refinements), called out in the improvement color. ---
  const imps = [];
  if (sys.accuracyMod) imps.push(`${L("PROJECTANIME.Skill.field.accuracyMod")} ${impSpan("+" + sys.accuracyMod)}`);
  if (sys.damageMod && cfg.dieEffects.includes(sys.effect)) {
    imps.push(`${L(sys.effect === "mend" ? "PROJECTANIME.Skill.field.healMod" : "PROJECTANIME.Skill.field.damageMod")} ${impSpan("+" + sys.damageMod)}`);
  }
  if (sys.energyReduction) imps.push(`${L("PROJECTANIME.Skill.auto.energyLowered")} ${impSpan("−" + sys.energyReduction)}`);
  if (imps.length) lines.push(`<p class="pa-rules-improve-line">${L("PROJECTANIME.Skill.auto.improvements")}: ${imps.join(" · ")}</p>`);

  // --- Modifiers: a tuned (grown-above-base) value shows in the improvement color. ---
  const modLines = [];
  for (const key of sys.modifiers ?? []) {
    const label = L(cfg.skillModifiers[key]) || key;
    const g = cfg.growableModifiers?.[key];
    if (g) {
      const val = modifierValue(item, key);
      const valHtml = val > (g.base ?? 0) ? impSpan(val) : numSpan(val);
      modLines.push(`<strong>${label}:</strong> ${valHtml} ${L(g.unit)}`);
    } else {
      modLines.push(`<strong>${label}.</strong> ${colorizeNumbers(L(`PROJECTANIME.Skill.modifierDesc.${key}`))}`);
    }
  }
  if (modLines.length) {
    lines.push(`<div class="pa-rules-group"><div class="pa-rules-h">${L("PROJECTANIME.Skill.field.modifiers")}</div><ul>${modLines.map((m) => `<li>${m}</li>`).join("")}</ul></div>`);
  }

  // --- Active Effects: each enabled effect's no-code rules, numbers colored, + any duration. ---
  const aeLines = [];
  for (const e of item.effects ?? []) {
    if (e.disabled) continue;
    const sums = summarizeRules(e);
    if (!sums.length) continue;
    let line = `<strong>${e.name}.</strong> ${sums.map(colorizeNumbers).join("; ")}`;
    if (e.isTemporary && e.duration?.label) line += ` (${colorizeNumbers(e.duration.label)})`;
    aeLines.push(line);
  }
  if (aeLines.length) {
    lines.push(`<div class="pa-rules-group"><div class="pa-rules-h">${L("PROJECTANIME.Skill.auto.effects")}</div><ul>${aeLines.map((m) => `<li>${m}</li>`).join("")}</ul></div>`);
  }

  return `<div class="skill-rules">${lines.join("")}</div>`;
}
