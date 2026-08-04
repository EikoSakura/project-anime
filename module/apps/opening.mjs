import { applyOpening } from "../chat.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* Characters other than the roll's creator that can take the benefit. */
function eligibleActors(message, kind) {
  const creator = message.speaker?.actor;
  return game.actors.filter(a => {
    if (a.type !== "character" || !a.isOwner || a.id === creator) return false;
    if (kind === "energy") return a.system.energy.value < a.system.energy.max;
    return a.system.luck.some(d => !d.spent && d.value > 0);
  });
}

/* Route an Opening state change: directly when this user may update the
   message, else through the active GM over the system socket. */
async function requestOpening(message, state) {
  if (message.canUserModify(game.user, "update")) return applyOpening(message, state);
  game.socket.emit("system.project-anime", { type: "opening", messageId: message.id, state });
}

async function spendEnergy(message, actor) {
  const { value, max } = actor.system.energy;
  await actor.update({ "system.energy.value": Math.min(value + 1, max) });
  await requestOpening(message, { name: actor.name, kind: "energy" });
}

async function spendLuck(message, actor, index, delta) {
  const die = actor.system.luck[index];
  if (!die || die.spent || !die.value) return;
  const to = Math.clamp(die.value + delta, 1, die.die);
  if (to === die.value) return;
  const luck = actor.system.luck.map(d => ({ ...d }));
  luck[index] = { ...luck[index], value: to };
  await actor.update({ "system.luck": luck });
  await requestOpening(message, { name: actor.name, kind: "luck", from: die.value, to });
}

/* The Opening benefit picker: characters for Recover 1 Energy, per-die
   steppers for Shift a Luck Die. */
export default class OpeningPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ message, kind, ...options } = {}) {
    super(options);
    this.#message = message;
    this.#kind = kind;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "luck-picker"],
    position: { width: 260, height: "auto" },
    actions: {
      char: this.#onChar,
      shift: this.#onShift
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/opening-picker.hbs" }
  };

  static #instance = null;

  #message;

  #kind;

  static open(message, kind) {
    this.#instance?.close();
    this.#instance = new this({ message, kind });
    this.#instance.render(true);
  }

  get title() {
    return game.i18n.localize(`PROJECTANIME.Opening.${this.#kind === "energy" ? "Energy" : "Luck"}`);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.isEnergy = this.#kind === "energy";
    context.chars = eligibleActors(this.#message, this.#kind).map(a => ({
      id: a.id,
      name: a.name,
      value: a.system.energy.value,
      max: a.system.energy.max,
      dice: a.system.luck
        .map((d, index) => ({ index, value: d.value, spent: d.spent, die: d.die }))
        .filter(d => !d.spent && d.value > 0)
        .map(d => ({ ...d, upDisabled: d.value >= d.die, downDisabled: d.value <= 1 }))
    }));
    return context;
  }

  _onClose(options) {
    super._onClose(options);
    if (OpeningPicker.#instance === this) OpeningPicker.#instance = null;
  }

  static async #onChar(event, target) {
    const actor = game.actors.get(target.dataset.actor);
    if (actor) await spendEnergy(this.#message, actor);
    this.close();
  }

  static async #onShift(event, target) {
    const actor = game.actors.get(target.dataset.actor);
    if (actor) await spendLuck(this.#message, actor, Number(target.dataset.die), Number(target.dataset.delta));
    this.close();
  }
}

/* The declare chip, the armed buttons, and the GM side of the relay. */
export function registerOpenings() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const card = message.getFlag("project-anime", "card");
    if (!card) return;
    const cbody = html.querySelector(".pa-card .cbody");
    if (!cbody) return;
    if (!card.opening && message.canUserModify(game.user, "update")) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "opdeclare";
      chip.textContent = `◆ ${game.i18n.localize("PROJECTANIME.Opening.Label")}`;
      chip.addEventListener("click", () => requestOpening(message, "armed"));
      cbody.append(chip);
    }
    if (card.opening === "armed") {
      const capable = message.canUserModify(game.user, "update") || !!game.users.activeGM;
      for (const btn of cbody.querySelectorAll(".opbtn")) {
        const kind = btn.dataset.kind;
        const eligible = capable ? eligibleActors(message, kind) : [];
        if (!eligible.length) {
          btn.classList.add("inert");
          continue;
        }
        btn.addEventListener("click", () => {
          if (kind === "energy" && eligible.length === 1) return spendEnergy(message, eligible[0]);
          OpeningPicker.open(message, kind);
        });
      }
    }
  });
  game.socket.on("system.project-anime", async data => {
    if (data?.type !== "opening") return;
    if (game.users.activeGM?.isSelf !== true) return;
    const message = game.messages.get(data.messageId);
    if (message) await applyOpening(message, data.state);
  });
}
