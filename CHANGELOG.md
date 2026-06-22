# Changelog

## 0.2.8 - 2026-06-22

- Headquarters: new Mission Haste effect output — a Trait or effect on a dispatch agent now shortens a mission's duration, bringing the whole squad home a turn (or more) sooner (floored at 1 turn).
- Mission squad-picker shows a live return-time estimate that reflects the assembled squad's combined haste.
- Actor sheets now use the card-style portrait frame for all characters, not just NPCs.

## 0.2.7 - 2026-06-21

- Minion Squads: the Encounter Builder now spawns Minions as a single pooled squad (one body, one initiative) instead of stacking duplicate tokens.
- Squad HP is pooled (member HP x squad size); a squad's Basic Attack strikes once per living member.
- Encounter screen gains Power + Bodies gauges; existing encounters auto-migrate from the old quantity multiplier.

## Unreleased ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Encounter Builder: Minion Squads

Reworked enemy/encounter creation around how classless, levelless TTRPGs handle
hordes (13th Age mooks, Draw Steel & Genesys minion squads, Daggerheart battle
points), retiring the clumsy per-row "ÃƒÆ’Ã¢â‚¬â€ quantity" multiplier.

- **Minion Squads (pooled units)** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â a Minion-Tier NPC now fields as ONE squad:
  one token, one initiative, one pooled HP bar (`hp.max = per-member HP ÃƒÆ’Ã¢â‚¬â€ size`).
  Area/any damage drains the shared pool, so a squad loses members automatically
  (the AoE-clears-chaff counter), and its Basic Attack strikes once per LIVING
  member as a single consolidated volley (`rollSquadStrike`). Durability AND
  output scale with the count. Standard / Elite / Solo stay individuals ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â drag
  again to field another body.
- **Encounter Builder, retooled** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no quantity multiplier anywhere. Minion lines
  carry a squad-SIZE stepper (priced sub-linearly via `squadSwarmFactor`); other
  tiers are one line per body. The fight reads on TWO gauges: **Power** (the same
  Skill-Point budget vs Party SP ÃƒÆ’Ã¢â‚¬â€ difficulty) and **Bodies** (turns/round vs the
  players ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â a squad is 1, a Solo is 2ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“3), replacing the old bolt-on warnings.
- **Squad authoring** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the Monster Creator gains a squad-size control + pooled-HP
  preview for Minions; the actor header, token bars, and Token Info show living
  members (e.g. "3 / 6"). Legacy `{uuid, qty}` encounter lines migrate once
  (minion qty ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ squad size; non-minion qty ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ individual lines).

## 0.2.6 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Playtest systems & repository sync

Consolidates the accumulated 0.2.x playtest work and aligns the published
repository with the live system. Highlights since 0.1.0:

- **Skill Builder & Effects** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â full wizard with rank-scaled effects, ten new
  wired Effects (Animate/Companion servants, Steal, Conjure, Gate, Barrier,
  Regen, Overcome, Combo, etc.), Auras, Sustain, passive Drain, and a
  self-describing rules summary on every Skill.
- **Headquarters Codex** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â unified Quests / Factions / Home / Archive hub, with
  per-character Bonds, faction standing, a quest log, crafting Workshop, and a
  vendor Shop.
- **NPCs** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â MonsterÃƒÂ¢Ã¢â‚¬Â¡Ã¢â‚¬Å¾NPC role toggle, ÃƒÂ¢Ã‹Å“Ã¢â‚¬Â¦ star ÃƒÆ’Ã¢â‚¬â€ tier power ratings, Bond offers,
  refundable Skill Point Log, and the Advancement dialog.
- **Combat & tokens** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â custom Anime HUD, encounter tracker, on-canvas HP/EP
  bars, hover Token Info / dossier, range line, effects halo, automated Status
  durations and Stunned skip.
- **Cleanup** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â removed dead pre-rewrite architecture (legacy actor subtypes,
  chargen/levelup wizards, orphaned stylesheets) from the published repo.

## 0.1.0 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Step 1: Foundation

- Initial Foundry VTT **V13** system scaffold (verified build 13.351).
- Manifest using `documentTypes` + `TypeDataModel` data models (no `template.json`).
- Actor types: Character, NPC ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â five attributes (Might/Agility/Mind/Spirit/Charm)
  as d4ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“d12, HP/Energy resources, and derived Evasion, Movement, Carrying Capacity,
  and Defense.
- Item types: Skill, Weapon, Armor, Shield, Accessory, Consumable, Container, Gear.
- ApplicationV2 actor & item sheets (basic, editable) with item create/edit/delete
  and equip toggling.
- Equipped armour/shields and containers automatically adjust Defense, Evasion,
  and Carrying Capacity.
- Initiative configured as the Agility die + the Mind die.
