# Changelog

## 0.3.9 - 2026-07-05

- Sense Skills no longer pay extra SP for range - a Sense's tile reach is now inherent to the Effect (ranged senses drop 1 SP).
- New Sense Skills default to a 5-tile detection range.

## 0.3.8 - 2026-07-05

- Sense Skills can now be built as Passive - an always-on sense, in the Skill Builder and NPC/Monster Creator.
- New "None" Skill Modifier for Skills that rely only on their Effect - it adds no SP or EP cost and replaces any other Modifier.

## 0.3.7 - 2026-07-05

- Quest objectives are now free text — the GM types the objective directly instead of picking from a fixed list,Party HUD: double-click the title bar to minimize/restore the roster, like a Foundry sheet,Party HUD: fixed the panel jumping to the top of the screen when you start dragging it or first open it

## 0.3.6 - 2026-07-05

- Overhaul v0.03 Phase 3 - Enemies rebuilt: monsters are now Role x Tier (I-IV), with a Monster Creator, Twists, Boss Bars, and a Threat budget for encounter building.
- Phase 4 - Crafting rebuilt: graded carried Materials, a Craft Workbench (Forge / Traits / Temper / Brew / Projects), Specialties, Sockets, Flaws, and defeat drops.
- Phase 5 - Bonds rebuilt: paired Party (PC-PC) and Follower (PC-NPC) bonds earning Bond Points across C/B/A/S ranks, with automatic party benefits, Dual Strike, and Union Skills.
- Phase 6 - Headquarters rebuilt: a base that grows on Gold and resident Followers, Renown-driven ranks (C to S), a 14-facility catalogue, and a Mission Board.
- Automatic migrations carry old enemies, resource pools, bonds, and HQ data into the new models.

## 0.3.5 - 2026-07-04

Overhaul Phase 6: the **Headquarters** rebuilt to playtest doc v0.03 — a home the party owns that grows on two things: **Gold** builds the rooms (**Facilities**) and **People** bring them to life (resident **Followers** who steward them). Lives in the **Home** tab of the Headquarters window (the book icon in the scene controls).

### The base
- The base has a **Rank** — **C Hideout → B Stronghold → A Haven → S Legend** — and a **Renown** score equal to its **built facilities + resident Followers**. Reach a Renown threshold (**6 / 12 / 20**) and the base ranks up at your next rest there. Each rank raises the **facility cap** (3 / 6 / 10 / 15) and grants a cumulative perk: a rest at the base counts as a **Town** (C); **buy 10% off / sell 60%**, **+50G** on Work, and the **Mission Board** opens (B); **+1 Downtime Slot** and a cap of 5 (A); **+2 Bond capacity** (S).
- GM: press **Establish Base** on the Home tab to found a fresh Hideout, then name it and set its crest / colour / banner as before.

### Facilities
- Build from the printed catalogue of **14 facilities** (Apothecary, Archive, Bathhouse, Forge, Garden, Gathering Grounds, Infirmary, Shrine, Stables, Tavern, Training Grounds, War Room, Watchtower, Workshop). Each is **built once** with Gold (paid from the party treasury), at a minimum rank, and shows what it does **unstaffed**, **staffed**, on its **Favor** line, and its one **Upgrade**.
- **Steward** a facility with a resident to light up its staffed line; while a resident stewards their **Favored Facility**, its Favor line also applies. Each facility carries one **Upgrade** (Gold), available once its steward's Follower Bond is rank **B+**.
- The **Forge** and **Apothecary** open the **HQ Shop** as vendors, priced by rank and staffing. Up to **3 Custom Facilities** can be authored within the Four Rails.
- Facilities pay out at a rest **at the base**: a staffed Apothecary hands out a free consumable, a Garden adds Work Gold, Gathering Grounds drop materials into the stash, a Workshop grants a free Craft Activity, a staffed Shrine steps up your Luck dice.

### Residents & the Mission Board
- **Residents** are your Follower Bonds marked "resides". Recruit a Follower (drag the NPC onto a PC's Bonds drawer), then **Move In** on the Residents tab — each resident adds 1 Renown. Recruitment is never a roll: meet the candidate's **Ask** (Bond / Debt / Deed / Delivery / Duel / Threshold) and they join.
- The **Mission Board** (rank B+) sends **2–3 residents** on **Scout / Trade / Search / Escort / Aid** jobs while you adventure. Results arrive after your next **1–3 rests**: two d6, **stepped up** once per **Suited** resident, versus **10** (or **13** Hard). Success pays the reward (Gold × Tier) and **+1 BP** with a dispatched Follower; failure loses the reward and a resident may return with a complication. Active jobs are capped by rank (**1 / 2 / 3**).
- Rest at the base with the new **"At our Headquarters"** toggle on the party Rest dialog — that's what makes a rest count as a Town, ranks the base up, ticks the Mission Board, and applies all the facility grants.

### Migration & removals
- Your base keeps its **name, crest, colour, banner**. A world that already used the old HQ is marked **established** at rank C, and the legacy **resource pools are drained** — Phase 4 already copied them into the party stash as carried materials, and the parallel HQ Workshop that kept them is retired.
- The old **resource stockpile**, **stat-die dispatch missions**, **facility tiers / gathering / passive boons**, **death strikes**, and the **HQ Turn / Advance Turn** clock are retired in favour of the doc's model. (Old data isn't deleted, just no longer shown.)

