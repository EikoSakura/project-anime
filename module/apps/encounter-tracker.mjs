/* The Encounter Tracker: replaces the Combat sidebar tab with the glass
   Spotlight panel. The core encounter create and cycle controls stay
   above the panel; below them sit the Spotlight plate, the Up Next
   queue, the party and Storyteller rows, and Begin or End in the
   footer. The Storyteller places the Spotlight with the row hands and
   RETURN; players raise hands with NEXT and claim an open Spotlight
   with TAKE through the Storyteller's client. The Grade plate flip is
   per-client display state. */

import { LADDER } from "../config.mjs";

export class EncounterTracker extends foundry.applications.sidebar.tabs.CombatTracker {
  static DEFAULT_OPTIONS = {
    classes: ["project-anime-encounter"],
    actions: {
      flipGrade: this.#onFlipGrade,
      toggleHand: this.#onToggleHand,
      takeSpotlight: this.#onTakeSpotlight,
      giveSpotlight: this.#onGiveSpotlight,
      returnSpotlight: this.#onReturnSpotlight
    }
  };

  static PARTS = {
    controls: { template: "systems/project-anime/templates/apps/encounter-controls.hbs" },
    panel: {
      template: "systems/project-anime/templates/apps/encounter-tracker.hbs",
      scrollable: [".ebody"]
    }
  };

