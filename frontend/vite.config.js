import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { ogMetaPlugin } from "./vite-plugins/ogMeta.js";

export default defineConfig(({ mode }) => {
  // Prefijo "" (no solo "VITE_") — ogMeta.js también quiere leer
  // FRONTEND_URL si algún día se define, que no lleva ese prefijo.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), ogMetaPlugin(env)],
    server: { port: 5173 },
  };
});
