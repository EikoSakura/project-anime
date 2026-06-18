# HQ Redesign — People · Facilities · Assignment

Evolve the party Headquarters from a single fused **"recruit = person = facility"** record into
three clean nouns, and bind its outputs to the real TTRPG resources so the base is part of the game,
not a side ledger.

## Decisions (locked 2026-06-15)

- **Separate People from Facilities.** A recruit no longer *is* a facility.
- **Roster = everyone recruited.** One unified people list; each person carries an `assignment`.
- **Dispatch supports multiple members per mission.** N people can be sent on one job.

## Why now — the tangle we're undoing

Today every entry in `hq.recruits[]` is simultaneously a person, a job, and a building; its `role`
just picks which face shows (`party` → fights with the group; `service`/`vendor`/`passive`/`upgrade`/
`dispatch` → becomes a facility). "Roster" and "Facilities" are two `.filter()` views of the *same*
list. Symptoms of the fusion:

- The same "Drag an item here to add it as a reward" slot appears on a facility (its per-turn **yield**)
  AND on a mission (its **reward**) — different concepts, identical affordance.
- The section the UI titles **"Roster"** is internally `facilitiesTitle`; the **"Mercenaries"** section
  is internally `roster`. The labels are crossed.

## Target model

### People — `hq.people[]` (the unified Roster)

One list. `recruited:false` = a Recruitment candidate card; `recruited:true` = a Roster member.

| Field | Purpose |
|---|---|
| `npcUuid` | backing NPC Actor → source of Attributes/Skills for the Phase-3 tie-in |
| `recruited`, `unlocked` | recruitment gating (unchanged) |
| `condition` | availability gate: auto / repTier / hqLevel / manual (unchanged) |
| `assignment` | `field` · `facility:<id>` · `dispatch:<missionId>` · `idle` |
| `status`, `returnsTurn`, `woundedUntil` | dispatch transient (away / wounded) |
| `aptitude` *(Phase 3)* | how strongly they boost a post |

### Facilities — `hq.facilities[]` (NEW, first-class)

| Field | Purpose |
|---|---|
| `kind` | service / vendor / passive / upgrade / production |
| `tier` (1–3), `baseOutput` | yield gold/SP/items produced **unstaffed** (the floor) |
| kind config | serviceKind · shop stock + rates · boon attrs · upgrade target |
| `staff` *(derived)* | the People whose `assignment === facility:<id>` |

### Missions — `hq.missions[]` (mostly unchanged)

The job board. A mission's party = People whose `assignment === dispatch:<id>` (so multi-member
falls out of the same derive-the-group pattern). Keeps `reward*`, `successChance`, `durationTurns`,
`permadeath`, `tier`.

## The HQ Turn

```
facility output = baseOutput(tier) + staffBonus(assigned people)   → pay party
resolve returning dispatched people (success roll, rank-up / wound / death)
apply upgrades + service restores
```

`staffBonus` is the **single hook** where real character stats enter (Phase 3).

## Migration (one-time at the ready hook; precedent: `migrateRostersToHQ`)

Split each fused `recruit`, guarded by an `hqModelMigrated` flag so it runs once:

- `role:party` → a Person, `assignment:field`.
- non-party **recruited** → a Facility (carry kind/tier/yield/config) **+** a Person (its backing NPC)
  `assignment:facility:<newId>`.
- un-recruited pool entries → a Person, `recruited:false` (a candidate card).

Nothing is lost.

## Labels (untangle the collision)

- Facility per-turn output → **Yield** (`HQ.yieldDropHint`).
- Mission → **Reward** (`HQ.rewardDropHint`).
- Bond → **Reward** (`NpcBond.dropItem`, unchanged).
- Section titles to correct in the schema slice: `roster` → "Roster" (the people), `facilitiesTitle`
  → "Facilities".

## Roadmap

1. **Model + untangle** ✓ *done* — People/Facilities/Missions split, migration, label split. Plus the
   standalone **Structures window** (`apps/structures.mjs`): the GM builds/configures every facility
   there and anyone builds from it; the Codex Facilities tab is now active buildings + a button.
2. **Staffing** ✓ *done (awaiting in-app verify)* — station MULTIPLE residents at a facility (capacity =
   tier) via the Structures window's portrait picker (`assignStaff`/`unassignStaff`, `facilityStaffCap`,
   `staffIds[]`); each present resident adds a floor's worth of per-turn yield (`STAFF_BONUS_PER`, a flat
   placeholder). Facility cards show resident portrait dots; the Roster book shows the posting; a posted
   person isn't offered for dispatch. Look modelled on Tensura: Isekai Memories — see
   `mockups/staffing-isekai-mockup.html`.
