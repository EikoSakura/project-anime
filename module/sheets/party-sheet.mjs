import { memberPower, partyPower, effectivePartyPower, encounterBudget, encounterLines, actionEconomy, effectivePlayers } from "../helpers/encounter.mjs";
import { partyMembers, ensurePartyFolder } from "../helpers/party-folder.mjs";
import { isMinionTier, setSquadSize } from "../helpers/squad.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Stable ordering: by sort, then name. */
const bySort = (a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name);

/** Item types that can live in the shared Stash (everything but Skills / Packages). */
const STASHABLE = new Set(["weapon", "armor", "shield", "accessory", "consumable", "container", "gear"]);

/**
 * The Party sheet — a three-tab planner.
 *   • Party     — the roster of Player Characters + the party's total Skill Points.
 *   • Stash     — shared storage: items the party holds together (drag items in).
 *   • Encounter — GM-ONLY budget builder: Party SP × difficulty = a monster budget, and a
 *                 drag-in tally of the fight's monsters (each priced in SP) vs that budget.
 * Members and encounter monsters are stored as UUIDs; the Stash uses embedded Items.
 *
 * The party reads as JUST a folder in the Actors sidebar (PF2e-style) — its own actor row is
 * hidden, and this sheet opens from the folder's icon (or the `P` key). Since the right-click
 * "Delete Actor" is therefore out of reach, the GM gets a Delete control in the window header.
 */
