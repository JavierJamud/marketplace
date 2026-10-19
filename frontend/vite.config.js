import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { ogMetaPlugin } from "./vite-plugins/ogMeta.js";
import { mediapipeAssets } from "./vite-plugins/mediapipeAssets.js";
import { stripDevNotes } from "./vite-plugins/stripDevNotes.js";

// Versión del sitio (v26.0.10): sale de package.json y se muestra en el pie de página.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Pone la versión en el splash de carga (index.html usa %APP_VERSION%).
const appVersionHtml = () => ({ name: "app-version-html", transformIndexHtml: (html) => html.replaceAll("%APP_VERSION%", version) });

// Compilación publicada (version.json): las pestañas abiertas la consultan para saber si corren una versión vieja (ver
// components/VersionWatcher.jsx). Mismo valor que __APP_BUILD__.
const build = `${version}-${Date.now().toString(36)}`;
const versionJson = () => ({
  name: "version-json",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version, build }) });
  },
});

export default defineConfig(({ mode }) => {
  // Prefijo "" (no solo "VITE_") — ogMeta.js también quiere leer
  // FRONTEND_URL si algún día se define, que no lleva ese prefijo.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), ogMetaPlugin(env), stripDevNotes(), mediapipeAssets(), appVersionHtml(), versionJson()],
    // __APP_BUILD__ cambia en cada compilación: invalida la caché guardada en el navegador (ver main.jsx) para que una respuesta con forma vieja nunca rompa una pantalla nueva.
    define: { __APP_VERSION__: JSON.stringify(version), __APP_BUILD__: JSON.stringify(build) },
    // Sin mapas de código ni comentarios en lo que se publica.
    // Sin mapas de código (traerían los comentarios internos del código fuente) y apuntando a navegadores actuales: así no se
    // incluyen transformaciones ni ayudas para navegadores viejos que casi nadie usa.
    build: { sourcemap: false, target: ["es2019", "chrome70", "safari12", "firefox68", "edge79"] },
    esbuild: { legalComments: "none" },
    server: { port: 5173, allowedHosts: true },
    // Vista previa local de la build (npm run preview): /api va al backend local, como hace Nginx en producción.
    preview: { port: 4173, proxy: { "/api": { target: "http://localhost:4000", rewrite: (path) => path.replace(/^\/api/, "") } } },
  };
});
