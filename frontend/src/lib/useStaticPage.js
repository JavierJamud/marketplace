import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";

// Bloque 48: htmlContent ya viene sanitizado desde el servidor (ver
// staticPages.controller.js — nunca se confía en HTML sin sanitizar,
// aunque venga de un campo de admin) — el cliente lo puede inyectar
// directo. null/vacío = el admin nunca lo editó, cada página muestra su
// copy por defecto tal cual estaba.
export function useStaticPage(slug) {
  const { data, isLoading } = useQuery({
    queryKey: ["static-page", slug],
    queryFn: async () => (await api.get(`/static-pages/${slug}`)).data,
  });
  return { htmlContent: data?.htmlContent ?? null, isLoading };
}
