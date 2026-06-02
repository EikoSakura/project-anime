import { rollContest } from "../helpers/rolls.mjs";

/**
 * GM-triggered dialog for opposed contest rolls.
 * Two actors each roll a chosen stat against each other.
 */
export class ContestDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {

  static DEFAULT_OPTIONS = {
    id: "shards-contest-dialog",
    classes: ["shards-of-mana", "contest-dialog"],
    window: {
      title: "SHARDS.Contest.Title",
      resizable: false
    },
    position: { width: 420, height: "auto" },
    actions: {
      rollContest: ContestDialog.#onRollContest
    }
  };

  static PARTS = {
    form: {
      template: "systems/shards-of-mana/templates/apps/contest-dialog.hbs"
    }
  };

  /** @override */
  async _prepareContext() {
    const stats = Object.entries(CONFIG.SHARDS.stats).map(([key, label]) => ({
      key,
      label: game.i18n.localize(label)
    }));

    // Pre-fill from selected and targeted tokens
    const controlled = canvas.tokens?.controlled ?? [];
    const targeted = Array.from(game.user.targets ?? []);

    const actorA = controlled[0]?.actor ?? null;
    const actorB = targeted[0]?.actor ?? controlled[1]?.actor ?? null;

    // Build actor list from all non-merchant actors the user can observe
    const actors = game.actors
      .filter(a => a.type !== "merchant" && a.testUserPermission(game.user, "OBSERVER"))
      .map(a => ({ id: a.id, name: a.name }));

    return {
      stats,
      actors,
      actorAId: actorA?.id ?? "",
      actorBId: actorB?.id ?? "",
      defaultStat: "str"
    };
  }

  static async #onRollContest(event, target) {
    const form = this.element.querySelector("form");
    const actorAId = form.querySelector("[name='actorA']").value;
    const actorBId = form.querySelector("[name='actorB']").value;
    const statKeyA = form.querySelector("[name='statA']").value;
    const statKeyB = form.querySelector("[name='statB']").value;

    const actorA = game.actors.get(actorAId);
    const actorB = game.actors.get(actorBId);

    if (!actorA || !actorB) {
      ui.notifications.warn(game.i18n.localize("SHARDS.Contest.SelectTwoActors"));
      return;
    }
    if (actorA.id === actorB.id) {
      ui.notifications.warn(game.i18n.localize("SHARDS.Contest.SelectDifferentActors"));
      return;
    }

    await rollContest(actorA, statKeyA, actorB, statKeyB);
    this.close();
  }
}
