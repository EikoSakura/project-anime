/**
 * Custom dropdown enhancement for <select> elements.
 *
 * The native <select> popup can't be reliably themed dark (Chromium paints the
 * selected row white in dark `color-scheme`, and custom properties don't cascade
 * into the native popup). So we keep the real <select> in the DOM as the source
 * of truth — hidden — and render a fully styled purple menu beside it. The menu
 * is a `popover`, which renders in the top layer and therefore escapes the
 * sheet's `overflow` clipping. Selecting an option sets the native select's
 * value and dispatches `input`/`change`, so form binding & submitOnChange
 * keep working.
 *
 * Falls back to the native control wherever the popover API is unavailable.
 */

const SUPPORTS_POPOVER =
  typeof HTMLElement !== "undefined" &&
  Object.prototype.hasOwnProperty.call(HTMLElement.prototype, "popover");

let _seq = 0;

/** Enhance every eligible <select> within `root`. Safe to call on each render. */
export function enhanceSelects(root) {
  if (!root || !SUPPORTS_POPOVER) return;
  for (const select of root.querySelectorAll("select:not([multiple]):not([data-pa-enhanced])")) {
    try {
      enhanceOne(select);
    } catch (err) {
      console.error("Project: Anime | select enhancement failed", err, select);
    }
  }
}

function enhanceOne(select) {
  if (!select.options.length) return;
  select.dataset.paEnhanced = "true";

  // Wrapper inserted in the select's place; the select moves inside it (hidden).
  const wrap = document.createElement("div");
  wrap.className = "pa-select";
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.classList.add("pa-select-native");

  // Trigger button (shows the current label).
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pa-select-button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  const label = document.createElement("span");
  label.className = "pa-select-label";
  const arrow = document.createElement("i");
  arrow.className = "pa-select-arrow fas fa-chevron-down";
  button.append(label, arrow);

  // Popover menu (top layer → not clipped by sheet overflow).
  const menu = document.createElement("div");
  menu.className = "pa-select-menu";
  menu.setAttribute("popover", "auto");
  menu.setAttribute("role", "listbox");
  menu.id = `pa-select-${_seq++}`;

  wrap.append(button, menu);

  const buildOptions = () => {
    menu.replaceChildren();
    for (const opt of select.options) {
      const row = document.createElement("div");
      row.className = "pa-select-option";
      row.dataset.value = opt.value;
      row.textContent = opt.textContent;
      if (opt.value === "") row.classList.add("is-empty");
      if (opt.disabled) row.classList.add("is-disabled");
      if (opt.selected) row.classList.add("is-selected");
      row.addEventListener("click", () => {
        if (opt.disabled) return;
        select.value = opt.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        syncLabel();
        menu.hidePopover();
      });
      menu.appendChild(row);
    }
  };

  const syncLabel = () => {
    const opt = select.selectedOptions[0];
    label.textContent = opt ? opt.textContent : "";
    label.classList.toggle("is-empty", !opt || opt.value === "");
    for (const row of menu.children) row.classList.toggle("is-selected", row.dataset.value === select.value);
  };

  const position = () => {
    const r = button.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.inset = "auto";   // override the popover UA stylesheet's inset:0
    menu.style.margin = "0";
    menu.style.minWidth = `${r.width}px`;
    menu.style.left = `${Math.round(r.left)}px`;
    const h = menu.offsetHeight;
    const fitsBelow = r.bottom + 4 + h <= window.innerHeight;
    menu.style.top = `${Math.round(fitsBelow || r.top - h - 4 < 0 ? r.bottom + 4 : r.top - h - 4)}px`;
  };

  // Reposition while open is pointless once the page scrolls under it, so just
  // dismiss on scroll to avoid a detached floating menu.
  const onScroll = () => { if (menu.matches(":popover-open")) menu.hidePopover(); };

  button.addEventListener("click", () => menu.togglePopover());
  menu.addEventListener("toggle", (ev) => {
    const open = ev.newState === "open";
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      position();
      document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    } else {
      document.removeEventListener("scroll", onScroll, { capture: true });
    }
  });

  // Keep the button label in sync if the value changes from elsewhere.
  select.addEventListener("change", syncLabel);

  buildOptions();
  syncLabel();
}
