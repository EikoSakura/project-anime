/**
 * Project: Anime — GM-configurable Bio "dossier" fields.
 *
 * The Bio tab shows a list of identity fields (Age, Gender, Homeland, …) above the
 * rich-text biography. The system is setting-agnostic, so the GM can rename / re-icon /
 * retype / add / remove those fields via a world setting (registered and edited through
 * apps/bio-field-config.mjs). These accessors return the *active* field list, falling
 * back to the built-in defaults (localized) until the world customizes it.
 *
 * A field's `key` is the stable id used to store its value at
 * `actor.system.details.<key>`; `label`, `icon` (FA class or image path) and `type`
 * ("short" = single-line input, "long" = multi-line textarea) are presentation.
 */
import { PROJECTANIME } from "./config.mjs";

/** World-setting key (under the "project-anime" namespace). */
export const BIO_FIELDS_SETTING = "bioFields";

/** Normalize a stored/loose field type to one of the two supported values. */
function normalizeType(type) {
  return type === "long" ? "long" : "short";
}

/** Built-in defaults, derived from config (labels localized at call time). */
export function defaultBioFields() {
  return Object.entries(PROJECTANIME.bioFields).map(([key, def]) => ({
    key,
    label: game.i18n.localize(def.label),
    icon: def.icon ?? "",
    type: normalizeType(def.type)
  }));
}

/** The active dossier-field list — the GM's setting if set, else the defaults. */
export function getBioFields() {
  let stored = null;
  try {
    stored = game.settings.get("project-anime", BIO_FIELDS_SETTING);
  } catch (_e) {
    /* setting not registered yet (very early render) — fall through to defaults */
  }
  if (Array.isArray(stored) && stored.length) {
    return stored
      .filter((f) => f && f.key)
      .map((f) => ({ key: String(f.key), label: f.label || f.key, icon: f.icon || "", type: normalizeType(f.type) }));
  }
  return defaultBioFields();
}
