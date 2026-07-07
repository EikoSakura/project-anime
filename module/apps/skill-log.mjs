/**
 * Project: Anime — Advancement Log dialog.
 *
 * A standalone ApplicationV2 opened from the actor sheet. Shows the advancement summary
 * (Available / Spent / Total) and the full, scrollable ledger, each entry with a "Refund"
 * control that reverses the purchase and returns its advancement
 * (actor.refundAdvancementEntry). Mirrors the AdvancementApp pattern — registers in
 * `actor.apps` so it re-renders live as the actor changes (a refund here updates both this
 * dialog and the sheet's summary).
 */
import { advancementLedger, attributePeel } from "../helpers/skill-points.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SkillLogApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `pa-skill-log-${actor.id}` });
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "skill-log-app"],
    position: { width: 480, height: "auto" },
    window: { title: "PROJECTANIME.AdvLog.title", icon: "fa-solid fa-scroll" },
    actions: { refundEntry: SkillLogApp.#onRefundEntry }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/skill-log.hbs", scrollable: [".sp-log-list"] }
  };

  get title() {
    return `${game.i18n.localize("PROJECTANIME.AdvLog.title")} — ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext() {
    const { advInfo, advLog } = advancementLedger(this.actor);
    return { advInfo, advLog: advLog ?? [], editable: this.actor.isOwner };
  }

  /** Live-refresh as the actor changes by joining the document's app registry. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    this.actor.apps[this.id] = this;
  }

  _onClose(options) {
    delete this.actor.apps[this.id];
    super._onClose?.(options);
  }

  /** Refund a ledger entry: reverse the purchase and return its advancement (with
   *  confirmation). Item purchases phrase it as a delete; die steps stack, so refunding
   *  one cascades to every higher step of the same target — show the full amount coming
   *  back and a clearer prompt when more than the clicked step is being undone. */
  static async #onRefundEntry(event, target) {
    const id = target.closest("[data-entry-id]")?.dataset.entryId;
    if (!id) return;
    const log = this.actor.system.advancement?.log ?? [];
    const entry = log.find((e) => e.id === id);
    if (!entry || entry.kind === "legacy" || entry.kind === "rebuild") return;

    let promptKey = (entry.kind === "technique" || entry.kind === "talent")
      ? "PROJECTANIME.AdvLog.confirmDelete"
      : "PROJECTANIME.AdvLog.confirm";
    let amount = Number(entry.amount) || 0;
    if (entry.kind === "attribute" || entry.kind === "talentStep") {
      const currentBase = entry.kind === "attribute"
        ? this.actor.system.attributes?.[entry.ref]?.base
        : this.actor.system.talents?.[entry.ref]?.die;
      const peel = attributePeel(log, entry, currentBase);
      amount = peel.refund;
      if (peel.entries.length > 1) promptKey = "PROJECTANIME.AdvLog.confirmCascade";
    }

    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.AdvLog.confirmTitle") },
      content: `<p>${game.i18n.format(promptKey, { label: entry.label, amount })}</p>`
    });
    if (ok) await this.actor.refundAdvancementEntry(id);
  }
}
