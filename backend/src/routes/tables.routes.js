import { Router } from "express";
import * as tablesController from "../controllers/tables.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireVendorAccess, requireVendorWrite } from "../middleware/requireVendorAccess.js";

const router = Router();

// Vendedor (restaurante)
// Bloque 183 (pedido explícito — "solo le va a salir la sección de
// pedidos o la que él designe"): reemplaza requireRole("VENDOR","ADMIN")
// por requireVendorAccess(section) — VENDOR/ADMIN pasan igual que siempre,
// un usuario de sistema (VENDOR_STAFF) solo si tiene esa sección asignada.
// Bloque 185: de acá para abajo, todo lo que MODIFICA algo (crear/editar/
// borrar mesas, cambiar estado, cobrar, cancelar) pasa a requireVendorWrite
// — un usuario en modo "solo lectura" puede seguir viendo Mesas/Pedidos en
// vivo, pero el servidor rechaza cualquier acción real, sin importar lo que
// el frontend le muestre o esconda.
router.get("/me", authenticate, requireVendorAccess("mesas"), tablesController.listMyTables);
// Bloque 164: lista chica y dedicada para el popup de "pedido nuevo" (ver
// NewOrderPopup.jsx) — antes de /me/:id para que Express nunca intente
// matchear "pending-orders" contra ese patrón.
router.get("/pending-orders", authenticate, requireVendorAccess("pedidos"), tablesController.listPendingTableOrders);
// Bloque 188 (pedido explícito — "agregar alertas al sistema... cuando a
// un usuario o vendedor se le olvida cerrar una mesa o un pedido"): lista
// de solo lectura (cualquiera con acceso a Pedidos la ve), pero las 2 de
// abajo SÍ modifican el pedido (posponer el aviso, o ponerlo al día) —
// exigen modo escritura.
router.get("/stale-orders", authenticate, requireVendorAccess("pedidos"), tablesController.listStaleTableOrders);
router.patch("/orders/:tableOrderId/snooze-reminder", authenticate, requireVendorWrite("pedidos"), tablesController.snoozeStaleReminder);
router.patch("/orders/:tableOrderId/catch-up", authenticate, requireVendorWrite("pedidos"), tablesController.catchUpTableOrderStatus);
// Bloque 177: reconocer que el vendedor ya vio que el cliente sumó consumo
// a una cuenta ya aceptada — ver ackCustomerTableOrderUpdate.
router.patch("/orders/:tableOrderId/ack-customer-update", authenticate, requireVendorWrite("pedidos"), tablesController.ackCustomerTableOrderUpdate);
router.post("/me", authenticate, requireVendorWrite("mesas"), tablesController.createTable);
// Bloque 173/183: el mesero abre una cuenta manual en una mesa (nadie
// escaneó el QR todavía) — vive en la pantalla de Mesas pero es, en el
// fondo, crear un pedido — cualquiera de las 2 secciones alcanza (en modo
// escritura).
router.post("/me/:id/order", authenticate, requireVendorWrite("mesas", "pedidos"), tablesController.createManualTableOrder);
// Bloque 141: renombrar mesa, regenerar su QR (invalida el viejo — ver el
// comentario largo en regenerateTableQr) y eliminarla.
router.patch("/me/:id", authenticate, requireVendorWrite("mesas"), tablesController.updateTable);
router.post("/me/:id/regenerate-qr", authenticate, requireVendorWrite("mesas"), tablesController.regenerateTableQr);
router.delete("/me/:id", authenticate, requireVendorWrite("mesas"), tablesController.deleteTable);
router.patch("/orders/:tableOrderId/status", authenticate, requireVendorWrite("pedidos"), tablesController.updateKitchenStatus);
// Bloque 175: registro/historial de acciones sobre UN pedido de mesa —
// mismo ActivityLog que ya alimenta Admin > Actividad, filtrado a este id.
// Solo lectura — se queda en requireVendorAccess.
router.get("/orders/:tableOrderId/activity", authenticate, requireVendorAccess("pedidos", "mesas"), tablesController.getTableOrderActivity);
router.patch("/orders/:tableOrderId/clear", authenticate, requireVendorWrite("pedidos"), tablesController.clearTableOrder);
// Bloque 163: "entregado" es un paso propio, antes de "liberar mesa" — ver
// el comentario largo en markTableOrderDelivered (tables.controller.js).
router.patch("/orders/:tableOrderId/delivered", authenticate, requireVendorWrite("pedidos"), tablesController.markTableOrderDelivered);
// Bloque 158: modificar cantidades/productos de un pedido de mesa todavía
// sin aceptar — mismo criterio que PATCH /orders/:id/items (orders.routes.js).
router.patch("/orders/:tableOrderId/items", authenticate, requireVendorWrite("pedidos"), tablesController.updateTableOrderItems);
// Bloque 168: agregar consumo a una cuenta abierta (en cualquier momento
// hasta cobrarla/liberarla) — mismo criterio que PATCH .../items de arriba
// pero SUMA en vez de reemplazar (ver addTableOrderItem).
router.post("/orders/:tableOrderId/items/add", authenticate, requireVendorWrite("pedidos", "mesas"), tablesController.addTableOrderItem);
// Bloque 185: quitar una línea puntual de una cuenta abierta, o ajustarle
// la cantidad — ver el comentario largo en tables.controller.js.
router.patch("/orders/:tableOrderId/items/:itemId", authenticate, requireVendorWrite("pedidos", "mesas"), tablesController.updateTableOrderItemQuantity);
router.delete("/orders/:tableOrderId/items/:itemId", authenticate, requireVendorWrite("pedidos", "mesas"), tablesController.removeTableOrderItem);
// Bloque 190: avanzar el estado de UNA línea puntual (Revisando -> Preparando
// -> Listo) — para una ronda de consumo que el cliente agregó DESPUÉS de que
// la cuenta ya estaba en curso, independiente del resto de la cuenta.
router.patch("/orders/:tableOrderId/items/:itemId/status", authenticate, requireVendorWrite("pedidos", "mesas"), tablesController.updateTableOrderItemStatus);
// Bloque 167 (antes DELETE, Bloque 164 — ahora PATCH: cancelar ya no borra
// la fila, la actualiza con motivo, ver cancelTableOrder): botón "Cancelar"
// del popup de pedido nuevo.
router.patch("/orders/:tableOrderId/cancel", authenticate, requireVendorWrite("pedidos"), tablesController.cancelTableOrder);

// Público (cliente escaneando el QR)
router.get("/qr/:qrToken", tablesController.getTableByToken);
router.post("/qr/:qrToken/order", tablesController.createTableOrder);
// Bloque 158: seguimiento del pedido ya enviado — sin login, el `id` (cuid)
// es el token de acceso, igual que qrToken arriba.
router.get("/order/:id", tablesController.getTableOrderStatus);

export default router;
