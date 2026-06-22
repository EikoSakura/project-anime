/**
 * Project: Anime — system entry point for Foundry VTT V13.
 */
import * as models from "./data/_module.mjs";
import { ProjectAnimeActor, enforceEquipExclusivity, refundSkillOnDelete, naturalAttackData, ensureNaturalAttack } from "./documents/actor.mjs";
import { ProjectAnimeItem } from "./documents/item.mjs";
import { ProjectAnimeActorSheet } from "./sheets/actor-sheet.mjs";
import { ProjectAnimePartySheet } from "./sheets/party-sheet.mjs";
import { ProjectAnimeItemSheet } from "./sheets/item-sheet.mjs";
import { PROJECTANIME, ENCOUNTER_POWER_SETTING, cursedPools } from "./helpers/config.mjs";
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
import { auditGearPacks, PACK_AUDIT_SETTING } from "./helpers/pack-audit.mjs";
import { syncAuras, isAuraEffect } from "./helpers/aura.mjs";
import { EffectsPanel } from "./apps/effects-panel.mjs";
import { TokenInfoPanel, TOKEN_INFO_SETTING, TOKEN_INFO_CLIENT_SETTING, canSeeTokenVitals } from "./apps/token-info.mjs";
import { TokenDossier } from "./apps/token-dossier.mjs";
import { RangeLine, RANGE_LINE_SETTING, RANGE_LINE_CLIENT_SETTING } from "./apps/range-line.mjs";
import { AuraField } from "./apps/aura-field.mjs";
import { patchEffectsHalo } from "./apps/effects-halo.mjs";
import { ComboSplash, COMBO_SPLASH_SETTING, COMBO_SPLASH_CLIENT_SETTING } from "./apps/combo-splash.mjs";
import { ensurePartyFolder, ensureAllPartyFolders, syncPartyFolderName, deletePartyFolder, partyMembers } from "./helpers/party-folder.mjs";
import { AnimeHud, AnimePartyRail, AnimeCombatTracker, registerHudSettings, applyHudState, HUD_ENABLED_SETTING, HUD_SHOW_PARTY_SETTING, HUD_COMBAT_SETTING } from "./apps/anime-hud.mjs";
import { Codex, ChronicleTracker } from "./apps/codex.mjs";
import { QUESTS_SETTING, TRACKED_SETTING, TRACKER_VISIBLE_SETTING } from "./helpers/chronicle.mjs";
import { FACTIONS_SETTING, HQ_SETTING, DEATH_STRIKES_SETTING, CRAFT_REQUIRE_SETTING, migrateRostersToHQ, migrateHQModel, getHQ, buildFacility, craftRecipe } from "./helpers/factions.mjs";
import { ARCHIVE_SETTING } from "./helpers/archive.mjs";
import { reconcileHQBoons } from "./helpers/hq-boons.mjs";
import { reconcileTraits } from "./helpers/trait-effect.mjs";
import { reconcileBonds } from "./helpers/bond-effect.mjs";
import { registerPartySettings } from "./apps/party-config.mjs";

const { Actors, Items } = foundry.documents.collections;
const { ActorSheet, ItemSheet } = foundry.appv1.sheets;

// Hidden world flag — set once after the bottom-stacked HP/Energy bars migrate existing tokens.
const BARS_BACKFILLED_SETTING = "barsBackfilled";

// Hidden world flag — set once after existing Natural Attacks pick up the weapon table's
// Unarmed DMG −2 (v0.01).
const UNARMED_DMG_SETTING = "unarmedDmgV001";

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

/* -------------------------------------------- */
/*  Init                                        */
/* -------------------------------------------- */

