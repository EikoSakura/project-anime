import { ShardsItemSheet } from "./item-sheet.mjs";

/**
 * Sheet for the Equipment item type.
 * Features:
 * - Crystal header with portrait, name, rank badge, slot/weapon-group/armor-category selectors
 * - Details tab: stat bonuses grid, weapon fields (accuracy/damage), property chips
 * - Description tab: rich-text editor
 * - Effects tab: Active Effects panel
 */
export class ShardsEquipmentSheet extends ShardsItemSheet {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "item-sheet", "equipment-sheet"],
    position: { width: 520, height: 540 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      ...ShardsItemSheet.DEFAULT_OPTIONS.actions,
      addProperty: ShardsEquipmentSheet.#onAddProperty,
      removeProperty: ShardsEquipmentSheet.#onRemoveProperty
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: "systems/shards-of-mana/templates/items/equipment/equipment-header.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    details: {
      template: "systems/shards-of-mana/templates/items/equipment/tab-details.hbs",
      scrollable: [""]
    },
    description: {
      template: "systems/shards-of-mana/templates/items/equipment/tab-description.hbs",
      scrollable: [""]
    },
    effects: {
      template: "systems/shards-of-mana/templates/items/equipment/tab-effects.hbs",
      scrollable: [""]
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "description", group: "primary", icon: "fa-solid fa-book", label: "SHARDS.Equipment.Tabs.Description" },
        { id: "details", group: "primary", icon: "fa-solid fa-sliders", label: "SHARDS.Equipment.Tabs.Details" },
        { id: "effects", group: "primary", icon: "fa-solid fa-sparkles", label: "SHARDS.Effects.ActiveEffects" }
      ],
      initial: "description",
      labelPrefix: "SHARDS.Equipment.Tabs"
    }
  };

  /* -------------------------------------------- */
  /*  Context Preparation                          */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;

    // Slot options
    context.slotOptions = this.#buildOptions(CONFIG.SHARDS.equipmentSlots, system.slot);

    // Weapon group options (shown when slot is weapon/offhand)
    context.weaponGroupOptions = this.#buildOptions(CONFIG.SHARDS.weaponGroups, system.weaponGroup);

    // Armor category options (shown when slot is armor/helm/offhand)
    context.armorCategoryOptions = this.#buildOptions(CONFIG.SHARDS.armorCategories, system.armorCategory);

    // Display flags
    context.isWeapon = system.slot === "weapon";
    context.isOffhand = system.slot === "offhand";
    context.isArmor = system.slot === "armor" || system.slot === "helm";
    context.showWeaponGroup = system.slot === "weapon" || system.slot === "offhand";
    context.showArmorCategory = system.slot === "armor" || system.slot === "helm" || system.slot === "offhand";
    context.showWeaponFields = system.slot === "weapon" || system.slot === "offhand";

    // Handedness (weapons only)
    context.showHandedness = system.slot === "weapon";
    context.handednessOptions = this.#buildOptions(CONFIG.SHARDS.handedness, system.handedness ?? "one-handed");
    context.showOversizedFields = system.handedness === "oversized";

    // Stat bonus rows for the grid
    context.statBonusRows = Object.entries(CONFIG.SHARDS.stats).map(([key, labelKey]) => {
      const value = system.statBonuses[key] ?? 0;
      return {
        key,
        label: game.i18n.localize(labelKey),
        abbrev: game.i18n.localize(`SHARDS.Stats.${key}`),
        value,
        sign: value > 0 ? "positive" : value < 0 ? "negative" : "neutral"
      };
    });

    // Total stat bonus for the header summary
    const totalBonus = Object.values(system.statBonuses).reduce((sum, v) => sum + (v ?? 0), 0);
    context.totalStatBonus = totalBonus;
    context.totalStatBonusSign = totalBonus > 0 ? "positive" : totalBonus < 0 ? "negative" : "neutral";
    context.totalStatBonusDisplay = totalBonus > 0 ? `+${totalBonus}` : `${totalBonus}`;

    // Properties as array
    context.propertyArray = [...(system.properties ?? [])];

    // Slot label for the header display
    context.slotLabel = game.i18n.localize(CONFIG.SHARDS.equipmentSlots[system.slot] ?? system.slot);

    // Weapon group / armor category labels for header
    context.weaponGroupLabel = system.weaponGroup
      ? game.i18n.localize(CONFIG.SHARDS.weaponGroups[system.weaponGroup] ?? system.weaponGroup)
      : "";
    context.armorCategoryLabel = system.armorCategory
      ? game.i18n.localize(CONFIG.SHARDS.armorCategories[system.armorCategory] ?? system.armorCategory)
      : "";

    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (["details", "description", "effects"].includes(partId)) {
      context.tab = context.tabs?.primary?.[partId] ?? context.tabs?.[partId];
    }
    return context;
  }

  /* -------------------------------------------- */
  /*  Render Hooks                                 */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Ensure the active tab content + nav button are visible after render
    const activeTab = this.tabGroups?.primary ?? "description";
    for (const section of this.element.querySelectorAll("[data-group='primary'][data-tab]")) {
      const isActive = section.dataset.tab === activeTab;
      section.classList.toggle("active", isActive);
    }

    // Property input: Enter key to add property
    const propInput = this.element.querySelector(".equip-property-input");
    if (propInput) {
      propInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          this.#addPropertyFromInput(propInput);
        }
      });
    }
  }

  /* -------------------------------------------- */
  /*  Helpers                                      */
  /* -------------------------------------------- */

  /**
   * Build an options array for a select dropdown.
   */
  #buildOptions(configMap, currentValue) {
    return Object.entries(configMap).map(([key, labelKey]) => ({
      key,
      label: game.i18n.localize(labelKey),
      selected: currentValue === key
    }));
  }

  /**
   * Add a property from the input field.
   */
  async #addPropertyFromInput(input) {
    const value = input.value.trim();
    if (!value) return;
    const properties = [...(this.document.system.properties ?? [])];
    if (properties.includes(value)) return;
    properties.push(value);
    input.value = "";
    await this.document.update({ "system.properties": properties });
  }

  /* -------------------------------------------- */
  /*  Action Handlers                              */
  /* -------------------------------------------- */

  static async #onAddProperty(event, target) {
    const input = this.element.querySelector(".equip-property-input");
    if (!input) return;
    const value = input.value.trim();
    if (!value) return;
    const properties = [...(this.document.system.properties ?? [])];
    if (properties.includes(value)) return;
    properties.push(value);
    input.value = "";
    await this.document.update({ "system.properties": properties });
  }

  static async #onRemoveProperty(event, target) {
    const index = Number(target.dataset.index);
    if (Number.isNaN(index)) return;
    const properties = [...(this.document.system.properties ?? [])];
    properties.splice(index, 1);
    await this.document.update({ "system.properties": properties });
  }
}
