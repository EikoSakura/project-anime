import { ShardsItemBrowser } from "./item-browser.mjs";

/**
 * Browse Skills from world items and system compendium packs.
 * Filters: skillType, damageType (element), powerTier, tag.
 * GM-only template picker for quick skill creation.
 */
export class ShardsSkillBrowser extends ShardsItemBrowser {

  /** @override */
  static ITEM_TYPE = "skill";

  /** @override */
  static COMPENDIUM_PACKS = ["shards-of-mana.skills"];

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "shards-skill-browser",
    window: {
      title: "SHARDS.SkillBrowser.Title"
    },
    actions: {
      createFromTemplate: ShardsSkillBrowser.#onCreateFromTemplate
    }
  };

  /** @override — use custom header with template picker */
  static PARTS = {
    header: {
      template: "systems/shards-of-mana/templates/apps/skill-browser-header.hbs"
    },
    list: {
      template: "systems/shards-of-mana/templates/apps/item-browser-list.hbs",
      scrollable: [""]
    }
  };

  /** Collected tags across all mapped cards. */
  _allTags = new Set();

  /* -------------------------------------------- */
  /*  Lifecycle                                    */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Mark filter panel as collapsible and bind toggle
    const filterPanel = this.element.querySelector(".item-browser-header__filters");
    const filterToggle = this.element.querySelector(".item-browser-header__filter-toggle");
    if (filterPanel && filterToggle) {
      filterPanel.classList.add("collapsible");
      filterToggle.addEventListener("click", () => {
        filterPanel.classList.toggle("open");
        filterToggle.classList.toggle("open");
      });
    }

    // Bind template dropdown toggle
    const tplToggle = this.element.querySelector(".skill-templates-dropdown__toggle");
    if (tplToggle) {
      tplToggle.addEventListener("click", () => {
        tplToggle.closest(".skill-templates-dropdown").classList.toggle("open");
      });
    }
  }

  /* -------------------------------------------- */
  /*  Index Fields                                 */
  /* -------------------------------------------- */

  /** @override */
  _getIndexFields() {
    return [
      "system.skillLevel",
      "system.description",
      "system.skillType",
      "system.damageType",
      "system.powerTier",
      "system.tags"
    ];
  }

  /* -------------------------------------------- */
  /*  Context                                      */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    this._allTags = new Set();
    const context = await super._prepareContext(options);

    // Add skill templates for GM template picker
    if (game.user.isGM) {
      context.skillTemplates = Object.entries(CONFIG.SHARDS.skillTemplates).map(([key, tpl]) => ({
        key,
        label: game.i18n.localize(tpl.label),
        icon: tpl.icon
      }));
    } else {
      context.skillTemplates = [];
    }

    // Flag for filter icon highlight
    context.hasActiveFilters = Object.values(this._filters).some(v => !!v);

    return context;
  }

  /* -------------------------------------------- */
  /*  Card Mapping                                 */
  /* -------------------------------------------- */

  /** @override */
  _mapItemToCard(item) {
    const sys = item.system;
    const typeLabel = game.i18n.localize(CONFIG.SHARDS.skillTypes[sys.skillType] ?? sys.skillType ?? "");
    const rawDesc = sys.description || "";
    const plainDesc = rawDesc.replace(/<[^>]*>/g, "").trim();
    const snippet = plainDesc.length > 80 ? plainDesc.slice(0, 80) + "\u2026" : plainDesc;

    // Collect tags
    const tags = Array.isArray(sys.tags) ? sys.tags : [];
    for (const t of tags) if (t) this._allTags.add(t);

    // Element label
    const elementLabel = sys.damageType
      ? game.i18n.localize(CONFIG.SHARDS.damageTypes[sys.damageType] ?? sys.damageType)
      : "\u2014";

    // Power tier label
    const tierCfg = CONFIG.SHARDS.powerTiers[sys.powerTier];
    const tierLabel = tierCfg ? game.i18n.localize(tierCfg.label) : "\u2014";

    return {
      name: item.name,
      img: item.img,
      rank: null,
      categoryBadge: `SL ${sys.skillLevel}`,
      frontDetail: `${typeLabel} \u00b7 ${elementLabel} \u00b7 SL ${sys.skillLevel}`,
      backDetails: [
        { label: game.i18n.localize("SHARDS.Skill.SkillLevel"), value: String(sys.skillLevel) },
        { label: game.i18n.localize("SHARDS.Skill.SkillType"), value: typeLabel },
        { label: game.i18n.localize("SHARDS.Skill.DamageType"), value: elementLabel },
        { label: game.i18n.localize("SHARDS.Skill.PowerTier"), value: tierLabel }
      ],
      snippet,
      _skillType: sys.skillType ?? "",
      _damageType: sys.damageType ?? "",
      _powerTier: sys.powerTier ?? "",
      _tags: tags
    };
  }

  /** @override */
  _mapIndexToCard(entry, pack) {
    const sys = entry.system ?? {};
    const typeLabel = game.i18n.localize(CONFIG.SHARDS.skillTypes[sys.skillType] ?? sys.skillType ?? "");
    const rawDesc = sys.description || "";
    const plainDesc = rawDesc.replace(/<[^>]*>/g, "").trim();
    const snippet = plainDesc.length > 80 ? plainDesc.slice(0, 80) + "\u2026" : plainDesc;

    // Collect tags
    const tags = Array.isArray(sys.tags) ? sys.tags : [];
    for (const t of tags) if (t) this._allTags.add(t);

    // Element label
    const elementLabel = sys.damageType
      ? game.i18n.localize(CONFIG.SHARDS.damageTypes[sys.damageType] ?? sys.damageType)
      : "\u2014";

    // Power tier label
    const tierCfg = CONFIG.SHARDS.powerTiers[sys.powerTier];
    const tierLabel = tierCfg ? game.i18n.localize(tierCfg.label) : "\u2014";

    return {
      name: entry.name,
      img: entry.img,
      rank: null,
      categoryBadge: `SL ${sys.skillLevel ?? 1}`,
      frontDetail: `${typeLabel} \u00b7 ${elementLabel} \u00b7 SL ${sys.skillLevel ?? 1}`,
      backDetails: [
        { label: game.i18n.localize("SHARDS.Skill.SkillLevel"), value: String(sys.skillLevel ?? 1) },
        { label: game.i18n.localize("SHARDS.Skill.SkillType"), value: typeLabel },
        { label: game.i18n.localize("SHARDS.Skill.DamageType"), value: elementLabel },
        { label: game.i18n.localize("SHARDS.Skill.PowerTier"), value: tierLabel }
      ],
      snippet,
      _skillType: sys.skillType ?? "",
      _damageType: sys.damageType ?? "",
      _powerTier: sys.powerTier ?? "",
      _tags: tags
    };
  }

  /* -------------------------------------------- */
  /*  Filters                                      */
  /* -------------------------------------------- */

  /** @override */
  _buildFilterContext() {
    const allLabel = game.i18n.localize("SHARDS.Browser.All");
    const filters = [
      {
        key: "skillType",
        options: [
          { value: "", label: allLabel, selected: !this._filters.skillType },
          ...Object.entries(CONFIG.SHARDS.skillTypes).map(([value, labelKey]) => ({
            value,
            label: game.i18n.localize(labelKey),
            selected: this._filters.skillType === value
          }))
        ]
      },
      {
        key: "damageType",
        options: [
          { value: "", label: allLabel, selected: !this._filters.damageType },
          ...Object.entries(CONFIG.SHARDS.damageTypes).map(([value, labelKey]) => ({
            value,
            label: game.i18n.localize(labelKey),
            selected: this._filters.damageType === value
          }))
        ]
      },
      {
        key: "powerTier",
        options: [
          { value: "", label: allLabel, selected: !this._filters.powerTier },
          ...Object.entries(CONFIG.SHARDS.powerTiers).map(([value, cfg]) => ({
            value,
            label: game.i18n.localize(cfg.label),
            selected: this._filters.powerTier === value
          }))
        ]
      }
    ];

    // Dynamic tag filter — only show if any tags exist
    if (this._allTags.size > 0) {
      const sortedTags = [...this._allTags].sort((a, b) => a.localeCompare(b));
      filters.push({
        key: "tag",
        options: [
          { value: "", label: allLabel, selected: !this._filters.tag },
          ...sortedTags.map(tag => ({
            value: tag,
            label: tag,
            selected: this._filters.tag === tag
          }))
        ]
      });
    }

    return filters;
  }

  /** @override */
  _applyFilters(items) {
    if (this._filters.skillType) {
      items = items.filter(i => i._skillType === this._filters.skillType);
    }
    if (this._filters.damageType) {
      items = items.filter(i => i._damageType === this._filters.damageType);
    }
    if (this._filters.powerTier) {
      items = items.filter(i => i._powerTier === this._filters.powerTier);
    }
    if (this._filters.tag) {
      items = items.filter(i => i._tags?.includes(this._filters.tag));
    }
    return items;
  }

  /* -------------------------------------------- */
  /*  Defaults                                     */
  /* -------------------------------------------- */

  /** @override */
  _getDefaultItemData() {
    return {
      name: game.i18n.localize("TYPES.Item.skill"),
      type: "skill",
      img: "icons/svg/book.svg"
    };
  }

  /** @override */
  _getEmptyMessage() {
    return "SHARDS.SkillBrowser.NoItems";
  }

  /* -------------------------------------------- */
  /*  Template Picker Action                       */
  /* -------------------------------------------- */

  /**
   * Create a new skill from a predefined template and open its sheet.
   */
  static async #onCreateFromTemplate(event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.template;
    const tpl = CONFIG.SHARDS.skillTemplates[key];
    if (!tpl) return;

    const itemData = {
      name: game.i18n.localize(tpl.label),
      type: "skill",
      img: tpl.icon || "icons/svg/book.svg",
      system: foundry.utils.deepClone(tpl.data)
    };

    const doc = await Item.create(itemData);
    doc.sheet.render(true);
  }
}
