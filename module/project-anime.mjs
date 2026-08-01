import CharacterData from "./data/character.mjs";
import AdversaryData from "./data/adversary.mjs";
import TraitData from "./data/trait.mjs";
import TechniqueData from "./data/technique.mjs";
import CharacterSheet from "./sheets/character-sheet.mjs";
import AdversarySheet from "./sheets/adversary-sheet.mjs";
import ProjectAnimeItemSheet from "./sheets/item-sheet.mjs";

Hooks.once("init", () => {
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
    "systems/project-anime/templates/actor/techniques-panel.hbs"
  ]);
});
