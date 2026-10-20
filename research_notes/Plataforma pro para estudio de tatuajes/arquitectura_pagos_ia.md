# Arquitectura de plataforma, pagos e integración de proveedores de IA (estudios de tatuaje EE. UU. + Panamá)

> Nota metodológica (oct-2026): WebFetch estuvo bloqueado en este entorno (error DNS `ENOTFOUND` para stripe.com, docs.stripe.com, docs.x.ai) y el acceso por curl fue denegado. Todas las citas provienen de resultados de WebSearch (fragmentos y resúmenes de páginas), no de la lectura completa de las páginas. Donde un dato viene sólo de terceros se indica. Las "Inferencias" son razonamiento del investigador (en parte basado en conocimiento previo de la documentación de Stripe/Twilio/etc.) y deben verificarse antes de implementarse.

## 1. Stripe: Payment Links vs Checkout Sessions vs Invoices, depósitos, tarjetas guardadas para no-show, Terminal, webhooks, reembolsos/disputas y tarifas en EE. UU.

### Takeaway
Para enviar un link de pago por SMS/email/WhatsApp desde la plataforma, lo correcto es crear una **Checkout Session por cita** (monto exacto, metadata de booking, `setup_future_usage` para guardar la tarjeta) y enviar su URL; los Payment Links son reutilizables/genéricos y los Invoices sirven si se requiere documento con líneas y recordatorios. Tarifa estándar EE. UU.: 2.9 % + 30¢ online, 2.7 % + 5¢ presencial (Terminal), +1.5 % tarjetas internacionales, disputa US$15.

