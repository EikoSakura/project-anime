import { ShardsItemBrowser } from "./item-browser.mjs";

/**
 * Browse Equipment from world items and system compendium packs.
 * Filters: slot, weaponGroup.
 */
export class ShardsEquipmentBrowser extends ShardsItemBrowser {

  /** @override */
  static ITEM_TYPE = "equipment";

  /** @override */
  static COMPENDIUM_PACKS = ["shards-of-mana.equipment"];

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "shards-equipment-browser",
    window: {
      title: "SHARDS.EquipmentBrowser.Title"
    }
  };

  /* -------------------------------------------- */
  /*  Index Fields                                 */
  /* -------------------------------------------- */

  /** @override */
  _getIndexFields() {
    return [
      "system.slot",
      "system.weaponGroup",
      "system.armorCategory",
      "system.rank",
      "system.baseAccuracy",
      "system.pDmg",
      "system.mDmg",
      "system.statBonuses",
      "system.description"
    ];
  }

  /* -------------------------------------------- */
  /*  Card Mapping                                 */
  /* -------------------------------------------- */

  /** @override */
  _mapItemToCard(item) {
    const sys = item.system;
    const slotLabel = game.i18n.localize(CONFIG.SHARDS.equipmentSlots[sys.slot] ?? sys.slot);
    const rawDesc = sys.description || "";
    const plainDesc = rawDesc.replace(/<[^>]*>/g, "").trim();
    const snippet = plainDesc.length > 80 ? plainDesc.slice(0, 80) + "\u2026" : plainDesc;

    // Build back details based on weapon/offhand vs armor
    const backDetails = [];
    if (sys.slot === "weapon" || sys.slot === "offhand") {
      if (sys.slot === "weapon") {
        const groupLabel = game.i18n.localize(CONFIG.SHARDS.weaponGroups[sys.weaponGroup] ?? sys.weaponGroup ?? "—");
        backDetails.push({ label: game.i18n.localize("SHARDS.Equipment.Group"), value: groupLabel });
      }
      const combatStats = `Acc ${sys.baseAccuracy ?? 50}% / P.Dmg ${sys.pDmg ?? 0} / M.Dmg ${sys.mDmg ?? 0}`;
      backDetails.push({ label: game.i18n.localize("SHARDS.Equipment.CombatStats"), value: combatStats });
    } else if (sys.slot === "armor" || sys.slot === "helm") {
      const catLabel = game.i18n.localize(CONFIG.SHARDS.armorCategories[sys.armorCategory] ?? sys.armorCategory ?? "—");
      backDetails.push({ label: game.i18n.localize("SHARDS.Equipment.Category"), value: catLabel });
    }
    backDetails.push({ label: game.i18n.localize("SHARDS.EquipmentBrowser.SlotLabel"), value: slotLabel });

    // Stat bonuses summary
    const statSummary = this.#buildStatSummary(sys.statBonuses);
    if (statSummary) backDetails.push({ label: game.i18n.localize("SHARDS.Equipment.Stats"), value: statSummary });

    return {
      name: item.name,
      img: item.img,
      rank: sys.rank,
      categoryBadge: slotLabel,
      frontDetail: slotLabel,
      backDetails,
      snippet,
      _slot: sys.slot,
      _weaponGroup: sys.weaponGroup ?? ""
    };
  }

  /** @override */
  _mapIndexToCard(entry, pack) {
    const sys = entry.system ?? {};
    const slotLabel = game.i18n.localize(CONFIG.SHARDS.equipmentSlots[sys.slot] ?? sys.slot ?? "");
    const rawDesc = sys.description || "";
    const plainDesc = rawDesc.replace(/<[^>]*>/g, "").trim();
    const snippet = plainDesc.length > 80 ? plainDesc.slice(0, 80) + "\u2026" : plainDesc;

    const backDetails = [];
    if (sys.slot === "weapon" || sys.slot === "offhand") {
      if (sys.slot === "weapon") {
        const groupLabel = game.i18n.localize(CONFIG.SHARDS.weaponGroups[sys.weaponGroup] ?? sys.weaponGroup ?? "—");
        backDetails.push({ label: game.i18n.localize("SHARDS.Equipment.Group"), value: groupLabel });
      }
      const combatStats = `Acc ${sys.baseAccuracy ?? 50}% / P.Dmg ${sys.pDmg ?? 0} / M.Dmg ${sys.mDmg ?? 0}`;
      backDetails.push({ label: game.i18n.localize("SHARDS.Equipment.CombatStats"), value: combatStats });
    } else if (sys.slot === "armor" || sys.slot === "helm") {
      const catLabel = game.i18n.localize(CONFIG.SHARDS.armorCategories[sys.armorCategory] ?? sys.armorCategory ?? "—");
      backDetails.push({ label: game.i18n.localize("SHARDS.Equipment.Category"), value: catLabel });
    }
    backDetails.push({ label: game.i18n.localize("SHARDS.EquipmentBrowser.SlotLabel"), value: slotLabel });

    const statSummary = this.#buildStatSummary(sys.statBonuses ?? {});
    if (statSummary) backDetails.push({ label: game.i18n.localize("SHARDS.Equipment.Stats"), value: statSummary });

    return {
      name: entry.name,
      img: entry.img,
      rank: sys.rank ?? "F",
      categoryBadge: slotLabel,
      frontDetail: slotLabel,
      backDetails,
      snippet,
      _slot: sys.slot ?? "",
      _weaponGroup: sys.weaponGroup ?? ""
    };
  }

  /**
   * Build a compact stat bonus summary string like "+3 STR, +2 AGI".
   * @param {object} bonuses
   * @returns {string}
   */
  #buildStatSummary(bonuses) {
    if (!bonuses) return "";
    const parts = [];
    for (const [key, value] of Object.entries(bonuses)) {
      if (value && value !== 0) {
        const label = game.i18n.localize(`SHARDS.Stats.${key}`).toUpperCase();
        parts.push(`${value > 0 ? "+" : ""}${value} ${label}`);
      }
    }
    return parts.join(", ");
  }

  /* -------------------------------------------- */
  /*  Filters                                      */
  /* -------------------------------------------- */

  /** @override */
  _buildFilterContext() {
    const allLabel = game.i18n.localize("SHARDS.Browser.All");
    return [
      {
        key: "slot",
        options: [
          { value: "", label: allLabel, selected: !this._filters.slot },
          ...Object.entries(CONFIG.SHARDS.equipmentSlots).map(([value, labelKey]) => ({
            value,
            label: game.i18n.localize(labelKey),
            selected: this._filters.slot === value
          }))
        ]
      },
      {
        key: "weaponGroup",
        options: [
          { value: "", label: allLabel, selected: !this._filters.weaponGroup },
          ...Object.entries(CONFIG.SHARDS.weaponGroups).map(([value, labelKey]) => ({
            value,
            label: game.i18n.localize(labelKey),
            selected: this._filters.weaponGroup === value
          }))
        ]
      }
    ];
  }

  /** @override */
  _applyFilters(items) {
    if (this._filters.slot) {
      items = items.filter(i => i._slot === this._filters.slot);
    }
    if (this._filters.weaponGroup) {
      items = items.filter(i => i._weaponGroup === this._filters.weaponGroup);
    }
    return items;
  }

  /** @override */
  _getDefaultItemData() {
    return {
      name: game.i18n.localize("TYPES.Item.equipment"),
      type: "equipment",
      img: "icons/svg/sword.svg"
    };
  }

  /** @override */
  _getEmptyMessage() {
    return "SHARDS.EquipmentBrowser.NoItems";
  }
}
