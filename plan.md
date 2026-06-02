# Choice Grants & Extended Effect Types — Implementation Plan

## Overview

Add a **Choice Grant** system to constellation trees (inspired by PF2e's Choice Set rule element) and expand the effect type vocabulary with **Condition on Hit**, **Skill Cost Reduction**, and **Proficiency** as first-class Effect Creator entries.

When a player unlocks a tree node with a choice grant, a selection dialog appears. The GM pre-defines the options in the Constellation Editor. The player picks one, and the corresponding effect is applied. On refund/reset, the choice is removed and re-presented if the node is unlocked again.

---

## Phase 1: Choice Grant Data Model

### 1a. Expand `tree-schema.mjs`

Add `"choice"` to `GRANT_TYPES`:
```js
export const GRANT_TYPES = ["skill", "activeEffect", "proficiency", "job", "choice"];
```

Add choice-specific fields inside the `grants` SchemaField:
```js
// Choice grant category
choiceCategory: new StringField({
  blank: true, initial: "",
  choices: ["", "proficiency", "growthRate", "element", "skill"]
}),

// Array of choice options — each option is a self-contained mini-grant
choiceOptions: new ArrayField(new SchemaField({
  id:    new StringField({ required: true }),
  label: new StringField({ required: true, initial: "" }),
  icon:  new StringField({ blank: true, initial: "" }),
  // Type-specific payload (only one populated per option):
  proficiencyType: new StringField({ blank: true, initial: "" }),  // "weapon" | "armor"
  proficiencyKey:  new StringField({ blank: true, initial: "" }),  // e.g. "longBlades"
  growthRateStat:  new StringField({ blank: true, initial: "" }),  // e.g. "str"
  growthRateValue: new NumberField({ integer: true, initial: 5 }), // e.g. +5%
  elementKey:      new StringField({ blank: true, initial: "" }),  // e.g. "fire"
  elementTier:     new NumberField({ integer: true, initial: 1 }), // 1=Resist, 2=Immune, etc.
  skillUuid:       new StringField({ blank: true, initial: "" })   // compendium UUID
}), { initial: [] })
```

### 1b. Expand `treeProgress` schema

Add `nodeChoices` to `createTreeProgressSchema()`:
```js
nodeChoices: new ArrayField(new SchemaField({
  nodeId:   new StringField({ required: true }),
  choiceId: new StringField({ required: true })
}), { initial: [] })
```

This tracks which option the player selected per choice node, enabling cleanup and re-prompting.

---

## Phase 2: Choice Grant Application & Removal (`tree-grants.mjs`)

### 2a. New `applyChoiceGrant()` function

Called when a choice node is unlocked. Receives the player's selected option and applies the appropriate grant:

- **proficiency** → Creates AE with `system.flags.treeProficiency.{type}.{key}` (OVERRIDE "1")
- **growthRate** → Creates AE with `system.growthRates.{stat}` (ADD value)
- **element** → Creates AE with `system.elementResistances.{elem}` (OVERRIDE tier)
- **skill** → Embeds skill item from UUID (same as existing skill grant)

All created documents get the same `treeGrant` flag tag, so `removeNodeGrant()` works unchanged.

### 2b. Update `applyNodeGrant()` switch

Add a `case "choice"` that:
1. Does NOT auto-apply (returns a signal that a choice is needed)
2. The caller (tree dialog) detects this and opens the Choice Dialog instead

### 2c. Update `removeNodeGrant()`

No changes needed — the flag-based cleanup already handles any documents tagged with the node ID. But we DO need to clear the `nodeChoices` entry from the actor's tree progress when a choice node is refunded/reset.

---

## Phase 3: Choice Dialog (`module/apps/choice-dialog.mjs`)

A new ApplicationV2 dialog that presents the player's options.

### UI Design
```
╔══════════════════════════════════════╗
║  🔮 Choose: Weapon Proficiency       ║
╠══════════════════════════════════════╣
║                                      ║
║  ┌──────┐  Long Blades               ║
║  │ icon │  Swords, rapiers, katanas   ║
║  └──────┘                             ║
║                                      ║
║  ┌──────┐  Short Blades              ║
║  │ icon │  Daggers, knives            ║
║  └──────┘                             ║
║                                      ║
║  ┌──────┐  Polearms                  ║
║  │ icon │  Spears, halberds           ║
║  └──────┘                             ║
║                                      ║
║           [ Confirm ]                 ║
╚══════════════════════════════════════╝
```

- Shows node label + description at top
- Lists all `choiceOptions` as selectable cards (radio-style, one at a time)
- Selected option highlighted with crystal glow border
- Confirm button applies the choice
- Closing without choosing cancels the node unlock (refunds SP)

### Implementation
- `HandlebarsApplicationMixin(ApplicationV2)` with a single HBS template
- Returns a `Promise<string|null>` (the chosen option ID, or null if cancelled)
- Static `async ShardsChoiceDialog.prompt(node, actor)` convenience method

---

## Phase 4: Tree Dialog Integration (`tree-dialog.mjs`)

### 4a. Update `#unlockNode()`

After the SP confirmation dialog but **before** calling `applyNodeGrant()`:

```js
if (node.grants?.type === "choice") {
  const choiceId = await ShardsChoiceDialog.prompt(node, this.actor);
  if (!choiceId) return; // cancelled — don't spend SP
  // Store choice in progress
  entry.nodeChoices = [...(entry.nodeChoices ?? []), { nodeId: node.id, choiceId }];
  // Apply the specific chosen grant
  await applyChoiceGrant(actor, treeItemId, node, choiceId);
} else {
  await applyNodeGrant(actor, treeItemId, node);
}
```

### 4b. Update `#refundNode()` and `#resetTree()`

After removing grants, also clear the corresponding `nodeChoices` entries from progress.

---

## Phase 5: Constellation Editor — Choice Grant UI

### 5a. New grant type option in panel

When GM selects grant type "Choice", show:

1. **Category dropdown**: Proficiency / Growth Rate / Element / Skill
2. **Options list**: Dynamic rows based on category
   - **Proficiency**: dropdown of weapon groups + armor categories (from `CONFIG.SHARDS`)
   - **Growth Rate**: dropdown of stats + value input (e.g., STR +5%)
   - **Element**: dropdown of elements + tier selector (Resist/Immune/Absorb)
   - **Skill**: UUID input (drag from compendium, same as skill grant)
3. **Add/Remove** buttons for each option row

### 5b. Grant Summary for choice nodes

Shows: "Choice: Weapon Proficiency (3 options)" with the category icon.

---

## Phase 6: New Effect Types in Effect Creator

### 6a. Condition on Hit

**Data storage**: AE flag `system.flags.conditionOnHit.{condition}` with value = chance% (e.g., `"25"` for 25%).

**Effect Creator UI**: New section "Condition on Hit" — dropdown for condition + percentage input.

**Roll integration** (`rolls.mjs`): After a successful attack, check attacker's `conditionOnHit` flags. For each, roll d100 vs chance. If hit, apply condition to target (respecting condition immunity).

### 6b. Skill Cost Reduction

**Data storage**: AE flags:
- `system.flags.skillCostReduction.mp` — flat MP reduction (min 0)
- `system.flags.skillCostReduction.pips` — flat pip reduction (min 0)

**Effect Creator UI**: New row in Effect Builder — "Skill Cost Reduction" target group with MP/Pips sub-targets.

**Roll integration** (`rolls.mjs`): When computing resource cost before a skill use, subtract these values (floor at 0).

### 6c. Proficiency Grant in Effect Creator

**Already works** via AE key `system.flags.treeProficiency.{type}.{key}`, but the UI doesn't expose it. Add a "Proficiency" section to the Effect Creator with weapon group / armor category dropdowns (same as constellation editor proficiency grant).

### 6d. Flat Bonus (% support)

The Effect Builder already supports MULTIPLY mode, but the UI defaults to ADD and doesn't clearly indicate percentage. Add a "Percentage" toggle that:
- Sets mode to MULTIPLY (mode 1)
- Displays the value as "%" in the preview
- The existing code already handles MULTIPLY in `prepareDerivedData()`

---

## Phase 7: Localization & Polish

- Add `SHARDS.Choice.*` keys for dialog labels, category names, confirm/cancel buttons
- Add `SHARDS.EffectCreator.ConditionOnHit`, `SHARDS.EffectCreator.SkillCostReduction`, `SHARDS.EffectCreator.Proficiency`
- Style the Choice Dialog with crystal theme (matching existing tree dialog)
- Add `app-choice-dialog.css`

---

## Files Modified

| File | Changes |
|------|---------|
| `module/data/tree-schema.mjs` | Add `"choice"` grant type, choice fields on grants, `nodeChoices` on progress |
| `module/helpers/tree-grants.mjs` | Add `applyChoiceGrant()`, update `applyNodeGrant()` for choice type |
| `module/apps/choice-dialog.mjs` | **NEW** — Player choice selection dialog |
| `templates/apps/choice-dialog.hbs` | **NEW** — Choice dialog template |
| `module/apps/tree-dialog.mjs` | Integrate choice flow into unlock/refund/reset |
| `module/apps/constellation-editor.mjs` | Choice grant editing UI in property panel |
| `module/apps/effect-creator.mjs` | Add Condition on Hit, Skill Cost Reduction, Proficiency sections |
| `templates/apps/effect-creator.hbs` | New sections for new effect types |
| `module/helpers/effect-targets.mjs` | Add conditionOnHit, skillCostReduction, proficiency target groups |
| `module/helpers/rolls.mjs` | Check conditionOnHit flags post-attack, skill cost reduction pre-use |
| `module/helpers/config.mjs` | Add `SHARDS.choiceCategories` config |
| `styles/app-choice-dialog.css` | **NEW** — Choice dialog styling |
| `styles/app-constellation-editor.css` | Choice option rows styling |
| `lang/en.json` | New localization keys |
| `system.json` | Register new CSS file |

---

## Implementation Order

1. **Phase 1** — Schema changes (data model foundation)
2. **Phase 2** — Grant application logic
3. **Phase 3** — Choice Dialog app
4. **Phase 4** — Tree Dialog integration (testable end-to-end)
5. **Phase 5** — Constellation Editor UI (GM can define choices)
6. **Phase 6** — New effect types (independent of choice system)
7. **Phase 7** — Localization & polish
