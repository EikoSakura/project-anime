import { PROJECTANIME } from "./config.mjs";

/**
 * Project: Anime — one-time compendium audit against the Version 2 Equipment tables.
 *
 * V2 defines equipment by STYLES: seven Weapon Styles (Damage / Threshold / Range / Property),
 * two Shield Styles (+Guard), four Armor Styles (Guard / Movement; Unarmored +1 energy regen),
 * plus the printed Accessories and Consumables. This reconciles every known pack item to the
 * printed line IN PLACE (unlocking and re-locking around the write), keeps GM homebrew
 * untouched, seeds any missing canonical Style items, and renames the potion line to the doc's
 * consumables. Existing world/actor copies are re-based by migrateGearRebaseV2
 * (project-anime.mjs), which reuses these targets.
 */

/** Hidden world-flag key: the V2 gear audit has been applied. */
export const PACK_AUDIT_SETTING = "packAuditV2";

/** Flat system updates for a Weapon Style row (also stamped by the item sheet's Style picker). */
export function weaponRow(styleKey, extra = {}) {
  const s = PROJECTANIME.weaponStyles[styleKey];
  return {
    "system.style": styleKey,
    "system.damage.value": s.damage,
    "system.threshold": s.threshold,
    "system.range.type": s.range[1] > 1 ? "ranged" : "melee",
    "system.range.tiles": s.range[1],
    "system.range.minTiles": s.range[0] > 1 ? s.range[0] : 0,
    "system.dual": !!s.dual,
    "system.twoHandedOnly": !!s.twoHanded,
    "system.grip": s.twoHanded ? "two" : "one",
    ...extra
  };
}

/** Flat system updates for an Armor Style row (also stamped by the item sheet's Style picker). */
export function armorRow(styleKey, extra = {}) {
  const s = PROJECTANIME.armorStyles[styleKey];
  return {
    "system.style": styleKey,
    "system.guardBonus": s.guard,
    "system.movement": s.movement,
    "system.energyRegen": s.energyRegen ?? 0,
    ...extra
  };
}

/** The printed Armor Style line as a description, per style key (rules: Armor Styles). */
export const ARMOR_DESCRIPTIONS = {
  unarmored: "<p>+0 Guard 💠 Movement 6 💠 Clear 2 Energy Boxes per turn instead of 1.</p>",
  light: "<p>+1 Guard 💠 Movement 6</p>",
  medium: "<p>+3 Guard 💠 Movement 5</p>",
  heavy: "<p>+5 Guard 💠 Movement 4</p>"
};

/** Flat system updates for a Shield Style row (also stamped by the item sheet's Style picker). */
export function shieldRow(styleKey, extra = {}) {
  const s = PROJECTANIME.shieldStyles[styleKey];
  return {
    "system.style": styleKey,
    "system.guardBonus": s.guard,
    "system.damage.value": s.damage,
    "system.threshold": s.threshold,
    "system.range.type": "melee",
    "system.range.tiles": 1,
    "system.dual": !!s.dual,
    ...extra
  };
}

/**
 * The printed Accessories (rules: Equipment — Accessories): canonical item fields plus the ONE
 * wired Active Effect each carries. Shared by the pack tables below and migrateAccessoriesV2
 * (project-anime.mjs), which re-bases the copies players already own — replacing their stale
 * pre-V2 effects (Belt +4 max HP, Charm-die Luck, Skill-Point Scouter) with these.
 */
