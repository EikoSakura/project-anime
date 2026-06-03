/**
 * Project: Anime — system entry point for Foundry VTT V13.
 */
import * as models from "./data/_module.mjs";
import { ProjectAnimeActor, enforceEquipExclusivity, refundSkillOnDelete, naturalAttackData, ensureNaturalAttack } from "./documents/actor.mjs";
import { ProjectAnimeItem } from "./documents/item.mjs";
import { ProjectAnimeActorSheet } from "./sheets/actor-sheet.mjs";
import { ProjectAnimePartySheet } from "./sheets/party-sheet.mjs";
import { ProjectAnimeItemSheet } from "./sheets/item-sheet.mjs";
import { PROJECTANIME, ENCOUNTER_POWER_SETTING } from "./helpers/config.mjs";
import * as dice from "./helpers/dice.mjs";
import { registerElementSettings } from "./apps/element-config.mjs";
import { registerBioFieldSettings } from "./apps/bio-field-config.mjs";
import { registerTokenFieldSettings } from "./apps/token-field-config.mjs";
import { registerCreationSettings } from "./apps/creation-config.mjs";
import { applyEffectCopy, syncGrants, removeGrants, itemHasGrantRule } from "./helpers/effects.mjs";
import { EffectsPanel } from "./apps/effects-panel.mjs";
import { TokenInfoPanel, TOKEN_INFO_SETTING, TOKEN_INFO_CLIENT_SETTING } from "./apps/token-info.mjs";
import { TokenDossier } from "./apps/token-dossier.mjs";
import { RangeLine, RANGE_LINE_SETTING, RANGE_LINE_CLIENT_SETTING } from "./apps/range-line.mjs";
import { ComboSplash, COMBO_SPLASH_SETTING, COMBO_SPLASH_CLIENT_SETTING } from "./apps/combo-splash.mjs";
import { ensurePartyFolder, ensureAllPartyFolders, syncPartyFolderName, deletePartyFolder, partyMembers } from "./helpers/party-folder.mjs";

const { Actors, Items } = foundry.documents.collections;
const { ActorSheet, ItemSheet } = foundry.appv1.sheets;

// Hidden world flag — set once after the bottom-stacked HP/Energy bars migrate existing tokens.
const BARS_BACKFILLED_SETTING = "barsBackfilled";

/* -------------------------------------------- */
/*  Init                                        */
/* -------------------------------------------- */

