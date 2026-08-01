const { HandlebarsApplicationMixin } = foundry.applications.api;

/* Shared sheet chrome: the View | Edit toggle in the window title bar.
   Mode is per-user display state, never stored on the document. */
export default function ProjectAnimeSheet(Base) {
  return class extends HandlebarsApplicationMixin(Base) {
    static DEFAULT_OPTIONS = {
      classes: ["project-anime", "sheet"],
      window: { resizable: true },
      form: { submitOnChange: true, closeOnSubmit: false },
      actions: {
        setMode: this.#onSetMode
      }
    };

    #mode = "view";

    get isEditMode() {
      return this.#mode === "edit" && this.isEditable;
    }

    async _renderFrame(options) {
      const frame = await super._renderFrame(options);
      if (this.isEditable) {
        const toggle = document.createElement("div");
        toggle.className = "modetoggle";
        for (const [mode, key] of [["view", "PROJECTANIME.Mode.View"], ["edit", "PROJECTANIME.Mode.Edit"]]) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.action = "setMode";
          button.dataset.mode = mode;
          button.textContent = game.i18n.localize(key);
          toggle.append(button);
        }
        this.window.title.after(toggle);
      }
      return frame;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this.#syncModeToggle();
    }

    #syncModeToggle() {
      for (const button of this.element.querySelectorAll(".modetoggle button")) {
        button.classList.toggle("on", button.dataset.mode === this.#mode);
      }
    }

    static #onSetMode(event, target) {
      const mode = target.dataset.mode === "edit" ? "edit" : "view";
      if (mode === this.#mode) return;
      this.#mode = mode;
      this.#syncModeToggle();
      this.render();
    }
  };
}
