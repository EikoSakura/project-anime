/**
 * Project: Anime — SHARE helpers for HQ facility content (Vendor stock / Workshop recipes).
 *
 * Export wraps a payload in a typed `{ system, type, version }` envelope and downloads it as a .json
 * file; import prompts the GM to pick that file (or paste its contents), validates the envelope, and
 * returns the parsed payload. The domain windows own the MERGE step (regenerating ids, remapping a
 * recipe's facility requirements by name) since that's specific to each content type.
 *
 * Item snapshots (stock items, recipe outputs) are self-contained `toObject()` data, so they port across
 * worlds with no compendium dependency. Resource-cost keys (e.g. "wood") and facility requirements are
 * matched by their world identity (key / facility name) on import — unmatched requirements are dropped.
 */

import { getHQ, saveHQ } from "./factions.mjs";

const SYSTEM = "project-anime";
const SHARE_VERSION = 1;

const _saveDataToFile = (data, type, filename) =>
  (foundry.utils.saveDataToFile ?? globalThis.saveDataToFile)(data, type, filename);
const _readTextFromFile = (file) =>
  (foundry.utils.readTextFromFile ?? globalThis.readTextFromFile)(file);

/** Download a share file: `payload` wrapped with a `{ system, type, version }` header (pretty-printed). */
export function exportShare(type, payload, filename) {
  const data = JSON.stringify({ system: SYSTEM, type, version: SHARE_VERSION, ...payload }, null, 2);
  _saveDataToFile(data, "application/json", filename);
}

/** A filesystem-safe slug for an export filename (falls back when the name is blank). */
export function fileSlug(name, fallback = "facility") {
  const s = String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || fallback;
}

/**
 * Prompt (GM) to pick a .json share file or paste its JSON, then resolve the parsed payload object — or
 * null if cancelled, empty, unparseable, or the wrong `type`. A selected file takes precedence over the
 * textarea; the parse + type check happen here so callers get a validated payload or nothing.
 */
export async function promptImportShare(expectedType, { title } = {}) {
  const content = `
    <div class="pa-share-import">
      <p class="notes">${game.i18n.localize("PROJECTANIME.Share.importHint")}</p>
      <input type="file" accept="application/json,.json" data-share-file>
      <textarea data-share-text rows="8" spellcheck="false" placeholder="${game.i18n.localize("PROJECTANIME.Share.importPaste")}"></textarea>
    </div>`;
  // The button callback stays SYNC (matching the codebase's DialogV2 usage) and returns the chosen File
  // object + pasted text; the File survives the dialog closing, so we read it afterward. This avoids
  // depending on DialogV2 awaiting an async callback.
  const res = await foundry.applications.api.DialogV2.wait({
    window: { title: title || game.i18n.localize("PROJECTANIME.Share.importTitle"), icon: "fa-solid fa-file-import" },
    classes: ["project-anime", "theme-dark"],
    content,
    rejectClose: false,
    buttons: [
      {
        action: "import",
        label: game.i18n.localize("PROJECTANIME.Share.import"),
        icon: "fa-solid fa-file-import",
        default: true,
        callback: (event, button) => ({
          file: button.form?.querySelector("[data-share-file]")?.files?.[0] ?? null,
          text: button.form?.querySelector("[data-share-text]")?.value ?? ""
        })
      },
      { action: "cancel", label: game.i18n.localize("Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
    ]
  }).catch(() => null);

  if (!res) return null;                                         // cancelled / closed
  let raw = res.text;
  if (res.file) { try { raw = await _readTextFromFile(res.file); } catch (_e) { raw = ""; } }
  if (!raw || typeof raw !== "string") return null;             // empty
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_e) { ui.notifications.warn(game.i18n.localize("PROJECTANIME.Share.importBad")); return null; }
  if (parsed?.system !== SYSTEM || parsed?.type !== expectedType) {
    ui.notifications.warn(game.i18n.localize("PROJECTANIME.Share.importWrongType"));
    return null;
  }
  return parsed;
}

/* -------------------------------------------------------------------------- */
/*  Facility-aware export / import (called from the Codex facility context menu) */
/* -------------------------------------------------------------------------- */

/** Export a facility's shareable content to a .json file (GM): a vendor's stock or a workshop's recipes.
 *  Workshop requirements are written by facility NAME (remapped on import); recipe ids are dropped. */
export function exportFacility(facilityId) {
  if (!game.user.isGM) return;
  const hq = getHQ();
  const f = hq.facilities.find((x) => x.id === facilityId);
  if (!f) return;
  if (f.role === "workshop") {
    const recipes = f.recipes ?? [];
    if (!recipes.length) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Share.exportEmpty"));
    const facName = (id) => hq.facilities.find((x) => x.id === id)?.name || "";
    const out = recipes.map((r) => {
      const c = foundry.utils.deepClone(r);
      delete c.id;
      c.requires = (r.requires ?? []).map((q) => ({ tier: q.tier, name: facName(q.facilityId) })).filter((q) => q.name);
      return c;
    });
    exportShare("workshop-recipes", { workshop: f.name, recipes: out }, `${fileSlug(f.name, "workshop")}-recipes.json`);
  } else if (f.role === "vendor") {
    const stock = f.stock ?? [];
    if (!stock.length) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Share.exportEmpty"));
    exportShare("vendor-stock", { vendor: f.name, stock, drawFromShop: !!f.drawFromShop, rateBuy: f.rateBuy, rateSell: f.rateSell }, `${fileSlug(f.name, "shop")}-stock.json`);
  } else {
    ui.notifications.warn(game.i18n.localize("PROJECTANIME.Share.notShareable"));
  }
}

/** Import shareable content into a facility from a file/paste (GM) — APPENDS to what's there, then saves.
 *  Workshop recipes get fresh ids + their requirements remapped by name to a building in THIS HQ. */
export async function importFacility(facilityId) {
  if (!game.user.isGM) return;
  const role = getHQ().facilities.find((x) => x.id === facilityId)?.role;
  if (role === "workshop") {
    const payload = await promptImportShare("workshop-recipes", { title: game.i18n.localize("PROJECTANIME.Workshop.importTitle") });
    if (!payload || !Array.isArray(payload.recipes)) return;
    const hq = getHQ();
    const f = hq.facilities.find((x) => x.id === facilityId);
    if (!f) return;
    const byName = new Map(hq.facilities.map((x) => [x.name, x.id]));
    const incoming = payload.recipes.map((r) => ({
      ...r,
      id: foundry.utils.randomID(),
      requires: Array.isArray(r.requires)
        ? r.requires.map((q) => ({ facilityId: byName.get(q.name) || "", tier: q.tier })).filter((q) => q.facilityId)
        : []
    }));
    (f.recipes ??= []).push(...incoming);
    await saveHQ(hq);
    ui.notifications.info(game.i18n.format("PROJECTANIME.Share.imported", { n: incoming.length }));
  } else if (role === "vendor") {
    const payload = await promptImportShare("vendor-stock", { title: game.i18n.localize("PROJECTANIME.Shop.importTitle") });
    if (!payload || !Array.isArray(payload.stock)) return;
    const hq = getHQ();
    const f = hq.facilities.find((x) => x.id === facilityId);
    if (!f) return;
    const items = payload.stock.map((s) => { const c = foundry.utils.deepClone(s); delete c._id; return c; });
    (f.stock ??= []).push(...items);
    await saveHQ(hq);
    ui.notifications.info(game.i18n.format("PROJECTANIME.Share.imported", { n: items.length }));
  } else {
    ui.notifications.warn(game.i18n.localize("PROJECTANIME.Share.notShareable"));
  }
}
