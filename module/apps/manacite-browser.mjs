import { ShardsItemBrowser } from "./item-browser.mjs";

/**
 * Browse Manacite from world items and system compendium packs.
 * Filters: manaciteType, rank.
 */
export class ShardsManaciteBrowser extends ShardsItemBrowser {

  /** @override */
  static ITEM_TYPE = "manacite";

  /** @override */
  static COMPENDIUM_PACKS = ["shards-of-mana.manacite"];

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "shards-manacite-browser",
    window: {
      title: "SHARDS.ManaciteBrowser.Title"
    }
  };

  /* -------------------------------------------- */
  /*  Index Fields                                 */
  /* -------------------------------------------- */

  /** @override */
  _getIndexFields() {
    return [
      "system.rank",
      "system.manaciteType",
      "system.skillGranted",
      "system.skillLevel",
      "system.goldValue",
      "system.absorbed",
      "system.description"
    ];
  }

  /* -------------------------------------------- */
  /*  Card Mapping                                 */
  /* -------------------------------------------- */

  /** @override */
  _mapItemToCard(item) {
    const sys = item.system;
    const typeLabel = game.i18n.localize(CONFIG.SHARDS.manaciteTypes[sys.manaciteType] ?? sys.manaciteType);
    const rawDesc = sys.description || "";
    const plainDesc = rawDesc.replace(/<[^>]*>/g, "").trim();
    const snippet = plainDesc.length > 80 ? plainDesc.slice(0, 80) + "\u2026" : plainDesc;

    return {
      name: item.name,
      img: item.img,
      rank: sys.rank,
      categoryBadge: typeLabel,
      frontDetail: sys.skillGranted ? `${typeLabel} \u2014 ${sys.skillGranted}` : typeLabel,
      backDetails: [
        { label: game.i18n.localize("SHARDS.Manacite.TypeLabel"), value: typeLabel },
        { label: game.i18n.localize("SHARDS.Manacite.SkillGranted"), value: sys.skillGranted || "\u2014" },
        { label: game.i18n.localize("SHARDS.Manacite.SkillLevel"), value: `SL ${sys.skillLevel}` },
        { label: game.i18n.localize("SHARDS.Manacite.GoldValue"), value: String(sys.goldValue) }
      ],
      snippet,
      _manaciteType: sys.manaciteType,
      _rank: sys.rank
    };
  }

  /** @override */
  _mapIndexToCard(entry, pack) {
    const sys = entry.system ?? {};
    const typeLabel = game.i18n.localize(CONFIG.SHARDS.manaciteTypes[sys.manaciteType] ?? sys.manaciteType ?? "");
    const rawDesc = sys.description || "";
    const plainDesc = rawDesc.replace(/<[^>]*>/g, "").trim();
    const snippet = plainDesc.length > 80 ? plainDesc.slice(0, 80) + "\u2026" : plainDesc;

    return {
      name: entry.name,
      img: entry.img,
      rank: sys.rank ?? "F",
      categoryBadge: typeLabel,
      frontDetail: sys.skillGranted ? `${typeLabel} \u2014 ${sys.skillGranted}` : typeLabel,
      backDetails: [
        { label: game.i18n.localize("SHARDS.Manacite.TypeLabel"), value: typeLabel },
        { label: game.i18n.localize("SHARDS.Manacite.SkillGranted"), value: sys.skillGranted || "\u2014" },
        { label: game.i18n.localize("SHARDS.Manacite.SkillLevel"), value: `SL ${sys.skillLevel ?? 1}` },
        { label: game.i18n.localize("SHARDS.Manacite.GoldValue"), value: String(sys.goldValue ?? 0) }
      ],
      snippet,
      _manaciteType: sys.manaciteType ?? "",
      _rank: sys.rank ?? ""
    };
  }

  /* -------------------------------------------- */
  /*  Filters                                      */
  /* -------------------------------------------- */

  /** @override */
  _buildFilterContext() {
    const allLabel = game.i18n.localize("SHARDS.Browser.All");
    return [
      {
        key: "manaciteType",
        options: [
          { value: "", label: allLabel, selected: !this._filters.manaciteType },
          ...Object.entries(CONFIG.SHARDS.manaciteTypes).map(([value, labelKey]) => ({
            value,
            label: game.i18n.localize(labelKey),
            selected: this._filters.manaciteType === value
          }))
        ]
      },
      {
        key: "rank",
        options: [
          { value: "", label: allLabel, selected: !this._filters.rank },
          ...Object.entries(CONFIG.SHARDS.ranks).map(([value, labelKey]) => ({
            value,
            label: game.i18n.localize(labelKey),
            selected: this._filters.rank === value
          }))
        ]
      }
    ];
  }

  /** @override */
  _applyFilters(items) {
    if (this._filters.manaciteType) {
      items = items.filter(i => i._manaciteType === this._filters.manaciteType);
    }
    if (this._filters.rank) {
      items = items.filter(i => i._rank === this._filters.rank);
    }
    return items;
  }

  /** @override */
  _getDefaultItemData() {
    return {
      name: game.i18n.localize("TYPES.Item.manacite"),
      type: "manacite",
      img: "icons/svg/gem.svg"
    };
  }

  /** @override */
  _getEmptyMessage() {
    return "SHARDS.ManaciteBrowser.NoItems";
  }
}
