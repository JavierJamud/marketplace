# Auditoría de Baznova por roles (2026-10-28)

Revisión de solo lectura con 28 agentes: 22 subagentes por sección que reportaron a 6 líderes. Cada líder verificó en el código los hallazgos de severidad alta y media y separó lo que está así a propósito.


## Administrador

El panel de administración está bien protegido en lo básico: todo /admin exige authenticate + requireRole("ADMIN") (admin.routes.js:48) y casi todas las acciones destructivas piden código de acción. Lo que falla es sobre todo la coherencia con el modelo de cuatro planes y el cobro del Básico (v26.0.122). Suscripciones, métricas, MRR, Nova (platformFacts.js) y muchos textos siguen pensando en dos planes, "Regular" y "Premium/Business". Además, el Empresarial activado a mano vence a los 30 días, y cambiar grantsBadge o isFree tiene efectos ocultos sobre el cobro de tiendas reales. Revisé en el código los hallazgos de severidad alta y media, y casi todos son reales. Los más graves: el GMV y el ticket promedio "del mes" suman toda la historia (admin.controller.js:129-130); GET /admin/vendors?plan=PAID da 500 (línea 474); las campañas mandan un solo correo con toda la lista en "to" (campaigns.controller.js:104), con fuga de correos y fallo con más de 50 destinatarios; la tienda puede deshacer la suspensión del admin sobre sus ofertas y códigos; las ofertas de tienda siguen públicas cuando el plan baja; y no se puede editar una venta manual sin nota. Hay que conservar varios diseños de los subagentes. (1) Planes dinámicos: crear una tabla Plan con id estable ('plan_regular', etc.) y planId en Vendor, VerificationRequest, SubscriptionPayment y PartnerPlanPrice; cambiar los "roles" del enum por banderas (isDefault = plan de registro y de bajada, isTrialPlan, contactOnly, grantsBadge); validar con cuid en lugar de z.enum; borrar un plan = archivarlo, con un plan destino obligatorio si tiene tiendas, y nunca archivar el isDefault ni el isTrialPlan. Los subagentes dejaron la lista de los ~60 puntos de backend y frontend que hoy dan por hecho 4 planes fijos. (2) Catálogo de funciones: PlanFeature (key, label, kind flag|limit, group, requiresBadge, textos públicos) más PlanFeatureValue (planId, featureKey, enabled, limit), con un registro en código (lib/planFeatures.js) que asegura que cada clave se cumple en el servidor; planAllows/planLimit, buildPlanIncludes, PlansCatalog, platformFacts y AdminSubscriptions se generan desde ese catálogo. (3) Estadísticas por plan: GET /admin/plan-stats?desde&hasta con tiendas al día, en prueba, con cobro atrasado, suspendidas y activadas a mano; altas y bajas; ingresos y MRR por moneda sin convertir; ARPU. SubscriptionPayment pasa a ser la única fuente de ingresos. (4) Pantalla Configuración > Planes y pagos: tarjetas por plan (1 columna a 390px, 4 en escritorio) con chips de estado, precios, tiendas y MRR; una ventana "Configurar" con pestañas Resumen, Precio y venta, Funciones y límites, Beneficios extra e Historial; "Guardar" muestra antes el impacto (N tiendas, productos ocultos, usuarios sin acceso, Stripe con precio viejo); asistente "Crear plan" que deja el plan oculto, y modal de archivar con plan destino.

### Errores confirmados (63)

**1. [ALTA] "Valor de pedidos (mes)" y "Ticket promedio (mes)" usan el total histórico**  
`backend/src/controllers/admin.controller.js:129` · bug  
*Por qué:* Confirmado: `prisma.order.aggregate({ _sum: { total: true } })` y el de tableOrder (líneas 129-130) no llevan where. La etiqueta "(mes)" se agregó en el Bloque 48 sobre un cálculo del commit inicial. aov (línea 247) divide el total histórico entre los pedidos del mes, así que crece cada mes. La gráfica (rawSalesSeries) sí filtra, por eso las dos cifras no cuadran.  
*Arreglo:* En getDashboard: (1) agregar `where: { createdAt: { gte: monthStart }, status: { not: "CANCELLED" } }` al aggregate de Order y `{ createdAt: { gte: monthStart }, cancelledAt: null }` al de TableOrder; (2) contar ordersThisMonth/tableOrdersThisMonth con el mismo criterio; (3) calcular monthStart con startOfDayInTimezone(SiteSettings.timezone); (4) como Order.total mezcla monedas (AdminDashboard.jsx:188-191), agrupar por moneda o reutilizar rawSalesSeries. Probar comparando con la gráfica del mes.

**2. [ALTA] GET /admin/vendors?plan=PAID responde 500 (rompe el estimado de destinatarios de Campañas)**  
`backend/src/controllers/admin.controller.js:474` · conexion  
*Por qué:* Confirmado: la línea 456 traduce PAID a `{ in: PAID_PLAN_TYPES }`, pero baseScope (474) usa `planType: plan || undefined`. Prisma recibe "PAID" como valor del enum y falla todo el Promise.all. AdminCampaigns.jsx:330 manda plan: "PAID". Se olvidó repetir la traducción al agregar los KPI. (Lo reportaron dos subagentes.)  
*Arreglo:* En listVendors: `const planWhere = plan === "PAID" ? { in: PAID_PLAN_TYPES } : plan || undefined;` y usarlo en scope y en baseScope. Mejor aún, validar `plan` con z.enum([...PlanType, "PAID"]). Probar Campañas > "Tiendas con plan de pago" y la lista de Tiendas con cada filtro de plan.

**3. [ALTA] Campañas y ofertas dirigidas: un solo correo con todos los destinatarios en "to"**  
`backend/src/controllers/campaigns.controller.js:102` · seguridad  
*Por qué:* Confirmado: `resend.emails.send({ from, to: recipients, ... })` (102-104), y lo mismo en targetedOffers.controller.js:146. Cada cliente ve el correo de todos los demás (fuga de datos personales), y Resend acepta como máximo 50 direcciones en `to`, así que con una base real el envío falla.  
*Arreglo:* Crear lib/massEmail.js con una función sendToEach(recipients, build) que use resend.batch.send en lotes de 100, cada uno con un único `to` y enlace de baja, y que registre los fallos por lote. Usarla en campaigns.controller.js (create/resend) y en targetedOffers.controller.js. Guardar en la campaña sentCount/failedCount. Probar en local con la cuenta sandbox (solo entrega al correo del desarrollador).

**4. [ALTA] La tienda puede reactivar una oferta o un código de descuento que el admin suspendió**  
`backend/src/controllers/storeOffers.controller.js:240` · permisos_plan  
*Por qué:* Confirmado: setStoreOfferActiveAdmin solo pone active:false (240), y updateStoreOffer (178-184) acepta active:true sin saber quién la apagó. El comentario (214-220) decide a propósito reutilizar `active`, pero el resultado es que la moderación no dura. Lo mismo con setDiscountCodeActiveAdmin frente a updateDiscountCode. Va contra la regla 2.  
*Arreglo:* Migración escrita a mano: agregar suspendedByAdminAt/suspendedByAdminReason a StoreOffer y DiscountCode. Las rutas admin las llenan o limpian. updateStoreOffer/updateDiscountCode responden 403 "La suspendió el equipo de la plataforma" si suspendedByAdminAt existe y piden active:true. La vista pública y la aplicación del código filtran suspendedByAdminAt: null. En el panel de la tienda: chip "Suspendida por el administrador" y el interruptor oculto.

**5. [ALTA] Las ofertas de tienda siguen públicas (y se pueden reactivar) cuando el plan ya no las incluye o baja el tope**  
`backend/src/controllers/storeOffers.controller.js:182` · permisos_plan  
*Por qué:* Confirmado: solo createStoreOffer (116) llama a assertPlanAllows("allowStoreOffers"). Al reactivar solo se revisa el tope, y la consulta pública (vendors.controller.js:348) no mira el plan. Los códigos de descuento sí se protegen al aplicarse, así que aquí es una omisión. Va contra las reglas 1 y 2.  
*Arreglo:* (1) En updateStoreOffer, cuando active pasa a true, llamar a assertPlanAllows(vendor, "allowStoreOffers"). (2) En vendors.controller.js (storeOffers públicas) devolver [] si !planAllows(vendor, "allowStoreOffers") o !isPremiumActive, y recortar a maxActiveStoreOffers (las más recientes). (3) Incluir las ofertas en el recalcVendorPlanLimits general (ver el hallazgo de límites).

**6. [ALTA] Editar una venta manual sin nota siempre falla (note:null)**  
`frontend/src/pages/admin/AdminManualSales.jsx:39` · conexion  
*Por qué:* Confirmado: el frontend manda `note: form.note || null`, pero el esquema (adminVendorStaffSales.controller.js:46) es `z.string().trim().max(280).optional()`, que no acepta null. La línea 86 del controller ya preveía vaciar la nota.  
*Arreglo:* En adminVendorStaffSales.controller.js:46 y vendorStaffSales.controller.js (~746) usar `.optional().nullable()`. En el frontend mandar `note: form.note` ("" se guarda como null). Probar editando la cantidad de una venta sin nota.

**7. [ALTA] El Empresarial (y todo plan activado a mano) vence a los 30 días, siempre da la insignia y no se puede renovar**  
`backend/src/controllers/admin.controller.js:1771` · bug  
*Por qué:* Confirmado: grantBusinessPlan fija nextPaymentDueDate = ahora + 30 días (1771) y siempre llama a transitionVendorVerification("VERIFIED") (1777), sin mirar plan.grantsBadge. expireOverduePayments (verificationPayment.job.js:96) pasa a PAYMENT_FAILED a toda tienda sin Stripe con la fecha vencida, y la baja al Básico. quotePlan rechaza contactOnly (planConfig.js:90), así que la tienda no puede renovar. registerManualPayment solo acepta tiendas vencidas (1392). El comentario de la línea 1761 dice que el Empresarial "solo se activa así": no es intencional que caiga solo. Lo reportaron dos subagentes.  
*Arreglo:* (1) grantBusinessPlan acepta `months` (1-24) o `noExpiry` (obligatorio para contactOnly). Para noExpiry, nextPaymentDueDate = null y una marca manualGrant. (2) Si !plan.grantsBadge, cambiar planType + nextPaymentDueDate sin pasar a VERIFIED (igual que en el cobro sin insignia). (3) En verificationPayment.job.js (expireOverduePayments y sendPaymentReminders) excluir tiendas con un plan contactOnly o noExpiry. (4) Permitir registerManualPayment también en VERIFIED para extender. (5) En AdminVendorManage.jsx:366 y GrantBusinessCard, ajustar el texto según el plan y mostrar "Activo hasta…".

**8. [ALTA] Nova contesta precios y planes con datos viejos: SiteSettings y solo Básico y Premium**  
`backend/src/lib/platformFacts.js:36` · conexion  
*Por qué:* Confirmado: getPlansFacts usa getSubscriptionPricing() (SiteSettings.cupSubscriptionPriceCup/cardSubscriptionPriceUsd, que ya no se editan en ninguna pantalla), arma solo regular/business (38), pone "Gratis" fijo para el Básico (68) y usa el fallback "plan Business" (134). El comentario del archivo promete datos siempre de la base. Es un resto de antes de PlanConfig y rompe la regla 3. Lo reportaron dos subagentes.  
*Arreglo:* Reescribir getPlansFacts/plansAnswer/planFactsForPrompt para recorrer getAllPlanConfigs().filter(p => p.isPublic) ordenados por sortOrder, con publicPlan()/buildPlanIncludes(); el precio sale de priceCup/priceUsd (tachado si isFree, "por WhatsApp" si contactOnly), en una tabla de N columnas. Invalidar su caché en invalidatePlanConfigCache. Después borrar getSubscriptionPricing, SUBSCRIPTION_PRICE_USD (stripe.js) y los campos de precio en getSettings (128-131) y en cupPaymentSettingsSchema. Columnas en una migración escrita a mano posterior.

**9. [ALTA] Suscripciones, métricas y MRR dejan fuera las tiendas que cobra planBilling (Básico de pago y planes sin insignia)**  
`backend/src/controllers/admin.controller.js:59` · bug  
*Por qué:* Confirmado: SUBSCRIPTION_SCOPE filtra PAID_PLAN_TYPES (sin REGULAR). computeSubscriptionMetrics (75) solo suma al MRR las tiendas en estado "active", o sea VERIFIED, así que una tienda de un plan sin insignia que paga por planBilling queda como pending_payment y nunca suma. El Empresarial (priceUsd 0) siempre suma 0, y se usa el precio de lista sin los descuentos por meses. Viene de cuando el Básico era siempre gratis. Une los hallazgos de MRR de Dashboard y Planes.  
*Arreglo:* (1) Calcular el alcance desde PlanConfig: planes isPaidConfig o tiendas con billingNoticeStage != null. (2) subscriptionStatusOf: usar isPremiumActive y agregar los estados "Cobro atrasado" (billingNoticeStage) y "Suspendida por falta de pago" (billingSuspendedAt) en STATUS_META y en los filtros de AdminSubscriptions.jsx. (3) MRR por moneda calculado desde el último SubscriptionPayment vigente (monto / meses), separado por plan; Empresarial "a medida". (4) Etiquetas "Ingreso mensual estimado (planes de pago)".

**10. [ALTA] Cambiar "Da la insignia de verificada" cambia en silencio el cobro y las funciones de todas las tiendas del plan**  
`frontend/src/pages/admin/AdminSubscriptions.jsx:245` · config  
*Por qué:* Confirmado: la ayuda solo dice "La tienda tiene que pasar la verificación de documentos". Pero grantsBadge decide si planBilling cobra el plan (planBilling.service.js:28), si reconcilePlanVerification baja al Básico a las tiendas no verificadas (vendorVerification.service.js:229-233) y el flujo de pago (verification.controller.js:439/762). Además storeOffers.controller.js:113 y otras funciones exigen VERIFIED aunque el plan no dé insignia. La regla "plan + verificación" es deliberada (comentario de isPremiumActive), pero que el admin no reciba aviso no lo es.  
*Arreglo:* (1) En PlanConfigCard, al cambiar grantsBadge abrir un ConfirmModal con el impacto: GET /admin/plan-configs/:planType/impact devuelve cuántas tiendas pasan a cobro por planBilling o bajan al Básico. (2) Reemplazar los `verificationStatus === "VERIFIED"` sueltos (storeOffers:113, chat.controller.js:212, products.controller.js:537, vendors.controller.js:429, search.controller.js:490) por isPremiumActive(vendor) && planAllows, o marcar esas funciones como "exige insignia" en la UI y validarlo en updatePlanConfig. (3) reconcilePlanVerification (212) restaura siempre a BUSINESS: guardar el plan anterior.

**11. [ALTA] Pasar un plan de pago a "Gratis por ahora" o "por WhatsApp" no cancela Stripe ni resuelve los vencimientos**  
`backend/src/controllers/settings.controller.js:298` · bug  
*Por qué:* Confirmado: updatePlanConfig solo reacciona al paso de gratis a pago (299-302). Con isFree o contactOnly en un plan con suscriptores, quotePlan rechaza renovar (planConfig.js:90-91), las suscripciones de Stripe siguen cobrando y las tiendas que pagan en CUP vencen y caen al Básico por el cron. La validación solo cubre REGULAR+grantsBadge+isFree.  
*Arreglo:* En updatePlanConfig: si un plan con tiendas pasa a isFree o contactOnly, exigir confirmación (409 con el conteo, que la UI muestra en un ConfirmModal) y luego: cancelar las suscripciones de Stripe al final del periodo (cancelAtPeriodEnd), poner nextPaymentDueDate = null o marca "sin vencimiento" y excluir ese plan de expireOverduePayments y sendPaymentReminders. Mientras no exista ese flujo, bloquear isFree en planes con grantsBadge y tiendas activas.

**12. [MEDIA] Campanita: no suma los casos de soporte y no avisa de renovaciones ni de cambios de datos; "Pedido nuevo" con CUP fijo y enlace a Tiendas**  
`backend/src/controllers/admin.controller.js:2342` · bug  
*Por qué:* Confirmado: openSupportCases entra en items (2272), pero `total` (2342-2354) no lo suma. No se consultan los SubscriptionPayment reclamados ni los vendorChangeRequest PENDING. El aviso de pedido (2321) lleva "CUP" fijo aunque Order.total mezcla monedas, y enlaza a /admin/tiendas con el comentario viejo "no hay vista de detalle" (2315), cuando adminSearch ya enlaza a ?tab=pedidos&pedido=id desde la v26.0.121.  
*Arreglo:* Sumar openSupportCases.length a total; agregar consultas y avisos renewal-/change- que enlacen a /admin/verificaciones?tab=renovaciones|cambios; el aviso de pedido enlaza a `/admin/tiendas/${vendorId}?tab=pedidos&pedido=${id}`, usa la moneda del pedido (o ninguna) y "·" en lugar de "—" (también en 2298). Borrar el comentario viejo.

**13. [MEDIA] Accesos de "Necesita tu atención" llevan a pantallas sin lo pendiente**  
`frontend/src/pages/admin/AdminDashboard.jsx:242` · conexion  
*Por qué:* Confirmado: pagos por confirmar → /admin/suscripciones (242) y cambios pendientes → /admin/tiendas (250), cuando se confirman en AdminVerifications (?tab=renovaciones / ?tab=cambios). Son enlaces anteriores al traslado.  
*Arreglo:* Cambiar a `/admin/verificaciones?tab=renovaciones` y `?tab=cambios`. Reutilizar section-counts (misma queryKey que el layout) en lugar de bajar /admin/suggestions para contar.

**14. [MEDIA] El dashboard no da datos por plan y usa nombres viejos ("MRR (Business)", "tiendas Business", "Volvió a Regular")**  
`frontend/src/pages/admin/AdminDashboard.jsx:213` · texto  
*Por qué:* Confirmado: businessVendors (admin.controller.js:132) mete Estándar, Premium y Empresarial en un solo número con la etiqueta "Business". PLAN_ENDED: "Volvió a Regular" (103) sale además como insignia roja. La v26.0.122 no tocó el dashboard.  
*Arreglo:* En getDashboard agregar `prisma.vendor.groupBy({ by: ["planType"], where: { deletedAt: null }, _count: true })` e ingresos del mes por SubscriptionPayment.planType y moneda. Nueva tarjeta "Tiendas e ingresos por plan" con displayName de PlanConfig (usePlatformSettings().planNames). Etiquetas: "Ingreso mensual estimado (planes de pago)", "N tiendas con plan de pago", "Volvió al Básico" en tono neutro.

**15. [MEDIA] Nombres de plan fijos ("Regular", "Premium", "Business") en avisos y pantallas, en lugar del displayName**  
`backend/src/services/planDowngrade.service.js:43` · texto  
*Por qué:* Confirmado en: planDowngrade.service.js:43/52/62; orders.controller.js:963 ("es del Plan Premium") y 969 ("Verificate para pasar a Premium"); products.controller.js:779; pos.controller.js:551; invoices.controller.js:104/169; AdminSubscriptions.jsx:465/624/634/722/788-789; AdminVendorManage.jsx:405/418/421/442/506/617; AdminVendors.jsx:594 (tarjeta "Premium" que cuenta los tres planes de pago); AdminIntegrations.jsx:28/417 ("suscripción Business"); AdminLayout.jsx:65 (keywords "business regular"). Son restos de cuando había dos planes; rompe la regla 3.  
*Arreglo:* Backend: helper planName(planType) basado en getPlanConfig().displayName; usarlo en todos los mensajes y cambiar "pasa a Premium" por "cambia a un plan que lo incluya" ("Verifícate" con tilde). Frontend: planNames[v.planType] o v.planName; tarjeta de AdminVendors → "Con plan de pago"; Integraciones → "Cobro con tarjeta de los planes de las tiendas"; keywords "básico estándar premium empresarial".

**16. [MEDIA] Pago manual de renovación se cuenta dos veces en los ingresos del dashboard**  
`backend/src/controllers/admin.controller.js:1422` · bug  
*Por qué:* Confirmado: registerManualPayment guarda paymentAmount + paymentConfirmedAt=now en VerificationRequest (1404-1420) y, si es renovación, crea además un SubscriptionPayment confirmado con el mismo monto (1423-1439). getDashboard (147-163) suma las dos fuentes del mes.  
*Arreglo:* Corto plazo: en getDashboard excluir los VerificationRequest con paymentMethod MANUAL cuyo vendor tenga un SubscriptionPayment con el mismo confirmedAt. Mejor: registrar todo cobro (también el inicial) en SubscriptionPayment y usar solo esa tabla como fuente de ingresos (también para plan-stats).

**17. [MEDIA] Un plan oculto (isPublic=false) se puede contratar llamando la API**  
`backend/src/lib/planConfig.js:87` · permisos_plan  
*Por qué:* Confirmado: isPublic solo se usa en /settings/plans y seoPages. quotePlan y chooseMyPaymentMethod/startMyCardSubscription/chooseMyRenewalPayment aceptan cualquier planType. La ayuda del admin da a entender que deja de venderse.  
*Arreglo:* Agregar a quotePlan un parámetro `vendor` y rechazar con 400 si !config.isPublic && vendor.planType !== planType (renovación permitida). Pasarlo desde las tres rutas de verification.controller.js. Ayuda del admin: "Las tiendas que ya lo tienen lo siguen renovando".

**18. [MEDIA] Los límites del plan solo se aplican al crear: bajar el límite o el plan deja el exceso activo**  
`backend/src/controllers/settings.controller.js:312` · permisos_plan  
*Por qué:* Confirmado: updatePlanConfig solo recalcula maxProducts (312-315). maxStaffUsers, maxTables, maxDiscountCodes, maxActiveStoreOffers y los interruptores solo se miran al crear; requireVendorAccess.js mira allowStaffUsers pero no la cantidad. Para productos (overQuota) se hizo a propósito; para el resto no. Va contra la regla 1.  
*Arreglo:* Crear services/planLimits.service.js con recalcVendorPlanLimits(vendorId): desactiva las ofertas activas que sobran (las más viejas), marca overQuota en staff/mesas/códigos más nuevos fuera de cupo, y aplica ese bloqueo en requireVendorAccess (staff fuera de cupo → 403), en el pedido por mesa y al aplicar el código. Llamarlo en updatePlanConfig (para todas las tiendas del plan) y en cada cambio de planType (grant, downgrade, transitionVendorVerification, planBilling, trialExpiry).

**19. [MEDIA] Descuentos por meses: el admin acepta de 2 a 36, pero se cobran hasta 24 (CUP) o 1/3/6/12 (tarjeta) y /planes muestra hasta 12**  
`backend/src/controllers/settings.controller.js:225` · config  
*Por qué:* Confirmado: discountSchema max(36); MAX_PAYMENT_MONTHS = 24 (verification.controller.js:41); CARD_INTERVAL_MONTHS = [1,3,6,12] (stripe.js:187); PlansCatalog.jsx:129 filtra m <= 12. Un descuento de 18 o 24 no se ve en público y uno de 30 nunca se usa.  
*Arreglo:* Constante compartida PAYMENT_MONTH_OPTIONS = [3,6,12,24] (backend lib/planConfig.js, y expuesta en /settings). discountSchema: months en esa lista. Editor del admin: selector en lugar de número libre, con el aviso "con tarjeta solo 3, 6 y 12". PlansCatalog: mostrar hasta 24.

**20. [MEDIA] "Perfil público de tu tienda" se anuncia como beneficio, pero el interruptor significa "puede poner su perfil privado"**  
`backend/src/lib/planConfig.js:325` · texto  
*Por qué:* Confirmado: buildPlanIncludes dice "Perfil público de tu tienda". El admin lo llama "Puede poner su perfil privado" (AdminSubscriptions.jsx:120) y vendors.controller.js:802 lo usa como permiso para ponerse en privado.  
*Arreglo:* Cambiar el texto a "Puedes poner tu tienda en privado" y revisar TOPICS. A futuro, renombrar la columna a allowPrivateProfile en una migración escrita a mano.

**21. [MEDIA] El límite de correos se presenta como total, pero solo cuenta los correos manuales**  
`backend/src/lib/planConfig.js:320` · texto  
*Por qué:* Confirmado: "Correos a tus clientes (hasta N al mes)" y PlansCatalog.jsx:50 "Correos a clientes por mes", mientras orders.controller.js:935 cuenta solo type MANUAL.  
*Arreglo:* Texto público: "Hasta N correos escritos por ti al mes (los automáticos no cuentan)". En PlansCatalog: "Correos escritos por ti, por mes". En el admin, cambiar "Emails" por "Correos".

**22. [MEDIA] La lista de Suscripciones no muestra el plan de cada tienda**  
`backend/src/controllers/admin.controller.js:1658` · bug  
*Por qué:* Confirmado: listSubscriptions no devuelve planType. La tabla y los textos ("Todavía no hay tiendas en el Plan Premium", "Plan Premium revocado") dan por hecho un solo plan. Viene del Bloque 46.  
*Arreglo:* Devolver planType y planName. En AdminSubscriptions.jsx agregar columna y filtro Plan, y usar el nombre real en el vacío, en el modal de revocar y en los toasts (ver también el hallazgo de nombres fijos).

**23. [MEDIA] Combinaciones de interruptores contradictorias y cambios de plan sin historial**  
`backend/src/controllers/settings.controller.js:276` · config  
*Por qué:* Confirmado: se aceptan isFree+contactOnly, highlighted en un plan oculto o contactOnly, sortOrder repetido, límites con el interruptor apagado y features sin tope (246). No se llama a logActivity aunque cambian precios de todas las tiendas.  
*Arreglo:* Agregar validación cruzada con superRefine en updatePlanConfig sobre `next`: isFree y contactOnly excluyentes; highlighted solo si isPublic y !contactOnly; sortOrder único (consultar los otros planes); features max 12 × 80 caracteres. Crear la tabla PlanConfigChange (adminId, planType, diff JSON) y registrar el antes/después + logActivity. En la UI, desactivar el campo de límite cuando su interruptor está apagado.

**24. [MEDIA] PlanConfigTab y SubscriptionsTab sin estado de carga ni de error**  
`frontend/src/pages/admin/AdminSubscriptions.jsx:355` · desborde_ui  
*Por qué:* Confirmado: `const { data: plans } = useQuery(...)` sin isLoading ni isError. Si falla, solo se ve el párrafo. SubscriptionsTab (616) muestra "Todavía no hay tiendas" ante un error. Además dice "1 tiendas" (387).  
*Arreglo:* ListSkeleton mientras carga; bloque de error con "Reintentar" (refetch, 44px); plural correcto en el conteo. Incluir isError en SubscriptionsTab antes del estado vacío.

**25. [MEDIA] Desbloquear por API una tienda en eliminación pendiente: queda visible pero el cron la borra igual**  
`backend/src/controllers/admin.controller.js:665` · bug  
*Por qué:* Confirmado: updateVendor con isBlocked:false limpia blockReason/blockedAt sin mirar adminDeletionRequestedAt. vendorDeletion.job.js la elimina igual. La UI lo oculta, pero el servidor no lo impide (regla 2). Para eso existe restoreVendorDeletion.  
*Arreglo:* En updateVendor, antes de 665: `if (data.isBlocked === false && vendor.adminDeletionRequestedAt) throw new AppError("Esta tienda está en eliminación pendiente: usa Restaurar.", 409)`.

**26. [MEDIA] Restaurar una tienda en eliminación pendiente borra el bloqueo previo y no deja rastro**  
`backend/src/controllers/admin.controller.js:874` · bug  
*Por qué:* Confirmado: deleteVendor sobrescribe blockReason/blockedAt (854-856) y restoreVendorDeletion pone isBlocked:false y blockReason:null (874). Una tienda bloqueada por normas queda desbloqueada al restaurarla. Ni eliminar ni restaurar llaman a logActivity. El comentario de las líneas 834-835 ("el dueño queda suspendido") ya no es cierto.  
*Arreglo:* Migración escrita a mano: Vendor.preDeletionBlockReason y preDeletionBlockedAt. deleteVendor guarda el estado previo; restoreVendorDeletion lo devuelve (isBlocked = !!prev). Agregar logActivity en las dos funciones y corregir el comentario y el texto de AdminVendorManage.jsx:482.

**27. [MEDIA] Editar tienda falla si el responsable, su identificación o la dirección están vacíos**  
`backend/src/controllers/admin.controller.js:602` · bug  
*Por qué:* Confirmado: ownerName min(2), ownerIdNumber/companyAddress min(1), nullable, pero EditVendorModal (AdminVendors.jsx:148-150) manda "". El Bloque 165 quería justamente poder corregir tiendas viejas; con el email sí se previó (587-591).  
*Arreglo:* En updateVendorSchema usar z.union([schema, z.literal("")]) en esos tres campos y en updateVendor convertir "" en null (o borrarlo si ya era null). Probar editando solo el color de una tienda vieja.

**28. [MEDIA] Al cambiar la contraseña o el correo de una tienda, o al suspender a un cliente, las sesiones abiertas siguen activas**  
`backend/src/controllers/admin.controller.js:735` · seguridad  
*Por qué:* Confirmado: resetVendorPassword (735), updateVendorLoginEmail (766) y updateCustomer (1951) no revocan Session. authenticate (middleware/auth.js:34) solo mira la sesión, así que el access token sigue sirviendo hasta 1 h (el refresh sí revisa isSuspended). El reset del personal (1059/1082), moderation.js y accountDeletion.js sí revocan. Además el correo no se normaliza a minúsculas (753/763), a diferencia de requestEmailChange.  
*Arreglo:* Helper revokeUserSessions(userId) en lib/sessions.js (updateMany revokedAt + borrar trustedDevice). Llamarlo en las tres funciones (en updateCustomer solo cuando isSuspended pasa a true). updateVendorLoginEmailSchema: .trim().toLowerCase(), comparar con mode:"insensitive" y revisar la lista negra. Agregar logActivity a la suspensión de clientes.

**29. [MEDIA] Gestionar no pasa isRestaurant a Estadísticas ni a Usuarios**  
`frontend/src/pages/admin/AdminVendorManage.jsx:359` · conexion  
*Por qué:* Confirmado: StatsModal recibe `{ id, companyName }` (359) y solo pide /table-orders con `enabled: !!vendorName.isRestaurant` (AdminVendors.jsx:329). Lo mismo con AdminVendorStaffModal (361) para el tipo "Mesero".  
*Arreglo:* Pasar `{ id: v.id, companyName: v.companyName, isRestaurant: v.isRestaurant }` (o v completo) en las líneas 359 y 361.

**30. [MEDIA] "Suspendida por inactividad" también aparece en las suspensiones por falta de pago**  
`frontend/src/pages/admin/AdminVendorManage.jsx:198` · texto  
*Por qué:* Confirmado: el chip sale con cualquier status SUSPENDED (166/198), y planBilling.service.js:90 también suspende con billingSuspendedAt y suspensionReason. AdminSuspendedVendors.jsx:62 tampoco nombra el impago, y reactivar da 7 días sin decirlo.  
*Arreglo:* getVendorManage y listSuspendedVendors devuelven suspensionReason y billingSuspendedAt (listSuspendedVendors además con select limitado, sin ids de Stripe). Mostrar "Suspendida por falta de pago" o "por inactividad" con el motivo; en el modal de reactivar avisar "tendrá 7 días para pagar"; actualizar el texto de la lista.

**31. [MEDIA] Límites en Gestionar: cuentan otra cosa que el servidor e ignoran los interruptores del plan**  
`backend/src/controllers/adminVendorManage.controller.js:166` · permisos_plan  
*Por qué:* Confirmado: usa _count.products (incluye inactivos y fuera de cupo) y _count.storeOffers (todas), y `max: plan?.[key]` sin la regla de planConfig.js:121-124 (0 si la función está apagada). Puede mostrar "120 de 50" o "sin límite" en algo que el plan no incluye.  
*Arreglo:* Contar productos activos no overQuota y ofertas active:true. Calcular max con publicPlan(plan).limits (que ya aplica los interruptores). Idealmente, mover el cálculo de uso a una función compartida con assistantData.js.

**32. [MEDIA] Socio: tras regenerar la llave, la caja sigue mostrando y copiando la llave revocada**  
`frontend/src/pages/admin/partners/PartnerDetail.jsx:335` · bug  
*Por qué:* Confirmado: `<ApiKeyBox partnerId={id} activeKey={...} />` sin key, con el estado value/shown interno; invalidateQueries(["admin-partner-api-key", id]) (264) apunta a una consulta que no existe.  
*Arreglo:* `<ApiKeyBox key={activeKey?.id} .../>` y quitar el invalidate muerto.

**33. [MEDIA] Suspender o reactivar un socio no pide código de acción ni confirmación**  
`backend/src/routes/admin.routes.js:55` · seguridad  
*Por qué:* Confirmado: PATCH /partners/:id sin requireActionCode, aunque el comentario de la línea 58 dice que todo lo que cambia el acceso de un socio pide el código, y status cambia el acceso (partnerAuth.js:76).  
*Arreglo:* Middleware dinámico (igual que vendorChangeAction): si el body trae status, aplicar requireActionCode("PARTNER_MANAGE"). En PartnerDetail.jsx:292, ConfirmModal antes de suspender.

**34. [MEDIA] El filtro "Se mantuvieron" deja fuera los reportes mantenidos después de pedir evidencia**  
`backend/src/controllers/adminReports.controller.js:37` · conexion  
*Por qué:* Confirmado: dismissFraudReport guarda RESOLVED_NO_ACTION si había evidencia pedida (125), pero listFraudReports filtra por un solo estado (37). Además un status inválido da 500.  
*Arreglo:* Aceptar status=KEPT → `{ in: ["DISMISSED","RESOLVED_NO_ACTION"] }` y validar con z.enum (400). En AdminFraudReports.jsx:105 enviar KEPT.

**35. [MEDIA] Decidir reportes y apelaciones no es atómico (dos admins, dos pestañas o el cron aplican el aviso dos veces)**  
`backend/src/controllers/adminReports.controller.js:143` · bug  
*Por qué:* Confirmado: findUnique + comprobar estado + update sin condición, en resolve (143-148), dismiss (117-129) y rejectAppeal (188-195). confirmAndSuspend lo usa también la tarea diaria de evidencia vencida, así que el cron puede coincidir con la decisión del admin.  
*Arreglo:* Reclamar la decisión con `prisma.report.updateMany({ where: { id, status: { in: ["PENDING","EVIDENCE_REQUESTED"] } }, data: { status: "PROCESSING" o el final } })` y seguir solo si count === 1; lo mismo con appealStatus:"PENDING". O envolverlo en $transaction con nivel serializable.

**36. [MEDIA] Comentarios: solo trae los 200 últimos, no hay pestaña Reportados y "Mostrar" se salta el reporte**  
`backend/src/controllers/reviews.controller.js:336` · bug  
*Por qué:* Confirmado: listAllReviews `take: 200` sin filtros; AdminReviews.jsx no filtra por reportStatus, y el aviso de la campana lleva a ?review=id, que puede no estar en la lista. setReviewHidden (347-358) deja mostrar un comentario REPORTED o SUSPENDED, en contra del comentario de la UI (361-365).  
*Arreglo:* listAllReviews con paginación (paginationQuerySchema) y filtro reportStatus; pestaña "Reportados" primero; si llega ?review=id y no está en la página, pedirlo con GET /admin/reviews/:id. setReviewHidden: 409 si isHidden=false y reportStatus está en [REPORTED, SUSPENDED]; ocultar "Mostrar" en esos casos.

**37. [MEDIA] Productos del admin: la búsqueda pisa el filtro "Ocultos al público"**  
`backend/src/controllers/adminProducts.controller.js:103` · bug  
*Por qué:* Confirmado: HIDDEN_WHERE es `{ OR: [...] }` (47) y la búsqueda agrega otra clave OR al mismo objeto (103-105), que reemplaza la primera.  
*Arreglo:* `const where = { ...scope, AND: [statusWhere(status), q ? { OR: [...] } : {}] }`. Si la categoría elegida es principal, incluir sus hijas (categoryId in [id, ...hijas]).

**38. [MEDIA] El admin cambia el precio sin revalidar los precios por cantidad y el modal manda stock y campos viejos**  
`backend/src/controllers/adminProducts.controller.js:218` · bug  
*Por qué:* Confirmado: replacePriceTiers solo se ejecuta si llegan priceTiers (221), y el modal nunca los manda. El modal (AdminProducts.jsx:56-68) envía siempre stock aunque el producto tenga tallas (pisa el stock tras ventas concurrentes) y categoryId undefined con "Sin categoría" (115). No se registra actividad.  
*Arreglo:* Backend: si data.price cambia y no llegan tiers, leer los tramos actuales y llamar a assertValidPriceTiers (como products.controller.js:877-885); ignorar `stock` si el producto tiene tallas; aplicar la lógica de reposición (avisos); logActivity y aviso opcional a la tienda en update y delete. Frontend: mandar solo los campos que cambiaron respecto de initialFormSnapshot, no mandar stock con tallas y quitar "Sin categoría".

**39. [MEDIA] POST /categories: cualquier empleado de una tienda, incluso bloqueada o sin la sección Productos, crea categorías globales**  
`backend/src/routes/categories.routes.js:11` · permisos_plan  
*Por qué:* Confirmado: solo requireRole("VENDOR","VENDOR_STAFF","ADMIN"), sin requireVendorWrite("productos") ni rate limit. El comentario dice que se crea al cargar un producto, así que debería pedir el mismo permiso.  
*Arreglo:* Usar `authenticate, requireVendorWrite("productos")` (el ADMIN ya pasa) y un rateLimit (por ejemplo 20 por tienda al día). En AdminProductCategories.jsx:29, si res.existing, mostrar "Ya existía".

**40. [MEDIA] Eliminar una provincia o estado no revisa direcciones, personas ni ventas rápidas: 500 o pérdida de datos**  
`backend/src/controllers/locations.controller.js:338` · bug  
*Por qué:* Confirmado: solo cuenta vendorLocations y municipalities. En schema.prisma, Address.province es obligatoria sin onDelete (3248, Restrict → P2003 → 500), User (895) y CustomerListing (3343) son SetNull y pierden el dato, y LocationSuggestion (339) es Cascade. deleteMunicipality y deleteCountry ya revisan todo (Bloque 244).  
*Arreglo:* Incluir en _count addresses, users, customerListings y los vendors con provincia legal, y responder 409 con el mismo formato que deleteMunicipality.

**41. [MEDIA] Un código de país que no es ISO deja el país invisible en el registro**  
`backend/src/controllers/locations.controller.js:165` · config  
*Por qué:* Confirmado: code min(2).max(5); listActiveCountries descarta los que no tienen callingCode (119). El modal ya dice que se espera ISO, pero el servidor no lo valida.  
*Arreglo:* `code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).refine(c => callingCodeFor(c))` con el mensaje "Usa el código ISO de 2 letras (CU, US, ES)". Aviso en vivo en el modal. Agregar .max(80) a los nombres de país, provincia, municipio y rubro.

