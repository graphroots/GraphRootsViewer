const KIND_CLASS = {
  OPERATOR: "kind-operator",
  PARAMETER: "kind-parameter",
  GROUP: "kind-group",
  ANNOTATION: "kind-annotation",
  CLUSTER: "kind-cluster",
};

const PORT_ROW = 16;
const HEADER = 26;
const MIN_WIDTH = 128;
const CHAR_W = 7.2;

export class GraphCanvas {
  constructor(svg) {
    this.svg = svg;
    this.view = { x: 0, y: 0, k: 1 };
    this.layouts = [];
    this.portIndex = new Map();
    this.edges = [];
    this.onSelect = () => {};
    this.filter = "";
    this.selectedKey = null;
    this.needsFit = false;
    this.dragging = null;
    this.ns = "http://www.w3.org/2000/svg";

    svg.addEventListener("mousedown", (event) => this.#onCanvasMouseDown(event));
    svg.addEventListener("wheel", (event) => this.#onWheel(event), { passive: false });
    svg.addEventListener("contextmenu", (event) => event.preventDefault());
    svg.addEventListener("click", (event) => {
      if (event.target === svg) this.select(null);
    });
  }

  setFilter(text) {
    this.filter = text.trim().toLowerCase();
    this.#applyFilter();
  }

  setGraph(graph) {
    const nodes = graph?.nodes ?? [];
    const ports = graph?.ports ?? [];
    const edges = graph?.edges ?? [];
    const portsByNode = groupBy(ports, (port) => port.nodeId ?? "");

    this.portIndex = new Map(ports.map((port) => [port.portId, port]));
    this.edges = edges;
    this.layouts = nodes.map((node, index) => layoutNode(node, portsByNode.get(node.nodeId) ?? [], index));
    this.selectedKey = null;
    this.needsFit = true;
    this.#draw(edges);
    this.fit();
  }

  clear(message) {
    this.layouts = [];
    this.portIndex = new Map();
    this.edges = [];
    this.selectedKey = null;
    this.needsFit = false;
    this.svg.replaceChildren();
    if (message) this.svg.dataset.empty = message;
    else delete this.svg.dataset.empty;
  }

  select(key, silent = false) {
    this.selectedKey = key;
    for (const el of this.svg.querySelectorAll("[data-key]")) {
      el.classList.toggle("is-selected", el.dataset.key === key);
    }
    if (!silent) this.onSelect(this.#selectionPayload(key));
  }

  fit() {
    if (!this.layouts.length) return;
    const box = this.svg.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return;
    const pad = 80;
    const xs = this.layouts.map((item) => item.x);
    const ys = this.layouts.map((item) => item.y);
    const rights = this.layouts.map((item) => item.x + item.w);
    const bottoms = this.layouts.map((item) => item.y + item.h);
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const width = Math.max(1, Math.max(...rights) - minX + pad);
    const height = Math.max(1, Math.max(...bottoms) - minY + pad);
    const k = Math.min(box.width / width, box.height / height, 1.8);
    this.view = {
      x: (box.width - width * k) / 2 - minX * k,
      y: (box.height - height * k) / 2 - minY * k,
      k,
    };
    this.needsFit = false;
    this.#applyView();
  }

  #draw(edges) {
    const ns = this.ns;
    const root = document.createElementNS(ns, "g");
    root.id = "viewport";

    const wires = document.createElementNS(ns, "g");
    wires.classList.add("wires");
    for (const edge of edges) {
      const source = this.#portAnchor(edge.sourcePortId, "out");
      const target = this.#portAnchor(edge.targetPortId, "in");
      if (!source || !target) continue;
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", bezier(source.x, source.y, target.x, target.y));
      path.dataset.key = edgeKey(edge);
      path.dataset.kind = "edge";
      path.addEventListener("click", (event) => {
        event.stopPropagation();
        this.select(path.dataset.key);
      });
      wires.append(path);
    }
    root.append(wires);

    const nodes = document.createElementNS(ns, "g");
    nodes.classList.add("nodes");
    for (const layout of this.layouts) {
      nodes.append(this.#nodeGroup(layout));
    }
    root.append(nodes);

    this.svg.replaceChildren(root);
    this.#applyView();
    this.#applyFilter();
  }

  #nodeGroup(layout) {
    const ns = this.ns;
    const group = document.createElementNS(ns, "g");
    group.classList.add("node", KIND_CLASS[layout.node.kind] ?? "kind-operator");
    group.dataset.key = nodeKey(layout.node);
    group.dataset.kind = "node";
    group.dataset.search = [
      layout.node.name,
      layout.node.nickName,
      layout.node.kind,
      layout.node.typeId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    group.setAttribute("transform", `translate(${layout.x} ${layout.y})`);
    group.addEventListener("contextmenu", (event) => event.preventDefault());
    group.addEventListener("mousedown", (event) => {
      if (event.button !== 0 && event.button !== 2) return;
      event.preventDefault();
      event.stopPropagation();
      this.#dragNode(event, layout, group);
    });
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      this.select(group.dataset.key);
    });

    const body = document.createElementNS(ns, "rect");
    body.setAttribute("width", layout.w);
    body.setAttribute("height", layout.h);
    body.setAttribute("rx", layout.node.kind === "PARAMETER" ? 10 : 4);
    group.append(body);

    const title = document.createElementNS(ns, "text");
    title.setAttribute("x", 10);
    title.setAttribute("y", 17);
    title.textContent = layout.node.name || layout.node.nickName || layout.node.nodeId;
    group.append(title);

    const kind = document.createElementNS(ns, "text");
    kind.classList.add("kind-label");
    kind.setAttribute("x", layout.w - 8);
    kind.setAttribute("y", 17);
    kind.setAttribute("text-anchor", "end");
    kind.textContent = layout.node.kind ?? "";
    group.append(kind);

    for (const [ports, side] of [
      [layout.ins, "in"],
      [layout.outs, "out"],
    ]) {
      ports.forEach((port, index) => {
        const y = HEADER + 8 + index * PORT_ROW;
        const x = side === "in" ? 0 : layout.w;
        const dot = document.createElementNS(ns, "circle");
        dot.setAttribute("cx", x);
        dot.setAttribute("cy", y);
        dot.setAttribute("r", 4);
        dot.dataset.key = portKey(port);
        dot.dataset.kind = "port";
        dot.addEventListener("click", (event) => {
          event.stopPropagation();
          this.select(dot.dataset.key);
        });
        group.append(dot);

        const label = document.createElementNS(ns, "text");
        label.classList.add("port-label");
        label.setAttribute("x", side === "in" ? 10 : layout.w - 10);
        label.setAttribute("y", y + 3);
        label.setAttribute("text-anchor", side === "in" ? "start" : "end");
        label.textContent = port.name || port.portId.slice(0, 6);
        group.append(label);
      });
    }

    return group;
  }

  #portAnchor(portId, side) {
    const port = this.portIndex.get(portId);
    if (!port) return null;
    const layout = this.layouts.find((item) => item.node.nodeId === port.nodeId);
    if (!layout) return null;
    const list = side === "in" ? layout.ins : layout.outs;
    const index = Math.max(0, list.findIndex((item) => item.portId === portId));
    return {
      x: layout.x + (side === "in" ? 0 : layout.w),
      y: layout.y + HEADER + 8 + index * PORT_ROW,
    };
  }

