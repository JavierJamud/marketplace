-- Correos de acceso en minúsculas y sin espacios. El backend ya los normaliza al entrar (utils/emailField.js) y busca con
-- findUnique exacto, así que una cuenta vieja guardada como "Juan@x.com" dejaría de poder iniciar sesión si no se pasa a
-- minúsculas aquí.
--
-- No se toca ninguna cuenta cuyo correo en minúsculas ya lo use OTRA cuenta (pares "Juan@x.com" / "juan@x.com"): forzarlo
-- rompería el índice único y la migración entera fallaría. Esos casos los decide el dueño a mano. Para listarlos:
--   SELECT lower(btrim(email)) AS correo, array_agg(email), count(*) FROM "User" GROUP BY 1 HAVING count(*) > 1;
UPDATE "User" u
SET "email" = lower(btrim(u."email"))
WHERE u."email" <> lower(btrim(u."email"))
  AND NOT EXISTS (
    SELECT 1 FROM "User" o
    WHERE o."id" <> u."id" AND lower(btrim(o."email")) = lower(btrim(u."email"))
  );

-- Registros a medio confirmar: duran lo que dura el código (minutos). Si dos difieren solo en mayúsculas, se borran los que
-- no están ya en minúsculas (la persona solo tiene que volver a pedir el código); el resto se pasa a minúsculas para que
-- verifyRegistration los encuentre con el correo normalizado.
DELETE FROM "PendingRegistration" p
WHERE p."email" <> lower(btrim(p."email"))
  AND EXISTS (
    SELECT 1 FROM "PendingRegistration" o
    WHERE o."id" <> p."id" AND lower(btrim(o."email")) = lower(btrim(p."email"))
  );

UPDATE "PendingRegistration"
SET "email" = lower(btrim("email"))
WHERE "email" <> lower(btrim("email"));
