import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import ToggleSwitch from "../admin/ToggleSwitch.jsx";
import { Button } from "../ui/Button.jsx";
import { disablePush, enablePush, hasPushSubscription, isIos, isStandalone, pushPermission, pushSupported } from "../../lib/pwa.js";

// Avisos en este dispositivo: activarlos o quitarlos, y elegir de qué temas avisar. Las categorías las da el servidor según el
// rol (cliente, tienda o admin), así que la misma tarjeta sirve en los tres perfiles. Lo que se silencia vale para todos los
// dispositivos de la persona; activar o quitar vale solo para este.
export function NotificationSettings({ app }) {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["site-settings"], queryFn: async () => (await api.get("/settings")).data.settings, staleTime: 5 * 60 * 1000 });
  const [subscribed, setSubscribed] = useState(null);
  const [permission, setPermission] = useState(() => pushPermission());

  const prefs = useQuery({ queryKey: ["push-preferences"], queryFn: async () => (await api.get("/push/preferences")).data });

  useEffect(() => {
    hasPushSubscription().then(setSubscribed);
  }, []);

  // La campana del panel enlaza aquí con #avisos.
  const box = useRef(null);
  useEffect(() => {
    if (window.location.hash === "#avisos") setTimeout(() => box.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  }, []);

  const toggleDevice = useMutation({
    mutationFn: async (on) => (on ? enablePush(app) : disablePush().then(() => "off")),
    onSuccess: async (r) => {
      setPermission(pushPermission());
      setSubscribed(await hasPushSubscription());
      queryClient.invalidateQueries({ queryKey: ["push-preferences"] });
      if (r === "denied") toast.warning("Avisos bloqueados", "Permítelos desde los ajustes del navegador para este sitio.");
      else if (r === "unsupported") toast.error("Este navegador no admite avisos.");
    },
    onError: () => toast.error("No se pudo cambiar. Inténtalo de nuevo."),
  });

  const save = useMutation({
    mutationFn: async (muted) => (await api.patch("/push/preferences", { muted })).data,
    onMutate: async (muted) => {
      const prev = queryClient.getQueryData(["push-preferences"]);
      queryClient.setQueryData(["push-preferences"], (d) => d && { ...d, categories: d.categories.map((c) => ({ ...c, enabled: !muted.includes(c.id) })) });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      queryClient.setQueryData(["push-preferences"], ctx?.prev);
      toast.error("No se pudo guardar.");
    },
  });

  if (settings && settings.pwaEnabled === false) return null;

  const categories = prefs.data?.categories ?? [];
  const toggleCategory = (id) => {
    const muted = categories.filter((c) => (c.id === id ? c.enabled : !c.enabled)).map((c) => c.id);
    save.mutate(muted);
  };

  const iosNeedsInstall = isIos() && !isStandalone();
  const supported = pushSupported();
  const on = permission === "granted" && subscribed;

  return (
    <div ref={box} id="avisos" className="scroll-mt-24 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
        {on ? <Bell className="h-5 w-5 text-tertiary-accent" /> : <BellOff className="h-5 w-5 text-outline" />} Avisos
      </div>
      <p className="mb-4 text-[12.5px] text-outline">
        {on
          ? "Este dispositivo recibe avisos aunque la página esté cerrada."
          : iosNeedsInstall
            ? "En iPhone y iPad los avisos llegan solo con la aplicación instalada: toca Compartir y luego Añadir a pantalla de inicio."
            : !supported
              ? "Este navegador no admite avisos. Mientras tengas la página abierta, igual verás los avisos dentro de ella."
              : permission === "denied"
                ? "Bloqueaste los avisos de este sitio. Para recibirlos, permítelos desde los ajustes del navegador."
                : "Activa los avisos para enterarte al momento aunque no tengas la página abierta."}
      </p>

      {supported && !iosNeedsInstall && permission !== "denied" && (
        <Button variant={on ? "outline" : "primary"} className="mb-4 rounded-xl" disabled={toggleDevice.isPending || subscribed === null} onClick={() => toggleDevice.mutate(!on)}>
          {toggleDevice.isPending ? "Un momento..." : on ? "Quitar avisos de este dispositivo" : "Activar avisos en este dispositivo"}
        </Button>
      )}

      {categories.length > 0 && (
        <div className="border-t border-surface-container-high pt-3">
          <p className="mb-1 text-[13px] font-bold text-on-surface">Qué te avisamos</p>
          <ul className="divide-y divide-surface-container-high">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-on-surface">{c.label}</p>
                  <p className="text-[12px] leading-[17px] text-on-surface-variant">{c.hint}</p>
                </div>
                <ToggleSwitch isActive={c.enabled} label={c.label} disabled={save.isPending} onToggle={() => toggleCategory(c.id)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
