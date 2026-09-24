import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const port = env.PORT || "3000";
  return {
    plugins: [react()],
    root: "client",
    build: {
      outDir: "../dist/client",
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      proxy: {
        "/api": `http://localhost:${port}`,
      },
    },
  };
});
