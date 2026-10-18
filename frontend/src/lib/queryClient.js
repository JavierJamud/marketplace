import { QueryCache, QueryClient } from "@tanstack/react-query";
import toast from "./toast.jsx";
import { isTechnicalFailure } from "./errorReport.js";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

// Bloque 136 (pedido explícito — "quiero que el sitio empiece a alojar
// caché, así cuando se sale de la pantalla y se vuelve a entrar, no se
// estaría recargando la página nuevamente"): staleTime sube de 30s a 5min
// (mismo valor ya usado en varios lados puntuales del código —
// usePlatformSettings.js, MarketplaceChatWidget.jsx, AdminIntegrations.jsx
// — se vuelve el default general en vez de repetirse caso por caso) para
// que volver a una pantalla ya visitada, dentro de esa ventana, no dispare
// ni siquiera un refetch de fondo silencioso, no solo que se vea instantáneo.
// Una consulta que falla por un problema técnico avisa con el mismo mensaje amable y el botón de reporte, como mucho una
// vez por minuto (las consultas de fondo se repiten y no deben llenar la pantalla de avisos).
let lastQueryToastAt = 0;
const queryCache = new QueryCache({
  onError: (error) => {
    if (!isTechnicalFailure(error) || Date.now() - lastQueryToastAt < 60_000) return;
    lastQueryToastAt = Date.now();
    toast.error("");
  },
});

export const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      // Un error 4xx (sin permiso, no existe, plan que no lo incluye) no se arregla repitiendo: se reintenta solo lo de red o 5xx.
      retry: (count, error) => {
        const status = error?.response?.status;
        return count < 1 && !(status >= 400 && status < 500);
      },
      refetchOnWindowFocus: false,
    },
  },
});

// Bloque 136: persiste el caché de React Query en localStorage — sin esto,
// el caché vive solo en memoria y una recarga completa de página (F5,
// cerrar/reabrir la pestaña) lo perdía entero, sin importar qué tan reciente
// fuera. Con esto, ese mismo caché sobrevive a la recarga: volver a entrar
// pinta de una con lo que ya había, sin esperar la respuesta del servidor
// (ver PersistQueryClientProvider en main.jsx). Se limpia entero al cerrar
// sesión (ver clearLocalSession en AuthContext.jsx) para que el caché de una
// cuenta nunca sobreviva a un logout ni se filtre a la sesión siguiente en el
// mismo navegador.
// Bloque 139 (pedido explícito): el aviso (CacheNotice.jsx) pasó a tener un
// solo botón de confirmación ("Estoy de acuerdo", sin opción de rechazar) —
// se saca el wrapper con gate de consentimiento del Bloque 138 (quedaría
// código muerto: nada en la UI podría volver a activar ese camino).
export const queryPersister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "zeudin_query_cache",
});
