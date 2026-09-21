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

const port = Number(process.env.PORT ?? 4000);

// Bloque 183 (bug real pre-existente encontrado al armar el link del nuevo
// correo de invitación de usuarios — se repite en TODOS los templates de
// email y en los redirect_url de Stripe): FRONTEND_URL admite una lista
// separada por comas para el allowlist de CORS (varios orígenes válidos,
// ver app.js) pero `env.frontendUrl` se usaba DIRECTO como si fuera una
// sola URL en cada botón de cada email y en Stripe — con más de un origen
// configurado (que es el caso real de este .env desde antes de hoy),
// terminaba armando un link literal roto tipo
// "http://localhost:5173,http://localhost:5174/vendedor". `frontendUrl`
// (singular) pasa a ser SIEMPRE el primero de la lista — el que de verdad
// hace de "URL pública principal" para armar links — y `frontendUrls`
// (plural, array) es la lista completa, solo para el allowlist de CORS.
const rawFrontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
const frontendUrls = rawFrontendUrl.split(",").map((u) => u.trim()).filter(Boolean);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port,
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  integrationsEncryptionKey: required("INTEGRATIONS_ENCRYPTION_KEY"),
  frontendUrl: frontendUrls[0],
  frontendUrls,
  // Bloque 49: para armar URLs absolutas de archivos servidos por este
  // mismo backend (ej. el logo de la plataforma) en contextos que no tienen
  // el origin del navegador — un correo, un PDF. request.protocol/host no
  // sirve acá porque estos se generan fuera de un ciclo request/response.
  backendUrl: process.env.BACKEND_URL ?? `http://localhost:${port}`,
};
