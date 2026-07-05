/**
 * Project: Anime — system entry point for Foundry VTT V13.
 */
import * as models from "./data/_module.mjs";
import { ProjectAnimeActor, enforceEquipExclusivity, refundSkillOnDelete, naturalAttackData, ensureNaturalAttack } from "./documents/actor.mjs";
import { ProjectAnimeItem } from "./documents/item.mjs";
import { ProjectAnimeActorSheet } from "./sheets/actor-sheet.mjs";
import { ProjectAnimePartySheet } from "./sheets/party-sheet.mjs";
import { ProjectAnimeItemSheet } from "./sheets/item-sheet.mjs";
import { PROJECTANIME, ENCOUNTER_POWER_SETTING, cursedPools, combatantSide, sideInitiative, hasActed, isSkippable, pendingOnSide, activeSide, enemyVitals, enemyStrongAttrs } from "./helpers/config.mjs";
import * as dice from "./helpers/dice.mjs";
import { elementLabel } from "./helpers/elements.mjs";
import { registerElementSettings } from "./apps/element-config.mjs";
import { registerMaterialSettings } from "./apps/material-config.mjs";
import { registerBioFieldSettings } from "./apps/bio-field-config.mjs";
import { registerTokenFieldSettings } from "./apps/token-field-config.mjs";
import { registerTokenSettings } from "./apps/token-config.mjs";
import { registerCreationSettings } from "./apps/creation-config.mjs";
import { applyEffectCopy, syncGrants, removeGrants, itemHasGrantRule, collectSustain } from "./helpers/effects.mjs";
import { raiseServant, createCompanion, removeServantActor, pruneServantLedger, confirmAndDismiss } from "./helpers/servants.mjs";
import { auditGearPacks, PACK_AUDIT_SETTING, PACK_TARGETS } from "./helpers/pack-audit.mjs";
import { syncAuras, isAuraEffect } from "./helpers/aura.mjs";
import { EffectsPanel } from "./apps/effects-panel.mjs";
import { TokenInfoPanel, TOKEN_INFO_SETTING, TOKEN_INFO_CLIENT_SETTING, canSeeTokenVitals, viewerReveals } from "./apps/token-info.mjs";
import { TokenDossier } from "./apps/token-dossier.mjs";
import { RangeLine, RANGE_LINE_SETTING, RANGE_LINE_CLIENT_SETTING } from "./apps/range-line.mjs";
import { AuraField } from "./apps/aura-field.mjs";
import { patchEffectsHalo } from "./apps/effects-halo.mjs";
import { ComboSplash, COMBO_SPLASH_SETTING, COMBO_SPLASH_CLIENT_SETTING } from "./apps/combo-splash.mjs";
import { ensurePartyFolder, ensureAllPartyFolders, syncPartyFolderName, deletePartyFolder, partyMembers, resolveParty } from "./helpers/party-folder.mjs";
import { AnimeHud, AnimePartyRail, AnimeCombatTracker, registerHudSettings, applyHudState, HUD_ENABLED_SETTING, HUD_SHOW_PARTY_SETTING, HUD_COMBAT_SETTING } from "./apps/anime-hud.mjs";
import { Codex, ChronicleTracker } from "./apps/codex.mjs";
import { QUESTS_SETTING, TRACKED_SETTING, TRACKER_VISIBLE_SETTING, SEASON_COUNT_SETTING, PARTY_TIER_SETTING } from "./helpers/chronicle.mjs";
import { FACTIONS_SETTING, HQ_SETTING, DEATH_STRIKES_SETTING, CRAFT_REQUIRE_SETTING, migrateRostersToHQ, migrateHQModel, getHQ, saveHQ, buildFacility, craftRecipe } from "./helpers/factions.mjs";
import { ARCHIVE_SETTING } from "./helpers/archive.mjs";
import { CRAFT_PROJECTS_SETTING, depositMaterial } from "./helpers/crafting.mjs";
import { awardDefeatDrops } from "./helpers/gathering.mjs";
import { reconcileHQBoons } from "./helpers/hq-boons.mjs";
import { reconcileTraits } from "./helpers/trait-effect.mjs";
import { reconcileBonds } from "./helpers/bond-effect.mjs";
import { syncPartyBonds, blankBond } from "./helpers/bonds.mjs";
import { registerPartySettings } from "./apps/party-config.mjs";
import { isMinionTier, setSquadSize, isSquad, squadMembers, squadSize } from "./helpers/squad.mjs";
import { combatPlayerCount } from "./helpers/encounter.mjs";
import { seedTwistSkills } from "./helpers/twists.mjs";

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

// Hidden world flag — set once after legacy Encounter-Builder lines (the old per-entry "× qty"
// multiplier) migrate to the squad model: a minion's qty becomes its squad SIZE, a non-minion's
// qty becomes that many individual lines. See migrateEncounterSquads.
const ENCOUNTER_SQUAD_MIGRATION_SETTING = "encounterSquadsMigrated";

// Hidden world flag — set once after every existing Character gets the v0.03 HP baseline
// (HP = 6 + ⟪Might⟫×2, was ⟪Might⟫×2): +6 max AND current HP. See migrateHpBaseV003.
const HP_BASE_V003_SETTING = "hpBaseV003";

// Hidden world flag — set once after every existing world/actor-owned weapon, armor, and shield
// is re-based to the v0.03 gear tables (absolute DMG column, Hit/Bulk corrections, armor
// Protection 3/4). The compendiums themselves are handled by the packAuditV003 pass; this one
// reaches the COPIES players already own. See migrateGearRebaseV003.
const GEAR_REBASE_V003_SETTING = "gearRebaseV003";

// Hidden world flag — set once after every existing monster NPC (built on the retired ★×Tier model:
// minion/standard/elite/solo × stars 1–5) is remapped to the v0.03 Role × Tier model: shape → Role
// (minion→Swarm, standard→Grunt, elite/solo→Elite), stars → Tier I–IV, with the finished statblock
// recomputed (Strong/Weak dice, role deltas, HP/EP). Retires the legacy tier/stars/squad fields. See
// migrateNpcRoleV003.
const NPC_ROLE_V003_SETTING = "npcRoleV003";

// One-time (v0.3.3): seed the party stash with carried materials mapped from the legacy HQ resource
// pools (best-effort). See migrateMaterialsV003.
const MATERIALS_V003_SETTING = "materialsV003";

// One-time (v0.3.4): remap every legacy solo bond card (rank 0–5, per-rank abilities, NPC link) to a
// v0.03 Follower Bond (kind/partnerUuid, rank C/B/A/S, Bond Points). See migrateBondsV003.
const BONDS_V003_SETTING = "bondsV003";

// One-time (v0.3.5): stand up the doc-v0.03 Headquarters. Mark an already-used base "established" so its
// v0.03 fields (rank C, catalog facilities, Mission Board) come alive, and DRAIN the legacy resource
// pools (Phase 4 already copied them to the party stash; the parallel Workshop is retired now). See
// migrateHqV003.
const HQ_V003_SETTING = "hqV003";

