/**
 * Project: Anime — Twists (v0.03 Enemies): the 12 pre-built enemy Skills.
 *
 * A Twist is a finished Skill an enemy can carry (up to 2; a 3rd makes it an Elite). Each is expressed
 * with the system's own Skill primitives — Effect + Modifiers + Inflict — so it costs EP (SP×2) and
 * fires through the normal Skill pipeline (drainHP, pierce, aura, inflicted Statuses, 1/Conflict…). The
 * Monster Creator adds them from this library; they are ordinary Skill items flagged `twist`.
 *
 * A code-defined library (the numbers derive from the Skill model, so there's nothing to precompute).
 * On first GM load `seedTwistSkills` materialises them into the Skills compendium as real Skill items —
 * that is where GMs pick them, via the Skill Browser — while `addTwistToActor` can still stamp one onto
 * an actor directly.
 */

/**
 * The 12 Twists. Each entry is the Skill item's `img` + `system` overrides; everything else takes the
 * Skill model's defaults. EP derives from SP×2 (the doc's own rule), so the printed EP costs are
 * approximate. Twists opt out of the 1/Conflict limiter (`noConflictLimit`, stamped in twistItemData),
 * so even the ones that inflict Stunned / Bound can be used freely.
 */
export const TWISTS = {
  // React · Attack from range 1: strike back first.
  counter: {
    img: "icons/svg/sword.svg",
    system: {
      actionType: "react", effect: "strike", target: "foe",
      range: { scope: "weapon", tiles: 1 },
      attributes: { attrA: "might", attrB: "agility" }, damageAttr: "attrA"
    }
  },
  // On hit, recover HP equal to half the damage dealt (drainHP is wired in dice.mjs applyDrain).
  drainTouch: {
    img: "icons/svg/blood.svg",
    system: {
      actionType: "action", effect: "strike", target: "foe", modifiers: ["drainHP"],
      attributes: { attrA: "might", attrB: "agility" }, damageAttr: "attrA"
    }
  },
  // Passive · Foes within 2 tiles Step Down Charm (an enemy-targeted Aura + Hinder Charm).
  dreadAura: {
    img: "icons/svg/terror.svg",
    system: {
      actionType: "passive", effect: "hinder", target: "foe", modifiers: ["aura"],
      effectAttrs: ["charm"], auraTarget: "enemy"
    }
  },
  // On hit: Bound (Duration 2).
  ensnare: {
    img: "icons/svg/net.svg",
    system: {
      actionType: "action", effect: "strike", target: "foe", modifiers: ["inflict"],
      inflictStatus: "bound",
      attributes: { attrA: "might", attrB: "agility" }, damageAttr: "attrA"
    }
  },
  // Unseen until you attack (the Vanish Effect → Vanished status).
  fade: {
    img: "icons/svg/invisible.svg",
    system: { actionType: "action", effect: "vanish", target: "self" }
  },
  // React · An ally within 2 tiles is attacked: take the hit instead (the Cover redirect).
  guard: {
    img: "icons/svg/shield.svg",
    system: { actionType: "react", effect: "custom", target: "ally", modifiers: ["cover"] }
  },
  // Restore HP equal to the Strong die value to an ally within range 3.
  mend: {
    img: "icons/svg/heal.svg",
    system: {
      actionType: "action", effect: "mend", target: "ally",
      range: { scope: "tiles", tiles: 3 },
      attributes: { attrA: "spirit", attrB: "mind" }, damageAttr: "attrA"
    }
  },
  // Attack ignores DEF and RES (the Pierce modifier).
  piercingShot: {
    img: "icons/svg/target.svg",
    system: {
      actionType: "action", effect: "strike", target: "foe", modifiers: ["pierce"],
      range: { scope: "tiles", tiles: 5 },
      attributes: { attrA: "agility", attrB: "mind" }, damageAttr: "attrA"
    }
  },
  // One Swarm of the same tier arrives at a board edge (no summon primitive — a custom Skill the GM
  // resolves by dropping a Swarm token).
  reinforce: {
    img: "icons/svg/upgrade.svg",
    system: { actionType: "action", effect: "custom", target: "self" }
  },
  // On hit: Stunned.
  stunningBlow: {
    img: "icons/svg/paralysis.svg",
    system: {
      actionType: "action", effect: "strike", target: "foe", modifiers: ["inflict"],
      inflictStatus: "stunned",
      attributes: { attrA: "might", attrB: "agility" }, damageAttr: "attrA"
    }
  },
  // Attack all targets within 2 tiles of a point in range (the Burst area).
  sweep: {
    img: "icons/svg/explosion.svg",
    system: {
      actionType: "action", effect: "strike", target: "foe", modifiers: ["burst"],
      range: { scope: "weapon", tiles: 2 },
      attributes: { attrA: "might", attrB: "agility" }, damageAttr: "attrA"
    }
  },
  // Allies within 2 tiles Step Up one Attribute (Duration 2) — an ally-Aura + Bolster.
  warcry: {
    img: "icons/svg/sun.svg",
    system: {
      actionType: "action", effect: "bolster", target: "ally", modifiers: ["aura"],
      effectAttrs: ["might"], auraTarget: "ally"
    }
  }
};

