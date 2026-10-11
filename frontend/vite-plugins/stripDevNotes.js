import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { transformSync } from "esbuild";

// Lo que se sirve al navegador no lleva notas de desarrollo: ni comentarios HTML, ni comentarios dentro de los
// scripts y estilos en línea del index.html, ni en los archivos sueltos de /public que se copian tal cual. Así, al
// inspeccionar la página solo se ve código. El código fuente conserva sus comentarios; esto actúa al servir y al compilar.

const cssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

function cleanScript(code) {
  try {
    return transformSync(code, { loader: "js", legalComments: "none" }).code.trim();
  } catch {
    return code;
  }
}

export function cleanHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g, (m, attrs, code) => {
      const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
      if (type && type !== "module" && type !== "text/javascript") return m;
      return `<script${attrs}>${cleanScript(code)}</script>`;
    })
    .replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (m, attrs, css) => `<style${attrs}>${cssComments(css)}</style>`);
}

// Archivos de /public que se sirven sin pasar por el compilador (el cargador del logo tiene CSS dentro de una cadena).
const PUBLIC_FILES = ["logo-loader.js"];
export function cleanPublicScript(code) {
  // También las líneas de comentario que quedan dentro de cadenas de plantilla, que el compilador no toca.
  return cleanScript(cssComments(code)).replace(/^[ \t]*\/\/.*\n?/gm, "");
}

export function stripDevNotes() {
  let outDir = "dist";
  let root = process.cwd();
  return {
    name: "strip-dev-notes",
    configResolved(config) {
      outDir = config.build.outDir;
      root = config.root;
    },
    transformIndexHtml: { order: "post", handler: (html) => cleanHtml(html) },
    // En desarrollo, los archivos de /public se limpian al responder.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = PUBLIC_FILES.find((f) => req.url?.split("?")[0] === `/${f}`);
        if (!name) return next();
        const file = join(root, "public", name);
        if (!existsSync(file)) return next();
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.end(cleanPublicScript(readFileSync(file, "utf8")));
      });
    },
    // Al compilar, se limpian las copias que quedan en la carpeta de salida.
    closeBundle() {
      for (const name of PUBLIC_FILES) {
        const file = resolve(root, outDir, name);
        if (existsSync(file)) writeFileSync(file, cleanPublicScript(readFileSync(file, "utf8")));
      }
    },
  };
}
