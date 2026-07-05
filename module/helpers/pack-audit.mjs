/**
 * Project: Anime — one-time compendium audit against the rules doc's gear tables (v0.03).
 *
 * The shipped packs were seeded by hand and had drifted from the printed tables (prices, Bulk,
 * accuracy/damage modifiers, the Heavy Shield's Evasion). This reconciles every known item to
 * the doc's numbers IN PLACE via the compendium API (unlocking and re-locking around the write),
 * so the LevelDB stays consistent no matter what state it's in. Items are matched by NAME within
 * their pack; names not in the table (a GM's homebrew additions) are left untouched, as are all
 * non-numeric fields (names, icons, descriptions, authored Active Effects). Doc entries missing
 * from a pack entirely (v0.03's Artisan's Kit) are created.
 *
 * Run once per world by the active GM (gated by the PACK_AUDIT_SETTING world flag in
 * project-anime.mjs's ready hook). Idempotent — re-running writes the same values.
 *
 * v0.03 rebases weapon DMG to the doc's ABSOLUTE column (Axe 5 … Unarmed 0 — damage is now
 * ⟪Attribute⟫ + this value), corrects Hit/Bulk drift, seeds Bow/Firearm minimum ranges, and
 * raises Medium/Heavy armor Protection to 3/4. Existing world/actor copies are re-based by
 * migrateGearRebaseV003 (project-anime.mjs), which reuses these targets.
 */

/** Hidden world-flag key: the v0.03 gear audit has been applied. */
export const PACK_AUDIT_SETTING = "packAuditV003";

/** Doc table targets, per pack → item name → flat system updates. */
export const PACK_TARGETS = {
  weapons: {
    "Axe":      { "system.cost": 500,  "system.size": 3, "system.accuracy.attrA": "might",   "system.accuracy.attrB": "might",   "system.accuracy.mod": -1, "system.damage.mod": 5, "system.range.type": "melee",  "system.range.tiles": 1 },
    "Blade":    { "system.cost": 600,  "system.size": 2, "system.accuracy.attrA": "might",   "system.accuracy.attrB": "agility", "system.accuracy.mod": 1,  "system.damage.mod": 3, "system.range.type": "melee",  "system.range.tiles": 1 },
    "Bow":      { "system.cost": 1000, "system.size": 2, "system.accuracy.attrA": "agility", "system.accuracy.attrB": "mind",    "system.accuracy.mod": 0,  "system.damage.mod": 3, "system.range.type": "ranged", "system.range.tiles": 8, "system.range.minTiles": 2, "system.grip": "two", "system.twoHandedOnly": true },
    "Chain":    { "system.cost": 800,  "system.size": 1, "system.accuracy.attrA": "agility", "system.accuracy.attrB": "charm",   "system.accuracy.mod": 1,  "system.damage.mod": 2, "system.range.type": "melee",  "system.range.tiles": 3 },
    "Firearm":  { "system.cost": 1000, "system.size": 2, "system.accuracy.attrA": "agility", "system.accuracy.attrB": "mind",    "system.accuracy.mod": -1, "system.damage.mod": 4, "system.range.type": "ranged", "system.range.tiles": 6, "system.range.minTiles": 2 },
    "Grimoire": { "system.cost": 800,  "system.size": 2, "system.accuracy.attrA": "mind",    "system.accuracy.attrB": "spirit",  "system.accuracy.mod": -1, "system.damage.mod": 4, "system.range.type": "ranged", "system.range.tiles": 5 },
    "Polearm":  { "system.cost": 700,  "system.size": 3, "system.accuracy.attrA": "might",   "system.accuracy.attrB": "agility", "system.accuracy.mod": 0,  "system.damage.mod": 4, "system.range.type": "melee",  "system.range.tiles": 2 },
    "Staff":    { "system.cost": 700,  "system.size": 1, "system.accuracy.attrA": "mind",    "system.accuracy.attrB": "spirit",  "system.accuracy.mod": 0,  "system.damage.mod": 3, "system.range.type": "melee",  "system.range.tiles": 1 },
    "Unarmed":  { "system.cost": 0,    "system.size": 0, "system.accuracy.attrA": "might",   "system.accuracy.attrB": "agility", "system.accuracy.mod": 0,  "system.damage.mod": 0, "system.range.type": "melee",  "system.range.tiles": 1 }
  },
  armor: {
    "Clothes":      { "system.cost": 100,  "system.size": 0, "system.protection": 0, "system.defSplit": 0, "system.resSplit": 0, "system.evasionMod": 0 },
    "Light Armor":  { "system.cost": 250,  "system.size": 1, "system.protection": 1, "system.defSplit": 1, "system.resSplit": 0, "system.evasionMod": 0 },
    "Medium Armor": { "system.cost": 500,  "system.size": 2, "system.protection": 3, "system.defSplit": 3, "system.resSplit": 0, "system.evasionMod": -1 },
    "Heavy Armor":  { "system.cost": 1000, "system.size": 3, "system.protection": 4, "system.defSplit": 4, "system.resSplit": 0, "system.evasionMod": -2 }
  },
  shields: {
    "Light Shield": { "system.cost": 150, "system.size": 2, "system.evasionBonus": 1, "system.defenseBonus": 0, "system.accuracy.attrA": "might", "system.accuracy.attrB": "agility", "system.accuracy.mod": 0,  "system.damage.mod": 1, "system.range.type": "melee", "system.range.tiles": 1 },
    "Heavy Shield": { "system.cost": 400, "system.size": 3, "system.evasionBonus": 1, "system.defenseBonus": 1, "system.accuracy.attrA": "might", "system.accuracy.attrB": "might",   "system.accuracy.mod": -1, "system.damage.mod": 2, "system.range.type": "melee", "system.range.tiles": 1 }
  },
  accessories: {
    "Belt of the Titan": { "system.cost": 750,  "system.size": 1 },
    "Lucky Pendant":     { "system.cost": 1500, "system.size": 1 },
    "Running Sandals":   { "system.cost": 750,  "system.size": 1 },
    "Trader's Pass":     { "system.cost": 2000, "system.size": 0 },
    "Scouter":           { "system.cost": 1000, "system.size": 1 }
  },
  consumables: {
    "HP Potion":             { "system.cost": 100, "system.size": 1, "system.restoreType": "hp",     "system.restoreAmount": 4 },
    "HP Potion (Strong)":    { "system.cost": 300, "system.size": 1, "system.restoreType": "hp",     "system.restoreAmount": 8 },
    "Energy Drink":          { "system.cost": 100, "system.size": 1, "system.restoreType": "energy", "system.restoreAmount": 4 },
    "Energy Drink (Strong)": { "system.cost": 300, "system.size": 1, "system.restoreType": "energy", "system.restoreAmount": 8 }
  },
  containers: {
    "Pouch":          { "system.cost": 100,  "system.size": 0, "system.capacityBonus": 1 },
    "Small Backpack": { "system.cost": 300,  "system.size": 0, "system.capacityBonus": 3 },
    "Backpack":       { "system.cost": 500,  "system.size": 0, "system.capacityBonus": 5 },
    "Large Backpack": { "system.cost": 1000, "system.size": 0, "system.capacityBonus": 10 }
  }
};

