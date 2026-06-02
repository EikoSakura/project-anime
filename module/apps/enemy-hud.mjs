import { prepareElementDisplay } from "../helpers/effects.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Persistent floating Enemy HUD overlay shown during active combat.
 * Displays hostile/neutral combatants with a tiered reveal system:
 * - Hidden: HUD not shown to players
 * - Basic: Name + HP bar (percentage only) + rank badge
 * - Detailed: HP/MP numbers, conditions, pips
 * - Full: All stats, derived stats, element resistances, movement modes
 *
 * GM always sees full details regardless of the reveal tier setting.
 * Positioned on the right side of the screen, draggable with per-client persistence.
 */
export class ShardsEnemyHud extends HandlebarsApplicationMixin(ApplicationV2) {

  /* -------------------------------------------- */
  /*  Singleton                                   */
  /* -------------------------------------------- */

  static _instance = null;

  static getInstance() {
    if (!ShardsEnemyHud._instance) {
      ShardsEnemyHud._instance = new ShardsEnemyHud();
    }
    return ShardsEnemyHud._instance;
  }

  /* -------------------------------------------- */
  /*  Configuration                               */
  /* -------------------------------------------- */

  static DEFAULT_OPTIONS = {
    id: "shards-enemy-hud",
    classes: ["shards-of-mana", "enemy-hud"],
    position: { width: "auto", height: "auto" },
    window: {
      frame: false,
      positioned: false,
      minimizable: false,
      resizable: false
    },
    actions: {
      interactEnemy: ShardsEnemyHud.#onInteractEnemy,
      cycleMode: ShardsEnemyHud.#onCycleMode,
      toggleHud: ShardsEnemyHud.#onToggleHud
    }
  };

  static PARTS = {
    hud: {
      template: "systems/shards-of-mana/templates/apps/enemy-hud.hbs"
    }
  };

  /* -------------------------------------------- */
  /*  Rank-Based Theme Colors                     */
  /* -------------------------------------------- */

  static RANK_THEME_COLORS = {
    F: { accent: "#7788a0", accentLight: "#99aabb", accentGlow: "rgba(119, 136, 160, 0.3)" },
    E: { accent: "#40c060", accentLight: "#66dd88", accentGlow: "rgba(64, 192, 96, 0.3)" },
    D: { accent: "#40a0d4", accentLight: "#66bbee", accentGlow: "rgba(64, 160, 212, 0.3)" },
    C: { accent: "#c060d4", accentLight: "#dd88ee", accentGlow: "rgba(192, 96, 212, 0.3)" },
    B: { accent: "#d4a040", accentLight: "#eebb66", accentGlow: "rgba(212, 160, 64, 0.3)" },
    A: { accent: "#d44040", accentLight: "#ee6666", accentGlow: "rgba(212, 64, 64, 0.3)" },
    S: { accent: "#e0d050", accentLight: "#f0e080", accentGlow: "rgba(224, 208, 80, 0.3)" }
  };

  /* -------------------------------------------- */
  /*  Drag State                                  */
  /* -------------------------------------------- */

  #isDragging = false;
  #dragOffset = { x: 0, y: 0 };
  _renderDebounce = null;

  /* -------------------------------------------- */
  /*  Combat Data Source                           */
  /* -------------------------------------------- */

  /**
   * Get hostile/neutral combatants from the active combat.
   * Filters by token disposition: hostile (-1) and neutral (0).
   * Sorted by initiative order (descending).
   * @returns {Actor[]}
   */
  _getEnemyCombatants() {
    const combat = game.combat;
    if (!combat) return [];

    const seen = new Set();
    return combat.combatants
      .filter(c => {
        if (!c.actor) return false;
        // Exclude friendly (1) and secret (-2) dispositions
        const disposition = c.token?.disposition ?? c.actor.prototypeToken?.disposition ?? 0;
        return disposition <= 0;
      })
      .sort((a, b) => {
        // Sort by initiative (descending), matching combat tracker order
        const ia = Number.isNumeric(a.initiative) ? a.initiative : -Infinity;
        const ib = Number.isNumeric(b.initiative) ? b.initiative : -Infinity;
        return ib - ia;
      })
      .filter(c => {
        // Deduplicate by actor ID (multiple tokens of same actor)
        if (seen.has(c.actor.id)) return false;
        seen.add(c.actor.id);
        return true;
      })
      .map(c => c.actor);
  }

