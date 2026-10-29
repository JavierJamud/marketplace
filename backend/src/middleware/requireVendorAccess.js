import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { planAllows, getPlanConfig } from "../lib/planConfig.js";

// Usuarios del equipo: son del plan de pago. Si la tienda bajó de plan, las cuentas se conservan pero no entran hasta que vuelva.
// Lo mismo con el tope de usuarios (maxStaffUsers): si la tienda pasa a un plan con menos usuarios que los activos, entran
// solo los más antiguos hasta llegar al tope y el resto queda en pausa (sus cuentas no se tocan). Antes solo se miraba el
// interruptor, así que bajar de plan dejaba entrar a todos aunque el plan nuevo permitiera menos.
async function assertStaffPlan(staff) {
  if (!staff) return;
  const vendor = await prisma.vendor.findUnique({ where: { id: staff.vendorId }, select: { planType: true } });
  if (!vendor) return;
  if (!(await planAllows(vendor.planType, "allowStaffUsers"))) {
    throw new AppError("El plan actual de la tienda no incluye usuarios del equipo. Pide al dueño que cambie de plan.", 403, { planRequired: "allowStaffUsers" });
  }
  const max = (await getPlanConfig(vendor.planType))?.maxStaffUsers ?? null;
  if (max === null) return;
  // Mismo orden en cada petición (fecha de alta y, si empatan, el id) para que el mismo grupo quede dentro siempre.
  const allowed = await prisma.vendorStaff.findMany({
    where: { vendorId: staff.vendorId, isActive: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: max,
    select: { id: true },
  });
  if (!allowed.some((s) => s.id === staff.id)) {
    throw new AppError("El plan actual de la tienda tiene menos usuarios del equipo que los activos. Pide al dueño que desactive a alguien o cambie de plan.", 403, { planRequired: "maxStaffUsers" });
  }
}

// Estado de la tienda en el servidor (auditoría run-2): antes el bloqueo solo lo aplicaba VendorLayout.jsx en pantalla.
// Tienda eliminada: nadie del panel entra. Bloqueada o suspendida: solo las rutas sin sección (las que carga la pantalla
// de bloqueo, como /vendors/me o los avisos); las secciones con datos y toda escritura quedan cerradas.
async function assertVendorUsable(req, staff, { strict }) {
  const where = staff ? { id: staff.vendorId } : { userId: req.user.id };
  const vendor = await prisma.vendor.findUnique({ where, select: { deletedAt: true, isBlocked: true, status: true, billingSuspendedAt: true } });
  if (!vendor) return; // el controlador responde "no tienes tienda"
  if (vendor.deletedAt) throw new AppError("Esta tienda fue eliminada.", 403, { vendorState: "deleted" });
  // Suspendida por falta de pago del plan: no se ve en público, pero el dueño sigue usando su panel completo para pagar y
  // dejarlo todo listo para volver (decisión de planBilling.service.js: la suspensión corta la tienda pública, no el
  // panel). El personal no puede pagar, así que con la tienda suspendida no entra ni a las rutas sin sección: antes seguía
  // vendiendo y editando como si nada, saltándose el "impago, limitado, suspendida" del plan.
  if (staff && vendor.billingSuspendedAt) {
    throw new AppError("La tienda está suspendida por falta de pago. Avisa al dueño.", 403, { vendorState: "billing" });
  }
  if (strict && (vendor.isBlocked || (vendor.status === "SUSPENDED" && !vendor.billingSuspendedAt))) {
    throw new AppError("Tu tienda está bloqueada. Revisa el aviso en tu panel.", 403, { vendorState: "blocked" });
  }
}

// Bloque 183 (pedido explícito — "solo le va a salir la sección de pedidos
// o la que él designe... las demás secciones él no las verá"): reemplaza
// requireRole("VENDOR","ADMIN") en las rutas del panel de vendedor que
// tienen una sección asignable de verdad. VENDOR/ADMIN pasan siempre
// (dueño de la tienda / soporte de la plataforma — igual que hoy, sin
// ningún cambio de comportamiento para ellos). Un VENDOR_STAFF (usuario de
// sistema) solo pasa si `section` está en su `allowedSections` Y sigue
// activo — el frontend ya oculta lo que no puede ver (VendorLayout.jsx
// filtra el NAV), pero la app real de la restricción es esto: nunca
// alcanza con ocultar un botón, cualquiera puede pegarle directo a la API.
//
// Sin argumentos (`requireVendorAccess()`) = "avísale que sos alguien del
// panel de este negocio, sin importar qué sección" — para endpoints que
// TODO usuario de sistema necesita sin importar su sección asignada (el
// propio /vendors/me para que cargue el layout, el buscador global, las
// notificaciones). Con más de una sección (`requireVendorAccess("pedidos",
// "mesas")`) alcanza con tener CUALQUIERA de las listadas — útil para
// acciones que en la práctica viven a caballo entre 2 pantallas (ej. crear
// un pedido manual desde Mesas).
export function requireVendorAccess(...sections) {
  return async (req, _res, next) => {
    if (!req.user) throw new AppError("No autenticado.", 401);

    if (req.user.role === "ADMIN") return next();
    if (req.user.role === "VENDOR") {
      await assertVendorUsable(req, null, { strict: sections.length > 0 });
      return next();
    }

    if (req.user.role === "VENDOR_STAFF") {
      const staff = await prisma.vendorStaff.findUnique({ where: { userId: req.user.id } });
      const hasAccess = sections.length === 0 || sections.some((s) => staff?.allowedSections.includes(s));
      if (staff?.isActive && hasAccess) {
        await assertVendorUsable(req, staff, { strict: sections.length > 0 });
        await assertStaffPlan(staff);
        req.vendorStaff = staff; // Disponible para quien lo necesite (ver vendorStaff.controller.js).
        return next();
      }
    }

    throw new AppError("No tienes permiso para esta sección.", 403);
  };
}

// Bloque 185 (pedido explícito — "también debe seleccionar qué permisos
// tendrá el usuario en esa sección, si solo lectura o modificar, si leer o
// escribir"): nivel efectivo de una sección para un usuario de sistema.
// Ausente en `sectionPermissions` (nunca configurado, o el usuario se creó
// antes de este bloque) = "manage" — nadie pierde funcionalidad de golpe
// con la migración que agregó la columna.
export function staffSectionLevel(staff, section) {
  return staff?.sectionPermissions?.[section] ?? "manage";
}

// Igual que requireVendorAccess, pero además exige nivel "manage" en AL
// MENOS una de las secciones listadas — para las rutas que escriben/
// modifican datos (crear, editar, borrar, cambiar de estado). Las rutas de
// solo lectura (listar/ver) siguen usando requireVendorAccess a secas: un
// usuario en "view" todavía necesita poder VER la sección, solo no tocarla.
// VENDOR/ADMIN nunca pasan por ningún chequeo de nivel — son el dueño de la
// tienda o soporte de la plataforma, sin restricciones de por sí.
export function requireVendorWrite(...sections) {
  return async (req, _res, next) => {
    if (!req.user) throw new AppError("No autenticado.", 401);

    if (req.user.role === "ADMIN") return next();
    if (req.user.role === "VENDOR") {
      await assertVendorUsable(req, null, { strict: true });
      return next();
    }

    if (req.user.role === "VENDOR_STAFF") {
      const staff = await prisma.vendorStaff.findUnique({ where: { userId: req.user.id } });
      if (staff?.isActive) await assertVendorUsable(req, staff, { strict: true });
      const hasWriteAccess =
        sections.length === 0
          ? staff?.allowedSections.length > 0
          : sections.some((s) => staff?.allowedSections.includes(s) && staffSectionLevel(staff, s) === "manage");
      if (staff?.isActive && hasWriteAccess) {
        await assertStaffPlan(staff);
        req.vendorStaff = staff;
        return next();
      }
    }

    throw new AppError("Tienes acceso de solo lectura a esta sección: no puedes modificarla.", 403);
  };
}
