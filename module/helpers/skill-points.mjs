import { PROJECTANIME, isCompanion } from "./config.mjs";

/**
 * Advancement ledger view-model (V2). Shared by the actor sheet (the drawer summary strip),
 * the Advancement dialog (slot usage), and the Log dialog so all read identical numbers.
 * `Spent = Σ log.amount`; slots used per option = count of entries of that kind.
 * See documents/actor.mjs for how entries are spent and refunded.
 */

/** Ledger entry kind → Font Awesome glyph. */
const KIND_ICONS = {
  technique: "fa-wand-sparkles",
  energy: "fa-bolt",
  hitBox: "fa-heart-circle-plus",
  talent: "fa-graduation-cap",
  rebuild: "fa-rotate",
  attribute: "fa-dumbbell",
  talentStep: "fa-arrow-up-right-dots",
  luckDie: "fa-clover",
  legacy: "fa-clock-rotate-left"
};

/**
 * @param {Actor} actor
 * @returns {{advInfo:{available:number,spent:number,total:number,slots:object}, advLog:Array|null}}
 *   `advLog` is null for actors without a ledger (NPCs); otherwise the rows, newest first.
 *   `slots` maps each advancement option key → {used, max, full}.
 */
export function advancementLedger(actor) {
  const sys = actor.system ?? {};
  const adv = sys.advancement ?? {};
  const value = adv.value ?? 0;

  const ledger = Array.isArray(adv.log) ? adv.log : null;
  let advLog = null;
  let spent = 0;
  const used = {};
  if (ledger) {
    spent = ledger.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    for (const e of ledger) used[e.kind] = (used[e.kind] ?? 0) + 1;
    advLog = ledger
      .map((e) => ({
        id: e.id,
        label: e.label,
        amount: Number(e.amount) || 0,
        kind: e.kind,
        icon: KIND_ICONS[e.kind] ?? "fa-star",
        time: e.time ?? 0,
        // Rebuild replaced a Technique that no longer exists — nothing to reverse.
        refundable: e.kind !== "legacy" && e.kind !== "rebuild"
      }))
      .sort((a, b) => b.time - a.time);
  }

  // A Companion spends against its own caps where they differ (rules: Companion Advancement).
  const companion = isCompanion(actor);
  const slots = {};
  for (const key of PROJECTANIME.advancementOptionKeys) {
    const opt = PROJECTANIME.advancementOptions[key] ?? {};
    const max = (companion ? opt.companionSlots : null) ?? opt.slots ?? 0;
    const u = used[key] ?? 0;
    slots[key] = { used: u, max, full: u >= max };
  }

  return {
    advInfo: { available: value, spent, total: value + spent, slots },
    advLog
  };
}

/** Back-compat alias while call sites migrate. */
export const skillPointLedger = (actor) => {
  const { advInfo, advLog } = advancementLedger(actor);
  return { spInfo: { available: advInfo.available, spent: advInfo.spent, granted: 0, total: advInfo.total }, spLog: advLog };
};

/**
 * The ledger steps a refund of one step entry reverses. Steps stack (d4→d6→d8→…), so refunding
 * one must also refund every HIGHER step of the same target — otherwise the ledger would claim
 * a die the base no longer reaches. Works for both `attribute` (ref = attribute key) and
 * `talentStep` (ref = `system.talents` key) entries, which both carry {from, to} step data.
 * Returns the affected entries, their combined advancements, and the die the target steps back
 * to (this entry's `from`).
 * @param {Array}  log           The actor's full ledger (`system.advancement.log`).
 * @param {object} entry         The clicked step entry.
 * @param {number} [currentBase] Current die; used only for the defensive no-`from` fallback.
 * @returns {{entries:Array, refund:number, base:number}}
 */
export function attributePeel(log, entry, currentBase) {
  const from = Number(entry?.data?.from);
  const hasFrom = Number.isFinite(from);
  const entries = (Array.isArray(log) ? log : []).filter(
    (e) => e.kind === entry.kind && e.ref === entry.ref &&
      (hasFrom ? Number(e.data?.from) >= from : e.id === entry.id)
  );
  const refund = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const base = Math.max(4, hasFrom ? from : (Number(currentBase) || 6) - 2);
  return { entries, refund, base };
}
