// Cuánto dura un código de verificación de un solo uso. Debe coincidir con backend/src/lib/codeTtl.js (los correos y los
// servidores usan el de allá; aquí solo sirve para textos fijos de pantallas que no reciben la hora exacta de vencimiento).
export const CODE_TTL_MINUTES = 3;
