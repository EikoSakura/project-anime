# Project: Anime — Foundry VTT System

An unofficial Foundry Virtual Tabletop implementation of **Project: Anime**, a
setting-agnostic anime TTRPG (playtest v0.01) of attribute dice, player-built
Skills, and cinematic scenes.

- **Foundry compatibility:** V13 (verified on build 13.351)
- **System version:** 0.1.0

## Status

This is an in-progress build. **Step 1** establishes the foundation:

- V13 manifest using `documentTypes` + `TypeDataModel` (no legacy `template.json`)
- Actor types: **Character**, **NPC**
- Item types: **Skill, Weapon, Armor, Shield, Accessory, Consumable, Container, Gear**
- ApplicationV2 actor & item sheets (basic, editable)
- Derived combat stats (Evasion, Movement, Carrying Capacity, Defense), with
  equipped armour/shields and containers applied automatically
- Initiative formula (Agility die + Mind die)

## Roadmap

| Step | Focus |
| ---- | ----- |
| 1 ✅ | Foundation — loads cleanly in V13 |
| 2 | Full character sheet (tabs, equipment slots, dice styling) |
| 3 | Per-type item sheets + the Skill builder UI |
| 4 | Rolls — Checks/Tests, attacks (Accuracy vs Evasion, Fumble/Combo), Damage, Initiative |
| 5 | Status effects & Affinities as Active Effects |
| 6 | Compendium packs (the gear tables) |
| 7 | Character-creation auto-calc, carrying-capacity penalty, advancement |

## Installation (local development)

The system lives in `{userData}/Data/systems/project-anime`. Launch Foundry V13,
create a new World using the **Project: Anime** system, and open it.

## Credits

Designer: Vinny · Team: Hellfire, CSwrites. Game rules © their respective authors.
