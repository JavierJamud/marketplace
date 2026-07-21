import { PrismaClient } from "@prisma/client";

// Bloque 17 (auditoría de seguridad) — por qué no hay Row Level Security de
// Postgres acá: RLS necesita que cada conexión/transacción le diga a
// Postgres "quién" está preguntando (ej. SET LOCAL app.current_user_id) para
// que una política pueda comparar contra eso. Esta app usa un único
// PrismaClient con un pool de conexiones compartido y un solo rol de DB — no
// existe ninguna variable de sesión por request, así que una política RLS
// no tendría nada contra qué filtrar. Retrofit real de RLS implicaría
// envolver cada query en una transacción que primero haga SET LOCAL con el
// id resuelto del JWT — un cambio de arquitectura grande, no algo para
// agregar a ciegas en un bloque de pulido.
//
// La protección real hoy (y la que de hecho importa) es a nivel aplicación:
// cada controller que lee/escribe datos de un vendor o de un user siempre
// resuelve el dueño desde req.user.id (JWT) — nunca confía en un id que
// mande el cliente — antes de tocar la fila (ver resolveMyVendor, y el
// patrón `existing.vendorId !== vendor.id` repetido en products/orders/
// tables/vendors/verification.controller.js). Auditado en Bloque 17: todos
// los endpoints que toman un :id de ruta fueron revisados uno por uno.
export const prisma = new PrismaClient();
