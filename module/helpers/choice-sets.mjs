/**
 * Choice Set system for Shards of Mana.
 * Items can define choice dialogs that appear when added to an actor.
 * Choices are stored in item flags and can generate Active Effects.
 *
 * Data model (stored in item flags):
 *   flags["shards-of-mana"].choiceSets = [{
 *     id, label, type ("preset"|"custom"),
 *     presetType ("stat"|"element"|"damageType"|"weaponGroup"|"condition"|"skill"),
 *     customOptions: [{ label, value }],
 *     required: true,
 *     effectTemplate: { namePattern, img, changes: [{ key, mode, value }] },
 *     renamePattern: "{NAME} ({CHOICE})",   // optional — rename item on choice
 *     itemUpdate: { key: "system.damageType", value: "{CHOICE_VALUE}" }  // optional — update item field
 *   }]
 *
 * Results stored on the actor's embedded item copy:
 *   flags["shards-of-mana"].choiceResults = { "choice-id": { value, label } }
 */

/* -------------------------------------------- */
/*  Preset Resolvers                             */
/* -------------------------------------------- */

/**
 * Preset type resolvers — each returns an array of { value, label } options.
 * @type {Object<string, function>}
 */
const PRESET_RESOLVERS = {
  stat: () => Object.entries(CONFIG.SHARDS.stats).map(([key, loc]) => ({
    value: key, label: game.i18n.localize(loc)
  })),

  element: () => [
    "fire", "ice", "lightning", "wind",
    "earth", "water", "light", "dark", "plant", "poison"
  ].map(key => ({
    value: key,
    label: game.i18n.localize(`SHARDS.DamageType.${key.charAt(0).toUpperCase() + key.slice(1)}`)
  })),

  damageType: () => Object.entries(CONFIG.SHARDS.damageTypes).map(([key, loc]) => ({
    value: key, label: game.i18n.localize(loc)
  })),

  weaponGroup: () => Object.entries(CONFIG.SHARDS.weaponGroups).map(([key, loc]) => ({
    value: key, label: game.i18n.localize(loc)
  })),

  condition: () => Object.entries(CONFIG.SHARDS.conditions).map(([key, loc]) => ({
    value: key, label: game.i18n.localize(loc)
  })),

  skill: (actor) => {
    if (!actor) return [];
    return actor.items
      .filter(i => i.type === "skill")
      .map(i => ({ value: i.uuid, label: i.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
};

/* -------------------------------------------- */
/*  Public API                                   */
/* -------------------------------------------- */

/**
 * Build the options array for a single choice set.
 * @param {object} choiceSet - The choice set definition
 * @param {Actor} [actor] - The actor (needed for "skill" preset)
 * @returns {{ value: string, label: string }[]}
 */
export function buildChoiceOptions(choiceSet, actor = null) {
  if (choiceSet.type === "custom") {
    return (choiceSet.customOptions ?? []).map(o => ({
      value: o.value, label: o.label
    }));
  }
  const resolver = PRESET_RESOLVERS[choiceSet.presetType];
  return resolver ? resolver(actor) : [];
}

/**
 * Check if an item has choice sets that need resolution.
 * @param {Item} item
 * @returns {boolean}
 */
export function hasChoiceSets(item) {
  const sets = item.flags?.["shards-of-mana"]?.choiceSets;
  return Array.isArray(sets) && sets.length > 0;
}

/**
 * Check if an item's choice sets have already been resolved.
 * @param {Item} item
 * @returns {boolean}
 */
export function choiceSetsResolved(item) {
  const results = item.flags?.["shards-of-mana"]?.choiceResults;
  return results && Object.keys(results).length > 0;
}

/**
 * Process choice sets for a newly added item.
 * Shows the choice dialog, stores results, and creates templated AEs.
 * Called from actor._onCreateDescendantDocuments.
 * @param {Actor} actor
 * @param {Item} embeddedItem
 */
export async function processItemChoiceSets(actor, embeddedItem) {
  const choiceSets = embeddedItem.flags?.["shards-of-mana"]?.choiceSets;
  if (!Array.isArray(choiceSets) || !choiceSets.length) return;

  // Only present dialog to the owning player or GM
  if (!actor.isOwner) return;

  // Don't re-present if already resolved (e.g. duplicate add)
  if (choiceSetsResolved(embeddedItem)) return;

  console.log("SoM | processItemChoiceSets — presenting dialog for:", embeddedItem.name);
  console.log("SoM | choiceSets flag data:", JSON.stringify(choiceSets, null, 2));

  const results = await _presentChoiceDialog(actor, embeddedItem, choiceSets);
  if (!results) {
    ui.notifications.info(game.i18n.localize("SHARDS.ChoiceSet.Cancelled"));
    return;
  }

  console.log("SoM | Dialog returned results:", JSON.stringify(results, null, 2));
  await _applyChoiceResults(actor, embeddedItem, choiceSets, results);
}

/**
 * Clean up AEs created by choice sets when the source item is removed.
 * @param {Actor} actor
 * @param {string} itemId - The removed item's ID
 */
export async function cleanupChoiceSetEffects(actor, itemId) {
  const toDelete = actor.effects.filter(e =>
    e.flags?.["shards-of-mana"]?.choiceSourceItemId === itemId
  );
  if (toDelete.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete.map(e => e.id));
  }
}

/* -------------------------------------------- */
/*  Internal Functions                           */
/* -------------------------------------------- */

/**
 * Present the choice dialog and return selected values.
 * @param {Actor} actor
 * @param {Item} embeddedItem
 * @param {object[]} choiceSets
 * @returns {Promise<Object<string, { value: string, label: string }> | null>}
 * @private
 */
async function _presentChoiceDialog(actor, embeddedItem, choiceSets) {
  // Build options for each choice set
  const sections = choiceSets.map(cs => ({
    ...cs,
    options: buildChoiceOptions(cs, actor)
  }));

  // Render dialog HTML
  const content = await renderTemplate(
    "systems/shards-of-mana/templates/apps/choice-set-dialog.hbs",
    { sections, itemName: embeddedItem.name, itemImg: embeddedItem.img }
  );

  // Read selections from the DOM at confirm time via button callback
  const result = await foundry.applications.api.DialogV2.wait({
    window: {
      title: game.i18n.format("SHARDS.ChoiceSet.DialogTitle", { name: embeddedItem.name }),
      icon: "fa-solid fa-list-check"
    },
    content,
    buttons: [
      {
        action: "confirm",
        label: game.i18n.localize("SHARDS.ChoiceSet.Confirm"),
        icon: "fa-solid fa-check",
        callback: (event, button, dialog) => {
          const selections = {};
          const root = dialog.element ?? dialog;
          for (const select of root.querySelectorAll(".cs-dialog-select")) {
            const csId = select.dataset.csId;
            const value = select.value;
            if (value) {
              const option = select.options[select.selectedIndex];
              selections[csId] = { value, label: option?.textContent?.trim() ?? value };
            }
          }
          return selections;
        }
      },
      {
        action: "cancel",
        label: game.i18n.localize("Cancel"),
        icon: "fa-solid fa-times"
      }
    ]
  });

  // Cancel or close returns null/string
  if (!result || typeof result === "string") return null;

  // Validate required choices
  for (const cs of choiceSets) {
    if (cs.required && !result[cs.id]) {
      ui.notifications.warn(game.i18n.localize("SHARDS.ChoiceSet.RequiredChoice"));
      return null;
    }
  }

  return result;
}

/**
 * Apply choice results: store in item flags and create any templated AEs.
 * @param {Actor} actor
 * @param {Item} embeddedItem
 * @param {object[]} choiceSets
 * @param {Object<string, { value: string, label: string }>} results
 * @private
 */
async function _applyChoiceResults(actor, embeddedItem, choiceSets, results) {
  console.log("SoM | Choice Set results:", results);
  console.log("SoM | Choice Sets config:", choiceSets.map(cs => ({
    id: cs.id, renamePattern: cs.renamePattern, itemUpdate: cs.itemUpdate
  })));

  // Store results in the embedded item's flags
  await embeddedItem.setFlag("shards-of-mana", "choiceResults", results);

  // --- Item updates: rename + system data changes ---
  const itemUpdate = {};
  const originalName = embeddedItem.name;
  for (const cs of choiceSets) {
    const result = results[cs.id];
    if (!result) continue;

    // Auto-rename: append "(Choice)" by default. Set renamePattern to "" to disable.
    if (cs.renamePattern) {
      itemUpdate.name = cs.renamePattern
        .replace(/\{NAME\}/g, originalName)
        .replace(/\{CHOICE\}/g, result.label)
        .replace(/\{CHOICE_VALUE\}/g, result.value);
    } else if (cs.renamePattern !== "") {
      itemUpdate.name = `${originalName} (${result.label})`;
    }

    // Item data update: write directly to the embedded item's system fields
    if (cs.itemUpdate?.key) {
      const key = cs.itemUpdate.key
        .replace(/\{CHOICE\}/g, result.value)
        .replace(/\{CHOICE_VALUE\}/g, result.value);
      const value = String(cs.itemUpdate.value ?? "")
        .replace(/\{CHOICE\}/g, result.label)
        .replace(/\{CHOICE_VALUE\}/g, result.value);
      itemUpdate[key] = value;
    }
  }

  console.log("SoM | Choice Set item update:", itemUpdate);

  if (Object.keys(itemUpdate).length) {
    await embeddedItem.update(itemUpdate);
  }

  // --- Create AEs on the actor from effect templates ---
  const aesToCreate = [];
  for (const cs of choiceSets) {
    const result = results[cs.id];
    if (!result || !cs.effectTemplate) continue;

    const template = cs.effectTemplate;
    const name = (template.namePattern ?? "Choice Effect")
      .replace(/\{CHOICE\}/g, result.label)
      .replace(/\{CHOICE_VALUE\}/g, result.value);

    const changes = (template.changes ?? []).map(c => ({
      key: c.key.replace(/\{CHOICE\}/g, result.value),
      mode: Number(c.mode) || 2,
      value: String(c.value).replace(/\{CHOICE\}/g, result.value)
    }));

    aesToCreate.push({
      name,
      img: template.img ?? "icons/svg/aura.svg",
      changes,
      origin: embeddedItem.uuid,
      flags: {
        "shards-of-mana": {
          choiceSetId: cs.id,
          choiceSourceItemId: embeddedItem.id
        }
      }
    });
  }

  if (aesToCreate.length) {
    await actor.createEmbeddedDocuments("ActiveEffect", aesToCreate);
  }

  // --- Substitute {CHOICE} placeholders in existing item effects ---
  await _substituteExistingEffects(embeddedItem, choiceSets, results);

  // --- Substitute {CHOICE} placeholders in lineage trait names/descriptions ---
  await _substituteTraitText(embeddedItem, choiceSets, results);
}

/* -------------------------------------------- */
/*  Choice Propagation to Existing Effects       */
/* -------------------------------------------- */

/**
 * Resolve all choice placeholders in a string.
 *
 * Supported placeholders:
 *   {CHOICE}          — label when isName=true, value when isName=false
 *   {CHOICE_VALUE}    — always the raw value
 *   {CHOICE_LABEL}    — always the display label
 *   {CHOICE:id}       — scoped to a specific choice set (label/value follows isName)
 *   {CHOICE_VALUE:id} — scoped value
 *   {CHOICE_LABEL:id} — scoped label
 *
 * @param {string} str - The string with potential placeholders
 * @param {Object<string, { value: string, label: string }>} results - All choice results keyed by choice set ID
 * @param {{ value: string, label: string } | null} firstResult - First choice set result (default for bare {CHOICE})
 * @param {boolean} isName - If true, bare {CHOICE} resolves to label; if false, to value
 * @returns {string}
 * @private
 */
function _resolveAllPlaceholders(str, results, firstResult, isName) {
  if (!str || !str.includes("{CHOICE")) return str;

  // Scoped placeholders: {CHOICE:id}, {CHOICE_VALUE:id}, {CHOICE_LABEL:id}
  str = str.replace(/\{CHOICE_VALUE:([^}]+)\}/g, (match, csId) => {
    return results[csId]?.value ?? match;
  });
  str = str.replace(/\{CHOICE_LABEL:([^}]+)\}/g, (match, csId) => {
    return results[csId]?.label ?? match;
  });
  str = str.replace(/\{CHOICE:([^}]+)\}/g, (match, csId) => {
    const result = results[csId];
    if (!result) return match;
    return isName ? result.label : result.value;
  });

  // Bare placeholders: {CHOICE}, {CHOICE_VALUE}, {CHOICE_LABEL}
  if (firstResult) {
    str = str.replace(/\{CHOICE_VALUE\}/g, firstResult.value);
    str = str.replace(/\{CHOICE_LABEL\}/g, firstResult.label);
    str = str.replace(/\{CHOICE\}/g, isName ? firstResult.label : firstResult.value);
  }

  return str;
}

