-- Bloque 111 (bug real reportado en vivo, con captura): "Países y
-- provincias" mostraba "0 subdivisiones" para CUBA/España/Estados Unidos —
-- las 16 provincias cubanas del seed original (con datos reales de
-- usuarios/vendedores/direcciones ya ligados) quedaron con "countryId" NULL
-- desde que se agregó el modelo Country (ver el fix de historial en
-- 20260730015900_fix_missing_country_table — "Country" se creó vía
-- `prisma db push` sin backfillear las provincias que ya existían, pese a
-- que el comentario de schema.prisma ya avisaba "las provincias ya
-- sembradas se backfillean a Cuba" como si eso ya hubiera pasado). El
-- frontend (AdminLocations.jsx) filtra por `province.country?.id ===
-- selectedCountryId` — con countryId NULL, ninguna de las 16 aparecía bajo
-- ningún país, aunque `Province.code` sigue siendo único GLOBAL (nunca por
-- país) y las 16 código seguían bloqueando cualquier intento de crear una
-- provincia nueva con ese mismo código — de ahí el "Ya existe una
-- provincia/estado con ese código" al intentar cargar "La Habana"/"hab"
-- que en la pantalla se veía completamente vacía.
--
-- Idempotente: crea el país CUBA solo si no existe ya (por code, no por un
-- id fijo — este id lo pudo haber creado el admin a mano desde la UI antes
-- de correr esta migración, como pasó en esta base real) y vincula SOLO
-- las provincias que coinciden exacto con los 16 códigos reales del seed
-- de Cuba y que today siguen sin país — nunca toca una provincia que ya
-- tenga countryId asignado (de Cuba o de cualquier otro país).

INSERT INTO "Country" ("id", "code", "name", "isActive")
SELECT 'cuba-country-seed', 'CU', 'CUBA', true
WHERE NOT EXISTS (SELECT 1 FROM "Country" WHERE "code" = 'CU');

UPDATE "Province" p
SET "countryId" = c."id"
FROM "Country" c
WHERE c."code" = 'CU'
  AND p."countryId" IS NULL
  AND p."code" IN ('pri','art','hab','may','mat','cfg','vcl','ssp','cav','cmg','ltu','grm','hlg','stg','gtm','ijv');
