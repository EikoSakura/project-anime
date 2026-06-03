/**
 * Project: Anime — Skill Point Log dialog.
 *
 * A standalone ApplicationV2 opened from the Skills drawer. Shows the Skill-Point summary
 * (Available / Spent / Total) and the full, scrollable transaction ledger, each entry with a
 * "Refund" control that reverses the purchase and returns its SP. Mirrors the AdvancementApp
 * pattern — registers in `actor.apps` so it re-renders live as the actor changes (a refund here
 * updates both this dialog and the sheet's summary). Keeping the log in its own dialog keeps the
 * drawer tidy as the ledger grows over a long campaign.
 */
import { skillPointLedger, attributePeel } from "../helpers/skill-points.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SkillLogApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `pa-skill-log-${actor.id}` });
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "skill-log-app"],
    position: { width: 480, height: "auto" },
    window: { title: "PROJECTANIME.SkillLog.title", icon: "fa-solid fa-scroll" },
    actions: { refundSp: SkillLogApp.#onRefundSp }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/skill-log.hbs", scrollable: [".sp-log-list"] }
  };

  get title() {
    return `${game.i18n.localize("PROJECTANIME.SkillLog.title")} — ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext() {
    const { spInfo, spLog } = skillPointLedger(this.actor);
    return { spInfo, spLog: spLog ?? [], editable: this.actor.isOwner };
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

  /** Refund a ledger entry: reverse the purchase and return its SP (with confirmation). */
  static async #onRefundSp(event, target) {
    const id = target.closest("[data-entry-id]")?.dataset.entryId;
    if (!id) return;
    const log = this.actor.system.skillPoints?.log ?? [];
    const entry = log.find((e) => e.id === id);
    if (!entry || entry.kind === "legacy") return;

    // Default: undo this one entry for its own SP (Skills phrase it as a delete). Attribute
    // raises stack, so refunding one cascades to its higher steps — show the full SP coming
    // back, and a clearer prompt when more than the clicked step is being undone.
    let promptKey = entry.kind === "skill" ? "PROJECTANIME.SkillLog.confirmSkill" : "PROJECTANIME.SkillLog.confirm";
    let amount = Number(entry.amount) || 0;
    if (entry.kind === "attribute") {
      const peel = attributePeel(log, entry, this.actor.system.attributes?.[entry.ref]?.base);
      amount = peel.refund;
      if (peel.entries.length > 1) promptKey = "PROJECTANIME.SkillLog.confirmAttribute";
    }

    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.SkillLog.confirmTitle") },
      content: `<p>${game.i18n.format(promptKey, { label: entry.label, amount })}</p>`
    });
    if (ok) await this.actor.refundSkillPointEntry(id);
  }
}
