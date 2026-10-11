import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { ogMetaPlugin } from "./vite-plugins/ogMeta.js";
import { stripDevNotes } from "./vite-plugins/stripDevNotes.js";

// Versión del sitio (v26.0.10): sale de package.json y se muestra en el pie de página.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig(({ mode }) => {
  // Prefijo "" (no solo "VITE_") — ogMeta.js también quiere leer
  // FRONTEND_URL si algún día se define, que no lleva ese prefijo.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), ogMetaPlugin(env), stripDevNotes()],
    define: { __APP_VERSION__: JSON.stringify(version) },
    // Sin mapas de código ni comentarios en lo que se publica.
    build: { sourcemap: false },
    esbuild: { legalComments: "none" },
    server: { port: 5173, allowedHosts: true },
  };
});