Hooks.once("init", function () {
  console.log("Project: Anime | Initializing system");

  // Expose useful classes on the global scope for macros / downstream modules.
  globalThis.projectanime = {
    documents: { ProjectAnimeActor, ProjectAnimeItem },
    applications: { ProjectAnimeActorSheet, ProjectAnimeItemSheet, Codex },
    dice,
    models
  };

  // Configuration constants.
  CONFIG.PROJECTANIME = PROJECTANIME;

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
        if (app.id === "pa-codex") app.render({ parts: ["quests"] });
      }
      ChronicleTracker.refresh();
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
  // good. Off → agents only ever come back wounded. A rules toggle, so it's world-scoped + visible.
  game.settings.register("project-anime", DEATH_STRIKES_SETTING, {
    name: "PROJECTANIME.Settings.hqDeathStrikes.name",
    hint: "PROJECTANIME.Settings.hqDeathStrikes.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // Crafting: when on (default), a Workshop recipe's `requires[]` facility prerequisites are enforced;
  // off → recipes gate on Workshop tier + resource cost only (pure tier-gating). World-scoped rules knob.
  game.settings.register("project-anime", CRAFT_REQUIRE_SETTING, {
    name: "PROJECTANIME.Settings.craftRequireFacilities.name",
    hint: "PROJECTANIME.Settings.craftRequireFacilities.hint",
    scope: "world",
    config: true,
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
  for (const key of [PACK_AUDIT_SETTING, UNARMED_DMG_SETTING, WEAPON_TYPE_BACKFILL_SETTING, DEFAULT_PARTY_SETTING]) {
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

  // Effects Halo: show ALL of the actor's active effects (not just status conditions) as a ring of
  // round icon badges around the token, replacing the default corner stack (PF2e-style).
  patchEffectsHalo(TokenClass);

  // Register the system's status conditions (token HUD icons + Active Effects).
  CONFIG.statusEffects = PROJECTANIME.statusConditions.map((c) => ({ ...c }));

  // Initiative Check (rules p.13): roll the Agility die + the Mind die; the highest total acts
  // first. Tiebreakers ride as fractions (small enough never to flip a real total): the larger
  // Agility die wins a tie (+Agility/100), and an enemy acts before any player it still ties
  // with (+0.001 for NPCs — see ProjectAnimeActor#getRollData's `tiebreak`). The tracker displays
  // the whole number only (decimals: 0); the fractions still order ties, they just don't show.
  CONFIG.Combat.initiative = {
    formula: "1d@attributes.agility.value + 1d@attributes.mind.value + (@attributes.agility.value / 100) + (@tiebreak.npc / 1000)",
    decimals: 0
  };

  // Extra-turn grants on `nextTurn` — patched on the prototype so every advance path (tracker
  // buttons, the HUD's End Turn relay) honors them. Two stack on top of each other:
  //   1. COMBO (rules p.13): "the moment it resolves you take an additional turn". A Combo scored on
  //      the roller's own turn flags the combat (dice.mjs maybeGrantComboTurn, GM-relayed); the next
  //      advance consumes the flag, STAYS on that combatant, and marks the grant so a Combo during it
  //      can't chain another.
  //   2. SOLO extra turns: an apex Solo monster acts multiple times per round (its Tier `turns`, +1
  //      at ★4+). Each End-Turn while a Solo has turns left STAYS on it (a fresh turn) and ticks a
  //      per-round counter; only the final one advances. The counter resets each round (the flag is
  //      keyed to combat.round). A forced advance (`_paSkipExtra`, set by the Stunned skip) bypasses
  //      BOTH so a stunned Solo still loses its turn instead of being handed an extra one.
  const CombatClass = CONFIG.Combat.documentClass ?? Combat;
  if (!CombatClass.prototype._paNextTurnPatched) {
    const baseNextTurn = CombatClass.prototype.nextTurn;
    CombatClass.prototype.nextTurn = async function () {
      // Forced advance (Stunned skip) — no extra turns, just pass.
      if (this._paSkipExtra) { delete this._paSkipExtra; return baseNextTurn.call(this); }
      const cur = this.combatant;

      // 1) Combo extra turn.
      const pending = this.getFlag("project-anime", "comboTurn");
      if (pending && cur && pending === `${cur.id}:${this.round}`) {
        await this.update({
          "flags.project-anime.-=comboTurn": null,
          "flags.project-anime.comboGranted": `${cur.id}:${this.round}`
        });
        if (cur.actor) {
          ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: cur.actor }),
            content: `<div class="project-anime chat-card"><div class="card-line"><em class="muted">${game.i18n.format("PROJECTANIME.Effect.comboTurn", { name: cur.actor.name })}</em></div></div>`
          });
        }
        return this;
      }
      // A stale pending grant (the turn moved on some other way) dies with the advance.
      if (pending) await this.unsetFlag("project-anime", "comboTurn");

      // 2) Solo extra turns — stay on a Solo until it has used its per-round turn allotment.
      if (cur && this.started) {
        const turns = soloTurnsPerRound(cur);
        if (turns > 1) {
          const tracker = this.getFlag("project-anime", "soloTurn");
          const used = (tracker && tracker.round === this.round) ? (Number(tracker.used) || 0) : 0;
          if (used < turns - 1) {
            await this.setFlag("project-anime", "soloTurn", { round: this.round, used: used + 1 });
            if (cur.actor) {
              ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: cur.actor }),
                content: `<div class="project-anime chat-card"><div class="card-line"><em class="muted">${game.i18n.format("PROJECTANIME.Effect.soloTurn", { name: cur.actor.name, n: used + 2, total: turns })}</em></div></div>`
              });
            }
            return this; // hold the turn on the Solo — its next action
          }
          if (tracker) await this.unsetFlag("project-anime", "soloTurn"); // allotment spent → advance
        }
      }
      return baseNextTurn.call(this);
    };
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
  // (absorb heals; immune lands 0; resist now floors at 1 like every other HP hit).
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