  /* -------------------------------------------- */
  /*  Data Preparation                            */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const mode = game.settings.get("shards-of-mana", "enemyHudMode");
    const revealTier = game.settings.get("shards-of-mana", "enemyHudRevealTier");
    const isGM = game.user.isGM;

    // Effective tier: GM always sees "full"
    const effectiveTier = isGM ? "full" : revealTier;

    context.mode = mode;
    context.isHidden = mode === "hidden";
    context.isCompact = mode === "compact";
    context.isExpanded = mode === "expanded";
    context.isGM = isGM;
    context.hasCombat = !!game.combat?.started;
    context.tier = effectiveTier;
    context.showBasic = effectiveTier !== "hidden";
    context.showDetailed = ["detailed", "full"].includes(effectiveTier);
    context.showFull = effectiveTier === "full";

    const enemies = this._getEnemyCombatants();

    context.enemies = enemies.map(actor => {
      const sys = actor.system;
      const hp = sys.health ?? { value: 0, max: 0 };
      const mp = sys.mana ?? { value: 0, max: 0 };
      const hpPct = hp.max > 0 ? Math.clamp(Math.round((hp.value / hp.max) * 100), 0, 100) : 0;
      const mpPct = mp.max > 0 ? Math.clamp(Math.round((mp.value / mp.max) * 100), 0, 100) : 0;

      // Rank (for badge + theme color)
      const rank = sys.rank ?? "F";
      const rankTheme = ShardsEnemyHud.RANK_THEME_COLORS[rank]
                     || ShardsEnemyHud.RANK_THEME_COLORS.F;

      // Active conditions (magnitude > 0)
      const activeConditions = [];
      if (sys.conditions) {
        for (const [key, value] of Object.entries(sys.conditions)) {
          if (value <= 0) continue;
          const effectDef = CONFIG.statusEffects.find(e => e.id === key);
          activeConditions.push({
            id: key,
            label: CONFIG.SHARDS.conditions?.[key]
              ? game.i18n.localize(CONFIG.SHARDS.conditions[key])
              : key,
            img: effectDef?.img ?? null,
            magnitude: value
          });
        }
      }

      // Pips — build dot array for template iteration
      const pips = sys.pips ?? { value: 0, max: 0 };
      const pipDots = [];
      for (let i = 0; i < pips.max; i++) {
        pipDots.push(i < pips.value);
      }

      // Stats (for Full tier)
      const stats = {};
      if (sys.stats) {
        for (const [key, stat] of Object.entries(sys.stats)) {
          stats[key] = {
            label: CONFIG.SHARDS.stats[key]
              ? game.i18n.localize(CONFIG.SHARDS.stats[key])
              : key.toUpperCase(),
            total: stat.total ?? (stat.base + stat.bonus)
          };
        }
      }

      // Derived stats (for Full tier)
      const derived = {};
      if (sys.derived) {
        for (const [key, value] of Object.entries(sys.derived)) {
          derived[key] = {
            label: CONFIG.SHARDS.derivedStats[key]
              ? game.i18n.localize(CONFIG.SHARDS.derivedStats[key])
              : key,
            value
          };
        }
      }

      // Element resistances (for Full tier)
      let notableElements = [];
      let hasNotableElements = false;
      if (sys.elementResistances) {
        const elemData = prepareElementDisplay(sys);
        notableElements = elemData.notableElements;
        hasNotableElements = elemData.hasNotableElements;
      }

      // Movement modes (for Full tier)
      const activeMovementModes = [];
      if (sys.movementModes) {
        for (const [key, value] of Object.entries(sys.movementModes)) {
          if (value) {
            activeMovementModes.push({
              key,
              label: CONFIG.SHARDS.movementModes[key]
                ? game.i18n.localize(CONFIG.SHARDS.movementModes[key])
                : key
            });
          }
        }
      }

      // Downed state
      const isDowned = (sys.conditions?.downed ?? 0) > 0;

      // Theme style string for CSS custom properties
      const themeStyle = [
        `--ehud-accent: ${rankTheme.accent}`,
        `--ehud-accent-light: ${rankTheme.accentLight}`,
        `--ehud-accent-glow: ${rankTheme.accentGlow}`
      ].join("; ");

      return {
        actorId: actor.id,
        name: actor.name,
        img: actor.img ?? "icons/svg/mystery-man.svg",
        rank,
        hp, mp,
        hpPct, mpPct,
        pips: { value: pips.value, max: pips.max, dots: pipDots },
        activeConditions,
        isDowned,
        stats,
        derived,
        notableElements,
        hasNotableElements,
        activeMovementModes,
        themeStyle,
        actorType: actor.type
      };
    });

