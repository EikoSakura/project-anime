const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Quick Effect Creator — a PF2e-style dropdown + builder panel dialog for
 * creating Active Effects on actors or items. Users select an effect type
 * from a dropdown, click "Add", and the appropriate builder panel appears.
 *
 * Layout:
 *  1. Existing Effects list (compact cards with toggle/edit/delete)
 *  2. Item Flags sections (choice sets, grants, damage alterations) — items only
 *  3. Active Builder panel (appears when user selects type + clicks Add)
 *  4. Fixed footer (dropdown + Add button + Advanced + Save & Close)
 *
 * Opened via ShardsEffectCreator.open(document). Singleton per document.
 */
export class ShardsEffectCreator extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {Map<string, ShardsEffectCreator>} Track one instance per document */
  static #instances = new Map();

  /**
   * Open (or focus) the Effect Creator for a given document (Actor or Item).
   * @param {Actor|Item} document
   * @param {object} [defaultFlags={}]  Extra flags merged into every created AE
   *                                     (e.g. `{ "shards-of-mana": { traitId } }`)
   * @returns {ShardsEffectCreator}
   */
  static open(document, defaultFlags = {}) {
    if (this.#instances.has(document.id)) {
      const existing = this.#instances.get(document.id);
      existing._defaultFlags = defaultFlags;
      existing.render(true);
      existing.bringToFront();
      return existing;
    }
    const creator = new this({ document, defaultFlags });
    this.#instances.set(document.id, creator);
    creator.render(true);
    return creator;
  }

  /* -------------------------------------------- */

  /** @type {Actor|Item} The document this dialog creates effects on. */
  document;

  /** @type {boolean} Whether the target document is an Actor (vs Item). */
  isActor;

  /**
   * Which builder panel is currently shown, or null if none.
   * @type {string|null}
   */
  _activeBuilder = null;

  /**
   * Per-category selected target key for builder forms.
   * Maps category id → target key (e.g. "stat" → "str").
   * @type {Map<string, string>}
   */
  _selectedTargets = new Map();

  /** @type {number[]} Hook IDs for auto-refresh. */
  _hookIds = [];

  /**
   * Extra flags merged into every AE created by this dialog instance.
   * Used by the lineage sheet to auto-link effects to a specific trait.
   * @type {object}
   */
  _defaultFlags = {};

  constructor(options = {}) {
    super(options);
    this.document = options.document;
    this.isActor = this.document instanceof Actor;
    this._defaultFlags = options.defaultFlags ?? {};
  }

  /**
   * Merge default flags into AE data before creation.
   * Deep-merges `_defaultFlags` into `aeData.flags` so that trait-linked
   * effects automatically receive the correct flag without each creation
   * site needing to know about it.
   * @param {object} aeData  The AE creation data (mutated in-place)
   * @returns {object} The same aeData, with flags merged
   */
  _applyDefaultFlags(aeData) {
    if (!Object.keys(this._defaultFlags).length) return aeData;
    aeData.flags = foundry.utils.mergeObject(aeData.flags ?? {}, this._defaultFlags);
    return aeData;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "effect-creator"],
    position: { width: 480, height: 700 },
    window: {
      resizable: true,
      icon: "fa-solid fa-wand-sparkles"
    },
    actions: {
      // Builder management
      showBuilder: ShardsEffectCreator.#onShowBuilder,
      cancelBuilder: ShardsEffectCreator.#onCancelBuilder,

      // Existing effect actions
      toggleExistingEffect: ShardsEffectCreator.#onToggleExistingEffect,
      editExistingEffect: ShardsEffectCreator.#onEditExistingEffect,
      deleteExistingEffect: ShardsEffectCreator.#onDeleteExistingEffect,

      // Builder actions (same as before)
      pickTarget: ShardsEffectCreator.#onPickTarget,
      createCategoryEffect: ShardsEffectCreator.#onCreateCategoryEffect,
      toggleSign: ShardsEffectCreator.#onToggleSign,
      togglePercent: ShardsEffectCreator.#onTogglePercent,
      toggleCondition: ShardsEffectCreator.#onToggleCondition,
      toggleFlag: ShardsEffectCreator.#onToggleFlag,
      toggleElementResistance: ShardsEffectCreator.#onToggleElementResistance,
      openAdvanced: ShardsEffectCreator.#onOpenAdvanced,

      // Item-only actions
      addChoiceSet: ShardsEffectCreator.#onAddChoiceSet,
      removeChoiceSet: ShardsEffectCreator.#onRemoveChoiceSet,
      addCustomOption: ShardsEffectCreator.#onAddCustomOption,
      removeCustomOption: ShardsEffectCreator.#onRemoveCustomOption,
      addGrant: ShardsEffectCreator.#onAddGrant,
      removeGrant: ShardsEffectCreator.#onRemoveGrant,
      addAlteration: ShardsEffectCreator.#onAddAlteration,
      removeAlteration: ShardsEffectCreator.#onRemoveAlteration,

      // Critical HP
      createCriticalHpEffect: ShardsEffectCreator.#onCreateCriticalHpEffect,
      deleteCriticalHpEffect: ShardsEffectCreator.#onDeleteCriticalHpEffect,

      // Choice-Linked builder
      createChoiceLinkedEffect: ShardsEffectCreator.#onCreateChoiceLinkedEffect,

      // Footer
      saveAndClose: ShardsEffectCreator.#onSaveAndClose
    }
  };

  /** @override */
  static PARTS = {
    main: {
      template: "systems/shards-of-mana/templates/apps/effect-creator.hbs",
      scrollable: [".ec-scroll-area"]
    }
  };

  /** @override */
  get title() {
    return `${game.i18n.localize("SHARDS.EffectCreator.Title")} \u2014 ${this.document.name}`;
  }

  /** @override */
  get id() {
    return `shards-effect-creator-${this.document.id}`;
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                    */
  /* -------------------------------------------- */

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const refresh = (doc) => {
      if (doc.parent?.id === this.document.id || doc.id === this.document.id) {
        this.render({ parts: ["main"] });
      }
    };
    this._hookIds = [
      Hooks.on("createActiveEffect", refresh),
      Hooks.on("deleteActiveEffect", refresh),
      Hooks.on("updateActiveEffect", refresh)
    ];
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Duration visibility toggles for all builder forms
    for (const form of this.element.querySelectorAll(".ec-builder-form")) {
      const modeSelect = form.querySelector("[data-field='duration-mode']");
      const countInput = form.querySelector("[data-field='duration-count']");
      if (modeSelect && countInput) {
        const updateVisibility = () => {
          countInput.classList.toggle("hidden", modeSelect.value === "permanent");
        };
        updateVisibility();
        modeSelect.addEventListener("change", updateVisibility);
      }

      // Conditional label enabled/disabled
      const condCheckbox = form.querySelector("[data-field='conditional']");
      const condLabel = form.querySelector("[data-field='conditional-label']");
      if (condCheckbox && condLabel) {
        const updateLabel = () => { condLabel.disabled = !condCheckbox.checked; };
        updateLabel();
        condCheckbox.addEventListener("change", updateLabel);
      }
    }

    // Restore selected targets in builder forms
    for (const [category, key] of this._selectedTargets) {
      const form = this.element.querySelector(`.ec-builder-form[data-category="${category}"]`);
      if (!form) continue;
      const selectedLabel = form.querySelector("[data-field='selected-label']");
      const selectedKey = form.querySelector("[data-field='selected-key']");
      const btn = this.element.querySelector(
        `.ec-pick-btn[data-category="${category}"][data-target-key="${key}"]`
      );
      if (btn) btn.classList.add("selected");
      if (selectedLabel && btn) {
        selectedLabel.textContent = btn.querySelector(".ec-pick-btn__label")?.textContent || key;
      }
      if (selectedKey) selectedKey.value = key;
    }

    // Right-click context menus for condition buttons (only if builder is showing them)
    for (const btn of this.element.querySelectorAll(".ec-flag-btn--cond[data-condition-id]")) {
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this._showConditionContextMenu(e, btn.dataset.conditionId);
      });
    }

    // Right-click context menus for flag buttons
    for (const btn of this.element.querySelectorAll(".ec-flag-btn[data-flag-key]")) {
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this._showFlagContextMenu(e, btn.dataset.flagKey);
      });
    }

    // Right-click context menus for element resistance buttons
    for (const btn of this.element.querySelectorAll(".ec-elem-btn[data-element-key]")) {
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this._showElementResistanceContextMenu(e, btn.dataset.elementKey);
      });
    }

    // Choice-Linked builder: show/hide conditional rows based on template selection
    const clTemplateSelect = this.element.querySelector(".ec-cl-template-select");
    if (clTemplateSelect) {
      const updateClRows = () => {
        const selected = clTemplateSelect.options[clTemplateSelect.selectedIndex];
        const needsTier = selected?.dataset.needsTier === "true";
        const needsValue = selected?.dataset.needsValue === "true";
        const needsCustom = selected?.dataset.needsCustom === "true";
        for (const row of this.element.querySelectorAll(".ec-cl-conditional")) {
          const forType = row.dataset.clFor;
          const show = (forType === "tier" && needsTier)
            || (forType === "value" && needsValue)
            || (forType === "custom" && needsCustom);
          row.classList.toggle("hidden", !show);
        }
      };
      updateClRows();
      clTemplateSelect.addEventListener("change", updateClRows);

      // Choice set dropdown: re-render to update templates when set changes
      const clSetSelect = this.element.querySelector(".ec-cl-set-select");
      if (clSetSelect) {
        clSetSelect.addEventListener("change", () => {
          this._choiceLinkedSetId = clSetSelect.value;
          this.render({ parts: ["main"] });
        });
      }
    }

    // Restore dropdown selection to match active builder
    if (this._activeBuilder) {
      const dropdown = this.element.querySelector("[data-field='add-type']");
      if (dropdown) dropdown.value = this._activeBuilder;
    }

    // Item-only inline field change listeners (auto-save to flags)
    if (!this.isActor) {
      this._bindChoiceSetFieldListeners();
      this._bindGrantFieldListeners();
      this._bindAlterationFieldListeners();
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    ShardsEffectCreator.#instances.delete(this.document.id);
    for (const hookId of this._hookIds) {
      Hooks.off("createActiveEffect", hookId);
      Hooks.off("deleteActiveEffect", hookId);
      Hooks.off("updateActiveEffect", hookId);
    }
    this._hookIds = [];
  }

  /* -------------------------------------------- */
  /*  Context Preparation                          */
  /* -------------------------------------------- */

  /** Condition IDs classified as negative. */
  static #NEGATIVE_IDS = new Set([
    "poison", "burn", "stun", "blind", "silence",
    "slow", "root", "weaken", "downed"
  ]);

  /** Stat abbreviation map */
  static #STAT_ABBR = {
    str: "STR", agi: "AGI", vit: "VIT", mag: "MAG",
    spi: "SPI", per: "PER", lck: "LCK", chm: "CHM"
  };

  /** Derived stat abbreviation map */
  static #DERIVED_ABBR = {
    acc: "ACC", eva: "EVA", pDef: "pDEF", mDef: "mDEF", crit: "CRIT"
  };

  /** Preset type dropdown options for choice sets (localization keys, resolved at render time) */
  static #PRESET_TYPE_OPTIONS = [
    { value: "stat", labelKey: "SHARDS.ChoiceSet.PresetStat" },
    { value: "element", labelKey: "SHARDS.ChoiceSet.PresetElement" },
    { value: "damageType", labelKey: "SHARDS.ChoiceSet.PresetDamageType" },
    { value: "weaponGroup", labelKey: "SHARDS.ChoiceSet.PresetWeaponGroup" },
    { value: "condition", labelKey: "SHARDS.ChoiceSet.PresetCondition" },
    { value: "skill", labelKey: "SHARDS.ChoiceSet.PresetSkill" }
  ];

  /** Builder label map for dropdown display */
  static #BUILDER_LABELS = {
    stat: "SHARDS.EffectCreator.CatStat",
    derived: "SHARDS.EffectCreator.CatDerived",
    hpmp: "SHARDS.EffectCreator.CatHpMp",
    growthRate: "SHARDS.EffectCreator.CatGrowthRate",
    movement: "SHARDS.EffectCreator.CatMovement",
    elementRes: "SHARDS.EffectCreator.FlagGroupElementRes",
    condImmunity: "SHARDS.EffectCreator.FlagGroupCondImmunity",
    conditions: "SHARDS.EffectCreator.Conditions",
    movementModes: "SHARDS.EffectCreator.FlagGroupMovementModes",
    special: "SHARDS.EffectCreator.FlagGroupSpecial",
    criticalHp: "SHARDS.EffectCreator.CatCriticalHp",
    choiceLinked: "SHARDS.EffectCreator.CatChoiceLinked"
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const doc = this.document;
    context.isActor = this.isActor;

    // --- Active Builder State ---
    context.activeBuilder = this._activeBuilder;
    context.activeBuilderLabel = this._activeBuilder
      ? game.i18n.localize(ShardsEffectCreator.#BUILDER_LABELS[this._activeBuilder] ?? "")
      : "";
    context.builderIsStat = this._activeBuilder === "stat";
    context.builderIsDerived = this._activeBuilder === "derived";
    context.builderIsHpmp = this._activeBuilder === "hpmp";
    context.builderIsGrowthRate = this._activeBuilder === "growthRate";
    context.builderIsMovement = this._activeBuilder === "movement";
    context.builderIsElementRes = this._activeBuilder === "elementRes";
    context.builderIsCondImmunity = this._activeBuilder === "condImmunity";
    context.builderIsConditions = this._activeBuilder === "conditions";
    context.builderIsMovementModes = this._activeBuilder === "movementModes";
    context.builderIsSpecial = this._activeBuilder === "special";
    context.builderIsCriticalHp = this._activeBuilder === "criticalHp";
    context.builderIsChoiceLinked = this._activeBuilder === "choiceLinked";

    // --- Existing Effects List ---
    context.existingEffects = this._buildExistingEffectsList();

    // --- Stat Modifier buttons ---
    context.statButtons = Object.keys(CONFIG.SHARDS.stats).map(key => ({
      key,
      abbr: ShardsEffectCreator.#STAT_ABBR[key] || key.toUpperCase(),
      label: game.i18n.localize(CONFIG.SHARDS.stats[key]),
      selected: this._selectedTargets.get("stat") === key
    }));

    // --- Derived Stat buttons ---
    context.derivedButtons = Object.entries(CONFIG.SHARDS.derivedStats).map(([key, label]) => ({
      key,
      abbr: ShardsEffectCreator.#DERIVED_ABBR[key] || key.toUpperCase(),
      label: game.i18n.localize(label),
      selected: this._selectedTargets.get("derived") === key
    }));

    // --- HP/MP/Pips buttons ---
    context.hpmpButtons = [
      { key: "hp", label: game.i18n.localize("SHARDS.Derived.MaxHp"), icon: "fa-solid fa-heart" },
      { key: "mp", label: game.i18n.localize("SHARDS.Derived.MaxMp"), icon: "fa-solid fa-droplet" },
      { key: "pips", label: game.i18n.localize("SHARDS.Derived.MaxPips"), icon: "fa-solid fa-circle" }
    ].map(btn => ({ ...btn, selected: this._selectedTargets.get("hpmp") === btn.key }));

    // --- Movement/Size selected states ---
    const movTarget = this._selectedTargets.get("movement");
    context.movSelected = movTarget === "mov";
    context.sizeSelected = movTarget === "size";

    // --- Condition Toggle Groups ---
    const negConditions = [];
    const posConditions = [];

    for (const config of CONFIG.statusEffects) {
      const existingEffect = doc.effects.find(e => e.statuses?.has(config.id));
      const active = existingEffect && !existingEffect.disabled;
      const entry = {
        id: config.id,
        label: game.i18n.localize(config.name),
        img: config.img,
        desc: game.i18n.localize(`SHARDS.ConditionDesc.${config.id}`),
        active,
        effectId: existingEffect?.id ?? null,
        disabled: existingEffect?.disabled ?? false
      };
      if (ShardsEffectCreator.#NEGATIVE_IDS.has(config.id)) {
        negConditions.push(entry);
      } else {
        posConditions.push(entry);
      }
    }
    negConditions.sort((a, b) => a.label.localeCompare(b.label));
    posConditions.sort((a, b) => a.label.localeCompare(b.label));
    context.conditionGroups = [
      { group: game.i18n.localize("SHARDS.ConditionsNegative"), colorClass: "negative", conditions: negConditions },
      { group: game.i18n.localize("SHARDS.ConditionsPositive"), colorClass: "positive", conditions: posConditions }
    ];

    // --- Element Resistance Toggles ---
    context.elementResistances = this._buildElementResistanceToggles();

    // --- Flag Groups ---
    const allFlags = this._buildFlagPresets();
    const flagMap = new Map(allFlags.map(g => [g.id, g]));

    const condImmGroup = flagMap.get("condImmunity");
    context.condImmunityFlags = condImmGroup?.flags ?? [];

    const movGroup = flagMap.get("movementModes");
    context.movementModeFlags = movGroup?.flags ?? [];

    const specialGroup = flagMap.get("special");
    context.specialFlags = specialGroup?.flags ?? [];

    // --- Choice Sets (item-only) ---
    if (!this.isActor) {
      const rawSets = doc.flags?.["shards-of-mana"]?.choiceSets ?? [];
      context.choiceSets = rawSets.map(cs => {
        const isPreset = cs.type !== "custom";
        const isCustom = cs.type === "custom";
        const hasEffect = !!cs.effectTemplate;
        const changeKey = cs.effectTemplate?.changes?.[0]?.key ?? "";
        const changeMode = cs.effectTemplate?.changes?.[0]?.mode ?? 2;
        const changeValue = cs.effectTemplate?.changes?.[0]?.value ?? "";
        const effectNamePattern = cs.effectTemplate?.namePattern ?? "";
        const hasItemUpdate = !!cs.itemUpdate;
        const itemUpdateKey = cs.itemUpdate?.key ?? "";
        const itemUpdateValue = cs.itemUpdate?.value ?? "";

        return {
          ...cs,
          isPreset,
          isCustom,
          hasEffect,
          changeKey,
          changeMode,
          changeValue,
          effectNamePattern,
          hasItemUpdate,
          itemUpdateKey,
          itemUpdateValue,
          modeIsAdd: changeMode === 2,
          modeIsOverride: changeMode === 5,
          presetTypeOptions: ShardsEffectCreator.#PRESET_TYPE_OPTIONS.map(o => ({
            value: o.value,
            label: game.i18n.localize(o.labelKey),
            selected: cs.presetType === o.value
          }))
        };
      });
      context.choiceSetCount = rawSets.length;
      context.hasChoiceSets = rawSets.length > 0;

      // --- Choice-Linked Builder context ---
      if (this._activeBuilder === "choiceLinked" && rawSets.length) {
        context.choiceLinked = this._buildChoiceLinkedContext(rawSets);
      }

      // --- Grants (item-only) ---
      const rawGrants = doc.flags?.["shards-of-mana"]?.grants ?? [];

      // Build available choice sets for propagation dropdowns
      const availableChoiceSets = (doc.flags?.["shards-of-mana"]?.choiceSets ?? []).map(cs => ({
        id: cs.id,
        label: cs.label || cs.id
      }));

      context.grants = rawGrants.map(g => {
        const isItem = g.type !== "effect";
        const isEffect = g.type === "effect";
        const changeKey = g.effectChanges?.[0]?.key ?? "";
        const changeMode = g.effectChanges?.[0]?.mode ?? 2;
        const changeValue = g.effectChanges?.[0]?.value ?? "";

        // Choice propagation
        const prop = g.choicePropagation ?? {};
        const hasChoicePropagation = !!prop.choiceSetId;
        const propagationCsId = prop.choiceSetId ?? "";
        const propagationRename = prop.renamePattern ?? "";
        const propagationUpdateKey = prop.itemUpdates?.[0]?.key ?? "";
        const propagationUpdateValue = prop.itemUpdates?.[0]?.value ?? "";

        return {
          ...g,
          isItem,
          isEffect,
          changeKey,
          changeMode,
          changeValue,
          modeIsAdd: changeMode === 2,
          modeIsOverride: changeMode === 5,
          typeLabel: isEffect
            ? game.i18n.localize("SHARDS.Grant.TypeEffect")
            : game.i18n.localize("SHARDS.Grant.TypeItem"),
          // Propagation context
          availableChoiceSets,
          hasChoicePropagation,
          propagationCsId,
          propagationRename,
          propagationUpdateKey,
          propagationUpdateValue
        };
      });
      context.grantCount = rawGrants.length;
      context.hasGrants = rawGrants.length > 0;

      // --- Damage Alterations (item-only) ---
      const rawAlts = doc.flags?.["shards-of-mana"]?.damageAlterations ?? [];
      // Build shared dropdown options for templates
      context.elementOptions = Object.entries(CONFIG.SHARDS.damageTypes).map(([value, labelKey]) => ({
        value,
        label: game.i18n.localize(labelKey)
      }));
      context.weaponGroupOptions = Object.entries(CONFIG.SHARDS.weaponGroups).map(([value, labelKey]) => ({
        value,
        label: game.i18n.localize(labelKey)
      }));
      context.skillTypeOptions = Object.entries(CONFIG.SHARDS.skillTypes).map(([value, labelKey]) => ({
        value,
        label: game.i18n.localize(labelKey)
      }));

      context.damageAlterations = rawAlts.map(alt => {
        const scope = alt.filter?.scope ?? "all";
        const elOpts = context.elementOptions.map(o => ({
          ...o, selected: o.value === alt.newElement
        }));
        const wgOpts = context.weaponGroupOptions.map(o => ({
          ...o, selected: o.value === alt.filter?.weaponGroup
        }));
        const stOpts = context.skillTypeOptions.map(o => ({
          ...o, selected: o.value === alt.filter?.skillType
        }));
        return {
          ...alt,
          isChangeElement: alt.type === "changeElement",
          isBonusDamage: alt.type === "bonusDamage",
          isAddPierce: alt.type === "addPierce",
          isChangeDefense: alt.type === "changeDefenseType",
          typeLabel: game.i18n.localize(`SHARDS.DmgAlt.${
            alt.type === "changeElement" ? "ChangeElement"
              : alt.type === "bonusDamage" ? "BonusDamage"
              : alt.type === "addPierce" ? "AddPierce"
              : "ChangeDefense"
          }`),
          defIsPhysical: alt.newDefenseType === "physical",
          defIsMagical: alt.newDefenseType === "magical",
          defIsNone: alt.newDefenseType === "none",
          scopeIsAll: scope === "all",
          scopeIsWeaponGroup: scope === "weaponGroup",
          scopeIsSkillType: scope === "skillType",
          elementOptions: elOpts,
          weaponGroupOptions: wgOpts,
          skillTypeOptions: stOpts
        };
      });
      context.dmgAltCount = rawAlts.length;
      context.hasDmgAlts = rawAlts.length > 0;
    }

    // --- Critical HP Effects ---
    const criticalHpEffects = [];
    for (const effect of doc.effects) {
      if (effect.flags?.["shards-of-mana"]?.criticalHp) {
        criticalHpEffects.push({
          effectId: effect.id,
          name: effect.name,
          img: effect.img || "icons/svg/downgrade.svg",
          active: !effect.disabled,
          disabled: effect.disabled
        });
      }
    }
    context.criticalHpEffects = criticalHpEffects;
    context.criticalHpCount = criticalHpEffects.length;

    // Stat + derived buttons for critical HP builder
    const criticalTargets = [
      ...Object.keys(CONFIG.SHARDS.stats).map(key => ({
        key: `stat.${key}`,
        abbr: ShardsEffectCreator.#STAT_ABBR[key] || key.toUpperCase(),
        label: game.i18n.localize(CONFIG.SHARDS.stats[key]),
        selected: this._selectedTargets.get("criticalHp") === `stat.${key}`
      })),
      ...Object.entries(CONFIG.SHARDS.derivedStats).map(([key, label]) => ({
        key: `derived.${key}`,
        abbr: ShardsEffectCreator.#DERIVED_ABBR[key] || key.toUpperCase(),
        label: game.i18n.localize(label),
        selected: this._selectedTargets.get("criticalHp") === `derived.${key}`
      }))
    ];
    context.criticalHpStatButtons = criticalTargets;

    return context;
  }

  /**
   * Build enriched data for the existing effects list.
   * @returns {object[]}
   */
  _buildExistingEffectsList() {
    const doc = this.document;
    const effects = [];

    for (const effect of doc.effects) {
      const flags = effect.flags?.["shards-of-mana"] ?? {};
      const isCriticalHp = !!flags.criticalHp;
      const isConditional = !!flags.conditional;
      const conditionalLabel = flags.conditionalLabel ?? "";

      // Determine badge
      let badge = "";
      let badgeCss = "";
      if (effect.disabled) {
        badge = game.i18n.localize("SHARDS.EffectCreator.CtxDisable");
        badgeCss = "badge-disabled";
      } else if (isCriticalHp) {
        badge = game.i18n.localize("SHARDS.EffectCreator.CriticalHpPrefix");
        badgeCss = "badge-critical";
      } else if (isConditional) {
        badge = game.i18n.localize("SHARDS.Effects.Conditional");
        badgeCss = "badge-conditional";
      } else if (effect.duration?.rounds || effect.duration?.turns) {
        const count = effect.duration.rounds || effect.duration.turns;
        const unit = effect.duration.rounds
          ? game.i18n.localize("SHARDS.EffectCreator.Rounds")
          : game.i18n.localize("SHARDS.EffectCreator.Turns");
        badge = `${count} ${unit}`;
        badgeCss = "badge-duration";
      }

      effects.push({
        effectId: effect.id,
        name: effect.name,
        img: effect.img || "icons/svg/aura.svg",
        disabled: effect.disabled,
        isCriticalHp,
        isConditional,
        conditionalLabel: isConditional ? conditionalLabel : "",
        badge,
        badgeCss
      });
    }

    return effects;
  }

  /**
   * System flag definitions for the Flags category.
   * @type {object[]}
   */
  static FLAG_DEFINITIONS = [
    {
      key: "mightyGrip",
      changeKey: "system.flags.mightyGrip",
      label: "SHARDS.Equipment.MightyGrip",
      desc: "SHARDS.EffectCreator.MightyGripDesc",
      icon: "icons/svg/sword.svg",
      img: "icons/svg/sword.svg"
    },
    {
      key: "undead",
      changeKey: "system.flags.undead",
      label: "SHARDS.Flags.Undead",
      desc: "SHARDS.EffectCreator.UndeadDesc",
      icon: "icons/svg/skull.svg",
      img: "icons/svg/skull.svg"
    },
    { key: "condImmunity.poison",  changeKey: "system.conditionResistances.poison",  label: "SHARDS.ConditionImmunity.Poison",  desc: "SHARDS.ConditionImmunity.Desc", icon: "icons/svg/poison.svg",       img: "icons/svg/poison.svg",       value: "true" },
    { key: "condImmunity.burn",    changeKey: "system.conditionResistances.burn",    label: "SHARDS.ConditionImmunity.Burn",    desc: "SHARDS.ConditionImmunity.Desc", icon: "icons/svg/fire.svg",         img: "icons/svg/fire.svg",         value: "true" },
    { key: "condImmunity.stun",    changeKey: "system.conditionResistances.stun",    label: "SHARDS.ConditionImmunity.Stun",    desc: "SHARDS.ConditionImmunity.Desc", icon: "icons/svg/lightning.svg",    img: "icons/svg/lightning.svg",    value: "true" },
    { key: "condImmunity.blind",   changeKey: "system.conditionResistances.blind",   label: "SHARDS.ConditionImmunity.Blind",   desc: "SHARDS.ConditionImmunity.Desc", icon: "icons/svg/blind.svg",        img: "icons/svg/blind.svg",        value: "true" },
    { key: "condImmunity.silence", changeKey: "system.conditionResistances.silence", label: "SHARDS.ConditionImmunity.Silence", desc: "SHARDS.ConditionImmunity.Desc", icon: "icons/svg/silenced.svg",     img: "icons/svg/silenced.svg",     value: "true" },
    { key: "condImmunity.slow",    changeKey: "system.conditionResistances.slow",    label: "SHARDS.ConditionImmunity.Slow",    desc: "SHARDS.ConditionImmunity.Desc", icon: "icons/svg/frozen.svg",       img: "icons/svg/frozen.svg",       value: "true" },
    { key: "condImmunity.root",    changeKey: "system.conditionResistances.root",    label: "SHARDS.ConditionImmunity.Root",    desc: "SHARDS.ConditionImmunity.Desc", icon: "icons/svg/net.svg",          img: "icons/svg/net.svg",          value: "true" },
    { key: "condImmunity.weaken",  changeKey: "system.conditionResistances.weaken",  label: "SHARDS.ConditionImmunity.Weaken",  desc: "SHARDS.ConditionImmunity.Desc", icon: "icons/svg/downgrade.svg",    img: "icons/svg/downgrade.svg",    value: "true" },
    { key: "condImmunity.downed",  changeKey: "system.conditionResistances.downed",  label: "SHARDS.ConditionImmunity.Downed",  desc: "SHARDS.ConditionImmunity.Desc", icon: "icons/svg/unconscious.svg",  img: "icons/svg/unconscious.svg",  value: "true" },
    { key: "movementMode.walk",     changeKey: "system.movementModes.walk",     label: "SHARDS.Movement.Walk",     desc: "SHARDS.EffectCreator.MovementModeDesc", icon: "icons/svg/pawprint.svg",  img: "icons/svg/pawprint.svg",  value: "1" },
    { key: "movementMode.fly",      changeKey: "system.movementModes.fly",      label: "SHARDS.Movement.Fly",      desc: "SHARDS.EffectCreator.MovementModeDesc", icon: "icons/svg/wing.svg",      img: "icons/svg/wing.svg",      value: "1" },
    { key: "movementMode.swim",     changeKey: "system.movementModes.swim",     label: "SHARDS.Movement.Swim",     desc: "SHARDS.EffectCreator.MovementModeDesc", icon: "icons/svg/waterfall.svg", img: "icons/svg/waterfall.svg", value: "1" },
    { key: "movementMode.climb",    changeKey: "system.movementModes.climb",    label: "SHARDS.Movement.Climb",    desc: "SHARDS.EffectCreator.MovementModeDesc", icon: "icons/svg/mountain.svg",  img: "icons/svg/mountain.svg",  value: "1" },
    { key: "movementMode.burrow",   changeKey: "system.movementModes.burrow",   label: "SHARDS.Movement.Burrow",   desc: "SHARDS.EffectCreator.MovementModeDesc", icon: "icons/svg/mountain.svg",  img: "icons/svg/mountain.svg",  value: "1" },
    { key: "movementMode.teleport", changeKey: "system.movementModes.teleport", label: "SHARDS.Movement.Teleport", desc: "SHARDS.EffectCreator.MovementModeDesc", icon: "icons/svg/lightning.svg", img: "icons/svg/lightning.svg", value: "1" }
  ];

  static FLAG_GROUPS = [
    {
      id: "special",
      label: "SHARDS.EffectCreator.FlagGroupSpecial",
      keys: ["mightyGrip", "undead"]
    },
    {
      id: "condImmunity",
      label: "SHARDS.EffectCreator.FlagGroupCondImmunity",
      keys: [
        "condImmunity.poison", "condImmunity.burn", "condImmunity.stun",
        "condImmunity.blind", "condImmunity.silence", "condImmunity.slow",
        "condImmunity.root", "condImmunity.weaken", "condImmunity.downed"
      ]
    },
    {
      id: "movementModes",
      label: "SHARDS.EffectCreator.FlagGroupMovementModes",
      keys: [
        "movementMode.walk", "movementMode.fly",
        "movementMode.swim", "movementMode.climb",
        "movementMode.burrow", "movementMode.teleport"
      ]
    }
  ];

  _buildFlagPresets() {
    const doc = this.document;
    const defMap = new Map(ShardsEffectCreator.FLAG_DEFINITIONS.map(d => [d.key, d]));

    return ShardsEffectCreator.FLAG_GROUPS.map(group => ({
      id: group.id,
      group: game.i18n.localize(group.label),
      flags: group.keys.map(key => {
        const def = defMap.get(key);
        if (!def) return null;
        const existingEffect = doc.effects.find(e =>
          e.changes.some(c => c.key === def.changeKey)
        );
        return {
          key: def.key,
          label: game.i18n.localize(def.label),
          desc: game.i18n.localize(def.desc),
          img: def.img,
          active: existingEffect && !existingEffect.disabled,
          effectId: existingEffect?.id ?? null,
          disabled: existingEffect?.disabled ?? false
        };
      }).filter(Boolean)
    }));
  }

  static ELEMENT_TIER_CYCLE = [-1, 1, 2, 3];

  static ELEMENT_KEYS = [
    "physical", "magical", "fire", "ice", "lightning", "wind",
    "earth", "water", "light", "dark", "plant", "poison"
  ];

  /**
   * Maps choice set preset types to available effect templates.
   * Each template defines how to build an AE with {CHOICE_VALUE} placeholders.
   */
  static #CHOICE_EFFECT_TEMPLATES = {
    element: [
      { id: "elementRes", labelKey: "SHARDS.ChoiceTemplate.ElementRes", icon: "fa-solid fa-shield-halved", needsTier: true },
      { id: "damageType", labelKey: "SHARDS.ChoiceTemplate.DamageType", icon: "fa-solid fa-burst" }
    ],
    stat: [
      { id: "statBonus", labelKey: "SHARDS.ChoiceTemplate.StatBonus", icon: "fa-solid fa-arrow-up", needsValue: true },
      { id: "growthRate", labelKey: "SHARDS.ChoiceTemplate.GrowthRate", icon: "fa-solid fa-chart-line", needsValue: true }
    ],
    damageType: [
      { id: "damageType", labelKey: "SHARDS.ChoiceTemplate.DamageType", icon: "fa-solid fa-burst" }
    ],
    condition: [
      { id: "condImmunity", labelKey: "SHARDS.ChoiceTemplate.CondImmunity", icon: "fa-solid fa-shield-virus" }
    ],
    weaponGroup: [],
    skill: []
  };

  /**
   * Build context data for the Choice-Linked builder panel.
   * @param {object[]} rawSets - The raw choice set flag data
   * @returns {object}
   */
  _buildChoiceLinkedContext(rawSets) {
    // Build dropdown of choice sets
    const selectedSetId = this._choiceLinkedSetId ?? rawSets[0]?.id;
    const sets = rawSets.map(cs => ({
      id: cs.id,
      label: cs.label || cs.id,
      presetType: cs.presetType ?? "custom",
      isCustom: cs.type === "custom",
      selected: cs.id === selectedSetId
    }));

    // Use the first set by default (or the one the user last selected)
    const selectedSet = sets.find(s => s.id === selectedSetId) ?? sets[0];

    // Get templates for this preset type
    const presetTemplates = ShardsEffectCreator.#CHOICE_EFFECT_TEMPLATES[selectedSet?.presetType] ?? [];
    const templates = [
      ...presetTemplates.map(t => ({
        ...t,
        label: game.i18n.localize(t.labelKey)
      })),
      // Always add Custom as a fallback
      { id: "custom", label: game.i18n.localize("SHARDS.ChoiceTemplate.Custom"), icon: "fa-solid fa-code", needsCustom: true }
    ];

    // Build resistance tier options for element templates
    const tierOptions = Object.entries(CONFIG.SHARDS.resistanceTiers ?? {}).map(([value, config]) => ({
      value,
      label: game.i18n.localize(config.label),
      css: config.css ?? ""
    }));

    return {
      sets,
      selectedSetId: selectedSet?.id,
      hasMultipleSets: sets.length > 1,
      templates,
      tierOptions
    };
  }

  _buildElementResistanceToggles() {
    const doc = this.document;
    const OVERRIDE = 5;

    return ShardsEffectCreator.ELEMENT_KEYS.map(key => {
      const changeKey = `system.elementResistances.${key}`;
      const existing = doc.effects.find(e =>
        e.changes.some(c => c.key === changeKey && c.mode === OVERRIDE)
      );

      let tierValue = null;
      let tierCss = "";
      let tierLabel = "";
      if (existing && !existing.disabled) {
        const change = existing.changes.find(c => c.key === changeKey);
        tierValue = Number(change?.value ?? 0);
        const tierConfig = CONFIG.SHARDS.resistanceTiers?.[String(tierValue)];
        tierCss = tierConfig?.css ?? "";
        tierLabel = tierConfig ? game.i18n.localize(tierConfig.label) : "";
      }

      const elemLabel = game.i18n.localize(
        `SHARDS.DamageType.${key.charAt(0).toUpperCase() + key.slice(1)}`
      );

      return {
        key,
        label: elemLabel,
        tierValue,
        tierCss,
        tierLabel,
        active: existing && !existing.disabled,
        effectId: existing?.id ?? null,
        disabled: existing?.disabled ?? false
      };
    });
  }

  /* -------------------------------------------- */
  /*  Builder Management Actions                   */
  /* -------------------------------------------- */

  /**
   * Show the builder panel for the selected dropdown type.
   * For item-flag types (choiceSet, grants, dmgAlt), directly add a new card instead.
   */
  static #onShowBuilder(event, target) {
    const dropdown = this.element.querySelector("[data-field='add-type']");
    const type = dropdown?.value;
    if (!type) return;

    // Item-flag types: directly add a new card, no builder panel needed
    if (type === "choiceSet") {
      ShardsEffectCreator.#onAddChoiceSet.call(this, event, target);
      return;
    }
    if (type === "grants") {
      ShardsEffectCreator.#onAddGrant.call(this, event, target);
      return;
    }
    if (type === "dmgAlt") {
      ShardsEffectCreator.#onAddAlteration.call(this, event, target);
      return;
    }

    // Show the builder panel for this type
    this._activeBuilder = type;
    this.render({ parts: ["main"] });
  }

  /**
   * Close the active builder panel.
   */
  static #onCancelBuilder(event, target) {
    this._activeBuilder = null;
    this.render({ parts: ["main"] });
  }

  /* -------------------------------------------- */
  /*  Existing Effect Actions                      */
  /* -------------------------------------------- */

  /**
   * Toggle an existing effect's enabled/disabled state.
   */
  static async #onToggleExistingEffect(event, target) {
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId ?? target.dataset.effectId;
    if (!effectId) return;
    const effect = this.document.effects.get(effectId);
    if (effect) await effect.update({ disabled: !effect.disabled });
  }

  /**
   * Open the full AE config sheet for an existing effect.
   */
  static #onEditExistingEffect(event, target) {
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId ?? target.dataset.effectId;
    if (!effectId) return;
    const effect = this.document.effects.get(effectId);
    if (effect) effect.sheet.render(true);
  }

  /**
   * Delete an existing effect.
   */
  static async #onDeleteExistingEffect(event, target) {
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId ?? target.dataset.effectId;
    if (!effectId) return;
    const effect = this.document.effects.get(effectId);
    if (effect) await effect.delete();
  }

  /* -------------------------------------------- */
  /*  Builder Action Handlers                      */
  /* -------------------------------------------- */

  /**
   * Pick a target button in a builder category grid.
   */
  static #onPickTarget(event, target) {
    const btn = target.closest(".ec-pick-btn") ?? target;
    const category = btn.dataset.category;
    const targetKey = btn.dataset.targetKey;
    if (!category || !targetKey) return;

    // Deselect siblings
    const grid = btn.closest(".ec-button-grid");
    if (grid) {
      for (const sibling of grid.querySelectorAll(".ec-pick-btn.selected")) {
        sibling.classList.remove("selected");
      }
    }
    btn.classList.add("selected");

    this._selectedTargets.set(category, targetKey);

    // Update the selected label in the builder form
    const form = this.element.querySelector(`.ec-builder-form[data-category="${category}"]`);
    if (form) {
      const selectedLabel = form.querySelector("[data-field='selected-label']");
      const selectedKey = form.querySelector("[data-field='selected-key']");
      const label = btn.querySelector(".ec-pick-btn__label")?.textContent || targetKey;
      if (selectedLabel) selectedLabel.textContent = label;
      if (selectedKey) selectedKey.value = targetKey;
    }
  }

  /**
   * Create an Active Effect from a builder category form.
   */
  static async #onCreateCategoryEffect(event, target) {
    const categoryId = target.dataset.category;
    const form = this.element.querySelector(`.ec-builder-form[data-category="${categoryId}"]`);
    if (!form) return;

    const targetKey = form.querySelector("[data-field='selected-key']")?.value;
    if (!targetKey) {
      ui.notifications.warn(game.i18n.localize("SHARDS.EffectCreator.NoTarget"));
      return;
    }

    const signBtn = form.querySelector(".ec-sign-btn");
    const isNegative = signBtn?.textContent.trim() === "-";
    const inputValue = (form.querySelector("[data-field='value']")?.value ?? "").trim();
    const customName = form.querySelector("[data-field='name']")?.value?.trim();
    const durationMode = form.querySelector("[data-field='duration-mode']")?.value ?? "permanent";
    const durationCount = Number(form.querySelector("[data-field='duration-count']")?.value ?? 1);
    const isPercent = form.querySelector(".ec-pct-btn")?.classList.contains("active") ?? false;

    if (!inputValue || inputValue === "0") {
      ui.notifications.warn(game.i18n.localize("SHARDS.EffectCreator.NoValue"));
      return;
    }

    const numericValue = Number(inputValue);
    const isFormula = isNaN(numericValue);

    let changeValue, displayValue;
    if (isFormula) {
      changeValue = inputValue;
      displayValue = inputValue;
    } else {
      const absValue = Math.abs(numericValue);
      const rawValue = isNegative ? -absValue : absValue;
      changeValue = String(rawValue);
      displayValue = rawValue;
    }

    if (isPercent && !isFormula) {
      changeValue = changeValue + "%";
    }

    let changeKey, modeValue = 2, autoName, icon;
    const sign = !isFormula && Number(changeValue) >= 0 ? "+" : "";
    const pctSuffix = isPercent ? "%" : "";

    switch (categoryId) {
      case "stat": {
        changeKey = `system.stats.${targetKey}.bonus`;
        const statLabel = game.i18n.localize(CONFIG.SHARDS.stats[targetKey]);
        autoName = isFormula ? `${statLabel} [${displayValue}]` : `${statLabel} ${sign}${displayValue}${pctSuffix}`;
        icon = !isFormula && Number(changeValue) >= 0 ? "icons/svg/upgrade.svg" : "icons/svg/downgrade.svg";
        break;
      }
      case "derived": {
        changeKey = `system.derived.${targetKey}`;
        const derivedLabel = game.i18n.localize(CONFIG.SHARDS.derivedStats[targetKey]);
        autoName = isFormula ? `${derivedLabel} [${displayValue}]` : `${derivedLabel} ${sign}${displayValue}${pctSuffix}`;
        icon = "icons/svg/aura.svg";
        break;
      }
      case "hpmp": {
        if (targetKey === "pips") {
          changeKey = "system.pips.max";
        } else {
          changeKey = targetKey === "hp" ? "system.health.max" : "system.mana.max";
        }
        const hpmpLabels = { hp: "SHARDS.Derived.MaxHp", mp: "SHARDS.Derived.MaxMp", pips: "SHARDS.Derived.MaxPips" };
        const label = game.i18n.localize(hpmpLabels[targetKey] || "SHARDS.Derived.MaxHp");
        autoName = isFormula ? `${label} [${displayValue}]` : `${label} ${sign}${displayValue}${pctSuffix}`;
        icon = targetKey === "hp" ? "icons/svg/regen.svg" : targetKey === "mp" ? "icons/svg/daze.svg" : "icons/svg/circle.svg";
        break;
      }
      case "growthRate": {
        changeKey = `system.growthRates.${targetKey}`;
        const grLabel = game.i18n.localize(CONFIG.SHARDS.stats[targetKey]);
        autoName = isFormula ? `${grLabel} Growth [${displayValue}]` : `${grLabel} Growth ${sign}${displayValue}${pctSuffix}`;
        icon = !isFormula && Number(changeValue) >= 0 ? "icons/svg/upgrade.svg" : "icons/svg/downgrade.svg";
        break;
      }
      case "movement": {
        if (targetKey === "size") {
          changeKey = "system.size";
          modeValue = 5;
          autoName = isFormula
            ? `${game.i18n.localize("SHARDS.Size")} [${displayValue}]`
            : `${game.i18n.localize("SHARDS.Size")} ${displayValue}`;
          icon = "icons/svg/target.svg";
        } else {
          changeKey = "system.mov";
          autoName = isFormula ? `MOV [${displayValue}]` : `MOV ${sign}${displayValue}${pctSuffix}`;
          icon = "icons/svg/wing.svg";
        }
        break;
      }
      default:
        return;
    }

    const effectName = customName || autoName;

    const isConditional = form.querySelector("[data-field='conditional']")?.checked ?? false;
    const conditionalLabel = form.querySelector("[data-field='conditional-label']")?.value?.trim() || "";

    const duration = {};
    if (durationMode === "rounds") duration.rounds = durationCount;
    else if (durationMode === "turns") duration.turns = durationCount;

    const aeData = {
      name: effectName,
      img: icon,
      changes: [{ key: changeKey, mode: modeValue, value: changeValue }],
      duration,
      disabled: false
    };

    if (isConditional) {
      aeData.flags = {
        "shards-of-mana": {
          conditional: true,
          conditionalLabel: conditionalLabel || undefined
        }
      };
    }

    this._applyDefaultFlags(aeData);
    await this.document.createEmbeddedDocuments("ActiveEffect", [aeData]);
    ui.notifications.info(game.i18n.format("SHARDS.EffectCreator.Applied", { name: effectName }));
  }

  static #onToggleSign(event, target) {
    const isNegative = target.textContent.trim() === "-";
    target.textContent = isNegative ? "+" : "-";
    target.classList.toggle("negative", !isNegative);
  }

  static #onTogglePercent(event, target) {
    target.classList.toggle("active");
  }

  static async #onToggleCondition(event, target) {
    const btn = target.closest("[data-condition-id]") ?? target;
    const conditionId = btn.dataset.conditionId;
    const doc = this.document;

    const existing = doc.effects.find(e => e.statuses?.has(conditionId));
    if (existing) {
      if (existing.disabled) {
        await existing.update({ disabled: false });
      } else {
        await existing.delete();
      }
    } else {
      const config = CONFIG.statusEffects.find(s => s.id === conditionId);
      if (!config) return;
      const aeData = {
        name: game.i18n.localize(config.name),
        img: config.img,
        statuses: [conditionId],
        changes: config.changes ?? []
      };
      this._applyDefaultFlags(aeData);
      await doc.createEmbeddedDocuments("ActiveEffect", [aeData]);
    }
  }

  static async #onToggleFlag(event, target) {
    const btn = target.closest("[data-flag-key]") ?? target;
    const flagKey = btn.dataset.flagKey;
    const def = ShardsEffectCreator.FLAG_DEFINITIONS.find(d => d.key === flagKey);
    if (!def) return;

    const doc = this.document;
    const existing = doc.effects.find(e =>
      e.changes.some(c => c.key === def.changeKey)
    );

    if (existing) {
      if (existing.disabled) {
        await existing.update({ disabled: false });
      } else {
        await existing.delete();
      }
    } else {
      const OVERRIDE = 5;
      const effectName = game.i18n.localize(def.label);
      const aeData = {
        name: effectName,
        img: def.icon,
        changes: [{ key: def.changeKey, mode: OVERRIDE, value: def.value ?? "true" }],
        disabled: false
      };
      this._applyDefaultFlags(aeData);
      await doc.createEmbeddedDocuments("ActiveEffect", [aeData]);
      ui.notifications.info(game.i18n.format("SHARDS.EffectCreator.Applied", { name: effectName }));
    }
  }

  static async #onToggleElementResistance(event, target) {
    const btn = target.closest("[data-element-key]") ?? target;
    const elementKey = btn.dataset.elementKey;
    if (!elementKey) return;

    const doc = this.document;
    const changeKey = `system.elementResistances.${elementKey}`;
    const OVERRIDE = 5;
    const cycle = ShardsEffectCreator.ELEMENT_TIER_CYCLE;

    const existing = doc.effects.find(e =>
      e.changes.some(c => c.key === changeKey && c.mode === OVERRIDE)
    );

    if (existing) {
      if (existing.disabled) {
        await existing.update({ disabled: false });
        return;
      }

      const change = existing.changes.find(c => c.key === changeKey);
      const currentTier = Number(change?.value ?? 0);
      const currentIdx = cycle.indexOf(currentTier);
      const nextIdx = currentIdx + 1;

      if (nextIdx >= cycle.length) {
        await existing.delete();
      } else {
        const nextTier = cycle[nextIdx];
        const tierConfig = CONFIG.SHARDS.resistanceTiers?.[String(nextTier)];
        const tierLabel = tierConfig ? game.i18n.localize(tierConfig.label) : "";
        const elemLabel = game.i18n.localize(
          `SHARDS.DamageType.${elementKey.charAt(0).toUpperCase() + elementKey.slice(1)}`
        );
        await existing.update({
          name: `${elemLabel} Res. ${tierLabel}`,
          changes: [{ key: changeKey, mode: OVERRIDE, value: String(nextTier) }]
        });
      }
    } else {
      const firstTier = cycle[0];
      const tierConfig = CONFIG.SHARDS.resistanceTiers?.[String(firstTier)];
      const tierLabel = tierConfig ? game.i18n.localize(tierConfig.label) : "";
      const elemLabel = game.i18n.localize(
        `SHARDS.DamageType.${elementKey.charAt(0).toUpperCase() + elementKey.slice(1)}`
      );
      const effectName = `${elemLabel} Res. ${tierLabel}`;
      const aeData = {
        name: effectName,
        img: "icons/svg/aura.svg",
        changes: [{ key: changeKey, mode: OVERRIDE, value: String(firstTier) }],
        disabled: false
      };
      this._applyDefaultFlags(aeData);
      await doc.createEmbeddedDocuments("ActiveEffect", [aeData]);
    }
  }

  /* -------------------------------------------- */
  /*  Context Menus                                */
  /* -------------------------------------------- */

  _showConditionContextMenu(event, conditionId) {
    const existing = this.document.effects.find(e => e.statuses?.has(conditionId));
    this._showEffectContextMenu(event, existing);
  }

  _showElementResistanceContextMenu(event, elementKey) {
    const changeKey = `system.elementResistances.${elementKey}`;
    const existing = this.document.effects.find(e =>
      e.changes.some(c => c.key === changeKey && c.mode === 5)
    );
    this._showEffectContextMenu(event, existing);
  }

  _showFlagContextMenu(event, flagKey) {
    const def = ShardsEffectCreator.FLAG_DEFINITIONS.find(d => d.key === flagKey);
    if (!def) return;
    const existing = this.document.effects.find(e =>
      e.changes.some(c => c.key === def.changeKey)
    );
    this._showEffectContextMenu(event, existing);
  }

  _showEffectContextMenu(event, effect) {
    if (!effect) return;

    this.element.querySelector(".ec-context-menu")?.remove();

    const menu = document.createElement("div");
    menu.classList.add("ec-context-menu");
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    const isDisabled = effect.disabled;
    const toggleLabel = isDisabled
      ? game.i18n.localize("SHARDS.EffectCreator.CtxEnable")
      : game.i18n.localize("SHARDS.EffectCreator.CtxDisable");
    const toggleIcon = isDisabled ? "fa-eye" : "fa-eye-slash";

    menu.innerHTML = `
      <button class="ec-ctx-item" data-ctx-action="toggle">
        <i class="fa-solid ${toggleIcon}"></i> ${toggleLabel}
      </button>
      <button class="ec-ctx-item" data-ctx-action="edit">
        <i class="fa-solid fa-pen-to-square"></i> ${game.i18n.localize("SHARDS.EffectCreator.CtxEdit")}
      </button>
      <button class="ec-ctx-item ec-ctx-item--danger" data-ctx-action="delete">
        <i class="fa-solid fa-trash"></i> ${game.i18n.localize("SHARDS.EffectCreator.CtxDelete")}
      </button>
    `;

    menu.querySelector("[data-ctx-action='toggle']").addEventListener("click", async () => {
      menu.remove();
      await effect.update({ disabled: !effect.disabled });
    });
    menu.querySelector("[data-ctx-action='edit']").addEventListener("click", () => {
      menu.remove();
      effect.sheet.render(true);
    });
    menu.querySelector("[data-ctx-action='delete']").addEventListener("click", async () => {
      menu.remove();
      await effect.delete();
    });

    const close = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("pointerdown", close);
        document.removeEventListener("keydown", escClose);
      }
    };
    const escClose = (e) => {
      if (e.key === "Escape") {
        menu.remove();
        document.removeEventListener("pointerdown", close);
        document.removeEventListener("keydown", escClose);
      }
    };
    requestAnimationFrame(() => {
      document.addEventListener("pointerdown", close);
      document.addEventListener("keydown", escClose);
    });

    this.element.appendChild(menu);
  }

  static async #onOpenAdvanced(event, target) {
    const aeData = {
      name: game.i18n.localize("SHARDS.Effects.NewEffect"),
      img: "icons/svg/aura.svg"
    };
    this._applyDefaultFlags(aeData);
    const [ae] = await this.document.createEmbeddedDocuments("ActiveEffect", [aeData]);
    ae.sheet.render(true);
  }

  /* -------------------------------------------- */
  /*  Critical HP Handlers                         */
  /* -------------------------------------------- */

  /**
   * Create an Active Effect that auto-activates when HP < 25%.
   */
  static async #onCreateCriticalHpEffect(event, target) {
    const form = this.element.querySelector('.ec-builder-form[data-category="criticalHp"]');
    if (!form) return;

    const targetKey = form.querySelector("[data-field='selected-key']")?.value;
    if (!targetKey) {
      ui.notifications.warn(game.i18n.localize("SHARDS.EffectCreator.NoTarget"));
      return;
    }

    const signBtn = form.querySelector(".ec-sign-btn");
    const isNegative = signBtn?.textContent.trim() === "-";
    const inputValue = (form.querySelector("[data-field='value']")?.value ?? "").trim();
    const customName = form.querySelector("[data-field='name']")?.value?.trim();
    const isPercent = form.querySelector(".ec-pct-btn")?.classList.contains("active") ?? false;

    if (!inputValue || inputValue === "0") {
      ui.notifications.warn(game.i18n.localize("SHARDS.EffectCreator.NoValue"));
      return;
    }

    const numericValue = Number(inputValue);
    const isFormula = isNaN(numericValue);

    let changeValue, displayValue;
    if (isFormula) {
      changeValue = inputValue;
      displayValue = inputValue;
    } else {
      const absValue = Math.abs(numericValue);
      const rawValue = isNegative ? -absValue : absValue;
      changeValue = String(rawValue);
      displayValue = rawValue;
    }

    if (isPercent && !isFormula) {
      changeValue = changeValue + "%";
    }

    // Parse target key (stat.str, derived.acc, etc.)
    const [targetType, targetStat] = targetKey.split(".");
    let changeKey, autoName, icon;
    const sign = !isFormula && Number(changeValue) >= 0 ? "+" : "";
    const pctSuffix = isPercent ? "%" : "";
    const critPrefix = game.i18n.localize("SHARDS.EffectCreator.CriticalHpPrefix");

    if (targetType === "stat") {
      changeKey = `system.stats.${targetStat}.bonus`;
      const statLabel = game.i18n.localize(CONFIG.SHARDS.stats[targetStat]);
      autoName = isFormula
        ? `${critPrefix} ${statLabel} [${displayValue}]`
        : `${critPrefix} ${statLabel} ${sign}${displayValue}${pctSuffix}`;
      icon = "icons/svg/downgrade.svg";
    } else if (targetType === "derived") {
      changeKey = `system.derived.${targetStat}`;
      const derivedLabel = game.i18n.localize(CONFIG.SHARDS.derivedStats[targetStat]);
      autoName = isFormula
        ? `${critPrefix} ${derivedLabel} [${displayValue}]`
        : `${critPrefix} ${derivedLabel} ${sign}${displayValue}${pctSuffix}`;
      icon = "icons/svg/downgrade.svg";
    } else {
      return;
    }

    const effectName = customName || autoName;

    // Determine initial disabled state based on current HP
    const doc = this.document;
    let startDisabled = true;
    if (this.isActor && doc.system?.health) {
      const ratio = doc.system.health.max > 0
        ? doc.system.health.value / doc.system.health.max
        : 1;
      startDisabled = ratio >= 0.25;
    }

    const aeData = {
      name: effectName,
      img: icon,
      changes: [{ key: changeKey, mode: 2, value: changeValue }],
      disabled: startDisabled,
      flags: {
        "shards-of-mana": {
          criticalHp: true
        }
      }
    };

    this._applyDefaultFlags(aeData);
    await this.document.createEmbeddedDocuments("ActiveEffect", [aeData]);
    ui.notifications.info(game.i18n.format("SHARDS.EffectCreator.Applied", { name: effectName }));
  }

  /**
   * Delete a Critical HP effect by ID.
   */
  static async #onDeleteCriticalHpEffect(event, target) {
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId ?? target.dataset.effectId;
    if (!effectId) return;
    const effect = this.document.effects.get(effectId);
    if (effect) await effect.delete();
  }

  /* -------------------------------------------- */
  /*  Choice-Linked Builder Handlers               */
  /* -------------------------------------------- */

  /**
   * Create an Active Effect from the choice-linked builder form.
   * Reads the selected template type and builds the AE with {CHOICE_VALUE} placeholders.
   */
  static async #onCreateChoiceLinkedEffect(event, target) {
    const form = this.element.querySelector(".ec-choice-linked-form");
    if (!form) return;

    const templateId = form.querySelector("[data-field='cl-template']")?.value;
    if (!templateId) {
      ui.notifications.warn(game.i18n.localize("SHARDS.EffectCreator.NoTarget"));
      return;
    }

    const customName = form.querySelector("[data-field='cl-name']")?.value?.trim();
    let changeKey, changeMode, changeValue, autoName, icon;

    switch (templateId) {
      case "elementRes": {
        const tier = form.querySelector("[data-field='cl-tier']")?.value ?? "1";
        const tierConfig = CONFIG.SHARDS.resistanceTiers?.[tier];
        const tierLabel = tierConfig ? game.i18n.localize(tierConfig.label) : tier;
        changeKey = "system.elementResistances.{CHOICE_VALUE}";
        changeMode = 5; // Override
        changeValue = tier;
        autoName = `{CHOICE_LABEL} Res. ${tierLabel}`;
        icon = "icons/svg/aura.svg";
        break;
      }
      case "damageType": {
        changeKey = "system.damageType";
        changeMode = 5;
        changeValue = "{CHOICE_VALUE}";
        autoName = "{CHOICE_LABEL} Damage";
        icon = "icons/svg/explosion.svg";
        break;
      }
      case "statBonus": {
        const value = form.querySelector("[data-field='cl-value']")?.value?.trim();
        if (!value) {
          ui.notifications.warn(game.i18n.localize("SHARDS.EffectCreator.NoValue"));
          return;
        }
        changeKey = "system.stats.{CHOICE_VALUE}.bonus";
        changeMode = 2; // Add
        changeValue = value;
        autoName = `{CHOICE_LABEL} ${Number(value) >= 0 ? "+" : ""}${value}`;
        icon = Number(value) >= 0 ? "icons/svg/upgrade.svg" : "icons/svg/downgrade.svg";
        break;
      }
      case "growthRate": {
        const value = form.querySelector("[data-field='cl-value']")?.value?.trim();
        if (!value) {
          ui.notifications.warn(game.i18n.localize("SHARDS.EffectCreator.NoValue"));
          return;
        }
        changeKey = "system.growthRates.{CHOICE_VALUE}";
        changeMode = 2;
        changeValue = value;
        autoName = `{CHOICE_LABEL} Growth ${Number(value) >= 0 ? "+" : ""}${value}`;
        icon = Number(value) >= 0 ? "icons/svg/upgrade.svg" : "icons/svg/downgrade.svg";
        break;
      }
      case "condImmunity": {
        changeKey = "system.conditionResistances.{CHOICE_VALUE}";
        changeMode = 5;
        changeValue = "true";
        autoName = "{CHOICE_LABEL} Immunity";
        icon = "icons/svg/aura.svg";
        break;
      }
      case "custom": {
        changeKey = form.querySelector("[data-field='cl-custom-key']")?.value?.trim();
        changeValue = form.querySelector("[data-field='cl-custom-value']")?.value?.trim() ?? "";
        changeMode = Number(form.querySelector("[data-field='cl-custom-mode']")?.value ?? 2);
        if (!changeKey) {
          ui.notifications.warn(game.i18n.localize("SHARDS.EffectCreator.NoTarget"));
          return;
        }
        autoName = "{CHOICE_LABEL} Effect";
        icon = "icons/svg/aura.svg";
        break;
      }
      default:
        return;
    }

    const aeData = {
      name: customName || autoName,
      img: icon,
      changes: [{ key: changeKey, mode: changeMode, value: String(changeValue) }],
      disabled: false
    };

    this._applyDefaultFlags(aeData);
    await this.document.createEmbeddedDocuments("ActiveEffect", [aeData]);
    ui.notifications.info(game.i18n.format("SHARDS.EffectCreator.Applied", { name: aeData.name }));
  }

  /* -------------------------------------------- */
  /*  Choice Set Handlers                          */
  /* -------------------------------------------- */

  /**
   * Add a new empty choice set to the item's flags.
   */
  static async #onAddChoiceSet(event, target) {
    if (this.isActor) return;
    const existing = this.document.flags?.["shards-of-mana"]?.choiceSets ?? [];
    const newSet = {
      id: foundry.utils.randomID(),
      label: "",
      type: "preset",
      presetType: "element",
      customOptions: [],
      required: true,
      itemUpdate: { key: "system.damageType", value: "{CHOICE_VALUE}" },
      effectTemplate: null
    };
    await this.document.setFlag("shards-of-mana", "choiceSets", [...existing, newSet]);
    this.render({ parts: ["main"] });
  }

  /**
   * Remove a choice set by ID.
   */
  static async #onRemoveChoiceSet(event, target) {
    const csId = target.closest("[data-cs-id]")?.dataset.csId;
    if (!csId) return;
    const existing = this.document.flags?.["shards-of-mana"]?.choiceSets ?? [];
    const filtered = existing.filter(cs => cs.id !== csId);
    await this.document.setFlag("shards-of-mana", "choiceSets", filtered);
    this.render({ parts: ["main"] });
  }

  /**
   * Add a custom option to a specific choice set.
   */
  static async #onAddCustomOption(event, target) {
    const csId = target.closest("[data-cs-id]")?.dataset.csId ?? target.dataset.csId;
    if (!csId) return;
    const sets = foundry.utils.deepClone(this.document.flags?.["shards-of-mana"]?.choiceSets ?? []);
    const cs = sets.find(s => s.id === csId);
    if (!cs) return;
    cs.customOptions = cs.customOptions ?? [];
    cs.customOptions.push({ label: "", value: "" });
    await this.document.setFlag("shards-of-mana", "choiceSets", sets);
    this.render({ parts: ["main"] });
  }

  /**
   * Remove a custom option from a specific choice set.
   */
  static async #onRemoveCustomOption(event, target) {
    const csId = target.closest("[data-cs-id]")?.dataset.csId ?? target.dataset.csId;
    const optIdx = Number(target.closest("[data-option-index]")?.dataset.optionIndex ?? target.dataset.optionIndex);
    if (!csId || isNaN(optIdx)) return;
    const sets = foundry.utils.deepClone(this.document.flags?.["shards-of-mana"]?.choiceSets ?? []);
    const cs = sets.find(s => s.id === csId);
    if (!cs || !cs.customOptions) return;
    cs.customOptions.splice(optIdx, 1);
    await this.document.setFlag("shards-of-mana", "choiceSets", sets);
    this.render({ parts: ["main"] });
  }

  /**
   * Bind change listeners for all choice set inline fields.
   * @private
   */
  _bindChoiceSetFieldListeners() {
    const cards = this.element.querySelectorAll(".ec-cs-card");
    if (!cards.length) return;

    const structuralFields = new Set(["cs-type", "cs-hasEffect", "cs-hasItemUpdate"]);
    const saveAll = foundry.utils.debounce(() => this._saveAllChoiceSets(), 400);
    const saveAndRerender = async (e) => {
      await this._saveAllChoiceSets();
      this.render({ parts: ["main"] });
    };

    for (const card of cards) {
      for (const input of card.querySelectorAll("input[data-field], select[data-field]")) {
        const field = input.dataset.field;
        if (structuralFields.has(field)) {
          input.addEventListener("change", saveAndRerender);
        } else {
          input.addEventListener("change", saveAll);
        }
      }
    }
  }

  /**
   * Read all choice set form state from the DOM and save to item flags.
   * @private
   */
  async _saveAllChoiceSets() {
    const cards = this.element.querySelectorAll(".ec-cs-card");
    if (!cards.length) return;

    const sets = [];
    for (const card of cards) {
      const csId = card.dataset.csId;
      if (!csId) continue;

      const label = card.querySelector("[data-field='cs-label']")?.value?.trim() ?? "";
      const type = card.querySelector("[data-field='cs-type']")?.value ?? "preset";
      const presetType = card.querySelector("[data-field='cs-presetType']")?.value ?? "element";
      const required = card.querySelector("[data-field='cs-required']")?.checked ?? true;

      // Custom options
      const customOptions = [];
      for (const row of card.querySelectorAll(".ec-cs-option-row")) {
        const optLabel = row.querySelector("[data-field='cs-opt-label']")?.value?.trim() ?? "";
        const optValue = row.querySelector("[data-field='cs-opt-value']")?.value?.trim() ?? "";
        customOptions.push({ label: optLabel, value: optValue });
      }

      // Item data update
      const hasItemUpdate = card.querySelector("[data-field='cs-hasItemUpdate']")?.checked ?? false;
      let itemUpdate = null;
      if (hasItemUpdate) {
        const updateKey = card.querySelector("[data-field='cs-itemUpdateKey']")?.value?.trim() ?? "";
        const updateValue = card.querySelector("[data-field='cs-itemUpdateValue']")?.value?.trim() ?? "";
        itemUpdate = { key: updateKey, value: updateValue };
      }

      // Effect template
      const hasEffect = card.querySelector("[data-field='cs-hasEffect']")?.checked ?? false;
      let effectTemplate = null;
      if (hasEffect) {
        const namePattern = card.querySelector("[data-field='cs-effectName']")?.value?.trim() ?? "";
        const changeKey = card.querySelector("[data-field='cs-changeKey']")?.value?.trim() ?? "";
        const changeMode = Number(card.querySelector("[data-field='cs-changeMode']")?.value ?? 2);
        const changeValue = card.querySelector("[data-field='cs-changeValue']")?.value?.trim() ?? "";
        effectTemplate = {
          namePattern,
          img: "icons/svg/aura.svg",
          changes: changeKey ? [{ key: changeKey, mode: changeMode, value: changeValue }] : []
        };
      }

      sets.push({
        id: csId,
        label,
        type,
        presetType: type === "preset" ? presetType : undefined,
        customOptions: type === "custom" ? customOptions : [],
        required,
        itemUpdate,
        effectTemplate
      });
    }

    await this.document.setFlag("shards-of-mana", "choiceSets", sets);
  }

  /* -------------------------------------------- */
  /*  Grant Handlers                               */
  /* -------------------------------------------- */

  /**
   * Add a new empty grant to the item's flags.
   */
  static async #onAddGrant(event, target) {
    if (this.isActor) return;
    const existing = this.document.flags?.["shards-of-mana"]?.grants ?? [];
    const newGrant = {
      id: foundry.utils.randomID(),
      type: "item",
      uuid: "",
      label: "",
      img: "",
      optional: false,
      effectChanges: []
    };
    await this.document.setFlag("shards-of-mana", "grants", [...existing, newGrant]);
    this.render({ parts: ["main"] });
  }

  /**
   * Remove a grant by ID.
   */
  static async #onRemoveGrant(event, target) {
    const grantId = target.closest("[data-grant-id]")?.dataset.grantId;
    if (!grantId) return;
    const existing = this.document.flags?.["shards-of-mana"]?.grants ?? [];
    const filtered = existing.filter(g => g.id !== grantId);
    await this.document.setFlag("shards-of-mana", "grants", filtered);
    this.render({ parts: ["main"] });
  }

  /**
   * Bind change listeners for all grant inline fields.
   * @private
   */
  _bindGrantFieldListeners() {
    const cards = this.element.querySelectorAll(".ec-grant-card");
    if (!cards.length) return;

    const structuralFields = new Set(["grant-type", "grant-propagation-cs"]);
    const saveAll = foundry.utils.debounce(() => this._saveAllGrants(), 400);
    const saveAndRerender = async () => {
      await this._saveAllGrants();
      this.render({ parts: ["main"] });
    };

    for (const card of cards) {
      for (const input of card.querySelectorAll("input[data-field], select[data-field]")) {
        const field = input.dataset.field;
        if (structuralFields.has(field)) {
          input.addEventListener("change", saveAndRerender);
        } else {
          input.addEventListener("change", saveAll);
        }
      }

      // Drop zone: accept dragged items for UUID resolution
      const dropZone = card.querySelector(".ec-grant-drop-zone");
      const uuidInput = card.querySelector("[data-field='grant-uuid']");
      if (dropZone && uuidInput) {
        dropZone.addEventListener("dragover", (e) => {
          e.preventDefault();
          dropZone.classList.add("drag-over");
        });
        dropZone.addEventListener("dragleave", () => {
          dropZone.classList.remove("drag-over");
        });
        dropZone.addEventListener("drop", async (e) => {
          e.preventDefault();
          dropZone.classList.remove("drag-over");
          const data = TextEditor.getDragEventData(e);
          if (data?.type === "Item" && data?.uuid) {
            uuidInput.value = data.uuid;
            // Resolve label + img
            const source = await fromUuid(data.uuid);
            if (source) {
              const grantId = card.dataset.grantId;
              const grants = foundry.utils.deepClone(this.document.flags?.["shards-of-mana"]?.grants ?? []);
              const grant = grants.find(g => g.id === grantId);
              if (grant) {
                grant.uuid = data.uuid;
                grant.label = source.name;
                grant.img = source.img;
                await this.document.setFlag("shards-of-mana", "grants", grants);
                this.render({ parts: ["main"] });
                return;
              }
            }
            // Fallback: just save UUID via normal save
            await this._saveAllGrants();
          }
        });
      }
    }
  }

  /**
   * Read all grant form state from the DOM and save to item flags.
   * @private
   */
  async _saveAllGrants() {
    const cards = this.element.querySelectorAll(".ec-grant-card");
    if (!cards.length) return;

    const grants = [];
    for (const card of cards) {
      const grantId = card.dataset.grantId;
      if (!grantId) continue;

      const type = card.querySelector("[data-field='grant-type']")?.value ?? "item";
      const optional = card.querySelector("[data-field='grant-optional']")?.checked ?? false;

      // Preserve existing label/img from flags (drop zone updates these)
      const existingGrants = this.document.flags?.["shards-of-mana"]?.grants ?? [];
      const existingGrant = existingGrants.find(g => g.id === grantId);

      // Read choice propagation fields
      const propagationCsId = card.querySelector("[data-field='grant-propagation-cs']")?.value?.trim() ?? "";
      let choicePropagation = null;
      if (propagationCsId) {
        const renamePattern = card.querySelector("[data-field='grant-propagation-rename']")?.value?.trim() ?? "";
        const updateKey = card.querySelector("[data-field='grant-propagation-updateKey']")?.value?.trim() ?? "";
        const updateValue = card.querySelector("[data-field='grant-propagation-updateValue']")?.value?.trim() ?? "";
        choicePropagation = {
          choiceSetId: propagationCsId,
          renamePattern: renamePattern || null,
          itemUpdates: updateKey ? [{ key: updateKey, value: updateValue }] : []
        };
      }

      if (type === "item") {
        const uuid = card.querySelector("[data-field='grant-uuid']")?.value?.trim() ?? "";
        grants.push({
          id: grantId,
          type: "item",
          uuid,
          label: existingGrant?.label ?? "",
          img: existingGrant?.img ?? "",
          optional,
          effectChanges: [],
          choicePropagation
        });
      } else {
        const label = card.querySelector("[data-field='grant-effectLabel']")?.value?.trim() ?? "";
        const changeKey = card.querySelector("[data-field='grant-changeKey']")?.value?.trim() ?? "";
        const changeMode = Number(card.querySelector("[data-field='grant-changeMode']")?.value ?? 2);
        const changeValue = card.querySelector("[data-field='grant-changeValue']")?.value?.trim() ?? "";
        grants.push({
          id: grantId,
          type: "effect",
          uuid: "",
          label,
          img: "",
          optional,
          effectChanges: changeKey ? [{ key: changeKey, mode: changeMode, value: changeValue }] : [],
          choicePropagation
        });
      }
    }

    await this.document.setFlag("shards-of-mana", "grants", grants);
  }

  /* -------------------------------------------- */
  /*  Damage Alteration Handlers                   */
  /* -------------------------------------------- */

  /**
   * Add a new empty damage alteration to the item's flags.
   */
  static async #onAddAlteration(event, target) {
    if (this.isActor) return;
    const existing = this.document.flags?.["shards-of-mana"]?.damageAlterations ?? [];
    const newAlt = {
      id: foundry.utils.randomID(),
      type: "changeElement",
      newElement: "fire",
      bonusFormula: "",
      newDefenseType: "physical",
      filter: { scope: "all" }
    };
    await this.document.setFlag("shards-of-mana", "damageAlterations", [...existing, newAlt]);
    this.render({ parts: ["main"] });
  }

  /**
   * Remove a damage alteration by ID.
   */
  static async #onRemoveAlteration(event, target) {
    const altId = target.closest("[data-alt-id]")?.dataset.altId;
    if (!altId) return;
    const existing = this.document.flags?.["shards-of-mana"]?.damageAlterations ?? [];
    const filtered = existing.filter(a => a.id !== altId);
    await this.document.setFlag("shards-of-mana", "damageAlterations", filtered);
    this.render({ parts: ["main"] });
  }

  /**
   * Bind change listeners for all damage alteration inline fields.
   * @private
   */
  _bindAlterationFieldListeners() {
    const cards = this.element.querySelectorAll(".ec-alt-card");
    if (!cards.length) return;

    const structuralFields = new Set(["alt-type", "alt-scope"]);
    const saveAll = foundry.utils.debounce(() => this._saveAllAlterations(), 400);
    const saveAndRerender = async () => {
      await this._saveAllAlterations();
      this.render({ parts: ["main"] });
    };

    for (const card of cards) {
      for (const input of card.querySelectorAll("input[data-field], select[data-field]")) {
        const field = input.dataset.field;
        if (structuralFields.has(field)) {
          input.addEventListener("change", saveAndRerender);
        } else {
          input.addEventListener("change", saveAll);
        }
      }
    }
  }

  /**
   * Read all damage alteration form state from the DOM and save to item flags.
   * @private
   */
  async _saveAllAlterations() {
    const cards = this.element.querySelectorAll(".ec-alt-card");
    if (!cards.length) return;

    const alts = [];
    for (const card of cards) {
      const altId = card.dataset.altId;
      if (!altId) continue;

      const type = card.querySelector("[data-field='alt-type']")?.value ?? "changeElement";
      const newElement = card.querySelector("[data-field='alt-newElement']")?.value ?? "";
      const bonusFormula = card.querySelector("[data-field='alt-bonusFormula']")?.value?.trim() ?? "";
      const newDefenseType = card.querySelector("[data-field='alt-newDefenseType']")?.value ?? "physical";

      const scope = card.querySelector("[data-field='alt-scope']")?.value ?? "all";
      const weaponGroup = card.querySelector("[data-field='alt-weaponGroup']")?.value ?? "";
      const skillType = card.querySelector("[data-field='alt-skillType']")?.value ?? "";

      alts.push({
        id: altId,
        type,
        newElement: type === "changeElement" ? newElement : undefined,
        bonusFormula: type === "bonusDamage" ? bonusFormula : undefined,
        newDefenseType: type === "changeDefenseType" ? newDefenseType : undefined,
        filter: {
          scope,
          weaponGroup: scope === "weaponGroup" ? weaponGroup : undefined,
          skillType: scope === "skillType" ? skillType : undefined
        }
      });
    }

    await this.document.setFlag("shards-of-mana", "damageAlterations", alts);
  }

  /* -------------------------------------------- */
  /*  Save & Close                                 */
  /* -------------------------------------------- */

  static async #onSaveAndClose() {
    if (!this.isActor) {
      await this._saveAllChoiceSets();
      await this._saveAllGrants();
      await this._saveAllAlterations();
    }
    ui.notifications.info(game.i18n.localize("SHARDS.EffectCreator.Saved"));
    this.close();
  }
}
