# Changelog

## 0.2.9 - 2026-06-25

- Quest banner: click the banner to set or replace its image — now works in any view, not just edit mode,Quest banner: drag to reposition the focal point, and scroll the wheel to zoom the image (1–4×)

## 0.2.8 - 2026-06-22

- Headquarters: new Mission Haste effect output â€” a Trait or effect on a dispatch agent now shortens a mission's duration, bringing the whole squad home a turn (or more) sooner (floored at 1 turn).
- Mission squad-picker shows a live return-time estimate that reflects the assembled squad's combined haste.
- Actor sheets now use the card-style portrait frame for all characters, not just NPCs.

## 0.2.7 - 2026-06-21

- Minion Squads: the Encounter Builder now spawns Minions as a single pooled squad (one body, one initiative) instead of stacking duplicate tokens.
- Squad HP is pooled (member HP x squad size); a squad's Basic Attack strikes once per living member.
- Encounter screen gains Power + Bodies gauges; existing encounters auto-migrate from the old quantity multiplier.

## Unreleased ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Encounter Builder: Minion Squads

Reworked enemy/encounter creation around how classless, levelless TTRPGs handle
hordes (13th Age mooks, Draw Steel & Genesys minion squads, Daggerheart battle
points), retiring the clumsy per-row "ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â quantity" multiplier.

- **Minion Squads (pooled units)** ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â a Minion-Tier NPC now fields as ONE squad:
  one token, one initiative, one pooled HP bar (`hp.max = per-member HP ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â size`).
  Area/any damage drains the shared pool, so a squad loses members automatically
  (the AoE-clears-chaff counter), and its Basic Attack strikes once per LIVING
  member as a single consolidated volley (`rollSquadStrike`). Durability AND
  output scale with the count. Standard / Elite / Solo stay individuals ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â drag
  again to field another body.
- **Encounter Builder, retooled** ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â no quantity multiplier anywhere. Minion lines
  carry a squad-SIZE stepper (priced sub-linearly via `squadSwarmFactor`); other
  tiers are one line per body. The fight reads on TWO gauges: **Power** (the same
  Skill-Point budget vs Party SP ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â difficulty) and **Bodies** (turns/round vs the
  players ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â a squad is 1, a Solo is 2ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ3), replacing the old bolt-on warnings.
- **Squad authoring** ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â the Monster Creator gains a squad-size control + pooled-HP
  preview for Minions; the actor header, token bars, and Token Info show living
  members (e.g. "3 / 6"). Legacy `{uuid, qty}` encounter lines migrate once
  (minion qty ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ squad size; non-minion qty ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ individual lines).

## 0.2.6 ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Playtest systems & repository sync

Consolidates the accumulated 0.2.x playtest work and aligns the published
repository with the live system. Highlights since 0.1.0:

- **Skill Builder & Effects** ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â full wizard with rank-scaled effects, ten new
  wired Effects (Animate/Companion servants, Steal, Conjure, Gate, Barrier,
  Regen, Overcome, Combo, etc.), Auras, Sustain, passive Drain, and a
  self-describing rules summary on every Skill.
- **Headquarters Codex** ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â unified Quests / Factions / Home / Archive hub, with
  per-character Bonds, faction standing, a quest log, crafting Workshop, and a
  vendor Shop.
- **NPCs** ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â MonsterÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾NPC role toggle, ÃƒÆ’Ã‚Â¢Ãƒâ€¹Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ star ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â tier power ratings, Bond offers,
  refundable Skill Point Log, and the Advancement dialog.
- **Combat & tokens** ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â custom Anime HUD, encounter tracker, on-canvas HP/EP
  bars, hover Token Info / dossier, range line, effects halo, automated Status
  durations and Stunned skip.
- **Cleanup** ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â removed dead pre-rewrite architecture (legacy actor subtypes,
  chargen/levelup wizards, orphaned stylesheets) from the published repo.

## 0.1.0 ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Step 1: Foundation

- Initial Foundry VTT **V13** system scaffold (verified build 13.351).
- Manifest using `documentTypes` + `TypeDataModel` data models (no `template.json`).
- Actor types: Character, NPC ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â five attributes (Might/Agility/Mind/Spirit/Charm)
  as d4ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œd12, HP/Energy resources, and derived Evasion, Movement, Carrying Capacity,
  and Defense.
- Item types: Skill, Weapon, Armor, Shield, Accessory, Consumable, Container, Gear.
- ApplicationV2 actor & item sheets (basic, editable) with item create/edit/delete
  and equip toggling.
- Equipped armour/shields and containers automatically adjust Defense, Evasion,
  and Carrying Capacity.
- Initiative configured as the Agility die + the Mind die.
