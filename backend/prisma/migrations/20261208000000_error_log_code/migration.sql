-- Número corto de cada error (E-00123). Los que ya existen se numeran por fecha, del más viejo al más nuevo.
CREATE SEQUENCE "ErrorLog_code_seq";
ALTER TABLE "ErrorLog" ADD COLUMN "code" INTEGER;
UPDATE "ErrorLog" e SET "code" = n.rn FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS rn FROM "ErrorLog") n WHERE e."id" = n."id";
SELECT setval('"ErrorLog_code_seq"', COALESCE((SELECT MAX("code") FROM "ErrorLog"), 0) + 1, false);
ALTER TABLE "ErrorLog" ALTER COLUMN "code" SET DEFAULT nextval('"ErrorLog_code_seq"');
ALTER TABLE "ErrorLog" ALTER COLUMN "code" SET NOT NULL;
ALTER SEQUENCE "ErrorLog_code_seq" OWNED BY "ErrorLog"."code";
CREATE UNIQUE INDEX "ErrorLog_code_key" ON "ErrorLog"("code");
