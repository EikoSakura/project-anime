import { applyStructuredRules } from "../helpers/effects.mjs";
import { attributePeel } from "../helpers/skill-points.mjs";

/**
 * Enforce one equipped item per equipment slot after `item` becomes equipped:
 * one weapon per hand, one armor, at most two accessories, and a two-handed weapon
 * (or a shield) clears the conflicting hand. Called from the `updateItem` hook, so it
 * covers EVERY equip path (the bag quick-equip button, the item-sheet checkbox, …);
 * the paperdoll's own equip logic already clears conflicts, so this is a no-op there.
 * Unequips the displaced items in one batch (the resulting equipped→false updates don't
 * re-trigger enforcement).
 */
export function enforceEquipExclusivity(actor, item) {
  if (!actor || !item?.system?.equipped) return;
  const others = actor.items.filter((i) => i.id !== item.id && i.system?.equipped);
  const clears = [];
  const clear = (it) => clears.push({ _id: it.id, "system.equipped": false });

  switch (item.type) {
    case "weapon":
    case "shield": {
      // Weapons and shields share the two hand slots; each hand holds one of either,
      // so dual-wielding — including a shield in each hand — is allowed. A two-handed
      // weapon spans both hands, whether it's the incoming item or the one already worn.
      const hand = item.system.hand === "off" ? "off" : "main";
      const twoHanded = item.type === "weapon" && item.system.grip === "two";
      for (const it of others) {
        if (it.type !== "weapon" && it.type !== "shield") continue;
        const otherTwoHanded = it.type === "weapon" && it.system.hand === "main" && it.system.grip === "two";
        if (it.system.hand === hand || twoHanded || otherTwoHanded) clear(it);
      }
      break;
    }
    case "armor":
      for (const it of others) if (it.type === "armor") clear(it);
      break;
    case "accessory": {
      // At most two accessories; drop the oldest (by sort) until the new one fits.
      const accs = others.filter((i) => i.type === "accessory").sort((a, b) => (a.sort || 0) - (b.sort || 0));
      while (accs.length > 1) clear(accs.shift());
      break;
    }
  }
  if (clears.length) actor.updateEmbeddedDocuments("Item", clears);
}

/**
 * Refund a deleted Skill's logged Skill Points. Called from the `deleteItem` hook so that
 * removing a Skill by ANY path (drawer trash, Skill-Builder, creator, drag-out) returns the
 * SP that was logged against it and prunes its ledger entries — the ledger never dangles, and
 * a Skill's SP is always recoverable (matching the "remove = refund" creation behaviour).
 * Only the user who made the deletion runs it (they own the actor); a no-op for NPCs (no log).
 */
export function refundSkillOnDelete(item, userId) {
  if (game.user.id !== userId) return;
  const actor = item.parent;
  if (actor?.documentName !== "Actor" || item.type !== "skill") return;
  const log = actor.system.skillPoints?.log;
  if (!Array.isArray(log) || !log.length) return;
  const mine = log.filter((e) => e.ref === item.id);
  if (!mine.length) return;
  const refund = mine.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const value = actor.system.skillPoints?.value ?? 0;
  return actor.update({
    "system.skillPoints.value": value + refund,
    "system.skillPoints.log": log.filter((e) => e.ref !== item.id)
  });
}

/** Default icon for the innate Natural Attack (an unarmed strike). */
export const NATURAL_ATTACK_IMG = "icons/svg/combat.svg";

/**
 * Source data for the innate "Natural Attack" every creature carries — an unarmed strike usable
 * with no weapon equipped, available alongside (in addition to) any equipped weapons. It's an
 * ordinary weapon item flagged `natural`, so the sheet always surfaces it in the quick-attack
 * panel, keeps it out of the carried-gear grid, and protects it from accidental equip/delete. It
 * rolls through `rollAttack` like any Basic Attack (no Energy), weighs nothing (size 0), and is
 * fully tunable on its item sheet (Might + Agility melee strike by default).
 */
export function naturalAttackData() {
  return {
    name: game.i18n.localize("PROJECTANIME.NaturalAttack.name"),
    type: "weapon",
    img: NATURAL_ATTACK_IMG,
    system: {
      accuracy: { attrA: "might", attrB: "agility", mod: 0 },
      // Unarmed strikes hit at full Accuracy but land light (weapon table: Unarmed DMG −2).
      damage: { mod: -2, type: "physical" },
      range: { type: "melee", tiles: 1 },
      size: 0, cost: 0, equipped: false, hand: "main", grip: "one"
    },
    flags: { "project-anime": { natural: true } }
  };
}

/**
 * Give a creature its innate Natural Attack if it lacks one. Idempotent (a no-op once present);
 * Characters and NPCs only — Party actors have no combat stats. Used by the one-time backfill for
 * actors that predate the feature; new actors get theirs baked in at creation (preCreateActor).
 */
