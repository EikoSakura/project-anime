# Constellation Tree Balance Guide

Reference document for node distribution across Lineage and Job trees.

---

## SP Economy

| Constant | Value |
|----------|-------|
| SP per level | 5 |
| Skill node cost | 2 SP |
| Passive node cost | 1 SP |
| Socket node cost | 1 SP |
| Keystone node cost | 3 SP |
| Form node cost | 0 SP |
| Innate node cost | 0 SP |

---

## Tier Overview

| Tier | Total Nodes | Total SP Cost | Notes |
|------|------------:|--------------:|-------|
| Lineage | 15 | ~16 SP | Passive-heavy, no keystones. Forms optional per lineage. |
| Basic Job | 30 | ~45 SP | Foundational. Teaches core skills + proficiencies. |
| Advanced Job | 50 | ~73 SP | Deeper specialization. More skills, more sockets. |
| Hybrid Job | 70 | ~104 SP | Blends two roles. Flex slots lean toward the mix. |
| Special Job | 90 | ~135 SP | Unique/rare. Largest skill library, most sockets. |

---

## Lineage — 15 Nodes (~16 SP)

Defines *what you are*. Passive-heavy with a couple lineage-specific skills.
No keystones. Forms are optional (only certain lineages branch).

| Category | Node Type | Count | SP | Subtotal |
|----------|-----------|------:|---:|---------:|
| Innate (auto-granted) | Passive | 1 | 0 | 0 |
| Skills | Skill | 2 | 2 | 4 |
| Growth Rates | Passive | 3 | 1 | 3 |
| Stat Bonuses | Passive | 3 | 1 | 3 |
| Resistances | Passive | 2 | 1 | 2 |
| Special (flags) | Passive | 2 | 1 | 2 |
| Sockets | Socket | 2 | 1 | 2 |
| **Total** | | **15** | | **16** |

### Lineages with Forms
Subtract 1-2 nodes from any passive category and replace with Form nodes (0 SP).
Total SP decreases by 1-2 accordingly.

### Design Notes
- Growth Rates are highest here (20%) — lineage defines natural aptitudes
- Skills are lineage-flavored (e.g., a beast lineage might grant a claw attack)
- Special flags cover things like Undead, Element Pierce, etc.
- Sockets let players customize racial identity with manacite

---

## Basic Job — 30 Nodes (~45 SP)

Entry-level profession. Teaches foundational skills and grants weapon/armor access.
Many "passives" in jobs are actually delivered as passive skills — factor that
into the Skill count when designing specific jobs.

| Category | Node Type | Count | SP | Subtotal |
|----------|-----------|------:|---:|---------:|
| Innate (starter perk) | Passive | 1 | 0 | 0 |
| Skills | Skill | 8 | 2 | 16 |
| Stat Bonuses | Passive | 5 | 1 | 5 |
| Growth Rates | Passive | 3 | 1 | 3 |
| Resistances | Passive | 2 | 1 | 2 |
| Proficiencies | Passive | 3 | 1 | 3 |
| Special (flags) | Passive | 1 | 1 | 1 |
| Sockets | Socket | 3 | 1 | 3 |
| Keystones | Keystone | 4 | 3 | 12 |
| **Total** | | **30** | | **45** |

### Design Notes
- ~27% Skills — 8 is a solid starter kit for a profession
- Proficiencies front-loaded here (weapon/armor access is an early need)
- 4 Keystones pace the tree into roughly 4 progression tiers
- Jobs that lean passive can shift 1-2 Stat Bonus nodes → Skills (keeps SP same if passive skills at 2 SP, or swap keystones down)
- Jobs that are very active can shift Resistances/Special → more Skills

---

## Advanced Job — 50 Nodes (~73 SP)

Deeper specialization with a broader skill set.

| Category | Node Type | Count | SP | Subtotal |
|----------|-----------|------:|---:|---------:|
| Innate (entry perk) | Passive | 1 | 0 | 0 |
| Skills | Skill | 14 | 2 | 28 |
| Stat Bonuses | Passive | 8 | 1 | 8 |
| Growth Rates | Passive | 4 | 1 | 4 |
| Resistances | Passive | 5 | 1 | 5 |
| Proficiencies | Passive | 2 | 1 | 2 |
| Special (flags) | Passive | 3 | 1 | 3 |
| Sockets | Socket | 5 | 1 | 5 |
| Keystones | Keystone | 6 | 3 | 18 |
| Flex | Any | 2 | — | — |
| **Total** | | **50** | | **~73** |

### Design Notes
- ~28% Skills — meaningful jump from Basic (8 → 14)
- 6 Keystones create natural checkpoints across the larger tree
- 2 Flex slots let each Advanced job lean into its identity
- Special passives introduce build-defining flags (Element Pierce, etc.)
- Many "stat bonus" nodes may actually be passive skills in practice

---

## Hybrid Job — 70 Nodes (~104 SP)

Blends two combat roles. The flex slots let each hybrid lean its mix.

