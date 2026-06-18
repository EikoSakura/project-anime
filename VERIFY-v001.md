# v0.01 Alignment — In-Foundry Verification Checklist

Everything the playtest-doc alignment changed, in one pass. Covers Phase 1
(`e634714` + `895ffa4`), Phase 2 (`a8dfc45`), Phase 3 (`18567e7`), and the
Phase 3.5 loose ends (this commit). Test with a GM client plus one player
client where multiplayer is called out.

## Skill Builder

- [ ] Effect picker gates by Base Rank: the full catalog is always listed, but at ⭐ the over-rank entries — Sense/Transform/Animate/Companion/Illusion/Telepathy (· ★★) and Empower (· ★★★) — are greyed out, unpickable, and tagged with the Rank they need; raising Rank un-greys them. Same in the Secondary Effect picker on the Modifiers step.
- [ ] Picking each of the ten new Effects seeds sensible Target/Duration (Steal/Illusion → Foe, Vanish/Conjure/Companion → Self, Steal/Elemental Control/Animate/Companion → Instant) and re-picking stays free.
- [ ] Skill Evasion lives on the EFFECT step (the Roll step has no dropdown anymore): picking Disguise/Illusion shows locked "Skill Evasion A / B" columns auto-filled Mind + Charm; Telepathy/Vanish fill Mind + Spirit; every other Effect shows no Skill Evasion fields. The item sheet's Edit tab keeps the raw dropdown (real labels, not raw keys).
- [ ] Animate/Companion: the Modifiers step reads 0 / 0, every row is blocked, and switching an existing draft to them sheds its modifiers.
- [ ] Elemental Control shows a free-text "Element" box (NOT the Damage Type list — type anything, e.g. "Sand"); the typed element appears bolded in the auto-description, on the Review step, as an Element row on the item sheet View tab + skill tooltip, and as a text box on the raw Edit tab. A pre-change EC skill's Damage-Type pick lands in the box (capitalized key). Works the same when EC is the Secondary Effect.
- [ ] Choose-able Modifiers configure INSIDE their checklist row once ticked (Inflict / Affinity Damage / Affinity Status / Analyze / Infuse — no separate panels under the list anymore; Secondary Effect keeps its panel). Clicking a picker in the row never un-ticks the Modifier.
- [ ] Affinity (Damage) and Affinity (Status) are MULTI-TAKE (doc: "can be selected more than once"): the ＋ chip in the row adds another Element/Status pick row (each take eats a Modifier slot — watch the budget line), ✕ removes a take (the last take has no ✕ — un-tick the row), and the budget gate blocks ＋ when slots run out. Review lists every take ("Fire — Resist · Ice — Immune") and the modifier list shows "×2". Each Damage take grants its own affinity on use/passive/aura; the auto-description writes one sentence per take. In Improve mode both stay listed when already taken — buying again adds a blank take (pick its Element/Status on the next rebuild); refunding peels one take. Legacy single picks land as take #1.
- [ ] Inflict (in its row): choosing Barrier, Regen, or Curse reveals the Status Pool (HP/Energy) select; choosing Lingering still reveals the element; Reflect is now in the Inflict status list.
- [ ] The Reflect MODIFIER is gone from the Builder and Improve lists; an old skill that had it now shows Inflict + Reflect instead (open one if any exist).
- [ ] A Servant or Companion actor's Builder never offers Animate or Companion (raise one first — see Servants below).
- [ ] Review step shows Target / Duration (+turns) / Skill Evasion / Inflict (+pool) correctly.
- [ ] Auto-description: each new Effect writes its rules sentence(s); Steal's text changes at ⭐⭐⭐; Animate shows the four tier Energy locks computed from its cost; Sense includes the anti-Vanish clause; a passive Drain skill says "your basic attacks…".

## Statuses & combat ticks

- [ ] Token HUD shows the new icons: Barrier, Regen, Vanished (and Reflect still).
- [ ] Inflicted statuses still expire after 2 of the bearer's turns (or the skill's Duration), refresh-to-longer; Stunned still auto-skips.
- [ ] Lingering still ticks 1 (element-adjusted) at end of turn — a typed tick on a RESISTANT target now lands 1 (not 0); only IMMUNE → 0 and absorb → heal deviate.
- [ ] **HP damage floors at 1**: any connecting attack/Skill deals at least 1 HP even after a resist (−2) adjustment or a low roll — EXCEPT when the target's Defense alone soaks it to 0 (armor still fully negates a hit). Immunity still → 0; Pierce (ignores Defense) always lands ≥ 1; Energy-pool damage (Drain Energy / energy Strike) may still land 0. The damage card's calc line tags "min 1" when the floor lifts the result.
- [ ] A Skill-inflicted Curse blocks recovery of ONLY its chosen pool: an HP-Curse blocks HP heals / HP-regen / HP-drain / HP potions but Energy still recovers (and vice versa for an Energy-Curse). The inflict card + item sheet + auto-description read "Curse (Hit Points / Energy)". A Curse toggled by hand from the token HUD still blocks BOTH pools.
- [ ] Prone still steps the ATTACKER's dice up; Sealed blocks skill activation.

## Phase 1 spot-checks (if not already verified)