**42. [MEDIA] Ubicaciones a 390px: doble padding, cabecera del país cortada y controles de 20 a 36px**  
`frontend/src/pages/admin/AdminLocations.jsx:501` · desborde_ui  
*Por qué:* Según el subagente (clases leídas): px-4 py-8 propio sobre el px-4 del layout, más p-6 en la tarjeta (~278px útiles); la fila del país sin flex-wrap (631); interruptores py-0.5/py-1, íconos p-1.5 sin aria-label, tarjeta de país como div onClick sin teclado (579), lápiz oculto con lg:opacity-0 (608). Además no hay estado de carga ni de error (410). Es diseño de escritorio anterior a la regla de 44px.  
*Arreglo:* Quitar px-4 py-8 del contenedor raíz; tarjeta p-4 sm:p-6; flex-wrap + min-w-0 + break-words en la fila del país; min-h-11/min-w-11 y aria-label en todos los controles; convertir la tarjeta en <button>; lg:focus-visible:opacity-100; ListSkeleton y error con Reintentar; textos en minúscula ("Nuevo país", "Habilitado/Apagado" iguales en filtro e interruptor). Revisar a 390px y en escritorio.

**43. [MEDIA] Campañas y ofertas dirigidas ignoran marketingEmails y las cuentas eliminadas**  
`backend/src/controllers/campaigns.controller.js:21` · bug  
*Por qué:* Confirmado: resolveRecipients solo filtra role, isSuspended y provinceId. schema.prisma dice que los recordatorios respetan User.marketingEmails; el estimado (listCustomers con deletedAt:null) y el envío cuentan cosas distintas.  
*Arreglo:* Agregar `marketingEmails: true, deletedAt: null` para clientes; para tiendas `deletedAt: null, adminDeletionRequestedAt: null, user: { marketingEmails: true }`. Mismo criterio en el contador del frontend (endpoint /admin/campaigns/estimate). Enlace de baja en la plantilla.

**44. [MEDIA] Envío masivo de campañas sin código de acción ni registro**  
`backend/src/routes/admin.routes.js:248` · seguridad  
*Por qué:* Confirmado: POST /campaigns y /campaigns/:id/resend (248-250) sin requireActionCode, mientras acciones menores (discount-codes/:id/active, 384) sí lo piden. Un clic en "Reenviar" manda correo a toda la base.  
*Arreglo:* Agregar MASS_EMAIL a ACTION_LABELS (lib/adminActionCode.js) y requireActionCode("MASS_EMAIL") en create/resend de campañas y de ofertas dirigidas. logActivity con el número de destinatarios.

**45. [MEDIA] Vista previa del HTML de la oferta ejecuta HTML sin sanear en la sesión del admin**  
`frontend/src/pages/admin/AdminOffers.jsx:353` · seguridad  
*Por qué:* Confirmado: dangerouslySetInnerHTML={{ __html: htmlContent }} con lo que el admin escribe o pega. DOMPurify solo se aplica en el servidor al guardar. Es self-XSS en la cuenta con más privilegios.  
*Arreglo:* Mostrar la vista previa en `<iframe sandbox="" srcDoc={htmlContent}>` (sin allow-scripts), o sanear con dompurify en el cliente (con versión fija) con la misma configuración del backend.

**46. [MEDIA] Borrar o editar una campaña borra la imagen que comparten sus reenvíos**  
`backend/src/controllers/campaigns.controller.js:243` · bug  
*Por qué:* Confirmado: resendCampaign copia imageUrl (219) y deleteCampaign/updateCampaign llaman a deleteLocalCampaignImage (172-179, 243) sin comprobar otros usos.  
*Arreglo:* Antes del unlink: `if (await prisma.campaign.count({ where: { imageUrl, id: { not: id } } })) return;`. Agregar ese chequeo dentro de deleteLocalCampaignImage pasándole el id.

**47. [MEDIA] Editar o borrar una venta manual mueve el stock aunque el producto sea "siempre disponible"**  
`backend/src/controllers/adminVendorStaffSales.controller.js:99` · bug  
*Por qué:* Confirmado: increment/decrement de stock y remainingQty (63-76, 102-104) sin mirar unlimitedStock. returnManualSale sí lo tiene en cuenta (Bloque 199) y el comentario de cabecera promete la misma lógica.  
*Arreglo:* Leer product.unlimitedStock dentro de la transacción y no mover ningún ledger si es true, en update/delete del admin y de la tienda (vendorStaffSales.controller.js). Mejor: extraer una función común.

**48. [MEDIA] Códigos de descuento del admin siempre muestran "CUP" en los montos fijos**  
`frontend/src/pages/admin/AdminDiscountCodes.jsx:17` · bug  
*Por qué:* Confirmado: valueLabel pone CUP fijo aunque el endpoint devuelve currency. AdminStoreOffers.jsx ya usa code.currency.  
*Arreglo:* `${...} ${c.currency ?? "CUP"}` y mostrar startsAt en Vigencia si es futuro.

**49. [MEDIA] Con el chatbot apagado, el servidor sigue respondiendo /assistant/chat**  
`backend/src/controllers/assistant.controller.js:1133` · permisos_plan  
*Por qué:* Confirmado: showChatWidget solo se lee en getSettings (settings.controller.js:112) y en el frontend (MarketplaceChatGate). La regla 2 pide bloquearlo en el servidor, y hay un costo real (cupo de los proveedores de IA).  
*Arreglo:* En postMarketplaceChatMessage y en /ai/transcribe (cuando lo usa el bot general) leer showChatWidget con caché corta (como getMaintenanceState) y responder 403 "El asistente no está disponible ahora".

**50. [MEDIA] "Guardar y salir" de Marca se queda colgado con dos tarjetas con cambios**  
`frontend/src/pages/admin/AdminBranding.jsx:204` · bug  
*Por qué:* Confirmado: `await Promise.all(jobs)` con varias PATCH que piden PLATFORM_BRANDING; ActionCodeProvider guarda un solo resolver (useRef, línea 47), así que la segunda petición pisa a la primera, que nunca se resuelve, y se mandan dos códigos.  
*Arreglo:* En el guard, guardar en serie: `for (const job of fns) await job()` (la segunda entra en el periodo de gracia). Robustecer ActionCodeProvider con una cola: si ya hay un modal abierto para la misma acción, encolar el resolve y resolver todos con el mismo código.

**51. [MEDIA] El admin puede escribir por chat a tiendas que no pueden leerlo**  
`backend/src/controllers/admin.controller.js:2019` · permisos_plan  
*Por qué:* Confirmado: sendConversationMessage solo comprueba que la tienda exista (2023), mientras que el lado de la tienda exige VERIFIED + allowAdminChat. El mensaje se guarda y nadie lo ve. listConversations carga todas las tiendas cada 5 s.  
*Arreglo:* listConversations/getConversation devuelven canRead (isPremiumActive && planAllows allowAdminChat). AdminChat muestra "Esta tienda no puede ver el chat con su plan actual; escríbele por correo" y desactiva el envío; el servidor responde 409. Paginar o limitar a las tiendas con conversación, con un buscador para abrir otra.

**52. [MEDIA] "Mejorar con IA" (/ai/generate-description) sin rate limit y con kinds de admin abiertos a vendedores**  
`backend/src/routes/ai.routes.js:11` · seguridad  
*Por qué:* Confirmado: la línea 11 no lleva chatRateLimit, mientras que la ruta hermana (10) sí. Según el subagente, un VENDOR puede pedir kind campaign/admin-offer y saltarse resolveMyVendor.  
*Arreglo:* Agregar chatRateLimit (o un límite propio por usuario) a la línea 11, y en ai.controller.js aceptar kind campaign/admin-offer solo si req.user.role === "ADMIN".

**53. [MEDIA] El texto de zona horaria promete regir todos los procesos programados, pero casi todos usan La Habana fija**  
`frontend/src/pages/admin/AdminBranding.jsx:326` · config  
*Por qué:* Según el subagente: getSiteTimezone solo lo usan aiHealthCheck.job.js y customerListings; los demás cron llevan "America/Havana". El comentario de settings.controller.js:141-145 lo reconoce.  
*Arreglo:* Corto plazo: cambiar el texto a "Se usa para la verificación diaria de la IA y los anuncios de venta rápida". Si el negocio es solo Cuba, valorar quitar el selector. Si no, reprogramar los cron con getSiteTimezone() al cambiarla.

**54. [MEDIA] Chat del admin: mensajes largos desbordan, los envíos fallidos no avisan y no hay estados**  
`frontend/src/pages/admin/AdminChat.jsx:335` · desborde_ui  
*Por qué:* Según el subagente: la burbuja <p>{m.body}</p> sin break-words ni whitespace-pre-wrap, send sin onError ni maxLength (el servidor limita a 2000), sin carga, vacío ni error en la lista, h1 duplicado y pestañas y X de ~32px sin aria-label.  
*Arreglo:* `break-words whitespace-pre-wrap` en la burbuja; onError con toast y maxLength={2000}; ListSkeleton, vacío y error; h2 interno; min-h-11 + aria-label; h-[calc(100dvh-60px)].

**55. [MEDIA] Respuestas de FAQ guardadas sin sanear y mostradas con dangerouslySetInnerHTML en el admin**  
`backend/src/controllers/faq.controller.js:39` · seguridad  
*Por qué:* Confirmado: createFaq/updateFaq guardan answer tal cual (solo hay min(3), sin max); solo listPublicFaqs sanea al servir (24); AdminFaq.jsx:341 pinta crudo. Va contra el criterio del propio proyecto (staticPages.controller.js:46-49).  
*Arreglo:* En create/update: `answer = hasMarkup(answer) ? sanitizeFaqHtml(answer) : answer` y .max(FAQ_ANSWER_MAX); question .max(FAQ_QUESTION_MAX). listAdminFaqs aplica el mismo map que el endpoint público.

**56. [MEDIA] Los vendedores ya no tienen buzón de sugerencias, aunque el admin las filtra por "Vendedores"**  
`frontend/src/components/SuggestionBox.jsx:9` · conexion  
*Por qué:* Confirmado: solo se monta en CustomerPanel.jsx:1025; se quitó de pages/vendor en el commit 4e74aa3 ("Update project files") sin explicación, y el backend sigue aceptando VENDOR. Parece una pérdida accidental durante un refactor.  
*Arreglo:* Volver a montar <SuggestionBox /> en el panel del vendedor (Configuración o Ayuda), salvo que el dueño confirme que se quitó a propósito; en ese caso, quitar el filtro "Vendedores" y corregir el comentario.

**57. [MEDIA] Sugerencias sin límite de envíos ni de longitud**  
`backend/src/routes/suggestions.routes.js:8` · seguridad  
*Por qué:* Confirmado: sin rate limit; el esquema z.string().min(5) no tiene max. /contact sí tiene contactRateLimit. Además ?type inválido da 500 y la lista no pagina.  
*Arreglo:* rateLimit de 5 cada 10 min por usuario; `.trim().max(2000)` y maxLength + contador en SuggestionBox; validar type/status con z.enum; paginar; agregar filtro Nueva/Revisada en AdminSuggestions.

**58. [MEDIA] El pegado por lote de FAQ se cierra al tocar fuera y se pierde el HTML**  
`frontend/src/pages/admin/AdminFaq.jsx:50` · bug  
*Por qué:* Confirmado: el fondo de FaqBatchModal hace onClick={onClose} sin useDirtyModal, cuando el Bloque 196 exige preguntar (el otro modal del archivo sí lo hace en 176).  
*Arreglo:* useDirtyModal({ isDirty: html.trim() !== "", onClose }) + UnsavedChangesModal; el fondo usa dirtyModal.handleBackdropClick.

**59. [MEDIA] Páginas legales: primero sale el texto predeterminado y luego salta al editado, y la fecha de "Última actualización" es siempre el mes actual**  
`frontend/src/pages/public/Terms.jsx:46` · bug  
*Por qué:* Confirmado: `const { htmlContent } = useStaticPage("terminos")` (46) sin isLoading; lo mismo en Privacy, Ayuda y Contacto. La línea 64 usa new Date() como fecha. En textos legales es engañoso. Los términos predeterminados hablan de un único "plan de pago" (línea 20).  
*Arreglo:* Mostrar un skeleton mientras isLoading y usar el texto fijo solo si la respuesta trae htmlContent null. Fecha: updatedAt del endpoint, o una fecha fija para el texto predeterminado. Reescribir la sección de planes con un enlace a /planes.

**60. [MEDIA] Contacto usa un WhatsApp y un correo fijos con la marca vieja (zeudin.com)**  
`frontend/src/pages/public/Contacto.jsx:62` · conexion  
*Por qué:* Confirmado: "+1 469 507 4046" y "soporte@zeudin.com" (62, 71). Fue intencional el 2026-08-07 (comentario de la línea 52), pero la marca ahora es Baznova y supportWhatsapp ya se configura en el admin.  
*Arreglo:* Leer usePlatformSettings().supportWhatsapp (enlace wa.me de 44px) y agregar supportEmail a SiteSettings (migración escrita a mano + campo en AdminBranding). Ocultar la tarjeta si falta el dato. Cambiar el default siteName "ZeuDin" (settings.controller.js:747, schema) a "Baznova".

**61. [MEDIA] El buscador del admin manda "Verificación en dos pasos" a Mi perfil, donde no está**  
`frontend/src/pages/admin/AdminLayout.jsx:72` · conexion  
*Por qué:* Confirmado: to "/admin/perfil", pero TwoFactorCard solo se monta en AdminSecurity.jsx:141 (Configuración › Seguridad).  
*Arreglo:* Apuntar a `/admin/configuracion?tab=seguridad` o mover TwoFactorCard a AdminProfile (es de la cuenta personal) y quitar la palabra clave duplicada de la línea 66.

**62. [MEDIA] El tope del asistente para tiendas "gratis" no es un límite del plan y castiga al Básico de pago**  
`frontend/src/pages/admin/AdminSecurity.jsx:112` · permisos_plan  
*Por qué:* Según el subagente y planConfig.js:155 (isPremiumActive devuelve false para cualquier REGULAR): businessAssistant freeQuota exime solo a isPremiumActive, así que un Básico pagado y al día queda limitado a 5 mensajes. No está en PlanConfig, así que ni /planes ni la suscripción lo muestran (reglas 1 y 3).  
*Arreglo:* Migración escrita a mano: PlanConfig.maxAssistantMessagesPerDay (null = sin tope); editarlo en Suscripciones › Planes; mostrarlo en buildPlanIncludes/PlansCatalog/SubscriptionOverview; freeQuota lee el límite del plan de la tienda (y, para el Básico de pago al día, su plan). Quitar el ajuste global de Seguridad o dejarlo como valor por defecto.

**63. [MEDIA] Pantallas sin estado de error (un fallo se ve como "no hay nada" o como carga infinita)**  
`frontend/src/pages/admin/AdminCustomerListings.jsx:254` · desborde_ui  
*Por qué:* Confirmado en el patrón `const { data, isLoading } = useQuery` sin isError en: AdminCustomerListings (254), AdminReviews (207/265), AdminRankingAnomalies (48/119), AdminDashboard (538/594, más los KPI con "—" y los esqueletos que no terminan), AdminActivityLog, AdminErrors, AdminPartners (87) y PartnerDetail (278, esqueleto eterno), AdminCategories (205/314), AdminProductCategories (189, error y vacío a la vez), AdminIntegrations (292, todo "Inactivo" mientras carga), AdminPages (157), AdminFaq, AdminSuggestions, StaticPageEditor y Faq.jsx público. Va contra la regla 4.  
*Arreglo:* Crear components/admin/QueryState.jsx ({ isLoading, isError, refetch, isEmpty, emptyText }) que muestre ListSkeleton, el error "No se pudo cargar" con Reintentar de 44px o el vacío. Aplicarlo en esas pantallas y no mostrar el vacío si isError.

### Está así a propósito (no se toca)

- **El admin se salta los límites del plan al editar productos**: Comentario explícito en adminProducts.controller.js:25-28 y 198-199: el admin corrige datos. Lo que no es intencional es saltarse la coherencia de precios por cantidad y stock (eso sí quedó como error).
- **MRR como "Ingreso mensual estimado" con precio de lista**: El comentario de computeSubscriptionMetrics (73) lo declara como estimación. Se reporta solo lo que falta (planes cobrados por planBilling, Empresarial en 0) dentro del hallazgo de Suscripciones/MRR.
- **La regla "funciones de plan = plan + verificación"**: Decisión confirmada del Bloque 52 (comentario de isPremiumActive, planConfig.js:142-153). El error es solo que el admin no recibe aviso al cambiar grantsBadge y que quedan chequeos VERIFIED sueltos.
- **La prueba gratis siempre es del plan Premium (BUSINESS)**: Decisión del dueño del Bloque 235. Queda como mejora: configurar el plan de prueba (SiteSettings.trialPlanType) y usar su displayName en el texto "Días de la prueba gratis de Premium".
- **Reutilizar el campo `active` para la suspensión admin de ofertas de tienda**: Fue decisión explícita (storeOffers.controller.js:214-220), pero con un efecto no previsto (la tienda la revierte). Por eso se mantiene como error confirmado de severidad alta; el diseño en sí era intencional.
- **PATCH /settings/pwa sin código de acción**: Está descrito como "interruptor de emergencia". Pedir código ahí retrasaría apagar una PWA rota. Hay que documentarlo; chat-widget, customer-reminders y ai-models sí deberían pedirlo (mejora).
- **Pausar plazo, pedir evidencia, responder comentarios, resolver soporte y marcar anomalías sin código de acción**: No destruyen nada y requieren rapidez. El subagente de clientes lo vio razonable y concuerdo.
- **Rechazar solicitudes de socio sin código**: No toca credenciales ni acceso a la API; el comentario del Bloque 303 limita el código a acceso y credenciales.
- **Socio suspendido puede entrar a /socio y ver su estado**: Probablemente buscado para que vea por qué está suspendido (partnerPortal.controller.js:53). Hay que confirmarlo con el dueño; no se reporta como error.
- **El contador de tiendas por rubro incluye las de la papelera y eso impide borrar el rubro**: Bloquear el borrado mientras hay tiendas restaurables tiene sentido. Solo conviene aclararlo en el número y en el mensaje ("1 tienda en papelera") y corregir "Desactivala" → "Desactívala".
- **Rutas de países activate-all, deactivate-all y bulk sin pantalla**: Coincide con el pendiente "admin/ubicaciones countries" de la auditoría 2026-08-06 (memoria). Es trabajo pendiente conocido, no un error nuevo.
- **Copy fijo en los componentes de Términos, Privacidad, Ayuda y Contacto (htmlContent null = predeterminado)**: Decisión explícita (staticPages.controller.js:20-22). Los errores reales son el salto mientras carga y la fecha falsa.
- **El panel del asistente todavía no dice "Nova"**: Pendiente conocido según la memoria del proyecto ("el panel aún no dice Nova"). Hay que decidirlo con el dueño.
- **Desde Gestionar no se cambia directo entre planes de pago**: Simplificación probable: grant y downgrade mueven plan e insignia juntos. Se propone como mejora.
- **La pestaña de Mi perfil no está en la URL**: La ruta /admin/marca suple el enlace directo; es una inconsistencia menor (mejora).
- **Las X de algunos modales cierran sin preguntar por cambios sin guardar**: El subagente de ofertas no lo reportó por ser posiblemente intencional (la X es un cierre explícito). Se deja como observación.
- **GET /settings público incluye los planes ocultos**: El panel del vendedor puede necesitar los datos de un plan oculto que tenga asignado. No expone secretos; se propone filtrar como mejora.
- **Botón "Rotar" igual a "Guardar" en Integraciones**: Es un rótulo semántico ("reemplazar clave"), no un error funcional; se propone unificar como mejora.

### Mejoras propuestas

- Planes dinámicos (crear y archivar planes): tabla Plan con id estable ('plan_regular', 'plan_standard', 'plan_business', 'plan_enterprise'); planId en Vendor, VerificationRequest, SubscriptionPayment y PartnerPlanPrice, rellenado desde el enum y con el enum como espejo un tiempo; banderas isDefault (registro y bajada, exactamente uno) e isTrialPlan en lugar de REGULAR/BUSINESS fijos; validación por cuid en lugar de z.enum; archivar en vez de borrar, con plan destino obligatorio si hay tiendas (recalcular cupos, avisar y cancelar Stripe si el destino es gratis). planNames pasa a ser un mapa por id. Los subagentes dejaron la lista de ~60 puntos de código que hoy dan por hecho 4 planes fijos.
- Catálogo de funciones de plan: PlanFeature (key, label, description, kind flag|limit, unit, group Ventas/Equipo/Marketing/Visibilidad, requiresBadge, publicLabelOn/publicLabelLimit con {n}, sortOrder) y PlanFeatureValue (planId, featureKey, enabled, limit). Registro en lib/planFeatures.js que avisa al arrancar si hay claves sin cumplimiento en el servidor. planAllows/planLimit, buildPlanIncludes, publicPlan, PlansCatalog, platformFacts y AdminSubscriptions se generan del catálogo. Una fila por función con 'Incluida' y 'Hasta N', así no existe el estado 'límite 1 con la función apagada'.
- Estadísticas por plan: GET /admin/plan-stats?desde&hasta con tiendas totales, al día, en prueba, con cobro atrasado, suspendidas por pago y activadas a mano; altas y bajas (tabla VendorPlanChange); ingresos confirmados y MRR por moneda sin convertir CUP a USD; ARPU. Mostrarlas en cada tarjeta de plan, en la pestaña Resumen de 'Configurar', en Suscripciones (columna y filtro Plan) y en el Dashboard (fila 'Ingresos por plan').
- Pantalla Configuración > Planes y pagos: encabezado con 'Crear plan' (44px) y 'Ver página de planes'; tarjetas por plan (1/2/4 columnas) con chips de estado (Gratis, De pago, Por WhatsApp, Oculto, Más elegido, Da insignia, Plan de prueba, Por defecto), precios, tiendas (enlace a Tiendas filtrado) y MRR; 'Configurar' en hoja a pantalla completa en el celular o panel lateral de 720px, con pestañas Resumen, Precio y venta, Funciones y límites, Beneficios extra (vista previa exacta de 'Tu plan incluye') e Historial; 'Guardar' muestra antes el impacto ('Afecta a N tiendas: X productos ocultos, Y usuarios sin acceso, Z suscripciones de tarjeta siguen con el precio anterior') y pide PLAN_CONFIG_CHANGE; tarjetas aparte para 'Prueba gratis', 'Cobro y suspensión' y 'Datos de transferencia CUP'.
- Unificar SubscriptionPayment como única fuente de ingresos (también el pago inicial), lo que elimina la doble cuenta y simplifica dashboard y plan-stats.
- Configurar el plan y los días de la prueba gratis desde el admin (SiteSettings.trialPlanType o PlanConfig.trialDays) en lugar de BUSINESS fijo.
- En Gestionar tienda: cambio directo entre planes de pago y casilla 'Avisar a la tienda' en desbloquear, bajar de plan y restaurar; reiniciar motivo, aviso y lista negra al abrir cada modal (helper openModal).
- Historial de cambios (logActivity) en: configuración de planes, eliminar y restaurar tienda, edición y borrado de productos por el admin, venta rápida (suspender, eliminar, quitar fotos; borrar archivos después de la fila), pausar plazos de sanción y suspensión de clientes.
- Paginación y filtros en listas que hoy cortan sin aviso: Actividad (150), Errores (300), ventas manuales (300), reportes (300), comentarios (200), anomalías, códigos, ofertas de tienda, campañas, sugerencias y conversaciones; mostrar 'Mostrando X de N'.
- Filtro de Actividad 'Vendedores' que incluya VENDOR_STAFF (mismo criterio que el ranking del Bloque 183) y filtro 'Admin' aparte.
- Unificar el conteo de errores (menú, pestañas y dashboard con la misma lista de estados) y renombrar a 'Errores y tickets'; invalidar ['admin-section-counts'] al resolver errores, casos de soporte, comentarios y sugerencias.
- Validar con z.enum los parámetros de consulta (status, kind, origin, type) en reportes, anomalías, errores y sugerencias para responder 400 en vez de 500.
- Pedir código de acción en chat-widget, customer-reminders y en desactivar o borrar modelos de IA; documentar que la PWA queda sin código a propósito.
- Mover TwoFactorCard a Mi perfil y sincronizar las pestañas de Mi perfil y de la FAQ pública con ?tab.
- Socios: tabla con tarjetas en el celular, nombre como enlace o botón, buscador con aria-label y debounce, socio abierto en ?socio=, y toast de rechazo según d.emailed.
- Comentarios: mostrar 'Compra verificada' según isVerifiedPurchase; Anomalías: mostrar reviewNote y fecha en las cerradas.
- Venta rápida: el contador 'X/máximo' solo con anuncios activos; lista negra con el origen de cada entrada y texto que incluya las suspensiones manuales.
- Editor de páginas estáticas: botón 'Cargar el contenido actual como punto de partida', vista previa con .prose-static y aviso al salir con cambios sin guardar; .prose-static con overflow-wrap:anywhere, tablas con scroll propio y pre con pre-wrap; DOMPurify con lista blanca (sin style, form ni input) y rel=noopener en los enlaces.
- FAQ con orden manual (sortOrder, subir y bajar) y acordeón con aria-expanded.
- Accesibilidad táctil en todo el panel: min-h-11 en botones, filtros e inputs (hoy h-9/h-10, py-1.5), botones de solo ícono de h-11 w-11 con aria-label ('Cerrar', 'Editar', 'Quitar {beneficio}', 'Limpiar búsqueda'); filas de ofertas y anuncios con flex-wrap en el celular; fechas del anuncio y pares de campos de campañas en grid-cols-1 sm:grid-cols-2; grilla de Tiendas a xl: para que no desborde entre 768 y 1100px; StatStrip con 8 columnas.
- Textos: quitar la raya larga (—) de los textos visibles (AdminDashboard 455, AdminErrors 94, AdminVerifications 264/515/616/656/822..., AdminReviews, AdminRankingAnomalies, AdminOffers, AdminCampaigns, AdminAnnouncements, AdminBranding, AdminAssistant, AdminFaq, Terms, Privacy, Contacto, errorHandler.js:104 'Revisa estos datos —', asunto del correo de prueba de Resend); usar 'Sin dato' o 'Sin ventas' en lugar de '—' como valor vacío; 'badge' → 'insignia'; quitar emojis (💡, 🔒) por íconos lucide; voseo 'dejalos'/'Desactivala' → 'déjalos'/'Desactívala'; 'Hero' → 'Portada'; estados de campaña SENDING/DRAFT traducidos; mayúsculas a la inglesa en Ubicaciones; género de 'método' en CatalogOptionsManager; textos de Marca ('pie del sitio y de los correos', 'Asistente Nova en Inicio, Tiendas y Catálogo').
- Contraste: el verde #0CAE53 como texto de 10.5px (~2.9:1) por el token verified-dark, y quitar opacity-55 en los ítems sin pendientes del dashboard.
- Dashboard: filtrar deletedAt en actividad reciente y 'Tiendas por provincia' (contando tiendas distintas), quitar el enlace de 'Pedidos (mes)' a Actividad.
- Anuncios y campañas: opción 'Quitar imagen' y borrar req.file si la validación falla; mover ListingPolicyCard a su archivo y eliminar /settings/offer-policy si ya no se usa; mover ProductImageLinksPanel a components/admin.
- Integraciones: un solo botón 'Guardar' o 'Reemplazar clave', name con z.enum de los proveedores conocidos, correo de prueba a req.user.email y flex-wrap en la cabecera de las tarjetas.
- Asistente del admin: implementar arrastrar y soltar o quitar la palabra 'Arrastra', y botón de borrar documento de 44px con aria-label.
- Código de provincia único por país (@@unique([countryId, code])) en lugar de global.

<details><summary>Notas del subagente: Dashboard y control</summary>

