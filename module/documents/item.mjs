import { rollAttack, rollSkill, postConsumableCard } from "../helpers/dice.mjs";
import { renderDescriptionHTML } from "../helpers/prose.mjs";

/**
 * Extends the base Item with Project: Anime behaviour: roll data and a
 * type-aware `roll()` (weapons/shields attack, techniques resolve, others post a card).
 */
export class ProjectAnimeItem extends Item {
  /** @override */
  getRollData() {
    const data = { ...this.system };
    if (this.actor) data.actor = this.actor.getRollData();
    return data;
  }

  /**
   * Roll or use this item.
   * @param {object} [options]
   * @param {Event}  [options.event]  Originating event (Shift skips roll dialogs).
   */
  async roll(options = {}) {
    if (this.actor) {
      if (this.type === "weapon" || this.type === "shield") return rollAttack(this.actor, this, options);
      if (this.type === "skill") return rollSkill(this.actor, this, options);
      if (this.type === "consumable") return postConsumableCard(this.actor, this);
    }
    return this.#postDescriptionCard();
  }

  /** Post this item's identity + description card to chat — the read-only "show it" action, never
   *  an attack/technique roll. Consumables keep their ▶ Use card so it can still be consumed. */
  async toChat() {
    if (this.actor && this.type === "consumable") return postConsumableCard(this.actor, this);
    return this.#postDescriptionCard();
  }

  /** Post a simple identity + description card to chat. */
  async #postDescriptionCard() {
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const typeLabel = game.i18n.localize(`TYPES.Item.${this.type}`);
    // Render the Codex-prose description (legacy HTML passes through) — helpers/prose.
    const enriched = await renderDescriptionHTML(this);
    const iconHTML = this.img ? `<img class="card-icon" src="${this.img}" alt="" />` : "";
    const descHTML = enriched ? `<div class="card-desc">${enriched}</div>` : "";
    const content = `<div class="project-anime chat-card">
      <header class="card-header">
        ${iconHTML}
        <div class="card-titles">
          <h3 class="card-title">${this.name}</h3>
          <span class="card-type">${typeLabel}</span>
        </div>
      </header>
      ${descHTML}
    </div>`;
    return ChatMessage.create({ speaker, content });
  }
}
