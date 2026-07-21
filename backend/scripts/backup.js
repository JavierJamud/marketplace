// Backup simple de Postgres con pg_dump + rotación básica.
// Uso: npm run db:backup   (ver README.md raíz para cómo programarlo con cron/Task Scheduler)
import { config as loadEnv } from "dotenv";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
// Mismo criterio que src/config/env.js: preferí .env.<NODE_ENV> si existe.
const modeFile = join(rootDir, `.env.${process.env.NODE_ENV ?? "development"}`);
loadEnv({ path: existsSync(modeFile) ? modeFile : join(rootDir, ".env") });
const BACKUP_DIR = process.env.BACKUP_DIR ?? join(__dirname, "..", "backups");
const KEEP_LAST = Number(process.env.BACKUP_KEEP_LAST ?? 14);

function parseDatabaseUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Falta DATABASE_URL en el entorno.");

  const { host, port, user, password, database } = parseDatabaseUrl(databaseUrl);
  mkdirSync(BACKUP_DIR, { recursive: true });

  const file = join(BACKUP_DIR, `zeudin_${timestamp()}.dump`);

  const pgDumpBin = process.env.PG_DUMP_PATH ?? "pg_dump";

  await new Promise((resolve, reject) => {
    execFile(
      pgDumpBin,
      ["-h", host, "-p", port, "-U", user, "-d", database, "-F", "c", "-f", file],
      { env: { ...process.env, PGPASSWORD: password } },
      (error, _stdout, stderr) => {
        if (error) return reject(new Error(stderr || error.message));
        resolve();
      }
    );
  });
  console.log(`Backup creado: ${file}`);

  // Rotación: conserva solo los KEEP_LAST más recientes.
  const dumps = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("zeudin_") && f.endsWith(".dump"))
    .map((f) => ({ f, mtime: statSync(join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const { f } of dumps.slice(KEEP_LAST)) {
    unlinkSync(join(BACKUP_DIR, f));
    console.log(`Backup viejo eliminado: ${f}`);
  }
}

main().catch((err) => {
  console.error("Error al hacer backup:", err.message);
  process.exit(1);
});