Todos los enlaces del menú (NAV en AdminLayout.jsx) llevan a rutas que existen en App.jsx, y cada endpoint que llaman estas pantallas existe en admin.routes.js (o auth.routes.js para /auth/me/*). Los nombres de campo coinciden: metrics.*, topPotentialVendors, verificationFunnel, byProvince, activity, series/total/orders/vendors, payments, requests, suggestions, logs, topVendors/topCustomers y errors. AdminSecurity no tiene ruta propia: se monta dentro de Configuración › Seguridad y /admin/seguridad redirige ahí. Todo el router admin exige authenticate + requireRole("ADMIN"), y los cambios de seguridad piden el código de acción. No encontré huecos de permisos en estas pantallas. Respuesta a la pregunta: el dashboard NO muestra datos por plan. Junta todos los planes de pago en un solo número con la etiqueta vieja \"Business\", y el MRR deja fuera el Básico cuando se cobra. El error de mayor peso es que el GMV y el ticket promedio usan el total histórico aunque digan \"(mes)\". No ejecuté nada: todo sale de leer el código.

</details>

<details><summary>Notas del subagente: Planes, suscripciones y verificación</summary>

RESUMEN DE (a) a (f)

(b) Qué hace cada campo hoy y si la UI lo explica
- displayName, tagline, sortOrder: nombre, frase y orden en /planes y en todo el panel. sortOrder también decide el texto 'Todo lo de X, más:' en PlansCatalog, que supone que cada plan incluye lo del anterior (no se valida).
- priceCup/priceUsd: precio mensual; quotePlan cobra con esto (verificación, renovación, Stripe). No se explica que las suscripciones de Stripe ya creadas mantienen su precio anterior.
- listPrice*: tachado solo cuando isFree. Explicado.
- isFree: explicado solo para el paso gratis -> de pago. Lo contrario no está resuelto (hallazgo).
- contactOnly: sin precio, botón WhatsApp; quotePlan no lo cobra. Ojo: tampoco se puede renovar (hallazgo Empresarial).
- highlighted: uno solo; bien explicado.
- grantsBadge: la ayuda no cuenta sus efectos (cobro por verificación o por planBilling, reconcile, funciones que exigen VERIFIED). Hallazgo alto.
- isPublic: oculta en /planes, pero se puede comprar por API.
- monthDiscounts: explicado; topes incoherentes con los plazos reales.
- features: texto libre; la UI explica que se filtran líneas con números. El filtro TOPICS puede esconder un beneficio legítimo sin avisar (sería bueno una vista previa de 'Así lo ve la tienda').
- Límites: label claro salvo maxMonthlyOrderEmails ('Emails manuales' vs público 'Correos a tus clientes'). Falta decir que vacío = ilimitado y 0 = nada en cada campo, y que solo se cumplen al crear.
- Interruptores: allowPublicProfile tiene el sentido invertido respecto al texto público; allowPanelOrders sobra (el servidor lo borra, sigue en schema y en zod: eliminar columna); featuredInHome dice 'Home / búsqueda' (usar 'portada'); allowAiChatbot, allowStoreOffers y featuredInHome además exigen insignia.
- Configuraciones que sobran: SiteSettings.cupSubscriptionPriceCup y cardSubscriptionPriceUsd (solo los lee Nova, con datos viejos), SUBSCRIPTION_PRICE_USD en stripe.js, allowPanelOrders, el endpoint cup-payment aceptando precios. Más estrictas: isFree/contactOnly excluyentes, grantsBadge con confirmación, descuentos 2 a 24, features con tope.

(c) Lugares que asumen los 4 planes fijos (para poder crear y borrar planes)
Base de datos: enum PlanType (schema.prisma:35) usado en PlanConfig.planType (@unique), Vendor.planType (@default REGULAR), VerificationRequest.paymentPlanType, SubscriptionPayment.planType, PartnerPlanPrice.planType (PK compuesta).
Backend:
- controllers/settings.controller.js:227 z.enum de 4; :289 regla solo para REGULAR.
- controllers/admin.controller.js:58 PAID_PLAN_TYPES; :59 SUBSCRIPTION_SCOPE; :132 conteo; :400/:420/:456 filtro plan y 'PAID'; :1376 ADMIN_PLAN; :1703/:1711/:1731 REGULAR; :1762 enum de grant.
- controllers/verification.controller.js:43 PAYABLE_PLAN; :436, :1079, :1121, :1122, :1182 default BUSINESS; :1060 fallback BUSINESS; :1252, :1264 lista REGULAR/STANDARD/BUSINESS para metadata de Stripe.
- lib/planConfig.js:83 paymentPlanOf -> BUSINESS; :155 isPremiumActive REGULAR.
- lib/stripe.js:49, 102, 120, 217, 243, 385 default BUSINESS.
- services/vendorVerification.service.js:46, 48, 203, 212, 229, 232 (REGULAR como 'gratis' y BUSINESS como destino de restauración).
- services/planDowngrade.service.js:40 REGULAR; services/trialEligibility.service.js:90, 142; jobs/trialExpiry.job.js:49.
- controllers/vendors.controller.js:185, 268 (registro en REGULAR), 629 z.enum REGULAR/BUSINESS, 778, 841, 855.
- controllers/products.controller.js:785, 786, 846, 847 (REGULAR solo pago universal).
- controllers/campaigns.controller.js:27 y targetedOffers.controller.js:103, 447, 448 (segmentos regular/business).
- controllers/summary.controller.js:119, 122; lib/assistantTools.js:559; controllers/businessAssistant.controller.js:31 (BUSINESS); controllers/seoPages.controller.js:429; controllers/partnerPortal.controller.js:74; controllers/adminVendorManage.controller.js:185; lib/platformFacts.js:38 (regular/business).
Frontend:
- lib/usePlatformSettings.js:51-54 planNames con 4 claves y nombres de reserva.
- pages/admin/AdminSubscriptions.jsx:301, 535, 581 (lista fija de planes a activar), 562.
- pages/admin/AdminVendorManage.jsx:120, 190, 248, 251, 381; pages/admin/AdminVerifications.jsx:1157; pages/admin/AdminCampaigns.jsx:330; pages/admin/AdminVendors.jsx:594.
- lib/planStatus.js:14; lib/verificationMeta.js:17; components/PlanComparisonModal.jsx:46, 51; components/vendor/TrialOfferPopup.jsx:37; components/vendor/SubscriptionOverview.jsx:201; components/vendor/TrialStatusBanner.jsx:36-43; pages/vendor/VendorVerification.jsx:85; pages/vendor/PagoManual.jsx:197; pages/public/Account.jsx:970; pages/public/Home.jsx:515; pages/partner/PartnerPlans.jsx:43.
Textos con 'Premium'/'Regular' fijos: planDowngrade.service.js, pos.controller.js:551, invoices.controller.js:104/169, orders.controller.js:963/969, products.controller.js:779, AdminSubscriptions.jsx:465/624/634/722/788-789.

Qué haría falta, por pasos (sin romper datos):
1) Migración: crear tabla Plan (id cuid, slug único, ...todo lo de PlanConfig..., isSystem, archivedAt). Copiar las 4 filas con ids estables 'plan_regular', 'plan_standard', 'plan_business', 'plan_enterprise'. Agregar Vendor.planId (FK) y planId en VerificationRequest, SubscriptionPayment, PartnerPlanPrice; rellenar desde el enum; luego quitar las columnas enum (o mantenerlas un tiempo como espejo).
2) Reemplazar los 'roles' que hoy da el nombre del enum por banderas del plan: isDefault (el plan de registro y de bajada, hoy REGULAR; exactamente uno), isTrialPlan (hoy BUSINESS), contactOnly ya existe, grantsBadge ya existe. Con eso desaparecen PAID_PLAN_TYPES (= !isDefault o !isFree), paymentPlanOf (fallback al plan de prueba) y los defaults de stripe.js.
3) Validaciones zod: z.string().cuid() + existencia en la tabla y no archivado, en lugar de z.enum.
4) Borrar = archivar: no se permite si tiene tiendas; si tiene, pedir plan destino y mover (con recalc de cupos y aviso), cancelando Stripe si el destino es gratis. Nunca borrar el isDefault ni el isTrialPlan. Los pagos históricos siguen apuntando al plan archivado.
5) planNames pasa a ser un mapa por id construido desde /settings/plans; los segmentos de campañas pasan a 'plan gratis' y 'planes de pago' calculados.

(d) Funciones del plan como casillas sin tocar código
Datos: tabla PlanFeature (key único, label, description, kind 'flag' | 'limit', unit, group: 'Ventas', 'Equipo', 'Marketing', 'Visibilidad'; requiresBadge bool; publicLabelOn, publicLabelLimit con {n}; sortOrder; enforcedBy texto informativo) y tabla PlanFeatureValue (planId, featureKey, enabled bool, limit int null). Las claves solo pueden ser las que el código conoce (catálogo sembrado por migración), porque cada función necesita su punto de cumplimiento en el servidor: el admin no inventa funciones, pero sí cambia nombres, textos públicos, orden, agrupación y valores por plan sin desplegar. Un registro en código (lib/planFeatures.js) declara FEATURE_KEYS y, al arrancar, avisa si hay una clave en la base sin cumplimiento o al revés.
API única: planAllows(vendor, key) y planLimit(vendor, key) leen PlanFeatureValue (con caché como hoy); buildPlanIncludes, publicPlan, PlansCatalog (LIMIT_ROWS, FLAG_ROWS), platformFacts y AdminSubscriptions (PLAN_LIMIT_FIELDS, PLAN_TOGGLE_FIELDS) se generan desde el catálogo, así nunca vuelven a divergir. requiresBadge reemplaza los 'verificationStatus === VERIFIED' sueltos.
Interruptor + límite juntos: una sola fila por función con 'Incluida' y 'Hasta N (vacío = ilimitado)', así no existe el estado incoherente de hoy (límite 1 con la función apagada).

(e) Estadísticas por plan
Endpoint GET /admin/plan-stats?desde&hasta devolviendo por plan: tiendas totales, pagando al día, en prueba, cobro atrasado (billingNoticeStage due/after), suspendidas por pago, activadas a mano sin pago, altas y bajas del periodo (VerificationStatusLog y cambios de planType; conviene una tabla VendorPlanChange), ingresos confirmados por moneda (VerificationRequest.paymentPlanType + SubscriptionPayment.planType, sin la doble cuenta del pago manual; mejor aún, escribir el pago inicial también en SubscriptionPayment y usar solo esa tabla), MRR por moneda (monto del pago vigente / meses) y ARPU. Dónde: (1) en cada tarjeta de plan del admin (tiendas, MRR, tendencia 30 días); (2) en la ventana Configurar, pestaña Resumen con gráfico de 12 meses de ingresos y altas/bajas; (3) en Suscripciones, columna y filtro Plan y métricas separadas por plan; (4) en el Dashboard, una fila 'Ingresos por plan' por moneda. Nada de convertir CUP a USD sin tasa explícita: mostrar las dos monedas.

(f) Estructura de pantalla propuesta (Configuración > Planes y pagos)
- Encabezado: 'Planes' + botón 'Crear plan' (44px) + enlace 'Ver página de planes'.
- Rejilla de tarjetas (1 columna a 390px, 2 en tablet, 4 en escritorio), una por plan en su sortOrder, con: nombre y frase, chips de estado (Gratis / De pago / Por WhatsApp / Oculto / Más elegido / Da insignia / Plan de prueba / Plan por defecto), precio mensual CUP y USD, número de tiendas (enlace a Tiendas filtrado por plan), MRR por moneda, y botones 'Configurar' y menú (Duplicar, Ocultar, Archivar). Arrastrar o flechas para el orden.
- 'Configurar' abre una ventana (hoja a pantalla completa en móvil, panel lateral de 720px en escritorio) con pestañas: Resumen (estadísticas), Precio y venta (gratis, por WhatsApp, precios, tachado, descuentos 3/6/12/24 meses, público, más elegido, insignia con confirmación de impacto), Funciones y límites (catálogo agrupado; cada fila con casilla 'Incluida', campo 'Hasta' y descripción de qué hace y si exige insignia), Beneficios extra (chips con vista previa exacta de 'Tu plan incluye'), Historial de cambios. Pie fijo con 'Guardar' que muestra antes de confirmar un resumen del impacto: 'Esto afecta a N tiendas: X productos quedarán ocultos, Y usuarios del equipo quedarán sin acceso, Z suscripciones de tarjeta siguen con el precio anterior'. Pide el código PLAN_CONFIG_CHANGE como hoy.
- Debajo, tarjetas aparte: 'Prueba gratis' (plan de prueba elegible y días), 'Cobro y suspensión' (días sin pagar, recordatorios) y 'Datos de transferencia CUP'. Estados de carga (skeleton de 4 tarjetas), error con Reintentar y vacío ('Todavía no hay planes. Crea el primero').
- Crear plan: asistente corto (nombre, copiar funciones de un plan existente, precio) que crea el plan oculto para revisarlo antes de publicarlo.
- Borrar/archivar: modal que exige elegir plan destino si tiene tiendas y explica qué pasa con cobros y Stripe.

Verificado sin ejecutar nada (solo lectura). No pude comprobar los valores reales de la base (por ejemplo si cardSubscriptionPriceUsd sigue en 25), por eso el hallazgo de Nova depende de ese dato; el código sí lee esos campos viejos.

</details>

<details><summary>Notas del subagente: Tiendas y socios</summary>

Solo lectura: no ejecuté nada y no abrí archivos de claves ni .env. Lo más urgente es la línea 474 de admin.controller.js: cualquier llamada con plan=PAID (Campañas > tiendas con plan de pago) da 500. Después vienen los dos agujeros de servidor en tiendas: desbloquear una tienda en eliminación pendiente y restaurar perdiendo el bloqueo previo. Mirando los códigos de acción: las rutas de tienda los tienen bien (VENDOR_CHANGE, BLOCK, UNBLOCK, DELETE, RESTORE, PLAN_CHANGE, ACCOUNT_ACCESS_CHANGE). En socios falta el código en PATCH /partners/:id (suspender o reactivar) y en el rechazo de solicitudes; lo segundo es razonable porque no toca credenciales. No revisé a fondo RepresentativeFileModal, VendorUsage, VendorOrdersPanel ni OrderLookup (solo sus grillas) ni el portal del socio. Un socio suspendido sigue pudiendo entrar a /socio y ver su llave (partnerPortal.controller.js:53); puede ser intencional para que vea su estado, pero conviene confirmarlo con el dueño.

</details>

<details><summary>Notas del subagente: Clientes, reportes y moderación</summary>

Permisos: todas las rutas de estas secciones están bajo `router.use(authenticate, requireRole("ADMIN"))` (admin.routes.js:48), y las acciones destructivas piden código de acción (CUSTOMER_CHANGE, DELETE_CUSTOMER, FRAUD_DECISION, CONTENT_MODERATION, PLATFORM_SETTINGS). No encontré endpoints accesibles por otros roles. No llevan código, y parece intencional porque no destruyen nada: pausar plazo, pedir evidencia, responder comentario, resolver caso de soporte y marcar anomalías. Estas pantallas no tienen reglas de plan. El interceptor de api.js vacía el mensaje al cancelar el código y toast.jsx no muestra avisos vacíos, así que los onError sin revisar actionCodeCancelled no muestran errores falsos. No ejecuté nada: los desbordes a 390px se revisaron leyendo las clases. Los listados usan flex-col o tarjeta en celular, min-w-0 y break-all, y no vi desbordes horizontales evidentes.

</details>

<details><summary>Notas del subagente: Catálogo y ubicaciones</summary>

Revisión hecha solo leyendo código. Las rutas de admin están protegidas por authenticate + requireRole('ADMIN') (admin.routes.js l.48), y los borrados de catálogo y ubicaciones piden código de acción. Saltarse los límites de plan en adminProducts es intencional (comentario l.25-28). CatalogOptionsManager y adminCatalog.controller están bien hechos: tienen cargando, error, vacío, botones de 44px y reglas de 'al menos una activa' en el servidor. Lo más importante para corregir primero: (1) el choque de OR entre búsqueda y estado 'hidden' en listAllProducts; (2) que el admin cambie el precio sin revalidar los precios por cantidad; (3) que el modal del admin mande stock y otros campos viejos; (4) que POST /categories no use requireVendorWrite('productos'); (5) deleteProvince sin revisar sus usos (puede dar 500 por Address); (6) códigos de país no ISO que dejan el país invisible; (7) el diseño de AdminLocations a 390px y sus botones pequeños.

</details>

<details><summary>Notas del subagente: Ofertas, códigos, campañas y ventas</summary>

Todo se revisó en solo lectura. Hallazgos más graves:
(1) Editar una venta manual sin nota falla siempre: el frontend manda null y zod lo rechaza.
(2) Las campañas y ofertas dirigidas se envían en un único correo con todos los destinatarios en `to`. Expone los correos de todos y falla con más de 50 direcciones (límite de Resend).
(3) La suspensión que pone el admin a ofertas de tienda y códigos de descuento la puede deshacer la tienda, porque se reusa el campo `active`.
(4) Las ofertas de tienda no se apagan ni se ocultan al bajar a un plan que no las permite: no hay comprobación de plan al reactivar ni en la vista pública.

Lo de plan=PAID en /admin/vendors queda fuera de los archivos asignados (admin.controller.js), pero rompe el contador de AdminCampaigns.

El admin pide código de acción (requireActionCode) en discount-codes, store-offers y vendor-staff-sales. El frontend lo resuelve con ActionCodeProvider y api.js; eso se vio en el grep, pero no se probó en ejecución.

Las X de los modales cierran sin preguntar por cambios sin guardar: llaman a onClose directo en lugar de requestClose, que el hook useDirtyModal sí expone. Podría ser intencional y no se reporta.

No se revisaron VendorStoreOffers ni VendorDiscountCodes, el lado de la tienda, porque son de otra área.

</details>

<details><summary>Notas del subagente: Configuración, marca e integraciones</summary>

Revisión solo de lectura. Lo más grave: el chat de Nova contesta precios con columnas de SiteSettings que ya no se pueden editar, presenta el Básico siempre como gratis y no conoce Estándar ni Empresarial, lo que rompe la regla 3. AdminSettings.jsx solo arma las pestañas y no tiene errores propios; las Tabs se desplazan en horizontal sin desbordar. Comprobé que se usan todos los campos de SiteSettings que se editan en estas pantallas (redes, soporte, zona horaria, etiquetas, PWA, recordatorios, seguimiento de pedidos, mantenimiento). Las únicas columnas sin efecto real son productPaymentMethods, availableCurrencies, cupSubscriptionPriceCup y cardSubscriptionPriceUsd. No ejecuté la app; los desbordes a 390px salen de leer las clases, no de capturas.

</details>

<details><summary>Notas del subagente: Contenido y páginas</summary>

Permisos: todas las rutas de edición están bajo /admin con router.use(authenticate, requireRole("ADMIN")) (admin.routes.js:48). Las públicas (GET /static-pages/:slug, GET /faq, POST /contact) no piden sesión, como corresponde. POST /suggestions exige VENDOR o CUSTOMER (VENDOR_STAFF y PARTNER quedan fuera). Esta área no tiene límites de plan que comprobar. Conexiones: los endpoints y campos que usa el frontend existen (pages[].slug/htmlContent/updatedAt; items de FAQ; suggestions[].authorName/authorType/status) y lo editado en el admin llega a /terminos, /privacidad, /ayuda, /contacto (solo la columna informativa) y /faq. El HTML estático se sanitiza al guardar y el de la FAQ al servir en público. Nota: listStaticPagesAdmin dice 'las 5 páginas' en el comentario, pero son 4 (no afecta). El correo de contacto escapa nombre, correo y mensaje (templates/contactMessage.js). No ejecuté nada; es una revisión de solo lectura.

</details>


## Vendedores

Revisé en el código todos los hallazgos altos y medios. Casi todos son reales; los que responden a una decisión documentada del dueño pasaron a "intentional". El problema de fondo es que el panel del vendedor no conoce los flags del plan: el NAV y las pantallas solo filtran por rol y sección, y assertPlanAllows no devuelve planRequired, así que la regla 2 falla en casi todo el panel. A eso se suman topes de plan que se cumplen al crear pero no al activar ni al reactivar (productos al subir la foto, ofertas, códigos, personal), y por eso la regla 1 tampoco se cumple. En la suscripción hay dos fallos de dinero: al pasar a tarjeta, una tienda puede subir de plan y usarlo gratis hasta que vence lo ya pagado (trial_end), y el webhook descarta los cobros con tarjeta del Básico de pago. Para la regla 3 propongo un diseño de planes dinámicos que recoge las notas de los subagentes: (a) /vendors/me devuelve `planFeatures`, con los flags y límites efectivos calculados con planAllows e isPremiumActive, y el panel oculta o limita a partir de eso; (b) los planes que se pueden pagar se validan contra PlanConfig (existe, isPublic, ni gratis ni contactOnly) en vez del enum fijo PAYABLE_PLAN, y los webhooks usan la misma comprobación; (c) el plan elegido en /planes se guarda en Vendor.requestedPlanType; (d) todos los textos usan displayName. Un plan nuevo de verdad exige migrar el enum planType de Prisma a un String con FK a PlanConfig. En mesas hay un doble descuento de stock que se reproduce desde el panel ("Agregar consumo" en una cuenta en Recibido y después "Aceptar").

### Errores confirmados (54)

**64. [ALTA] La casilla "Ofertas" del selector de secciones hace fallar con 400 la creación y edición de personal**  
`frontend/src/lib/vendorSections.js:16` · conexion  
*Por qué:* El front sigue listando { key: "ofertas" }. El back la quitó en 71a6b0f (Bloque 297, backend/src/constants/vendorSections.js:19-36) y vendorStaff.controller.js:60, 104, 211 y 215 validan con z.enum(VENDOR_SECTION_KEYS). La cabecera del archivo exige claves EXACTAS: se borró en un lado y no en el otro. Las etiquetas también difieren entre front y back ("reportes": Reportes / Reportes de fraude; "ventas-manuales": Productos Asignados / Agentes de Ventas), y sectionForPath no cubre usuarios ni pago-manual.  
*Arreglo:* 1) Quitar { key: "ofertas" } de VENDOR_SECTIONS en frontend/src/lib/vendorSections.js. 2) Fuente única: SectionAccessPicker.jsx y VendorUsers.jsx arman el selector con `sections` de GET /vendor-staff (ya existe, vendorStaff.controller.js:39), y el back devuelve [{key,label}] desde constants/vendorSections.js. 3) Unificar las etiquetas en el back ("Productos Asignados", "Reportes") y completar sectionForPath. 4) Prueba: crear y editar personal marcando todas las casillas, a 390px y en escritorio.

**65. [ALTA] El tope de productos del plan se salta: activar un producto (al subir foto o por PATCH) nunca mira maxProducts**  
`backend/src/controllers/products.controller.js:774` · permisos_plan  
*Por qué:* createProduct cuenta los activos (l.776), pero el producto nace inactivo (l.763) y se activa en addProductImages (l.948) y addProductImageLink (l.1039) sin mirar el tope. updateProduct acepta isActive (l.65). products.controller.js nunca llama a recalcVendorProductQuota, aunque planConfig.js:194-196 dice que se llama 'al crear/activar/desactivar un producto'. Con 9 de 10 activos se crean 5 borradores, se les sube foto y quedan 14 públicos (overQuota=false por defecto). El fallo nace de la pausa forzada del Bloque 56, que movió la activación a la subida de foto.  
*Arreglo:* 1) En backend/src/controllers/products.controller.js, crear assertCanActivateProduct(vendor, productId) que cuente isActive && !overQuota contra getPlanLimit(maxProducts). 2) Llamarlo en addProductImages, addProductImageLink y updateProduct cuando isActive pasa de false a true; o, más simple y robusto, llamar a recalcVendorProductQuota(vendor.id) después de cada cambio de isActive, de modo que el excedente quede overQuota:true sin error. 3) createProduct: contar activos sin overQuota. 4) Prueba: con el tope en 3, crear 5 borradores, subirles foto y comprobar que solo 3 salen públicos.

**66. [ALTA] Doble descuento de stock en mesas: consumo agregado a una cuenta que todavía está en Recibido**  
`backend/src/controllers/tables.controller.js:954` · bug  
*Por qué:* addTableOrderItem (l.481-520) descuenta stock al agregar y deja la línea en PREPARING, pero acepta cuentas en RECEIVED. Al aceptar, updateKitchenStatus RECEIVED→PREPARING recorre TODOS los items (l.959) y vuelve a descontar. El comentario de l.947-953 da por hecho que en RECEIVED no se descontó nada, y eso dejó de ser cierto con el Bloque 190. Mismo origen: cancelTableOrder no repone en RECEIVED (shouldRestock, l.426) y attachSaleToTable (pos.controller) suma líneas ya descontadas.  
*Arreglo:* Opción recomendada: marcar cada item con stockTaken:true cuando se descuenta (addTableOrderItem, createManualTableOrder, attachSaleToTable) y, en updateKitchenStatus (l.959), saltar los que ya lo tienen. cancelTableOrder y updateTableOrderItems reponen solo los stockTaken. Alternativa rápida: rechazar con 409 'Acepta primero el pedido' en addTableOrderItem y attachSaleToTable si kitchenStatus === RECEIVED, y ocultar 'Agregar consumo' en TableOrderDetailModal.jsx:422 mientras siga en Recibido. Prueba: stock 10, cuenta QR con 2 en Recibido, agregar 1, aceptar y comprobar que queda en 7.

**67. [ALTA] Al pasar a cobro con tarjeta, una tienda verificada puede subir de plan y usarlo gratis hasta que vence lo pagado**  
`backend/src/controllers/verification.controller.js:1079` · permisos_plan  
*Por qué:* En modo switching, renewalPlanFor (l.751-758) acepta cualquier plan con insignia y la suscripción se abre con trialEnd = nextPaymentDueDate (l.1109). activateFromCardSubscription aplica planType al instante (l.1210). PaymentChooser con `switching` muestra el selector de plan. El trial_end se pensó para no cobrar dos veces el MISMO plan (comentario l.1108), no para regalar la diferencia: un Estándar elige Premium, lo usa gratis y, si cancela antes del vencimiento, nunca paga.  
*Arreglo:* 1) startMyCardSubscription: si switching y body.planType distinto de vendor.planType, responder 409 ('Para cambiar de plan escríbenos o espera al vencimiento'), o forzar planType = vendor.planType. 2) frontend/src/components/vendor/PaymentChooser.jsx: con `switching`, ocultar el selector de plan y fijar initialPlanType. 3) Si el dueño quiere permitir subir de plan, implementarlo aparte cobrando el prorrateo (Stripe proration) y sin trial_end. 4) Prueba: un Estándar en CUP pasa a tarjeta intentando Premium y la API lo rechaza.

**68. [ALTA] Básico de pago: el cobro con tarjeta se hace, pero el webhook lo descarta y no queda registrado**  
`backend/src/controllers/verification.controller.js:1034` · conexion  
*Por qué:* handleRenewalCheckoutCompleted sale si verificationStatus !== VERIFIED. Las tiendas del Básico de pago no pasan por la verificación (planBilling.service.js:7-9) y pagan con createRenewalCheckoutSession (renewal). Stripe cobra, pero no se marca stripePaidAt, no se avisa al admin y la tienda sigue atrasada hasta la suspensión. renewalPlanFor (l.759-761) ya acepta paysWithoutBadge; el webhook se quedó con el criterio anterior.  
*Arreglo:* 1) En handleRenewalCheckoutCompleted, sustituir la condición VERIFIED por una función compartida canPayRenewal(vendor, payment.planType) que use la misma regla que renewalPlanFor (verificada, o plan propio de pago sin insignia). 2) Valorar extender nextPaymentDueDate y limpiar billingSuspendedAt/billingNoticeStage al confirmar Stripe, sin esperar al admin. 3) Añadir 'renew-success' en VendorVerification (ver el hallazgo propio). 4) Prueba con Stripe en modo test sobre un Básico de pago.

**69. [ALTA] Las ofertas de tienda siguen públicas y se pueden reactivar después de bajar de plan**  
`backend/src/controllers/storeOffers.controller.js:182` · permisos_plan  
*Por qué:* updateStoreOffer solo llama a assertActiveOfferLimit al encender, sin assertPlanAllows(allowStoreOffers) ni la verificación. getStoreOfferPolicy (settings.controller.js:183-186) devuelve maxActiveStoreOffers sin mirar allowStoreOffers. La consulta pública (vendors.controller.js:348-358) lista active:true sin plan. El cliente ve una oferta cuyo código resolveDiscountForOrder rechaza (discountCodes.controller.js:235). Para los códigos hay una decisión explícita de conservarlos sin aplicarlos; para las ofertas no hay ninguna.  
*Arreglo:* 1) updateStoreOffer: si data.active && !existing.active, aplicar las mismas puertas que createStoreOffer (plan y verificación, ver el hallazgo de insignia). 2) getStoreOfferPolicy: maxActive = allowStoreOffers ? maxActiveStoreOffers : 0. 3) vendors.controller.js getStoreBySlug: si !planAllows(planType,'allowStoreOffers') (o !allowDiscountCodes), devolver storeOffers: [], y recortar a maxActiveStoreOffers. 4) applyPlanDowngrade y updatePlanConfig: apagar con storeOffer.updateMany las que sobren. 5) Prueba: bajar de Premium a Básico y comprobar que la oferta desaparece de la tienda pública.

**70. [ALTA] El panel no oculta lo que el plan no permite (Caja, Mesas, Puntos, Ofertas y códigos, Usuarios, Email de pedidos)**  
`frontend/src/pages/vendor/VendorLayout.jsx:340` · permisos_plan  
*Por qué:* El filtro del NAV (l.340-352) y la redirección (l.360-373) solo miran restaurantOnly, unverifiedOnly, staffOnly y las secciones del personal, nunca flags del plan. VendorStoreOffers solo mira isVerified (l.312) y muestra siempre 'Crear código' (l.466). VendorUsers muestra 'Crear usuario'. VendorOrders muestra 'Email' sin mirar allowCustomerEmails. assertPlanAllows (planConfig.js:177-182) no adjunta planRequired, así que PlanUpsell/isPlanError no reconocen esos 403; solo requirePosPlan lo adjunta. Resultado: errores 403 sin explicación, contra la regla 2.  
*Arreglo:* 1) backend/src/lib/planConfig.js: assertPlanAllows lanza AppError(..., 403, { planRequired: flag }). 2) vendors.controller.js getMyVendor: añadir `planFeatures` (flags efectivos con planConfig + isPremiumActive y límites maxX) también para el personal. 3) VendorLayout.jsx NAV: añadir planFlag por entrada (caja→allowPos, mesas→allowQrTables, puntos→allowLoyalty, ofertas-tienda→allowStoreOffers||allowDiscountCodes, usuarios→allowStaffUsers) y filtrar NAV y redirección con planFeatures. Si el dueño prefiere vender la mejora, mostrar PlanUpsell en lugar de la pantalla, pero nunca un botón que falla. 4) En las páginas: VendorStoreOffers (pestañas según cada flag), VendorUsers (PlanUpsell si !allowStaffUsers), VendorOrders (ocultar Email si !allowCustomerEmails; getEmailUsage devuelve allowed). 5) Prueba con cada plan, entrando por enlace directo.

**71. [MEDIA] Una tienda bloqueada sigue editando datos y gestionando personal por las rutas solo del dueño**  
`backend/src/routes/vendors.routes.js:38` · seguridad  
*Por qué:* PATCH /me, /me/logo, /me/schedule, /me/locations, /me/delivery-countries, /me/ai-document y todo vendorStaff.routes.js usan requireRole("VENDOR"), que no corre assertVendorUsable. El comentario de requireVendorAccess.js:14-16 dice que, bloqueada, 'toda escritura queda cerrada'. Solo la pantalla lo impide (VendorLayout.jsx:335).  
*Arreglo:* 1) En backend/src/middleware/requireVendorAccess.js, exportar requireVendorOwner({ strict = true }) = requireRole VENDOR + assertVendorUsable(req, null, { strict }). 2) Usarlo en las rutas de escritura de vendors.routes.js y vendorStaff.routes.js. 3) Dejar con requireRole a secas, y con un comentario, solo lo necesario para pagar o reactivar (verification.routes.js, /me/trial*). 4) Prueba: bloquear la tienda desde el admin y comprobar que PATCH /vendors/me da 403.

**72. [MEDIA] Mesas y paso de caja a mesa sin control de plan ni de tipo de negocio en el servidor**  
`backend/src/controllers/tables.controller.js:721` · permisos_plan  
*Por qué:* Solo createTable (l.788-791) mira isRestaurant y allowQrTables. createManualTableOrder, addTableOrderItem, las operaciones de cocina y pos attach/send-to-table no lo hacen. Una tienda que bajó de plan sigue abriendo cuentas en sus mesas viejas por la API.  
*Arreglo:* 1) Crear requireTablesPlan en tables.routes.js (como requirePosPlan en pos.controller.js:549): isRestaurant + allowQrTables, con planRequired. 2) Aplicarlo a /tables/me*, /tables/orders/* y a las rutas de pos que adjuntan a mesa. 3) Las lecturas pueden seguir abiertas para ver el historial. 4) Decidir con el dueño qué pasa con las mesas por encima de maxTables tras bajar de plan (desactivar las más nuevas).

**73. [MEDIA] Regalar o ajustar puntos funciona aunque el plan no incluya fidelidad**  
`backend/src/controllers/loyalty.controller.js:205` · permisos_plan  
*Por qué:* adjustMemberPoints no consulta el plan; saveMyProgram sí lo hace (l.150-151). Una tienda Básica puede crear saldos y avisar al cliente (notifyPointsAdjusted) de unos puntos que no se pueden canjear.  
*Arreglo:* 1) En adjustMemberPoints, assertPlanAllows(vendor, 'allowLoyalty', ...) o exigir activeProgramFor. 2) VendorLoyalty.jsx: ocultar 'Regalar puntos' cuando !data.planAllows. 3) Prueba con Básico por API.

**74. [MEDIA] El tope de personal cuenta a los inactivos, no se puede liberar un cupo y bajar maxStaffUsers no corta a los que sobran**  
`backend/src/controllers/vendorStaff.controller.js:128` · permisos_plan  
*Por qué:* count({ vendorId }) incluye a los desactivados y no hay endpoint para borrar personal (desactivar es intencional, para conservar el historial). Al llegar al tope, el dueño no puede reemplazar a un empleado que se fue. assertStaffPlan (requireVendorAccess.js:6-12) solo mira allowStaffUsers, nunca maxStaffUsers.  
*Arreglo:* 1) Contar solo isActive:true en createMyStaff y validar el tope también en updateMyStaff al reactivar. 2) En assertStaffPlan, si los activos superan maxStaffUsers, dejar entrar solo a los N más antiguos (ordenados por createdAt) y responder 403 con planRequired:'maxStaffUsers' a los demás. 3) VendorUsers.jsx: mostrar 'X de Y usuarios de tu plan' con planFeatures.

**75. [MEDIA] El tope de códigos de descuento cuenta los históricos, que no se pueden borrar si se usaron: la tienda queda bloqueada para siempre**  
`backend/src/controllers/discountCodes.controller.js:103` · permisos_plan  
*Por qué:* count({ vendorId }) cuenta inactivos y vencidos, y delete rechaza los usados (l.212). El propio mensaje propone 'solo desactivarlo', pero desactivar no libera cupo. Al reactivar no se mira el tope, y si el admin lo baja, los códigos que sobran siguen aplicándose.  
*Arreglo:* 1) Contar active:true y no vencidos al crear. 2) En updateDiscountCode, aplicar el mismo tope cuando active pasa de false a true. 3) DiscountCodesTab en VendorStoreOffers.jsx: mostrar 'X/N códigos activos'.

**76. [MEDIA] Cualquier error al cargar /vendors/me manda al login sin explicación (cortes de red, 5xx o personal de una tienda que bajó de plan)**  
`frontend/src/pages/vendor/VendorLayout.jsx:310` · conexion  
*Por qué:* if (isError) Navigate('/vendedor/ingresar'). El comentario lo pensó solo para un VENDOR sin tienda (404). Un corte de red, frecuente en Cuba, o el 403 planRequired que assertStaffPlan da al personal terminan en el login sin mensaje.  
*Arreglo:* 1) Leer error.response.status: 404 lleva al login; 403 con planRequired o vendorState muestra una pantalla propia ('El plan de la tienda ya no incluye usuarios del equipo. Habla con el dueño.' + Cerrar sesión); red o 5xx muestran un estado de error con Reintentar. 2) Cambiar retry:false por retry con 2 intentos, salvo 4xx.

**77. [MEDIA] El bloqueo por URL del personal compara la ruta exacta: con una barra final se entra a pantallas solo del dueño**  
`frontend/src/pages/vendor/VendorLayout.jsx:362` · permisos_plan  
*Por qué:* NAV.find(n => n.to === location.pathname). Con /vendedor/configuracion/ no hay coincidencia y blocked queda en false. El servidor rechaza las escrituras, pero se pinta Configuración con datos operativos. El comentario de l.354-359 pide justo lo contrario.  
*Arreglo:* Normalizar const path = location.pathname.replace(/\/+$/, '') || '/vendedor' y buscar por prefijo de segmento (path === n.to || path.startsWith(n.to + '/')), eligiendo la coincidencia más larga. Mejor a medio plazo: un guardián por ruta en App.jsx con section/ownerOnly.

**78. [MEDIA] Guardar Configuración da error siempre si el admin apaga 'Horarios de atención' en el plan**  
`frontend/src/pages/vendor/VendorSettings.jsx:407` · permisos_plan  
*Por qué:* Promise.all([saveProfile, saveSchedule]) manda siempre PATCH /me/schedule, y updateSchedule exige allowSchedules (vendors.controller.js:1137). El interruptor existe en AdminSubscriptions.jsx:119 y VendorSettings no lo mira. Si el admin lo apaga, cada guardado muestra error aunque el perfil sí se guardó.  
*Arreglo:* 1) Con planFeatures.allowSchedules, ocultar la tarjeta de horarios y no llamar a saveSchedule. 2) Enviar el horario solo si `days` cambió respecto al baseline. 3) Usar Promise.allSettled y mostrar un toast por cada parte.

**79. [MEDIA] El personal con solo 'Resumen' ve el correo y el teléfono de los clientes potenciales**  
`backend/src/controllers/vendors.controller.js:1311` · permisos_plan  
*Por qué:* getDashboard (requireVendorAccess('resumen'), vendors.routes.js:65) devuelve potentialCustomers con email y phone. Esos datos tienen su propia sección delegable ('clientes').  
*Arreglo:* En getDashboard, si req.vendorStaff no tiene 'clientes' en allowedSections, quitar email y phone (devolver solo el conteo o el nombre). En VendorDashboard.jsx, ocultar los enlaces a secciones que el usuario no tiene.

**80. [MEDIA] El personal de tiendas que no son restaurante nunca recibe avisos de pedidos nuevos**  
`frontend/src/pages/vendor/VendorUsers.jsx:212` · bug  
*Por qué:* La casilla receivesOrderNotifications solo aparece si isRestaurant (también en EditStaffModal, l.354). El comentario (l.206-211) es anterior al Bloque 231, que montó NewRegularOrderPopup para todas las tiendas (VendorLayout.jsx:690-693) con la condición receivesOrderNotifications.  
*Arreglo:* Mostrar la casilla en todas las tiendas, en los dos modales. Fuera de restaurantes, activarla por defecto si se marca la sección 'pedidos'. Actualizar el comentario.

**81. [MEDIA] El personal con solo 'Pedidos' no puede modificar pedidos ni agregar consumo: /products/me/list exige productos o mesas**  
`backend/src/routes/products.routes.js:25` · conexion  
*Por qué:* requireVendorAccess('productos','mesas'). EditOrderModal, EditTableOrderModal, CreateManualOrderModal y TableOrderDetailModal dependen de esa lista y se muestran a quien escribe en 'pedidos': el resultado es un selector vacío y un 403.  
*Arreglo:* Añadir 'pedidos' (y 'caja' si aplica) a requireVendorAccess en /me/list, o crear GET /products/me/picker con solo id, nombre, precio, moneda y stock, accesible desde pedidos, mesas y caja.

**82. [MEDIA] La pestaña Ofertas falla para el personal sin la sección 'codigos-descuento'**  
`frontend/src/pages/vendor/VendorStoreOffers.jsx:266` · conexion  
*Por qué:* StoreOffersTab llama a GET /discount-codes/me/list, que exige 'codigos-descuento' (discountCodes.routes.js:13). Con solo 'ofertas-tienda' no se puede elegir código, así que no se puede crear ni editar ofertas.  
*Arreglo:* discountCodes.routes.js:13: requireVendorAccess('codigos-descuento','ofertas-tienda'). En el front, ocultar '+ Crear nuevo' si no tiene escritura en 'codigos-descuento'.

**83. [MEDIA] No se puede eliminar una mesa que alguna vez tuvo un pedido cancelado, y al eliminarla se borra el historial cobrado**  
`backend/src/controllers/tables.controller.js:874` · bug  
*Por qué:* Filtra clearedAt:null sin cancelledAt:null (listMyTables sí lo excluye). Además, TableOrder→Table tiene onDelete: Cascade (schema.prisma:2247), así que borrar la mesa borra sus cuentas cobradas, contra el Bloque 167 (los movimientos deben quedar registrados).  
*Arreglo:* 1) where: { clearedAt: null, cancelledAt: null }. 2) Borrado lógico: añadir Table.deletedAt (migración escrita a mano), filtrarlo en listados y QR, y no borrar físicamente. Otra opción: onDelete SetNull guardando tableNumber/label en TableOrder.

**84. [MEDIA] 'Efectivo en caja hoy' se calcula solo con los últimos 200 movimientos**  
`backend/src/controllers/pos.controller.js:113` · bug  
*Por qué:* cashSummary suma byCurrency sobre findMany take:200. El límite tiene sentido para la lista, no para el total. Un día con mucho movimiento da un total de menos sin aviso.  
*Arreglo:* Calcular el total con prisma.cashEntry.groupBy({ by:['currency'], where, _sum:{ amount:true } }) y dejar take:200 solo para la lista, con un aviso de 'y N más'. Revisar el take:80 de getState (l.161).

**85. [MEDIA] Los items de una cuenta de mesa se leen y escriben sin bloqueo y se pierden rondas**  
`backend/src/controllers/tables.controller.js:1256` · bug  
*Por qué:* createTableOrder lee existingOrder fuera de la transacción (l.1256) y escribe [...existing.items, ...nuevos] (l.1299 y siguientes). addTableOrderItem y los demás leen fuera y escriben dentro. Si el cliente y el mesero agregan a la vez, una ronda desaparece aunque su stock ya se descontó. La caja ya usa lockSale con FOR UPDATE.  
*Arreglo:* Dentro de cada $transaction: tx.$queryRaw`SELECT id FROM "TableOrder" WHERE id=${id} FOR UPDATE`, releer con tx.tableOrder.findUnique y luego modificar items. Aplicarlo en createTableOrder, addTableOrderItem, removeTableOrderItem, updateTableOrderItemQuantity/Status, updateTableOrderItems y attachSaleToTable.

**86. [MEDIA] Modal de pedido de mesa: si la carga falla, queda un velo que no se puede cerrar**  
`frontend/src/components/vendor/TableOrderDetailModal.jsx:248` · bug  
*Por qué:* if (!order) pinta un esqueleto fijo sin cerrar, sin clic fuera y sin estado de error. Un 404 o un corte de red atrapan al usuario hasta recargar. Los botones +/- miden 24px y no tienen aria-label.  
*Arreglo:* Usar isError: 'No se pudo cargar el pedido' + Reintentar + Cerrar. Permitir cerrar al tocar fuera también mientras carga. Llevar los controles a min-h-11 min-w-11 y añadir aria-label ('Quitar una unidad de X', 'Cerrar').

**87. [MEDIA] Botones de escritura visibles para el personal de solo lectura (Pedidos, Productos, Ofertas, Reseñas, Mensajes, Productos Asignados)**  
`frontend/src/pages/vendor/VendorOrders.jsx:592` · permisos_plan  
*Por qué:* Solo VendorCustomers, VendorLoyalty, VendorTables, VendorPos y parte de VendorManualSales usan canWriteSection. VendorOrders, VendorProducts, VendorStoreOffers, VendorReviews y VendorChat no lo hacen. VendorChat dispara PATCH /me/messages/read cada 4 s y recibe 403 en bucle (vendors.routes.js:93). MySaleRow (VendorManualSales.jsx:196) muestra 'Devolver' aunque el aviso de solo lectura (l.469) promete lo contrario.  
*Arreglo:* En cada página, leer staffSectionPermissions del Outlet context y calcular canManage = canWriteSection(perms, sección). Ocultar las acciones de escritura. VendorChat: no marcar como leído ni mostrar el formulario sin escritura (o pasar /messages/read a requireVendorAccess) y añadir onError. Pasar canWrite a MySaleRow.

**88. [MEDIA] Productos Asignados: los montos salen en CUP aunque el producto sea en USD, y se suman monedas distintas**  
`frontend/src/pages/vendor/VendorManualSales.jsx:234` · bug  
*Por qué:* fmtMoney(sale.total), 'Total del lote' (l.401), el cuadre (l.489) y el total del período (l.513) se llaman sin moneda, y fmtMoney pone CUP. VendorStaffSale no guarda la moneda.  
*Arreglo:* 1) Añadir currency a VendorStaffSale (migración a mano, rellenando con product.currency). 2) En vendorStaffSales.controller, totalizar por moneda. 3) En el front, mostrar '1.200 CUP + 15 USD'. Corregir también 'registrá' por 'registra' (l.577).

**89. [MEDIA] Mesas: el límite del plan no se ve y 'Agregar mesa' no se desactiva al llegar a él**  
`frontend/src/pages/vendor/VendorTables.jsx:506` · permisos_plan  
*Por qué:* El botón siempre está activo. maxTables y allowQrTables solo aparecen en el toast de error (createTable, l.791-796). Contradice la regla 3.  
*Arreglo:* listMyTables devuelve { tables, limit: { allowed, max } }. Mostrar '3 de 5 mesas', desactivar el botón con un enlace a Suscripción al llegar al tope y distinguir 'no es restaurante' de 'tu plan no incluye mesas'.

**90. [MEDIA] Los productos fuera de cupo (overQuota) se ven como 'Disponible' en el panel y no hay botón para elegirlos**  
`frontend/src/pages/vendor/VendorProducts.jsx:69` · conexion  
*Por qué:* stockStatus no mira overQuota, y el front nunca llama a POST /products/:id/activate-quota (products.routes.js:31). El Bloque 52 pidió ese botón: el backend está hecho, falta la UI.  
*Arreglo:* Añadir la etiqueta 'Fuera de tu plan (no visible)', un grupo propio y el botón 'Hacer visible' que llama a activate-quota, mostrando el 429 del tope diario. Con eso también se corrige atLimit (ver el hallazgo bajo).

**91. [MEDIA] Crear ofertas exige la insignia VERIFIED aunque un plan de pago sin insignia tenga allowStoreOffers**  
`backend/src/controllers/storeOffers.controller.js:113` · config  
*Por qué:* El Bloque 66 lo pidió cuando Premium iba siempre con insignia. Con grantsBadge configurable y Básico o Estándar de pago (isPremiumActive, planConfig.js:154-158), /planes promete 'Ofertas de tienda' y la tienda no puede usarlas. El front también mira vendor.isVerified (VendorStoreOffers.jsx:264, 312).  
*Arreglo:* Confirmar con el dueño. Si se desliga de la insignia: cambiar la condición por isPremiumActive(vendor) + assertPlanAllows(allowStoreOffers), aquí y en updateStoreOffer, y en el front usar planFeatures. Si sigue atada a la insignia: buildPlanIncludes no lista 'Ofertas de tienda' cuando !grantsBadge.

**92. [MEDIA] Reportar una reseña la oculta al instante sin límite de reportes ni control del nivel de permiso del personal**  
`backend/src/controllers/reviews.controller.js:273` · seguridad  
*Por qué:* Ocultar al instante es intencional (Bloque 69). Pero POST /reviews/:id/report solo usa authenticate (reviews.routes.js:17): no hay límite de reportes y el personal de solo lectura también puede. Una tienda puede ocultar todas sus reseñas negativas y subir su nota (recalculateVendorRating) hasta que el admin revise. KEPT impide repetir sobre la misma reseña, nada más.  
*Arreglo:* 1) Límite de reportes por usuario y tienda (por ejemplo 5 al día), con un rateLimit como el de assistantRateLimit. 2) Si el que reporta es VENDOR_STAFF de esa tienda, exigir 'manage' en 'resenas'. 3) No recalcular el promedio hasta que el admin resuelva, o limitar a N reseñas ocultas a la vez por tienda.

**93. [MEDIA] 'Cliente verificado' aparece en todas las reseñas del panel**  
`frontend/src/pages/vendor/VendorReviews.jsx:140` · bug  
*Por qué:* La insignia se dibuja sin condición. El back guarda isVerifiedPurchase y ReviewsList.jsx sí lo usa.  
*Arreglo:* Envolver la insignia en {r.isVerifiedPurchase && (...)}.

**94. [MEDIA] La vuelta de Stripe de una renovación (?stripe=renew-success) no se reconoce**  
`frontend/src/pages/vendor/VendorVerification.jsx:50` · conexion  
*Por qué:* RETURN_MESSAGES no incluye 'renew-success', que es el successParam de createRenewalCheckoutSession (backend/src/lib/stripe.js:128). No sale ningún aviso y no se activa el sondeo.  
*Arreglo:* Añadir 'renew-success': ['Pago recibido', 'Estamos registrando tu pago. Tarda unos segundos.'] y, en el Básico de pago, refrescar la suscripción y PlanBillingBanner.

**95. [MEDIA] El plan elegido en /planes se pierde antes del pago**  
`frontend/src/pages/public/Account.jsx:970` · bug  
*Por qué:* Solo acepta STANDARD/BUSINESS (cualquier otro cae en BUSINESS). El plan vive solo en la URL (VendorVerification.jsx:81-84). El aviso de aprobación vuelve sin ?plan, y TrialOfferPopup siempre ofrece BUSINESS. En la práctica, el visitante llega al pago con el plan destacado, no con el suyo.  
*Arreglo:* 1) Migración: Vendor.requestedPlanType (PlanType?, nullable). 2) Al registrarse con ?plan válido (público, de pago, con insignia), guardarlo. 3) VendorVerification/PaymentChooser lo usan como valor por defecto, y verificationNotify.service.js lo añade al ctaHref. 4) Account.jsx valida contra usePublicPlans en vez de una lista fija.

**96. [MEDIA] La lista de planes que se pueden pagar está fija (enum) en el servidor y en el registro**  
`backend/src/controllers/verification.controller.js:43` · config  
*Por qué:* PAYABLE_PLAN = z.enum(['REGULAR','STANDARD','BUSINESS']) y los webhooks fuerzan BUSINESS para cualquier otro valor (l.1252, l.1264). updatePlanConfig permite quitarle contactOnly al Empresarial y ponerle precio (settings.controller.js:283-287). Entonces la UI lo ofrece y el servidor lo rechaza, contra la regla 3. Un plan nuevo exige migrar el enum planType.  
*Arreglo:* 1) Crear isPayablePlan(planType) en planConfig.js (existe, isPublic, !isFree, !contactOnly) y validar con z.string().refine(...) en cardCheckoutSchema, renewalMethodSchema y chooseMyPaymentMethod. 2) Webhooks: aceptar cualquier planType que exista en PlanConfig. 3) Mientras tanto, bloquear en updatePlanConfig que ENTERPRISE deje de ser contactOnly. 4) A largo plazo: migrar planType de enum a String con FK a PlanConfig.

**97. [MEDIA] Los planes ocultos se pueden pagar por la API y dejan sin pantalla a las tiendas que ya los tienen**  
`backend/src/lib/planConfig.js:87` · permisos_plan  
*Por qué:* quotePlan no mira isPublic. El front saca los planes de /settings/plans, que filtra isPublic (settings.controller.js:778): para una tienda con un plan oculto, currentPlan queda undefined, el Básico de pago muestra 'No pudimos cargar los planes' y switching cae al plan destacado.  
*Arreglo:* 1) En quotePlan (o en los endpoints de primera contratación), rechazar !isPublic salvo que sea el plan actual de la tienda. 2) En el front, tomar los datos del plan propio de /verification/me/subscription (planName, includes, precios) en vez de la lista pública.

**98. [MEDIA] Una tienda verificada que paga en CUP no tiene botón para renovar antes del vencimiento**  
`frontend/src/components/vendor/SubscriptionOverview.jsx:212` · conexion  
*Por qué:* Para !isCard && VERIFIED solo aparece 'Pasar a cobro automático con tarjeta', y PaymentChooser con switching oculta CUP. La cabecera (l.13) promete 'En CUP: renovar con transferencia'. Según git -S, el botón se perdió en e4b5653 (v26.0.81). El endpoint existe y renewalPlanFor lo permite.  
*Arreglo:* Para method CUP_TRANSFER/MANUAL, añadir 'Renovar con transferencia', que abre <PaymentChooser renewal onlyPlanType={vendor.planType} />, como VendorVerification.jsx:224 hace con el Básico de pago.

**99. [MEDIA] En /planes, 'Elegir X' lleva a una tienda verificada a una pantalla sin acción**  
`frontend/src/pages/public/Plans.jsx:28` · conexion  
*Por qué:* Para VERIFIED, VendorVerification solo muestra SubscriptionOverview (l.239) e ignora ?plan, aunque renewalPlanFor admite subir o bajar entre planes con insignia.  
*Arreglo:* Añadir 'Cambiar de plan' en SubscriptionOverview, que lea ?plan y abra PaymentChooser renewal con ese planType (el cambio se aplica al vencer, o con prorrateo). Mientras no exista, en Plans.jsx mostrar a los verificados 'Escríbenos para cambiar de plan'.

**100. [MEDIA] TrialOfferPopup dice 'el día 31' aunque la prueba se configura en días**  
`frontend/src/components/vendor/TrialOfferPopup.jsx:130` · texto  
*Por qué:* trialDays es configurable (l.38), pero el texto de cobro está fijo y engaña sobre la fecha del primer cobro.  
*Arreglo:* 'Hoy no se cobra nada; al terminar los ${trialDays} días se cobra el primer mes.' Y sustituir 'volver al Básico' por el displayName del plan REGULAR.

**101. [MEDIA] TrialOfferPopup no se puede desplazar en pantallas bajas y su X mide 32px**  
`frontend/src/components/vendor/TrialOfferPopup.jsx:64` · desborde_ui  
*Por qué:* La tarjeta no tiene max-h ni overflow, y lista todas las líneas de includes. A 390x667 los botones quedan fuera de la pantalla. La X es h-8 w-8, accept no tiene onError y falta role=dialog.  
*Arreglo:* Tarjeta con max-h-[90dvh] overflow-y-auto, includes limitado a 6 más un enlace a /planes, X con min-h-11 min-w-11 y aria-label, role='dialog' aria-modal, onError con toast.

**102. [MEDIA] PagoManual: el nombre del archivo adjunto desborda a lo ancho en el celular**  
`frontend/src/pages/vendor/PagoManual.jsx:340` · desborde_ui  
*Por qué:* La etiqueta w-fit muestra proofFile.name sin cortar. Los nombres de captura de Android no tienen espacios y generan scroll horizontal a 390px.  
*Arreglo:* Label con max-w-full min-w-0 min-h-11 y el nombre en <span className='truncate'>.

**103. [MEDIA] Nombres de plan escritos a mano en textos del panel y en errores del servidor**  
`frontend/src/pages/vendor/VendorLayout.jsx:565` · texto  
*Por qué:* 'Mejora tu plan… lo que Business tiene' (VendorLayout.jsx:565) se muestra a cualquier !isVerified, incluidas las tiendas que ya pagan un plan sin insignia; el comentario de l.459 todavía dice 'Solo dos planes'. Hay más casos: VendorPos.jsx:879 'La caja es del Plan Premium'; pos.controller.js:551; orders.controller.js:963 y 969 ('Verificate', voseo); products.controller.js:779; SubscriptionOverview.jsx:119 y 249 ('plan gratis'); PagoManual.jsx:197; VendorSetupGuide.jsx:291; verificationMeta.js:43; Plans.jsx:47; PlanComparisonModal.jsx:28 (insignia fija). Rompe la regla 3 cuando el admin cambia nombres o interruptores.  
*Arreglo:* 1) Back: crear cheapestPlanWith(flag) en planConfig.js y armar los mensajes con su displayName ('Disponible desde el plan X. Cambia de plan en Suscripción.'); quitar 'Verificate'. 2) Front: usar planNames de usePlatformSettings y data.paymentPlanName. La tarjeta 'Mejora tu plan' se muestra solo si !vendorPlanStatus(vendor, planNames).premium y nombra planNames.BUSINESS. 3) PlanComparisonModal usa grantsBadge e includes de buildPlanIncludes.

**104. [MEDIA] Pedidos solo trae los últimos 50, y la búsqueda y los enlaces ?ver= / ?buscar= son locales**  
`backend/src/controllers/orders.controller.js:472` · bug  
*Por qué:* take:50 sin paginar, para pedidos y para tableOrders. Un enlace de aviso a un pedido más viejo termina en 'No hay pedidos que coincidan'. El límite tiene sentido para el sondeo cada 8 s, pero la búsqueda quedó sin servidor.  
*Arreglo:* /orders/me con ?q, ?status y paginación por cursor; el popup usa un endpoint liviano propio. Con ?ver=id, pedir GET /orders/me/:id si el pedido no está en la lista.

**105. [BAJA] Faltan estados de error: StaffProfile se rompe y otras pantallas muestran un 'vacío' engañoso**  
`frontend/src/pages/vendor/StaffProfile.jsx:50` · bug  
*Por qué:* StaffProfile solo mira isLoading, y profile.photoUrl lanza TypeError al fallar la carga. VendorUsers (l.1470), VendorOrders (l.373 y 499), VendorReviews (l.71) y VendorProducts muestran el estado vacío cuando la consulta falla.  
*Arreglo:* En cada página: if (isError) mostrar un mensaje con Reintentar (refetch), separado del estado vacío.

**106. [BAJA] Botones y controles por debajo de 44px en todo el panel**  
`frontend/src/components/vendor/SectionAccessPicker.jsx:36` · desborde_ui  
*Por qué:* SectionAccessPicker (unos 24px, con ☑/☐ como texto), VendorUsers.jsx:763-781, VendorLayout.jsx:592 y 618 (36px), VendorProfile.jsx:638, VendorOrders/VendorTables/VendorManualSales (py-1.5), VendorReviews (h-10), VendorStoreOffers, PagoManual CopyRow (l.36) y SubscriptionOverview (min-h-10).  
*Arreglo:* min-h-11 (y min-w-11 en los botones de icono) en todos. En SectionAccessPicker, un checkbox real con label y texto de 12px o más.

**107. [BAJA] Raya larga (—) y voseo en textos visibles**  
`frontend/src/pages/vendor/VendorUsers.jsx:122` · texto  
*Por qué:* Aparecen en VendorUsers, StaffProfile, VendorLayout:152, VendorDashboard, VendorOrders, VendorTables, VendorManualSales, TableOrderDetailModal, VendorStoreOffers, VendorProducts, VendorReviews y PagoManual, en AppError del back (requireVendorAccess.js:113, tables, storeOffers, discountCodes, reviews, verification:213, stripe.js:52) y en fmtDate ('—'). Voseo: 'usá' (tables.controller.js:731), 'reasignale', 'Avisale', 'registrá', 'Verificate'. Va contra la regla 4.  
*Arreglo:* Repasar con grep '—' en frontend/src y backend/src/controllers|middleware|lib en los strings visibles; cambiar la raya por punto, coma o dos puntos, poner 'Sin dato' en fechas vacías y corregir el voseo.

**108. [BAJA] Mensajes: los textos largos desbordan a 390px y la altura usa 100vh**  
`frontend/src/pages/vendor/VendorChat.jsx:109` · desborde_ui  
*Por qué:* La burbuja no tiene break-words, el contenedor usa h-[calc(100vh-60px)], falta aria-label en Enviar y el input no tiene maxLength.  
*Arreglo:* Añadir break-words [overflow-wrap:anywhere] whitespace-pre-wrap, 100dvh, aria-label='Enviar mensaje' y maxLength={2000}; el CTA dice 'Verificar mi tienda'.

**109. [BAJA] canReactivate mezcla && y || sin paréntesis**  
`backend/src/controllers/verification.controller.js:720` · bug  
*Por qué:* planDowngradeAt solo bloquea el primer caso. Se muestra 'Reactivar' y luego reactivateMySubscription responde 409.  
*Arreglo:* canReactivate: !vendor.planDowngradeAt && ((VERIFIED && cancelAtPeriodEnd) || ([SUSPENDED, PAYMENT_FAILED].includes(status) && !!stripeCustomerId)).

**110. [BAJA] El panel de Productos calcula el límite distinto que el servidor**  
`frontend/src/pages/vendor/VendorProducts.jsx:1041` · bug  
*Por qué:* Cuenta todos los productos (también los pausados), y data?.limit && falla con 0 ('sin límite'). La l.1029 usa != null. El encabezado cuenta los pausados como 'publicados'.  
*Arreglo:* /products/me/list devuelve activeCount (activos sin overQuota). Usarlo en atLimit, el encabezado y el pie, siempre con limit != null.

**111. [BAJA] Editar un código permite porcentajes mayores que 100 y fechas invertidas**  
`backend/src/controllers/discountCodes.controller.js:153` · bug  
*Por qué:* El refine solo valida si type viene en el body, y la fecha de fin no se compara con la de inicio en update (l.185-188).  
*Arreglo:* Después de armar el patch, validar con los valores finales (type ?? existing.type, value ?? existing.value, startsAt y expiresAt finales).

**112. [BAJA] GET /settings (público) devuelve la configuración interna de todos los planes, también los ocultos**  
`backend/src/controllers/settings.controller.js:86` · config  
*Por qué:* Lo reportaron dos subagentes. El comentario lo justifica como fuente única, pero el endpoint no tiene autenticación, y VendorStoreOffers y PlanComparisonModal dependen de él.  
*Arreglo:* En GET /settings, devolver plans.filter(isPublic).map(publicPlan). El panel lee su plan de planFeatures (/vendors/me) y el admin usa listPlanConfigs (l.273).

**113. [BAJA] Caja: mutaciones sin onError y setFulfillment permite volver atrás**  
`frontend/src/pages/vendor/VendorPos.jsx:144` · bug  
*Por qué:* cancel, saveName, newSale, regen y remove fallan sin aviso. pos.controller.js:367 acepta cualquier transición, incluso de DELIVERED a PREPARING.  
*Arreglo:* Añadir onError con toast. En setFulfillment, aceptar solo transiciones hacia adelante (PREPARING→READY→PICKED_UP). Ocultar las Tabs si planLocked.

**114. [BAJA] Los períodos de ventas manuales usan la hora del servidor**  
`backend/src/controllers/vendorStaffSales.controller.js:36` · config  
*Por qué:* periodSince usa la zona del proceso; la caja usa startOfToday(vendor.timezone). En un VPS en UTC, 'hoy' en Cuba arranca a las 19:00 o 20:00 del día anterior.  
*Arreglo:* Reutilizar startOfToday(vendor.timezone) desde un helper común para hoy, semana y mes.

**115. [BAJA] Detalles de texto y estilo del flujo de pago**  
`frontend/src/components/vendor/SubscriptionOverview.jsx:219` · texto  
*Por qué:* 'Renovación en CUP en curso' sale también con pagos con tarjeta; PagoManual.jsx:358 usa rounded-full en un bloque de formulario (desde 333b802); PlanComparisonModal no tiene role=dialog ni Escape.  
*Arreglo:* Elegir el texto según pendingRenewal.paymentMethod, cambiar a rounded-xl y añadir role='dialog' aria-modal y cierre con Escape.

**116. [BAJA] El cambio de contraseña del dueño no comprueba que la confirmación coincida**  
`frontend/src/pages/vendor/VendorProfile.jsx:55` · mejora  
*Por qué:* StaffProfile.jsx:109 sí lo comprueba; aquí falta.  
*Arreglo:* Añadir newPassword !== confirmPassword a disabled, con un mensaje en línea.

**117. [BAJA] El menú lateral en móvil recibe foco con el teclado aunque esté cerrado**  
`frontend/src/pages/vendor/VendorLayout.jsx:422` · mejora  
*Por qué:* Cerrado, solo se aplica -translate-x-full, sin inert, sin botón de cerrar y sin Escape.  
*Arreglo:* Poner inert al aside cerrado por debajo de lg, añadir un botón 'Cerrar menú' de 44px y cerrar con Escape.

### Está así a propósito (no se toca)

- **Desactivar al personal en lugar de borrarlo**: Es para conservar el historial de actividad y de ventas (comentario en StaffDetailModal). El error real es que el tope cuente a los inactivos; quedó como hallazgo propio.
- **Reportar una reseña la oculta al instante**: Lo pidió el dueño en el Bloque 69 (comentarios en reviews.routes.js:13-16 y en el controlador). Solo se reporta la falta de límite de reportes y de control del nivel de permiso.
- **Una tienda suspendida por impago sigue entrando a su panel**: Es intencional (requireVendorAccess.js:22 y VendorLayout.jsx:334): el dueño tiene que poder pagar, y assertVendorAcceptsOrders ya corta los pedidos nuevos. Queda para decidir con el dueño si el personal y la escritura de catálogo deben cerrarse en ese estado.
- **Los códigos de descuento se conservan tras bajar de plan, pero no se aplican**: Es una decisión explícita (discountCodes.controller.js:18-19 y resolveDiscountForOrder, l.235). Las ofertas de tienda no tienen el mismo trato, y eso quedó como hallazgo alto.
- **El programa de fidelidad se puede dejar configurado sin plan**: VendorLoyalty lo explica a propósito ('puedes dejarlo configurado y encenderlo cuando cambies de plan') y saveMyProgram impide encenderlo. Solo se reporta el ajuste de puntos sin plan.
- **Caja muestra PlanUpsell en lugar de ocultarse**: La página está diseñada para vender la mejora (VendorPos.jsx:862-879, con planRequired en requirePosPlan). Choca con la letra de la regla 2, así que el dueño debe elegir entre ocultar o mostrar un aviso. Queda incluido en el plan de arreglo del NAV.
- **Total de clientes sumado por ítem**: Se suma por ítem a propósito, para separar las monedas. No descontar los códigos y los puntos sí parece un descuido; va como mejora.
- **take:50 en /orders/me**: Mantiene liviano el sondeo cada 8 s de NewRegularOrderPopup. Lo que falla es la búsqueda y los enlaces sin servidor; eso quedó como hallazgo.
- **Gestión de personal y suscripción solo para el dueño**: Está bien hecho: vendorStaff.routes.js y verification.routes.js usan requireRole('VENDOR'), stripOwnerPrivateFields quita al personal los datos privados del dueño, assertOwnerOrAdmin protege la supervisión de ventas manuales y PlanBillingBanner se oculta al personal.

### Mejoras propuestas

- Exponer planFeatures (flags y límites efectivos) en GET /vendors/me y usarlo como única fuente del panel: NAV, botones, contadores 'X de Y' (productos, mesas, usuarios, códigos, ofertas) y PlanUpsell.
- Que assertPlanAllows adjunte siempre { planRequired: flag } y que todas las páginas usen isPlanError/PlanUpsell con el nombre del plan más barato que incluya esa función.
- Planes dinámicos: validar los planes pagables contra PlanConfig en vez del enum fijo, guardar Vendor.requestedPlanType desde /planes y, a largo plazo, migrar planType de enum a String con FK a PlanConfig para poder crear planes desde el admin.
- Botón 'Cambiar de plan' en Suscripción (subir o bajar entre planes con insignia) con prorrateo de Stripe, o aplicando el cambio al vencer, en lugar de usar trial_end.
- Lista de secciones del personal servida por el backend (key y label), sin copias en el front.
- Al bajar de plan o al editar PlanConfig, reaplicar todos los topes (productos, ofertas activas, códigos, personal, mesas) con un servicio único, como recalcVendorProductQuota.
- Búsqueda y paginación en el servidor para Pedidos, y GET por id para los enlaces de avisos.
- Lista de clientes con groupBy en SQL y totales netos de descuentos y puntos, o aclarar 'en productos, antes de descuentos'.
- targetedOffers 'business_vendors' (l.448) debería usar isPremiumActive y no 'cualquier plan distinto de REGULAR'.
- Guardián de rutas declarativo en App.jsx (section/ownerOnly/planFlag por ruta) en lugar de la comparación en VendorLayout.
- Repasar estados vacío, cargando y error en todas las páginas del panel con un componente común (ErrorState con Reintentar).
- Al confirmar un pago con Stripe del Básico de pago, extender nextPaymentDueDate y levantar la suspensión por impago automáticamente, sin esperar al admin.

<details><summary>Notas del subagente: Panel base, ajustes y personal</summary>

Revisión solo de lectura. Lo principal: (1) el frontend todavía ofrece la sección \"ofertas\", que el servidor quitó en el Bloque 297, así que crear o editar personal con esa casilla falla con un 400; (2) el menú del vendedor no tiene ningún filtro por plan, el bloqueo lo hace solo el servidor y en la mayoría de pantallas el usuario ve un 403 sin explicación; (3) el tope maxStaffUsers cuenta a los usuarios inactivos, no se puede borrar personal y bajar el tope no corta a los que ya existen. Lo que está bien: la gestión de usuarios (vendorStaff.routes) es solo del dueño con requireRole(\"VENDOR\"); la supervisión de ventas manuales tiene assertOwnerOrAdmin en el controlador; /vendors/me quita al personal los datos privados del dueño (stripOwnerPrivateFields); las rutas de lectura y escritura por sección usan requireVendorAccess y requireVendorWrite de forma coherente. No revisé en detalle las páginas de cada sección (Caja, Mesas, Puntos y demás); otros subagentes cubren si cada una bloquea por plan en el servidor. Solo comprobé que existen assertPlanAllows/planAllows en pos, tables, discountCodes, storeOffers y loyalty.

</details>

<details><summary>Notas del subagente: Pedidos, caja y mesas</summary>

Revisión hecha en modo solo lectura: no se ejecutó nada. Lo más grave es el doble descuento de stock en las mesas (alta). Se reproduce con el panel actual, sin llamar a la API a mano: en una cuenta en Recibido, \"Agregar consumo\" y luego \"Verificar y aceptar\". La mayoría de los permisos en el servidor están bien. Pos, tables, orders y vendorStaffSales usan requireVendorAccess/Write por sección; vendorStaffSales separa al personal del dueño con requireStaffActor y assertOwnerOrAdmin en todos los handlers; requireVendorAccess bloquea al personal si el plan ya no incluye usuarios del equipo. La caja exige allowPos en el panel y en las pantallas públicas. El límite de mesas por plan se aplica al crear una mesa, pero no al operar con mesas ya creadas después de bajar de plan. El NAV muestra \"Caja\" y \"Mesas\" sin mirar el plan: en Caja parece intencional, porque la página muestra un aviso para cambiar de plan. Tablas y modales están bien hechos para 390px (grid de 1 columna, truncate, min-w-0), salvo el chat y los botones pequeños. No se revisaron a fondo OrderDetailModal, NewRegularOrderPopup ni las pantallas públicas /caja/pantalla y /caja/tablero.

</details>

<details><summary>Notas del subagente: Catálogo, ofertas, fidelidad y clientes</summary>

targetedOffers: la audiencia 'business_vendors' toma cualquier plan distinto de REGULAR (l.448), aunque el plan pagado esté vencido y sin insignia. Es un detalle menor que no reporté como hallazgo. VendorFraudReports.jsx solo envuelve ReportsCenter, así que no lo revisé en profundidad. Sobre la pregunta central: el límite de productos se cumple al crear, pero no al activar ni al editar (hallazgo alto). El tope de ofertas activas se cumple al crear y al reactivar, pero la reactivación no vuelve a revisar el plan ni la verificación, y la página pública no filtra por plan. El tope de códigos se cumple solo al crear, contando el total histórico, y no se revisa al reactivar.

</details>

<details><summary>Notas del subagente: Suscripción, verificación y pago</summary>

Flujo /planes → registro → pago: Plans.jsx manda a /vendedor/ingresar?tab=registro&plan=X. Account.jsx muestra la comparación solo para STANDARD/BUSINESS (cualquier otro plan cae en Premium) y luego lleva a /vendedor/verificacion?plan=X o a /vendedor sin el plan. El plan solo vive en la URL. Antes de pagar hay que completar la tienda, enviar documentos y esperar la aprobación del admin, y el aviso de aprobación vuelve sin ?plan. Por eso, en la práctica, el visitante NO llega al pago con su plan preseleccionado. El Empresarial va por WhatsApp (EnterpriseCta) y nunca entra al pago. Si el admin lo vuelve pagable, la UI lo ofrece pero el servidor lo rechaza (enum fijo). Un plan totalmente nuevo no se puede crear sin migrar el enum planType. Lo más grave: (1) la subida de plan gratis al pasar a tarjeta (switching + trial_end) y (2) el webhook que descarta los cobros con tarjeta del Básico de pago. PlanBillingBanner está correcto: oculto para el personal, enlace a Suscripción y se oculta en las propias pantallas de pago. Las rutas /verification/me/* exigen el rol VENDOR, así que el personal (VENDOR_STAFF) no puede pagar ni ver la suscripción. Es coherente con ocultarlo en el panel. No revisé KycSubmitForm.jsx ni PlansCatalog.jsx a fondo (fuera del alcance indicado), ni el job verificationPayment.job.js.

</details>


## Clientes y socios

Revisé contra el código todos los hallazgos de severidad alta y media de los dos subagentes, y los confirmé, salvo el cobro del precio final del socio, que es una decisión de negocio pendiente y lo moví a intencionales. Lo más grave es placeOrder (orders.controller.js:234-237): no deduplica productIds, así que un carrito con dos tallas del mismo producto nunca se puede comprar. Además, la API de socios rechaza a propósito los productos repetidos (partnerOrders.controller.js:199-200), de modo que por ahí tampoco se pueden pedir dos tallas. Siguen en prioridad el carrito compartido (no respeta unlimitedStock, no filtra por tienda, hiddenFromStore, overQuota ni suspendedAt, y suma de nuevo las cantidades al recargar), el carrito que sobrevive al cierre de sesión y se escribe en la cuenta siguiente, el descuento que queda desactualizado en el ticket y el WhatsApp, y la fidelización ajustable sin permiso del plan. En socios: el CORS no permite Idempotency-Key, así que crear pedidos desde el navegador o la consola de /api-socios es imposible. acceptsOrders está fijo en true aunque el cobro esté atrasado, los planes del socio no siguen la forma de publicPlan (Básico 'Gratis' fijo, features crudos, límites sin interruptores) y las solicitudes de socio no pasan por la lista negra ni por la regla de teléfono único. Diseño propuesto para los planes del socio: armar cada plan desde publicPlan(c), que ya trae includes, limits con interruptores, flags, monthDiscounts, isFree y contactOnly, y sumarle baseMonthly/extraMonthly/finalMonthly. Así /planes, la Suscripción del vendedor, GET /plans y PartnerPlans salen de una sola fuente, como pide la regla 3. Quedó bien resuelto: el aislamiento de "mis pedidos" (loadOwnOrder con el mismo 404), el rastreo público, los topes de venta rápida en el servidor, activeProgramFor con allowLoyalty al canjear, las rutas /partner-portal con requireRole('PARTNER') y la visibilidad de la API pública (cupo, ocultos y tiendas privadas).

### Errores confirmados (32)

**118. [ALTA] Un pedido con el mismo producto en dos tallas siempre falla (web y API de socios)**  
`backend/src/controllers/orders.controller.js:234` · bug  
*Por qué:* `const productIds = data.items.map((i) => i.productId)` repite el id una vez por línea, y findMany devuelve una fila por producto. Por eso `products.length !== productIds.length` (línea 237) lanza 'Uno o más productos ya no están disponibles.' en cuanto el carrito (CartContext, Bloque 52: una línea por producto+talla) trae dos tallas. updateOrderItems (890) y editOrderItemsForCustomer (1078) ya usan `[...new Set(...)]`: aquí se olvidó. La API de socios tampoco permite pedir dos tallas, porque partnerOrders.controller.js:199-200 rechaza los productos repetidos ('Junta las cantidades en una sola línea') y una sola línea no puede llevar dos tallas.  
*Arreglo:* 1) En orders.controller.js:234 usar `const productIds = [...new Set(data.items.map((i) => i.productId))]`; la comparación de la 237 y productById siguen valiendo. 2) Revisar el quickCheck de stock (272-281): con dos líneas del mismo producto SIN talla, cada una se compara contra el stock total. Agrupar las cantidades por productId+size antes de comparar. 3) En partnerOrders.controller.js:199-200, rechazar solo las líneas repetidas por productId+size (clave `${productId}|${size ?? ''}`) y ajustar el mensaje; también la comparación sameItems de la línea 185 para que tenga en cuenta la talla. 4) Prueba: carrito con talla S y M del mismo producto, el pedido se crea con 2 líneas, por la web y por POST /orders de socios.

**119. [MEDIA] El carrito compartido descarta o limita los productos 'disponible siempre'**  
`backend/src/controllers/sharedCart.controller.js:71` · bug  
*Por qué:* `availableStock = i.size ? sizeStock : product.stock; if (availableStock <= 0) return null;` no mira product.unlimitedStock. Un producto ilimitado con stock 0 aparece como 'ya no está disponible' (droppedCount), y uno con stock bajo queda limitado a ese número. En cambio, placeOrder (línea 277) y CartContext (resolveStockCap con stock null) tratan unlimitedStock como sin techo.  
*Arreglo:* En getSharedCart, si product.unlimitedStock: no descartar, devolver `quantity: i.quantity` y `stock: null` (el centinela que entiende CartContext.resolveStockCap). Agregar unlimitedStock al cálculo antes de la línea 71. Prueba: compartir un carrito con un producto ilimitado y stock 0, abrir el enlace y ver que se importa con la cantidad original.

**120. [MEDIA] El carrito compartido no comprueba la tienda ni la visibilidad y muestra productos ocultos o fuera del cupo**  
`backend/src/controllers/sharedCart.controller.js:57` · permisos_plan  
*Por qué:* createSharedCart guarda cualquier productId (sin comprobar que sea de vendorId, sin .max en items, sin rate limit), y getSharedCart solo filtra `isActive: true`. Así sale en público el nombre, el precio, la foto y el stock de productos de otras tiendas, 'solo de mesa' (hiddenFromStore), fuera del cupo del plan (overQuota) o suspendidos por reporte (suspendedAt), justo lo que publicVisibility.js marca como ocultos. placeOrder sí los bloquea al pedir (línea 240), así que el problema es que quedan a la vista y se rompe la regla 2.  
*Arreglo:* 1) En getSharedCart, filtrar `{ id: { in: productIds }, vendorId: shared.vendorId, isActive: true, hiddenFromStore: false, overQuota: false, suspendedAt: null }`, y si vendor.menuPublic === false excluir availableForTableMenu, con el mismo criterio que productVisibility. 2) En createSharedCartSchema: items .max(100), quantity .max(99999), size .max(20). Comprobar con un count que todos los productos sean de data.vendorId y estén visibles; si no, 400. 3) En routes/sharedCarts.routes.js, aplicar a POST un rate limit como ordersRateLimit (middleware/rateLimit.js).

**121. [MEDIA] Recargar /carrito-compartido/:id vuelve a sumar las cantidades**  
`frontend/src/pages/public/SharedCart.jsx:62` · bug  
*Por qué:* El efecto llama commit() cada vez que llega `data` y `committed` es estado local, que vuelve a false al recargar. Cuando el carrito ya es de esa tienda, commit usa mergeItems en modo 'sum' (CartContext.jsx:127-140), así que cada recarga o cada vez que se vuelve a abrir el enlace duplica las cantidades (solo las limita el stock). El modo 'sum' es intencional para sumar el carrito de otra persona, pero no se pensó en reabrir el mismo enlace. CartContext ya corrigió el mismo síntoma (1, 2, 4, 8) al restaurar el carrito de la cuenta.  
*Arreglo:* En SharedCart.jsx, guardar en localStorage (envuelto en try/catch) una lista corta `zeudin_imported_shared_carts` con los ids ya importados (por ejemplo, los últimos 20). Si el id ya está, llamar a mergeItems(data.items, 'max') o no fusionar y solo mostrar la pantalla de 'ya está en tu carrito'. Registrar el id dentro de commit(). Prueba: abrir el enlace, recargar 3 veces y ver que la cantidad no cambia.

**122. [MEDIA] La dirección de cada pedido nuevo se guarda con raya larga (web y API de socios)**  
`frontend/src/pages/public/Checkout.jsx:311` · texto  
*Por qué:* Checkout une municipio y dirección con `.join(" — ")`, y partnerOrders.controller.js:232 hace `${place} — ${body.shippingAddress}`. El comentario de orderTracking.controller.js:105 dice que 'los pedidos de antes' usaban raya y que los nuevos van con coma, pero no es así: solo el rastreo la reemplaza. El panel del vendedor, los correos, el chat y el mensaje de WhatsApp (orderDto, partnerOrders 144) la muestran tal cual, y eso rompe la regla 4.  
*Arreglo:* 1) Checkout.jsx:311: `.join(", ")`. 2) partnerOrders.controller.js:232: `${place}, ${body.shippingAddress}`. 3) Opcional: en placeOrder, normalizar `data.shippingAddress = data.shippingAddress?.replace(/\s+—\s+/g, ', ')` antes de guardar, para cubrir cualquier otro cliente de la API. 4) Si se quiere limpiar el histórico, que el panel del vendedor y los correos usen el mismo replace que orderTracking, o hacer una migración de datos aparte, con autorización.

**123. [MEDIA] El ticket de confirmación y el WhatsApp usan un descuento desactualizado si cambian las cantidades**  
`frontend/src/pages/public/Checkout.jsx:323` · bug  
*Por qué:* `orderTotals = loyalty.used ? { order.total } : productTotals`, y productTotals (línea 290-291) resta `discount.amount`, que se guarda una sola vez al aplicar el código (Cart.jsx:53 / Checkout.jsx:234). updateQuantity y removeItem en CartContext.jsx (319-371) no recalculan ni quitan el descuento (solo lo borran si el carrito queda vacío). Con un código porcentual y la cantidad cambiada después, el servidor guarda bien el total (resolveDiscountForOrder, línea 331), pero el cliente ve otro total en el ticket y la tienda recibe otro por WhatsApp.  
*Arreglo:* 1) En onSuccess de Checkout.jsx, armar orderTotals siempre desde la respuesta: order.total (que ya trae el descuento de código y de puntos) por moneda, y order.discountAmount para la línea de descuento de confirmedInfo y del texto de WhatsApp (línea 67). Si el pedido mezcla monedas, usar los ítems del pedido devuelto (order.items con su price) en lugar de los del carrito. 2) En CartContext, cuando cambien items y haya discount, volver a llamar a POST /discount-codes/validate (con debounce) o borrar el descuento con un aviso 'Vuelve a aplicar tu código'. 3) Prueba: aplicar un código del 10 %, subir la cantidad, confirmar y comparar el total del ticket con el del panel del vendedor.

**124. [MEDIA] Al cerrar sesión el carrito queda en el navegador y pasa a la cuenta siguiente**  
`frontend/src/context/CartContext.jsx:185` · seguridad  
*Por qué:* clearLocalSession (AuthContext.jsx:83-106) borra tokens y la caché de React Query (Bloque 136), pero no 'zeudin_cart' ni el estado del CartProvider. Cuando entra otra cuenta, el efecto de sincronización (158-180) da prioridad al carrito local, y el efecto de guardado (185-196) hace PUT /cart/me con los productos y el código de descuento de quien salió, escribiéndolos en la cuenta nueva. Que el carrito de un invitado pase a la cuenta al iniciar sesión es intencional; que el carrito de una cuenta sobreviva al logout no lo es.  
*Arreglo:* 1) En AuthContext.clearLocalSession: `try { localStorage.removeItem('zeudin_cart') } catch {}` y emitir un evento (por ejemplo window.dispatchEvent(new Event('zeudin:logout'))). 2) En CartProvider, escuchar ese evento (o reaccionar a user que pasa de objeto a null) y llamar a clearCart() sin toast, cancelando antes saveTimerRef para que no se dispare un PUT/DELETE con la sesión ya cerrada. 3) Sacar la clave a una constante compartida para no duplicar el texto. 4) Prueba: entrar con A, agregar productos, salir, entrar con B y ver que el carrito de B está vacío o es el suyo.

**125. [MEDIA] Una tienda sin fidelización en su plan puede regalar o quitar puntos por API**  
`backend/src/controllers/loyalty.controller.js:205` · permisos_plan  
*Por qué:* saveMyProgram (151) comprueba plan.allowLoyalty, pero adjustMemberPoints solo pasa por requireVendorWrite('puntos') (loyalty.routes.js:24) y no mira el plan. Además, notifyPointsAdjusted manda un aviso al cliente. Que la página siga visible después de bajar de plan es a propósito (VendorLoyalty.jsx:447: 'Puedes dejarlo configurado'), pero ajustar puntos es justo la función de pago, y eso rompe la regla 2.  
*Arreglo:* 1) En adjustMemberPoints, después de resolveMyVendor: `const plan = await getPlanConfig(vendor.planType); if (plan?.allowLoyalty === false) throw new AppError('Tu plan actual no incluye el programa de fidelidad.', 403);`. 2) Dejar en solo lectura listMyMembers, getMemberHistory y listEligibleCustomers, o bloquear también listEligibleCustomers, porque solo sirve para regalar puntos. 3) En VendorLoyalty.jsx, ocultar o desactivar el botón de ajustar puntos cuando !data.planAllows. 4) Prueba: tienda en Básico sin fidelidad, POST /loyalty/store/adjust responde 403.

**126. [MEDIA] Editar un pedido solo ofrece 60 productos que rotan, con tope y precio que no son reales**  
`frontend/src/components/customer/CustomerOrderActions.jsx:133` · conexion  
*Por qué:* EditOrderModal usa GET /vendors/:slug, y getVendorBySlug (vendors.controller.js:379-380) recorta a ranked.slice(0, 60) con rotación por visita (rotationSeed). En tiendas con más de 60 productos falta lo que el cliente quiere agregar. Si un producto del pedido no viene, maxFor() devuelve 999 y unitFor() usa el precio guardado. Además, `currency = lines[0]?.currency` suma monedas distintas en un solo total. El servidor vuelve a validar al guardar, así que es un problema de experiencia y de datos mostrados, no de integridad.  
*Arreglo:* 1) Backend: nuevo GET /customers/me/orders/:id/editable-products en customers.controller.js. Usa loadOwnOrder, comprueba CUSTOMER_CAN_EDIT y devuelve todos los productos vendibles de order.vendorId (isActive, !hiddenFromStore, !overQuota, suspendedAt null, stock>0 o unlimitedStock) con price, currency, priceTiers, sizes, sizeStock, stock y unlimitedStock, sin rotación. 2) Agregar la ruta en customers.routes.js. 3) En EditOrderModal, cambiar la consulta a ese endpoint (queryKey propia, sin chocar con ['vendor', slug]). 4) Mostrar el total con itemsTotalsByCurrency(lines, unitFor) y combineTotalsLabel. 5) Para un producto del pedido que ya no está, maxFor = cantidad actual (no 999).

**127. [MEDIA] Guardar la pestaña Direcciones borra el municipio y el estado aunque no cambie la provincia**  
`backend/src/controllers/customers.controller.js:86` · bug  
*Por qué:* La rama `else if (basic.provinceId)` pone municipalityId, municipalityOther y stateOther en null siempre, y CustomerPanel.jsx:410 manda { provinceId, address } en cada guardado. El comentario ('el municipio anterior ya no vale') solo tiene sentido si cambia la provincia. Quien corrige solo la calle pierde el municipio, el perfil puede quedar incompleto (profileLocationMissing) y las ventas rápidas toman esa ubicación.  
*Arreglo:* 1) En updateMe, leer el provinceId actual del usuario y entrar en la rama de limpieza solo si `basic.provinceId !== current.provinceId`. 2) En la UI, mejor quitar el Select de provincia de la pestaña Direcciones (CustomerPanel.jsx:985), que lista provincias de todos los países sin agrupar, y dejar solo la dirección, o reutilizar LocationPicker como en Perfil (1064-1074). 3) Prueba: perfil con municipio, cambiar solo la calle en Direcciones y ver que el municipio sigue igual.

**128. [MEDIA] Botones de menos de 44px y botones de solo ícono sin aria-label en el panel del cliente y el carrito**  
`frontend/src/pages/customer/CustomerPanel.jsx:711` · desborde_ui  
*Por qué:* Tarjeta de venta rápida: Editar, Vendido y Eliminar con h-8 (711, 719, 726). Quitar foto con p-0.5 y sin aria-label (845). Cerrar en 933 con h-8 w-8. En Cart.jsx, el paso a paso h-9 w-8 (194, 198, 212), la papelera y el '-' solo con title, y Quitar código con p-1 (240). Checkout.jsx:844 igual. El resto del panel ya usa min-h-11 (regla R-03), así que son restos.  
*Arreglo:* 1) CustomerPanel.jsx 711/719/726: h-11 (y w-11 en los cuadrados). 845: zona táctil de 44px con el círculo visible dentro (patrón del corazón de favoritos, 963) más aria-label='Quitar foto'. 933: h-11 w-11. 655: min-h-11. 2) Cart.jsx 194/198/212: h-11 w-11 y aria-label en la papelera ('Eliminar {nombre} del carrito') y en el '-' ('Restar una unidad de {nombre}'). 240: h-11 w-11 con aria-label='Quitar código'. 3) Checkout.jsx:844 igual. 4) Comprobar a 390px que la fila del paso a paso no desborde (puede hacer falta pasar el precio a una segunda línea).

**129. [MEDIA] El CORS de la API de socios no permite Idempotency-Key: crear pedidos desde el navegador falla en el preflight**  
`backend/src/middleware/partnerAuth.js:38` · conexion  
*Por qué:* Allow-Headers es 'Authorization, X-Api-Key, Content-Type', pero POST /orders exige Idempotency-Key (partnerOrders.controller.js:173-176). Cualquier fetch del navegador con esa cabecera hace preflight, y el navegador lo bloquea. La cabecera se agregó con los pedidos y no se sumó a la lista.  
*Arreglo:* 1) partnerAuth.js:38: 'Authorization, X-Api-Key, Content-Type, Idempotency-Key'. 2) Probar en local un POST /orders desde un origen autorizado (la consola de /api-socios) y ver que el preflight responde 204 y el pedido se crea o devuelve el error de validación esperado.

**130. [MEDIA] La consola de /api-socios no manda Idempotency-Key: 'Crear pedido' siempre responde 400**  
`frontend/src/pages/public/ApiSocios.jsx:96` · conexion  
*Por qué:* send() arma headers solo con Authorization y Content-Type, y el recurso 'order-create' (línea 36) sale en el selector. El backend responde idempotency_key_required. La descripción del recurso ya dice que la cabecera es obligatoria; la consola no la contempla. Depende del arreglo del CORS.  
*Arreglo:* 1) Si ep.id === 'order-create', mostrar un campo 'Idempotency-Key' con un valor autogenerado (crypto.randomUUID().replace(/-/g,'')), un botón para regenerarlo y min-h-11. 2) Agregar `'Idempotency-Key': idemKey` a headers en ese caso. 3) Mostrar arriba del botón un aviso: 'Esto crea un pedido real en la tienda'. 4) Cambiar la etiqueta 'Llave de navegador' (118) por 'Tu credencial'.

**131. [MEDIA] Los planes del socio no salen de la configuración del admin (Básico 'Gratis' fijo, features crudos, límites sin interruptores) y se puede poner precio a planes gratis o 'por WhatsApp'**  
`backend/src/controllers/partnerOrders.controller.js:263` · permisos_plan  
*Por qué:* plansForPartner es anterior a publicPlan y buildPlanIncludes. Devuelve `features: c.features` (texto libre que buildPlanIncludes filtra a propósito porque puede contradecir los límites, planConfig.js:295-299), limits sin aplicar allowQrTables/allowStaffUsers/allowDiscountCodes (publicPlan los pone en 0, 117-126) y no trae isFree, contactOnly, monthDiscounts ni listPrice. PartnerPlans.jsx:43 decide `free = planType === 'REGULAR'` aunque desde v26.0.122 el Básico puede cobrarse, y muestra 'Gratis' con 'mínimo 500' al lado. Además, setPortalPlanPrice (partnerPortal.controller.js:76) deja fijar precio sobre planes isFree o contactOnly, que tienen base 0. Rompe la regla 3.  
*Arreglo:* 1) En plansForPartner: `const pub = publicPlan(c); return { ...pub, baseMonthly, extraMonthly, finalMonthly, stores, estimatedMonthlyEarnings }` (mantener `name` y `planType`, que ya vienen en publicPlan). Para no romper a los socios, documentar en ApiSocios.jsx que `features` pasa a `includes`, o dejar `features: pub.includes` durante una versión. 2) En partnerPortal.controller.js setPortalPlanPrice: cargar el config y responder 400 si isFree o contactOnly ('Este plan no tiene precio que puedas ajustar'). 3) En PartnerPlans.jsx: quitar `planType === 'REGULAR'`. Si plan.isFree: 'Gratis por ahora' y sin campos de precio. Si plan.contactOnly: 'Se contrata con el equipo' y sin campos. Si no, precio real. Listar plan.includes en lugar de features. 4) Prueba: poner precio al Básico en el admin y ver lo mismo en /planes, en la Suscripción del vendedor, en GET /plans y en PartnerPlans.

**132. [MEDIA] GET /stores/:slug/checkout responde siempre acceptsOrders: true**  
`backend/src/controllers/partnerOrders.controller.js:92` · bug  
*Por qué:* Es un valor fijo, anterior al cobro del Básico. placeOrder llama a assertVendorAcceptsOrders (orders.controller.js:169), que rechaza con 409 VENDOR_BILLING_OVERDUE cuando el cobro está atrasado (planBilling.service.js:61-65). El socio arma el formulario y el pedido falla recién al final.  
*Arreglo:* 1) Exportar isBillingOverdue desde planBilling.service.js si no lo está. 2) En getCheckoutRequirements: `const overdue = await isBillingOverdue(store); acceptsOrders: !overdue, reason: overdue ? 'La tienda no está recibiendo pedidos en este momento.' : null`. 3) Documentar `reason` y el código VENDOR_BILLING_OVERDUE (409) en ApiSocios.jsx. 4) Prueba: tienda con nextPaymentDueDate vencida, la respuesta dice acceptsOrders false.

**133. [MEDIA] Las solicitudes de socio no pasan por la lista negra ni por la regla de teléfono único**  
`backend/src/controllers/partnerApplications.controller.js:57` · seguridad  
*Por qué:* submitApplication solo comprueba que el correo no tenga cuenta ni otra solicitud pendiente. No llama a assertNotBlacklisted (lib/blacklist.js:40) ni a assertPhoneFree (lib/phoneUniqueness.js:39), que sí usan el registro y updateMe (customers.controller.js:62-63). approveApplication (140-147) crea el usuario PARTNER con app.phone sin volver a comprobar nada. El flujo se hizo aparte y quedó fuera cuando se creó la lista negra. Va contra la regla del dueño de lista negra y datos únicos.  
*Arreglo:* 1) En submitApplication, después de parse: `await assertNotBlacklisted({ email: data.email, phone: data.phone }); await assertPhoneFree(data.phone);`. 2) Lo mismo en editApplication cuando cambian el correo o el teléfono. 3) En approveApplication, repetir las dos comprobaciones antes de la transacción (la lista negra puede haber cambiado mientras la solicitud esperaba). 4) Prueba: poner un teléfono en la lista negra y enviar una solicitud con él, debe responder con el mismo error que el registro.

**134. [MEDIA] Panel del socio sin estado de error: el Resumen se queda cargando para siempre**  
`frontend/src/pages/partner/PartnerDashboard.jsx:88` · bug  
*Por qué:* `isLoading || !usage ? <Skeleton/>`: si /partner-portal/overview falla (por ejemplo, 404 de cuenta no vinculada), usage queda undefined y el esqueleto no desaparece. PartnerKeys y PartnerMovements tampoco leen isError; solo PartnerPlans (122) tiene mensaje. La regla 4 pide estados vacío, cargando y error.  
*Arreglo:* 1) En PartnerDashboard: tomar isError y refetch de useQuery; si isError, mostrar una tarjeta CARD con el error del servidor (err.response?.data?.error) y un botón 'Reintentar' (min-h-11) que llame a refetch. Dejar el esqueleto solo para isLoading. 2) Mismo patrón en PartnerKeys.jsx (consultas de las líneas 14 y 49) y PartnerMovements.jsx (26). 3) Prueba: cortar el backend y ver el mensaje con el botón Reintentar.

**135. [BAJA] Los puntos usados en un pedido se muestran siempre en CUP**  
`frontend/src/pages/customer/CustomerPanel.jsx:548` · bug  
*Por qué:* `fmtCUP(o.loyaltyDiscount)` con fmtCUP = `${n} CUP` (línea 37). El programa usa la moneda de la tienda (getPublicProgram: currency: vendor.currency). Es un resto de cuando todo era en CUP.  
*Arreglo:* Usar formatPrice(o.loyaltyDiscount, o.items[0]?.currency ?? 'CUP') y borrar fmtCUP si no queda ningún uso.

**136. [BAJA] Las fotos de las ventas rápidas del panel apuntan a localhost**  
`frontend/src/pages/customer/CustomerPanel.jsx:676` · conexion  
*Por qué:* `${import.meta.env.VITE_API_URL ?? 'http://localhost:4000'}${...}` en las líneas 676 y 840. El resto del sitio usa lib/imgUrl.js o api.defaults.baseURL (Bloque 182). Desde el celular en la red local no cargan, y si VITE_API_URL está vacío, ?? no cae al valor por defecto.  
*Arreglo:* Importar imgUrl/thumbUrl de lib/imgUrl.js y usarlos en las líneas 676 y 840, como QuickSaleCard.

**137. [BAJA] Una venta rápida vendida sigue abierta por enlace y deja contactar al dueño**  
`backend/src/controllers/customerListings.controller.js:339` · bug  
*Por qué:* getPublicListing no filtra isSold, mientras que publicVisibility.listingVisibility (línea 46) cuenta 'Marcado como vendido' como oculto. QuickSaleDetail no muestra 'Vendido' y deja 'Pedir por WhatsApp' activo.  
*Arreglo:* Mantener la ficha accesible para no romper enlaces compartidos, pero en QuickSaleDetail.jsx, si listing.isSold, mostrar la insignia 'Vendido' y desactivar los botones de contacto (o reemplazarlos por 'Ver otros anuncios').

**138. [BAJA] Validación floja al crear pedidos y guardar el carrito**  
`backend/src/controllers/orders.controller.js:63` · config  
*Por qué:* createOrderSchema no tiene .max en items, quantity, shippingAddress ni selectedOptions (z.record(z.any())). cart.controller.js acepta items z.array(z.record(z.any())) sin tope. /orders/shipping-quote no tiene rate limit. customerItemsSchema (1055) y la API de socios (max 50 líneas, quantity 10000) ya aplican este criterio. Una cantidad de más de 2^31 en un producto ilimitado provoca un 500 por la columna Int.  
*Arreglo:* createOrderSchema: items .max(100), quantity .max(99999), shippingAddress .max(500), selectedOptions z.record(z.string().max(100)) con un máximo de claves. cart.controller: items .max(100) y un tamaño máximo del JSON. Aplicar un rate limit a POST /orders/shipping-quote.

**139. [BAJA] Abrir 'Cancelar pedido' en un pedido en preparación manda un correo cada vez**  
`backend/src/controllers/customers.controller.js:152` · mejora  
*Por qué:* CancelBlockedModal hace POST al montarse, y el servidor llama a sendOrderCancelHelpEmail sin antirrebote. Si el plan no permite correos, el modal dice 'No pudimos enviarte el correo ahora mismo', como si fuera un fallo pasajero. Mandar el correo es intencional (comentario de la línea 142); lo que falta es el antirrebote.  
*Arreglo:* Registrar el envío en OrderEvent y no repetirlo en 6 h; devolver emailSkipped:'recent'|'plan'. En CustomerOrderActions.jsx:103, mostrar un texto distinto para cada caso ('Ya te enviamos el correo hace un rato').

**140. [BAJA] El nombre o el correo largo desborda la cabecera del panel a 390px y se muestra 'Cuba' por defecto**  
`frontend/src/pages/customer/CustomerPanel.jsx:456` · desborde_ui  
*Por qué:* Al div del medio del flex le faltan min-w-0, truncate y break-words, así que un correo largo sin espacios empuja 'Cerrar sesión' fuera de la tarjeta. La línea 458 pone 'Cuba' a clientes de cualquier país.  
*Arreglo:* Agregar `min-w-0 flex-1` al contenedor y `truncate` (o break-all) al nombre o correo. En la 458: mostrar customer.province?.name y, si falta, el país real o nada.

**141. [BAJA] La insignia 'Entregado' no cumple el contraste AA**  
`frontend/src/pages/customer/CustomerPanel.jsx:44` · desborde_ui  
*Por qué:* #0CAE53 a 11.5px sobre su propio color al 12 % da unos 2,8:1. Se copió de VendorOrders por consistencia, así que conviene arreglarlo en los dos.  
*Arreglo:* Texto con un verde de 4,5:1 o más (token verified-dark o #087A38) y el verde claro solo de fondo. Aplicar lo mismo en VendorOrders.jsx.

**142. [BAJA] Raya larga y emoji en textos visibles del panel, la venta rápida y el carrito compartido**  
`frontend/src/pages/customer/CustomerPanel.jsx:226` · texto  
*Por qué:* Hay rayas largas en CustomerPanel.jsx 226, 299, 325, 690, 865 y 877, QuickSaleListings.jsx:56 y SharedCart.jsx:194, y un emoji ⚠️ en 832. Rompe la regla 4.  
*Arreglo:* Cambiar por punto, coma o dos puntos (por ejemplo, 'Anuncio creado. Ahora sube al menos una foto.'), y quitar el emoji o sustituirlo por un ícono de lucide con aria-hidden.

**143. [BAJA] Mayúsculas de título y lugar mal armado en el checkout y el carrito**  
`frontend/src/pages/public/Checkout.jsx:895` · texto  
*Por qué:* 'Confirmar Pedido' (895) y 'Seleccionar País' (688) usan mayúsculas de título. Cart.jsx:67 arma `${municipio ?? ''}, ${provincia}`, que da ', La Habana' o 'x, undefined'. Checkout.jsx:699 pone 'Cuba' por defecto.  
*Arreglo:* Usar 'Confirmar pedido' y 'Elige el país'. En Cart.jsx:67, armar el lugar con [municipio, provincia].filter(Boolean).join(', ').

**144. [BAJA] Faltan estados de error en las listas del panel del cliente y en la venta rápida**  
`frontend/src/pages/customer/CustomerPanel.jsx:128` · mejora  
*Por qué:* Las consultas de pedidos, anuncios, favoritos y perfil no leen isError. QuickSaleListings.jsx:72 muestra 'No hay anuncios' también cuando la petición falla. MyPoints y EmailPreferencesCard sí tienen estado de error. getMyOrders no pagina y se vuelve a pedir cada 8 s.  
*Arreglo:* Agregar un bloque de error con 'Reintentar' (refetch) en cada pestaña y en QuickSaleListings. Paginar /customers/me/orders (20 por página) y subir refetchInterval a 30 s.

**145. [BAJA] El listado público de ventas rápidas no tiene tope sin ?limit**  
`backend/src/controllers/customerListings.controller.js:314` · config  
*Por qué:* Sin ?limit, take queda undefined y devuelve todos los anuncios. QuickSaleListings los pide así y filtra en el navegador. Está documentado, pero escala mal con datos móviles.  
*Arreglo:* Paginar (take 48 con cursor) y mover la búsqueda y el filtro de estado al servidor, o al menos un tope de 200.

**146. [BAJA] El filtro inStock de la API de socios se acepta pero no se aplica, y las reseñas de un producto agotado dan 404**  
`backend/src/controllers/partnerApi.controller.js:55` · bug  
*Por qué:* productQuerySchema define inStock, pero buildProductWhere no lo lee. listProductReviews (172) usa visibleProductWhere sin includeOutOfStock, a diferencia de getProduct (163).  
*Arreglo:* En buildProductWhere: si f.inStock, agregar `{ OR: [{ unlimitedStock: true }, { stock: { gt: 0 } }] }`. En listProductReviews, pasar `{ includeOutOfStock: true }`. Documentar inStock y payment en ApiSocios.jsx.

**147. [BAJA] Textos y comentarios desactualizados en el portal y la doc de socios**  
`frontend/src/pages/partner/PartnerKeys.jsx:68` · texto  
*Por qué:* Sin credencial se ven dos avisos a la vez (23 y 68). El comentario de las líneas 43-45 dice que el secreto no se puede volver a ver. A la tabla de errores de ApiSocios (241) le faltan 400, 409 y 413. La descripción del permiso stores:read (partnerScopes.js:6) no dice que /stores/:slug/products también exige products:read. El comentario de partnerApi.controller.js:96 dice 30 s y el TTL es de 5 s. Los textos visibles dicen 'Baznova' fijo en lugar de siteName.  
*Arreglo:* Dejar un solo aviso de vacío en PartnerKeys y corregir el comentario. Sumar a la tabla de errores las filas 400 (validación, invalid_json, idempotency_key_required), 409 (idempotency_key_reused, sin stock, VENDOR_BILLING_OVERDUE) y 413 (body_too_large). Aclarar en stores:read que los productos requieren además 'Productos'. Corregir el comentario a 5 s. Usar siteName de usePlatformSettings en los textos visibles del portal y de la doc.

**148. [BAJA] El filtro de Movimientos deja fuera los pedidos creados (201) y no cubre 400, 409 ni 5xx**  
`frontend/src/pages/partner/PartnerMovements.jsx:13` · mejora  
*Por qué:* FILTERS usa estados exactos y recentMovements (partnerStats.js:49) filtra por igualdad. Se hizo antes de que existieran los pedidos por API.  
*Arreglo:* Filtrar por rangos (2xx, 4xx, 5xx) en partnerStats.recentMovements con gte/lt, y cambiar las opciones del filtro a 'Correctos (2xx)', 'Errores del cliente (4xx)', 'Errores del servidor (5xx)' y '429'.

**149. [BAJA] El límite de pedidos por credencial se reinicia para todos al pasar de 2000 entradas**  
`backend/src/controllers/partnerOrders.controller.js:58` · seguridad  
*Por qué:* `orderHits.clear()` borra también los contadores de una credencial que está en el tope. Además vive en memoria. Con pocos socios casi no pasa.  
*Arreglo:* En vez de clear(), recorrer orderHits y borrar solo las entradas cuyo último hit tiene más de ORDER_WINDOW_MS, igual que poolCache en partnerApi.controller.js:109.

### Está así a propósito (no se toca)

- **El precio final del socio (finalMonthly) no se cobra a la tienda**: PartnerPlans.jsx:128 dice a propósito 'El cobro del extra a cada tienda lo define Baznova contigo', y quotePlan/planBilling solo usan el precio base. No es un error de código sino una decisión de negocio pendiente. Hasta que el dueño decida, GET /plans y PartnerPlans deberían llamarlo 'precio sugerido' para no chocar con la regla 3 (ver mejoras).
- **Al aprobar una solicitud de socio se dan todos los permisos por defecto, incluido orders:create**: partnerScopes.js:17 y approveBody (partnerApplications.controller.js:113-114) lo documentan como 'Por defecto, todos'. El admin puede recortarlos al aprobar. Que el dueño confirme si prefiere dejar orders:create fuera por defecto.
- **La restricción por dominio se basa en Origin/Referer, que se pueden falsificar**: El comentario de partnerCors (partnerAuth.js:29-31) reconoce que la defensa real es la llave más dominio o IP. Es una limitación conocida de las llaves usadas desde el navegador. Solo conviene ajustar el texto de la doc (ApiSocios.jsx:177) para no prometer más de lo que se hace.
- **El formulario público de socios responde 409 si el correo ya tiene cuenta**: Tiene registerRateLimit (partnerApplications.routes.js:7) y sigue el mismo criterio de experiencia que el registro normal, que también avisa del correo duplicado. Es un riesgo acotado y aceptado.
- **La API de socios rechaza un producto repetido en dos líneas**: partnerOrders.controller.js:198-200 lo hace a propósito para que el socio junte las cantidades. Lo que falla es que la comparación no tiene en cuenta la talla, y eso va incluido en el plan del hallazgo alto de placeOrder.
- **El modo 'sum' del carrito compartido**: CartContext.jsx:126-132 explica que se suma porque se agrega el carrito de otra persona al propio. Es correcto la primera vez; el error es solo reimportar el mismo enlace al recargar (hallazgo confirmado aparte).
- **La página de fidelización sigue visible y configurable cuando el plan no la incluye**: VendorLoyalty.jsx:447-449 lo muestra a propósito ('Puedes dejarlo configurado y encenderlo cuando cambies de plan'), y saveMyProgram impide encenderlo. Solo el ajuste manual de puntos queda sin bloquear (confirmado aparte).
- **Mandar un correo de ayuda al intentar cancelar un pedido en preparación**: Lo explica el comentario de customers.controller.js:142-143 y CustomerOrderActions.jsx:66-68. Lo que falta es el antirrebote (confirmado como mejora baja).
- **El listado público de ventas rápidas devuelve todo sin ?limit**: Está documentado en el código ('sin límite, la página completa') y QuickSaleListings filtra en el navegador. Se deja como mejora de rendimiento (baja), no como error.
- **La regla doble stores:read + products:read en /stores/:slug/products**: partnerApi.routes.js:20 la exige a propósito y ApiSocios.jsx:25 la documenta. Solo está mal la descripción del permiso (incluida en el hallazgo de textos).

### Mejoras propuestas

- Planes del socio: que el dueño decida si una tienda que llega por un socio paga finalMonthly (quotePlan con el extra del socio cuando vendor.partnerId, y la Suscripción del vendedor muestra ese precio) o si se renombra a 'precio sugerido' en GET /plans, PartnerPlans y ApiSocios aclarando que Baznova cobra el precio base.
- Unificar la fuente de los planes: /planes, la Suscripción del vendedor, GET /plans de socios y PartnerPlans deben salir de publicPlan(c) + buildPlanIncludes. Agregar una prueba que compare las cuatro salidas para el mismo PlanConfig.
- Carrito: revalidar el código de descuento con debounce al cambiar los productos o las cantidades, en lugar de guardar un monto fijo, y mostrar el aviso 'Tu código se recalculó'.
- Carrito compartido: mostrar en la pantalla de importación qué productos se descartaron y por qué (agotado, ya no disponible) en lugar de solo un contador.
- Venta rápida vendida: insignia 'Vendido' y botón 'Ver anuncios parecidos' en lugar de los contactos, para no perder la visita del enlace compartido.
- Panel del cliente: paginar 'Mis pedidos' y cambiar el sondeo de 8 s por 30 s o por avisos push, para ahorrar datos móviles.
- Pestaña Direcciones del cliente: quitarla o fusionarla con LocationPicker de Perfil, para tener un solo formulario de ubicación agrupado por país.
- Consola de /api-socios: aviso claro de que 'Crear pedido' genera un pedido real, con Idempotency-Key autogenerada y botón para regenerarla.
- Movimientos del socio: filtros por rangos (2xx/4xx/5xx) y un filtro específico para pedidos creados.
- Respuesta de cancelación bloqueada: distinguir 'el plan de la tienda no permite correos' de 'ya te lo enviamos hace un rato' y de 'falló el envío'.
- Portal y doc de socios: usar siteName de la configuración en todos los textos visibles para no mezclar marcas si el admin cambia el nombre del sitio.

<details><summary>Notas del subagente: Cliente comprador</summary>

Revisé todo solo leyendo, sin ejecutar nada. Lo más grave es el hallazgo de orders.controller.js:237: un carrito con dos tallas del mismo producto no se puede comprar ni por la web ni por la API de socios. Ya se arregló antes en editar pedido y en el panel del vendedor; aquí falta el Set. Las otras prioridades son el carrito compartido (no ve productos ilimitados, no comprueba la tienda ni el cupo del plan, y duplica cantidades al recargar), el carrito que sobrevive al cierre de sesión y la raya larga que Checkout sigue grabando en la dirección de cada pedido, aunque un comentario del rastreo dice que ya no pasa. Comprobé como bien resueltos: el aislamiento de 'mis pedidos', cancelar y editar (loadOwnOrder, mismo 404), el rastreo público (correo y número, rate limit, sin documento de identidad), los topes de venta rápida en el servidor (activos, por día, fotos) y que activeProgramFor respeta allowLoyalty al canjear. No vi problemas de React hooks en estos archivos.

</details>

<details><summary>Notas del subagente: Portal de socios</summary>

Revisión de solo lectura: no se editó ni se ejecutó nada. Lo que está bien: las rutas /partner-portal están protegidas en el servidor con authenticate + requireRole('PARTNER'), y el socio sale siempre de req.user.id, nunca de un id que mande el navegador. La API pública valida llave, estado del socio, scopes, cuota y visibilidad (tiendas privadas solo para su socio, productos fuera de cupo u ocultos excluidos), y los pedidos pasan por placeOrder con todas sus reglas. En la UI a 390px no encontré desbordes horizontales de página: las tablas y los bloques de código usan overflow-x-auto internos, los botones llegan a 44px y los tokens de color (outline #65676c, on-surface-variant) cumplen AA. Lo más importante por resolver: (1) CORS sin Idempotency-Key, que rompe los pedidos desde el navegador y la consola; (2) acceptsOrders fijo en true aunque la tienda tenga el cobro atrasado; (3) planes del socio desalineados con lo que configura el admin (Básico 'Gratis' fijo, límites sin interruptores, features crudos) y precio final del socio que nunca se cobra; (4) las solicitudes de socio no pasan por la lista negra. No revisé partners.controller.js (admin de socios, revealKeyValue) ni la pantalla de login de socio (Account mode='partner') porque quedan fuera del alcance asignado.

</details>


## Páginas públicas

Revisé en el código los hallazgos de severidad alta y media de los cuatro subagentes, y casi todos se confirman. Hay cuatro errores graves. Uno es el registro: si cambias el país después de escribir el teléfono, el cambio no se guarda, porque se usa una copia vieja de `form` (Account.jsx:1292-1293 junto con PhoneInput.handleCountry). Otro es que el correo distingue mayúsculas en registro, login y recuperación (auth.controller.js), y eso deja crear cuentas duplicadas. El tercero es el beneficio de plan "Destacada en la portada" (featuredInHome): el admin lo configura y /planes lo vende, pero la portada no lo usa, porque solo lo mira el autocompletado (search.controller.js:490). El cuarto es el menú QR, que muestra y acepta productos fuera del cupo del plan (tables.controller.js:1130 y 1274). En datos privados, las reseñas públicas se envían con la fila completa: quién las reportó, el motivo y el admin que resolvió. Además, toPublicVendor no quita los campos nuevos de fraude, cobro y bajada de plan. Contra la regla 3 hay textos fijos ("gratis", "Premium", "Baznova", soporte@zeudin.com) que no siguen lo que configura el admin. Y en /planes, "Elegir Básico" o un plan sin insignia lleva al pago de Premium. Lo que funciona bien, según los subagentes: las tiendas bloqueadas o suspendidas se ocultan en todos los endpoints públicos y POST /vendors exige el rol CUSTOMER. El límite de mesas al registrarse se aplica en el servidor, y las redes de la tienda se normalizan en el servidor. VendorOnboarding.jsx ya no existe: /vender redirige al registro de Account.jsx con mode="vendor". La enumeración de correos en el login es una decisión aceptada (Bloques 88 y 279). Ningún subagente propuso un diseño de planes dinámicos. La propuesta que más se repite es leer de la configuración pública de planes (usePlatformSettings o /settings/plans) el plan REGULAR (displayName, isFree) y los planes con grantsBadge, y armar con eso todos los textos de "gratis" y "Premium" de la portada, el registro, el pie y /planes. No ejecuté nada: el recorte de OfferCard a 390px y el desborde de los botones lg salen del cálculo con las clases y hay que comprobarlos en el navegador.

### Errores confirmados (50)

**150. [ALTA] Cambiar el país del teléfono en el registro no se guarda (copia vieja de form)**  
`frontend/src/pages/public/Account.jsx:1292` · bug  
*Por qué:* PhoneInput.handleCountry (PhoneInput.jsx:96-101) llama a onChange y a onCountryChange en el mismo evento. Account.jsx usa setForm({ ...form, phone }) y setForm({ ...form, country }) con el mismo `form` viejo, así que el segundo setForm devuelve form.phone al número anterior. Después, el efecto de PhoneInput (50-56) ve que value !== lastEmitted y vuelve a poner el país del número viejo. Resultado: con un número ya escrito no se puede cambiar el país. Pasa lo mismo al pegar un número con + (handleNational 105-112). CustomerPanel ya usa la forma con función, así que aquí es un descuido.  
*Arreglo:* 1) En Account.jsx:1292-1293 usar setForm((f) => ({ ...f, phone })) y setForm((f) => ({ ...f, country })). 2) Usar la misma forma en el resto de los setForm del registro (1283-1311) para evitar casos parecidos. 3) Prueba: escribir un número con Cuba, cambiar a México y comprobar que el selector queda en México y que el payload lleva +52; pegar '+52 55...' y comprobar lo mismo; hacerlo a 390px.

**151. [ALTA] El correo distingue mayúsculas en registro, login, 2FA y recuperación**  
`backend/src/controllers/auth.controller.js:152` · bug  
*Por qué:* registerSchema (123), verifyRegistration (212), loginSchema (292), verifyTwoFactor (509), forgot, verify y reset (735-772) usan z.string().email() sin trim ni toLowerCase, y luego findUnique({ where: { email } }). En schema.prisma User.email es String @unique, que en Postgres distingue mayúsculas. En cambio, requestEmailChangeSchema (825) normaliza y checkVendorAvailability (vendors.controller.js:1879) compara sin distinguir mayúsculas. Así check-availability dice que la cuenta existe y register crea igual 'Juan@...' aparte de 'juan@...'. Además, el teclado del celular pone mayúscula inicial y el login falla. Rompe la regla del dueño de que nada se duplique.  
*Arreglo:* 1) Crear un emailField = z.string().trim().toLowerCase().email(...) en auth.controller.js y usarlo en registerSchema, verifyRegistrationSchema, loginSchema, el schema de 2FA, forgotPasswordSchema, verifyResetCodeSchema y resetPasswordSchema. 2) Hacer lo mismo en createVendorSchema y en las altas de usuarios del admin y del personal. 3) Antes de pasar a minúsculas, listar los correos que solo difieren en mayúsculas (SELECT lower(email), count(*) ... HAVING count>1) y resolver los casos con el dueño. Después, una migración escrita a mano: UPDATE "User" SET email = lower(email), y lo mismo en PendingRegistration. 4) En el frontend, autoCapitalize="none" en los campos de correo. 5) Prueba: registrar 'Test@x.com', intentar 'test@x.com' (debe decir que la cuenta ya existe) y entrar con 'TEST@x.com'.

**152. [ALTA] El beneficio de plan 'Destacada en la portada' (featuredInHome) no se aplica en la portada**  
`backend/src/controllers/search.controller.js:352` · permisos_plan  
*Por qué:* Home pide los Destacados a GET /search sin texto, y ese camino ordena con rankFeaturedProducts, que solo usa isFeatured (manual del admin) y verificationStatus (productRanking.js:154-238), sin mirar el plan. featuredInHome solo se usa en el autocompletado (search.controller.js:486-490). Sin embargo, AdminSubscriptions.jsx:122 lo ofrece como interruptor, y PlansCatalog.jsx:60 y buildPlanIncludes (planConfig.js:324) lo publican como beneficio en /planes. Rompe las reglas 1 y 3: se vende algo que el servidor no cumple. Es un olvido: cuando se rehízo el ranking (Bloque 98) no se volvió a mirar el plan.  
*Arreglo:* 1) En structuredSearch, agregar planType al select del vendor (includeOpts.vendor.select). 2) Cargar plansByType con getAllPlanConfigs(), como en autocompleteSearch, y pasar a rankFeaturedProducts una opción isPlanFeatured(vendor) = verificada y con plansByType[planType]?.featuredInHome. 3) En productRanking.js, sumar un empuje fijo (por ejemplo +0.5, menor que el +1 de isFeatured) cuando esa función dé true, y mostrarlo en el desglose de explicación (línea ~289). 4) Opcional: aplicar el mismo empuje en listVendors con isVerified=true (sección 'Tiendas verificadas' de Home). 5) Prueba: apagar featuredInHome en Premium y ver que sus productos pierden el empuje; encenderlo y ver que suben; revisar la regresión en el catálogo con texto.

**153. [ALTA] El menú QR muestra y acepta productos fuera del cupo del plan (overQuota)**  
`backend/src/controllers/tables.controller.js:1130` · permisos_plan  
*Por qué:* getTableByToken (1129-1137) y createTableOrder (1273-1281) filtran solo isActive, availableForTableMenu y la restricción por mesa, sin overQuota:false ni suspendedAt:null. recalcVendorProductQuota (planConfig.js:207-221) cuenta todos los productos activos, también los del menú, y publicVisibility.js:30 define overQuota como 'no sale en ningún lado público'. Un restaurante que baja de plan sigue vendiendo por QR los platos fuera del cupo, lo que rompe la regla 1. El comentario del Bloque 157 dice que los dos where deben ser iguales; overQuota se olvidó en los dos.  
*Arreglo:* 1) Extraer en tables.controller.js const tableMenuProductWhere = (qrToken) => ({ isActive: true, availableForTableMenu: true, overQuota: false, suspendedAt: null, OR: [...] }). 2) Usarlo en getTableByToken (products.where) y en createTableOrder (findMany). 3) Revisar addItem/updateItem del mozo (tables.controller.js 486-634, 1421) y, si aceptan productos del menú, aplicarles el mismo filtro. 4) Prueba: tienda con maxProducts=1 y 2 platos de menú; el plato excedente no debe salir en /mesa/:token y un POST directo con su productId debe responder 400.

**154. [MEDIA] Las reseñas públicas incluyen quién las reportó, el motivo y el admin que resolvió**  
`backend/src/controllers/vendors.controller.js:328` · seguridad  
*Por qué:* getVendorBySlug trae reviews con include (fila completa) y getProductBySlug igual (products.controller.js:476). Review tiene reportStatus, reportedById, reportReason y reportResolvedById (schema.prisma:3219-3223). Cuando el admin mantiene la reseña (KEPT), vuelve a ser visible con esos campos llenos, así que cualquier visitante o la tienda pueden ver el id del cliente que denunció y su texto. El frontend no usa esos campos.  
*Arreglo:* 1) Crear en backend/src/lib/publicReview.js un PUBLIC_REVIEW_SELECT (id, userId, authorName, rating, title, comment, images, createdAt, isVerifiedPurchase, vendorReply, adminReply, los campos de respuesta que use ReviewsList.jsx y product {id,name,slug,images}). 2) Usarlo en vendors.controller.js:328 y products.controller.js:476 en lugar de include. 3) Comparar con ReviewsList.jsx, Store.jsx y Product.jsx que no falte ningún campo usado (por ejemplo, para 'es tuya'). 4) Prueba: reportar una reseña, mantenerla desde el admin y comprobar en la respuesta de GET /vendors/:slug que no aparecen campos report*.

**155. [MEDIA] toPublicVendor no quita los campos nuevos de fraude, cobro y bajada de plan**  
`backend/src/lib/publicVendor.js:6` · seguridad  
*Por qué:* PRIVATE_VENDOR_FIELDS no incluye fraudSuspendedAt, fraudContactDueAt, fraudDeleteAt, fraudStrikesResetAt, billingSuspendedAt, billingNoticeStage, billingNoticeDue, planDowngradeAt, planDowngradeReason, trialBilling, stripeIntervalMonths ni previousSlugs, que existen en el modelo Vendor (schema.prisma:1153-1394). GET /vendors/:slug y GET /vendors devuelven la fila completa menos esa lista, así que un visitante puede saber que una tienda tiene el cobro atrasado o un proceso de fraude abierto. El propio comentario dice 'un campo nuevo sensible se agrega aquí'; estos campos se agregaron después.  
*Arreglo:* 1) Sumar esos 12 campos a PRIVATE_VENDOR_FIELDS. 2) Revisar el resto del modelo Vendor (1140-1485) y sumar cualquier otro campo interno. 3) A mediano plazo, pasar a una lista de lo que sí se envía (select público), para que un campo nuevo no se filtre por defecto. 4) Agregar un test o script que compare las claves de Vendor del schema contra las listas pública y privada y avise si aparece una clave nueva sin clasificar.

**156. [MEDIA] Al cambiar la contraseña no se cierran las demás sesiones ni se borra el dispositivo de confianza**  
`backend/src/controllers/auth.controller.js:792` · seguridad  
*Por qué:* resetPassword solo actualiza passwordHash, resetCode y mustSetPassword (792-795), y updateMyPassword (916-917) igual. Si alguien recupera una cuenta robada, la sesión del intruso sigue viva: su refresh token renueva 30 días y su TrustedDevice le evita el 2FA. logoutAllDevices (641-642) y confirmMyEmailChange (889-890) ya revocan sesiones y dispositivos, así que el patrón existe. No hay comentario que explique la omisión.  
*Arreglo:* 1) En resetPassword, después del update: prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }) y prisma.trustedDevice.deleteMany({ where: { userId: user.id } }), todo en una transacción. 2) En updateMyPassword, revocar las sesiones menos la actual (where: { id: { not: req.user.sid } } o el campo equivalente) y avisar en el frontend 'Cerramos tus otras sesiones'. 3) Prueba: dos navegadores con sesión; restablecer en uno y comprobar que el refresh del otro devuelve 401.

**157. [MEDIA] Códigos de 6 dígitos con Math.random y sin tope de intentos por cuenta**  
`backend/src/controllers/auth.controller.js:425` · seguridad  
*Por qué:* Los códigos de registro (184), restablecimiento (366) y 2FA (425, 499) usan Math.random(), y el de cambio de correo también (820). verifyRegistration, verifyResetCode, resetPassword y verifyTwoFactorLogin no cuentan intentos fallidos. El único freno es passwordResetRateLimit, de 40 cada 15 min por IP (rateLimit.js:67-73), y el propio archivo dice que esos límites 'NO son límites de producción'. Repartiendo IPs se puede probar todo el espacio de 10^6 códigos.  
*Arreglo:* 1) Cambiar a crypto.randomInt(0, 10 ** N) en las 5 generaciones. 2) Migración escrita a mano: agregar codeAttempts Int @default(0) a User (para reset y 2FA) y a PendingRegistration. 3) En cada verificación fallida, incrementar el contador; al llegar a 5, invalidar el código (hash a null) y responder 'Pide un código nuevo'; al emitir un código nuevo, volver el contador a 0. 4) Ajustar los rate limits de producción antes de subir al VPS.

**158. [MEDIA] Los textos 'gratis' están fijos en la portada, el registro y el pie aunque el admin puede cobrar el Básico**  
`frontend/src/pages/public/Home.jsx:472` · permisos_plan  
*Por qué:* Home.jsx:472 y 483 ('Abre tu tienda online gratis', 'Crear mi tienda gratis'), Account.jsx:41 (subtítulo del cliente), 673 y 1427 ('Con el plan gratis puedes tener hasta N mesas') y Footer.jsx:89 ('Registrarse gratis') son fijos. Desde cf0c446, planBilling.service.js (7, 27-29) cobra el Básico cuando el admin le quita isFree, y Plans.jsx:35 ya usa plan.isFree. Hoy el Básico es gratis por decisión del dueño, pero el texto no sigue el interruptor, y eso rompe la regla 3.  
*Arreglo:* 1) En usePlatformSettings.js, exponer regularPlan = data?.plans?.find(p => p.planType === 'REGULAR') con displayName, isFree y priceCup. 2) Home.jsx: título y botón según isFree ('Abre tu tienda online gratis' o 'Abre tu tienda desde X CUP al mes', 'Crear mi tienda gratis' o 'Crear mi tienda'). 3) Account.jsx:41: decir 'gratis' solo si isFree; 673 y 1427: `Con el plan ${regularPlan.displayName} puedes tener hasta ${maxTables} mesas`. 4) Footer.jsx:89: 'Registrarse gratis' o 'Crear mi tienda'. 5) Prueba: quitar isFree al Básico en AdminSubscriptions y revisar portada, /cuenta, /vendedor/ingresar?tab=registro, el pie y /planes a 390px.

**159. [MEDIA] En /planes, 'Elegir Básico' o un plan de pago sin insignia abre el pago de Premium**  
`frontend/src/pages/public/Plans.jsx:28` · bug  
*Por qué:* Para un vendedor, cada plan que no es el suyo enlaza a /vendedor/verificacion?plan=X, también el Básico gratis. VendorVerification.jsx:83-84 solo acepta planes con grantsBadge, de pago y sin contactOnly; si no encuentra el pedido, cae al destacado (Premium). Quien elige Básico o un Estándar sin insignia termina en la pantalla de pago de otro plan. El comentario de VendorVerification.jsx:77 dice que ?plan= preselecciona ese plan, así que no es intencional.  
*Arreglo:* 1) Plans.jsx: si plan.isFree y el vendedor tiene un plan de pago, mostrar un texto ('Para bajar al plan X, escríbenos' o un flujo de bajada si el dueño lo define) en lugar de 'Elegir'. 2) VendorVerification.jsx: si requestedPlan es de pago pero sin insignia, mostrar el pago sin verificación (paysWithoutBadge o la renovación de planBilling) en lugar de caer al destacado. 3) Account.jsx:970: aceptar cualquier planType de pago de la configuración pública (no isFree ni contactOnly) en lugar de la lista fija ['STANDARD','BUSINESS']. 4) Prueba con cada planType como vendedor y como visitante, a 390px.

**160. [MEDIA] El menú del Header manda al personal de tienda y a los socios a /cuenta/panel, que es solo para clientes**  
`frontend/src/components/layout/Header.jsx:155` · conexion  
*Por qué:* accountHref solo distingue ADMIN y VENDOR; VENDOR_STAFF y PARTNER caen en /cuenta/panel, protegida con roles ['CUSTOMER'] (App.jsx:224). La etiqueta dice 'Mi cuenta'. Account.jsx:484-492 ya tiene el mapa correcto, pero el Header es anterior a los Bloques 183 (personal) y 299 (socios).  
*Arreglo:* 1) Crear frontend/src/lib/rolePanel.js con panelForRole(role) que devuelva { href, label }: ADMIN /admin 'Panel de administración'; VENDOR y VENDOR_STAFF /vendedor 'Panel de vendedor'; PARTNER /socio 'Panel de socio'; CUSTOMER /cuenta/panel 'Mi cuenta'. 2) Usarlo en Header.jsx:155-156 y en Account.jsx (donde redirige tras el login). 3) Prueba: entrar con cada rol y tocar el menú de cuenta.

**161. [MEDIA] El contador del carrito tiene texto blanco sobre naranja (#fe9800), con contraste de unos 2,2:1**  
`frontend/src/components/layout/Header.jsx:180` · desborde_ui  
*Por qué:* Usa bg-secondary-container con text-white y letra de 10px en negrita. En el resto de la app ese fondo lleva text-on-secondary-container (Button.jsx:4, Header.jsx:63). No llega a AA (4,5:1).  
*Arreglo:* Cambiar text-white por text-on-secondary-container en Header.jsx:180, o usar bg-error con text-white. Comprobar el contraste con una herramienta y revisar que se lea sobre el fondo oscuro del Header.

**162. [MEDIA] Los botones del encabezado del chat (silenciar, reiniciar, cerrar) miden 18x18 px**  
`frontend/src/components/MarketplaceChatWidget.jsx:802` · desborde_ui  
*Por qué:* Las líneas 802, 811 y 836 usan h-[18px] w-[18px] sin área extra. Cerrar el chat es la acción más usada en el celular. El resto del widget ya usa h-11 w-11, así que esto es un descuido. Los botones Cancelar y Reiniciar del popover (unos 28px) y el micrófono y enviar (40px) tampoco llegan a 44px.  
*Arreglo:* 1) Cambiar los 3 botones a h-11 w-11, con el ícono de 18px dentro y -m-3 para no mover el diseño. 2) Popover: min-h-11 en Cancelar y Reiniciar. 3) Micrófono y enviar: h-11 w-11. 4) Prueba a 390px: el encabezado no debe desbordar y debe poder tocarse cómodo.

**163. [MEDIA] La portada y otras páginas públicas muestran 'Todavía no hay...' cuando en realidad falló la API**  
`frontend/src/pages/public/Home.jsx:228` · bug  
*Por qué:* Las queries quickSales, featured y verifiedVendors (228-242) solo leen data e isPending; si la API falla, se pinta el EmptyState de 'no hay nada' (395, 445, 514). Lo mismo pasa en Shop.jsx (sin isError), Store.jsx:447 (cualquier error dice que la tienda 'ya no existe'), Faq.jsx (no muestra nada) y TableOrder.jsx:318 (si falla /vendors/:slug, la pantalla queda en esqueleto para siempre). La regla 4 pide estados de error, y Stores.jsx y PlansCatalog ya lo hacen bien.  
*Arreglo:* 1) Crear un componente ErrorState (ícono, 'No pudimos cargar esto', botón 'Reintentar' min-h-11 que llame a refetch), o reutilizar el de Stores.jsx. 2) Home.jsx: usar isError en cada query y mostrar ErrorState antes del vacío. 3) Shop.jsx y Faq.jsx: lo mismo. 4) Store.jsx: separar el 404 ('Esta tienda no está disponible ahora') del error de red o 500 (ErrorState). 5) TableOrder.jsx: manejar isError de vendorFull, o quitar esa dependencia (ver el hallazgo de la mesa QR). 6) Prueba con el backend apagado o forzando un 500 en cada endpoint.

**164. [MEDIA] La mesa QR depende de GET /vendors/:slug, que devuelve la forma reducida justo en los restaurantes con menú solo por QR**  
`frontend/src/pages/public/TableOrder.jsx:260` · conexion  
*Por qué:* vendorFull sale de /vendors/:slug. Si la tienda tiene menuPublic=false y solo platos de menú, getVendorBySlug filtra los productos (vendors.controller.js:369-371) y devuelve { companyName, slug, color, logoUrl, hasPublishedProducts:false } (387-393). Sin isOpenNow, isClosed da false (TableOrder.jsx:325) y deja pedir aunque el local esté cerrado (el servidor lo frena después). El banner, que trata undefined como falso, muestra 'Cerrado ahora', y faltan el sello, la descripción y las redes. Si la consulta falla, la pantalla queda en esqueleto (318).  
*Arreglo:* 1) En getTableByToken, agregar al select del vendor lo que usa el banner minimal: verificationStatus, description, socialLinks (pasado por publicSocialLinks), businessCategory, schedules y timezone, y calcular isOpenNow y nextOpenLabel con isVendorOpenNow. 2) TableOrder.jsx: armar el banner con table.vendor y quitar la query a /vendors/:slug. 3) Prueba: restaurante con menuPublic=false y solo platos de menú, en horario abierto y cerrado.

**165. [MEDIA] La mesa QR muestra y suma todo en CUP aunque el plato tenga otra moneda**  
`frontend/src/pages/public/TableOrder.jsx:14` · bug  
*Por qué:* fmtCUP siempre agrega ' CUP' y se usa para precio, precio anterior, subtotal y total (144-166, 395-435). Product.currency puede ser cualquier moneda activa y tables.controller.js no la tiene en cuenta: un plato de 5 USD sale como '5 CUP', y si se mezclan monedas el total se suma mal. La regla de envíos pide totales por moneda.  
*Arreglo:* 1) TableOrder.jsx: usar formatPrice(p.price, p.currency) (el mismo helper que ProductCard) en lugar de fmtCUP. 2) Total del carrito y de la cuenta: agrupar por moneda y mostrar una línea por moneda. 3) Backend: guardar currency en cada item de makeOrderItem y totalizar por moneda en TableOrder.total, o, si el dueño lo prefiere, impedir en VendorProducts que un plato de menú QR tenga otra moneda que la principal de la tienda. 4) Revisar el panel del mozo (VendorTables) con monedas mezcladas.

**166. [MEDIA] Las ofertas de tienda siguen publicadas después de bajar a un plan que no las permite**  
`backend/src/controllers/vendors.controller.js:348` · permisos_plan  
*Por qué:* getVendorBySlug trae storeOffers activas sin mirar allowStoreOffers ni maxActiveStoreOffers del plan actual. storeOffers.controller.js valida el plan solo al crear o activar (116, 43-51), y nada las apaga al cambiar de plan; para los productos sí existe recalcVendorProductQuota. Rompe la regla 1.  
*Arreglo:* 1) En getVendorBySlug: si !planAllows(vendor.planType, 'allowStoreOffers'), devolver storeOffers = []; si hay tope, cortar a maxActiveStoreOffers (las más recientes). 2) Aplicar el mismo criterio al validar el código de la oferta en el carrito o checkout. 3) Crear una función enforceStoreOfferQuota(vendorId) que desactive las sobrantes y llamarla donde se llama recalcVendorProductQuota (cambio de plan, guardado de PlanConfig, bajada por impago). 4) Prueba: tienda Premium con 3 ofertas, bajarla a Básico y comprobar que la tienda pública y el carrito ya no las aceptan.

**167. [MEDIA] El selector de fotos de reseña aparece aunque el plan de la tienda no lo permita**  
`frontend/src/pages/public/Store.jsx:756` · permisos_plan  
*Por qué:* Store.jsx:756 y Product.jsx:818 muestran el selector con `user && v.isVerified`. El servidor exige además assertPlanAllows(vendor, 'allowReviewPhotos') (reviews.controller.js:73) y responde 403 después de que el cliente eligió las fotos y escribió. Rompe la regla 2 (oculto en la UI si el plan no lo permite).  
*Arreglo:* 1) En getVendorBySlug y getProductBySlug, devolver reviewPhotosAllowed = verificada y planAllows(planType, 'allowReviewPhotos'), con el mismo patrón que aiAvailable. 2) Store.jsx:756 y Product.jsx:818: usar v.reviewPhotosAllowed en lugar de v.isVerified. 3) Prueba con un plan que tenga allowReviewPhotos apagado.

**168. [MEDIA] El menú QR deja armar el pedido aunque el plan no tenga mesas con QR o el cobro esté atrasado**  
`backend/src/controllers/tables.controller.js:1146` · permisos_plan  
*Por qué:* getTableByToken solo revisa isBlocked y status. createTableOrder rechaza con 409 si el plan no tiene allowQrTables (1226) o si el cobro está atrasado (1227). El cliente elige los platos y escribe su nombre, y recién al enviar recibe el error. El servidor bloquea bien, pero la UI no avisa (regla 2).  
*Arreglo:* 1) En getTableByToken, devolver acceptsOrders = planAllows(planType, 'allowQrTables') && !(await isBillingOverdue(vendor)), agregando al select planType, nextPaymentDueDate y billingNoticeStage. 2) TableOrder.jsx: si acceptsOrders es false, mostrar el menú en modo solo lectura con el aviso 'Esta mesa no recibe pedidos por aquí ahora. Pide al personal.' y ocultar el carrito y el formulario. 3) Prueba con un plan sin allowQrTables.

**169. [MEDIA] Los productos relacionados de la ficha incluyen tiendas bloqueadas y platos de menú oculto**  
`backend/src/controllers/products.controller.js:513` · bug  
*Por qué:* Los dos findMany de relacionados (513 y 526) filtran solo isActive, hiddenFromStore y overQuota, sin vendor isBlocked, status, isPrivate, menuPublic ni stock. getProductBySlug tampoco aplica la regla de menuPublic, así que un plato de menú oculto se abre por enlace directo. search.controller.js (PUBLIC_PRODUCT_WHERE) sí aplica estos filtros.  
*Arreglo:* 1) Exportar desde search.controller.js (o desde un lib/publicWhere.js nuevo) PUBLIC_PRODUCT_WHERE con el vendor público y la regla de menuPublic. 2) Usarlo en los dos findMany de relacionados. 3) En getProductBySlug, devolver 404 si product.availableForTableMenu && !vendor.menuPublic (agregar menuPublic al select). 4) Prueba: bloquear una tienda y comprobar que sus productos no salen como relacionados.

**170. [MEDIA] La página de la tienda solo muestra 60 productos y el banner cuenta esos 60**  
`backend/src/controllers/vendors.controller.js:380` · bug  
*Por qué:* Se traen 200 candidatos y se corta a 60 tras el ranking (380). Store.jsx no tiene paginación y StoreHeaderBanner.jsx:333 cuenta v.products.length, mientras StoreCard usa _count.products. Una tienda de 150 productos dice '150' en la tarjeta y '60' en su banner, y 90 productos del plan pagado no se pueden ver desde su página. El corte es intencional por rendimiento (2026-10-24), pero no hay forma de ver el resto.  
*Arreglo:* 1) En getVendorBySlug, calcular productCount con prisma.product.count usando el mismo where (incluida la regla de menuPublic) y devolverlo. 2) StoreHeaderBanner.jsx:333: usar v.productCount. 3) Crear GET /vendors/:slug/products?page=&seed= que pagine sobre el mismo ranking (misma semilla) y agregar 'Ver más' en Store.jsx. 4) Prueba con una tienda de más de 60 productos.

**171. [MEDIA] El listado de tiendas se corta en 100 antes de ordenar**  
`backend/src/controllers/vendors.controller.js:494` · bug  
*Por qué:* listVendors hace orderBy createdAt desc y take 100, y después ordena en memoria (verificadas primero, rating, productos) (497-503). Con más de 100 tiendas, una tienda verificada antigua desaparece, 'Mejor valoradas' solo compara las 100 más nuevas y Stores.jsx muestra '100 tiendas en total'.  
*Arreglo:* 1) Ordenar en la base antes del take: para rating y productos usar orderBy de Prisma ([{ rating: 'desc' }, { reviewCount: 'desc' }] y _count products), y para 'verificadas primero' hacer dos consultas (VERIFIED y el resto) o un campo booleano isVerified. 2) Paginar con page o cursor y devolver total con prisma.vendor.count(where). 3) Stores.jsx: usar total del servidor y agregar 'Ver más'.

**172. [MEDIA] En la portada, a 390px, las ofertas con cupón y botón recortan por arriba el nombre y el título**  
`frontend/src/components/OffersSlider.jsx:96` · desborde_ui  
*Por qué:* El bloque de texto tiene max-h-[calc(100%-2.75rem)], justify-end y overflow-hidden (96). A 390px la tarjeta mide unos 144px de alto. La fila de la tienda, el título text-lg sin line-clamp (108), el cupón (117-121), el botón (122-126) y el padding suman unos 150px para unos 100px disponibles, y como el contenido crece hacia arriba se cortan la tienda, el contador y el título. El Bloque 248 no contó el cupón ni el botón. Es un cálculo con las clases: hay que confirmarlo en el navegador.  
*Arreglo:* 1) Título: agregar line-clamp-2 y, en celular, max-sm:text-base. 2) En celular, si hay cupón y botón, mostrar el cupón dentro del botón ('Usar CODIGO') o solo uno de los dos. 3) Otra opción: aspect-[2/1] sm:aspect-[12/5] en la tarjeta, y ajustar el alto reservado del slider. 4) Prueba a 390px con título largo, cupón, botón y contador.

**173. [MEDIA] La página Contacto muestra un WhatsApp y un correo fijos, y el correo es de la marca vieja (zeudin)**  
`frontend/src/pages/public/Contacto.jsx:71` · config  
*Por qué:* Si el admin no cargó HTML en /admin/contacto, se muestran '+1 469 507 4046' (62) y 'soporte@zeudin.com' (71) como texto, sin wa.me ni mailto, así que no se pueden tocar en el celular. El comentario (52-55) dice que son canales 'confirmados por ZeuDin (2026-08-07)', pero la plataforma ahora es Baznova y ya existe supportWhatsapp configurable en SiteSettings. El valor por defecto quedó viejo.  
*Arreglo:* 1) WhatsApp: leer supportWhatsapp de usePlatformSettings y mostrarlo como <a href="https://wa.me/..." target="_blank" rel="noopener noreferrer"> con min-h-11. 2) Agregar supportEmail a SiteSettings (migración escrita a mano, campo en brandingSchema y en Admin → Marca) y mostrarlo con mailto:. 3) Ocultar cada tarjeta si su dato no está configurado. 4) Quitar el correo @zeudin.com.

**174. [MEDIA] Los enlaces de redes del pie se guardan sin validar (javascript:, o rutas relativas rotas)**  
`backend/src/controllers/settings.controller.js:567` · seguridad  
*Por qué:* whatsappUrl, instagramUrl y facebookUrl (567-569) se guardan como texto libre y Footer.jsx:24-27 los pone directo en href. React 18 solo avisa en consola ante un javascript: y lo renderiza igual, en todas las páginas. Un valor como 'instagram.com/x' sin https queda como ruta relativa y da 404. Solo el admin puede cargarlo, pero lib/socialLinks.js ya resuelve la normalización para las tiendas, así que el argumento del comentario (562-566) ya no se sostiene.  
*Arreglo:* 1) Exportar normalizeUrl(network, value) de backend/src/lib/socialLinks.js, si no lo está. 2) En brandingSchema, aplicar .transform o .refine con normalizeUrl para whatsapp, instagram y facebook: solo https del dominio correcto, y un número se convierte en wa.me. Si el valor no es válido, responder 400 con un mensaje claro. 3) Migrar los valores guardados con un script que los normalice. 4) Footer.jsx: rel="noopener noreferrer".

**175. [MEDIA] Términos y Privacidad muestran la fecha de hoy como 'Última actualización' y una nota de 'texto genérico'**  
`frontend/src/pages/public/Terms.jsx:64` · texto  
*Por qué:* new Date() hace que la fecha cambie sola cada mes (Terms:64, Privacy:56), y debajo se lee públicamente 'Este texto es una estructura genérica de referencia' (65 y 57). La sección 4 de Términos (20) solo habla de la suscripción para la verificación, sin contar los cuatro planes ni el cobro del Básico. También hay rayas largas en textos visibles (Terms 8, 20, 65; Privacy 16, 57). Es el texto por defecto mientras el admin no cargue el suyo, pero una fecha que cambia sola en un documento legal engaña.  
*Arreglo:* 1) Usar el updatedAt de la página estática si existe; si no, una fecha fija constante en el archivo. 2) Quitar la nota de 'texto genérico'. 3) Reescribir la sección 4 para los planes actuales (suscripción mensual de los planes de pago, Básico gratis o de pago según configuración), leyendo isFree de la configuración pública. 4) Cambiar las rayas largas por punto o dos puntos. 5) Mientras useStaticPage carga (isLoading), mostrar un esqueleto para que no se vea un momento el texto por defecto.

**176. [MEDIA] Botones lg con texto largo se parten en dos líneas dentro de 48px a 390px**  
`frontend/src/pages/public/Account.jsx:1483` · desborde_ui  
*Por qué:* Button size lg es h-12 px-6 text-title-lg (Button.jsx:15), sin min-h. En el último paso conviven 'Atrás' y 'Enviar código de verificación' (1472-1484); también 'Reintentar crear mi tienda' (1083) y 'Activar también con aplicación' (114). En unos 185px libres, el texto de 20px pasa a 2 líneas y se sale del alto fijo. Es un cálculo con las clases: falta confirmarlo en el navegador.  
*Arreglo:* 1) Button.jsx: cambiar lg a 'min-h-12 px-6 py-2 text-title-lg leading-tight' para que crezca en lugar de desbordar. 2) Account.jsx:1483: acortar a 'Enviar código'. 3) Revisar a 390px los pasos finales de cliente y tienda, 2FA y la pantalla de reintento.

**177. [MEDIA] Botones de texto y pestañas por debajo de 44px en el login y el registro**  
`frontend/src/pages/public/Account.jsx:1237` · desborde_ui  
*Por qué:* '¿Olvidaste tu contraseña?' (1237), 'Enviar código nuevamente' (1018, 1095, 1152), 'Usar el código de mi aplicación' (1023), 'No tengo acceso a mi app' (1009) y los '← Volver' (1029, 1099, 1123, 1155) no tienen alto mínimo (unos 16-20px). Las pestañas Iniciar sesión y Crear cuenta (1188, 1196) miden unos 40px. RegisterAppStep ya usa min-h-11, así que es un descuido. Lo mismo pasa en la mesa (stepper de unos 30px sin aria-label, TableOrder 401-421), el banner de la tienda (h-10, StoreHeaderBanner 269-288), las pestañas de Store (556-571) y Faq (125-140).  
*Arreglo:* 1) Account.jsx: agregar 'inline-flex min-h-11 items-center' a todos esos botones de texto y min-h-11 a las pestañas, con role="tablist", role="tab" y aria-selected. 2) TableOrder.jsx: stepper con min-h-11 min-w-11 y aria-label 'Quitar uno' y 'Agregar uno'. 3) StoreHeaderBanner: h-11 w-11. 4) Store.jsx y Faq.jsx: pestañas con min-h-11. 5) Revisar a 390px que nada desborde.

**178. [MEDIA] El login de socios muestra el subtítulo de clientes**  
`frontend/src/pages/public/Account.jsx:1216` · texto  
*Por qué:* El subtítulo (1212-1216) solo tiene ramas para admin y vendor; /socio/ingresar cae en 'Ingresa para comprar o gestionar tu tienda.'. El título sí tiene la rama de socio (1209). Se olvidó en el Bloque 299.  
*Arreglo:* Agregar la rama: mode === "partner" ? "Ingresa con tu cuenta de socio para ver el uso de tu API." : ... en Account.jsx:1212-1216.

**179. [MEDIA] Quien se registra como cliente ve un aviso pensado para tiendas debajo del teléfono**  
`frontend/src/pages/public/Account.jsx:1296` · texto  
*Por qué:* El paso 1 se comparte entre cliente y tienda, y siempre muestra 'Este es el número por el que los clientes te contactarán para comprar productos...'. En /cuenta (accountType customer), quien se registra es comprador.  
*Arreglo:* En Account.jsx:1295-1297, mostrar el texto solo si accountType === "vendor"; para el cliente, 'Lo usan las tiendas para coordinar tu pedido.'

**180. [MEDIA] Faltan atributos autocomplete en los formularios de ingreso y registro**  
`frontend/src/pages/public/Account.jsx:1221` · mejora  
*Por qué:* El correo y la contraseña del login (1221, 1232), Nombre, Apellidos y Correo del registro (1283-1286) y las contraseñas (1304-1311, 1166-1167) no pasan autoComplete, así que los gestores de contraseñas y el celular no ofrecen rellenar ni sugerir una contraseña. PhoneInput y OtpInput sí lo usan.  
*Arreglo:* Login: autoComplete="email" y "current-password". Registro: "given-name", "family-name", "email", "new-password" (en las dos contraseñas). Restablecer: "new-password". En los correos, agregar inputMode="email" y autoCapitalize="none". Comprobar que Input y PasswordInput pasen ...props al <input>.

**181. [MEDIA] La tarjeta de producto puede mostrar '--20%' porque el servidor no exige oldPrice > price**  
`frontend/src/components/ProductCard.jsx:97` · bug  
*Por qué:* discount = Math.round(100 - price/oldPrice*100) da negativo si oldPrice < price, y se pinta `-${discount}%` en rojo con un precio tachado más alto que el real (232). El esquema de productos (products.controller.js:49) solo pide positive(). pos.controller.js:507 sí revisa oldPrice > price, así que la regla se conoce.  
*Arreglo:* 1) products.controller.js: en crear y editar, agregar un .superRefine que rechace oldPrice <= price ('El precio anterior debe ser mayor que el actual'), o guardar null. 2) ProductCard.jsx:97 y 232: calcular y mostrar el descuento solo si Number(oldPrice) > Number(price). Aplicar lo mismo en Product.jsx y DigitalMenuProductCard. 3) VendorProducts.jsx: validación en el formulario. 4) Corregir los datos existentes con una consulta (UPDATE ... SET oldPrice = NULL WHERE oldPrice <= price), con autorización del dueño.

**182. [MEDIA] Los subtítulos de la portada prometen 'tiendas verificadas' y ofertas 'de tiendas', y no es así**  
`frontend/src/pages/public/Home.jsx:363` · texto  
*Por qué:* Destacados dice 'De tiendas verificadas...' (363), pero /search sin onlyVerified incluye tiendas sin verificar (search.controller.js:258); eso es intencional desde el Bloque 98. Ofertas dice 'De tiendas verificadas y de la casa' (354), pero desde el Bloque 297 solo salen ofertas del admin (offers.controller.js:88). El vacío de verificadas nombra fijo el plan BUSINESS (515), aunque la insignia la decide grantsBadge.  
*Arreglo:* 1) Home.jsx:363: 'Lo más buscado y mejor valorado cerca de ti' o 'en todo el país'. 2) Home.jsx:354: `Promociones de ${siteName}`. 3) Home.jsx:515: armar la lista con settings.plans.filter(p => p.grantsBadge && p.isPublic) y nombrarlos, o usar '¿Tienes un negocio? Verifica tu tienda y aparece aquí'.

**183. [BAJA] Raya larga (—) en textos visibles de varias páginas públicas**  
`frontend/src/pages/public/Account.jsx:1388` · texto  
*Por qué:* La regla 4 lo prohíbe. Aparece en Account.jsx 56, 1385 y 1388; en MarketplaceChatWidget 585, 595, 646, 659, 665 y 818; en Store.jsx 390, 466, 530, 621, 655, 698 y 806; en Product.jsx 216, 764 y 876; en TableOrder 32, 35 y 192; en los mensajes del servidor de la mesa (tables.controller.js 1241-1242, 1259); en Terms y Privacy; y en Contacto.jsx:26.  
*Arreglo:* Cambiar la raya por punto, coma o dos puntos en cada texto visible (las rayas de los comentarios del código pueden quedar). En Account.jsx:1385, ocultar la línea si falta el nombre en lugar de mostrar '—'. Al terminar, buscar '—' fuera de comentarios en pages/public, components y en los AppError de los controllers públicos.

**184. [BAJA] El error de un código anterior reaparece en el siguiente paso de código**  
`frontend/src/pages/public/Account.jsx:456` · bug  
*Por qué:* codeError se comparte entre 2FA, register-verify y forgot-code, y solo se limpia al escribir o al reenviar (836, 913). switchView, handleFinalSubmit y handleForgotEmail no lo limpian.  
*Arreglo:* Llamar a setCodeError("") en switchView, al pasar a register-verify en handleFinalSubmit, al pasar a forgot-code en handleForgotEmail y en la rama requiresPasswordSetup.

**185. [BAJA] El número de mesas no tiene tope técnico cuando el plan no tiene límite**  
`backend/src/controllers/vendors.controller.js:118` · config  
*Por qué:* tableCount es z.number().int().positive() sin max. Con maxTables null, createVendor crea Array.from({ length: tableCount }) mesas (276-277), y una llamada con 1000000 satura la base.  
*Arreglo:* Agregar .max(500) en createVendorSchema (118) y en el schema de actualización (625).

**186. [BAJA] La pastilla 'Cerrado ahora' aparece en tiendas sin horario cargado**  
`frontend/src/components/StoreHeaderBanner.jsx:229` · bug  
*Por qué:* isVendorOpenNow devuelve null si no hay horario. createTableOrder lo trata como 'sin horario' (tables.controller.js:1234-1237), pero el banner (229 y 198-201) lo muestra como cerrado.  
*Arreglo:* En StoreHeaderBanner, si v.isOpenNow == null, no mostrar la pastilla ni el punto de estado.

**187. [BAJA] Las tarjetas de tienda usan Vendor.category, que ya nadie llena**  
`frontend/src/components/StoreCard.jsx:130` · conexion  
*Por qué:* Vendor.categoryId no se escribe en ningún controller desde que se unificaron las categorías; el rubro real es businessCategory. Por eso las tarjetas dicen siempre 'Tienda' o 'Restaurante'.  
*Arreglo:* StoreCard.jsx:130 y CompactStoreCard.jsx:230: usar vendor.businessCategory?.name. StoreHeaderBanner.jsx:231: quitar la pastilla de v.category o pasarla a businessCategory. Quitar `category: true` de los includes de vendors.controller.js.

**188. [BAJA] CompactStoreCard y la ficha muestran 0.0 estrellas sin reseñas, y '1 reseñas'**  
`frontend/src/components/CompactStoreCard.jsx:222` · bug  
*Por qué:* StoreCard y el banner ya lo resolvieron; CompactStoreCard y Product.jsx:554-555 no.  
*Arreglo:* Si reviewCount es 0, mostrar 'Sin reseñas todavía'; pluralizar 'reseña' o 'reseñas'.

**189. [BAJA] La pantalla de agradecimiento de la mesa trata de usted al cliente**  
`frontend/src/pages/public/TableOrder.jsx:191` · texto  
*Por qué:* 'Ha sido un placer atenderle' y 'esperamos verlo pronto', mientras el resto de la pantalla tutea (regla 4).  
*Arreglo:* 'Fue un placer atenderte.' y `Gracias por visitar ${vendorName}. Esperamos verte pronto.`

**190. [BAJA] Al personal de tienda, /planes le ofrece 'Crear mi tienda gratis'**  
`frontend/src/pages/public/Plans.jsx:14` · permisos_plan  
*Por qué:* isVendor solo mira VENDOR; VENDOR_STAFF cae en la rama de visitante y se le invita a registrar otra tienda.  
*Arreglo:* Para VENDOR_STAFF, mostrar 'El plan lo cambia el dueño de la tienda' en lugar del botón, y pedir /vendors/me (ya soporta personal) para marcar 'Tu plan'.

**191. [BAJA] /planes tiene fijos 'Baznova' y 'Premium' y no tiene SEO propio**  
`frontend/src/pages/public/Plans.jsx:18` · texto  
*Por qué:* document.title con 'Baznova' (18), 'probar Premium' (47) y en PlansCatalog.jsx 57 y 266. /planes no está en seoRoutes.js. Rompe la regla 3 si el admin renombra el plan o el sitio.  
*Arreglo:* Usar siteName y planNames del plan de prueba (de la configuración pública). Agregar '/planes' a staticSeoFor y quitar el document.title manual.

**192. [BAJA] Formulario de contacto sin tope de largo y textarea sin label asociado**  
`frontend/src/pages/public/Contacto.jsx:95` · mejora  
*Por qué:* 'Mensaje' es un <span> y el textarea no tiene nombre accesible. contact.controller.js:6-10 no pone .max() a name ni a message.  
*Arreglo:* Usar <label htmlFor> con id y maxLength=2000. En el zod: message .max(2000), name .max(100). Cambiar el toast a 'Mensaje enviado. Te respondemos pronto.'

**193. [BAJA] Las tarjetas de favoritos cuentan productos ocultos y muestran tiendas bloqueadas**  
`backend/src/controllers/favorites.controller.js:24` · conexion  
*Por qué:* _count solo filtra isActive, sin hiddenFromStore ni overQuota, y no filtra el estado de la tienda, a diferencia de listVendors (492).  
*Arreglo:* Usar el mismo where de _count que listVendors y marcar como 'No disponible' (o quitar) los favoritos de tiendas no públicas.

**194. [BAJA] El chat de la portada pide /business-categories sin zona ni inUse, con otra clave de caché**  
`frontend/src/components/MarketplaceChatWidget.jsx:459` · conexion  
*Por qué:* El comentario (452) dice que usa la misma queryKey que Home, pero Home usa ["business-categories", zoneKey] con inUse. El chat hace una petición extra y puede proponer rubros sin tiendas en la zona.  
*Arreglo:* Usar useZone y la misma queryKey y params que Home.jsx:208.

**195. [BAJA] GET /settings envía a cualquier visitante la configuración completa de todos los planes, también los ocultos**  
`backend/src/controllers/settings.controller.js:86` · config  
*Por qué:* Envía todos los planes sin filtrar isPublic ni pasar por publicPlan() (planConfig.js:101), sin publicCache, y en cada llamada ejecuta isChatbotHealthy().  
*Arreglo:* Para visitantes, enviar plans.filter(isPublic).map(publicPlan) y dejar la configuración completa en un endpoint del admin (revisar que el panel del vendedor reciba lo que necesita). Agregar publicCache de unos 30 s y staleTime a las queries ['site-settings'].

**196. [BAJA] El indicador de foco de los campos es débil y el error no está ligado al campo**  
`frontend/src/components/ui/Input.jsx:22` · desborde_ui  
*Por qué:* outline-none y solo cambia el borde de 1px; el :focus-visible global (#fe9800) tiene unos 2,1:1 sobre blanco. El error no usa aria-describedby ni aria-invalid, y el aria-label de PhoneInput tapa la etiqueta visible.  
*Arreglo:* Input y PasswordInput: agregar focus:ring-2 focus:ring-primary-container/40. Usar un color de foco global con 3:1 o más. Agregar aria-invalid y aria-describedby al error. En PhoneInput, cambiar aria-label por aria-labelledby a la etiqueta visible.

**197. [BAJA] La copia duplicada de la fila de categorías deja enlaces repetidos para el teclado y el lector de pantalla**  
`frontend/src/pages/public/Home.jsx:116` · mejora  
*Por qué:* Duplicar la lista es intencional para el bucle, pero la segunda mitad no está oculta a la tecnología de asistencia.  
*Arreglo:* Envolver la segunda copia en un contenedor con aria-hidden="true" e inert.

**198. [BAJA] Una oferta de admin de tipo PRODUCT sigue en la portada aunque el producto o la tienda no estén visibles**  
`backend/src/controllers/offers.controller.js:88` · bug  
*Por qué:* listActiveOffers no revisa product.isActive, hiddenFromStore u overQuota ni el estado de la tienda; el enlace termina en 404.  
*Arreglo:* Agregar al where: OR [{ contentType: { not: 'PRODUCT' } }, { product: { isActive: true, hiddenFromStore: false, overQuota: false, vendor: { status: 'ACTIVE', isBlocked: false } } }].

**199. [BAJA] Fuga de memoria con URL.createObjectURL en la vista previa de las fotos de reseña**  
`frontend/src/pages/public/Store.jsx:761` · mejora  
*Por qué:* Se crea una URL nueva en cada render (Store 761, Product 823) y nunca se libera.  
*Arreglo:* Guardar las URLs en el estado al elegir el archivo y llamar a revokeObjectURL al quitar la foto o al desmontar.

### Está así a propósito (no se toca)

- **El login dice si el correo no existe o si el rol no coincide (enumeración de cuentas)**: Los Bloques 88 y 279 lo decidieron con el riesgo aceptado por el dueño. Lo único desfasado es el comentario de Account.jsx:316-320 y 548-550, que dice que nunca se revela el rol. Hay que actualizar ese comentario. Opcional, si el dueño lo pide: mensaje genérico solo en el contexto admin.
- **/cuenta acepta cualquier rol, también ADMIN**: El comentario de Account.jsx:495 lo da como comportamiento de siempre. La puerta /admin/ingresar es de apariencia; cambiarlo depende del dueño (rechazar ADMIN en el servidor cuando context es null).
- **El botón 'Contactar' por WhatsApp de la tienda ignora el interruptor de WhatsApp de sus redes**: v.whatsapp es el contacto principal obligatorio del registro, y el interruptor de socialLinks controla el ícono de la red social. Hay que confirmarlo con el dueño antes de cambiarlo; si se mantiene, aclarar en el panel que el interruptor solo afecta el ícono.
- **El pie solo admite WhatsApp, Facebook e Instagram de la plataforma**: Según usePlatformSettings.js:60-65 se reutilizaron los 3 enlaces que ya tenían los correos. La lista de seis redes que fijó el dueño es para las tiendas, no para la plataforma.
- **Enlaces externos con rel="noreferrer" sin "noopener"**: En los navegadores actuales noreferrer ya implica noopener, así que no hay un hueco real; solo hay inconsistencia. Queda como mejora de unificación.
- **Las tiendas con el cobro atrasado siguen visibles en Destacados**: La regla del dueño (planBilling.service.js:14) dice que la tienda impaga sigue visible pero no recibe pedidos. Mostrarla es intencional; lo que falta es avisarlo antes del checkout (ver mejoras).
- **El aviso de 'número no válido' no bloquea el avance del registro**: Probablemente es a propósito, para no trabar números atípicos de Cuba, aunque no hay comentario. Conviene preguntarle al dueño si quiere una confirmación en lugar de un bloqueo.
- **El ojo de la contraseña tiene tabIndex={-1}**: Busca que el Tab vaya directo del campo al botón Entrar. Es una decisión de usabilidad defendible; se puede revisar como mejora de accesibilidad.
- **Corte a 60 productos y 200 candidatos en la tienda**: El corte es intencional por rendimiento del ranking (2026-10-24). Lo que se reporta como error es que no haya forma de ver el resto y que el banner cuente mal.

### Mejoras propuestas

- Fuente única de textos de plan: un hook usePlanCopy() que lea de la configuración pública el plan REGULAR (displayName, isFree, precio), los planes con grantsBadge y el plan de prueba, usado por Home, Account, Footer, Plans, Terms y el vacío de 'Tiendas verificadas', para que nada diga 'gratis' o 'Premium' fijo (regla 3).
- Calcular en el servidor acceptsOrders (cobro atrasado o plan sin pedidos) en search, listVendors, getVendorBySlug y getTableByToken, para que ProductCard y la tienda cambien el carrito por 'No recibe pedidos ahora' antes del checkout, y bajar esos productos en el ranking de la portada.
- Helper compartido panelForRole(role) para el Header, Account y cualquier redirección por rol (ADMIN, VENDOR, VENDOR_STAFF, PARTNER, CUSTOMER).
- Pasar las respuestas públicas de Vendor y Review a select explícitos (listas de lo que sí se envía) en lugar de listas de exclusión, con un test que avise si aparece un campo nuevo sin clasificar.
- Mostrar el horario semanal de la tienda (getVendorBySlug ya envía schedules) con el día de hoy resaltado, junto a Formas de pago o desplegable en el banner.
- Componente ErrorState común con 'Reintentar' para todas las páginas públicas (Home, Shop, Store, Faq, TableOrder).
- Shop.jsx: guardar el orden (sort) en la URL igual que Stores.jsx, para que se conserve al compartir y al volver atrás.
- Componente ExternalLink que aplique target=_blank y rel="noopener noreferrer" en todos los enlaces externos (Footer, PlansCatalog, TargetedOfferPopup, StoreHeaderBanner, QuickSaleDetail, VendorOrders, VendorLayout).
- Accesibilidad: aria-expanded en el acordeón de la FAQ; aria-label en las estrellas de calificación, en 'Quitar foto' y en los puntos de la galería de Product.jsx; casilla 'Soy un restaurante' de h-5 w-5 con la fila de min-h-11.
- Textos: 'Te damos la bienvenida' en lugar de '¡Bienvenido de vuelta!' o 'Bienvenido de nuevo', y '← Volver a iniciar sesión' en lugar de '← Volver al login'.
- En escritorio, la columna de Account usa justify-center y la tarjeta salta al cambiar de paso; usar justify-start con padding superior fijo en lg.
- Si el dueño lo quiere, agregar TikTok, YouTube y Telegram a las redes de la plataforma en el pie, con el mismo normalizador e interruptor de las tiendas.
- Comprobar en el navegador a 390px los dos desbordes calculados con las clases (OfferCard con cupón y botón, y los botones lg del registro) y el ancho del SearchBar en el Header, que no se revisó en detalle.

<details><summary>Notas del subagente: Inicio de sesión y registro</summary>

VendorOnboarding.jsx ya no existe: /vender redirige a /vendedor/ingresar?tab=registro (App.jsx:157 y 241). El registro de tienda vive entero en Account.jsx mode="vendor". POST /vendors exige requireRole("CUSTOMER") en el servidor, bien. El límite de mesas al registrar se aplica en el servidor (assertTableCountWithinPlan("REGULAR")), así que la regla 1 se cumple en ese punto. assertRoleMatchesContext corta en el servidor antes de mandar el código, cuando el rol no corresponde a /admin, /vendedor o /socio. A 390px, OtpInput (6 casillas de unos 45px) y la grilla Nombre/Apellidos (unos 144px cada campo) caben sin desborde. Lo que sí desborda es el texto de los botones lg. La enumeración de correos en login y forgot-password es intencional (Bloque 88 y 279). No ejecuté la app; todo sale de la lectura del código.

</details>

<details><summary>Notas del subagente: Página principal</summary>

Revisión de solo lectura: no edité ni ejecuté nada. Endpoints que usa la portada: GET /business-categories?inUse=true&zona, /offers/active (solo ofertas del admin desde el Bloque 297), /search?seed (destacados con ranking y rotación), /vendors?isVerified=true, /customer-listings?limit=8 y /settings (imágenes del hero, siteName, planes, showChatWidget y chatbotAvailable). El frontend no llama ningún endpoint "seo-home" ni "/hero": las imágenes del hero salen de settings.heroImages, y "featured" es /search sin texto. Todos los endpoints y campos que usa Home existen en el backend. Lo que comprobé que está bien: el HTML de las ofertas de admin pasa por DOMPurify al guardarse (adminOffers.controller.js:98); track-click tiene deduplicación por IP y trust proxy en producción (el comentario de products.controller.js:629 está desactualizado); las alturas reservadas del hero coinciden con las del slider (268px en móvil, 388px en lg); los botones del hero a 390px no desbordan (el primero ocupa todo el ancho y los otros dos se reparten el resto). Pendiente de confirmar en el navegador a 390px: el recorte de OfferCard con cupón y botón (calculado a partir de las clases) y el ancho del SearchBar dentro de la barra del Header, que no revisé en detalle.

</details>

<details><summary>Notas del subagente: Tiendas</summary>

Revisión de solo lectura. No se ejecutó nada ni se tocaron archivos.

Lo que está bien:
- Las tiendas bloqueadas, suspendidas (por inactividad, moderación o impago) y en eliminación pendiente quedan ocultas en getVendorBySlug, listVendors, getProductBySlug, favoritos (al agregar), reseñas y QR, porque todas filtran isBlocked y status ACTIVE. La eliminación pendiente pone isBlocked:true y el impago pone status SUSPENDED.
- isPrivate se omite a propósito en getVendorBySlug, para que la tienda privada siga abriendo por enlace.
- Las redes sociales se filtran en el servidor: solo salen las encendidas, normalizadas a https de su dominio.
- El chat con IA respeta el plan (aiAvailable).
- El horario se aplica en el servidor para los pedidos de mesa.

Hallazgos más importantes:
1. overQuota no se filtra en el menú QR. Rompe la regla 1.
2. Fuga de datos: quién reportó cada reseña, y campos internos de fraude y cobro de la tienda.
3. Ofertas de tienda y fotos de reseña sin control del plan actual en la vista pública.
4. TableOrder depende de /vendors/:slug, que devuelve la forma reducida justo para restaurantes con menú solo por QR, y muestra todo en CUP.

Antes de cambiar el botón Contactar conviene preguntarle al dueño; puede ser intencional.

</details>

<details><summary>Notas del subagente: Footer y enlaces externos</summary>

Todos los enlaces internos del pie y de Ayuda apuntan a rutas que existen en App.jsx: /catalogo, /tiendas (con ?isRestaurant=true, que Stores.jsx sí lee), /ventas-rapidas, /rastrear-pedido, /vendedor/ingresar?tab=registro (Account.jsx lo lee), /planes, /api-socios, /faq (con ?tab=vendor|customer), /ayuda, /contacto, /terminos, /privacidad y /cuenta. Los botones del pie miden 44px en celular, y el pie a 390px usa dos columnas de unos 167px que caben sin desbordar. El contraste de white/55-70 sobre #0e1a28 pasa AA. El HTML de las páginas estáticas y las respuestas de la FAQ se sanitizan en el servidor (staticPages.controller, sanitizeFaqHtml). TargetedOfferPopup y OffersSlider solo abren externos los enlaces http/https. No ejecuté nada, solo leí el código.

</details>


## Correos electrónicos

Revisé el código citado de todos los hallazgos de severidad alta y media. Todos se confirman salvo uno que trato como decisión pendiente (la ayuda para cancelar depende del plan). El problema de fondo está en emailShell (_shared.js 354-455): no escapa `title` ni `storeName`, y el escape queda repartido entre las plantillas. Por eso el asunto libre que escribe la tienda (vendorMessage), los asuntos de los avisos al admin con nombres de tiendas o personas, el re-enganche y los recordatorios meten HTML de terceros en correos que salen con la marca de la plataforma. Si se escapa en el shell (y se quita el esc() de las plantillas que ya lo hacen, para no escapar dos veces) se arregla casi todo de una vez. Los otros dos problemas graves son estos: el re-enganche (vendorLifecycle.job.js) no respeta la baja de correos de promoción ni trae enlace para darse de baja, y los nombres de plan están fijos ("Plan Business", "Plan Regular", "Plan Premium") en verificationNotify, lib/email.js y orders.controller.js, cuando el admin puede renombrarlos (regla 3). También hay fallos de calidad: el texto plano pega etiqueta e importe ("Total12.000 CUP"), orderCancelledVendor y orderCancelHelp muestran CUP fijo, el pie por defecto habla de WhatsApp y del pedido en correos que no tienen pedido, el cuadre de caja diario sale a las 8:30 y casi siempre informa 0, y el sello verde y el subtítulo de la cabecera de color no llegan a AA. Lo que funciona bien, según los subagentes: todos los enlaces de los CTA llevan a rutas que existen, los códigos no van en el asunto, el código de cambio de correo va a la dirección nueva y la vieja recibe un aviso, el preheader se escapa, los íconos de redes y de los pasos son PNG, el CTA naranja cumple AA (unos 4,6:1) y a 390px caben el código de 6 dígitos y la línea de 4 pasos. Los contrastes los calculé a mano con la fórmula WCAG (por ejemplo, #0CAE53 sobre blanco da 2,92:1 y #9aa3ad sobre #0CAE53 da 1,14:1); no los medí con una herramienta.

### Errores confirmados (18)

**200. [ALTA] emailShell no escapa `title` ni `storeName`: asuntos y nombres de tienda escritos por terceros entran como HTML en correos con la marca de la plataforma**  
`backend/src/templates/_shared.js:393` · seguridad  
*Por qué:* emailShell inserta `title` tal cual en `<mj-title>${title}</mj-title>` (393) y en el h1 (414), y `storeName` en brandRowHtml (name y alt, 262-276, vía 367) y en el pie `Enviado por <strong>${storeName}</strong>` (440). El comentario de esc() (123-125) dice que el escape va en cada dato de usuario, pero varias llamadas no lo aplican: vendorMessage.js:13 `title: subject` (asunto libre de la tienda hacia su cliente, y manualEmailSchema en orders.controller.js:949-951 solo pide `z.string().min(2)`); adminDirectEmail.js:16 `title: subject`, que usan notifyAdminActionNeeded con `Tienda aceptó la prueba gratis: ${vendor.companyName}` (vendors.controller.js:1108), `Prueba gratis activada: ${vendor.companyName}` (trialEligibility.service.js:157), vendorDeletion.job.js:29/46 y `Nueva solicitud de ...: ${created.name}` (locationSuggestions.service.js:169), además de adminActionCode.js:97 con el fullName de la persona; vendorWinback.js:24-25 (title y storeName con companyName); customerReminders.js:34/65 y documentEmail.js:14/31 (storeName). companyName solo se valida con `z.string().min(2)` (vendors.controller.js:96 y 589). adminNotify.js:22-25 escapa el mensaje a propósito, pero se olvidó del asunto. Así, una tienda puede meter enlaces o imágenes propias en un correo enviado con el remitente y la cabecera de Baznova, que sirve para phishing.  
*Arreglo:* 1) En _shared.js emailShell: calcula `const showStore = storeName && storeName !== siteName` con los valores sin escapar, y después `const safeTitle = esc(title)`, `const safeStore = esc(storeName)` y `const safeSite = esc(siteName)`. Usa safeTitle en mj-title y en el h1, safeStore en brandRowHtml (name e imgAlt) y en el pie. 2) Quita el esc() que hoy se aplica a mano a title/storeName, para no escapar dos veces: orderConfirmation.js:19-20, tableOrderStatus.js:16-17, loyaltyPoints.js:27, orderCancelHelp.js:31, orderDelay.js:72, orderFollowUp.js:109 y 132, statusUpdate.js:25 y vendorMessage.js:14. 3) En orders.controller.js manualEmailSchema y en admin.controller.js sendEmailSchema, añade `.trim().max(150)` al subject y `.max(5000)` al message. 4) Prueba local: genera vendorMessage, adminDirectEmail (aviso de prueba gratis), vendorWinback, cartReminder e invoiceEmail con companyName `<a href="https://x">"Tienda" & Co</a>` y comprueba que en el HTML sale como texto (&lt;a ...) y que "Hermanos Pérez & Hijos" no sale como &amp;amp;.

