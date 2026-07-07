/**
 * Project: Anime — step-by-step Character Creator (rules doc V2).
 *
 * A guided ApplicationV2 that walks a new Player Character through the rulebook's
 * eight creation steps:
 *   1. Set Attributes       — all start d4; spend the configured Step-Ups (default 5), max d10.
 *   2. Define Talents       — exactly two named Talents, each with a Primary Attribute, at d6.
 *   3. Choose Weapon Style  — pick a Style, assign the Paired Attribute plus a matching Talent
 *                             or a second Attribute, name the weapon.
 *   4. Choose Armor Style   — pick a Style, name it.
 *   5. Build Techniques     — up to three, via the Technique Builder.
 *   6. Set Stats            — fixed baselines: 5 Hit Boxes, 5 Energy Boxes, Guard 6 + gear,
 *                             Movement from armor.
 *   7. Roll Luck Dice       — 3d12, recorded once.
 *   8. Name Everything      — name, portrait, pronouns, and the dossier fields.
 * The GM-configured extras keep their places: the optional Choices step (Race/Class packages)
 * leads.
 *
 * Like the Technique Builder and Advancement apps, it operates on the LIVE actor and
 * registers in `actor.apps`, so changes made here — or in the Builder it launches —
 * refresh it live. Sets `flags.project-anime.creationComplete` on finish (the actor
 * sheet auto-opens this once for an owner until that flag is set).
 */
import { SkillBuilderApp } from "./skill-builder.mjs";
import { stampCompendiumSource } from "../helpers/gear.mjs";
import { getBioFields } from "../helpers/bio-fields.mjs";
import { isImageIcon, actorTalents, styleTooltipHTML } from "../helpers/config.mjs";
import { getCreationConfig } from "../helpers/creation.mjs";
import { postRollCard } from "../helpers/dice.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Base creation steps, in rulebook order. The optional "choose" step (Race/Class/…)
 *  leads only when the GM has configured Choices. */
const BASE_STEPS = ["attributes", "talents", "weapon", "armor", "techniques", "stats", "luck", "finish"];

/** A character builds up to three Techniques at creation. */
const MAX_TECHNIQUES = 3;

/** Default images for the creation gear. */
const WEAPON_IMG = "icons/svg/sword.svg";
const ARMOR_IMG = "icons/svg/shield.svg";

/** Stable ordering: by sort, then name. */
const bySort = (a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name);

