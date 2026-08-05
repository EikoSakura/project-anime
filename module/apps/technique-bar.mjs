/* The Technique hotbar: ten slots over five pages, docked bottom center
   over the board. The bar belongs to the controlled token's actor, or
   the client's assigned character with nothing controlled — so players
   hold their character's bar and the Storyteller gets one per selected
   token. Slots hold that actor's Techniques and Traits and live on the
   actor, so the bar follows it across clients. It replaces the native
   macro hotbar and takes the 1 to 0 keys. */

import { LADDER, ATTRIBUTES } from "../config.mjs";
import { postItemCard } from "../chat.mjs";
import RollDialog from "./roll-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const PAGES = 5;
const SLOTS = 10;

/* Marks a drag that left a bar slot, so a slot drop moves instead of fills. */
const SLOT_TYPE = "application/x-project-anime-slot";

let bar = null;

const refresh = foundry.utils.debounce(() => bar?.render(), 0);

export function registerTechniqueBar() {
  for (let n = 1; n <= SLOTS; n++) {
    const digit = n % 10;
    game.keybindings.register("project-anime", `slot${n}`, {
      name: `PROJECTANIME.TechBar.Slot${n}`,
      editable: [{ key: `Digit${digit}` }],
      onDown: () => bar?.useKey(n) ?? false
    });
  }
  Hooks.once("ready", () => {
    bar = new TechniqueBar();
    bar.render(true);
  });
  Hooks.on("updateActor", actor => {
    if (actor === bar?.actor) refresh();
  });
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, item => {
      if (item.parent === bar?.actor) refresh();
    });
  }
  Hooks.on("updateUser", (user, changes) => {
    if (user === game.user && "character" in changes) refresh();
  });
  Hooks.on("controlToken", refresh);
}

class TechniqueBar extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "technique-bar",
    window: { frame: false, positioned: false },
    actions: {
      useSlot: this.#onUseSlot,
      page: this.#onPage
    }
  };

  static PARTS = {
    bar: { template: "systems/project-anime/templates/apps/technique-bar.hbs" }
  };

  /* The visible page. Display state only, never stored. */
  #page = 0;

  /* The slot index the current drag left from, and whether a slot drop
     took it. A drag that ends anywhere else clears its slot. */
  #dragFrom = null;

  #dropped = false;

  get actor() {
    const controlled = canvas.ready ? canvas.tokens.controlled : [];
    if (controlled.length === 1 && controlled[0].actor?.system.hotbar) return controlled[0].actor;
    const assigned = game.user.character;
    return assigned?.system.hotbar ? assigned : null;
  }

  /* The bar stays open through play. */
  async close(options) {
    return this;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    context.actor = actor;
    if (!actor) return context;
    const energy = actor.system.energy.value;
    const ids = actor.system.hotbar[this.#page] ?? [];
    context.page = this.#page + 1;
    context.slots = Array.from({ length: SLOTS }, (_, i) => {
      const key = (i + 1) % 10;
      const item = actor.items.get(ids[i]);
      if (!item) return { key, i };
      const step = LADDER[item.system.rank];
      const technique = item.type === "technique";
      return {
        key,
        i,
        id: item.id,
        name: item.name,
        img: item.img,
        cssVar: step.cssVar,
        technique,
        triggered: technique && item.system.kind === "Triggered",
        drained: technique && step.mod > energy,
        n: step.mod
      };
    });
    return context;
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("contextmenu", this.#onContextMenu.bind(this));
    this.element.addEventListener("dragstart", this.#onDragStart.bind(this));
    this.element.addEventListener("dragend", this.#onDragEnd.bind(this));
    this.element.addEventListener("dragover", this.#onDragOver.bind(this));
    this.element.addEventListener("dragleave", this.#onDragLeave.bind(this));
    this.element.addEventListener("drop", this.#onDrop.bind(this));
  }

  /* A key press 1 to 0 while the bar is up belongs to the bar. */
  useKey(n) {
    if (!this.actor) return false;
    this.#use(n - 1);
    return true;
  }

  /* Opens the roll flow with the slot's item preselected: a Technique as
     the locked first die, a Trait on the highest Attribute with the Trait
     chosen. The dialog handles any Energy spend; the bar deducts nothing. */
  #use(i) {
    const actor = this.actor;
    const item = actor?.items.get(actor.system.hotbar[this.#page]?.[i]);
    if (!item) return;
    if (item.type === "technique") return RollDialog.open(actor, { kind: "technique", id: item.id });
    const attributes = actor.system.attributes;
    const key = ATTRIBUTES.reduce((best, a) => attributes[a.key] > attributes[best.key] ? a : best).key;
    RollDialog.open(actor, { kind: "attribute", key }, item.id);
  }

  async #writeSlots(mutate) {
    const actor = this.actor;
    if (!actor) return;
    const hotbar = actor.system.toObject().hotbar;
    mutate(hotbar[this.#page]);
    await actor.update({ "system.hotbar": hotbar });
  }

  static #onUseSlot(event, target) {
    this.#use(Number(target.dataset.i));
  }

  static #onPage(event, target) {
    this.#page = (this.#page + Number(target.dataset.dir) + PAGES) % PAGES;
    this.render();
  }

  async #onContextMenu(event) {
    event.preventDefault();
    const item = this.actor?.items.get(event.target.closest(".slot")?.dataset.itemId);
    if (item) await postItemCard(item);
  }

  #onDragStart(event) {
    const slot = event.target.closest(".slot[data-item-id]");
    const item = slot ? this.actor?.items.get(slot.dataset.itemId) : null;
    if (!item) return;
    this.#dragFrom = Number(slot.dataset.i);
    this.#dropped = false;
    event.dataTransfer.setData(SLOT_TYPE, String(this.#dragFrom));
    event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
  }

  async #onDragEnd(event) {
    const from = this.#dragFrom;
    this.#dragFrom = null;
    if (from === null || this.#dropped) return;
    await this.#writeSlots(slots => {
      slots[from] = "";
    });
  }

  #onDragOver(event) {
    const slot = event.target.closest(".slot");
    if (!slot) return;
    event.preventDefault();
    slot.classList.add("dragover");
  }

  #onDragLeave(event) {
    event.target.closest(".slot")?.classList.remove("dragover");
  }

  async #onDrop(event) {
    const slot = event.target.closest(".slot");
    const actor = this.actor;
    if (!slot || !actor) return;
    event.preventDefault();
    slot.classList.remove("dragover");
    const to = Number(slot.dataset.i);

    // A drag between slots moves or swaps; back onto itself stands.
    const fromSlot = event.dataTransfer.getData(SLOT_TYPE);
    if (fromSlot !== "") {
      this.#dropped = true;
      this.#dragFrom = null;
      const from = Number(fromSlot);
      if (from === to) return;
      return this.#writeSlots(slots => {
        [slots[from], slots[to]] = [slots[to], slots[from]];
      });
    }

    // A drag from the character sheet fills the slot.
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data.type !== "Item" || !data.uuid) return;
    const item = await fromUuid(data.uuid);
    if (!item || item.parent !== actor || !["technique", "trait"].includes(item.type)) return;
    await this.#writeSlots(slots => {
      slots[to] = item.id;
    });
  }
}