**201. [ALTA] El correo de re-enganche al cliente ignora la baja de correos de promoción y no trae enlace para darse de baja**  
`backend/src/jobs/vendorLifecycle.job.js:134` · bug  
*Por qué:* sendWinbackEmails solo filtra `customer.isSuspended || customer.deletedAt` y llama a sendVendorWinbackEmail. No mira User.marketingEmails ni lastMarketingEmailAt (schema.prisma:946-949, "se apagan desde el perfil o desde el enlace del correo"). Además, vendorWinback.js no pasa footerNote con enlace de baja y lleva `showSocial: true` (es de promoción). El job nuevo customerReminders.job.js sí respeta `marketingEmails: true`, el intervalo de 3 días y el unsubscribeUrl. El winback (Bloque 62) es anterior a esa regla y no se actualizó. Un cliente que se dio de baja sigue recibiendo publicidad, lo que va contra lo que se le prometió y perjudica la entregabilidad.  
*Arreglo:* 1) En vendorLifecycle.job.js, al buscar el customer, selecciona marketingEmails y lastMarketingEmailAt, y salta si `!customer.marketingEmails` o si no pasaron 3 días desde lastMarketingEmailAt (reutiliza o exporta el helper canSend/markSent de customerReminders.job.js). Al enviar, actualiza lastMarketingEmailAt. 2) Pasa `unsubscribeUrl: unsubscribeUrl(customer.id)` (lib/marketingEmail.js) a sendVendorWinbackEmail y de ahí a la plantilla. 3) En vendorWinback.js, exporta y reutiliza unsubscribeFooter de customerReminders.js (o muévelo a _shared.js) y pásalo como footerNote. 4) Prueba: con un cliente con marketingEmails=false no sale nada; con true sale y el pie trae el enlace de baja, que funciona.