export class CharacterCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `pa-character-creator-${actor.id}` });
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "character-creator"],
    tag: "form",
    position: { width: 660, height: "auto" },
    window: { title: "PROJECTANIME.Creator.title", icon: "fa-solid fa-user-plus" },
    // No real submit — navigation and commits run through the action buttons below.
    // (Enter in a text field still routes here, so we persist the open step's fields.)
    form: { handler: CharacterCreatorApp.#onFormSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      stepNext: CharacterCreatorApp.#onStepNext,
      stepBack: CharacterCreatorApp.#onStepBack,
      gotoStep: CharacterCreatorApp.#onGotoStep,
      pickImage: CharacterCreatorApp.#onPickImage,
      raiseAttr: CharacterCreatorApp.#onRaiseAttr,
      lowerAttr: CharacterCreatorApp.#onLowerAttr,
      pickWeaponStyle: CharacterCreatorApp.#onPickWeaponStyle,
      pickArmorStyle: CharacterCreatorApp.#onPickArmorStyle,
      rollLuck: CharacterCreatorApp.#onRollLuck,
      openSkillBuilder: CharacterCreatorApp.#onOpenSkillBuilder,
      editSkill: CharacterCreatorApp.#onEditSkill,
      removeSkill: CharacterCreatorApp.#onRemoveSkill,
      chooseOption: CharacterCreatorApp.#onChooseOption,
      finish: CharacterCreatorApp.#onFinish
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/character-creator.hbs", scrollable: [""] }
  };

  /** Current step index. */
  #step = 0;
  /** Staged Define Talents rows [{name, attr}, {name, attr}]; null = unseeded. */
  #talents = null;
  /** Staged Weapon Style pick {style, name, attrA, pair}; null = unseeded.
   *  `pair` is "talent:<talentKey>" or "attr:<attrKey>". */
  #weapon = null;
  /** Staged Armor Style pick {style, name}; null = unseeded. */
  #armor = null;

  get title() {
    return `${game.i18n.localize("PROJECTANIME.Creator.title")} — ${this.actor.name}`;
  }

  /** The active step keys — "choose" leads only when the GM configured Choices. */
  #stepKeys() {
    const keys = [...BASE_STEPS];
    if (getCreationConfig().choices?.length) keys.unshift("choose");
    return keys;
  }

  /* -------------------------------------------- */
  /*  Creation gear lookups                       */
  /* -------------------------------------------- */

  /** The weapon / armor this creator authored (re-entering the step edits it in place). */
  #creationItem(type, flag) {
    return this.actor.items.find((i) => i.type === type && i.getFlag("project-anime", flag));
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const cfg = CONFIG.PROJECTANIME;
    const creation = getCreationConfig();
    const sys = this.actor.system;
    const steps = this.#stepKeys();
    const stepKey = steps[this.#step];
    const ctx = { config: cfg };

    ctx.steps = steps.map((k, i) => ({
      key: k,
      num: i + 1,
      label: game.i18n.localize(`PROJECTANIME.Creator.step.${k}`),
      index: i,
      active: i === this.#step,
      done: i < this.#step
    }));
    ctx.stepLabel = game.i18n.format("PROJECTANIME.Creator.stepOf", { n: this.#step + 1, total: steps.length });
    ctx.stepTitle = game.i18n.localize(`PROJECTANIME.Creator.step.${stepKey}`);
    ctx.isFirst = this.#step === 0;
    ctx.isLast = this.#step === steps.length - 1;
    ctx.onChoose = stepKey === "choose";
    ctx.onAttributes = stepKey === "attributes";
    ctx.onTalents = stepKey === "talents";
    ctx.onWeapon = stepKey === "weapon";
    ctx.onArmor = stepKey === "armor";
    ctx.onTechniques = stepKey === "techniques";
    ctx.onStats = stepKey === "stats";
    ctx.onLuck = stepKey === "luck";
    ctx.onFinish = stepKey === "finish";

    ctx.attrChoices = Object.fromEntries(cfg.attributeKeys.map((k) => [k, game.i18n.localize(cfg.attributes[k])]));

    // Creation Choices (Race/Class/…) — each offers Package options that grant abilities
    // for free. Current selection(s) = the chosen-option Packages already on the actor.
    if (stepKey === "choose") {
      ctx.choices = creation.choices.map((choice) => {
        const chosen = this.#chosenUuidsFor(choice.id);
        return {
          id: choice.id,
          label: choice.label,
          pickN: choice.mode === "pickN",
          n: choice.n,
          chosenCount: chosen.size,
          options: choice.options.map((opt) => ({
            uuid: opt.uuid,
            label: opt.label,
            img: opt.img || "icons/svg/item-bag.svg",
            selected: chosen.has(opt.uuid)
          }))
        };
      });
    }

    // 1 · Set Attributes — the free creation Step-Ups (count from the GM setting).
    const used = this.#stepsUsed();
    ctx.stepsUsed = used;
    ctx.stepsTotal = creation.stepUps;
    ctx.stepsLeft = Math.max(0, creation.stepUps - used);
    ctx.overSpent = used > creation.stepUps;
    ctx.attributes = cfg.attributeKeys.map((k) => {
      const a = sys.attributes[k];
      return {
        key: k,
        label: game.i18n.localize(cfg.attributes[k]),
        icon: cfg.attributeIcons?.[k] ?? "",
        base: a.base,
        die: `d${a.base}`,
        canRaise: a.base < 10 && ctx.stepsLeft > 0,
        canLower: a.base > 4
      };
    });

    // 2 · Define Talents — two named Talents at d6.
    if (stepKey === "talents") {
      if (!this.#talents) {
        const owned = actorTalents(this.actor);
        this.#talents = [0, 1].map((i) => ({
          name: owned[i]?.name ?? "",
          attr: owned[i]?.attribute ?? "might"
        }));
      }
      ctx.talentSlots = this.#talents.map((t, i) => ({ index: i, name: t.name, attr: t.attr }));
    }

    // 3 · Choose Weapon Style.
    if (stepKey === "weapon") {
      if (!this.#weapon) {
        const w = this.#creationItem("weapon", "creationWeapon");
        this.#weapon = w ? {
          style: w.system.style || "",
          name: w.name,
          attrA: w.system.accuracy?.attrA ?? "might",
          pair: w.system.talentId ? `talent:${w.system.talentId}` : `attr:${w.system.accuracy?.attrB ?? ""}`
        } : { style: "", name: "", attrA: "might", pair: "" };
      }
      const w = this.#weapon;
      // Icon cards, alphabetized — the printed line lives in the hover tooltip (matches the
      // item sheets).
      ctx.weaponStyles = cfg.weaponStyleKeys.map((k) => {
        const st = cfg.weaponStyles[k];
        return {
          key: k,
          label: game.i18n.localize(st.label),
          icon: st.icon,
          tooltip: styleTooltipHTML(st, "PROJECTANIME.Style.weapon"),
          selected: k === w.style
        };
      }).sort((a, b) => a.label.localeCompare(b.label));
      const talents = actorTalents(this.actor);
      ctx.weapon = { name: w.name, attrA: w.attrA };
      ctx.pairChoices = {
        ...Object.fromEntries(talents.map((t) => [
          `talent:${t.id}`,
          game.i18n.format("PROJECTANIME.Creator.talentOpt", { name: t.name })
        ])),
        ...Object.fromEntries(cfg.attributeKeys.map((k) => [`attr:${k}`, game.i18n.localize(cfg.attributes[k])]))
      };
      ctx.weaponPair = w.pair;
    }

    // 4 · Choose Armor Style.
    if (stepKey === "armor") {
      if (!this.#armor) {
        const a = this.#creationItem("armor", "creationArmor");
        this.#armor = a ? { style: a.system.style || "", name: a.name } : { style: "", name: "" };
      }
      // Icon cards, alphabetized — the printed line lives in the hover tooltip (matches the
      // item sheets).
      ctx.armorStyles = cfg.armorStyleKeys.map((k) => {
        const st = cfg.armorStyles[k];
        return {
          key: k,
          label: game.i18n.localize(st.label),
          icon: st.icon,
          tooltip: styleTooltipHTML(st, "PROJECTANIME.Style.armor"),
          selected: k === this.#armor.style
        };
      }).sort((a, b) => a.label.localeCompare(b.label));
      ctx.armor = { name: this.#armor.name };
    }

    // 5 · Build Techniques — up to three via the Technique Builder.
    ctx.skills = this.actor.items
      .filter((i) => i.type === "skill")
      .sort(bySort)
      .map((i) => ({
        id: i.id,
        name: i.name,
        img: i.img,
        actionLabel: game.i18n.localize(cfg.actionTypes[i.system.actionType] ?? ""),
        energyCost: i.system.energyCost ?? 0,
        passive: i.system.actionType === "passive"
      }));
    ctx.techniqueMax = MAX_TECHNIQUES;
    ctx.canBuild = ctx.skills.length < MAX_TECHNIQUES;

    // 6 · Set Stats — fixed baselines + the equipped gear's contribution (model-derived).
    ctx.stats = {
      hp: cfg.baseHitBoxes,
      energy: cfg.baseEnergyBoxes,
      guard: sys.guard?.value ?? cfg.baseGuard,
      movement: sys.movement?.value ?? 0,
      regen: sys.energyRegen ?? cfg.baseEnergyRegen
    };

    // 7 · Roll Luck Dice.
    ctx.luckDice = sys.luckDice ?? [];
    ctx.luckRolled = !!this.actor.getFlag("project-anime", "luckRolled");
    ctx.luckFormula = `${cfg.luckDiceCount}d${cfg.luckDie}`;

    // 8 · Name Everything — name, portrait, pronouns + the GM-configurable dossier fields.
    ctx.name = this.actor.name;
    ctx.img = this.actor.img;
    ctx.biography = sys.biography ?? "";
    ctx.pronouns = sys.pronouns ?? "";
    ctx.bioFields = getBioFields().map((f) => ({
      key: f.key,
      label: f.label,
      long: f.type === "long",
      icon: f.icon,
      iconImg: f.icon ? isImageIcon(f.icon) : false,
      value: sys.details?.[f.key] ?? ""
    }));

    return ctx;
  }

  /** Step-Ups already spent = sum over attributes of (steps above d4). */
  #stepsUsed() {
    const attrs = this.actor.system.attributes;
    return CONFIG.PROJECTANIME.attributeKeys.reduce(
      (n, k) => n + Math.max(0, ((attrs[k].base ?? 4) - 4) / 2),
      0
    );
  }

  /* -------------------------------------------- */
  /*  Render lifecycle                            */
  /* -------------------------------------------- */

  /** @override — live-refresh on actor changes by joining the document app registry. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.actor.apps[this.id] = this;
  }

  _onClose(options) {
    delete this.actor.apps[this.id];
    super._onClose?.(options);
  }

  /* -------------------------------------------- */
  /*  Form persistence                            */
  /* -------------------------------------------- */

  static #onFormSubmit() {
    // Enter in a field routes here — persist the open step's inputs.
    return this.#sync();
  }

  /** Persist the open step's inputs: actor fields (name + any system.* paths) update the
   *  document; the staged creation inputs (Talent slots, weapon, armor) update this app's
   *  working state and commit as items on navigation. */
  async #sync() {
    if (!this.element || !this.actor.isOwner) return;
    // Flatten so dotted (`system.details.age`) keys resolve whether FormDataExtended
    // returns a flat or a nested object.
    const data = foundry.utils.flattenObject(new foundry.applications.ux.FormDataExtended(this.element).object);

    // Staged creation state.
    if (this.#talents) {
      this.#talents.forEach((t, i) => {
        if (typeof data[`talentName.${i}`] === "string") t.name = data[`talentName.${i}`];
        if (typeof data[`talentAttr.${i}`] === "string") t.attr = data[`talentAttr.${i}`];
      });
    }
    if (this.#weapon) {
      if (typeof data.weaponName === "string") this.#weapon.name = data.weaponName;
      if (typeof data.weaponAttrA === "string") this.#weapon.attrA = data.weaponAttrA;
      if (typeof data.weaponPair === "string") this.#weapon.pair = data.weaponPair;
    }
    if (this.#armor && typeof data.armorName === "string") this.#armor.name = data.armorName;

    // Actor fields.
    const update = {};
    if (typeof data.name === "string" && data.name !== this.actor.name) update.name = data.name;
    for (const [key, val] of Object.entries(data)) {
      if (key.startsWith("system.")) update[key] = val;
    }
    if (Object.keys(update).length) await this.actor.update(update);
  }

  /* -------------------------------------------- */
  /*  Navigation                                  */
  /* -------------------------------------------- */

  static async #onStepNext() {
    await this.#sync();
    if (!this.#validateStep()) return;
    await this.#commitStep();
    if (this.#step < this.#stepKeys().length - 1) this.#step += 1;
    await this.#onEnterStep();
    this.render();
  }

  static async #onStepBack() {
    await this.#sync();
    await this.#commitStep();
    if (this.#step > 0) this.#step -= 1;
    await this.#onEnterStep();
    this.render();
  }

  static async #onGotoStep(event, target) {
    await this.#sync();
    await this.#commitStep();
    const i = Number(target.dataset.step);
    if (i >= 0 && i < this.#stepKeys().length) this.#step = i;
    await this.#onEnterStep();
    this.render();
  }

  /** Block leaving a step that isn't legal yet. */
  #validateStep() {
    const creation = getCreationConfig();
    const key = this.#stepKeys()[this.#step];
    const warn = (k, data) => { ui.notifications.warn(game.i18n.format(k, data ?? {})); return false; };

    if (key === "choose") {
      const missing = creation.choices.find((c) => c.mode === "single" && this.#chosenUuidsFor(c.id).size === 0);
      if (missing) return warn("PROJECTANIME.Creator.chooseRequired", { label: missing.label });
    }
    if (key === "attributes" && this.#stepsUsed() < creation.stepUps) {
      return warn("PROJECTANIME.Creator.stepsRemaining", { n: creation.stepUps - this.#stepsUsed() });
    }
    if (key === "talents" && this.#talents?.some((t) => !t.name.trim())) {
      return warn("PROJECTANIME.Creator.talentsRequired");
    }
    if (key === "weapon") {
      const w = this.#weapon;
      if (!w?.style || !w.name.trim() || !w.pair) return warn("PROJECTANIME.Creator.weaponRequired");
      // The second Attribute must differ from the Paired Attribute — Heavy alone may double
      // up, and only on Might (rules: Weapon Styles, the Might + Might exception).
      if (w.pair === `attr:${w.attrA}` && !(w.style === "heavy" && w.attrA === "might")) {
        return warn("PROJECTANIME.Creator.weaponPairSame");
      }
    }
    if (key === "armor" && (!this.#armor?.style || !this.#armor.name.trim())) {
      return warn("PROJECTANIME.Creator.armorRequired");
    }
    if (key === "luck" && !this.actor.getFlag("project-anime", "luckRolled")) {
      return warn("PROJECTANIME.Creator.luckRequired");
    }
    return true;
  }

  /** Commit the open step's staged state to the actor (Talent / weapon / armor items).
   *  Best-effort — incomplete staging simply isn't written yet. */
  async #commitStep() {
    const key = this.#stepKeys()[this.#step];
    if (key === "talents") return this.#commitTalents();
    if (key === "weapon") return this.#commitWeapon();
    if (key === "armor") return this.#commitArmor();
  }

  /** Write the two Define-Talents slots as embedded Talent rows at d6 (create or update in place). */
  async #commitTalents() {
    if (!this.#talents) return;
    const existing = actorTalents(this.actor);
    const changes = {};
    this.#talents.forEach((t, i) => {
      const name = (t.name ?? "").trim();
      if (!name) return;
      const row = existing[i];
      if (row) {
        if (row.name !== name || row.attribute !== t.attr) {
          changes[`system.talents.${row.id}.name`] = name;
          changes[`system.talents.${row.id}.attribute`] = t.attr;
        }
      } else {
        changes[`system.talents.${foundry.utils.randomID()}`] = { name, die: 6, attribute: t.attr };
      }
    });
    if (Object.keys(changes).length) await this.actor.update(changes);
  }

  /** Write the staged Weapon Style as an equipped weapon item (create or update in place). */
  async #commitWeapon() {
    const cfg = CONFIG.PROJECTANIME;
    const w = this.#weapon;
    const st = w ? cfg.weaponStyles[w.style] : null;
    if (!st || !(w.name ?? "").trim()) return;
    const [min, max] = st.range;
    const talentId = w.pair?.startsWith("talent:") ? w.pair.slice(7) : "";
    const attrB = w.pair?.startsWith("attr:") ? w.pair.slice(5) : w.attrA;
    const system = {
      style: w.style,
      accuracy: { attrA: w.attrA, attrB: attrB in cfg.attributes ? attrB : w.attrA, mod: 0 },
      talentId: talentId && this.actor.system.talents?.[talentId] ? talentId : "",
      damage: { value: st.damage },
      threshold: st.threshold,
      range: { type: max > 1 ? "ranged" : "melee", tiles: max, minTiles: min > 1 ? min : 0 },
      dual: !!st.dual,
      grip: st.twoHanded ? "two" : "one",
      twoHandedOnly: !!st.twoHanded,
      equipped: true,
      hand: "main"
    };
    const existing = this.#creationItem("weapon", "creationWeapon");
    if (existing) await existing.update({ name: w.name.trim(), system });
    else {
      await this.actor.createEmbeddedDocuments("Item", [{
        name: w.name.trim(), type: "weapon", img: WEAPON_IMG, system,
        flags: { "project-anime": { creationWeapon: true } }
      }]);
    }
  }

  /** Write the staged Armor Style as an equipped armor item (create or update in place). */
  async #commitArmor() {
    const cfg = CONFIG.PROJECTANIME;
    const a = this.#armor;
    const st = a ? cfg.armorStyles[a.style] : null;
    if (!st || !(a.name ?? "").trim()) return;
    const system = {
      style: a.style,
      guardBonus: st.guard,
      movement: st.movement,
      energyRegen: st.energyRegen ?? 0,
      equipped: true
    };
    const existing = this.#creationItem("armor", "creationArmor");
    if (existing) await existing.update({ name: a.name.trim(), system });
    else {
      await this.actor.createEmbeddedDocuments("Item", [{
        name: a.name.trim(), type: "armor", img: ARMOR_IMG, system,
        flags: { "project-anime": { creationArmor: true } }
      }]);
    }
  }

  /** Side effects on entering a step: write the fixed stat baselines. */
  async #onEnterStep() {
    const cfg = CONFIG.PROJECTANIME;
    const key = this.#stepKeys()[this.#step];
    if (key === "stats") {
      // Set Stats (rules): Hit Boxes 5, Energy Boxes 5, both full. Only during initial
      // creation — once finished, boxes bought through Advancement must survive a re-run.
      if (!this.actor.getFlag("project-anime", "creationComplete")) {
        const src = this.actor._source.system;
        if (src.hp.max !== cfg.baseHitBoxes || src.hp.value !== cfg.baseHitBoxes
          || src.energy.max !== cfg.baseEnergyBoxes || src.energy.value !== cfg.baseEnergyBoxes) {
          await this.actor.update({
            "system.hp.max": cfg.baseHitBoxes,
            "system.hp.value": cfg.baseHitBoxes,
            "system.energy.max": cfg.baseEnergyBoxes,
            "system.energy.value": cfg.baseEnergyBoxes
          });
        }
      }
    }
  }

  /* -------------------------------------------- */
  /*  Attributes (free Step-Ups)                  */
  /* -------------------------------------------- */

  static async #onRaiseAttr(event, target) {
    const key = target.closest("[data-attribute]")?.dataset.attribute;
    const attr = this.actor.system.attributes[key];
    // No Attribute may exceed d10 AT CREATION; the d12 ceiling belongs to advancement.
    if (!attr || attr.base >= 10) return;
    if (this.#stepsUsed() >= getCreationConfig().stepUps) {
      return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Creator.noStepsLeft"));
    }
    await this.actor.update({ [`system.attributes.${key}.base`]: attr.base + 2 });
  }

  static async #onLowerAttr(event, target) {
    const key = target.closest("[data-attribute]")?.dataset.attribute;
    const attr = this.actor.system.attributes[key];
    if (!attr || attr.base <= 4) return;
    await this.actor.update({ [`system.attributes.${key}.base`]: attr.base - 2 });
  }

  /* -------------------------------------------- */
  /*  Weapon / Armor Styles                       */
  /* -------------------------------------------- */

  static async #onPickWeaponStyle(event, target) {
    await this.#sync();
    if (!this.#weapon) return;
    this.#weapon.style = target.dataset.style || "";
    this.render();
  }

  static async #onPickArmorStyle(event, target) {
    await this.#sync();
    if (!this.#armor) return;
    this.#armor.style = target.dataset.style || "";
    this.render();
  }

  /* -------------------------------------------- */
  /*  Luck Dice                                   */
  /* -------------------------------------------- */

  static async #onRollLuck() {
    // Luck Dice are rolled exactly once during creation and then locked in. (A GM can
    // clear the `luckRolled` flag to allow another roll.)
    if (this.actor.getFlag("project-anime", "luckRolled")) return;
    const cfg = CONFIG.PROJECTANIME;
    const roll = await new Roll(`${cfg.luckDiceCount}d${cfg.luckDie}`).evaluate();
    const values = roll.dice[0].results.map((r) => r.result);
    await this.actor.update({ "system.luckDice": values });
    await this.actor.setFlag("project-anime", "luckRolled", true);
    await postRollCard(this.actor, {
      title: game.i18n.localize("PROJECTANIME.Advancement.rollLuck"),
      roll,
      lines: [`${game.i18n.localize("PROJECTANIME.Stat.luckDice")}: <strong>${values.join(", ")}</strong>`]
    });
    this.render();
  }

  /* -------------------------------------------- */
  /*  Techniques (Builder hand-off)               */
  /* -------------------------------------------- */

  /** Open (or focus) the in-game Technique Builder, jumping straight into Build mode. */
  static #onOpenSkillBuilder() {
    if (this.actor.items.filter((i) => i.type === "skill").length >= MAX_TECHNIQUES) return;
    const id = `pa-skill-builder-${this.actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.bringToFront();
    return new SkillBuilderApp(this.actor, { startMode: "build" }).render(true);
  }

  /** Edit a built Technique in the full Builder, pre-loaded with all its choices. */
  static #onEditSkill(event, target) {
    const id = target.closest("[data-skill-id]")?.dataset.skillId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "skill") return;
    return SkillBuilderApp.open(this.actor, { skillId: id });
  }

  /** Delete a built Technique (creation is a sandbox — undo is free). */
  static async #onRemoveSkill(event, target) {
    const id = target.closest("[data-skill-id]")?.dataset.skillId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "skill") return;
    // Granted (free) abilities are managed by their source bundle.
    if (item.getFlag("project-anime", "granted")) return;
    await item.delete();
    this.render();
  }

  /* -------------------------------------------- */
  /*  Choices (Race/Class — grant Packages free)  */
  /* -------------------------------------------- */

  /** The source-uuids currently chosen for a choice = its choice-flagged Packages on the actor. */
  #chosenUuidsFor(choiceId) {
    const set = new Set();
    for (const item of this.actor.items) {
      if (item.type !== "package" || item.getFlag("project-anime", "choice") !== choiceId) continue;
      const src = item.getFlag("project-anime", "chosenOption");
      if (src) set.add(src);
    }
    return set;
  }

  /** Add an option's Package to the actor (flagged with its choice) — the Grant engine then
   *  grants its abilities for free. */
  async #addChoicePackage(choiceId, uuid) {
    const src = await fromUuid(uuid);
    if (!src || src.type !== "package") {
      return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Creator.choiceMissing"));
    }
    const data = src.toObject();
    delete data._id;
    stampCompendiumSource(data, src);
    foundry.utils.setProperty(data, "flags.project-anime.choice", choiceId);
    foundry.utils.setProperty(data, "flags.project-anime.chosenOption", uuid);
    await this.actor.createEmbeddedDocuments("Item", [data]);
  }

  /** Pick (or, for pick-N, toggle) a choice option. Single-pick swaps the previous Package;
   *  the dynamic Grant link then swaps the granted abilities to match. */
  static async #onChooseOption(event, target) {
    const choiceId = target.closest("[data-choice-id]")?.dataset.choiceId;
    const uuid = target.closest("[data-option-uuid]")?.dataset.optionUuid;
    if (!choiceId || !uuid) return;
    const choice = getCreationConfig().choices.find((c) => c.id === choiceId);
    if (!choice) return;
    const existing = this.actor.items.filter((i) => i.type === "package" && i.getFlag("project-anime", "choice") === choiceId);
    const already = existing.find((i) => i.getFlag("project-anime", "chosenOption") === uuid);

    if (choice.mode === "pickN") {
      if (already) {
        await already.delete();
      } else if (existing.length >= (choice.n || 1)) {
        return ui.notifications.warn(game.i18n.format("PROJECTANIME.Creator.choosePickMax", { n: choice.n || 1, label: choice.label }));
      } else {
        await this.#addChoicePackage(choiceId, uuid);
      }
    } else {
      if (already) return; // re-clicking the selected single option — keep it
      if (existing.length) await this.actor.deleteEmbeddedDocuments("Item", existing.map((i) => i.id));
      await this.#addChoicePackage(choiceId, uuid);
    }
    this.render();
  }

  /* -------------------------------------------- */
  /*  Pick portrait                               */
  /* -------------------------------------------- */

  static async #onPickImage() {
    const FP = foundry.applications.apps.FilePicker?.implementation
      ?? foundry.applications.apps.FilePicker
      ?? globalThis.FilePicker;
    const fp = new FP({
      type: "image",
      current: this.actor.img || "",
      callback: (path) => this.actor.update({ img: path }).catch((err) => ui.notifications.error(err.message))
    });
    return fp.browse();
  }

  /* -------------------------------------------- */
  /*  Finish                                      */
  /* -------------------------------------------- */

  static async #onFinish() {
    await this.#sync();
    await this.actor.setFlag("project-anime", "creationComplete", true);
    ui.notifications.info(game.i18n.format("PROJECTANIME.Creator.done", { name: this.actor.name }));
    this.close();
  }
}