export async function ensureNaturalAttack(actor) {
  if (!actor || (actor.type !== "character" && actor.type !== "npc")) return;
  if (actor.items.some((i) => i.type === "weapon" && i.getFlag("project-anime", "natural"))) return;
  return actor.createEmbeddedDocuments("Item", [naturalAttackData()]);
}

/**
 * Extends the base Actor with Project: Anime behaviour. All stat derivation
 * (including equipped gear and carried load) lives in the type DataModels;
 * this class only exposes roll data so formulas can reference attributes.
 */
export class ProjectAnimeActor extends Actor {
  /**
   * @override — apply core ActiveEffect changes, then our no-code structured
   * rules (effect.flags["project-anime"].rules). This runs in Foundry's native
   * slot: after prepareBaseData (attribute `value` seeded from `base`) and before
   * prepareDerivedData (which reads the `.bonus` fields and clamps the dice), so
   * Bolster/Hinder and flat stat bonuses land on the right base fields.
   */
  applyActiveEffects() {
    super.applyActiveEffects();
    applyStructuredRules(this);
  }

  /**
   * @override — keep a non-Passive Skill's Active Effect off its carrier. Such an effect is an
   * on-use TEMPLATE, copied onto recipients only when the Skill is used (dice.mjs
   * applySkillEffects reads `item.effects`), never a buff on the owner. Foundry transfers it
   * like any item effect, which would surface a do-nothing token icon + Effects-drawer row —
   * its rules are already gated dormant by effects.mjs `effectIsLive`. This generator is the
   * single chokepoint behind `appliedEffects`, `temporaryEffects` (token icons) and the sheet's
   * effect list, so filtering it here removes that phantom while leaving the effect on the item
   * for on-use copying. Passive Skills keep transferring so their always-on rules still apply.
   */
  *allApplicableEffects() {
    for (const effect of super.allApplicableEffects()) {
      const parent = effect.parent;
      if (parent?.documentName === "Item" && parent.type === "skill" && parent.system?.actionType !== "passive") continue;
      yield effect;
    }
  }

  /** @override */
  getRollData() {
    const data = this.system.getRollData?.() ?? { ...this.system };
    data.name = this.name;
    // Initiative tiebreak fraction (rules: an enemy acts before any player it ties with) — read
    // by the initiative formula as `@tiebreak.npc`.
    data.tiebreak = { npc: this.type === "npc" ? 1 : 0 };
    return data;
  }

  /* -------------------------------------------- */
  /*  Skill-Point ledger                          */
  /* -------------------------------------------- */

  /**
   * Spend Skill Points and record the transaction. Deducts `amount` from the unspent pool; an
   * actor WITH a ledger (a PC) appends a refundable `log` entry describing the purchase, while an
   * actor WITHOUT one (an NPC) tallies the spend into the legacy `spent` scalar instead — the
   * derived SP readout (skill-points.mjs) already adds that scalar, so the Total stays balanced
   * either way. Any additional document changes for the purchase (the raised attribute, the bought
   * stat) are passed in `changes` and written in the same atomic update. Callers check affordability.
   * @param {{amount:number, label:string, kind:string, ref?:string, data?:object, changes?:object}} entry
   */
  async recordSkillPointSpend({ amount, label, kind, ref = "", data = {}, changes = {} }) {
    const sp = this.system.skillPoints ?? {};
    const nextValue = Math.max(0, (sp.value ?? 0) - amount);
    if (Array.isArray(sp.log)) {
      const log = [...sp.log];
      log.push({ id: foundry.utils.randomID(), label, amount, kind, ref, data, time: Date.now() });
      return this.update({ ...changes, "system.skillPoints.value": nextValue, "system.skillPoints.log": log });
    }
    return this.update({ ...changes, "system.skillPoints.value": nextValue, "system.skillPoints.spent": (sp.spent ?? 0) + amount });
  }

