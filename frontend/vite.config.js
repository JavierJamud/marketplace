import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { ogMetaPlugin } from "./vite-plugins/ogMeta.js";
import { stripDevNotes } from "./vite-plugins/stripDevNotes.js";

export default defineConfig(({ mode }) => {
  // Prefijo "" (no solo "VITE_") — ogMeta.js también quiere leer
  // FRONTEND_URL si algún día se define, que no lleva ese prefijo.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), ogMetaPlugin(env), stripDevNotes()],
    // Sin mapas de código ni comentarios en lo que se publica.
    build: { sourcemap: false },
    esbuild: { legalComments: "none" },
    server: { port: 5173, allowedHosts: true },
  };
});
