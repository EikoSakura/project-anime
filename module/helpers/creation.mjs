/**
 * Project: Anime — Character-Creation configuration accessors.
 *
 * A GM-configurable world setting that tunes the step-by-step Character Creator:
 * the starting Skill Points, the number of free Attribute Step-Ups, the Gold
 * budget, which Item types may be purchased, and WHICH compendium packs the gear
 * shop draws from. Edited through apps/creation-config.mjs (a Configure-Settings
 * menu); these accessors return the active config, falling back to the rulebook
 * defaults until the world customizes it.
 *
 * Kept free of any ApplicationV2 import (like elements.mjs vs element-config.mjs)
 * so the data models can read the starting Skill Points without pulling in an app.
 */

/** World-setting key (under the "project-anime" namespace). */
export const CREATION_SETTING = "characterCreation";

/** Item types a character may purchase at creation by default (rules p.6 — no accessories). */
export const DEFAULT_SHOP_TYPES = ["weapon", "armor", "shield", "consumable", "gear"];

/** Every Item compendium of this system (the gear shop's default source). */
export function systemItemPacks() {
  try {
    return (game.packs ?? []).filter((p) => p.documentName === "Item" && p.metadata?.system === game.system.id);
  } catch (_e) {
    return [];
  }
}

/** Rulebook defaults — the gear shop opens to all of this system's Item compendiums.
 *  `choices` is empty by default: the GM opts into the creation Choose step by adding
 *  choices (Race/Class/…), each offering Package options that grant abilities for free. */
export function defaultCreationConfig() {
  return {
    skillPoints: 6,
    stepUps: 5,
    gold: 1500,
    allowedTypes: [...DEFAULT_SHOP_TYPES],
    packs: systemItemPacks().map((p) => p.collection),
    choices: []
  };
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
  c.skillPoints = toInt(c.skillPoints, d.skillPoints);
  c.stepUps = toInt(c.stepUps, d.stepUps);
  c.gold = toInt(c.gold, d.gold);
  // An empty/missing type list falls back to the rules defaults; an empty pack list
  // is honoured (the GM may deliberately open no compendiums).
  if (!Array.isArray(c.allowedTypes) || !c.allowedTypes.length) c.allowedTypes = d.allowedTypes;
  if (!Array.isArray(c.packs)) c.packs = d.packs;
  c.choices = normalizeChoices(c.choices);
  return c;
}

/** Just the starting Skill Points — read by the Character data model's field initial. */
export function creationStartingSkillPoints() {
  try {
    return toInt(game.settings.get("project-anime", CREATION_SETTING)?.skillPoints, 6);
  } catch (_e) {
    return 6;
  }
}
