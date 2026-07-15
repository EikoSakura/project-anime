import { encounterBudget, encounterLines, minionSpent, effectivePlayers, formatThreat } from "../helpers/encounter.mjs";
import { stampCompendiumSource } from "../helpers/gear.mjs";
import { partyMembers, partyCompanions, ensurePartyFolder } from "../helpers/party-folder.mjs";
import { partyTier, partyTierAuto, tierNumeral, PARTY_TIER_SETTING } from "../helpers/chronicle.mjs";
import { RestApp } from "../apps/rest.mjs";
import { AdvancementApp } from "../apps/advancement.mjs";

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
 *   • Encounter — GM-ONLY budget builder: party size × difficulty = a Threat budget, and a
 *                 drag-in tally of the fight's enemies (each priced by Type) vs that budget.
 * Members and encounter monsters are stored as UUIDs; the Stash uses embedded Items.
 *
 * The party reads as JUST a folder in the Actors sidebar (PF2e-style) — its own actor row is
 * hidden, and this sheet opens from the folder's icon (or the `P` key). Since the right-click
 * "Delete Actor" is therefore out of reach, the GM gets a Delete control in the window header.
 */
export class ProjectAnimePartySheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "party-sheet"],
    position: { width: 660, height: 640 },
    window: { resizable: true, icon: "fa-solid fa-users" },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      editImage: ProjectAnimePartySheet.#onEditImage,
      selectTab: ProjectAnimePartySheet.#onSelectTab,
      toggleMember: ProjectAnimePartySheet.#onToggleMember,
      removeMember: ProjectAnimePartySheet.#onRemoveMember,
      removeMonster: ProjectAnimePartySheet.#onRemoveMonster,
      removeStashItem: ProjectAnimePartySheet.#onRemoveStashItem,
      openStashItem: ProjectAnimePartySheet.#onOpenStashItem,
      giveItem: ProjectAnimePartySheet.#onGiveItem,
      splitGold: ProjectAnimePartySheet.#onSplitGold,
      collectGold: ProjectAnimePartySheet.#onCollectGold,
      openActor: ProjectAnimePartySheet.#onOpenActor,
      advanceCompanion: ProjectAnimePartySheet.#onAdvanceCompanion,
      setMemberBox: ProjectAnimePartySheet.#onSetMemberBox,
      pullRoster: ProjectAnimePartySheet.#onPullRoster,
      restParty: ProjectAnimePartySheet.#onRestParty,
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

  /** UUID of the member whose in-place detail drawer is expanded (one at a time), or null. Survives
   *  re-render — the Party tab re-applies it as the `.expanded` class. */
  #openMember = null;

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
    // available one.
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

    // Party tab — the roster (the party folder's Characters) as Eiyuden-style formation cards. Each
    // card is a scannable readout (portrait, name, Hit + Energy boxes, Guard + Movement) that opens
    // an in-place detail drawer (attribute dice, equipped gear).
    const myCharId = game.user.character?.id ?? null;
    const st = (v) => Number(v) || 0;
    // Hit/Energy MARK-BOX strips — the character sheet's convention (marks = max − value; box n
    // marks n, the topmost marked box clears). Locked boxes (Wound-locked hit boxes, Passive- or
    // Servant-locked energy boxes) trail the strip padlocked. Owners click; others just read.
    const marksOf = (res) => Math.clamp((res.max ?? 0) - (res.value ?? 0), 0, Math.max(res.max ?? 0, 0));
    const boxStrip = (a, key) => {
      const res = a.system?.[key] ?? {};
      let locked = 0;
      if (key === "hp") {
        const authored = Math.clamp(a._source.system?.hp?.max ?? (res.max ?? 0), 1, cfg.maxBoxes ?? 10);
        locked = a.system?.gates?.enabled ? 0 : Math.max(0, authored - (res.max ?? 0));
      } else {
        locked = Math.max(0, (res.base ?? res.max ?? 0) - (res.max ?? 0));
      }
      const m = marksOf(res);
      return [
        ...Array.fromRange(Math.max(res.max ?? 0, 0)).map((i) => ({ n: i + 1, marked: i < m })),
        ...Array.fromRange(Math.max(locked, 0)).map(() => ({ locked: true }))
      ];
    };
    context.members = partyMembers(this.actor).map((a) => {
      const ms = a.system ?? {};
      return {
        ref: a.uuid, name: a.name, img: a.img,
        me: myCharId != null && a.id === myCharId,          // the viewer's own PC — wears their accent frame
        crit: !!ms.critical,                                // 75% of boxes marked (derived) — danger tint + pulse
        expanded: a.uuid === this.#openMember,              // drawer open? (persisted across re-render)
        editable: a.isOwner,
        hpBoxes: boxStrip(a, "hp"),
        energyBoxes: boxStrip(a, "energy"),
        // V2 derived pair: Guard (target number to hit) · Movement (tiles per turn).
        guard: st(ms.guard?.value), mov: st(ms.movement?.value),
        // Drawer depth (rendered hidden, revealed on card click) — the five Attributes as dice glyphs
        // and the equipped paperdoll.
        attrs: cfg.attributeKeys.map((k) => {
          const val = ms.attributes?.[k]?.value ?? 4;
          return { icon: cfg.attributeIcons[k], label: game.i18n.localize(cfg.attributeAbbr[k]), die: `d${val}`, big: val >= 10 };
        }),
        gear: this.#memberGear(a)
      };
    });
    // Pad the grid to six with ghost drop-slots (Eiyuden-faithful); a larger roster just grows the grid.
    context.ghosts = Array.from({ length: Math.max(0, 6 - context.members.length) }, (_, i) => i);
    context.memberCount = context.members.length;

    // Companions strip — the party's bonded Companions (flagged to a member, or filed in the
    // Servants & Companions folder). Rendered only when the party has any. The Advancement
    // button spends the pool the Milestone tool pays them (1 point per milestone).
    context.companions = partyCompanions(this.actor).map((c) => {
      const cs = c.system ?? {};
      let bonder = null;
      const bondRef = c.getFlag("project-anime", "companionOf");
      if (bondRef) { try { bonder = fromUuidSync(bondRef); } catch (_e) { /* bonder gone */ } }
      return {
        ref: c.uuid, name: c.name, img: c.img,
        editable: c.isOwner,
        hpBoxes: boxStrip(c, "hp"),
        energyBoxes: boxStrip(c, "energy"),
        master: bonder?.name ?? "",
        adv: cs.advancement?.value ?? 0,
        canAdvance: c.isOwner
      };
    });
    context.gold = sys.gold ?? 0; // shared treasury (Stash tab)

    // Party Tier I–IV (v0.03 revised): auto = the Tier shared by most member characters (ties read
    // the higher — each member's Tier comes from their Rank); the GM can pin it via the select.
    const override = Number(game.settings.get("project-anime", PARTY_TIER_SETTING)) || 0;
    context.tier = tierNumeral(partyTier());
    context.tierOptions = [
      { v: 0, label: `${game.i18n.localize("PROJECTANIME.Party.tierAuto")} · ${tierNumeral(partyTierAuto())}`, sel: override === 0 },
      ...[1, 2, 3, 4].map((t) => ({ v: t, label: tierNumeral(t), sel: override === t }))
    ];

    // Stash tab — the party's shared items.
    context.stash = this.actor.items
      .filter((i) => STASHABLE.has(i.type))
      .sort(bySort)
      .map((i) => {
        const qty = Number(i.system?.quantity);
        return { id: i.id, name: i.name, img: i.img, qty: qty > 1 ? qty : null, cost: Number(i.system?.cost) || 0 };
      });

    // Encounter tab (GM only) — difficulty, the Threat budget, and the planned enemies on ONE gauge:
    // Threat spent vs the budget (party size × difficulty: Easy ½ · Standard 1 · Hard ×2 ·
    // Climax ×3). Each enemy costs its Tier's Threat (Minion 1 · Standard 2 · Elite 3 · Champion 4);
    // a Villain costs the FULL budget and its Retinue is free. Every enemy is one line (drag again
    // to field another); Minions may not exceed half the budget.
    if (isGM) {
      const players = effectivePlayers(this.actor);
      context.encounterManual = sys.encounterManual ?? false;
      context.encounterPlayers = sys.encounterPlayers ?? 4;
      context.rosterPlayers = this.#resolvedMembers().length || 0; // "From roster" reference (live count)
      context.difficulty = sys.difficulty ?? "standard";
      context.difficultyChoices = Object.fromEntries(
        cfg.encounterDifficultyKeys.map((k) => [k, game.i18n.localize(cfg.encounterDifficulty[k].label)])
      );
      const budget = encounterBudget(this.actor);
      context.budget = formatThreat(budget);
      context.thresholds = cfg.encounterDifficultyKeys.map((k) => {
        const d = cfg.encounterDifficulty[k];
        return { label: game.i18n.localize(d.label), value: formatThreat(Math.max(0, players * (d.mult ?? 1))), active: context.difficulty === k };
      });

      const lines = encounterLines(this.actor);
      context.encounter = lines.map((l) => ({ ...l, threatLabel: l.retinue ? "" : formatThreat(l.threat) }));
      const spent = lines.reduce((s, l) => s + (l.threat || 0), 0);
      context.spent = formatThreat(spent);
      context.over = spent > budget;
      context.usePct = budget > 0 ? Math.clamp(Math.round((spent / budget) * 100), 0, 100) : (spent > 0 ? 100 : 0);
      // Minions may not exceed half the budget (rules "Encounter Budget").
      context.minionOver = budget > 0 && minionSpent(this.actor) > budget / 2;
    }

    return context;
  }

  /** @override — bind drag-drop zones + make Stash items draggable. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Tier select (GM): writes the world override setting (0 = auto), not actor data.
    this.element.querySelector(".party-tier-select")?.addEventListener("change", (ev) => {
      if (!game.user.isGM) return;
      game.settings.set("project-anime", PARTY_TIER_SETTING, Number(ev.currentTarget.value) || 0);
    });
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
      stampCompendiumSource(obj, item);
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
      // Every enemy is its own body (its own line). Field more of the same by dropping it again — a
      // Minion is a single 1-hit-box body too (drop N Minions for a wave), each costing ½ Threat.
      const list = foundry.utils.deepClone(this.actor.system.encounter ?? []);
      list.push({ id: foundry.utils.randomID(), uuid: actor.uuid });
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

  /** Toggle a member card's in-place detail drawer (attribute dice / equipped gear). DOM-only
   *  toggle — instant, no re-render — mirroring #onSelectTab; only one opens at a time, and the open
   *  member is remembered (`#openMember`) so a later data-driven re-render restores it. */
  static #onToggleMember(event, target) {
    const ref = target.closest(".pcard[data-ref]")?.dataset.ref;
    if (!ref) return;
    const opening = this.#openMember !== ref;
    this.#openMember = opening ? ref : null;
    for (const c of this.element.querySelectorAll(".pcard[data-ref]"))
      c.classList.toggle("expanded", opening && c.dataset.ref === ref);
  }

  /** Equipped-gear snapshot for a member's detail drawer: the four paperdoll slots (Weapon / Off-hand /
   *  Armor / Accessory), each `{ name, img }` or null. An off-hand weapon takes the Off-hand
   *  slot, else an equipped shield fills it. */
  #memberGear(actor) {
    const equipped = actor.items.filter((i) => i.system?.equipped);
    const weapons = equipped.filter((i) => i.type === "weapon");
    const main = weapons.find((i) => i.system?.hand === "main") ?? weapons.find((i) => i.system?.hand !== "off") ?? weapons[0] ?? null;
    const off = weapons.find((i) => i.system?.hand === "off" && i !== main) ?? equipped.find((i) => i.type === "shield") ?? null;
    const slot = (i) => (i ? { name: i.name, img: i.img } : null);
    return {
      weapon: slot(main),
      offhand: slot(off),
      armor: slot(equipped.find((i) => i.type === "armor")),
      accessory: slot(equipped.find((i) => i.type === "accessory"))
    };
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
    stampCompendiumSource(obj, item);
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
    stampCompendiumSource(obj, item);
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

  /** Open the Advancement dialog for a Companion (the Milestone tool pays it 1 point per milestone). */
  static async #onAdvanceCompanion(event, target) {
    const ref = target.closest("[data-ref]")?.dataset.ref;
    const companion = ref ? await fromUuid(ref) : null;
    if (!companion?.isOwner) return;
    new AdvancementApp(companion).render(true);
  }

  /** Mark/clear a Hit or Energy box on a member/companion row — the character sheet's box
   *  convention (click box n to mark n; click the topmost marked box to unmark it), resolved
   *  through the row's actor. Owners only (the buttons render disabled for everyone else). */
  static async #onSetMemberBox(event, target) {
    const ref = target.closest("[data-ref]")?.dataset.ref;
    const actor = ref ? await fromUuid(ref) : null;
    if (!actor?.isOwner) return;
    const res = target.dataset.resource;
    if (!["hp", "energy"].includes(res)) return;
    const { value = 0, max = 0 } = actor.system[res] ?? {};
    const n = Number(target.dataset.n) || 0;
    const marked = Math.clamp(max - value, 0, max);
    const next = n === marked ? n - 1 : n;
    await actor.update({ [`system.${res}.value`]: Math.clamp(max - next, 0, max) });
  }

  /** Prefill the manual-estimate player count from the live roster — its member count. Lets the GM
   *  start from the real party and then tweak the number (e.g. "what if there were 5 of them?")
   *  without a built roster. */
  static async #onPullRoster() {
    await this.actor.update({
      "system.encounterPlayers": Math.max(1, this.#resolvedMembers().length || 1)
    });
  }

  /** Party-wide rest (GM): every roster member rests together in ONE dialog — shared Rest Scene,
   *  per-member Downtime Slots — and active quest Deadlines tick down one rest. */
  static #onRestParty() {
    if (!game.user.isGM) return;
    const members = this.#resolvedMembers();
    if (!members.length) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Party.noMembers"));
    new RestApp(members, { party: this.actor }).render(true);
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