/** How many combat turns a combatant takes per round (action economy). A Monster-role Solo takes its
 *  Tier's `turns` (2), bumped to 3 at the apex ★4+; everything else takes 1. Drives the Solo extra-turn
 *  logic in the `nextTurn` patch — tunable via PROJECTANIME.monsterTiers[…].turns. */
function soloTurnsPerRound(combatant) {
  const a = combatant?.actor;
  if (a?.type !== "npc" || (a.system?.role ?? "monster") === "npc") return 1;
  const tier = PROJECTANIME.monsterTiers?.[a.system?.tier];
  let turns = tier?.turns ?? 1;
  if (a.system?.tier === "solo" && (Number(a.system?.stars) || 0) >= 4) turns += 1;
  return Math.max(1, turns);
}

/** Runaway guard: bounds the chain of consecutive Stunned skips so a status that somehow can't be
 *  cleared can never spin the tracker forever. Reset whenever the turn lands on a non-Stunned actor. */
let stunnedSkipChain = 0;

/** Stunned (rules p.13): the creature loses its next turn entirely (no Move, no Action), then Stunned
 *  ends. At the START of a Stunned creature's turn we announce it, remove the status, and auto-advance
 *  the tracker so the turn is skipped. Consecutive Stunned creatures chain (each is skipped in turn).
 *  GM-side only (the caller is gated). Returns true if a turn was skipped. */
async function tickStunned(combat, started) {
  const actor = started?.actor;
  if (!actor?.statuses?.has?.("stunned")) { stunnedSkipChain = 0; return false; }
  // Safety: if a Stunned status can't be cleared, stop after one full lap rather than loop forever.
  if (stunnedSkipChain > (combat.combatants?.size ?? 0)) { stunnedSkipChain = 0; return false; }
  stunnedSkipChain += 1;
  tickCard(actor, game.i18n.format("PROJECTANIME.Effect.stunnedSkip", { name: actor.name }));
  await actor.toggleStatusEffect?.("stunned", { active: false });
  // Force a real advance: this is a SKIP, so the extra-turn grants (Combo / Solo) must not fire and
  // hand a stunned creature another turn. The flag is consumed at the top of the nextTurn patch.
  combat._paSkipExtra = true;
  await combat.nextTurn();   // re-enters combatTurnTick for the now-current combatant (chains if also Stunned)
  return true;
}

/**
 * Combat turn-tick automation (GM-side only, mirroring expireEffects' single-active-GM guard).
 * On a turn/round advance: the combatant whose turn just ENDED takes Decay and counts down its
 * status durations; the one whose turn just STARTED gets Sustain regen, then — if Stunned — has its
 * turn auto-skipped. Reads combat.previous / combat.current. Sustain regen is gated to once per round
 * per combatant via a high-water `sustainRound` flag, so stepping back through the turn order — within
 * a round or across rounds — never re-heals.
 */
