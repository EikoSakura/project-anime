import { ShardsItemBrowser } from "./item-browser.mjs";

/**
 * Mana's Codex — Jobs.
 * Browse Jobs from world items and system compendium packs.
 * Supports full CRUD via the base class.
 */
export class ShardsJobBrowser extends ShardsItemBrowser {

  /** @override */
  static ITEM_TYPE = "job";

  /** @override */
  static COMPENDIUM_PACKS = ["shards-of-mana.jobs"];

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "shards-job-browser",
    window: {
      title: "SHARDS.JobBrowser.Title"
    }
  };

  /* -------------------------------------------- */
  /*  Index Fields                                 */
  /* -------------------------------------------- */

  /** @override */
  _getIndexFields() {
    return [
      "system.rank",
      "system.category",
      "system.baseHp",
      "system.baseMp",
      "system.prerequisites",
      "system.description"
    ];
  }

  /* -------------------------------------------- */
  /*  Card Mapping                                 */
  /* -------------------------------------------- */

  /** @override */
  _mapItemToCard(item) {
    const sys = item.system;
    const rawDesc = sys.description || "";
    const plainDesc = rawDesc.replace(/<[^>]*>/g, "").trim();
    const snippet = plainDesc.length > 80 ? plainDesc.slice(0, 80) + "\u2026" : plainDesc;
    const category = sys.category ?? "basic";

    return {
      name: item.name,
      img: item.img,
      rank: sys.rank,
      categoryBadge: game.i18n.localize(
        CONFIG.SHARDS.jobCategories[category] ?? CONFIG.SHARDS.jobCategories.basic
      ),
      categoryKey: category,
      frontDetail: `${game.i18n.localize("SHARDS.Job.BaseHP")}: ${sys.baseHp}`,
      backDetails: [
        { label: game.i18n.localize("SHARDS.Job.BaseHP"), value: sys.baseHp },
        { label: game.i18n.localize("SHARDS.Job.BaseMP"), value: sys.baseMp }
      ],
      snippet,
      _rank: sys.rank,
      _category: category
    };
  }

  /** @override */
  _mapIndexToCard(entry, pack) {
    const sys = entry.system ?? {};
    const rawDesc = sys.description || "";
    const plainDesc = rawDesc.replace(/<[^>]*>/g, "").trim();
    const snippet = plainDesc.length > 80 ? plainDesc.slice(0, 80) + "\u2026" : plainDesc;
    const category = sys.category ?? "basic";

    return {
      name: entry.name,
      img: entry.img,
      rank: sys.rank ?? "F",
      categoryBadge: game.i18n.localize(
        CONFIG.SHARDS.jobCategories[category] ?? CONFIG.SHARDS.jobCategories.basic
      ),
      categoryKey: category,
      frontDetail: `${game.i18n.localize("SHARDS.Job.BaseHP")}: ${sys.baseHp ?? 10}`,
      backDetails: [
        { label: game.i18n.localize("SHARDS.Job.BaseHP"), value: sys.baseHp ?? 10 },
        { label: game.i18n.localize("SHARDS.Job.BaseMP"), value: sys.baseMp ?? 5 }
      ],
      snippet,
      _rank: sys.rank ?? "F",
      _category: category
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
        key: "rank",
        options: [
          { value: "", label: allLabel, selected: !this._filters.rank },
          ...Object.entries(CONFIG.SHARDS.ranks).map(([value, labelKey]) => ({
            value,
            label: game.i18n.localize(labelKey),
            selected: this._filters.rank === value
          }))
        ]
      },
      {
        key: "category",
        options: [
          { value: "", label: allLabel, selected: !this._filters.category },
          ...Object.entries(CONFIG.SHARDS.jobCategories).map(([value, labelKey]) => ({
            value,
            label: game.i18n.localize(labelKey),
            selected: this._filters.category === value
          }))
        ]
      }
    ];
  }

  /** @override */
  _applyFilters(items) {
    if (this._filters.rank) {
      items = items.filter(i => i._rank === this._filters.rank);
    }
    if (this._filters.category) {
      items = items.filter(i => i._category === this._filters.category);
    }
    return items;
  }

  /* -------------------------------------------- */
  /*  Defaults                                     */
  /* -------------------------------------------- */

  /** @override */
  _getDefaultItemData() {
    return {
      name: game.i18n.localize("TYPES.Item.job"),
      type: "job",
      img: "icons/svg/combat.svg"
    };
  }

  /** @override */
  _getEmptyMessage() {
    return "SHARDS.JobBrowser.NoJobs";
  }
}
