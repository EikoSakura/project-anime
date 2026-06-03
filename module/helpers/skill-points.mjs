/**
 * Skill-Point ledger view-model. Shared by the actor sheet (the drawer summary strip) and the
 * Skill Point Log dialog so both read identical numbers. Characters use the stored ledger
 * (`Spent = Σ log.amount`); NPCs (no ledger) fall back to the derived sum (advancement scalar +
 * every owned skill's spCost). See documents/actor.mjs for how entries are spent and refunded.
 */

/** Ledger entry kind → Font Awesome glyph. Swappable like the other icon maps. */
const KIND_ICONS = {
  skill: "fa-wand-sparkles",
  improve: "fa-arrow-up-right-dots",
  attribute: "fa-dumbbell",
  stat: "fa-heart-circle-plus",
  legacy: "fa-clock-rotate-left"
};

/**
 * @param {Actor} actor
 * @returns {{spInfo:{available:number,spent:number,granted:number,total:number}, spLog:Array|null}}
 *   `spLog` is null for actors without a ledger (NPCs); otherwise the rows, newest first.
 */
export function skillPointLedger(actor) {
  const sys = actor.system ?? {};
  const sp = sys.skillPoints ?? {};
  const value = sp.value ?? 0;

  // Granted (free) abilities don't touch the pool but still count toward the Total.
  let grantedSP = 0;
  for (const i of actor.items) {
    if (i.type === "skill" && i.getFlag("project-anime", "granted")) grantedSP += Number(i.system?.spCost ?? 0) || 0;
  }

  const ledger = Array.isArray(sp.log) ? sp.log : null;
  let spLog = null;
  let spent;
  if (ledger) {
    spent = ledger.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    spLog = ledger
      .map((e) => ({
        id: e.id,
        label: e.label,
        amount: Number(e.amount) || 0,
        kind: e.kind,
        icon: KIND_ICONS[e.kind] ?? "fa-star",
        time: e.time ?? 0,
        // Everything is refundable except the legacy lump (it carries nothing to reverse).
        // Attribute steps stack, so refunding one cascades to its higher steps — see attributePeel().
        refundable: e.kind !== "legacy"
      }))
      // Newest first; backfilled entries (time 0) sit at the bottom in insertion order.
      .sort((a, b) => b.time - a.time);
  } else {
    let selfSP = 0;
    for (const i of actor.items) if (i.type === "skill" && !i.getFlag("project-anime", "granted")) selfSP += Number(i.system?.spCost ?? 0) || 0;
    spent = (sp.spent ?? 0) + selfSP;
  }

  return {
    spInfo: { available: value, spent, granted: grantedSP, total: value + spent + grantedSP },
    spLog
  };
}

/**
 * The ledger steps a refund of one attribute entry reverses. Attribute raises stack
 * (d4→d6→d8→…), so refunding a step must also refund every HIGHER step of the same attribute —
 * otherwise the ledger would claim a die the base no longer reaches and `Spent` would drift.
 * Returns the affected entries, their combined SP, and the base the attribute steps back to (this
 * entry's `from`). Shared by the actor's refund and the Skill-Point Log's confirm prompt so both
 * agree on what a click will undo.
 * @param {Array}  log           The actor's full ledger (`system.skillPoints.log`).
 * @param {object} entry         The clicked attribute entry.
 * @param {number} [currentBase] Current base die; used only for the defensive no-`from` fallback.
 * @returns {{entries:Array, refund:number, base:number}}
 */
export function attributePeel(log, entry, currentBase) {
  const from = Number(entry?.data?.from);
  const hasFrom = Number.isFinite(from);
  const entries = (Array.isArray(log) ? log : []).filter(
    (e) => e.kind === "attribute" && e.ref === entry.ref &&
      (hasFrom ? Number(e.data?.from) >= from : e.id === entry.id)
  );
  const refund = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const base = Math.max(4, hasFrom ? from : (Number(currentBase) || 6) - 2);
  return { entries, refund, base };
}