Hooks.once("init", function () {
  console.log("Project: Anime | Initializing system");

  // Expose useful classes on the global scope for macros / downstream modules.
  globalThis.projectanime = {
    documents: { ProjectAnimeActor, ProjectAnimeItem },
    applications: { ProjectAnimeActorSheet, ProjectAnimeItemSheet },
    dice,
    models
  };

  // Configuration constants.
  CONFIG.PROJECTANIME = PROJECTANIME;

  // Homebrew Elements (damage types): world setting + GM-only config menu.
  registerElementSettings();

  // GM-configurable Bio-tab dossier fields: world setting + GM-only config menu.
  registerBioFieldSettings();

  // GM-configurable Character Creator: starting SP / Step-Ups / Gold, purchasable
  // types, and which compendiums the gear shop draws from.
  registerCreationSettings();

  // Monster Creator "Encounter Power" — the party-power baseline its Tiers scale from
  // (≈ a typical current PC's total Skill Points). Raising it as the party advances makes
  // newly-built monsters tougher: it rescales each Tier's Skill-Point grant and HP together
  // (Step-Ups / Evasion / Defense stay fixed — attributes cap at d12). Re-renders any open
  // Monster Creator so its Tier cards reflect the new value.
  game.settings.register("project-anime", ENCOUNTER_POWER_SETTING, {
    name: "PROJECTANIME.Settings.encounterPower.name",
    scope: "world",
    config: true,
    type: Number,
    default: PROJECTANIME.encounterPowerDefault,
    onChange: () => {
      for (const app of foundry.applications.instances.values()) {
        if (app.id?.startsWith("pa-monster-creator-")) app.render(false);
      }
    }
  });

  // Token Info panel: a GM-flipped, off-by-default hover readout of a token's HP/Energy.
  game.settings.register("project-anime", TOKEN_INFO_SETTING, {
    name: "PROJECTANIME.Settings.tokenInfo.name",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => { projectanime.tokenInfo?.hide(); ui.controls?.render(); }
  });

  // Per-user show/hide for the hover panel, flipped from a toggle in the Token scene controls.
  // The feature stays "active" (the world setting above); each person can hide the panel just
  // for themselves (e.g. when it overlaps the Token HUD).
  game.settings.register("project-anime", TOKEN_INFO_CLIENT_SETTING, {
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
    onChange: (value) => { if (!value) projectanime.tokenInfo?.hide(); }
  });

  // One-shot guard: switch pre-existing creatures' tokens to always-on resource bars (the new
  // bottom-stacked HP/Energy overlay) exactly once per world, so a GM's later manual change to a
  // token's bar display isn't re-forced on every load. Hidden (not a player-facing setting).
  game.settings.register("project-anime", BARS_BACKFILLED_SETTING, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  // Hover Range Line: a measured line from your selected token to the hovered token, with a
  // tile-distance label. GM-flipped (world), off by default; each player can additionally hide
  // it for themselves via the Token scene-controls toggle (like the info panel above).
  game.settings.register("project-anime", RANGE_LINE_SETTING, {
    name: "PROJECTANIME.Settings.rangeLine.name",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => { projectanime.rangeLine?.refresh(); ui.controls?.render(); }
  });
  game.settings.register("project-anime", RANGE_LINE_CLIENT_SETTING, {
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => projectanime.rangeLine?.refresh()
  });

  // Combo Splash: a brief cinematic flash when someone scores a Combo (matching dice ≥ 6).
  // ON by default — a GM can switch the whole feature off (world), and each player can
  // silence it just for themselves (client, e.g. for motion sensitivity). The splash plays
  // on every client off the Combo card's flag (see the createChatMessage hook below).
  game.settings.register("project-anime", COMBO_SPLASH_SETTING, {
    name: "PROJECTANIME.Settings.comboSplash.name",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register("project-anime", COMBO_SPLASH_CLIENT_SETTING, {
    name: "PROJECTANIME.Settings.comboSplash.clientName",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  // GM-configurable custom Token-Info fields (label + actor data path + gate + surface) — the
  // extensibility hook so module-added data (e.g. a Rank) can show in the readout.
  registerTokenFieldSettings();

  // Right-click a token you do NOT own → open the read-only Token Dossier (owners/GM keep the
  // core Token HUD). Core gates the right-click callback behind _canHUD (GM || owner), so for
  // other viewers it never fires — we relax _canHUD so our handler runs, then branch in
  // _onClickRight: the real _canHUD (GM/owner) → core HUD, otherwise → the dossier. Patched on
  // the prototype in `init`, before any token's interaction manager is built.
  const TokenClass = CONFIG.Token?.objectClass;
  if (TokenClass && !TokenClass.prototype._paDossierPatched) {
    const baseCanHUD = TokenClass.prototype._canHUD;
    const baseOnClickRight = TokenClass.prototype._onClickRight;
    TokenClass.prototype._canHUD = function (user, event) {
      if (baseCanHUD.call(this, user, event)) return true;
      if (!game.settings.get("project-anime", TOKEN_INFO_SETTING) || !this.actor) return false;
      // Keep the same situational guards core uses (no active drag / inactive layer / preview).
      if (this.layer?._draggedToken || !this.layer?.active || this.isPreview) return false;
      return true;
    };
    TokenClass.prototype._onClickRight = function (event) {
      // GM/owner (the real _canHUD) → unchanged core behavior (opens the Token HUD).
      if (baseCanHUD.call(this, game.user, event)) return baseOnClickRight.call(this, event);
      // Any other viewer, feature on → the reveal-gated dossier.
      if (game.settings.get("project-anime", TOKEN_INFO_SETTING) && this.actor) {
        TokenDossier.open(this, event);
        if (!this._propagateRightClick(event)) event.stopPropagation();
        return;
      }
      return baseOnClickRight.call(this, event);
    };
    TokenClass.prototype._paDossierPatched = true;
  }

  // Custom HP / Energy token bars. Replace Foundry's default top-and-bottom, edge-to-edge bars
  // with two slim bars stacked at the BOTTOM of the token — HP on top, Energy directly beneath —
  // both inset from the edges so nothing hangs off. Fills reuse the sheet's crimson→coral (HP) and
  // indigo→violet (Energy) gradients (baked into a cached texture) and carry a "value / max" label.
  if (TokenClass && !TokenClass.prototype._paBarsPatched) {
    TokenClass.prototype._drawBar = paDrawBar;
    TokenClass.prototype._paBarsPatched = true;
  }

  // Register the system's status conditions (token HUD icons + Active Effects).
  CONFIG.statusEffects = PROJECTANIME.statusConditions.map((c) => ({ ...c }));

  // Initiative Check (rules p.13): roll the Agility die + the Mind die; the
  // highest total acts first. No tiebreaker fraction — just die + die.
  CONFIG.Combat.initiative = {
    formula: "1d@attributes.agility.value + 1d@attributes.mind.value",
    decimals: 0
  };

  // Document classes.
  CONFIG.Actor.documentClass = ProjectAnimeActor;
  CONFIG.Item.documentClass = ProjectAnimeItem;

  // System DataModels per sub-type.
  CONFIG.Actor.dataModels = {
    character: models.ProjectAnimeCharacter,
    npc: models.ProjectAnimeNPC,
    party: models.ProjectAnimeParty
  };
  CONFIG.Item.dataModels = {
    skill: models.ProjectAnimeSkill,
    weapon: models.ProjectAnimeWeapon,
    armor: models.ProjectAnimeArmor,
    shield: models.ProjectAnimeShield,
    accessory: models.ProjectAnimeAccessory,
    consumable: models.ProjectAnimeConsumable,
    container: models.ProjectAnimeContainer,
    gear: models.ProjectAnimeGear,
    package: models.ProjectAnimePackage
  };

  // Active Effects apply from the owning Item rather than being copied onto the Actor.
  CONFIG.ActiveEffect.legacyTransferral = false;

  // Register sheets, replacing the core defaults. The main sheet drives Characters and NPCs;
  // the Party (encounter-budget planner) is a distinct actor type with its own sheet.
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("project-anime", ProjectAnimeActorSheet, {
    types: ["character", "npc"],
    makeDefault: true,
    label: "PROJECTANIME.SheetLabels.Actor"
  });
  Actors.registerSheet("project-anime", ProjectAnimePartySheet, {
    types: ["party"],
    makeDefault: true,
    label: "PROJECTANIME.SheetLabels.Actor"
  });

  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("project-anime", ProjectAnimeItemSheet, {
    makeDefault: true,
    label: "PROJECTANIME.SheetLabels.Item"
  });

  // Press "P" to open the Party sheet (rebindable in Configure Controls). Keybindings MUST be
  // registered during `init`. Not restricted — players with party access can use it too.
  game.keybindings.register("project-anime", "openParty", {
    name: "PROJECTANIME.Keybindings.openParty.name",
    hint: "PROJECTANIME.Keybindings.openParty.hint",
    editable: [{ key: "KeyP" }],
    restricted: false,
    onDown: () => { openPartySheetForUser(); return true; }
  });
});

/* -------------------------------------------- */
/*  Chat card interactivity                     */
/* -------------------------------------------- */

Hooks.on("renderChatMessageHTML", (message, html) => dice.onRenderChatMessage(message, html));

// Right-click a Project: Anime chat card → "Apply as Effect": stamp its icon + description onto the
// selected creature(s) as a tracked reminder, for anything the rules engine can't fully automate.
Hooks.on("getChatMessageContextOptions", (...args) => {
  const options = args.find((a) => Array.isArray(a));
  if (options) options.push(dice.cardEffectMenuOption());
});

// A scored Combo flashes the cinematic Combo Splash. The dice engine flags the Combo's chat
// card; that card broadcasts to every client, so each one fires its own splash here (gated by
// the world + per-user settings inside ComboSplash). createChatMessage runs once per client
// per new message — including the roller's — so the whole table sees it together, once.
Hooks.on("createChatMessage", (message) => {
  const combo = message.getFlag("project-anime", "combo");
  if (combo) ComboSplash.flash(combo);
});

/* -------------------------------------------- */
/*  Active Effect expiry                        */
/* -------------------------------------------- */

// Delete actor-owned temporary effects whose duration has run out, and announce each.
// GM-side only (a single client performs the deletes). Runs on combat turn/round changes
// and on world-time advances, so both round/turn and minute durations expire.
function expireEffects() {
  if (game.users.activeGM?.id !== game.user.id) return;
  const actors = new Set(game.actors);
  for (const c of game.combat?.combatants ?? []) if (c.actor) actors.add(c.actor);
  for (const actor of actors) {
    const expired = actor.effects.filter(
      (e) => e.isTemporary && Number.isFinite(e.duration?.remaining) && e.duration.remaining <= 0
    );
    if (!expired.length) continue;
    actor.deleteEmbeddedDocuments("ActiveEffect", expired.map((e) => e.id));
    for (const e of expired) {
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="project-anime chat-card"><div class="card-line"><em class="muted">${game.i18n.format("PROJECTANIME.Effect.expired", { name: e.name, actor: actor.name })}</em></div></div>`
      });
    }
  }
}

Hooks.on("updateCombat", expireEffects);
Hooks.on("updateWorldTime", expireEffects);

/* -------------------------------------------- */
/*  Combat turn-tick (Sustain / Decay / Stunned)*/
/* -------------------------------------------- */

/** A small themed chat line (no roll) announcing a turn-tick event. */
function tickCard(actor, text) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="project-anime chat-card"><div class="card-line"><em class="muted">${text}</em></div></div>`
  });
}

/** Sustain regen per turn by Skill Rank (rules: ★ 2 · ★★★ 4 · ★★★★★ 6 → +2 per tier). */
function sustainAmount(rank) {
  return 2 * Math.ceil((Number(rank) || 1) / 2);
}

/** Decay: 1 HP damage at the END of the actor's turn, for up to 3 turns, then it clears. The
 *  remaining-turns counter is a flag, initialised to 3 the first tick (so ANY way the `decay`
 *  status was applied — Skill modifier, effect, token HUD — gets the rules' 3-turn life). */
async function tickDecay(actor) {
  if (!actor?.statuses?.has?.("decay")) return;
  let remaining = actor.getFlag("project-anime", "decay");
  if (!Number.isInteger(remaining) || remaining <= 0) remaining = 3;
  const hp = actor.system.hp ?? { value: 0, max: 0 };
  remaining -= 1;
  const updates = { "system.hp.value": Math.max(0, (hp.value ?? 0) - 1) };
  if (remaining <= 0) updates["flags.project-anime.-=decay"] = null;
  else updates["flags.project-anime.decay"] = remaining;
  await actor.update(updates);
  if (remaining <= 0) await actor.toggleStatusEffect?.("decay", { active: false });
  tickCard(actor, game.i18n.format("PROJECTANIME.Effect.decayTick", { name: actor.name }));
}

/** Sustain: each PASSIVE Sustain Skill regenerates its rank amount into its pool (HP/Energy)
 *  at the START of the actor's turn, clamped to max. */
async function tickSustain(actor) {
  const skills = actor?.items?.filter(
    (i) => i.type === "skill" && i.system.actionType === "passive" && i.system.effect === "sustain"
  ) ?? [];
  if (!skills.length) return;
  const gains = { hp: 0, energy: 0 };
  for (const skill of skills) gains[skill.system.damagePool === "energy" ? "energy" : "hp"] += sustainAmount(skill.system.rank);
  const updates = {};
  const parts = [];
  for (const pool of ["hp", "energy"]) {
    if (gains[pool] <= 0) continue;
    const res = actor.system[pool] ?? { value: 0, max: 0 };
    const next = Math.min(res.max ?? 0, (res.value ?? 0) + gains[pool]);
    if (next !== res.value) {
      updates[`system.${pool}.value`] = next;
      parts.push(`+${next - res.value} ${game.i18n.localize(`PROJECTANIME.Stat.${pool}`)}`);
    }
  }
  if (!parts.length) return;
  await actor.update(updates);
  tickCard(actor, game.i18n.format("PROJECTANIME.Effect.sustainRegen", { name: actor.name, gain: parts.join(" · ") }));
}

/** Stunned: announce a skipped turn at the START of the actor's turn (GM advances manually). */
function tickStunned(actor) {
  if (!actor?.statuses?.has?.("stunned")) return;
  tickCard(actor, game.i18n.format("PROJECTANIME.Effect.stunnedSkip", { name: actor.name }));
}

/**
 * Combat turn-tick automation (GM-side only, mirroring expireEffects' single-active-GM guard).
 * On a turn/round advance: the combatant whose turn just ENDED takes Decay; the one whose turn
 * just STARTED gets Sustain regen + a Stunned skip notice. Reads combat.previous / combat.current.
 * Sustain regen is gated to once per round per combatant via a high-water `sustainRound` flag, so
 * stepping back through the turn order — within a round or across rounds — never re-heals.
 */
async function combatTurnTick(combat, change) {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (!("turn" in change) && !("round" in change)) return;
  const endedActor = combat.combatants.get(combat.previous?.combatantId)?.actor ?? null;
  const started = combat.combatants.get(combat.current?.combatantId) ?? null;
  if (endedActor) await tickDecay(endedActor);
  if (started?.actor) {
    // HP/Energy regen applies once per round: only when this combatant first reaches a round it
    // hasn't sustained in yet. Going back in the turn order won't clear the flag, so it won't reheal.
    const lastSustained = Number(started.getFlag("project-anime", "sustainRound")) || 0;
    if (combat.round > lastSustained) {
      await started.setFlag("project-anime", "sustainRound", combat.round);
      await tickSustain(started.actor);
    }
    tickStunned(started.actor);
  }
}

Hooks.on("updateCombat", combatTurnTick);

/* -------------------------------------------- */
/*  Defeat & end-of-combat recovery (rules p.14) */
/* -------------------------------------------- */

/** Mark/clear a combatant as Defeated in the tracker when its HP crosses 0. The system replaces
 *  CONFIG.statusEffects, so core's "dead" overlay id no longer resolves — we drive the tracker's
 *  own `defeated` flag instead. Healing above 0 clears it (a Defeated creature revives at once,
 *  rules p.14). GM-side only; the active GM is permitted to update any combatant. */
function markDefeatedFromHP(actor, changes) {
  if (game.users.activeGM?.id !== game.user.id) return;
  const hp = foundry.utils.getProperty(changes, "system.hp.value");
  if (hp === undefined) return;
  const defeated = hp <= 0;
  let crossed = false;
  for (const c of game.combat?.combatants ?? []) {
    if (c.actor?.uuid === actor.uuid && c.defeated !== defeated) { c.update({ defeated }); crossed = true; }
  }
  if (defeated && crossed) tickCard(actor, game.i18n.format("PROJECTANIME.Effect.defeated", { name: actor.name }));
}
Hooks.on("updateActor", markDefeatedFromHP);

/** End of combat: any still-Defeated player character recovers to half their Max HP, rounded down
 *  (rules p.14). Only PCs (type "character") and only those at/below 0 HP — anyone who ended the
 *  fight above 0 keeps their HP, and enemies are left as-is. GM-side only. */
async function recoverDefeatedOnCombatEnd(combat) {
  if (game.users.activeGM?.id !== game.user.id) return;
  const seen = new Set();
  for (const c of combat.combatants ?? []) {
    const actor = c.actor;
    if (!actor || actor.type !== "character" || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    const hp = actor.system.hp ?? { value: 0, max: 0 };
    if ((hp.value ?? 0) > 0) continue;
    const healed = Math.floor((hp.max ?? 0) / 2);
    await actor.update({ "system.hp.value": healed });
    tickCard(actor, game.i18n.format("PROJECTANIME.Effect.recovered", { name: actor.name, hp: healed }));
  }
}
Hooks.on("deleteCombat", recoverDefeatedOnCombatEnd);

/** End of combat: clear "scene"-duration auto-effects (e.g. an active Bolster/Hinder left blank =
 *  lasts the scene) from every combatant — they expire when the fight ends. GM-side only. */
async function expireSceneEffectsOnCombatEnd(combat) {
  if (game.users.activeGM?.id !== game.user.id) return;
  const seen = new Set();
  for (const c of combat.combatants ?? []) {
    const actor = c.actor;
    if (!actor || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    const scene = actor.effects.filter((e) => e.flags?.["project-anime"]?.scene).map((e) => e.id);
    if (scene.length) await actor.deleteEmbeddedDocuments("ActiveEffect", scene);
  }
}
Hooks.on("deleteCombat", expireSceneEffectsOnCombatEnd);

/** Foundry only steps over Defeated combatants on turn advancement when the world's "Skip
 *  Defeated" combat-tracker option is enabled, and it ships off. The rules (p.14) make skipping
 *  the Defeated mandatory, so the active GM turns it on at startup. Idempotent (writes only when
 *  it's currently off) and the change is reflected in the tracker's ⚙ settings, so a GM still
 *  sees it enabled. With it on, `Combat#nextTurn` skips any combatant `markDefeatedFromHP`
 *  flagged at 0 HP; healing one back above 0 clears the flag and returns it to the order. */
async function ensureSkipDefeated() {
  const key = CONFIG.Combat.documentClass?.CONFIG_SETTING ?? "combatTrackerConfig";
  const current = game.settings.get("core", key);
  const cfg = current?.toObject?.() ?? foundry.utils.deepClone(current ?? {});
  if (cfg.skipDefeated) return;
  cfg.skipDefeated = true;
  await game.settings.set("core", key, cfg);
}

// Drag an ActiveEffect onto a token to apply a copy to its actor (requires ownership;
// effects dragged from a sheet's Effects list, an item's Effects tab, or a compendium).
Hooks.on("dropCanvasData", (canvas, data) => {
  if (data?.type !== "ActiveEffect" || !data.uuid) return;
  const token = canvas.tokens?.placeables?.find((t) => {
    const b = t.bounds;
    return data.x >= b.x && data.x <= (b.x + b.width) && data.y >= b.y && data.y <= (b.y + b.height);
  });
  const actor = token?.actor;
  if (!actor) return;
  fromUuid(data.uuid).then((effect) => { if (effect) applyEffectCopy(actor, effect); });
  return false;
});

/* -------------------------------------------- */
/*  Grant Item effects (drag-built bundles)     */
/* -------------------------------------------- */

// A Skill or Package carrying a "Grant Item" effect creates its granted Items (for free)
// when it lands on an actor, and removes them when it leaves — a dynamic link. Only the
// user who made the change reconciles (they own / can edit the actor); the engine is
// idempotent and re-entrancy-guarded, so the carrier-create + embedded-effect-create that
// fire together on a drop don't double-grant. Editing/adding/removing a grant effect on an
// already-owned carrier re-syncs.
Hooks.on("createItem", (item, options, userId) => {
  if (game.user.id === userId && item.actor && itemHasGrantRule(item)) syncGrants(item);
});
Hooks.on("deleteItem", (item, options, userId) => {
  if (game.user.id === userId && item.parent?.documentName === "Actor") removeGrants(item.parent, item.id);
  // Removing a Skill refunds its logged Skill Points and prunes its ledger entries.
  refundSkillOnDelete(item, userId);
});
function resyncGrantsFromEffect(effect, userId) {
  if (game.user.id !== userId) return;
  const item = effect.parent;
  if (item?.documentName === "Item" && item.actor && itemHasGrantRule(item)) syncGrants(item);
}
Hooks.on("createActiveEffect", (effect, options, userId) => resyncGrantsFromEffect(effect, userId));
Hooks.on("deleteActiveEffect", (effect, options, userId) => resyncGrantsFromEffect(effect, userId));
Hooks.on("updateActiveEffect", (effect, change, options, userId) => resyncGrantsFromEffect(effect, userId));

/* -------------------------------------------- */
/*  Equipment slot exclusivity                  */
/* -------------------------------------------- */

// Whenever an item becomes equipped, clear anything else occupying its slot (one
// weapon per hand, one armor, ≤2 accessories, a 2H weapon/shield frees the off-hand).
// Catches every equip path, plus grip flips (switching to a two-handed grip must free the
// off hand). Only the user who made the change enforces (they own the actor, so they can
// unequip the displaced items). Handles flat ("system.equipped") and nested
// ({system:{equipped}}) change shapes.
Hooks.on("updateItem", (item, change, options, userId) => {
  if (game.user.id !== userId || !item.actor || !item.system?.equipped) return;
  const touched = ["system.equipped", "system.grip"].some(
    (k) => foundry.utils.hasProperty(change, k) || Object.prototype.hasOwnProperty.call(change, k)
  );
  if (touched) enforceEquipExclusivity(item.actor, item);
});

/* -------------------------------------------- */
/*  Token resource bars (HP / Energy overlay)   */
/* -------------------------------------------- */

// Two slim bars stacked at the BOTTOM of every token — HP above Energy — replacing Foundry's
// default top-and-bottom edge-to-edge bars (patched onto Token#_drawBar in `init`). Matches the
// character sheet: the same crimson→coral→gold (HP) and indigo→periwinkle→violet (Energy) gradient,
// a baked vertical gloss, a bright leading edge, and a "value / max" label. The animated shimmer is
// kept sheet-only — redrawing it on every token each frame is needless canvas load.

// Horizontal-ramp stops (dark-theme variants, vivid on the canvas) mirroring css/project-anime.css.
const PA_BAR_STOPS = {
  hp:     [[0, "#c34155"], [0.5, "#ef8a6e"], [1, "#ffc36b"]],
  energy: [[0, "#4f6ad0"], [0.5, "#97a6f2"], [1, "#c58cff"]]
};
// Each ramp baked into a texture once and reused by every token / redraw.
const paBarTextures = {};
function paBarTexture(kind) {
  if (paBarTextures[kind]) return paBarTextures[kind];
  const w = 256, h = 32;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  const ramp = ctx.createLinearGradient(0, 0, w, 0);
  for (const [stop, col] of PA_BAR_STOPS[kind]) ramp.addColorStop(stop, col);
  ctx.fillStyle = ramp;
  ctx.fillRect(0, 0, w, h);
  const gloss = ctx.createLinearGradient(0, 0, 0, h);   // bright top → dark base, baked in
  gloss.addColorStop(0, "rgba(255,255,255,0.5)");
  gloss.addColorStop(0.45, "rgba(255,255,255,0)");
  gloss.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, w, h);
  return (paBarTextures[kind] = PIXI.Texture.from(cv));
}

// Centred "value / max" label on a bar: rendered at a high font size then scaled down so it stays
// crisp at token resolution. Cached as a child of the bar Graphics (survives bar.clear()).
function paBarLabel(bar, text, innerW, bh) {
  let label = bar.paLabel;
  if (!label) {
    const TextCls = foundry.canvas?.containers?.PreciseText ?? globalThis.PreciseText ?? PIXI.Text;
    const style = new PIXI.TextStyle({
      fontFamily: "Signika, sans-serif", fontSize: 28, fontWeight: "700",
      fill: "#ffffff", stroke: "#100c18", strokeThickness: 6,
      dropShadow: true, dropShadowColor: "#000000", dropShadowBlur: 3, dropShadowDistance: 0
    });
    label = bar.paLabel = bar.addChild(new TextCls(text, style));
    label.anchor.set(0.5, 0.5);
  } else if (label.text !== text) {
    label.text = text;
  }
  label.scale.set(1, 1);
  const lw = label.width, lh = label.height;
  if (lw > 0 && lh > 0) {
    const fit = Math.min((bh * 0.82) / lh, (innerW * 0.9) / lw);
    label.scale.set(fit, fit);
  }
  label.position.set(innerW / 2, bh / 2);
}

// Override of Token#_drawBar (see the `init` patch). `number` 0 = bar1 (HP), 1 = bar2 (Energy) —
// the system maps both via system.json's primary/secondaryTokenAttribute. Both bars are placed at
// the bottom, inset, with HP stacked directly above Energy.
function paDrawBar(number, bar, data) {
  const doc = this.document;
  const max = Number(data.max) || 0;
  const pct = max > 0 ? Math.clamp(Number(data.value), 0, max) / max : 0;

  const { width, height } = doc.getSize();
  const s = canvas.dimensions.uiScale;
  const mx = width * 0.06;                              // side inset — never touches the edge
  const mb = height * 0.06;                             // bottom inset
  const bh = 8 * (doc.height >= 2 ? 1.5 : 1) * s;       // bar height (core's sizing)
  const gap = Math.max(2 * s, height * 0.025);          // gap between the two bars
  const innerW = Math.max(1, width - (2 * mx));
  const fw = pct * innerW;
  const r = Math.min(3 * s, bh / 2);

  // Stack at the bottom: Energy on the lower row, HP directly above it.
  const enY = height - mb - bh;
  const hpY = enY - gap - bh;
  bar.position.set(mx, number === 0 ? hpY : enY);

  // Track — translucent dark fill with a hairline border.
  bar.clear();
  bar.lineStyle(Math.max(1, s), 0x16131c, 0.9);
  bar.beginFill(0x000000, 0.5);
  bar.drawRoundedRect(0, 0, innerW, bh, r);
  bar.endFill();
  bar.lineStyle(0);

  // Fill — reveal the left `pct` of the full-width hue ramp.
  if (fw > 0.5) {
    const kind = data.attribute === "energy" ? "energy"
      : (data.attribute === "hp" ? "hp" : (number === 0 ? "hp" : "energy"));
    const tex = paBarTexture(kind);
    const matrix = new PIXI.Matrix().scale(innerW / tex.width, bh / tex.height);
    bar.beginTextureFill({ texture: tex, matrix });
    bar.drawRoundedRect(0, 0, fw, bh, r);
    bar.endFill();
    if (pct < 0.999) {                                  // bright leading edge, like the sheet's tip
      const ew = Math.max(1, 1.5 * s);
      bar.beginFill(0xffffff, 0.85);
      bar.drawRect(Math.max(0, fw - ew), 0, ew, bh);
      bar.endFill();
    }
  }

  paBarLabel(bar, `${data.value} / ${data.max}`, innerW, bh);
  return true;
}

/* -------------------------------------------- */
/*  Token defaults                              */
/* -------------------------------------------- */

// Sensible prototype-token defaults at creation: link PCs and give them vision, always show the
// HP/Energy bars (the bottom-stacked overlay), show the name on owner-hover, and map an NPC's
// disposition to the token's disposition. (Bars read hp/energy via the manifest token attributes.)
Hooks.on("preCreateActor", (actor, data) => {
  // The Party planner has no token / combat stats — leave its prototype token at core defaults.
  if (actor.type === "party") return;
  const isChar = actor.type === "character";
  const DISP = CONST.TOKEN_DISPOSITIONS;
  const dispMap = { friendly: DISP.FRIENDLY, neutral: DISP.NEUTRAL, hostile: DISP.HOSTILE };
  actor.updateSource({
    prototypeToken: {
      actorLink: isChar,
      sight: { enabled: isChar },
      displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
      displayName: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
      disposition: isChar ? DISP.FRIENDLY : (dispMap[data?.system?.disposition] ?? DISP.NEUTRAL)
    }
  });
  // Innate Natural Attack: bake an unarmed strike into every new creature unless it already
  // carries one (a duplicated or imported actor). Flag it provisioned so the one-time backfill
  // skips it and a later deletion isn't undone on reload.
  const items = actor._source.items ?? [];
  const hasNatural = items.some((i) => foundry.utils.getProperty(i, "flags.project-anime.natural"));
  const update = { "flags.project-anime.naturalProvisioned": true };
  if (!hasNatural) update.items = [...items, naturalAttackData()];
  // Player Characters default to LIMITED ownership for everyone, so all players can at least see
  // each PC at a glance. (updateSource merges, so the creating user's OWNER entry is preserved;
  // NPCs stay GM-only.) The GM can still raise a specific player to Owner of their own PC.
  if (isChar) update["ownership.default"] = CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
  actor.updateSource(update);
});

/* -------------------------------------------- */
/*  Party folder lifecycle (real Foundry folder)*/
/* -------------------------------------------- */

// Each Party actor is backed by a real Folder whose Characters ARE its roster, so Foundry's
// native folder UI manages membership (drag in/out, collapse, right-click). The single active
// GM owns the folder's lifecycle: create it with the party, rename + delete to follow it.
const paIsActiveGM = () => game.users.activeGM?.id === game.user.id;
Hooks.on("createActor", (actor) => { if (actor.type === "party" && paIsActiveGM()) ensurePartyFolder(actor); });
Hooks.on("updateActor", (actor, changes) => { if (actor.type === "party" && "name" in changes && paIsActiveGM()) syncPartyFolderName(actor); });
Hooks.on("deleteActor", (actor) => { if (actor.type === "party" && paIsActiveGM()) deletePartyFolder(actor); });

// A party's roster IS its folder's Characters, so adding/removing a member mutates the CHARACTER
// (its `folder`) — never the party Document — and the open party sheet won't refresh on its own.
// Re-render any open party sheet whenever folder membership could have shifted: a character's
// folder changes, or one is created / deleted. Debounced so the burst of updates ensurePartyFolder
// fires (party + legacy members in one go) collapses into a single render. Pure local refresh —
// runs for every user with a party sheet open (players included), no GM gate.
const refreshOpenPartySheets = foundry.utils.debounce(() => {
  for (const app of foundry.applications.instances.values())
    if (app instanceof ProjectAnimePartySheet) app.render(false);
}, 50);
Hooks.on("updateActor", (actor, changes) => { if (actor.type === "character" && "folder" in changes) refreshOpenPartySheets(); });
Hooks.on("createActor", (actor) => { if (actor.type === "character") refreshOpenPartySheets(); });
Hooks.on("deleteActor", (actor) => { if (actor.type === "character") refreshOpenPartySheets(); });

// Open the Party sheet most relevant to this user: for a player, the party whose folder holds a
// character they own; otherwise (and for the GM) the first party they can view. Backs both the
// "P" keybinding and the folder icon below.
function openPartySheetForUser() {
  const parties = game.actors.filter((a) => a.type === "party" && a.testUserPermission(game.user, "LIMITED"));
  if (!parties.length) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Party.none"));
  const mine = !game.user.isGM && parties.find((p) => partyMembers(p).some((m) => m.isOwner));
  (mine || parties[0]).sheet.render(true);
}

// Make each Party folder behave like PF2e's party in the Actors sidebar:
//   • PIN it to the TOP of its list — no matter the directory's sort mode (the `sort: -100000`
//     set at creation only bites in MANUAL mode; under alphabetical sorting it's ignored, so the
//     folder would otherwise drift). Re-applied on every render, so it can't drift.
//   • Drop a one-click "open the party sheet" icon on the folder header (for users who can view
//     it). The folder's Characters already ARE the roster, so this is the party's home.
// Pure DOM, so it runs for everyone (the pin has no GM gate; the icon is permission-gated).
Hooks.on("renderActorDirectory", (app, element) => {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  // Reversed so that after each prepend the directory's first party ends up topmost.
  for (const party of game.actors.filter((a) => a.type === "party").reverse()) {
    const id = party.getFlag("project-anime", "folderId");
    const li = id ? root.querySelector(`li[data-folder-id="${id}"]`) : null;
    if (!li) continue;
    li.parentElement?.prepend(li);                                  // pin to the top of its list
    if (!party.testUserPermission(game.user, "LIMITED")) continue;  // icon only if viewable
    const header = li.querySelector("header") ?? li;                // the folder's header row
    if (header.querySelector(".pa-party-open")) continue;           // inject the open icon once
    const open = document.createElement("a");
    open.className = "pa-party-open";
    open.dataset.tooltip = game.i18n.localize("PROJECTANIME.Party.openSheet");
    open.innerHTML = '<i class="fas fa-users"></i>';
    open.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); party.sheet.render(true); });
    header.appendChild(open);
  }
});

/* -------------------------------------------- */
/*  Token Info: per-user scene-control toggle   */
/* -------------------------------------------- */

// Add a per-user on/off toggle for the hover panel to the Token scene controls — but only
// while the GM's world feature is enabled. Each user's choice persists in the client setting;
// the panel reads it via TokenInfoPanel.panelEnabled.
Hooks.on("getSceneControlButtons", (controls) => {
  const tools = controls.tokens?.tools;
  if (!tools) return;
  if (game.settings.get("project-anime", TOKEN_INFO_SETTING)) {
    tools["project-anime-token-info"] = {
      name: "project-anime-token-info",
      order: 100,
      title: "PROJECTANIME.Settings.tokenInfo.toggle",
      icon: "fa-solid fa-heart-pulse",
      toggle: true,
      active: game.settings.get("project-anime", TOKEN_INFO_CLIENT_SETTING),
      onChange: (event, toggled) => game.settings.set("project-anime", TOKEN_INFO_CLIENT_SETTING, toggled)
    };
  }
  if (game.settings.get("project-anime", RANGE_LINE_SETTING)) {
    tools["project-anime-range-line"] = {
      name: "project-anime-range-line",
      order: 101,
      title: "PROJECTANIME.Settings.rangeLine.toggle",
      icon: "fa-solid fa-ruler",
      toggle: true,
      active: game.settings.get("project-anime", RANGE_LINE_CLIENT_SETTING),
      onChange: (event, toggled) => game.settings.set("project-anime", RANGE_LINE_CLIENT_SETTING, toggled)
    };
  }
});

/* -------------------------------------------- */
/*  Skill-Point ledger backfill (one-time)      */
/* -------------------------------------------- */

// Seed the Skill-Point ledger for characters made before it existed: one refundable "skill"
// entry per self-built Skill (its spCost), plus a single non-refundable "Prior advancement"
// lump estimating SP spent on attribute raises (the 5 cheapest steps are the free creation
// step-ups) + stat buys (carry/move bonuses + HP/Energy bought over the attribute×2 baseline).
// GM-side, once per actor (flagged "spLogBackfilled"); NPCs are just flagged (no SP advancement).
async function backfillSkillPointLog() {
  if (game.users.activeGM?.id !== game.user.id) return;
  const STEP = { 4: 1, 6: 2, 8: 3, 10: 4 };
  const updates = [];
  for (const actor of game.actors) {
    if (actor.getFlag("project-anime", "spLogBackfilled")) continue;
    if (actor.type !== "character") {
      updates.push({ _id: actor.id, "flags.project-anime.spLogBackfilled": true });
      continue;
    }
    const log = [];
    // Self-built Skills — exact, refundable (Refund deletes the skill and returns its SP).
    for (const item of actor.items) {
      if (item.type !== "skill" || item.getFlag("project-anime", "granted")) continue;
      const amount = Number(item.system?.spCost ?? 0) || 0;
      if (amount > 0) log.push({ id: foundry.utils.randomID(), label: item.name, amount, kind: "skill", ref: item.id, data: {}, time: null });
    }
    // Prior advancement — can't be itemised after the fact, so one non-refundable lump.
    const src = actor._source.system ?? {};
    const steps = [];
    for (const k of PROJECTANIME.attributeKeys) {
      const base = src.attributes?.[k]?.base ?? 4;
      for (let v = 4; v < base; v += 2) steps.push(STEP[v] ?? 0);
    }
    steps.sort((a, b) => a - b);
    let spent = steps.slice(5).reduce((s, c) => s + c, 0);   // drop the 5 free creation steps
    spent += (src.carryingCapacity?.bonus ?? 0);             // 1 SP each
    spent += (src.movement?.bonus ?? 0) * 3;                 // 3 SP each
    const might = actor.system.attributes?.might?.value ?? 4;
    const spirit = actor.system.attributes?.spirit?.value ?? 4;
    spent += Math.max(0, Math.round(((src.hp?.max ?? 0) - might * 2) / 2));
    spent += Math.max(0, Math.round(((src.energy?.max ?? 0) - spirit * 2) / 2));
    if (spent > 0) log.push({ id: foundry.utils.randomID(), label: game.i18n.localize("PROJECTANIME.SkillLog.legacy"), amount: spent, kind: "legacy", ref: "", data: {}, time: null });

    updates.push({ _id: actor.id, "system.skillPoints.log": log, "flags.project-anime.spLogBackfilled": true });
  }
  if (updates.length) await Actor.updateDocuments(updates);
}

/* -------------------------------------------- */
/*  Natural Attack backfill (one-time)          */
/* -------------------------------------------- */

// Give every existing Character / NPC made before the feature its innate Natural Attack (an
// unarmed strike, usable alongside equipped weapons). GM-side, once per actor (flagged
// "naturalProvisioned" so an intentional deletion isn't undone on the next world load). New
// actors get theirs at creation via preCreateActor.
async function backfillNaturalAttacks() {
  if (game.users.activeGM?.id !== game.user.id) return;
  const flagged = [];
  for (const actor of game.actors) {
    if (actor.type !== "character" && actor.type !== "npc") continue;
    if (actor.getFlag("project-anime", "naturalProvisioned")) continue;
    await ensureNaturalAttack(actor);
    flagged.push({ _id: actor.id, "flags.project-anime.naturalProvisioned": true });
  }
  if (flagged.length) await Actor.updateDocuments(flagged);
}

/* -------------------------------------------- */
/*  Always-on token bars backfill (one-time)    */
/* -------------------------------------------- */

// Switch creatures made before the bottom-stacked HP/Energy overlay to always-visible bars, so the
// readout matches the new design everywhere. GM-side, once per world (the BARS_BACKFILLED flag),
// covering both every actor's prototype token and every token already placed in a scene. Guarded so
// a GM who later hides a specific token's bars isn't overridden on the next load. New tokens inherit
// ALWAYS from the prototype defaults set in preCreateActor.
async function backfillAlwaysBars() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", BARS_BACKFILLED_SETTING)) return;
  const ALWAYS = CONST.TOKEN_DISPLAY_MODES.ALWAYS;

  const actorUpdates = [];
  for (const actor of game.actors) {
    if (actor.type === "party") continue;               // the planner has no token
    if (actor.prototypeToken?.displayBars !== ALWAYS)
      actorUpdates.push({ _id: actor.id, "prototypeToken.displayBars": ALWAYS });
  }
  if (actorUpdates.length) await Actor.updateDocuments(actorUpdates);

  for (const scene of game.scenes) {
    const tokenUpdates = [];
    for (const token of scene.tokens) {
      if (token.actor?.type === "party") continue;
      if (token.displayBars !== ALWAYS) tokenUpdates.push({ _id: token.id, displayBars: ALWAYS });
    }
    if (tokenUpdates.length) await scene.updateEmbeddedDocuments("Token", tokenUpdates);
  }

  await game.settings.set("project-anime", BARS_BACKFILLED_SETTING, true);
}

/* -------------------------------------------- */
/*  Ready                                       */
/* -------------------------------------------- */

Hooks.once("ready", function () {
  console.log("Project: Anime | System ready");

  // One-time: seed the Skill-Point ledger from existing skills + past advancement.
  backfillSkillPointLog();

  // One-time: give pre-existing creatures their innate Natural Attack.
  backfillNaturalAttacks();

  // One-time: switch existing tokens to always-on HP/Energy bars (the bottom-stacked overlay).
  backfillAlwaysBars();

  // One-time: back each existing Party with a real Folder (migrating any legacy system.members).
  if (paIsActiveGM()) ensureAllPartyFolders();

  // Enforce the rules' "skip the Defeated" turn order (p.14) — defeated enemies/PCs at 0 HP
  // are stepped over in the encounter tracker.
  if (paIsActiveGM()) ensureSkipDefeated();

  // GM-side relay for applying damage. A player clicking "Apply" on a target
  // they don't own (e.g. the GM's monster) can't update it directly — the server
  // would reject it — so they emit over the system socket and the single active
  // GM performs the HP change. Requires "socket": true in system.json.
  game.socket.on("system.project-anime", (payload) => {
    if (game.users.activeGM?.id !== game.user.id) return;
    if (payload?.type === "applyDamage") dice.applyDamageTo(payload.targetUuid, payload.amount, payload.heal, payload.pool);
    else if (payload?.type === "applyStatus") dice.applyStatusTo(payload.targetUuid, payload.statusId, payload.active);
    else if (payload?.type === "applyEffect") dice.applyEffectTo(payload.targetUuid, payload.effectData);
  });

  // Floating Effects Panel (PF2e-style): a frameless, screen-docked readout of the
  // controlled token's (or assigned character's) live effects. It debounces its own
  // re-render, so we can wire it to every change that might alter what affects an actor.
  const effectsPanel = new EffectsPanel();
  projectanime.effectsPanel = effectsPanel;
  effectsPanel.render({ force: true });
  const refreshEffectsPanel = () => effectsPanel.refresh();
  for (const hook of [
    "controlToken", "deleteToken", "updateActor",
    "createItem", "updateItem", "deleteItem",
    "createActiveEffect", "updateActiveEffect", "deleteActiveEffect",
    "updateWorldTime", "updateCombat", "canvasReady"
  ]) Hooks.on(hook, refreshEffectsPanel);

  // Hover Token Info panel: a screen-docked HP/Energy readout shown beside a token while
  // hovered (off by default — see the "Token Info Panel" world setting). Hidden on
  // hover-out / pan / delete, and re-shown live when the displayed actor or token changes.
  const tokenInfo = new TokenInfoPanel();
  projectanime.tokenInfo = tokenInfo;
  Hooks.on("hoverToken", (token, hovered) => {
    if (!TokenInfoPanel.panelEnabled || !hovered) tokenInfo.hide();
    else tokenInfo.show(token);
  });
  Hooks.on("canvasPan", () => tokenInfo.hide());
  Hooks.on("deleteToken", () => tokenInfo.hide());
  // The Token HUD opens over the same spot — hide the panel so they don't overlap.
  Hooks.on("renderTokenHUD", () => tokenInfo.hide());
  // Live refresh of BOTH the hover panel and any open dossier — on anything that can change
  // what they show OR what the VIEWER can reveal (their Scouter): the displayed actor changing,
  // ANY actor/item/effect change (equipping a scouter, toggling/adding/removing an effect),
  // control changes, and combat/world-time advances (for HP%/condition predicates). Debounced
  // so a burst of related updates collapses into a single re-render — no re-hover or refresh.
  const refreshTokenInfo = foundry.utils.debounce(() => {
    if (tokenInfo.token) tokenInfo.show(tokenInfo.token);
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof TokenDossier) app.render(false);
    }
  }, 50);
  for (const hook of [
    "controlToken", "updateActor", "updateToken",
    "createItem", "updateItem", "deleteItem",
    "createActiveEffect", "updateActiveEffect", "deleteActiveEffect",
    "updateCombat", "updateWorldTime"
  ]) Hooks.on(hook, refreshTokenInfo);

  // Hover Range Line: a measured line from the controlled token (near end) to the hovered token
  // (far end), labelled with the tile distance (off by default — see the "Range Line" world
  // setting). A local canvas overlay; only this user sees their own line.
  const rangeLine = new RangeLine();
  projectanime.rangeLine = rangeLine;
  Hooks.on("hoverToken", (token, hovered) => {
    if (!RangeLine.lineEnabled) return;
    if (hovered) rangeLine.show(token);
    else if (rangeLine.hovered === token) rangeLine.hide();
  });
  // Selection (the near end) changed, or either token moved → recompute. Token deletion or a
  // scene redraw → drop the line (its hover is gone).
  Hooks.on("controlToken", () => rangeLine.refresh());
  Hooks.on("updateToken", (doc, changes) => { if ("x" in changes || "y" in changes) rangeLine.refresh(); });
  Hooks.on("deleteToken", () => rangeLine.refresh());
  Hooks.on("canvasReady", () => rangeLine.hide());
});
