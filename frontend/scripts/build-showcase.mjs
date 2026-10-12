// Compila la animación del Hero (public/baznova-showcase/app/*.jsx) a un solo JavaScript normal.
// Antes la página cargaba Babel completo (casi 3 MB) y compilaba el JSX en el navegador de cada visitante, lo que en
// teléfonos con poca memoria cerraba la pestaña. Se ejecuta con:  npm run build:showcase  y se sube el resultado.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "baznova-showcase", "app");
const parts = ["runtime.jsx", "showcase.jsx"].map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
parts.push("ReactDOM.createRoot(document.getElementById('root')).render(<BaznovaShowcase />);");

const { code } = await transform(parts.join("\n"), { loader: "jsx", minify: true, target: "es2019" });
fs.writeFileSync(path.join(dir, "showcase.bundle.js"), code);
console.log(`showcase.bundle.js: ${(code.length / 1024).toFixed(1)} KB`);
