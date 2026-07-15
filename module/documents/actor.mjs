import { applyStructuredRules } from "../helpers/effects.mjs";
import { gateLockedTechnique } from "../helpers/config.mjs";
import { attributePeel } from "../helpers/skill-points.mjs";

/**
 * Enforce one equipped item per equipment slot after `item` becomes equipped:
 * one weapon per hand, one armor, at most two accessories, and a two-handed weapon
 * (or a shield) clears the conflicting hand. Called from the `updateItem` hook, so it
 * covers EVERY equip path (the bag quick-equip button, the item-sheet checkbox, …);
 * the paperdoll's own equip logic already clears conflicts, so this is a no-op there.
 */
export function enforceEquipExclusivity(actor, item) {
  if (!actor || !item?.system?.equipped) return;
  const others = actor.items.filter((i) => i.id !== item.id && i.system?.equipped);
  const clears = [];
  const clear = (it) => clears.push({ _id: it.id, "system.equipped": false });

  switch (item.type) {
    case "weapon":
    case "shield": {
      // Weapons and shields share the two hand slots; each hand holds one of either.
      // A two-handed weapon spans both hands, whether incoming or already worn.
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
 * Refund a deleted Technique's logged advancements. Called from the `deleteItem` hook so
 * removal by ANY path (drawer trash, Builder, creator, drag-out) returns the advancements
 * logged against it and prunes its ledger entries — the ledger never dangles. Only the user
 * who made the deletion runs it (they own the actor). Talents are actor data — their removal
 * refunds inside `Actor#removeTalent`.
 */
export function refundSkillOnDelete(item, userId) {
  if (game.user.id !== userId) return;
  const actor = item.parent;
  if (actor?.documentName !== "Actor") return;
  if (item.type !== "skill") return;
  const log = actor.system.advancement?.log;
  if (!Array.isArray(log) || !log.length) return;
  const mine = log.filter((e) => e.ref === item.id);
  if (!mine.length) return;
  const refund = mine.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const value = actor.system.advancement?.value ?? 0;
  return actor.update({
    "system.advancement.value": value + refund,
    "system.advancement.log": log.filter((e) => e.ref !== item.id)
  });
}

/** Default icon for the innate Natural Attack (an unarmed strike). */
export const NATURAL_ATTACK_IMG = "icons/svg/combat.svg";

/**
 * Source data for the innate "Natural Attack" every creature carries — an unarmed strike
 * usable with no weapon equipped. It's an ordinary weapon item flagged `natural`, so the
 * sheet always surfaces it in the quick-attack panel, keeps it out of the carried-gear grid,
 * and protects it from accidental equip/delete. V2 profile: Damage 1, Threshold 10, 1 tile.
 */
export function naturalAttackData() {
  return {
    name: game.i18n.localize("PROJECTANIME.NaturalAttack.name"),
    type: "weapon",
    img: NATURAL_ATTACK_IMG,
    system: {
      accuracy: { attrA: "might", attrB: "agility", mod: 0 },
      damage: { value: 1 },
      threshold: 10,
      weaponType: "Unarmed",
      range: { type: "melee", tiles: 1 },
      size: 0, cost: 0, equipped: false, hand: "main", grip: "one"
    },
    flags: { "project-anime": { natural: true } }
  };
}

/**
 * Give a creature its innate Natural Attack if it lacks one. Idempotent; Characters and NPCs
 * only — Party actors have no combat stats.
 */
export async function ensureNaturalAttack(actor) {
  if (!actor || (actor.type !== "character" && actor.type !== "npc")) return;
  if (actor.items.some((i) => i.type === "weapon" && i.getFlag("project-anime", "natural"))) return;
  return actor.createEmbeddedDocuments("Item", [naturalAttackData()]);
}

/**
 * Extends the base Actor with Project: Anime behaviour. All stat derivation
 * (including equipped gear) lives in the type DataModels; this class exposes roll data
 * and the advancement ledger.
 */
export class ProjectAnimeActor extends Actor {
  /**
   * @override — apply core ActiveEffect changes, then our no-code structured
   * rules (effect.flags["project-anime"].rules). This runs in Foundry's native
   * slot: after prepareBaseData (attribute `value` seeded from `base`) and before
   * prepareDerivedData, so Empower/Weaken and flat stat bonuses land on the right fields.
   */
  applyActiveEffects() {
    super.applyActiveEffects();
    applyStructuredRules(this);
  }

  /**
   * @override — keep a non-Passive Technique's Active Effect off its carrier. Such an effect
   * is an on-use TEMPLATE, copied onto recipients only when the Technique is used, never a
   * buff on the owner. Passive Techniques keep transferring so their always-on rules apply.
   */
  *allApplicableEffects() {
    for (const effect of super.allApplicableEffects()) {
      const parent = effect.parent;
      if (parent?.documentName === "Item" && parent.type === "skill") {
        if (parent.system?.actionType !== "passive") continue;
        // A gated Villain's Passive assigned to a later Gate stays locked until it opens.
        if (gateLockedTechnique(this, parent)) continue;
      }
      yield effect;
    }
  }

  /** @override */
  getRollData() {
    const data = this.system.getRollData?.() ?? { ...this.system };
    data.name = this.name;
    data.tiebreak = { npc: this.type === "npc" ? 1 : 0 };
    return data;
  }

  /* -------------------------------------------- */
  /*  Advancement ledger (V2)                     */
  /* -------------------------------------------- */

  /**
   * Spend one advancement and record the transaction. Deducts from the unspent pool and
   * appends a refundable `log` entry describing the purchase. Any additional document changes
   * (the raised attribute, the bought box) are passed in `changes` and written in the same
   * atomic update. Callers check affordability and slot caps.
   * @param {{label:string, kind:string, ref?:string, data?:object, changes?:object, amount?:number}} entry
   */
  async recordAdvancementSpend({ label, kind, ref = "", data = {}, changes = {}, amount = 1 }) {
    const adv = this.system.advancement ?? {};
    const nextValue = Math.max(0, (adv.value ?? 0) - amount);
    const log = [...(adv.log ?? [])];
    log.push({ id: foundry.utils.randomID(), label, amount, kind, ref, data, time: Date.now() });
    return this.update({ ...changes, "system.advancement.value": nextValue, "system.advancement.log": log });
  }

  /**
   * Spend SEVERAL advancement purchases in one atomic actor update — the staged-Confirm path
   * of the Advancement dialog. Every purchase keeps its own refundable log entry.
   * @param {Array<{label:string, kind:string, ref?:string, data?:object, amount?:number}>} entries
   * @param {object} [changes]  Actor update paths written alongside the spend.
   */
  async recordAdvancementSpends(entries, changes = {}) {
    if (!entries?.length) return Object.keys(changes).length ? this.update(changes) : this;
    const adv = this.system.advancement ?? {};
    const total = entries.reduce((s, e) => s + (Number(e.amount) || 1), 0);
    const nextValue = Math.max(0, (adv.value ?? 0) - total);
    const log = [...(adv.log ?? [])];
    for (const { label, kind, ref = "", data = {}, amount = 1 } of entries) {
      log.push({ id: foundry.utils.randomID(), label, amount, kind, ref, data, time: Date.now() });
    }
    return this.update({ ...changes, "system.advancement.value": nextValue, "system.advancement.log": log });
  }

  /**
   * Remove one embedded Talent (`system.talents`): unlink every weapon/shield/Technique built
   * under it (their rolls fall back to the Attribute pair), refund + prune its ledger entries
   * (the grant and its Step Ups) in the same update, then delete the row.
   */
  async removeTalent(id) {
    if (!this.system.talents?.[id]) return;
    const unlink = this.items
      .filter((i) => i.system?.talentId === id)
      .map((i) => ({ _id: i.id, "system.talentId": "" }));
    if (unlink.length) await this.updateEmbeddedDocuments("Item", unlink);
    const changes = { [`system.talents.-=${id}`]: null };
    const log = this.system.advancement?.log;
    if (Array.isArray(log) && log.length) {
      const mine = log.filter((e) => e.ref === id);
      if (mine.length) {
        const refund = mine.reduce((s, e) => s + (Number(e.amount) || 0), 0);
        changes["system.advancement.value"] = (this.system.advancement?.value ?? 0) + refund;
        changes["system.advancement.log"] = log.filter((e) => e.ref !== id);
      }
    }
    return this.update(changes);
  }

  /**
   * Refund a single ledger entry: reverse the change it recorded and return its advancement.
   *  • technique          — delete the Item (the deleteItem hook refunds + prunes its entries).
   *  • talent             — remove the embedded row (removeTalent refunds + prunes its entries).
   *  • energy / hitBox    — take back the bought box.
   *  • attribute          — step the base attribute back down, cascading to higher steps.
   *  • talentStep         — step the Talent's die back down, cascading likewise.
   *  • luckDie            — drop one step; the derived Luck Die size recomputes from the count.
   * "rebuild" replaced a Technique that no longer exists and "legacy" carries nothing to
   * reverse — neither is refundable.
   */
  async refundAdvancementEntry(entryId) {
    const log = this.system.advancement?.log ?? [];
    const entry = log.find((e) => e.id === entryId);
    if (!entry || entry.kind === "legacy" || entry.kind === "rebuild") return;
    const value = this.system.advancement?.value ?? 0;
    const amount = Number(entry.amount) || 1;
    const without = log.filter((e) => e.id !== entryId);

    if (entry.kind === "technique") {
      const item = this.items.get(entry.ref);
      if (item) return item.delete(); // deleteItem hook refunds + prunes all of this item's entries
      const refund = log.filter((e) => e.ref === entry.ref).reduce((s, e) => s + (Number(e.amount) || 0), 0);
      return this.update({ "system.advancement.value": value + refund, "system.advancement.log": log.filter((e) => e.ref !== entry.ref) });
    }

    if (entry.kind === "talent") {
      if (this.system.talents?.[entry.ref]) return this.removeTalent(entry.ref); // refunds + prunes
      const refund = log.filter((e) => e.ref === entry.ref).reduce((s, e) => s + (Number(e.amount) || 0), 0);
      return this.update({ "system.advancement.value": value + refund, "system.advancement.log": log.filter((e) => e.ref !== entry.ref) });
    }

    if (entry.kind === "energy") {
      const max = Math.max(0, (this.system.energy?.base ?? this.system.energy?.max ?? 0) - 1);
      return this.update({
        "system.energy.max": max,
        "system.energy.value": Math.min(this.system.energy?.value ?? 0, max),
        "system.advancement.value": value + amount,
        "system.advancement.log": without
      });
    }

    if (entry.kind === "hitBox") {
      // `_source` max — the derived max is Wound-shaved, so refunding through it would
      // permanently remove one extra authored box per Wound.
      const src = this._source.system?.hp ?? {};
      const max = Math.max(1, (src.max ?? 1) - 1);
      return this.update({
        "system.hp.max": max,
        "system.hp.value": Math.min(src.value ?? 0, max),
        "system.advancement.value": value + amount,
        "system.advancement.log": without
      });
    }

    if (entry.kind === "attribute") {
      // Steps stack (d4→d6→d8→…), so refunding one also refunds every higher step.
      const { entries, refund, base } = attributePeel(log, entry, this.system.attributes?.[entry.ref]?.base);
      const ids = new Set(entries.map((e) => e.id));
      return this.update({
        [`system.attributes.${entry.ref}.base`]: base,
        "system.advancement.value": value + refund,
        "system.advancement.log": log.filter((e) => !ids.has(e.id))
      });
    }

    if (entry.kind === "luckDie") {
      // The Luck Die size is derived from the COUNT of these entries, so dropping any one just
      // steps it back down (d12→d10→d8→d6). No stored state to reverse and no cascade needed —
      // the remaining entries fully describe the die.
      return this.update({
        "system.advancement.value": value + amount,
        "system.advancement.log": without
      });
    }

    if (entry.kind === "talentStep") {
      const talent = this.system.talents?.[entry.ref];
      const { entries, refund, base } = attributePeel(log, entry, talent?.die);
      const ids = new Set(entries.map((e) => e.id));
      const changes = {
        "system.advancement.value": value + refund,
        "system.advancement.log": log.filter((e) => !ids.has(e.id))
      };
      if (talent) changes[`system.talents.${entry.ref}.die`] = Math.clamp(base, 4, 12);
      return this.update(changes);
    }
  }
}