/**
 * Substitute {CHOICE} placeholders in all existing Active Effects on an embedded item.
 * Runs after choice results are stored so that pre-existing AEs (e.g. lineage trait
 * effects) reflect the player's choices. Foundry's transfer system then propagates
 * the resolved values to the actor.
 *
 * @param {Item} embeddedItem - The embedded item whose effects to update
 * @param {object[]} choiceSets - The choice set definitions
 * @param {Object<string, { value: string, label: string }>} results - Resolved choices
 * @private
 */
async function _substituteExistingEffects(embeddedItem, choiceSets, results) {
  if (!embeddedItem.effects.size) return;

  const firstCsId = choiceSets[0]?.id;
  const firstResult = firstCsId ? results[firstCsId] : null;
  if (!firstResult) return;

  const effectUpdates = [];
  for (const effect of embeddedItem.effects) {
    const update = { _id: effect.id };
    let changed = false;

    // Substitute in effect name (isName=true → {CHOICE} = label)
    const newName = _resolveAllPlaceholders(effect.name, results, firstResult, true);
    if (newName !== effect.name) {
      update.name = newName;
      changed = true;
    }

    // Substitute in changes (isName=false → {CHOICE} = value)
    if (effect.changes?.length) {
      const newChanges = effect.changes.map(c => ({
        key: _resolveAllPlaceholders(c.key, results, firstResult, false),
        mode: c.mode,
        value: _resolveAllPlaceholders(String(c.value), results, firstResult, false)
      }));
      const changesModified = newChanges.some((nc, i) => {
        const oc = effect.changes[i];
        return nc.key !== oc.key || nc.value !== String(oc.value);
      });
      if (changesModified) {
        update.changes = newChanges;
        changed = true;
      }
    }

    if (changed) effectUpdates.push(update);
  }

  if (effectUpdates.length) {
    console.log("SoM | Substituting placeholders in", effectUpdates.length, "existing effects");
    await embeddedItem.updateEmbeddedDocuments("ActiveEffect", effectUpdates);
  }
}

/**
 * Substitute {CHOICE} placeholders in lineage innate trait names and descriptions.
 * Only applies to lineage items.
 *
 * @param {Item} embeddedItem - The embedded lineage item
 * @param {object[]} choiceSets - The choice set definitions
 * @param {Object<string, { value: string, label: string }>} results - Resolved choices
 * @private
 */
async function _substituteTraitText(embeddedItem, choiceSets, results) {
  if (embeddedItem.type !== "lineage") return;
  const traits = embeddedItem.system.innateTraits;
  if (!traits?.length) return;

  const firstCsId = choiceSets[0]?.id;
  const firstResult = firstCsId ? results[firstCsId] : null;
  if (!firstResult) return;

  let changed = false;
  const updatedTraits = traits.map(t => {
    const newName = _resolveAllPlaceholders(t.name, results, firstResult, true);
    const newDesc = _resolveAllPlaceholders(t.description, results, firstResult, true);
    if (newName !== t.name || newDesc !== t.description) changed = true;
    return { id: t.id, name: newName, description: newDesc };
  });

  if (changed) {
    console.log("SoM | Substituting placeholders in lineage trait names/descriptions");
    await embeddedItem.update({ "system.innateTraits": updatedTraits });
  }
}
