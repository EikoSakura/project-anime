import { ShardsItemBrowser } from "./item-browser.mjs";

/**
 * Browse Lineages from world items and system compendium packs.
 */
export class ShardsLineageBrowser extends ShardsItemBrowser {

  /** @override */
  static ITEM_TYPE = "lineage";

  /** @override */
  static COMPENDIUM_PACKS = ["shards-of-mana.lineages"];

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "shards-lineage-browser",
    window: {
      title: "SHARDS.LineageBrowser.Title"
    }
  };

  /* -------------------------------------------- */
  /*  Index Fields                                 */
  /* -------------------------------------------- */

  /** @override */
  _getIndexFields() {
    return [
      "system.size",
      "system.description",
      "system.tree"
    ];
  }

  /* -------------------------------------------- */
  /*  Card Mapping                                 */
  /* -------------------------------------------- */

  /** @override */
  _mapItemToCard(item) {
    return this.#buildCard(item.name, item.img, item.system);
  }

  /** @override */
  _mapIndexToCard(entry, pack) {
    return this.#buildCard(entry.name, entry.img, entry.system ?? {});
  }

  /**
   * Build a browser card from lineage data.
   * @param {string} name
   * @param {string} img
   * @param {object} sys
   * @returns {object}
   */
  #buildCard(name, img, sys) {
    const rawDesc = sys.description || "";
    const plainDesc = rawDesc.replace(/<[^>]*>/g, "").trim();
    const snippet = plainDesc.length > 80 ? plainDesc.slice(0, 80) + "\u2026" : plainDesc;

    // Node count from tree
    const nodeCount = sys.tree?.nodes?.length ?? sys.nodeCount ?? 0;

    const backDetails = [];
    backDetails.push({
      label: game.i18n.localize("SHARDS.Lineage.Size"),
      value: String(sys.size ?? 1)
    });
    if (nodeCount) {
      backDetails.push({
        label: game.i18n.localize("SHARDS.Lineage.NodeCount"),
        value: String(nodeCount)
      });
    }

    return {
      name,
      img,
      rank: null,
      categoryBadge: game.i18n.localize("TYPES.Item.lineage"),
      frontDetail: `${game.i18n.localize("SHARDS.Lineage.Size")}: ${sys.size ?? 1}`,
      backDetails,
      snippet
    };
  }

  /* -------------------------------------------- */
  /*  Filters                                      */
  /* -------------------------------------------- */

  /** @override */
  _buildFilterContext() {
    return [];
  }

  /** @override */
  _applyFilters(items) {
    return items;
  }

  /** @override */
  _getDefaultItemData() {
    return {
      name: game.i18n.localize("TYPES.Item.lineage"),
      type: "lineage",
      img: "icons/svg/dna.svg"
    };
  }

  /** @override */
  _getEmptyMessage() {
    return "SHARDS.LineageBrowser.NoItems";
  }
}
