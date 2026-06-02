const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Persistent floating Party HUD overlay linked to a Party actor.
 * Reads the party roster from the linked party actor's members array,
 * resolving each member's actorUuid to display live HP/MP/conditions.
 * Falls back to auto-detecting player-owned adventurers if no party is linked.
 *
 * Three display modes: expanded (full details), compact (portrait + name + bars),
 * and hidden (toggle button only). Draggable with per-client position persistence.
 */
export class ShardsPartyHud extends HandlebarsApplicationMixin(ApplicationV2) {

  /* -------------------------------------------- */
  /*  Singleton                                   */
  /* -------------------------------------------- */

  static _instance = null;

  static getInstance() {
    if (!ShardsPartyHud._instance) {
      ShardsPartyHud._instance = new ShardsPartyHud();
    }
    return ShardsPartyHud._instance;
  }

  /* -------------------------------------------- */
  /*  Configuration                               */
  /* -------------------------------------------- */

  static DEFAULT_OPTIONS = {
    id: "shards-party-hud",
    classes: ["shards-of-mana", "party-hud"],
    position: { width: "auto", height: "auto" },
    window: {
      frame: false,
      positioned: false,
      minimizable: false,
      resizable: false
    },
    actions: {
      openSheet: ShardsPartyHud.#onOpenSheet,
      cycleMode: ShardsPartyHud.#onCycleMode,
      toggleHud: ShardsPartyHud.#onToggleHud,
      selectParty: ShardsPartyHud.#onSelectParty,
      openPartySheet: ShardsPartyHud.#onOpenPartySheet
    }
  };

  static PARTS = {
    hud: {
      template: "systems/shards-of-mana/templates/apps/party-hud.hbs"
    }
  };

  /* -------------------------------------------- */
  /*  Theme Color Palette (matches sheet themes)  */
  /* -------------------------------------------- */

