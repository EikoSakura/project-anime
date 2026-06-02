/**
 * ManaGridRenderer — SVG-based interactive Mana Grid socket board.
 *
 * Renders the adventurer's Mana Grid as an interactive SVG showing job sockets,
 * skill sockets, free sockets, and their connections. Supports click-to-socket
 * and right-click-to-unsocket interactions.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Pixels per grid unit. */
const GRID_UNIT = 90;

/** Socket visual radii (SVG units). */
const SOCKET_RADIUS = {
  job: 28,
  skill: 20,
  free: 20
};

/** Socket shape corner radius. */
const SOCKET_CORNER = {
  job: 6,
  skill: 4,
  free: 4
};

export class ManaGridRenderer {

  /**
   * @param {HTMLElement} container  DOM element to render into
   * @param {object}  options
   * @param {object}  options.grid           Grid data { sockets: [...] }
   * @param {Function} options.getItemData   (itemId) => { name, img, school, type, skillLevel, rank } or null
   * @param {Function} options.getJobSchool  (jobSocketId) => school key for the parent job socket
   * @param {Function} options.onSocketClick     (socket, event) — left click on empty or filled socket
   * @param {Function} options.onSocketRightClick (socket, event) — right click on filled socket
   */
  constructor(container, options = {}) {
    this.container = container;
    this.grid = options.grid ?? { sockets: [] };
    this.getItemData = options.getItemData ?? (() => null);
    this.getJobSchool = options.getJobSchool ?? (() => "general");

    // Callbacks
    this.onSocketClick = options.onSocketClick ?? null;
    this.onSocketRightClick = options.onSocketRightClick ?? null;

    // Element references
    this.svg = null;
    this._viewport = null;
    this._connectionsGroup = null;
    this._socketsGroup = null;
    this._tooltip = null;
    this._socketElements = new Map(); // socketId → <g>

    // Tooltip state
    this._tooltipTimeout = null;
    this._hoveredSocket = null;

    // Build DOM
    this._build();
    this.render();
  }

  /* ==================================== */
  /*  Public API                          */
  /* ==================================== */

  /** Replace grid data and re-render. */
  setGrid(grid) {
    this.grid = grid ?? { sockets: [] };
    this.render();
  }

  /** Full re-render of connections and sockets. */
  render() {
    this._renderConnections();
    this._renderSockets();
    this._fitView();
  }

  /** Clean up all DOM and event listeners. */
  destroy() {
    this._removeEventListeners();
    this._hideTooltip();
    this.container.innerHTML = "";
    this._socketElements.clear();
  }

  /* ==================================== */
  /*  Build SVG Structure                 */
  /* ==================================== */

  _build() {
    this.svg = this._svgEl("svg", {
      class: "mana-grid-svg"
    });

    this._viewport = this._svgEl("g", { class: "mana-grid-viewport" });

    // Defs for filters and gradients
    const defs = this._svgEl("defs");
    this._buildFilters(defs);
    this.svg.appendChild(defs);

    // Layers — connections behind sockets
    this._connectionsGroup = this._svgEl("g", { class: "mana-grid-connections" });
    this._socketsGroup = this._svgEl("g", { class: "mana-grid-sockets" });

    this._viewport.appendChild(this._connectionsGroup);
    this._viewport.appendChild(this._socketsGroup);
    this.svg.appendChild(this._viewport);

    // Tooltip overlay
    this._tooltip = document.createElement("div");
    this._tooltip.className = "mana-grid-tooltip";
    this._tooltip.style.display = "none";

    this.container.classList.add("mana-grid-container");
    this.container.appendChild(this.svg);
    this.container.appendChild(this._tooltip);

    this._bindEventListeners();
  }

  /** Create SVG filter definitions for glow effects. */
  _buildFilters(defs) {
    // Socket glow filter
    const glow = this._svgEl("filter", {
      id: "mana-grid-glow",
      x: "-50%", y: "-50%", width: "200%", height: "200%"
    });
    const blur = this._svgEl("feGaussianBlur", {
      in: "SourceGraphic", stdDeviation: "4", result: "blur"
    });
    const merge = this._svgEl("feMerge");
    merge.appendChild(this._svgEl("feMergeNode", { in: "blur" }));
    merge.appendChild(this._svgEl("feMergeNode", { in: "SourceGraphic" }));
    glow.appendChild(blur);
    glow.appendChild(merge);
    defs.appendChild(glow);
  }

  /* ==================================== */
  /*  Render Connections                  */
  /* ==================================== */

