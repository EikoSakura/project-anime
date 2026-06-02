const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Mana's Codex — Monster Browser.
 * Browses Actor documents of type "monster" from both world and compendium sources.
 * Reuses the item-browser templates/CSS for visual consistency.
 */
export class ShardsMonsterBrowser extends HandlebarsApplicationMixin(ApplicationV2) {

  /** Hook IDs for live re-rendering. */
  #hookIds = [];

  /* -------------------------------------------- */
  /*  Default Options                              */
  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "shards-monster-browser",
    classes: ["shards-of-mana", "item-browser"],
    position: { width: 680, height: 580 },
    window: {
      title: "SHARDS.MonsterBrowser.Title",
      resizable: true,
      icon: "fa-solid fa-book-sparkles"
    },
    actions: {
      viewItem: ShardsMonsterBrowser.#onViewMonster,
      flipCard: ShardsMonsterBrowser.#onFlipCard,
      createItem: ShardsMonsterBrowser.#onCreateMonster
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: "systems/shards-of-mana/templates/apps/item-browser-header.hbs"
    },
    list: {
      template: "systems/shards-of-mana/templates/apps/item-browser-list.hbs",
      scrollable: [""]
    }
  };

  /** Compendium packs to search for monsters. */
  static COMPENDIUM_PACKS = ["shards-of-mana.monsters"];

  /* -------------------------------------------- */
  /*  Filter State                                 */
  /* -------------------------------------------- */

  _filters = {};
  _searchText = "";

  /* -------------------------------------------- */
  /*  Lifecycle                                    */
  /* -------------------------------------------- */

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const cb = (actor) => {
      if (actor.type === "monster" && !actor.parent) this.render();
    };
    this.#hookIds = [
      Hooks.on("createActor", cb),
      Hooks.on("updateActor", cb),
      Hooks.on("deleteActor", cb)
    ];
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Bind dragstart on all cards
    for (const card of this.element.querySelectorAll(".item-browser-card[data-uuid]")) {
      card.addEventListener("dragstart", this.#onDragStart.bind(this));
    }

    // Encounter Builder integration — add "Add to Encounter" buttons
    if (this._encounterBuilderRef) {
      for (const card of this.element.querySelectorAll(".item-browser-card[data-uuid]")) {
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "item-browser-card__add-encounter";
        addBtn.innerHTML = `<i class="fa-solid fa-plus"></i>`;
        addBtn.title = game.i18n.localize("SHARDS.Encounter.AddMonster");
        addBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const uuid = card.dataset.uuid;
          const actor = await fromUuid(uuid);
          if (actor) this._encounterBuilderRef.addMonsterFromBrowser(actor);
        });
        const cardInner = card.querySelector(".item-browser-card__front") ?? card;
        cardInner.appendChild(addBtn);
      }
    }

    // Bind right-click context menu on cards (GM only)
    if (game.user.isGM) {
      for (const card of this.element.querySelectorAll(".item-browser-card[data-uuid]")) {
        card.addEventListener("contextmenu", this._onCardContextMenu.bind(this));
      }
    }

    // Bind search input
    const searchInput = this.element.querySelector(".item-browser-search");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this._searchText = e.target.value;
        this.render({ parts: ["list"] });
      });
    }

    // Bind filter selects
    for (const select of this.element.querySelectorAll(".item-browser-filter")) {
      select.addEventListener("change", (e) => {
        this._filters[e.target.dataset.filterKey] = e.target.value;
        this.render({ parts: ["list"] });
      });
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    const hookNames = ["createActor", "updateActor", "deleteActor"];
    for (let i = 0; i < hookNames.length; i++) {
      Hooks.off(hookNames[i], this.#hookIds[i]);
    }
    this.#hookIds = [];
  }

  /* -------------------------------------------- */
  /*  Context                                      */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    // Gather world monsters
    let allItems = game.actors.filter(a => a.type === "monster").map(actor => ({
      ...this._mapActorToCard(actor),
      uuid: actor.uuid,
      source: "world",
      sourceLabel: game.i18n.localize("SHARDS.Browser.SourceWorld")
    }));

    // Gather from compendium packs
    for (const packName of this.constructor.COMPENDIUM_PACKS) {
      const pack = game.packs.get(packName);
      if (!pack) continue;
      const index = await pack.getIndex({ fields: ["system.rank", "system.speciesTags"] });
      for (const entry of index) {
        if (allItems.some(i => i.name === entry.name && i.source === "world")) continue;
        allItems.push({
          ...this._mapIndexToCard(entry, pack),
          uuid: entry.uuid,
          source: "compendium",
          sourceLabel: pack.metadata.label
        });
      }
    }

    // Apply rank filter
    if (this._filters.rank && this._filters.rank !== "all") {
      allItems = allItems.filter(i => i.rank === this._filters.rank);
    }

    // Apply search text
    if (this._searchText) {
      const search = this._searchText.toLowerCase();
      allItems = allItems.filter(i => i.name.toLowerCase().includes(search));
    }

    // Sort alphabetically
    allItems.sort((a, b) => a.name.localeCompare(b.name));

    context.items = allItems;
    context.itemCount = allItems.length;
    context.config = CONFIG.SHARDS;
    context.filters = this._buildFilterContext();
    context.searchText = this._searchText;
    context.emptyMessage = "SHARDS.MonsterBrowser.NoMonsters";
    context.isGM = game.user.isGM;
    return context;
  }

  /* -------------------------------------------- */
  /*  Mapping Helpers                              */
  /* -------------------------------------------- */

  /**
   * Map a world Actor document to a normalized card display object.
   * @param {Actor} actor
   * @returns {object}
   */
  _mapActorToCard(actor) {
    const sys = actor.system;
    const tags = sys.speciesTags?.length ? sys.speciesTags.join(", ") : null;
    return {
      name: actor.name,
      img: actor.img,
      rank: sys.rank || "F",
      frontDetail: tags,
      backDetails: [
        { label: game.i18n.localize("SHARDS.Rank"), value: sys.rank || "F" },
        { label: game.i18n.localize("SHARDS.Health"), value: `${sys.health?.value ?? 0} / ${sys.health?.max ?? 0}` },
        { label: game.i18n.localize("SHARDS.Mana"), value: `${sys.mana?.value ?? 0} / ${sys.mana?.max ?? 0}` }
      ],
      snippet: tags ? game.i18n.format("SHARDS.Monster.SpeciesTags", { tags }) : null
    };
  }

  /**
   * Map a compendium index entry to a normalized card display object.
   * @param {object} entry
   * @param {CompendiumCollection} pack
   * @returns {object}
   */
  _mapIndexToCard(entry, pack) {
    const rank = entry.system?.rank || "F";
    const tags = entry.system?.speciesTags?.length ? entry.system.speciesTags.join(", ") : null;
    return {
      name: entry.name,
      img: entry.img || "icons/svg/mystery-man.svg",
      rank,
      frontDetail: tags,
      backDetails: [
        { label: game.i18n.localize("SHARDS.Rank"), value: rank }
      ],
      snippet: tags ? game.i18n.format("SHARDS.Monster.SpeciesTags", { tags }) : null
    };
  }

  /**
   * Build filter dropdown context.
   * @returns {object[]}
   */
  _buildFilterContext() {
    const rankOptions = [
      { value: "all", label: game.i18n.localize("SHARDS.Browser.All"), selected: !this._filters.rank || this._filters.rank === "all" }
    ];
    for (const [key, label] of Object.entries(CONFIG.SHARDS.ranks)) {
      rankOptions.push({
        value: key,
        label: game.i18n.localize(label),
        selected: this._filters.rank === key
      });
    }
    return [{ key: "rank", options: rankOptions }];
  }

  /* -------------------------------------------- */
  /*  Drag & Action Handlers                       */
  /* -------------------------------------------- */

  #onDragStart(event) {
    const uuid = event.currentTarget.dataset.uuid;
    if (!uuid) return;
    event.dataTransfer.setData("text/plain", JSON.stringify({
      type: "Actor",
      uuid
    }));
  }

  static async #onViewMonster(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    const doc = await fromUuid(uuid);
    doc?.sheet?.render(true);
  }

  static #onFlipCard(event, target) {
    const card = target.closest(".item-browser-card");
    if (!card) return;
    const flipContainer = card.querySelector(".item-browser-card__flip");
    if (flipContainer) flipContainer.classList.toggle("flipped");
  }

  /**
   * Create a new world monster actor and open its sheet.
   */
  static async #onCreateMonster(event, target) {
    if (!game.user.isGM) return;
    const doc = await Actor.create({
      name: game.i18n.localize("TYPES.Actor.monster"),
      type: "monster",
      img: "icons/svg/mystery-man.svg"
    });
    doc.sheet.render(true);
  }

  /* -------------------------------------------- */
  /*  Right-Click Context Menu                     */
  /* -------------------------------------------- */

  /**
   * Show a context menu with Edit / Delete options.
   * @param {PointerEvent} event
   */
  async _onCardContextMenu(event) {
    event.preventDefault();
    this.element.querySelector(".item-browser-context")?.remove();

    const card = event.currentTarget;
    const uuid = card.dataset.uuid;
    const actor = await fromUuid(uuid);
    if (!actor) return;

    const menu = document.createElement("div");
    menu.classList.add("item-browser-context");
    menu.innerHTML = `
      <ul class="item-browser-context__list">
        <li class="item-browser-context__item" data-ctx-action="edit">
          <i class="fa-solid fa-pen-to-square"></i> ${game.i18n.localize("SHARDS.Edit")}
        </li>
        <li class="item-browser-context__item item-browser-context__item--danger" data-ctx-action="delete">
          <i class="fa-solid fa-trash"></i> ${game.i18n.localize("SHARDS.Delete")}
        </li>
      </ul>
    `;

    const appRect = this.element.getBoundingClientRect();
    let x = event.clientX - appRect.left;
    let y = event.clientY - appRect.top;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    this.element.appendChild(menu);

    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > appRect.right) {
      x -= (menuRect.right - appRect.right + 4);
      menu.style.left = `${x}px`;
    }
    if (menuRect.bottom > appRect.bottom) {
      y -= (menuRect.bottom - appRect.bottom + 4);
      menu.style.top = `${y}px`;
    }

    menu.querySelector('[data-ctx-action="edit"]').addEventListener("click", () => {
      actor.sheet.render(true);
      menu.remove();
    });

    menu.querySelector('[data-ctx-action="delete"]').addEventListener("click", async () => {
      menu.remove();
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("SHARDS.Delete") },
        content: `<p>${game.i18n.format("SHARDS.Browser.ConfirmDelete", { name: actor.name })}</p>`,
        yes: { default: true }
      });
      if (confirmed) {
        await actor.delete();
        this.render();
      }
    });

    const dismiss = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("click", dismiss, true);
        document.removeEventListener("contextmenu", dismiss, true);
      }
    };
    setTimeout(() => {
      document.addEventListener("click", dismiss, true);
      document.addEventListener("contextmenu", dismiss, true);
    }, 0);
  }
}
