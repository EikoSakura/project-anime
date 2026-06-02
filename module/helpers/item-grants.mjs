/**
 * Item Grant System — items can auto-embed other items/effects when added to an actor.
 *
 * Each granted document is tagged with:
 *   flags["shards-of-mana"].itemGrant = { parentItemId, grantId }
 * so cleanup can precisely remove them when the parent item is deleted.
 *
 * Choice Propagation:
 *   Grants can reference a parent item's choice set results via `choicePropagation`.
 *   When the parent item has resolved choice sets, propagation substitutes
 *   {CHOICE} (label) and {CHOICE_VALUE} (value) into granted item names, fields,
 *   and effect changes.
 */

/* -------------------------------------------- */
/*  Public API                                    */
/* -------------------------------------------- */

/**
 * Check whether an item has any grant definitions in its flags.
 * @param {Item} item
 * @returns {boolean}
 */
export function hasItemGrants(item) {
  const grants = item.flags?.["shards-of-mana"]?.grants;
  return Array.isArray(grants) && grants.length > 0;
}

/**
 * Process all grants defined on an embedded item after it's been added to an actor.
 * Resolves UUIDs, optionally confirms optional grants, and creates embedded documents.
 * If the parent item has resolved choice sets, propagation rules are applied.
 * @param {ShardsActor} actor         The actor that received the item
 * @param {Item}        embeddedItem  The embedded item copy on the actor
 */
export async function applyItemGrants(actor, embeddedItem) {
  const grants = embeddedItem.flags?.["shards-of-mana"]?.grants;
  if (!Array.isArray(grants) || !grants.length) return;

  // Read parent item's choice results for propagation
  const choiceResults = embeddedItem.flags?.["shards-of-mana"]?.choiceResults ?? {};
  if (Object.keys(choiceResults).length) {
    console.log("SoM | applyItemGrants — found choice results for propagation:", choiceResults);
  }

  const itemsToCreate = [];
  const effectsToCreate = [];

  for (const grant of grants) {
    // Optional grants: ask GM/player for confirmation
    if (grant.optional) {
      const label = grant.label || grant.uuid || "Unknown";
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("SHARDS.Grant.ConfirmTitle") },
        content: `<p>${game.i18n.format("SHARDS.Grant.ConfirmBody", { name: label, parent: embeddedItem.name })}</p>`,
        yes: { label: game.i18n.localize("SHARDS.Grant.ConfirmYes") },
        no: { label: game.i18n.localize("SHARDS.Grant.ConfirmNo") }
      });
      if (!confirmed) continue;
    }

    // Resolve choice propagation for this grant
    const propagation = _resolveChoicePropagation(grant, choiceResults);

    const grantFlag = {
      "shards-of-mana": {
        itemGrant: {
          parentItemId: embeddedItem.id,
          grantId: grant.id
        }
      }
    };

    if (grant.type === "effect") {
      // Grant is an ActiveEffect definition stored inline
      let changes = (grant.effectChanges ?? []).map(c => ({
        key: String(c.key),
        mode: Number(c.mode),
        value: String(c.value)
      }));
      if (!changes.length) continue;

      let effectName = grant.label || embeddedItem.name;

      // Apply choice propagation to effect grant
      if (propagation) {
        const prop = grant.choicePropagation;
        if (prop.renamePattern) {
          effectName = prop.renamePattern
            .replace(/\{NAME\}/g, effectName)
            .replace(/\{CHOICE\}/g, propagation.label)
            .replace(/\{CHOICE_VALUE\}/g, propagation.value);
        } else {
          effectName = _substituteChoice(effectName, propagation);
        }
        changes = changes.map(c => ({
          key: _substituteChoice(c.key, propagation),
          mode: c.mode,
          value: _substituteChoice(c.value, propagation)
        }));
      }

      effectsToCreate.push({
        name: effectName,
        icon: grant.img || "icons/svg/aura.svg",
        changes,
        flags: grantFlag,
        disabled: false
      });
    } else {
      // Grant is an item reference (UUID)
      if (!grant.uuid) continue;
      const source = await fromUuid(grant.uuid);
      if (!source) {
        ui.notifications.warn(
          game.i18n.format("SHARDS.Grant.NotFound", { uuid: grant.uuid })
        );
        continue;
      }

      // Check for duplicates by name + type (skip if already owned, except stackable skills)
      const existing = actor.items.find(
        i => i.type === source.type && i.name === source.name
      );
      if (existing) {
        ui.notifications.info(
          game.i18n.format("SHARDS.Grant.AlreadyOwned", { name: source.name })
        );
        continue;
      }

      const itemData = {
        name: source.name,
        type: source.type,
        img: source.img,
        system: foundry.utils.deepClone(source.system),
        flags: grantFlag
      };

      // Apply choice propagation to item grant
      if (propagation) {
        _applyItemPropagation(itemData, grant, propagation);
      }

      itemsToCreate.push(itemData);
    }
  }

  // Batch create
  if (itemsToCreate.length) {
    await actor.createEmbeddedDocuments("Item", itemsToCreate);
  }
  if (effectsToCreate.length) {
    await actor.createEmbeddedDocuments("ActiveEffect", effectsToCreate);
  }
}

