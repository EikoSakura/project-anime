/* Full-screen Combo and Fumble cut-in. Display only: the result rides the
   roll card as a system flag and every client plays the splash when the
   message is created. Waits for Dice So Nice when it is active. */

const HOLD = { combo: 2300, fumble: 2500 };
const EXIT = 320;

export function registerSplash() {
  Hooks.on("createChatMessage", message => {
    const kind = message.getFlag("project-anime", "splash");
    if (!kind) return;
    const faces = message.rolls[0]?.dice.map(d => d.total) ?? [];
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      showSplash(kind, faces, message.alias);
    };
    if (game.modules.get("dice-so-nice")?.active) {
      const hookId = Hooks.on("diceSoNiceRollComplete", id => {
        if (id !== message.id) return;
        Hooks.off("diceSoNiceRollComplete", hookId);
        show();
      });
      setTimeout(() => {
        Hooks.off("diceSoNiceRollComplete", hookId);
        show();
      }, 8000);
    } else show();
  });
  /* A Luck replacement re-reads Combos and Fumbles; the changed splash flag
     arrives with the message update on every client. */
  Hooks.on("updateChatMessage", (message, changes) => {
    const kind = foundry.utils.getProperty(changes, "flags.project-anime.splash");
    if (kind !== "combo" && kind !== "fumble") return;
    const faces = message.getFlag("project-anime", "card")?.faces
      ?? message.rolls[0]?.dice.map(d => d.total) ?? [];
    showSplash(kind, faces, message.alias);
  });
}

export function showSplash(kind, faces, name) {
  document.querySelector(".pa-splash")?.remove();
  const word = game.i18n.localize(`PROJECTANIME.Splash.${kind === "combo" ? "Combo" : "Fumble"}`);
  const el = document.createElement("div");
  el.className = `pa-splash ${kind}`;
  el.innerHTML = `
    <div class="dim"></div>
    <div class="lines"></div>
    <div class="band">
      <div class="inner">
        <div class="faces">${faces.map(f => `<span class="face">${f}</span>`).join("")}</div>
        <div class="word">${word}</div>
        <div class="who"></div>
      </div>
    </div>`;
  el.querySelector(".who").textContent = name;
  const close = () => {
    if (el.classList.contains("closing")) return;
    el.classList.add("closing");
    setTimeout(() => el.remove(), EXIT);
  };
  el.addEventListener("click", close, { once: true });
  setTimeout(close, HOLD[kind]);
  document.body.appendChild(el);
}