  /* Which Grade plates currently show their Difficulty number. Display
     state only, never stored. */
  #flipped = new Set();

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId === "controls") await this._prepareCombatContext(context, options);
    else if (partId === "panel") await this.#preparePanelContext(context);
    return context;
  }

  /* The roster lists as soon as combatants join; Begin only opens the
     Spotlight. */
  async #preparePanelContext(context) {
    const combat = this.viewed;
    const gm = game.user.isGM;
    const started = !!combat?.started;
    Object.assign(context, { gm, started, hasCombat: !!combat, name: combat?.name });
    if (!combat) return;

    const holder = started ? combat.combatant ?? null : null;
    if (started) {
      if (holder) {
        context.plate = {
          name: holder.name,
          img: await this._getCombatantThumbnail(holder),
          st: !holder.isParty,
          side: game.i18n.localize(`PROJECTANIME.Encounter.${holder.isParty ? "Party" : "Storyteller"}`),
          return: gm && !holder.isParty
        };
      } else {
        context.plate = {
          open: true,
          hint: game.i18n.localize(`PROJECTANIME.Encounter.${gm ? "HintStoryteller" : "HintPlayer"}`)
        };
      }
    }

    const queue = started ? combat.raisedHands : [];
    context.queue = queue.map((c, i) => ({ no: i + 1, name: c.name }));

    context.party = [];
    context.storyteller = [];
    for (const combatant of combat.turns) {
      if (!combatant.visible) continue;
      const row = await this.#row(combatant, holder, queue, started);
      (combatant.isParty ? context.party : context.storyteller).push(row);
    }
  }

  async #row(combatant, holder, queue, started) {
    const gm = game.user.isGM;
    const down = combatant.isDefeated;
    const raised = !!combatant.system.hand?.raised && !down && !combatant.hidden;
    const pos = queue.indexOf(combatant) + 1;
    const row = {
      id: combatant.id,
      name: combatant.name,
      img: await this._getCombatantThumbnail(combatant),
      active: combatant === holder,
      down,
      hidden: combatant.hidden,
      state: down
        ? game.i18n.localize(`PROJECTANIME.Encounter.${combatant.isParty ? "Overwhelmed" : "Defeated"}`)
        : null
    };
    const actor = combatant.actor;
    if (!combatant.isParty && actor?.type === "adversary") {
      const ladder = LADDER[actor.system.grade];
      const flipped = this.#flipped.has(combatant.id);
      row.grade = {
        text: flipped ? ladder.grade : ladder.rank,
        flipped,
        cssVar: ladder.cssVar,
        title: game.i18n.format("PROJECTANIME.Encounter.GradeTitle", { rank: ladder.rank, number: ladder.grade })
      };
    }
    if (gm) {
      row.badge = raised ? pos : 0;
      row.eye = !combatant.isParty;
      row.eyeLabel = game.i18n.localize(`PROJECTANIME.Encounter.${combatant.hidden ? "Reveal" : "Hide"}`);
      row.skull = true;
      row.skullLabel = game.i18n.localize(`PROJECTANIME.Encounter.${combatant.isParty ? "Overwhelmed" : "Defeated"}`);
      row.hand = started && !down;
    } else if (started && combatant.isParty && combatant.isOwner && !down) {
      const stHolds = !!holder && !holder.isParty;
      row.take = !stHolds && combatant !== holder;
      row.takeLocked = !game.users.activeGM;
      row.next = true;
      row.raised = !!combatant.system.hand?.raised;
      row.nextLabel = row.raised && pos
        ? game.i18n.format("PROJECTANIME.Encounter.NextN", { n: pos })
        : game.i18n.localize("PROJECTANIME.Encounter.Next");
    } else {
      row.badge = raised ? pos : 0;
    }
    return row;
  }

  /* The combatant context menu, without the initiative entries. */
  _getEntryContextOptions() {
    const dropped = ["COMBATANT.ACTIONS.Clear", "COMBATANT.ACTIONS.Reroll"];
    return super._getEntryContextOptions().filter(o => !dropped.includes(o.label));
  }

  /* The encounter context menu, without the initiative reset. */
  _getCombatContextOptions() {
    return super._getCombatContextOptions().filter(o => o.label !== "COMBAT.InitiativeReset");
  }

  /* A marked row loses its hand and the Spotlight if it held it. */
  async _onToggleDefeatedStatus(combatant) {
    await super._onToggleDefeatedStatus(combatant);
    if (!combatant.isDefeated) return;
    await combatant.lowerHand();
    if (this.viewed?.combatant === combatant) await this.viewed.update({ turn: null });
  }

  /* A hidden row loses its hand and the Spotlight if it held it. */
  async _onToggleHidden(combatant) {
    const hidden = !combatant.hidden;
    await combatant.update({ hidden });
    if (!hidden) return;
    await combatant.lowerHand();
    if (this.viewed?.combatant === combatant) await this.viewed.update({ turn: null });
  }

  #combatantFor(target) {
    const id = target.closest("[data-combatant-id]")?.dataset.combatantId;
    return this.viewed?.combatants.get(id) ?? null;
  }

  static #onFlipGrade(event, target) {
    const id = target.closest("[data-combatant-id]")?.dataset.combatantId;
    if (!id) return;
    if (this.#flipped.has(id)) this.#flipped.delete(id);
    else this.#flipped.add(id);
    this.render({ parts: ["panel"] });
  }

  static async #onToggleHand(event, target) {
    const combatant = this.#combatantFor(target);
    if (!combatant?.isOwner || combatant.isDefeated) return;
    await combatant.toggleHand();
  }

  static async #onTakeSpotlight(event, target) {
    const combat = this.viewed;
    const combatant = this.#combatantFor(target);
    if (!combat || !combatant?.isOwner) return;
    const storyteller = game.users.activeGM;
    if (!storyteller) return;
    await storyteller.query("project-anime.takeSpotlight", {
      combatId: combat.id,
      combatantId: combatant.id
    });
  }

  static async #onGiveSpotlight(event, target) {
    if (!game.user.isGM) return;
    const combatant = this.#combatantFor(target);
    if (!combatant || combatant.isDefeated) return;
    await this.viewed.giveSpotlight(combatant);
  }

  static async #onReturnSpotlight(event, target) {
    if (!game.user.isGM) return;
    await this.viewed?.returnSpotlight();
  }
}

/* The combatant sheet behind the context menu's Update entry, without
   the initiative field. */
export class EncounterCombatantConfig extends foundry.applications.sheets.CombatantConfig {
  static PARTS = {
    body: {
      root: true,
      template: "systems/project-anime/templates/apps/combatant-config.hbs"
    },
    footer: { template: "templates/generic/form-footer.hbs" }
  };
}

export function registerEncounterTracker() {
  CONFIG.ui.combat = EncounterTracker;
  /* TAKE's disabled state follows the Storyteller's connection. */
  Hooks.on("userConnected", () => ui.combat?.render({ parts: ["panel"] }));
  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    foundry.documents.Combatant, "project-anime", EncounterCombatantConfig,
    { makeDefault: true, label: "PROJECTANIME.Sheet.Combatant" }
  );
}
