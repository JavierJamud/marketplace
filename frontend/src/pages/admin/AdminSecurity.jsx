import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, ShieldCheck, Trash2 } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Button } from "../../components/ui/Button.jsx";
import TwoFactorCard from "../../components/TwoFactorCard.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

// Bloque 272 (pedido explícito): configuración de seguridad del administrador. Aquí vive el
// plazo de la eliminación pendiente de tiendas ("esta configuración de 30 días se podrá
// cambiar en el panel de administrador"). Cambiarlo pide el código enviado al correo, como
// el resto de las acciones sensibles (el modal lo gestiona ActionCodeProvider).
export default function AdminSecurity({ embedded = false }) {
  const queryClient = useQueryClient();
  // Antes de que llegaran los datos los campos mostraban 30 y 5 y se podían guardar (unchanged era undefined), pisando
  // el valor real con el de ejemplo. Ahora los formularios esperan a los datos y, si fallan, se ofrece reintentar.
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["admin-security-settings"],
    queryFn: async () => (await api.get("/admin/security/settings")).data.settings,
  });
  // Nombre del plan por defecto para el texto del asistente (planes dinámicos: nunca un nombre fijo). Mismo queryKey
  // ["site-settings"] que el resto del panel.
  const { data: siteSettings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
    staleTime: 5 * 60 * 1000,
  });
  const defaultPlan = siteSettings?.plans?.find((p) => p.isDefault) ?? null;
  const [days, setDays] = useState("30");
  useEffect(() => {
    if (data) setDays(String(data.vendorDeletionDays));
  }, [data]);

  const save = useMutation({
    mutationFn: async (value) => (await api.put("/admin/security/settings", { vendorDeletionDays: value })).data,
    onSuccess: () => {
      toast.success("Plazo de eliminación actualizado.");
      queryClient.invalidateQueries({ queryKey: ["admin-security-settings"] });
    },
    onError: (err) => {
      if (!err.actionCodeCancelled) toast.error(err.response?.data?.error ?? "No se pudo guardar.");
    },
  });

  // Bloque 276: mensajes por día del asistente de negocio para tiendas sin plan de pago.
  const [freeLimit, setFreeLimit] = useState("5");
  useEffect(() => {
    if (data) setFreeLimit(String(data.freeAssistantDailyLimit ?? 5));
  }, [data]);
  const saveLimit = useMutation({
    mutationFn: async (value) => (await api.put("/admin/security/settings", { freeAssistantDailyLimit: value })).data,
    onSuccess: () => {
      toast.success("Límite del asistente actualizado.");
      queryClient.invalidateQueries({ queryKey: ["admin-security-settings"] });
    },
    onError: (err) => {
      if (!err.actionCodeCancelled) toast.error(err.response?.data?.error ?? "No se pudo guardar.");
    },
  });
  const limitValue = Number(freeLimit);
  const limitValid = freeLimit !== "" && Number.isInteger(limitValue) && limitValue >= 0 && limitValue <= 500;
  const limitUnchanged = !data || limitValue === (data.freeAssistantDailyLimit ?? 5);

  const value = Number(days);
  const valid = Number.isInteger(value) && value >= 1 && value <= 365;
  const unchanged = !data || value === data.vendorDeletionDays;

  return (
    <div className="max-w-[760px]">
      {!embedded && (
        <>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={ShieldCheck} tone="teal" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Seguridad</h1>
      </div>
      <p className="mb-5 text-[13.5px] text-outline">Ajustes que protegen la plataforma. Cambiarlos o hacer acciones sensibles pide un código enviado a tu correo.</p>

        </>
      )}

      {isLoading ? (
        <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-5">
          <ListSkeleton rows={2} avatar={false} label="Cargando ajustes de seguridad" />
        </div>
      ) : isError && !data ? (
        <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-5 text-center">
          <p className="mb-3 text-[13.5px] text-error">No se pudieron cargar los ajustes de seguridad.</p>
          <Button variant="outline" disabled={isFetching} onClick={() => refetch()}>
            {isFetching ? "Reintentando..." : "Reintentar"}
          </Button>
        </div>
      ) : (
      <>
      <section className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <Trash2 className="h-[18px] w-[18px] text-error" aria-hidden="true" />
          <h2 className="text-[15px] font-bold text-on-surface">Eliminación de tiendas</h2>
        </div>
        <p className="mb-4 text-[13px] leading-5 text-on-surface-variant">
          Cuando eliminas una tienda no se borra enseguida: pasa a <strong>eliminación pendiente</strong> (oculta y bloqueada). Si no la restauras en este plazo, se elimina sola y de forma definitiva. Mientras tanto
          puedes verla en Tiendas con el filtro "Eliminación pendiente", restaurarla o eliminarla ya con un código enviado a tu correo.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !unchanged) save.mutate(value);
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="block">
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Días de espera antes de eliminar</span>
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="h-11 w-32 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[14px] outline-none focus-visible:border-tertiary-accent"
            />
          </label>
          <Button type="submit" disabled={!valid || !!unchanged || save.isPending}>
            {save.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </form>
        {!valid && <p className="mt-2 text-[12.5px] text-error">Escribe un número entero entre 1 y 365.</p>}
      </section>

      <section className="mt-5 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <MessageSquareText className="h-[18px] w-[18px] text-tertiary-accent" aria-hidden="true" />
          <h2 className="text-[15px] font-bold text-on-surface">Tope diario del asistente de negocio</h2>
        </div>
        {/* El texto dice a quién se aplica de verdad (businessAssistant.controller, freeQuota con isPremiumActive): el plan
            por defecto cuenta siempre, aunque se cobre y esté al día. Fuera de él, lo que exime es la tienda (verificada o
            con tiempo pagado por delante), no que su plan dé insignia: una tienda de un plan con insignia que aún no está
            verificada sí tiene tope. El paréntesis del cobro solo sale si el plan por defecto se cobra, para no hablar de un
            pago que no existe. */}
        <p className="mb-4 text-[13px] leading-5 text-on-surface-variant">
          Cuántos mensajes por día puede enviar al asistente una tienda en el plan {defaultPlan ? <strong>{defaultPlan.displayName}</strong> : "por defecto"}
          {defaultPlan && !defaultPlan.isFree ? " (también si lo paga y está al día)" : ""} o una tienda de otro plan que no esté verificada ni tenga
          tiempo pagado por delante. Al agotarlos, el asistente le avisa que puede suscribirse o esperar al día siguiente, cuando su cuota se
          restablece. Las tiendas de los demás planes que estén verificadas o tengan tiempo pagado por delante no tienen tope. Con 0, las tiendas
          con tope no pueden usarlo.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (limitValid && !limitUnchanged) saveLimit.mutate(limitValue);
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="block">
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Mensajes por día</span>
            <input
              type="number"
              min={0}
              max={500}
              value={freeLimit}
              onChange={(e) => setFreeLimit(e.target.value)}
              className="h-11 w-32 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[14px] outline-none focus-visible:border-tertiary-accent"
            />
          </label>
          <Button type="submit" disabled={!limitValid || !!limitUnchanged || saveLimit.isPending}>
            {saveLimit.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </form>
        {!limitValid && <p className="mt-2 text-[12.5px] text-error">Escribe un número entero entre 0 y 500.</p>}
      </section>
      </>
      )}

      <div className="mt-5">
        <TwoFactorCard />
      </div>
    </div>
  );
}