**202. [MEDIA] Datos de terceros sin escapar dentro del cuerpo de varios correos**  
`backend/src/templates/vendorWinback.js:29` · seguridad  
*Por qué:* Esto es aparte del title/storeName del shell: vendorWinback.js:13-14 mete offer.title sin escapar (también en `alt="..."`) y en la 29 `Hola ${customer.fullName}` y `<strong>${vendor.companyName}</strong>`. Va al cliente y el contenido lo escribe la tienda. adminActionCode.js:97-99 mete `target` (con person.fullName) en el message sin escapar, y adminDirectEmail.js:19 mete recipientName sin escapar (en sendAdminEmail es user.fullName o companyName). accountDeletion.js:16 `Hola ${fullName}` es la única plantilla de cuenta sin esc. fraudReport{EvidenceRequested,Dismissed,Suspended}.js meten `<strong>${targetLabel}</strong>` (nombre de producto o anuncio), cuando moderation.js sí escapa. verificationUpdate.js:43-44 mete vendorName y message (con las notas del admin), y vendorInactivityReminder.js:18, vendorSuspended.js:17 y vendorReactivated.js:17-18 meten companyName y reason. Las plantillas más nuevas sí siguen la regla de esc(), y estas se quedaron atrás.  
*Arreglo:* 1) vendorWinback.js: importa esc y escapa offer.title (texto y alt), offer.discountLabel, customer.fullName y vendor.companyName. Usa 'Hola,' si no hay nombre. 2) adminDirectEmail.js:19: `para ${esc(recipientName)}`. 3) adminActionCode.js: escapa `target` antes de meterlo en el message (o añade a adminDirectEmail un parámetro `code` que pinte codeBlock(code) y escape el resto del message). 4) accountDeletion.js:16: `Hola ${esc(fullName)}`. 5) Los 3 fraudReport*.js: `esc(targetLabel)`. 6) verificationUpdate.js:43: `esc(vendorName)`, y en verificationNotify.service.js escapa `notes` al armar cada body. 7) vendorInactivityReminder/vendorSuspended/vendorReactivated: esc(companyName) y esc(reason). 8) Genera cada plantilla con un nombre `<b>x</b>` y comprueba que sale como texto.

