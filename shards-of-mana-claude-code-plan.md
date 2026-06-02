# Shards of Mana — Foundry VTT v13 Claude Code Implementation Plan

> Build one phase at a time. Each phase must be complete and functional before proceeding to the next.

---

## Phase 1 — Foundation

**Goal:** Establish the system skeleton. Nothing works without this.

### Tasks

- Create `system.json` manifest file
  - System ID, name, version, compatibility for Foundry v13
  - Define document types: Actor, Item
  - Register actor and item sheets
- Create `template.json`
  - Define base data templates for all Actor and Item types
- Establish folder structure

### Folder Structure

```
shards-of-mana/
├── system.json
├── template.json
├── module/
│   ├── documents/
│   │   ├── actor.mjs
│   │   └── item.mjs
│   ├── sheets/
│   │   ├── adventurer-sheet.mjs
│   │   ├── monster-sheet.mjs
│   │   ├── job-sheet.mjs
│   │   ├── manacite-sheet.mjs
│   │   ├── equipment-sheet.mjs
│   │   └── trait-sheet.mjs
│   ├── helpers/
│   │   ├── derived-stats.mjs
│   │   ├── roll-handler.mjs
│   │   └── utils.mjs
│   └── shards-of-mana.mjs
├── templates/
│   ├── actors/
│   │   ├── adventurer-sheet.hbs
│   │   └── monster-sheet.hbs
│   └── items/
│       ├── job-sheet.hbs
│       ├── manacite-sheet.hbs
│       ├── equipment-sheet.hbs
│       └── trait-sheet.hbs
├── styles/
│   └── shards-of-mana.css
└── lang/
    └── en.json
```

### Deliverable
System loads in Foundry v13 without errors. Actor and Item documents can be created.

---

## Phase 2 — Data Models

**Goal:** Define the schema for every document type.

### Actor Types

**Adventurer**
- Identity: name, species, adventurerRank, level, xp, xpToNext
- Stats: str, agi, vit, mag, spi, per, lck, chr (base, bonus, total)
- Growth Rates: strGR, agiGR, vitGR, magGR, spiGR, perGR, lckGR, chrGR (pool, max 200%)
- Derived Stats: hp, mp, pHit, mHit, pDmg, mDmg, pEva, mEva, pDef, mDef, crit, cAvo, mov
- Combat: pips, limitBreakGauge, deathCounts, conditions
- Currency: gold

**Monster**
- Identity: name, rank, speciesTags
- Stats: str, agi, vit, mag, spi, per, lck, chr
- Derived Stats: same as Adventurer
- Combat: pips, conditions
- Drop Table: array of Manacite drops with percentage chances
- Behavior Priority: ordered list of AI behaviors

### Item Types

**Job**
- Rank: F through S
- Base HP formula, Base MP formula
- Growth Rate Modifiers per stat
- Tags Earned per Rank
- Techniques list per Rank
- Limit Break: name, description, effect, available from Rank D
- Mastery Bonus: growth rate increases on Rank S

**Manacite**
- Rank: F through S
- Type: Standard or Monster
- Source (Monster Manacite only)
- Accuracy Base value
- Base Effect: description, damage type, condition infliction %
- Synergy Effects: array of tag requirements and effects
- Mastered: boolean

**Equipment**
- Slot: Weapon, Offhand, Armor, Helm, Accessory
- Weapon Group: Blade, Polearm, Bludgeon, Claw, Chain, Ranged, Firearm, Staff, Wand, Tome, Instrument, Shield
- Armor Category: Clothing, Light, Heavy
- Rank: F through S
- Accuracy Base (weapons)
- Damage Value (weapons)
- Stat Bonuses
- Tag Requirements
- Properties array
- Manacite Slot: boolean

**Trait**
- Category: Species, Background, Personal
- Tags Granted
- Passive Effect
- Prerequisites

**Technique**
- Source Job
- Pip Cost: 1
- Target: Single, Burst, Line, Field
- Range in squares
- Damage Type
- Condition Infliction: condition name, base %
- Effect description

### Deliverable
All data models defined in `template.json` and document classes. No sheet UI yet.

---

## Phase 3 — Adventurer Sheet

**Goal:** Build the full playable Adventurer sheet. This is the most complex sheet.

### Tabs

**Identity Tab**
- Name, Species, Adventurer Rank, Level, XP bar
- Active Job and Job Rank display
- Gold

**Stats Tab**
- Core Stats table: base, bonus, total, growth rate per stat
- Growth Rate pool tracker (current / 200%)
- Derived Stats display (auto-calculated, read only)
- MOV display