export const ACCESSORY_CANON = {
  "Belt of the Titan": {
    cost: 750,
    description: "<p>+1 maximum Hit Boxes (maximum 10).</p>",
    effect: {
      name: "Belt of the Titan",
      img: "icons/magic/life/cross-yellow-green.webp",
      rules: [{ type: "resource", target: "hp", value: 1 }]
    }
  },
  "Lucky Pendant": {
    cost: 1500,
    description: "<p>When you restore a Luck Die, increase or decrease one of them by 1.</p>",
    effect: {
      name: "Lucky Pendant",
      img: "icons/magic/symbols/clover-luck-white-green.webp",
      rules: [{ type: "luck", steps: 1 }]
    }
  },
  "Running Sandals": {
    cost: 750,
    description: "<p>+1 Movement.</p>",
    effect: {
      name: "Running Sandals",
      img: "icons/equipment/feet/shoes-simple-leaf-green.webp",
      rules: [{ type: "stat", key: "movement", value: 1 }]
    }
  },
  "Scouter": {
    cost: 750,
    description: "<p>You can see the Guard of any creature you can see.</p>",
    effect: {
      name: "Scouter",
      img: "icons/equipment/head/goggles-leather-grey.webp",
      rules: [{ type: "reveal", category: "guard" }]
    }
  },
  "Trader's Pass": {
    cost: 1000,
    description: "<p>You sell items for 60% instead of half.</p>",
    effect: {
      name: "Trader's Pass",
      img: "icons/sundries/documents/document-symbol-triangle-pink.webp",
      rules: [{ type: "trade", target: "sell", pct: 10 }]
    }
  }
};

const ACCESSORY_DESC = (name) => ACCESSORY_CANON[name].description;

/** The canonical embedded-effect data for one printed Accessory (createEmbeddedDocuments-ready). */
export function accessoryEffectData(name) {
  const e = ACCESSORY_CANON[name]?.effect;
  if (!e) return null;
  return {
    name: e.name,
    img: e.img,
    transfer: true,
    flags: { "project-anime": { toggle: false, rules: { version: 1, list: e.rules } } }
  };
}

/** Doc table targets, per pack → item name → flat updates (may include a rename via `name`). */
export const PACK_TARGETS = {
  weapons: {
    // Legacy pack names fold to their nearest V2 Style; the canonical Style items are seeded below.
    "Axe":      weaponRow("heavy"),
    "Blade":    weaponRow("balanced"),
    "Bow":      weaponRow("ranged"),
    "Chain":    weaponRow("reach"),
    "Firearm":  weaponRow("ranged"),
    "Grimoire": weaponRow("casting"),
    "Polearm":  weaponRow("reach"),
    "Staff":    weaponRow("casting"),
    "Unarmed":  weaponRow("light", { "system.threshold": 10, "system.cost": 0, "system.size": 0 }),
    "Light Weapon":    weaponRow("light"),
    "Balanced Weapon": weaponRow("balanced"),
    "Heavy Weapon":    weaponRow("heavy"),
    "Reach Weapon":    weaponRow("reach"),
    "Thrown Weapon":   weaponRow("thrown"),
    "Ranged Weapon":   weaponRow("ranged"),
    "Casting Weapon":  weaponRow("casting")
  },
  armor: {
    "Clothes":      armorRow("unarmored", { "system.cost": 100, "system.description": ARMOR_DESCRIPTIONS.unarmored }),
    "Unarmored":    armorRow("unarmored", { "system.description": ARMOR_DESCRIPTIONS.unarmored }),
    "Light Armor":  armorRow("light",     { "system.description": ARMOR_DESCRIPTIONS.light }),
    "Medium Armor": armorRow("medium",    { "system.description": ARMOR_DESCRIPTIONS.medium }),
    "Heavy Armor":  armorRow("heavy",     { "system.description": ARMOR_DESCRIPTIONS.heavy })
  },
  shields: {
    "Light Shield": shieldRow("lightShield"),
    "Heavy Shield": shieldRow("heavyShield")
  },
  accessories: {
    "Belt of the Titan": { "system.cost": 750,  "system.description": ACCESSORY_DESC("Belt of the Titan") },
    "Lucky Pendant":     { "system.cost": 1500, "system.description": ACCESSORY_DESC("Lucky Pendant") },
    "Running Sandals":   { "system.cost": 750,  "system.description": ACCESSORY_DESC("Running Sandals") },
    "Trader's Pass":     { "system.cost": 1000, "system.description": ACCESSORY_DESC("Trader's Pass") },
    "Scouter":           { "system.cost": 750,  "system.description": ACCESSORY_DESC("Scouter") }
  },
  consumables: {
    // The doc's consumable line (renaming the legacy potions in place).
    "HP Potion":             { name: "Restorative",           "system.cost": 200, "system.restoreType": "hp",     "system.restoreAmount": 2 },
    "HP Potion (Strong)":    { name: "Strong Restorative",    "system.cost": 600, "system.restoreType": "hp",     "system.restoreAmount": 4 },
    "Restorative":           { "system.cost": 200, "system.restoreType": "hp",     "system.restoreAmount": 2 },
    "Strong Restorative":    { "system.cost": 600, "system.restoreType": "hp",     "system.restoreAmount": 4 },
    "Energy Drink":          { "system.cost": 300, "system.restoreType": "energy", "system.restoreAmount": 2 },
    "Energy Drink (Strong)": { name: "Strong Energy Drink",   "system.cost": 800, "system.restoreType": "energy", "system.restoreAmount": 4 },
    "Strong Energy Drink":   { "system.cost": 800, "system.restoreType": "energy", "system.restoreAmount": 4 }
  }
};

