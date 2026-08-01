import CharacterData from "./data/character.mjs";
import TraitData from "./data/trait.mjs";
import TechniqueData from "./data/technique.mjs";
import ProjectAnimeItemSheet from "./sheets/item-sheet.mjs";

Hooks.once("init", () => {
  CONFIG.Actor.dataModels.character = CharacterData;
  CONFIG.Item.dataModels.trait = TraitData;
  CONFIG.Item.dataModels.technique = TechniqueData;

  foundry.documents.collections.Items.registerSheet("project-anime", ProjectAnimeItemSheet, {
    types: ["trait", "technique"],
    makeDefault: true,
    label: "PROJECTANIME.Sheet.Item"
  });
});