### Cited Findings
- Stripe describe Invoicing como el producto para cobrar pagos únicos o recurrentes **a un cliente específico**, y Payment Links para vender un producto/suscripción o aceptar donaciones; los Payment Links se pueden reutilizar con múltiples clientes o limitar a un número de compras, mientras que los invoices no son reutilizables (se pueden duplicar y editar) — [Stripe docs: Payment Links](https://docs.stripe.com/docs/payment-links); [Stripe Support: Choosing between Stripe Checkout UIs or Invoicing](https://support.stripe.com/questions/choosing-between-stripe-checkout-uis-or-invoicing)
- Al hacer clic en un Payment Link, Stripe abre una nueva Checkout Session para renderizar la página de pago; Checkout es la página de pago alojada (hosted) y prediseñada — [stripity_stripe: Stripe.PaymentLink](https://stripity-stripe.hexdocs.pm/Stripe.PaymentLink.html); [Stripe Support](https://support.stripe.com/questions/choosing-between-stripe-checkout-uis-or-invoicing)
- Guía de terceros: los invoices encajan cuando el comprador necesita un documento con líneas, descuentos, términos de pago en cuotas o recordatorios — [Radom: Payment links vs invoices vs checkout](https://www.radom.com/guides/payment-links-vs-invoices-vs-checkout)
- Guardar tarjeta para cargos futuros fuera de sesión exige un acuerdo previo con el cliente; los términos mínimos deben cubrir el permiso del cliente, la frecuencia esperada y cómo se determina el monto; Stripe sugiere un checkbox tipo "Save my payment method for future use" — [Stripe docs: Setup Intents](https://docs.stripe.com/payments/setup-intents.md)
- Si la tarjeta se guardó correctamente, Stripe marca los pagos posteriores fuera de sesión como **merchant-initiated transactions (MIT)**, sin re-autenticación; las MIT requieren un acuerdo entre comercio y cliente; el emisor puede de todas formas declinar o exigir autenticación (exención a discreción del emisor) y entonces el cliente debe volver on-session — [Stripe Support: on session vs off session](https://support.stripe.com/questions/what-is-the-difference-between-on-session-and-off-session-and-why-is-it-important); [Stripe docs: Setup Intents](https://docs.stripe.com/payments/setup-intents.md)
- `usage` en SetupIntent: por defecto `off_session` (cliente puede o no estar presente), `on_session` sólo para reuso dentro del checkout — [Stripe API: Create a SetupIntent](https://edge-docs.stripe.com/api/setup_intents/create)
- Stripe tiene una **Off-Session Payments API (v2, preview)** que reemplaza crear PaymentIntents con `off_session=true` para transacciones recurrentes y no programadas iniciadas por el comercio — [Stripe docs: Migrate from Payment Intents to the Off-Session Payments API](https://docs.stripe.com/payments/off-session-payments/migrate-from-payment-intents)
- Tarifas EE. UU. (snapshot de la página de precios de Stripe del 15-oct-2026 vía terceros): 2.9 % + 30¢ por cargo online exitoso, sin cuota mensual — [DevToolLab](https://devtoollab.com/blog/stripe-alternatives); [Dodo Payments](https://dodopayments.com/blogs/stripe-fees-calculator)
- Tarjetas internacionales +1.5 % (total 4.4 % + 30¢) y +1 % adicional por conversión de moneda (hasta 5.4 % + 30¢) — [toolradar](https://toolradar.com/tools/stripe/pricing); [Eightx](https://eightx.co/blog/compare/how-much-does-stripe-cost). Un blog de 2023 citaba 1 %, ya desactualizado — [inai.io](https://inai.io/blog/stripes-fee-hike-and-dispute-policy-change). Conflicto: SwipeSum lista 3.1 % + 30¢ + 1.5 % para internacional — [SwipeSum](https://swipesum.com/insights/guide-to-stripe-fees-rates-for-2025)
- Terminal (presencial): 2.7 % + 5¢ — [toolradar](https://toolradar.com/tools/stripe/calculator); [DevToolLab](https://devtoollab.com/blog/stripe-alternatives)
- Disputas: US$15; conflicto entre fuentes: toolradar dice que se cobra ganes o pierdas; DevToolLab describe una tarifa "dispute-received" de US$15 más una "dispute-countered" de US$15 que se devuelve sólo si se gana — [toolradar](https://toolradar.com/tools/stripe/pricing); [DevToolLab](https://devtoollab.com/blog/stripe-alternatives)
- Tap to Pay corre sobre los SDK de Stripe Terminal para iOS y Android, acepta las principales redes y wallets NFC; Panamá no aparece en la lista de países de Tap to Pay on iPhone de la página regional — [Stripe AU: Tap to Pay](https://stripe.com/au/terminal/tap-to-pay); Android Tap to Pay se lanzó en 2023 — [TechRadar](https://www.techradar.com/news/stripe-will-now-let-merchants-accept-tap-to-pay-via-android-devices)

### Inferencias
- Patrón recomendado de depósito + saldo: (1) al reservar, Checkout Session `mode=payment` por el depósito con `payment_intent_data.setup_future_usage=off_session` y `customer` creado → guarda la tarjeta con consentimiento (texto de política de no-show/cancelación visible y aceptado); (2) saldo el día de la cita vía Terminal/Tap to Pay en el estudio, o un nuevo link; (3) no-show → PaymentIntent off-session (o la nueva Off-Session Payments API) sobre la tarjeta guardada, por el monto declarado en la política. Alternativa: SetupIntent puro (Checkout `mode=setup`) si no se cobra depósito.
- Para no-show, guardar evidencia (timestamp de aceptación, texto exacto de la política, IP, versión) para defender disputas; el cargo debe coincidir con lo informado.
- Las URLs de Checkout Session expiran (por defecto 24 h según la documentación de Stripe conocida previamente — verificar); para links enviados con días de antelación regenerarlas bajo demanda (link corto propio → endpoint que crea/reusa la sesión).
- Stripe no envía SMS/WhatsApp por sí mismo; la plataforma envía la URL vía Twilio/WhatsApp/Resend.
- Webhooks mínimos a manejar (de conocimiento previo, verificar): `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`/`payment_failed`, `setup_intent.succeeded`, `charge.refunded`, `charge.dispute.created/closed`, `invoice.paid`, `account.updated` (Connect). Verificar firma (`Stripe-Signature`), idempotencia por `event.id`, procesamiento asíncrono en cola.
- Reembolsos: parciales permitidos vía Refunds API; definir en la política si el depósito es no reembolsable. Según conocimiento previo, Stripe no devuelve la comisión de procesamiento en reembolsos (verificar).

### Gaps
- No se pudo leer stripe.com/pricing directamente; las cifras provienen de snapshots de terceros. Confirmar Tap to Pay fees, Invoicing (0.4–0.5 %?) y Payment Links (sin coste extra?) en la página oficial.
- No se encontró guía oficial de Stripe específica sobre cargos por no-show ni reglas de red (Visa/Mastercard) aplicables a "no-show fees" fuera de hotelería.
- No se verificó la duración de expiración de Checkout Sessions ni la lista completa de eventos de webhook.

## 2. ¿Stripe disponible en Panamá? Opciones para el estudio de Panamá (USD)

### Takeaway
Stripe **no** ofrece cuentas de comercio para empresas constituidas en Panamá (no está entre los ~46 países soportados). Opciones: (a) cobrar el estudio de Panamá desde la cuenta Stripe de la entidad de EE. UU. (riesgo legal/fiscal y de términos de servicio si la operación es panameña), (b) Stripe Atlas/LLC de EE. UU., o (c) un procesador local (Tilopay, PagueloFacil, BAC Credomatic) + Yappy, que es casi obligatorio en Panamá.

### Cited Findings
- La página de Stripe para negocios globales habla de disponibilidad para empresas en 46 países; Panamá no aparece en la parte visible de la lista; otra guía de 2025 también cuenta 46 países — [Stripe: global businesses](https://stripe.com/en-gb-de/use-cases/global-businesses); [Red Stag Fulfillment](https://redstagfulfillment.com/how-many-countries-does-stripe-operate-in/); [CS-Cart](https://www.cs-cart.com/blog/stripe-supported-countries/)
- Fuentes de terceros más antiguas/menos fiables afirman que desde Panamá se puede abrir cuenta, o que hay que constituir una LLC en EE. UU. — [LinkedIn (2024)](https://www.linkedin.com/pulse/how-open-stripe-account-panama-mazino-oyolo-2mxrf); [Zenind](https://www.zenind.com/help/post/how-to-open-a-stripe-account-from-panama-a-practical-guide-for-founders) (vendedor de LLC; recomienda LLC de EE. UU. como workaround); [Foundeck](https://foundeck.com/blog/stripe-for-unsupported-countries/)
- Panamá aparece en listas de terceros como país de **payouts** (no de comercio): Mercor, Bandcamp, Remote (pagos en USD a contratistas) — [Mercor](https://talent.docs.mercor.com/policies/supported-countries); [Bandcamp](https://get.bandcamp.help/en/articles/15263225-which-countries-are-supported-by-stripe-payments); [Remote](https://support.remote.com/hc/en-us/articles/7046120384909-Stripe-Connect-Country-Availability-for-Local-Currency-Payouts)
- Stripe Atlas forma una Delaware C-corp para fundadores no estadounidenses de forma remota; cuota única reportada de US$500 (incluye incorporación, EIN y cuenta Stripe de EE. UU.) según fuente secundaria — [Stripe blog: Atlas updates](https://stripe.com/blog/atlas-updates); [WP Simple Pay](https://wpsimplepay.com/is-stripe-atlas-worth-the-money/); [unil.ink: Stripe Atlas in 2026](https://unil.ink/help-center/articles/stripe-atlas-2026)
- **Yappy** (Banco General) puede integrarse en tiendas online vía Tilopay; volumen ~US$9.5 mil millones (cifra 2023) — [Tilopay blog: Yappy y e-commerce](https://tilopay.com/en/blog/conectar-yappy-con-tu-plataforma-de-ecommerce). Yappy Comercial cobra 1 % + ITBMS por transacción recibida; el "Botón de Pago" usa credenciales por comercio — [Tiendli: Yappy para negocios 2026](https://tiendli.com/pa/guias/yappy-para-negocios-panama)
- **Tilopay** (Costa Rica): sin costes fijos ni mensualidades (marketing), soporta Yappy, cuotas BAC y Clave en Panamá; pago on-site sin redirección; tarifas aproximadas 4–5.5 % + fijo (dato de comparativa de Costa Rica); aprobación 24–48 h — [Tilopay](https://tilopay.com/en); [BigCommerce: Tilopay Payment Methods](https://support.bigcommerce.com/s/article/Tilopay-Payment-Methods?language=en_US); [PressCompare](https://presscompare.com/plugin/ecommerce-sales/payment-processing-gateways/tilopay); [Koderz CR](https://koderzcr.com/batalla-de-pasarelas-en-costa-rica-tilopay-vs-bac-credomatic-vs-pixelpay-analisis-para-desarrolladores/)
- **PagueloFacil**: ~3.5 % + US$0.50 por transacción, +1 % tarjetas internacionales, US$1 por retiro bancario; acepta Visa, Mastercard, Clave y Yappy; ofrece botón de pago, **links de pago** y facturación electrónica — [NOWPayments: payment gateways Panama 2026](https://nowpayments.io/blog/payment-gateways-panama); [RG Media Manager](https://rgmediamanager.com/ecommerce-negocios/1668/pasarela-de-pago-un-componente-vital-para-que-tu-tienda/)
- **BAC Credomatic**: adquirente bancario directo, fondos a cuenta bancaria, requisitos de afiliación más estrictos, ~2.5–4 % (estimación en contexto Costa Rica), onboarding de semanas — [Koderz CR](https://koderzcr.com/batalla-de-pasarelas-en-costa-rica-tilopay-vs-bac-credomatic-vs-pixelpay-analisis-para-desarrolladores/); [Wikipedia: BAC Credomatic](https://en.wikipedia.org/wiki/BAC_Credomatic)

### Inferencias
- Panamá usa el USD (balboa a la par) → no hay conversión de moneda: el modelo de datos puede usar `currency='USD'` en ambos países, pero conviene guardar `currency` por transacción igualmente (futuro, y porque los clientes turistas pagan con tarjetas extranjeras). Para Stripe EE. UU., una tarjeta panameña es "internacional" (+1.5 %), aunque sin el +1 % de conversión si se cobra en USD.
- Cobrar servicios prestados en Panamá con la cuenta Stripe de la LLC de EE. UU. es técnicamente posible, pero implica: ingresos de una operación panameña facturados por una entidad de EE. UU. (tema fiscal/ITBMS, facturación electrónica panameña obligatoria), y posible conflicto con los términos de Stripe sobre dónde opera el negocio. Requiere asesoría contable/legal; no se encontró fuente que lo valide.
- Diseño recomendado: capa de abstracción `PaymentProvider` por estudio (`stripe_us` para estudios de EE. UU.; `tilopay`/`paguelofacil` + `yappy` para Panamá), con interfaz común: `createPaymentLink(amount, booking)`, `webhookHandler`, `refund`, `saveCard?` (capacidad opcional: no todos los procesadores locales soportan tokenización para no-show).
- PayPal y dLocal son alternativas plausibles (dLocal es más para empresas que cobran a LatAm a gran escala) — sin verificar en esta investigación.

### Gaps
- No se pudo confirmar en la página oficial stripe.com/global la lista de países 2026 (bloqueo de fetch).
- No se encontró documentación oficial de API de Yappy, PagueloFacil, Tilopay ni BAC (tokenización, webhooks, links de pago, cargos sin presencia del cliente). Tampoco se verificaron PayPal Panamá ni dLocal.
- Las tarifas de procesadores panameños provienen de blogs/agregadores y se contradicen.

## 3. Stripe Connect: ¿artistas como cuentas conectadas para split de comisión? Express vs Standard, disponibilidad en Panamá

### Takeaway
Viable para artistas en EE. UU. (Express o configuración con "controller properties", destination charges + `application_fee_amount`/`transfer_data`), pero añade coste, complejidad de KYC y de 1099; para artistas en Panamá no hay payouts transfronterizos self-serve desde una plataforma de EE. UU. Para un negocio con un solo dueño, probablemente es más simple pagar comisiones por nómina/transferencia con un ledger interno.

### Cited Findings
- Stripe ahora recomienda configurar cuentas conectadas con **controller properties** en lugar de las etiquetas Standard/Express/Custom (que son paquetes legacy); una propiedad define quién paga las comisiones de Stripe: `account` (la cuenta conectada) o `application` (la plataforma) — [Stripe docs: Migrate to controller properties](https://docs.stripe.com/connect/migrate-to-controller-properties); [Stripe docs: Connect account types](https://docs.stripe.com/connect/accounts)
- Express: Stripe gestiona onboarding/verificación, la plataforma define tipos de cargo y payouts, y asume disputas/reembolsos; dashboard Express simplificado; coste adicional. Standard: la cuenta conectada asume fraude/disputas en direct charges, menor esfuerzo de integración y menor responsabilidad para la plataforma; el tipo no se puede cambiar tras crearse — [Stripe docs: Connect account types](https://docs.stripe.com/connect/accounts); [DEV: Standard vs Express vs Custom](https://dev.to/stripe/standard-vs-express-vs-custom-account-types-for-stripe-connect-386j)
- Destination charges (fondos vía `transfer_data.destination`) cuando la plataforma acepta la responsabilidad por saldos negativos; direct charges cuando el riesgo recae en la cuenta conectada (fuente de terceros) — [skills.sh: stripe-connect](https://skills.sh/zef-computers/drivers/stripe-connect)
- Payouts transfronterizos: plataformas en EE. UU., Reino Unido, EEE, Canadá y Suiza pueden transferir a cuentas conectadas en esas mismas regiones; Stripe no soporta payouts transfronterizos self-serve fuera de ellas — [Stripe docs: Cross-border payouts](https://docs.stripe.com/connect/cross-border-payouts)
- Stripe permite **payouts en stablecoins** a individuos en Panamá desde plataformas de EE. UU. (vía Transfers API) — [Stripe docs: Crypto payouts](https://docs.stripe.com/connect/crypto-payouts)
- Una lista de terceros (Elgato, a 1-abr-2026) incluye Panamá entre los países de Stripe Connect, sin precisar si es transfronterizo — [Elgato docs: Stripe Connect](https://docs.elgato.com/monetization/stripe)

### Inferencias
- Pros de Connect para artistas: split automático, el artista ve sus cobros, la plataforma no custodia fondos ajenos, Stripe emite 1099-K/1099 (según configuración). Contras: coste por cuenta activa (Express), onboarding KYC de cada artista, muchos tatuadores son contratistas que prefieren cobrar en efectivo/propinas, artistas que trabajan en varios estudios/países complican quién es la "cuenta"; los de Panamá quedan fuera (salvo stablecoins o acuerdo con ventas de Stripe).
- Recomendación de diseño: modelar `commission_rules` (porcentaje por artista/estudio/servicio) y un `ledger` interno de comisiones desde el día 1; dejar Connect como integración opcional `payout_method = stripe_connect | manual | payroll` por artista.

### Gaps
- No se verificó el precio actual de Express (históricamente US$2/cuenta activa/mes + 0.25 % + 25¢ por payout — conocimiento previo, no confirmado) ni el comportamiento actual de `application_fee_amount` en destination charges.

## 4. Pagos por teléfono: PCI DSS, por qué los agentes de IA deben enviar links, Twilio `<Pay>`

### Takeaway
Si un agente de voz de IA escucha/transcribe números de tarjeta, el modelo, transcripciones, grabaciones y logs entran en alcance PCI DSS. Enviar un link de pago (Stripe Checkout o del procesador local) por SMS/WhatsApp mantiene el sistema fuera de alcance (probable SAQ A, a confirmar con el adquirente). Twilio `<Pay>` es la alternativa para capturar por DTMF dentro de la llamada, pero requiere activar PCI Mode (irreversible, en toda la cuenta).

### Cited Findings
- Los links de pago sacan los datos de tarjeta del sistema telefónico; el cuestionario ligero (SAQ A) es para comercios cuyo entorno nunca toca datos de tarjeta; puede aplicar SAQ A o SAQ B-IP y lo confirma el banco adquirente (fuentes de proveedor) — [Paytia: SMS payments](https://www.paytia.com/solutions/sms-payments); [Paytia: How it works](https://www.paytia.com/us/how-it-works); [Paytia blog 2026](https://www.paytia.com/resources/blog/take-card-payments-over-phone-securely)
- Cuando el cliente dicta el número, el agente lo oye, la grabación y las notas lo capturan, y los tres sistemas entran en alcance PCI; si la grabación captura la parte del pago y no se eliminan los tonos DTMF, contiene datos de tarjeta — [Paytia blog](https://www.paytia.com/resources/blog/how-to-accept-credit-card-payments-by-phone); [Paytia: DTMF](https://www.paytia.com/glossary/dtmf)
- Tomar pagos por Twilio (IVR, asistido por agente o agentes de voz IA) conlleva obligaciones PCI — [Shuttle: Twilio PCI compliance](https://www.shuttleglobal.com/guides/twilio-pci-compliance/)
- `<Pay>` permite aceptar pagos por teléfono conformes a PCI DSS sin construir infraestructura PCI propia — [Twilio blog: Pay GA](https://www.twilio.com/en-us/blog/pay-generally-available)
- Para usar Pay Connectors hay que activar **PCI Mode**, que redacta datos sensibles de TODOS los logs de la cuenta y **no se puede deshacer**; se sugiere usar una cuenta/subcuenta Twilio separada para pagos — [Twilio docs: How to capture your first payment using <Pay>](https://www.twilio.com/docs/voice/tutorials/how-capture-your-first-payment-using-pay.md)
- Existe un **Stripe Pay Connector**; con nombre "Default" no hace falta el atributo `paymentConnector`; con varios conectores se elige con `paymentConnector` — [Twilio docs](https://twilio.com/docs/voice/tutorials/how-capture-your-first-payment-using-pay); [Twilio: Pay Connectors](https://live.docs.dev.twilio.com/docs/voice/twiml/pay/pay-connectors.md)
- Según terceros, Stripe es el único conector soportado por el widget "Capture Payments" de Twilio Studio, y usar `<Pay>` no hace por sí solo PCI-compliant al comercio — [Shuttle: Twilio Stripe Pay connector](https://www.shuttleglobal.com/guides/twilio-stripe-pay-connector/)

### Inferencias
- Regla de diseño: el agente IA (voz o chat) nunca pide ni acepta datos de tarjeta; tiene una herramienta `send_payment_link(booking_id, channel)` que crea la sesión y la envía. Añadir filtro de PAN (regex Luhn) en transcripciones/logs como defensa en profundidad, por si el cliente dicta el número espontáneamente; no grabar segmentos de pago.
- `<Pay>` sólo encaja para EE. UU. con Stripe; para Panamá no hay conector conocido para Tilopay/PagueloFacil → link de pago.

### Gaps
- No se encontró guía oficial del PCI SSC específica sobre agentes de voz IA; no se leyó el documento "Protecting Telephone-Based Payment Card Data" del PCI SSC (fetch bloqueado).

## 5. Modelo de datos multi-tenant / multi-ubicación, zonas horarias, moneda, roles y auditoría

### Takeaway
Un solo tenant (organización) con jerarquía Organization → Country/Legal entity → Studio, artistas vinculados a varios estudios por tabla puente, clientes a nivel organización, horarios guardados en UTC con zona IANA por estudio (`America/New_York` etc. y `America/Panama`, que no tiene horario de verano), RBAC con alcance por estudio y log de auditoría append-only.

### Cited Findings
- No se encontraron fuentes específicas en esta investigación (límite de búsquedas); esta sección es mayormente diseño propio. Lo único citable relacionado: la elección de proveedor de pago debe ser por país/estudio porque Stripe no da cuentas de comercio en Panamá — [Stripe: global businesses](https://stripe.com/en-gb-de/use-cases/global-businesses)

### Inferencias (propuesta de esquema)
- `organization` (id, nombre, owner_user_id) — una sola fila hoy, pero mantener `org_id` en todas las tablas permite SaaS futuro y Row Level Security (Postgres RLS / Supabase).
- `legal_entity` (org_id, country_code ISO-3166 `US`/`PA`, razón social, tax_id, currency_default `USD`, payment_provider_account_id).
- `studio` (legal_entity_id, nombre, dirección, `timezone` IANA, `currency`, `locale` es-PA/en-US, settings JSONB: depósito %, política de no-show, horario de apertura, impuestos (sales tax estatal vs ITBMS 7 % — verificar), plantillas de mensajes, proveedor de pagos).
- `user` (identidad única, email/teléfono, auth) + `membership` (user_id, org_id, studio_id NULL=toda la org, role) → un artista con membresías en 2 estudios; un manager con alcance a un estudio.
- `artist_profile` (user_id, bio, estilos, portfolio) + `artist_studio` (artist_id, studio_id, comisión %, días disponibles, activo desde/hasta) para guest spots.
- `client` a nivel org (compartido entre estudios), con `client_studio_stats` o vistas; consentimientos (marketing SMS/WhatsApp TCPA, firma de waiver, menor de edad) por país.
- `service`, `appointment` (studio_id, artist_id, client_id, `starts_at timestamptz` en UTC, `duration`, estado, depósito requerido), `availability_rule` (recurrencia en hora local del estudio + timezone para que DST se resuelva bien), `time_off`.
- `payment` (provider, provider_ref, amount_cents, currency, tipo deposit/balance/no_show/tip/refund, appointment_id), `payment_method_saved` (provider customer id + pm id, nunca PAN), `commission_ledger`.
- `audit_log` append-only (actor_user_id, actor_type user/ai_agent/system, org_id, studio_id, action, entity, entity_id, before/after JSONB, ip, user_agent, created_at); sin UPDATE/DELETE para el rol de la app; registrar especialmente cambios de precios, reembolsos, lectura/rotación de API keys y cambios de permisos.
- Roles: `owner/super_admin` (todo, todas las entidades, claves API, facturación), `studio_manager` (su estudio: agenda, staff, reportes, reembolsos hasta un umbral), `receptionist` (agenda, clientes, cobros, sin reportes financieros ni claves), `artist` (su agenda, sus clientes/citas, sus comisiones), `client` (portal: sus citas, pagos, fotos de referencia). Implementar como permisos granulares (`appointment:write`, `refund:create`, `secrets:manage`) asignados a roles, evaluados con el `studio_id` del recurso.
- Zonas horarias: EE. UU. usa varias (Eastern/Central/Mountain/Pacific con DST); `America/Panama` es UTC-5 todo el año sin DST, por lo que en verano coincide con Central y en invierno con Eastern. Mostrar siempre en la zona del estudio, no la del navegador del admin (el dueño puede estar en otro país).
- Moneda: ambos en USD hoy; guardar montos en centavos enteros + `currency`.

### Gaps
- No se buscaron fuentes sobre tasa de ITBMS aplicable a servicios de tatuaje, ni normas de sales tax por estado para servicios de tatuaje, ni reglas TCPA/consentimiento de WhatsApp.

## 6. Almacenamiento seguro de API keys de terceros configuradas desde el panel admin

### Takeaway
Usar cifrado de sobre (envelope encryption): una KEK en KMS (AWS KMS / Google Cloud KMS), una DEK por secreto generada con `GenerateDataKey`, cifrado local AES-256-GCM con contexto de cifrado (org/studio/proveedor/entorno) como AAD; en la UI sólo mostrar valores enmascarados, nunca devolver el secreto al frontend; botón "probar conexión" que ejecuta en el backend; separar test/live.

### Cited Findings
- El cifrado simétrico de AWS KMS usa AES-GCM con claves de 256 bits; GCM añade una etiqueta de autenticación sobre el texto cifrado y cualquier dato autenticado adicional — [AWS KMS cryptography essentials](https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html)
- `GenerateDataKey`: AWS no retiene el texto plano ni el cifrado de la data key; no se puede recuperar sin el texto cifrado, el encryption context y autorización sobre la clave KMS; la gestión del ciclo de vida de las data keys queda en la aplicación; AWS recomienda el AWS Encryption SDK para cifrado del lado del cliente — [AWS KMS: Generating data keys](https://docs.aws.amazon.com/kms/latest/cryptographic-details/generating-data-keys.html)
- Flujo estándar: llamar `GenerateDataKey`, cifrar localmente con AES-256-GCM, guardar la DEK cifrada junto al texto cifrado y descartar la DEK en claro; política de clave KMS que restrinja quién llama `GenerateDataKey`/`Decrypt`, logging en CloudTrail y backoff exponencial ante throttling (fuentes de terceros) — [claudemarket skill](https://www.claudemarket.ai/skills/mukul975/implementing-envelope-encryption-with-aws-kms); [claudeskills.info](https://claudeskills.info/zh-hant/skills/mukul975/Anthropic-Cybersecurity-Skills/implementing-envelope-encryption-with-aws-kms/)
- El encryption context permite vincular metadatos (p. ej. propósito e ID de recurso) a la operación de clave — [OneUptime: KMS envelope encryption (2026)](https://oneuptime.com/blog/post/2026-02-12-kms-envelope-encryption/markdown)
- Twilio PCI Mode redacta todos los logs de la cuenta y es irreversible → usar cuenta Twilio separada para pagos (afecta a cómo se modelan las credenciales Twilio: puede haber 2 juegos) — [Twilio docs](https://www.twilio.com/docs/voice/tutorials/how-capture-your-first-payment-using-pay.md)

### Inferencias (diseño)
- Tabla `integration_credential` (org_id, studio_id NULL=global, provider `twilio|elevenlabs|resend|stripe|xai|nvidia|gemini|...`, environment `test|live`, label, `ciphertext`, `iv/nonce`, `auth_tag`, `encrypted_dek`, `kms_key_id`, `key_version`, `last4`, `fingerprint` (HMAC para detectar duplicados), status, last_tested_at, last_test_result, created_by, rotated_at). Encryption context/AAD = `{org_id, credential_id, provider, environment}` para que un ciphertext copiado a otra fila no descifre.
- Alternativa sin KMS gestionado: libsodium `crypto_secretbox`/`crypto_aead_xchacha20poly1305` con una master key en el gestor de secretos del hosting; o directamente AWS Secrets Manager / GCP Secret Manager / Supabase Vault (pgsodium) guardando sólo la referencia en la BD.
- UI: campo write-only; tras guardar mostrar `sk_live_••••••••abcd`, fecha y autor; "Reemplazar" en lugar de "Ver"; reautenticación (step-up/MFA) para ver/editar secretos; sólo rol owner/super_admin; cada acceso o cambio → `audit_log`.
- Test-connection: endpoint backend que descifra en memoria y hace una llamada barata e inocua (Stripe `GET /v1/balance` o `/v1/account`; Twilio `GET /Accounts/{sid}`; Resend listar dominios; xAI/NVIDIA/Gemini `GET /models`), devolviendo sólo OK/error.
- Rotación: (a) rotación de KEK en KMS (automática anual; los ciphertext antiguos siguen descifrando), (b) rotación de la credencial del tercero: permitir 2 versiones activas (primaria/secundaria) durante la transición, (c) re-wrap de DEKs con job en cola.
- Separación test/live: claves `sk_test_`/`sk_live_` de Stripe nunca en la misma fila; entornos staging/prod con KMS keys distintas; el selector de entorno visible en el panel; webhooks con secretos de firma separados por entorno.
- Los webhook signing secrets (Stripe `whsec_`, Twilio auth token para validar firma) también son secretos a guardar con el mismo mecanismo.

### Gaps
- No se consultó documentación de Google Cloud KMS, Supabase Vault ni guías multi-tenant de KMS (una KMS key por tenant vs una con contexto) — búsqueda no cubrió esos temas.

## 7. Capa de abstracción de proveedores de IA (xAI Grok, NVIDIA NIM, Gemini), registro de modelos actualizable, fallback, asignación por tarea, costes y librerías

### Takeaway
Los tres proveedores exponen endpoints compatibles con OpenAI (`https://api.x.ai/v1`, `https://integrate.api.nvidia.com/v1`, `https://generativelanguage.googleapis.com/v1beta/openai/`) y todos tienen algún listado de modelos, por lo que una capa común basada en el protocolo OpenAI (o Vercel AI SDK con `createProviderRegistry`) más un registro de modelos en BD (sincronizable con `/models` pero editable a mano: habilitar, precio, capacidades, tarea asignada, cadena de fallback) es el diseño adecuado.

### Cited Findings
- **xAI**: la documentación muestra el SDK de OpenAI apuntando a `https://api.x.ai/v1` con clave xAI; el proveedor xAI del Vercel AI SDK usa ese prefijo por defecto — [docs.x.ai: overview](https://docs.x.ai/overview); [AI SDK: xAI Grok provider](https://ai-sdk.dev/providers/ai-sdk-providers/xai)
- xAI: la página de modelos de la consola y `GET https://us.api.x.ai/v1/models` muestran la lista actual; en el endpoint regional US sólo están disponibles grok-4.7 y grok-4.6 y otros modelos (incluido `grok-latest`) devuelven 404 — [docs.x.ai: Regional Endpoints](https://docs.x.ai/developers/advanced-api-usage/regions)
- xAI: grok-4.7 es el modelo insignia con ventana de contexto de 500k tokens; el AI SDK lista también grok-4.6, grok-4.5 y variantes grok-4.20 y grok-4-1 — [docs.x.ai: overview](https://docs.x.ai/overview); [AI SDK: xAI](https://ai-sdk.dev/providers/ai-sdk-providers/xai). Nota: algunos resultados muestran la marca "SpaceXSI" en x.ai/api — [x.ai/api](https://x.ai/api) (no se pudo aclarar el cambio de marca).
- Un blog (Latenode) da `https://api.grok.xai.com/v1`, que contradice la documentación oficial y trata de Grok 3 → descartar — [Latenode](https://latenode.com/blog/complete-guide-to-xais-grok-api-documentation-and-implementation)
- **NVIDIA**: API compatible con OpenAI en `https://integrate.api.nvidia.com/v1`, clave (`nvapi-…`) obtenida en build.nvidia.com, modelos abiertos gratuitos (fuentes de terceros) — [OpenClaw docs: NVIDIA provider](https://docs.openclaw.ai/providers/nvidia); [NVIDIA API Catalog Quickstart](https://docs.api.nvidia.com/nim/docs/api-quickstart); [pasqualepillitteri.it: NVIDIA Build API 100+ modelos (2026)](https://pasqualepillitteri.it/pt/news/1628/nvidia-build-api-gratuita-100-modelos-ia-2026)
- NVIDIA: OpenClaw obtiene el catálogo de modelos destacados de `https://assets.ngc.nvidia.com/products/api-catalog/featured-models.json` (feed JSON público, distinto de `/v1/models`) — [OpenClaw docs: NVIDIA](https://docs.openclaw.ai/providers/nvidia)
- NVIDIA NeMo Guardrails (microservicio self-hosted) expone `GET /v1/guardrail/models` con estructura de lista OpenAI — [NVIDIA NeMo microservices docs](https://docs.nvidia.com/nemo/microservices/25.9.0/guardrails/manage-models.html)
- **Gemini**: la capa de compatibilidad OpenAI se usa con `base_url` `.../v1beta/openai/`; el ejemplo REST lista modelos con `GET /v1beta/openai/models` y Bearer key — [Gemini API: OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai?authuser=1); [ai.google.dev/api/compatibility](https://ai.google.dev/api/compatibility)
- Gemini: un hilo del foro reporta que el listado de modelos vía capa OpenAI devolvió 501 Unimplemented (sin fecha ni resolución); el endpoint nativo `v1beta/models` es el fallback — [Google AI forum](https://discuss.ai.google.dev/t/gemini-openai-compatible-api-list-models-returns-501-unimplemented/70163); [Bifrost: list models Gemini format](https://docs.getbifrost.ai/api-reference/genai-integration/list-models-gemini-format.md)
- Gemini: ejemplo de ID actual `gemini-3.1-pro-preview` (fuente secundaria; leer la lista en vivo antes de fijar IDs) — [Novita blog](https://blogs.novita.ai/gemini-pro-api/)
- **Vercel AI SDK**: `createProviderRegistry()` da un registro central con identificadores `providerId:modelId`; el proveedor OpenAI-compatible reenvía provider options en el body — [Qveris: Vercel AI SDK multiple providers](https://qveris.ai/guides/vercel-ai-sdk-multiple-providers); [Cortecs: Vercel AI SDK](https://docs.cortecs.ai/integration-examples/tooling/vercel-ai-sdk)
- Fallback: el paquete `ai-gateway-provider` (`createAiGateway()`) acepta un array de proveedores con fallback automático e incluye adaptador OpenRouter; el paquete `ai-fallback` reintenta con el siguiente modelo de la lista — [ai-gateway-provider README](https://cdn.jsdelivr.net/npm/ai-gateway-provider@3.2.0/README.md); [DEV: ai-fallback](https://dev.to/simplr_sh/stop-worrying-about-llm-downtime-build-resilient-ai-apps-with-ai-fallback-1bkc)
- Recomendación (guía de proveedor): asignar la política de enrutamiento/reintentos a una sola capa y comparar contabilidad de tokens, atribución de coste y finish reasons entre rutas; Portkey ofrece fallback y dashboard con costes, tokens y latencia — [Qveris](https://qveris.ai/guides/vercel-ai-sdk-multiple-providers); [Portkey blog](https://blog.portkey.ai/blog/vercel-ai-sdk-integration)

### Inferencias (diseño del registro)
- Tablas: `ai_provider` (id `xai|nvidia|gemini|openrouter|...`, base_url, protocolo `openai_compat|gemini_native`, credential_id → `integration_credential`, enabled, health_status). `ai_model` (provider_id, model_id remoto, display_name, enabled, deprecated, capabilities JSONB {text, vision, tools, json_mode, streaming, context_window}, precio input/output por 1M tokens (editable a mano: los `/models` no siempre traen precio), source `synced|manual`, last_seen_at). `ai_task_assignment` (task: `chatbot`, `voice_agent`, `design_description`, `review_reply`, `social_caption`, …; studio_id NULL=global; primary_model_id; fallback_model_ids ordenados; temperature, max_tokens, system_prompt_version). `ai_usage_log` (task, model, provider, input/output tokens, coste calculado, latencia, success/error, fallback_used, appointment/client ref, studio_id).
- Job "Sincronizar modelos": llama `/models` de cada proveedor, inserta nuevos como `enabled=false`, marca los desaparecidos como `deprecated` (no los borra, para no romper asignaciones); el admin habilita/deshabilita y fija precios. Para xAI ojo con endpoints regionales que exponen subconjuntos; para Gemini usar el endpoint nativo si el compat falla; para NVIDIA, el feed `featured-models.json` o `/v1/models` (verificar).
- Fallback: por tarea, ante 429/5xx/timeout pasar al siguiente modelo; no hacer fallback ante errores 4xx de validación/contenido; circuit breaker por proveedor con estado en Redis.
- Voz: para el agente de voz la latencia manda; asignar modelos rápidos y no encadenar demasiados fallbacks (cada intento suma latencia).
- Opciones de librería: (1) Vercel AI SDK (TypeScript, proveedores oficiales xAI/Google y `openai-compatible` para NVIDIA, registry, streaming, tools) — opción natural si el stack es Next.js/Node; (2) LiteLLM proxy (Python, router con fallbacks y cost tracking, se despliega como servicio aparte); (3) OpenRouter como agregador (una sola clave, facturación unificada, pero añade intermediario/margen y dependencia). Recomendación: AI SDK en el backend + registro propio en BD; OpenRouter como proveedor adicional opcional de último fallback.

### Gaps
- No se verificaron: si `GET https://integrate.api.nvidia.com/v1/models` devuelve lista; precios actuales de grok-4.7/4.6 ni de modelos Gemini 3.x; documentación de router/fallback y cost tracking de LiteLLM ni de usage accounting de OpenRouter (búsqueda no los cubrió); aclaración de la marca "SpaceXSI".

## 8. Stack moderno recomendado, hosting y subida de archivos con URLs firmadas

### Takeaway
Stack TypeScript de extremo a extremo: Next.js (panel admin + portal de clientes) con un backend Node (route handlers o NestJS/Fastify para la API y webhooks), PostgreSQL (Supabase o Neon/RDS) con Drizzle o Prisma, Redis + cola (BullMQ) para recordatorios programados y jobs de webhooks, almacenamiento de objetos S3-compatible (S3/R2/Supabase Storage) con URLs firmadas para fotos de referencia. Vercel AI SDK encaja de forma nativa.

### Cited Findings
- Vercel AI SDK tiene proveedores para xAI y registro multi-proveedor, lo que favorece un backend TypeScript/Node — [AI SDK: xAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/xai); [Qveris](https://qveris.ai/guides/vercel-ai-sdk-multiple-providers)
- No se encontraron en esta investigación fuentes específicas sobre Supabase, Prisma vs Drizzle, BullMQ ni URLs firmadas (límite de búsquedas).

### Inferencias
- Backend: monolito modular (módulos: identidad/RBAC, agenda, clientes, pagos con adaptadores por país, mensajería Twilio/WhatsApp/Resend, IA, secretos, auditoría). NestJS si el equipo quiere estructura; si no, Next.js route handlers + un worker Node aparte para colas. Los webhooks (Stripe, Twilio, procesadores de Panamá) deben responder rápido y encolar.
- Base de datos: PostgreSQL con `timestamptz`, RLS por `org_id`/`studio_id` si se usa Supabase; Drizzle (SQL-first, ligero, bueno en edge) o Prisma (DX, migraciones) — ambos válidos.
- Recordatorios: jobs programados (24 h / 2 h antes de la cita, en la zona del estudio) en BullMQ/Redis o colas gestionadas (Inngest, Trigger.dev, QStash, pg-boss si se quiere evitar Redis); reprogramar al mover citas; idempotencia.
- Fotos de referencia: subida directa del navegador a bucket privado con URL prefirmada (PUT, expiración corta, límite de tamaño/MIME), luego registro en BD; descarga con URLs firmadas de corta duración; generar miniaturas en worker; eliminar EXIF/GPS; políticas de retención por consentimiento. Las fotos del portfolio pueden ir a bucket público/CDN.
- Hosting: Vercel (frontend) + Render/Railway/Fly/AWS para worker y Redis; o todo en AWS. Región US-East minimiza latencia tanto para EE. UU. como para Panamá (UTC-5). Los agentes de voz (Twilio Media Streams/ConversationRelay) requieren servidor con WebSockets persistentes, no funciones serverless cortas.
- Observabilidad: Sentry + logs estructurados con redacción de PII/PAN.

### Gaps
- No se recopilaron fuentes oficiales (Supabase docs, AWS S3 presigned URLs, BullMQ) por el límite de llamadas; las recomendaciones de esta sección son del investigador y deben contrastarse.