  /**
   * Per-theme HUD colors synced from adventurer sheet color schemes.
   * Each entry provides bar gradients, glows, labels, and accent colors
   * that get injected as CSS custom properties on each member card.
   */
  static THEME_HUD_COLORS = {
    silver: {
      hp: "linear-gradient(90deg, #5a0a0a 0%, #b82020 15%, #d44040 35%, #e86050 55%, #f09060 75%, #ffcc66 100%)",
      hpBorder: "rgba(180, 40, 40, 0.6)",
      hpGlow: "rgba(212, 64, 64, 0.4)",
      hpLabel: "#ffddcc",
      mp: "linear-gradient(90deg, #0a1a3a 0%, #2050a0 15%, #4080d4 35%, #50a0e8 55%, #60c0f0 75%, #88eeff 100%)",
      mpBorder: "rgba(40, 100, 180, 0.6)",
      mpGlow: "rgba(64, 128, 212, 0.4)",
      mpLabel: "#ccddff",
      accent: "#8a8a9e",
      accentLight: "#b0b0c4",
      accentGlow: "rgba(138, 138, 158, 0.3)",
      lb: "linear-gradient(90deg, rgba(212, 64, 64, 0.8), rgba(224, 165, 38, 0.9) 60%, rgba(255, 220, 100, 1) 100%)",
      lbGlow: "rgba(224, 165, 38, 0.5)"
    },
    crimson: {
      hp: "linear-gradient(90deg, #3a0808 0%, #8b1a1a 12%, #c03020 28%, #e05030 45%, #f07838 62%, #ffaa44 80%, #ffe088 100%)",
      hpBorder: "rgba(200, 50, 30, 0.7)",
      hpGlow: "rgba(230, 80, 40, 0.4)",
      hpLabel: "#ffe0cc",
      mp: "linear-gradient(90deg, #1a0808 0%, #4a1a0a 12%, #803018 28%, #b04820 45%, #d06830 62%, #e8903e 80%, #ffbb66 100%)",
      mpBorder: "rgba(180, 80, 30, 0.6)",
      mpGlow: "rgba(200, 100, 40, 0.35)",
      mpLabel: "#ffd8aa",
      accent: "#9e5555",
      accentLight: "#c47a7a",
      accentGlow: "rgba(158, 85, 85, 0.3)",
      lb: "linear-gradient(90deg, rgba(180, 40, 20, 0.8), rgba(230, 120, 30, 0.9) 50%, rgba(255, 220, 100, 1) 100%)",
      lbGlow: "rgba(230, 120, 30, 0.55)"
    },
    emerald: {
      hp: "linear-gradient(90deg, #0a2a0a 0%, #1a5a20 12%, #2a8030 28%, #40a840 45%, #60c850 62%, #88e068 80%, #bbff88 100%)",
      hpBorder: "rgba(60, 160, 60, 0.6)",
      hpGlow: "rgba(80, 200, 80, 0.35)",
      hpLabel: "#ccffcc",
      mp: "linear-gradient(90deg, #081a18 0%, #104838 12%, #187858 28%, #20a078 45%, #30c098 62%, #50d8b0 80%, #88ffdd 100%)",
      mpBorder: "rgba(40, 160, 120, 0.6)",
      mpGlow: "rgba(50, 180, 130, 0.3)",
      mpLabel: "#bbffee",
      accent: "#559e60",
      accentLight: "#7ac488",
      accentGlow: "rgba(85, 158, 96, 0.3)",
      lb: "linear-gradient(90deg, rgba(40, 120, 40, 0.8), rgba(120, 200, 60, 0.9) 50%, rgba(200, 255, 100, 1) 100%)",
      lbGlow: "rgba(120, 200, 60, 0.5)"
    },
    azure: {
      hp: "linear-gradient(90deg, #080a2a 0%, #102060 12%, #184098 28%, #2868c0 45%, #4090e0 62%, #60b8f0 80%, #a0e0ff 100%)",
      hpBorder: "rgba(50, 120, 200, 0.65)",
      hpGlow: "rgba(60, 140, 230, 0.4)",
      hpLabel: "#c8e8ff",
      mp: "linear-gradient(90deg, #0a0a20 0%, #181848 12%, #283880 28%, #3858b0 45%, #5080d8 62%, #70a8f0 80%, #a8d8ff 100%)",
      mpBorder: "rgba(60, 80, 180, 0.6)",
      mpGlow: "rgba(70, 100, 200, 0.35)",
      mpLabel: "#ccd8ff",
      accent: "#5580b8",
      accentLight: "#80aad4",
      accentGlow: "rgba(85, 128, 184, 0.3)",
      lb: "linear-gradient(90deg, rgba(30, 80, 180, 0.8), rgba(60, 150, 230, 0.9) 50%, rgba(160, 230, 255, 1) 100%)",
      lbGlow: "rgba(60, 150, 230, 0.55)"
    },
    violet: {
      hp: "linear-gradient(90deg, #180828 0%, #381060 12%, #582090 28%, #7838b8 45%, #9850d8 62%, #b878f0 80%, #e0b0ff 100%)",
      hpBorder: "rgba(130, 60, 200, 0.6)",
      hpGlow: "rgba(150, 80, 220, 0.4)",
      hpLabel: "#e8ccff",
      mp: "linear-gradient(90deg, #100820 0%, #281050 12%, #481888 28%, #6828b0 45%, #8840d0 62%, #b060e8 80%, #e0a0ff 100%)",
      mpBorder: "rgba(100, 50, 180, 0.6)",
      mpGlow: "rgba(120, 60, 200, 0.35)",
      mpLabel: "#e0ccff",
      accent: "#7858b8",
      accentLight: "#a080d4",
      accentGlow: "rgba(120, 88, 184, 0.3)",
      lb: "linear-gradient(90deg, rgba(100, 40, 180, 0.8), rgba(170, 100, 240, 0.9) 50%, rgba(230, 180, 255, 1) 100%)",
      lbGlow: "rgba(170, 100, 240, 0.55)"
    },
    gold: {
      hp: "linear-gradient(90deg, #281808 0%, #604020 12%, #987030 28%, #c09838 45%, #d8b840 62%, #e8d048 80%, #fff088 100%)",
      hpBorder: "rgba(200, 160, 50, 0.65)",
      hpGlow: "rgba(220, 180, 60, 0.4)",
      hpLabel: "#fff0cc",
      mp: "linear-gradient(90deg, #181008 0%, #403010 12%, #706020 28%, #a08830 45%, #c0a840 62%, #d8c858 80%, #fff0a0 100%)",
      mpBorder: "rgba(180, 140, 40, 0.6)",
      mpGlow: "rgba(200, 160, 50, 0.35)",
      mpLabel: "#ffe8bb",
      accent: "#a08848",
      accentLight: "#c8b070",
      accentGlow: "rgba(160, 136, 72, 0.3)",
      lb: "linear-gradient(90deg, rgba(180, 120, 20, 0.8), rgba(230, 190, 50, 0.9) 50%, rgba(255, 245, 150, 1) 100%)",
      lbGlow: "rgba(230, 190, 50, 0.6)"
    },
    rose: {
      hp: "linear-gradient(90deg, #280818 0%, #601830 12%, #982850 28%, #c04070 45%, #d86090 62%, #e888b0 80%, #ffc0dd 100%)",
      hpBorder: "rgba(200, 70, 120, 0.6)",
      hpGlow: "rgba(220, 90, 140, 0.35)",
      hpLabel: "#ffe0ee",
      mp: "linear-gradient(90deg, #180820 0%, #381050 12%, #582078 28%, #783898 45%, #9858b8 62%, #b880d0 80%, #e0b8f0 100%)",
      mpBorder: "rgba(140, 60, 160, 0.6)",
      mpGlow: "rgba(160, 80, 180, 0.3)",
      mpLabel: "#eeccff",
      accent: "#a85888",
      accentLight: "#d080b0",
      accentGlow: "rgba(168, 88, 136, 0.3)",
      lb: "linear-gradient(90deg, rgba(160, 50, 100, 0.8), rgba(230, 120, 170, 0.9) 50%, rgba(255, 200, 230, 1) 100%)",
      lbGlow: "rgba(230, 120, 170, 0.5)"
    },
    obsidian: {
      hp: "linear-gradient(90deg, #080808 0%, #181820 12%, #282838 28%, #384050 45%, #506070 62%, #708090 80%, #a0b0c0 100%)",
      hpBorder: "rgba(80, 80, 100, 0.5)",
      hpGlow: "rgba(100, 100, 130, 0.25)",
      hpLabel: "#c0c0d0",
      mp: "linear-gradient(90deg, #050508 0%, #101018 12%, #1a1a28 28%, #282840 45%, #383858 62%, #505070 80%, #787898 100%)",
      mpBorder: "rgba(70, 70, 90, 0.5)",
      mpGlow: "rgba(80, 80, 110, 0.25)",
      mpLabel: "#b0b0c8",
      accent: "#444450",
      accentLight: "#606070",
      accentGlow: "rgba(68, 68, 80, 0.3)",
      lb: "linear-gradient(90deg, rgba(50, 50, 70, 0.8), rgba(100, 100, 140, 0.85) 50%, rgba(180, 180, 210, 1) 100%)",
      lbGlow: "rgba(100, 100, 140, 0.4)"
    }
  };

