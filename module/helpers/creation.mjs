/**
 * Project: Anime — Character-Creation configuration accessors.
 *
 * A GM-configurable world setting that tunes the step-by-step Character Creator:
 * the number of free Attribute Step-Ups and the optional creation Choices
 * (Race/Class/… Packages). Edited through apps/creation-config.mjs (a
 * Configure-Settings menu); these accessors return the active config, falling
 * back to the rulebook defaults until the world customizes it.
 *
 * Kept free of any ApplicationV2 import (like bio-fields.mjs vs bio-field-config.mjs)
 * so non-app modules can read the config without pulling in an app.
 */

/** World-setting key (under the "project-anime" namespace). */
export const CREATION_SETTING = "characterCreation";

/** Rulebook defaults — five Step-Ups (rules: Set Attributes). `choices` is empty by
 *  default: the GM opts into the creation Choose step by adding choices (Race/Class/…),
 *  each offering Package options that grant abilities for free. */
export function defaultCreationConfig() {
  return { stepUps: 5, choices: [] };
}

/**
 * Coerce stored creation Choices into clean entries. Each choice offers Package options;
 * `single` = pick exactly one, `pickN` = pick up to `n`. Options reference a Package by
 * uuid (label + img cached at author time so the creator needn't resolve them to render).
 */
export function normalizeChoices(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    let id = String(c.id ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
    if (!id) id = `choice${out.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const options = (Array.isArray(c.options) ? c.options : [])
      .map((o) => ({ uuid: String(o?.uuid ?? "").trim(), label: String(o?.label ?? "").trim(), img: String(o?.img ?? "").trim() }))
      .filter((o) => o.uuid);
    out.push({
      id,
      label: String(c.label ?? "").trim() || id,
      mode: c.mode === "pickN" ? "pickN" : "single",
      n: Math.max(1, Math.round(Number(c.n) || 1)),
      options
    });
  }
  return out;
}

const toInt = (v, fallback) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : fallback);

/** The active creation config — the GM's setting merged over the defaults. */
export function getCreationConfig() {
  const d = defaultCreationConfig();
  let stored = null;
  try {
    stored = game.settings.get("project-anime", CREATION_SETTING);
  } catch (_e) {
    /* setting not registered yet (very early) — use defaults */
  }
  const c = stored && typeof stored === "object" ? { ...d, ...stored } : d;
  c.stepUps = toInt(c.stepUps, d.stepUps);
  c.choices = normalizeChoices(c.choices);
  return c;
}