// One-time: materialise the 12 Twists into the Skills compendium as real Skill items (a "Twists"
// bag GMs pick from in the Skill Browser) and lift the 1/Conflict limit off them. Bump the version
// suffix to re-run the reconcile after changing the seeded Twist data. See seedTwistSkills.
const TWIST_SEED_SETTING = "twistSkillsSeededV004";

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
      // A quest edit only touches the Quests pane — scope the re-render so the Factions/Home panes
      // (and their prose enrichment) aren't rebuilt; rep/recruit side effects fire their own saves.
      for (const app of foundry.applications.instances.values()) {
        if (app.id === "pa-codex") {
          app.render({ parts: ["quests"] });
          app.notifyHQChanged?.(); // a completed quest may open a quest-gated recruit on the Home pane (digest-gated, no flash otherwise)
        }
      }
      ChronicleTracker.refresh();
    }
  });
  // Seasons concluded (v0.03 campaign spine): the Milestone tool advances it; party Tier and
  // once-per-Season recharges read it. Hidden. A concluded Season can raise the auto Tier, so
  // any open party sheet refreshes its Tier badge.
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
  // Party Tier override (v0.03): 0 = auto (1 + Seasons, max IV); 1–4 pins it. Set from the party
  // sheet's Tier select (GM). Hidden from the settings tab.
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
  // Crafting Projects (v0.03): Stage-based works defined with the ST, world-scoped. Any open Craft
  // Workbench refreshes when the list changes.
  game.settings.register("project-anime", CRAFT_PROJECTS_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => {
      for (const app of foundry.applications.instances.values())
        if (app.options?.classes?.includes("craft-app")) app.render(false);
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

  // FACTIONS — the world's factions live in one world setting (GM writes, all read), like the quest
  // log. Bonds moved onto each Character (data/actor-models.mjs); Factions + Home now surface in the
  // standalone CODEX window, so a change re-renders any open Codex (on every client). The legacy
  // `covenantBonds` setting is intentionally no longer registered — bonds are per-actor now.
  game.settings.register("project-anime", FACTIONS_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => {
      // Faction standing also gates HQ repTier recruits, so refresh both panes — but scoped, so the
      // Quests pane and nav keep their DOM (no whole-window flash on a standing tweak).
      for (const app of foundry.applications.instances.values()) {
        if (app.id === "pa-codex") app.render({ parts: ["factions", "hq"] });
      }
    }
  });

  // THE HQ — the party's single built faction + its recruit pool (Codex Home tab). One world object
  // (GM writes, all read), like the faction list; a change re-renders any open Codex on every client.
  // Recruitment used to live per-faction (the `buildable` flag); it consolidated here.
  game.settings.register("project-anime", HQ_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => {
      // Hand every open HQ window the change and let IT decide whether to re-render. Each one compares
      // a signature of the slice it actually shows, so an edit it doesn't surface (e.g. authoring a
      // Workshop recipe while the Codex Home tab is open) costs no flash. The Codex scopes to its `hq`
      // part; the satellites re-render their single body. `notifyHQChanged` is the seamless entry point.
      for (const app of foundry.applications.instances.values()) {
        if (app.id === "pa-codex" || app.id === "pa-structures" || app.id?.startsWith("pa-shop-") || app.id?.startsWith("pa-workshop-")) {
          app.notifyHQChanged?.();
        }
      }
      reconcileHQBoons(); // GM-gated: re-project passive-facility boons onto party members
    }
  });

  // THE CODEX ARCHIVE — the in-world encyclopedia (the "Codex" tab of the Headquarters window). One
  // world object (GM writes, everyone reads), like the quest log + factions; a change routes through each
  // open Codex's seamless gate (notifyArchiveChanged), which re-renders the archive pane only when what
  // THAT viewer sees actually moved — so inline authoring edits (saved quietly) don't flash the pane, and
  // a reveal still refreshes a player. Mirrors the HQ pane's notifyHQChanged fan-out.
  game.settings.register("project-anime", ARCHIVE_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => {
      for (const app of foundry.applications.instances.values()) {
        if (app.id === "pa-codex") app.notifyArchiveChanged?.();
      }
    }
  });

  // Variant rule (default on): a dispatch agent who rolls a natural 1 on three missions is lost for
  // good. Off → agents only ever come back wounded. Grouped under the Headquarters menu
  // (party-config.mjs) — config:false here.
  game.settings.register("project-anime", DEATH_STRIKES_SETTING, {
    name: "PROJECTANIME.Settings.hqDeathStrikes.name",
    hint: "PROJECTANIME.Settings.hqDeathStrikes.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  // Crafting: when on (default), a Workshop recipe's `requires[]` facility prerequisites are enforced;
  // off → recipes gate on Workshop tier + resource cost only. Grouped under the Headquarters menu.
  game.settings.register("project-anime", CRAFT_REQUIRE_SETTING, {
    name: "PROJECTANIME.Settings.craftRequireFacilities.name",
    hint: "PROJECTANIME.Settings.craftRequireFacilities.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  // Party Sheet settings — the grouped menu that toggles the Factions / Reputation tab.
  registerPartySettings();

  // Homebrew Elements (damage types): world setting + GM-only config menu.
  registerElementSettings();

  // Homebrew Material Categories: world setting + GM-only config menu.
  registerMaterialSettings();

  // GM-configurable Bio-tab dossier fields: world setting + GM-only config menu.
  registerBioFieldSettings();

  // GM-configurable Character Creator: starting SP / Step-Ups / Gold, purchasable
  // types, and which compendiums the gear shop draws from.
  registerCreationSettings();

  // Cinematic HUD — per-client settings (enable + intensity / slot shape / size / party rail).
  // The console replaces the hotbar and the party rail replaces the names list; both are
  // reversible from the "Cinematic HUD" client setting. See module/apps/anime-hud.mjs.
  registerHudSettings();

  // Monster Creator "Encounter Power" — the party-power baseline its Tiers scale from
  // (≈ a typical current PC's total Skill Points). Raising it as the party advances makes
  // newly-built monsters tougher: it rescales each Tier's Skill-Point grant and HP together
  // (Step-Ups / Evasion / Defense stay fixed — attributes cap at d12). Re-renders any open
  // Monster Creator so its Tier cards reflect the new value.
  game.settings.register("project-anime", ENCOUNTER_POWER_SETTING, {
    name: "PROJECTANIME.Settings.encounterPower.name",
    hint: "PROJECTANIME.Settings.encounterPower.hint",
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
  for (const key of [PACK_AUDIT_SETTING, WEAPON_TYPE_BACKFILL_SETTING, DEFAULT_PARTY_SETTING, ENCOUNTER_SQUAD_MIGRATION_SETTING, HP_BASE_V003_SETTING, GEAR_REBASE_V003_SETTING, NPC_ROLE_V003_SETTING, MATERIALS_V003_SETTING, BONDS_V003_SETTING, HQ_V003_SETTING, TWIST_SEED_SETTING]) {
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
  CONFIG.statusEffects = PROJECTANIME.statusConditions.map((c) => ({ ...c }));

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
    package: models.ProjectAnimePackage,
    material: models.ProjectAnimeMaterial
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

  game.keybindings.register("project-anime", "openQuestLog", {
    name: "PROJECTANIME.Keybindings.openQuestLog.name",
    hint: "PROJECTANIME.Keybindings.openQuestLog.hint",
    editable: [{ key: "KeyL" }],
    restricted: false,
    onDown: () => { Codex.open("quests"); return true; }
  });

  // Press "H" to open the Codex on the Home (HQ) tab. Falls back to Quests if the GM hasn't enabled
  // the Factions/Home panes (Codex reconciles an unavailable tab on render).
  game.keybindings.register("project-anime", "openHome", {
    name: "PROJECTANIME.Keybindings.openHome.name",
    hint: "PROJECTANIME.Keybindings.openHome.hint",
    editable: [{ key: "KeyH" }],
    restricted: false,
    onDown: () => { Codex.open("hq"); return true; }
  });

  // Press "K" to open the Codex on the Archive (encyclopedia) tab.
  game.keybindings.register("project-anime", "openCodex", {
    name: "PROJECTANIME.Keybindings.openCodex.name",
    hint: "PROJECTANIME.Keybindings.openCodex.hint",
    editable: [{ key: "KeyK" }],
    restricted: false,
    onDown: () => { Codex.open("archive"); return true; }
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
    lines: [`<span class="init-result">${Math.floor(Number(roll.total) || 0)}</span>`]
  });
  message.updateSource({ content, rolls: [], flavor: "", sound: CONFIG.sounds.dice });
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
/*  Combat turn-tick (Sustain / Channeled / Decay / Stunned) */
/* -------------------------------------------- */

/** A small themed chat line (no roll) announcing a turn-tick event. */
function tickCard(actor, text) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="project-anime chat-card"><div class="card-line"><em class="muted">${text}</em></div></div>`
  });
}

/** Lingering (stored id `decay`): 1 HP damage at the END of each of the bearer's turns while the
 *  status lasts. Its lifetime is the STANDARD condition timer (default 2 of the bearer's turns, a
 *  Skill's Duration overrides — counted down by tickStatusDurations after this damage lands), so
 *  Lingering expires like every other condition. */
async function tickDecay(actor) {
  if (!actor?.statuses?.has?.("decay")) return;
  const hp = actor.system.hp ?? { value: 0, max: 0 };

  // The tick is a flat 1 HP unless the inflicting Skill set a Lingering Element
  // (flags.project-anime.decayType): a typed tick is affinity-adjusted for THIS creature
  // (weak +2 / resist −2 / immune → 0 / absorb → heal), bypassing Defense. adjustForTarget
  // (dice.mjs) is the shared affinity authority, so typed Lingering matches every other source.
  const element = actor.getFlag("project-anime", "decayType") || "";
  const cur = hp.value ?? 0;
  let next = Math.max(0, cur - 1), amount = 1, healed = false;
  if (element) {
    const adj = dice.adjustForTarget(1, element, actor, { ignoresDefense: true });
    amount = adj.amount;
    healed = !!adj.heal;
    next = healed ? Math.min(hp.max ?? cur, cur + amount) : Math.max(0, cur - amount);
  }

  const updates = { "system.hp.value": next };
  // Pre-timer applications carry no countdown (the old build ran Lingering on its own 3-turn
  // counter flag): retire any legacy counter and stamp the standard default so it still expires.
  if (actor.getFlag("project-anime", "decay") !== undefined) updates["flags.project-anime.-=decay"] = null;
  const timers = actor.getFlag("project-anime", "statusTimers") ?? {};
  if (!("decay" in timers)) updates["flags.project-anime.statusTimers.decay"] = 2;
  await actor.update(updates);

  // Tick card: untyped keeps the original line; a typed tick names the element + result
  // (absorb heals; immune lands 0; resist can floor the tick to 0 — damage minimum is 0, v0.03).
  const fmt = (k, d) => game.i18n.format(`PROJECTANIME.Effect.${k}`, d);
  let msg;
  if (!element) msg = fmt("decayTick", { name: actor.name });
  else if (healed) msg = fmt("decayTickAbsorb", { name: actor.name, n: amount, element: elementLabel(element) });
  else msg = fmt("decayTickTyped", { name: actor.name, n: amount, element: elementLabel(element) });
  tickCard(actor, msg);
}

/** Sustain: regenerate the actor's pools at the START of their turn from every live `sustain` Active
 *  Effect — authored effects, gear, drag-ons, and projected auras, plus the actor's own passive
 *  Sustain Skills (all folded together by collectSustain). Clamped to each pool's max. */
async function tickSustain(actor) {
  // Defeated creatures (0 HP) can't passively regenerate: Sustain shuts off the moment HP hits 0 and
  // stays off until they're healed back above 0. Gating here (not just on the skip-Defeated turn
  // order) stops a downed creature self-reviving via Sustain even if it somehow gets a turn. This
  // suppresses BOTH HP- and Energy-pool regen — it's the creature's life that's switched off, not one pool.
  if ((actor?.system?.hp?.value ?? 0) <= 0) return;
  // A Cursed creature cannot regain its cursed pool (rules: Curse) — that pool's regen is
  // suppressed until the Curse ends. A pool-specific Curse leaves the other pool regenerating;
  // a hand-toggled Curse blocks both (cursedPools resolves which).
  const cursed = cursedPools(actor);
  // All Sustain now flows through the Active-Effect engine — including a Sustain+Aura projected onto
  // this creature by a nearby ally (the projected effect carries a `sustain` rule), so the old
  // regeneration-aura special case is gone.
  const gains = collectSustain(actor);
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

// A raised servant's death-of-record (dismissal or a straight delete) releases its master's
// locked Energy: prune the ledger entry. GM-side (the active GM may update any actor).
Hooks.on("deleteActor", (actor) => {
  if (game.users.activeGM?.id !== game.user.id) return;
  pruneServantLedger(actor);
});

/** Status durations (rules p.13): a status condition lasts a number of the affected creature's own
 *  turns — a default of 2, or whatever the Skill that applied it set — and counts down at the END of
 *  that creature's turn, ending when it reaches 0. The per-target counters live under
 *  flags.project-anime.statusTimers (stamped by applyStatusTo on application, max-merged so re-applying
 *  refreshes to the longer duration). Decay (its own damage counter) and Stunned (skip-based) run
 *  separately and never appear here. A status cleared by other means (Cleanse, the token HUD) leaves a
 *  stale timer, pruned here. */
async function tickStatusDurations(actor) {
  if (!actor) return;
  const timers = actor.getFlag("project-anime", "statusTimers");
  if (!timers || !Object.keys(timers).length) return;
  const updates = {};
  const expired = [];
  for (const [id, n] of Object.entries(timers)) {
    if (!actor.statuses?.has?.(id)) { updates[`flags.project-anime.statusTimers.-=${id}`] = null; continue; }
    const remaining = Number(n) - 1;
    if (remaining <= 0) { updates[`flags.project-anime.statusTimers.-=${id}`] = null; expired.push(id); }
    else updates[`flags.project-anime.statusTimers.${id}`] = remaining;
  }
  if (Object.keys(updates).length) await actor.update(updates);
  for (const id of expired) {
    await actor.toggleStatusEffect?.(id, { active: false });
    // Lingering's stashed Element retires with the status (applyStatusTo isn't on this path), as do
    // a pool-choice status's flags — a valued status's pools (Barrier / Regen) or a Curse's pool —
    // and any stamped Overcome CT.
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
}

/** Fixed actions a combatant takes per round (action economy — ENEMY-DESIGN Phase 0). A Monster-role
 *  NPC takes its Tier's `turns`: Minion-squad 1, Standard 1, Elite 2, and a Boss/Solo (`turns: null`)
 *  matches the LIVE player count in this combat (min 1). Everything else — PCs and social NPCs — takes 1.
 *  The old "+1 at ★4+" apex bonus is retired (Boss = player count supersedes it). Drives how many Combatant
 *  ENTRIES a Boss gets (ensureBossSlots) — tunable via PROJECTANIME.monsterTiers[…].turns. */
function actionsPerRound(combatant, combat) {
  const a = combatant?.actor;
  if (a?.type !== "npc" || (a.system?.role ?? "monster") === "npc") return 1;
  const tier = PROJECTANIME.monsterTiers?.[a.system?.tier];
  if (!tier) return 1;
  if (tier.turns === null) return combatPlayerCount(combat);   // Boss/Solo → live PC count
  return Math.max(1, Number(tier.turns) || 1);                 // Elite 2, the rest 1
}

/**
 * ENEMY-DESIGN Phase 0 — BOSS ACTION ECONOMY via multiple combatant entries ("slots"). A Boss/Elite is
 * entitled to actionsPerRound() actions per round (Elite 2, Solo = player count). Instead of hacking the
 * turn loop (which can't fairly interleave one combatant's extra actions), we give its ONE token that many
 * Combatant entries at SPREAD initiative values, so Foundry's own turn order interleaves the boss's actions
 * between the players' turns — exactly N per round, never back-to-back, at any initiative. The extra entries
 * are clones flagged `bossClone:<primaryId>`; they share the token (so HP, damage, and Defeat sync for free),
 * and per-round effects de-duplicate per creature (combatTurnTick + tickOncePerRound). Idempotent; GM-side.
 * Runs at the START of round 1 — driven off the post-update `updateCombat(round→1)` rather than the
 * synchronous `combatStart` hook (which fires BEFORE core's start update and would race our reordering).
 */
async function ensureBossSlots(combat) {
  if (!combat || game.users.activeGM?.id !== game.user.id) return;
  // A spread needs a range to place against — roll initiative for anyone still missing it.
  const unrolled = combat.combatants.filter((c) => c.initiative === null).map((c) => c.id);
  if (unrolled.length) await combat.rollInitiative(unrolled);

  let expanded = false;
  for (const primary of [...combat.combatants]) {
    if (primary.getFlag("project-anime", "bossClone") || primary.getFlag("project-anime", "bossExpanded")) continue;
    const n = actionsPerRound(primary, combat);
    if (n <= 1) continue;
    const clones = Array.from({ length: n - 1 }, () => ({
      tokenId: primary.tokenId, sceneId: primary.sceneId, actorId: primary.actorId, hidden: primary.hidden,
      flags: { "project-anime": { bossClone: primary.id } }
    }));
    await primary.setFlag("project-anime", "bossExpanded", true);
    const created = clones.length ? await combat.createEmbeddedDocuments("Combatant", clones) : [];
    await spreadBossInitiative(combat, [primary, ...created]);
    expanded = true;
  }
  // Adding entries + re-spreading reorders the tracker AFTER core fixed turn 0 against the pre-clone array,
  // so realign the round to the true top of the new order (no-op when nothing expanded).
  if (expanded && combat.started) await combat.update({ turn: 0 });
}

/** Place a boss group's entries in the GAPS between the OTHER combatants' initiatives, so each boss action
 *  falls between players' turns. Entries are forced into DISTINCT, strictly-spread slots, so with
 *  n ≤ (others + 1) — always true for a Boss vs its own players — no two boss entries land adjacent. */
async function spreadBossInitiative(combat, group) {
  const groupIds = new Set(group.map((c) => c.id));
  const anchors = [...combat.combatants]
    .filter((c) => !groupIds.has(c.id) && !c.getFlag("project-anime", "bossClone") && Number.isFinite(c.initiative))
    .map((c) => c.initiative)
    .sort((a, b) => b - a);
  const n = group.length;
  const updates = [];
  if (!anchors.length) {
    group.forEach((c, k) => updates.push({ _id: c.id, initiative: 100 - k * 10 }));   // boss alone — just space them
  } else {
    // Candidate slots, high → low: above the top anchor, the midpoint of each adjacent pair, below the bottom.
    const slots = [anchors[0] + 5];
    for (let i = 1; i < anchors.length; i++) slots.push((anchors[i - 1] + anchors[i]) / 2);
    slots.push(anchors[anchors.length - 1] - 5);
    // Pick n slot indices spread evenly but forced STRICTLY INCREASING, so two boss entries never share a
    // slot (which would put them back-to-back). Clamps to the last slot only if n exceeds the slot count.
    let prev = -1;
    group.forEach((c, k) => {
      let idx = n <= 1 ? 0 : Math.round((k * (slots.length - 1)) / (n - 1));
      idx = Math.min(slots.length - 1, Math.max(prev + 1, idx));
      prev = idx;
      // Per-entry epsilon: keeps the boss's own entries strictly ordered and off any exact anchor tie.
      updates.push({ _id: c.id, initiative: slots[idx] - k * 1e-3 });
    });
  }
  await combat.updateEmbeddedDocuments("Combatant", updates);
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

/** End-of-activation ticks for one unit (Lingering damage + status-duration countdown), once per round
 *  per token. Called explicitly when a unit's turn ends (free-pick has no reliable `combat.previous`). */
async function runEndOfTurnTicks(combat, c) {
  const actor = c?.actor;
  if (!actor) return;
  if (await tickOncePerRound(combat, "endTicks", c.tokenId)) {
    await tickDecay(actor);
    await tickStatusDurations(actor);
  }
}

/** True for a Boss combatant (its HP is split into Bars — it acts once per remaining Bar per round). */
function isBossCombatant(c) {
  return c?.actor?.type === "npc" && !!c.actor.system?.boss?.enabled;
}

/** Clear every combatant's per-round markers (`actedRound` + the Boss `bossTurns` counter) — run when a
 *  fresh round begins so the flags stay tidy and a Boss's Bar-turns reset. */
async function clearActedMarkers(combat) {
  const updates = [];
  for (const c of combat.combatants) {
    const patch = { _id: c.id };
    let dirty = false;
    if (c.getFlag("project-anime", "actedRound") != null) { patch["flags.project-anime.-=actedRound"] = null; dirty = true; }
    if (c.getFlag("project-anime", "bossTurns") != null) { patch["flags.project-anime.-=bossTurns"] = null; dirty = true; }
    if (dirty) updates.push(patch);
  }
  if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
}

/** Auto-pass a Stunned unit: it still Sustains and its statuses still count down (a turn passes), but it
 *  takes no action and the Stunned status clears (rules p.13 — lose your next turn, then it ends), then
 *  it's marked done for the round. */
async function autoSkipStunned(combat, c) {
  const actor = c.actor;
  if (actor?.statuses?.has?.("stunned")) {
    await runStartOfTurnTicks(combat, c);
    tickCard(actor, game.i18n.format("PROJECTANIME.Effect.stunnedSkip", { name: actor.name }));
    await actor.toggleStatusEffect?.("stunned", { active: false });
    await runEndOfTurnTicks(combat, c);
  }
  await c.setFlag("project-anime", "actedRound", combat.round);
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
        content: `<div class="project-anime chat-card"><div class="card-line"><em class="muted">${game.i18n.format("PROJECTANIME.Effect.comboTurn", { name: c.actor.name })}</em></div></div>`
      });
      return;                                            // stays the acting unit for a 2nd action
    }
    await runEndOfTurnTicks(combat, c);
    // Boss Bars (v0.03): a Boss takes one full turn per REMAINING Bar during the Enemy Phase. Count this
    // activation; leave it un-acted (still pickable this phase) until it has spent all its Bar-turns.
    if (isBossCombatant(c)) {
      const used = (Number(c.getFlag("project-anime", "bossTurns")) || 0) + 1;
      const allowed = Math.max(1, Number(c.actor.system.boss?.remaining) || 1);
      await c.setFlag("project-anime", "bossTurns", used);
      if (used < allowed) return reconcilePhase(combat);   // more Bar-turns left → the phase re-offers it
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

/** Reconcile the phase after a unit ends: auto-pass a side whose only pending units are Stunned, drop the
 *  now-spent "current" so the active side is free to pick, and when all three phases are done bump the
 *  round and reopen Player Phase. `turn: null` = "nobody up" — the active side free-picks; no phantom
 *  current lingers across a phase boundary or at round start. GM-side. */
async function reconcilePhase(combat) {
  if (!combat || game.users.activeGM?.id !== game.user.id) return;
  // Bounded loop: a round boundary re-enters so a new round that opens on an all-stunned side still
  // auto-advances. autoSkipStunned CLEARS the stun, so a side can't stall a call for more than one lap.
  for (let guard = 0; guard < 8; guard++) {
    let side = activeSide(combat);
    while (side) {
      const pend = pendingOnSide(combat, side);
      if (pend.some((c) => !isSkippable(c))) break;      // a real, actable unit remains → await a pick
      for (const c of pend) await autoSkipStunned(combat, c);
      side = activeSide(combat);
    }
    if (side) {                                          // the active phase awaits a pick
      const cur = combat.combatant;
      if (!cur || hasActed(cur, combat.round) || combatantSide(cur) !== side) {
        if (combat.turn !== null) await combat.update({ turn: null });   // drop the spent / off-phase current
      }
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

/** Reset per-encounter (1/Conflict) state on every combatant actor — and, at combat START, refill any
 *  Boss to full Bars so a re-used Boss token is fresh. Deduped per actor. GM-side. */
async function resetEncounterState(combat, { bars = false } = {}) {
  if (!combat || game.users.activeGM?.id !== game.user.id) return;
  const seen = new Set();
  for (const c of combat.combatants) {
    const a = c.actor;
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    await dice.resetConflictUses(a);
    if (bars && a.type === "npc" && a.system.boss?.enabled) {
      const barCount = Number(a.system.boss.bars) || 1;
      const barHp = Number(a.system.boss.barHp) || a.system.hp.max || 1;
      await a.update({
        "system.boss.remaining": barCount,
        "system.boss.broken": 0,
        "system.boss.resolveUsed": false,
        "system.hp.value": barHp
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
// ENEMY-REWORK: the boss multi-entry action economy (actionsPerRound / ensureBossSlots / spreadBossInitiative
// above) is RETAINED but UNWIRED under Side Initiative — a boss acts once, in the Enemy Phase. The clone
// cleanup below is inert (no clones are created) but kept for when the enemy redesign revives boss slots.
Hooks.on("deleteCombatant", async (combatant) => {
  if (game.users.activeGM?.id !== game.user.id) return;
  const combat = combatant.parent;
  if (!combat || !combatant.getFlag("project-anime", "bossExpanded")) return;
  const orphans = combat.combatants
    .filter((c) => c.getFlag("project-anime", "bossClone") === combatant.id)
    .map((c) => c.id);
  if (orphans.length) await combat.deleteEmbeddedDocuments("Combatant", orphans);
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
  let crossed = false;
  for (const c of game.combat?.combatants ?? []) {
    if (c.actor?.uuid !== actor.uuid || c.defeated === defeated) continue;
    c.update({ defeated });
    crossed = true;
    // Auto-hide a defeated Hostile token (and reveal it again if it's healed back above 0). Only
    // Hostile tokens vanish: player characters (FRIENDLY) are downed, not removed, and recover at end
    // of combat (rules p.14), and friendly / neutral NPCs stay on the board. NPCs default Hostile.
    const tok = c.token;
    if (tok && tok.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE
        && tok.hidden !== defeated) tok.update({ hidden: defeated });
  }
  if (defeated && crossed) tickCard(actor, game.i18n.format("PROJECTANIME.Effect.defeated", { name: actor.name }));

  // v0.03 Gathering: a defeated foe yields materials to the party stash, once per defeat. Keyed off
  // the HP crossing (works in or out of combat) and guarded by a flag so a heal→re-defeat can drop
  // again. computeDrops returns nothing for an untiered/roleless NPC, so only Monster-Creator foes
  // drop; a Rival that keeps escaping is never defeated, so its Prime naturally waits.
  if (actor.type === "npc") {
    // A Boss's token HP hits 0 on every Bar break (then refills) — only drop when the LAST Bar is
    // gone (boss.remaining ≤ 0), so mid-fight breaks don't pay out early.
    const boss = actor.system.boss;
    const trulyDefeated = defeated && !(boss?.enabled && (Number(boss.remaining) || 0) > 0);
    const dropped = !!actor.getFlag("project-anime", "materialsDropped");
    if (trulyDefeated && !dropped) {
      actor.setFlag("project-anime", "materialsDropped", true);
      awardDefeatDrops(actor);
    } else if (!defeated && dropped) {
      actor.unsetFlag("project-anime", "materialsDropped");
    }
  }
}
Hooks.on("updateActor", markDefeatedFromHP);

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
  let content = `<p>${game.i18n.format("PROJECTANIME.Effect.criticalEntered", { name: actor.name })}</p>`;
  if (reacts.length) content += `<p class="muted">${game.i18n.format("PROJECTANIME.Effect.criticalReacts", { skills: reacts.join(", ") })}</p>`;
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
  band.textContent = game.i18n.localize(`PROJECTANIME.Combat.phase.${side}`);
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

/** End of combat: ANY still-Defeated combatant recovers to half their Max HP, rounded down
 *  (v0.03: "any character still Defeated recovers"). Hostile tokens auto-hidden at defeat STAY
 *  hidden — the combat is already gone by this hook, so markDefeatedFromHP's unhide never fires;
 *  the creature just isn't a corpse if the story brings it back. Only those at/below 0 HP —
 *  anyone who ended the fight above 0 keeps their HP. GM-side only. */
async function recoverDefeatedOnCombatEnd(combat) {
  if (game.users.activeGM?.id !== game.user.id) return;
  const seen = new Set();
  for (const c of combat.combatants ?? []) {
    const actor = c.actor;
    if (!actor || seen.has(actor.uuid)) continue;
    if (actor.type !== "character" && actor.type !== "npc") continue;
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

  // A Minion Squad pools its HP; the HP bar (number 0) appends its living-member count so the GM
  // reads "12 / 24 · 3◊" — three of the squad still standing — straight off the token.
  let labelText = `${data.value} / ${data.max}`;
  if (number === 0) {
    const actor = doc.actor;
    if (actor && isSquad(actor)) labelText += ` · ${squadMembers(actor)}/${squadSize(actor)}◊`;
  }
  paBarLabel(bar, labelText, innerW, bh);
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
Hooks.on("updateActor", (actor, changes) => { if (actor.type === "character" && "folder" in changes) { refreshOpenPartySheets(); reconcileHQBoons(); } });
Hooks.on("createActor", (actor) => { if (actor.type === "character") { refreshOpenPartySheets(); reconcileHQBoons(); } });
// A Follower Bond's residency / favored facility lives on the PC (system.bonds), not the HQ object, so a
// change there must nudge any open Headquarters window — its residents/candidates are derived from bonds.
Hooks.on("updateActor", (actor, changes) => {
  if (actor.type !== "character" || !foundry.utils.hasProperty(changes, "system.bonds")) return;
  for (const app of foundry.applications.instances.values()) if (app.id === "pa-codex") app.notifyHQChanged?.();
});
Hooks.on("deleteActor", (actor) => { if (actor.type === "character") refreshOpenPartySheets(); });

// SIGNATURE TRAIT + TRAITS: project the Signature Trait and each Trait as always-on AEs
// (helpers/trait-effect.mjs, the hq-boons HAVE/WANT mirror) whenever a card is authored/cleared or an
// actor is created. Internally GM-gated (single active GM); the ready hook below does the initial pass.
Hooks.on("updateActor", (actor, changes) => {
  if (foundry.utils.hasProperty(changes, "system.trait") || foundry.utils.hasProperty(changes, "system.traits")) reconcileTraits(actor);
});
Hooks.on("createActor", (actor) => reconcileTraits(actor));

// BONDS (v0.03): project each unlocked PARTY benefit as a toggleable AE (helpers/bond-effect.mjs
// reconcileBonds) AND keep both sides of every Party Bond consistent (helpers/bonds.mjs
// syncPartyBonds) whenever a character's bonds change (earn BP / rank up / forge) or an actor is
// created. Both are GM-gated + idempotent, like the trait projection above; the ready hook does the
// initial pass. Runs GM-side so a player can't self-grant by editing their own bond.
Hooks.on("updateActor", (actor, changes) => {
  if (foundry.utils.hasProperty(changes, "system.bonds")) { reconcileBonds(actor); syncPartyBonds(actor); }
});
Hooks.on("createActor", (actor) => reconcileBonds(actor));

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
  // Open the CODEX (Quests / Factions / Home) — available to everyone; the GM additionally authors here.
  tools["project-anime-codex"] = {
    name: "project-anime-codex",
    order: 99,
    title: "PROJECTANIME.Codex.open",
    icon: "fa-solid fa-house",
    button: true,
    onClick: () => Codex.open()
  };
  // (The Covenant scene-control button is gone: Bonds live on each character's "Bonds" sheet drawer,
  // and Factions + Home moved into the Codex.)
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
/*  HP baseline migration (one-time, v0.03)     */
/* -------------------------------------------- */

// v0.03: HP = 6 + ⟪Might⟫×2 (was ⟪Might⟫×2). Every existing Character gets the flat +6 on max
// AND current HP so nobody loads wounded; new Characters start on the new baseline via the
// schema/creator. GM-side, once per world. Reads `_source` so derived clamping never skews the
// arithmetic. NPCs are untouched (their vitals come from the Monster Creator's own model).
async function migrateHpBaseV003() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", HP_BASE_V003_SETTING)) return;
  const updates = [];
  for (const actor of game.actors) {
    if (actor.type !== "character") continue;
    const hp = actor._source.system?.hp ?? {};
    const max = (Number(hp.max) || 0) + 6;
    updates.push({ _id: actor.id, "system.hp.max": max, "system.hp.value": Math.min((Number(hp.value) || 0) + 6, max) });
  }
  if (updates.length) await Actor.updateDocuments(updates);
  await game.settings.set("project-anime", HP_BASE_V003_SETTING, true);
}

// v0.3.3: retire the flat HQ resource pools in favour of carried graded materials. Best-effort:
// convert whatever's in the legacy stockpile into Common Tier-I materials in the party stash, mapped
// by type (manacite→Essence, cloth→Hide, stone/wood→Ore, herb→Reagent). The pools are LEFT intact so
// the parallel HQ Workshop keeps working until Phase 6 fully retires it — this only SEEDS the new
// system, it doesn't drain the old. GM-side, once per world.
const POOL_TO_MATERIAL = { cloth: "hide", herb: "reagent", manacite: "essence", stone: "ore", wood: "ore" };
async function migrateMaterialsV003() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", MATERIALS_V003_SETTING)) return;

  const party = await resolveParty();
  let resources = {};
  try { resources = getHQ()?.resources ?? {}; } catch (_e) { /* HQ not set up — nothing to seed */ }

  let deposited = 0;
  if (party) {
    for (const [key, amt] of Object.entries(resources)) {
      const n = Math.floor(Number(amt) || 0);
      if (n <= 0) continue;
      await depositMaterial(party, { grade: "common", tier: 1, category: POOL_TO_MATERIAL[key] ?? "ore", qty: n });
      deposited += n;
    }
  }
  await game.settings.set("project-anime", MATERIALS_V003_SETTING, true);
  if (deposited > 0) {
    console.log(`Project: Anime | materialsV003: seeded ${deposited} Common material(s) from the legacy HQ pools into the party stash.`);
    ui.notifications.info(game.i18n.format("PROJECTANIME.Migration.materialsV003", { n: deposited }));
  }
}

/**
 * One-shot (v0.3.4): remap every legacy solo bond card to a v0.03 paired bond. The old model was a
 * per-character card (rank 0–5, `prog`, per-rank `abilities`, an `actorUuid` link) — the doc-v0.03
 * model is a paired relationship (kind/partnerUuid, rank C/B/A/S = index 0–3, Bond Points). Per the
 * owner's decision, every legacy card maps to a FOLLOWER Bond (they were NPC-linked): the old rank
 * 0–5 buckets to C/B/A/S and BP settles at that rank's threshold; identity (name/img/title/quote/
 * accent) carries over; the NPC link becomes partnerUuid; the authored abilities/dossier/vitals are
 * dropped (doc-minimal). Reads `_source` so the new schema's cleaning hasn't yet stripped the legacy
 * fields. GM-side, once.
 */
async function migrateBondsV003() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", BONDS_V003_SETTING)) return;

  const updates = [];
  let migrated = 0;
  for (const actor of game.actors) {
    if (actor.type !== "character") continue;
    const raw = actor._source.system?.bonds;
    if (!Array.isArray(raw) || !raw.length) continue;
    // Only touch actors that still hold at least one LEGACY card (a v0.03 bond always has `kind`).
    if (!raw.some((b) => b && b.kind === undefined)) continue;

    const next = raw.map((b) => {
      if (b?.kind !== undefined) return b;   // already v0.03 — leave it
      const oldRank = Math.max(0, Math.min(5, Number(b?.rank) || 0));
      const rank = Math.min(PROJECTANIME.bondMaxRank, Math.round(oldRank * 0.6));   // 0→C 1→C 2→B 3→A 4→A 5→S
      return blankBond({
        id: b?.id || foundry.utils.randomID(),
        kind: "follower",
        partnerUuid: b?.actorUuid || "",
        name: b?.name || game.i18n.localize("PROJECTANIME.Bond.newBondName"),
        img: b?.img || "",
        title: b?.title || "",
        quote: b?.quote || "",
        accent: b?.accent || "",
        rank,
        bp: PROJECTANIME.bondThresholds[rank] || 0
      });
    });
    updates.push({ _id: actor.id, "system.bonds": next });
    migrated += next.length;
  }
  if (updates.length) await Actor.updateDocuments(updates, { diff: false, recursive: false });
  await game.settings.set("project-anime", BONDS_V003_SETTING, true);
  if (migrated) console.log(`Project: Anime | bondsV003 — remapped ${migrated} legacy bond card(s) to v0.03 Follower Bonds.`);
}

/**
 * One-shot (v0.3.5): stand up the doc-v0.03 Headquarters. The base's identity (name/crest/accent/motto/
 * banner) carries over untouched; a world that already used the HQ is marked "established" so its v0.03
 * fields (rank C, a fresh 14-facility catalog, the Mission Board) come alive on the Home tab. The legacy
 * resource pools are DRAINED (zeroed) here — Phase 4 already copied them into the party stash as carried
 * materials, and the parallel HQ Workshop that kept them is retired. The dormant legacy People/Facilities/
 * dispatch data is left in place (unsurfaced) so nothing is lost, but the v0.03 Home tab reads only the
 * new fields. GM-side, once per world.
 */
async function migrateHqV003() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", HQ_V003_SETTING)) return;

  let hq;
  try { hq = getHQ(); } catch (_e) { hq = null; }
  if (hq) {
    const usedBefore = !!(hq.name || hq.crest || hq.motto || hq.banner
      || (hq.people ?? []).length || (hq.facilities ?? []).length || (hq.recruits ?? []).length
      || Object.keys(hq.resources ?? {}).length);
    if (usedBefore) hq.established = true;
    if (!hq.rank) hq.rank = "C";
    hq.resources = {}; // pools drained (already seeded to the stash in v0.3.3); Workshop retired
    await saveHQ(hq);
  }
  await game.settings.set("project-anime", HQ_V003_SETTING, true);
  console.log("Project: Anime | hqV003 — Headquarters migrated to the v0.03 model (pools drained; catalog facilities + Mission Board live).");
}

/**
 * One-shot: remap every existing monster NPC from the retired ★×Tier model to v0.03 Role × Tier.
 *  • shape → Role: minion → Swarm · standard → Grunt · elite / solo → Elite (a Solo becomes an Elite;
 *    the GM re-flags it a Boss if wanted — the Solo/champion model is retired).
 *  • stars → Tier: 1–2 → I · 3 → II · 4 → III · 5 → IV · unrated → II (on-level).
 * Then recompute the finished statblock (Strong/Weak dice derive live; store HP/EP + role delta bonuses)
 * and retire the legacy tier/stars/squad fields so squad pooling never re-engages. Social NPCs (role
 * "npc") and NPCs already on the new model are skipped. Logs the count. GM-side, once.
 */
async function migrateNpcRoleV003() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", NPC_ROLE_V003_SETTING)) return;
  const shapeToRole = { minion: "swarm", standard: "grunt", elite: "elite", solo: "elite" };
  const starToTier = (s) => (s >= 5 ? 4 : s >= 4 ? 3 : s >= 3 ? 2 : s >= 1 ? 1 : 2);
  const updates = [];
  for (const actor of game.actors) {
    if (actor.type !== "npc") continue;
    const sys = actor._source.system ?? {};
    if ((sys.role ?? "monster") === "npc") continue;    // social NPC — no combat statblock
    if (sys.enemyRole) continue;                        // already migrated
    const legacyTier = sys.tier;
    const stars = Number(sys.stars) || 0;
    // Only convert NPCs that were actually built on the old model (a legacy shape or a star rating).
    if (!shapeToRole[legacyTier] && stars < 1) continue;
    const roleKey = shapeToRole[legacyTier] ?? "grunt";
    const tier = starToTier(stars);
    // Elite picks three Strong Attributes — carry over the three highest from the old five-attribute build.
    let strongAttrs = [];
    if (roleKey === "elite") {
      strongAttrs = [...PROJECTANIME.attributeKeys]
        .sort((a, b) => (Number(sys.attributes?.[b]?.base) || 4) - (Number(sys.attributes?.[a]?.base) || 4))
        .slice(0, 3);
    }
    const strong = enemyStrongAttrs(roleKey, strongAttrs);
    const { hp, energy } = enemyVitals(roleKey, tier, strong);
    const d = PROJECTANIME.enemyRoles[roleKey]?.deltas ?? {};
    updates.push({
      _id: actor.id,
      "system.enemyRole": roleKey,
      "system.enemyTier": tier,
      "system.strongAttrs": strongAttrs,
      "system.hp.max": hp, "system.hp.value": hp,
      "system.energy.max": energy, "system.energy.value": energy,
      "system.atk.bonus": Number(d.atk) || 0,
      "system.matk.bonus": Number(d.atk) || 0,
      "system.defense.bonus": Number(d.defense) || 0,
      "system.res.bonus": Number(d.res) || 0,
      "system.evasion.bonus": Number(d.evasion) || 0,
      "system.as.bonus": Number(d.as) || 0,
      "system.movement.bonus": Number(d.movement) || 0,
      // Retire the legacy shape + squad so pooling never re-engages (fields kept only for validation).
      "system.tier": "",
      "system.stars": 0,
      "system.squad.size": 1
    });
  }
  if (updates.length) await Actor.updateDocuments(updates);
  console.log(`Project: Anime | NPC Role v0.03 — remapped ${updates.length} monster NPC(s) to Role × Tier.`);
  await game.settings.set("project-anime", NPC_ROLE_V003_SETTING, true);
}

/* -------------------------------------------- */

// v0.03: re-base every EXISTING world/actor-owned weapon, armor, and shield to the new gear
// tables (the packs are reconciled separately by auditGearPacks). Renamed items ("Katana") are
// found through their compendium origin (_stats.compendiumSource → pack index name); items with
// no origin match by name. GM homebrew that matches neither is untouched. Natural Attacks move
// from the old Unarmed DMG −2 to the v0.03 flat 0 unless the GM retuned them. GM-side, once.
async function migrateGearRebaseV003() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", GEAR_REBASE_V003_SETTING)) return;
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
  const updatesFor = (items, { npc = false } = {}) => {
    const updates = [];
    for (const item of items) {
      if (item.getFlag("project-anime", "natural")) {
        const mod = Number(item.system?.damage?.mod) || 0;
        // PCs: old Unarmed −2 → the doc's 0. NPCs: their innate strikes ride the v0.02 scale
        // (0) — lift to blade-tier 3 so monsters keep pace with the rebased party until the
        // Phase-3 enemy redesign recalibrates them properly.
        if (npc && (mod === 0 || mod === -2)) updates.push({ _id: item.id, "system.damage.mod": 3 });
        else if (!npc && mod === -2) updates.push({ _id: item.id, "system.damage.mod": 0 });
        continue;
      }
      // Monster-Creator Basic Attacks (icons/svg/sword.svg, size 0, no compendium origin) carry
      // no `natural` flag — catch them by shape so existing monsters get the same interim lift.
      if (npc && item.type === "weapon" && item.img === "icons/svg/sword.svg" && !(Number(item.system?.size) || 0)
          && !item._stats?.compendiumSource && (Number(item.system?.damage?.mod) || 0) <= 0) {
        updates.push({ _id: item.id, "system.damage.mod": 3 });
        continue;
      }
      const row = rowFor(item);
      if (row) updates.push({ _id: item.id, ...row });
    }
    return updates;
  };
  let count = 0;
  const worldUpdates = updatesFor(game.items);
  if (worldUpdates.length) { await Item.updateDocuments(worldUpdates); count += worldUpdates.length; }
  for (const actor of game.actors) {
    const updates = updatesFor(actor.items, { npc: actor.type === "npc" });
    if (updates.length) { await actor.updateEmbeddedDocuments("Item", updates); count += updates.length; }
  }
  if (count) console.log(`Project: Anime | Gear rebase — ${count} owned/world item(s) aligned to the v0.03 tables.`);
  await game.settings.set("project-anime", GEAR_REBASE_V003_SETTING, true);
}

/* -------------------------------------------- */
/*  Skill-Point ledger backfill (one-time)      */
/* -------------------------------------------- */

// Seed the Skill-Point ledger for characters made before it existed: one refundable "skill"
// entry per self-built Skill (its spCost), plus a single non-refundable "Prior advancement"
// lump estimating SP spent on attribute raises (the 5 cheapest steps are the free creation
// step-ups) + stat buys (carry/move bonuses + HP/Energy bought over the 6+Might×2 / Spirit×2 baseline).
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
    spent += Math.max(0, Math.round(((src.hp?.max ?? 0) - (6 + might * 2)) / 2));
    spent += Math.max(0, Math.round(((src.energy?.max ?? 0) - spirit * 2) / 2));
    if (spent > 0) log.push({ id: foundry.utils.randomID(), label: game.i18n.localize("PROJECTANIME.SkillLog.legacy"), amount: spent, kind: "legacy", ref: "", data: {}, time: null });

    updates.push({ _id: actor.id, "system.skillPoints.log": log, "flags.project-anime.spLogBackfilled": true });
  }
  if (updates.length) await Actor.updateDocuments(updates);
}

/* -------------------------------------------- */
/*  NPC Skill-Point ledger backfill (one-time)  */
/* -------------------------------------------- */

// Give existing NPCs the SAME refundable Skill-Point ledger PCs carry, synthesised from current
// state so "Spent" stays correct once the ledger view takes over: one refundable "skill" entry per
// self-built Skill, plus one non-refundable "legacy" lump for the remainder of the old `spent`
// scalar (the attribute / stat advancement). GM-side, once per NPC (flag "npcStarLogBackfilled").
// NOTE: we deliberately do NOT auto-stamp a ★ star rating here — a legacy NPC was built against the
// global Encounter Power dial, not a known star, so guessing a star would mislabel its power level
// (and resize how the Monster Creator would rebuild it). The encounter budget now reads from the Tier
// in Party-Equivalents, not the star, so leaving a legacy NPC unrated never changes a planned fight's
// cost. The GM rates a monster when they choose, via the Monster Creator's star picker (or the sheet).
async function backfillNpcSkillLog() {
  if (game.users.activeGM?.id !== game.user.id) return;
  const updates = [];
  for (const actor of game.actors) {
    if (actor.type !== "npc") continue;
    if (actor.getFlag("project-anime", "npcStarLogBackfilled")) continue;
    const sys = actor.system ?? {};
    const upd = { _id: actor.id, "flags.project-anime.npcStarLogBackfilled": true };
    // Ledger seed: skip NPCs already on the log (created after this feature).
    const sp = sys.skillPoints ?? {};
    if (!Array.isArray(sp.log) || !sp.log.length) {
      const log = [];
      let skillsTotal = 0;
      for (const item of actor.items) {
        if (item.type !== "skill" || item.getFlag("project-anime", "granted")) continue;
        const amount = Number(item.system?.spCost ?? 0) || 0;
        if (amount > 0) { log.push({ id: foundry.utils.randomID(), label: item.name, amount, kind: "skill", ref: item.id, data: {}, time: null }); skillsTotal += amount; }
      }
      // The old `spent` scalar tracked skills + advancement; the non-skill remainder is the legacy lump.
      const advance = Math.max(0, (Number(sp.spent) || 0) - skillsTotal);
      if (advance > 0) log.push({ id: foundry.utils.randomID(), label: game.i18n.localize("PROJECTANIME.SkillLog.legacy"), amount: advance, kind: "legacy", ref: "", data: {}, time: null });
      upd["system.skillPoints.log"] = log;
    }
    updates.push(upd);
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

// (The v0.01 "Unarmed DMG −2" backfill is retired: v0.03's Unarmed row is DMG 0, new Natural
// Attacks are born at 0, and migrateGearRebaseV003 lifts the old −2 copies. The unarmedDmgV001
// world key may linger in old worlds' settings, unregistered and unread — harmless.)

/* -------------------------------------------- */
/*  Weapon Type from name backfill (one-time)   */
/* -------------------------------------------- */

// Seed each existing weapon/shield's Type — the game's weapons were all named after their type (a
// "Sword" item IS a Sword) before the Weapon Type field existed, so a "Weapon Adjustment" scoped
// "By weapon type" can match them out of the box: a normal weapon/shield takes its NAME, the innate
// Natural Attack takes "Unarmed". Only fills a BLANK weaponType (a deliberately-set one is left
// alone). Covers world Items and every actor's embedded gear. GM-side, once per world.
async function backfillWeaponTypes() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", WEAPON_TYPE_BACKFILL_SETTING)) return;

  // The Type to seed onto an item, or null if it shouldn't be touched.
  const desiredType = (i) => {
    if (i.type !== "weapon" && i.type !== "shield") return null;
    if (String(i.system?.weaponType ?? "").trim()) return null;          // already set — leave alone
    if (i.getFlag("project-anime", "natural")) return "Unarmed";          // the innate strike
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

  // Embedded gear on every actor (where the Natural Attacks live).
  for (const actor of game.actors) {
    const updates = buildUpdates(actor.items);
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }

  await game.settings.set("project-anime", WEAPON_TYPE_BACKFILL_SETTING, true);
}

/* -------------------------------------------- */
/*  Encounter squad migration (one-time)        */
/* -------------------------------------------- */

// Retire the old Encounter-Builder "× quantity" multiplier. Each legacy line carried a `qty`; under
// the new squad model a Minion fields as ONE pooled squad (qty → its squad SIZE) and a Standard /
// Elite / Solo is one body per line (qty → that many individual lines). Consumes `qty` (it is a
// transitional field) and normalizes every party's encounter array. GM-side, once per world.
async function migrateEncounterSquads() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", ENCOUNTER_SQUAD_MIGRATION_SETTING)) return;
  for (const party of game.actors) {
    if (party.type !== "party") continue;
    const list = party.system?.encounter ?? [];
    if (!list.length || !list.some((e) => e?.qty != null)) continue;   // nothing legacy to consume
    const next = [];
    for (const e of list) {
      const qty = Number(e?.qty);
      const n = Number.isFinite(qty) && qty > 1 ? Math.floor(qty) : 1;
      const actor = e?.uuid ? (fromUuidSync(e.uuid) ?? null) : null;
      if (actor && isMinionTier(actor)) {
        if (n > 1) await setSquadSize(actor, n);                       // a stack → one squad of n
        next.push({ id: e.id || foundry.utils.randomID(), uuid: e.uuid });
      } else if (n > 1) {
        for (let i = 0; i < n; i++) next.push({ id: foundry.utils.randomID(), uuid: e.uuid }); // n bodies
      } else {
        next.push({ id: e.id || foundry.utils.randomID(), uuid: e.uuid });
      }
    }
    await party.update({ "system.encounter": next });
  }
  await game.settings.set("project-anime", ENCOUNTER_SQUAD_MIGRATION_SETTING, true);
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

  // One-time (v0.03): raise every Character to the HP = 6 + ⟪Might⟫×2 baseline, THEN seed the
  // Skill-Point ledger — its "HP bought over baseline" lump must read post-migration HP.
  migrateHpBaseV003().then(() => backfillSkillPointLog());

  // One-time: give pre-existing NPCs their own refundable Skill-Point ledger (left unrated by ★).
  backfillNpcSkillLog();

  // One-time: give pre-existing creatures their innate Natural Attack.
  backfillNaturalAttacks();

  // One-time: seed each weapon/shield's Type from its name (they were named after their type).
  backfillWeaponTypes();

  // One-time: migrate legacy Encounter-Builder "× qty" lines to the squad model (minion qty → squad
  // size; non-minion qty → individual lines).
  migrateEncounterSquads();

  // One-time (v0.3.2): remap monster NPCs from ★×Tier to the v0.03 Role × Tier model.
  migrateNpcRoleV003();

  // One-time (v0.3.3): seed carried materials from the legacy HQ resource pools (pools kept for the
  // parallel Workshop until Phase 6).
  migrateMaterialsV003();

  // One-time (v0.3.4): remap legacy solo bond cards to v0.03 paired Follower Bonds.
  migrateBondsV003();
  migrateHqV003();

  // One-time: materialise the 12 Twists into the Skills compendium as pickable Skill items.
  if (paIsActiveGM() && !game.settings.get("project-anime", TWIST_SEED_SETTING)) {
    seedTwistSkills().then(() => game.settings.set("project-anime", TWIST_SEED_SETTING, true));
  }

  // One-time (v0.03): reconcile the gear compendiums to the rules doc's tables, then re-base the
  // copies players already own (order matters — the rebase reads the freshly-audited pack index).
  if (paIsActiveGM() && !game.settings.get("project-anime", PACK_AUDIT_SETTING)) {
    auditGearPacks()
      .then(() => game.settings.set("project-anime", PACK_AUDIT_SETTING, true))
      .then(() => migrateGearRebaseV003());
  } else {
    migrateGearRebaseV003();
  }

  // One-time: switch existing tokens to always-on HP/Energy bars (the bottom-stacked overlay).
  backfillAlwaysBars();

  // One-time: back each existing Party with a real Folder (migrating any legacy system.members),
  // then ensure the world ships with a Party at all — seed a starter one if it has none.
  if (paIsActiveGM()) ensureAllPartyFolders().then(ensureDefaultParty);

  // One-time HQ migrations (ordered): fold any legacy per-faction recruit rosters into the HQ pool,
  // THEN split the fused recruits[] into the People/Facilities model, THEN project passive boons.
  if (paIsActiveGM()) { migrateRostersToHQ().then(() => migrateHQModel()).then(() => reconcileHQBoons()); }

  // Initial self-healing pass for every actor's Signature Trait + Traits (the onChange hooks don't fire
  // on load). Each call is GM-gated + idempotent, so it's a cheap no-op for actors with no trait cards.
  if (paIsActiveGM()) for (const a of game.actors ?? []) reconcileTraits(a);

  // Initial pass for Party-benefit effects + party-bond sync too (GM-gated, idempotent no-op for
  // bondless actors).
  if (paIsActiveGM()) for (const a of game.actors ?? []) { reconcileBonds(a); syncPartyBonds(a); }

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
    else if (payload?.type === "applyStatus") dice.applyStatusTo(payload.targetUuid, payload.statusId, payload.active, payload.duration, { decayType: payload.decayType, value: payload.value, pool: payload.pool, overcomeCT: payload.overcomeCT });
    else if (payload?.type === "applyEffect") dice.applyEffectTo(payload.targetUuid, payload.effectData);
    else if (payload?.type === "stealItem") dice.stealItemTo(payload.stealerUuid, payload.targetUuid, payload.itemId);
    else if (payload?.type === "createItems") dice.createItemsOn(payload.targetUuid, payload.items);
    else if (payload?.type === "raiseServant") raiseServant(payload.casterUuid, payload.itemId, payload.corpseUuid, payload.userId);
    else if (payload?.type === "createCompanion") createCompanion(payload.casterUuid, payload.itemId, payload.name, payload.userId);
    else if (payload?.type === "dismissServant") removeServantActor(payload.servantUuid);
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
    else if (payload?.type === "buildFacility") {
      // A player asked to build/upgrade an HQ facility. The HQ is GM-owned, so the GM performs it —
      // but ONLY for a facility the GM has flagged `unlocked` (others are GM-managed; players can't touch).
      const f = getHQ().facilities.find((x) => x.id === payload.facilityId);
      if (f && f.unlocked) buildFacility(payload.facilityId);
    }
    else if (payload?.type === "craftRecipe") {
      // A player asked to craft at a Workshop. The HQ is GM-owned, so the GM performs the craft —
      // but ONLY at a workshop facility the GM has flagged `unlocked` (others are GM-managed).
      const f = getHQ().facilities.find((x) => x.id === payload.facilityId);
      if (f && f.role === "workshop" && f.unlocked) craftRecipe(payload.facilityId, payload.recipeId);
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
