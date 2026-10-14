import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, MAINTENANCE_EVENT } from "./api.js";

// Estado del modo mantenimiento del sitio ("OFF", "HOME" = solo la página principal, "FULL" = todo el sitio). Se pide aparte de los
// demás ajustes y no se guarda en el navegador (ver main.jsx), para que un cambio llegue en segundos y no con datos de una visita
// anterior. Si el servidor responde 503 de mantenimiento a cualquier otra petición, el estado pasa a "FULL" al instante; la
// consulta se repite cada minuto, así el sitio vuelve solo cuando se desactiva.
export function useMaintenance() {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["maintenance"],
    queryFn: async () => (await api.get("/settings/maintenance")).data,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  // Si el estado no llega en 4 segundos, el sitio sigue su curso: un fallo de esta consulta nunca debe dejarlo en blanco.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setWaited(true), 4000);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    const onMaintenance = (e) => queryClient.setQueryData(["maintenance"], (old) => ({ ...(old ?? {}), mode: "FULL", message: e.detail?.message || old?.message || "" }));
    window.addEventListener(MAINTENANCE_EVENT, onMaintenance);
    return () => window.removeEventListener(MAINTENANCE_EVENT, onMaintenance);
  }, [queryClient]);

  return { mode: data?.mode ?? "OFF", message: data?.message ?? "", customMessage: data?.customMessage ?? "", ready: !isPending || waited };
}
