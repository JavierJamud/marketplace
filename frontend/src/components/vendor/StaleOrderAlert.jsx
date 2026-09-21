import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.jsx";
import { canWriteSection } from "../../lib/vendorSections.js";

const POLL_MS = 60000;

// Bloque 188 (pedido explícito — "agregar alertas al sistema que se
// mostrarán en forma de popup en medio de la pantalla cuando a un usuario
// o vendedor se le olvida cerrar una mesa o un pedido, es decir el pedido
// está aún en estado de preparando pero ya se entregó en la mesa... le debe
// salir una alerta que notifique... o se le preguntará si el pedido cambió
// ya de estado o aún se mantiene, y en caso de que haya cambiado se le
// pedirá cuál es el estado del pedido en esa mesa"): montado a nivel de
// layout (mismo criterio que NewOrderPopup.jsx) — un pedido "olvidado" es
// el que lleva más del umbral de su estado SIN avanzar de verdad
// (statusChangedAt, backend). El sistema nunca asume qué pasó en la
// realidad — siempre pregunta primero.
// Un pedido RECEIVED sin aceptar nunca aparece acá (ya lo cubre
// NewOrderPopup con su propio aviso permanente) — ver STALE_THRESHOLD_MS
// en tables.controller.js — así que los 2 modales nunca compiten por el
// mismo pedido a la vez.
const CATCH_UP_OPTIONS = [
  { target: "PREPARING", label: "Preparando", level: 1 },
  { target: "READY", label: "Listo (sin entregar)", level: 2 },
  { target: "DELIVERED", label: "Entregado (falta cobrar)", level: 3 },
  { target: "CLEARED", label: "Cobrado — mesa liberada", level: 4 },
];
const CURRENT_LEVEL = { RECEIVED: 0, PREPARING: 1, READY: 2 };

export function StaleOrderAlert({ vendor, enabled = true, staffSectionPermissions = null }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState("ask"); // "ask" | "pick"

  const { data: orders } = useQuery({
    queryKey: ["stale-table-orders"],
    queryFn: async () => (await api.get("/tables/stale-orders")).data.orders,
    enabled: !!vendor?.isRestaurant && enabled,
    refetchInterval: POLL_MS,
  });

  const canManage = canWriteSection(staffSectionPermissions, "pedidos");

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["stale-table-orders"] });
    queryClient.invalidateQueries({ queryKey: ["pending-table-orders"] });
    queryClient.invalidateQueries({ queryKey: ["my-tables"] });
    queryClient.invalidateQueries({ queryKey: ["my-orders"] });
    queryClient.invalidateQueries({ queryKey: ["table-order-status"] });
    queryClient.invalidateQueries({ queryKey: ["table-order-activity"] });
  };

  const snooze = useMutation({
    mutationFn: async (id) => (await api.patch(`/tables/orders/${id}/snooze-reminder`)).data,
    onSuccess: () => {
      toast.success("Listo — te lo recordamos de nuevo en un rato si sigue igual.");
      setStep("ask");
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo posponer el aviso."),
  });

  const catchUp = useMutation({
    mutationFn: async ({ id, target }) => (await api.patch(`/tables/orders/${id}/catch-up`, { target })).data,
    onSuccess: () => {
      toast.success("Pedido puesto al día.");
      setStep("ask");
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el pedido."),
  });

  if (!vendor?.isRestaurant || !orders || orders.length === 0) return null;

  // Uno a la vez — el más atrasado primero (el backend ya lo ordena así).
  const order = orders[0];
  const tableLabel = order.table.label || `Mesa ${order.table.tableNumber}`;
  const currentLevel = order.deliveredAt ? 3 : CURRENT_LEVEL[order.kitchenStatus];
  const options = CATCH_UP_OPTIONS.filter((o) => o.level > currentLevel);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-inverse-surface/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-2xl animate-fade-up">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-error/10">
            <AlertTriangle className="h-5 w-5 text-error" />
          </div>
          <div>
            <h2 className="text-title-lg font-bold text-on-surface">¿Sigue así este pedido?</h2>
            <p className="text-[12.5px] text-outline">
              {tableLabel} · Pedido #{order.orderNumber}
            </p>
          </div>
        </div>

        <p className="mb-5 text-[13.5px] leading-relaxed text-on-surface-variant">
          Lleva <strong className="text-on-surface">{order.minutesInStatus} min</strong> registrado como{" "}
          <strong className="text-on-surface">"{order.reasonLabel}"</strong> sin ningún cambio. Si ya avanzó en la mesa, actualizalo acá
          mismo para que el cliente y el resto del equipo vean el estado real en Pedidos.
        </p>

        {!canManage ? (
          <p className="rounded-lg bg-surface-container px-3.5 py-2.5 text-center text-[12px] text-outline">
            Tienes acceso de solo lectura a Pedidos — avísale a alguien con permiso para actualizarlo.
          </p>
        ) : step === "ask" ? (
          <div className="flex flex-col gap-2">
            <Button className="w-full" disabled={catchUp.isPending} onClick={() => setStep("pick")}>
              Ya cambió de estado
            </Button>
            <Button variant="outline" className="w-full" disabled={snooze.isPending} onClick={() => snooze.mutate(order.id)}>
              {snooze.isPending ? "Posponiendo..." : "Sigue igual — recordámelo en un rato"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="mb-1 text-[11.5px] font-bold uppercase tracking-wide text-outline">¿Cuál es el estado real ahora?</p>
            {options.map((o) => (
              <Button
                key={o.target}
                variant="outline"
                className="w-full justify-start"
                disabled={catchUp.isPending}
                onClick={() => catchUp.mutate({ id: order.id, target: o.target })}
              >
                {o.label}
              </Button>
            ))}
            <button
              onClick={() => setStep("ask")}
              className="mt-1 flex items-center justify-center gap-1 text-[12px] font-semibold text-outline hover:text-on-surface"
            >
              <ArrowLeft className="h-3 w-3" /> Volver
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