/** Canonical Style items seeded into the packs when missing (name → full item data). */
const PACK_SEEDS = {
  weapons: [
    { name: "Light Weapon",    style: "light",    img: "icons/weapons/daggers/dagger-straight-blue.webp" },
    { name: "Balanced Weapon", style: "balanced", img: "icons/weapons/swords/sword-guard-blue.webp" },
    { name: "Heavy Weapon",    style: "heavy",    img: "icons/weapons/hammers/hammer-war-spiked.webp" },
    { name: "Reach Weapon",    style: "reach",    img: "icons/weapons/polearms/spear-flared-steel.webp" },
    { name: "Thrown Weapon",   style: "thrown",   img: "icons/weapons/thrown/dagger-ringed-steel.webp" },
    { name: "Ranged Weapon",   style: "ranged",   img: "icons/weapons/bows/shortbow-recurve.webp" },
    { name: "Casting Weapon",  style: "casting",  img: "icons/weapons/staves/staff-orb-purple.webp" }
  ],
  armor: [
    { name: "Unarmored",    style: "unarmored", img: "icons/equipment/chest/shirt-simple-white.webp" },
    { name: "Light Armor",  style: "light",     img: "icons/equipment/chest/breastplate-leather-brown-belted.webp" },
    { name: "Medium Armor", style: "medium",    img: "icons/equipment/chest/breastplate-scale-grey.webp" },
    { name: "Heavy Armor",  style: "heavy",     img: "icons/equipment/chest/breastplate-cuirass-steel-grey.webp" }
  ]
};

/** Doc entries retired from the packs, per pack → item names to delete when found. */
const PACK_DELETES = {
  containers: ["Artisan's Kit"]
};

/**
 * Reconcile every system gear pack to the V2 tables. Unlocks each pack just long enough to
 * write, then restores its prior lock state. Seeds missing canonical Style items. Returns the
 * number of items updated.
 */
