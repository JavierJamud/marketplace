import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import toast from "../lib/toast.jsx";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "long", year: "numeric" });
}

// Mismo GRACE_PERIOD_DAYS que auth.controller.js — el backend no manda la
// fecha de borrado final calculada en /auth/me, solo deletionRequestedAt.
export function deletionScheduledFor(requestedAtIso) {
  if (!requestedAtIso) return null;
  return new Date(new Date(requestedAtIso).getTime() + 30 * 24 * 60 * 60 * 1000);
}

// Bloque 211 (pedido explícito — "una vez el cliente inicie el proceso de
// eliminación... le debería aparecer un botón para reactivar su cuenta"):
// pantalla completa que reemplaza el panel real mientras dure el período de
// gracia — mismo lenguaje visual que VendorAccessBlockedGate
// (VendorLayout.jsx), reusado en el panel de cliente, de vendedor y de
// personal. `canReactivate=false` es el caso de personal viendo el panel de
// una tienda cuyo DUEÑO pidió la baja (no la suya propia) — ahí solo se
// informa, reactivar es decisión del dueño.
export function AccountPendingDeletionNotice({ scheduledFor, canReactivate = true, storeMode = false, onLogout }) {
  const { refetch } = useAuth();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const reactivate = useMutation({
    mutationFn: async () => (await api.post("/auth/reactivate-account")).data,
    onMutate: () => setPending(true),
    onSuccess: async () => {
      toast.success("Tu cuenta fue reactivada.");
      // Bug real encontrado en vivo al verificar esto: refetch() de useAuth()
      // solo vuelve a pedir /auth/me (el `user`) — VendorLayout.jsx además
      // depende de la query separada "my-vendor" (Vendor.deletionRequestedAt),
      // que sin esto queda con el dato viejo y sigue mostrando el aviso
      // "esta tienda se va a eliminar" aunque ya se reactivó de verdad.
      await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ["my-vendor"] })]);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo reactivar la cuenta.");
      setPending(false);
    },
  });

  const dateLabel = fmtDate(scheduledFor);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-container p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-7 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-error/10">
          <Clock className="h-7 w-7 text-error" />
        </div>
        <h1 className="mb-2 text-title-lg font-bold text-on-surface">
          {storeMode ? "Esta tienda se va a eliminar" : "Tu cuenta se va a eliminar"}
        </h1>
        <p className="mb-1 text-[13.5px] leading-relaxed text-on-surface-variant">
          {storeMode
            ? "El dueño pidió eliminar su cuenta — la tienda quedó suspendida mientras dure este proceso."
            : "Pediste eliminar tu cuenta — quedó suspendida mientras dure este proceso."}
        </p>
        {dateLabel && (
          <p className="mb-4 text-[12px] text-outline">
            Se elimina para siempre el <strong>{dateLabel}</strong>
            {canReactivate ? " si no se reactiva antes." : "."}
          </p>
        )}
        <p className="mb-6 text-[13px] leading-relaxed text-on-surface-variant">
          {canReactivate
            ? "Puedes reactivarla vos mismo en cualquier momento antes de esa fecha — tus datos siguen intactos hasta entonces."
            : "Solo el dueño de la cuenta puede reactivarla."}
        </p>
        <div className="flex flex-col gap-2.5">
          {canReactivate && (
            <button
              onClick={() => reactivate.mutate()}
              disabled={pending}
              className="rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Reactivando..." : "Reactivar mi cuenta"}
            </button>
          )}
          {onLogout && (
            <button
              onClick={onLogout}
              className="rounded-xl border border-outline-variant px-5 py-2.5 text-[13px] font-semibold text-on-surface transition hover:bg-surface-variant"
            >
              Cerrar sesión
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
