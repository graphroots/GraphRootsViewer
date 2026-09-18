import { listDocuments, loadDocument } from "./api.js";
import { GraphCanvas, edgeKey } from "./canvas.js";

const DEFAULT_API = "/graphql";

const apiUrlInput = document.querySelector("#api-url");
const apiStatus = document.querySelector("#api-status");
const refreshButton = document.querySelector("#refresh");
const docList = document.querySelector("#doc-list");
const docSummary = document.querySelector("#doc-summary");
const inspector = document.querySelector("#inspector");
const inspectorTitle = document.querySelector("#inspector-title");
const graphMeta = document.querySelector("#graph-meta");
const canvasHint = document.querySelector("#canvas-hint");
const nodeFilter = document.querySelector("#node-filter");
const fitButton = document.querySelector("#fit");

const canvas = new GraphCanvas(document.querySelector("#canvas"));
const storedEdges = new Map();
let documents = [];
let activeKey = null;
let currentDocument = null;

apiUrlInput.value = localStorage.getItem("graphroots.graphqlUrl") || DEFAULT_API;

canvas.onSelect = (selection) => {
  if (!selection) {
    if (currentDocument) showDocument(currentDocument);
    return;
  }
  if (selection.type === "edge") {
    const edge = storedEdges.get(edgeKey(selection.value)) ?? selection.value;
    showEntity("Edge", edge);
    return;
  }
  showEntity(capitalize(selection.type), selection.value);
};

refreshButton.addEventListener("click", () => refreshDocuments());
apiUrlInput.addEventListener("change", () => {
  localStorage.setItem("graphroots.graphqlUrl", apiUrlInput.value.trim());
  refreshDocuments();
});
nodeFilter.addEventListener("input", () => canvas.setFilter(nodeFilter.value));
fitButton.addEventListener("click", () => canvas.fit());
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") canvas.select(null);
});

refreshDocuments();

function apiUrl() {
  return apiUrlInput.value.trim() || DEFAULT_API;
}

async function refreshDocuments() {
  setStatus("idle", "Loading…");
  docSummary.textContent = "Loading…";
  try {
    const data = await listDocuments(apiUrl());
    documents = data.documents.nodes;
    setStatus("ok", `${data.documents.totalCount} documents`);
    docSummary.textContent = data.documents.totalCount
      ? `${data.documents.totalCount} stored version${data.documents.totalCount === 1 ? "" : "s"}`
      : "Database is empty. Import a GH/GHX file through GraphApi first.";
    renderDocumentList();
    if (!documents.length) {
      clearGraph("No documents in the store.");
      showMessage("Properties", "Nothing to inspect yet.");
      return;
    }
    const next = documents.find((doc) => docKey(doc) === activeKey) ?? documents[0];
    await openDocument(next);
  } catch (error) {
    documents = [];
    setStatus("error", "API unreachable");
    docSummary.textContent = error.message;
    docList.replaceChildren();
    clearGraph("Could not reach GraphApi.");
    showMessage("Properties", error.message);
  }
}

function renderDocumentList() {
  docList.replaceChildren(
    ...documents.map((doc) => {
      const item = document.createElement("li");
      item.classList.toggle("is-active", docKey(doc) === activeKey);
      item.innerHTML = `
        <strong>${escapeHtml(doc.fileName || "Untitled document")}</strong>
        <small>${escapeHtml(shortId(doc.documentId))} · ${doc.stats.nodeCount} nodes · ${doc.stats.edgeCount} edges</small>
        <div class="badges">
          <span class="badge">${escapeHtml(doc.origin)}</span>
          ${doc.isNested ? '<span class="badge">nested</span>' : ""}
          ${doc.committed ? '<span class="badge">committed</span>' : ""}
        </div>
      `;
      item.addEventListener("click", () => openDocument(doc));
      return item;
    }),
  );
}

