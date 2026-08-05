/* The Party HUD: one status card per character in the Party folder,
   docked over the left edge of the board on every client and open
   through play. Heart, Energy, and Luck controls write only on actors
   the client owns; the Grade plate flip is per-client display state;
   every card renders the same everywhere. */

import { LADDER } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let hud = null;

/* Coalesces bursts of actor changes and runs after the directory tree
   has rebuilt, so card order tracks the sidebar. */
const refresh = foundry.utils.debounce(() => hud?.render(), 0);

export function registerPartyHud() {
  Hooks.once("ready", async () => {
    await ensurePartyFolder();
    hud = new PartyHud();
    hud.render(true);
  });
  const hooks = ["createActor", "updateActor", "deleteActor", "createFolder", "updateFolder", "deleteFolder"];
  for (const hook of hooks) Hooks.on(hook, refresh);
  Hooks.on("renderSceneControls", () => hud?.reposition());
}

/* The roster is an Actors folder flagged as the party: characters inside
   it are the party, wherever it sits and whatever it is renamed to. */
function partyFolder() {
  return game.actors.folders.find(f => f.getFlag("project-anime", "party")) ?? null;
}

/* One client creates the folder for a world that lacks it. */
async function ensurePartyFolder() {
  if (partyFolder() || game.user !== game.users.activeGM) return;
  await Folder.implementation.create({
    name: game.i18n.localize("PROJECTANIME.PartyHud.Folder"),
    type: "Actor",
    flags: { "project-anime": { party: true } }
  });
}

class PartyHud extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "party-hud",
    window: { frame: false, positioned: false },
    actions: {
      flipPlate: this.#onFlipPlate,
      openSheet: this.#onOpenSheet,
      setSegment: this.#onSetSegment,
      toggleLuck: this.#onToggleLuck
    }
  };

  static PARTS = {
    cards: { template: "systems/project-anime/templates/apps/party-hud.hbs" }
  };

  /* Which cards' plates currently show their die face. Display state only, never stored. */
  #flipped = new Set();

  /* The HUD stays open through play. */
  async close(options) {
    return this;
  }

  /* Docks the column just right of the scene controls, wherever their
     rail ends right now. */
  reposition() {
    if (!this.element) return;
    const controls = document.getElementById("scene-controls");
    const left = controls ? Math.round(controls.getBoundingClientRect().right) + 12 : 16;
    this.element.style.left = `${left}px`;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.reposition();
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.members = PartyHud.#partyActors().map(actor => this.#member(actor));
    return context;
  }

  /* Character actors inside the party folder's branch of the actors
     directory, in directory order: each folder lists its subfolders'
     entries, then its own. */
  static #partyActors() {
    const party = partyFolder();
    if (!party) return [];
    const out = [];
    const walk = node => {
      for (const child of node.children) walk(child);
      for (const entry of node.entries) {
        if (entry.type === "character") out.push(entry);
      }
    };
    const find = node => node.folder === party ? node : node.children.map(find).find(n => n);
    const branch = find(game.actors.tree);
    if (branch) walk(branch);
    return out;
  }

  #member(actor) {
    const grade = LADDER[actor.system.grade];
    const flipped = this.#flipped.has(actor.id);
    return {
      id: actor.id,
      name: actor.name,
      img: actor.img,
      plate: { text: flipped ? grade.die : grade.rank, flipped, cssVar: grade.cssVar },
      overwhelmed: actor.system.hearts.value === 0,
      hearts: PartyHud.#segments(actor.system.hearts),
      energy: PartyHud.#segments(actor.system.energy),
      luck: actor.system.luck
    };
  }

  static #segments({ value, max }) {
    return Array.from({ length: max }, (_, i) => i < value);
  }

  static #cardActor(target) {
    return game.actors.get(target.closest("[data-actor-id]")?.dataset.actorId);
  }

  static #onFlipPlate(event, target) {
    const id = PartyHud.#cardActor(target)?.id;
    if (!id) return;
    if (this.#flipped.has(id)) this.#flipped.delete(id);
    else this.#flipped.add(id);
    this.render();
  }

  static #onOpenSheet(event, target) {
    PartyHud.#cardActor(target)?.sheet.render(true);
  }

  static async #onSetSegment(event, target) {
    const actor = PartyHud.#cardActor(target);
    if (!actor?.isOwner) return;
    const kind = target.dataset.kind;
    if (kind !== "hearts" && kind !== "energy") return;
    const i = Number(target.dataset.i);
    const current = actor.system[kind].value;
    await actor.update({ [`system.${kind}.value`]: i + 1 === current ? i : i + 1 });
  }

  static async #onToggleLuck(event, target) {
    const actor = PartyHud.#cardActor(target);
    if (!actor?.isOwner) return;
    const luck = actor.system.toObject().luck;
    const slot = luck[Number(target.dataset.i)];
    if (!slot) return;
    slot.spent = !slot.spent;
    await actor.update({ "system.luck": luck });
  }
}
