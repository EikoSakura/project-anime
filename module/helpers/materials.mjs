/**
 * Project: Anime — homebrew "Material Categories".
 *
 * Materials are a stackable resource Item type (crafting/gathering). The system ships a default
 * set of resource buckets but is setting-agnostic, so the GM can rename / re-icon / add / remove
 * them via a world setting (registered and edited through apps/material-config.mjs). These
 * accessors return the *active* category list, falling back to the built-in defaults (localized)
 * until the GM customizes it — exactly mirroring helpers/elements.mjs.
 *
 * A category's `key` is the stable identifier a Material stores and the HQ Stores tally groups by;
 * `label` and `icon` are pure presentation.
 */
import { PROJECTANIME } from "./config.mjs";
import { isImageIcon } from "./elements.mjs";

/** World-setting key (under the "project-anime" namespace). */
export const MATERIAL_CATEGORIES_SETTING = "materialCategories";

/** Built-in defaults, derived from config (labels localized at call time). */
export function defaultMaterialCategories() {
  return Object.keys(PROJECTANIME.materialCategories).map((key) => ({
    key,
    label: game.i18n.localize(PROJECTANIME.materialCategories[key]),
    icon: PROJECTANIME.materialCategoryIcons[key] ?? ""
  }));
}

/** The active category list — the GM's setting if set, else the defaults. */
export function getMaterialCategories() {
  let stored = null;
  try {
    stored = game.settings.get("project-anime", MATERIAL_CATEGORIES_SETTING);
  } catch (_e) {
    /* setting not registered yet (very early render) — fall through to defaults */
  }
  if (Array.isArray(stored) && stored.length) {
    return stored
      .filter((c) => c && c.key)
      .map((c) => ({ key: String(c.key), label: c.label || c.key, icon: c.icon || "" }));
  }
  return defaultMaterialCategories();
}

/** `{ key: {key, label, icon} }` lookup over the active categories. */
export function getMaterialCategoryMap() {
  return Object.fromEntries(getMaterialCategories().map((c) => [c.key, c]));
}

/** `{ key: label }` map, alphabetical by label — ready for the `selectOptions` Handlebars helper. */
export function materialCategoryChoices() {
  return Object.fromEntries(
    getMaterialCategories().map((c) => [c.key, c.label]).sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  );
}

/** A single category's display label (falls back to the raw key). */
export function materialCategoryLabel(key) {
  return getMaterialCategoryMap()[key]?.label ?? key;
}

export { isImageIcon };
