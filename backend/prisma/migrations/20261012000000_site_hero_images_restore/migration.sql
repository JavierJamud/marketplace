-- Vuelven las imágenes del Hero que sube el admin (la animación se retira del sitio).
ALTER TABLE "SiteSettings" ADD COLUMN "heroImages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
