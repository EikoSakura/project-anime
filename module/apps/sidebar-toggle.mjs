/* Clicking the active sidebar tab collapses the sidebar again. Core v13+
   only ever switches and expands on tab clicks (collapse lives on the
   caret button alone); this restores the click-to-toggle behavior. */

export function registerSidebarToggle() {
  const proto = foundry.applications.sidebar.Sidebar.prototype;
  const original = proto._onClickTab;
  proto._onClickTab = function(event) {
    const tab = event.target.closest("#sidebar-tabs [data-tab]")?.dataset.tab;
    if ((event.button === 0) && this.expanded && tab && (tab === this.tabGroups.primary)) return this.collapse();
    return original.call(this, event);
  };
}
