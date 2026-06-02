# Changelog

## 0.1.0 — Step 1: Foundation

- Initial Foundry VTT **V13** system scaffold (verified build 13.351).
- Manifest using `documentTypes` + `TypeDataModel` data models (no `template.json`).
- Actor types: Character, NPC — five attributes (Might/Agility/Mind/Spirit/Charm)
  as d4–d12, HP/Energy resources, and derived Evasion, Movement, Carrying Capacity,
  and Defense.
- Item types: Skill, Weapon, Armor, Shield, Accessory, Consumable, Container, Gear.
- ApplicationV2 actor & item sheets (basic, editable) with item create/edit/delete
  and equip toggling.
- Equipped armour/shields and containers automatically adjust Defense, Evasion,
  and Carrying Capacity.
- Initiative configured as the Agility die + the Mind die.