  #selectionPayload(key) {
    if (!key) return null;
    if (key.startsWith("node:")) {
      const layout = this.layouts.find((item) => nodeKey(item.node) === key);
      return layout ? { type: "node", value: layout.node } : null;
    }
    if (key.startsWith("port:")) {
      const port = [...this.portIndex.values()].find((item) => portKey(item) === key);
      return port ? { type: "port", value: port } : null;
    }
    if (key.startsWith("edge:")) {
      const [, sourcePortId, targetPortId] = key.split(":");
      return {
        type: "edge",
        value: { sourcePortId, targetPortId },
      };
    }
    return null;
  }

  #applyFilter() {
    for (const node of this.svg.querySelectorAll(".node")) {
      const match = !this.filter || (node.dataset.search ?? "").includes(this.filter);
      node.classList.toggle("is-dimmed", !match);
    }
  }

  #applyView() {
    const viewport = this.svg.querySelector("#viewport");
    if (viewport) {
      viewport.setAttribute("transform", `translate(${this.view.x} ${this.view.y}) scale(${this.view.k})`);
    }
  }

  #onCanvasMouseDown(event) {
    if (event.button !== 0) return;
    if (findNodeGroup(event.target, this.svg)) return;
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

  #dragNode(event, layout, el) {
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = layout.x;
    const originY = layout.y;
    this.select(el.dataset.key);
    this.svg.classList.add("is-dragging-node");
    const move = (moveEvent) => {
      moveEvent.preventDefault();
      layout.x = originX + (moveEvent.clientX - startX) / this.view.k;
      layout.y = originY + (moveEvent.clientY - startY) / this.view.k;
      layout.node.x = layout.x;
      layout.node.y = layout.y;
      el.setAttribute("transform", `translate(${layout.x} ${layout.y})`);
      this.#updateWires();
    };
    const up = () => {
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", up, true);
      window.removeEventListener("contextmenu", prevent, true);
      this.svg.classList.remove("is-dragging-node");
      this.onSelect({ type: "node", value: layout.node });
    };
    const prevent = (contextEvent) => contextEvent.preventDefault();
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", up, true);
    window.addEventListener("contextmenu", prevent, true);
  }

  #updateWires() {
    for (const path of this.svg.querySelectorAll(".wires path")) {
      const edge = this.edges.find((item) => edgeKey(item) === path.dataset.key);
      if (!edge) continue;
      const source = this.#portAnchor(edge.sourcePortId, "out");
      const target = this.#portAnchor(edge.targetPortId, "in");
      if (!source || !target) continue;
      path.setAttribute("d", bezier(source.x, source.y, target.x, target.y));
    }
  }

  #onWheel(event) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    const box = this.svg.getBoundingClientRect();
    const mx = event.clientX - box.left;
    const my = event.clientY - box.top;
    const next = clamp(this.view.k * factor, 0.15, 4);
    const wx = (mx - this.view.x) / this.view.k;
    const wy = (my - this.view.y) / this.view.k;
    this.view.k = next;
    this.view.x = mx - wx * next;
    this.view.y = my - wy * next;
    this.#applyView();
  }
}

