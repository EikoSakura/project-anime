import CharacterData from "./data/character.mjs";
import TraitData from "./data/trait.mjs";
import TechniqueData from "./data/technique.mjs";

Hooks.once("init", () => {
  CONFIG.Actor.dataModels.character = CharacterData;
  CONFIG.Item.dataModels.trait = TraitData;
  CONFIG.Item.dataModels.technique = TechniqueData;
});
