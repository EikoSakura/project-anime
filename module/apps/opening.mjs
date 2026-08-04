import { applyOpening } from "../chat.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* Route an Opening benefit: directly when this user may update the message,
   else through the active GM over the system socket. */
async function requestOpening(message, spent) {
  if (message.canUserModify(game.user, "update")) return applyOpening(message, spent);
  game.socket.emit("system.project-anime", { type: "opening", messageId: message.id, spent });
}

async function spendEnergy(message, actor) {
  const { value, max } = actor.system.energy;
  if (value >= max) return;
  await actor.update({ "system.energy.value": value + 1 });
  await requestOpening(message, { kind: "energy" });
}

async function spendLuck(message, actor, index, delta) {
  const die = actor.system.luck[index];
  if (!die || die.spent || !die.value) return;
  const to = Math.clamp(die.value + delta, 1, die.die);
  if (to === die.value) return;
  const luck = actor.system.luck.map(d => ({ ...d }));
  luck[index] = { ...luck[index], value: to };
  await actor.update({ "system.luck": luck });
  await requestOpening(message, { kind: "luck", from: die.value, to });
}

/* Die and direction for Shift Luck, the card actor's own dice. */
export default class OpeningPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ message, actor, ...options } = {}) {
    super(options);
    this.#message = message;
    this.#actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "luck-picker"],
    position: { width: 220, height: "auto" },
    actions: {
      shift: this.#onShift
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/opening-picker.hbs" }
  };

  static #instance = null;

  #message;

  #actor;

  static open(message, actor) {
    this.#instance?.close();
    this.#instance = new this({ message, actor });
    this.#instance.render(true);
  }

  get title() {
    return game.i18n.localize("PROJECTANIME.Opening.Luck");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.dice = this.#actor.system.luck
      .map((d, index) => ({ index, value: d.value, spent: d.spent, die: d.die }))
      .filter(d => !d.spent && d.value > 0)
      .map(d => ({ ...d, upDisabled: d.value >= d.die, downDisabled: d.value <= 1 }));
    return context;
  }

  _onClose(options) {
    super._onClose(options);
    if (OpeningPicker.#instance === this) OpeningPicker.#instance = null;
  }

  static async #onShift(event, target) {
    await spendLuck(this.#message, this.#actor, Number(target.dataset.die), Number(target.dataset.delta));
    this.close();
  }
}

/* The Opening band, injected on a character's roll cards for that
   character's owner, and the GM side of the relay. Nothing tracks who
   provided the Opening — that stays at the table. */
export function registerOpenings() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const card = message.getFlag("project-anime", "card");
    if (!card) return;
    html.querySelector(".pa-card .opening")?.remove();
    const cbody = html.querySelector(".pa-card .cbody");
    const actor = game.actors.get(message.speaker?.actor);
    if (!cbody || !actor || actor.type !== "character" || !actor.isOwner) return;
    const band = document.createElement("div");
    band.className = "opening";
    const label = document.createElement("span");
    label.className = "oplab";
    label.textContent = game.i18n.localize("PROJECTANIME.Opening.Label");
    band.append(label);
    const buttons = [
      {
        label: "PROJECTANIME.Opening.Energy",
        inert: actor.system.energy.value >= actor.system.energy.max,
        act: () => spendEnergy(message, actor)
      },
      {
        label: "PROJECTANIME.Opening.Luck",
        inert: !actor.system.luck.some(d => !d.spent && d.value > 0),
        act: () => OpeningPicker.open(message, actor)
      }
    ];
    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "opbtn";
      btn.textContent = game.i18n.localize(b.label);
      if (b.inert) btn.classList.add("inert");
      else btn.addEventListener("click", b.act);
      band.append(btn);
    }
    cbody.append(band);
  });
  game.socket.on("system.project-anime", async data => {
    if (data?.type !== "opening") return;
    if (game.users.activeGM?.isSelf !== true) return;
    const message = game.messages.get(data.messageId);
    if (message) await applyOpening(message, data.spent);
  });
}
