/**
 * Enhanced Combat Tracker for Shards of Mana.
 * Hooks into Foundry's renderCombatTracker to inject HP bars, pip dots,
 * condition badges, and expandable detail panels for each combatant.
 */

import { setLimitBreak } from "../helpers/limit-break.mjs";

/**
 * Enhance the default combat tracker with Shards of Mana combat info.
 * @param {Application} app - The CombatTracker application
 * @param {HTMLElement} html - The application's root HTML element
 */
export function enhanceCombatTracker(app, html) {
  const combat = app.viewed;
  if (!combat) return;

  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor?.system?.health) continue;

    // Find the combatant's row
    const row = html.querySelector(`[data-combatant-id="${combatant.id}"]`);
    if (!row) continue;

    // Skip if already enhanced
    if (row.querySelector(".shards-ct-info")) continue;

    // Inject compact info bar
    const infoBar = _buildCompactBar(actor);
    const controls = row.querySelector(".combatant-controls");
    if (controls) {
      controls.before(infoBar);
    } else {
      row.appendChild(infoBar);
    }

    // Inject expandable detail panel
    const detailPanel = _buildDetailPanel(actor, combatant);
    row.after(detailPanel);

    // Toggle expand on row click (avoid button clicks)
    row.addEventListener("click", (e) => {
      if (e.target.closest("button, a, .combatant-controls, input")) return;
      detailPanel.classList.toggle("expanded");
    });

    // Style the row to indicate expandability
    row.style.cursor = "pointer";
  }
}

/* -------------------------------------------- */
/*  Compact Bar                                  */
/* -------------------------------------------- */

/**
 * Build the compact info bar (HP bar + pip dots + condition badge).
 * @param {Actor} actor
 * @returns {HTMLElement}
 */
function _buildCompactBar(actor) {
  const container = document.createElement("div");
  container.className = "shards-ct-info";

  // HP Bar
  container.appendChild(_buildHpBar(actor.system.health));

  // Pip Dots
  if (actor.system.pips) {
    container.appendChild(_buildPipDots(actor.system.pips));
  }

  // Condition Count Badge
  const condCount = _countActiveConditions(actor);
  if (condCount > 0) {
    const badge = document.createElement("span");
    badge.className = "shards-ct-condition-badge";
    badge.textContent = condCount;
    badge.title = `${condCount} active condition${condCount > 1 ? "s" : ""}`;
    container.appendChild(badge);
  }

  return container;
}

/**
 * Build a thin HP bar.
 * @param {object} health - {value, max}
 * @returns {HTMLElement}
 */
function _buildHpBar(health) {
  const container = document.createElement("div");
  container.className = "shards-ct-hp-bar";

  const fill = document.createElement("div");
  fill.className = "shards-ct-hp-fill";

  const pct = health.max > 0 ? Math.clamp(health.value / health.max, 0, 1) * 100 : 0;
  fill.style.width = `${pct}%`;

  // Color coding
  if (pct > 50) fill.classList.add("shards-ct-hp-fill--high");
  else if (pct > 25) fill.classList.add("shards-ct-hp-fill--mid");
  else fill.classList.add("shards-ct-hp-fill--low");

  fill.title = `HP: ${health.value} / ${health.max}`;
  container.appendChild(fill);
  container.title = `HP: ${health.value} / ${health.max}`;
  return container;
}

/**
 * Build pip dots display.
 * @param {object} pips - {value, max}
 * @returns {HTMLElement}
 */
function _buildPipDots(pips) {
  const container = document.createElement("span");
  container.className = "shards-ct-pips";
  container.title = `Pips: ${pips.value} / ${pips.max}`;

  for (let i = 0; i < pips.max; i++) {
    const dot = document.createElement("span");
    dot.className = `shards-ct-pip${i < pips.value ? " shards-ct-pip--filled" : ""}`;
    container.appendChild(dot);
  }
  return container;
}

/* -------------------------------------------- */
/*  Expanded Detail Panel                        */
/* -------------------------------------------- */

/**
 * Build the expandable detail panel.
 * @param {Actor} actor
 * @param {Combatant} combatant
 * @returns {HTMLElement}
 */
function _buildDetailPanel(actor, combatant) {
  const panel = document.createElement("div");
  panel.className = "shards-ct-detail";

  const inner = document.createElement("div");
  inner.className = "shards-ct-detail__inner";

  // MP Bar
  if (actor.system.mana) {
    inner.appendChild(_buildResourceBar("MP", actor.system.mana, "shards-ct-mp-bar"));
  }

  // Limit Break Gauge (adventurers only)
  if (actor.type === "adventurer" && actor.system.limitBreak) {
    const lbSection = _buildLimitBreakSection(actor);
    inner.appendChild(lbSection);
  }

  // Movement
  const mov = actor.system.mov ?? 0;
  const moved = combatant.distanceMoved ?? 0;
  const movDiv = document.createElement("div");
  movDiv.className = "shards-ct-mov";
  movDiv.innerHTML = `<i class="fa-solid fa-shoe-prints"></i> MOV: ${mov - moved} / ${mov}`;
  inner.appendChild(movDiv);

  // Death Counts (if adventurer and downed)
  if (actor.type === "adventurer" && actor.system.conditions.downed > 0) {
    const dcDiv = document.createElement("div");
    dcDiv.className = "shards-ct-death-counts";
    dcDiv.innerHTML = `<i class="fa-solid fa-skull"></i> Death Counts: ${actor.system.deathCounts.value} / ${actor.system.deathCounts.max}`;
    inner.appendChild(dcDiv);
  }

  // Active Conditions
  const condList = _buildConditionList(actor);
  if (condList.children.length > 0) {
    inner.appendChild(condList);
  }

  // Quick Actions
  const actions = document.createElement("div");
  actions.className = "shards-ct-actions";

  // End Turn button
  if (game.combat?.current?.combatantId === combatant.id) {
    const endBtn = document.createElement("button");
    endBtn.type = "button";
    endBtn.className = "shards-ct-action-btn";
    endBtn.innerHTML = '<i class="fa-solid fa-forward-step"></i> End Turn';
    endBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await game.combat.nextTurn();
    });
    actions.appendChild(endBtn);
  }

  if (actions.children.length) inner.appendChild(actions);

  panel.appendChild(inner);
  return panel;
}

