import { ZONE_TINTS } from "../config.mjs";

const TYPE = "project-anime.zone";

const BENI = 0xd92b48;
const PAPER = 0xf7f2e7;

/* ============================================================
   Walls toolbar tools. Blank Wall is a palette preset for walls
   that block nothing. Weld Walls makes the selected walls meet
   endpoint to endpoint. Zone from Walls welds the selection,
   traces the enclosed interior, and creates a Region carrying a
   Zone behavior; open ends are marked when the walls do not close.
   Divide into Zones cuts the map into one Zone per enclosed cell,
   using the scene border as an implicit boundary.
   ============================================================ */

/* Endpoints closer than half the wall snapping interval cannot be
   two different intended corners. */
function weldTolerance() {
  const size = canvas.dimensions.size;
  const resolution = size >= 128 ? 8 : (size >= 64 ? 4 : 2);
  return size / resolution / 2;
}

/* The four edges of the scene rectangle. */
function borderSegments() {
  const r = canvas.dimensions.sceneRect;
  const x0 = Math.round(r.x);
  const y0 = Math.round(r.y);
  const x1 = Math.round(r.x + r.width);
  const y1 = Math.round(r.y + r.height);
  return [[x0, y0, x1, y0], [x1, y0, x1, y1], [x0, y1, x1, y1], [x0, y0, x0, y1]];
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
   and creations to apply and the number of joints made. With border,
   lone ends near the scene border clamp onto it. */
function weld(walls, { border = false } = {}) {
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
  // runs diagonally), that wall is split at the junction instead. The
  // scene border joins by clamping only, never splitting.
  const targets = [...entries];
  if (border) for (const c of borderSegments()) targets.push({ border: true, c });
  for (const e of ends) {
    if (e.met) continue;
    const p = { x: X(e), y: Y(e) };
    if (targets.some(o => (o !== e.entry) && onWall(o.c, p))) continue;
    let best = null;
    for (const other of targets) {
      if (other === e.entry) continue;
      const [ax, ay, bx, by] = other.c;
      const closest = foundry.utils.closestPointToSegment(p, { x: ax, y: ay }, { x: bx, y: by });
      const d = Math.hypot(p.x - closest.x, p.y - closest.y);
      if ((d <= tolerance) && (!best || (d < best.d))) best = { target: other, d, x: closest.x, y: closest.y };
    }
    if (!best) continue;
    const j = { x: Math.round(best.x), y: Math.round(best.y) };
    if (!onWall(best.target.c, j)) {
      if (best.target.border || (best.target.source.door !== CONST.WALL_DOOR_TYPES.NONE)) continue;
      const [ax, ay, bx, by] = best.target.c;
      best.target.c = [ax, ay, j.x, j.y];
      entries.push({ document: null, source: best.target.source, c: [j.x, j.y, bx, by] });
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
   Dividing the map. The selected walls plus, when the welded walls
   reach it, the scene border form a planar graph; its faces are the
   cells the map divides into.
   ============================================================ */

/* Build the graph. All intersections are computed pairwise here: the
   core intersection records do not cover the scene border. */
function divideGraph(walls, border) {
  const segments = walls.map(w => {
    const c = w.document.c;
    return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), Math.round(c[3])];
  }).filter(c => (c[0] !== c[2]) || (c[1] !== c[3]));
  if (border) segments.push(...borderSegments());
  const splits = segments.map(() => []);
  for (let i = 0; i < segments.length; i++) {
    const a = { x: segments[i][0], y: segments[i][1] };
    const b = { x: segments[i][2], y: segments[i][3] };
    for (let k = i + 1; k < segments.length; k++) {
      const c = { x: segments[k][0], y: segments[k][1] };
      const d = { x: segments[k][2], y: segments[k][3] };
      if (!foundry.utils.lineSegmentIntersects(a, b, c, d)) continue;
      const p = foundry.utils.lineLineIntersection(a, b, c, d);
      if (!p) continue;
      const point = { x: Math.round(p.x), y: Math.round(p.y) };
      splits[i].push(point);
      splits[k].push(point);
    }
  }
  const nodes = new Map();
  const node = p => {
    const key = `${p.x},${p.y}`;
    let n = nodes.get(key);
    if (!n) nodes.set(key, n = { x: p.x, y: p.y, links: new Set() });
    return n;
  };
  for (let i = 0; i < segments.length; i++) {
    const points = [
      { x: segments[i][0], y: segments[i][1] },
      ...splits[i],
      { x: segments[i][2], y: segments[i][3] }
    ];
    points.sort((p, q) => (p.x - q.x) || (p.y - q.y));
    for (let k = 1; k < points.length; k++) {
      const p = node(points[k - 1]);
      const q = node(points[k]);
      if (p === q) continue;
      p.links.add(q);
      q.links.add(p);
    }
  }
  return nodes;
}

/* Trim open ends until only closed circuits remain. */
function prune(nodes) {
  let again = true;
  while (again) {
    again = false;
    for (const [key, n] of nodes) {
      if (n.links.size > 1) continue;
      for (const m of n.links) m.links.delete(n);
      nodes.delete(key);
      again = true;
    }
  }
}

/* Label connected pieces of the graph; separate pieces nest rather
   than share faces, which is how holes are recognized. */
function labelComponents(nodes) {
  let comp = 0;
  for (const n of nodes.values()) {
    if (n.comp !== undefined) continue;
    n.comp = ++comp;
    const queue = [n];
    while (queue.length) {
      for (const m of queue.pop().links) {
        if (m.comp === undefined) {
          m.comp = comp;
          queue.push(m);
        }
      }
    }
  }
}

/* Trace the faces of the graph. Directions out of each point sort by
   angle, and a walk continues with the direction before the reverse of
   the one it arrived by; every directed edge is walked exactly once.
   Cells come out with positive signed area, each piece's outer rim
   comes out negative. */
function traceFaces(nodes) {
  const order = new Map();
  for (const n of nodes.values()) {
    order.set(n, [...n.links].sort((p, q) =>
      Math.atan2(p.y - n.y, p.x - n.x) - Math.atan2(q.y - n.y, q.x - n.x)));
  }
  const visited = new Set();
  const faces = [];
  for (const n of nodes.values()) {
    for (const m of n.links) {
      if (visited.has(`${n.x},${n.y}>${m.x},${m.y}`)) continue;
      const points = [];
      let area = 0;
      let from = n;
      let to = m;
      for (;;) {
        visited.add(`${from.x},${from.y}>${to.x},${to.y}`);
        points.push(from);
        area += (from.x * to.y) - (to.x * from.y);
        const out = order.get(to);
        const next = out[(out.indexOf(from) + out.length - 1) % out.length];
        from = to;
        to = next;
        if ((from === n) && (to === m)) break;
      }
      faces.push({ points, area: area / 2 });
    }
  }
  return faces;
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

async function divideControlled() {
  clearMarkers();
  const controlled = canvas.walls.controlled;
  if (!controlled.length) {
    ui.notifications.warn("PROJECTANIME.Zone.SelectWalls", { localize: true });
    return;
  }
  const plan = weld(controlled, { border: true });
  const created = await applyWeld(plan);
  if (plan.joints) ui.notifications.info("PROJECTANIME.Zone.Welded", { format: { count: plan.joints } });
  const walls = [...controlled, ...created.map(d => d.object).filter(Boolean)];

  // The border joins in only when the welded walls actually reach it;
  // otherwise it would enclose a whole-scene cell of its own.
  const edges = borderSegments();
  const touches = walls.some(w => {
    const c = w.document.c;
    return edges.some(seg => onWall(seg, { x: c[0], y: c[1] }) || onWall(seg, { x: c[2], y: c[3] }));
  });
  const nodes = divideGraph(walls, touches);
  const open = [...nodes.values()].filter(n => n.links.size === 1);
  prune(nodes);
  labelComponents(nodes);
  const faces = traceFaces(nodes);

  const zones = faces.filter(f => f.area > 4).map(f => ({
    area: f.area,
    comp: f.points[0].comp,
    points: f.points,
    polygon: new PIXI.Polygon(f.points.flatMap(p => [p.x, p.y])),
    minX: Math.min(...f.points.map(p => p.x)),
    minY: Math.min(...f.points.map(p => p.y)),
    holes: []
  }));
  if (!zones.length) {
    if (open.length) {
      showMarkers(open);
      ui.notifications.error("PROJECTANIME.Zone.NoDivisionGaps", { localize: true });
    }
    else ui.notifications.error("PROJECTANIME.Zone.NoDivision", { localize: true });
    return;
  }
  zones.sort((a, b) => (a.minY - b.minY) || (a.minX - b.minX));

  // A piece nested inside a cell of another piece carves a hole in it:
  // the inner piece's outer rim, assigned to the smallest cell around it.
  const rims = new Map();
  for (const f of faces) {
    if (f.area >= 0) continue;
    const comp = f.points[0].comp;
    const rim = rims.get(comp);
    if (!rim || (f.area < rim.area)) rims.set(comp, f);
  }
  for (const rim of rims.values()) {
    const v = rim.points[0];
    let owner = null;
    for (const z of zones) {
      if (z.comp === v.comp) continue;
      if (!z.polygon.contains(v.x, v.y)) continue;
      if (!owner || (z.area < owner.area)) owner = z;
    }
    owner?.holes.push(rim);
  }

  const base = canvas.scene.regions.filter(r => r.behaviors.some(b => b.type === TYPE)).length;
  const regions = await canvas.scene.createEmbeddedDocuments("Region", zones.map((z, i) => ({
    name: game.i18n.format("PROJECTANIME.Zone.DefaultName", { number: base + i + 1 }),
    shapes: [
      { type: "polygon", points: z.points.flatMap(p => [p.x, p.y]) },
      ...z.holes.map(h => ({ type: "polygon", hole: true, points: h.points.flatMap(p => [p.x, p.y]) }))
    ],
    levels: [canvas.level.id]
  })));
  for (let i = 0; i < regions.length; i++) {
    await regions[i].createEmbeddedDocuments("RegionBehavior", [{
      type: TYPE,
      system: { tint: ZONE_TINTS[i % ZONE_TINTS.length] }
    }]);
  }
  ui.notifications.info("PROJECTANIME.Zone.Divided", { format: { count: regions.length } });
}

/* ============================================================ */

export function registerZoneWalls() {
  Hooks.on("getSceneControlButtons", controls => {
    const tools = controls.walls?.tools;
    if (!tools) return;
    const s = CONST.EDGE_SENSE_TYPES;
    tools.blank = {
      name: "blank",
      order: 9.5,
      title: "PROJECTANIME.Zone.BlankWall",
      icon: "fa-solid fa-border-none",
      button: true,
      createData: {
        light: s.NONE, move: s.NONE, sight: s.NONE, sound: s.NONE,
        door: CONST.WALL_DOOR_TYPES.NONE,
        threshold: { light: null, sight: null, sound: null, attenuation: false }
      },
      onChange: event => foundry.canvas.layers.WallsLayer.paletteClass.onClickPreset(event)
    };
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
    tools.divide = {
      name: "divide",
      order: 16,
      title: "PROJECTANIME.Zone.Divide",
      icon: "fa-solid fa-chart-tree-map",
      button: true,
      onChange: () => divideControlled()
    };
  });
  Hooks.on("canvasTearDown", clearMarkers);
}
