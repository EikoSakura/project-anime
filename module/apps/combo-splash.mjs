/**
 * Project: Anime — Combo Splash.
 *
 * When someone scores a Combo (two matching attribute dice ≥ 6), this flashes a brief,
 * cinematic full-screen overlay — a burst of gold "speed lines", the rolling character's
 * portrait, and a big "COMBO!" — then fades itself away. It is purely celebratory: a
 * transient, non-interactive overlay (pointer-events: none), so it never blocks play.
 *
 * It is ON by default; a GM can turn the whole feature off (world setting), and each player
 * can additionally silence it just for themselves (client setting — handy for motion
 * sensitivity). The splash plays on EVERY connected client, driven by a flag the dice engine
 * stamps on the Combo's chat card: that card broadcasts to all clients, so the table shares
 * the moment (see the `createChatMessage` hook in project-anime.mjs).
 *
 * Self-contained, like the rich tooltip: it carries the `theme-dark` palette so its gold/ink
 * read the same dramatic way over any scene, light or dark. Honors `prefers-reduced-motion`
 * (the CSS drops the movement to a plain fade).
 */

export const COMBO_SPLASH_SETTING = "showComboSplash";
export const COMBO_SPLASH_CLIENT_SETTING = "comboSplashClientShow";

export class ComboSplash {
  /** The overlay currently on screen (null when nothing is showing). */
  static #el = null;

  /** Safety timer that removes the overlay if its CSS animation never reports an end. */
  static #timer = null;

  /** Whether the GM has enabled the feature (world setting). */
  static get enabled() {
    return game.settings.get("project-anime", COMBO_SPLASH_SETTING);
  }

  /** Whether the splash should play for THIS user: the world feature is on AND the user
   *  hasn't silenced it for themselves (client setting). */
  static get clientEnabled() {
    return this.enabled && game.settings.get("project-anime", COMBO_SPLASH_CLIENT_SETTING);
  }

  /**
   * Flash the splash for a scored Combo. No-op when the feature is off for this user.
   * @param {object} [combo]
   * @param {string} [combo.name]  The rolling character's name (shown under the word).
   * @param {string} [combo.img]   The character's portrait path (shown beside the word).
   */
  static flash({ name = "", img = "" } = {}) {
    if (!this.clientEnabled) return;
    this.#clear(); // a fresh Combo replaces any splash still fading out

    // Built from DOM nodes with textContent for the dynamic strings — never innerHTML —
    // so an actor name can't inject markup. `theme-dark` pulls the brighter gold palette.
    const el = document.createElement("aside");
    el.className = "project-anime theme-dark combo-splash";
    el.setAttribute("aria-hidden", "true");

    const burst = document.createElement("div");
    burst.className = "cs-burst";

    const stage = document.createElement("div");
    stage.className = "cs-stage";

    if (img) {
      const portrait = document.createElement("div");
      portrait.className = "cs-portrait";
      const im = document.createElement("img");
      im.src = img;
      im.alt = "";
      portrait.appendChild(im);
      stage.appendChild(portrait);
    }

    const text = document.createElement("div");
    text.className = "cs-text";
    const word = document.createElement("div");
    word.className = "cs-word";
    word.textContent = game.i18n.localize("PROJECTANIME.ComboSplash.word");
    text.appendChild(word);
    if (name) {
      const sub = document.createElement("div");
      sub.className = "cs-name";
      sub.textContent = game.i18n.format("PROJECTANIME.ComboSplash.scored", { name });
      text.appendChild(sub);
    }
    stage.appendChild(text);

    el.append(burst, stage);
    document.body.appendChild(el);
    this.#el = el;

    // The container's own master animation (fade in → hold → fade out) is the longest, so its
    // end is the cue to remove the overlay. Child animationend events bubble up, so guard on
    // the target. A timeout backstops the case where animations are disabled entirely.
    el.addEventListener("animationend", (event) => {
      if (event.target === el) this.#dismiss(el);
    });
    this.#timer = setTimeout(() => this.#dismiss(el), 3500);
  }

  /** Remove a specific overlay and clear the safety timer (if it's still the active one). */
  static #dismiss(el) {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
    el?.remove();
    if (this.#el === el) this.#el = null;
  }

  /** Tear down any overlay currently showing. */
  static #clear() {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
    if (this.#el) { this.#el.remove(); this.#el = null; }
  }
}