  /* -------------------------------------------- */
  /*  Drag State                                  */
  /* -------------------------------------------- */

  #isDragging = false;
  #dragOffset = { x: 0, y: 0 };
  _renderDebounce = null;

  /* -------------------------------------------- */
  /*  Party Actor Resolution                      */
  /* -------------------------------------------- */

  /**
   * Get the linked party actor.
   * Priority: explicit setting → auto-detect first party actor.
   * @returns {Actor|null}
   */
  _getPartyActor() {
    // 1. Check explicit setting
    const partyId = game.settings.get("shards-of-mana", "partyHudPartyId");
    if (partyId) {
      const party = game.actors.get(partyId);
      if (party?.type === "party") return party;
    }
    // 2. Auto-detect: first party-type actor in the world
    return game.actors.find(a => a.type === "party") ?? null;
  }

  /**
   * Get party members from the linked party actor's roster.
   * Falls back to ownership-based detection if no party actor exists.
   * @returns {Promise<{actor: Actor, role: string}[]>}
   */
  async _getPartyMembers() {
    const partyActor = this._getPartyActor();

    if (partyActor) {
      // Resolve member UUIDs from the party roster
      const results = [];
      for (const member of partyActor.system.members) {
        const linkedActor = await fromUuid(member.actorUuid);
        if (linkedActor) {
          results.push({ actor: linkedActor, role: member.role || "" });
        }
      }
      return results;
    }

    // Fallback: player-owned adventurers (no party actor exists)
    return game.actors
      .filter(a => a.type === "adventurer" && game.users.some(
        u => !u.isGM && u.active && a.testUserPermission(u, "OWNER")
      ))
      .map(actor => ({ actor, role: "" }));
  }

