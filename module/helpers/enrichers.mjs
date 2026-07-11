/**
 * Project: Anime — inline autocalc text enrichers, registered the PF2e way: one
 * `CONFIG.TextEditor.enrichers` entry whose pattern matches the system's calc tokens
 * (`@talent[Name]`, `@resistance`, `@threshold`, `@damage`, `@energy`, `@range`) and whose
 * enricher swaps each for a freshly-calculated span. Values resolve against
 * `options.relativeTo` — every description render in the system passes the owning item
 * (helpers/prose.mjs renderDescriptionHTML) — so the numbers are live, never frozen text.
 * The sync render path (renderDescriptionBlock) resolves the SAME tokens through the same
 * `inlineCalcHTML`, just without Foundry's enrich pass.
 */
import { inlineCalcHTML, INLINE_CALC_SOURCE } from "./prose.mjs";

/** Push the system's inline calc enricher onto Foundry's registry. Call once, at init. */
export function registerInlineCalcEnrichers() {
  CONFIG.TextEditor.enrichers.push({
    pattern: new RegExp(INLINE_CALC_SOURCE, "g"),
    enricher: (match, options) => {
      const html = inlineCalcHTML(match[1], match[2], options?.relativeTo ?? null, match[0]);
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
      return tpl.content.firstElementChild;
    }
  });
}