**Combat Tab**
- Pip display based on Job Rank
- Limit Break gauge with fill buttons
- Death Count tracker
- Active Conditions checklist (negative and positive)
- Movement Modes checklist

**Jobs Tab**
- Active Job selector
- Job history table: name, rank, status, tags earned, mastery bonus
- Earned Tags display (all permanent tags from all jobs)
- Active Techniques list

**Manacite Tab**
- Manacite Slots (expandable based on purchased slots)
- Each slot shows: name, rank, base effect, active synergy effects based on earned tags
- Mastered Manacite section

**Equipment Tab**
- Six equipment slots with drag and drop
- Auto-calculation of weapon accuracy base
- Stat bonus totals from equipment

**Traits Tab**
- Trait list with category labels
- Category cap indicator (max 2 per category)

**Bonds Tab**
- Archetype Bonds table: archetype, character name, heart rank, condition, unlocks
- Party Bonds table
- Heart advancement button (requires XP check)

**XP Tab**
- XP log table
- XP cost reference
- XP gain reference
- Spend XP buttons for each purchasable item

### Deliverable
Fully functional Adventurer sheet. All tabs display correctly. Data saves and loads.

---

## Phase 4 — Monster Sheet

**Goal:** Build the GM-facing Monster sheet.

### Sections

- Identity: name, rank, species tags, MOV, movement modes
- Stats: all 8 stats
- Derived Stats: auto-calculated display
- HP and MP with current / max tracking
- Pip display based on Rank
- Action List: name, type, effect, Manacite tag, condition infliction
- Drop Table: Manacite name, drop percentage
- Behavior Priority: ordered list
- Active Conditions checklist
- Resistances and Weaknesses: damage type toggles for Weakness, Resistance, Immunity, Absorption

### Deliverable
Fully functional Monster sheet. GMs can build and run monsters entirely from this sheet.

---

## Phase 5 — Item Sheets

**Goal:** Build sheets for all Item types.

### Job Sheet
- Rank selector
- HP and MP formula display
- Growth Rate Modifier table
- Tags per Rank table
- Techniques per Rank list
- Limit Break section
- Mastery Bonus section

### Manacite Sheet
- Rank selector
- Type toggle: Standard or Monster
- Accuracy Base input
- Base Effect section
- Synergy Effects builder: add tag requirement, add effect
- Mastered toggle

### Equipment Sheet
- Slot selector
- Weapon Group or Armor Category selector
- Rank selector
- Stat Bonuses table
- Tag Requirements input
- Properties list
- Manacite Slot toggle

### Trait Sheet
- Category selector: Species, Background, Personal
- Tags Granted input
- Passive Effect text
- Prerequisites input

### Technique Sheet
- Source Job input
- Target type selector
- Range input
- Damage Type selector
- Condition Infliction: condition selector, base % input
- Effect description

### Deliverable
All Item sheets functional. Items can be created, edited, and dragged onto Actor sheets.

---

## Phase 6 — Core Dice Resolution

**Goal:** Implement the d100 roll under system.

### Roll Types

**Test**
- Select stat to roll against
- Apply difficulty modifier: Easy +20, Normal 0, Hard -20, Severe -40, Extreme -60
- Roll d100
- Compare against modified stat
- Determine: Critical Success (roll ≤ 10% of stat), Success, Failure, Critical Failure (96-100)
- Output to chat with result label

**Contest**
- Two actors each roll against their relevant stat
- Compare outcomes
- Determine winner
- Output to chat

**Attack Roll**
- Calculate roll target: P.HIT or M.HIT minus target EVA
- Calculate crit threshold: CRIT minus target C.AVO
- Roll d100
- Determine: Miss, Normal Hit, Critical Hit
- If hit: calculate damage, apply DEF reduction
- Check condition infliction on same roll
- Output full result to chat

### Chat Output Format
- Actor name and action
- Roll result and target
- Degree of success label
- Damage dealt if applicable
- Conditions applied if applicable

### Deliverable
All three roll types functional with clean chat output.

---

## Phase 7 — Derived Stat Automation

**Goal:** Stats feed automatically into all derived stats. No manual calculation needed.

### Automation Rules

When any core stat changes recalculate immediately:

- STR changes → P.DMG updates
- AGI changes → P.HIT, P.EVA update
- VIT changes → HP max, P.DEF update
- MAG changes → M.HIT, M.DMG update
- SPI changes → MP max, M.EVA, M.DEF update
- LCK changes → CRIT, C.AVO update

When equipped weapon changes:
- Weapon Base Accuracy → P.HIT updates
- Weapon Damage Value → P.DMG updates

