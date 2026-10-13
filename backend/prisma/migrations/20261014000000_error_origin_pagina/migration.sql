-- Errores que le salen a un visitante en su pantalla (la página se rompió o hubo que recargarla): se registran solos para poder verlos en el panel.
ALTER TYPE "ErrorOrigin" ADD VALUE IF NOT EXISTS 'PAGINA';
