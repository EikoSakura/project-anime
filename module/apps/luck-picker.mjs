import { applyLuckSwap, readSplash } from "../chat.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* Owned actors holding recorded, unspent Luck Dice. */
function luckHolders() {
  return game.actors
    .filter(a => a.isOwner && a.system.luck?.some(d => !d.spent && d.value > 0))
    .map(a => ({
      id: a.id,
      name: a.name,
      dice: a.system.luck
        .map((d, index) => ({ index, value: d.value, spent: d.spent }))
        .filter(d => !d.spent && d.value > 0)
    }));
}

/* The Spend Luck picker, opened from a die face on a roll card. Picking a
   die marks it spent on its owner (the spender's own actor), then the swap
   applies directly when this user may update the message, or through the
   active GM over the system socket. */
export default class LuckPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ message, dieIndex, ...options } = {}) {
    super(options);
    this.#message = message;
    this.#dieIndex = dieIndex;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "luck-picker"],
    position: { width: 260, height: "auto" },
    actions: {
      pick: this.#onPick
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/luck-picker.hbs" }
  };

  static #instance = null;

  #message;

  #dieIndex;

  static open(message, dieIndex) {
    this.#instance?.close();
    this.#instance = new this({ message, dieIndex });
    this.#instance.render(true);
  }

  get title() {
    return game.i18n.localize("PROJECTANIME.Luck.Title");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.holders = luckHolders();
    return context;
  }

  _onClose(options) {
    super._onClose(options);
    if (LuckPicker.#instance === this) LuckPicker.#instance = null;
  }

  static async #onPick(event, target) {
    const actor = game.actors.get(target.dataset.actor);
    const index = Number(target.dataset.die);
    const die = actor?.system.luck[index];
    if (!die || die.spent || !die.value) return this.close();
    const message = this.#message;
    const direct = message.canUserModify(game.user, "update");
    if (!direct && !game.users.activeGM) return this.close();
    const luck = actor.system.luck.map(d => ({ ...d }));
    luck[index] = { ...luck[index], spent: true };
    await actor.update({ "system.luck": luck });
    if (direct) await applyLuckSwap(message, this.#dieIndex, die.value, actor.name);
    else game.socket.emit("system.project-anime", {
      type: "luckSwap",
      messageId: message.id,
      dieIndex: this.#dieIndex,
      value: die.value,
      name: actor.name
    });
    this.close();
  }
}

/* Face clicks on roll cards, and the GM side of the swap relay. */
export function registerLuck() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const card = message.getFlag("project-anime", "card");
    if (!card || readSplash(card.faces) === "fumble") return;
    if (!luckHolders().length) return;
    for (const face of html.querySelectorAll(".dicerow .face")) {
      face.classList.add("spendable");
      face.addEventListener("click", () => LuckPicker.open(message, Number(face.dataset.index)));
    }
  });
  game.socket.on("system.project-anime", async data => {
    if (data?.type !== "luckSwap") return;
    if (game.users.activeGM?.isSelf !== true) return;
    const message = game.messages.get(data.messageId);
    if (message) await applyLuckSwap(message, data.dieIndex, data.value, data.name);
  });
}
