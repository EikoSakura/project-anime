/**
 * Project: Anime — system entry point for Foundry VTT V13.
 */
import * as models from "./data/_module.mjs";
import { ProjectAnimeActor, enforceEquipExclusivity, refundSkillOnDelete } from "./documents/actor.mjs";
import { ProjectAnimeItem } from "./documents/item.mjs";
import { ProjectAnimeActorSheet } from "./sheets/actor-sheet.mjs";
import { ProjectAnimePartySheet } from "./sheets/party-sheet.mjs";
import { ProjectAnimeMerchantSheet } from "./sheets/merchant-sheet.mjs";
import { ProjectAnimeItemSheet } from "./sheets/item-sheet.mjs";
import { PROJECTANIME, cursedPools, combatantSide, sideInitiative, hasActed, isSkippable, pendingOnSide, activeSide } from "./helpers/config.mjs";
import * as dice from "./helpers/dice.mjs";
import { registerBioFieldSettings } from "./apps/bio-field-config.mjs";
import { registerTokenFieldSettings } from "./apps/token-field-config.mjs";
import { registerTokenSettings } from "./apps/token-config.mjs";
import { registerDiscordSettings } from "./apps/discord-config.mjs";
import { registerCreationSettings } from "./apps/creation-config.mjs";
import { applyEffectCopy, syncGrants, removeGrants, itemHasGrantRule, collectSustain, durationRounds, durationRoundsUpdate } from "./helpers/effects.mjs";
import { createCompanion, removeServantActor, confirmAndDismiss } from "./helpers/servants.mjs";
import { merchantBuyTo, merchantSellTo } from "./helpers/merchant.mjs";
import { auditGearPacks, purgeRetiredPackItems, healBrokenItemIcons, PACK_AUDIT_SETTING, PACK_TARGETS, ACCESSORY_CANON, accessoryEffectData } from "./helpers/pack-audit.mjs";
import { syncAuras, isAuraEffect } from "./helpers/aura.mjs";
import { EffectsPanel } from "./apps/effects-panel.mjs";
import { TokenInfoPanel, TOKEN_INFO_SETTING, TOKEN_INFO_CLIENT_SETTING, canSeeTokenVitals, viewerReveals } from "./apps/token-info.mjs";
import { TokenDossier } from "./apps/token-dossier.mjs";
import { RangeLine, RANGE_LINE_SETTING, RANGE_LINE_CLIENT_SETTING } from "./apps/range-line.mjs";
import { AuraField } from "./apps/aura-field.mjs";
import { patchEffectsHalo } from "./apps/effects-halo.mjs";
import { ComboSplash, COMBO_SPLASH_SETTING, COMBO_SPLASH_CLIENT_SETTING } from "./apps/combo-splash.mjs";
import { ensurePartyFolder, ensureAllPartyFolders, syncPartyFolderName, deletePartyFolder, partyMembers } from "./helpers/party-folder.mjs";
import { AnimeHud, AnimePartyRail, AnimeCombatTracker, registerHudSettings, applyHudState, HUD_ENABLED_SETTING, HUD_SHOW_PARTY_SETTING } from "./apps/anime-hud.mjs";
import { Codex, ChronicleTracker } from "./apps/codex.mjs";
import { QUESTS_SETTING, TRACKED_SETTING, TRACKER_VISIBLE_SETTING, SEASON_COUNT_SETTING, PARTY_TIER_SETTING } from "./helpers/chronicle.mjs";
import { htmlToMarkup, isLegacyHTML } from "./helpers/prose.mjs";
import { registerInlineCalcEnrichers } from "./helpers/enrichers.mjs";
import { autoRulesToMarkup } from "./helpers/skill-description.mjs";

const { Actors, Items } = foundry.documents.collections;
const { ActorSheet, ItemSheet } = foundry.appv1.sheets;

// Hidden world flag — set once after the bottom-stacked HP/Energy bars migrate existing tokens.
const BARS_BACKFILLED_SETTING = "barsBackfilled";


// Hidden world flag — set once after existing weapons/shields seed their Type from their name (the
// game's weapons were all named after their type before the Weapon Type field existed).
const WEAPON_TYPE_BACKFILL_SETTING = "weaponTypeFromName";

// Hidden client flag — set once after this client defaults chat bubbles + pan-to-speaker off.
const CHAT_DEFAULTS_SETTING = "chatBubbleDefaultsApplied";

// Hidden world flag — set once after the GM defaults automatic token rotation off and locks
// rotation on every existing actor's prototype token + placed token.
const ROTATION_DEFAULTS_SETTING = "tokenRotationDefaultsApplied";

// Hidden world flag — set once after the world is seeded with its starter Party, so every game
// ships with one. Guarding it means a GM who later deletes the party isn't fighting a respawn.
const DEFAULT_PARTY_SETTING = "defaultPartyProvisioned";

// Hidden world flag — set once after every existing actor is re-baselined to the Version 2 box
// model (Hit Boxes / Energy Boxes / Guard / Movement) and monster NPCs are remapped from the
// retired Role × Tier model to the V2 enemy Types. See migrateActorsV2.
const ACTORS_V2_SETTING = "actorsV2";

// Hidden world flag — set once after every existing world/actor-owned weapon, armor, and shield
// is re-based to the Version 2 Style tables (fixed Damage + Threshold, Guard bonus, Movement).
// The compendiums themselves are handled by the pack-audit pass; this one reaches the COPIES
// players already own. See migrateGearRebaseV2.
const GEAR_REBASE_V2_SETTING = "gearRebaseV2";

// Hidden world flag — set once after every world/actor-owned copy of the five printed
// Accessories (and the Armor Style descriptions) is re-based to the updated pack line, its
// stale pre-V2 wired effect replaced. The packs themselves were rewritten in place (v0.5.3).
// See migrateAccessoriesV2.
const ACCESSORIES_V2_SETTING = "accessoriesV2";

// Hidden world flag — set once after the auto-written Technique rules retired (v0.5.18) and every
// Technique's display text was folded into the hand-authored `system.description`: a stored Rules
// Override moves to the top of the description; a Technique with NEITHER is seeded from its last
// auto write-up so nothing on the table goes blank. Covers world Items, actor-owned Techniques,
// and the system's Techniques pack. See migrateProseDescriptions.
const PROSE_DESC_SETTING = "proseDescriptionsV1";

// Hidden world flag — set once after the Contest Target → Resistance rules change (Opposing
// Techniques retired): every stored Technique description swaps its `@contest` / `@rule[contest]`
// tokens and "**Contest**" outcome labels for the Resistance vocabulary, plus the literal
// "Contest Target" / "Opposing Techniques" phrases. Covers world Items, actor-owned Techniques,
// and the system's Techniques pack. See migrateResistanceText.
const RESISTANCE_TEXT_SETTING = "resistanceV1";

// Hidden world flag — set once after every NPC converts to the Tier × EXP enemy model: retired
// V2 Type keys fold into the Tier ladder, Bosses become gated Villains (Bars → Gates), Rivals
// become Villains, and the retired boss/rival source keys drop. See migrateEnemyTiersV1.
const ENEMY_TIERS_SETTING = "enemyTiersV1";

// Hidden world flag — set once after the innate "Natural Attack" (Unarmed Strike) retired
// (attacks come from Weapon Styles now): every natural-flagged weapon is deleted from world
// actors and unlocked Actor packs. See migrateNaturalAttacksRemoved.
const NATURAL_REMOVED_SETTING = "naturalAttacksRemovedV1";

// Per-user toggle for the PLAYER PHASE / ENEMY PHASE sweep banner on side-phase flips.
const PHASE_BANNER_CLIENT_SETTING = "phaseBannerClientShow";

// Per-user accent color — Log Horizon-style: every player's status windows wear THEIR color.
// The chosen color is injected on <html> as --pa-player-accent; the sheet skin keys off it.
const ACCENT_COLOR_SETTING = "accentColor";

/** Write the user's accent color onto the document root so the sheet CSS can theme off it. */
function applyPlayerAccent(value) {
  const css = value?.css ?? (value ? String(value) : null);
  if (css) document.documentElement.style.setProperty("--pa-player-accent", css);
}

/** Mirror the client-scoped accent to a USER FLAG so OTHER clients can read it — the Party HUD tints
 *  each member's card by its owning player's accent, and a client can't read another client's local
 *  settings. No-op until the user + socket are ready, or if we lack permission to update ourselves. */
async function syncPlayerAccentFlag(value) {
  if (!game?.user || !game.ready) return;
  const css = value?.css ?? (value ? String(value) : null);
  if (!css || game.user.getFlag("project-anime", "accent") === css) return;
  try { await game.user.setFlag("project-anime", "accent", css); } catch (_) { /* ignore */ }
}

/* -------------------------------------------- */
/*  Init                                        */
/* -------------------------------------------- */