  _renderConnections() {
    this._connectionsGroup.replaceChildren();

    // Draw lines from job sockets to their child skill sockets
    for (const socket of this.grid.sockets) {
      if (socket.type !== "skill" || !socket.parentJobSocketId) continue;

      const parent = this.grid.sockets.find(s => s.id === socket.parentJobSocketId);
      if (!parent) continue;

      const x1 = parent.position.x * GRID_UNIT;
      const y1 = parent.position.y * GRID_UNIT;
      const x2 = socket.position.x * GRID_UNIT;
      const y2 = socket.position.y * GRID_UNIT;

      const filled = !!parent.itemId;
      const childFilled = !!socket.itemId;

      const path = this._svgEl("path", {
        class: `grid-connection${filled && childFilled ? " active" : filled ? " partial" : ""}`,
        d: `M ${x1},${y1} L ${x2},${y2}`
      });

      this._connectionsGroup.appendChild(path);
    }
  }

  /* ==================================== */
  /*  Render Sockets                      */
  /* ==================================== */

  _renderSockets() {
    this._socketsGroup.replaceChildren();
    this._socketElements.clear();

    for (const socket of this.grid.sockets) {
      const x = socket.position.x * GRID_UNIT;
      const y = socket.position.y * GRID_UNIT;
      const isFilled = !!socket.itemId;
      const itemData = isFilled ? this.getItemData(socket.itemId) : null;

      // Determine school color
      let school = "general";
      if (isFilled && itemData?.school) {
        school = itemData.school;
      } else if (socket.type === "skill" && socket.parentJobSocketId) {
        school = this.getJobSchool(socket.parentJobSocketId);
      }
      const schoolColor = CONFIG.SHARDS?.schools?.[school]?.color ?? "#a0a0b0";

      const r = SOCKET_RADIUS[socket.type] ?? 20;
      const corner = SOCKET_CORNER[socket.type] ?? 4;

      const group = this._svgEl("g", {
        class: `grid-socket ${socket.type} ${isFilled ? "filled" : "empty"}`,
        "data-socket-id": socket.id,
        "data-school": school,
        transform: `translate(${x}, ${y})`
      });

      // Glow behind filled sockets
      if (isFilled) {
        group.appendChild(this._svgEl("rect", {
          class: "socket-glow",
          x: -(r + 8), y: -(r + 8),
          width: (r + 8) * 2, height: (r + 8) * 2,
          rx: corner + 4,
          fill: schoolColor,
          opacity: "0.15",
          filter: "url(#mana-grid-glow)"
        }));
      }

      // Socket shape (main body)
      const shape = this._svgEl("rect", {
        class: "socket-shape",
        x: -r, y: -r,
        width: r * 2, height: r * 2,
        rx: corner,
        stroke: isFilled ? schoolColor : undefined
      });
      group.appendChild(shape);

      // Socket type icon (empty state) or item icon (filled state)
      if (isFilled && itemData?.img) {
        // Clip to rounded rect
        const clipId = `clip-${socket.id}`;
        const clipPath = this._svgEl("clipPath", { id: clipId });
        clipPath.appendChild(this._svgEl("rect", {
          x: -(r - 4), y: -(r - 4),
          width: (r - 4) * 2, height: (r - 4) * 2,
          rx: corner - 1
        }));
        group.appendChild(clipPath);

        group.appendChild(this._svgEl("image", {
          class: "socket-item-img",
          href: itemData.img,
          x: -(r - 4), y: -(r - 4),
          width: (r - 4) * 2, height: (r - 4) * 2,
          preserveAspectRatio: "xMidYMid slice",
          "clip-path": `url(#${clipId})`
        }));
      } else {
        // Socket type indicator icon
        const icon = this._getSocketTypeIcon(socket.type);
        const iconText = this._svgEl("text", {
          class: "socket-type-icon",
          x: 0, y: 1,
          "text-anchor": "middle",
          "dominant-baseline": "middle",
          "font-family": "'Font Awesome 6 Free', 'Font Awesome 6 Pro'",
          "font-weight": "900",
          "font-size": socket.type === "job" ? "18" : "14"
        });
        iconText.textContent = icon;
        group.appendChild(iconText);
      }

      // SL badge (for filled skill/free sockets with manacite)
      if (isFilled && itemData?.skillLevel != null && socket.type !== "job") {
        const badgeR = 10;
        const badgeX = r - 2;
        const badgeY = -(r - 2);
        group.appendChild(this._svgEl("circle", {
          class: "sl-badge-bg",
          cx: badgeX, cy: badgeY, r: badgeR
        }));
        const badgeText = this._svgEl("text", {
          class: "sl-badge-text",
          x: badgeX, y: badgeY + 1,
          "text-anchor": "middle",
          "dominant-baseline": "middle"
        });
        badgeText.textContent = itemData.skillLevel;
        group.appendChild(badgeText);
      }

      // Rank badge (for filled job sockets)
      if (isFilled && itemData?.rank && socket.type === "job") {
        const badgeR = 12;
        const badgeX = r - 2;
        const badgeY = -(r - 2);
        group.appendChild(this._svgEl("circle", {
          class: "rank-badge-bg",
          cx: badgeX, cy: badgeY, r: badgeR
        }));
        const badgeText = this._svgEl("text", {
          class: "rank-badge-text",
          x: badgeX, y: badgeY + 1,
          "text-anchor": "middle",
          "dominant-baseline": "middle"
        });
        badgeText.textContent = itemData.rank;
        group.appendChild(badgeText);
      }

      // Name label (below socket)
      if (isFilled && itemData?.name) {
        const label = this._svgEl("text", {
          class: "socket-label",
          x: 0, y: r + 14,
          "text-anchor": "middle"
        });
        label.textContent = this._truncate(itemData.name, 12);
        group.appendChild(label);
      } else {
        // Show socket type name for empty sockets
        const typeLabel = socket.type === "job" ? "Job" : socket.type === "skill" ? "Skill" : "Free";
        const label = this._svgEl("text", {
          class: "socket-label empty-label",
          x: 0, y: r + 14,
          "text-anchor": "middle"
        });
        label.textContent = typeLabel;
        group.appendChild(label);
      }

      this._socketsGroup.appendChild(group);
      this._socketElements.set(socket.id, group);
    }
  }