When equipped Manacite changes:
- Manacite Base Accuracy → M.HIT updates
- Manacite Damage Value → M.DMG updates

When Job changes:
- Base HP and MP recalculate
- Pip count updates based on Job Rank

### Deliverable
All derived stats calculate automatically. Changing any input value instantly updates all dependent values.

---

## Phase 8 — Combat System

**Goal:** Full combat flow functional in Foundry.

### Features

**Initiative**
- Roll AGI based initiative for all combatants
- Populate combat tracker automatically

**Pip Tracker**
- Display current Pips per combatant in combat tracker
- Spend Pip button per action type
- Reset Pips at start of each turn

**Attack Flow**
- Target a token
- Select attack type: Physical or Magical
- Auto-pull attacker P.HIT or M.HIT and target P.EVA or M.EVA
- Roll and resolve in one click
- Auto-apply damage to target HP
- Auto-apply conditions if infliction roll succeeds

**Condition Tracking**
- Apply condition to token from sheet or chat
- Visual indicator on token
- Persistent until removed or one-turn conditions auto-expire

**Limit Break Gauge**
- Visible on combat tracker
- Auto-fill triggers: take damage, land crit, ally KO, GM button
- Available button appears when gauge hits 100%
- Resets to 0 on use

**Death Counts**
- Auto-trigger Downed state when HP hits 0
- Prompt VIT roll each turn while Downed
- Apply Death Count reduction on failure
- Alert on 0 Death Counts

**Grid Movement**
- 1 square = 1 MOV
- Movement range highlight on token selection
- Spend Move action costs 1 Pip

### Deliverable
Full combat loop playable end to end in Foundry.

---

## Phase 9 — Progression System

**Goal:** XP, leveling, and advancement fully automated.

### Features

**XP Tracking**
- XP log on Adventurer sheet
- Award XP buttons: Session, Quest, Milestone, Conviction, Discovery
- Auto-track toward next Level at 500 XP

**Level Up**
- Prompt when Level threshold reached
- Roll d100 against each stat's growth rate automatically
- Display results: which stats increased
- Update stat totals

**Job Rank Advancement**
- Spend 300 XP button on Job
- Unlock new techniques at new Rank
- Update Tags earned
- Update Pip count if Rank threshold crossed
- Trigger Mastery Bonus prompt at Rank S

**Manacite Synergy Check**
- When Manacite is slotted auto-check earned tags
- Display active synergy effects based on current tag list
- Update if tags change

**Adventurer Rank**
- Track quest completions per Rank
- Spend 200 XP + quest requirement check
- Prompt Trial requirement
- Update Rank on confirmation

### Deliverable
Full progression loop functional. Level ups, Job advancement, and Rank progression all automated.

---

## Phase 10 — Bonds and Guild

**Goal:** Bond system and Adventuring Guild tools.

### Bond Features

- Bond Archetype list on Adventurer sheet
- Heart tracker per Bond (5 hearts)
- Condition log per Bond
- Spend 150 XP to advance Heart (requires GM confirmation of Condition trigger)
- Heart 3 and Heart 5 unlock prompts
- Bond break mechanic

### Guild Features

- Quest log: title, rank, type, objective, reward, status
- Quest board handout template for GMs
- Adventurer Rank tracker with quest counter
- Trial assignment log

### Deliverable
Bond tracking and Guild tools functional.

---

## Phase 11 — Polish and GM Tools

**Goal:** Final pass on UI, styling, and GM facing tools.

### GM Tools

- Encounter builder: select party Rank, generate Standard, Elite, Boss, Raid encounter suggestions
- Monster creator wizard: guided sheet population
- Quest creator: fill in quest template fields, output as handout
- Crystal drop prompt: when monster KO'd prompt for Crystallization and Manacite drop rolls

### UI and Styling

- Custom CSS matching Shards of Mana aesthetic
- Token HUD showing HP, MP, Pips, active conditions
- Chat card styling for all roll types
- Compendium packs: starter Jobs, starter Manacite, starter Equipment, starter Traits

### Deliverable
Fully polished, GM and player ready system.

---

## Build Notes

- Always test each Phase in an active Foundry v13 world before proceeding
- Use Foundry v13 ApplicationV2 and DataModel APIs throughout
- No jQuery — use vanilla JS and Foundry's built in utilities
- All rolls use Foundry's Roll class
- All data mutations use Actor.update() and Item.update() properly
- Handlebars templates for all sheets
- CSS custom properties for theming

---

*Shards of Mana TTRPG — Claude Code Build Plan v0.1*
