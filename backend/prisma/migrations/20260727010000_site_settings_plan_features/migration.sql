-- Listas de features por plan (Regular/Business), editables desde
-- AdminSubscriptions.jsx — semilla = los mismos arrays hardcodeados hoy en
-- frontend/src/lib/verificationMeta.js, para que el comportamiento no
-- cambie al desplegar.
ALTER TABLE "SiteSettings" ADD COLUMN "planFeaturesRegular" TEXT[] NOT NULL DEFAULT ARRAY['Hasta 20 productos','Pedidos por WhatsApp','Perfil de tienda público','Sin comisiones por venta']::TEXT[];
ALTER TABLE "SiteSettings" ADD COLUMN "planFeaturesBusiness" TEXT[] NOT NULL DEFAULT ARRAY['Productos ilimitados','Sello de tienda verificada','Destacada en la home','Recomendaciones con IA','Horarios de atención']::TEXT[];
