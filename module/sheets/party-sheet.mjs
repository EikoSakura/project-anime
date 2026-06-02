const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * Party sheet — member roster, shared treasury, quest log.
 */
export class ShardsPartySheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** Transient quest filter state. */
  _questFilter = "all";

  /** Track which quests are expanded (by quest id). */
  _expandedQuests = new Set();

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "party-sheet"],
    position: { width: 720, height: 640 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      // Members
      removeMember: ShardsPartySheet.#onRemoveMember,
      openMemberSheet: ShardsPartySheet.#onOpenMemberSheet,
      browseActors: ShardsPartySheet.#onBrowseActors,
      // Treasury
      depositGold: ShardsPartySheet.#onDepositGold,
      withdrawGold: ShardsPartySheet.#onWithdrawGold,
      // Stash items
      editItem: ShardsPartySheet.#onEditItem,
      deleteItem: ShardsPartySheet.#onDeleteItem,
      // Quests
      addQuest: ShardsPartySheet.#onAddQuest,
      deleteQuest: ShardsPartySheet.#onDeleteQuest,
      toggleObjective: ShardsPartySheet.#onToggleObjective,
      addObjective: ShardsPartySheet.#onAddObjective,
      deleteObjective: ShardsPartySheet.#onDeleteObjective,
      filterQuests: ShardsPartySheet.#onFilterQuests,
      toggleQuestExpand: ShardsPartySheet.#onToggleQuestExpand
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: "systems/shards-of-mana/templates/actors/party/party-header.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    members: {
      template: "systems/shards-of-mana/templates/actors/party/tab-members.hbs",
      scrollable: [""]
    },
    treasury: {
      template: "systems/shards-of-mana/templates/actors/party/tab-treasury.hbs",
      scrollable: [""]
    },
    quests: {
      template: "systems/shards-of-mana/templates/actors/party/tab-quests.hbs",
      scrollable: [""]
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "members", group: "primary", icon: "fa-solid fa-users", label: "SHARDS.Tabs.Members" },
        { id: "treasury", group: "primary", icon: "fa-solid fa-coins", label: "SHARDS.Tabs.Treasury" },
        { id: "quests", group: "primary", icon: "fa-solid fa-scroll", label: "SHARDS.Tabs.Quests" }
      ],
      initial: "members",
      labelPrefix: "SHARDS.Tabs"
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;

    context.actor = actor;
    context.system = system;
    context.config = CONFIG.SHARDS;
    context.isGM = game.user.isGM;

    // Enriched biography
    const TE = foundry.applications.ux.TextEditor.implementation;
    context.enrichedBiography = await TE.enrichHTML(
      system.biography, { async: true, relativeTo: actor }
    );

    // --- Member cards (resolve UUIDs to live actor data) ---
    context.memberCards = [];
    let totalHp = 0, totalHpMax = 0, totalMp = 0, totalMpMax = 0, totalLevel = 0;
    let adventurerCount = 0;

    for (const [idx, member] of system.members.entries()) {
      const linkedActor = await fromUuid(member.actorUuid);
      const isAlive = !!linkedActor;
      const card = {
        ...member,
        _index: idx,
        linkedActor: isAlive ? linkedActor : null,
        displayName: isAlive ? linkedActor.name : member.name,
        displayImg: isAlive ? linkedActor.img : member.img,
        level: null,
        activeJobName: null,
        activeJobRank: null,
        healthPct: 0,
        manaPct: 0,
        health: null,
        mana: null,
        roleDef: member.role ? CONFIG.SHARDS.partyRoles[member.role] : null,
        roleLabel: member.role ? game.i18n.localize(CONFIG.SHARDS.partyRoles[member.role]?.label ?? "") : ""
      };

      if (isAlive && linkedActor.system.health) {
        const h = linkedActor.system.health;
        const m = linkedActor.system.mana;
        card.health = h;
        card.mana = m;
        card.healthPct = h.max > 0 ? Math.clamp(Math.round((h.value / h.max) * 100), 0, 100) : 0;
        card.manaPct = m.max > 0 ? Math.clamp(Math.round((m.value / m.max) * 100), 0, 100) : 0;
        totalHp += h.value;
        totalHpMax += h.max;
        totalMp += m.value;
        totalMpMax += m.max;
      }

      if (isAlive && linkedActor.type === "adventurer") {
        adventurerCount++;
        card.level = linkedActor.system.level;
        totalLevel += linkedActor.system.level;
        const jobId = linkedActor.system.activeJobId;
        if (jobId) {
          const job = linkedActor.items.get(jobId);
          if (job) {
            card.activeJobName = job.name;
            card.activeJobRank = job.system.rank;
          }
        }
      }

      context.memberCards.push(card);
    }

    // Header analytics
    context.memberCount = system.members.length;
    context.avgLevel = adventurerCount > 0 ? Math.round(totalLevel / adventurerCount) : 0;
    context.totalHp = totalHp;
    context.totalHpMax = totalHpMax;
    context.totalMp = totalMp;
    context.totalMpMax = totalMpMax;

    // Role options for select dropdowns
    context.roleOptions = Object.entries(CONFIG.SHARDS.partyRoles).map(([key, def]) => ({
      key,
      label: game.i18n.localize(def.label)
    }));

    // --- Quest cards ---
    const questFilter = this._questFilter;
    context.questFilter = questFilter;
    context.questCards = system.quests
      .map((quest, idx) => ({
        ...quest,
        _index: idx,
        statusLabel: game.i18n.localize(CONFIG.SHARDS.questStatuses[quest.status]?.label ?? ""),
        statusIcon: CONFIG.SHARDS.questStatuses[quest.status]?.icon ?? "fa-solid fa-question",
        statusColor: CONFIG.SHARDS.questStatuses[quest.status]?.color ?? "#9999b0",
        priorityLabel: game.i18n.localize(CONFIG.SHARDS.questPriorities[quest.priority]?.label ?? ""),
        priorityIcon: CONFIG.SHARDS.questPriorities[quest.priority]?.icon ?? "",
        objectiveProgress: quest.objectives.length > 0
          ? `${quest.objectives.filter(o => o.completed).length}/${quest.objectives.length}`
          : null,
        expanded: this._expandedQuests.has(quest.id)
      }))
      .filter(q => questFilter === "all" || q.status === questFilter);

    context.activeQuestCount = system.quests.filter(q => q.status === "active").length;
    context.questCounts = system.questCounts;

    // --- Stash items (owned items on this party actor) ---
    context.stashItems = [...actor.items];

    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    const tabIds = ["members", "treasury", "quests"];
    if (tabIds.includes(partId)) {
      context.tab = context.tabs?.primary?.[partId] ?? context.tabs?.[partId];
    }
    return context;
  }

  /* -------------------------------------------- */
  /*  Drag & Drop                                 */
  /* -------------------------------------------- */

  /** @override */
  async _onDropActor(event, data) {
    if (!this.actor.isOwner) return null;

    const droppedActor = await Actor.implementation.fromDropData(data);
    if (!droppedActor) return null;

    // Only adventurers and NPCs
    const allowed = new Set(["adventurer", "npc"]);
    if (!allowed.has(droppedActor.type)) {
      ui.notifications.warn(game.i18n.localize("SHARDS.Party.InvalidMemberType"));
      return null;
    }

    // Check for duplicate
    const existing = this.actor.system.members.find(m => m.actorUuid === droppedActor.uuid);
    if (existing) {
      ui.notifications.warn(game.i18n.format("SHARDS.Party.AlreadyMember", { name: droppedActor.name }));
      return null;
    }

    const members = [...this.actor.system.members, {
      actorUuid: droppedActor.uuid,
      img: droppedActor.img || "icons/svg/mystery-man.svg",
      name: droppedActor.name,
      role: "",
      joinDate: new Date().toLocaleDateString(),
      notes: ""
    }];
    await this.actor.update({ "system.members": members });
    ui.notifications.info(game.i18n.format("SHARDS.Party.MemberAdded", { name: droppedActor.name }));
  }

  /** @override */
  async _onDropItem(event, data) {
    if (!this.actor.isOwner) return null;
    return super._onDropItem(event, data);
  }

  /* -------------------------------------------- */
  /*  Member Actions                              */
  /* -------------------------------------------- */

  static async #onRemoveMember(event, target) {
    const idx = Number(target.closest("[data-member-index]")?.dataset.memberIndex);
    const member = this.actor.system.members[idx];
    if (!member) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("SHARDS.Party.RemoveMemberTitle") },
      content: `<p>${game.i18n.format("SHARDS.Party.RemoveMemberConfirm", { name: member.name || "?" })}</p>`
    });
    if (!confirmed) return;
    const members = this.actor.system.members.filter((_, i) => i !== idx);
    await this.actor.update({ "system.members": members });
  }

  static async #onOpenMemberSheet(event, target) {
    const idx = Number(target.closest("[data-member-index]")?.dataset.memberIndex);
    const member = this.actor.system.members[idx];
    if (!member?.actorUuid) return;
    const actor = await fromUuid(member.actorUuid);
    if (actor) actor.sheet.render(true);
    else ui.notifications.warn(game.i18n.localize("SHARDS.Party.MemberNotFound"));
  }

  static async #onBrowseActors(event, target) {
    const existing = new Set(this.actor.system.members.map(m => m.actorUuid));
    const candidates = game.actors.filter(a =>
      (a.type === "adventurer" || a.type === "npc") && !existing.has(a.uuid)
    );
    if (!candidates.length) {
      ui.notifications.info(game.i18n.localize("SHARDS.Party.NoActorsAvailable"));
      return;
    }

    let selectedId = candidates[0].id;
    const optionsHtml = candidates.map((a, idx) => `
      <label class="party-actor-option">
        <input type="radio" name="actorId" value="${a.id}" ${idx === 0 ? "checked" : ""} />
        <img src="${a.img}" width="32" height="32" />
        <span>${a.name}</span>
        <span class="party-actor-type">${a.type}</span>
      </label>
    `).join("");

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("SHARDS.Party.BrowseActors") },
      content: `<div class="party-actor-picker">${optionsHtml}</div>`,
      buttons: [
        { action: "confirm", label: game.i18n.localize("SHARDS.Party.AddMember"), icon: "fa-solid fa-plus" },
        { action: "cancel", label: game.i18n.localize("SHARDS.Cancel") }
      ],
      render: (event, dialog) => {
        for (const radio of dialog.element.querySelectorAll("input[name='actorId']")) {
          radio.addEventListener("change", () => { selectedId = radio.value; });
        }
      }
    });
    if (result !== "confirm") return;
    const actor = game.actors.get(selectedId);
    if (!actor) return;

    const members = [...this.actor.system.members, {
      actorUuid: actor.uuid,
      img: actor.img || "icons/svg/mystery-man.svg",
      name: actor.name,
      role: "",
      joinDate: new Date().toLocaleDateString(),
      notes: ""
    }];
    await this.actor.update({ "system.members": members });
    ui.notifications.info(game.i18n.format("SHARDS.Party.MemberAdded", { name: actor.name }));
  }

  /* -------------------------------------------- */
  /*  Treasury Actions                            */
  /* -------------------------------------------- */

  static async #onDepositGold(event, target) {
    const memberIdx = Number(target.closest("[data-member-index]")?.dataset.memberIndex);
    const member = this.actor.system.members[memberIdx];
    if (!member?.actorUuid) return;
    const memberActor = await fromUuid(member.actorUuid);
    if (!memberActor || !memberActor.isOwner) return;
    const memberGold = memberActor.system.gold ?? 0;

    let amount = 0;
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("SHARDS.Party.DepositGold") },
      content: `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;">
        <label>${game.i18n.localize("SHARDS.Party.Amount")}</label>
        <input type="number" name="amount" value="0" min="0" max="${memberGold}" style="width:80px" />
        <span style="opacity:0.6">/ ${memberGold} G</span>
      </div>`,
      buttons: [
        { action: "confirm", label: game.i18n.localize("SHARDS.Party.Deposit"), icon: "fa-solid fa-arrow-down" },
        { action: "cancel", label: game.i18n.localize("SHARDS.Cancel") }
      ],
      render: (event, dialog) => {
        const input = dialog.element.querySelector("input[name='amount']");
        input.addEventListener("change", () => { amount = Math.clamp(Number(input.value) || 0, 0, memberGold); });
        input.addEventListener("input", () => { amount = Math.clamp(Number(input.value) || 0, 0, memberGold); });
      }
    });
    if (result !== "confirm" || amount <= 0) return;

    await memberActor.update({ "system.gold": memberGold - amount });
    await this.actor.update({ "system.gold": this.actor.system.gold + amount });
  }

  static async #onWithdrawGold(event, target) {
    const memberIdx = Number(target.closest("[data-member-index]")?.dataset.memberIndex);
    const member = this.actor.system.members[memberIdx];
    if (!member?.actorUuid) return;
    const memberActor = await fromUuid(member.actorUuid);
    if (!memberActor || !memberActor.isOwner) return;
    const partyGold = this.actor.system.gold;

    let amount = 0;
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("SHARDS.Party.WithdrawGold") },
      content: `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;">
        <label>${game.i18n.localize("SHARDS.Party.Amount")}</label>
        <input type="number" name="amount" value="0" min="0" max="${partyGold}" style="width:80px" />
        <span style="opacity:0.6">/ ${partyGold} G</span>
      </div>`,
      buttons: [
        { action: "confirm", label: game.i18n.localize("SHARDS.Party.Withdraw"), icon: "fa-solid fa-arrow-up" },
        { action: "cancel", label: game.i18n.localize("SHARDS.Cancel") }
      ],
      render: (event, dialog) => {
        const input = dialog.element.querySelector("input[name='amount']");
        input.addEventListener("change", () => { amount = Math.clamp(Number(input.value) || 0, 0, partyGold); });
        input.addEventListener("input", () => { amount = Math.clamp(Number(input.value) || 0, 0, partyGold); });
      }
    });
    if (result !== "confirm" || amount <= 0) return;

    await this.actor.update({ "system.gold": partyGold - amount });
    await memberActor.update({ "system.gold": (memberActor.system.gold ?? 0) + amount });
  }

  /* -------------------------------------------- */
  /*  Item Stash Actions                          */
  /* -------------------------------------------- */

  static #onEditItem(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) item.sheet.render(true);
  }

  static async #onDeleteItem(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) await item.delete();
  }

  /* -------------------------------------------- */
  /*  Quest Actions                               */
  /* -------------------------------------------- */

  static async #onAddQuest(event, target) {
    const newId = foundry.utils.randomID();
    const quests = [...this.actor.system.quests, {
      id: newId,
      title: game.i18n.localize("SHARDS.Party.NewQuest"),
      description: "",
      status: "active",
      priority: "normal",
      rewards: "",
      objectives: [],
      gmNotes: ""
    }];
    this._expandedQuests.add(newId);
    await this.actor.update({ "system.quests": quests });
  }

  static async #onDeleteQuest(event, target) {
    const questId = target.closest("[data-quest-id]")?.dataset.questId;
    const quest = this.actor.system.quests.find(q => q.id === questId);
    if (!quest) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("SHARDS.Party.DeleteQuestTitle") },
      content: `<p>${game.i18n.format("SHARDS.Party.DeleteQuestConfirm", { title: quest.title })}</p>`
    });
    if (!confirmed) return;
    this._expandedQuests.delete(questId);
    const quests = this.actor.system.quests.filter(q => q.id !== questId);
    await this.actor.update({ "system.quests": quests });
  }

  static async #onToggleObjective(event, target) {
    const questId = target.closest("[data-quest-id]")?.dataset.questId;
    const objIdx = Number(target.dataset.objectiveIndex);
    const quests = foundry.utils.deepClone(this.actor.system.quests);
    const quest = quests.find(q => q.id === questId);
    if (!quest || !quest.objectives[objIdx]) return;
    quest.objectives[objIdx].completed = !quest.objectives[objIdx].completed;
    await this.actor.update({ "system.quests": quests });
  }

  static async #onAddObjective(event, target) {
    const questId = target.closest("[data-quest-id]")?.dataset.questId;
    const quests = foundry.utils.deepClone(this.actor.system.quests);
    const quest = quests.find(q => q.id === questId);
    if (!quest) return;
    quest.objectives.push({ text: "", completed: false });
    await this.actor.update({ "system.quests": quests });
  }

  static async #onDeleteObjective(event, target) {
    const questId = target.closest("[data-quest-id]")?.dataset.questId;
    const objIdx = Number(target.dataset.objectiveIndex);
    const quests = foundry.utils.deepClone(this.actor.system.quests);
    const quest = quests.find(q => q.id === questId);
    if (!quest) return;
    quest.objectives.splice(objIdx, 1);
    await this.actor.update({ "system.quests": quests });
  }

  static #onFilterQuests(event, target) {
    this._questFilter = target.dataset.filter ?? "all";
    this.render();
  }

  static #onToggleQuestExpand(event, target) {
    const questId = target.closest("[data-quest-id]")?.dataset.questId;
    if (!questId) return;
    if (this._expandedQuests.has(questId)) this._expandedQuests.delete(questId);
    else this._expandedQuests.add(questId);
    this.render();
  }

  /* -------------------------------------------- */
  /*  Render Hooks                                 */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Handle role select changes manually to avoid form serialization
    // wiping the members array (form only has role fields, not full member data)
    for (const select of this.element.querySelectorAll("select.role-select[data-role-index]")) {
      select.addEventListener("change", async (e) => {
        const idx = Number(e.target.dataset.roleIndex);
        const members = foundry.utils.deepClone(this.actor.system.members);
        if (members[idx]) {
          members[idx].role = e.target.value;
          await this.actor.update({ "system.members": members });
        }
      });
    }

    // Ensure the active tab is always visible after any re-render
    const activeTab = this.tabGroups?.primary ?? "members";
    const tabs = this.element.querySelectorAll("[data-group='primary'][data-tab]");
    for (const tab of tabs) {
      tab.classList.toggle("active", tab.dataset.tab === activeTab);
    }
    const navButtons = this.element.querySelectorAll("[data-group='primary'][data-action='tab']");
    for (const btn of navButtons) {
      btn.classList.toggle("active", btn.dataset.tab === activeTab);
    }

    // Restore expanded quest card state
    for (const questId of this._expandedQuests) {
      const card = this.element.querySelector(`.quest-card[data-quest-id="${questId}"]`);
      if (card) card.classList.add("expanded");
    }
  }
}