export class ProjectAnimePartySheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "party-sheet"],
    position: { width: 560, height: 620 },
    window: { resizable: true, icon: "fa-solid fa-users" },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      editImage: ProjectAnimePartySheet.#onEditImage,
      selectTab: ProjectAnimePartySheet.#onSelectTab,
      removeMember: ProjectAnimePartySheet.#onRemoveMember,
      removeMonster: ProjectAnimePartySheet.#onRemoveMonster,
      incMonster: ProjectAnimePartySheet.#onIncMonster,
      decMonster: ProjectAnimePartySheet.#onDecMonster,
      removeStashItem: ProjectAnimePartySheet.#onRemoveStashItem,
      openStashItem: ProjectAnimePartySheet.#onOpenStashItem,
      giveItem: ProjectAnimePartySheet.#onGiveItem,
      splitGold: ProjectAnimePartySheet.#onSplitGold,
      collectGold: ProjectAnimePartySheet.#onCollectGold,
      openActor: ProjectAnimePartySheet.#onOpenActor,
      pullRoster: ProjectAnimePartySheet.#onPullRoster,
      deleteParty: ProjectAnimePartySheet.#onDeleteParty
    }
  };

  static PARTS = {
    tabs: { template: "systems/project-anime/templates/party/tabs.hbs" },
    party: { template: "systems/project-anime/templates/party/party.hbs", scrollable: [""] },
    stash: { template: "systems/project-anime/templates/party/stash.hbs", scrollable: [""] },
    encounter: { template: "systems/project-anime/templates/party/encounter.hbs", scrollable: [""] }
  };

  /** @override — the party actor row is hidden from the directory (it reads as just a folder), so
   *  the usual right-click "Delete Actor" is out of reach. Give the GM a Delete control here;
   *  ownership / UUID stay on the inherited header menu. Built fresh each render so the
   *  options-backed parent array isn't mutated (which would duplicate it). */
  _getHeaderControls() {
    const controls = [...super._getHeaderControls()];
    if (game.user.isGM) controls.unshift({ icon: "fas fa-trash", label: "PROJECTANIME.Party.delete", action: "deleteParty" });
    return controls;
  }

  /** Active tab ("party" | "stash" | "encounter"). Survives re-render. */
  #activeTab = "party";

  /** @override — the Encounter tab (and its part) is GM-only. */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    const parts = ["tabs", "party", "stash"];
    if (game.user.isGM) parts.push("encounter");
    options.parts = parts;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const cfg = CONFIG.PROJECTANIME;
    const sys = this.actor.system;
    const isGM = game.user.isGM;
    context.editable = this.isEditable;
    context.actor = this.actor;
    context.system = sys;
    context.isGM = isGM;

    // Tabs — Party + Stash for everyone; Encounter is GM-only. Reconcile the active tab to an
    // available one. (Factions + Home now live in the standalone Codex window, not here.)
    const available = ["party", "stash", ...(isGM ? ["encounter"] : [])];
    if (!available.includes(this.#activeTab)) this.#activeTab = "party";
    const active = this.#activeTab;
    context.onParty = active === "party";
    context.onStash = active === "stash";
    context.onEncounter = active === "encounter";
    context.tabs = [
      { key: "party", icon: "fa-user-group", label: game.i18n.localize("PROJECTANIME.Party.tabParty"), active: active === "party" },
      { key: "stash", icon: "fa-box-archive", label: game.i18n.localize("PROJECTANIME.Party.tabStash"), active: active === "stash" }
    ];
    if (isGM) context.tabs.push({ key: "encounter", icon: "fa-skull", label: game.i18n.localize("PROJECTANIME.Party.tabEncounter"), active: active === "encounter" });

    // Party tab — the roster (the party folder's Characters) as dashboard cards.
    context.members = partyMembers(this.actor).map((a) => {
      const ms = a.system ?? {};
      const hp = ms.hp ?? { value: 0, max: 0 };
      const en = ms.energy ?? { value: 0, max: 0 };
      return {
        ref: a.uuid, name: a.name, img: a.img,
        power: memberPower(a),
        hp: hp.value, hpMax: hp.max, hpPct: hp.max > 0 ? Math.clamp(Math.round((hp.value / hp.max) * 100), 0, 100) : 0,
        energy: en.value, energyMax: en.max, energyPct: en.max > 0 ? Math.clamp(Math.round((en.value / en.max) * 100), 0, 100) : 0,
        evasion: ms.evasion?.value ?? 0,
        defense: ms.defense?.value ?? 0,
        movement: ms.movement?.value ?? 0
      };
    });
    context.partyPower = partyPower(this.actor);
    context.gold = sys.gold ?? 0; // shared treasury (Stash tab)

    // Stash tab — the party's shared items.
    context.stash = this.actor.items
      .filter((i) => STASHABLE.has(i.type))
      .sort(bySort)
      .map((i) => {
        const qty = Number(i.system?.quantity);
        return { id: i.id, name: i.name, img: i.img, qty: qty > 1 ? qty : null, cost: Number(i.system?.cost) || 0 };
      });

    // Encounter tab (GM only) — difficulty, the SP "Power" budget, and the planned threats. The fight
    // is read on TWO gauges: Power (Skill-Point threat vs the budget) and Bodies (turns/round vs the
    // players, the action-economy axis the SP sum can't see). Minions field as one pooled Squad line
    // (a size stepper, not a quantity multiplier); Standard/Elite/Solo are individual lines.
    if (isGM) {
      // Budget basis: typed total Skill Points in manual-estimate mode (plan a fight with no
      // built roster), else the live roster's summed power.
      const power = effectivePartyPower(this.actor);
      context.encounterManual = sys.encounterManual ?? false;
      context.encounterPlayers = sys.encounterPlayers ?? 4;
      context.encounterSP = sys.encounterSP ?? 0;
      context.rosterPower = context.partyPower; // shown as the "pull from roster" reference
      context.difficulty = sys.difficulty ?? "standard";
      context.difficultyChoices = Object.fromEntries(
        cfg.encounterDifficultyKeys.map((k) => [k, game.i18n.localize(cfg.encounterDifficulty[k].label)])
      );
      context.budget = encounterBudget(this.actor);
      context.thresholds = cfg.encounterDifficultyKeys.map((k) => ({
        label: game.i18n.localize(cfg.encounterDifficulty[k].label),
        value: Math.round(power * cfg.encounterDifficulty[k].mult),
        active: context.difficulty === k
      }));

      const lines = encounterLines(this.actor);
      context.encounter = lines.map((l) => ({
        ...l,
        starsArr: l.stars >= 1 ? Array.from({ length: l.stars }, (_, i) => i) : null,
        // Squad lines read "Squad ×N · cost" with living/total members; individuals read a flat cost.
        squadLabel: l.isMinion ? game.i18n.format("PROJECTANIME.Party.squadOf", { n: l.size }) : "",
        membersLabel: (l.isMinion && l.maxMembers > 1) ? `${l.members}/${l.maxMembers}` : "",
        costLabel: `${l.cost}`
      }));
      const spent = lines.reduce((s, l) => s + (l.cost || 0), 0);
      context.spent = spent;
      context.over = spent > context.budget;
      context.usePct = context.budget > 0 ? Math.clamp(Math.round((spent / context.budget) * 100), 0, 100) : 0;

      // Bodies gauge — turns/round vs the players (a Squad is 1 body whatever its size; a Solo is 2–3).
      const econ = actionEconomy(this.actor);
      context.players = econ.players;
      context.bodies = econ.bodies;
      context.bodiesTarget = econ.players;
      context.bodiesTone = econ.tone;
      context.bodiesPct = Math.clamp(Math.round((econ.bodies / Math.max(1, econ.high)) * 100), 0, 100);
      const econKey = { heavy: "actionEconHeavy", light: "actionEconLight", ok: "actionEconOk" }[econ.tone];
      context.actionEcon = econKey
        ? { tone: econ.tone, label: game.i18n.format(`PROJECTANIME.Party.${econKey}`, econ) }
        : null;
    }

    return context;
  }

  /** @override — bind drag-drop zones + make Stash items draggable. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (!this.isEditable) return;
    for (const zone of this.element.querySelectorAll("[data-drop]")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (ev) => { zone.classList.remove("drag-over"); this.#onDrop(ev, zone.dataset.drop); });
    }
    // Stash rows are draggable Items (drag one onto a member avatar below, or a PC sheet).
    for (const row of this.element.querySelectorAll(".party-row[data-item-id]")) {
      const item = this.actor.items.get(row.dataset.itemId);
      if (!item) continue;
      row.setAttribute("draggable", "true");
      row.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid }));
      });
    }
    // Member avatars in the Stash are "give" drop targets — drop a stash item onto one to hand it over.
    for (const tgt of this.element.querySelectorAll(".give-target[data-ref]")) {
      tgt.addEventListener("dragover", (ev) => { ev.preventDefault(); tgt.classList.add("drag-over"); });
      tgt.addEventListener("dragleave", () => tgt.classList.remove("drag-over"));
      tgt.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); tgt.classList.remove("drag-over"); this.#giveToMember(ev, tgt.dataset.ref); });
    }
  }

  /** Parse a sidebar/canvas drop payload. */
  #dropData(event) {
    try { return JSON.parse(event.dataTransfer.getData("text/plain") || "{}"); } catch (_e) { return {}; }
  }

  /** Route a drop by zone: Characters → roster, NPCs → encounter, Items → stash. */
  async #onDrop(event, slot) {
    event.preventDefault();
    const data = this.#dropData(event);
    if (!data?.type || !data.uuid) return;

    if (slot === "stash") {
      if (data.type !== "Item") return;
      const item = await fromUuid(data.uuid);
      if (!item || !STASHABLE.has(item.type)) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Party.itemsAreGear"));
      if (item.parent?.id === this.actor.id) return; // already in this stash
      const obj = item.toObject();
      delete obj._id;
      await this.actor.createEmbeddedDocuments("Item", [obj]);
      return;
    }

    if (data.type !== "Actor") return;
    const actor = await fromUuid(data.uuid);
    if (!actor) return;
    if (slot === "members") {
      if (actor.type !== "character") return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Party.membersArePCs"));
      // Membership = being in the party's folder, so adding a member files them into it.
      const folder = await ensurePartyFolder(this.actor);
      if (folder && actor.folder?.id !== folder.id) await actor.update({ folder: folder.id });
    } else if (slot === "encounter") {
      if (actor.type !== "npc") return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Party.encounterAreMonsters"));
      const list = foundry.utils.deepClone(this.actor.system.encounter ?? []);
      if (isMinionTier(actor)) {
        // Minions field as ONE pooled Squad line — re-dropping the same minion doesn't stack lines;
        // its numbers are the squad SIZE, not a count of lines. First time fielded, size it to the
        // party (Daggerheart "a group ≈ party size"), so a dropped wave is a real squad straight away.
        if (!list.some((e) => e.uuid === actor.uuid)) {
          list.push({ id: foundry.utils.randomID(), uuid: actor.uuid });
          if ((Number(actor.system?.squad?.size) || 1) < 2) await setSquadSize(actor, Math.max(2, effectivePlayers(this.actor)));
        }
      } else {
        // Standard / Elite / Solo are individuals — each drop is its own body (its own line).
        list.push({ id: foundry.utils.randomID(), uuid: actor.uuid });
      }
      await this.actor.update({ "system.encounter": list });
    }
  }

  /** Foundry's ActorSheetV2 binds its own `element.ondrop` (in `_onRender`) that auto-creates a
   *  copy of any dropped Item. The stash zone's own handler (#onDrop) doesn't stop propagation, so
   *  without this both channels would fire and stash drops would land TWICE. Suppress the base
   *  auto-create for foreign items (our #onDrop copies them); delegate own-item drops to core. */
  async _onDropItem(event, item) {
    if (this.actor.uuid !== item?.parent?.uuid) return null;
    return super._onDropItem(event, item);
  }

  /** No ActiveEffects live on the party actor — suppress the base auto-create on effect drops. */
  async _onDropActiveEffect(event, effect) {
    return null;
  }

  /** Switch tabs via CSS (toggle .active on the live DOM) — instant, no re-render. */
  static #onSelectTab(event, target) {
    const tab = target.dataset.tab;
    if (!tab || tab === this.#activeTab) return;
    this.#activeTab = tab;
    for (const pane of this.element.querySelectorAll(".party-pane"))
      pane.classList.toggle("active", pane.dataset.pane === tab);
    for (const btn of this.element.querySelectorAll(".party-tab"))
      btn.classList.toggle("active", btn.dataset.tab === tab);
  }

  static async #onEditImage() {
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    const fp = new FP({
      type: "image",
      current: this.actor.img || "",
      callback: (path) => this.actor.update({ img: path }).catch((err) => ui.notifications.error(err.message))
    });
    return fp.browse();
  }

  static async #onRemoveMember(event, target) {
    const ref = target.closest("[data-ref]")?.dataset.ref;
    const actor = ref ? await fromUuid(ref) : null;
    if (actor) await actor.update({ folder: null }); // leaving the folder = leaving the party
  }

  /** Remove one encounter LINE by its stable id (duplicates of the same NPC are distinct lines). */
  static async #onRemoveMonster(event, target) {
    const id = target.closest("[data-line-id]")?.dataset.lineId;
    if (!id) return;
    await this.actor.update({ "system.encounter": (this.actor.system.encounter ?? []).filter((e) => e.id !== id) });
  }

  static async #onIncMonster(event, target) { await this.#resizeSquad(target, +1); }
  static async #onDecMonster(event, target) { await this.#resizeSquad(target, -1); }

  /** Grow/shrink a Minion line's SQUAD (its pooled member count lives on the NPC — helpers/squad.mjs).
   *  Resizing the actor doesn't re-render the party sheet on its own, so force a redraw afterward. */
  async #resizeSquad(target, delta) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const actor = uuid ? await fromUuid(uuid) : null;
    if (!actor || !isMinionTier(actor)) return;
    await setSquadSize(actor, (Number(actor.system?.squad?.size) || 1) + delta);
    this.render();
  }

  static async #onRemoveStashItem(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = id ? this.actor.items.get(id) : null;
    if (item) await item.delete();
  }

  static #onOpenStashItem(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    this.actor.items.get(id)?.sheet?.render(true);
  }

  /* -------------------------------------------- */
  /*  Give items + shared Gold treasury           */
  /* -------------------------------------------- */

  /** The party's resolved Character members (the party folder's Characters). */
  #resolvedMembers() {
    return partyMembers(this.actor);
  }

  /** Hand a stash item to a member — copy it onto them and remove it from the stash.
   *  Tolerates external (non-stash) items too: those are just copied to the member. */
  async #giveToMember(event, ref) {
    const data = this.#dropData(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const item = await fromUuid(data.uuid);
    const member = ref ? await fromUuid(ref) : null;
    if (!item || !member) return;
    const obj = item.toObject();
    delete obj._id;
    await member.createEmbeddedDocuments("Item", [obj]);
    if (item.parent?.id === this.actor.id) await item.delete();
    ui.notifications.info(game.i18n.format("PROJECTANIME.Party.gave", { item: item.name, member: member.name }));
  }

  /** "Give" button on a stash item → pick a member from a dialog, then hand it over. */
  static async #onGiveItem(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = id ? this.actor.items.get(id) : null;
    if (!item) return;
    const members = this.#resolvedMembers();
    if (!members.length) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Party.noMembers"));
    const buttons = members.map((m) => ({ action: m.uuid, label: m.name, icon: "fas fa-user" }));
    buttons.push({ action: "cancel", label: game.i18n.localize("Cancel"), icon: "fas fa-xmark" });
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("PROJECTANIME.Party.giveTitle", { item: item.name }), icon: "fas fa-hand-holding" },
      content: "",
      buttons,
      rejectClose: false
    });
    if (!choice || choice === "cancel") return;
    const member = await fromUuid(choice);
    if (!member) return;
    const obj = item.toObject();
    delete obj._id;
    await member.createEmbeddedDocuments("Item", [obj]);
    await item.delete();
    ui.notifications.info(game.i18n.format("PROJECTANIME.Party.gave", { item: item.name, member: member.name }));
  }

  /** Split the treasury evenly among the members you can update; any remainder stays pooled. */
  static async #onSplitGold() {
    const members = this.#resolvedMembers().filter((m) => m.isOwner);
    if (!members.length) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Party.noMembers"));
    const gold = this.actor.system.gold ?? 0;
    const each = Math.floor(gold / members.length);
    if (each <= 0) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Party.notEnoughGold"));
    await Promise.all(members.map((m) => m.update({ "system.gold": (m.system.gold ?? 0) + each })));
    await this.actor.update({ "system.gold": gold - each * members.length });
    ui.notifications.info(game.i18n.format("PROJECTANIME.Party.splitDone", { each, n: members.length }));
  }

  /** Pull every (updatable) member's Gold into the shared treasury. */
  static async #onCollectGold() {
    const members = this.#resolvedMembers().filter((m) => m.isOwner);
    let pooled = 0;
    const updates = [];
    for (const m of members) {
      const g = m.system.gold ?? 0;
      if (g > 0) { pooled += g; updates.push(m.update({ "system.gold": 0 })); }
    }
    if (!pooled) return;
    await Promise.all(updates);
    await this.actor.update({ "system.gold": (this.actor.system.gold ?? 0) + pooled });
    ui.notifications.info(game.i18n.format("PROJECTANIME.Party.collectDone", { gold: pooled }));
  }

  /** Open a listed member's / monster's own sheet. */
  static async #onOpenActor(event, target) {
    const el = target.closest("[data-ref], [data-uuid]");
    const ref = el?.dataset.ref ?? el?.dataset.uuid;
    const actor = ref ? await fromUuid(ref) : null;
    actor?.sheet?.render(true);
  }

  /** Prefill the manual-estimate fields from the live roster — the party's summed power as the
   *  total SP, its member count as the player count. Lets the GM start from the real party and
   *  then tweak the numbers (e.g. "what if there were 5 of them?") without a built roster. */
  static async #onPullRoster() {
    await this.actor.update({
      "system.encounterSP": partyPower(this.actor),
      "system.encounterPlayers": Math.max(1, this.#resolvedMembers().length || 1)
    });
  }

  /** Delete the whole party (GM, from the header control). The deleteActor hook tears down its
   *  backing folder; the folder's Characters fall back to the directory root, not deleted. */
  static async #onDeleteParty() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.Party.deleteTitle"), icon: "fas fa-trash" },
      content: `<p>${game.i18n.format("PROJECTANIME.Party.deleteConfirm", { name: this.actor.name })}</p>`,
      rejectClose: false
    });
    if (ok) await this.actor.delete();
  }
}
