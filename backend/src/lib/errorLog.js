import { prisma } from "./prisma.js";

// Bloque 33: registro centralizado de errores técnicos reales — nunca
// reemplaza el try/catch/AppError que ya existe en cada punto de falla, es
// un registro ADICIONAL para que el admin tenga un solo lugar donde ver qué
// está fallando de verdad (ver AdminErrors.jsx), sin depender de revisar
// logs de servidor a mano. Nunca debe romper el flujo que lo llama: si
// ESCRIBIR el log de error falla (ej. la base cayó justo en ese momento),
// se traga en silencio — perder un registro de auditoría es aceptable,
// romper la respuesta real al cliente por un problema del logging no lo es.
export async function logError({ origin, message, context }) {
  try {
    await prisma.errorLog.create({
      data: {
        origin,
        message: String(message ?? "Error desconocido").slice(0, 4000),
        context: context ?? undefined,
      },
    });
  } catch (err) {
    console.error("[errorLog] no se pudo registrar el error en ErrorLog:", err.message);
  }
}