  /** Get a Font Awesome unicode character for socket type indicator. */
  _getSocketTypeIcon(type) {
    switch (type) {
      case "job": return "\uf0b1";      // fa-briefcase
      case "skill": return "\uf005";     // fa-star
      case "free": return "\uf192";      // fa-circle-dot
      default: return "\uf111";          // fa-circle
    }
  }

  /** Truncate a string with ellipsis. */
  _truncate(str, maxLen) {
    return str.length > maxLen ? str.slice(0, maxLen - 1) + "\u2026" : str;
  }

  /* ==================================== */
  /*  Auto-fit View                       */
  /* ==================================== */

  _fitView() {
    const sockets = this.grid.sockets;
    if (!sockets.length) return;

    const padding = 50;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of sockets) {
      const px = s.position.x * GRID_UNIT;
      const py = s.position.y * GRID_UNIT;
      const r = SOCKET_RADIUS[s.type] ?? 20;
      minX = Math.min(minX, px - r - 20);
      maxX = Math.max(maxX, px + r + 20);
      minY = Math.min(minY, py - r - 20);
      maxY = Math.max(maxY, py + r + 30); // extra for labels
    }

    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;

    // Set SVG viewBox to fit content
    this.svg.setAttribute("viewBox",
      `${minX - padding} ${minY - padding} ${contentW} ${contentH}`
    );
  }

  /* ==================================== */
  /*  Socket Interaction                  */
  /* ==================================== */

  _onSocketClick(e, socketId) {
    const socket = this.grid.sockets.find(s => s.id === socketId);
    if (!socket) return;
    if (this.onSocketClick) {
      this.onSocketClick(socket, e);
    }
  }

  _onSocketContextMenu(e, socketId) {
    e.preventDefault();
    const socket = this.grid.sockets.find(s => s.id === socketId);
    if (!socket) return;
    if (this.onSocketRightClick) {
      this.onSocketRightClick(socket, e);
    }
  }

  /* ==================================== */
  /*  Tooltip                             */
  /* ==================================== */

  _onSocketMouseEnter(e, socketId) {
    this._hoveredSocket = socketId;
    this._tooltipTimeout = setTimeout(() => {
      if (this._hoveredSocket === socketId) this._showTooltip(socketId, e);
    }, 300);
  }

  _onSocketMouseLeave() {
    this._hoveredSocket = null;
    clearTimeout(this._tooltipTimeout);
    this._hideTooltip();
  }

  _showTooltip(socketId, e) {
    const socket = this.grid.sockets.find(s => s.id === socketId);
    if (!socket) return;

    const isFilled = !!socket.itemId;
    const itemData = isFilled ? this.getItemData(socket.itemId) : null;

    let html = "";

    if (isFilled && itemData) {
      html += `<div class="tooltip-header">${itemData.name}</div>`;
      if (socket.type === "job") {
        html += `<div class="tooltip-type">Job — Rank ${itemData.rank ?? "F"}</div>`;
        if (itemData.school) {
          const schoolLabel = game.i18n?.localize(CONFIG.SHARDS?.schools?.[itemData.school]?.label) ?? itemData.school;
          html += `<div class="tooltip-school" style="color:${CONFIG.SHARDS?.schools?.[itemData.school]?.color ?? "#a0a0b0"}">${schoolLabel}</div>`;
        }
      } else {
        html += `<div class="tooltip-type">Manacite — SL ${itemData.skillLevel ?? 1}</div>`;
        if (itemData.skillGranted) {
          html += `<div class="tooltip-skill">${itemData.skillGranted}</div>`;
        }
      }
      html += `<div class="tooltip-hint">Right-click to unsocket</div>`;
    } else {
      const typeLabel = socket.type === "job" ? "Job Socket" : socket.type === "skill" ? "Skill Socket" : "Free Socket";
      html += `<div class="tooltip-header">${typeLabel}</div>`;
      if (socket.type === "skill" && socket.parentJobSocketId) {
        const school = this.getJobSchool(socket.parentJobSocketId);
        if (school && school !== "general") {
          const schoolLabel = game.i18n?.localize(CONFIG.SHARDS?.schools?.[school]?.label) ?? school;
          html += `<div class="tooltip-school" style="color:${CONFIG.SHARDS?.schools?.[school]?.color ?? "#a0a0b0"}">${schoolLabel} affinity</div>`;
        }
      }
      if (socket.type === "free") {
        html += `<div class="tooltip-desc">Accepts any Manacite</div>`;
      }
      html += `<div class="tooltip-hint">Click to socket an item</div>`;
    }

    this._tooltip.innerHTML = html;
    this._tooltip.style.display = "block";

    // Position near cursor
    const containerRect = this.container.getBoundingClientRect();
    let left = e.clientX - containerRect.left + 14;
    let top = e.clientY - containerRect.top - 10;

    requestAnimationFrame(() => {
      const tw = this._tooltip.offsetWidth;
      const th = this._tooltip.offsetHeight;
      if (left + tw > containerRect.width) left = e.clientX - containerRect.left - tw - 14;
      if (top + th > containerRect.height) top = containerRect.height - th - 8;
      if (top < 0) top = 8;
      this._tooltip.style.left = `${left}px`;
      this._tooltip.style.top = `${top}px`;
    });
  }

  _hideTooltip() {
    if (this._tooltip) this._tooltip.style.display = "none";
  }

  /* ==================================== */
  /*  Event Binding                       */
  /* ==================================== */

  _bindEventListeners() {
    this._socketsClickHandler = (e) => {
      const g = e.target.closest(".grid-socket[data-socket-id]");
      if (g) this._onSocketClick(e, g.dataset.socketId);
    };
    this._socketsContextMenuHandler = (e) => {
      const g = e.target.closest(".grid-socket[data-socket-id]");
      if (g) this._onSocketContextMenu(e, g.dataset.socketId);
    };
    this._socketsMouseOverHandler = (e) => {
      const g = e.target.closest(".grid-socket[data-socket-id]");
      if (!g) return;
      const id = g.dataset.socketId;
      if (this._hoveredSocket !== id) this._onSocketMouseEnter(e, id);
    };
    this._socketsMouseOutHandler = (e) => {
      const g = e.target.closest(".grid-socket[data-socket-id]");
      if (!g) return;
      if (e.relatedTarget && g.contains(e.relatedTarget)) return;
      this._onSocketMouseLeave();
    };

    this._socketsGroup.addEventListener("click", this._socketsClickHandler);
    this._socketsGroup.addEventListener("contextmenu", this._socketsContextMenuHandler);
    this._socketsGroup.addEventListener("mouseover", this._socketsMouseOverHandler);
    this._socketsGroup.addEventListener("mouseout", this._socketsMouseOutHandler);
  }

  _removeEventListeners() {
    this._socketsGroup?.removeEventListener("click", this._socketsClickHandler);
    this._socketsGroup?.removeEventListener("contextmenu", this._socketsContextMenuHandler);
    this._socketsGroup?.removeEventListener("mouseover", this._socketsMouseOverHandler);
    this._socketsGroup?.removeEventListener("mouseout", this._socketsMouseOutHandler);
  }

  /* ==================================== */
  /*  Helpers                             */
  /* ==================================== */

  _svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, val] of Object.entries(attrs)) {
      if (val !== undefined) el.setAttribute(key, String(val));
    }
    return el;
  }
}
