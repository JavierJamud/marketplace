import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..", "..");

// Carga .env.<NODE_ENV> si existe (ej. .env.development) y sino cae a .env
// a secas — así queda listo el patrón para cuando exista .env.production sin
// tener que tocar este archivo. Nunca se versiona ninguno de los dos (ver
// .gitignore); solo .env.example se commitea.
const modeFile = join(rootDir, `.env.${process.env.NODE_ENV ?? "development"}`);
loadEnv({ path: existsSync(modeFile) ? modeFile : join(rootDir, ".env") });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver .env.example)`);
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  integrationsEncryptionKey: required("INTEGRATIONS_ENCRYPTION_KEY"),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
};