    return context;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);
    this.#applyPosition();

    // Set up drag on the container (excluding buttons)
    const handle = this.element.querySelector("[data-drag-handle]") ?? this.element;
    handle.addEventListener("pointerdown", this.#onDragStart.bind(this));
  }

  /**
   * Apply saved position to the element. Uses right/top for right-side anchoring.
   */
  #applyPosition() {
    const pos = game.settings.get("shards-of-mana", "enemyHudPosition");
    if (pos?.right != null && pos?.top != null) {
      this.element.style.right = `${pos.right}px`;
      this.element.style.top = `${pos.top}px`;
      this.element.style.left = "unset";
    }
  }

  /* -------------------------------------------- */
  /*  Drag-to-Reposition                          */
  /* -------------------------------------------- */

  #onDragStart(event) {
    if (event.button !== 0) return;
    if (event.target.closest("button, a, select, input")) return;

    this.#isDragging = true;
    const rect = this.element.getBoundingClientRect();
    this.#dragOffset.x = event.clientX - rect.left;
    this.#dragOffset.y = event.clientY - rect.top;

    event.stopPropagation();
    event.preventDefault();

    const onMove = (e) => {
      if (!this.#isDragging) return;
      const newLeft = Math.max(0, e.clientX - this.#dragOffset.x);
      const newTop = Math.max(0, e.clientY - this.#dragOffset.y);
      this.element.style.left = `${newLeft}px`;
      this.element.style.top = `${newTop}px`;
      this.element.style.right = "unset";
    };

    const onUp = () => {
      if (!this.#isDragging) return;
      this.#isDragging = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);

      // Persist position as right/top (right-anchored)
      const finalRect = this.element.getBoundingClientRect();
      game.settings.set("shards-of-mana", "enemyHudPosition", {
        right: Math.max(0, Math.round(window.innerWidth - finalRect.right)),
        top: Math.round(finalRect.top)
      });
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  /* -------------------------------------------- */
  /*  Reactive Updates                            */
  /* -------------------------------------------- */

  /**
   * Debounced re-render when a relevant combatant's actor changes.
   * @param {Actor} actor
   */
  refreshIfRelevant(actor) {
    if (!this.rendered) return;
    if (!game.combat) return;
    const isCombatant = game.combat.combatants.some(c => c.actor?.id === actor.id);
    if (isCombatant) {
      clearTimeout(this._renderDebounce);
      this._renderDebounce = setTimeout(() => this.render(), 50);
    }
  }

  /* -------------------------------------------- */
  /*  Action Handlers                             */
  /* -------------------------------------------- */

  /**
   * Click portrait: target/untarget token.
   * Shift+click: pan to token.
   * GM data-open-sheet: open actor sheet.
   */
  static #onInteractEnemy(event, target) {
    const actorId = target.dataset.actorId;
    const actor = game.actors.get(actorId);
    if (!actor) return;

    if (event.shiftKey) {
      // Pan to token
      const token = canvas.tokens?.placeables.find(t => t.actor?.id === actorId);
      if (token) {
        canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 500 });
      }
    } else if (game.user.isGM && target.dataset.openSheet) {
      // GM: open sheet
      actor.sheet.render(true);
    } else {
      // Toggle target on token
      const token = canvas.tokens?.placeables.find(t => t.actor?.id === actorId);
      if (token) {
        token.setTarget(!token.isTargeted, { user: game.user, releaseOthers: false });
      }
    }
  }

  /**
   * Toggle between expanded and compact.
   */
  static #onCycleMode() {
    const current = game.settings.get("shards-of-mana", "enemyHudMode");
    const next = current === "expanded" ? "compact" : "expanded";
    game.settings.set("shards-of-mana", "enemyHudMode", next);
    this.render();
  }

  /**
   * Toggle between hidden and compact.
   */
  static #onToggleHud() {
    const current = game.settings.get("shards-of-mana", "enemyHudMode");
    const next = current === "hidden" ? "compact" : "hidden";
    game.settings.set("shards-of-mana", "enemyHudMode", next);
    this.render();
  }
}
