/* The Tension meter: a world number 0 to 6 drawn as six beni diamond
   slots docked top center over the board on every client. The
   Storyteller's slot clicks and the GM-only gain chips on roll cards are
   the only writers. */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const CAP = 6;

let meter = null;

export function registerTension() {
  game.settings.register("project-anime", "tension", {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
    onChange: () => {
      meter?.render();
      refreshChips();
    }
  });
  game.settings.register("project-anime", "tensionAnnounce", {
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });
  game.settings.register("project-anime", "tensionAuto", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  game.settings.registerMenu("project-anime", "tensionMenu", {
    name: "PROJECTANIME.Tension.Menu",
    label: "PROJECTANIME.Tension.Configure",
    icon: "fa-solid fa-gears",
    type: TensionSettings,
    restricted: true
  });
  Hooks.once("ready", () => {
    meter = new TensionMeter();
    meter.render(true);
  });
  Hooks.on("renderChatMessageHTML", renderChip);
  Hooks.on("createChatMessage", autoGain);
}

/* The meter: every client renders it, only the Storyteller's clicks
   write. A slot click sets Tension to that slot; a click on the current
   top slot drops it by one. */
class TensionMeter extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tension-meter",
    window: { frame: false, positioned: false },
    actions: {
      setSlot: this.#onSetSlot
    }
  };

  static PARTS = {
    meter: { template: "systems/project-anime/templates/apps/tension-meter.hbs" }
  };

  /* The meter stays open through play. */
  async close(options) {
    return this;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const value = game.settings.get("project-anime", "tension");
    context.slots = Array.from({ length: CAP }, (_, i) => i < value);
    return context;
  }

  static async #onSetSlot(event, target) {
    if (!game.user.isGM) return;
    const i = Number(target.dataset.i);
    const value = game.settings.get("project-anime", "tension");
    await game.settings.set("project-anime", "tension", i + 1 === value ? i : i + 1);
  }
}

/* All the Tension options in one window, reached from System Settings. */
class TensionSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tension-settings",
    classes: ["project-anime", "sheet", "tension-settings"],
    tag: "form",
    position: { width: 380, height: "auto" },
    form: {
      handler: this.#onSubmit,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/tension-settings.hbs" }
  };

  get title() {
    return game.i18n.localize("PROJECTANIME.Tension.Menu");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.announce = game.settings.get("project-anime", "tensionAnnounce");
    context.auto = game.settings.get("project-anime", "tensionAuto");
    return context;
  }

  static async #onSubmit(event, form, formData) {
    await game.settings.set("project-anime", "tensionAnnounce", !!formData.object.announce);
    await game.settings.set("project-anime", "tensionAuto", !!formData.object.auto);
  }
}

async function announce(key) {
  if (!game.settings.get("project-anime", "tensionAnnounce")) return;
  await ChatMessage.implementation.create({
    content: `<div class="pa-tline">${game.i18n.localize(`PROJECTANIME.Tension.${key}`)}</div>`
  });
}

async function gainTension() {
  const value = game.settings.get("project-anime", "tension");
  if (value >= CAP) return;
  await game.settings.set("project-anime", "tension", value + 1);
  await announce("GainLine");
}

/* The GM's gain chip, swapped in over a roll card's Tension rider line.
   The applied state rides the message as a flag so the chip stays spent
   on every later render. */
function renderChip(message, html) {
  if (!game.user.isGM) return;
  const rider = html.querySelector('.pa-card [data-rider="Tension"]');
  if (!rider) return;
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "tchip";
  if (message.getFlag("project-anime", "tensionApplied")) {
    chip.classList.add("done");
    chip.disabled = true;
    chip.textContent = game.i18n.localize("PROJECTANIME.Tension.Gained");
  } else {
    setChipState(chip, game.settings.get("project-anime", "tension") >= CAP);
    chip.addEventListener("click", () => applyChip(message, chip));
  }
  rider.replaceChildren(chip);
}

function setChipState(chip, full) {
  chip.classList.toggle("full", full);
  chip.disabled = full;
  chip.textContent = game.i18n.localize(full ? "PROJECTANIME.Tension.Full" : "PROJECTANIME.Tension.Raise");
}

/* Unspent chips already on screen follow the value: 6 locks, room unlocks. */
function refreshChips() {
  const full = game.settings.get("project-anime", "tension") >= CAP;
  for (const chip of document.querySelectorAll(".pa-card .tchip:not(.done)")) setChipState(chip, full);
}

async function applyChip(message, chip) {
  if (message.getFlag("project-anime", "tensionApplied")) return;
  if (game.settings.get("project-anime", "tension") >= CAP) return;
  chip.classList.add("done");
  chip.disabled = true;
  chip.textContent = game.i18n.localize("PROJECTANIME.Tension.Gained");
  await message.setFlag("project-anime", "tensionApplied", true);
  await gainTension();
}

/* With Auto Gain on, the active GM's client applies a roll card's Tension
   rider as the card lands, and the chip reads Gained. A full track leaves
   the chip live for a later click. */
async function autoGain(message) {
  if (game.users.activeGM?.isSelf !== true) return;
  if (!game.settings.get("project-anime", "tensionAuto")) return;
  const band = message.getFlag("project-anime", "card")?.difficulty?.band;
  if (!band || band === "Clean") return;
  if (message.getFlag("project-anime", "tensionApplied")) return;
  if (game.settings.get("project-anime", "tension") >= CAP) return;
  await message.setFlag("project-anime", "tensionApplied", true);
  await gainTension();
}
