import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/graphql": {
        target: "http://127.0.0.1:5088",
        changeOrigin: true,
      },
    },
  },
});
