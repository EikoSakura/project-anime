/* The Tracks board: world-level Tracks and Contests drawn as one
   draggable glass panel on every client. The Storyteller edits fills,
   Escalations, and rows on the board; roll cards carry Track chips that
   apply the band's Segments, clicked by the Storyteller or the card's
   author. Position, collapse, and hidden state are per-client display
   state, not world data. */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let board = null;

/* Segments a band applies through a card's Track chips. A plain Failure
   carries none. */
const BAND_FILL = { Clean: 2, Success: 1, Fumble: -1 };

export function registerTracks() {
  game.settings.register("project-anime", "tracks", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => {
      board?.render();
      refreshCards();
    }
  });
  game.settings.register("project-anime", "tracksPosition", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
  game.settings.register("project-anime", "tracksCollapsed", {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });
  game.settings.register("project-anime", "tracksHidden", {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });
  /* Players cannot write world settings; a chip click on their client
     asks the active Storyteller's client to apply the fill. */
  CONFIG.queries["project-anime.trackFill"] = ({ id, side, delta }) =>
    applyFillDelta(id, side, Math.trunc(Number(delta) || 0));
  Hooks.once("ready", () => {
    board = new TracksBoard();
    board.render(true);
  });
  Hooks.on("renderChatMessageHTML", renderChips);
  Hooks.on("getSceneControlButtons", addToggleTool);
}

function rawTracks() {
  return game.settings.get("project-anime", "tracks") ?? [];
}

function getTracks() {
  return rawTracks().filter(t => t?.kind === "track" || t?.kind === "contest");
}

/* The fillable state a cell or chip speaks for: a Contest side, or the
   Track itself. */
function sideState(track, side) {
  if (!track) return null;
  return track.kind === "contest" ? track.sides?.[side] ?? null : track;
}

/* An Escalation the fill has reached is revealed to everyone and stays
   revealed even if the fill later drops. */
function revealReached(track) {
  if (track.kind !== "track") return;
  for (const esc of track.escs ?? []) {
    if (!esc.revealed && esc.at <= track.fill) esc.revealed = true;
  }
}

async function setFill(id, side, value) {
  const tracks = foundry.utils.deepClone(rawTracks());
  const track = tracks.find(t => t.id === id);
  const state = sideState(track, side);
  if (!state) return;
  state.fill = Math.clamp(value, 0, state.len);
  revealReached(track);
  await game.settings.set("project-anime", "tracks", tracks);
}

async function applyFillDelta(id, side, delta) {
  if (!delta) return;
  const tracks = foundry.utils.deepClone(rawTracks());
  const track = tracks.find(t => t.id === id);
  const state = sideState(track, side);
  if (!state) return;
  const fill = Math.clamp((state.fill ?? 0) + delta, 0, state.len);
  if (fill === state.fill) return;
  state.fill = fill;
  revealReached(track);
  await game.settings.set("project-anime", "tracks", tracks);
}

async function toggleEscalation(id, at) {
  const tracks = foundry.utils.deepClone(rawTracks());
  const track = tracks.find(t => t.id === id);
  if (track?.kind !== "track") return;
  track.escs ??= [];
  const i = track.escs.findIndex(e => e.at === at);
  if (i >= 0) track.escs.splice(i, 1);
  else track.escs.push({ at, revealed: track.fill >= at });
  await game.settings.set("project-anime", "tracks", tracks);
}

/* One unfilled Track appended to the board; the New Track dialog and the
   Adversary Builder's Desire Track both create through here. */
export async function createTrack(name, len) {
  const track = { id: foundry.utils.randomID(), kind: "track", name, len, fill: 0, escs: [] };
  await game.settings.set("project-anime", "tracks", [...rawTracks(), track]);
}

