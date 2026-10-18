import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useFlow } from "../../context/FlowContext.jsx";
import { appForPath, applyManifest, resyncPush, syncServiceWorker, APPS } from "../../lib/pwa.js";
import { useRealtime } from "../../lib/useRealtime.js";
import { setQueueUser, SYNC_EVENT } from "../../lib/offlineQueue.js";
import { InstallPrompt } from "./InstallPrompt.jsx";
import { LiveNotices } from "./LiveNotices.jsx";
import { AppUpdateNotices } from "./AppUpdateNotices.jsx";

// Todo lo de la PWA en un solo lugar, montado una vez en App: service worker (o su retiro, si el admin apagó la PWA), manifiesto
// según la zona, canal en vivo con sesión, avisos dentro de la página e invitación a instalar.
export function PwaManager() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { canShowPopups } = useFlow();
  const { data: settings } = useQuery({ queryKey: ["site-settings"], queryFn: async () => (await api.get("/settings")).data.settings, staleTime: 5 * 60 * 1000 });
  const enabled = settings ? settings.pwaEnabled !== false : null;

  useEffect(() => {
    if (enabled === null) return;
    syncServiceWorker(enabled);
  }, [enabled]);

  const app = useMemo(() => appForPath(pathname), [pathname]);
  useEffect(() => applyManifest(app), [app]);

  // Cola de lo hecho sin conexión: es de la persona con sesión; al enviarse, las pantallas abiertas se actualizan.
  const queryClient = useQueryClient();
  useEffect(() => setQueueUser(user?.id ?? null), [user?.id]);
  useEffect(() => {
    const onSync = () => queryClient.invalidateQueries({ refetchType: "active" });
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, [queryClient]);

  // Canal en vivo y avisos: solo con sesión y con la PWA encendida.
  useRealtime(!!user && enabled === true);

  // La aplicación que le toca a esta persona en esta zona (y si le corresponde alguna).
  const ownApp = useMemo(() => {
    if (!user) return null;
    if (app.key === "admin") return user.role === "ADMIN" ? APPS.admin : null;
    if (app.key === "tienda") return user.role === "VENDOR" || user.role === "VENDOR_STAFF" ? APPS.tienda : null;
    return user.role === "CUSTOMER" ? APPS.cliente : null;
  }, [user, app]);

  useEffect(() => {
    if (ownApp && enabled) resyncPush(ownApp);
  }, [ownApp, enabled, user?.id]);

  // Se espera a que no haya otra ventana del sitio abierta: lugar de entrega (solo se pide en la zona pública) y cookies.
  const ready = !!ownApp && enabled === true && canShowPopups;

  return (
    <>
      {enabled && user && <LiveNotices />}
      <AppUpdateNotices app={app} enabled={enabled === true} userId={user?.id} />
      {ready && <InstallPrompt key={ownApp.key} app={ownApp} ready />}
    </>
  );
}
