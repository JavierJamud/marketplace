import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

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

    if (req.user.role === "VENDOR" || req.user.role === "ADMIN") return next();

    if (req.user.role === "VENDOR_STAFF") {
      const staff = await prisma.vendorStaff.findUnique({ where: { userId: req.user.id } });
      const hasAccess = sections.length === 0 || sections.some((s) => staff?.allowedSections.includes(s));
      if (staff?.isActive && hasAccess) {
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

    if (req.user.role === "VENDOR" || req.user.role === "ADMIN") return next();

    if (req.user.role === "VENDOR_STAFF") {
      const staff = await prisma.vendorStaff.findUnique({ where: { userId: req.user.id } });
      const hasWriteAccess =
        sections.length === 0
          ? staff?.allowedSections.length > 0
          : sections.some((s) => staff?.allowedSections.includes(s) && staffSectionLevel(staff, s) === "manage");
      if (staff?.isActive && hasWriteAccess) {
        req.vendorStaff = staff;
        return next();
      }
    }

    throw new AppError("Tienes acceso de solo lectura a esta sección — no puedes modificarla.", 403);
  };
}
