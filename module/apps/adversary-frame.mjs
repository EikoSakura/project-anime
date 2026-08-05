/* The Adversary frame: one status card per adversary-type actor with a
   token on the viewed scene, docked against the sidebar's left edge on
   every client and open through play. Cards appear and leave with their
   tokens and follow scene changes; tokens hidden from players keep
   their cards off player clients. Only the Storyteller's clicks write;
   the Grade plate flip is per-client display state. */

import { LADDER } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let frame = null;

/* Coalesces bursts of token, actor, and scene changes into one repaint. */
const refresh = foundry.utils.debounce(() => frame?.render(), 0);

export function registerAdversaryFrame() {
  Hooks.once("ready", () => {
    frame = new AdversaryFrame();
    frame.render(true);
  });
  for (const hook of ["createToken", "updateToken", "deleteToken", "updateActor", "canvasReady"]) Hooks.on(hook, refresh);
}

class AdversaryFrame extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "adversary-frame",
    window: { frame: false, positioned: false },
    actions: {
      flipPlate: this.#onFlipPlate,
      openSheet: this.#onOpenSheet,
      setSegment: this.#onSetSegment,
      toggleLuck: this.#onToggleLuck
    }
  };

  static PARTS = {
    cards: { template: "systems/project-anime/templates/apps/adversary-frame.hbs" }
  };

  /* Which cards' plates currently show their Difficulty number. Display state only, never stored. */
  #flipped = new Set();

  /* The frame stays open through play. */
  async close(options) {
    return this;
  }

  /* Rides inside #ui-right just before the sidebar as a ZERO-WIDTH flex
     item; the cards overlay off that anchor (see CSS). It must not take
     row width, or it squeezes the chat column and pushes the sidebar
     tabs when a tab is expanded. */
  _insertElement(element) {
    const existing = document.getElementById(element.id);
    if (existing) { existing.replaceWith(element); return; }
    const sidebar = document.getElementById("sidebar");
    if (sidebar?.parentElement) sidebar.parentElement.insertBefore(element, sidebar);
    else (document.getElementById("ui-right") ?? document.body).appendChild(element);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.members = AdversaryFrame.#sceneTokens().map(token => this.#member(token));
    return context;
  }

  /* One token per adversary on the viewed scene: linked tokens share
     their world actor, unlinked tokens each carry their own. */
  static #sceneTokens() {
    const out = [];
    const seen = new Set();
    for (const token of game.scenes.viewed?.tokens ?? []) {
      const actor = token.actor;
      if (actor?.type !== "adversary") continue;
      if (token.hidden && !game.user.isGM) continue;
      if (seen.has(actor.uuid)) continue;
      seen.add(actor.uuid);
      out.push(token);
    }
    return out;
  }

  #member(token) {
    const actor = token.actor;
    const ladder = LADDER[actor.system.grade];
    const flipped = this.#flipped.has(token.id);
    return {
      id: token.id,
      name: actor.name,
      img: actor.img,
      plate: { text: flipped ? ladder.grade : ladder.rank, cssVar: ladder.cssVar },
      overwhelmed: actor.system.hearts.value === 0,
      hearts: AdversaryFrame.#segments(actor.system.hearts),
      energy: AdversaryFrame.#segments(actor.system.energy),
      rival: actor.system.rival,
      luck: actor.system.luck
    };
  }

  static #segments({ value, max }) {
    return Array.from({ length: max }, (_, i) => i < value);
  }

  static #cardActor(target) {
    const id = target.closest("[data-token-id]")?.dataset.tokenId;
    return game.scenes.viewed?.tokens.get(id)?.actor;
  }

  static #onFlipPlate(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-token-id]")?.dataset.tokenId;
    if (!id) return;
    if (this.#flipped.has(id)) this.#flipped.delete(id);
    else this.#flipped.add(id);
    this.render();
  }

  static #onOpenSheet(event, target) {
    if (!game.user.isGM) return;
    AdversaryFrame.#cardActor(target)?.sheet.render(true);
  }

  static async #onSetSegment(event, target) {
    if (!game.user.isGM) return;
    const actor = AdversaryFrame.#cardActor(target);
    if (!actor) return;
    const kind = target.dataset.kind;
    if (kind !== "hearts" && kind !== "energy") return;
    const i = Number(target.dataset.i);
    const current = actor.system[kind].value;
    await actor.update({ [`system.${kind}.value`]: i + 1 === current ? i : i + 1 });
  }

  static async #onToggleLuck(event, target) {
    if (!game.user.isGM) return;
    const actor = AdversaryFrame.#cardActor(target);
    if (!actor) return;
    const luck = actor.system.toObject().luck;
    const slot = luck[Number(target.dataset.i)];
    if (!slot) return;
    slot.spent = !slot.spent;
    await actor.update({ "system.luck": luck });
  }
}
