import { ShardsEnemyHud } from "./enemy-hud.mjs";
import { getTargetingSourceTokenId } from "../canvas/targeting-line.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Log Horizon-inspired Token HUD overlay.
 * Floats near tokens on the canvas, showing character data in a flashy
 * anime JRPG style with deploy animations, scan-line overlays, and
 * disposition-based color theming.
 *
 * Shows on hover (after configurable delay) or pinned on token selection.
 * Tracks token position through canvas pan/zoom/drag via RAF loop.
 */
export class ShardsTokenHud extends HandlebarsApplicationMixin(ApplicationV2) {

  /* -------------------------------------------- */
  /*  Singleton                                   */
  /* -------------------------------------------- */

  static _instance = null;

  static getInstance() {
    if (!ShardsTokenHud._instance) {
      ShardsTokenHud._instance = new ShardsTokenHud();
    }
    return ShardsTokenHud._instance;
  }

  /* -------------------------------------------- */
  /*  Configuration                               */
  /* -------------------------------------------- */

  static DEFAULT_OPTIONS = {
    id: "shards-token-hud",
    classes: ["shards-of-mana", "token-hud-overlay"],
    position: { width: "auto", height: "auto" },
    window: {
      frame: false,
      positioned: false,
      minimizable: false,
      resizable: false
    },
    actions: {
      openSheet: ShardsTokenHud.#onOpenSheet
    }
  };

  static PARTS = {
    hud: {
      template: "systems/shards-of-mana/templates/apps/token-hud-overlay.hbs"
    }
  };

  /* -------------------------------------------- */
  /*  State                                       */
  /* -------------------------------------------- */

  /** @type {Token|null} The token being hovered */
  #hoveredToken = null;

  /** @type {Token|null} The currently controlled/selected token */
  #controlledToken = null;

  /** @type {Token|null} The token whose data is currently displayed */
  #activeToken = null;

  /** @type {number|null} Timer for hover enter delay */
  #hoverEnterTimeout = null;

  /** @type {number|null} Timer for hover leave delay */
  #hoverLeaveTimeout = null;

  /** @type {number|null} RAF ID for position tracking */
  #positionRAF = null;

  /** @type {boolean} Whether deploy animation is active */
  #isDeploying = false;

  /** @type {number|null} Debounced render timer */
  _renderDebounce = null;

  /** @type {string|null|undefined} Cached targeting source ID (undefined = not yet computed) */
  #lastTargetingSourceId = undefined;

  /** @type {boolean} Cached preferred side for HUD (true = right of token, false = left) */
  #cachedPreferRight = true;

  /* -------------------------------------------- */
  /*  Public Hook Handlers                        */
  /* -------------------------------------------- */