| Category | Node Type | Count | SP | Subtotal |
|----------|-----------|------:|---:|---------:|
| Innate (entry perk) | Passive | 1 | 0 | 0 |
| Skills | Skill | 22 | 2 | 44 |
| Stat Bonuses | Passive | 11 | 1 | 11 |
| Growth Rates | Passive | 5 | 1 | 5 |
| Resistances | Passive | 5 | 1 | 5 |
| Proficiencies | Passive | 3 | 1 | 3 |
| Special (flags) | Passive | 4 | 1 | 4 |
| Sockets | Socket | 8 | 1 | 8 |
| Keystones | Keystone | 8 | 3 | 24 |
| Flex | Any | 3 | — | — |
| **Total** | | **70** | | **~104** |

### Design Notes
- ~31% Skills — large roster reflecting two role blends
- 8 Keystones pace the biggest tree so far
- 3 Flex slots: a magic-tank hybrid might put all 3 into Resistances;
  a striker-healer might put them into Skills
- 8 Sockets reward players who've been collecting manacite

---

## Special Job — 90 Nodes (~135 SP)

Unique, rare, pinnacle professions. The ultimate build investment.

| Category | Node Type | Count | SP | Subtotal |
|----------|-----------|------:|---:|---------:|
| Innate (entry perk) | Passive | 1 | 0 | 0 |
| Skills | Skill | 30 | 2 | 60 |
| Stat Bonuses | Passive | 12 | 1 | 12 |
| Growth Rates | Passive | 6 | 1 | 6 |
| Resistances | Passive | 7 | 1 | 7 |
| Proficiencies | Passive | 3 | 1 | 3 |
| Special (flags) | Passive | 6 | 1 | 6 |
| Sockets | Socket | 11 | 1 | 11 |
| Keystones | Keystone | 10 | 3 | 30 |
| Flex | Any | 4 | — | — |
| **Total** | | **90** | | **~135** |

### Design Notes
- 33% Skills — massive skill library, the payoff for investing in a Special job
- 10 Keystones gate the 90 nodes into digestible progression tiers
- 11 Sockets make manacite collection crucial at endgame
- 4 Flex slots let each Special job feel truly unique
- Special flags at this tier can be powerful and build-defining

---

## Distribution Trends (% of total nodes)

| Category | Lineage | Basic | Advanced | Hybrid | Special |
|----------|--------:|------:|---------:|-------:|--------:|
| Skills | 13% | 27% | 28% | 31% | 33% |
| Growth Rates | 20% | 10% | 8% | 7% | 7% |
| Stat Bonuses | 20% | 17% | 16% | 16% | 13% |
| Resistances | 13% | 7% | 10% | 7% | 8% |
| Proficiencies | — | 10% | 4% | 4% | 3% |
| Special/Flags | 13% | 3% | 6% | 6% | 7% |
| Sockets | 13% | 10% | 10% | 11% | 12% |
| Keystones | — | 13% | 12% | 11% | 11% |

**Key trends:**
- Skills scale up as tiers increase (more active combat options)
- Growth Rates highest on Lineage (racial aptitude), taper for jobs
- Sockets grow slightly (rewarding manacite collectors at higher tiers)
- Proficiencies front-load on Basic jobs (weapon/armor access is early-game)
- Special flags increase at higher tiers (powerful build-defining effects)
- Keystones stay ~11-13% for jobs (consistent pacing)

---

## Career SP Budget

### Single-Path Player (1 Lineage + 1 Job progression)

| Level | Total SP | Trees Invested | Remaining SP |
|------:|---------:|---------------:|-------------:|
| 10 | 45 | Lineage (16) + Basic partial | ~10 |
| 20 | 95 | Lineage (16) + Basic (45) | 34 |
| 40 | 195 | + Advanced (73) | 61 |
| 65 | 320 | + Hybrid (104) | 82 |
| 99 | 490 | + Special (135) | 117 |

Leftover ~117 SP at max level covers ~2 maxed skills (90 SP) plus bond hearts.
Players cannot max everything — meaningful choices persist throughout.

### Multi-Job Player (breadth over depth)

| Level | Total SP | Trees Invested | Remaining SP |
|------:|---------:|---------------:|-------------:|
| 40 | 195 | Lineage (16) + 2 Basic (90) + Adv partial | ~40 |
| 99 | 490 | + Adv (73) + Hybrid (104) | ~207 |

Multi-jobbers get breadth but sacrifice the Special tier or delay it significantly.

---

## Reminder: Jobs Are Skill-Heavy

Many effects that would be "pure passives" in other systems are delivered as
**passive skills** in Shards of Mana. When designing a specific job tree:

- A "passive" like "Shield Mastery (+5 pDef when shield equipped)" is a **Skill node**, not a Passive node
- True Passive nodes are for raw stat bumps (+2 STR), growth rate adjustments, or resistance values
- This means the actual Skill node count on any given job may be **higher** than the template suggests — shift from Stat Bonuses/Resistances into Skills as needed
- The SP cost shifts accordingly (Skill = 2 SP vs Passive = 1 SP), so watch the total

---

## Quick Reference: Node Type → SP Cost

| Node Type | SP Cost | Grants |
|-----------|--------:|--------|
| Form | 0 | Branch selection (lineage only) |
| Innate | 0 | Auto-granted on tree acquisition |
| Passive | 1 | Stat bonus, growth rate, resistance, proficiency, or flag |
| Skill | 2 | Skill item (active or passive skill) |
| Socket | 1 | Empty slot for manacite crystal |
| Keystone | 3 | Progression gate (no grant, just pacing) |
