import { z } from "zod";

// Bloque 241 (pedido explícito — "la sección de productos del admin necesita
// demasiado scroll cuando hay muchos... los clientes pueden ser miles"):
// ninguna lista del admin paginaba en el servidor (productos cortaba
// silenciosamente en 200, tiendas y clientes traían TODO y filtraban en el
// navegador). Este helper es el contrato común de las listas del admin:
// la página y el tamaño entran por query, `take` nunca pasa de MAX_PAGE_SIZE,
// y la respuesta siempre dice cuántos hay en total para poder pintar
// "1-25 de 340" y los botones de página.
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

// z.coerce porque llegan como string desde la URL; los valores inválidos
// ("abc", 0, negativos) se rechazan con 400 en vez de caer en silencio a otra
// página.
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export function pageArgs({ page, pageSize }) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function pageMeta({ page, pageSize }, total) {
  return { total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