async function combatTurnTick(combat, change) {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (!("turn" in change) && !("round" in change)) return;
  const endedActor = combat.combatants.get(combat.previous?.combatantId)?.actor ?? null;
  const started = combat.combatants.get(combat.current?.combatantId) ?? null;
  if (endedActor) {
    await tickDecay(endedActor);
    await tickStatusDurations(endedActor);
  }
  if (started?.actor) {
    // HP/Energy regen applies once per round: only when this combatant first reaches a round it
    // hasn't sustained in yet. Going back in the turn order won't clear the flag, so it won't reheal.
    // Channeled upkeep rides the same once-per-round gate (1 EP per open channel, rules v0.01) —
    // regen first, then the channel bill, then a Stunned creature's turn is skipped (a channel
    // holds while Stunned: the EP keeps flowing even though the bearer can't act).
    const lastSustained = Number(started.getFlag("project-anime", "sustainRound")) || 0;
    if (combat.round > lastSustained) {
      await started.setFlag("project-anime", "sustainRound", combat.round);
      await tickSustain(started.actor);
      await tickChanneled(started.actor);
    }
    await tickStunned(combat, started);
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
}
Hooks.on("updateActor", markDefeatedFromHP);

/** End of combat: any still-Defeated character recovers to half their Max HP, rounded down
 *  (rules: "any character still Defeated"). Player characters always; NPCs only if they're NOT
 *  hostile (a downed ally/bystander gets back up — defeated enemies stay down, and their tokens
 *  stay auto-hidden rather than popping back onto the field). Only those at/below 0 HP — anyone
 *  who ended the fight above 0 keeps their HP. GM-side only. */
async function recoverDefeatedOnCombatEnd(combat) {
  if (game.users.activeGM?.id !== game.user.id) return;
  const seen = new Set();
  for (const c of combat.combatants ?? []) {
    const actor = c.actor;
    if (!actor || seen.has(actor.uuid)) continue;
    const friendlyNpc = actor.type === "npc" && actor.system?.disposition !== "hostile";
    if (actor.type !== "character" && !friendlyNpc) continue;
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
Hooks.on("deleteActor", (actor) => { if (actor.type === "character") refreshOpenPartySheets(); });

// SIGNATURE TRAIT + TRAITS: project the Signature Trait and each Trait as always-on AEs
// (helpers/trait-effect.mjs, the hq-boons HAVE/WANT mirror) whenever a card is authored/cleared or an
// actor is created. Internally GM-gated (single active GM); the ready hook below does the initial pass.
Hooks.on("updateActor", (actor, changes) => {
  if (foundry.utils.hasProperty(changes, "system.trait") || foundry.utils.hasProperty(changes, "system.traits")) reconcileTraits(actor);
});
Hooks.on("createActor", (actor) => reconcileTraits(actor));

// BOND rank effects: project each UNLOCKED bond rank's no-code Effect as an always-on AE and deliver
// its Grant Items/Skills (helpers/bond-effect.mjs) whenever a character's bonds change (deepen/lessen/
// forge) or an actor is created. GM-gated + idempotent, like the trait projection above; the ready
// hook does the initial pass. Runs GM-side so a player can't self-grant by editing their own bond.
Hooks.on("updateActor", (actor, changes) => {
  if (foundry.utils.hasProperty(changes, "system.bonds")) reconcileBonds(actor);
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
    icon: "fa-solid fa-book-open",
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
/*  NPC Skill-Point ledger backfill (one-time)  */
/* -------------------------------------------- */

// Give existing NPCs the SAME refundable Skill-Point ledger PCs carry, synthesised from current
// state so "Spent" stays correct once the ledger view takes over: one refundable "skill" entry per
// self-built Skill, plus one non-refundable "legacy" lump for the remainder of the old `spent`
// scalar (the attribute / stat advancement). GM-side, once per NPC (flag "npcStarLogBackfilled").
// NOTE: we deliberately do NOT auto-stamp a ★ star rating here — a legacy NPC was built against the
// global Encounter Power dial, not a known star, so guessing a star would both mislabel it and shift
// its encounter-tally cost (monsterStarCost prices off the star). Unrated NPCs (stars 0) keep the
// legacy monsterSPCost pricing → existing prepped fights are unchanged. The GM rates a monster when
// they choose, via the Monster Creator's star picker (or the sheet).
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

/* -------------------------------------------- */
/*  Unarmed DMG −2 backfill (one-time, v0.01)   */
/* -------------------------------------------- */

// Bring existing creatures' innate Natural Attacks in line with the weapon table's Unarmed row
// (DMG −2). Only touches natural-flagged weapons still at the old default of 0, so a deliberately
// retuned one (a monster's claws at +1) is left alone. GM-side, once per world.
async function backfillUnarmedDamage() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get("project-anime", UNARMED_DMG_SETTING)) return;
  for (const actor of game.actors) {
    if (actor.type !== "character" && actor.type !== "npc") continue;
    const updates = actor.items
      .filter((i) => i.type === "weapon" && i.getFlag("project-anime", "natural") && (i.system.damage?.mod ?? 0) === 0)
      .map((i) => ({ _id: i.id, "system.damage.mod": -2 }));
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }
  await game.settings.set("project-anime", UNARMED_DMG_SETTING, true);
}

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
/*  Orphaned `material` Item purge (self-heal)  */
/* -------------------------------------------- */

// An early design modelled crafting resources as a `material` Item sub-type before the system settled
// on HQ resource *pools* (helpers/materials.mjs now configures Resource Types, NOT an Item type). A
// `material` Item left in a world from that experiment is an unregistered type, so it fails validation
// on every load ("'material' is not a valid type for the Item Document class") and is parked in the
// collection's invalid set instead of the sidebar — the GM can't see it to delete it. Remove those
// orphans so the world loads clean. GM-side; naturally idempotent (nothing to do once they're gone);
// strictly scoped to type "material" so a genuinely-corrupt item of some OTHER type is left for manual
// recovery rather than silently deleted.
async function purgeOrphanedMaterialItems() {
  if (!paIsActiveGM()) return;
  const invalid = game.items?.invalidDocumentIds;
  if (!invalid?.size || typeof game.items.getInvalid !== "function") return;

  const orphans = [];
  for (const id of invalid) {
    let doc = null;
    try { doc = game.items.getInvalid(id, { strict: false }); } catch (_e) { /* unreadable — leave it be */ }
    if ((doc?.type ?? doc?._source?.type) === "material") orphans.push(id);
  }
  if (!orphans.length) return;

  console.warn(`Project: Anime | Removing ${orphans.length} orphaned 'material' Item(s) from a retired design:`, orphans);
  await ProjectAnimeItem.deleteDocuments(orphans);
  ui.notifications.info(game.i18n.format("PROJECTANIME.MaterialOrphansPurged", { count: orphans.length }));
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

  // One-time: seed the Skill-Point ledger from existing skills + past advancement.
  backfillSkillPointLog();

  // One-time: give pre-existing NPCs their own refundable Skill-Point ledger (left unrated by ★).
  backfillNpcSkillLog();

  // One-time: give pre-existing creatures their innate Natural Attack.
  backfillNaturalAttacks();

  // One-time (v0.01): Unarmed strikes land at DMG −2 per the weapon table.
  backfillUnarmedDamage();

  // One-time: seed each weapon/shield's Type from its name (they were named after their type).
  backfillWeaponTypes();

  // One-time (v0.01): reconcile the gear compendiums to the rules doc's tables.
  if (paIsActiveGM() && !game.settings.get("project-anime", PACK_AUDIT_SETTING)) {
    auditGearPacks().then(() => game.settings.set("project-anime", PACK_AUDIT_SETTING, true));
  }

  // One-time: switch existing tokens to always-on HP/Energy bars (the bottom-stacked overlay).
  backfillAlwaysBars();

  // Self-heal: drop any orphaned `material` Items (a retired Item-type experiment; resources are HQ
  // pools now) so the world loads without "'material' is not a valid type" validation errors.
  purgeOrphanedMaterialItems();

  // One-time: back each existing Party with a real Folder (migrating any legacy system.members),
  // then ensure the world ships with a Party at all — seed a starter one if it has none.
  if (paIsActiveGM()) ensureAllPartyFolders().then(ensureDefaultParty);

  // One-time HQ migrations (ordered): fold any legacy per-faction recruit rosters into the HQ pool,
  // THEN split the fused recruits[] into the People/Facilities model, THEN project passive boons.
  if (paIsActiveGM()) { migrateRostersToHQ().then(() => migrateHQModel()).then(() => reconcileHQBoons()); }

  // Initial self-healing pass for every actor's Signature Trait + Traits (the onChange hooks don't fire
  // on load). Each call is GM-gated + idempotent, so it's a cheap no-op for actors with no trait cards.
  if (paIsActiveGM()) for (const a of game.actors ?? []) reconcileTraits(a);

  // Initial pass for bond-rank effects too (same GM-gated, idempotent no-op for bondless actors).
  if (paIsActiveGM()) for (const a of game.actors ?? []) reconcileBonds(a);

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
      // A player asked to end their turn. Validate they own the CURRENT combatant, then advance.
      const combat = game.combats.get(payload.combatId) ?? game.combats.active;
      const user = game.users.get(payload.userId);
      const cur = combat?.combatant;
      if (combat?.started && cur && user) {
        const owns = cur.players?.some((u) => u.id === payload.userId)
          || !!cur.actor?.testUserPermission(user, "OWNER");
        if (owns) combat.nextTurn();
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

  // Encounter tracker — pinned just left of the chat sidebar (in #ui-right). Appears as soon as an
  // encounter has combatants (the createCombat/createCombatant hooks below re-render it live, so it
  // pops up without a reload — even before "Begin"), and carries a Begin button + the GM/player
  // turn controls. Players end their own turn via the GM socket relay.
  projectanime.combat = new AnimeCombatTracker();
  projectanime.combat.refresh();   // render/close lifecycle — shows only if an encounter already has combatants
  const refreshCombat = () => projectanime.combat?.refresh();
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
