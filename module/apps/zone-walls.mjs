const TYPE = "project-anime.zone";

const BENI = 0xd92b48;
const PAPER = 0xf7f2e7;

/* ============================================================
   Walls toolbar tools. Weld Walls makes the selected walls meet
   endpoint to endpoint. Zone from Walls welds the selection,
   traces the enclosed interior, and creates a Region carrying a
   Zone behavior; open ends are marked when the walls do not close.
   ============================================================ */

/* Endpoints closer than half the wall snapping interval cannot be
   two different intended corners. */
function weldTolerance() {
  const size = canvas.dimensions.size;
  const resolution = size >= 128 ? 8 : (size >= 64 ? 4 : 2);
  return size / resolution / 2;
}

/* Is the integer point exactly on the wall segment? Exact contact is
   what the interior tracing recognizes as a junction. */
function onWall(c, p) {
  const [ax, ay, bx, by] = c;
  if (foundry.utils.orient2dFast({ x: ax, y: ay }, { x: bx, y: by }, p) !== 0) return false;
  return (p.x >= Math.min(ax, bx)) && (p.x <= Math.max(ax, bx))
    && (p.y >= Math.min(ay, by)) && (p.y <= Math.max(ay, by));
}

/* Plan the weld. One working entry per wall: its document (null for a
   piece added by a split), the document supplying data for that piece,
   and the coordinates as they stand mid-weld. Returns the wall updates
   and creations to apply and the number of joints made. */
function weld(walls) {
  const tolerance = weldTolerance();
  const entries = walls.map(w => ({ document: w.document, source: w.document, c: [...w.document.c] }));
  const ends = [];
  for (const entry of entries) ends.push({ entry, i: 0 }, { entry, i: 2 });
  const X = e => e.entry.c[e.i];
  const Y = e => e.entry.c[e.i + 1];
  let joints = 0;

  // Corner pass: cluster endpoints lying within the tolerance of one
  // another, then move each cluster onto its best-connected point.
  const parent = ends.map((_, k) => k);
  const find = k => {
    while (parent[k] !== k) k = parent[k] = parent[parent[k]];
    return k;
  };
  for (let a = 0; a < ends.length; a++) {
    for (let b = a + 1; b < ends.length; b++) {
      if (Math.hypot(X(ends[a]) - X(ends[b]), Y(ends[a]) - Y(ends[b])) <= tolerance) parent[find(b)] = find(a);
    }
  }
  const clusters = new Map();
  for (let k = 0; k < ends.length; k++) {
    const root = find(k);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(ends[k]);
  }
  for (const cluster of clusters.values()) {
    if (cluster.length < 2) continue;
    for (const e of cluster) e.met = true;
    const counts = new Map();
    for (const e of cluster) {
      const key = `${X(e)},${Y(e)}`;
      const point = counts.get(key) ?? { x: X(e), y: Y(e), n: 0 };
      point.n++;
      counts.set(key, point);
    }
    if (counts.size < 2) continue;
    const mx = cluster.reduce((s, e) => s + X(e), 0) / cluster.length;
    const my = cluster.reduce((s, e) => s + Y(e), 0) / cluster.length;
    let target = null;
    for (const point of counts.values()) {
      if (!target || (point.n > target.n) || ((point.n === target.n)
        && (Math.hypot(point.x - mx, point.y - my) < Math.hypot(target.x - mx, target.y - my)))) target = point;
    }
    for (const e of cluster) {
      e.entry.c[e.i] = target.x;
      e.entry.c[e.i + 1] = target.y;
    }
    joints++;
  }

  // A wall collapsed by its own two ends merging stays as it was.
  for (const entry of entries) {
    if ((entry.c[0] === entry.c[2]) && (entry.c[1] === entry.c[3])) entry.c = [...entry.document.c];
  }

  // Junction pass: a lone end near the middle of another wall joins it
  // there. The junction must sit exactly on the other wall to count as
  // contact; when no integer point on its line is available (the wall
  // runs diagonally), that wall is split at the junction instead.
  for (const e of ends) {
    if (e.met) continue;
    const p = { x: X(e), y: Y(e) };
    if (entries.some(o => (o !== e.entry) && onWall(o.c, p))) continue;
    let best = null;
    for (const other of entries) {
      if (other === e.entry) continue;
      const [ax, ay, bx, by] = other.c;
      const closest = foundry.utils.closestPointToSegment(p, { x: ax, y: ay }, { x: bx, y: by });
      const d = Math.hypot(p.x - closest.x, p.y - closest.y);
      if ((d <= tolerance) && (!best || (d < best.d))) best = { entry: other, d, x: closest.x, y: closest.y };
    }
    if (!best) continue;
    const j = { x: Math.round(best.x), y: Math.round(best.y) };
    if (!onWall(best.entry.c, j)) {
      if (best.entry.source.door !== CONST.WALL_DOOR_TYPES.NONE) continue;
      const [ax, ay, bx, by] = best.entry.c;
      best.entry.c = [ax, ay, j.x, j.y];
      entries.push({ document: null, source: best.entry.source, c: [j.x, j.y, bx, by] });
    }
    e.entry.c[e.i] = j.x;
    e.entry.c[e.i + 1] = j.y;
    joints++;
  }

  const updates = [];
  const creates = [];
  for (const entry of entries) {
    if (!entry.document) {
      const data = entry.source.toObject();
      delete data._id;
      data.c = entry.c;
      creates.push(data);
    } else if (!entry.c.every((v, k) => v === entry.document.c[k])) {
      updates.push({ _id: entry.document.id, c: entry.c });
    }
  }
  return { updates, creates, joints };
}