/** Doc entries the packs never shipped, per pack → full creation data (skipped when a document
 *  of the same name already exists). v0.03 adds the Artisan's Kit (required to craft outside a
 *  Town — the Crafting chapter reads it). */
const PACK_CREATES = {
  containers: [
    {
      name: "Artisan's Kit",
      type: "gear",
      img: "icons/svg/item-bag.svg",
      system: { cost: 150, size: 1, description: "<p>Required to craft outside a Town.</p>" }
    }
  ]
};

/**
 * Reconcile every system gear pack to the doc tables. Unlocks each pack just long enough to
 * write, then restores its prior lock state. Returns the number of items updated.
 */
export async function auditGearPacks() {
  let updated = 0;
  const packKeys = new Set([...Object.keys(PACK_TARGETS), ...Object.keys(PACK_CREATES)]);
  for (const key of packKeys) {
    const targets = PACK_TARGETS[key] ?? {};
    const pack = game.packs.get(`project-anime.${key}`);
    if (!pack) continue;
    const wasLocked = pack.locked;
    try {
      if (wasLocked) await pack.configure({ locked: false });
      const docs = await pack.getDocuments();
      const updates = [];
      for (const doc of docs) {
        const target = targets[doc.name];
        if (target) updates.push({ _id: doc.id, ...target });
      }
      if (updates.length) {
        await Item.updateDocuments(updates, { pack: pack.collection });
        updated += updates.length;
      }
      const creates = (PACK_CREATES[key] ?? []).filter((c) => !docs.some((d) => d.name === c.name));
      if (creates.length) {
        await Item.createDocuments(creates, { pack: pack.collection });
        updated += creates.length;
      }
    } catch (err) {
      console.error(`Project: Anime | Gear audit failed for pack "${key}"`, err);
    } finally {
      if (wasLocked) await pack.configure({ locked: true });
    }
  }
  if (updated) console.log(`Project: Anime | Gear audit — ${updated} compendium item(s) aligned to the v0.03 tables.`);
  return updated;
}
