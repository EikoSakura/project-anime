/* The Encounter documents: Combat and Combatant subclasses with no
   initiative anywhere. Begin opens round 1 with the Spotlight open;
   combat.turn marks the Spotlight holder and null means open on the
   party side. Rows sort party first, then the Storyteller side,
   alphabetical inside each. Only Spotlight clicks move the turn; rolls
   and roll cards never touch it. The spotlit token wears Foundry's
   native turn marker through the ordinary combatant lookup. */

import ParticipantData from "./data/combatant.mjs";

export class EncounterCombat extends foundry.documents.Combat {
  /* Party rows first, then the Storyteller side, alphabetical inside each. */
  _sortCombatants(a, b) {
    if (a.isParty !== b.isParty) return a.isParty ? -1 : 1;
    return a.name.localeCompare(b.name) || (a.id > b.id ? 1 : -1);
  }

  /* Begin: round 1 with the Spotlight open. */
  async startCombat() {
    this._playCombatSound("startEncounter");
    const updateData = { round: 1, turn: null };
    Hooks.callAll("combatStart", this, updateData);
    await this.update(updateData, { turnEvents: false });
    await foundry.documents.ActiveEffect.registry.refresh("combatStart", { combat: this });
    return this;
  }

  /* There is no turn or round advance. */
  async nextTurn() { return this; }
  async previousTurn() { return this; }
  async nextRound() { return this; }
  async previousRound() { return this; }

  /* No initiative anywhere. */
  async rollInitiative() { return this; }

  /* Raised hands in raise order. */
  get raisedHands() {
    return this.turns
      .filter(c => c.system.hand?.raised && !c.isDefeated && !c.hidden)
      .sort((a, b) => (a.system.hand.order - b.system.hand.order) || a.name.localeCompare(b.name));
  }

  /* The Spotlight to one row: reveal it, point the turn at it, lower its
     hand. */
  async giveSpotlight(combatant) {
    if (combatant.hidden) await combatant.update({ hidden: false });
    const turn = this.turns.findIndex(t => t.id === combatant.id);
    if (turn < 0) return;
    await this.update({ turn });
    await combatant.lowerHand();
  }

  /* The Spotlight to the first raised hand, lowering it, else to open. */
  async returnSpotlight() {
    const [first] = this.raisedHands;
    if (first) return this.giveSpotlight(first);
    await this.update({ turn: null });
  }

  /* A deleted holder leaves the Spotlight open. */
  _onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId) {
    const holder = collection === "combatants" && this.turn !== null ? this.turns[this.turn] : null;
    super._onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId);
    if (holder && ids.includes(holder.id) && userId === game.userId) this.update({ turn: null });
  }
}

export class EncounterCombatant extends foundry.documents.Combatant {
  /* Character actors sit on the party side; everything else is the
     Storyteller's. */
  get isParty() {
    return this.actor?.type === "character";
  }

  /* Every combatant carries the hand data. A type change must replace
     the system field through the ForcedReplacement operator. */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;
    if (this.type !== CONST.BASE_DOCUMENT_TYPE) return;
    this.updateSource({
      type: "participant",
      system: foundry.data.operators.ForcedReplacement.create(foundry.utils.deepClone(this._source.system) ?? {})
    });
  }

  async toggleHand() {
    if (this.system.hand?.raised) return this.lowerHand();
    const order = Math.max(0, ...this.parent.combatants.map(c => c.system.hand?.order ?? 0)) + 1;
    return this.update({ system: { hand: { raised: true, order } } });
  }

  async lowerHand() {
    if (!this.system.hand?.raised) return this;
    return this.update({ system: { hand: { raised: false, order: 0 } } });
  }
}

export function registerCombat() {
  CONFIG.Combat.documentClass = EncounterCombat;
  CONFIG.Combatant.documentClass = EncounterCombatant;
  CONFIG.Combatant.dataModels.participant = ParticipantData;

  /* Players cannot move the Spotlight themselves; TAKE asks the active
     Storyteller's client to place it, which also serializes racing
     claims. */
  CONFIG.queries["project-anime.takeSpotlight"] = async ({ combatId, combatantId }, { user }) => {
    const combat = game.combats.get(combatId);
    const combatant = combat?.combatants.get(combatantId);
    if (!combat?.started || !combatant?.isParty) return;
    if (!user || !combatant.testUserPermission(user, "OWNER")) return;
    if (combatant.isDefeated || combatant.hidden) return;
    const holder = combat.combatant;
    if (holder && !holder.isParty) return;
    await combat.giveSpotlight(combatant);
  };
}
