# Changelog

## 0.2.6 — Playtest systems & repository sync

Consolidates the accumulated 0.2.x playtest work and aligns the published
repository with the live system. Highlights since 0.1.0:

- **Skill Builder & Effects** — full wizard with rank-scaled effects, ten new
  wired Effects (Animate/Companion servants, Steal, Conjure, Gate, Barrier,
  Regen, Overcome, Combo, etc.), Auras, Sustain, passive Drain, and a
  self-describing rules summary on every Skill.
- **Headquarters Codex** — unified Quests / Factions / Home / Archive hub, with
  per-character Bonds, faction standing, a quest log, crafting Workshop, and a
  vendor Shop.
- **NPCs** — Monster⇄NPC role toggle, ★ star × tier power ratings, Bond offers,
  refundable Skill Point Log, and the Advancement dialog.
- **Combat & tokens** — custom Anime HUD, encounter tracker, on-canvas HP/EP
  bars, hover Token Info / dossier, range line, effects halo, automated Status
  durations and Stunned skip.
- **Cleanup** — removed dead pre-rewrite architecture (legacy actor subtypes,
  chargen/levelup wizards, orphaned stylesheets) from the published repo.

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
