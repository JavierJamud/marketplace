import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { ShoppingBag, CheckCircle2, Eye } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatElapsed } from "../../lib/duration.js";
import { playNewOrderSound } from "../../lib/orderNotificationSound.js";
import { Button } from "../ui/Button.jsx";
import { canWriteSection } from "../../lib/vendorSections.js";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Bloque 231 (bug real reportado en vivo — "cuando entra un pedido nuevo el
// panel de vendedor no suena ni muestra la notificación"): NewOrderPopup.jsx
// (el aviso con sonido que ya existía) solo corre para pedidos de MESA
// (vendor.isRestaurant) — un pedido normal (Checkout.jsx, cualquier tienda)
// nunca tuvo ningún popup ni sonido propio, solo la campanita genérica
// (poll de 20s, sin sonido). Mismo esqueleto que NewOrderPopup.jsx: reusa
// playNewOrderSound() y el mismo criterio de "solo suena a partir de la 2ª
// lectura" para que la carga inicial del panel nunca dispare el sonido con
// pedidos que ya estaban ahí de antes.
//
// A diferencia del pedido de mesa (que fuerza aceptar/rechazar antes de
// seguir), un pedido normal SÍ se puede descartar del aviso sin decidir
// nada — el vendedor y el cliente siempre pueden ver el estado real en la
// sección de Pedidos (pedido explícito), así que "Ver en Pedidos" es una
// salida válida, no solo "Confirmar pedido" acá mismo.
const POLL_MS = 4000;

export function NewRegularOrderPopup({ vendor, enabled = true, staffSectionPermissions = null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = canWriteSection(staffSectionPermissions, "pedidos");
  const seenKeysRef = useRef(new Set());
  const firstLoadRef = useRef(true);
  // IDs descartados con "Ver en Pedidos"/cerrado a mano en esta sesión del
  // panel — nunca cambia nada en el backend, solo evita que el MISMO aviso
  // vuelva a taparle la pantalla hasta que llegue uno realmente nuevo.
  const [dismissedIds, setDismissedIds] = useState(() => new Set());

  // Mismo queryKey/endpoint que ya usa VendorOrders.jsx (GET /orders/me) —
  // comparten una sola consulta cacheada en vez de 2 fuentes de verdad
  // distintas para "mis pedidos".
  const { data } = useQuery({
    queryKey: ["my-orders"],
    queryFn: async () => (await api.get("/orders/me")).data,
    enabled: !!vendor && enabled,
    refetchInterval: POLL_MS,
  });

  useEffect(() => {
    if (!data?.orders) return;
    const keys = data.orders.filter((o) => o.status === "NEW").map((o) => o.id);
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      seenKeysRef.current = new Set(keys);
      return;
    }
    const isNew = keys.some((k) => !seenKeysRef.current.has(k));
    if (isNew) playNewOrderSound();
    seenKeysRef.current = new Set(keys);
  }, [data]);

  const confirm = useMutation({
    mutationFn: async (id) => (await api.post(`/orders/${id}/confirm`)).data,
    onSuccess: () => {
      toast.success("Pedido confirmado, stock actualizado.");
      queryClient.invalidateQueries({ queryKey: ["my-orders"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo confirmar el pedido."),
  });

  const pendingOrders = (data?.orders ?? []).filter((o) => o.status === "NEW" && !dismissedIds.has(o.id));
  if (!vendor || !enabled || pendingOrders.length === 0) return null;

  // Igual que NewOrderPopup.jsx: solo el más viejo a la vez — si entran
  // varios juntos, el siguiente aparece solo apenas se resuelve/descarta
  // este.
  const order = pendingOrders[0];

  function dismiss() {
    setDismissedIds((prev) => new Set(prev).add(order.id));
  }
  function goToOrders() {
    dismiss();
    navigate("/vendedor/pedidos");
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-inverse-surface/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-2xl animate-fade-up">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-secondary-container">
            <ShoppingBag className="h-5 w-5 text-on-secondary-container" />
          </div>
          <div>
            <h2 className="text-title-lg font-bold text-on-surface">¡Pedido nuevo!</h2>
            <p className="text-[12.5px] text-outline">
              {order.code} · hace {formatElapsed(order.createdAt)}
            </p>
          </div>
        </div>

        {order.customerName && (
          <p className="mb-3 text-[13px] text-on-surface-variant">
            Pidió: <span className="font-semibold text-on-surface">{order.customerName}</span>
          </p>
        )}

        <div className="mb-4 space-y-1.5">
          {order.items.map((it, i) => (
            <div key={i} className="flex items-center justify-between rounded-md bg-surface-container px-3 py-2 text-[13px]">
              <span className="text-on-surface">
                {it.quantity} × {it.name}
                {it.size && ` (${it.size})`}
              </span>
              <span className="font-semibold text-on-surface-variant">{fmtCUP(it.price * it.quantity)}</span>
            </div>
          ))}
        </div>

        <div className="mb-5 flex items-center justify-between border-t border-surface-container-high pt-3.5">
          <span className="text-[13px] font-semibold text-on-surface-variant">Total</span>
          <span className="text-[18px] font-bold text-primary">{fmtCUP(order.total)}</span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {canManage && (
            <Button
              className="flex-1"
              disabled={confirm.isPending}
              onClick={() => {
                confirm.mutate(order.id);
                dismiss();
              }}
            >
              <CheckCircle2 className="h-4 w-4" /> {confirm.isPending ? "Confirmando..." : "Confirmar pedido"}
            </Button>
          )}
          <Button variant="outline" className="flex-1" onClick={goToOrders}>
            <Eye className="h-3.5 w-3.5" /> Ver en Pedidos
          </Button>
        </div>
      </div>
    </div>
  );
}