async function openDocument(doc) {
  activeKey = docKey(doc);
  renderDocumentList();
  canvasHint.textContent = "Loading graph…";
  canvasHint.classList.remove("is-hidden");
  try {
    const data = await loadDocument(apiUrl(), doc.documentId, doc.versionId);
    currentDocument = data.document;
    storedEdges.clear();
    for (const edge of currentDocument.graph.edges) {
      storedEdges.set(edgeKey(edge), edge);
    }
    canvas.setGraph(currentDocument.graph);
    canvasHint.classList.add("is-hidden");
    graphMeta.textContent = `${currentDocument.stats.nodeCount} nodes · ${currentDocument.stats.portCount} ports · ${currentDocument.stats.edgeCount} edges`;
    showDocument(currentDocument);
  } catch (error) {
    clearGraph(error.message);
    showMessage("Properties", error.message);
  }
}

function showDocument(doc) {
  inspectorTitle.textContent = "Document";
  inspector.replaceChildren(
    statsRow(doc.stats),
    heading("Identity"),
    table({
      fileName: doc.fileName,
      documentId: doc.documentId,
      versionId: doc.versionId,
      origin: doc.origin,
      committed: doc.committed,
      isNested: doc.isNested,
      filePath: doc.filePath,
      fileCreationTimeUtc: doc.fileCreationTimeUtc,
      fileLastWriteTimeUtc: doc.fileLastWriteTimeUtc,
    }),
    heading("Counts by kind"),
    table(Object.fromEntries((doc.stats.countsByKind ?? []).map((item) => [item.key, item.count]))),
    heading("Counts by type"),
    table(Object.fromEntries((doc.stats.countsByTypeId ?? []).map((item) => [item.key, item.count]))),
    heading("Libraries"),
    tableFromList(doc.libraries ?? [], (lib) => ({
      name: lib.name || lib.library?.name,
      libraryId: lib.libraryId,
      version: lib.version,
      assemblyVersion: lib.assemblyVersion,
      origin: lib.origin,
    })),
    heading("Extensions"),
    extensionsTable(doc.extensions),
  );
}

function showEntity(title, value) {
  inspectorTitle.textContent = title;
  const { extensions, ...fields } = value;
  inspector.replaceChildren(
    heading(title),
    table(fields),
    heading("Extensions"),
    extensionsTable(extensions),
  );
}

function showMessage(title, message) {
  inspectorTitle.textContent = title;
  inspector.innerHTML = `<p class="muted">${escapeHtml(message)}</p>`;
}

function clearGraph(message) {
  currentDocument = null;
  storedEdges.clear();
  canvas.clear();
  graphMeta.textContent = "";
  canvasHint.textContent = message;
  canvasHint.classList.remove("is-hidden");
}

function setStatus(state, text) {
  apiStatus.dataset.state = state;
  apiStatus.textContent = text;
}

function statsRow(stats) {
  const wrap = document.createElement("div");
  wrap.className = "stats";
  for (const [label, value] of [
    ["Nodes", stats.nodeCount],
    ["Ports", stats.portCount],
    ["Edges", stats.edgeCount],
  ]) {
    const item = document.createElement("div");
    item.className = "stat";
    item.innerHTML = `<b>${value}</b><span class="muted">${label}</span>`;
    wrap.append(item);
  }
  return wrap;
}

function heading(text) {
  const el = document.createElement("h3");
  el.textContent = text;
  return el;
}

function table(record) {
  if (!record || !Object.keys(record).length) return emptyNote("None");
  const el = document.createElement("table");
  el.className = "kv";
  el.innerHTML = Object.entries(record)
    .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${formatCell(value)}</td></tr>`)
    .join("");
  return el;
}

function tableFromList(items, mapFn) {
  if (!items.length) return emptyNote("None");
  const wrap = document.createElement("div");
  for (const item of items) wrap.append(table(mapFn(item)));
  return wrap;
}

function extensionsTable(extensions) {
  if (!extensions?.length) return emptyNote("None");
  return table(Object.fromEntries(extensions.map((item) => [item.key, item.value])));
}

function emptyNote(text) {
  const el = document.createElement("p");
  el.className = "muted";
  el.textContent = text;
  return el;
}

function formatCell(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "object") return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  return escapeHtml(String(value));
}

function docKey(doc) {
  return `${doc.documentId}:${doc.versionId}`;
}

function shortId(value) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