3. **TTRPG tie-in** ✓ *done (awaiting in-app verify)* — yield is driven by residents' **Traits**, not a
   flat boost. A new Effect-Builder **Gather** rule (`{type:"gather", target:<resourceKey>, value}`,
   `collectGather` in effects.mjs) on a Trait/Signature; a facility's new **`accepts`** list (GM-toggled
   in the Structures window) is the *fit*. On the HQ turn each present resident credits the resources it
   gathers whose type the facility accepts → `hq.resources`. The flat per-resident multiplier is gone.
   Decision (locked 2026-06-16): gather amount lives on the trait; matches by resource type; resources
   (the Civ stockpile types), NOT the `material` item type.
4. **Dispatch cleanup** ✓ *done (awaiting in-app verify)* — dispatch is a person-action: an idle dispatch
   agent (recruited, not away/wounded, not staffing a facility) can be **Sent on a mission from their Roster
   card** (a mission picker + Send in their book; `dispatchFromRoster` in `apps/codex.mjs`), alongside the
   Missions-tab squad picker — which stays the home for multi-member assembly + the live combined-odds
   preview. Resolution rule **locked = together** (the existing Sum model, unchanged); death **per-member**
   (the 3-natural-1s strike tally), never party-wipe. The squad send now re-checks the full idle gate at
   commit (a transient pick can go stale if the agent gets staffed mid-assembly).
5. **Faction turn (L5)** — **REMOVED 2026-06-17** (user dropped BOTH the autonomous drift AND the reactive L4 ripple; factions are now just a standing record + the relationship-web MAP — standing changes only via a direct GM adjust / quest rep reward. Text below kept as history). Was: autonomous per-downtime drift, on its own
   **Advance Faction Turn** button + `factionTurn` clock on the Factions tab (mirrors `advanceHQTurn`).
   `advanceFactionTurn()` drifts every non-frozen faction from a SNAPSHOT (simultaneous, order-free) via
   `factionDrift()`: **web gravity** (mean pull toward allies' standings / away from rivals' — the reactive
   ripple turned into a steady force) **+** an optional per-faction **agenda** (`agendaTarget`, with an
   `agendaStep` cap override; decay-to-baseline = target a low standing). Movement is **quiet** — written
   straight onto the record (bypassing `setFactionStanding`), so passive drift NEITHER pays tier rewards
   NOR ripples; `rewardedTiers` is left untouched so the next ACTIVE standing change settles up any tier
   crossed in between (no faucet, no lost reward). Bounded by the `factionDriftStep` world setting (0 = off);
   a per-faction **Frozen** toggle opts out (frozen factions still anchor neighbours' gravity). One digest
   chat card; idempotent-by-advancing. Built on the existing L4: `relations[]`/`setFactionRelation`, the
   `webPos` graph + Link tool + edge-cycle in `factions.hbs`/`.pa-factions` CSS, and the reactive ripple.

## Open questions

- **Facility origin** — RESOLVED 2026-06-16: **build, then assign.** Facilities are GM-built blueprints
  (the Structures window); People are recruited separately on the Roster; staffing is its own step
  (assign a Person → a Facility). Recruiting never auto-creates a building.
- **Multi-member dispatch resolution** — RESOLVED 2026-06-16: **together** (the Sum model — each member's
  stat die + Trait bonuses summed vs the DC, one shared reward, squad-wide wound on failure), NOT
  independent (which would multiply loot by headcount and dissolve the squad / combined-odds concept).
  Permadeath stays **per-member** via the 3-natural-1s strike tally (failure only wounds; death is
  decoupled bad-luck-over-time), never a party-wipe. The resolution code was already this shape, so Phase 4
  kept it and added only the person-side entry point (Roster-card **Send on mission**).
- **Faction turn (L5)** — RESOLVED 2026-06-16 (all four locked, then built): **(1) WHAT** = web gravity
  (allies converge / rivals diverge along the L4 edges) **+** an optional per-faction agenda toward a target
  standing (decay-to-baseline = target a low value); random events deferred. **(2) WHEN** = its own **Advance
  Faction Turn** button + `factionTurn` clock on the Factions tab (NOT folded into Advance HQ Turn), mirroring
  `advanceHQTurn` 1:1. **(3) TIER REWARDS** = quiet drift, payout DEFERRED — drift writes standing directly
  (no payout, no ripple) and leaves `rewardedTiers` untouched, so the next active change settles up crossed
  tiers (no downtime faucet, reward not lost). **(4) GM control** = fully automatic + one digest, a per-faction
  **Frozen** opt-out (still anchors neighbours' gravity), and a `factionDriftStep` world setting (0 = off);
  preview/confirm deferred.
