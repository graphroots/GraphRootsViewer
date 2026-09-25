import { edgeKey, nodeKey } from "./canvas.js";

const KIND_CLASS = {
  OPERATOR: "kind-operator",
  PARAMETER: "kind-parameter",
  GROUP: "kind-group",
  ANNOTATION: "kind-annotation",
  CLUSTER: "kind-cluster",
};

const NODE_R = 18;

export class GraphView {
  constructor(svg) {
    this.svg = svg;
    this.view = { x: 0, y: 0, k: 1 };
    this.simNodes = [];
    this.links = [];
    this.nodeById = new Map();
    this.onSelect = () => {};
    this.filter = "";
    this.selectedKey = null;
    this.needsFit = false;
    this.ns = "http://www.w3.org/2000/svg";
    this.raf = 0;

    svg.addEventListener("mousedown", (event) => this.#onCanvasMouseDown(event));
    svg.addEventListener("wheel", (event) => this.#onWheel(event), { passive: false });
    svg.addEventListener("contextmenu", (event) => event.preventDefault());
    svg.addEventListener("click", (event) => {
      if (event.target === svg) this.select(null);
    });
  }

  setFilter(text) {
    this.filter = text.trim().toLowerCase();
    this.#applyEmphasis();
  }

  setGraph(graph) {
    this.#stop();
    const nodes = graph?.nodes ?? [];
    const ports = graph?.ports ?? [];
    const edges = graph?.edges ?? [];
    const portById = new Map(ports.map((port) => [port.portId, port]));

    this.simNodes = nodes.map((node, index) => {
      const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
      const ring = 48 + nodes.length * 6;
      return {
        id: node.nodeId,
        data: node,
        x: Math.cos(angle) * ring,
        y: Math.sin(angle) * ring,
        vx: 0,
        vy: 0,
        fixed: false,
        search: [node.name, node.nickName, node.kind, node.typeId].filter(Boolean).join(" ").toLowerCase(),
      };
    });
    this.nodeById = new Map(this.simNodes.map((node) => [node.id, node]));

    this.links = [];
    for (const edge of edges) {
      const sourcePort = portById.get(edge.sourcePortId);
      const targetPort = portById.get(edge.targetPortId);
      const source = sourcePort ? this.nodeById.get(sourcePort.nodeId) : null;
      const target = targetPort ? this.nodeById.get(targetPort.nodeId) : null;
      if (!source || !target) continue;
      this.links.push({
        edge,
        source,
        target,
        curve: 0,
        label: relationLabel(edge),
      });
    }
    assignCurves(this.links);

    const steps = this.simNodes.length > 400 ? 70 : this.simNodes.length > 160 ? 140 : 220;
    let alpha = 1;
    for (let i = 0; i < steps; i += 1) {
      this.#tick(alpha);
      alpha *= 0.975;
    }
    for (const node of this.simNodes) {
      node.vx = 0;
      node.vy = 0;
    }

    this.selectedKey = null;
    this.needsFit = true;
    this.#draw();
  }

  clear() {
    this.#stop();
    this.simNodes = [];
    this.links = [];
    this.nodeById = new Map();
    this.selectedKey = null;
    this.needsFit = false;
    this.svg.replaceChildren();
  }

  select(key, silent = false) {
    this.selectedKey = key;
    for (const el of this.svg.querySelectorAll("[data-key]")) {
      el.classList.toggle("is-selected", el.dataset.key === key);
    }
    this.#applyEmphasis();
    if (!silent) this.onSelect(this.#selectionPayload(key));
  }

  fit() {
    if (!this.simNodes.length) return;
    const box = this.svg.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return;
    const pad = 72;
    const xs = this.simNodes.map((node) => node.x - NODE_R);
    const ys = this.simNodes.map((node) => node.y - NODE_R);
    const rights = this.simNodes.map((node) => node.x + NODE_R + 80);
    const bottoms = this.simNodes.map((node) => node.y + NODE_R + 28);
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const width = Math.max(1, Math.max(...rights) - minX + pad);
    const height = Math.max(1, Math.max(...bottoms) - minY + pad);
    const k = Math.min(box.width / width, box.height / height, 1.6);
    this.view = {
      x: (box.width - width * k) / 2 - minX * k,
      y: (box.height - height * k) / 2 - minY * k,
      k,
    };
    this.needsFit = false;
    this.#applyView();
    this.#applyEmphasis();
  }

  #draw() {
    const ns = this.ns;
    this.svg.replaceChildren();

    const defs = document.createElementNS(ns, "defs");
    const marker = document.createElementNS(ns, "marker");
    marker.setAttribute("id", "graph-arrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("orient", "auto-start-reverse");
    const head = document.createElementNS(ns, "path");
    head.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    head.setAttribute("fill", "context-stroke");
    marker.append(head);
    defs.append(marker);
    this.svg.append(defs);

    const root = document.createElementNS(ns, "g");
    root.id = "graph-viewport";

    const edges = document.createElementNS(ns, "g");
    edges.classList.add("g-edges");
    for (const link of this.links) {
      const group = document.createElementNS(ns, "g");
      group.classList.add("g-edge");
      group.dataset.key = edgeKey(link.edge);
      group.dataset.kind = "edge";

      const hit = document.createElementNS(ns, "path");
      hit.classList.add("hit");
      const line = document.createElementNS(ns, "path");
      line.classList.add("line");
      line.setAttribute("marker-end", "url(#graph-arrow)");

      const label = document.createElementNS(ns, "g");
      label.classList.add("rel");
      const plate = document.createElementNS(ns, "rect");
      plate.setAttribute("rx", "4");
      plate.setAttribute("ry", "4");
      const text = document.createElementNS(ns, "text");
      text.textContent = link.label;
      label.append(plate, text);

      group.append(hit, line, label);
      group.addEventListener("click", (event) => {
        event.stopPropagation();
        this.select(group.dataset.key);
      });
      edges.append(group);
      link.hit = hit;
      link.line = line;
      link.labelEl = label;
      link.plate = plate;
      link.text = text;
    }
    root.append(edges);

    const nodes = document.createElementNS(ns, "g");
    nodes.classList.add("g-nodes");
    for (const node of this.simNodes) {
      const group = document.createElementNS(ns, "g");
      group.classList.add("g-node", KIND_CLASS[node.data.kind] ?? "kind-operator");
      group.dataset.key = nodeKey(node.data);
      group.dataset.kind = "node";
      group.dataset.search = node.search;

      const ring = document.createElementNS(ns, "circle");
      ring.classList.add("ring");
      ring.setAttribute("r", NODE_R + 5);
      const body = document.createElementNS(ns, "circle");
      body.classList.add("body");
      body.setAttribute("r", NODE_R);
      const glyph = document.createElementNS(ns, "text");
      glyph.classList.add("glyph");
      glyph.setAttribute("text-anchor", "middle");
      glyph.setAttribute("dy", "4");
      glyph.textContent = glyphFor(node.data);
      const caption = document.createElementNS(ns, "text");
      caption.classList.add("caption");
      caption.setAttribute("text-anchor", "middle");
      caption.setAttribute("y", NODE_R + 16);
      const fullName = node.data.name || node.data.nickName || node.data.nodeId;
      caption.textContent = truncate(fullName, 26);
      const title = document.createElementNS(ns, "title");
      title.textContent = [fullName, node.data.kind].filter(Boolean).join(" · ");

      group.append(ring, body, glyph, caption, title);
      group.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.#dragNode(event, node);
      });
      group.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        node.fixed = false;
        this.#relax(90, 0.55);
      });
      group.addEventListener("click", (event) => {
        event.stopPropagation();
        this.select(group.dataset.key);
      });
      nodes.append(group);
      node.el = group;
    }
    root.append(nodes);
    this.svg.append(root);
    this.#paint();
    this.#applyView();
    this.#applyEmphasis();
  }

  #paint() {
    for (const node of this.simNodes) {
      node.el?.setAttribute("transform", `translate(${node.x} ${node.y})`);
      node.el?.classList.toggle("is-pinned", node.fixed);
    }
    const showLabels = this.view.k >= 0.62;
    for (const link of this.links) {
      const path = linkPath(link);
      link.hit?.setAttribute("d", path.d);
      link.line?.setAttribute("d", path.d);
      if (!link.labelEl) continue;
      const selected = link.line?.parentElement?.classList.contains("is-selected");
      const visible = Boolean(link.label) && (showLabels || selected);
      link.labelEl.setAttribute("transform", `translate(${path.mx} ${path.my})`);
      link.labelEl.classList.toggle("is-hidden", !visible);
      if (visible && link.plate && link.text) {
        const width = Math.max(28, link.label.length * 5.6 + 12);
        link.plate.setAttribute("x", -width / 2);
        link.plate.setAttribute("y", -8);
        link.plate.setAttribute("width", width);
        link.plate.setAttribute("height", 16);
        link.text.setAttribute("text-anchor", "middle");
        link.text.setAttribute("y", 3);
      }
    }
  }

  #selectionPayload(key) {
    if (!key) return null;
    if (key.startsWith("node:")) {
      const node = this.simNodes.find((item) => nodeKey(item.data) === key);
      return node ? { type: "node", value: node.data } : null;
    }
    if (key.startsWith("edge:")) {
      const link = this.links.find((item) => edgeKey(item.edge) === key);
      if (!link) return null;
      return { type: "edge", value: link.edge };
    }
    return null;
  }

  #focusIds() {
    if (!this.selectedKey) return null;
    if (this.selectedKey.startsWith("node:")) {
      const node = this.simNodes.find((item) => nodeKey(item.data) === this.selectedKey);
      if (!node) return null;
      const ids = new Set([node.id]);
      for (const link of this.links) {
        if (link.source === node) ids.add(link.target.id);
        if (link.target === node) ids.add(link.source.id);
      }
      return ids;
    }
    if (this.selectedKey.startsWith("edge:")) {
      const link = this.links.find((item) => edgeKey(item.edge) === this.selectedKey);
      if (!link) return null;
      return new Set([link.source.id, link.target.id]);
    }
    return null;
  }

  #applyEmphasis() {
    const focus = this.#focusIds();
    for (const node of this.simNodes) {
      const matches = !this.filter || node.search.includes(this.filter);
      const inFocus = !focus || focus.has(node.id);
      node.el?.classList.toggle("is-dimmed", !matches || !inFocus);
    }
    for (const link of this.links) {
      const matches =
        !this.filter || link.source.search.includes(this.filter) || link.target.search.includes(this.filter);
      const inFocus = !focus || focus.has(link.source.id) || focus.has(link.target.id);
      const selected = edgeKey(link.edge) === this.selectedKey;
      link.line?.parentElement?.classList.toggle("is-dimmed", !selected && (!matches || !inFocus));
    }
  }

  #applyView() {
    const viewport = this.svg.querySelector("#graph-viewport");
    if (viewport) {
      viewport.setAttribute("transform", `translate(${this.view.x} ${this.view.y}) scale(${this.view.k})`);
    }
    this.#paint();
  }

  #tick(alpha) {
    const nodes = this.simNodes;
    const n = nodes.length;
    for (const node of nodes) {
      node.fx = 0;
      node.fy = 0;
    }

    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 < 0.01) {
          dx = (i + 1) * 0.01;
          dy = (j + 1) * 0.01;
          dist2 = dx * dx + dy * dy;
        }
        const dist = Math.sqrt(dist2);
        const force = (alpha * 2400) / dist2;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        nodes[i].fx -= fx;
        nodes[i].fy -= fy;
        nodes[j].fx += fx;
        nodes[j].fy += fy;

        const minDist = NODE_R * 2 + 36;
        if (dist < minDist) {
          const push = ((minDist - dist) / dist) * 0.5;
          nodes[i].fx -= dx * push;
          nodes[i].fy -= dy * push;
          nodes[j].fx += dx * push;
          nodes[j].fy += dy * push;
        }
      }
    }

    const seen = new Set();
    for (const link of this.links) {
      if (link.source === link.target) continue;
      const key = link.source.id < link.target.id ? `${link.source.id}|${link.target.id}` : `${link.target.id}|${link.source.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = link.source;
      const b = link.target;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const force = (dist - 150) * 0.045 * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.fx += fx;
      a.fy += fy;
      b.fx -= fx;
      b.fy -= fy;
    }

    for (const node of nodes) {
      node.fx -= node.x * 0.015 * alpha;
      node.fy -= node.y * 0.015 * alpha;
      if (node.fixed) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx = (node.vx + node.fx) * 0.55;
      node.vy = (node.vy + node.fy) * 0.55;
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > 48) {
        node.vx = (node.vx / speed) * 48;
        node.vy = (node.vy / speed) * 48;
      }
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  #relax(steps, alphaStart) {
    this.#stop();
    let left = steps;
    let alpha = alphaStart;
    const frame = () => {
      const batch = Math.min(6, left);
      for (let i = 0; i < batch; i += 1) {
        this.#tick(alpha);
        alpha *= 0.9;
      }
      left -= batch;
      this.#paint();
      if (left > 0) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  #stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  #dragNode(event, node) {
    this.select(nodeKey(node.data));
    node.fixed = true;
    this.svg.classList.add("is-dragging-node");
    const move = (moveEvent) => {
      moveEvent.preventDefault();
      const point = this.#worldPoint(moveEvent.clientX, moveEvent.clientY);
      node.x = point.x;
      node.y = point.y;
      node.vx = 0;
      node.vy = 0;
      this.#paint();
    };
    const up = () => {
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", up, true);
      this.svg.classList.remove("is-dragging-node");
      this.#relax(48, 0.4);
    };
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", up, true);
  }

  #onCanvasMouseDown(event) {
    if (event.button !== 0) return;
    if (findGroup(event.target, this.svg, "g-node") || findGroup(event.target, this.svg, "g-edge")) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = this.view.x;
    const originY = this.view.y;
    const move = (moveEvent) => {
      this.view.x = originX + (moveEvent.clientX - startX);
      this.view.y = originY + (moveEvent.clientY - startY);
      this.#applyView();
    };
    const up = () => {
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", up, true);
    };
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", up, true);
  }

  #onWheel(event) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    const box = this.svg.getBoundingClientRect();
    const mx = event.clientX - box.left;
    const my = event.clientY - box.top;
    const next = clamp(this.view.k * factor, 0.12, 3.5);
    const wx = (mx - this.view.x) / this.view.k;
    const wy = (my - this.view.y) / this.view.k;
    this.view.k = next;
    this.view.x = mx - wx * next;
    this.view.y = my - wy * next;
    this.#applyView();
    this.#applyEmphasis();
  }

  #worldPoint(clientX, clientY) {
    const box = this.svg.getBoundingClientRect();
    return {
      x: (clientX - box.left - this.view.x) / this.view.k,
      y: (clientY - box.top - this.view.y) / this.view.k,
    };
  }
}

function relationLabel(edge) {
  const source = edge.sourceName || "";
  const target = edge.targetName || "";
  if (source && target && source !== target) return truncate(`${source} → ${target}`, 32);
  return truncate(source || target || "", 32);
}

function assignCurves(links) {
  const groups = new Map();
  for (const link of links) {
    if (link.source === link.target) {
      link.curve = 1;
      continue;
    }
    const a = link.source.id;
    const b = link.target.id;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(link);
  }
  for (const group of groups.values()) {
    const count = group.length;
    group.forEach((link, index) => {
      link.curve = count === 1 ? 0 : (index - (count - 1) / 2) * 36;
    });
  }
}

function linkPath(link) {
  const source = link.source;
  const target = link.target;
  if (source === target) {
    const x = source.x;
    const y = source.y - NODE_R;
    return {
      d: `M ${x - 5} ${y} C ${x - 42} ${y - 48}, ${x + 42} ${y - 48}, ${x + 8} ${y}`,
      mx: x,
      my: y - 40,
    };
  }
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const pad = NODE_R + 7;
  const x1 = source.x + ux * pad;
  const y1 = source.y + uy * pad;
  const x2 = target.x - ux * pad;
  const y2 = target.y - uy * pad;
  const mx = (x1 + x2) / 2 - uy * link.curve;
  const my = (y1 + y2) / 2 + ux * link.curve;
  if (!link.curve) return { d: `M ${x1} ${y1} L ${x2} ${y2}`, mx, my };
  return { d: `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`, mx, my };
}

function glyphFor(node) {
  const name = node.name || node.nickName || node.kind || "?";
  return name.trim().charAt(0).toUpperCase() || "?";
}

function truncate(text, max) {
  if (!text || text.length <= max) return text || "";
  return `${text.slice(0, max - 1)}…`;
}

function findGroup(el, root, className) {
  for (let current = el; current && current !== root; current = current.parentElement) {
    if (current.classList?.contains(className)) return current;
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