async function removeTrack(id) {
  const track = getTracks().find(t => t.id === id);
  if (!track) return;
  const prompt = document.createElement("p");
  prompt.textContent = game.i18n.format("PROJECTANIME.Tracks.DeletePrompt", { name: track.name });
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("PROJECTANIME.Tracks.Delete") },
    content: prompt.outerHTML
  });
  if (!confirmed) return;
  await game.settings.set("project-anime", "tracks", rawTracks().filter(t => t.id !== id));
}

/* The board: every client renders it, only the Storyteller's clicks
   write. A cell click sets the fill to that cell; a click on the current
   top cell drops it by one; Shift-click on a Track cell toggles an
   Escalation; right-click on a row removes it. */
class TracksBoard extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tracks-board",
    window: { frame: false, positioned: false },
    actions: {
      add: this.#onAdd,
      collapse: this.#onCollapse,
      hide: this.#onHide,
      cell: this.#onCell
    }
  };

  static PARTS = {
    board: { template: "systems/project-anime/templates/apps/tracks-board.hbs" }
  };

  /* The board stays open through play; hidden is display state. */
  async close(options) {
    return this;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const collapsed = game.settings.get("project-anime", "tracksCollapsed");
    context.gm = game.user.isGM;
    context.collapsed = collapsed;
    context.collapseIcon = collapsed ? "▼" : "▲";
    context.collapseLabel = game.i18n.localize(collapsed ? "PROJECTANIME.Tracks.Expand" : "PROJECTANIME.Tracks.Collapse");
    context.rows = getTracks().map(track => this.#row(track));
    return context;
  }

  /* An unreached Escalation renders dim and for the Storyteller only; a
     revealed one renders lit for everyone. A two-side Contest draws as
     one line toward the center diamond; three or more sides stack. */
  #row(track) {
    const gm = game.user.isGM;
    const row = { id: track.id, name: track.name };
    if (track.kind === "track") {
      row.cells = Array.from({ length: track.len }, (_, i) => {
        const esc = (track.escs ?? []).find(e => e.at === i + 1);
        return {
          on: i < track.fill,
          esc: esc && (esc.revealed || gm) ? { hit: !!esc.revealed } : null
        };
      });
      return row;
    }
    const cellsOf = side => Array.from({ length: side.len }, (_, i) => ({ on: i < side.fill }));
    const sides = track.sides ?? [];
    if (sides.length === 2) {
      row.line = { a: cellsOf(sides[0]), b: cellsOf(sides[1]), aname: sides[0].name, bname: sides[1].name };
    } else {
      row.sides = sides.map((side, si) => ({ si, name: side.name, cells: cellsOf(side) }));
    }
    return row;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    el.classList.toggle("gm", game.user.isGM);
    el.classList.toggle("collapsed", context.collapsed);
    el.style.display = game.settings.get("project-anime", "tracksHidden") ? "none" : "";
    const position = game.settings.get("project-anime", "tracksPosition");
    if (Number.isFinite(position?.left)) {
      el.style.left = `${Math.clamp(position.left, 0, window.innerWidth - 60)}px`;
      el.style.top = `${Math.clamp(position.top, 0, window.innerHeight - 34)}px`;
      el.style.transform = "none";
    }
    this.#wireDrag();
    if (game.user.isGM) {
      for (const row of el.querySelectorAll(".row[data-id]")) {
        row.addEventListener("contextmenu", event => {
          event.preventDefault();
          removeTrack(row.dataset.id);
        });
      }
    }
  }

  /* Dragged by the header, position remembered per client. */
  #wireDrag() {
    const el = this.element;
    const head = el.querySelector(".bhead");
    let drag = null;
    head.addEventListener("pointerdown", e => {
      if (e.target.closest("button")) return;
      const rect = el.getBoundingClientRect();
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.top}px`;
      el.style.transform = "none";
      drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener("pointermove", e => {
      if (!drag) return;
      el.style.left = `${Math.clamp(e.clientX - drag.dx, 0, window.innerWidth - el.offsetWidth)}px`;
      el.style.top = `${Math.clamp(e.clientY - drag.dy, 0, window.innerHeight - 34)}px`;
    });
    head.addEventListener("pointerup", () => {
      if (!drag) return;
      drag = null;
      const rect = el.getBoundingClientRect();
      game.settings.set("project-anime", "tracksPosition", { left: rect.left, top: rect.top });
    });
  }

  static #onAdd() {
    if (game.user.isGM) NewTrackDialog.open();
  }

  static async #onCollapse() {
    const collapsed = game.settings.get("project-anime", "tracksCollapsed");
    await game.settings.set("project-anime", "tracksCollapsed", !collapsed);
    this.render();
  }

  static async #onHide() {
    await game.settings.set("project-anime", "tracksHidden", true);
    this.render();
    ui.controls.render();
  }

  static async #onCell(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-id]")?.dataset.id;
    const track = getTracks().find(t => t.id === id);
    if (!track) return;
    const i = Number(target.dataset.i);
    if (event.shiftKey && track.kind === "track") return toggleEscalation(id, i + 1);
    const side = target.dataset.side === undefined ? null : Number(target.dataset.side);
    const state = sideState(track, side);
    if (!state) return;
    await setFill(id, side, i + 1 === state.fill ? i : i + 1);
  }
}

/* Name and Segments for a Track; the Contest toggle swaps Segments for
   the side rows, each side with its own name and length. */
class NewTrackDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "track-new",
    classes: ["project-anime", "sheet", "track-new"],
    tag: "form",
    position: { width: 320, height: "auto" },
    actions: {
      addSide: this.#onAddSide,
      delSide: this.#onDelSide
    },
    form: {
      handler: this.#onSubmit,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/track-new.hbs" }
  };

  static #instance = null;

  static open() {
    this.#instance?.close();
    this.#instance = new this();
    this.#instance.render(true);
  }

  get title() {
    return game.i18n.localize("PROJECTANIME.Tracks.New");
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const contest = this.element.querySelector('[name="contest"]');
    const lenrow = this.element.querySelector(".lenrow");
    const sides = this.element.querySelector(".sidesbox");
    contest.addEventListener("change", () => {
      lenrow.hidden = contest.checked;
      sides.hidden = !contest.checked;
      sides.disabled = !contest.checked;
    });
  }

  _onClose(options) {
    super._onClose(options);
    if (NewTrackDialog.#instance === this) NewTrackDialog.#instance = null;
  }

  static #onAddSide() {
    const rows = this.element.querySelector(".siderows");
    const row = rows.firstElementChild.cloneNode(true);
    row.querySelector('[name="sname"]').value = "";
    row.querySelector('[name="slen"]').value = 6;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "delside";
    del.dataset.action = "delSide";
    del.setAttribute("aria-label", game.i18n.localize("PROJECTANIME.Tracks.RemoveSide"));
    del.textContent = "✕";
    row.append(del);
    rows.append(row);
  }

  static #onDelSide(event, target) {
    target.closest(".siderow")?.remove();
  }

  static async #onSubmit(event, form, formData) {
    const f = formData.object;
    const name = String(f.name ?? "").trim();
    if (!name) return;
    const clampLen = n => Math.clamp(Math.trunc(Number(n) || 6), 2, 12);
    if (f.contest) {
      const names = [].concat(f.sname ?? []);
      const lens = [].concat(f.slen ?? []);
      const sides = names
        .map((n, i) => ({ name: String(n).trim(), len: clampLen(lens[i]), fill: 0 }))
        .filter(side => side.name);
      if (sides.length < 2) return;
      const track = { id: foundry.utils.randomID(), kind: "contest", name, sides };
      await game.settings.set("project-anime", "tracks", [...rawTracks(), track]);
    } else {
      await createTrack(name, clampLen(f.len));
    }
  }
}

/* Hidden, the board reopens from a toggle in the scene controls. */
function addToggleTool(controls) {
  const tokens = controls.tokens;
  if (!tokens) return;
  tokens.tools.tracks = {
    name: "tracks",
    title: "PROJECTANIME.Tracks.Title",
    icon: "fa-solid fa-bars-progress",
    order: Object.values(tokens.tools).reduce((max, tool) => Math.max(max, tool.order ?? 0), 0) + 1,
    toggle: true,
    active: !game.settings.get("project-anime", "tracksHidden"),
    onChange: async (event, active) => {
      await game.settings.set("project-anime", "tracksHidden", !active);
      board?.render();
    }
  };
}

/* One chip per fillable line: solo Tracks, or each Contest side. */
function chipTargets() {
  const targets = [];
  for (const track of getTracks()) {
    if (track.kind === "track") {
      targets.push({ id: track.id, side: null, label: track.name, fill: track.fill, len: track.len });
    } else {
      (track.sides ?? []).forEach((side, i) => targets.push({
        id: track.id, side: i, label: `${track.name} · ${side.name}`, fill: side.fill, len: side.len
      }));
    }
  }
  return targets;
}

/* The card's Track chips, drawn fresh on every render for the
   Storyteller and the card's author, so the list follows the board. A
   click applies the band once; the choice rides the message as a flag
   and the spent chip renders in its place. */
function renderChips(message, html) {
  const card = message.getFlag("project-anime", "card");
  const delta = BAND_FILL[card?.difficulty?.band] ?? 0;
  if (!delta) return;
  if (!game.user.isGM && !message.isAuthor) return;
  const body = html.querySelector(".pa-card .cbody");
  if (!body) return;
  body.querySelector(".trackrow")?.remove();
  const row = document.createElement("div");
  row.className = "trackrow";
  const applied = message.getFlag("project-anime", "trackApplied");
  if (applied) {
    const done = document.createElement("button");
    done.type = "button";
    done.className = "trchip done";
    done.disabled = true;
    done.textContent = game.i18n.format(
      applied.action === "erase" ? "PROJECTANIME.Tracks.AppliedErase" : "PROJECTANIME.Tracks.AppliedFill",
      { name: applied.label });
    row.append(done);
  } else {
    for (const target of chipTargets()) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = delta < 0 ? "trchip erase" : "trchip";
      chip.disabled = delta > 0 ? target.fill >= target.len : target.fill <= 0;
      chip.textContent = game.i18n.format(
        delta < 0 ? "PROJECTANIME.Tracks.ChipErase" : "PROJECTANIME.Tracks.ChipFill",
        { name: target.label, n: delta });
      chip.addEventListener("click", () => applyChip(message, target, delta));
      row.append(chip);
    }
    if (!row.childElementCount) return;
  }
  body.append(row);
}

/* Chips on cards already on screen follow the board: rows appear,
   vanish, and lock as Tracks change. */
function refreshCards() {
  for (const li of document.querySelectorAll(".chat-message[data-message-id]")) {
    const message = game.messages.get(li.dataset.messageId);
    if (message) renderChips(message, li);
  }
}

async function applyChip(message, target, delta) {
  if (message.getFlag("project-anime", "trackApplied")) return;
  const state = sideState(getTracks().find(t => t.id === target.id), target.side);
  if (!state) return;
  if (delta > 0 ? state.fill >= state.len : state.fill <= 0) return;
  if (!game.user.isGM && !game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("PROJECTANIME.Tracks.NoStoryteller"));
    return;
  }
  await message.setFlag("project-anime", "trackApplied", {
    id: target.id,
    side: target.side,
    label: target.label,
    action: delta < 0 ? "erase" : "fill"
  });
  if (game.user.isGM) await applyFillDelta(target.id, target.side, delta);
  else await game.users.activeGM.query("project-anime.trackFill", { id: target.id, side: target.side, delta });
}
