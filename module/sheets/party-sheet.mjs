import { monsterSPCost, memberPower, partyPower, encounterBudget, resolveActor } from "../helpers/encounter.mjs";
import { partyMembers, ensurePartyFolder } from "../helpers/party-folder.mjs";

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
      openActor: ProjectAnimePartySheet.#onOpenActor
    }
  };

  static PARTS = {
    tabs: { template: "systems/project-anime/templates/party/tabs.hbs" },
    party: { template: "systems/project-anime/templates/party/party.hbs", scrollable: [""] },
    stash: { template: "systems/project-anime/templates/party/stash.hbs", scrollable: [""] },
    encounter: { template: "systems/project-anime/templates/party/encounter.hbs", scrollable: [""] }
  };

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

    // Tabs — Encounter is GM-only; reconcile the active tab to one that's available.
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

    // Encounter tab (GM only) — difficulty, budget, and the monster tally.
    if (isGM) {
      const power = context.partyPower;
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

      let spent = 0;
      context.encounter = (sys.encounter ?? []).map((entry) => {
        const a = resolveActor(entry.uuid);
        const qty = Math.max(1, entry.qty ?? 1);
        if (!a) return { uuid: entry.uuid, name: "—", img: "icons/svg/mystery-man.svg", qty, costLabel: "0", missing: true };
        const cost = monsterSPCost(a);
        const total = cost * qty;
        spent += total;
        const tier = a.system?.tier ? cfg.monsterTiers[a.system.tier] : null;
        return {
          uuid: a.uuid, name: a.name, img: a.img, qty,
          costLabel: qty > 1 ? `${cost} ×${qty} = ${total}` : `${cost}`,
          tierLabel: tier ? game.i18n.localize(tier.label) : "",
          tierColor: tier?.color ?? "var(--pa-line)"
        };
      });
      context.spent = spent;
      context.budgetTotal = context.budget;
      context.over = spent > context.budget;
      context.usePct = context.budget > 0 ? Math.clamp(Math.round((spent / context.budget) * 100), 0, 100) : 0;
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
      const existing = list.find((e) => e.uuid === actor.uuid);
      if (existing) existing.qty = (existing.qty ?? 1) + 1;
      else list.push({ uuid: actor.uuid, qty: 1 });
      await this.actor.update({ "system.encounter": list });
    }
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

  static async #onRemoveMonster(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    await this.actor.update({ "system.encounter": (this.actor.system.encounter ?? []).filter((e) => e.uuid !== uuid) });
  }

  static async #onIncMonster(event, target) { await this.#bumpMonster(target, +1); }
  static async #onDecMonster(event, target) { await this.#bumpMonster(target, -1); }

  /** Change a monster entry's quantity (clamped to ≥ 1). */
  async #bumpMonster(target, delta) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    const list = foundry.utils.deepClone(this.actor.system.encounter ?? []);
    const entry = list.find((e) => e.uuid === uuid);
    if (!entry) return;
    entry.qty = Math.max(1, (entry.qty ?? 1) + delta);
    await this.actor.update({ "system.encounter": list });
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
}
