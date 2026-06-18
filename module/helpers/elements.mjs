/**
 * Project: Anime — homebrew "Elements" (damage types).
 *
 * The system ships 7 default damage channels but is setting-agnostic, so the GM
 * can rename / re-icon / add / remove them via a world setting (registered and
 * edited through apps/element-config.mjs). These accessors return the *active*
 * element list, falling back to the built-in defaults (localized) until the GM
 * customizes it.
 *
 * An element's `key` is a stable identifier used to key actor affinities and
 * item damage types; `label` and `icon` are pure presentation.
 */
import { PROJECTANIME } from "./config.mjs";

/** World-setting key (under the "project-anime" namespace). */
export const ELEMENTS_SETTING = "elements";

/** Built-in defaults, derived from config (labels localized at call time). */
export function defaultElements() {
  return Object.keys(PROJECTANIME.damageTypes).map((key) => ({
    key,
    label: game.i18n.localize(PROJECTANIME.damageTypes[key]),
    icon: PROJECTANIME.damageTypeIcons[key] ?? ""
  }));
}

/** The active element list — the GM's setting if set, else the defaults. */
export function getElements() {
  let stored = null;
  try {
    stored = game.settings.get("project-anime", ELEMENTS_SETTING);
  } catch (_e) {
    /* setting not registered yet (very early render) — fall through to defaults */
  }
  if (Array.isArray(stored) && stored.length) {
    return stored
      .filter((e) => e && e.key)
      .map((e) => ({ key: String(e.key), label: e.label || e.key, icon: e.icon || "" }));
  }
  return defaultElements();
}

/** `{ key: {key, label, icon} }` lookup over the active elements. */
export function getElementMap() {
  return Object.fromEntries(getElements().map((e) => [e.key, e]));
}

/** `{ key: label }` map, ready for the `selectOptions` Handlebars helper. Alphabetical by
 *  label so element/damage-type dropdowns scan easily. (The affinity grid uses
 *  getElements() and keeps the GM's configured order.) */
export function elementChoices() {
  return Object.fromEntries(
    getElements().map((e) => [e.key, e.label]).sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  );
}

/** A single element's display label (falls back to the raw key). */
export function elementLabel(key) {
  return getElementMap()[key]?.label ?? key;
}

/** Whether an `icon` value is an image file path (vs a Font Awesome class). */
export function isImageIcon(icon) {
  return typeof icon === "string" && /\.(webp|png|jpe?g|svg|gif|avif)$/i.test(icon.trim());
}