**203. [MEDIA] El nombre del remitente va sin comillas: un nombre de tienda con coma, comillas o < > puede hacer fallar el envío**  
`backend/src/lib/email.js:94` · conexion  
*Por qué:* `displayName = fromName ? `${fromName} vía ${siteName}` : siteName` y `from: `${displayName} <${fromAddress}>``. fromName es companyName (texto libre) en confirmación, estado, envío manual, puntos y re-enganche. Según RFC 5322, un display-name con coma o comillas tiene que ir entre comillas. Si no, el campo se lee como dos direcciones y el proveedor puede rechazarlo. Como los envíos son best-effort, el fallo solo queda en EmailLog/Errores y la tienda no se entera. No pude probar contra Resend (sin red), así que el rechazo es plausible, no comprobado.  
*Arreglo:* En email.js sendViaResend: `const safeName = displayName.replace(/[\r\n<>]/g, "").replace(/["\\]/g, "\\$&");` y `from: `"${safeName}" <${fromAddress}>``. Prueba local con companyName 'Hermanos Pérez, S.R.L.' y 'La "Bodega"' contra el sandbox de Resend (solo llega al correo del desarrollador).

**204. [MEDIA] En el texto plano, la etiqueta y el importe de los totales salen pegados ("Total12.000 CUP")**  
`backend/src/templates/_shared.js:234` · bug  
*Por qué:* totalRow genera `<td ...>${label}</td><td ...>${amount}</td>` sin espacio entre las celdas. htmlToText (email.js:58-81) solo convierte </p|div|tr|h|li|table> en salto de línea y después borra las etiquetas sin dejar separador. El resultado es 'Envío0 CUP' o 'Total a cobrar1.500 USD' en todos los correos de pedido. El texto plano se añadió a propósito para la entregabilidad (comentario en email.js:56-57); este pegado es un efecto que no se buscó.  
*Arreglo:* En email.js htmlToText, añade antes de `.replace(/<[^>]+>/g, "")` un `.replace(/<\/td>/gi, " ")` (y opcionalmente `</th>`). Así el colapso de espacios que ya existe deja 'Total 12.000 CUP'. Comprueba el texto de orderConfirmation y newOrderVendor.