  /**
   * Called from the hoverToken hook.
   * @param {Token} token
   * @param {boolean} hovered
   */
  onTokenHover(token, hovered) {
    if (!game.settings.get("shards-of-mana", "tokenHudEnabled")) return;

    if (hovered) {
      // Clear any pending hide
      if (this.#hoverLeaveTimeout) {
        clearTimeout(this.#hoverLeaveTimeout);
        this.#hoverLeaveTimeout = null;
      }
      // Already showing this token
      if (this.#activeToken === token) return;

      this.#hoveredToken = token;
      const delay = game.settings.get("shards-of-mana", "tokenHudHoverDelay") ?? 300;
      if (this.#hoverEnterTimeout) clearTimeout(this.#hoverEnterTimeout);
      this.#hoverEnterTimeout = setTimeout(() => {
        this.#hoverEnterTimeout = null;
        this.show(token);
      }, delay);
    } else {
      // Clear pending show
      if (this.#hoverEnterTimeout) {
        clearTimeout(this.#hoverEnterTimeout);
        this.#hoverEnterTimeout = null;
      }
      this.#hoveredToken = null;

      // If we have a controlled token, switch back to it
      if (this.#controlledToken && this.#activeToken === token) {
        this.show(this.#controlledToken);
      } else if (this.#activeToken === token) {
        // Hide after short delay
        this.#hoverLeaveTimeout = setTimeout(() => {
          this.#hoverLeaveTimeout = null;
          this.hide();
        }, 200);
      }
    }
  }

  /**
   * Called from the controlToken hook.
   * @param {Token} token
   * @param {boolean} controlled
   */
  onTokenControl(token, controlled) {
    if (!game.settings.get("shards-of-mana", "tokenHudEnabled")) return;

    if (controlled) {
      // Multi-select: hide token HUD
      if (canvas.tokens.controlled.length > 1) {
        this.#controlledToken = null;
        this.hide();
        return;
      }
      this.#controlledToken = token;
      if (this.#hoverEnterTimeout) {
        clearTimeout(this.#hoverEnterTimeout);
        this.#hoverEnterTimeout = null;
      }
      if (this.#hoverLeaveTimeout) {
        clearTimeout(this.#hoverLeaveTimeout);
        this.#hoverLeaveTimeout = null;
      }
      this.show(token);
    } else {
      if (this.#controlledToken === token) {
        this.#controlledToken = null;
        // If hovering another token, show that one
        if (this.#hoveredToken) {
          this.show(this.#hoveredToken);
        } else {
          this.hide();
        }
      }
    }
  }

  /**
   * Called when the active token's actor data changes.
   * @param {Actor} actor
   */
  refreshIfRelevant(actor) {
    if (!this.rendered || !this.#activeToken) return;
    if (this.#activeToken.actor?.id !== actor.id) return;
    clearTimeout(this._renderDebounce);
    this._renderDebounce = setTimeout(() => this.render(), 50);
  }

  /**
   * Called when a token document is updated (e.g. elevation change).
   * Re-renders the HUD if the affected token is the active one.
   * @param {TokenDocument} tokenDoc
   * @param {object} changes
   */
  onTokenUpdate(tokenDoc, changes) {
    if (!this.rendered || !this.#activeToken) return;
    if (this.#activeToken.document?.id !== tokenDoc.id) return;
    if ("elevation" in changes) {
      clearTimeout(this._renderDebounce);
      this._renderDebounce = setTimeout(() => this.render(), 50);
    }
  }

  /**
   * Called on refreshToken — update position if our token moved.
   * @param {Token} token
   */
  onTokenRefresh(token) {
    if (this.#activeToken === token && this.rendered) {
      this.#updatePosition();
    }
  }

  /* -------------------------------------------- */
  /*  Show / Hide                                 */
  /* -------------------------------------------- */

  /**
   * Show the HUD for a given token.
   * @param {Token} token
   */
  show(token) {
    const actor = token.actor;
    if (!actor) return;

    // Skip non-combat actor types
    if (actor.type === "merchant" || actor.type === "party") return;

    const isNewToken = this.#activeToken !== token;
    this.#activeToken = token;
    this.#isDeploying = isNewToken;
    // Reset positioning cache so side is re-evaluated for the new token
    if (isNewToken) {
      this.#lastTargetingSourceId = undefined;
      this.#cachedPreferRight = true;
    }
    this.render(true);
  }

  /**
   * Hide the HUD with retract animation.
   */
  hide() {
    this.#stopPositionTracking();
    this.#activeToken = null;

    if (this.#hoverEnterTimeout) {
      clearTimeout(this.#hoverEnterTimeout);
      this.#hoverEnterTimeout = null;
    }
    if (this.#hoverLeaveTimeout) {
      clearTimeout(this.#hoverLeaveTimeout);
      this.#hoverLeaveTimeout = null;
    }

    if (this.rendered) {
      // Animate retract then close
      const panel = this.element?.querySelector(".thud__panel");
      if (panel) {
        panel.classList.add("thud__panel--retracting");
        panel.addEventListener("animationend", () => {
          this.close();
        }, { once: true });
        // Fallback: close after animation duration
        setTimeout(() => {
          if (this.rendered) this.close();
        }, 250);
      } else {
        this.close();
      }
    }
  }

  /* -------------------------------------------- */
  /*  Positioning                                 */
  /* -------------------------------------------- */

  /**
   * Convert token canvas coordinates to screen coordinates.
   * @param {Token} token
   * @returns {{ screenX: number, screenY: number, screenW: number, screenH: number }}
   */
  #getScreenPosition(token) {
    const { x, y, width, height } = token.document;
    const gridSize = canvas.grid.size;
    const tokenWorldW = width * gridSize;
    const tokenWorldH = height * gridSize;

    // canvas.stage.worldTransform maps world coords → screen coords
    const wt = canvas.stage.worldTransform;
    const screenX = (x * wt.a) + wt.tx;
    const screenY = (y * wt.d) + wt.ty;
    const screenW = tokenWorldW * wt.a;
    const screenH = tokenWorldH * wt.d;

    return { screenX, screenY, screenW, screenH };
  }

  /**
   * Update element position to track the active token. Called every frame via RAF.
   */
  #updatePosition() {
    if (!this.#activeToken || !this.rendered || !this.element) {
      this.#stopPositionTracking();
      return;
    }

    const { screenX, screenY, screenW, screenH } = this.#getScreenPosition(this.#activeToken);
    const el = this.element;
    const hudW = el.offsetWidth || 200;
    const hudH = el.offsetHeight || 100;
    const gap = 10;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Determine preferred side — avoid the targeting line direction.
    // Only recalculate when the targeting source changes to prevent RAF oscillation.
    const sourceId = getTargetingSourceTokenId() ?? null;
    if (sourceId !== this.#lastTargetingSourceId) {
      this.#lastTargetingSourceId = sourceId;
      if (sourceId) {
        const sourceToken = canvas.tokens?.get(sourceId);
        if (sourceToken) {
          const srcPos = this.#getScreenPosition(sourceToken);
          const srcCenterX = srcPos.screenX + srcPos.screenW / 2;
          const tgtCenterX = screenX + screenW / 2;
          // If source is to the right → line comes from right → put HUD on left
          // If source is to the left → line comes from left → put HUD on right
          this.#cachedPreferRight = srcCenterX < tgtCenterX;
        } else {
          this.#cachedPreferRight = true;
        }
      } else {
        this.#cachedPreferRight = true;
      }
    }

    let left;
    if (this.#cachedPreferRight) {
      left = screenX + screenW + gap;
      // Flip to left side if overflows right
      if (left + hudW > vw - 10) {
        left = screenX - hudW - gap;
      }
    } else {
      left = screenX - hudW - gap;
      // Flip to right side if overflows left
      if (left < 10) {
        left = screenX + screenW + gap;
      }
    }

    let top = screenY;

    // Push down if overflows top
    if (top < 10) {
      top = 10;
    }
    // Push up if overflows bottom
    if (top + hudH > vh - 10) {
      top = vh - hudH - 10;
    }
    // Final clamps
    left = Math.max(10, Math.min(left, vw - hudW - 10));
    top = Math.max(10, Math.min(top, vh - hudH - 10));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;

    // Continue tracking
    this.#positionRAF = requestAnimationFrame(() => this.#updatePosition());
  }

  #startPositionTracking() {
    this.#stopPositionTracking();
    this.#positionRAF = requestAnimationFrame(() => this.#updatePosition());
  }

  #stopPositionTracking() {
    if (this.#positionRAF != null) {
      cancelAnimationFrame(this.#positionRAF);
      this.#positionRAF = null;
    }
  }

  /* -------------------------------------------- */
  /*  Visibility Tiers                            */
  /* -------------------------------------------- */

  /**
   * Determine what level of detail to show for this token.
   * @param {Token} token
   * @returns {"full"|"friendly"|"basic"|"name-only"|"none"}
   */
  #determineVisibility(token) {
    const actor = token.actor;
    if (!actor) return "none";
    if (actor.type === "merchant" || actor.type === "party") return "none";

    // GM always sees full
    if (game.user.isGM) return "full";

    // Owned tokens: full info
    if (actor.isOwner) return "full";

    // Determine disposition
    const disposition = token.document.disposition;

    // Friendly unowned: limited
    if (disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) return "friendly";

    // Hostile/Neutral: use enemy HUD reveal tier setting
    try {
      const tier = game.settings.get("shards-of-mana", "enemyHudRevealTier");
      if (tier === "hidden") return "name-only";
      if (tier === "basic") return "basic";
      if (tier === "detailed") return "friendly";
      return "full";
    } catch {
      return "basic";
    }
  }

  /* -------------------------------------------- */
  /*  Data Preparation                            */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const token = this.#activeToken;
    if (!token?.actor) return context;

    const actor = token.actor;
    const sys = actor.system;
    const tier = this.#determineVisibility(token);

    context.actorId = actor.id;
    context.actorType = actor.type;
    context.tier = tier;
    context.name = actor.name;
    context.img = actor.img ?? "icons/svg/mystery-man.svg";

    // Disposition for theming
    const disposition = token.document.disposition;
    if (disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) {
      context.disposition = "friendly";
    } else if (disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE) {
      context.disposition = "hostile";
    } else {
      context.disposition = "neutral";
    }

    // HP / MP (all combat actors have these via BaseActorData)
    const hp = sys.health ?? { value: 0, max: 0 };
    const mp = sys.mana ?? { value: 0, max: 0 };
    const hpPct = hp.max > 0 ? Math.clamp(Math.round((hp.value / hp.max) * 100), 0, 100) : 0;
    const mpPct = mp.max > 0 ? Math.clamp(Math.round((mp.value / mp.max) * 100), 0, 100) : 0;

    context.hp = hp;
    context.mp = mp;
    context.hpPct = hpPct;
    context.mpPct = mpPct;
    context.hpCritical = hpPct <= 25 && hpPct > 0;
    context.hpDanger = hpPct === 0 && hp.max > 0;

    // Show values only for full/friendly tiers
    context.showValues = (tier === "full" || tier === "friendly");
    context.showHp = (tier !== "name-only" && tier !== "none");
    context.showMp = (tier === "full" || tier === "friendly");

    // Level (adventurer only)
    context.level = (actor.type === "adventurer") ? sys.level ?? null : null;

    // Rank (monster)
    context.rank = (actor.type === "monster") ? sys.rank ?? null : null;

    // Active job info (adventurer)
    context.jobName = null;
    context.jobRank = null;
    context.jobImg = null;
    if (actor.type === "adventurer" && sys.activeJobId) {
      const job = actor.items.get(sys.activeJobId);
      if (job) {
        context.jobName = job.name;
        context.jobRank = job.system.rank;
        context.jobImg = job.img ?? null;
      }
    }

    // Active conditions
    context.activeConditions = [];
    if (sys.conditions && (tier === "full" || tier === "friendly")) {
      for (const [key, value] of Object.entries(sys.conditions)) {
        if (value <= 0) continue;
        const effectDef = CONFIG.statusEffects.find(e => e.id === key);
        context.activeConditions.push({
          id: key,
          label: CONFIG.SHARDS.conditions?.[key]
            ? game.i18n.localize(CONFIG.SHARDS.conditions[key])
            : key,
          img: effectDef?.img ?? null,
          magnitude: value
        });
      }
    }

    // Pips (adventurer/monster/npc)
    context.pips = { value: 0, max: 0, dots: [] };
    if (sys.pips && (tier === "full" || tier === "friendly")) {
      const pips = sys.pips;
      const dots = [];
      for (let i = 0; i < pips.max; i++) dots.push(i < pips.value);
      context.pips = { value: pips.value, max: pips.max, dots };
    }

    // Limit Break (adventurer only, full tier)
    context.showLb = false;
    context.lbPct = 0;
    context.lbReady = false;
    if (actor.type === "adventurer" && tier === "full") {
      const lb = sys.limitBreak ?? { value: 0, max: 100 };
      context.lbPct = Math.clamp(lb.value, 0, 100);
      context.lbReady = lb.value >= 100;
      context.showLb = context.lbPct > 0 || context.lbReady;
    }

    // Downed state
    context.isDowned = (sys.conditions?.downed ?? 0) > 0;

    // Elevation
    const elevation = token.document?.elevation ?? 0;
    context.elevation = elevation;
    context.showElevation = elevation !== 0;
    context.elevationDisplay = elevation > 0 ? `\u2191${elevation}` : `\u2193${Math.abs(elevation)}`;
    context.elevationFlying = elevation > 0;

    // Deploying animation flag
    context.deploying = this.#isDeploying;

    // Theme style — for monsters use rank colors, for others use disposition
    let themeVars = "";
    if (actor.type === "monster" && sys.rank) {
      const rc = ShardsEnemyHud.RANK_THEME_COLORS?.[sys.rank];
      if (rc) {
        themeVars = [
          `--thud-accent: ${rc.accent}`,
          `--thud-accent-light: ${rc.accentLight}`,
          `--thud-accent-glow: ${rc.accentGlow}`
        ].join("; ");
      }
    }
    context.themeStyle = themeVars;

    return context;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);
    this.#startPositionTracking();

    // Reset deploy flag after render so subsequent re-renders don't re-animate
    if (this.#isDeploying) {
      this.#isDeploying = false;
    }
  }

  _onClose(options) {
    super._onClose(options);
    this.#stopPositionTracking();
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Click the name to open the actor's sheet.
   */
  static #onOpenSheet(event, target) {
    const actorId = target.dataset.actorId;
    const actor = game.actors.get(actorId);
    if (actor) actor.sheet.render(true);
  }
}