  /* -------------------------------------------- */
  /*  Data Preparation                            */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const mode = game.settings.get("shards-of-mana", "partyHudMode");
    const partyMembers = await this._getPartyMembers();
    const partyActor = this._getPartyActor();

    context.mode = mode;
    context.isHidden = mode === "hidden";
    context.isCompact = mode === "compact";
    context.isExpanded = mode === "expanded";
    context.isGM = game.user.isGM;

    // Party actor info (for header display)
    context.partyName = partyActor?.name ?? null;
    context.partyId = partyActor?.id ?? null;
    context.hasParty = !!partyActor;

    // Available party actors (for GM selection dropdown)
    if (game.user.isGM) {
      context.partyActors = game.actors
        .filter(a => a.type === "party")
        .map(a => ({ id: a.id, name: a.name, selected: a.id === partyActor?.id }));
      context.hasMultipleParties = context.partyActors.length > 1;
    }

    context.members = partyMembers.map(({ actor, role }) => {
      const sys = actor.system;
      const hp = sys.health ?? { value: 0, max: 0 };
      const mp = sys.mana ?? { value: 0, max: 0 };
      const hpPct = hp.max > 0 ? Math.clamp(Math.round((hp.value / hp.max) * 100), 0, 100) : 0;
      const mpPct = mp.max > 0 ? Math.clamp(Math.round((mp.value / mp.max) * 100), 0, 100) : 0;

      // Active job info
      let jobName = null, jobRank = null, jobImg = null;
      if (actor.type === "adventurer") {
        const jobId = sys.activeJobId;
        if (jobId) {
          const job = actor.items.get(jobId);
          if (job) {
            jobName = job.name;
            jobRank = job.system.rank;
            jobImg = job.img ?? null;
          }
        }
      }

      // Active conditions (value > 0)
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

      // Limit break
      const lb = sys.limitBreak ?? { value: 0, max: 100 };
      const lbPct = Math.clamp(lb.value, 0, 100);
      const lbReady = lb.value >= 100;

      // Downed state
      const isDowned = (sys.conditions?.downed ?? 0) > 0;

      // Role info
      const roleDef = role ? CONFIG.SHARDS.partyRoles?.[role] : null;
      const roleLabel = roleDef ? game.i18n.localize(roleDef.label) : "";

      // Theme — sync from adventurer sheet color scheme
      const theme = actor.getFlag("shards-of-mana", "sheetTheme") ?? "silver";
      const t = ShardsPartyHud.THEME_HUD_COLORS[theme] || ShardsPartyHud.THEME_HUD_COLORS.silver;
      const themeStyle = [
        `--phud-hp-gradient: ${t.hp}`,
        `--phud-hp-border: ${t.hpBorder}`,
        `--phud-hp-glow: ${t.hpGlow}`,
        `--phud-hp-label: ${t.hpLabel}`,
        `--phud-mp-gradient: ${t.mp}`,
        `--phud-mp-border: ${t.mpBorder}`,
        `--phud-mp-glow: ${t.mpGlow}`,
        `--phud-mp-label: ${t.mpLabel}`,
        `--phud-accent: ${t.accent}`,
        `--phud-accent-light: ${t.accentLight}`,
        `--phud-accent-glow: ${t.accentGlow}`,
        `--phud-lb-gradient: ${t.lb}`,
        `--phud-lb-glow: ${t.lbGlow}`
      ].join("; ");

      return {
        actorId: actor.id,
        name: actor.name,
        img: actor.img ?? "icons/svg/mystery-man.svg",
        level: sys.level ?? null,
        jobName,
        jobRank,
        jobImg,
        hp, mp,
        hpPct, mpPct,
        pips: { value: pips.value, max: pips.max, dots: pipDots },
        activeConditions,
        lbPct, lbReady,
        isDowned,
        role,
        roleLabel,
        theme,
        themeStyle
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

    // Party selection change handler (GM only)
    const select = this.element.querySelector(".party-hud__party-select");
    if (select) {
      select.addEventListener("change", (e) => {
        game.settings.set("shards-of-mana", "partyHudPartyId", e.target.value);
        this.render();
      });
    }
  }

  /**
   * Apply saved position to the element. Called after every render.
   * Uses the persistent client setting directly — no caching needed
   * since positioned: false means Foundry never touches our position.
   */
  #applyPosition() {
    const pos = game.settings.get("shards-of-mana", "partyHudPosition");
    if (pos?.left != null && pos?.top != null) {
      this.element.style.left = `${pos.left}px`;
      this.element.style.top = `${pos.top}px`;
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
    };

    const onUp = () => {
      if (!this.#isDragging) return;
      this.#isDragging = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);

      // Persist position to setting
      const finalRect = this.element.getBoundingClientRect();
      game.settings.set("shards-of-mana", "partyHudPosition", {
        left: Math.round(finalRect.left),
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
   * Debounced re-render when a relevant actor changes.
   * Reacts to adventurer updates (member data) and party updates (roster changes).
   * @param {Actor} actor
   */
  refreshIfRelevant(actor) {
    if (!this.rendered) return;
    // Always refresh on party actor updates (roster changed)
    if (actor.type === "party") {
      clearTimeout(this._renderDebounce);
      this._renderDebounce = setTimeout(() => this.render(), 50);
      return;
    }
    // For adventurers, refresh if they might be in the roster
    if (actor.type === "adventurer") {
      clearTimeout(this._renderDebounce);
      this._renderDebounce = setTimeout(() => this.render(), 50);
    }
  }

  /* -------------------------------------------- */
  /*  Action Handlers                             */
  /* -------------------------------------------- */

  /**
   * Click portrait: open sheet. Shift-click: pan to token.
   */
  static #onOpenSheet(event, target) {
    const actorId = target.dataset.actorId;
    const actor = game.actors.get(actorId);
    if (!actor) return;

    if (event.shiftKey) {
      const token = canvas.tokens?.placeables.find(t => t.actor?.id === actorId);
      if (token) {
        token.control({ releaseOthers: true });
        canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 500 });
      } else {
        ui.notifications.warn(game.i18n.localize("SHARDS.PartyHud.NoTokenOnScene"));
      }
    } else {
      actor.sheet.render(true);
    }
  }

  /**
   * Toggle between expanded and compact only.
   * The hide button handles hiding separately.
   */
  static #onCycleMode() {
    const current = game.settings.get("shards-of-mana", "partyHudMode");
    const next = current === "expanded" ? "compact" : "expanded";
    game.settings.set("shards-of-mana", "partyHudMode", next);
    this.render();
  }

  /**
   * Toggle between hidden and the last non-hidden mode (defaults to compact).
   */
  static #onToggleHud() {
    const current = game.settings.get("shards-of-mana", "partyHudMode");
    const next = current === "hidden" ? "compact" : "hidden";
    game.settings.set("shards-of-mana", "partyHudMode", next);
    this.render();
  }

  /**
   * GM selects a party actor from the dropdown.
   */
  static #onSelectParty(event, target) {
    const partyId = target.value;
    game.settings.set("shards-of-mana", "partyHudPartyId", partyId);
    this.render();
  }

  /**
   * Open the linked party actor's sheet.
   */
  static #onOpenPartySheet() {
    const partyActor = this._getPartyActor();
    if (partyActor) partyActor.sheet.render(true);
  }
}