**205. [MEDIA] Pedido cancelado (a la tienda) y ayuda para cancelar muestran CUP aunque el pedido sea en otra moneda**  
`backend/src/templates/orderCancelledVendor.js:11` · bug  
*Por qué:* orderCancelledVendor mapea los items sin `currency` (línea 11), así que itemsTable cae en fmtCUP, y el total es `fmtCUP(order.total)` (22). orderCancelHelp.js:41 también usa `fmtCUP(order.total)` aunque sus items llevan la moneda, así que en el mismo correo sale 'USD' en las filas y 'CUP' en el total. OrderItem.currency existe y lib/orderSummary.js ya tiene orderCurrency/money/orderGrandTotal, que usan newOrderVendor y orderOverdueVendor. Estas dos plantillas se quedaron sin migrar a multimoneda. Además, itemsTable (_shared.js:225) imprime el código de la moneda ('USD') y no el nombre corto del admin, que es lo que muestran los totales (orderSummary.js:14).  
*Arreglo:* 1) orderCancelledVendor.js: añade `currency: i.currency` al map e importa orderCurrency/money (o orderGrandTotal si debe incluir el envío) para el total. 2) orderCancelHelp.js:41: cambia fmtCUP por `money(order.total, orderCurrency(order))` u orderGrandTotal(order). 3) _shared.js itemsTable: usa currencyLabel(i.currency) de lib/catalog.js en vez de esc(i.currency). 4) Genera los correos con un pedido en USD y comprueba que filas y total coinciden.

**206. [MEDIA] La nota del pie por defecto le dice a todos que contesten a la tienda por WhatsApp desde su pedido**  
`backend/src/templates/_shared.js:441` · texto  
*Por qué:* `footerNote ?? "Este es un correo automático: si tienes dudas, responde directo a la tienda por WhatsApp desde tu pedido."`. La mayoría de las plantillas no pasan footerNote: las de código (2FA, reset, registro, cambio de correo), accountDeletion, las que van a la propia tienda (newOrderVendor, orderOverdueVendor, orderCancelledVendor, orderDelayVendor, orderFollowUpVendor), verificación y cobro, moderación, socios de la API, personal (cuadre, invitación), soporte, reviewReply y adminDirectEmail. El texto se escribió cuando casi todos los correos eran de pedidos para el cliente.  
*Arreglo:* 1) Cambia el texto por defecto a uno neutro: 'Este es un correo automático de {siteName}. Si tienes dudas, escríbenos desde la página de contacto.' 2) Crea en _shared.js `export const ORDER_FOOTER = "Si tienes dudas sobre tu pedido, escríbele a la tienda por WhatsApp desde tu pedido."` y pásalo como footerNote solo en las plantillas de pedido al cliente (orderConfirmation, statusUpdate, tableOrderStatus, orderCancelHelp, orderDelay cliente, orderFollowUp cliente y reactivado, vendorMessage, documentEmail). 3) Revisa una muestra de cada grupo.

**207. [MEDIA] Nombres de plan fijos ('Plan Business', 'Plan Regular', 'Plan Premium', 'badge') en vez del nombre que configura el admin**  
`backend/src/services/verificationNotify.service.js:17` · permisos_plan  
*Por qué:* verificationNotify.service.js usa 'Plan Business' (17, 35, 56, 62), 'Plan Regular' (64, 90, 98, 103) y 'Plan Premium' (72-111). lib/email.js:360 dice 'Plan Business vence...' y :395 'vuelve al Plan Regular'. verificationUpdate.js META:12-13, 23-25 dice 'Plan Premium'. orders.controller.js:961 y 969 tienen 'es del Plan Premium' y 'Verificate para pasar a Premium' (además con voseo y 'emails'). En un mismo correo de BUSINESS_REVOKED el título dice 'Plan Business revocado' y el sello 'Plan Premium retirado'. El admin puede renombrar los planes (PlanConfig.displayName) y planBilling.service.js ya usa config.displayName. Esto rompe la regla 3 (lo configurado en el admin se ve igual en todos lados). Hay unas 38 apariciones en controllers, lib y services.  
*Arreglo:* 1) En verificationNotify.service.js, cambia los body/title a funciones async que reciban el plan, o resuelve antes `const paid = await getPlanConfig(vendor.planType)` y `const free = await getPlanConfig("REGULAR")`, y arma los textos con `paid.displayName` y `free.displayName`. Cambia 'badge' por 'insignia' y 'Link' por 'Enlace'. 2) lib/email.js:360 y :395: lo mismo con getPlanConfig. 3) verificationUpdate.js META: etiquetas sin el nombre del plan ('Plan activado', 'Plan retirado', 'Prueba gratis activada', 'Tu prueba gratis termina pronto', 'Tu prueba gratis terminó'). 4) orders.controller.js:961 y 969: 'Enviar correos a tus clientes no está incluido en tu plan. Cambia de plan desde Suscripción.' y 'Llegaste al límite de N correos manuales de tu plan este mes. Cambia de plan para enviar más.' 5) Busca con `grep -rn "Plan Premium\|Plan Business\|Plan Regular" backend/src` y aplica el mismo criterio a los textos visibles que queden. 6) Prueba: renombra un plan en AdminSubscriptions y comprueba que el correo, el aviso del panel y /planes dicen lo mismo.

**208. [MEDIA] El cuadre de caja diario (y el semanal en lunes o el mensual en día 1) informa casi siempre 0 vendido**  
`backend/src/jobs/cashCloseReminder.job.js:63` · bug  
*Por qué:* El cron sale a las 8:30 hora de Cuba (línea 96) y usa `periodBounds(frequency, today)`, que para DAILY va desde hoy a las 00:00 (vendorStaffSales.controller.js:53-59). El correo dice 'Vendiste en este período' con lo vendido entre las 00:00 y las 8:30, así que casi siempre 0. Con WEEKLY configurado el lunes y con MONTHLY el día 1, el período acaba de empezar y pasa lo mismo. periodBounds además usa la hora local del servidor (getDate() en UTC) y no America/Havana, así que con el servidor en UTC el 'día' empieza a las 19:00 o 20:00 de Cuba del día anterior. El comentario de la plantilla pide 'un solo número claro (cuánto vendió en el período)', y una cifra a medias no lo cumple.  
*Arreglo:* Elige con el dueño una de dos opciones: (a) mover el cron a última hora (por ejemplo, '0 20 * * *'), o (b) informar el período que acaba de cerrar (DAILY: ayer; WEEKLY en el día configurado: los 7 días anteriores; MONTHLY: el mes anterior) y decirlo en el texto ('Lo que vendiste ayer'). En los dos casos, calcula los límites en America/Havana (por ejemplo, con Intl.DateTimeFormat y timeZone 'America/Havana', o restando el offset) en periodBounds o en un helper del job. Prueba runCashCloseReminderJob con ventas sembradas a distintas horas.

**209. [MEDIA] verificationUpdate: todos los avisos de cobro del plan (incluida la suspensión) llevan el mismo asunto y el mismo sello, y 6 eventos caen en 'Actualización'**  
`backend/src/templates/verificationUpdate.js:32` · texto  
*Por qué:* `subject = `${meta.label}: ${vendorName}`` y PLAN_BILLING_NOTICE tiene una sola entrada ámbar ('Pago de tu plan'). planBilling.service.js:71-77 manda 5 pasos muy distintos (start, before, due, after, suspended) y todos llegan como 'Pago de tu plan: Tienda X', así que en la bandeja no se distingue un aviso de una suspensión. El CTA dice 'Ver en mi panel' aunque el texto pide pagar. Además, VERIFICATION_APPROVAL_EXPIRED, VERIFICATION_STRIPE_PAID, VERIFICATION_PAYMENT_METHOD_RESET, SUBSCRIPTION_RENEWAL_CONFIRMED y VENDOR_CHANGE_REQUEST_APPROVED/REJECTED (verificationNotify.service.js:28-120) no tienen entrada en META y salen como 'Actualización' en verde azulado, incluidos los rechazos.  
*Arreglo:* 1) verificationUpdateEmail: acepta parámetros opcionales `subject`, `badge` y `ctaLabel`. Cuando vienen, tienen prioridad sobre META. 2) sendPlanBillingEmail (email.js:370): pasa el stage, usa `title` como asunto (`${title}: ${vendorName}`), sello rojo #ba1a1a para 'after' y 'suspended' y ámbar para el resto, y ctaLabel 'Pagar mi plan'. 3) Añade a META las 6 entradas que faltan (rojo para APPROVAL_EXPIRED y CHANGE_REQUEST_REJECTED, verde oscuro para STRIPE_PAID, RENEWAL_CONFIRMED y CHANGE_REQUEST_APPROVED, ámbar para PAYMENT_METHOD_RESET) y cambia 'Link de pago' por 'Enlace de pago'.

**210. [MEDIA] La pastilla de estado con texto verde #0CAE53 no llega a AA y el fondo con hex de 8 dígitos falla en Outlook**  
`backend/src/templates/_shared.js:178` · desborde_ui  
*Por qué:* statusBadge pinta el texto en `color:${color}` a 13px sobre `${color}1f`. #0CAE53 sobre blanco da unos 2,92:1 (calculado con la fórmula WCAG) y #0A8F42 unos 4,2:1, los dos por debajo de 4,5:1. Se usa en Pedido recibido, Seguridad, 2FA, Nueva cuenta, Reactivada, Verificada, Prueba activada, Documentos aprobados, 'Resuelto', 'Aprobada' y el descuento del re-enganche. El hex con alfa (#0CAE531f) no lo entienden Outlook de escritorio ni varios clientes, que dejan la pastilla sin fondo. El comentario dice que copia Badge.jsx (fondo al 12%), que es una decisión visual, pero ese verde como texto incumple la regla 4.  
*Arreglo:* En _shared.js, añade un mapa `BADGE_TONES = { "#0CAE53": { fg: "#087A38", bg: "#E3F5EA" }, "#0A8F42": { fg: "#087A38", bg: "#E3F5EA" }, "#8A5100": { fg: "#8A5100", bg: "#F6EDE0" }, "#ba1a1a": { fg: "#ba1a1a", bg: "#FBE7E7" }, "#337475": { fg: "#2B6364", bg: "#E5EFEF" } }`. statusBadge usa fg/bg sólidos de 6 dígitos y, para colores desconocidos, cae a fg=color y bg=#f0edee. Verifica cada par con 4,5:1 o más.

**211. [MEDIA] El subtítulo de la cabecera (#9aa3ad) y el nombre en blanco quedan ilegibles cuando accentColor no es navy**  
`backend/src/templates/_shared.js:277` · desborde_ui  
*Por qué:* brandRowHtml tiene fijo el subtítulo 'Marketplace multivendedor de Cuba' en #9aa3ad a 11,5px, pensado para el navy #0e1a28 (comentario 107-110). Pero verificationUpdate (accentColor = color del estado), orderCancelledVendor (#ba1a1a), orderOverdueVendor/orderDelayVendor (#8A5100), orderFollowUpVendor (#65676c) y tableOrderStatus/statusUpdate/orderCancelHelp de una tienda sin logo muestran la cabecera de la plataforma sobre esos colores. #9aa3ad sobre #0CAE53 da unos 1,14:1 (no se ve) y en los demás unos 2 a 2,6:1. El nombre en blanco a 19px en negrita sobre #0CAE53 queda en 2,9:1, por debajo del 3:1 de texto grande. accentColor se añadió después y no se ajustó el subtítulo.  
*Arreglo:* La opción más simple y coherente: en emailShell, usa accentColor solo cuando hay storeLogoUrl (cabecera de tienda). La cabecera de la plataforma va siempre en navy y el color del estado queda en el sello. Si se quiere mantener el color de cabecera, pinta el subtítulo con rgba(255,255,255,0.85) cuando accentColor !== '#0e1a28' y no uses #0CAE53 como fondo (cámbialo por #087A38). Revisa visualmente verificationUpdate, orderCancelledVendor y statusUpdate a 390px.

**212. [BAJA] Rayas largas (—) en asuntos, preheaders y párrafos visibles**  
`backend/src/templates/accountDeletion.js:21` · texto  
*Por qué:* Aparecen en accountDeletion.js (21-78), passwordReset.js 16 y 23, registrationCode.js 22 y 24, twoFactorCode.js 19-26, tableOrderStatus.js:16, documentEmail.js:10 y 27 (asuntos), adminDirectEmail.js:13 (' — Administrador' en cada asunto al admin), cashCloseReminder.js:25, fraudReport*.js, lowStockAlert.js:33, vendorInactivityReminder.js 13-20, vendorReactivated.js:17, vendorStaffInvite.js:20, vendorSuspended.js 18-19, vendorWinback.js 23 y 29, y en los mensajes de verificationNotify.service.js. Son anteriores a la regla 4.  
*Arreglo:* Cambia cada '—' visible por punto, coma, dos puntos o '·' según la frase. En adminDirectEmail.js:13, no añadas el nombre al asunto cuando recipientName es 'Administrador'. Comprueba con `grep -rn "—" backend/src/templates backend/src/services/verificationNotify.service.js` y deja solo las que estén en comentarios.

**213. [BAJA] Textos con fallos: frase de mesa que termina en dos puntos, concordancia en el asunto de estado y género en la suspensión por fraude**  
`backend/src/templates/tableOrderStatus.js:21` · texto  
*Por qué:* tableOrderStatus.js:21 dice 'Tu pedido cambió de estado:' y debajo no hay nada, porque el sello se movió arriba del título en el Bloque 61. statusUpdate.js:20 arma 'tu pedido está preparando' o 'está nuevo' con las etiquetas de las pastillas, y el CTA de un pedido cancelado dice 'Ver el avance'. fraudReportSuspended.js:10 dice 'Tu tienda "X" fue suspendido' y moderation.js:200-221 mezcla 'suspenderlo' y 'publicada'.  
*Arreglo:* 1) tableOrderStatus: 'Tu pedido de la mesa N ahora está <strong>{estado}</strong>.' 2) statusUpdate: un mapa STATUS_PHRASE {NEW:'recibido', PREPARING:'en preparación', READY:'en camino', DELIVERED:'entregado', CANCELLED:'cancelado'} para el asunto, y CTA 'Ver el pedido' si está CANCELLED. 3) fraudReportSuspended y moderation.js: frases neutras ('Suspendimos tu tienda "X"', 'Se mantiene visible').

**214. [BAJA] Cuadre de caja: el botón dice 'Agentes de Ventas' y el correo se manda al personal aunque el plan ya no incluya equipo**  
`backend/src/jobs/cashCloseReminder.job.js:54` · permisos_plan  
*Por qué:* cashCloseReminder.js:26 dice 'Ir a Agentes de Ventas', pero la sección se llama 'Productos Asignados' (VendorLayout.jsx:82, VendorManualSales.jsx:575). El job no revisa allowStaffUsers, y requireVendorAccess.js:9-10 bloquea al personal con 403 si el plan no lo incluye, así que el correo lleva a una pantalla que la persona no puede abrir (regla 2).  
*Arreglo:* 1) En el job, después de matchesToday: `if (!(await planAllows(vendor.planType, "allowStaffUsers"))) continue;` (importa planAllows de lib/planConfig.js). 2) Cambia el botón a 'Reportar mis ventas' o 'Ir a Productos Asignados'.

**215. [BAJA] Detalles de plantillas: fecha sin zona horaria, '90 días' fijo, sello 'Suspendida' en un correo de pausa, último aviso de fraude contradictorio y cantidad que se parte en bajo stock**  
`backend/src/templates/accountDeletion.js:6` · bug  
*Por qué:* accountDeletion.js:6 usa toLocaleDateString sin `timeZone: "America/Havana"` (las demás sí la usan), así que con el servidor en UTC la fecha puede salir con un día más. vendorInactivityReminder.js:20 tiene '90 días' fijo, aunque existe SUSPENSION_DAYS en vendorLifecycle.job.js:19. vendorSuspended.js:14 usa el sello 'Suspendida' en un correo que dice 'pausada'. fraudReportEvidenceRequested.js:27 muestra 'Tienes N días' justo debajo de 'mañana vence', y tiene un import de env sin usar. lowStockAlert.js:21 no pone nowrap en '12 unidades'.  
*Arreglo:* Añade timeZone a accountDeletion. Pasa suspensionDays desde el job a la plantilla. Cambia el sello a 'Pausada'. Muestra el smallNote de plazo solo si !isLastReminder y quita el import. Pon `white-space:nowrap;padding-left:8px` en la celda de la cantidad.

**216. [BAJA] El ícono de bolsa de los productos sin foto es un SVG en línea, que Gmail y Outlook no muestran**  
`backend/src/templates/_shared.js:212` · desborde_ui  
*Por qué:* itemThumbHtml pinta un <svg> en línea. El propio archivo (300-305) dice que Gmail y Outlook no muestran SVG y por eso pasó los íconos de redes a PNG en el Bloque 284. Esta parte, del Bloque 231, no se migró, así que queda un cuadro gris vacío.  
*Arreglo:* Genera backend/src/assets/social/bag.png (o en /brand), igual que los íconos de redes, y en itemThumbHtml usa `<img src="${backendUrl}/brand/social/bag.png" width=18 height=18 alt="">` dentro de la misma celda.

**217. [BAJA] Grises del pie y de los pasos pendientes por debajo de AA**  
`backend/src/templates/_shared.js:439` · desborde_ui  
*Por qué:* El pie usa #8a8d92 sobre #f7f5f6 a 11px (unos 3:1). Los pasos sin llegar de orderProgress usan #9a9ca1 sobre blanco (unos 2,8:1). Los enlaces del pie, #75777c sobre #f7f5f6, quedan en unos 4,3:1. Es un gris 'muted' a propósito, pero incumple la regla 4.  
*Arreglo:* Sube el pie a #63666b, los enlaces a #5b6470 y los pasos pendientes a #6f7277, y verifica con un medidor de contraste.

### Está así a propósito (no se toca)

- **La ayuda para cancelar (sendOrderCancelHelpEmail) depende del plan de la tienda**: lib/email.js:135-136 dice que los correos con el nombre de la tienda a sus clientes son del plan de pago, y este sale con fromName de la tienda. Aun así es incoherente con orderDelayCustomer y orderAutoCancelledCustomer, que son avisos de la plataforma sin plan. Lo dejo para que lo decida el dueño: o se convierte en aviso de la plataforma (sin fromName y sin plan) o se documenta. La respuesta 409 de cancelMyOrder ya trae `store` y `emailSent:false` para que la pantalla muestre el contacto.
- **La credencial completa de la API va en el correo de aprobación o regeneración del socio**: partnerNotices.js lo hace a propósito ('aprobada (con su credencial)') para que el socio empiece rápido. Es un riesgo bajo (la clave queda en el buzón y en Resend). Lo paso a mejoras.
- **Los correos de bajo stock y de cuadre de caja pasan por storeEmailsAllowed (allowCustomerEmails)**: Es intencional según el comentario de lib/email.js:135-136: los correos automáticos de gestión son del plan de pago.
- **Los avisos de retraso, cierre automático y puntos al cliente no dependen del plan de la tienda**: Está documentado en lib/email.js:193-195 y 224-225: son avisos de la plataforma o sobre el saldo del cliente, no publicidad de la tienda.
- **adminNotify escapa el mensaje pero no el asunto**: El escape del mensaje es intencional y correcto (adminNotify.js:22-25). El asunto sin escapar no es intencional y está cubierto por el hallazgo de emailShell.
- **Pastilla con fondo del color al 12% y texto sólido**: Es una decisión visual que copia Badge.jsx de la app (comentario _shared.js:174-175). Lo que está mal es solo el contraste del verde y el hex de 8 dígitos (cubierto en confirmados), no el patrón.

### Mejoras propuestas

- Quitar el botón 'Ir a Baznova' (que lleva a /cuenta y abre el login) de los correos de código (passwordReset, registrationCode, twoFactorCode, emailChangeCode), o que el frontend acepte ?paso=codigo en Account.jsx para abrir el paso pendiente.
- Crear una plantilla propia para el código de confirmación de acciones del admin (o un parámetro `code` en adminDirectEmail) que use codeBlock, en vez de poner el código como texto corrido a 14px.
- Declarar color-scheme en mj-head (`<meta name="color-scheme" content="light">` y supported-color-schemes), probar en Gmail y Outlook.com en modo oscuro, y pasar codeBlock a una tabla de una celda con bgcolor y white-space:nowrap para que Outlook de escritorio respete el fondo y el relleno.
- Correos de socios de la API: mostrar solo los últimos 4 caracteres de la credencial y llevar a /socio/llaves para copiarla, o al menos avisar de que conviene borrar el correo.
- Escapar en un solo lugar: que emailShell sea el único responsable de escapar title, storeName y preview, y añadir una prueba automática que genere todas las plantillas con un nombre malicioso y falle si aparece '<a href' o '<script' sin escapar.
- Centralizar los textos de plan en un helper (por ejemplo, planText(vendor) con displayName del plan actual y del gratuito), para que correos, avisos del panel, mensajes 403 de assertPlanAllows y /planes digan siempre lo que configura el admin.
- Agrupar las plantillas por tipo de destinatario (cliente-pedido, tienda, cuenta, admin) con un footerNote propio de cada grupo, en vez de un texto por defecto que no le sirve a la mayoría.
- Añadir a vendorWinback y a los recordatorios un tope global entre correos de promoción (el mismo lastMarketingEmailAt) para que un cliente no reciba el re-enganche y el recordatorio de carrito el mismo día.

<details><summary>Notas del subagente: Plantillas de cuenta y pedidos</summary>

Todo fue solo lectura. Lo que funciona bien: los enlaces de los correos apuntan a rutas que existen (/rastrear-pedido?pedido, /vendedor/pedidos?ver&tipo=orden, /cuenta/panel?tab=points, /admin/errores?tab=tickets&ticket, /checkout, /terminos, /privacidad). Los códigos no van en el asunto. El código de cambio de correo va a la dirección nueva y la vieja recibe un aviso. El preheader se escapa en el shell. El texto plano se genera automáticamente. Los íconos de redes y de los pasos son PNG. A 390px el código de 6 dígitos (unos 225px) y la línea de 4 pasos (unos 272px mínimo) caben en los unos 338px útiles. El contraste del CTA #643900 sobre #fe9800 es de unos 4,6:1 (AA). Lo más urgente: escapar title y storeName dentro de emailShell (arregla de una vez adminDirectEmail, customerReminders y documentEmail), el remitente sin comillas, los totales pegados en el texto plano y la moneda CUP fija en orderCancelledVendor y orderCancelHelp. Los contrastes están calculados a mano (aproximados), no medidos con una herramienta.

</details>

<details><summary>Notas del subagente: Plantillas de tiendas y moderación</summary>

