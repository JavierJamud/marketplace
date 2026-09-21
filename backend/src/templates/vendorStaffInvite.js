import { env } from "../config/env.js";
import { emailShell, ctaButton, paragraph, smallNote } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 183 (pedido explícito — el vendedor da de alta a un usuario de
// sistema para su negocio): aviso best-effort de que la cuenta ya existe —
// la contraseña real recién se define cuando la persona entra por primera
// vez (login con su correo detecta que hace falta crearla, ver login() en
// auth.controller.js), nunca acá.
export async function vendorStaffInviteEmail(user, vendorName) {
  const { siteName } = await getBrandSettings();
  const subject = `Te dieron acceso al panel de ${vendorName}`;
  const html = await emailShell({
    preview: `${vendorName} te agregó como usuario de su panel en ${siteName}`,
    title: "Te agregaron como usuario",
    badge: { label: "Acceso nuevo", color: "#337475" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola <strong>${user.fullName}</strong>, <strong>${vendorName}</strong> te agregó como usuario de su panel en ${siteName}.`)}
      ${paragraph(`Para entrar, entra a la página de inicio de sesión de vendedores e ingresa tu correo (<strong>${user.email}</strong>) — como es tu primera vez, el sistema te va a pedir crear tu propia contraseña con un código que te mandamos a este mismo correo.`)}
      ${ctaButton("Ir a iniciar sesión", `${env.frontendUrl}/vendedor/ingresar`)}
      ${smallNote("Vas a ver solo las secciones del panel a las que te dieron acceso.")}
    `,
  });
  return { subject, html };
}
