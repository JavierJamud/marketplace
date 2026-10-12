import fs from "node:fs";
import path from "node:path";

// Sirve los archivos WebAssembly de MediaPipe (detección de rostro) desde /mediapipe/wasm. Se toman de node_modules en
// desarrollo y se copian al build en producción, así no pesan en el repositorio (son unos 26 MB).
const SRC = path.resolve("node_modules/@mediapipe/tasks-vision/wasm");
const FILES = ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"];

export function mediapipeAssets() {
  return {
    name: "baznova-mediapipe-assets",
    configureServer(server) {
      server.middlewares.use("/mediapipe/wasm", (req, res, next) => {
        const name = path.basename((req.url ?? "").split("?")[0]);
        if (!FILES.includes(name)) return next();
        res.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        fs.createReadStream(path.join(SRC, name)).pipe(res);
      });
    },
    writeBundle(options) {
      const out = path.join(options.dir ?? "dist", "mediapipe", "wasm");
      fs.mkdirSync(out, { recursive: true });
      for (const f of FILES) fs.copyFileSync(path.join(SRC, f), path.join(out, f));
    },
  };
}