/* Apply a weld plan and return the walls created by splits. */
async function applyWeld({ updates, creates }) {
  if (updates.length) await canvas.scene.updateEmbeddedDocuments("Wall", updates);
  if (creates.length) return canvas.scene.createEmbeddedDocuments("Wall", creates);
  return [];
}

/* The graph WallsLayer#identifyInteriorArea builds: endpoints rounded
   to integers, walls split where they intersect. A point connected to
   a single edge is an open end. */
function openEnds(walls) {
  const nodes = new Map();
  const node = p => {
    const key = `${p.x},${p.y}`;
    let n = nodes.get(key);
    if (!n) nodes.set(key, n = { x: p.x, y: p.y, links: new Set() });
    return n;
  };
  for (const wall of walls) {
    const edge = wall.edge;
    if (!edge) continue;
    const a = { x: Math.round(edge.a.x), y: Math.round(edge.a.y) };
    const b = { x: Math.round(edge.b.x), y: Math.round(edge.b.y) };
    if ((a.x === b.x) && (a.y === b.y)) continue;
    const points = (edge.intersections[canvas.level.id] ?? [])
      .map(i => ({ x: Math.round(i.intersection.x), y: Math.round(i.intersection.y) }));
    points.push(a, b);
    points.sort((p, q) => (p.x - q.x) || (p.y - q.y));
    for (let k = 1; k < points.length; k++) {
      const p = node(points[k - 1]);
      const q = node(points[k]);
      if (p === q) continue;
      p.links.add(q);
      q.links.add(p);
    }
  }
  return [...nodes.values()].filter(n => n.links.size === 1);
}

/* ============================================================
   Open-end markers, drawn on the walls layer and panned to.
   ============================================================ */

let markers = null;
let markerTimeout = null;

function clearMarkers() {
  if (markerTimeout) {
    clearTimeout(markerTimeout);
    markerTimeout = null;
  }
  if (markers && !markers.destroyed) markers.destroy();
  markers = null;
}

function showMarkers(points) {
  const s = canvas.dimensions.uiScale;
  markers = canvas.walls.addChild(new PIXI.Graphics());
  markers.eventMode = "none";
  for (const p of points) {
    markers.lineStyle({ width: 5 * s, color: PAPER, alpha: 0.9 });
    markers.drawCircle(p.x, p.y, 11 * s);
    markers.lineStyle({ width: 2.5 * s, color: BENI });
    markers.drawCircle(p.x, p.y, 11 * s);
    markers.lineStyle();
    markers.beginFill(BENI, 1).drawCircle(p.x, p.y, 2.5 * s).endFill();
  }
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  canvas.animatePan({
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2
  });
  markerTimeout = setTimeout(clearMarkers, 10000);
}

/* ============================================================
   The tools.
   ============================================================ */

async function weldControlled() {
  clearMarkers();
  const walls = canvas.walls.controlled;
  if (walls.length < 2) {
    ui.notifications.warn("PROJECTANIME.Zone.SelectWalls", { localize: true });
    return;
  }
  const plan = weld(walls);
  if (!plan.joints) {
    ui.notifications.info("PROJECTANIME.Zone.NothingToWeld", { localize: true });
    return;
  }
  await applyWeld(plan);
  ui.notifications.info("PROJECTANIME.Zone.Welded", { format: { count: plan.joints } });
}

async function zoneFromControlled() {
  clearMarkers();
  const controlled = canvas.walls.controlled;
  if (!controlled.length) {
    ui.notifications.warn("PROJECTANIME.Zone.SelectWalls", { localize: true });
    return;
  }
  const plan = weld(controlled);
  const created = await applyWeld(plan);
  if (plan.joints) ui.notifications.info("PROJECTANIME.Zone.Welded", { format: { count: plan.joints } });
  const walls = [...controlled, ...created.map(d => d.object).filter(Boolean)];

  // Wall intersections recompute lazily; force them fresh before tracing.
  canvas.level.edges.getEdges(canvas.dimensions.rect);
  const polygons = canvas.walls.identifyInteriorArea(walls);
  if (!polygons.length) {
    const gaps = openEnds(walls);
    if (gaps.length) {
      showMarkers(gaps);
      ui.notifications.error("PROJECTANIME.Zone.GapsMarked", { localize: true });
    }
    else ui.notifications.error("PROJECTANIME.Zone.NoEnclosure", { localize: true });
    return;
  }

  const number = canvas.scene.regions.filter(r => r.behaviors.some(b => b.type === TYPE)).length + 1;
  const [region] = await canvas.scene.createEmbeddedDocuments("Region", [{
    name: game.i18n.format("PROJECTANIME.Zone.DefaultName", { number }),
    shapes: polygons.map(p => ({ type: "polygon", points: Array.from(p.points) })),
    levels: [canvas.level.id]
  }]);
  const [behavior] = await region.createEmbeddedDocuments("RegionBehavior", [{ type: TYPE }]);
  behavior.sheet.render(true);
}

/* ============================================================ */

export function registerZoneWalls() {
  Hooks.on("getSceneControlButtons", controls => {
    const tools = controls.walls?.tools;
    if (!tools) return;
    tools.weld = {
      name: "weld",
      order: 14,
      title: "PROJECTANIME.Zone.WeldWalls",
      icon: "fa-solid fa-arrows-to-dot",
      button: true,
      onChange: () => weldControlled()
    };
    tools.zone = {
      name: "zone",
      order: 15,
      title: "PROJECTANIME.Zone.FromWalls",
      icon: "fa-solid fa-torii-gate",
      button: true,
      onChange: () => zoneFromControlled()
    };
  });
  Hooks.on("canvasTearDown", clearMarkers);
}
