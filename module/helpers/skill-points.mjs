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
    const attrs = sys.attributes ?? {};
    spLog = ledger
      .map((e) => ({
        id: e.id,
        label: e.label,
        amount: Number(e.amount) || 0,
        kind: e.kind,
        icon: KIND_ICONS[e.kind] ?? "fa-star",
        time: e.time ?? 0,
        // Refundable unless it's the legacy lump, or a non-top attribute step (refund the
        // most-recent raise first — its `to` still matches the attribute's current base).
        refundable: e.kind !== "legacy" && (e.kind !== "attribute" || attrs[e.ref]?.base === e.data?.to)
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