Hooks.once("init", function () {
  console.log("Project: Anime | Initializing system");

  // Expose useful classes on the global scope for macros / downstream modules. `sideInit` surfaces the
  // Side-Initiative state machine (GM-side) so the HUD tracker can drive it without an import cycle.
  // (Note: `projectanime.combat` is later assigned the AnimeCombatTracker instance — keep these distinct.)
  globalThis.projectanime = {
    documents: { ProjectAnimeActor, ProjectAnimeItem },
    applications: { ProjectAnimeActorSheet, ProjectAnimeItemSheet, Codex },
    sideInit: { activate: activateCombatant, end: endActivation, reconcile: reconcilePhase, nextRound: forceNextRound },
    dice,
    models
  };

  // Configuration constants.
  CONFIG.PROJECTANIME = PROJECTANIME;

  // Inline autocalc tokens (@talent[Name] / @resistance / @threshold / @damage / @energy / @range)
  // render live values wherever descriptions are enriched — sheets, chat cards, journals.
  registerInlineCalcEnrichers();

  // Register shared Handlebars partials included by full path via {{> …}} (Foundry does not auto-load
  // them). The carried-gear body is shared by the actor sheet's Gear drawer and the Monster Creator's
  // Gear step; preloading at init means it's registered long before any sheet opens.
  const loadTpl = foundry.applications.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  loadTpl?.([
    "systems/project-anime/templates/actor/gear-body.hbs",
    "systems/project-anime/templates/apps/monster-statblock.hbs"
  ]);

  // CHRONICLE quest log — the campaign's quests live in one world setting (GM writes, all read).
  game.settings.register("project-anime", QUESTS_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => {
      for (const app of foundry.applications.instances.values()) {
        if (app.id === "pa-codex") app.render(false);
      }
      ChronicleTracker.refresh();
    }
  });
  // Seasons concluded (v0.03 campaign spine): the Milestone tool advances it; once-per-Season
  // recharges read it, and it backstops the auto party Tier when a world has no roster (the
  // majority-of-member-Tiers rule needs members). Hidden. Any open party sheet refreshes its badge.
  game.settings.register("project-anime", SEASON_COUNT_SETTING, {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
    onChange: () => {
      for (const app of foundry.applications.instances.values())
        if (app.options?.classes?.includes("party-sheet")) app.render();
    }
  });
  // Party Tier override (v0.03 revised): 0 = auto (the Tier shared by most member characters,
  // ties read the higher); 1–4 pins it. Set from the party sheet's Tier select (GM). Hidden.
  game.settings.register("project-anime", PARTY_TIER_SETTING, {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
    onChange: () => {
      for (const app of foundry.applications.instances.values())
        if (app.options?.classes?.includes("party-sheet")) app.render();
    }
  });
  // Per-user "tracked quest" id (drives the on-canvas quest tracker).
  game.settings.register("project-anime", TRACKED_SETTING, {
    scope: "client",
    config: false,
    type: String,
    default: "",
    onChange: () => ChronicleTracker.refresh()
  });
  // Per-user toggle for the on-canvas quest tracker widget. The tracker's own "hide" (eye-slash)
  // button flips this off so it stops taking up screen space without un-tracking the quest; it's
  // also a checkbox in Settings, and tracking a quest turns it back on.
  game.settings.register("project-anime", TRACKER_VISIBLE_SETTING, {
    name: "PROJECTANIME.Settings.trackerVisible.name",
    hint: "PROJECTANIME.Settings.trackerVisible.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => ChronicleTracker.refresh()
  });

  // GM-configurable Bio-tab dossier fields: world setting + GM-only config menu.
  registerBioFieldSettings();

  // GM-configurable Character Creator: starting SP / Step-Ups / Gold, purchasable
  // types, and which compendiums the gear shop draws from.
  registerCreationSettings();

  // Cinematic HUD — per-client settings (enable + intensity / slot shape / size / party rail).
  // The console replaces the hotbar and the party rail replaces the names list; both are
  // reversible from the "Cinematic HUD" client setting. See module/apps/anime-hud.mjs.
  registerHudSettings();

  // Token Info panel: a GM-flipped, off-by-default hover readout of a token's HP/Energy. Now grouped
  // under the "Token Settings" menu (registered below, alongside the HP/EP bar-visibility dropdown),
  // so it's config:false here and toggled from that dialog rather than as a standalone checkbox.
  game.settings.register("project-anime", TOKEN_INFO_SETTING, {
    name: "PROJECTANIME.Settings.tokenInfo.name",
    scope: "world",
    config: false,
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

  // "Token Settings" menu — one System-Settings entry grouping the HP/Energy bar-visibility dropdown
  // (everyone vs. allies; gates paDrawBar below) with the Token Info Panel toggle registered above.
  registerTokenSettings();

  // "Discord" menu — GM-only dialog holding the channel webhook URL that quests post to (Phase 1
  // outbound; stored config:false so it never shows in the players' Configure Settings list).
  registerDiscordSettings();

  // One-shot guard: switch pre-existing creatures' tokens to always-on resource bars (the new
  // bottom-stacked HP/Energy overlay) exactly once per world, so a GM's later manual change to a
  // token's bar display isn't re-forced on every load. Hidden (not a player-facing setting).
  game.settings.register("project-anime", BARS_BACKFILLED_SETTING, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  // One-shot guards that each run exactly once per world: the v0.01 compendium gear audit, the
  // Unarmed DMG −2 backfill, and seeding the world's starter Party. Hidden.
  for (const key of [PACK_AUDIT_SETTING, WEAPON_TYPE_BACKFILL_SETTING, DEFAULT_PARTY_SETTING, ACTORS_V2_SETTING, GEAR_REBASE_V2_SETTING, ACCESSORIES_V2_SETTING, PROSE_DESC_SETTING, RESISTANCE_TEXT_SETTING, ENEMY_TIERS_SETTING, NATURAL_REMOVED_SETTING]) {
    game.settings.register("project-anime", key, {
      scope: "world",
      config: false,
      type: Boolean,
      default: false
    });
  }

  // One-shot guards for the system's preferred token/UI defaults (applied in the ready hook):
  // chat bubbles + pan-to-speaker off (per client) and automatic token rotation off + rotation
  // locked on existing tokens (per world). Guarding the writes lets a GM/player turn any of them
  // back on without the system re-forcing it on the next load. Hidden (not player-facing).
  game.settings.register("project-anime", CHAT_DEFAULTS_SETTING, {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });
  game.settings.register("project-anime", ROTATION_DEFAULTS_SETTING, {
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
    hint: "PROJECTANIME.Settings.rangeLine.hint",
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
    hint: "PROJECTANIME.Settings.comboSplash.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register("project-anime", COMBO_SPLASH_CLIENT_SETTING, {
    name: "PROJECTANIME.Settings.comboSplash.clientName",
    hint: "PROJECTANIME.Settings.comboSplash.clientHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  // PLAYER PHASE / ENEMY PHASE sweep banner when the side-initiative phase flips. Per-player.
  game.settings.register("project-anime", PHASE_BANNER_CLIENT_SETTING, {
    name: "PROJECTANIME.Settings.phaseBanner.name",
    hint: "PROJECTANIME.Settings.phaseBanner.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  // Player Accent — the color this user's sheets glow (trim, Energy bar, highlights). Client-scoped
  // so each player at the table sees their own; applied immediately so open sheets re-tint live.
  game.settings.register("project-anime", ACCENT_COLOR_SETTING, {
    name: "PROJECTANIME.Settings.accentColor.name",
    hint: "PROJECTANIME.Settings.accentColor.hint",
    scope: "client",
    config: true,
    type: new foundry.data.fields.ColorField({ nullable: false, initial: "#3ec9f0" }),
    onChange: (v) => { applyPlayerAccent(v); syncPlayerAccentFlag(v); }
  });
  applyPlayerAccent(game.settings.get("project-anime", ACCENT_COLOR_SETTING));

  // GM-configurable custom Token-Info fields (label + actor data path + gate + surface) — the
  // extensibility hook so module-added data (e.g. a Rank) can show in the readout.
  registerTokenFieldSettings();

  // Right-click a token you do NOT own → open the read-only Token Dossier (owners/GM keep the
  // core Token HUD). Core gates the right-click callback behind _canHUD (GM || owner), so for
  // other viewers it never fires — we relax _canHUD so our handler runs, then branch in
  // _onClickRight: the real _canHUD (GM/owner) → core HUD, otherwise → the dossier. Patched on
  // the prototype in `init`, before any token's interaction manager is built.
  //
  // The dossier opens for a non-owner when EITHER the Token Info Panel world setting is on, OR the
  // viewer carries at least one active Reveal category (a Scouter — e.g. a passive "analyze Skills"
  // Skill). Reveal is a granted inspection ability, so it enables the inspect surface on its own,
  // without also needing the GM to flip the (separate, hover-vitals) Token Info Panel setting. The
  // dossier still gates each section by the viewer's reveals, so they only ever see what they earned.
  const canInspect = () =>
    game.settings.get("project-anime", TOKEN_INFO_SETTING) || viewerReveals().size > 0;
  const TokenClass = CONFIG.Token?.objectClass;
  if (TokenClass && !TokenClass.prototype._paDossierPatched) {
    const baseCanHUD = TokenClass.prototype._canHUD;
    const baseOnClickRight = TokenClass.prototype._onClickRight;
    TokenClass.prototype._canHUD = function (user, event) {
      if (baseCanHUD.call(this, user, event)) return true;
      if (!this.actor || !canInspect()) return false;
      // Keep the same situational guards core uses (no active drag / inactive layer / preview).
      if (this.layer?._draggedToken || !this.layer?.active || this.isPreview) return false;
      return true;
    };
    TokenClass.prototype._onClickRight = function (event) {
      // GM/owner (the real _canHUD) → unchanged core behavior (opens the Token HUD).
      if (baseCanHUD.call(this, game.user, event)) return baseOnClickRight.call(this, event);
      // Any other viewer with an inspect entitlement → the reveal-gated dossier.
      if (this.actor && canInspect()) {
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

  // Effects Halo: show ALL of the actor's active effects (not just status conditions) as a ring of
  // round icon badges around the token, replacing the default corner stack (PF2e-style).
  patchEffectsHalo(TokenClass);

  // Register the system's status conditions (token HUD icons + Active Effects).
  // v14 keys CONFIG.statusEffects by id ({[id]: config}); v13 wants the array form.
  const statusConditions = PROJECTANIME.statusConditions.map((c) => ({ ...c }));
  CONFIG.statusEffects = Number(game.release?.generation ?? 0) >= 14
    ? Object.fromEntries(statusConditions.map((c) => [c.id, c]))
    : statusConditions;

  // SIDE INITIATIVE (Fire-Emblem phases): turn order is NOT rolled — a combatant's `initiative` is
  // assigned deterministically from its side band (config.mjs sideInitiative), so Foundry groups the
  // tracker Player → Enemy → Neutral. The formula is neutralized so any stray core roll path (or a
  // reset) can never scatter a combatant out of its band. See assignSideInitiative + the free-pick
  // state machine below.
  CONFIG.Combat.initiative = { formula: "0", decimals: 0 };

  // Turn advancement under SIDE INITIATIVE. Foundry's per-combatant `nextTurn` / `nextRound` are
  // repointed at the free-pick state machine (endActivation / forceNextRound below), so EVERY advance
  // path — the Anime HUD, the native tracker, a macro — runs the same phase logic: stamp the acting
  // unit done, auto-skip stunned/defeated, roll on to the next phase, and bump the round once all
  // three phases are spent. COMBO extra turns and the Stunned skip are handled inside that machine
  // (endActivation holds a comboing unit for a second action; reconcilePhase skips the stunned).
  const CombatClass = CONFIG.Combat.documentClass ?? Combat;
  if (!CombatClass.prototype._paNextTurnPatched) {
    CombatClass.prototype.nextTurn = async function () { await endActivation(this); return this; };
    CombatClass.prototype.nextRound = async function () { await forceNextRound(this); return this; };
    CombatClass.prototype._paNextTurnPatched = true;
  }

  // Document classes.
  CONFIG.Actor.documentClass = ProjectAnimeActor;
  CONFIG.Item.documentClass = ProjectAnimeItem;

  // System DataModels per sub-type.
  CONFIG.Actor.dataModels = {
    character: models.ProjectAnimeCharacter,
    npc: models.ProjectAnimeNPC,
    party: models.ProjectAnimeParty,
    merchant: models.ProjectAnimeMerchant
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
  // v14 removed the legacy model outright, so the opt-out only exists on v13.
  if (Number(game.release?.generation ?? 0) < 14) CONFIG.ActiveEffect.legacyTransferral = false;

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
  Actors.registerSheet("project-anime", ProjectAnimeMerchantSheet, {
    types: ["merchant"],
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

  game.keybindings.register("project-anime", "openQuestLog", {
    name: "PROJECTANIME.Keybindings.openQuestLog.name",
    hint: "PROJECTANIME.Keybindings.openQuestLog.hint",
    editable: [{ key: "KeyL" }],
    restricted: false,
    onDown: () => { Codex.open(); return true; }
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

// Foundry's default initiative roll posts a plain parchment card showing the raw tiebreak formula
// and a decimal total (1d4 + 1d4 + (4/100) + (1/1000) = 5.04). Reskin it into a themed system card —
// combatant name + just the whole-number result, no math. Every roll path funnels here (sheet
// button, the Anime-HUD roll buttons, the default tracker): core flags each such message
// `core.initiativeRoll`. updateSource rewrites the stored doc so the whole table sees the themed
// card; the combatant's precise initiative (set before the message) is left untouched.
Hooks.on("preCreateChatMessage", (message) => {
  if (!message.flags?.core?.initiativeRoll) return;
  const roll = message.rolls?.[0];
  if (!roll) return;
  const speaker = message.speaker ?? {};
  const actor = ChatMessage.getSpeakerActor?.(speaker) ?? null;
  const name = speaker.alias || actor?.name || game.i18n.localize("PROJECTANIME.Roll.initiative");
  const content = dice.cardHTML({
    title: name,
    subtitle: game.i18n.localize("PROJECTANIME.Roll.initiative"),
    icon: actor?.img ?? "",
    accent: dice.cardAccent(actor),
    lines: [`<span class="init-result">${Math.floor(Number(roll.total) || 0)}</span>`]
  });
  message.updateSource({ content, rolls: [], flavor: "", sound: CONFIG.sounds.dice });
});

/* -------------------------------------------- */
/*  Active Effect expiry                        */
/* -------------------------------------------- */

// v0.03 duration engine: a timed Active Effect (a Skill's Bolster/Hinder copy, a Conjure/Gate
// marker, an Overcome-immunity ward) counts down when its CREATOR'S side phase begins — decremented
// and deleted by runPhaseDurationTick (below), the same engine that runs Status conditions. There is
// no round-based / world-time expiry sweep any more: outside a Conflict Scene, durations don't tick
// (they last the Scene, then the combat-end scene sweep clears them). announceEffectExpired posts the
// themed line when the phase engine removes one.
function announceEffectExpired(actor, effect) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: dice.tickerHTML(game.i18n.format("PROJECTANIME.Effect.expired", { name: effect.name, actor: actor.name }))
  });
}

/* -------------------------------------------- */
/*  Combat turn-tick (Sustain / Channeled / Decay / Stunned) */
/* -------------------------------------------- */

/** A small themed chat line (no roll) announcing a turn-tick event — the ticker strip. */
function tickCard(actor, text) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: dice.tickerHTML(text)
  });
}

/** Lingering (stored id `decay`): 1 HP damage at the END of each of the bearer's turns while the
 *  status lasts. This is the FIRE only — its lifetime is the standard condition Duration (default 2
 *  rounds, a Skill's Duration overrides), counted down on the INFLICTER'S phase by the duration engine
 *  (runPhaseDurationTick), so Lingering expires like every other condition. */
async function tickDecay(actor) {
  if (!actor?.statuses?.has?.("decay")) return;

  const updates = {};
  // Pre-timer applications carry no countdown (the old build ran Lingering on its own 3-turn
  // counter flag): retire any legacy counter and stamp the standard default so it still expires.
  if (actor.getFlag("project-anime", "decay") !== undefined) updates["flags.project-anime.-=decay"] = null;
  // Retire the legacy typed-Lingering element flag (damage types are gone).
  if (actor.getFlag("project-anime", "decayType")) updates["flags.project-anime.-=decayType"] = null;
  const timers = actor.getFlag("project-anime", "statusTimers") ?? {};
  if (!("decay" in timers)) updates["flags.project-anime.statusTimers.decay"] = { n: 2, side: null };
  if (Object.keys(updates).length) await actor.update(updates);

  // The 1 HP fire goes through the single damage chokepoint so Barriers and a gated Villain's
  // Gate-break rules apply — a bare hp.value write would kill through an unbroken Gate.
  await dice.applyDamageTo(actor.uuid, 1, false, "hp");

  tickCard(actor, game.i18n.format("PROJECTANIME.Effect.decayTick", { name: actor.name }));
}

/** Start-of-turn recovery: ENERGY REGEN (rules: "At the start of each of your turns, clear 1
 *  energy box" — Unarmored clears 2; the data model derives `energyRegen`) plus every live
 *  `sustain`/Regen Active Effect (collectSustain). Clamped to each pool's max. */
async function tickSustain(actor) {
  // Defeated creatures (0 boxes) can't passively regenerate: recovery shuts off the moment HP
  // hits 0 and stays off until they're healed back above 0.
  if ((actor?.system?.hp?.value ?? 0) <= 0) return;
  // A Cursed creature cannot clear its cursed pool's boxes — that pool's recovery is suppressed.
  const cursed = cursedPools(actor);
  const gains = collectSustain(actor);
  // The universal Energy Regen (1, Unarmored 2) folds in with any effect-granted regen.
  gains.energy = (gains.energy ?? 0) + Math.max(0, Number(actor.system?.energyRegen) || PROJECTANIME.baseEnergyRegen);
  const updates = {};
  const parts = [];
  for (const pool of ["hp", "energy"]) {
    if (gains[pool] <= 0 || cursed.includes(pool)) continue;
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

/** Channeled Skills (rules v0.01: "This Skill remains active as long as you spend 1 EP at the
 *  Start of your Turn"): each open channel is a marker effect on the caster (stamped by dice.mjs
 *  when the Skill is used). At the start of the caster's turn, pay 1 EP per channel — can't pay
 *  → that channel ends (deleting the marker; the deleteActiveEffect hook below sweeps every
 *  effect copy carrying its key). Paying is a COST, not recovery, so Curse doesn't block it. */
async function tickChanneled(actor) {
  const markers = (actor?.effects ?? []).filter((e) => e.flags?.["project-anime"]?.channelSource);
  for (const m of markers) {
    const en = actor.system?.energy ?? { value: 0 };
    if ((en.value ?? 0) >= 1) {
      await actor.update({ "system.energy.value": en.value - 1 });
      tickCard(actor, game.i18n.format("PROJECTANIME.Effect.channelPay", { name: actor.name, skill: m.name }));
    } else {
      tickCard(actor, game.i18n.format("PROJECTANIME.Effect.channelEnd", { name: actor.name, skill: m.name }));
      await m.delete();   // → deleteActiveEffect hook sweeps the channel's copies
    }
  }
}

/** Remove every effect copy carrying a channel's key — from the combatants, the current scene's
 *  tokens, and world actors (a linked target may have left the scene). Fired when a channel
 *  marker is deleted for ANY reason: the EP tick ran dry, the player dismissed the Skill (rules
 *  v0.01: dismissing an ongoing Skill on your turn is free — deleting the marker IS the
 *  dismissal), or the end-of-combat scene sweep took it. GM-side only. */
async function sweepChannelCopies(channelKey) {
  if (!channelKey) return;
  const actors = new Set(game.actors);
  for (const c of game.combat?.combatants ?? []) if (c.actor) actors.add(c.actor);
  for (const t of canvas?.tokens?.placeables ?? []) if (t.actor) actors.add(t.actor);
  for (const actor of actors) {
    const linked = (actor.effects ?? []).filter((e) =>
      e.flags?.["project-anime"]?.channelKey === channelKey && !e.flags?.["project-anime"]?.channelSource
    ).map((e) => e.id);
    if (linked.length) await actor.deleteEmbeddedDocuments("ActiveEffect", linked);
  }
}

/** A conjured item evaporates with its lifetime marker (rules v0.01: Conjure makes something out
 *  of nothing — when the Skill's Duration ends, so does the something). Sweep every actor that
 *  could hold one. GM-side only. */
async function sweepConjuredItems(conjureKey) {
  if (!conjureKey) return;
  const actors = new Set(game.actors);
  for (const c of game.combat?.combatants ?? []) if (c.actor) actors.add(c.actor);
  // Every scene's token actors, not just the viewed one — an unlinked recipient elsewhere
  // must lose its conjuration too.
  for (const scene of game.scenes) for (const t of scene.tokens) if (t.actor) actors.add(t.actor);
  for (const actor of actors) {
    const ids = (actor.items ?? []).filter((i) => i.flags?.["project-anime"]?.conjured === conjureKey).map((i) => i.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
  }
}

/** A Gate's paired portal tiles close with their lifetime marker. GM-side only. */
async function sweepGateTiles(gateKey) {
  if (!gateKey) return;
  for (const scene of game.scenes) {
    const ids = scene.tiles.filter((t) => t.flags?.["project-anime"]?.gateKey === gateKey).map((t) => t.id);
    if (ids.length) await scene.deleteEmbeddedDocuments("Tile", ids);
  }
}

// A deleted channel marker takes its channel's effect copies with it; a deleted Conjure / Gate
// lifetime marker takes its conjured items / portal tiles (single active GM acts). A channeled
// Conjure/Gate chains naturally: the channel's end sweeps the lifetime marker (it carries the
// channel's key), and THAT deletion lands back here to sweep the items/tiles.
Hooks.on("deleteActiveEffect", (effect) => {
  if (game.users.activeGM?.id !== game.user.id) return;
  const flags = effect?.flags?.["project-anime"];
  if (flags?.channelSource && flags?.channelKey) sweepChannelCopies(flags.channelKey);
  if (flags?.conjureMarker) sweepConjuredItems(flags.conjureMarker);
  if (flags?.gateMarker) sweepGateTiles(flags.gateMarker);
});


/** Remove a timed Status when its Duration hits 0 (v0.03 duration engine): drop the condition and
 *  retire whatever it stashed — Lingering's legacy Element flag, a pool-choice
 *  status's pools (a valued Barrier / Regen or a Curse), a stamped Overcome CT — then post the themed
 *  "wore off" line. Shared by the phase-start engine. */
async function expireStatusOnActor(actor, id) {
  await actor.toggleStatusEffect?.(id, { active: false });
  if (id === "decay" && actor.getFlag("project-anime", "decayType")) {
    await actor.update({ "flags.project-anime.-=decayType": null });
  }
  if ((PROJECTANIME.poolChoiceStatuses ?? []).includes(id) && actor.getFlag("project-anime", id)) {
    await actor.update({ [`flags.project-anime.-=${id}`]: null });
  }
  if (id in (actor.getFlag("project-anime", "overcomeCT") ?? {})) {
    await actor.update({ [`flags.project-anime.overcomeCT.-=${id}`]: null });
  }
  tickCard(actor, game.i18n.format("PROJECTANIME.Effect.statusExpired", {
    status: game.i18n.localize(`PROJECTANIME.Status.${id}`), name: actor.name
  }));
}

/** DURATION ENGINE (v0.03 headline) — count down every timed effect a side created when THAT side's
 *  phase begins, on any target, and remove it at 0. ONE engine for both Status conditions (the
 *  per-target `statusTimers` flag, each stamped `{ n, side }` by dice.applyStatusTo) and timed Active
 *  Effects (Skill Bolster/Hinder copies, Conjure/Gate/Overcome markers, each stamped `creatorSide`).
 *  Duration N = N full rounds regardless of the target's side, because a side's effects only ever tick
 *  on that side's own phase. Fire timings (Regen at start-of-turn, Lingering at end-of-turn) are a
 *  SEPARATE concern and stay per-creature (runStartOfTurnTicks / runEndOfTurnTicks). Effects whose
 *  creator side is unknown — a legacy save, a hand-dragged Active Effect — fall back to the Player
 *  Phase so they still expire once per round. Channeled / Scene effects carry no round timer and never
 *  enter here. GM-side. */
async function runPhaseDurationTick(combat, side) {
  if (!combat || !side || game.users.activeGM?.id !== game.user.id) return;
  const isPlayerPhase = side === "friendly";
  const mine = (owner) => owner === side || ((owner ?? null) === null && isPlayerPhase);
  const actors = new Set();
  for (const c of combat.combatants) if (c.actor) actors.add(c.actor);
  for (const actor of actors) {
    // 1) Status conditions — decrement the ones this phase's side created; prune any gone stale.
    const timers = actor.getFlag("project-anime", "statusTimers");
    if (timers && Object.keys(timers).length) {
      const updates = {};
      const expired = [];
      for (const [id, raw] of Object.entries(timers)) {
        if (!actor.statuses?.has?.(id)) { updates[`flags.project-anime.statusTimers.-=${id}`] = null; continue; }
        const t = dice.normalizeTimer(raw);
        if (!mine(t.side)) continue;
        const n = t.n - 1;
        if (n <= 0) { updates[`flags.project-anime.statusTimers.-=${id}`] = null; expired.push(id); }
        else updates[`flags.project-anime.statusTimers.${id}`] = { n, side: t.side ?? null };
      }
      if (Object.keys(updates).length) await actor.update(updates);
      for (const id of expired) await expireStatusOnActor(actor, id);
    }
    // 2) Timed Active Effects — same rule (Scene / Channeled carry no round timer, so they're skipped).
    // The round count reads/writes through the v13 ↔ v14 duration helpers (effects.mjs): v14 replaced
    // the `rounds` field with `{value, units}`.
    const timed = actor.effects.filter((e) => {
      const f = e.flags?.["project-anime"];
      if (f?.scene || f?.channelKey) return false;
      const r = durationRounds(e);
      if (!Number.isFinite(r) || r <= 0) return false;
      return mine(f?.creatorSide ?? null);
    });
    for (const e of timed) {
      const n = durationRounds(e) - 1;
      if (n <= 0) { await e.delete(); await announceEffectExpired(actor, e); }
      // Re-anchor (v13) so Foundry's displayed `remaining` tracks the caster-keyed count.
      else await e.update(durationRoundsUpdate(n, combat));
    }
  }
}

/** Fire a side's phase-start countdown ONCE per (round, side): the mark is stamped on the combat so
 *  repeated reconciles within a phase don't re-tick, while a fresh round re-opens each phase. GM-side. */
async function maybeRunPhaseTick(combat, side) {
  if (!combat || !side) return;
  const mark = `${combat.round}:${side}`;
  if (combat.getFlag("project-anime", "durTickMark") === mark) return;
  await combat.setFlag("project-anime", "durTickMark", mark);
  await runPhaseDurationTick(combat, side);
}

/** True the FIRST time `key` is requested for a combatant TOKEN in the current round, recording it so a
 *  Boss with several combatant entries (which all share ONE token) — or a GM stepping the tracker — ticks
 *  ONCE PER ROUND PER CREATURE, not once per entry. Keyed on the token id (a flat document id): boss
 *  clones share it (deduped) while two distinct tokens of the same base actor key separately (each ticks).
 *  Token ids carry no dots, so they're safe as flag-map keys (an actor UUID would be mangled by Foundry's
 *  dotted-path flattening). High-water — the round only advances. Scoped to this combat. GM-side caller. */
async function tickOncePerRound(combat, key, tokenId) {
  if (!tokenId) return true;
  const map = combat.getFlag("project-anime", key) ?? {};
  if ((Number(map[tokenId]) || 0) >= combat.round) return false;
  await combat.setFlag("project-anime", key, { ...map, [tokenId]: combat.round });
  return true;
}

/* -------------------------------------------- */
/*  Side Initiative — free-pick state machine   */
/* -------------------------------------------- */

/** Deterministically (re)assign each combatant's `initiative` to its side band (config.sideInitiative),
 *  so the tracker groups Player → Enemy → Neutral with no dice roll. `ids` limits the write to specific
 *  combatants (a fresh join / a disposition flip); omitted = the whole encounter. GM-side. */
async function assignSideInitiative(combat, ids = null) {
  if (!combat || game.users.activeGM?.id !== game.user.id) return;
  const list = ids ? ids.map((i) => combat.combatants.get(i)).filter(Boolean) : [...combat.combatants];
  const updates = list
    .filter((c) => c.initiative !== sideInitiative(c))
    .map((c) => ({ _id: c.id, initiative: sideInitiative(c) }));
  if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
}

/** Start-of-activation ticks for one unit (Sustain regen + Channeled upkeep), once per round per token. */
async function runStartOfTurnTicks(combat, c) {
  const actor = c?.actor;
  if (!actor) return;
  if (await tickOncePerRound(combat, "sustainTicks", c.tokenId)) {
    await tickSustain(actor);
    await tickChanneled(actor);
  }
}

/** End-of-activation FIRE tick for one unit (Lingering's 1 HP), once per round per token. Called
 *  explicitly when a unit's turn ends (free-pick has no reliable `combat.previous`). Duration COUNTDOWN
 *  no longer lives here (v0.03): it moved to the creator-keyed phase-start engine (runPhaseDurationTick),
 *  so a status ends by its inflicter's phase, not the bearer's own turn. Only the fire stays per-creature. */
async function runEndOfTurnTicks(combat, c) {
  const actor = c?.actor;
  if (!actor) return;
  if (await tickOncePerRound(combat, "endTicks", c.tokenId)) {
    await tickDecay(actor);
  }
}

/** True for a GATED Villain combatant (rules: Villains → Gates — it acts twice per Enemy Phase). */
function isGatedVillainCombatant(c) {
  return c?.actor?.type === "npc" && !!c.actor.system?.gates?.enabled;
}

/** Clear every combatant's per-round markers (`actedRound` + the Villain `villainTurns` counter) — run
 *  when a fresh round begins so the flags stay tidy and a gated Villain's turns reset. */
async function clearActedMarkers(combat) {
  const updates = [];
  for (const c of combat.combatants) {
    const patch = { _id: c.id };
    let dirty = false;
    if (c.getFlag("project-anime", "actedRound") != null) { patch["flags.project-anime.-=actedRound"] = null; dirty = true; }
    if (c.getFlag("project-anime", "villainTurns") != null) { patch["flags.project-anime.-=villainTurns"] = null; dirty = true; }
    if (c.getFlag("project-anime", "bossTurns") != null) { patch["flags.project-anime.-=bossTurns"] = null; dirty = true; }
    if (dirty) updates.push(patch);
  }
  if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
}

/** PUT A UNIT ON (free-pick): make `id` the acting combatant, if it's a valid, un-acted, actable unit on
 *  the currently-active side. Points `turn` at it (so combat.combatant is the roller — Combo reads it —
 *  and the UI lights the row), then fires its start-of-turn ticks explicitly. GM-side. */
async function activateCombatant(combat, id) {
  if (!combat || game.users.activeGM?.id !== game.user.id) return;
  const c = combat.combatants.get(id);
  if (!c || hasActed(c, combat.round) || isSkippable(c)) return;
  if (combatantSide(c) !== activeSide(combat)) return;   // only the active phase may act
  const idx = combat.turns.findIndex((t) => t.id === id);
  if (idx >= 0 && combat.turn !== idx) await combat.update({ turn: idx });
  await runStartOfTurnTicks(combat, c);                  // Sustain + Channeled upkeep (once per round per token)
}

/** END THE ACTING UNIT'S TURN (or a given unit's): a COMBO holds it for a second action; otherwise its
 *  end-of-turn ticks fire, it's marked done for the round, and the phase reconciles. With nothing active,
 *  this is a plain "advance" — auto-pick the top pending unit of the active side. GM-side. */
async function endActivation(combat, id = combat.combatant?.id) {
  if (!combat?.started || game.users.activeGM?.id !== game.user.id) return;
  const c = id ? combat.combatants.get(id) : null;

  // A valid, actable unit is ending its turn: honor a Combo hold, else run its end-of-turn ticks, mark
  // it done, and reconcile. Guard isSkippable/hasActed so an explicit id (a socket relay or a stale UI
  // click) can never fire Lingering/status ticks on a defeated/stunned/already-acted unit.
  if (c && !isSkippable(c) && !hasActed(c, combat.round)) {
    // Combo (rules p.13): a Combo scored on this unit's own turn holds it for one more action (no chain —
    // comboGranted blocks a second grant). maybeGrantComboTurn (dice.mjs) set the round-stamped flag.
    const comboKey = `${c.id}:${combat.round}`;
    if (combat.getFlag("project-anime", "comboTurn") === comboKey) {
      await combat.update({
        "flags.project-anime.-=comboTurn": null,
        "flags.project-anime.comboGranted": comboKey
      });
      if (c.actor) ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: c.actor }),
        content: dice.tickerHTML(game.i18n.format("PROJECTANIME.Effect.comboTurn", { name: c.actor.name }), { variant: "gold", icon: "fa-forward" })
      });
      return;                                            // stays the acting unit for a 2nd action
    }
    await runEndOfTurnTicks(combat, c);
    // Gated Villain (rules: Villains → Gates) — "The Villain acts twice per Energy Phase". Count this
    // activation; leave it un-acted (still pickable this phase) until it has spent both actions.
    if (isGatedVillainCombatant(c)) {
      const used = (Number(c.getFlag("project-anime", "villainTurns")) || 0) + 1;
      const allowed = Math.max(1, Number(PROJECTANIME.villain?.actionsPerPhase) || 2);
      await c.setFlag("project-anime", "villainTurns", used);
      if (used < allowed) return reconcilePhase(combat);   // a second action remains → the phase re-offers it
    }
    await c.setFlag("project-anime", "actedRound", combat.round);
    return reconcilePhase(combat);
  }

  // Nobody actable is up (turn parked at null) → the GM "advance" auto-picks the top pending unit of the
  // active side. Otherwise the target is defeated/stunned/already-acted (a stale relay) → just reconcile.
  if (!c) {
    const side = activeSide(combat);
    const top = side ? pendingOnSide(combat, side).find((x) => !isSkippable(x)) : null;
    if (top) return activateCombatant(combat, top.id);
  }
  return reconcilePhase(combat);
}

/** Reconcile the phase after a unit ends: drop the now-spent "current" so the active side is free to
 *  pick, and when all three phases are done bump the round and reopen Player Phase. `turn: null` =
 *  "nobody up" — the active side free-picks; no phantom current lingers across a phase boundary or at
 *  round start. GM-side. */
async function reconcilePhase(combat) {
  if (!combat || game.users.activeGM?.id !== game.user.id) return;
  for (let guard = 0; guard < 8; guard++) {
    const side = activeSide(combat);
    if (side) {                                          // the active phase awaits a pick
      const cur = combat.combatant;
      if (!cur || hasActed(cur, combat.round) || combatantSide(cur) !== side) {
        if (combat.turn !== null) await combat.update({ turn: null });   // drop the spent / off-phase current
      }
      // The phase has OPENED — count down every Duration this side created before it acts.
      await maybeRunPhaseTick(combat, side);
      return;
    }
    await clearActedMarkers(combat);                     // round complete → next round, Player Phase, loop
    await combat.update({ round: combat.round + 1, turn: null });
  }
}

/** Force the encounter to the next round immediately (the GM "next round" control / native nextRound). */
async function forceNextRound(combat) {
  if (!combat?.started || game.users.activeGM?.id !== game.user.id) return;
  await clearActedMarkers(combat);
  await combat.update({ round: combat.round + 1, turn: null });
  await reconcilePhase(combat);
}

/** Initialize Side Initiative at combat start — fired off the post-update `updateCombat(round→1)`, AFTER
 *  core's `update({round:1,turn:0})` so it doesn't race. Assign side bands, clear markers, park `turn` at
 *  null so the whole Player side is free to pick, and reconcile (auto-skip any pre-stunned units). */
async function startSideInitiative(combat) {
  if (!combat || game.users.activeGM?.id !== game.user.id) return;
  await resetEncounterState(combat, { bars: true });
  await assignSideInitiative(combat);
  await clearActedMarkers(combat);
  if (combat.turn !== null) await combat.update({ turn: null });
  await reconcilePhase(combat);
}

/** Reset per-encounter (1/Conflict) state on every combatant actor — and, at combat START, reset any
 *  gated Villain to its first Gate so a re-used Villain token is fresh. Deduped per actor. GM-side. */
async function resetEncounterState(combat, { bars = false } = {}) {
  if (!combat || game.users.activeGM?.id !== game.user.id) return;
  const seen = new Set();
  for (const c of combat.combatants) {
    const a = c.actor;
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    await dice.resetConflictUses(a);
    if (bars && a.type === "npc" && a.system.gates?.enabled && (a.system.gates.hb?.length ?? 0) > 0) {
      await a.update({
        "system.gates.broken": 0,
        "system.hp.value": Math.max(1, Number(a.system.gates.hb[0]) || 1)
      });
    }
  }
}

// Under Side Initiative every per-turn tick is fired EXPLICITLY by the state machine — start-of-turn
// (Sustain + Channeled) from activateCombatant, end-of-turn (Lingering + status countdown) from
// endActivation, and both for an auto-skipped Stunned unit from reconcilePhase — each guarded once per
// round per token by tickOncePerRound. So there is no `updateCombat` turn-tick listener to mis-fire on an
// incidental `turn` shift (e.g. Foundry re-indexing after a combatant is removed).

// SIDE INITIATIVE wiring. Assign side-initiative bands when an encounter or a combatant is created, and
// re-band on a `side` override change, so the tracker groups Player → Enemy → Neutral with no roll. At the
// START of round 1 (post-update, after core's start `update({round:1,turn:0})` so we win the race) run
// startSideInitiative to park `turn` at null (the Player side free-picks). A disposition flip is re-banded
// by the updateToken watcher further below.
Hooks.on("createCombat", (combat) => assignSideInitiative(combat));
Hooks.on("createCombatant", (combatant) => assignSideInitiative(combatant.parent, [combatant.id]));
Hooks.on("updateCombatant", (combatant, change) => {
  if (foundry.utils.hasProperty(change, "flags.project-anime.side")) assignSideInitiative(combatant.parent, [combatant.id]);
});
Hooks.on("updateCombat", (combat, change) => {
  if (change?.round === 1 && game.users.activeGM?.id === game.user.id) startSideInitiative(combat);
});
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
  // Backstop for DIRECT hp writes (sheet mark boxes, token-bar edits) on a gated Villain:
  // dropping to 0 with unbroken Gates is a Gate BREAK, not a defeat. applyDamageTo never writes
  // 0 here mid-Gates, and its final-defeat update bakes gates.broken = hb.length in the same
  // change, so this only catches writes that bypassed the chokepoint.
  const gates = actor.type === "npc" ? actor.system?.gates : null;
  if (defeated && gates?.enabled && (gates.hb?.length ?? 0) > 0
    && (Number(gates.broken) || 0) < gates.hb.length - 1) {
    dice.breakGate(actor);
    return;
  }
  let crossed = false;
  for (const c of game.combat?.combatants ?? []) {
    if (c.actor?.uuid !== actor.uuid || c.defeated === defeated) continue;
    c.update({ defeated });
    crossed = true;
    // Auto-hide a defeated Hostile token (and reveal it again if it's healed back above 0). Only
    // Hostile tokens vanish: player characters (FRIENDLY) are downed, not removed; friendly /
    // neutral NPCs stay on the board. NPCs default Hostile.
    const tok = c.token;
    if (tok && tok.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE
        && tok.hidden !== defeated) tok.update({ hidden: defeated });
  }
  if (defeated && crossed) {
    tickCard(actor, game.i18n.format("PROJECTANIME.Effect.defeated", { name: actor.name }));
    maybeTakeWound(actor);
  }
}
Hooks.on("updateActor", markDefeatedFromHP);

/** Wounds (rules: Wounds) — the FIRST time a character is Defeated in a Conflict Scene they take
 *  a Wound, locking one hit box until a Town clears it. Only Player Characters (and Companions)
 *  take Wounds; enemies are simply Defeated. Once per combat, tracked by a combat-id flag. */
async function maybeTakeWound(actor) {
  const combat = game.combat;
  if (!combat?.started || actor?.type !== "character") return;
  if (actor.getFlag("project-anime", "woundedConflict") === combat.id) return;
  const wounds = [...(actor.system.wounds ?? []), { id: foundry.utils.randomID(), note: "" }];
  await actor.update({ "system.wounds": wounds, "flags.project-anime.woundedConflict": combat.id });
  tickCard(actor, game.i18n.format("PROJECTANIME.Effect.woundTaken", { name: actor.name, n: wounds.length }));
  if (wounds.length >= 3) tickCard(actor, game.i18n.format("PROJECTANIME.Effect.woundBar", { name: actor.name }));
}

// Stash the pre-update HP so the Critical watcher below can tell a CROSSING from a re-assertion.
Hooks.on("preUpdateActor", (actor, changes, options) => {
  if (foundry.utils.getProperty(changes, "system.hp.value") !== undefined) {
    options.paPrevHp = Number(actor.system?.hp?.value ?? 0);
  }
});

/** Critical (v0.03): dropping to 25% max HP or below (rounded down) is a state some Skills key
 *  off. On the crossing, whisper the owner + GM — listing the bearer's "Critical"-trigger React
 *  Skills so the moment they fire on isn't missed. GM-side only. */
function noteCriticalFromHP(actor, changes, options) {
  if (game.users.activeGM?.id !== game.user.id) return;
  const hp = foundry.utils.getProperty(changes, "system.hp.value");
  const prev = options?.paPrevHp;
  if (hp === undefined || prev === undefined) return;
  if (actor.type !== "character" && actor.type !== "npc") return;
  const threshold = Math.floor((actor.system?.hp?.max ?? 0) * 0.25);
  const wasCritical = prev > 0 && prev <= threshold;
  if (!actor.system?.critical || wasCritical) return;
  const reacts = actor.items
    .filter((i) => i.type === "skill" && i.system?.actionType === "react" && i.system?.trigger === "critical")
    .map((i) => i.name);
  const content = dice.tickerHTML(game.i18n.format("PROJECTANIME.Effect.criticalEntered", { name: actor.name }), {
    variant: "boss",
    icon: "fa-heart-crack",
    sub: reacts.length ? game.i18n.format("PROJECTANIME.Effect.criticalReacts", { skills: reacts.join(", ") }) : ""
  });
  ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: [...game.users.filter((u) => u.isGM || actor.testUserPermission(u, "OWNER")).map((u) => u.id)]
  });
}
Hooks.on("updateActor", noteCriticalFromHP);

/* -------------------------------------------- */
/*  Phase banner (side initiative)              */
/* -------------------------------------------- */

// The last side each CLIENT saw for the active combat — the banner fires on the flip. Seeded at
// ready so a mid-combat reload doesn't replay the current phase's banner.
let paLastBannerSide = null;

/** Sweep a PLAYER PHASE / ENEMY PHASE / NEUTRAL PHASE band across the screen (Fire-Emblem style).
 *  Pure DOM overlay — styles + keyframes live in css (.pa-phase-banner); the node removes itself
 *  on the exit animation (pa-phase-out) with a timeout fallback. Per-user off-switch. */
function showPhaseBanner(side) {
  if (!side || !game.settings.get("project-anime", PHASE_BANNER_CLIENT_SETTING)) return;
  document.querySelector(".pa-phase-banner")?.remove();
  const el = document.createElement("div");
  el.className = "pa-phase-banner";
  el.dataset.side = side;
  const band = document.createElement("div");
  band.className = "pa-phase-banner__band";
  // Sides are "friendly"/"hostile"/"neutral" — sideLabel maps them onto the phase lang keys.
  band.textContent = game.i18n.localize(PROJECTANIME.sideLabel[side] ?? "");
  el.appendChild(band);
  document.body.appendChild(el);
  el.addEventListener("animationend", (ev) => { if (ev.animationName === "pa-phase-out") el.remove(); });
  setTimeout(() => el.remove(), 2200);
}

Hooks.on("updateCombat", (combat, changes) => {
  if (combat !== game.combat || !combat.started) return;
  if (!("round" in (changes ?? {})) && !("turn" in (changes ?? {}))) return;
  const side = activeSide(combat);
  if (side === paLastBannerSide) return;
  paLastBannerSide = side;
  showPhaseBanner(side);
});
Hooks.on("deleteCombat", (combat) => { if (combat === game.combat || !game.combat) paLastBannerSide = null; });
Hooks.once("ready", () => { paLastBannerSide = game.combat?.started ? activeSide(game.combat) : null; });

/** End of combat (rules: After Combat): ALL energy boxes clear immediately; hit boxes do NOT
 *  clear — except any character still Defeated clears half their hit boxes, rounded up. Hostile
 *  tokens auto-hidden at defeat STAY hidden. Also clears the per-conflict wound marker. GM-side. */
async function recoverDefeatedOnCombatEnd(combat) {
  if (game.users.activeGM?.id !== game.user.id) return;
  const seen = new Set();
  for (const c of combat.combatants ?? []) {
    const actor = c.actor;
    if (!actor || seen.has(actor.uuid)) continue;
    if (actor.type !== "character" && actor.type !== "npc") continue;
    seen.add(actor.uuid);
    const updates = {};
    const en = actor.system.energy ?? { value: 0, max: 0 };
    if ((en.value ?? 0) < (en.max ?? 0)) updates["system.energy.value"] = en.max;
    const hp = actor.system.hp ?? { value: 0, max: 0 };
    let healed = null;
    if ((hp.value ?? 0) <= 0) {
      healed = Math.max(1, Math.ceil((hp.max ?? 0) / 2));
      updates["system.hp.value"] = healed;
    }
    if (actor.getFlag("project-anime", "woundedConflict")) updates["flags.project-anime.-=woundedConflict"] = null;
    if (Object.keys(updates).length) await actor.update(updates);
    if (healed != null) tickCard(actor, game.i18n.format("PROJECTANIME.Effect.recovered", { name: actor.name, hp: healed }));
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

/** End of combat: clear every combatant's 1/Conflict Skill ledger — a new Conflict re-grants the uses. */
async function clearConflictUsesOnCombatEnd(combat) {
  if (game.users.activeGM?.id !== game.user.id) return;
  const seen = new Set();
  for (const c of combat.combatants ?? []) {
    const actor = c.actor;
    if (!actor || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    await dice.resetConflictUses(actor);
  }
}
Hooks.on("deleteCombat", clearConflictUsesOnCombatEnd);

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
/*  Aura Skills (passive area buff)             */
/* -------------------------------------------- */

// A passive Skill carrying the "Aura" Modifier continuously grants its Effect(s) to allies within
// PROJECTANIME.auraTiles of the bearer. The single active GM reconciles the projected effects for the
// whole canvas (helpers/aura.mjs); we just nudge it whenever the picture could change. Debounced so a
// burst of related updates collapses into one pass.
// syncAuras() reconciles the projected effects (GM-only, internally gated); the field overlay redraws
// the on-canvas rings for THIS client. Both hang off the same triggers below, so a ring appears/moves
// exactly when the field it represents does.
const refreshAuras = foundry.utils.debounce(() => { syncAuras(); globalThis.projectanime?.auraField?.refresh(); }, 100);

// Token movement / visibility / side changes shift who's inside an aura.
Hooks.on("updateToken", (doc, changes) => {
  if ("x" in changes || "y" in changes || "hidden" in changes || "disposition" in changes) refreshAuras();
  // A disposition flip mid-combat moves the token's combatant(s) to a different phase — re-band their
  // side-initiative and reconcile (a unit switching sides can change which phase is active). GM-side.
  if ("disposition" in changes && game.users.activeGM?.id === game.user.id) {
    const combat = game.combat;
    const ids = combat?.combatants?.filter((c) => c.tokenId === doc.id).map((c) => c.id) ?? [];
    if (ids.length) assignSideInitiative(combat, ids).then(() => { if (combat.started) reconcilePhase(combat); });
  }
});
Hooks.on("createToken", refreshAuras);
Hooks.on("deleteToken", refreshAuras);
// A bearer crossing 0 HP switches its aura off (and back on when healed above 0).
Hooks.on("updateActor", (actor, changes) => { if (foundry.utils.hasProperty(changes, "system.hp.value")) refreshAuras(); });
// Learning / editing / removing an Aura Skill (its Modifiers, Effect, or Action Type) changes what's projected.
Hooks.on("createItem", (item) => { if (item.type === "skill") refreshAuras(); });
Hooks.on("updateItem", (item) => { if (item.type === "skill") refreshAuras(); });
Hooks.on("deleteItem", (item) => { if (item.type === "skill") refreshAuras(); });
// Editing an Aura Skill's authored Effect re-projects it — but ignore our OWN projected copies (they
// carry the aura flag), or creating/deleting them in the reconcile would loop back here.
const onAuraEffectChange = (effect) => { if (!isAuraEffect(effect)) refreshAuras(); };
Hooks.on("createActiveEffect", onAuraEffectChange);
Hooks.on("updateActiveEffect", onAuraEffectChange);
Hooks.on("deleteActiveEffect", onAuraEffectChange);
// Initial pass + on every scene change (the new scene's tokens reconcile fresh).
Hooks.on("canvasReady", refreshAuras);

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
  label.visible = true;                                 // re-show after an HP/EP-visibility gate
}

// Override of Token#_drawBar (see the `init` patch). `number` 0 = bar1 (HP), 1 = bar2 (Energy) —
// the system maps both via system.json's primary/secondaryTokenAttribute. Both bars are placed at
// the bottom, inset, with HP stacked directly above Energy.
function paDrawBar(number, bar, data) {
  const doc = this.document;
  // HP/EP visibility gate — canSeeTokenVitals (shared with the hover panel + dossier). If this
  // viewer may not see vitals, draw nothing and hide the cached label; re-shown when allowed again.
  if (!canSeeTokenVitals(this)) {
    bar.clear();
    if (bar.paLabel) bar.paLabel.visible = false;
    return false;
  }
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
  // The Party planner has no token / combat stats — leave its prototype token at core defaults,
  // but default it to OBSERVER for everyone so the whole table can open the shared party sheet.
  // (updateSource merges, so the creating user's OWNER entry is preserved; the GM can raise a
  // player to Owner if they want them managing the Stash.)
  if (actor.type === "party") {
    actor.updateSource({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER });
    return;
  }
  // A Merchant is a shop, not a combatant — no vision, a neutral linked token (stock lives
  // on the actor, so every placed token sells from the same shelf), and OBSERVER default so
  // any player can open the shop and buy.
  if (actor.type === "merchant") {
    actor.updateSource({
      "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
      prototypeToken: {
        actorLink: data?.prototypeToken?.actorLink ?? true,
        displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
        disposition: data?.prototypeToken?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL,
        lockRotation: data?.prototypeToken?.lockRotation ?? true
      }
    });
    return;
  }
  const isChar = actor.type === "character";
  const DISP = CONST.TOKEN_DISPOSITIONS;
  const dispMap = { friendly: DISP.FRIENDLY, neutral: DISP.NEUTRAL, hostile: DISP.HOSTILE };
  actor.updateSource({
    prototypeToken: {
      // Respect an explicitly-provided link (raised servants / bonded companions are linked
      // NPCs — their advancement must flow to the placed token); otherwise PCs link, NPCs don't.
      actorLink: data?.prototypeToken?.actorLink ?? isChar,
      sight: { enabled: isChar },
      displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
      displayName: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
      // Lock rotation by default so token art never spins (the system also defaults core's
      // "Automatic Token Rotation" off); respect an explicit value on import / duplication.
      lockRotation: data?.prototypeToken?.lockRotation ?? true,
      disposition: data?.prototypeToken?.disposition
        ?? (isChar ? DISP.FRIENDLY : (dispMap[data?.system?.disposition] ?? DISP.HOSTILE))
    }
  });
  // Unarmed Strikes are RETIRED (attacks come from Weapon Styles): scrub any Natural Attack
  // riding in on an import or duplication — e.g. an actor from a pre-0.6.2 compendium.
  const items = actor._source.items ?? [];
  const scrubbed = items.filter((i) => !foundry.utils.getProperty(i, "flags.project-anime.natural"));
  const update = {};
  if (scrubbed.length !== items.length) update.items = scrubbed;
  // Player Characters default to LIMITED ownership for everyone, so all players can at least see
  // each PC at a glance. (updateSource merges, so the creating user's OWNER entry is preserved;
  // NPCs stay GM-only.) The GM can still raise a specific player to Owner of their own PC.
  if (isChar) update["ownership.default"] = CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
  if (Object.keys(update).length) actor.updateSource(update);
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

// Every world ships with a Party (PF2e-style). On first ready per world, if none exists yet, seed
// a starter one — the createActor hook above backs it with its folder, and the directory hook below
// pins that folder to the top with an "open sheet" icon. Flagged provisioned so it runs exactly
// once: a GM who later deletes the party isn't fighting a respawn on the next load.
async function ensureDefaultParty() {
  if (!paIsActiveGM() || game.settings.get("project-anime", DEFAULT_PARTY_SETTING)) return;
  if (!game.actors.some((a) => a.type === "party")) {
    await Actor.create({
      name: game.i18n.localize("PROJECTANIME.Party.defaultName"),
      type: "party",
      img: "icons/svg/team.svg"
    });
  }
  await game.settings.set("project-anime", DEFAULT_PARTY_SETTING, true);
}

// A party's roster IS its folder's Characters, so nearly everything the sheet displays lives on
// OTHER documents — a member's folder/HP/gear, a Companion's boxes — never the party Document,
// and the open party sheet won't refresh on its own. Re-render any open party sheet whenever a
// character or NPC changes. Debounced so bursts (ensurePartyFolder's party + legacy members,
// a combat round of updates) collapse into a single render. Pure local refresh — runs for every
// user with a party sheet open (players included), no GM gate.
const refreshOpenPartySheets = foundry.utils.debounce(() => {
  for (const app of foundry.applications.instances.values())
    if (app instanceof ProjectAnimePartySheet) app.render(false);
}, 50);
// Characters and NPCs both matter to an open party sheet (members + the Companions strip); any
// system change re-renders it (debounced) so the Hit/Energy box strips track live damage.
Hooks.on("updateActor", (actor, changes) => {
  if (actor.type !== "character" && actor.type !== "npc") return;
  if ("folder" in changes || "name" in changes || "img" in changes || changes.system !== undefined || changes.flags !== undefined) refreshOpenPartySheets();
});
Hooks.on("createActor", (actor) => { if (actor.type === "character" || actor.type === "npc") refreshOpenPartySheets(); });
Hooks.on("deleteActor", (actor) => { if (actor.type === "character" || actor.type === "npc") refreshOpenPartySheets(); });

// A merchant sheet shows the viewer's purse (their character's Gold) and per-patron prices;
// those live on ANOTHER document, so nudge any open shop when a character's gold changes.
Hooks.on("updateActor", (actor, changes) => {
  if (actor.type !== "character" || !foundry.utils.hasProperty(changes, "system.gold")) return;
  for (const app of foundry.applications.instances.values())
    if (app instanceof ProjectAnimeMerchantSheet) app.render(false);
});

// Open the Party sheet most relevant to this user: for a player, the party whose folder holds a
// character they own; otherwise (and for the GM) the first party they can view. Backs both the
// "P" keybinding and the folder icon below.
function openPartySheetForUser() {
  const parties = game.actors.filter((a) => a.type === "party" && a.testUserPermission(game.user, "LIMITED"));
  if (!parties.length) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Party.none"));
  const mine = !game.user.isGM && parties.find((p) => partyMembers(p).some((m) => m.isOwner));
  (mine || parties[0]).sheet.render(true);
}

// Present each Party as JUST its folder in the Actors sidebar (PF2e-style). The party actor has no
// character sheet of its own — only a compact Stash / Gold / encounter popup — so:
//   • HIDE the party actor's own directory entry: the folder, not a stray actor row, IS the party.
//   • PIN the folder to the TOP of its list — no matter the directory's sort mode (the `sort:
//     -100000` set at creation only bites in MANUAL mode; under alphabetical sorting it's ignored,
//     so the folder would otherwise drift). Re-applied on every render, so it can't drift.
//   • Drop a one-click icon on the folder header (for users who can view it) that opens the popup.
//     The folder's Characters already ARE the roster, so this is the party's home.
// Pure DOM, so it runs for everyone (the hide + pin have no GM gate; the icon is permission-gated).
Hooks.on("renderActorDirectory", (app, element) => {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  // Reversed so that after each prepend the directory's first party ends up topmost.
  for (const party of game.actors.filter((a) => a.type === "party").reverse()) {
    // The party reads as a folder, not an actor — drop its own entry from the directory.
    root.querySelector(`li[data-entry-id="${party.id}"], li[data-document-id="${party.id}"]`)?.remove();

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
  // Open the CODEX (the quest log) — available to everyone; the GM additionally authors here.
  tools["project-anime-codex"] = {
    name: "project-anime-codex",
    order: 99,
    title: "PROJECTANIME.Codex.open",
    icon: "fa-solid fa-book-open",
    button: true,
    onChange: () => Codex.open()
  };
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
/*  Talent items → actor data (v0.5.1)          */
/* -------------------------------------------- */

// Talents live on the actor now (`system.talents`, Daggerheart-Experience-style — no item
// sheet). The `talent` Item type is unregistered, so any survivor is an invalid document:
// read the raw source and convert each into a `system.talents` row KEYED BY THE OLD ITEM ID,
// so weapon/Technique `talentId` links and advancement-ledger refs keep resolving, then delete
// the items. Standalone world talents have no actor to land on — deleted. Idempotent.
async function migrateTalentsToActorData() {
  for (const a of game.actors ?? []) {
    if (a.type !== "character" && a.type !== "npc") continue;
    const rows = (a._source?.items ?? []).filter((i) => i.type === "talent");
    if (!rows.length) continue;
    const upd = {};
    for (const r of rows) {
      upd[`system.talents.${r._id}`] = {
        name: r.name ?? "",
        die: Number(r.system?.die) || 4,
        attribute: r.system?.attribute in PROJECTANIME.attributes ? r.system.attribute : "might"
      };
    }
    await a.update(upd);
    await a.deleteEmbeddedDocuments("Item", rows.map((r) => r._id));
    console.log(`Project: Anime | Migrated ${rows.length} Talent item(s) → actor data on "${a.name}".`);
  }
  const worldTalents = [...game.items.invalidDocumentIds].filter((id) => game.items.getInvalid(id)?.type === "talent");
  if (worldTalents.length) await Item.deleteDocuments(worldTalents);
}

/* -------------------------------------------- */
/*  Version 2 actor migration (one-time)        */
/* -------------------------------------------- */

// V2: every actor re-baselines to the box model (the data model's migrateData collapses the old
// numeric pools in memory; this bakes it). The V2 Type-line stamping this once performed is
// retired — enemies are Tier × EXP builds now, and migrateEnemyTiersV1 below finishes any world
// jumping straight here. GM-side, once per world.
async function migrateActorsV2() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", ACTORS_V2_SETTING)) return;
  let count = 0;
  for (const actor of game.actors) {
    if (actor.type !== "character" && actor.type !== "npc") continue;
    const upd = { _id: actor.id };
    upd["system.hp.max"] = Math.clamp(actor.system.hp.max + (actor.system.woundCount ?? 0), 1, PROJECTANIME.maxBoxes);
    upd["system.hp.value"] = Math.clamp(actor.system.hp.value, 0, PROJECTANIME.maxBoxes);
    upd["system.energy.max"] = Math.clamp(actor.system.energy.base ?? actor.system.energy.max, 0, PROJECTANIME.maxBoxes);
    upd["system.energy.value"] = Math.clamp(actor.system.energy.value, 0, PROJECTANIME.maxBoxes);
    await actor.update(upd);
    count++;
  }
  console.log(`Project: Anime | V2 actor migration — re-baselined ${count} actor(s) to the box model.`);
  await game.settings.set("project-anime", ACTORS_V2_SETTING, true);
}

/* -------------------------------------------- */
/*  Enemy Tiers migration (one-time)            */
/* -------------------------------------------- */

// Tier × EXP enemies: persist what the NPC data model now migrates in memory — retired V2 Type
// keys fold into the Tier ladder (bruiser → elite; skirmisher/support → standard), a Boss
// becomes a Villain whose Bars carry over as Gates, a Rival becomes a Villain without Gates —
// and the retired `boss`/`rival` source keys are dropped. Runs over world NPCs and any unlocked
// NPC compendium of this world. GM-side, once per world.
async function migrateEnemyTiersV1() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", ENEMY_TIERS_SETTING)) return;
  let count = 0;
  const migrateOne = async (actor) => {
    if (actor.type !== "npc") return;
    // NOTE: actor._source is NOT raw DB data — the model's migrateData already rewrote it in
    // memory (npcType mapped, boss folded into gates). So never diff against it to decide what
    // to persist: bake the in-memory values unconditionally with diff:false (a normal diff
    // would compare against the same migrated values and strip everything).
    const src = actor._source.system ?? {};
    const hadLegacy = src.boss !== undefined || src.rival !== undefined || src.enemyRole !== undefined;
    const meaningful = hadLegacy || (actor.system.npcType ?? "") !== "" || !!actor.system.gates?.enabled;
    if (!meaningful) return;
    const upd = {
      "system.npcType": actor.system.npcType ?? "",
      "system.gates": {
        enabled: !!actor.system.gates?.enabled,
        hb: [...(actor.system.gates?.hb ?? [])],
        broken: Number(actor.system.gates?.broken) || 0
      }
    };
    if (src.boss !== undefined) upd["system.-=boss"] = null;
    if (src.rival !== undefined) upd["system.-=rival"] = null;
    if (src.enemyRole !== undefined) upd["system.-=enemyRole"] = null;
    await actor.update(upd, { diff: false });
    count++;
  };
  for (const actor of game.actors) await migrateOne(actor);
  for (const pack of game.packs) {
    if (pack.metadata.type !== "Actor" || pack.locked) continue;
    for (const actor of await pack.getDocuments()) await migrateOne(actor);
  }
  console.log(`Project: Anime | Enemy Tiers migration — converted ${count} NPC(s) to the Tier × EXP model.`);
  await game.settings.set("project-anime", ENEMY_TIERS_SETTING, true);
}

// V2: re-base every EXISTING world/actor-owned weapon, armor, and shield to the Style tables
// (the packs are reconciled separately by auditGearPacks). Renamed items ("Katana") are found
// through their compendium origin (_stats.compendiumSource → pack index name); items with no
// origin match by name. GM homebrew that matches neither is untouched. GM-side, once.
async function migrateGearRebaseV2() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", GEAR_REBASE_V2_SETTING)) return;
  const PACK_FOR_TYPE = { weapon: "weapons", armor: "armor", shield: "shields" };
  const rowFor = (item) => {
    const packKey = PACK_FOR_TYPE[item.type];
    if (!packKey) return null;
    const targets = PACK_TARGETS[packKey] ?? {};
    const src = item._stats?.compendiumSource ?? "";
    const m = /^Compendium\.project-anime\.([^.]+)\.Item\.(\w+)$/.exec(src);
    if (m && m[1] === packKey) {
      const name = game.packs.get(`project-anime.${packKey}`)?.index.get(m[2])?.name;
      if (name && targets[name]) return targets[name];
    }
    return targets[item.name] ?? null;
  };
  const updatesFor = (items) => {
    const updates = [];
    for (const item of items) {
      if (item.getFlag("project-anime", "natural")) continue;   // retired strike — migrateNaturalAttacksRemoved deletes it
      const row = rowFor(item);
      if (row) updates.push({ _id: item.id, ...row });
    }
    return updates;
  };
  let count = 0;
  const worldUpdates = updatesFor(game.items);
  if (worldUpdates.length) { await Item.updateDocuments(worldUpdates); count += worldUpdates.length; }
  for (const actor of game.actors) {
    const updates = updatesFor(actor.items);
    if (updates.length) { await actor.updateEmbeddedDocuments("Item", updates); count += updates.length; }
  }
  if (count) console.log(`Project: Anime | Gear rebase — ${count} owned/world item(s) aligned to the V2 Style tables.`);
  await game.settings.set("project-anime", GEAR_REBASE_V2_SETTING, true);
}

// V2 accessories rewire: re-base every world/actor-owned copy of the five printed Accessories to
// the updated pack line — item fields plus a REPLACED wired Active Effect (Belt +1 max Hit Box,
// Sandals +1 Movement, Scouter reveals Guard, Lucky Pendant tunes a restored Luck Die, Trader's
// Pass sell +10%) — and re-stamp the Armor Style descriptions the earlier rebase never carried.
// Renamed copies are found through their compendium origin, like migrateGearRebaseV2. GM-side, once.
async function migrateAccessoriesV2() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", ACCESSORIES_V2_SETTING)) return;

  // Canonical name for a pack-born copy (compendiumSource → pack index name), else its own name.
  const canonNameFor = (item, packKey) => {
    const src = item._stats?.compendiumSource ?? "";
    const m = /^Compendium\.project-anime\.([^.]+)\.Item\.(\w+)$/.exec(src);
    if (m && m[1] === packKey) {
      const name = game.packs.get(`project-anime.${packKey}`)?.index.get(m[2])?.name;
      if (name) return name;
    }
    return item.name;
  };

  let count = 0;
  const rewire = async (items) => {
    for (const item of items) {
      if (item.type === "armor") {
        const row = PACK_TARGETS.armor?.[canonNameFor(item, "armor")];
        if (row) { await item.update(row); count++; }
        continue;
      }
      if (item.type !== "accessory") continue;
      const canonName = canonNameFor(item, "accessories");
      const canon = ACCESSORY_CANON[canonName];
      if (!canon) continue; // GM homebrew — untouched
      await item.update({ "system.cost": canon.cost, "system.description": canon.description });
      // Replace the wired effect wholesale — the stale pre-V2 rules are wrong, not tunable.
      const stale = item.effects.map((e) => e.id);
      if (stale.length) await item.deleteEmbeddedDocuments("ActiveEffect", stale);
      await item.createEmbeddedDocuments("ActiveEffect", [accessoryEffectData(canonName)]);
      count++;
    }
  };
  await rewire(game.items);
  for (const actor of game.actors) await rewire(actor.items);
  if (count) console.log(`Project: Anime | Accessories rewire — ${count} owned/world item(s) re-based to the V2 line.`);
  await game.settings.set("project-anime", ACCESSORIES_V2_SETTING, true);
}

/* -------------------------------------------- */
/*  Prose descriptions fold (one-time)          */
/* -------------------------------------------- */

// The auto-written Technique rules retired (v0.5.18): descriptions are hand-authored Codex prose,
// locked behind the item sheet's pencil editor. Fold each Technique's old display text into
// `system.description` exactly once so no table content goes blank:
//  - a stored Rules Override (hand-written) moves to the top of the description, flavor beneath;
//  - a Technique with NO override and NO description is seeded from its final auto write-up,
//    rendered as editable markup (helpers/skill-description.mjs — kept alive only for this);
//  - a Technique that already has a hand-authored description is left untouched.
// Covers world Items, actor-owned Techniques, and the system's Techniques pack (unlock → relock),
// so post-retirement imports don't arrive blank. GM-side, once per world.
async function migrateProseDescriptions() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", PROSE_DESC_SETTING)) return;

  let count = 0;
  const fold = async (items) => {
    for (const item of items) {
      if (item.type !== "skill") continue;
      const desc = String(item.system.description ?? "").trim();
      const override = String(item.system.rulesOverride ?? "").trim();
      let next = null;
      if (override) {
        // A legacy ProseMirror description converts to markup so the two halves render as one
        // prose block (mixed HTML + markup would pass through raw).
        const flavor = desc && isLegacyHTML(desc) ? htmlToMarkup(desc) : desc;
        next = flavor ? `${override}\n\n${flavor}` : override;
      } else if (!desc) {
        next = autoRulesToMarkup(item) || null;
      }
      if (next == null) continue;
      await item.update({ "system.description": next, "system.rulesOverride": "" });
      count++;
    }
  };

  await fold(game.items);
  for (const actor of game.actors) await fold(actor.items);
  const pack = game.packs.get("project-anime.skills");
  if (pack) {
    const wasLocked = pack.locked;
    try {
      if (wasLocked) await pack.configure({ locked: false });
      await fold(await pack.getDocuments());
    } finally {
      if (wasLocked) await pack.configure({ locked: true });
    }
  }
  if (count) console.log(`Project: Anime | Prose descriptions — ${count} Technique(s) folded/seeded (auto rules retired).`);
  await game.settings.set("project-anime", PROSE_DESC_SETTING, true);
}

/* -------------------------------------------- */
/*  Resistance text migration (one-time)        */
/* -------------------------------------------- */

// Contest Target → Resistance (the Opposing-Techniques contest retired): rewrite every stored
// Technique description to the new vocabulary — `@contest` → `@resistance`, `@rule[contest]` →
// `@rule[resistance]`, a line-leading "**Contest**" outcome label → "**Resistance**", and the
// literal "Contest Target" / "Opposing Techniques" phrases → "Resistance". Covers world Items,
// actor-owned Techniques, and the system's Techniques pack (unlock → relock). `@contest` is fully
// retired from the inline vocabulary — a pre-0.5.27 JSON import shows the literal token until its
// text is touched up by hand (the migration has already run by then). GM-side, once per world.
async function migrateResistanceText() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", RESISTANCE_TEXT_SETTING)) return;

  const swap = (text) => String(text)
    .replace(/@contest\b/g, "@resistance")
    .replace(/@rule\[\s*contest\s*\]/gi, "@rule[resistance]")
    .replace(/^(\s*)\*\*Contest\*\*/gim, "$1**Resistance**")
    .replace(/Contest Target/g, "Resistance")
    .replace(/Opposing Techniques/g, "Resistance");

  let count = 0;
  const sweep = async (items) => {
    for (const item of items) {
      if (item.type !== "skill") continue;
      const desc = String(item.system.description ?? "");
      if (!desc.trim()) continue;
      const next = swap(desc);
      if (next === desc) continue;
      await item.update({ "system.description": next });
      count++;
    }
  };

  await sweep(game.items);
  for (const actor of game.actors) await sweep(actor.items);
  const pack = game.packs.get("project-anime.skills");
  if (pack) {
    const wasLocked = pack.locked;
    try {
      if (wasLocked) await pack.configure({ locked: false });
      await sweep(await pack.getDocuments());
    } finally {
      if (wasLocked) await pack.configure({ locked: true });
    }
  }
  if (count) console.log(`Project: Anime | Resistance — ${count} Technique description(s) reworded (Contest Target retired).`);
  await game.settings.set("project-anime", RESISTANCE_TEXT_SETTING, true);
}

/* -------------------------------------------- */
/*  Natural Attack removal (one-time)           */
/* -------------------------------------------- */

// The innate "Natural Attack" (Unarmed Strike) is RETIRED (v0.6.2) — attacks come from Weapon
// Styles now. Delete every natural-flagged weapon from world Items, world actors, and unlocked
// Actor packs; new imports are scrubbed by preCreateActor. GM-side, once per world. (The old
// naturalProvisioned actor flags and the unarmedDmgV001 world key may linger, unread — harmless.)
async function migrateNaturalAttacksRemoved() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", NATURAL_REMOVED_SETTING)) return;
  let count = 0;
  const isNatural = (i) => i.type === "weapon" && !!i.getFlag("project-anime", "natural");
  const scrub = async (actor) => {
    if (actor.type !== "character" && actor.type !== "npc") return;
    const ids = actor.items.filter(isNatural).map((i) => i.id);
    if (!ids.length) return;
    await actor.deleteEmbeddedDocuments("Item", ids);
    count += ids.length;
  };
  const worldIds = game.items.filter(isNatural).map((i) => i.id);
  if (worldIds.length) { await Item.deleteDocuments(worldIds); count += worldIds.length; }
  for (const actor of game.actors) await scrub(actor);
  for (const pack of game.packs) {
    if (pack.metadata.type !== "Actor" || pack.locked) continue;
    for (const actor of await pack.getDocuments()) await scrub(actor);
  }
  if (count) console.log(`Project: Anime | Unarmed Strikes retired — removed ${count} Natural Attack(s).`);
  await game.settings.set("project-anime", NATURAL_REMOVED_SETTING, true);
}

/* -------------------------------------------- */
/*  Weapon Type from name backfill (one-time)   */
/* -------------------------------------------- */

// Seed each existing weapon/shield's Type — the game's weapons were all named after their type (a
// "Sword" item IS a Sword) before the Weapon Type field existed, so a "Weapon Adjustment" scoped
// "By weapon type" can match them out of the box: a weapon/shield takes its NAME. Only fills a
// BLANK weaponType (a deliberately-set one is left alone). Covers world Items and every actor's
// embedded gear. GM-side, once per world.
async function backfillWeaponTypes() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", WEAPON_TYPE_BACKFILL_SETTING)) return;

  // The Type to seed onto an item, or null if it shouldn't be touched.
  const desiredType = (i) => {
    if (i.type !== "weapon" && i.type !== "shield") return null;
    if (String(i.system?.weaponType ?? "").trim()) return null;          // already set — leave alone
    const nm = String(i.name ?? "").trim();
    return nm || null;                                                    // named after its type
  };
  const buildUpdates = (coll) => coll.reduce((acc, i) => {
    const t = desiredType(i);
    if (t) acc.push({ _id: i.id, "system.weaponType": t });
    return acc;
  }, []);

  // World Items directory (standalone weapons/shields, e.g. an unequipped stash item).
  const worldUpdates = buildUpdates(game.items);
  if (worldUpdates.length) await Item.updateDocuments(worldUpdates);

  // Embedded gear on every actor.
  for (const actor of game.actors) {
    const updates = buildUpdates(actor.items);
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }

  await game.settings.set("project-anime", WEAPON_TYPE_BACKFILL_SETTING, true);
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
    if (actor.type === "party" || actor.type === "merchant") continue;  // no combat stats, no bars
    if (actor.prototypeToken?.displayBars !== ALWAYS)
      actorUpdates.push({ _id: actor.id, "prototypeToken.displayBars": ALWAYS });
  }
  if (actorUpdates.length) await Actor.updateDocuments(actorUpdates);

  for (const scene of game.scenes) {
    const tokenUpdates = [];
    for (const token of scene.tokens) {
      if (token.actor?.type === "party" || token.actor?.type === "merchant") continue;
      if (token.displayBars !== ALWAYS) tokenUpdates.push({ _id: token.id, displayBars: ALWAYS });
    }
    if (tokenUpdates.length) await scene.updateEmbeddedDocuments("Token", tokenUpdates);
  }

  await game.settings.set("project-anime", BARS_BACKFILLED_SETTING, true);
}

// Per-client UI default: chat bubbles and pan-to-speaker (both core, client-scoped) start off, once
// per client. Guarded by CHAT_DEFAULTS_SETTING so a user who re-enables either keeps it on.
async function applyChatBubbleDefaults() {
  if (game.settings.get("project-anime", CHAT_DEFAULTS_SETTING)) return;
  await game.settings.set("core", "chatBubbles", false);
  await game.settings.set("core", "chatBubblesPan", false);
  await game.settings.set("project-anime", CHAT_DEFAULTS_SETTING, true);
}

// GM-side, once per world: turn core's "Automatic Token Rotation" off and lock rotation on every
// existing actor's prototype token + placed token (matching the lockRotation default new actors get
// in preCreateActor). Guarded by ROTATION_DEFAULTS_SETTING so a GM who later re-enables auto-rotate
// or unlocks a token isn't overridden on the next load.
async function applyTokenRotationDefaults() {
  if (!paIsActiveGM()) return;
  if (game.settings.get("project-anime", ROTATION_DEFAULTS_SETTING)) return;

  await game.settings.set("core", "tokenAutoRotate", false);

  const actorUpdates = [];
  for (const actor of game.actors) {
    if (actor.type === "party") continue;               // the planner has no token
    if (!actor.prototypeToken?.lockRotation)
      actorUpdates.push({ _id: actor.id, "prototypeToken.lockRotation": true });
  }
  if (actorUpdates.length) await Actor.updateDocuments(actorUpdates);

  for (const scene of game.scenes) {
    const tokenUpdates = [];
    for (const token of scene.tokens) {
      if (token.actor?.type === "party") continue;
      if (!token.lockRotation) tokenUpdates.push({ _id: token.id, lockRotation: true });
    }
    if (tokenUpdates.length) await scene.updateEmbeddedDocuments("Token", tokenUpdates);
  }

  await game.settings.set("project-anime", ROTATION_DEFAULTS_SETTING, true);
  // (Merchants aren't skipped here on purpose — locked rotation is right for them too.)
}

/* -------------------------------------------- */
/*  Ready                                       */
/* -------------------------------------------- */

/** Enable any disabled effect that is marked Toggleable (own or on an owned item): its player toggle
 *  is the on/off, so it must stay live to appear and apply. Idempotent — a no-op once everything's
 *  clean. Mirrors the Effect Builder, which now force-enables toggleable effects on save. */
async function enableToggleableEffects(actor) {
  const broken = (effs) => (effs ?? []).filter((e) => e.disabled && e.flags?.["project-anime"]?.toggle);
  const own = broken(actor?.effects);
  if (own.length) await actor.updateEmbeddedDocuments("ActiveEffect", own.map((e) => ({ _id: e.id, disabled: false })));
  for (const item of actor?.items ?? []) {
    const fix = broken(item.effects);
    if (fix.length) await item.updateEmbeddedDocuments("ActiveEffect", fix.map((e) => ({ _id: e.id, disabled: false })));
  }
}

Hooks.once("ready", function () {
  console.log("Project: Anime | System ready");

  // Restore the on-canvas quest tracker for whatever quest this client was tracking.
  ChronicleTracker.refresh();

  // One-time (V2): re-baseline every actor to the box model (Hit/Energy Boxes, Guard, Movement).
  migrateActorsV2();

  // One-time: convert every NPC to the Tier × EXP enemy model (retired Types fold into the Tier
  // ladder; Bosses/Rivals become Villains, Bars carry over as Gates; boss/rival keys drop).
  migrateEnemyTiersV1();

  // One-time: retire the innate Natural Attack (Unarmed Strike) — attacks come from Weapon
  // Styles now; every natural-flagged weapon is deleted.
  migrateNaturalAttacksRemoved();

  // One-time: seed each weapon/shield's Type from its name (they were named after their type).
  backfillWeaponTypes();

  // One-time (V2): reconcile the gear compendiums to the Style tables, then re-base the copies
  // players already own (order matters — the rebase reads the freshly-audited pack index).
  if (paIsActiveGM() && !game.settings.get("project-anime", PACK_AUDIT_SETTING)) {
    auditGearPacks()
      .then(() => game.settings.set("project-anime", PACK_AUDIT_SETTING, true))
      .then(() => migrateGearRebaseV2())
      .then(() => migrateAccessoriesV2())
      .then(() => migrateProseDescriptions())
      .then(() => migrateResistanceText());
  } else {
    migrateGearRebaseV2().then(() => migrateAccessoriesV2()).then(() => migrateProseDescriptions()).then(() => migrateResistanceText());
  }

  // One-time: switch existing tokens to always-on HP/Energy bars (the bottom-stacked overlay).
  backfillAlwaysBars();

  // One-time: back each existing Party with a real Folder (migrating any legacy system.members),
  // then ensure the world ships with a Party at all — seed a starter one if it has none.
  if (paIsActiveGM()) ensureAllPartyFolders().then(ensureDefaultParty);

  // Bonds removed (v0.4.0) + NPC Signature Trait/Traits removed (v0.5.2): purge any effect those
  // retired engines projected onto an actor (flagged bondKey / traitKey / legacy traitEffect), so
  // stale toggles and trait buffs don't linger.
  if (paIsActiveGM()) for (const a of game.actors ?? []) {
    const stale = (a.effects ?? []).filter((e) => {
      const f = e.flags?.["project-anime"];
      return f?.bondKey || f?.traitKey || f?.traitEffect;
    }).map((e) => e.id);
    if (stale.length) a.deleteEmbeddedDocuments("ActiveEffect", stale);
  }

  // Crafting removed (v0.4.3): purge carried `material` Items. The type is unregistered, so any
  // survivor is an invalid document — read the raw source, delete by id. GM-gated + idempotent.
  if (paIsActiveGM()) {
    for (const a of game.actors ?? []) {
      const mats = (a._source?.items ?? []).filter((i) => i.type === "material").map((i) => i._id);
      if (mats.length) a.deleteEmbeddedDocuments("Item", mats);
    }
    const worldMats = [...game.items.invalidDocumentIds].filter((id) => game.items.getInvalid(id)?.type === "material");
    if (worldMats.length) Item.deleteDocuments(worldMats);
    // …and the crafting-only Artisan's Kit from the gear packs.
    purgeRetiredPackItems();
    // …and re-point items still wearing a broken seed image (the old Casting Weapon staff).
    healBrokenItemIcons();
  }

  // Talents are actor data now (v0.5.1, Daggerheart-Experience-style) — convert any retired
  // `talent` Items into `system.talents` rows. GM-gated + idempotent.
  if (paIsActiveGM()) migrateTalentsToActorData();

  // Self-heal: a Toggleable effect is switched by its player toggle, so it must stay ENABLED to be
  // live (the collectors read appliedEffects, which drops disabled effects). Enable any effect saved
  // disabled+toggleable so it shows up in the roll dialog / Effects tab. GM-gated + idempotent.
  if (paIsActiveGM()) for (const a of game.actors ?? []) enableToggleableEffects(a);

  // Enforce the rules' "skip the Defeated" turn order (p.14) — defeated enemies/PCs at 0 HP
  // are stepped over in the encounter tracker.
  if (paIsActiveGM()) ensureSkipDefeated();

  // Apply the system's preferred defaults once: chat bubbles + pan-to-speaker off (per client),
  // automatic token rotation off + rotation locked on existing tokens (per world, GM-side).
  applyChatBubbleDefaults();
  applyTokenRotationDefaults();

  // GM-side relay for applying damage. A player clicking "Apply" on a target
  // they don't own (e.g. the GM's monster) can't update it directly — the server
  // would reject it — so they emit over the system socket and the single active
  // GM performs the HP change. Requires "socket": true in system.json.
  game.socket.on("system.project-anime", (payload) => {
    if (game.users.activeGM?.id !== game.user.id) return;
    if (payload?.type === "applyDamage") dice.applyDamageTo(payload.targetUuid, payload.amount, payload.heal, payload.pool, { ignoreBarrier: payload.ignoreBarrier });
    else if (payload?.type === "applyStatus") dice.applyStatusTo(payload.targetUuid, payload.statusId, payload.active, payload.duration, { value: payload.value, pool: payload.pool, overcomeCT: payload.overcomeCT, side: payload.side });
    else if (payload?.type === "applyEffect") dice.applyEffectTo(payload.targetUuid, payload.effectData);
    else if (payload?.type === "stealItem") dice.stealItemTo(payload.stealerUuid, payload.targetUuid, payload.itemId);
    else if (payload?.type === "createItems") dice.createItemsOn(payload.targetUuid, payload.items);
    else if (payload?.type === "createCompanion") createCompanion(payload.casterUuid, payload.itemId, payload.name, payload.userId);
    else if (payload?.type === "dismissServant") removeServantActor(payload.servantUuid);
    // Merchant trades — the executors re-validate everything GM-side (the sender must own the
    // buying/selling character; stock, price, and gold are re-read from current world state).
    else if (payload?.type === "merchantBuy") merchantBuyTo(payload.merchantUuid, payload.itemId, payload.buyerUuid, payload.qty, payload.userId);
    else if (payload?.type === "merchantSell") merchantSellTo(payload.merchantUuid, payload.sellerUuid, payload.itemId, payload.qty, payload.userId);
    else if (payload?.type === "placeGates") {
      // Portal tiles are GM territory — stamp them onto the caster's scene.
      game.scenes.get(payload.sceneId)?.createEmbeddedDocuments("Tile", payload.tiles ?? []);
    }
    else if (payload?.type === "comboTurn") {
      // A roll comboed on the CURRENT combatant's own turn (the roller's — a Luck flip by anyone
      // can manufacture it): validate the grant lands on whoever holds the turn right now, then
      // flag the pending extra turn (consumed by the Combat#nextTurn patch).
      const combat = game.combats.get(payload.combatId) ?? game.combats.active;
      const cur = combat?.combatant;
      if (combat?.started && cur && cur.id === payload.combatantId && cur.actor?.uuid === payload.actorUuid) {
        const key = `${cur.id}:${combat.round}`;
        const granted = combat.getFlag("project-anime", "comboGranted") === key;
        if (!granted) combat.setFlag("project-anime", "comboTurn", key);
      }
    }
    else if (payload?.type === "endTurn") {
      // A player asked to end a SPECIFIC unit's turn (the one that was acting when they clicked, sent in
      // the payload — not `combat.combatant`, which a concurrent activation could have changed). Validate
      // they own that unit; endActivation re-checks it's actable so a stale relay is a safe no-op.
      const combat = game.combats.get(payload.combatId) ?? game.combats.active;
      const user = game.users.get(payload.userId);
      const c = combat?.combatants?.get(payload.combatantId);
      if (combat?.started && c && user) {
        const owns = c.players?.some((u) => u.id === payload.userId)
          || !!c.actor?.testUserPermission(user, "OWNER");
        if (owns) endActivation(combat, payload.combatantId);
      }
    }
    else if (payload?.type === "activate") {
      // A player asked to PUT ONE OF THEIR UNITS ON in the active phase (free-pick). Validate they own the
      // target; activateCombatant re-checks it's the active phase, un-acted, and not stunned/defeated.
      const combat = game.combats.get(payload.combatId) ?? game.combats.active;
      const user = game.users.get(payload.userId);
      const c = combat?.combatants?.get(payload.combatantId);
      if (combat?.started && c && user) {
        const owns = c.players?.some((u) => u.id === payload.userId)
          || !!c.actor?.testUserPermission(user, "OWNER");
        if (owns) activateCombatant(combat, payload.combatantId);
      }
    }
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

  // Cinematic HUD: persistent anime console (bottom-centre, replaces the hotbar) + party rail
  // (lower-left, replaces the names list). applyHudState() reads the client settings, toggles
  // the body class that CSS-hides the native chrome, and renders/closes the widgets.
  projectanime.hud = new AnimeHud();
  projectanime.party = new AnimePartyRail();
  applyHudState();
  // Mirror this client's accent to a user flag so other clients can tint this player's Party HUD card.
  syncPlayerAccentFlag(game.settings.get("project-anime", ACCENT_COLOR_SETTING));
  // Re-render on anything that changes the driven actor, its vitals/items, or the party. Guarded
  // on the enabled setting so the debounced render() can't re-open the HUD after it's switched off.
  const refreshHud = () => {
    if (!game.settings.get("project-anime", HUD_ENABLED_SETTING)) return;
    projectanime.hud?.refresh();
    if (game.settings.get("project-anime", HUD_SHOW_PARTY_SETTING)) projectanime.party?.refresh();
  };
  // NB: no "collapseSidebar" here — the bar is now positioned with constant layout vars (CSS), so it
  // holds its place when the sidebar toggles. Re-rendering on collapse only rebuilt every slot (async
  // fromUuid) for nothing and contributed to the visible shift/flicker.
  for (const hook of [
    "controlToken", "updateActor", "updateUser", "canvasReady",
    "createItem", "updateItem", "deleteItem", "createActor", "deleteActor"
  ]) Hooks.on(hook, refreshHud);
  // pf2e-style: the native macro #hotbar is re-parented into the HUD grid's bottom row. When Foundry
  // re-renders the hotbar (macro drag, page flip), re-home it so it can't snap back to #ui-bottom.
  Hooks.on("renderHotbar", () => {
    if (game.settings.get("project-anime", HUD_ENABLED_SETTING)) projectanime.hud?.rehomeHotbar();
  });

  // Encounter tracker — pinned just left of the chat sidebar (in #ui-right). Appears as soon as an
  // encounter has combatants (the createCombat/createCombatant hooks below re-render it live, so it
  // pops up without a reload — even before "Begin"), and carries a Begin button + the GM/player
  // turn controls. Players end their own turn via the GM socket relay.
  projectanime.combat = new AnimeCombatTracker();
  projectanime.combat.refresh();   // render/close lifecycle — shows only if an encounter already has combatants
  const refreshCombat = () => {
    projectanime.combat?.refresh();
    // The Party HUD's acting-now glow follows side-initiative — refresh it on combat changes too.
    if (game.settings.get("project-anime", HUD_ENABLED_SETTING) && game.settings.get("project-anime", HUD_SHOW_PARTY_SETTING)) projectanime.party?.refresh();
  };
  for (const hook of [
    "combatStart", "combatTurn", "combatRound", "updateCombat", "createCombat", "deleteCombat",
    "createCombatant", "updateCombatant", "deleteCombatant", "updateActor", "targetToken",
    // renderCombatTracker fires whenever the native tracker re-renders (combatant added/removed, etc.),
    // so ours mirrors it live — the reliable "people are now in the encounter" signal.
    "renderCombatTracker"
  ]) Hooks.on(hook, refreshCombat);

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

  // Servant dismissal from the Token HUD — a persistent release path that doesn't depend on the
  // transient Animate raise card. A raised servant's token shows a "Dismiss" control to its owner;
  // clicking confirms, then releases the servant (deleting its actor + tokens), and the deleteActor
  // → pruneServantLedger hook restores the caster's locked Energy.
  Hooks.on("renderTokenHUD", (hud, html) => {
    const actor = hud?.object?.actor ?? hud?.document?.actor ?? null;
    if (!actor?.getFlag?.("project-anime", "servantOf") || !actor.isOwner) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const col = root?.querySelector(".col.right") ?? root?.querySelector(".col.left");
    if (!col || col.querySelector(".pa-dismiss-servant")) return;
    const btn = document.createElement("div");
    btn.className = "control-icon pa-dismiss-servant";
    const label = game.i18n.localize("PROJECTANIME.Servant.dismiss");
    btn.dataset.tooltip = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = `<i class="fas fa-person-walking-arrow-loop-left"></i>`;
    btn.addEventListener("click", () => confirmAndDismiss(actor));
    col.appendChild(btn);
  });

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

  // Aura field overlay: a visible ring around every token projecting an Aura, with a PF2e-style area
  // highlight while a bearer is hovered. Per-client and cosmetic; it mirrors the reconcile's live-aura
  // set + circular radius. The shared refreshAuras() (above) rebuilds it on every aura-set change; here
  // we add the hover highlight and the live follow-along during a token's move animation.
  const auraField = new AuraField();
  globalThis.projectanime.auraField = auraField;
  auraField.refresh();
  Hooks.on("hoverToken", (token, hovered) => auraField.setHover(token, hovered));
  // refreshToken is the reliable "this token moved (and settled)" signal in V13 — the updateToken
  // diff doesn't always surface x/y for an animated drag, which would leave a creature that walked
  // out of an aura still carrying the projected effect. Reposition the ring every frame (cheap), and
  // also nudge the debounced reconcile so the effect is added/removed against the final position.
  Hooks.on("refreshToken", (token) => { auraField.reposition(token); refreshAuras(); });
  Hooks.on("canvasReady", () => auraField.refresh());

  // Initial Aura reconcile for the active scene (the canvasReady hook also covers first load and
  // scene changes; this catches the case where the canvas is already ready when the system boots).
  refreshAuras();
});
