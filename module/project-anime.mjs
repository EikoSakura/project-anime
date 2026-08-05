import CharacterData from "./data/character.mjs";
import AdversaryData from "./data/adversary.mjs";
import TraitData from "./data/trait.mjs";
import TechniqueData from "./data/technique.mjs";
import CharacterSheet from "./sheets/character-sheet.mjs";
import AdversarySheet from "./sheets/adversary-sheet.mjs";
import ProjectAnimeItemSheet from "./sheets/item-sheet.mjs";
import { registerSplash } from "./apps/splash.mjs";
import { registerLuck } from "./apps/luck-picker.mjs";
import { registerOpenings } from "./apps/opening.mjs";
import { registerTension } from "./apps/tension.mjs";
import { registerTracks } from "./apps/tracks.mjs";
import { registerPartyHud } from "./apps/party-hud.mjs";
import { registerAdversaryFrame } from "./apps/adversary-frame.mjs";
import { registerTechniqueBar } from "./apps/technique-bar.mjs";
import { registerSidebarToggle } from "./apps/sidebar-toggle.mjs";
import { registerCombat } from "./combat.mjs";
import { registerTokenDefaults } from "./tokens.mjs";
import { registerEncounterTracker } from "./apps/encounter-tracker.mjs";
import { registerDistance } from "./apps/distance.mjs";
import { registerMigrations } from "./migrations.mjs";

Hooks.once("init", () => {
  registerSplash();
  registerLuck();
  registerOpenings();
  registerTension();
  registerTracks();
  registerPartyHud();
  registerAdversaryFrame();
  registerTechniqueBar();
  registerSidebarToggle();
  registerCombat();
  registerTokenDefaults();
  registerEncounterTracker();
  registerDistance();
  registerMigrations();

  CONFIG.Actor.dataModels.character = CharacterData;
  CONFIG.Actor.dataModels.adversary = AdversaryData;
  CONFIG.Item.dataModels.trait = TraitData;
  CONFIG.Item.dataModels.technique = TechniqueData;

  foundry.documents.collections.Actors.registerSheet("project-anime", CharacterSheet, {
    types: ["character"],
    makeDefault: true,
    label: "PROJECTANIME.Sheet.Character"
  });
  foundry.documents.collections.Actors.registerSheet("project-anime", AdversarySheet, {
    types: ["adversary"],
    makeDefault: true,
    label: "PROJECTANIME.Sheet.Adversary"
  });
  foundry.documents.collections.Items.registerSheet("project-anime", ProjectAnimeItemSheet, {
    types: ["trait", "technique"],
    makeDefault: true,
    label: "PROJECTANIME.Sheet.Item"
  });

  foundry.applications.handlebars.loadTemplates([
    "systems/project-anime/templates/actor/badge.hbs",
    "systems/project-anime/templates/actor/vitals.hbs",
    "systems/project-anime/templates/actor/rail.hbs",
    "systems/project-anime/templates/actor/traits-panel.hbs",
    "systems/project-anime/templates/actor/techniques-panel.hbs",
    "systems/project-anime/templates/apps/encounter-row.hbs"
  ]);
});
