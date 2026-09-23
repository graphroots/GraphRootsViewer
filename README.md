# GraphRoots Viewer

A small browser explorer for graphs stored through [GraphRootsApi](../GraphRootsApi). It does not talk to Neo4j directly. It calls the GraphQL API, which reads the `GraphRoots` database.

## Run

1. Start Neo4j and GraphApi as described in `GraphRootsApi/README.md`.
2. Import at least one Grasshopper file so the store is not empty.
3. From this folder:

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). In development the viewer proxies `/graphql` to GraphApi at `http://127.0.0.1:5088/graphql`. You can also point the GraphQL field at that URL directly after GraphApi is restarted with localhost CORS.

The page lists stored documents, draws the selected document using canvas `x`/`y` when present, and shows document / node / port / edge properties on the right. Drag to pan, scroll to zoom, and use **Fit** to frame the graph.