  /**
   * Refund a single ledger entry: reverse the change it recorded and return its SP to the pool.
   *  • skill     — delete the Skill (the deleteItem hook refunds + prunes every entry for it).
   *  • improve   — undo the refinement on the Skill (rank, accuracy, energy, range, modifier).
   *  • attribute — step the base attribute back down, cascading to any higher steps of it.
   *  • stat      — undo the combat-stat purchase.
   * "legacy" (pre-ledger advancement lump) carries nothing to reverse and is not refundable.
   */
  async refundSkillPointEntry(entryId) {
    const log = this.system.skillPoints?.log ?? [];
    const entry = log.find((e) => e.id === entryId);
    if (!entry || entry.kind === "legacy") return;
    const value = this.system.skillPoints?.value ?? 0;
    const amount = Number(entry.amount) || 0;
    const without = log.filter((e) => e.id !== entryId);

    if (entry.kind === "skill") {
      const item = this.items.get(entry.ref);
      if (item) return item.delete(); // deleteItem hook refunds + prunes all of this skill's entries
      // The skill is already gone: refund every entry that referenced it, and drop them.
      const refund = log.filter((e) => e.ref === entry.ref).reduce((s, e) => s + (Number(e.amount) || 0), 0);
      return this.update({ "system.skillPoints.value": value + refund, "system.skillPoints.log": log.filter((e) => e.ref !== entry.ref) });
    }

    if (entry.kind === "improve") {
      const item = this.items.get(entry.ref);
      if (item) await this.#reverseImprovement(item, entry);
      return this.update({ "system.skillPoints.value": value + amount, "system.skillPoints.log": without });
    }

    if (entry.kind === "attribute") {
      // Attribute raises stack (d4→d6→d8→…), so refunding one step also refunds every higher
      // step of the same attribute — otherwise the ledger would claim a die the base no longer
      // reaches. Drop this step + all higher ones, return their combined SP, and step the base
      // back down to where this step began.
      const { entries, refund, base } = attributePeel(log, entry, this.system.attributes?.[entry.ref]?.base);
      const ids = new Set(entries.map((e) => e.id));
      return this.update({
        [`system.attributes.${entry.ref}.base`]: base,
        "system.skillPoints.value": value + refund,
        "system.skillPoints.log": log.filter((e) => !ids.has(e.id))
      });
    }

    // stat — reverse the combat-stat purchase in the same update as the refund.
    return this.update({ ...this.#reverseStat(entry), "system.skillPoints.value": value + amount, "system.skillPoints.log": without });
  }

  /** Undo one Skill refinement (Improve mode) recorded by an "improve" ledger entry. */
  async #reverseImprovement(item, entry) {
    const sys = item.system;
    const key = entry.data?.key;
    switch (entry.data?.op) {
      case "rank": return item.update({ "system.rank": Math.max(1, (sys.rank ?? 1) - 1) });
      case "accuracy": return item.update({ "system.accuracyMod": Math.max(0, (sys.accuracyMod ?? 0) - 1) });
      case "damage": return item.update({ "system.damageMod": Math.max(0, (sys.damageMod ?? 0) - 1) });
      case "energy": return item.update({ "system.energyReduction": Math.max(0, (sys.energyReduction ?? 0) - 1) });
      case "range": return item.update({ "system.range.tiles": Math.max(0, (sys.range?.tiles ?? 0) - 1) });
      case "modifier": {
        // A multi-take Modifier (Affinity Damage/Status) refunds ONE take — the newest; the key
        // itself only goes when this was the last take.
        if (key === "affinityDamage" && (sys.affinityDamages ?? []).length > 1) {
          return item.update({ "system.affinityDamages": sys.affinityDamages.slice(0, -1) });
        }
        if (key === "affinityStatus" && (sys.affinityStatusIds ?? []).length > 1) {
          return item.update({ "system.affinityStatusIds": sys.affinityStatusIds.slice(0, -1) });
        }
        const upd = { "system.modifiers": (sys.modifiers ?? []).filter((m) => m !== key) };
        if (key === "affinityDamage") upd["system.affinityDamages"] = [];
        if (key === "affinityStatus") upd["system.affinityStatusIds"] = [];
        if (key && sys.modifierGrowth?.[key] != null) upd[`system.modifierGrowth.-=${key}`] = null;
        return item.update(upd);
      }
      case "growth":
        if (key) return item.update({ [`system.modifierGrowth.${key}`]: Math.max(0, (sys.modifierGrowth?.[key] ?? 0) - 1) });
    }
  }

  /** Build the actor-update that reverses a "stat" advancement entry (a combat-stat buy). */
  #reverseStat(entry) {
    const sys = this.system;
    switch (entry.ref) {
      case "hp": { const max = Math.max(0, (sys.hp?.max ?? 0) - 2); return { "system.hp.max": max, "system.hp.value": Math.min(sys.hp?.value ?? 0, max) }; }
      case "energy": { const max = Math.max(0, (sys.energy?.base ?? sys.energy?.max ?? 0) - 2); return { "system.energy.max": max, "system.energy.value": Math.min(sys.energy?.value ?? 0, max) }; }
      case "carryingCapacity": return { "system.carryingCapacity.bonus": Math.max(0, (sys.carryingCapacity?.bonus ?? 0) - 1) };
      case "movement": return { "system.movement.bonus": Math.max(0, (sys.movement?.bonus ?? 0) - 1) };
    }
    return {};
  }
}
