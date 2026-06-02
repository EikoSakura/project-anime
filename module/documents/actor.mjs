import { rollStatTest as _rollStatTest } from "../helpers/rolls.mjs";
import { resolveFormulaValue } from "../helpers/formulas.mjs";
import { processItemChoiceSets, cleanupChoiceSetEffects, hasChoiceSets } from "../helpers/choice-sets.mjs";
import { applyItemGrants, cleanupItemGrants, hasItemGrants } from "../helpers/item-grants.mjs";

/**
 * Custom Actor document class for Shards of Mana.
 */
export class ShardsActor extends Actor {

  /** @override */
  prepareData() {
    super.prepareData();
  }

  /** @override */
  prepareBaseData() {
    super.prepareBaseData();
  }

  /**
   * Set default prototype token options for new actors.
   * Adventurers, NPCs, and Merchants link actor data by default.
   * @override
   */
  async _preCreate(data, options, userId) {
    await super._preCreate(data, options, userId);
    const linkTypes = new Set(["adventurer", "npc", "merchant", "party"]);
    const tokenDefaults = {};

    if (linkTypes.has(this.type)) {
      tokenDefaults["prototypeToken.actorLink"] = true;
    }

    // Lock artwork rotation so token art stays upright
    tokenDefaults["prototypeToken.lockRotation"] = true;

    // Auto-configure token resource bars for combat-capable actors
    const combatTypes = new Set(["adventurer", "monster", "npc"]);
    if (combatTypes.has(this.type)) {
      tokenDefaults["prototypeToken.bar1.attribute"] = "health";
      tokenDefaults["prototypeToken.bar2.attribute"] = "mana";
      tokenDefaults["prototypeToken.displayBars"] = CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER;
      tokenDefaults["prototypeToken.displayName"] = CONST.TOKEN_DISPLAY_MODES.ALWAYS;
    }

    if (Object.keys(tokenDefaults).length) {
      this.updateSource(tokenDefaults);
    }
  }

  /**
   * After actor creation, generate initial Mana Grid for adventurers.
   * @override
   */
  _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    if (this.type !== "adventurer" || game.user.id !== userId) return;

    // Guard: skip if grid already has sockets (import/copy safety)
    if (this.system.grid?.sockets?.length) return;

