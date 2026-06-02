import { applyStructuredRules } from "../helpers/effects.mjs";

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
    case "weapon": {
      const hand = item.system.hand === "off" ? "off" : "main";
      for (const it of others) if (it.type === "weapon" && it.system.hand === hand) clear(it);
      // A two-handed grip occupies both hands → also free the off-hand.
      if (item.system.grip === "two") {
        for (const it of others) if (it.type === "shield" || (it.type === "weapon" && it.system.hand === "off")) clear(it);
      }
      break;
    }
    case "shield":
      // Shields equip to the off-hand: clear another off-hand item and a 2H main weapon.
      for (const it of others) {
        if (it.type === "shield") clear(it);
        else if (it.type === "weapon" && it.system.hand === "off") clear(it);
        else if (it.type === "weapon" && it.system.hand === "main" && it.system.grip === "two") clear(it);
      }
      break;
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

  /** @override */
  getRollData() {
    const data = this.system.getRollData?.() ?? { ...this.system };
    data.name = this.name;
    return data;
  }

  /* -------------------------------------------- */
  /*  Skill-Point ledger                          */
  /* -------------------------------------------- */

  /**
   * Spend Skill Points and record the transaction in the ledger. Deducts `amount` from the
   * unspent pool and appends a `log` entry describing the purchase so it can be Refunded later.
   * Any additional document changes for the purchase (the raised attribute, the bought stat)
   * are passed in `changes` and written in the same atomic update. Callers check affordability.
   * @param {{amount:number, label:string, kind:string, ref?:string, data?:object, changes?:object}} entry
   */
  async recordSkillPointSpend({ amount, label, kind, ref = "", data = {}, changes = {} }) {
    const value = this.system.skillPoints?.value ?? 0;
    const log = [...(this.system.skillPoints?.log ?? [])];
    log.push({ id: foundry.utils.randomID(), label, amount, kind, ref, data, time: Date.now() });
    return this.update({ ...changes, "system.skillPoints.value": Math.max(0, value - amount), "system.skillPoints.log": log });
  }

  /**
   * Refund a single ledger entry: reverse the change it recorded and return its SP to the pool.
   *  • skill     — delete the Skill (the deleteItem hook refunds + prunes every entry for it).
   *  • improve   — undo the refinement on the Skill (rank, accuracy, energy, range, modifier).
   *  • attribute — step the base attribute back down.
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

    // attribute / stat — reverse on this actor, in the same update as the refund.
    return this.update({ ...this.#reverseAdvancement(entry), "system.skillPoints.value": value + amount, "system.skillPoints.log": without });
  }

  /** Undo one Skill refinement (Improve mode) recorded by an "improve" ledger entry. */
  async #reverseImprovement(item, entry) {
    const sys = item.system;
    const key = entry.data?.key;
    switch (entry.data?.op) {
      case "rank": return item.update({ "system.rank": Math.max(1, (sys.rank ?? 1) - 1) });
      case "accuracy": return item.update({ "system.accuracyMod": Math.max(0, (sys.accuracyMod ?? 0) - 1) });
      case "energy": return item.update({ "system.energyReduction": Math.max(0, (sys.energyReduction ?? 0) - 1) });
      case "range": return item.update({ "system.range.tiles": Math.max(0, (sys.range?.tiles ?? 0) - 1) });
      case "modifier": {
        const upd = { "system.modifiers": (sys.modifiers ?? []).filter((m) => m !== key) };
        if (key && sys.modifierGrowth?.[key] != null) upd[`system.modifierGrowth.-=${key}`] = null;
        return item.update(upd);
      }
      case "growth":
        if (key) return item.update({ [`system.modifierGrowth.${key}`]: Math.max(0, (sys.modifierGrowth?.[key] ?? 0) - 1) });
    }
  }

  /** Build the actor-update that reverses an "attribute" or "stat" advancement entry. */
  #reverseAdvancement(entry) {
    const sys = this.system;
    if (entry.kind === "attribute") {
      const base = sys.attributes?.[entry.ref]?.base ?? 4;
      const from = Number(entry.data?.from);
      return { [`system.attributes.${entry.ref}.base`]: Math.max(4, Number.isFinite(from) ? from : base - 2) };
    }
    switch (entry.ref) {
      case "hp": { const max = Math.max(0, (sys.hp?.max ?? 0) - 2); return { "system.hp.max": max, "system.hp.value": Math.min(sys.hp?.value ?? 0, max) }; }
      case "energy": { const max = Math.max(0, (sys.energy?.max ?? 0) - 2); return { "system.energy.max": max, "system.energy.value": Math.min(sys.energy?.value ?? 0, max) }; }
      case "carryingCapacity": return { "system.carryingCapacity.bonus": Math.max(0, (sys.carryingCapacity?.bonus ?? 0) - 1) };
      case "movement": return { "system.movement.bonus": Math.max(0, (sys.movement?.bonus ?? 0) - 1) };
    }
    return {};
  }
}