## 0.3.4 - 2026-07-03

Overhaul Phase 5: Bonds rebuilt to playtest doc v0.03 — a **Bond** is now a relationship shared between exactly **two characters** that earns **Bond Points** and pays out **automatic benefits**. Your old bond cards become Follower Bonds automatically (see Migration). Lives in the same **Bonds** drawer on the character sheet.

### Bonds

- Two kinds of bond: a **Party Bond** between two Player Characters (purple), and a **Follower Bond** between a PC and an NPC (gold). Drag a character or NPC onto your Bonds drawer to open one. A Party Bond is shared — it appears on **both** sheets and stays in sync.
- Ranks are **C → B → A → S**. A bond opens at rank C and deepens as it earns **Bond Points**, shown on a meter with the **2 / 4 / 7** thresholds.
- Earn BP two ways: a **Bond Scene** (a Downtime Activity, once per rest per pair) or **Standing Together** (once per Conflict — take a hit for your partner, spend a Luck Die on their check, or defeat a foe threatening them). Buttons on the bond book; a GM can also nudge BP by ±1.
- Clearing a threshold doesn't rank you up on its own — the **next Bond Scene** is the rank-up. When you're eligible the book shows a **Rank Up** prompt.
- **Charm capacity**: you can hold rank-**B-or-higher** bonds with a number of characters equal to your **Charm half-score** (shown in the drawer header). Rank C is unlimited.

### Party benefits (automatic)

- **Side by Side** (rank C): +1 to hit while within 1 tile of your partner. **Back to Back** (rank A): +1 DEF and +1 RES within 1 tile. Both apply as **toggleable effects** — flip them on when you're beside your partner (roll dialog + Effects drawer).
- **Dual Strike** (rank S): once per Conflict, when your partner hits a foe you may Basic Attack it — surfaced as a tracked reaction in the book.
- At rank S a pair can build a **Union Skill**: build a Skill, then drop it onto the bond's Union panel. Split SP, both Actions in one Phase, within 2 tiles, half EP each (surfaced on both sheets; the table adjudicates the shared action/EP for now).

### Follower benefits

- **Welcome** (C), **Aid** (B — pick Livelihood / Hearth / Access), **Lesson** (A), **Devotion** (S) — preset benefits you and the GM shape with a note per rank. A follower can be marked as residing at HQ, and given a **Favored Facility** by dragging a facility card from the Headquarters onto the bond (feeds the coming HQ system).

### Migration & removals

- Your existing bond cards are remapped to **Follower Bonds** automatically: rank 0–5 buckets to C/B/A/S, portrait / title / quote / colour carry over, and the old NPC link becomes the partner. The old per-rank custom abilities and dossier are retired (doc-minimal).
- The separate GM-authored **NPC bond offer** editor is removed — any NPC can simply be bonded with now.

## 0.3.3 - 2026-07-03

Overhaul Phase 4: Crafting rebuilt to playtest doc v0.03 — graded materials, Forging, Traits, Temper, Brewing, Projects, Flaws, Specialties, and Sockets. Your old HQ resource stockpile is converted to carried materials automatically (see Migration).

### Materials

- Materials are now **carried items**, each with a **grade** (Common / Prime), a **Tier** (I–IV), and a **type** (Essence / Hide / Ore / Reagent), plus a free flavour name you can rename like gear. They live in a **Materials** section on the Gear tab.
- Materials **bundle at 3 per 1 Bulk** — a Prime counts as 2 toward its bundle. A **Prime counts as two Commons** when paying any Commons cost.
- **Gathering**: a defeated foe automatically drops materials to the party stash — 1 Common of its Tier per point of Threat, typed by Role (Brute → Hide, Caster → Essence, Grunt → Ore, Skirmisher → Ore, Support → Reagent, Swarm → Reagent at half). An **Elite** drops 1 Prime; a **Boss** drops 1 Prime per Bar (when the last Bar breaks). A **Rival** drops nothing until it actually falls.
- **Material shops**: a vendor facility can be set to sell materials — Common materials of the settlement's Tier at **50G × Tier** each (never Prime). Set the "Sell materials" toggle + Settlement Tier on the vendor.

### The Craft Activity