/**
 * Remove all documents granted by a parent item when that parent is removed.
 * Searches both items and effects for matching `itemGrant.parentItemId`.
 * @param {ShardsActor} actor        The actor
 * @param {string}      parentItemId The ID of the removed parent item
 */
export async function cleanupItemGrants(actor, parentItemId) {
  const matchItem = (doc) => {
    const flag = doc.flags?.["shards-of-mana"]?.itemGrant;
    return flag?.parentItemId === parentItemId;
  };

  const itemIds = actor.items.filter(matchItem).map(i => i.id);
  const effectIds = actor.effects.filter(matchItem).map(e => e.id);

  const promises = [];
  if (itemIds.length) {
    promises.push(actor.deleteEmbeddedDocuments("Item", itemIds));
  }
  if (effectIds.length) {
    promises.push(actor.deleteEmbeddedDocuments("ActiveEffect", effectIds));
  }
  if (promises.length) await Promise.all(promises);
}

/* -------------------------------------------- */
/*  Choice Propagation Helpers                    */
/* -------------------------------------------- */

/**
 * Resolve the choice propagation config for a grant against the parent's choice results.
 * @param {object} grant - The grant definition
 * @param {object} choiceResults - The parent item's resolved choice results
 * @returns {{ value: string, label: string } | null} The resolved choice, or null
 * @private
 */
function _resolveChoicePropagation(grant, choiceResults) {
  const prop = grant.choicePropagation;
  if (!prop?.choiceSetId) return null;
  const result = choiceResults[prop.choiceSetId];
  if (!result) return null;
  return result;
}

/**
 * Substitute {CHOICE} and {CHOICE_VALUE} placeholders in a string.
 * @param {string} str - The string with placeholders
 * @param {{ value: string, label: string }} choice - The resolved choice
 * @returns {string}
 * @private
 */
function _substituteChoice(str, choice) {
  return str
    .replace(/\{CHOICE\}/g, choice.label)
    .replace(/\{CHOICE_VALUE\}/g, choice.value);
}

/**
 * Apply choice propagation to an item grant's data before creation.
 * Handles renaming and system field updates.
 * @param {object} itemData - The item data object to be created
 * @param {object} grant - The grant definition with choicePropagation config
 * @param {{ value: string, label: string }} choice - The resolved choice
 * @private
 */
function _applyItemPropagation(itemData, grant, choice) {
  const prop = grant.choicePropagation;

  // Rename pattern: {NAME} = original item name, {CHOICE} = chosen label
  if (prop.renamePattern) {
    itemData.name = prop.renamePattern
      .replace(/\{NAME\}/g, itemData.name)
      .replace(/\{CHOICE\}/g, choice.label)
      .replace(/\{CHOICE_VALUE\}/g, choice.value);
  }

  // Item field updates: set system fields on the granted item
  const updates = prop.itemUpdates;
  if (Array.isArray(updates)) {
    for (const upd of updates) {
      if (!upd.key) continue;
      const key = _substituteChoice(upd.key, choice);
      const value = _substituteChoice(String(upd.value ?? ""), choice);

      // Support dotted paths into system data (e.g. "system.damageType")
      if (key.startsWith("system.")) {
        const path = key.slice(7); // strip "system."
        foundry.utils.setProperty(itemData.system, path, value);
      }
    }
  }
}
