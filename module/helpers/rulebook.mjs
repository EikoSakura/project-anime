/**
 * Shards of Mana — Rulebook Journal Entry
 * Auto-populates the "rules" compendium pack on first load.
 */

/* -------------------------------------------- */
/*  Page Content                                */
/* -------------------------------------------- */

const PAGES = [
  // ═══════════════════════════════════════════
  // PAGE 1 — INTRODUCTION
  // ═══════════════════════════════════════════
  {
    name: "Introduction",
    sort: 100000,
    text: {
      content: `
<h2>Welcome to Shards of Mana</h2>
<p><em>Shards of Mana</em> is an original tabletop role-playing game built for Foundry VTT. It is a world of crystallized magic, adventuring guilds, and bonds forged through shared peril. Players take on the role of <strong>Adventurers</strong> — seekers of fortune and glory who grow stronger through combat, exploration, and the connections they form with others.</p>

<h3>Core Principles</h3>
<ul>
  <li><strong>Growth Through Play</strong> — Your character evolves through experience, not just numbers. Every level-up involves growth rolls against your personal growth rates, making each adventurer's progression unique.</li>
  <li><strong>Jobs Define Your Path</strong> — Jobs determine your HP, MP, combat proficiencies, and the skills you learn. Master a job to unlock permanent growth bonuses, then move on to advanced or hybrid jobs.</li>
  <li><strong>Skills Are Your Arsenal</strong> — Skills are socketed via Manacite into your Mana Grid, leveling from SL 1 to 5 through XP siphon as you adventure.</li>
  <li><strong>Bonds Give You Strength</strong> — Your relationships with other characters grow through shared experience, granting mechanical benefits as heart ranks deepen.</li>
  <li><strong>Pips Power Your Turns</strong> — Combat uses an action economy of Pips. Higher-ranked adventurers get more pips per turn, allowing more actions.</li>
</ul>

<h3>What You Need</h3>
<p>Shards of Mana requires <strong>Foundry VTT v13</strong> or later. The system handles all dice rolling, character sheets, combat tracking, and progression automatically.</p>

<h3>Dice</h3>
<p>Shards of Mana uses a single die type: the <strong>d100</strong> (percentile dice). All checks — stat tests, attacks, condition infliction, death saves, and growth rolls — use a d100 roll-under system. Lower is better.</p>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 2 — CHARACTER CREATION
  // ═══════════════════════════════════════════
  {
    name: "Character Creation",
    sort: 200000,
    text: {
      content: `
<h2>Creating an Adventurer</h2>
<p>New characters are created using the <strong>Character Creation Wizard</strong>, accessible from the Actors sidebar. The wizard walks you through eight steps:</p>

<h3>Step 1: Identity</h3>
<p>Choose your character's name and personal details: age, height, weight, pronouns, gender, hair color, eye color, skin tone, build, and distinguishing features. These are purely cosmetic and help bring your character to life.</p>

<h3>Step 2: Stats</h3>
<p>All eight stats begin at a <strong>base of 10</strong>. You receive a pool of <strong>40 additional points</strong> to distribute freely, with a <strong>maximum of 25</strong> in any single stat at character creation. This represents your character's natural aptitudes.</p>

<table>
  <caption>The Eight Core Stats</caption>
  <thead><tr><th>Stat</th><th>Abbr.</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td>Strength</td><td>STR</td><td>Physical power. Drives physical damage (P.DMG).</td></tr>
    <tr><td>Agility</td><td>AGI</td><td>Speed and reflexes. Drives physical accuracy (P.HIT) and evasion (P.EVA).</td></tr>
    <tr><td>Vitality</td><td>VIT</td><td>Endurance and toughness. Drives physical defense (P.DEF) and HP.</td></tr>
    <tr><td>Magic</td><td>MAG</td><td>Arcane aptitude. Drives magical accuracy (M.HIT) and magical damage (M.DMG).</td></tr>
    <tr><td>Spirit</td><td>SPI</td><td>Willpower and inner strength. Drives magical evasion (M.EVA), magical defense (M.DEF), and MP.</td></tr>
    <tr><td>Perception</td><td>PER</td><td>Awareness and keen senses. Used for observation, tracking, and detection.</td></tr>
    <tr><td>Luck</td><td>LCK</td><td>Fortune's favor. Drives critical hit rate (CRIT) and critical avoidance (C.AVO).</td></tr>
    <tr><td>Charm</td><td>CHM</td><td>Force of personality. Used for social interactions, persuasion, and leadership.</td></tr>
  </tbody>
</table>

<h3>Step 3: Growth Rates</h3>
<p>Growth rates determine how likely each stat is to increase when you level up. You distribute a pool of <strong>200%</strong> across all eight stats, with a <strong>minimum of 10%</strong> and a <strong>maximum of 60%</strong> per stat. Choose carefully — these define your character's long-term trajectory.</p>
<p>When you level up, the system rolls d100 for each stat. If the roll is equal to or less than the growth rate, that stat gains +1. A stat with 40% growth has a 40% chance to increase each level.</p>

<h3>Step 4: Starting Job</h3>
<p>Select your first job from the available <strong>Basic</strong> jobs in the Codex. Your job determines your base HP, base MP, weapon and armor proficiencies, growth rate modifiers, and the skills you learn at each rank. See the <strong>Jobs</strong> section for details.</p>

<h3>Step 2: Lineage</h3>
<p>Choose <strong>1 or 2 lineages</strong> for your character. Each lineage grants traits, skills, movement modes, and element resistances.</p>
<ul>
  <li><strong>Single Lineage (Realized)</strong> — You receive both base and realized abilities, unlocking the lineage's full power.</li>
  <li><strong>Dual Lineage</strong> — You receive base abilities from both lineages and choose your character's size from either. No realized abilities.</li>
</ul>

<h3>Step 6: Traits</h3>
<p>Select up to <strong>2 traits</strong> (GM configurable). Traits are freeform character qualities like Ambidextrous, Hero, or Lucky.</p>
<p>Some traits grant passive abilities or skills.</p>

<h3>Step 6: Equipment</h3>
<p>Purchase your starting gear within a budget of <strong>250 gold</strong>. You can equip a weapon, offhand, helm, armor, and up to two accessories.</p>

<h3>Step 7: Biography</h3>
<p>Write your character's appearance, personality, and backstory. This step is entirely optional but enriches the roleplaying experience.</p>

<h3>Step 8: Review &amp; Finalize</h3>
<p>Confirm all your choices. Once finalized, your adventurer is created at <strong>Level 1, Rank F</strong>, with full HP and MP.</p>

<h3>GM Configuration</h3>
<p>The GM can adjust character creation parameters in the system settings: stat pool, stat cap, growth pool, growth min/max per stat, number of starting traits, and starting gold.</p>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 3 — STATS & DERIVED VALUES
  // ═══════════════════════════════════════════
  {
    name: "Stats & Derived Values",
    sort: 300000,
    text: {
      content: `
<h2>Stats &amp; Derived Values</h2>
<p>Every stat has a <strong>base</strong> value (increased by growth rolls on level-up and character creation) and a <strong>bonus</strong> (from equipment and active effects). The <strong>total</strong> equals base + bonus and is what all formulas reference.</p>

<h3>Derived Combat Stats</h3>
<p>These values are automatically calculated from your stats, job, equipment, and active effects:</p>

<table>
  <thead><tr><th>Derived Stat</th><th>Formula</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><strong>HP Max</strong></td><td>Job Base HP + (VIT &times; 2)</td><td>Maximum hit points. At 0 HP, you are Downed.</td></tr>
    <tr><td><strong>MP Max</strong></td><td>Job Base MP + (SPI &times; 2)</td><td>Maximum mana points. Spent to use magical skills.</td></tr>
    <tr><td><strong>P.HIT</strong></td><td>AGI total + weapon bonus</td><td>Physical hit rate. Compared vs target's P.EVA.</td></tr>
    <tr><td><strong>M.HIT</strong></td><td>MAG total + weapon bonus</td><td>Magical hit rate. Compared vs target's M.EVA.</td></tr>
    <tr><td><strong>P.DMG</strong></td><td>STR total + weapon bonus</td><td>Physical damage bonus added to skill damage.</td></tr>
    <tr><td><strong>M.DMG</strong></td><td>MAG total + weapon bonus</td><td>Magical damage bonus added to skill damage.</td></tr>
    <tr><td><strong>P.EVA</strong></td><td>AGI total</td><td>Physical evasion. Subtracts from attacker's P.HIT.</td></tr>
    <tr><td><strong>M.EVA</strong></td><td>SPI total</td><td>Magical evasion. Subtracts from attacker's M.HIT.</td></tr>
    <tr><td><strong>P.DEF</strong></td><td>VIT total</td><td>Physical defense. Reduces physical damage taken.</td></tr>
    <tr><td><strong>M.DEF</strong></td><td>SPI total</td><td>Magical defense. Reduces magical damage taken.</td></tr>
    <tr><td><strong>CRIT</strong></td><td>floor(LCK / 2)</td><td>Critical hit threshold. Roll at or below this to crit.</td></tr>
    <tr><td><strong>C.AVO</strong></td><td>floor(LCK / 2)</td><td>Critical avoidance. Subtracts from attacker's CRIT.</td></tr>
    <tr><td><strong>MOV</strong></td><td>4 (base)</td><td>Movement in squares per turn. Modified by conditions.</td></tr>
    <tr><td><strong>PIPS</strong></td><td>By Adventurer Rank</td><td>Action points per turn. See Rank table below.</td></tr>
  </tbody>
</table>

<h3>Adventurer Rank</h3>
<p>As adventurers gain levels, their rank increases, granting more pips per turn:</p>

<table>
  <thead><tr><th>Rank</th><th>Level Required</th><th>Pips per Turn</th></tr></thead>
  <tbody>
    <tr><td>F</td><td>1</td><td>2</td></tr>
    <tr><td>E</td><td>10</td><td>2</td></tr>
    <tr><td>D</td><td>20</td><td>3</td></tr>
    <tr><td>C</td><td>30</td><td>3</td></tr>
    <tr><td>B</td><td>45</td><td>4</td></tr>
    <tr><td>A</td><td>60</td><td>4</td></tr>
    <tr><td>S</td><td>80</td><td>5</td></tr>
  </tbody>
</table>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 4 — JOBS
  // ═══════════════════════════════════════════
  {
    name: "Jobs",
    sort: 400000,
    text: {
      content: `
<h2>Jobs</h2>
<p>Jobs are the heart of character progression. Your active job determines your base HP, base MP, weapon and armor proficiencies, and the skills you learn as you advance in rank. An adventurer always has one <strong>active job</strong> but can switch jobs freely outside of combat.</p>

<h3>Job Categories</h3>
<table>
  <thead><tr><th>Category</th><th>Prerequisites</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><strong>Basic</strong></td><td>None</td><td>Starting jobs with no requirements. Available during character creation.</td></tr>
    <tr><td><strong>Advanced</strong></td><td>Skill requirements</td><td>Specialized jobs that require mastering specific skills from basic jobs.</td></tr>
    <tr><td><strong>Hybrid</strong></td><td>Skill requirements</td><td>Jobs that blend disciplines from multiple basic or advanced jobs.</td></tr>
    <tr><td><strong>Special</strong></td><td>Skill requirements</td><td>Rare or unique jobs with unusual prerequisites.</td></tr>
  </tbody>
</table>

<h3>Job Rank Progression</h3>
<p>Each job has its own rank from F to S, separate from your adventurer rank. As you gain levels while a job is active, the job's rank increases. Higher ranks unlock new skills associated with that job.</p>
<p>Each rank tier lists <strong>starter skills</strong> that are granted when you reach that rank in the job. These skills start at Skill Level 1 and can be leveled up independently.</p>

<h3>HP &amp; MP</h3>
<p>Your HP and MP maximums are derived from your active job:</p>
<ul>
  <li><strong>HP Max</strong> = Job's Base HP + (VIT &times; 2)</li>
  <li><strong>MP Max</strong> = Job's Base MP + (SPI &times; 2)</li>
</ul>
<p>Switching jobs may change your HP and MP maximums. Your current HP/MP are clamped to the new maximum if they exceed it.</p>

<h3>Proficiencies</h3>
<p>Jobs grant <strong>weapon proficiencies</strong> (which weapon groups you can use effectively) and <strong>armor proficiencies</strong> (which armor categories you can wear). Using equipment outside your proficiencies may impose penalties or be disallowed.</p>

<h3>Growth Rate Modifiers</h3>
<p>Each job applies modifiers to your base growth rates while active. A martial job might add +10% to STR growth and -5% to MAG growth. These modifiers stack with your base growth rates during level-up rolls.</p>

<h3>Mastery Bonus</h3>
<p>Reaching <strong>Rank S</strong> in a job grants a permanent <strong>mastery bonus</strong> — a lasting growth rate increase that persists even after switching to another job. This rewards dedication to fully mastering a discipline.</p>

<h3>Limit Break</h3>
<p>Each job defines a unique <strong>Limit Break</strong> — a devastating ultimate ability available from Rank D onward. See the <strong>Limit Break</strong> section for details on how the gauge works.</p>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 5 — SKILLS
  // ═══════════════════════════════════════════
  {
    name: "Skills",
    sort: 500000,
    text: {
      content: `
<h2>Skills</h2>
<p>Skills are the primary abilities your adventurer uses in and out of combat. Each skill has a <strong>Skill Level (SL)</strong> from 1 to 10 that determines its potency — many skill formulas use SL as a variable, so a skill grows more powerful as you invest in it.</p>

<h3>Learning Skills</h3>
<p>Skills can be learned from multiple sources:</p>
<ul>
  <li><strong>Job Ranks</strong> — Each job grants starter skills at specific rank thresholds. These are learned automatically at SL 1.</li>
  <li><strong>Manacite Absorption</strong> — Absorbing a Manacite grants its associated skill. The skill level depends on the Manacite's rank (see Manacite section).</li>
  <li><strong>Experiential Learning</strong> — Repeated exposure to certain conditions may teach related survival skills (GM adjudicated).</li>
</ul>

<h3>Leveling Up Skills</h3>
<p>Manacite levels up through <strong>XP Siphon</strong> — socketed manacite automatically absorbs a portion of XP earned by the adventurer. Skills progress from SL 1 to SL 5.</p>

<table>
  <thead><tr><th>Skill Level</th><th>SP Cost</th></tr></thead>
  <tbody>
    <tr><td>1 &rarr; 2</td><td>1</td></tr>
    <tr><td>2 &rarr; 3</td><td>2</td></tr>
    <tr><td>3 &rarr; 4</td><td>3</td></tr>
    <tr><td>4 &rarr; 5</td><td>4</td></tr>
  </tbody>
</table>
<p><strong>SL 5 is the maximum.</strong> Higher SL increases damage formulas and may unlock additional effects.</p>

<h3>Skill Types</h3>
<table>
  <thead><tr><th>Type</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><strong>Combat</strong></td><td>Offensive or defensive abilities used in battle.</td></tr>
    <tr><td><strong>Utility</strong></td><td>Non-combat abilities with practical applications.</td></tr>
    <tr><td><strong>Passive</strong></td><td>Always-on effects that provide persistent bonuses.</td></tr>
    <tr><td><strong>Reaction</strong></td><td>Triggered defensively in response to enemy actions.</td></tr>
    <tr><td><strong>Limit Break</strong></td><td>Ultimate abilities requiring a full Limit Break gauge.</td></tr>
  </tbody>
</table>

<h3>Skill Timing</h3>
<ul>
  <li><strong>Action</strong> — A standard action that costs pips to use.</li>
  <li><strong>Reaction</strong> — Triggered in response to an event (does not cost pips on your turn).</li>
  <li><strong>Passive</strong> — Always active, no activation needed.</li>
  <li><strong>Limit Break</strong> — Requires the Limit Break gauge to be at 100%.</li>
</ul>

<h3>Skill Properties</h3>
<p>Each skill has mechanical properties that define how it works:</p>
<ul>
  <li><strong>Pip Cost</strong> — Number of pips consumed to use the skill (formula-based, may scale with SL).</li>
  <li><strong>MP Cost</strong> — Mana consumed to use the skill (formula-based).</li>
  <li><strong>Damage Formula</strong> — The base damage dealt, usually referencing SL (e.g., <code>SL * 3 + 10</code>).</li>
  <li><strong>Skill Base</strong> — Base accuracy bonus added to hit calculation.</li>
  <li><strong>Skill Stats</strong> — Which stats contribute to the skill's hit bonus (best one is used).</li>
  <li><strong>Defense Type</strong> — Physical, Magical, or None (auto-hit). Determines which hit/evasion/defense stats are used.</li>
  <li><strong>Damage Type</strong> — The element of the damage (physical, fire, ice, etc.) or "healing."</li>
  <li><strong>Target Type</strong> — Self, Single, Area, or Field.</li>
  <li><strong>Range</strong> — Distance in squares (0 = melee).</li>
  <li><strong>Condition</strong> — A status condition that may be inflicted on hit, with a percentage chance.</li>
</ul>

`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 6 — MANACITE
  // ═══════════════════════════════════════════
  {
    name: "Manacite",
    sort: 600000,
    text: {
      content: `
<h2>Manacite</h2>
<p>Manacite are crystallized fragments of mana — shimmering shards that contain the echo of a skill. When an adventurer <strong>absorbs</strong> a Manacite, they learn the skill contained within it at a level determined by the Manacite's rank.</p>

<h3>Types of Manacite</h3>
<ul>
  <li><strong>Standard Manacite</strong> — Found naturally or sold by merchants. Contains a specific skill.</li>
  <li><strong>Monster Manacite</strong> — Dropped by defeated monsters. Contains a skill related to the monster's abilities.</li>
</ul>

<h3>Absorption</h3>
<p>To absorb a Manacite, the adventurer uses the <strong>Absorb</strong> button on their Skills tab (Manacite Pouch section). Absorption is permanent — the Manacite is consumed and the skill is learned. If the adventurer already knows the skill, the higher skill level is kept.</p>

<h3>Rank to Skill Level</h3>
<p>The rank of the Manacite determines the skill level granted:</p>

<table>
  <thead><tr><th>Manacite Rank</th><th>Skill Level Granted</th></tr></thead>
  <tbody>
    <tr><td>F</td><td>1</td></tr>
    <tr><td>E</td><td>3</td></tr>
    <tr><td>D</td><td>5</td></tr>
    <tr><td>C</td><td>7</td></tr>
    <tr><td>B</td><td>9</td></tr>
    <tr><td>A</td><td>10</td></tr>
    <tr><td>S</td><td>10</td></tr>
  </tbody>
</table>
<p>Higher-ranked Manacite are rarer and more valuable but grant skills at much higher starting levels, potentially saving hundreds of XP in skill leveling costs.</p>

<h3>Gold Value</h3>
<p>Each Manacite has a gold value for trading. Merchants may buy and sell Manacite.</p>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 7 — EQUIPMENT
  // ═══════════════════════════════════════════
  {
    name: "Equipment",
    sort: 700000,
    text: {
      content: `
<h2>Equipment</h2>
<p>Adventurers can equip gear across <strong>six equipment slots</strong>. Equipment provides stat bonuses, combat modifiers, and defines your combat capabilities.</p>

<h3>Equipment Slots</h3>
<table>
  <thead><tr><th>Slot</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><strong>Weapon</strong></td><td>Your primary weapon. Adds P.HIT, P.DMG, M.HIT, M.DMG bonuses to derived stats.</td></tr>
    <tr><td><strong>Offhand</strong></td><td>A shield, secondary weapon, or focus item. Blocked by two-handed weapons.</td></tr>
    <tr><td><strong>Helm</strong></td><td>Head protection. Typically provides stat bonuses.</td></tr>
    <tr><td><strong>Armor</strong></td><td>Body protection. Typically provides P.DEF and stat bonuses.</td></tr>
    <tr><td><strong>Accessory 1</strong></td><td>A ring, amulet, or charm. Provides various bonuses.</td></tr>
    <tr><td><strong>Accessory 2</strong></td><td>A second accessory slot.</td></tr>
  </tbody>
</table>

<h3>Weapon Groups</h3>
<p>There are 16 weapon groups: Bows, Chains, Clubs, Firearms, Heavy, Instruments, Long Blades, Natural, Polearms, Shields, Short Blades, Staves, Throwing, Tomes, Unarmed, and Wands. Your job's weapon proficiencies determine which groups you can use effectively.</p>

<h3>Armor Categories</h3>
<p>There are 4 armor categories: <strong>Clothing</strong> (lightest), <strong>Light Armor</strong>, <strong>Heavy Armor</strong> (heaviest), and <strong>Shields</strong> (offhand). Your job's armor proficiencies determine what you can wear.</p>

<h3>Weapon Handedness</h3>
<table>
  <thead><tr><th>Handedness</th><th>Effect</th></tr></thead>
  <tbody>
    <tr><td><strong>One-Handed</strong></td><td>Default. Allows the offhand slot to be used freely. Can dual-wield with another one-handed weapon.</td></tr>
    <tr><td><strong>Two-Handed</strong></td><td>Blocks the offhand slot entirely. Any equipped offhand item is automatically unequipped when a two-handed weapon is equipped.</td></tr>
    <tr><td><strong>Oversized</strong></td><td>Like two-handed, but also has a <strong>STR Requirement</strong>. If your STR is below the requirement, you suffer penalties to P.HIT, M.HIT, P.EVA, and M.EVA.</td></tr>
  </tbody>
</table>

<h3>Dual Wielding</h3>
<p>If you have a one-handed weapon equipped and equip a second one-handed weapon, you are <strong>dual-wielding</strong>. The second weapon displays as your "Offhand" weapon. Both provide their combat bonuses.</p>

<h3>Mighty Grip</h3>
<p>The <strong>Mighty Grip</strong> ability (granted by certain Active Effects) allows you to wield a two-handed weapon in one hand, freeing your offhand slot. However, it does <strong>not</strong> bypass STR requirements for oversized weapons — you still suffer penalties if you lack the strength.</p>

<h3>Equipment Rank</h3>
<p>Equipment has a rank (F through S) indicating its quality and power tier. Higher-ranked equipment generally provides better bonuses.</p>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 8 — COMBAT SYSTEM
  // ═══════════════════════════════════════════
  {
    name: "Combat",
    sort: 800000,
    text: {
      content: `
<h2>Combat</h2>
<p>Combat in Shards of Mana is turn-based, using Foundry VTT's combat tracker. Each round, combatants act in initiative order, spending <strong>Pips</strong> to take actions.</p>

<h3>Initiative</h3>
<p>Initiative is rolled at the start of combat:</p>
<ul>
  <li><strong>Formula:</strong> 1d100 + AGI total</li>
  <li><strong>Tie-breaking:</strong> Higher AGI total wins ties. If still tied, alphabetical by name.</li>
  <li>Higher initiative acts first.</li>
</ul>

<h3>Turn Structure</h3>
<p>At the <strong>start of your turn</strong>, the following happens automatically in order:</p>
<ol>
  <li><strong>Pip Reset</strong> — Your pips are restored to your maximum (determined by adventurer rank).</li>
  <li><strong>Movement Reset</strong> — Your distance moved this turn resets to 0.</li>
  <li><strong>Death Save</strong> — If you are Downed, you must make a death save (see Death &amp; Dying).</li>
  <li><strong>Damage over Time</strong> — Poison and Burn conditions deal their stack value as HP damage.</li>
  <li><strong>Healing over Time</strong> — Regen restores HP and Refresh restores MP (stack value each).</li>
  <li><strong>Effect Expiry</strong> — Temporary effects with 0 remaining duration are removed.</li>
</ol>

<h3>Actions &amp; Pips</h3>
<p>On your turn, you can spend pips to take actions:</p>
<ul>
  <li><strong>Basic Weapon Attack</strong> — Costs <strong>1 pip</strong>. Uses your equipped weapon's stats.</li>
  <li><strong>Use a Skill</strong> — Costs the skill's pip cost (may vary by skill level). Some skills also cost MP.</li>
  <li><strong>Move</strong> — Costs 0 pips. Move up to your MOV stat in squares per turn.</li>
  <li><strong>Other Actions</strong> — Use items, interact with objects, etc. (GM discretion).</li>
</ul>

<h3>Pips by Rank</h3>
<table>
  <thead><tr><th>Rank</th><th>Pips</th></tr></thead>
  <tbody>
    <tr><td>F &amp; E</td><td>2</td></tr>
    <tr><td>D &amp; C</td><td>3</td></tr>
    <tr><td>B &amp; A</td><td>4</td></tr>
    <tr><td>S</td><td>5</td></tr>
  </tbody>
</table>

<h3>Movement</h3>
<p>Base movement is <strong>4 squares</strong> per turn. This is modified by conditions:</p>
<ul>
  <li><strong>Haste:</strong> +2 MOV</li>
  <li><strong>Slow / Freeze:</strong> -2 MOV each</li>
  <li><strong>Root / Downed:</strong> MOV reduced to 0 (cannot move)</li>
</ul>

<h3>Death &amp; Dying</h3>
<p>When an adventurer's HP reaches 0 (and they do not have the Undying condition), they gain the <strong>Downed</strong> condition. While Downed:</p>
<ul>
  <li>You cannot take any actions or move.</li>
  <li>At the start of each turn, you make a <strong>death save</strong>: roll d100 vs your VIT total.</li>
  <li><strong>Pass</strong> (roll &le; VIT): You stabilize but remain Downed.</li>
  <li><strong>Fail</strong> (roll &gt; VIT): You lose 1 death count.</li>
  <li>If your death counts reach <strong>0</strong>, your character is permanently dead.</li>
</ul>
<p>Adventurers start with <strong>3 death counts</strong>. These represent your remaining chances before permanent death and do not replenish easily.</p>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 9 — DICE RESOLUTION
  // ═══════════════════════════════════════════
  {
    name: "Dice Resolution",
    sort: 900000,
    text: {
      content: `
<h2>Dice Resolution</h2>
<p>All rolls in Shards of Mana use a <strong>d100 roll-under</strong> system. Roll a d100 — if the result is equal to or less than your target number, you succeed.</p>

<h3>Stat Tests</h3>
<p>When a character attempts something with an uncertain outcome, the GM calls for a stat test:</p>
<ol>
  <li>The GM chooses the relevant stat and a difficulty modifier.</li>
  <li><strong>Target Number</strong> = Stat Total + Modifier (minimum 1).</li>
  <li>Roll d100. Result &le; Target = <strong>Success</strong>. Result &gt; Target = <strong>Failure</strong>.</li>
</ol>

<h4>Difficulty Modifiers</h4>
<table>
  <thead><tr><th>Difficulty</th><th>Modifier</th></tr></thead>
  <tbody>
    <tr><td>Easy</td><td>+20</td></tr>
    <tr><td>Normal</td><td>+0</td></tr>
    <tr><td>Hard</td><td>-20</td></tr>
    <tr><td>Severe</td><td>-40</td></tr>
    <tr><td>Extreme</td><td>-60</td></tr>
  </tbody>
</table>
<p>There are no critical successes or failures on stat tests — criticals only apply to attack rolls.</p>

<h3>Attack Rolls</h3>
<p>When you attack a target, the system follows this sequence:</p>
<ol>
  <li><strong>Validate</strong> — Check for blocking conditions (stunned, downed, silenced for magical).</li>
  <li><strong>Deduct Resources</strong> — Spend the required pips and MP.</li>
  <li><strong>Calculate Hit Target</strong> — Hit Target = max(Attacker Hit - Target Evasion, 1).</li>
  <li><strong>Calculate Crit Threshold</strong> — Crit = max(Attacker CRIT - Target C.AVO, 1).</li>
  <li><strong>Roll d100</strong>:
    <ul>
      <li>Roll 96-100: <strong>Always misses</strong> (regardless of bonuses).</li>
      <li>Roll &le; Crit Threshold: <strong>Critical Hit!</strong></li>
      <li>Roll &le; Hit Target: <strong>Hit</strong>.</li>
      <li>Roll &gt; Hit Target: <strong>Miss</strong>.</li>
    </ul>
  </li>
</ol>

<h4>Skill Rate Bonus</h4>
<p>When using a skill (not a basic weapon attack), the attacker gains a <strong>Skill Rate</strong> bonus: the skill's base accuracy + the highest total among the skill's associated stats. This is added to the attacker's hit value.</p>

<h3>Damage Calculation</h3>
<p>On a hit, damage is calculated step by step:</p>
<ol>
  <li><strong>Base Damage</strong> = Skill Damage Formula result + Attacker's damage stat (P.DMG or M.DMG based on defense type).</li>
  <li><strong>Critical Multiplier</strong> — If the attack is a critical hit, base damage is multiplied by <strong>1.5&times;</strong> (rounded down).</li>
  <li><strong>Element Resistance</strong> — Multiply by the target's resistance percentage for the damage element:
    <ul>
      <li>100% = full damage (normal)</li>
      <li>150% = 1.5&times; damage (weakness)</li>
      <li>50% = half damage (resistance)</li>
      <li>0% = no damage (immunity)</li>
      <li>Negative = heals instead of damaging (absorption)</li>
    </ul>
  </li>
  <li><strong>Defense Reduction</strong> — Subtract the target's defense (P.DEF or M.DEF).</li>
  <li><strong>Final Damage</strong> = max(result, 0). Damage cannot go below 0.</li>
</ol>

<h3>Condition Infliction</h3>
<p>If an attack has an associated condition, a separate d100 roll is made after a successful hit:</p>
<ul>
  <li>Roll d100 vs the skill's <strong>Condition Chance</strong> percentage.</li>
  <li>If the roll succeeds, the condition is applied to the target.</li>
</ul>

<h3>Healing</h3>
<p>Healing skills work similarly to attacks but restore HP instead of dealing damage:</p>
<ol>
  <li>Validate conditions and deduct resources.</li>
  <li><strong>Heal Amount</strong> = Healing Formula result + bonus stat (M.DMG if magical).</li>
  <li>Applied to the target, capped at their HP maximum.</li>
</ol>
<p>Healing does not require a hit roll — it always succeeds.</p>

<h3>Contests</h3>
<p>When two characters oppose each other directly, the GM calls for a <strong>contest</strong>:</p>
<ol>
  <li>Each participant chooses (or is assigned) a stat.</li>
  <li>Both roll d100 vs their stat total.</li>
  <li>Compare outcomes:
    <ul>
      <li>Success beats failure.</li>
      <li>If both succeed or both fail, compare <strong>margin</strong> (Stat Total - Roll). Higher margin wins.</li>
      <li>Equal margin = tie.</li>
    </ul>
  </li>
</ol>

<h3>Special Combat Rules</h3>
<ul>
  <li><strong>Stun / Downed</strong> — Blocks all actions. You cannot attack or use skills.</li>
  <li><strong>Silence</strong> — Blocks magical skills (defense type "magical"). Physical skills are unaffected.</li>
  <li><strong>Reflect</strong> — Magical damage targeting a character with Reflect is bounced back to the attacker. The reflected damage uses the original damage calculation.</li>
  <li><strong>Undying</strong> — HP cannot drop below 1. Lethal damage is reduced to leave the character at 1 HP instead of triggering the Downed state.</li>
  <li><strong>Defense Type "None"</strong> — Attacks with no defense type auto-hit (no roll needed).</li>
</ul>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 10 — LIMIT BREAK
  // ═══════════════════════════════════════════
  {
    name: "Limit Break",
    sort: 1000000,
    text: {
      content: `
<h2>Limit Break</h2>
<p>Every adventurer has a <strong>Limit Break gauge</strong> that fills during combat. When it reaches 100%, you can unleash your job's ultimate ability — a powerful, dramatic action that can turn the tide of battle.</p>

<h3>Filling the Gauge</h3>
<p>The Limit Break gauge fills in response to dramatic combat events:</p>
<table>
  <thead><tr><th>Trigger</th><th>Gauge Fill</th></tr></thead>
  <tbody>
    <tr><td>Take damage from an attack</td><td>+10%</td></tr>
    <tr><td>Land a critical hit</td><td>+15%</td></tr>
    <tr><td>An ally is knocked out (Downed)</td><td>+25%</td></tr>
  </tbody>
</table>
<p>These values are GM-configurable in the system settings.</p>

<h3>Using a Limit Break</h3>
<ul>
  <li>When the gauge reaches 100%, a dramatic notification announces that your Limit Break is ready.</li>
  <li>Limit Break skills have the timing "Limit Break" — they can only be activated when the gauge is full.</li>
  <li>After using the Limit Break, the gauge <strong>resets to 0%</strong>.</li>
  <li>Each job has its own unique Limit Break, available from <strong>Rank D</strong> onward.</li>
</ul>

<h3>Design Note</h3>
<p>The Limit Break system rewards adventurers who endure hardship. Taking damage and watching allies fall fuels your determination. When it fires, it should feel like a pivotal moment in the battle.</p>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 11 — CONDITIONS
  // ═══════════════════════════════════════════
  {
    name: "Conditions",
    sort: 1100000,
    text: {
      content: `
<h2>Conditions</h2>
<p>Conditions are status effects that modify a character's capabilities. There are <strong>13 negative</strong> and <strong>12 positive</strong> conditions. Conditions can be applied by skills, traps, environmental effects, or GM fiat.</p>

<h3>Negative Conditions</h3>
<table>
  <thead><tr><th>Condition</th><th>Effect</th></tr></thead>
  <tbody>
    <tr><td><strong>Poison</strong></td><td>Deals HP damage equal to stacks at the start of each turn (DoT).</td></tr>
    <tr><td><strong>Burn</strong></td><td>Deals fire HP damage equal to stacks at the start of each turn (DoT).</td></tr>
    <tr><td><strong>Freeze</strong></td><td>MOV -2, P.EVA -5. May skip your turn entirely.</td></tr>
    <tr><td><strong>Drench</strong></td><td>Lightning resistance reduced by 10 (increased lightning vulnerability).</td></tr>
    <tr><td><strong>Blind</strong></td><td>P.HIT -10, PER -5. Severely hampers accuracy and awareness.</td></tr>
    <tr><td><strong>Silence</strong></td><td>Cannot use magical skills. Physical skills are unaffected.</td></tr>
    <tr><td><strong>Slow</strong></td><td>MOV -2. Reduced movement speed.</td></tr>
    <tr><td><strong>Stun</strong></td><td>Cannot take any actions. Skips your entire turn.</td></tr>
    <tr><td><strong>Root</strong></td><td>MOV reduced to 0. Cannot move, but can still act.</td></tr>
    <tr><td><strong>Shatter</strong></td><td>P.DEF -5, M.DEF -5. Defenses are cracked.</td></tr>
    <tr><td><strong>Hex</strong></td><td>M.EVA -10. Weakens magical defenses and may reduce healing received.</td></tr>
    <tr><td><strong>Exhaust</strong></td><td>All 8 stats reduced by -5. A debilitating full-body penalty.</td></tr>
    <tr><td><strong>Downed</strong></td><td>MOV 0, cannot act. Applied at 0 HP. Must make death saves each turn.</td></tr>
  </tbody>
</table>

<h3>Positive Conditions</h3>
<table>
  <thead><tr><th>Condition</th><th>Effect</th></tr></thead>
  <tbody>
    <tr><td><strong>Haste</strong></td><td>MOV +2. Move further each turn.</td></tr>
    <tr><td><strong>Regen</strong></td><td>Restores HP equal to stacks at the start of each turn (HoT).</td></tr>
    <tr><td><strong>Refresh</strong></td><td>Restores MP equal to stacks at the start of each turn.</td></tr>
    <tr><td><strong>Guard</strong></td><td>P.DEF +5. Reduces physical damage taken.</td></tr>
    <tr><td><strong>Ward</strong></td><td>M.DEF +5. Reduces magical damage taken.</td></tr>
    <tr><td><strong>Bulwark</strong></td><td>P.DEF +5, M.DEF +5. Total damage reduction.</td></tr>
    <tr><td><strong>Berserk</strong></td><td>P.DMG +10, but P.DEF -5. Trade defense for offense.</td></tr>
    <tr><td><strong>Valor</strong></td><td>P.HIT +5, M.HIT +5. Improved accuracy across the board.</td></tr>
    <tr><td><strong>Focus</strong></td><td>CRIT +5. Increased critical hit rate.</td></tr>
    <tr><td><strong>Veil</strong></td><td>P.EVA +5, M.EVA +5. Harder to hit.</td></tr>
    <tr><td><strong>Reflect</strong></td><td>Bounces magical attack damage back to the attacker.</td></tr>
    <tr><td><strong>Undying</strong></td><td>HP cannot drop below 1. Survives lethal hits.</td></tr>
  </tbody>
</table>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 12 — ELEMENTS & RESISTANCES
  // ═══════════════════════════════════════════
  {
    name: "Elements & Resistances",
    sort: 1200000,
    text: {
      content: `
<h2>Elements &amp; Resistances</h2>
<p>Damage in Shards of Mana is elemental. Every attack has a damage type (element), and every character has resistance values for each element. The interaction between these creates a rich tactical layer.</p>

<h3>Elements</h3>
<p>There are <strong>12 elements</strong> in Shards of Mana:</p>
<table>
  <thead><tr><th>Element</th><th>Common Sources</th></tr></thead>
  <tbody>
    <tr><td><strong>Physical</strong></td><td>Weapons, unarmed strikes, most basic attacks</td></tr>
    <tr><td><strong>Magical</strong></td><td>Raw arcane energy</td></tr>
    <tr><td><strong>Fire</strong></td><td>Flames, heat, combustion</td></tr>
    <tr><td><strong>Ice</strong></td><td>Cold, frost, freezing</td></tr>
    <tr><td><strong>Lightning</strong></td><td>Electricity, storms, static</td></tr>
    <tr><td><strong>Wind</strong></td><td>Air, gusts, vacuum</td></tr>
    <tr><td><strong>Earth</strong></td><td>Stone, sand, tremors</td></tr>
    <tr><td><strong>Water</strong></td><td>Currents, waves, pressure</td></tr>
    <tr><td><strong>Light</strong></td><td>Holy, radiance, purification</td></tr>
    <tr><td><strong>Dark</strong></td><td>Shadow, corruption, void</td></tr>
    <tr><td><strong>Plant</strong></td><td>Nature, vines, spores</td></tr>
    <tr><td><strong>Poison</strong></td><td>Toxins, venom, acid</td></tr>
  </tbody>
</table>

<h3>Resistance Values</h3>
<p>Each character has a resistance percentage for every element. The default is <strong>100%</strong> (normal damage). Resistance modifies incoming damage as a percentage multiplier:</p>

<table>
  <thead><tr><th>Resistance</th><th>Effect</th><th>Example</th></tr></thead>
  <tbody>
    <tr><td><strong>&gt;100%</strong></td><td>Weakness — takes MORE damage</td><td>150% = 1.5&times; damage taken</td></tr>
    <tr><td><strong>100%</strong></td><td>Normal — standard damage</td><td>100% = full damage</td></tr>
    <tr><td><strong>1-99%</strong></td><td>Resistance — takes LESS damage</td><td>50% = half damage</td></tr>
    <tr><td><strong>0%</strong></td><td>Immunity — takes NO damage</td><td>0% = immune</td></tr>
    <tr><td><strong>Negative</strong></td><td>Absorption — HEALS from that element</td><td>-100% = fully healed by that element</td></tr>
  </tbody>
</table>

<p>On character sheets, resistances are displayed as color-coded chips: <strong style="color:#d44040;">red</strong> for weakness, <strong style="color:#4080d4;">blue</strong> for resistance, <strong style="color:#888;">grey</strong> for immunity, and <strong style="color:#40b070;">green</strong> for absorption.</p>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 13 — BONDS
  // ═══════════════════════════════════════════
  {
    name: "Bonds",
    sort: 1300000,
    text: {
      content: `
<h2>Bonds</h2>
<p>Bonds represent the meaningful relationships your adventurer forms with other characters. Inspired by the Social Link systems of JRPGs, bonds deepen over time, granting narrative weight and mechanical benefits.</p>

<h3>Bond Archetypes</h3>
<p>Each bond is categorized by one of <strong>8 archetypes</strong>, reflecting the nature of the relationship:</p>

<table>
  <thead><tr><th>Archetype</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><strong>Rival</strong></td><td>A competitor who pushes you to be better. Your clashes forge mutual respect.</td></tr>
    <tr><td><strong>Mentor</strong></td><td>A teacher or guide who shares wisdom and experience.</td></tr>
    <tr><td><strong>Beloved</strong></td><td>A romantic partner or deep emotional connection.</td></tr>
    <tr><td><strong>Sworn</strong></td><td>A comrade bound by oath or duty. Loyalty above all.</td></tr>
    <tr><td><strong>Kindred</strong></td><td>A kindred spirit — someone who understands you intrinsically.</td></tr>
    <tr><td><strong>Shadow</strong></td><td>A dark mirror or mysterious figure tied to your past.</td></tr>
    <tr><td><strong>Muse</strong></td><td>An inspiration who sparks creativity and new perspectives.</td></tr>
    <tr><td><strong>Guardian</strong></td><td>A protector who watches over you, or whom you protect.</td></tr>
  </tbody>
</table>

<h3>Heart Rank</h3>
<p>Each bond has a <strong>Heart Rank</strong> from 0 to 5, represented by heart pips on the character sheet. Heart rank deepens through shared experiences during play.</p>
<ul>
  <li><strong>Advancing a heart rank</strong> costs <strong>150 XP</strong>.</li>
  <li>The GM may also set heart ranks directly for narrative purposes.</li>
  <li>Each heart rank has a <strong>condition</strong> (what triggered the advancement) and an <strong>unlock</strong> (what benefit it grants).</li>
</ul>

<h3>Bond Breaking</h3>
<p>Bonds can be <strong>broken</strong> through betrayal, tragedy, or irreconcilable conflict. A broken bond is visually marked (greyscale portrait, struck-through name) but is not deleted — it can be <strong>restored</strong> through roleplay if the rift is mended.</p>

<h3>Creating Bonds</h3>
<p>Bonds are created by right-clicking an actor in the sidebar and selecting <strong>"Add as Bond"</strong>. You choose which adventurer the bond belongs to (if you own multiple) and select the archetype. The bond is linked to the other actor's portrait and name.</p>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 14 — LEVELING UP
  // ═══════════════════════════════════════════
  {
    name: "Leveling Up",
    sort: 1400000,
    text: {
      content: `
<h2>Leveling Up</h2>
<p>Adventurers gain experience points (XP) through play and level up when they accumulate enough. Each level requires <strong>500 XP</strong> of total accumulated XP, regardless of current level. There is no maximum level.</p>

<h3>XP Sources</h3>
<p>XP is awarded by the GM through the XP tab on the adventurer sheet:</p>
<table>
  <thead><tr><th>Category</th><th>Suggested Award</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><strong>Session</strong></td><td>100 XP</td><td>Awarded for participating in a game session.</td></tr>
    <tr><td><strong>Milestone</strong></td><td>250 XP</td><td>Completing a major story milestone.</td></tr>
    <tr><td><strong>Conviction</strong></td><td>50 XP</td><td>Acting on your character's beliefs or convictions in a meaningful way.</td></tr>
    <tr><td><strong>Discovery</strong></td><td>50 XP</td><td>Uncovering significant lore, locations, or secrets.</td></tr>
    <tr><td><strong>Quest</strong></td><td>Varies</td><td>Completing a quest. Amount set by the GM.</td></tr>
  </tbody>
</table>

<h3>The Level-Up Wizard</h3>
<p>When an adventurer has enough XP to level up, a glowing button appears on their sheet header. Clicking it opens the <strong>Level-Up Wizard</strong>, which walks through four steps:</p>

<h4>Step 1: Overview</h4>
<p>Shows your current level, XP, growth rates, and how many levels you can gain in this session. If you have enough XP for multiple levels (e.g., 1,500 XP = 3 levels), you can process them all at once.</p>

<h4>Step 2: Growth Rolls</h4>
<p>For each level gained, the system rolls d100 for each of the 8 stats. If the roll is <strong>equal to or less than</strong> the stat's effective growth rate (base + job modifier), that stat gains <strong>+1</strong> to its base value. Growth rolls are animated with a staggered reveal.</p>
<p><em>Example: If your STR growth rate is 35%, and the d100 rolls 28, your STR gains +1. If it rolls 41, no increase.</em></p>

<h4>Step 3: Summary</h4>
<p>Displays all stat changes across all levels gained, showing before and after values. Review your growth before committing.</p>

<h4>Step 4: Finalize</h4>
<p>Applies all changes to your character. A summary chat card is posted showing your level-up results for all players to see. If your new level reaches a rank threshold, your adventurer rank automatically advances.</p>

<h3>Rank Advancement</h3>
<p>When your level reaches a rank threshold during leveling, your adventurer rank automatically increases. This grants additional pips per turn and may unlock new job features.</p>

<table>
  <thead><tr><th>Rank</th><th>Level Required</th></tr></thead>
  <tbody>
    <tr><td>F &rarr; E</td><td>Level 10</td></tr>
    <tr><td>E &rarr; D</td><td>Level 20</td></tr>
    <tr><td>D &rarr; C</td><td>Level 30</td></tr>
    <tr><td>C &rarr; B</td><td>Level 45</td></tr>
    <tr><td>B &rarr; A</td><td>Level 60</td></tr>
    <tr><td>A &rarr; S</td><td>Level 80</td></tr>
  </tbody>
</table>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 15 — TRAITS
  // ═══════════════════════════════════════════
  {
    name: "Traits",
    sort: 1500000,
    text: {
      content: `
<h2>Traits</h2>
<p>Traits are innate qualities that define who your character is beyond their lineage, job, and stats. They are selected during character creation and provide passive benefits, flavor, or prerequisites for advanced options.</p>

<h3>Traits</h3>
<p>Traits are freeform — they can represent backgrounds, personal talents, or any other character quality. Each trait may have prerequisites and can carry Active Effects.</p>

<h3>Trait Effects</h3>
<p>Traits may provide:</p>
<ul>
  <li><strong>Passive Effects</strong> — Ongoing bonuses or special abilities (described in the trait's text).</li>
  <li><strong>Granted Skills</strong> — Some traits grant a specific skill upon acquisition.</li>
  <li><strong>Prerequisites</strong> — Some traits have requirements that must be met before they can be selected.</li>
</ul>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 16 — EXPERIENTIAL LEARNING
  // ═══════════════════════════════════════════
  {
    name: "Experiential Learning",
    sort: 1600000,
    text: {
      content: `
<h2>Experiential Learning</h2>
<p>Through repeated exposure to certain conditions, adventurers may develop natural resistances and survival instincts. This system rewards characters who endure hardship with new skills.</p>

<h3>How It Works</h3>
<p>Every time a condition is applied to an adventurer, an internal <strong>exposure counter</strong> increments. When the counter reaches the threshold for that condition, the GM receives a whispered notification suggesting a related skill. The GM can then choose to grant the skill.</p>

<h3>Exposure Thresholds</h3>
<table>
  <thead><tr><th>Condition</th><th>Threshold</th><th>Suggested Skill</th></tr></thead>
  <tbody>
    <tr><td>Poison</td><td>5 exposures</td><td>Poison Resistance</td></tr>
    <tr><td>Burn</td><td>5 exposures</td><td>Heat Tolerance</td></tr>
    <tr><td>Freeze</td><td>5 exposures</td><td>Cold Resistance</td></tr>
    <tr><td>Drench</td><td>5 exposures</td><td>Water Affinity</td></tr>
    <tr><td>Blind</td><td>5 exposures</td><td>Blindsight</td></tr>
    <tr><td>Silence</td><td>5 exposures</td><td>Inner Voice</td></tr>
    <tr><td>Slow</td><td>5 exposures</td><td>Adaptive Tempo</td></tr>
    <tr><td>Stun</td><td>7 exposures</td><td>Iron Will</td></tr>
    <tr><td>Root</td><td>5 exposures</td><td>Escape Artist</td></tr>
    <tr><td>Shatter</td><td>5 exposures</td><td>Hardened Shell</td></tr>
    <tr><td>Hex</td><td>5 exposures</td><td>Curse Ward</td></tr>
    <tr><td>Exhaust</td><td>7 exposures</td><td>Endurance</td></tr>
  </tbody>
</table>
<p>Stun and Exhaust require 7 exposures (instead of 5) because they are particularly potent conditions — the GM may wish to gate these skills more carefully.</p>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 17 — PARTY SYSTEM
  // ═══════════════════════════════════════════
  {
    name: "Party System",
    sort: 1700000,
    text: {
      content: `
<h2>Party System</h2>
<p>The <strong>Party</strong> actor represents the adventuring group itself. It tracks shared resources, membership, and the party's quest log.</p>

<h3>Party Management</h3>
<p>Party members are added by dragging adventurer actors onto the party sheet. Each member can be assigned a <strong>role</strong> for organizational purposes:</p>
<table>
  <thead><tr><th>Role</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><strong>Tank</strong></td><td>Front-line defender</td></tr>
    <tr><td><strong>Healer</strong></td><td>Support and recovery</td></tr>
    <tr><td><strong>DPS</strong></td><td>Damage dealer</td></tr>
    <tr><td><strong>Support</strong></td><td>Buffer and utility</td></tr>
    <tr><td><strong>Scout</strong></td><td>Reconnaissance and exploration</td></tr>
  </tbody>
</table>
<p>Roles are purely cosmetic and organizational — they have no mechanical effect.</p>

<h3>Shared Treasury</h3>
<p>The party has a communal <strong>gold treasury</strong> separate from individual adventurer gold. Items can be dragged into the party treasury for shared storage and distribution.</p>

<h3>Quest Log</h3>
<p>The party sheet includes a full quest tracking system:</p>
<ul>
  <li><strong>Quest Status:</strong> Active, Completed, or Failed.</li>
  <li><strong>Priority:</strong> Low, Normal, High, or Critical.</li>
  <li><strong>Objectives:</strong> A checklist of sub-goals that can be individually checked off.</li>
  <li><strong>Rewards:</strong> Text description of expected rewards.</li>
  <li><strong>GM Notes:</strong> Private notes visible only to the GM.</li>
</ul>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 18 — MONSTERS & NPCS
  // ═══════════════════════════════════════════
  {
    name: "Monsters & NPCs",
    sort: 1800000,
    text: {
      content: `
<h2>Monsters &amp; NPCs</h2>

<h3>Monsters</h3>
<p>Monsters are the primary adversaries in Shards of Mana. They share the same 8 core stats as adventurers but have unique features:</p>
<ul>
  <li><strong>Rank</strong> — F through S, indicating the monster's power tier.</li>
  <li><strong>Species Tags</strong> — Descriptive tags for the monster's species type.</li>
  <li><strong>Actions</strong> — Named abilities with type (physical/magical), effect description, and optional condition infliction with a percentage chance.</li>
  <li><strong>Drop Table</strong> — List of Manacite the monster can drop, each with a drop chance percentage. When a monster is defeated, the system rolls against the drop table to determine loot.</li>
  <li><strong>Behavior Priority</strong> — An ordered list of behavioral tendencies that guide GM decision-making (e.g., "targets weakest," "flees at low HP").</li>
  <li><strong>Element Resistances</strong> — Monsters may have unique resistances, weaknesses, immunities, or absorptions.</li>
</ul>

<h3>NPCs</h3>
<p>Non-player characters use a simplified sheet for allies, townspeople, and other characters the party interacts with:</p>
<ul>
  <li><strong>Full Stats</strong> — All 8 core stats with derived values, HP, and MP.</li>
  <li><strong>Lineage &amp; Occupation</strong> — Descriptive fields for the character.</li>
  <li><strong>Rank</strong> — General power level (F through S).</li>
  <li><strong>Disposition</strong> — Friendly, Neutral, Hostile, or Unknown — indicating their default attitude toward the party.</li>
  <li><strong>Movement Modes</strong> — Walk, fly, swim, climb, burrow, teleport.</li>
  <li><strong>GM Notes</strong> — Private notes for the GM's reference.</li>
</ul>

<h3>Merchants</h3>
<p>Merchant actors represent shops and traders:</p>
<ul>
  <li><strong>Shop Name &amp; Location</strong> — Flavor text identifying the shop.</li>
  <li><strong>Inventory</strong> — A catalog of items for sale with prices and stock levels. Stock of -1 means unlimited supply.</li>
  <li><strong>Buy Rate</strong> — The percentage of an item's value the merchant will pay when buying from the party (e.g., 0.5 = 50%).</li>
  <li><strong>Restock Interval</strong> — How often inventory replenishes: Daily, Weekly, Manual, or None.</li>
</ul>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 19 — FORMULAS
  // ═══════════════════════════════════════════
  {
    name: "Formula Reference",
    sort: 1900000,
    text: {
      content: `
<h2>Formula Reference</h2>
<p>Many skill and effect values in Shards of Mana use <strong>formulas</strong> that dynamically resolve based on context. Formulas appear in skill damage, pip costs, MP costs, and Active Effect values.</p>

<h3>Available Variables</h3>
<table>
  <thead><tr><th>Variable</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>SL</code></td><td>Skill Level (1-10)</td></tr>
    <tr><td><code>RANK</code></td><td>Adventurer rank as a number (F=1, E=2, D=3, C=4, B=5, A=6, S=7)</td></tr>
    <tr><td><code>LVL</code></td><td>Character level</td></tr>
    <tr><td><code>STR</code></td><td>Strength total</td></tr>
    <tr><td><code>AGI</code></td><td>Agility total</td></tr>
    <tr><td><code>VIT</code></td><td>Vitality total</td></tr>
    <tr><td><code>MAG</code></td><td>Magic total</td></tr>
    <tr><td><code>SPI</code></td><td>Spirit total</td></tr>
    <tr><td><code>PER</code></td><td>Perception total</td></tr>
    <tr><td><code>LCK</code></td><td>Luck total</td></tr>
    <tr><td><code>CHM</code></td><td>Charm total</td></tr>
  </tbody>
</table>

<h3>Operators</h3>
<p><code>+</code>, <code>-</code>, <code>*</code>, <code>/</code>, <code>&gt;=</code>, <code>&lt;=</code>, <code>&gt;</code>, <code>&lt;</code>, <code>==</code>, <code>!=</code>, <code>? :</code> (ternary)</p>

<h3>Functions</h3>
<p><code>ceil()</code>, <code>floor()</code>, <code>min()</code>, <code>max()</code>, <code>abs()</code>, <code>round()</code></p>

<h3>Examples</h3>
<table>
  <thead><tr><th>Formula</th><th>Meaning</th></tr></thead>
  <tbody>
    <tr><td><code>SL * 3 + 10</code></td><td>Damage scales with skill level: 13 at SL1, 40 at SL10.</td></tr>
    <tr><td><code>SL &gt;= 5 ? 2 : 1</code></td><td>Costs 1 pip below SL5, 2 pips at SL5+.</td></tr>
    <tr><td><code>floor(MAG / 2) + SL</code></td><td>Healing scales with both Magic and Skill Level.</td></tr>
    <tr><td><code>max(SL * 2, 10)</code></td><td>At least 10 damage, scaling with SL.</td></tr>
  </tbody>
</table>

<p>In skill descriptions, formulas are written in double brackets: <code>[[SL * 3 + 10]]</code>. These resolve to their calculated value when viewed on a character sheet, styled like inline dice rolls.</p>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 20 — ACTIVE EFFECTS
  // ═══════════════════════════════════════════
  {
    name: "Active Effects",
    sort: 2000000,
    text: {
      content: `
<h2>Active Effects</h2>
<p>Active Effects are the mechanical backbone for buffs, debuffs, and equipment bonuses. They modify stats, derived values, and flags on actors and items.</p>

<h3>How Effects Work</h3>
<p>Active Effects apply <strong>changes</strong> — each change targets a specific data path (e.g., <code>system.stats.str.bonus</code>) with a value and a mode:</p>

<table>
  <thead><tr><th>Mode</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><strong>Add</strong></td><td>Adds the value to the current value. Most common for stat bonuses.</td></tr>
    <tr><td><strong>Override</strong></td><td>Sets the value directly, replacing whatever was there.</td></tr>
    <tr><td><strong>Multiply</strong></td><td>Multiplies the current value.</td></tr>
    <tr><td><strong>Upgrade</strong></td><td>Sets to the higher of the current value and the new value.</td></tr>
    <tr><td><strong>Downgrade</strong></td><td>Sets to the lower of the current value and the new value.</td></tr>
  </tbody>
</table>

<h3>Modern Transfer Mode</h3>
<p>Shards of Mana uses Foundry's <strong>modern effect mode</strong>. Active Effects stay on their parent item — they are not copied to the actor. Effects on equipped items are active; effects on unequipped items are inactive. This means unequipping an item automatically removes its bonuses.</p>

<h3>Effect Creator</h3>
<p>The <strong>Effect Creator</strong> (accessible from the Codex Hub) provides a user-friendly interface for building Active Effects with preset categories: Stats, Derived Stats, Conditions, Element Resistances, Flags (like Mighty Grip), and custom changes.</p>

<h3>Duration</h3>
<p>Effects can have a duration in rounds. At the start of each turn, effects with 0 remaining duration are automatically removed. Permanent effects (no duration) persist until manually removed.</p>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 21 — MOVEMENT MODES
  // ═══════════════════════════════════════════
  {
    name: "Movement Modes",
    sort: 2100000,
    text: {
      content: `
<h2>Movement Modes</h2>
<p>Characters can possess different modes of movement, each enabling them to traverse specific types of terrain:</p>

<table>
  <thead><tr><th>Mode</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><strong>Walk</strong></td><td>Standard ground movement. All adventurers have this by default.</td></tr>
    <tr><td><strong>Fly</strong></td><td>Aerial movement. Can cross gaps, avoid ground hazards.</td></tr>
    <tr><td><strong>Swim</strong></td><td>Aquatic movement. Can traverse water without penalty.</td></tr>
    <tr><td><strong>Climb</strong></td><td>Vertical movement. Can scale walls and cliffs.</td></tr>
    <tr><td><strong>Burrow</strong></td><td>Underground movement. Can tunnel beneath the surface.</td></tr>
    <tr><td><strong>Teleport</strong></td><td>Instantaneous translocation. Ignores all terrain.</td></tr>
  </tbody>
</table>

<p>Movement modes are displayed on the adventurer, monster, and NPC combat tabs. They are primarily used for GM adjudication of what a character can or cannot traverse, rather than having hard-coded mechanical rules.</p>
`
    }
  },

  // ═══════════════════════════════════════════
  // PAGE 22 — QUICK REFERENCE
  // ═══════════════════════════════════════════
  {
    name: "Quick Reference",
    sort: 2200000,
    text: {
      content: `
<h2>Quick Reference</h2>

<h3>Combat Turn Checklist</h3>
<ol>
  <li>Pips restored to maximum</li>
  <li>Death save (if Downed)</li>
  <li>Poison / Burn damage (DoT)</li>
  <li>Regen HP / Refresh MP (HoT)</li>
  <li>Expired effects removed</li>
  <li>Take actions (spend pips)</li>
  <li>Move (up to MOV squares, free)</li>
</ol>

<h3>Attack Flow</h3>
<ol>
  <li>Choose skill or basic attack</li>
  <li>Select target(s)</li>
  <li>Pay pip &amp; MP costs</li>
  <li>Roll d100 vs Hit Target (attacker hit - target evasion)</li>
  <li>96-100 always misses</li>
  <li>&le; Crit threshold = Critical Hit (1.5&times; damage)</li>
  <li>&le; Hit target = Hit</li>
  <li>Calculate damage: formula + stat &rarr; crit &rarr; resistance &rarr; defense</li>
  <li>Roll condition infliction (if applicable)</li>
</ol>

<h3>Damage Formula Summary</h3>
<p><code>Final = max( floor(floor(BaseDmg &times; CritMult) &times; ElemResist / 100) - Defense, 0 )</code></p>

<h3>Key Thresholds</h3>
<table>
  <thead><tr><th>Mechanic</th><th>Value</th></tr></thead>
  <tbody>
    <tr><td>Auto-miss range</td><td>96-100 on d100</td></tr>
    <tr><td>XP per level</td><td>500</td></tr>
    <tr><td>Max level</td><td>No cap</td></tr>
    <tr><td>Growth rate pool</td><td>200%</td></tr>
    <tr><td>Starting stat pool</td><td>40 points (base 10 each)</td></tr>
    <tr><td>Starting gold</td><td>250</td></tr>
    <tr><td>Death counts</td><td>3</td></tr>
    <tr><td>Bond heart XP cost</td><td>150 per rank</td></tr>
    <tr><td>Max bond hearts</td><td>5</td></tr>
    <tr><td>Max skill level</td><td>10</td></tr>
    <tr><td>Skill XP (1&rarr;10)</td><td>1,300 total</td></tr>
    <tr><td>Base MOV</td><td>4 squares</td></tr>
    <tr><td>Crit multiplier</td><td>1.5&times;</td></tr>
  </tbody>
</table>

<h3>Foundry Controls</h3>
<table>
  <thead><tr><th>Action</th><th>How</th></tr></thead>
  <tbody>
    <tr><td>Open Codex Hub</td><td>System Settings &rarr; Mana's Codex (GM only)</td></tr>
    <tr><td>Roll stat test</td><td>Click a stat on the character sheet</td></tr>
    <tr><td>Basic weapon attack</td><td>Click the weapon attack button on combat tab</td></tr>
    <tr><td>Use a skill</td><td>Click the skill's use button on combat or skills tab</td></tr>
    <tr><td>Add a bond</td><td>Right-click an actor in the sidebar &rarr; "Add as Bond"</td></tr>
    <tr><td>Level up</td><td>Click the glowing level-up button in sheet header (when XP is sufficient)</td></tr>
    <tr><td>Absorb manacite</td><td>Click "Absorb" on unabsorbed manacite in the Skills tab Manacite Pouch</td></tr>
    <tr><td>Create a party</td><td>Create a new actor with type "Party"</td></tr>
    <tr><td>Start combat</td><td>Add tokens to combat tracker, roll initiative</td></tr>
  </tbody>
</table>

<h3>Macros (game.shards API)</h3>
<p>The following functions are available for macro use:</p>
<ul>
  <li><code>game.shards.rollStatTest(actor, statKey, options)</code> — Roll a stat test</li>
  <li><code>game.shards.rollAttack(actor, skillItem, targets, options)</code> — Roll an attack</li>
  <li><code>game.shards.rollHealing(actor, skillItem, targets, options)</code> — Roll healing</li>
  <li><code>game.shards.rollContest()</code> — Open the contest dialog</li>
  <li><code>game.shards.rollWeaponAttack(actor, targets, options)</code> — Roll a basic weapon attack</li>
  <li><code>game.shards.contestDialog()</code> — Open the contest dialog</li>
</ul>
`
    }
  }
];


/* -------------------------------------------- */
/*  Populate Function                           */
/* -------------------------------------------- */

/**
 * Populate the rules compendium pack with the rulebook journal entry.
 * Only runs for GM, only if the pack is empty.
 */
export async function populateRulebook() {
  if (!game.user.isGM) return;

  const pack = game.packs.get("shards-of-mana.rules");
  if (!pack) {
    console.warn("shards-of-mana | Rules compendium pack not found.");
    return;
  }

  // Check if already populated
  const index = await pack.getIndex();
  if (index.size > 0) return;

  console.log("shards-of-mana | Populating Rulebook compendium...");

  // Unlock the pack for editing
  const wasLocked = pack.locked;
  if (wasLocked) await pack.configure({ locked: false });

  try {
    // Build page data
    const pages = PAGES.map((p, i) => ({
      name: p.name,
      type: "text",
      sort: p.sort,
      text: p.text,
      title: { show: true, level: 1 }
    }));

    // Create the JournalEntry in the pack
    await JournalEntry.create(
      {
        name: "Shards of Mana Rulebook",
        pages
      },
      { pack: "shards-of-mana.rules" }
    );

    console.log("shards-of-mana | Rulebook created successfully!");
    ui.notifications.info("Shards of Mana Rulebook has been created in the Rules compendium.");
  } catch (err) {
    console.error("shards-of-mana | Failed to create Rulebook:", err);
  } finally {
    // Re-lock if it was locked
    if (wasLocked) await pack.configure({ locked: true });
  }
}
