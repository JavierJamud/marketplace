// Crea la cuenta administradora real, a mano, una sola vez — pensado para el
// primer arranque en producción (VPS de Hostinger), cuando la base recién
// desplegada todavía no tiene ningún usuario. A propósito NO es un endpoint
// HTTP: la única forma de convertirse en admin es tener acceso al propio
// servidor (SSH) y correr este script — así no existe ninguna URL pública
// que un desconocido pueda usar para volverse admin primero.
//
// Uso (por SSH, en el servidor, parado en backend/):
//   ADMIN_EMAIL=tu@correo.com ADMIN_PASSWORD='unaClaveLarga123!' node scripts/create-admin.js
//
// Si no pasás ADMIN_EMAIL/ADMIN_PASSWORD como variables de entorno, el
// script los pregunta de forma interactiva (la contraseña queda oculta
// mientras se escribe) — es la forma más segura, porque así no queda
// guardada en el historial de la terminal (bash history) ni en ningún
// archivo. ADMIN_FULL_NAME/ADMIN_PHONE son opcionales en ambos casos.
import { config as loadEnv } from "dotenv";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
// Mismo criterio que scripts/backup.js: preferí .env.<NODE_ENV> si existe.
const modeFile = join(rootDir, `.env.${process.env.NODE_ENV ?? "development"}`);
loadEnv({ path: existsSync(modeFile) ? modeFile : join(rootDir, ".env") });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Cola de líneas en vez de encadenar rl.question() una y otra vez: contra un
// stdin con pipe (no una terminal real), Node puede entregar el evento
// "line" de una pregunta futura ANTES de que el código vuelva a pedirla —
// question() lo pierde porque recién engancha su listener en ese momento.
// Escuchando "line" desde el arranque, ninguna respuesta se pierde sin
// importar cuándo llegue.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
const lineQueue = [];
const waiters = [];
rl.on("line", (line) => {
  if (waiters.length > 0) waiters.shift()(line);
  else lineQueue.push(line);
});

function nextLine() {
  if (lineQueue.length > 0) return Promise.resolve(lineQueue.shift());
  return new Promise((resolve) => waiters.push(resolve));
}

async function promptVisible(question) {
  process.stdout.write(question);
  const line = await nextLine();
  return line.trim();
}

// Sin dependencias nuevas: le pisa _writeToOutput mientras dura ESTA
// pregunta para que readline no haga eco de lo que se va tipeando — mismo
// truco mínimo documentado para esto sin instalar nada. Sin una terminal
// real de por medio (input con pipe/redirigido) no tiene sentido ocultar
// nada: se comporta como promptVisible.
async function promptHidden(question) {
  if (!process.stdin.isTTY) return promptVisible(question);

  const realWrite = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (str) => {
    if (str === question) realWrite(str);
  };
  process.stdout.write(question);
  const line = await nextLine();
  rl._writeToOutput = realWrite;
  process.stdout.write("\n");
  return line.trim();
}

async function main() {
  let email = process.env.ADMIN_EMAIL?.trim();
  let password = process.env.ADMIN_PASSWORD;
  let fullName = process.env.ADMIN_FULL_NAME?.trim() || null;
  let phone = process.env.ADMIN_PHONE?.trim() || null;

  if (!email) email = await promptVisible("Correo del admin: ");
  if (!EMAIL_RE.test(email)) throw new Error(`"${email}" no es un correo válido.`);

  if (!password) password = await promptHidden("Contraseña del admin (mínimo 8 caracteres): ");
  if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");

  if (!fullName) fullName = (await promptVisible("Nombre completo (opcional, Enter para omitir): ")) || null;
  if (!phone) phone = (await promptVisible("Teléfono (opcional, Enter para omitir): ")) || null;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error(
      `Ya existe una cuenta con ese correo (rol actual: ${existing.role}). ` +
        "Este script solo crea cuentas nuevas — para convertir una cuenta existente en admin, hacelo a mano desde Prisma Studio (npm run prisma:studio)."
    );
  }

  const otherAdmins = await prisma.user.count({ where: { role: "ADMIN" } });
  if (otherAdmins > 0) {
    const confirm = await promptVisible(
      `Ya existe(n) ${otherAdmins} cuenta(s) admin en esta base. Escribí CONFIRMAR para crear una más: `
    );
    if (confirm !== "CONFIRMAR") {
      console.log("Cancelado — no se creó ninguna cuenta.");
      return;
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.user.create({
    data: { email, passwordHash, fullName, phone, role: "ADMIN" },
  });

  console.log(`\nListo — cuenta admin creada: ${admin.email} (id: ${admin.id}).`);
  console.log("Entrá a /admin/ingresar con ese correo y la contraseña que acabás de definir.");
}

main()
  .catch((err) => {
    console.error(`\nError: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
