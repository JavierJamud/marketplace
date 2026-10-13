// Cuánto dura un código de verificación de un solo uso (confirmar el correo al registrarse, iniciar sesión en dos pasos,
// restablecer la contraseña, cambiar el correo y confirmar acciones del administrador). Lo habitual en el mercado es que no pasen
// de 3 minutos: un código que dura mucho es una ventana más larga para que alguien lo adivine o lo use. Es el único lugar donde se
// cambia; los correos y las pantallas leen este valor.
export const CODE_TTL_MINUTES = 3;
export const CODE_TTL_MS = CODE_TTL_MINUTES * 60 * 1000;