- [ ] Natural Attack rolls at DMG −2; Bow has no grip toggle and never gains the two-handed step-up.
- [ ] Push/Pull distance = the Skill's Rank; Chain leaps within 3 tiles; Secondary Effect costs 2 modifier slots (legacy over-budget skills show the warning badge, still work).
- [ ] Roll dialog has the CT preset dropdown (7/10/13/16/19) + custom field.
- [ ] Initiative shows whole numbers in the tracker; ties still break by larger Agility, then NPCs before PCs (the ordering fractions are hidden but still applied).
- [ ] End of combat: non-hostile NPCs at 0 HP recover to half; hostile stay down/hidden.
- [ ] Protection / Affinity (Damage) modifiers apply their auto-effects passive, on-use, and via aura; Analyze/Banish/Infuse/Manifest/Nullify show their creation-time picks on cards.

## Phase 2 spot-checks (if not already verified)

- [ ] Ally-target skills refuse self/enemies before Energy is spent; Foe-target always rolls accuracy; Self/Ally never roll.
- [ ] Channeled skill: marker appears, 1 EP at the start of each turn, dismissing the marker (effects panel right-click → Remove) sweeps every applied copy; running dry ends it.
- [ ] Skill Evasion swaps the defender's attribute on cards ("vs Skill Evasion (Mind)"); Banish/Nullify defenders auto-use better-of-Spirit.
- [ ] Transform steps one attribute +2 or two +1; Empower/Weaken touch exactly one chosen attribute.
- [ ] Aura audience follows Target (Foe = enemies only, Any = everyone incl. bearer, Ally = allies + bearer).

## The ten new Effects (Phase 3)

- [ ] **Strike-style checks first**: Steal/Disguise/Illusion/Telepathy aimed at a Foe (or Any vs an enemy) roll accuracy vs the pair Skill Evasion — the card names "Skill Evasion (Mind or Charm)" and uses the defender's BETTER attribute + gear mods.
- [ ] **Steal**: hit → "Steal Item" button → picker lists carried items (never skills/natural/granted); at ⭐⭐⭐+ equipped items appear and trigger the Contested Check card (auto-rerolls ties); win moves the item (one unit off a stack), player-vs-GM-monster works via relay; Luck flip-to-hit re-offers the button.
- [ ] **Vanish**: cast applies Vanished for the Duration (Scene/Channeled variants too); ANY attack you make removes it with a "revealed" line; "Stay Hidden" rolls your accuracy vs the targeted seeker; aiming a Sense skill at a vanished creature rolls Mind+Spirit (one die stepped up) vs their Skill Evasion.
- [ ] **Conjure**: picker offers Weapons/Armor/Shields packs + free-text; the item lands equipped (displacing the slot holder), shows on the recipient; when the duration marker expires/is dismissed/the channel ends, the item evaporates — including on a token in another scene.
- [ ] **Gate**: two crosshair picks → two portal tiles appear (player cast routes via GM); the targeting templates do NOT persist; marker expiry/dismissal removes both tiles.
- [ ] **Animate**: needs a targeted 0-HP creature (warns otherwise, no Energy spent); servant appears at the corpse with full HP/EN, skills above the Animate's rank gone, Animate/Companion skills gone; filed in "Servants & Companions", casting player owns it; caster's max Energy drops by tier × cost (check vs a Minion and an Elite corpse); Dismiss button (and outright deleting the servant) restores it.
- [ ] **Companion**: first use prompts a name and creates the all-d6 12/12 friendly NPC owned by the player; later uses just report it; no Energy change.
- [ ] **Disguise/Illusion/Telepathy**: landing leaves a named marker on the target (Disguise also marks the caster); re-casting refreshes rather than stacks; markers honor Duration/Scene/Channeled.
- [ ] **Elemental Control**: casts with no roll, card shows the chosen element + generate/move/suppress text.
- [ ] Neither Animate nor Companion creatures appear in the combat tracker or party rail; their owner can move them on the caster's turn.

## Barrier / Regen / Overcome / Combo (Phase 3)

- [ ] Inflict-Barrier on a hit (or grant to an ally) rolls the Skill Die for the value; the damage card then shows "absorbed by Barrier" and only the remainder hits HP/EN; the status drops when both pools empty; undoing a damage row doesn't get eaten by an active Barrier.
- [ ] Drain feeds on what got THROUGH a Barrier (a fully absorbed hit drains nothing).
- [ ] Inflict-Regen restores its rolled value at the start of the bearer's turns (blocked by Curse, off at 0 HP).
- [ ] Effects panel right-click on a status or ensnare marker (as its owner) offers Overcome / Remove / Cancel; Overcome prefills the CT with the inflicting skill's die size; success removes the effect and re-application from the same skill is blocked for 2 rounds; right-click on any other effect still removes instantly.
- [ ] A Combo on your own combat turn: the next End Turn / tracker advance stays on you with a chat note; the SECOND advance moves on; a combo during the granted turn does NOT chain; a React combo on someone else's turn grants nothing; a Luck-flip combo grants the extra turn to the original roller (test with a different player spending the Luck).

## Phase 3.5

- [ ] A PASSIVE skill with Drain HP/Energy: basic weapon (and shield-bash) damage heals/recovers half to the attacker; skill casts unchanged.
- [ ] Reflect via Inflict: lands as a 2-turn status on the target, shows in the effects panel, Overcome can clear it; old Reflect-modifier skills migrated (see Builder section).

## Multiplayer / relay sanity

- [ ] Player steals from / conjures onto / animates a GM-owned creature — all land via the GM relay (GM client must be open).
- [ ] Player gate-cast places tiles; player dismissing their servant removes its tokens and actor.
- [ ] Valued statuses (Barrier/Regen) inflicted by a player on a GM monster carry their value + pool.
