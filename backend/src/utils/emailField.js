import { z } from "zod";

// Correo de una cuenta, siempre sin espacios y en minúsculas. User.email es @unique en Postgres, que distingue
// mayúsculas: sin esto "Juan@x.com" y "juan@x.com" eran dos cuentas distintas y el login fallaba cuando el teclado del
// celular ponía la primera letra en mayúscula. trim y toLowerCase van ANTES de .email() para que " juan@x.com " valga.
export function emailField(message = "Ingresa un correo electrónico válido.") {
  return z.string().trim().toLowerCase().email(message);
}