export async function auditGearPacks() {
  let updated = 0;
  const packKeys = new Set([...Object.keys(PACK_TARGETS), ...Object.keys(PACK_SEEDS)]);
  for (const key of packKeys) {
    const targets = PACK_TARGETS[key] ?? {};
    const pack = game.packs.get(`project-anime.${key}`);
    if (!pack) continue;
    const wasLocked = pack.locked;
    try {
      if (wasLocked) await pack.configure({ locked: false });
      const docs = await pack.getDocuments();
      const updates = [];
      const have = new Set(docs.map((d) => d.name));
      for (const doc of docs) {
        const target = targets[doc.name];
        if (target) updates.push({ _id: doc.id, ...target });
      }
      if (updates.length) {
        await Item.updateDocuments(updates, { pack: pack.collection });
        updated += updates.length;
      }
      // Seed the canonical Style items that aren't in the pack yet.
      const seeds = (PACK_SEEDS[key] ?? []).filter((s) => !have.has(s.name));
      if (seeds.length) {
        const type = key === "weapons" ? "weapon" : key === "armor" ? "armor" : "shield";
        const rowFn = key === "weapons" ? weaponRow : key === "armor" ? armorRow : shieldRow;
        const data = seeds.map((s) => {
          const item = { name: s.name, type, img: s.img, system: {} };
          for (const [path, value] of Object.entries(rowFn(s.style))) {
            foundry.utils.setProperty(item, path, value);
          }
          if (key === "armor" && ARMOR_DESCRIPTIONS[s.style]) item.system.description = ARMOR_DESCRIPTIONS[s.style];
          return item;
        });
        await Item.createDocuments(data, { pack: pack.collection });
        updated += data.length;
      }
    } catch (err) {
      console.error(`Project: Anime | Gear audit failed for pack "${key}"`, err);
    } finally {
      if (wasLocked) await pack.configure({ locked: true });
    }
  }
  if (updated) console.log(`Project: Anime | Gear audit — ${updated} compendium item(s) aligned to the V2 Style tables.`);
  return updated;
}

/** Seed images that shipped pointing at files Foundry's core icon set doesn't have → the fix. */
const BROKEN_ICON_FIXES = {
  "icons/weapons/staves/staff-orb-blue.webp": "icons/weapons/staves/staff-orb-purple.webp"
};

/**
 * Re-point any item still wearing a known-broken seed image (pack copies, world items, and
 * actor-owned copies alike). Runs every GM load — cheap and idempotent, no one-shot gate.
 */
export async function healBrokenItemIcons() {
  const fixFor = (img) => BROKEN_ICON_FIXES[img] ?? null;
  // Compendium copies (the seeded Style items).
  for (const key of Object.keys(PACK_SEEDS)) {
    const pack = game.packs.get(`project-anime.${key}`);
    if (!pack) continue;
    const broken = pack.index.filter((e) => fixFor(e.img)).map((e) => ({ _id: e._id, img: fixFor(e.img) }));
    if (!broken.length) continue;
    const wasLocked = pack.locked;
    try {
      if (wasLocked) await pack.configure({ locked: false });
      await Item.updateDocuments(broken, { pack: pack.collection });
      console.log(`Project: Anime | Repaired ${broken.length} broken item icon(s) in pack "${key}".`);
    } catch (err) {
      console.error(`Project: Anime | Icon repair failed for pack "${key}"`, err);
    } finally {
      if (wasLocked) await pack.configure({ locked: true });
    }
  }
  // World items + actor-owned copies (bought/imported before the fix).
  const worldFixes = game.items.filter((i) => fixFor(i.img)).map((i) => ({ _id: i.id, img: fixFor(i.img) }));
  if (worldFixes.length) await Item.updateDocuments(worldFixes);
  for (const a of game.actors ?? []) {
    const fixes = a.items.filter((i) => fixFor(i.img)).map((i) => ({ _id: i.id, img: fixFor(i.img) }));
    if (fixes.length) await a.updateEmbeddedDocuments("Item", fixes);
  }
}

/**
 * Delete retired items from the packs (PACK_DELETES). Runs every GM load — cheap and
 * idempotent, so it needs no one-shot gate.
 */
export async function purgeRetiredPackItems() {
  for (const [key, names] of Object.entries(PACK_DELETES)) {
    const pack = game.packs.get(`project-anime.${key}`);
    if (!pack) continue;
    const ids = pack.index.filter((e) => names.includes(e.name)).map((e) => e._id);
    if (!ids.length) continue;
    const wasLocked = pack.locked;
    try {
      if (wasLocked) await pack.configure({ locked: false });
      await Item.deleteDocuments(ids, { pack: pack.collection });
      console.log(`Project: Anime | Removed ${ids.length} retired item(s) from pack "${key}".`);
    } catch (err) {
      console.error(`Project: Anime | Retired-item purge failed for pack "${key}"`, err);
    } finally {
      if (wasLocked) await pack.configure({ locked: true });
    }
  }
}