/**
 * Build a generic resource bar (MP, etc).
 * @param {string} label
 * @param {object} resource - {value, max}
 * @param {string} className
 * @returns {HTMLElement}
 */
function _buildResourceBar(label, resource, className) {
  const container = document.createElement("div");
  container.className = `shards-ct-resource-bar ${className}`;

  const labelEl = document.createElement("span");
  labelEl.className = "shards-ct-resource-label";
  labelEl.textContent = `${label}: ${resource.value} / ${resource.max}`;
  container.appendChild(labelEl);

  const barOuter = document.createElement("div");
  barOuter.className = "shards-ct-bar-outer";

  const barFill = document.createElement("div");
  barFill.className = "shards-ct-bar-fill";
  const pct = resource.max > 0 ? Math.clamp(resource.value / resource.max, 0, 1) * 100 : 0;
  barFill.style.width = `${pct}%`;

  barOuter.appendChild(barFill);
  container.appendChild(barOuter);
  return container;
}

/**
 * Build the Limit Break gauge section with GM adjustment buttons.
 * @param {Actor} actor
 * @returns {HTMLElement}
 */
function _buildLimitBreakSection(actor) {
  const lb = actor.system.limitBreak;
  const container = document.createElement("div");
  container.className = "shards-ct-lb-section";

  const labelRow = document.createElement("div");
  labelRow.className = "shards-ct-lb-header";

  const label = document.createElement("span");
  label.className = "shards-ct-resource-label";
  label.textContent = `LB: ${lb.value}%`;
  labelRow.appendChild(label);

  // GM adjustment buttons
  if (game.user.isGM) {
    const minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "shards-ct-lb-adjust";
    minusBtn.textContent = "-10";
    minusBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await setLimitBreak(actor, lb.value - 10);
    });

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "shards-ct-lb-adjust";
    plusBtn.textContent = "+10";
    plusBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await setLimitBreak(actor, lb.value + 10);
    });

    const maxBtn = document.createElement("button");
    maxBtn.type = "button";
    maxBtn.className = "shards-ct-lb-adjust shards-ct-lb-adjust--max";
    maxBtn.textContent = "MAX";
    maxBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await setLimitBreak(actor, 100);
    });

    labelRow.appendChild(minusBtn);
    labelRow.appendChild(plusBtn);
    labelRow.appendChild(maxBtn);
  }

  container.appendChild(labelRow);

  // Gauge bar
  const barOuter = document.createElement("div");
  barOuter.className = "shards-ct-bar-outer shards-ct-lb-gauge";

  const barFill = document.createElement("div");
  barFill.className = "shards-ct-bar-fill shards-ct-lb-fill";
  barFill.style.width = `${Math.clamp(lb.value, 0, 100)}%`;

  if (lb.value >= 100) {
    barFill.classList.add("shards-ct-lb-ready");
  }

  barOuter.appendChild(barFill);
  container.appendChild(barOuter);
  return container;
}

/**
 * Build the condition list for the expanded panel.
 * @param {Actor} actor
 * @returns {HTMLElement}
 */
function _buildConditionList(actor) {
  const container = document.createElement("div");
  container.className = "shards-ct-conditions";

  const conditions = actor.system.conditions;
  if (!conditions) return container;

  for (const [key, value] of Object.entries(conditions)) {
    if (value <= 0) continue;

    const chip = document.createElement("span");
    chip.className = "shards-ct-condition-chip";

    const effectDef = CONFIG.statusEffects.find(e => e.id === key);
    if (effectDef?.img) {
      const icon = document.createElement("img");
      icon.src = effectDef.img;
      icon.width = 16;
      icon.height = 16;
      chip.appendChild(icon);
    }

    const label = document.createElement("span");
    const condLabel = CONFIG.SHARDS?.conditions?.[key];
    label.textContent = condLabel ? game.i18n.localize(condLabel) : key;
    chip.appendChild(label);

    // Show magnitude for all stacked conditions
    if (value > 1) {
      const mag = document.createElement("span");
      mag.className = "shards-ct-condition-mag";
      mag.textContent = `×${value}`;
      chip.appendChild(mag);
    }

    container.appendChild(chip);
  }

  return container;
}

/**
 * Count active conditions on an actor.
 * @param {Actor} actor
 * @returns {number}
 */
function _countActiveConditions(actor) {
  const conditions = actor.system.conditions;
  if (!conditions) return 0;
  let count = 0;
  for (const value of Object.values(conditions)) {
    if (value > 0) count++;
  }
  return count;
}