Todas las rutas a las que apuntan los botones existen en App.jsx: /vendedor/ventas-manuales, /vendedor/productos, /vendedor/verificacion (Suscripción), /vendedor/reportes, /vendedor/ingresar, /contacto, /rastrear-pedido?pedido= (OrderTracking lee 'pedido'), /tienda/:slug, /api-socios, /socio/ingresar, /socio/llaves y /cuenta/panel?tab=quick-sale|reports. moderationNotice.js está bien: los párrafos que arma moderation.js escapan los datos de usuario. lowStockAlert y cashCloseReminder pasan por storeEmailsAllowed (allowCustomerEmails) a propósito, según el comentario de lib/email.js:135-136. No encontré voseo dentro de las plantillas revisadas. El único caso está en orders.controller.js:969. Los riesgos más importantes: el asunto libre de vendorMessage entra sin escapar como HTML en un correo al cliente, y el re-enganche ignora marketingEmails y no trae enlace de baja.

</details>


## Reglas transversales de planes y permisos

La base está bien armada. El plan nunca viaja en el JWT: planAllows y getPlanLimit leen PlanConfig y vendor.planType de la base en cada petición, con una caché de 5 s que se borra al guardar. El vendorId siempre sale de resolveMyVendor. Todas las rutas /admin y /partner-portal tienen guardia de rol. Caja (requirePosPlan), fidelidad, correos y pedidos por WhatsApp se cumplen bien en el servidor. El hueco principal es que los límites solo se miran al CREAR. Activar, reactivar, bajar de plan o bajar un límite desde el admin no los vuelve a aplicar, salvo el cupo de productos, y ese también se salta (pausar y reactivar, o crear en pausa y subir foto). Las ofertas de tienda siguen públicas aunque el plan ya no las incluya. El menú del panel no se filtra por plan (regla 2). En permisos hay cuatro fallos más: rutas solo del dueño que no miran si la tienda está bloqueada, la suspensión manual de clientes que no cierra sus sesiones, la sección "Reportes" que no sirve al personal y la casilla "Ofertas" que da error 400. Diseño propuesto por los subagentes que conviene conservar: (a) un servicio único applyPlanLimits(vendorId), que reemplace a recalcVendorProductQuota en todos sus puntos de llamada (applyPlanDowngrade, transitionVendorVerification, updatePlanConfig, cambio de plan desde el admin o por la propia tienda) y recorte productos, ofertas, códigos, personal y mesas, y avise de las provincias y países que sobran; (b) un `planFlag` por cada entrada del menú de VendorLayout, leído de settings.plans, con redirect también para el dueño; (c) el mapa de dónde se aplica cada límite: maxProducts (createProduct, que se salta al activar), maxProvinces (addMyLocation y syncVendorProvinceZone, falta en createVendor), maxDeliveryCountries (addMyDeliveryCountry), maxMonthlyOrderEmails (solo sendManualEmail), maxStaffUsers y maxTables (solo al crear), maxActiveStoreOffers (create y update, falta en lo público), maxDiscountCodes (create, y cuenta el total).

### Errores confirmados (22)

**218. [ALTA] El cupo de productos se salta pausando y reactivando, o creando productos en pausa y subiéndoles foto**  
`backend/src/controllers/products.controller.js:776` · permisos_plan  
*Por qué:* Desde el Bloque 56 todo producto nace con isActive=false (l.763) y se activa solo al subir la primera foto (addProductImages l.948, addProductImageLink l.1039) o con PATCH isActive:true (updateProduct, que solo mira suspendedAt en l.852). createProduct cuenta solo `isActive: true`, así que los productos en pausa no cuentan, y ningún camino de activación mira maxProducts ni llama a recalcVendorProductQuota. El producto queda con overQuota=false (valor por defecto) y sale en público. El comentario de planConfig.js l.194-196 dice que el recálculo corre 'al crear/activar/desactivar un producto', pero products.controller.js ni lo importa. Es un descuido al cambiar el flujo en el Bloque 56, no una decisión. Con tope 10, una tienda del Básico puede crear 30 productos sin foto, subir las fotos después y tener 30 públicos.  
*Arreglo:* 1) En products.controller.js, importa recalcVendorProductQuota desde lib/planConfig.js. 2) Llámalo con vendor.id después de cada cambio de isActive: en addProductImages y addProductImageLink cuando wasEmpty activa el producto, en removeProductImage cuando queda sin fotos (l.976), en updateProduct cuando data.isActive !== undefined y en deleteProduct. 3) En createProduct, cuenta los productos con `isActive: true, overQuota: false` más los que están en pausa sin foto, o deja de bloquear al crear y que el recálculo marque overQuota=true. Lo más simple y coherente con el Bloque 52 es mantener el bloqueo al crear contando `{ vendorId, overQuota: false }` (activos y en pausa) y además recalcular al activar. 4) Prueba: con maxProducts=3, crea 3 con foto, pausa 1, crea otro con foto, reactiva el pausado. Debe quedar uno con overQuota=true y no verse en /tienda/:slug.

**219. [ALTA] Las ofertas de tienda siguen públicas y se pueden reactivar aunque el plan ya no las incluya**  
`backend/src/controllers/storeOffers.controller.js:182` · permisos_plan  
*Por qué:* updateStoreOffer, al pasar active:true, solo llama a assertActiveOfferLimit. No repite la comprobación de verificación ni assertPlanAllows('allowStoreOffers') que sí hace createStoreOffer (l.113-116). En lo público, getVendorBySlug (vendors.controller.js l.348), la pantalla del cliente de caja (pos.controller.js l.494) y la API de socios (partnerApi.controller.js l.281) devuelven las ofertas activas sin mirar el plan ni maxActiveStoreOffers. Al bajar de plan nada las apaga. Resultado: la tienda del Básico publica una oferta cuyo código el checkout rechaza ('Esta tienda no acepta códigos de descuento por ahora', discountCodes.controller.js l.235). Para los códigos el comportamiento 'se conservan pero no se aplican' es explícito. Para las ofertas no hay nada parecido, así que no es intencional e incumple las reglas 1 y 2.  
*Arreglo:* 1) storeOffers.controller.js updateStoreOffer: si data.active === true && !existing.active, exige verificationStatus === 'VERIFIED' (o isPremiumActive, ver el hallazgo de la insignia) y await assertPlanAllows(vendor, 'allowStoreOffers', 'Tu plan actual no incluye ofertas de tienda.') antes de assertActiveOfferLimit. 2) Saca un helper visibleStoreOffersWhere(vendor) o un post-filtro filterOffersByPlan(vendor, offers) en storeOffers.controller.js: devuelve [] si !planAllows(vendor.planType,'allowStoreOffers') y, si no, las primeras maxActiveStoreOffers ordenadas por createdAt desc. Úsalo en vendors.controller.js getVendorBySlug, pos.controller.js l.494 y partnerApi.controller.js l.281. 3) En el recálculo al bajar de plan (ver el hallazgo siguiente) y en updatePlanConfig cuando allowStoreOffers pase a false o baje maxActiveStoreOffers, haz updateMany active=false de las sobrantes (las más viejas primero).

**220. [MEDIA] Al bajar de plan o bajar un límite en el admin solo se recorta el cupo de productos: personal, mesas, códigos, ofertas, provincias y países siguen sin tope**  
`backend/src/services/planDowngrade.service.js:40` · permisos_plan  
*Por qué:* applyPlanDowngrade (l.40-41), transitionVendorVerification (vendorVerification.service.js l.69) y updatePlanConfig (settings.controller.js l.312-315) solo llaman a recalcVendorProductQuota. Tras la bajada: assertStaffPlan (requireVendorAccess.js l.6-12) solo mira el interruptor allowStaffUsers, no maxStaffUsers, así que si el plan nuevo permite 2 y había 10, entran los 10. createTableOrder (tables.controller.js l.1226) solo mira allowQrTables, así que todas las mesas siguen recibiendo pedidos aunque maxTables sea menor. resolveDiscountForOrder solo mira el interruptor, así que funcionan todos los códigos por encima de maxDiscountCodes. VendorLocation y VendorDeliveryCountry no se recortan nunca. Para los productos hay decisión explícita (Bloque 52); para el resto no hay comentario que justifique quedar por encima del tope. El comentario de requireVendorAccess cubre el interruptor apagado, no el límite numérico.  
*Arreglo:* 1) Crea backend/src/services/planLimits.service.js con applyPlanLimits(vendorId), que llame a recalcVendorProductQuota y además: a) personal, deja activos solo los maxStaffUsers más antiguos (isActive=true ordenados por createdAt asc) y desactiva el resto (isActive=false + revocar sesiones, igual que updateMyStaff l.291); b) mesas, añade un campo Table.disabledByPlan (migración a mano) y márcalo en las que pasen de maxTables (tableNumber desc); createTableOrder y getTableByToken lo rechazan con un mensaje claro; c) códigos, desactiva los activos que pasen de maxDiscountCodes (los más nuevos primero); d) ofertas, ver el hallazgo anterior; e) provincias y países, no borres nada: guarda el exceso y avisa a la tienda con adminNoticeToVendor para que elija cuáles quitar. 2) Sustituye recalcVendorProductQuota por applyPlanLimits en planDowngrade.service.js l.41, vendorVerification.service.js l.69, l.217 y l.233, admin.controller.js (l.1365, 1453, 1567, 1714, 1784), verification.controller.js (l.1213, 1300), trialEligibility.service.js l.145 y settings.controller.js l.312 (dispáralo cuando cambie cualquier max* o allow*). 3) Confirma con el dueño el criterio de cada excedente antes de implementarlo (regla de productos del Bloque 52 como modelo).

**221. [MEDIA] Cuando la tienda baja ella misma al Básico no se recalcula el cupo y no se cancela el cobro del plan de pago sin insignia**  
`backend/src/controllers/vendors.controller.js:778` · bug  
*Por qué:* Si la tienda no está VERIFIED, `planType = 'REGULAR'` se guarda directo en prisma.vendor.update (l.824) sin recalcVendorProductQuota. En la rama de verificación en curso (l.855-866), transitionVendorVerification lee el vendor ya actualizado a REGULAR, así que `updatedVendor.planType !== vendor.planType` da false y tampoco recalcula. El comentario de l.772 supone dos planes (Regular y Business). Con 4 planes y grantsBadge configurable, una tienda en Estándar sin insignia (NOT_STARTED o PLAN_ENDED, pagada desde Suscripción) cae en este camino: pasa al Básico conservando públicos todos sus productos, y si pagaba con Stripe la suscripción no se cancela (solo se cancela en la rama de verificación en curso).  
*Arreglo:* 1) En updateMyVendor, si planType === 'REGULAR' && vendor.planType !== 'REGULAR', no lo escribas en el update general. Delega en applyPlanDowngrade(vendor.id, { actorId: req.user.id, source: 'VENDOR_ACTION', reason: 'La tienda eligió el plan Básico.' }), que cancela Stripe, limpia nextPaymentDueDate y recalcula. Si hay periodo pagado vigente (currentPeriodEnd(vendor)), usa scheduleOrCancelDowngrade como en la rama VERIFIED. 2) Si no se adopta applyPlanDowngrade, al menos llama a recalcVendorProductQuota(vendor.id) (o al futuro applyPlanLimits) después del update cuando planType cambie. 3) Actualiza el comentario de l.772-777 al modelo de 4 planes.

**222. [MEDIA] El registro de la tienda no aplica maxProvinces, allowQrTables ni allowSchedules del Básico**  
`backend/src/controllers/vendors.controller.js:270` · permisos_plan  
*Por qué:* createVendorSchema.locations es `.min(1)` sin máximo (l.130-144) y createVendor crea todas las ubicaciones (l.270) sin comparar contra maxProvinces, cosa que addMyLocation y syncVendorProvinceZone sí hacen. Solo valida el número de mesas (assertTableCountWithinPlan, l.185) y siembra mesas (l.275-278) aunque el Básico tenga allowQrTables=false, cuando createTable sí lo exige (tables.controller.js l.791). Guarda el horario (l.281) aunque allowSchedules esté apagado, y updateSchedule sí lo bloquea. updateMyVendor (l.785-792) tampoco mira allowQrTables al sembrar mesas. El Bloque 294 se centró en el tope y el Bloque 171 pidió el horario cuando el Básico lo incluía. Si el admin apaga esas funciones en el Básico, el registro se las salta por API.  
*Arreglo:* 1) En createVendor, tras construir resolvedLocations, cuenta las provincias con el helper único countVendorProvinces (ver el hallazgo de conteo de provincias) y compáralo con (await getPlanConfig('REGULAR')).maxProvinces; si pasa, AppError 400 'Tu plan permite hasta N provincias'. 2) Siembra tables solo si await planAllows('REGULAR','allowQrTables'); si no, ignora tableCount o devuelve 403 con mensaje. 3) Guarda schedules solo si planAllows('REGULAR','allowSchedules'). 4) En updateMyVendor l.787, exige también planAllows(vendor.planType,'allowQrTables') antes de seedTables. 5) Refleja lo mismo en VendorOnboarding.jsx: oculta el paso de mesas u horario si el plan no lo incluye (lee settings.plans).

**223. [MEDIA] El tope de códigos de descuento y de usuarios del equipo cuenta los inactivos, que no se pueden borrar: la tienda queda bloqueada para siempre**  
`backend/src/controllers/discountCodes.controller.js:103` · bug  
*Por qué:* createDiscountCode cuenta todos los códigos de la tienda (l.103), y deleteDiscountCode prohíbe borrar uno con usos (l.212, 'solo desactivarlo'). Con maxDiscountCodes=5 y 5 códigos usados y desactivados, la tienda no puede crear códigos nunca más. Con el personal pasa lo mismo: createMyStaff cuenta todos los VendorStaff (vendorStaff.controller.js l.128), incluidos los desactivados, y no existe ningún endpoint para borrar personal. Hoy reactivar un código o un usuario no supera el cupo, justamente porque se cuenta el total, y el plan se aplica al usarlo (resolveDiscountForOrder l.235, assertStaffPlan). Pero al arreglar el conteo, la reactivación pasa a necesitar las mismas comprobaciones. El texto público ('Hasta N códigos') no aclara si son activos o totales, y que la tienda quede bloqueada no parece buscado.  
*Arreglo:* 1) discountCodes.controller.js createDiscountCode: cuenta solo `{ vendorId, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }`. 2) updateDiscountCode: si data.active === true && !existing.active, aplica assertPlanAllows(vendor,'allowDiscountCodes') y el mismo conteo contra maxDiscountCodes (excluyendo el propio id). 3) vendorStaff.controller.js createMyStaff: cuenta `{ vendorId, isActive: true }`. updateMyStaff: si data.isActive === true y el usuario estaba inactivo, assertPlanAllows(vendor,'allowStaffUsers') y el conteo contra maxStaffUsers. 4) Cambia los mensajes a 'Tu plan permite hasta N códigos activos. Desactiva uno o mejora tu plan.'.

**224. [MEDIA] Las rutas solo del dueño (requireRole('VENDOR')) no comprueban si la tienda está bloqueada, suspendida o eliminada**  
`backend/src/routes/vendors.routes.js:38` · seguridad  
*Por qué:* PATCH /vendors/me, /me/logo, /me/schedule, /me/locations, /me/delivery-countries, /me/ai-document, /me/assistant y todas las rutas de vendorStaff.routes.js (l.16-22) usan requireRole('VENDOR') a secas. Por eso no pasan por assertVendorUsable, y resolveMyVendor (utils/resolveVendor.js) no mira isBlocked ni deletedAt. El comentario de requireVendorAccess.js l.14-16 ('antes el bloqueo solo lo aplicaba VendorLayout.jsx') muestra que la intención es bloquear en el servidor, pero el arreglo solo cubrió las rutas con sección. Una tienda bloqueada por fraude o eliminada puede, llamando a la API, cambiar su perfil y enlace, crear o reactivar personal y gastar IA del asistente. Algunas rutas (verificación, pago, solicitud de cambio) sí deben quedar abiertas para apelar o pagar.  
*Arreglo:* 1) En middleware/requireVendorAccess.js, exporta requireVendorOwner({ strict = true } = {}), que exija req.user.role === 'VENDOR' (o ADMIN) y llame a assertVendorUsable(req, null, { strict }). 2) Sustituye requireRole('VENDOR') por requireVendorOwner() en vendors.routes.js l.38, 41, 82-86, 89, 103-107, 111-112 y en vendorStaff.routes.js l.16-22. 3) Deja requireVendorOwner({ strict: false }) (solo bloquea deletedAt) en /me/trial*, /me/change-request y las rutas de verification.routes.js de pago y suscripción, para que la tienda suspendida por impago pueda pagar. 4) Prueba: con vendor.isBlocked=true, PATCH /vendors/me debe dar 403 vendorState 'blocked'.

**225. [MEDIA] Un cliente suspendido a mano por el admin conserva el acceso a la API hasta una hora**  
`backend/src/controllers/admin.controller.js:1951` · seguridad  
*Por qué:* updateCustomer guarda isSuspended:true pero no revoca sus sesiones. authenticate (middleware/auth.js l.34-45) valida solo la Session, no user.isSuspended, y el rol sale del JWT. isSuspended solo se mira en refresh, así que el access token sigue sirviendo hasta que caduca (1 h). lib/moderation.js l.122 sí revoca las sesiones al bloquear por fraude, y updateMyStaff (l.291) también al desactivar. En la suspensión manual es un olvido.  
*Arreglo:* 1) En admin.controller.js updateCustomer, después del update: si data.isSuspended === true, ejecuta prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }). 2) Revisa las otras suspensiones y cambios de rol del admin (vendedores, personal, socios) y aplica lo mismo. 3) Opcional, defensa extra: en authenticate, incluye `user: { select: { isSuspended: true, role: true, deletedAt: true } }` en la consulta de la sesión (ya se hace en cada petición) y rechaza si está suspendido o si el rol no coincide con payload.role.

**226. [MEDIA] La sección 'Reportes' delegada a un usuario del equipo siempre sale vacía**  
`backend/src/controllers/reports.controller.js:69` · conexion  
*Por qué:* GET /reports/me/list (reports.routes.js l.18) solo lleva authenticate y filtra por `vendor: { userId: req.user.id }`. Para un VENDOR_STAFF, req.user.id es el del empleado, no el del dueño, así que la lista sale vacía. Aun así, 'reportes' está en los dos VENDOR_SECTIONS (backend constants/vendorSections.js l.30 y frontend lib/vendorSections.js l.26), VendorLayout l.75 muestra el enlace y SectionAccessPicker lo ofrece. submitEvidence y submitAppeal (l.26 y l.28) también resuelven por el usuario y el empleado no podría responder. No es intencional: la clave existe para delegarla.  
*Arreglo:* 1) En reports.controller.js, añade listStoreReports, que use resolveMyVendor(req.user.id).id y filtre por `OR: [{ vendorId }, { product: { vendorId } }]`, más submitStoreEvidence y submitStoreAppeal, que comprueben report.vendorId (o el del producto) igual a ese vendor. 2) En reports.routes.js, crea GET /reports/store/list con requireVendorAccess('reportes') y POST /reports/store/:id/evidence y /reports/store/:id/appeal con requireVendorWrite('reportes'). 3) En el frontend, la pantalla VendorFraudReports usa las rutas /store/* cuando está en el panel; /me/list queda para CustomerPanel. 4) Otra opción, si el dueño no quiere delegarlo: quita 'reportes' de los dos VENDOR_SECTIONS y marca el enlace como ownerOnly.

**227. [MEDIA] La casilla 'Ofertas' del selector de secciones hace fallar el guardado del usuario con un error 400**  
`frontend/src/lib/vendorSections.js:16` · conexion  
*Por qué:* El VENDOR_SECTIONS del frontend tiene { key: 'ofertas' }, que entra en MANUALLY_ASSIGNABLE_SECTIONS (l.43) y se pinta en SectionAccessPicker. El backend valida z.enum(VENDOR_SECTION_KEYS) (vendorStaff.controller.js l.104 y l.211, admin.controller.js l.1013), y constants/vendorSections.js no tiene 'ofertas'. Si el dueño marca esa casilla, el alta o la edición del usuario falla. Es un residuo de antes de unir ofertas y códigos (Bloque 232). Las etiquetas también difieren entre las dos listas ('Dashboard' frente a 'Resumen', 'Reportes' frente a 'Reportes de fraude', 'Productos Asignados' frente a 'Agentes de Ventas').  
*Arreglo:* 1) Borra { key: 'ofertas', label: 'Ofertas' } de frontend/src/lib/vendorSections.js. 2) Unifica las etiquetas con constants/vendorSections.js (elige un texto por clave y úsalo en los dos archivos). 3) Opcional: expón GET /vendor-staff/sections desde el backend para que el frontend no tenga su propia copia, o añade un test que compare las dos listas de claves.

**228. [MEDIA] El menú del panel no oculta lo que el plan no incluye y esas pantallas se abren por enlace directo**  
`frontend/src/pages/vendor/VendorLayout.jsx:340` · permisos_plan  
*Por qué:* El filtro de `nav` (l.340-352) solo mira restaurantOnly, unverifiedOnly, staffOnly y las secciones del personal, nunca allowPos, allowQrTables, allowStaffUsers, allowLoyalty, allowStoreOffers o allowDiscountCodes. El redirect defensivo (l.360-373) solo existe para isStaff. Caja (VendorPos con PlanUpsell) y Fidelidad (VendorLoyalty con 'Tu plan actual no incluye...') muestran una venta del plan superior a propósito. Pero Usuarios, Mesas y Ofertas y códigos (VendorStoreOffers.jsx l.313 habilita 'Agregar oferta' solo con isVerified) no avisan y fallan con 403 al guardar. SectionAccessPicker también deja delegar secciones que el plan no tiene. El servidor sí bloquea, así que no es un hueco de seguridad, pero incumple la regla 2.  
*Arreglo:* 1) En VendorLayout.jsx, añade `planFlag` a las entradas de NAV: caja→allowPos, mesas→allowQrTables, usuarios→allowStaffUsers, puntos→allowLoyalty, ofertas-tienda→['allowStoreOffers','allowDiscountCodes'] (cualquiera de los dos). 2) Obtén el plan de la tienda desde settings.plans.find(p => p.planType === vendor.planType) (ya viene en /settings) y filtra `nav` por esos flags también para el dueño. 3) Amplía el bloque de redirect para todos los roles: si el pathname normalizado (`location.pathname.replace(/\/+$/, '') || '/vendedor'`) corresponde a un item con planFlag apagado, restaurantOnly sin restaurante o unverifiedOnly ya verificado, redirige a /vendedor o a /vendedor/verificacion?mejorar=1. 4) Si el dueño quiere mantener la venta del plan superior, sustituye esas entradas por una sola 'Funciones de otros planes', con candado y enlace a /planes, en vez de la pantalla funcional. 5) VendorStoreOffers.jsx: muestra cada pestaña solo si su flag está encendido. 6) SectionAccessPicker: oculta las secciones cuyo flag está apagado.

**229. [BAJA] Ajustar puntos de fidelidad no comprueba el plan ni que el programa esté activo**  
`backend/src/controllers/loyalty.controller.js:205` · permisos_plan  
*Por qué:* adjustMemberPoints llama a adjustPoints y notifyPointsAdjusted sin mirar allowLoyalty ni activeProgramFor. Una tienda sin fidelidad en su plan puede dar puntos y mandar avisos a clientes por API. El daño es limitado porque el canje sí exige un programa activo.  
*Arreglo:* Al inicio de adjustMemberPoints, añade `if (!(await activeProgramFor(vendor))) throw new AppError('Activa tu programa de fidelidad para ajustar puntos.', 403, { planRequired: 'allowLoyalty' })`, o assertPlanAllows(vendor, 'allowLoyalty').

**230. [BAJA] El límite de correos al mes solo cuenta los manuales, pero el texto público promete un tope general**  
`backend/src/controllers/orders.controller.js:935` · config  
*Por qué:* countManualEmailsThisMonth filtra type 'MANUAL'. Las facturas y garantías por correo (invoices.controller.js l.104 y l.169) no cuentan, y buildPlanIncludes (planConfig.js l.320) dice 'Correos a tus clientes (hasta N al mes)'. Además, getEmailUsage (l.941) devuelve unlimited:true con límite null aunque allowCustomerEmails esté apagado. Incumple la regla 3.  
*Arreglo:* 1) Cambia el texto en buildPlanIncludes a 'Hasta N correos manuales al mes a tus clientes', o cuenta también facturas y garantías en el mismo contador. 2) En getEmailUsage, si !planAllows(vendor.planType,'allowCustomerEmails'), devuelve { limit: 0, unlimited: false }.

**231. [BAJA] Funciones que exigen la insignia de verificada además del interruptor del plan**  
`backend/src/controllers/chat.controller.js:212` · config  
*Por qué:* El chat con IA (l.212), las fotos en reseñas (reviews.controller.js l.70), crear ofertas (storeOffers.controller.js l.113), el destacado en portada (search.controller.js l.490) y VendorStoreOffers.jsx l.313 exigen verificationStatus === 'VERIFIED'. Es intencional (Bloque 52, 'las dos cosas'), y hoy funciona porque los 3 planes de pago tienen grantsBadge=true. Pero grantsBadge se puede apagar desde el admin, y entonces /planes anunciaría funciones que la tienda no puede usar (regla 3).  
*Arreglo:* Cambia esas comprobaciones por isPremiumActive(vendor) (lib/planConfig.js l.154, que ya cubre un plan pagado sin insignia) más el interruptor del plan. Otra opción: en updatePlanConfig, rechaza apagar grantsBadge mientras el plan tenga encendidas allowAiChatbot, allowReviewPhotos, allowStoreOffers o featuredInHome, con un mensaje que lo explique.

**232. [BAJA] Mensajes de límite que nombran 'Premium' o dicen 'Verificate', y textos visibles con raya larga**  
`backend/src/controllers/products.controller.js:779` · texto  
*Por qué:* 'Verificate para pasar a Premium y publicar sin límite' tiene voseo sin tilde ('Verifícate' en tuteo) y supone que solo hay Regular y Premium. Pasa lo mismo en orders.controller.js l.969, invoices.controller.js l.104, pos.controller.js l.551, vendorZoneSync.service.js l.27 y planDowngrade.service.js l.43 y l.52 ('plan Regular', 'volver a Premium'). Hay rayas largas '—' en textos visibles: storeOffers.controller.js l.50-51, discountCodes.controller.js l.170, l.212 y l.215, y VendorStoreOffers.jsx l.320 y l.345.  
*Arreglo:* Usa config.displayName del plan actual y un CTA genérico ('Mejora tu plan en Suscripción para ampliar el límite.'). Sustituye 'plan Regular' por el displayName de REGULAR ('Básico'). Cambia cada '—' de los mensajes por punto o dos puntos. Busca con grep '—' dentro de cadenas de AppError y de JSX.

**233. [BAJA] Las provincias se cuentan distinto en el admin y al aplicar el tope**  
`backend/src/services/vendorZoneSync.service.js:19` · conexion  
*Por qué:* El tope usa new Set(provinceId).size, así que todas las ubicaciones sin provinceId cuentan como una. adminVendorManage.controller.js l.167 usa provinceId ?? stateOther ?? countryId. Son dos implementaciones distintas: el admin ve 'excede' donde el servidor no ve exceso, o al revés.  
*Arreglo:* Crea countVendorProvinces(locations) en lib/planConfig.js o en un lib/vendorLocations.js, con la clave provinceId ?? `${countryId ?? countryOther}:${stateOther}`, y úsala en vendorZoneSync.service.js, addMyLocation (vendors.controller.js l.1766), adminVendorManage.controller.js l.167 y createVendor.

**234. [BAJA] 'Mejorar con IA' en Productos da 403 al personal y la ruta no tiene límite de uso**  
`backend/src/routes/ai.routes.js:11` · conexion  
*Por qué:* La ruta usa requireRole('VENDOR','ADMIN') desde antes de que existiera el personal (Bloque 183), y VendorProducts.jsx l.513 muestra el botón a quien puede editar productos. Es la única ruta de IA de pago sin chatRateLimit.  
*Arreglo:* Cambia la guardia a requireVendorWrite('productos') y valida en el controlador que kind 'store' lo use solo el dueño (req.user.role === 'VENDOR'). Añade chatRateLimit, o un límite propio, a la ruta.

**235. [BAJA] Con la tienda suspendida por impago, el personal mantiene acceso completo de escritura**  
`backend/src/middleware/requireVendorAccess.js:23` · permisos_plan  
*Por qué:* La excepción por billingSuspendedAt es intencional para que el dueño pague (planBilling.service.js l.85), pero también deja pasar al VENDOR_STAFF, que no puede pagar. La regla del dueño es 'impago → limitado → suspendida'.  
*Arreglo:* En assertVendorUsable, si staff && vendor.billingSuspendedAt, lanza 403 { vendorState: 'billing' } con 'La tienda está suspendida por falta de pago. Avisa al dueño.'. Para el dueño, define con el negocio si queda en solo lectura más las rutas de pago, y documenta la decisión en un comentario.

**236. [BAJA] /settings publica todas las filas de PlanConfig, también los planes ocultos**  
`backend/src/controllers/settings.controller.js:86` · config  
*Por qué:* getSettings (público) mapea getAllPlanConfigs() sin filtrar isPublic ni pasar por publicPlan(), mientras GET /settings/plans (l.776) sí filtra. Un plan marcado como no público se ve en /settings para cualquier visitante (regla 3). El comentario explica que el panel necesita todos los límites.  
*Arreglo:* En /settings, devuelve solo los planes con isPublic pasados por publicPlan(). Sirve la configuración completa (incluido el plan actual aunque no sea público) en una ruta autenticada del panel, por ejemplo GET /vendors/me/plan, y cambia VendorLayout y las pantallas del panel para que la usen.

**237. [BAJA] La defensa por URL del panel compara la ruta exacta y no cubre al dueño**  
`frontend/src/pages/vendor/VendorLayout.jsx:362` · desborde_ui  
*Por qué:* `NAV.find((n) => n.to === location.pathname)` no reconoce '/vendedor/caja/' (con barra final), y el redirect solo corre para isStaff. Un dueño sin restaurante abre /vendedor/mesas por enlace. El servidor bloquea los datos, así que solo es UI rota.  
*Arreglo:* Normaliza la ruta con `location.pathname.replace(/\/+$/, '') || '/vendedor'` y aplica a todos los roles el redirect por restaurantOnly, unverifiedOnly y planFlag. Se resuelve junto con el hallazgo del menú por plan.

**238. [BAJA] Los botones 'Solo lectura / Leer y escribir' del selector de secciones miden menos de 44 px**  
`frontend/src/components/vendor/SectionAccessPicker.jsx:40` · desborde_ui  
*Por qué:* Usan px-2.5 py-1 text-[10.5px] (unos 22-24 px de alto), y la casilla es un carácter ☑/☐ sin área táctil. Incumple la regla 4 en el celular, que es donde el dueño crea usuarios.  
*Arreglo:* Usa min-h-[44px] y text-xs (12 px) como mínimo en los botones de nivel. Sustituye la casilla por un <input type='checkbox'> real dentro de un <label> que ocupe toda la fila con min-h-[44px]. Comprueba a 390 px que no haya desborde horizontal.

**239. [BAJA] Comentario de ruta desactualizado sobre quién puede usar el asistente de negocio**  
`backend/src/routes/vendors.routes.js:79` · texto  
*Por qué:* El comentario dice 'solo con tienda verificada, plan de pago y el interruptor encendido', pero desde el Bloque 259/276 está abierto a cualquier dueño, con un límite diario para las tiendas sin plan. Puede inducir a 'arreglar' algo que está bien.  
*Arreglo:* Reescribe el comentario: dueño de cualquier tienda, límite diario configurable (freeAssistantDailyLimit) para las tiendas sin plan de pago activo.

### Está así a propósito (no se toca)

- **Los productos que pasan del cupo quedan en el panel y no se borran**: Bloque 52, pedido explícito: al bajar el cupo, los excedentes quedan con overQuota=true, visibles solo en el panel, y la tienda los intercambia con swapProductQuota (máximo 5 al día). El orden por mérito (rankForQuota) es del 2026-10-24.
- **Los códigos de descuento se conservan al bajar de plan pero no se aplican**: Decisión explícita en discountCodes.controller.js l.234 ('los que ya tenía se conservan pero no se aplican'). resolveDiscountForOrder lo comprueba con planAllows en cada uso.
- **Los usuarios del equipo se conservan pero no entran si el plan apaga allowStaffUsers**: Comentario de requireVendorAccess.js l.5: assertStaffPlan bloquea en cada petición. Cubre el interruptor; el límite numérico al bajar de plan sí está reportado como error.
- **El dueño sigue entrando a su panel con la tienda suspendida por impago**: Intencional, para que pueda pagar (requireVendorAccess.js l.22 y planBilling.service.js l.85). Lo que se reporta es que el personal también entra.
- **Caja y Fidelidad muestran una pantalla de venta del plan superior en vez de ocultarse**: VendorPos usa PlanUpsell (403 + planRequired) y VendorLoyalty muestra 'Tu plan actual no incluye...'. Es una decisión de venta válida. El menú por plan se reporta por el resto de secciones (Usuarios, Mesas, Ofertas) y para que el dueño decida si quiere mantener la venta en una sola tarjeta.
- **Ofertas, chat con IA, fotos en reseñas y destacado en portada exigen la insignia además del plan**: Bloque 52 ('las dos cosas'): hoy los 3 planes de pago dan la insignia (migración 20261115000001 l.41, 61 y 82). Solo queda el riesgo latente si el admin apaga grantsBadge, reportado como baja.
- **allowPanelOrders se descarta en updatePlanConfig**: settings.controller.js l.280: el panel lo tiene toda tienda y el campo quedó obsoleto. El plan solo decide si se ofrece además el botón de WhatsApp (allowWhatsappOrders, que al apagarse fuerza PANEL en l.303-305).
- **El asistente de negocio está abierto a cualquier dueño con un límite diario**: Bloques 259 y 276. Solo el comentario de la ruta está viejo.
- **Horario obligatorio en el registro**: Bloque 171, pedido explícito. Lo que falta es respetar allowSchedules si el admin lo apaga en el Básico.
- **El plan no viaja en el JWT**: Diseño correcto: planAllows y getPlanLimit leen la base en cada petición (caché de 5 s que se invalida al guardar), así que un token viejo no conserva funciones tras bajar de plan. El personal se revalida en la base en cada petición y desactivarlo revoca sus sesiones.

### Mejoras propuestas

- Un servicio único applyPlanLimits(vendorId) que sea el único punto de entrada al cambiar de plan o configuración: recorta productos, ofertas, códigos, personal y mesas, y avisa de provincias y países. Sustituye las 13 llamadas sueltas a recalcVendorProductQuota.
- Al bajar un límite o apagar una función en AdminSubscriptions.jsx, mostrar antes de guardar cuántas tiendas quedan por encima y qué les va a pasar ('12 tiendas tienen más de 5 usuarios: se desactivarán los más nuevos').
- En Suscripción del vendedor, una tarjeta 'Uso de tu plan' con X/Y de cada límite (productos, provincias, países, mesas, usuarios, ofertas activas, códigos activos, correos del mes), leída de la misma PlanConfig que /planes (regla 3).
- Un middleware requireVendorOwner({ strict }) para todas las rutas solo del dueño, en lugar de requireRole('VENDOR').
- Una sola fuente de las secciones delegables: un endpoint GET /vendor-staff/sections, o un test que compare constants/vendorSections.js con frontend/src/lib/vendorSections.js.
- Un aviso a la tienda (adminNoticeToVendor) que liste exactamente qué quedó oculto o desactivado al bajar de plan, con un botón para elegir qué conservar.
- Quitar el import sin usar de assertPlanAllows en offers.controller.js (código muerto).
- Un helper countVendorProvinces compartido entre el admin, addMyLocation, syncVendorProvinceZone y createVendor.
- Tests de integración por plan: para cada límite max* y cada interruptor allow*, probar crear, reactivar, bajar de plan y llamar a la API directamente, a fin de cumplir las reglas 1 y 2 sin depender de la UI.

<details><summary>Notas del subagente: Límites de plan en el servidor</summary>

Resumen de límites en PlanConfig y dónde se aplican: maxProducts (createProduct, pero se salta al activar; recalcVendorProductQuota al cambiar de plan o configuración), maxProvinces (addMyLocation, syncVendorProvinceZone; no en createVendor), maxDeliveryCountries (addMyDeliveryCountry), maxMonthlyOrderEmails (solo sendManualEmail), maxStaffUsers (createMyStaff; no al reactivar ni al bajar de plan), maxTables (createTable, assertTableCountWithinPlan; no al bajar de plan), maxActiveStoreOffers (create y update de ofertas; no en lo público ni al bajar de plan), maxDiscountCodes (createDiscountCode, cuenta el total; no al reactivar ni al aplicar el código). Interruptores: allowAiChatbot, allowReviewPhotos, allowSchedules, allowAdminChat, allowPos (middleware requirePosPlan en todas las rutas de caja, bien), allowLoyalty (servicio y controlador, bien), allowCustomerEmails (lib/email.js e invoices, bien), allowWhatsappOrders (updateMyVendor, y updatePlanConfig fuerza PANEL, bien), allowPublicProfile (updateMyVendor), featuredInHome (search), allowPanelOrders (obsoleto, se descarta a propósito). offers.controller.js importa assertPlanAllows sin usarlo (código muerto). getSettings público expone las filas completas de PlanConfig, incluidas las que tienen isPublic=false; no es grave, pero /settings/plans ya filtra y conviene usar publicPlan también aquí. No revisé planBilling.service.js en detalle (estado 'limitado' por impago) porque es de otro subagente. Revisión de solo lectura: no ejecuté nada.

</details>

<details><summary>Notas del subagente: Rutas y acceso directo</summary>

Lo que está bien, para que no se reporte por error. Todas las rutas /admin pasan por router.use(authenticate, requireRole('ADMIN')). /partner-portal usa requireRole('PARTNER'). Las rutas del panel de vendedor usan requireVendorAccess/requireVendorWrite por sección, y el vendorId siempre sale de resolveMyVendor(req.user.id), nunca del cliente. Los endpoints con :staffId, :userId o :id comprueban que pertenecen a la tienda (loyalty getMemberHistory, vendorStaffSales, storeOffers, discountCodes). Los archivos KYC, de solicitudes de cambio y de comprobantes comprueban dueño o admin. createOrder toma customerId de la sesión (resolveSessionUser). El override de admin en pedidos exige role ADMIN.

Sobre los tokens: el plan NUNCA viaja en el JWT. planAllows/getPlanLimit leen PlanConfig y vendor.planType de la base en cada petición (caché de 5s que se invalida al guardar), así que un token viejo no conserva funciones del plan tras bajar. El rol sí viaja en el JWT (1h). El personal se revalida en la base (vendorStaff.isActive y allowedSections) en cada petición, y desactivar a alguien revoca sus sesiones. Tras crear la tienda, Account.jsx llama a refreshRole(). La debilidad pendiente es la suspensión manual de clientes (ver hallazgo).

En el frontend, App.jsx protege /vendedor, /admin, /socio y /cuenta/panel con ProtectedRoute por rol. Las secciones del personal se filtran y redirigen en VendorLayout, pero NO por plan (ver hallazgo).

No revisé a fondo los controladores de admin ni la API de socios (partnerApi.routes.js) más allá de sus guardias.

</details>
