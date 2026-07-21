-- Bloque 40: bug real reportado en vivo — "audifonos" (sin tilde, muy común
-- al escribir rápido) no matcheaba "Audífonos inalámbricos Pro" porque
-- contains()/ILIKE de Postgres compara byte a byte, no pliega acentos. La
-- extensión unaccent() permite comparar name/description/companyName/etc.
-- sin tilde de los dos lados (ver assistant.controller.js).
CREATE EXTENSION IF NOT EXISTS unaccent;