- A new **Craft** button on the character sheet opens the **Craft Workbench**. Crafting never rolls and never fails. Each operation spends its bill **plus one Craft Activity** — a Downtime Slot you spend on **Craft** at a rest (slots don't carry over; the GM can always craft). Outside a Town it wants an Artisan's Kit + the Fieldcrafter Specialty (a soft reminder).
- **Forge**: forge a weapon / shield / armor for **half its list Gold + 3 Commons** of the matching type at party Tier (Ore for weapons & shields, Hide for armor). Forged gear is identical to bought; name it freely.
- **Traits**: 14 permanent modifications (Attuned, Collapsible, Concealed, Extended, Fitted, Honed, Insulated, Lightened, Luminous, Marked, Reinforced, Socket, Sturdy, Warded). Up to **2 per item** (a Socket counts; accessories hold none), each once, **3 matching materials** at party Tier to apply, one Activity to remove (destroyed). Stat trades (Honed, Fitted, Reinforced, Extended, Lightened, Collapsible, Attuned) apply live and floor at their printed minimums.
- **Temper**: +1 DMG (weapon/shield) or +1 Protection (armor) per level, cap **party Tier − 1**, **2 Primes** of the matching type each.
- **Brew**: a batch of **3** consumables (**4** with the Brewer Specialty) of one of 7 recipes — Elixir, Energy Drink, Field Meal, HP Potion, Strong Energy Drink, Strong HP Drink, Ward Salve — from Reagents at the recipe's Tier.
- **Projects**: Stage-based works the GM defines (Personal 2 / Grand 3 / Legendary 4 Stages); anyone advances one Stage per rest for the Stage's bill.

### Specialties

- Learn a crafting **Specialty** at a rest for 1 SP (one per character), in the Advancement dialog: **Brewer, Fieldcrafter, Salvager, Smith, Steward** — each bends a Craft mechanic. Refundable in the Skill Point Log like any purchase.

### Flaws & Sockets

- An item can carry a **Flaw** (shown to its holder). A **Socket** is an empty fitting crafted via the Socket Trait (2 Essence + 1 Prime Essence); what fills it is Module-defined.

### Migration

- Your legacy HQ resource pools are converted **best-effort** into Common Tier-I materials in the party stash (Manacite → Essence, Cloth → Hide, Stone/Wood → Ore, Herb → Reagent). The pools themselves are left intact for the existing HQ Workshop, which keeps working alongside the new Craft Activity until the HQ overhaul (Phase 6).

## 0.3.2 - 2026-07-02

Overhaul Phase 3: Enemies rebuilt to playtest doc v0.03. Existing monsters are remapped automatically (see below).

### Enemies — Role × Tier

- A monster is now a **Role** at a **Tier I–IV**. It no longer tracks five Attributes: it has a **Strong die** (the tier's die) and a **Weak die** (two steps down, min d4). The Role decides which Attributes are Strong; every other Attribute uses the Weak die. Tier dice: I d6/d4 · II d8/d4 · III d10/d6 · IV d12/d8.
- The seven Roles are built in: Grunt, Brute, Skirmisher, Caster, Support, Swarm, Elite — each with its own stat shape and Threat cost. A Caster's attacks target RES; a Swarm is one flat-HP body (5/8/10/12 by Tier); an Elite picks three Strong Attributes.
- The NPC sheet header shows the Role · Tier line (with Rival / Boss chips and a Threat number). A Step Down still marks a single Attribute (via the usual Bolster/Hinder effects).

### Monster Creator — three build paths

- Rebuilt around **Take a Row / Role & Twist / Build Your Own**: pick a Role and Tier and the statblock falls out; add Twists; or trade stats yourself.
- **Four Rails** audit checks the monster against the party (ATK ≤ lowest DEF + 6 · DEF ≤ lowest ATK − 2 · AS ≤ slowest AS + 4 unless a Skirmisher · EVA ≤ 12), with a Tempered tier-row fallback when there are no party sheets. This stands in as the "Forecast" for now.
- The old star rating, Step-Up budget, NPC Skill-Point pool, and squad stepper are gone from the creator.

### Twists

- The 12 pre-built enemy Skills (Counter, Drain Touch, Dread Aura, Ensnare, Fade, Guard, Mend, Piercing Shot, Reinforce, Stunning Blow, Sweep, Warcry) can be added to a monster from the Creator's Abilities step. Up to 2; a 3rd flags it as an Elite.

### 1/Conflict

- A Skill that inflicts Stunned, Sealed, or Bound — or any Skill flagged 1/Conflict (Reinforce, Stunning Blow) — may be used only once per encounter. The counter resets when combat starts and ends.

### Bosses

- A **Boss** is one Elite whose HP is split into **Bars** (⌈party ÷ 2⌉; each Bar = 8/10/12/14 × party size by Tier). It takes one full turn per remaining Bar during the Enemy Phase. Breaking a Bar loses the excess damage, refills the Bar, ends every Status on the Boss, and lets it Shift (announced in chat). **Desperation**: +2 ATK per broken Bar. **Resolve**: once per Bar it shrugs off a Detrimental Status (the damage still lands).

### Rivals

- A monster can be flagged a **Rival** — a recurring villain built on full PC rules that counts as Elite + 1 Threat (3) and is meant to grow with the party.

### Encounter budget — Threat

- The party sheet's encounter gauge is now measured in **Threat**: budget = party size, shifted by difficulty (Easy −1 · Standard · Hard +1.5 · Climax ×2). Each enemy costs its Role's Threat (Grunt 1 · Brute 1.5 · Swarm ½ · Elite 2 · Rival 3 · Boss = party size). Swarms may not exceed half the budget (flagged).
- Every enemy is one line — drag an NPC in again to field another (Swarms included).

### Migration

- Existing monsters are remapped once on load: shape → Role (Minion → Swarm · Standard → Grunt · Elite/Solo → Elite), stars → Tier I–IV, and the statblock is recomputed. The old tier/stars/squad data is retired.

## 0.3.1 - 2026-07-02

Overhaul Phase 2: the campaign spine — party Tier, real Downtime, quest Postings. (No data migration — new fields default in place.)

### Party Tier

- The party has a Tier (I–IV), shown on the party sheet. It starts at I and rises with each concluded Season (the ◆ Milestone tool), max IV; the GM can pin it from the party sheet's Tier select.
- Work pay and quest Reward Budgets read the Tier now; material prices and Temper caps read it in the crafting phase.

### Resting — Downtime Slots

- Town rests grant 2 Downtime Slots (+1 per extra full day in the settlement, max 4); Camp allows Minor Downtime only — no slots.
- All seven Activities are spendable per slot: Bond, Craft (points at the Workshop until the Phase-4 crafting build), Pursuit, Recover, Refine, Train (+1 SP, once per rest), Work (100G × party Tier, paid to the worker). Repeatable except Train.
- Refine arms Skill Enhancement: staging an Enhancement/Expansion without a Refine from your last rest shows a one-time reminder (advisory, never blocks), and confirming one spends the Refine.
- Camping twice inside 24 hours of world time asks before it applies.
- The party sheet gained a Rest button (GM): the whole roster rests together in one dialog — shared Rest Scene, per-member slots, one combined chat card.

### Quests — Postings v2

- Every Posting carries a Size — Job / Request / Commission — shown on the banner ribbon beside its category; main/side/personal stay as the journal categories.
- The reward editor shows the Posting's Reward Budget (Job 100G × Tier · Request 100G × Tier per character · Commission 200G × Tier per character), reading the quest's star rank as its Tier (party Tier when unranked).
- Deadlines: set X rests and a printed consequence. Every party-wide rest ticks active Deadlines down one; at 0 the Posting expires — it fails, pays nothing, and the consequence posts to chat. Rail cards show an hourglass counter; the detail view shows the strip (red at 1).
- A GM-only Complication field on every Posting — players never see it.
- Objective rows can carry one of the nine Objective types (Clear · Deliver · Duel · Escort · Hunt · Protect · Recover · Scout · Survive), shown as a tag on the objective.

## 0.3.0 - 2026-07-02

THE v0.03 OVERHAUL BEGINS — Phase 1: core rules aligned to playtest doc v0.03 (full plan in OVERHAUL-V003.md; enemies, crafting, HQ, and bonds rebuild in the next phases).

### Rules — formulas

- HP = 6 + ⟪Might⟫×2: every existing character gains +6 max AND current HP automatically (one-time migration); new characters start at 14.
- Evasion = 5 + ⟪Agility⟫/2 + armor modifier (was full Agility) — low-Agility characters are noticeably harder to hit now, high-Agility slightly easier.
- Attack Speed subtracts the TOTAL Bulk of everything wielded — off-hand weapons and shields now count, so dual-wielders and shield-bearers double up less often.
- Strikes damage with the STRIKING weapon's own DMG: off-hand and Unarmed attacks no longer borrow the main weapon's damage; unarmed hits deal ⟪Might⟫ flat.
- A weapon whose Accuracy uses both ⟪Might⟫ and ⟪Mind⟫ asks which formula you're striking with (Physical vs DEF / Magical vs RES) and remembers your last choice.

### Rules — gear (v0.03 tables)

- Weapon DMG is now the doc's absolute column (Axe 5, Blade 3, Bow 3, Chain 2, Firearm 4, Grimoire 4, Polearm 4, Staff 3, Unarmed 0) with corrected Hit (Blade +1, Chain +1) and Bulk (Bow/Firearm 2, Chain/Staff 1, Grimoire 2); Bows and Firearms carry their minimum ranges (2).
- Medium/Heavy armor Protection raised to 3/4; shields hit the printed lines (Light: 1 DMG · Heavy: 2 DMG, −1 Hit, Bulk 3).
- Compendiums, world items, AND gear your characters already own all rebase automatically (renamed items are found through their compendium origin). Monster innate attacks lift to the new scale so fights stay honest until the Phase-3 enemy redesign.
- New gear: Artisan's Kit (150G) — the Crafting chapter reads it.

### Rules — combat

- Overcome difficulty is 7 + the inflicting Skill's SP cost (max 16).
- Cover: the attack dialog has a +1/+2 selector that raises the target's Evasion for that strike (basic attacks and squad strikes).
- Critical: dropping to 25% max HP or below is now a tracked state — the owner and GM get a whisper naming any Critical-trigger React Skills.
- A Combo rolled during a Go Again turn restores one spent Luck Die (roll your ⟪Charm⟫ die), per the doc.
- End-of-combat recovery now stands EVERY Defeated combatant back up at half max HP — enemies included (their tokens stay hidden).
- Contested Checks: target a token before rolling a Check and the dialog offers "Contested vs <name>" — both sides roll, higher total wins, ties re-roll.

### Rules — skills

- SP cost is ADDITIVE per the doc: Effect cost + 1 per Modifier (+2 per Heavy). Multi-modifier Skills got pricier; every stored Skill re-derives automatically and passives tax the new full amount.
- Inflict is a Heavy Modifier when its status is Stunned, Sealed, or Bound.
- An Effect with a Duration can no longer be built as a Passive (existing Skills keep working until re-edited).
- Heal (EP) is a true TRANSFER: pick an amount up to Power, capped by your own Energy — it leaves your pool and enters theirs.
- Banish/Nullify target ⟪Spirit⟫ outright (the defender no longer takes the better of two numbers).
- Charge rolls its to-hit on the FOCUS turn: a miss fades the charge on the spot; a hit is locked in and the release resolves at double power without re-rolling.

### Rules — Skill Points

- Train pays 1 SP (was 2).
- Quests no longer pay SP. The new ◆ Milestone button on the Quests pane awards Episode +2 / Arc +3 / Season +5 (stacking, per the doc) to the whole party and tracks Seasons for the coming party-Tier system.

### Interface

- NEW phase banner: a PLAYER PHASE / ENEMY PHASE / NEUTRAL PHASE band sweeps the screen when the side phase flips (per-player off-switch in settings).
- The Log Horizon status-glass is now a shared kit: the HUD action console, party rail, encounter tracker, effects panel, and ITEM SHEETS all wear the dark glass with your accent color (gold ornaments inside them re-key to your accent automatically).
- Settings tidy-up: the Headquarters menu now owns Lethal Dispatch and the crafting-facilities rule; Encounter Power, Range Line, and Combo Splash gained explanations; visible settings follow one "Area — Setting" naming scheme.

## 0.2.27 - 2026-07-02

- Side Initiative: combat now runs on Fire Emblem-style side phases (Player then Enemy then Neutral) with free-pick turns and no initiative roll
- Skills rebuilt to rules v0.03: the Rank system is gone; SP derives from Modifiers, Power replaces the Skill Die, and Skill Enhancement replaces Improving Skills
- Actor sheet re-skinned as an isekai Status Window (Log Horizon glass) with a per-player accent color
- Advancement rebuilt as a staged level-up screen: nothing spends until CONFIRM, and Skill Enhancement moved into it
- Items gained a Refresh-from-Compendium button and remember their compendium origin across every transfer route

## 0.2.26 - 2026-07-01

Advancement rebuilt as a staged LEVEL-UP screen; Skill Enhancement moved into it.

- The Advancement dialog wears the Status Window glass and now STAGES everything: +/− marks pending raises against the live SP pool and nothing spends until CONFIRM — one atomic update, one refundable Skill Point Log entry per purchase (refunds work exactly as before). Minus only takes back staged points.
- Attributes show their d4→d12 ladder as a diamond node track — bought steps sit solid, staged steps pulse in your accent, and the die label lights up with the pending value. Step costs still climb (1/2/3/4 SP by die).
- Combat stats (+2 HP, +2 Energy, +1 Carry, +1 Movement) are stepper rows with a live value preview of the staged total.
- SKILL ENHANCEMENT lives here now (moved out of the Skill Builder hub — its Improve button is gone; Effects stays): pick a Skill in a paged icon grid (8 per page, hover tooltips, chevron pagers + diamond page dots, empty slots pad the page), then raise Power / Accuracy / Area on pip gauges and Duration / Efficiency / Range on value steppers. Efficiency live-drops the ⚡ readout; every cap and compatibility rule matches the old Builder flow.
- Expansion is a slim track row: the Skill's Modifiers as chips, one + that opens an in-window Modifier picker (Heavy picks cost 2 SP and wear the gold diamond); staged picks pulse as chips and click to remove.
- Calculate HP/Energy and Roll Luck Dice remain instant, as quiet text actions at the foot of the window.

## 0.2.25 - 2026-07-01

Actor sheet re-skinned as an isekai STATUS WINDOW (Log Horizon-style).

- The character/NPC sheet is now a dark grey glass status screen in both Foundry themes: accent-lit window frame with a folded-corner tab, "—  Name" spaced titlebar with a luminous rail, and hairline dividers with diamond terminals.
- NEW per-player accent color (client setting, default azure): window trim, glow, Energy bar, studs, diamonds, and highlights all tint to YOUR color — every player sees their own, like Log Horizon windows.
- HP/Energy bars are slim, square, diamond-capped, and segment-ticked; HP keeps the iridescent crimson-amber flow, Energy flows in the player accent.
- Side-panel vitals (ATK/MATK/DEF/RES/EVA/AS/MOV) became dotted-leader status rows; Luck stays as dice — rounded cubes with corner pips.
- Attributes render as rotated DIAMOND dice in open hairline columns (label under the die); section headers everywhere use the "— Section" em-dash treatment; the drawer nav is quiet spaced caps with diamond separators.
- Item/skill tiles sharpened into square grid slots with accent-trimmed quantity/energy badges; drawers share the glass with an accent-lit edge.
- New bundled display font: Marcellus (name, die faces, serif headers).

## 0.2.24 - 2026-07-01

Skills rebuilt to rules v0.03 — the Rank system is gone.

- SP cost now derives from the build: the number of Modifiers (Heavy 🔶 count as two), with a minimum equal to the Effect's cost (Companion/Empower/Illusion/Sense/Telepathy/Transform 2+, the rest 1+, no-Effect Skills 0). Energy to use = SP × 2. Targeting, React, and Passive are free. Existing Skills re-derive their cost automatically.
- Skill Builder: the Rank step is removed; effects wear their minimum cost, the Modifiers step shows a live SP/EP readout, and there is no Modifier cap anymore.
- Power replaces the Skill Die: a weapon-range Skill's damage/healing = chosen ACC Attribute + Weapon DMG (plus grip/dual-wield adjustments); a non-weapon Skill uses the Attribute alone. Weapon Skills keep borrowing the weapon's ACC to hit. Overcome CTs key off Power; Barrier absorbs the Skill's full SP cost and Regen restores half of it (round down, min 1) instead of Rank x2.
- Passive Skills now subtract their FULL Energy cost (SP × 2) from max Energy (was half).
- Skill ranges simplified: Skills default to Weapon range; "Range (X tiles)" and "Scene" are overrides that add +1 SP. Legacy Melee/Near/Far skills migrate to a plain tile count, Very Far to Scene. Weapons show tile numbers only (optional min range field for bands like 2–8).
- New Modifiers: Absorb 🔶, Immunity 🔶 (Damage Type or Status), Combo, Disarm (steal equipped items via contested roll — base Steal is inventory-only now), Mental (targets Mind/Spirit/Charm instead of EVA), Waypoint (split out of Gate).
- Changed Modifiers: Affinity (Damage) grants Resist only; Affinity (Status) grants Resist (halves the status duration — wired) instead of Immunity; Chain leaps deal FULL damage (no more halving) to 1 extra target; Pierce ignores DEF or RES; Manifest only runs a Passive (Combo covers the activate-another-Skill half); Re-equip is one version; Push/Pull/Move are flat 2 tiles, Chain 1 target (Rank scaling removed, old Tune growth grandfathered).
- Heal (Mend) can restore HP or EP, chosen at creation, and applies to the chosen pool.
- "Targets ⟪X⟫ or ⟪Y⟫" evasion swaps are now chosen at creation (one Attribute) instead of defender-picks-better; existing pair-based Skills keep the old behavior.
- Skill Enhancement replaces Improving Skills: Accuracy +1 (max +3), Area +1 tile to a Burst/Aura size (max +3, new), Duration +1 turn (new), Efficiency −1 EP (min half), Power +1 (max +3, merges damage/healing), Range +1 tile — 1 SP each — plus Expansion (add a Modifier; 2 SP for a Heavy). Raise Rank and Tune a Modifier are gone.
- Animate and the standalone Affinity Effect are retired from new authoring (existing Skills keep working); Empower costs 2+ and lasts 2 turns.
- Sheets, chat cards, creators, and the token dossier show the Skill's SP cost where rank stars used to be.

## 0.2.23 - 2026-07-01

- Combat now runs on SIDE INITIATIVE (Fire Emblem-style phases): the whole Player side acts, then the Enemy side, then Neutrals, and a round is one pass through all three phases. Player Phase always goes first - initiative is no longer rolled.
- A unit's side is read from its token disposition (Friendly to the Player Phase, Hostile to the Enemy Phase, Neutral to the Neutral Phase); the encounter tracker groups combatants under phase headers and highlights the active phase.
- Within a phase you FREE-PICK: the controlling player (or the GM) clicks any of their not-yet-acted units to take its turn, in any order. Acted units are dimmed with a checkmark; the End Turn control shows for whoever controls the unit currently acting, and the phase advances on its own once a side is spent.
- Stunned units are skipped automatically (their turn passes and the status clears); defeated units are excluded; a Combo still grants a second action within the same phase. Sustain, Lingering decay, and status-duration countdown tick once per unit per round, at that unit's own turn - unchanged in pace from before.
- The per-actor initiative roll button and the tracker's roll/reset buttons are gone (there is nothing to roll under side initiative).
- Enemy action-economy specials (the boss interleave and multi-action Solos) are paused pending the enemy redesign: a boss acts once in the Enemy Phase for now. Minion Squads still act as one unit.
- Item sheets gained a PF2e-style "Refresh from Compendium" button (the circular arrows beside the ✕), shown whenever the item came from a compendium — on world items AND on items owned by a character. Clicking it re-pulls the item's name, artwork, stats, and effects from its source pack after a confirm, while keeping your copy's quantity, equipped state, bag, and flags.
- Items now remember their compendium origin when they land on a character by any route — dragging from a pack, buying from the Creator shop or an HQ vendor, package/bond grants, quest/faction/mission rewards, party stash hand-offs, and steal/devour — so the Refresh button works on them.

## 0.2.22 - 2026-06-28

- Encounter budget reworked to a Party-Equivalents model: one gauge measured in PC-worth (Minion 1/4, Standard 1, Elite 2, Solo = party size), with difficulty as a simple +offset
- Minion Squads: pooled-HP horde units that act on a single initiative and strike once per living member
- NPC star x tier ratings: a per-NPC power level (1-5 stars) layered over the combat role, plus an NPC Skill Point Log
- Enemy Skill Points now always snap to multiples of 5 (star-3 ladder: Minion 5 / Standard 10 / Elite 15 / Solo 25)

## 0.2.21 - 2026-06-27

- Monster Roles are now listed alphabetically in the Monster Creator picker: Artillery, Brute, Controller, Sentinel, Skirmisher, Support.

## 0.2.20 - 2026-06-27

- Enemy HP and Energy now use a Fabula-Ultima-style formula: clean multiples of 5 derived from the NPC's star Level plus its attributes, with Elite (x2 HP) and Solo (x party HP, x2 Energy) rank scaling. Existing monsters are unchanged - only newly built ones use the new model.
- NPC tier badge is cleaner: it shows just the Tier (Solo, Elite, etc.) without the trailing worth descriptor.

## 0.2.19 - 2026-06-27

- Bosses no longer alpha-strike: a Boss/Solo now takes one action per player, interleaved between the players' turns instead of back-to-back, and Elites take 2 actions.
- Minion squads now attack as one shared group-strike: a single to-hit for the whole squad, with damage still scaling by the number of surviving members.
- New monster Role axis (Brute, Skirmisher, Artillery, Sentinel, Controller, Support): pick a Role and the Monster Creator spreads the attributes, sets the signature attack, and grants a signature ability for you.
- Monster Creator streamlined to read off a chart: one Frame step (star, Tier, Role) shows the finished statblock as final numbers, with attributes pre-filled on an optional Tune step.
- A monster's Role now shows as a badge beside its star-Tier badge on the NPC sheet header and the creator review.

## 0.2.18 - 2026-06-27

- Monsters now have a ROLE (a third axis alongside Tier and ★): Brute, Skirmisher, Artillery, Sentinel, Controller, or Support. Pick one in the Monster Creator's Tier step and it does the build for you — spreads the Step-Up budget down that role's attribute priority (no more hand-clicking dice), nudges Evasion/Defense to fit the role, pre-fills the natural-weapon Basic Attack, and grants one signature ability. The role's ability is reserved from the Skill-Point budget so the remaining pool stays honest; click the selected role again to clear it back to a custom hand-build. Role is power-neutral — it doesn't change a monster's encounter cost. Existing NPCs are unchanged (no role until you pick one).

## 0.2.17 - 2026-06-27

- Minion squads now strike as ONE shared action: a single to-hit for the whole squad instead of one roll per member. On a hit, every living member still adds its damage (rolled and adjusted for the target's Defense/affinity, then summed into one application), so a bigger squad still hits harder and a tough target still shrugs off chaff. On a miss the squad does nothing — the strike is now all-or-nothing (burst or whiff). A lone minion (size 1) still makes a normal attack.

## 0.2.16 - 2026-06-27

- Bosses no longer alpha-strike: a Boss/Solo now appears multiple times in the turn order at spread initiative, so its actions are INTERLEAVED between the players' turns (boss, player, boss, player…) instead of taken back-to-back.
- A Boss/Solo now takes as many actions per round as there are players in the fight; an Elite now takes 2; Minions and Standards take 1. (The old "+1 at ★4+" Solo bonus is retired.) The extra turns share one token, so the boss's HP, damage, and Defeat stay in sync across its entries.
- Lingering decay, status-duration countdown, and Sustain/Channel upkeep now tick once per round per creature — a multi-action boss no longer decays, regenerates, or burns through its statuses several times faster, and stepping the tracker backward no longer double-applies them.

## 0.2.15 - 2026-06-27

- Encounter budgets now use Party-Equivalents: a Minion is worth 1/4 of a PC (four = one), a Standard 1, an Elite 2, and a Solo equals the whole party.
- Encounter difficulty is now a simple offset on the player count: Easy -2, Medium on-level, Hard +2, Extreme +4.
- Each monster's PC-worth is shown on its NPC tier badge and in the Monster Creator, so you can budget a fight at a glance.

## 0.2.14 - 2026-06-26

- Recruits can now be gated on a quest directly from the Recruitment setup (new Quest Complete condition); the quest-side Recruit reward UI is retired,Removed the Mercenary and Dispatch roles — recruits are now one kind and anyone idle can be dispatched on missions,Recruitment lock/hide symbols lost their hover tooltips and now toggle seamlessly with no re-render flash,HQ header faction colour picker tints the banner background and border

## 0.2.13 - 2026-06-26

- HQ header now has a faction colour picker that tints the headquarters banner and its border,Recruitment cards gained clickable lock/unlock and hide-from-players symbols (GM); hidden recruits are invisible to players,Recruits can be gated behind quests — complete a quest with a Recruit reward to unlock them,Recruitment condition dropdown is now Title Case and sorted alphabetically,Added Minion Squads (pooled-unit hordes) to the Encounter Builder, plus NPC star x tier power ratings and a refundable NPC Skill Point Log

## 0.2.12 - 2026-06-26

- Headquarters import/export: bundle the entire HQ (identity, roster, facilities, missions, resources) plus its backing NPC actors into a portable .zip to move between games,Minion Squads: pooled-unit hordes for the Encounter Builder (one squad, pooled HP, strikes per living member),NPC Ascendant Stars: per-NPC star x tier power ratings, Solo extra turns, and a refundable NPC Skill Point Log,Ten new fully-wired Skill Effects, passive Drain on basic attacks, and Reflect reworked into a Status,HQ polish: Combat talent replaces Medicine, talents and resource pools alphabetized, and a home icon for the Codex

## 0.2.11 - 2026-06-26

- Status Immunity: a new no-code Active Effect rule that makes the bearer immune to a chosen Status Effect - incoming inflicts (Skill/weapon, Hinder, Inflict Modifier, Lingering) are shrugged off
- Minion Squads: pooled-unit hordes for the Encounter Builder
- NPC Ascendant Stars (1-5 power rating) plus a refundable NPC Skill Point Log

## 0.2.10 - 2026-06-25

- Bond Offer: each rank is now a card — click a rank to open its full editor (ability, effect, rewards) in a codex-style detail book, instead of one long stacked list.
- Rank cards show an at-a-glance summary: ability name plus an effect marker and gold / SP / item-reward counts.

## 0.2.9 - 2026-06-25

- Quest banner: click the banner to set or replace its image — now works in any view, not just edit mode,Quest banner: drag to reposition the focal point, and scroll the wheel to zoom the image (1–4×)

## 0.2.8 - 2026-06-22

- Headquarters: new Mission Haste effect output — a Trait or effect on a dispatch agent now shortens a mission's duration, bringing the whole squad home a turn (or more) sooner (floored at 1 turn).
- Mission squad-picker shows a live return-time estimate that reflects the assembled squad's combined haste.
- Actor sheets now use the card-style portrait frame for all characters, not just NPCs.

## 0.2.7 - 2026-06-21

- Minion Squads: the Encounter Builder now spawns Minions as a single pooled squad (one body, one initiative) instead of stacking duplicate tokens.
- Squad HP is pooled (member HP x squad size); a squad's Basic Attack strikes once per living member.
- Encounter screen gains Power + Bodies gauges; existing encounters auto-migrate from the old quantity multiplier.

## Unreleased — Encounter Builder: Minion Squads

Reworked enemy/encounter creation around how classless, levelless TTRPGs handle
hordes (13th Age mooks, Draw Steel & Genesys minion squads, Daggerheart battle
points), retiring the clumsy per-row "× quantity" multiplier.

- **Minion Squads (pooled units)** — a Minion-Tier NPC now fields as ONE squad:
  one token, one initiative, one pooled HP bar (`hp.max = per-member HP × size`).
  Area/any damage drains the shared pool, so a squad loses members automatically
  (the AoE-clears-chaff counter), and its Basic Attack strikes once per LIVING
  member as a single consolidated volley (`rollSquadStrike`). Durability AND
  output scale with the count. Standard / Elite / Solo stay individuals — drag
  again to field another body.
- **Encounter Builder, retooled** — no quantity multiplier anywhere. Minion lines
  carry a squad-SIZE stepper (priced sub-linearly via `squadSwarmFactor`); other
  tiers are one line per body. The fight reads on TWO gauges: **Power** (the same
  Skill-Point budget vs Party SP × difficulty) and **Bodies** (turns/round vs the
  players — a squad is 1, a Solo is 2–3), replacing the old bolt-on warnings.
- **Squad authoring** — the Monster Creator gains a squad-size control + pooled-HP
  preview for Minions; the actor header, token bars, and Token Info show living
  members (e.g. "3 / 6"). Legacy `{uuid, qty}` encounter lines migrate once
  (minion qty → squad size; non-minion qty → individual lines).

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