export function nodeKey(node) {
  return `node:${node.nodeId}`;
}

export function portKey(port) {
  return `port:${port.portId}`;
}

export function edgeKey(edge) {
  return `edge:${edge.sourcePortId}:${edge.targetPortId}`;
}

function layoutNode(node, ports, index) {
  const ins = ports.filter((port) => port.direction === "IN" || port.direction === "BOTH");
  const outs = ports.filter((port) => port.direction === "OUT" || port.direction === "BOTH");
  const label = node.name || node.nickName || node.nodeId;
  const width = Math.max(MIN_WIDTH, 24 + label.length * CHAR_W, 56 + (node.kind?.length ?? 0) * CHAR_W);
  const height = HEADER + Math.max(ins.length, outs.length, 1) * PORT_ROW + 10;
  const hasCoord = Number.isFinite(node.x) && Number.isFinite(node.y);
  return {
    node,
    ins,
    outs,
    w: width,
    h: height,
    x: hasCoord ? node.x : (index % 6) * 200,
    y: hasCoord ? node.y : Math.floor(index / 6) * 110,
  };
}

function bezier(x1, y1, x2, y2) {
  const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function findNodeGroup(el, root) {
  for (let current = el; current && current !== root; current = current.parentElement) {
    if (current.classList?.contains("node")) return current;
  }
  return null;
}
