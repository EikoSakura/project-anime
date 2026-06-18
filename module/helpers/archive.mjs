/**
 * Project: Anime — THE CODEX ARCHIVE (in-world encyclopedia data layer).
 *
 * One world setting (`codexArchive`), GM-writes / everyone-reads, exactly like the quest log
 * (`quests`) and factions (`covenantFactions`). It backs the "Codex" tab of the Headquarters window
 * (apps/codex.mjs): a tabbed encyclopedia of GM-authored entries — Enemies, NPCs, Locations,
 * Items & Relics, plus any custom categories the GM adds, renames, re-icons, or reorders in-app.
 *
 * An entry may LINK a world Actor or Item (a live, reveal-gated stat block reads off it at display
 * time) or stand alone as free-form lore (banner, dossier, quote, tags, custom "vital" rows).
 *
 * Discovery: each entry carries a `revealed` flag. The GM sees everything; players see a revealed
 * entry in full and unrevealed ones as locked "???" silhouettes — that filtering lives in the
 * codex.mjs context, this layer just stores the flag.
 */

export const ARCHIVE_SETTING = "codexArchive";

/** Font-Awesome solid icon ids offered in the category icon picker. */
export const CATEGORY_ICONS = [
  "fa-skull", "fa-user", "fa-map-location-dot", "fa-gem", "fa-dragon", "fa-hat-wizard",
  "fa-landmark", "fa-scroll", "fa-flask", "fa-paw", "fa-ghost", "fa-crown",
  "fa-book", "fa-masks-theater", "fa-mountain-sun", "fa-shield-halved", "fa-skull-crossbones", "fa-spaghetti-monster-flying"
];

/** The four sections the archive seeds with on first use. `label` is a localization KEY here; it's
 *  resolved to a plain (then GM-editable) string when the archive is first normalized. */
export const DEFAULT_CATEGORIES = [
  { id: "enemies",   label: "PROJECTANIME.Archive.cat.enemies",   icon: "fa-skull" },
  { id: "npcs",      label: "PROJECTANIME.Archive.cat.npcs",      icon: "fa-user" },
  { id: "locations", label: "PROJECTANIME.Archive.cat.locations", icon: "fa-map-location-dot" },
  { id: "items",     label: "PROJECTANIME.Archive.cat.items",     icon: "fa-gem" }
];

/** Seed the default categories, resolving their labels to plain strings the GM can later rename. */
function seedCategories() {
  return DEFAULT_CATEGORIES.map((c, i) => ({ id: c.id, label: game.i18n.localize(c.label), icon: c.icon, sort: i }));
}

/** A safe, complete category record. */
function normalizeCategory(c = {}, i = 0) {
  return {
    id: c.id || foundry.utils.randomID(),
    label: c.label ?? "",
    icon: c.icon || "fa-book",
    sort: Number.isFinite(c.sort) ? c.sort : i
  };
}

/** A safe, complete entry record (superset of fields across all category kinds). */
function normalizeEntry(e = {}) {
  return {
    id: e.id || foundry.utils.randomID(),
    category: e.category ?? "",
    sort: Number(e.sort) || 0,
    name: e.name ?? "",
    subtitle: e.subtitle ?? "",
    img: e.img ?? "",
    banner: e.banner ?? "",
    accent: e.accent || "",
    actorUuid: e.actorUuid ?? "",                                  // optional live Actor link
    itemUuid: e.itemUuid ?? "",                                    // optional live Item link
    tier: e.tier ?? "",                                            // enemies: minion|standard|elite|solo
    tags: Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim()) : [],
    dossier: e.dossier ?? "",                                      // rich HTML lore (enriched on display)
    quote: e.quote ?? "",
    vitals: Array.isArray(e.vitals)
      ? e.vitals.map((v) => ({ id: v?.id || foundry.utils.randomID(), k: v?.k ?? "", v: v?.v ?? "" }))
      : [],
    gmNotes: e.gmNotes ?? "",                                      // GM-only secret notes (never shown to players)
    showStatBlock: e.showStatBlock !== false,                      // default ON for actor-backed entries
    revealed: !!e.revealed                                         // discovery gate
  };
}

/** Normalize the whole archive object — seeds the default categories when none exist yet. */
export function normalizeArchive(raw = {}) {
  let categories = Array.isArray(raw.categories) ? raw.categories : [];
  if (!categories.length) categories = seedCategories();
  categories = categories.map((c, i) => normalizeCategory(c, i)).sort((a, b) => a.sort - b.sort);
  const entries = (Array.isArray(raw.entries) ? raw.entries : []).map(normalizeEntry);
  return { categories, entries };
}

/** The Codex archive — a safe, normalized deep copy you can mutate before saveArchive. */
export function getArchive() {
  return normalizeArchive(foundry.utils.deepClone(game.settings.get("project-anime", ARCHIVE_SETTING) ?? {}));
}

/** Persist the archive (GM only — world-scoped). Re-renders any open Codex via the setting's onChange. */
export async function saveArchive(archive) {
  if (!game.user.isGM) return;
  return game.settings.set("project-anime", ARCHIVE_SETTING, archive);
}

/** A fresh category, appended after the existing ones (sort defaults to the next slot). */
export function blankCategory(sort = 0) {
  return { id: foundry.utils.randomID(), label: game.i18n.localize("PROJECTANIME.Archive.newCategory"), icon: "fa-book", sort };
}

/** A fresh blank entry in the given category. */
export function blankEntry(categoryId = "") {
  return normalizeEntry({ id: foundry.utils.randomID(), category: categoryId });
}

/** Resolve an entry's linked Actor (sync, null-safe). */
export function entryActor(entry) {
  if (!entry?.actorUuid) return null;
  try { return fromUuidSync(entry.actorUuid); } catch (_e) { return null; }
}

/** Resolve an entry's linked Item (sync, null-safe). */
export function entryItem(entry) {
  if (!entry?.itemUuid) return null;
  try { return fromUuidSync(entry.itemUuid); } catch (_e) { return null; }
}
