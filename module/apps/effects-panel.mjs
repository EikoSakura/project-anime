/**
 * Project: Anime — floating Effects Panel (PF2e-style).
 *
 * A frameless, screen-docked widget that lists the live Active Effects on the currently
 * controlled token (or, with nothing selected, the user's assigned character): icon,
 * name, remaining-duration label, and the effect's rule-summary chips. It auto-refreshes
 * whenever something that could change an actor's effects happens (the hooks are wired in
 * project-anime.mjs). Left-click an entry to open its source — the no-code builder for an
 * actor-owned effect, or the parent item's sheet for an item-borne one.
 *
 * It reuses the engine's own "what's live" set (helpers/effects.mjs `liveEffects`) so the
 * panel shows exactly what's affecting the actor: equip- and toggle-gated, never the
 * effects of unequipped gear. The panel hides itself entirely when there's nothing to show.
 */
import { liveEffects, summarizeRules } from "../helpers/effects.mjs";
import { EffectBuilder } from "./effect-builder.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EffectsPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-effects-panel",
    classes: ["project-anime", "effects-panel"],
    // Frameless + unpositioned: render just our content (no window chrome) and anchor it
    // entirely from CSS (position: fixed). Appends to <body> by default.
    window: { frame: false, positioned: false },
    actions: {
      openEffect: EffectsPanel.#onOpenEffect
    }
  };

  static PARTS = {
    list: { template: "systems/project-anime/templates/apps/effects-panel.hbs" }
  };

  /** Debounced re-render — safe to call from many hooks firing at once. */
  refresh = foundry.utils.debounce(this.render.bind(this), 100);

  /** The actor whose effects we display: the controlled token's, else the assigned PC. */
  get actor() {
    return canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? null;
  }

  /** @override */
  async _prepareContext() {
    const actor = this.actor;
    const effects = actor ? EffectsPanel.#collect(actor) : [];
    return { effects, hasEffects: effects.length > 0 };
  }

  /** @override — insert the panel as a flex item immediately BEFORE #sidebar inside #ui-right
   *  (a flexrow: [#ui-right-column-1][#sidebar]). The flex layout then keeps the icon column
   *  tucked against the sidebar and reflows it with the collapse/expand animation — pure CSS,
   *  no measurement → no lag or flicker. Because #ui-right is right-anchored, this grows it
   *  leftward without moving the sidebar. Falls back to #ui-right / <body>. */
  _insertElement(element) {
    const existing = document.getElementById(element.id);
    if (existing) { existing.replaceWith(element); return; }
    const sidebar = document.getElementById("sidebar");
    if (sidebar?.parentElement) sidebar.parentElement.insertBefore(element, sidebar);
    else (document.getElementById("ui-right") ?? document.body).appendChild(element);
  }

  /** @override — hide the whole panel when there's nothing to show. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.classList.toggle("empty", !context.hasEffects);
  }

  /** Map an actor's live effects to icon rows, baking name + remaining duration + rule
   *  summary into a rich `data-tooltip-html` payload (matching the sheet's item tooltips). */
  static #collect(actor) {
    const esc = foundry.utils.escapeHTML;
    return liveEffects(actor).map((e) => {
      const summary = summarizeRules(e);
      const durationLabel = e.isTemporary ? (e.duration?.label ?? "") : "";
      const head = `<div class="pa-tt-head"><img class="pa-tt-img" src="${esc(e.img)}" />`
        + `<div class="pa-tt-heads"><div class="pa-tt-title">${esc(e.name)}</div>`
        + (durationLabel ? `<div class="pa-tt-type">${esc(durationLabel)}</div>` : "")
        + `</div></div>`;
      const chips = summary.length
        ? `<div class="ep-tip-chips">${summary.map((s) => `<span class="ep-tip-chip">${esc(s)}</span>`).join("")}</div>`
        : "";
      const desc = e.description ? `<div class="pa-tt-desc">${e.description}</div>` : "";
      const body = (chips || desc) ? `<div class="pa-tt-body">${chips}${desc}</div>` : "";
      return { uuid: e.uuid, name: e.name, img: e.img, tooltip: head + body };
    });
  }

  /** Left-click an entry → open its source: the builder for an actor-owned effect, or the
   *  parent item's sheet for an item-borne one. */
  static async #onOpenEffect(event, target) {
    const uuid = target.closest("[data-effect-uuid]")?.dataset.effectUuid;
    const effect = uuid ? await fromUuid(uuid) : null;
    if (!effect) return;
    if (effect.parent?.documentName === "Actor") {
      const existing = foundry.applications.instances.get(`pa-effect-builder-${effect.id}`);
      (existing ?? new EffectBuilder(effect)).render(true);
    } else {
      effect.parent?.sheet?.render(true);
    }
  }
}
