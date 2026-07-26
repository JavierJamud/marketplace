-- Bloque 52 (bug real reportado en vivo): la barra de búsqueda del header
-- (SearchBar.jsx -> /search y /search/autocomplete) nunca tuvo el fix de
-- unaccent() que ya se le aplicó al buscador interno del asistente de IA
-- en el Bloque 40 (ver assistant.controller.js) — "CAFE"/"cafe" no
-- encontraba "Café", mayúsculas y tildes rompían la búsqueda literal.
-- pg_trgm (similarity()) es la pieza NUEVA: permite un último resort de
-- "resultados más parecidos" cuando ni siquiera unaccent()+ILIKE encuentra
-- nada — típicamente porque el cliente se equivocó en una letra, no solo en
-- mayúsculas/tildes (ver search.controller.js, findProductIdsByTrigram).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índices GIN de trigramas — sin esto, similarity()/el operador "%" hacen un
-- sequential scan completo de la tabla en cada búsqueda; con la tabla
-- creciendo esto se pone lento rápido. Es un fallback de "cero resultados",
-- así que no es el camino caliente de cada búsqueda, pero igual conviene
-- indexarlo ahora que se sabe que hace falta, no cuando ya sea un problema.
CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx" ON "Product" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Vendor_companyName_trgm_idx" ON "Vendor" USING gin ("companyName" gin_trgm_ops);