    // Defer to avoid mid-creation conflicts — generate initial Mana Grid
    setTimeout(async () => {
      const { generateInitialGrid } = await import("../data/grid-schema.mjs");
      const grid = generateInitialGrid(this.system.level ?? 1);
      await this.update({ "system.grid": grid });
    }, 0);
  }

  /**
   * Override applyActiveEffects to:
   * 1. Pre-process formula strings in AE change values (e.g. "5 * RANK" → "5")
   * 2. Collect derived stat bonuses for post-derivation application
   * @override
   */
  applyActiveEffects() {
    // Pre-process: resolve formula strings and intercept percentage values
    // before Foundry core processes them (core just does Number(change.value)).
    // This mutation is transient — prepareData() re-reads from source each cycle.
    this._aePercentBonuses = {};
    for (const effect of this.allApplicableEffects()) {
      if (!effect.active) continue;
      for (const change of effect.changes) {
        const val = change.value;
        if (typeof val !== "string" || !val.trim()) continue;

        // Intercept percentage values (e.g. "5%") — collect and neutralize
        // so Foundry core applies +0 instead of NaN.
        if (val.endsWith("%")) {
          const pct = Number(val.slice(0, -1));
          if (!isNaN(pct)) {
            this._aePercentBonuses[change.key] =
              (this._aePercentBonuses[change.key] ?? 0) + pct;
            change.value = "0";
            continue;
          }
        }

        // Skip if already a plain number (fast path — avoids context build)
        if (!isNaN(Number(val))) continue;
        // Skip boolean strings — these are flag toggles, not formulas
        if (val === "true" || val === "false") continue;
        // Resolve formula to a number string
        change.value = String(resolveFormulaValue(val, this));
      }
    }

    super.applyActiveEffects();

    // Only actors with derived stats (not merchant)
    if (!this.system.derived) return;

    // Collect derived stat bonuses from active effects for post-derivation
    // application.  Derived stats are computed from base stats in prepareDerivedData,
    // so AE bonuses for derived stats must be re-applied after that computation.
    // Element/condition resistances use a simpler additive approach — Foundry core
    // applies AE changes (from equipment, manacite, etc.) directly.
    this._aeDerivedBonuses = {};
    for (const effect of this.allApplicableEffects()) {
      if (!effect.active) continue;
      for (const change of effect.changes) {
        if (change.key.startsWith("system.derived.")) {
          const derivedKey = change.key.replace("system.derived.", "");
          this._aeDerivedBonuses[derivedKey] =
            (this._aeDerivedBonuses[derivedKey] ?? 0) + Number(change.value);
        }
      }
    }
  }

  /**
   * Override allApplicableEffects to filter out conditional and non-passive
   * skill effects that should only apply explicitly during rolls.
   * @override
   */
  *allApplicableEffects() {
    for (const effect of super.allApplicableEffects()) {
      // Skip conditional effects — they only apply when toggled in pre-roll dialogs
      // Exception: effects with _conditionalActive are temporarily activated by the dialog
      if (effect.flags?.["shards-of-mana"]?.conditional && !effect._conditionalActive) continue;

      // Non-passive skill effects should not passively transfer — they are applied
      // explicitly by roll functions (rollBuff, rollAttack, etc.).  Without this guard,
      // a buff skill's embedded AE would double-apply: once via Foundry's transfer
      // system and once via the copy created by rollBuff().
      if (effect.transfer && effect.parent?.type === "skill"
        && effect.parent?.system?.timing !== "passive") continue;

      yield effect;
    }
  }

  /** @override */
  prepareDerivedData() {
    // BaseActorData.prepareDerivedData() computes stat.total and derived stats from AE-modified bonuses
    super.prepareDerivedData();

    const system = this.system;

    // Merchant/Party have no stats/combat — skip everything below
    if (this.type === "merchant" || this.type === "party") {
      this._syncTokenSize();
      return;
    }

    // --- Equipment stat bonus aggregation ---
    // Loop equipped items and sum their statBonuses into stats.*.bonus
    for (const item of this.items) {
      if (item.type !== "equipment") continue;
      if (!item.system.equipped) continue;
      const bonuses = item.system.statBonuses;
      if (!bonuses) continue;
      for (const key of Object.keys(system.stats)) {
        if (bonuses[key]) system.stats[key].bonus += bonuses[key];
      }
    }

    // Recompute stat totals with equipment bonuses included
    for (const key of Object.keys(system.stats)) {
      system.stats[key].total = system.statTotal(key);
    }

    // Apply percentage-based stat bonuses (e.g. "+5% STR")
    const aePerc = this._aePercentBonuses ?? {};
    let statPctApplied = false;
    for (const key of Object.keys(system.stats)) {
      const pct = aePerc[`system.stats.${key}.bonus`];
      if (pct) {
        const total = system.statTotal(key);
        system.stats[key].bonus += Math.floor(total * pct / 100);
        statPctApplied = true;
      }
    }
    if (statPctApplied) {
      for (const key of Object.keys(system.stats)) {
        system.stats[key].total = system.statTotal(key);
      }
    }

    // Recompute derived stats from final stat totals (simplified: 5 stats)
    const agi = system.statTotal("agi");
    const vit = system.statTotal("vit");
    const spi = system.statTotal("spi");
    const per = system.statTotal("per");
    const lck = system.statTotal("lck");

    system.derived.acc = per;
    system.derived.eva = agi + Math.floor(lck / 4);
    system.derived.pDef = vit;
    system.derived.mDef = spi;
    system.derived.crit = Math.floor(lck / 2) + Math.floor(per / 4);

    // Apply percentage-based derived stat bonuses (e.g. "+5% P.Eva")
    for (const key of Object.keys(system.derived)) {
      const pct = aePerc[`system.derived.${key}`];
      if (pct) {
        system.derived[key] += Math.floor(system.derived[key] * pct / 100);
      }
    }

    // Apply oversized weapon penalties if STR requirement is not met.
    this._oversizedPenalties = [];
    for (const item of this.items) {
      if (item.type !== "equipment") continue;
      if (!item.system.equipped) continue;
      const slot = item.system.slot;
      if (slot !== "weapon" && slot !== "offhand") continue;

      // Oversized weapon penalty: apply if STR requirement not met
      if (item.system.handedness === "oversized" && item.system.strRequirement > 0) {
        const strTotal = system.stats.str.total ?? system.statTotal("str");
        if (strTotal < item.system.strRequirement) {
          const penalties = item.system.oversizedPenalties;
          system.derived.acc += penalties.acc ?? 0;
          system.derived.eva += penalties.eva ?? 0;
          this._oversizedPenalties.push({
            itemId: item._id,
            name: item.name,
            strRequired: item.system.strRequirement,
            strActual: strTotal,
            penalties
          });
        }
      }
    }

    // Apply AE-sourced derived stat bonuses (collected in applyActiveEffects)
    for (const [key, bonus] of Object.entries(this._aeDerivedBonuses ?? {})) {
      if (key in system.derived) {
        system.derived[key] += bonus;
      }
    }

    // Apply percentage-based MOV bonus (before root/downed override)
    const movPct = aePerc["system.mov"];
    if (movPct) {
      system.mov += Math.floor(system.mov * movPct / 100);
    }

    // Root and Downed override MOV to 0
    if (system.conditions.root > 0 || system.conditions.downed > 0) {
      system.mov = 0;
    }

    // Adventurer: derive HP/MP max and pip max from active job
    if (this.type === "adventurer" && system.activeJobId) {
      const activeJob = this.items.get(system.activeJobId);
      if (activeJob) {
        system.deriveHpMp(activeJob);

        // Apply percentage-based HP/MP max bonuses
        const hpPct = aePerc["system.health.max"];
        if (hpPct) system.health.max += Math.floor(system.health.max * hpPct / 100);
        const mpPct = aePerc["system.mana.max"];
        if (mpPct) system.mana.max += Math.floor(system.mana.max * mpPct / 100);

        // Pip max scales with adventurer rank (F:2, E:2, D:3, C:3, B:4, A:4, S:5)
        system.pips.max = CONFIG.SHARDS.pipsByRank[system.adventurerRank] ?? 2;
        system.pips.value = Math.clamp(system.pips.value, 0, system.pips.max);
      }
    }

    // Adventurer: derive lineage display, size, and movement modes from the
    // single embedded lineage item. Lineage provides body, not power — no
    // resistances or condition immunities come from lineage.
    if (this.type === "adventurer") {
      const lineageItem = [...this.items].find(i => i.type === "lineage");

      // Auto-derive lineage display name
      system.lineage = lineageItem?.name ?? "";

      // --- Size from lineage ---
      if (lineageItem) {
        system.size = lineageItem.system.size ?? 1;
      }

      // --- Movement modes from lineage ---
      if (lineageItem) {
        for (const [mode, granted] of Object.entries(lineageItem.system.movementModes)) {
          if (granted && system.movementModes[mode] != null) {
            system.movementModes[mode] = Math.max(system.movementModes[mode], 1);
          }
        }
      }

      // Re-apply non-lineage size AEs on top (equipment, buffs, etc.)
      const sizeChanges = [];
      for (const effect of this.allApplicableEffects()) {
        if (!effect.active) continue;
        const parent = effect.parent;
        // Skip lineage item AEs for size — lineage size is set directly above
        if (parent?.type === "lineage") continue;
        for (const change of effect.changes) {
          if (change.key === "system.size") sizeChanges.push(change);
        }
      }
      sizeChanges.sort((a, b) => (a.priority ?? a.mode * 10) - (b.priority ?? b.mode * 10));
      for (const change of sizeChanges) {
        const val = Number(change.value);
        if (isNaN(val)) continue;
        switch (change.mode) {
          case CONST.ACTIVE_EFFECT_MODES.ADD: system.size += val; break;
          case CONST.ACTIVE_EFFECT_MODES.OVERRIDE: system.size = val; break;
          case CONST.ACTIVE_EFFECT_MODES.MULTIPLY: system.size *= val; break;
          case CONST.ACTIVE_EFFECT_MODES.UPGRADE: system.size = Math.max(system.size, val); break;
          case CONST.ACTIVE_EFFECT_MODES.DOWNGRADE: system.size = Math.min(system.size, val); break;
        }
      }
    }

    // Round and clamp size for all actor types that have the field.
    // 0.5 is the only valid non-integer size; everything else floors to a whole number.
    if (system.size != null) {
      if (system.size !== 0.5) {
        system.size = Math.floor(system.size);
      }
      system.size = Math.max(0.5, system.size);
    }

    // Sync token dimensions to match effective size (handles AE-driven changes)
    this._syncTokenSize();

    // Sync Critical HP effects: auto-enable/disable based on HP threshold
    this._syncCriticalHpEffects();
  }

  /**
   * Inject prototype token dimensions into the same update when system.size changes
   * via a direct actor update (not AE).
   * @override
   */
  async _preUpdate(changed, options, userId) {
    await super._preUpdate(changed, options, userId);
    if (foundry.utils.hasProperty(changed, "system.size")) {
      let newSize = Number(foundry.utils.getProperty(changed, "system.size"));
      // Apply rounding: 0.5 is preserved, everything else floors to integer
      if (newSize !== 0.5) newSize = Math.floor(newSize);
      newSize = Math.max(0.5, newSize);
      foundry.utils.setProperty(changed, "system.size", newSize);
      changed.prototypeToken ??= {};
      changed.prototypeToken.width = newSize;
      changed.prototypeToken.height = newSize;
    }
  }

  /**
   * Sync token dimensions to match the effective system.size.
   * Called at the end of prepareDerivedData (after AEs are applied) so it
   * catches both direct edits AND Active-Effect-driven size changes.
   * Uses a deferred update to avoid modifying documents mid-preparation.
   */
  _syncTokenSize() {
    if (!game.ready) return;
    const size = this.system.size;
    if (size == null) return;

    // Guard: prevent re-entrant syncs from triggering infinite update loops
    if (this._tokenSizeSyncPending) return;

    // Sync prototype token if out of date
    const pt = this.prototypeToken;
    const ptNeedsSync = pt && (pt.width !== size || pt.height !== size);

    // Sync placed tokens on active scenes (GM only — permissions required)
    const tokenUpdates = [];
    if (game.user?.isGM) {
      for (const token of this.getActiveTokens()) {
        if (token.document.width !== size || token.document.height !== size) {
          tokenUpdates.push(token.document);
        }
      }
    }

    if (!ptNeedsSync && tokenUpdates.length === 0) return;

    this._tokenSizeSyncPending = true;
    setTimeout(async () => {
      try {
        if (ptNeedsSync) {
          await this.update({
            "prototypeToken.width": size,
            "prototypeToken.height": size
          }, { render: false });
        }
        for (const tokenDoc of tokenUpdates) {
          await tokenDoc.update({ width: size, height: size });
        }
      } finally {
        this._tokenSizeSyncPending = false;
      }
    }, 0);
  }

  /**
   * Sync Critical HP effects: enable when HP < 25%, disable when HP >= 25%.
   * Uses a deferred update to avoid modifying documents mid-preparation.
   * Only applies to adventurers with the criticalHp flag on effects.
   */
  _syncCriticalHpEffects() {
    if (!game.ready) return;
    if (this.type !== "adventurer") return;
    if (this._criticalHpSyncPending) return;

    const system = this.system;
    if (!system.health || system.health.max <= 0) return;

    const ratio = system.health.value / system.health.max;
    const isCritical = ratio > 0 && ratio < 0.25;

    const updates = [];
    for (const effect of this.effects) {
      if (!effect.flags?.["shards-of-mana"]?.criticalHp) continue;
      // If critical: enable (disabled=false). If not critical: disable (disabled=true).
      const shouldBeDisabled = !isCritical;
      if (effect.disabled !== shouldBeDisabled) {
        updates.push({ _id: effect.id, disabled: shouldBeDisabled });
      }
    }

    if (!updates.length) return;

    this._criticalHpSyncPending = true;
    setTimeout(async () => {
      try {
        await this.updateEmbeddedDocuments("ActiveEffect", updates, { render: false });
      } finally {
        this._criticalHpSyncPending = false;
      }
    }, 0);
  }

  /**
   * Roll a d100 stat test. Delegates to the centralized roll engine.
   * @param {string} statKey - The stat key (str, agi, etc.)
   * @param {object} [options={}]
   * @param {number} [options.modifier=0] - Difficulty modifier
   * @returns {Promise<{roll: Roll, target: number, outcome: string}>}
   */
  async rollStatTest(statKey, { modifier = 0 } = {}) {
    return _rollStatTest(this, statKey, { modifier });
  }

  /* -------------------------------------------- */
  /*  Lineage Grant Automation                      */
  /* -------------------------------------------- */

  /**
   * When a lineage item is added to an adventurer, auto-create granted items.
   * When removed, auto-delete granted items that came from that lineage.
   * @override
   */
  _onCreateDescendantDocuments(parent, collection, documents, data, options, userId) {
    super._onCreateDescendantDocuments(parent, collection, documents, data, options, userId);
    if (collection !== "items") return;

    for (const doc of documents) {
      if (doc.type === "lineage" && this.type === "adventurer") {
        // Defer to avoid mid-creation conflicts
        setTimeout(() => this._applyLineageGrants(doc), 0);
      }

      const hasChoices = hasChoiceSets(doc);
      const hasGrants = hasItemGrants(doc);

      if (hasChoices && hasGrants) {
        // Both: sequence choices first so grants can propagate choice results.
        // After processItemChoiceSets stores choiceResults via setFlag, the original
        // doc reference may be stale — re-fetch from actor to get updated flags.
        const actor = this;
        const docId = doc.id;
        setTimeout(async () => {
          await processItemChoiceSets(actor, doc);
          const freshDoc = actor.items.get(docId) ?? doc;
          await applyItemGrants(actor, freshDoc);
        }, 50);
      } else if (hasChoices) {
        setTimeout(() => processItemChoiceSets(this, doc), 50);
      } else if (hasGrants) {
        setTimeout(() => applyItemGrants(this, doc), 50);
      }
    }
  }

  /** @override */
  _onDeleteDescendantDocuments(parent, collection, documents, data, options, userId) {
    super._onDeleteDescendantDocuments(parent, collection, documents, data, options, userId);
    if (collection !== "items") return;

    for (const doc of documents) {
      if (doc.type === "lineage" && this.type === "adventurer") {
        // Lineages are templates — cleanup is handled passively in prepareDerivedData
        setTimeout(() => this._cleanupLineageGrants(doc._id), 0);
      } else if (doc.type === "job" && this.type === "adventurer") {
        setTimeout(() => this._cleanupJobRemoval(doc._id), 0);
      }

      // Choice Set AE cleanup — any item type on any actor type
      setTimeout(() => cleanupChoiceSetEffects(this, doc._id), 0);

      // Item Grant cleanup — any item type on any actor type
      setTimeout(() => cleanupItemGrants(this, doc._id), 0);
    }
  }

  /**
   * Handle lineage addition to an adventurer.
   * Lineages are body templates — size and movement modes are applied
   * passively in prepareDerivedData(). No item grants needed.
   * @param {Item} lineageItem - The embedded lineage item
   */
  async _applyLineageGrants(lineageItem) {
    // Lineages are body templates. Size and movement modes are applied
    // in prepareDerivedData(). Nothing to create here.
    ui.notifications.info(game.i18n.format("SHARDS.Lineage.Applied", {
      name: lineageItem.name
    }));
  }

  /**
   * Clean up when a lineage is removed from an adventurer.
   * Lineages are body templates — size and movement modes are derived
   * passively in prepareDerivedData(), so removal just needs a re-render.
   * @param {string} removedLineageId - The ID of the lineage item that was removed
   */
  async _cleanupLineageGrants(removedLineageId) {
    // Lineages are body templates. Size and movement modes are removed
    // automatically when prepareDerivedData() runs without the lineage
    // item present. No manual cleanup needed.
  }

  /**
   * Clean up when a job item is removed from the adventurer.
   * Unsockets from the Mana Grid (cascading to children) and syncs activeJobId.
   * @param {string} removedJobId - The ID of the job item that was removed
   */
  async _cleanupJobRemoval(removedJobId) {
    // Unsocket from grid if the job was socketed
    const grid = this.system.grid;
    const jobSocket = grid?.sockets?.find(s => s.type === "job" && s.itemId === removedJobId);
    if (jobSocket) {
      await this.unsocketFromGrid(jobSocket.id);
    }

    // Sync activeJobId if it referenced the deleted job (belt and suspenders)
    if (this.system.activeJobId === removedJobId) {
      const firstJob = this.system.grid?.sockets?.find(s => s.type === "job" && s.itemId);
      await this.update({ "system.activeJobId": firstJob?.itemId ?? "" });
    }
  }

  /* -------------------------------------------- */
  /*  Mana Grid Socketing                           */
  /* -------------------------------------------- */

  /**
   * Socket an item into a Mana Grid socket.
   * Validates socket type, item type, and school affinity.
   * @param {string} socketId - The grid socket ID to socket into
   * @param {string} itemId - The item ID (Job or Manacite) to socket
   */
  async socketToGrid(socketId, itemId) {
    if (this.type !== "adventurer") return;

    const grid = foundry.utils.deepClone(this.system.grid);
    const socket = grid.sockets.find(s => s.id === socketId);
    if (!socket) {
      ui.notifications.warn("Invalid socket.");
      return;
    }
    if (socket.itemId) {
      ui.notifications.warn("Socket is already occupied. Unsocket first.");
      return;
    }

    const item = this.items.get(itemId);
    if (!item) {
      ui.notifications.warn("Item not found.");
      return;
    }

    // Validate item type matches socket type
    if (socket.type === "job" && item.type !== "job") {
      ui.notifications.warn("Only Jobs can be placed in job sockets.");
      return;
    }
    if ((socket.type === "skill" || socket.type === "free") && item.type !== "manacite") {
      ui.notifications.warn("Only Manacite can be placed in skill/free sockets.");
      return;
    }

    // Validate school affinity for skill sockets
    if (socket.type === "skill") {
      const parentJobSocket = grid.sockets.find(s => s.id === socket.parentJobSocketId);
      if (parentJobSocket?.itemId) {
        const parentJob = this.items.get(parentJobSocket.itemId);
        const jobSchool = parentJob?.system?.school ?? "general";
        const manaciteSchool = item.system.school ?? "general";
        if (manaciteSchool !== "general" && jobSchool !== "general" && manaciteSchool !== jobSchool) {
          const jobSchoolLabel = game.i18n.localize(CONFIG.SHARDS.schools[jobSchool]?.label ?? jobSchool);
          const manaciteSchoolLabel = game.i18n.localize(CONFIG.SHARDS.schools[manaciteSchool]?.label ?? manaciteSchool);
          ui.notifications.warn(`School mismatch: ${manaciteSchoolLabel} manacite cannot go in a ${jobSchoolLabel} job's socket.`);
          return;
        }
      }
    }

    // Mark socket as occupied
    socket.itemId = itemId;

    // Mark item as socketed
    const itemUpdate = { _id: itemId, "system.socketed": true };
    if (item.type === "manacite") {
      itemUpdate["system.socketId"] = socketId;
    }

    // Build update object — sync activeJobId if a job was socketed
    const actorUpdate = { "system.grid": grid };
    if (item.type === "job") {
      // First socketed job becomes the primary (activeJobId)
      const firstJobSocket = grid.sockets.find(s => s.type === "job" && s.itemId);
      actorUpdate["system.activeJobId"] = firstJobSocket?.itemId ?? "";
    }

    await this.update(actorUpdate);
    await this.updateEmbeddedDocuments("Item", [itemUpdate]);

    // If job was socketed, expand grid to add branch skill sockets
    if (item.type === "job") {
      await this.recalculateGrid();
    }
  }

  /**
   * Unsocket an item from a Mana Grid socket.
   * If unsocketing a Job, unsockets all children first.
   * @param {string} socketId - The grid socket ID to unsocket
   */
  async unsocketFromGrid(socketId) {
    if (this.type !== "adventurer") return;

    const grid = foundry.utils.deepClone(this.system.grid);
    const socket = grid.sockets.find(s => s.id === socketId);
    if (!socket || !socket.itemId) return;

    const item = this.items.get(socket.itemId);
    const itemUpdates = [];

    // If unsocketing a job, unsocket all child skill sockets first
    if (socket.type === "job") {
      const childSockets = grid.sockets.filter(s => s.type === "skill" && s.parentJobSocketId === socketId);
      for (const child of childSockets) {
        if (child.itemId) {
          const childItem = this.items.get(child.itemId);
          if (childItem) {
            itemUpdates.push({
              _id: childItem.id,
              "system.socketed": false,
              "system.socketId": ""
            });
          }
          child.itemId = "";
        }
      }
      // Remove branch skill sockets from grid (they'll be re-added by recalculateGrid if job is re-socketed)
      grid.sockets = grid.sockets.filter(s => !(s.type === "skill" && s.parentJobSocketId === socketId));
    }

    // Mark the socket as empty
    socket.itemId = "";

    // Mark the item as unsocketed
    if (item) {
      const update = { _id: item.id, "system.socketed": false };
      if (item.type === "manacite") update["system.socketId"] = "";
      itemUpdates.push(update);
    }

    // Build update — sync activeJobId if a job was unsocketed
    const actorUpdate = { "system.grid": grid };
    if (socket.type === "job") {
      const firstJobSocket = grid.sockets.find(s => s.type === "job" && s.itemId);
      actorUpdate["system.activeJobId"] = firstJobSocket?.itemId ?? "";
    }

    await this.update(actorUpdate);
    if (itemUpdates.length) {
      await this.updateEmbeddedDocuments("Item", itemUpdates);
    }
  }

  /**
   * Recalculate the grid — ensure correct number of sockets based on level and job ranks.
   * Called after level-up, job rank-up, or socketing/unsocketing a job.
   */
  async recalculateGrid() {
    if (this.type !== "adventurer") return;

    const { expandGrid } = await import("../data/grid-schema.mjs");
    const level = this.system.level;

    // Build list of socketed jobs with their ranks
    const socketedJobs = [];
    for (const socket of this.system.grid.sockets) {
      if (socket.type === "job" && socket.itemId) {
        const job = this.items.get(socket.itemId);
        if (job) {
          socketedJobs.push({ socketId: socket.id, rank: job.system.rank });
        }
      }
    }

    const expandedGrid = expandGrid(this.system.grid, level, socketedJobs);
    await this.update({ "system.grid": expandedGrid });
  }

  /* -------------------------------------------- */
  /*  XP Siphon (Mana Grid)                        */
  /* -------------------------------------------- */

  /**
   * Distribute bonus XP to all socketed items (manacite and jobs) on this actor.
   * Called when the adventurer gains XP. Does NOT reduce actor XP — siphoned XP is bonus.
   * @param {number} xpAmount - The amount of XP the adventurer earned
   */
  async distributeXpToGrid(xpAmount) {
    if (this.type !== "adventurer" || xpAmount <= 0) return;

    const siphonRate = CONFIG.SHARDS?.manaciteXpSiphonRate ?? 0.10;
    const siphonXp = Math.floor(xpAmount * siphonRate);
    if (siphonXp <= 0) return;

    const manaciteThresholds = CONFIG.SHARDS?.manaciteXpThresholds ?? [0, 0, 50, 150, 350, 750];
    const jobThresholds = CONFIG.SHARDS?.jobXpThresholds ?? {};
    const maxSL = CONFIG.SHARDS?.skillLevelMax ?? 5;
    const rankOrder = ["F", "E", "D", "C", "B", "A", "S"];
    const itemUpdates = [];
    const notifications = [];
    let jobRankedUp = false;

    // Find all socketed manacite
    for (const item of this.items) {
      if (item.type === "manacite" && item.system.socketed) {
        const sys = item.system;
        const newXp = sys.manaciteXp + siphonXp;
        let newSL = sys.skillLevel;

        // Check for level-ups
        while (newSL < maxSL && manaciteThresholds[newSL + 1] != null && newXp >= manaciteThresholds[newSL + 1]) {
          newSL++;
          notifications.push(game.i18n.format("SHARDS.Siphon.ManaciteLevelUp", { name: item.name, level: newSL }));
        }

        itemUpdates.push({
          _id: item.id,
          "system.manaciteXp": newXp,
          "system.skillLevel": newSL
        });
      }

      if (item.type === "job" && item.system.socketed) {
        const sys = item.system;
        const newXp = (sys.jobXp ?? 0) + siphonXp;
        let newRank = sys.rank;
        const currentRankIdx = rankOrder.indexOf(newRank);

        // Check for rank-ups
        for (let i = currentRankIdx + 1; i < rankOrder.length; i++) {
          const nextRank = rankOrder[i];
          const threshold = jobThresholds[nextRank];
          if (threshold != null && newXp >= threshold) {
            newRank = nextRank;
            notifications.push(game.i18n.format("SHARDS.Siphon.JobRankUp", { name: item.name, rank: newRank }));
            jobRankedUp = true;
          } else break;
        }

        itemUpdates.push({
          _id: item.id,
          "system.jobXp": newXp,
          "system.rank": newRank
        });
      }
    }

    if (itemUpdates.length) {
      await this.updateEmbeddedDocuments("Item", itemUpdates);
    }

    // If any job ranked up, expand the grid to add new skill sockets
    if (jobRankedUp) {
      await this.recalculateGrid();
    }

    // Post notifications to chat
    for (const msg of notifications) {
      ChatMessage.create({
        content: `<div class="siphon-notification"><i class="fa-solid fa-gem"></i> ${msg}</div>`,
        speaker: ChatMessage.getSpeaker({ actor: this })
      });
    }
  }
}
