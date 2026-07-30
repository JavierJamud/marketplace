-- Bloque 65: MXN nuevo — en su propia migración porque Postgres no deja usar
-- un valor de enum nuevo en la misma transacción donde se lo agrega.
ALTER TYPE "ProductCurrency" ADD VALUE 'MXN';