/** Twist keys in table order (the Monster Creator's picker + the compendium fallback). */
export const TWIST_KEYS = [
  "counter", "drainTouch", "dreadAura", "ensnare", "fade", "guard",
  "mend", "piercingShot", "reinforce", "stunningBlow", "sweep", "warcry"
];

/** Build the Skill-item creation data for one Twist (shared by the actor stamp + the compendium seed).
 *  Twists opt out of the 1/Conflict limiter (`noConflictLimit`) so they can be used freely. */
function twistItemData(key, { folderId = null } = {}) {
  const def = TWISTS[key];
  return {
    name: game.i18n.localize(`PROJECTANIME.Twist.${key}.name`),
    type: "skill",
    img: def.img,
    folder: folderId,
    system: {
      ...foundry.utils.deepClone(def.system),
      noConflictLimit: true,
      description: game.i18n.localize(`PROJECTANIME.Twist.${key}.desc`)
    },
    flags: { "project-anime": { twist: key } }
  };
}

/**
 * Stamp a Twist onto an actor as a Skill item (flagged `twist`). Returns the created item, or null on a
 * bad key / missing actor. The Skill model derives SP / EP / 1/Conflict from the effect + modifiers.
 */
export async function addTwistToActor(actor, key) {
  if (!actor || !TWISTS[key]) return null;
  const [created] = await actor.createEmbeddedDocuments("Item", [twistItemData(key)]);
  return created ?? null;
}

/**
 * Seed the 12 Twists into the system's Skills compendium as ordinary Skill items (each flagged
 * `twist`), filed under a "Twists" folder so they land in their own bag in the Skill Browser, then
 * reconcile any pre-existing seeded Twist so it opts out of the 1/Conflict limiter. Runs on demand from
 * the ready hook; idempotent by the `twist` flag (falling back to name), so re-runs and other worlds
 * sharing the install-wide pack never duplicate. Unlocks the pack just long enough to write, then
 * restores its prior lock state. Returns the number of Skills created.
 */
export async function seedTwistSkills() {
  const pack = game.packs?.get("project-anime.skills");
  if (!pack) return 0;
  const wasLocked = pack.locked;
  let created = 0;
  try {
    if (wasLocked) await pack.configure({ locked: false });
    const docs = await pack.getDocuments();
    const has = (key) => docs.some((d) =>
      d.getFlag("project-anime", "twist") === key ||
      d.name === game.i18n.localize(`PROJECTANIME.Twist.${key}.name`));
    const missing = TWIST_KEYS.filter((k) => !has(k));

    if (missing.length) {
      // File the seeded Twists under a "Twists" folder (→ a "Twists" bag in the browser). Non-fatal.
      let folderId = null;
      try {
        let folder = pack.folders?.find((f) => f.name === "Twists");
        if (!folder) [folder] = await Folder.createDocuments([{ name: "Twists", type: "Item", color: "#7b5cff" }], { pack: pack.collection });
        folderId = folder?.id ?? null;
      } catch (e) { console.warn("Project: Anime | Twist folder create skipped", e); }

      const made = await Item.createDocuments(missing.map((k) => twistItemData(k, { folderId })), { pack: pack.collection });
      created = made.length;
      if (created) console.log(`Project: Anime | Seeded ${created} Twist Skill(s) into the Skills compendium.`);
    }

    // Lift the once-per-encounter limit off any Twist seeded before the opt-out existed.
    const relimit = docs
      .filter((d) => d.getFlag("project-anime", "twist") &&
        (d.system?.noConflictLimit !== true || (Number(d.system?.usesPerConflict) || 0) !== 0))
      .map((d) => ({ _id: d.id, "system.noConflictLimit": true, "system.usesPerConflict": 0 }));
    if (relimit.length) {
      await Item.updateDocuments(relimit, { pack: pack.collection });
      console.log(`Project: Anime | Cleared the 1/Conflict limit on ${relimit.length} existing Twist Skill(s).`);
    }
  } catch (err) {
    console.error("Project: Anime | Twist seed failed", err);
  } finally {
    if (wasLocked) await pack.configure({ locked: true });
  }
  return created;
}
