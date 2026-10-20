# Recepcionista telefónica con IA para estudio de tatuajes: Twilio + ElevenLabs (ElevenAgents) conectado a la plataforma de reservas propia

> Nota metodológica (20-oct-2026): WebFetch falló con `getaddrinfo ENOTFOUND elevenlabs.io`, así que no se pudo leer la documentación oficial completa. Todo lo de abajo sale de resultados de WebSearch (fragmentos de docs oficiales de ElevenLabs y Twilio, más blogs de terceros). Cuando un dato viene de un tercero o de un proveedor competidor, lo indico. ElevenLabs renombró "Conversational AI / Agents Platform" a **ElevenAgents**; las URLs de docs ahora usan `/docs/eleven-agents/...` (algunas viejas siguen en `/docs/agents-platform/...`).

## 1. Capacidades actuales de ElevenLabs Agents (ElevenAgents) relevantes para el caso

### Takeaway
ElevenAgents cubre casi todo el flujo pedido sin infraestructura de voz propia: integración nativa con Twilio (entrante y saliente), webhook de inicio de conversación que recibe el caller ID y devuelve variables dinámicas (para identificar al cliente contra la BD de la plataforma), herramientas webhook/MCP para reservar y consultar pagos en tiempo real, herramientas de sistema (detección de idioma, transferencia a humano, fin de llamada, buzón de voz), webhooks post-llamada con transcripción + análisis + campos de "data collection", y llamadas salientes masivas (batch) para recordatorios. La transferencia "warm" exige el número importado vía integración nativa de Twilio (no SIP).

### Cited Findings

**Integración Twilio e identificación del llamante**
- Al entrar una llamada por Twilio, ElevenLabs hace un POST a tu endpoint con `caller_id`, `agent_id`, `called_number`, `call_sid` y `conversation_id`; tu servidor responde con datos de inicio (variables dinámicas y overrides) que ElevenLabs usa para arrancar la conversación. — [Twilio personalization](https://elevenlabs.io/docs/eleven-agents/customization/personalization/twilio-personalization)
- La consulta se hace durante el periodo de marcado/conexión de Twilio, en paralelo, para que los datos estén listos cuando conecta el audio. — [Twilio personalization](https://elevenlabs.io/docs/eleven-agents/customization/personalization/twilio-personalization)
- El webhook se habilita en la pestaña **Security** del agente, donde también se definen qué campos se pueden sobrescribir (overrides). — [Twilio personalization](https://elevenlabs.io/docs/eleven-agents/customization/personalization/twilio-personalization)
- El webhook solo se dispara si no se enviaron ya datos de inicio; en llamadas salientes de Twilio, SIP o WhatsApp solo se dispara si la petición saliente no incluyó `conversation_initiation_client_data`. — [Twilio personalization](https://elevenlabs.io/docs/eleven-agents/customization/personalization/twilio-personalization)
- Solo se pueden fijar variables dinámicas personalizadas; las que empiezan por `system__` no se pueden enviar ni sobrescribir. — [Twilio personalization](https://elevenlabs.io/docs/eleven-agents/customization/personalization/twilio-personalization)
- El número del llamante también está disponible directamente en prompts y herramientas como la variable de sistema `system__caller_id`, que se rellena automáticamente al iniciar la conversación (sirve si solo necesitas el número, sin webhook). — [Dynamic variables](https://elevenlabs.io/docs/agents-platform/customization/personalization/dynamic-variables)
- Fuente comunitaria (no oficial): la respuesta debe incluir todas las variables dinámicas personalizadas que el agente define, y un webhook que falla o expira puede impedir que la conversación empiece; por tanto, mantenerlo rápido. — [Medium: Automating Conversations… Twilio and ElevenLabs](https://medium.com/@programmerraja/automating-conversations-building-a-smart-call-agent-using-twilio-and-elevenlabs-37b6acfba3eb)
- Alternativa a la integración nativa: el endpoint **register call**. Tu servidor recibe el webhook entrante de Twilio, registra la llamada en ElevenLabs (agent_id, números origen/destino, opcionalmente `conversation_initiation_client_data`) y devuelve TwiML a Twilio. — [Register Twilio calls](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/register-call)
- Ejemplo comunitario de puente de memoria: webhook que recibe metadatos del llamante, devuelve variables dinámicas + override del system prompt y guarda los números de teléfono hasheados. — [GitHub britrik/elevenlabs-twilio-memory-bridge](https://github.com/britrik/elevenlabs-twilio-memory-bridge)
- ElevenLabs publicó una guía de métodos para autenticar al llamante en agentes de voz (5 métodos). — [Caller authentication for voice agents: 5 secure methods](https://elevenlabs.io/blog/designing-secure-caller-identity-authentication-flows-for-voice-agents)

**Herramientas (tools)**
- Herramientas de sistema incluidas: end call, language detection, agent transfer, transfer to number, skip turn, keypad touch tones (DTMF) y voicemail detection. Controlan la conversación sin llamadas externas. — [Tools](https://elevenlabs.io/docs/eleven-agents/customization/tools)
- Herramientas webhook (server tools): llaman a APIs REST externas con headers, path, query y body configurables. Herramientas MCP: servidores Model Context Protocol que exponen tools y recursos al agente. — [Tools](https://elevenlabs.io/docs/eleven-agents/customization/tools); [Layer3 Labs: ElevenLabs Agents Integrations](https://www.layer3labs.io/guides/elevenlabs-agents-integrations)
- Existen servidores MCP de terceros (no oficiales) para gestionar ElevenLabs (batch calls, tools, webhooks con HMAC). — [StackOne ElevenLabs MCP](https://www.stackone.com/connectors/elevenlabs/mcp/); [Composio ElevenLabs toolkit](https://composio.dev/toolkits/elevenlabs)
- ElevenLabs publicó una guía oficial para extender agentes con tools. — [Extending ElevenAgents with Tools (X/ElevenLabsDevs)](https://x.com/ElevenLabsDevs/article/2059699377279795412)
- ElevenAgents puede procesar imágenes y documentos dentro de la sesión, y el webhook post-llamada incluye URLs de los archivos que pasaron por la sesión. — [Processing Images and Documents in ElevenAgents](https://elevenlabs.io/blog/processing-images-and-documents-in-elevenagents)

**Transferencia a humano**
- Los mensajes de transferencia "warm" (briefing al operador) solo funcionan con números importados vía integración nativa de Twilio; las transferencias por SIP no los soportan. Las transferencias "blind" también exigen Twilio nativo, se configuran en el editor JSON, conservan el caller ID original pero no envían mensaje al humano. — [Transfer to number](https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/transfer-to-number)
- Mecanismo (tercero): por defecto es una transferencia por conferencia (marca al destino, une a todos en una sala y saca al agente IA). SIP REFER solo funciona si la conversación va por SIP y el trunk permite REFER. — [Layer3 Labs](https://www.layer3labs.io/guides/elevenlabs-agents-integrations)
- Patrón de Twilio: el agente pasa el Call SID padre a una Twilio Function que actualiza la llamada con nuevo TwiML (Dial, Conference, Sip o Redirect); Twilio conserva la propiedad de la llamada. — [Twilio blog: ElevenLabs Call Handoffs with Twilio](https://www.twilio.com/en-us/blog/developers/tutorials/integrations/ai-agent-to-human-agent-elevenlabs-call-handoffs-twilio)
- Hay un bug conocido documentado por la comunidad en la transferencia ElevenLabs + Twilio, con workaround. — [DEV Community: Fixing the ElevenLabs Call Transfer Bug with Twilio](https://dev.to/damuz91/fixing-the-elevenlabs-call-transfer-bug-with-twilio-20ck)

**Post-llamada, análisis y data collection**
- Tres tipos de webhook post-llamada: transcription (`post_call_transcription`, con transcripción completa, resultados de análisis y metadatos), audio (audio en base64) y call initiation failure. Hay reintentos. — [Post-call webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks)
- El webhook trae la transcripción, el análisis, los campos estructurados de "data collection" definidos y URLs de archivos. — [Processing Images and Documents in ElevenAgents](https://elevenlabs.io/blog/processing-images-and-documents-in-elevenagents)
- Data collection usa un LLM para extraer campos estructurados de la transcripción. — [Layer3 Labs](https://www.layer3labs.io/guides/elevenlabs-agents-integrations)
- Seguridad (tercero): el endpoint debe devolver 200 y verificar la firma HMAC del header `ElevenLabs-Signature`. — [Hookdeck: Guide to ElevenLabs Webhooks](https://hookdeck.com/webhooks/platforms/guide-to-elevenlabs-webhooks-features-and-best-practices)
- Fuente comunitaria: el payload trae ajustes de borrado; si se borran transcripciones/PII, por defecto se conservan solo el resumen y los campos recogidos. — [GitHub cognee issue #5816](https://github.com/topoteretes/cognee/issues/5816)

**Batch calling (salientes)**
- Batch Calling lanza muchas llamadas salientes a la vez con agentes ya configurados; lista de destinatarios en CSV/XLS; columnas extra = variables dinámicas para personalizar; disponible para números de Twilio nativo y SIP trunk; soporta programación y reportes por llamada. — [Batch calling](https://elevenlabs.io/docs/agents-platform/phone-numbers/batch-calls); [ElevenLabs blog: Introducing batch calling](https://elevenlabs.io/blog/introducing-batch-calling-for-elevenlabs-conversational-ai)
- ElevenLabs mantiene "skills" oficiales con referencia de llamadas salientes. — [elevenlabs/skills outbound-calls.md](https://github.com/elevenlabs/skills/blob/main/agents/references/outbound-calls.md)

**Idiomas, voces y latencia**
- La detección automática de idioma está integrada (reseña de tercero) y existe como herramienta de sistema "language detection". — [Layer3 Labs: ElevenLabs Agents Review 2026](https://www.layer3labs.io/guides/elevenlabs-agents-review); [Tools](https://elevenlabs.io/docs/eleven-agents/customization/tools)
- Español (España, México) está en Multilingual v2; Flash v2.5 cubre esos idiomas más tres extra (32 idiomas). — [Models](https://elevenlabs.io/docs/overview/models)
- Flash v2.5: ~75 ms de latencia de modelo según ElevenLabs, con nota de que excluye latencia de aplicación y red. — [Models](https://elevenlabs.io/docs/overview/models)
- Medición de un competidor (Deepgram): Flash v2.5 entre 350 ms (US East) y 527 ms (India) extremo a extremo; Deepgram también publica limitaciones de ElevenLabs para agentes multilingües (fuente interesada). — [Deepgram: Using ElevenLabs for Multilingual Voice Agents: Limitations](https://deepgram.com/learn/using-elevenlabs-multilingual-voice-agents-limitations)
- La plataforma gestiona detección de turnos, interrupciones, tool calls y voz en tiempo real; no hay cifras publicadas de precisión de turn-taking. — [Layer3 Labs review](https://www.layer3labs.io/guides/elevenlabs-agents-review)
- Métrica de latencia visible en payloads: `convai_llm_service_ttfb`. — [Post-call webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks)

**Precios (todas fuentes de terceros, 2026; verificar en elevenlabs.io/pricing)**
- Tarifa: $0.08 por minuto de llamada en todos los planes; "burst pricing" de $0.16/min cuando se excede la concurrencia; mensajes de texto a $0.003. — [Thunderphone: ElevenLabs Agents pricing (2026)](https://thunderphone.com/guides/elevenlabs-agents-pricing); [Macha: $0.08 a Minute](https://www.getmacha.com/blog/elevenlabs-agents-pricing-explained)
- Planes (precio mensual / minutos incluidos / llamadas concurrentes): Free $0/15/4; Starter $6/75/6; Creator $22/275/10; Pro $99/1,238/20; Scale $299/3,738/30; Business $990/12,375/40; Enterprise a medida. — [Macha complete guide](https://www.getmacha.com/blog/elevenlabs-agents-complete-guide); [CloudZero](https://www.cloudzero.com/blog/elevenlabs-pricing/); [Cartesia](https://www.cartesia.ai/learn/elevenlabs-pricing)
- Con facturación anual el minuto incluido baja a ~$0.067; subir de plan compra sobre todo concurrencia y features, no minuto más barato. — [Thunderphone](https://thunderphone.com/guides/elevenlabs-agents-pricing)
- El LLM se cobra aparte: de ~$0.0005 a ~$0.045/min según modelo. La telefonía (Twilio) la factura el proveedor de telefonía directamente (fuentes discrepan). — [Thunderphone](https://thunderphone.com/guides/elevenlabs-agents-pricing); contradicho parcialmente por [a8gent](https://a8gent.com/platforms/elevenlabs-agents) (dice que la telefonía no se cobra aparte)
- Discrepancia: Cekura habla de un techo de 25 solicitudes concurrentes antes de Enterprise, contra los 40 de Business en otras fuentes. — [Cekura](https://www.cekura.ai/blogs/elevenlabs-pricing)

### Inferences
- Flujo recomendado de identificación: integración nativa Twilio + webhook de inicio → la plataforma busca `caller_id` en su BD y devuelve variables como `{{client_name}}`, `{{client_id}}`, `{{preferred_language}}`, `{{has_pending_payment}}`, `{{next_appointment}}`, `{{studio_location}}`. El prompt usa el idioma preferido como saludo inicial y la herramienta de detección de idioma cambia si el cliente habla en el otro. Responder siempre con todas las variables (con valores por defecto para clientes desconocidos) y con timeout corto.
- El número entrante (`called_number`) permite saber qué sede se llamó (USA vs Panamá) con un solo agente multi-sede, o enrutar a agentes distintos por número.
- Las acciones transaccionales (consultar disponibilidad, crear/reprogramar cita, consultar saldo, enviar SMS/WhatsApp, notificar al artista) deben ser herramientas webhook contra la API propia; MCP es útil si la plataforma ya expone un servidor MCP, pero los webhooks dan más control de latencia y autenticación.
- Coste orientativo por minuto con ElevenLabs: ~$0.08 (plataforma) + LLM (~$0.005–0.045) + Twilio voz (~$0.0085/min entrante US, ver sección 3) ≈ $0.10–0.14/min. Una llamada típica de 3 min ≈ $0.30–0.45. (Cálculo propio a partir de las cifras citadas.)
- Usar data collection para extraer al final: intención (reserva/precio/queja), estilo, zona del cuerpo, tamaño, artista pedido, idioma, si se envió el link; y evaluation criteria para medir calidad (p. ej. "no prometió precio cerrado").

### Gaps
- No se pudo leer la documentación oficial de pricing de ElevenLabs (fetch bloqueado); las cifras de planes vienen de terceros coherentes entre sí pero no verificados.
- No se confirmó en fuente oficial el comportamiento exacto de la herramienta de detección de idioma ni los "evaluation criteria".
- Sin datos sobre latencia de la knowledge base/RAG de ElevenLabs ni límites de tamaño.
- No se verificó si las llamadas salientes vía API soportan las mismas herramientas de transferencia.
- No se encontró información sobre clonación de voz específicamente en agentes (precio/plan) en esta sesión; sí se sabe que hay voces y modelos multilingües.
- Certificaciones (HIPAA, SOC 2, zero retention) y residencia de datos no se investigaron en esta sesión.

## 2. Enviar SMS/WhatsApp con link de subida de foto o link de pago a mitad de llamada

### Takeaway
El patrón es una herramienta webhook del agente ("send_upload_link", "send_payment_link") que llama al backend de la plataforma; el backend genera el link (subida de referencia firmada / Stripe) y lo envía con la API de Twilio Messaging (SMS o WhatsApp con plantilla "utility"). Enviar un link es el patrón aceptado en PCI; nunca tomar el número de tarjeta por voz.

### Cited Findings
- El patrón común en agentes de voz es enviar un link de pago seguro por SMS durante la llamada, con DTMF (teclado) como alternativa en llamada. — [Famulor: AI Voice Agent Phone Payments PCI guide 2026](https://www.famulor.io/blog/ai-voice-agent-phone-payments-pci-compliant-guide-2026)
- Según el PCI Security Standards Council (resumido por Zian AI), enviar un link de pago por mensaje puede equipararse a un comercio electrónico que redirige a páginas de pago de terceros; enviar el número de tarjeta por SMS está prohibido, mientras que enviar un link es el patrón aceptado. — [Zian AI: Can an AI Voice Agent Take Card Payments?](https://zian.ai/ai-voice-agent-card-payments-pci-scope/)
- Capturar números de tarjeta hablados en la grabación/transcripción se considera un anti-patrón de cumplimiento. — [Ainora: PCI-Compliant Voice Payments](https://ainora.lt/blog/pci-dss-ai-call-recording-payment-processing); [Paytia](https://www.paytia.com/us/integrations/conversational-ai-payments)
- Recomendación: pedir al proveedor el ROC/SAQ y el Attestation of Compliance vigentes con fecha de evaluación. — [AutoInterviewAI: PCI-DSS & DTMF Masking (2026)](https://www.autointerviewai.com/blog/can-ai-voice-agents-take-credit-card-payments-pci-dss-2026)
- ElevenLabs tiene "texto" propio a $0.003/mensaje (dentro del producto de agentes). — [Thunderphone](https://thunderphone.com/guides/elevenlabs-agents-pricing)
- Hay un proyecto comunitario que integra ElevenAgents con memoria de llamantes y canales WhatsApp/SMS. — [GitHub cognee issue #5816](https://github.com/topoteretes/cognee/issues/5816)
- Precios Twilio Messaging (US): SMS/RCS desde $0.0083 por segmento + recargos de operador; números desde $1.15/mes. — [Twilio Messaging Pricing](https://www.twilio.com/en-us/pricing/messaging)
- WhatsApp vía Twilio: tarifa de plataforma Twilio de $0.005 por mensaje (entrante o saliente) + tarifa de Meta por plantilla. — [Twilio Messaging Pricing](https://www.twilio.com/en-us/pricing/messaging); [Zernio](https://zernio.com/blog/twilio-whatsapp-pricing-breakdown-what-it-really-costs)
- Tarifa Meta utility en Norteamérica ~$0.0034/mensaje (rate card 1-jul-2026); rango global $0.0014–$0.0499 según país y categoría; las plantillas utility dentro de la ventana de servicio de 24 h no pagan tarifa Meta (sí la de Twilio). — [W.app](https://w.app/blog/twilio-whatsapp-pricing/); [Chatmaxima](https://chatmaxima.com/whatsapp-api-pricing/); [EngageLab](https://www.engagelab.com/blog/whatsapp-business-api-pricing)
- EngageLab menciona un cambio de Meta el 1-oct-2026 (mensajes de servicio sobre 1,000 gratis no se entregan sin método de pago en Billing Hub); no confirmado en fuente de Meta. — [EngageLab](https://www.engagelab.com/blog/whatsapp-business-api-pricing)

### Inferences
- Diseño: herramienta `send_link(type: "reference_upload" | "deposit_payment" | "balance_payment", channel: "sms" | "whatsapp", appointment_id)`. El backend: (1) genera un token de un solo uso ligado a cliente/cita; (2) para pago, crea un Stripe Payment Link o Checkout Session con `metadata.appointment_id` y escucha el webhook de Stripe para marcar el depósito como pagado; (3) envía con Twilio Messaging (Messaging Service con fallback WhatsApp → SMS); (4) devuelve al agente `{"sent": true, "channel": "whatsapp"}` para que confirme verbalmente. (Conocimiento general de Stripe/Twilio, no verificado en esta sesión.)
- En Panamá WhatsApp es probablemente el canal preferente; en USA el SMS desde un número 10DLC requiere registro A2P 10DLC (conocimiento previo, no verificado aquí).
- Un mensaje WhatsApp iniciado por la empresa fuera de la ventana de 24 h necesita plantilla aprobada (utility); hay que pre-aprobar plantillas en inglés y español.
- La foto de referencia se sube a una página web propia (link firmado) en vez de por MMS, para controlar almacenamiento, tamaño y asociar a la cita; luego notificar al artista.

### Gaps
- No se encontraron tarifas de Twilio para Panamá (SMS, WhatsApp/Meta, números locales) ni disponibilidad de números locales/SMS bidireccional en Panamá.
- No se confirmó en esta sesión la documentación oficial de A2P 10DLC ni de Stripe Payment Links (se citan como conocimiento previo).

## 3. Alternativas: Twilio ConversationRelay, Vapi, Retell AI, Bland

### Takeaway
ElevenLabs es la opción "todo en uno" con la mejor calidad de voz y herramientas nativas de Twilio; ConversationRelay es la más barata y flexible si el equipo quiere controlar su propio LLM y lógica (Twilio pone STT/TTS, incluso con voces ElevenLabs), pero exige más desarrollo. Vapi/Retell son orquestadores con más controles de telefonía y precios desglosados; Bland es precio empaquetado más caro.

### Cited Findings
- **ConversationRelay**: Twilio gestiona STT, TTS y el audio; tu código solo maneja el LLM y la lógica, por WebSocket `wss://`; recibes mensajes `prompt` con el texto del llamante y devuelves texto en streaming; ante interrupción recibes `utteranceUntilInterrupt` y `durationUntilInterruptMs`. — [TwiML <ConversationRelay>](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay)
- La detección automática de idioma (modo `multi`) solo funciona con Deepgram (STT) + ElevenLabs (TTS); con otros proveedores da error y termina la sesión. Deepgram Flux cubre inglés y español entre otros. — [TwiML <ConversationRelay>](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay); [Twilio changelog: Deepgram Flux](https://www.twilio.com/en-us/changelog/conversation-relay-now-supports-deepgram-flux---new-features)
- Barge-in configurable (`interruptible`: none/dtmf/speech/any; `interruptSensitivity`); Flux reduce latencia de respuesta 200–600 ms y ~30% menos falsas interrupciones; mediana de latencia <0.5 s y p95 <0.725 s (benchmarks internos de Twilio); handshake con `X-Twilio-Signature`. — [Twilio blog: interruption handling](https://www.twilio.com/en-us/blog/insights/ai-voice-agent-interruption-handling); [ConversationRelay product page](https://www.twilio.com/en-us/products/conversational-ai/conversationrelay)
- ConversationRelay: $0.07/min + minutos de Twilio + LLM; estimación total US entrante ~$0.103/min (línea $0.0085, LLM $0.024). Un post más antiguo cita $0.05/min (conflicto). — [Superdupr: Twilio Pricing 2026](https://superdupr.com/blog/twilio-pricing); [Coreibytes](https://blog.coreibytes.com/blog/vapi-vs-twilio-conversationrelay-real-cost-service-businesses)
- **Vapi**: base $0.05/min; STT, LLM, TTS y telefonía se facturan aparte; estimaciones totales de $0.107 a $0.23–0.33/min según proveedores elegidos. — [Stackbinary: price per minute (2026)](https://stackbinary.io/insights/voice-ai-pricing-per-minute-2026); [Aliteq](https://aliteq.com/ai-voice-agent-cost-per-minute-2026)
- **Retell AI**: $0.07–$0.31/min sin contrato, componentes desglosados; telefonía Twilio $0.015/min. Retell publica guías de TCPA para salientes. — [Stackbinary](https://stackbinary.io/insights/voice-ai-pricing-per-minute-2026); [Retell: TCPA playbook](https://www.retellai.com/blog/tcpa-compliance-playbook-voice-ai-outbound)
- **Bland**: precio empaquetado: Start $0.14/min, Build ($299/mes) $0.12/min, Scale ($499/mes) $0.11/min; telefonía aparte según una fuente. — [Stackbinary](https://stackbinary.io/insights/voice-ai-pricing-per-minute-2026)
- Varias fuentes recomiendan calcular coste por tarea completada (cita reservada) en lugar de por minuto. — [Arahi: AI Voice Agent Platforms 2026](https://arahi.ai/blog/ai-voice-agent-platforms); [Venture Harbour: built voice agents on 7 tools](https://ventureharbour.com/voice-ai-platforms-compared-i-built-voice-agents-on-7-tools/)
- Comparativas generales 2026. — [Micdrop](https://micdrop.dev/blog/top-ai-voice-agent-platforms); [ClawCall](https://clawcall.dev/blog/best-ai-phone-agent-for-developers)
- Alternativa de arquitectura: poner Twilio detrás de LiveKit o Pipecat (código abierto). — [vadim.blog](https://vadim.blog/twilio-livekit-pipecat-phone-line/)

### Inferences
- Para una empresa de software que vende la función a muchos estudios (multi-tenant), ElevenLabs acelera el MVP (prompts, voces, herramientas, post-call, batch en UI/API). ConversationRelay conviene si se quiere un único LLM propio, prompts versionados en el repo y menor coste a escala, a cambio de construir la orquestación de herramientas, memoria y análisis.
- Ruta híbrida posible: ConversationRelay con TTS de ElevenLabs conserva la calidad de voz y deja la lógica en casa.
- Comparación aproximada de coste/minuto (sin LLM premium): ConversationRelay ~$0.10, ElevenLabs ~$0.10–0.14, Retell $0.07–0.31, Bland $0.11–0.14 + telefonía, Vapi $0.11–0.33 (cálculo propio con las cifras citadas).

### Gaps
- No se compararon en esta sesión features concretas de Vapi/Retell (squads, warm transfer, certificaciones) desde sus docs oficiales.
- Las cifras de coste total vienen de terceros con supuestos distintos; no son comparables al céntimo.

## 4. Casos reales y estadísticas de llamadas perdidas (argumentos de venta)

### Takeaway
La cifra más defendible es el estudio de 411 Locals (solo 37.8% de llamadas atendidas por una persona); el "62% sin contestar" y los "$126,000/año perdidos" se repiten mucho pero tienen origen difuso. Hay casos de salones con datos concretos; para tatuajes solo hay páginas de proveedores sin resultados verificables.

### Cited Findings
- Estudio 411 Locals (85 negocios, 30 días): solo el 37.8% de las llamadas las atendió una persona; 37.8% fue a buzón y 24.3% no tuvo respuesta. — [Hicira: Missed Call Statistics 2026](https://www.hicira.com/missed-call-statistics); [Getaira](https://www.getaira.io/blog/missed-business-calls-statistics)
- Informe Numa 2021: las pequeñas empresas pierden de media el 22% de las llamadas entrantes; otros resúmenes dan un rango de 25–60%; Invoca: 27% sin contestar en servicios del hogar. — [Hicira](https://www.hicira.com/missed-call-statistics); [Dialfyne](https://dialfyne.com/missed-call-statistics)
- "85% de quienes llegan al buzón no vuelven a llamar" (atribuido a Numa 2021) frente a "75%" en otra fuente: cifra incierta. — [Calljolt](https://calljolt.com/blog/guides/missed-call-statistics-2026); [Futurocorp](https://www.futurocorp.com/blogs/missed-call-economics)
- Conflicto: "86% no deja mensaje" frente a "menos del 3% deja mensaje"; no verificado con Invoca/Forbes originales. — [Dialzara](https://dialzara.com/blog/missed-calls-hidden-costs-and-ai-solutions); [Phone2](https://www.phone2.io/post/true-cost-of-missed-calls)
- "$126,000 de pérdida anual" para una pyme: muy repetido, origen poco trazable (blogs de proveedores). — [Callsetter](https://callsetter.ai/blog/cost-of-missed-calls); [Agentzap](https://agentzap.ai/blog/business-calls-go-unanswered-cost-2026)
- Por llamada perdida: $125–$350 de ingreso inmediato (modelo de un proveedor) vs ~$1,200 (Invoca, servicios del hogar). — [Zadarma research](https://zadarma.com/en/blog/missed-calls-cost-research/); [Dialfyne](https://dialfyne.com/missed-call-statistics)
- Salón Mermaid Hair Extensions (Salon Today, vía Zenoti): TrueLark envía SMS a llamadas perdidas, responde dudas y reserva consulta gratis: ~28 reservas online/semana, 17 fuera de horario. — [Zenoti: AI Receptionist for Salons](https://www.zenoti.com/thecheckin/how-ai-receptionists-are-revolutionizing-appointment-management-for-wellness-brands)
- Zenoti (dato propio, 3,500+ locales): su recepcionista IA convierte 1 de cada 3 llamadas perdidas en cita. — [Zenoti: missed call to kept appointment](https://www.zenoti.com/blog/ai-agents-missed-call-salon-appointment)
- Metropolitan Salon & Spa (Wisconsin): SMS automático personalizable ante llamada perdida para reservar sin esperar devolución. — [Zenoti](https://www.zenoti.com/thecheckin/how-ai-receptionists-are-revolutionizing-appointment-management-for-wellness-brands)
- Clínica cosmética multi-sede (Flipbytes): problemas previos de llamadas perdidas, dobles reservas y nula cobertura fuera de horario; agente IA reserva directo en el software de la clínica (sin métricas publicadas en el fragmento). — [Flipbytes case study](https://www.flipbytes.com/blog/case-study-ai-voice-receptionist-handles-calls-and-booking-for-a-multi-location-cosmetic-clinic/)
- Med spa Mirelle Institute (NJ, Smith.ai): atención 24/7, calificación de leads y reservas con reglas de depósito. — [Zenoti / Smith.ai via search](https://www.zenoti.com/blog/ai-agents-missed-call-salon-appointment)
- Tatuajes: proveedores afirman que el 60% de llamadas a estudios se pierden durante sesiones (el artista tiene guantes puestos) — sin fuente. — [VoiceCharm](https://www.voicecharm.ai/blog/ai-receptionist-for-tattoo-shops); [Astucia](https://astucia.io/blog/ai-receptionist-for-tattoo-shops); [Agentzap tattoo](https://agentzap.ai/industries/tattoo); [Ainora tattoo & piercing](https://ainora.lt/blog/ai-receptionist-for-tattoo-piercing-studios)

### Inferences
- Argumento de venta específico: en un estudio de tatuaje el artista no puede contestar con guantes durante sesiones largas; la IA cubre llamadas en sesión y fuera de horario, y el depósito por link reduce no-shows. Usar la cifra 411 Locals como dato duro y el resto como "estimaciones de la industria".
- La competencia directa (VoiceCharm, Agentzap, Ainora, Astucia) ya vende recepcionistas IA para tatuajes: el diferencial de la plataforma es la integración nativa con su propia agenda, pagos y fichas de clientes.

### Gaps
- Ningún caso de estudio de tatuajes con resultados medidos y nombre del estudio.
- No hay estadísticas de llamadas perdidas para Panamá/LatAm.

## 5. Buenas prácticas: diseño de conversación, guardarraíles, PCI, humano, grabación; y uso saliente (TCPA)

### Takeaway
Divulgar al inicio que es una IA y que la llamada se graba (aviso válido para estados de consentimiento de todas las partes), no tomar tarjetas por voz (link de pago), no prometer precios cerrados ni dar consejo médico, y tener transferencia a humano. Para salientes (recordatorios), la FCC trata las voces de IA como "artificiales" bajo la TCPA desde feb-2024: hace falta consentimiento previo expreso (los recordatorios informativos tienen estándar más ligero que el marketing).

### Cited Findings
**Grabación y divulgación**
- Unos 12–13 estados exigen consentimiento de todas las partes para grabar (California, Florida, Illinois, Washington, y además Connecticut, Delaware, Maryland, Massachusetts, Michigan [no resuelto], Montana, Nevada, New Hampshire, Pennsylvania; Oregón híbrido); las fuentes discrepan en el número. — [Dialzara: Call Recording Laws for AI Agents by State](https://dialzara.com/blog/call-recording-laws-ai-agents-by-state); [Fusion Calling](https://www.fusioncalling.com/blog/ai-receptionist-call-recording-laws); [PyAI](https://pyai.com/voice-ai-compliance/call-recording-consent-by-state)
- En llamadas entre estados se aplica en la práctica la regla más estricta. — [Reed Smith](https://www.reedsmith.com/our-insights/blogs/employment-law-watch/102ls2n/the-legality-of-ai-powered-recording-and-transcription/)
- California AB 2905 modificó el Public Utilities Code § 2874: los dispositivos de marcado automático deben informar si el mensaje usa voz artificial (multa reportada de forma inconsistente: $500 por llamada o $2,500 por infracción). — [NJ Business Attorney: AI Voice Agent Call Recording & Disclosure Laws (2026)](https://www.njbusiness-attorney.com/ai-voice-agent-call-recording-disclosure/); [Plura](https://www.plura.ai/articles/ai-voice-agent-disclosure-requirements)
- Recomendación práctica coincidente: aviso de grabación válido para todas las partes en todas las llamadas y presentar al agente como IA al inicio. — [Dialzara compliance checklist](https://dialzara.com/blog/ai-phone-agent-compliance-checklist); [Medsite AI](https://medsiteai.com/blog/ai-voice-agent-call-recording-hipaa-state-consent-law-compliance)

**Pagos / PCI**
- Ver sección 2: link por SMS o DTMF enmascarado; nunca tarjeta hablada. — [Zian AI](https://zian.ai/ai-voice-agent-card-payments-pci-scope/); [Roark: testing voice agents that take payments](https://roark.ai/blog/testing-voice-agents-that-take-payments)

**TCPA / salientes**
- Resolución declaratoria FCC de feb-2024 (FCC 24-17): las voces generadas por IA son "artificiales" bajo la TCPA (clarificación de la ley existente). — [regulations.ai: FCC Rules AI Voice Calls Illegal Under TCPA](https://regulations.ai/regulations/RAI-US-NA-FCCAITC-2024); [Ginsburg Law Group (feb-2026)](https://ginsburglawgroup.com/2026/02/ai-robocalls-the-tcpa-consent-rules-you-need-to-know/)
- Recordatorios de cita = llamadas informativas: basta consentimiento previo expreso (puede ser haber dado el número para un fin relacionado); el marketing exige consentimiento previo expreso por escrito. — [Klariqo: TCPA for AI Voice Agents 2026](https://klariqo.com/blog/tcpa-compliance-ai-voice-agents/); [Plura: TCPA for AI call centers](https://www.plura.ai/articles/ai-call-center-tcpa-compliance)
- NPRM de la FCC (sep-2024) para definir "llamada generada por IA" y exigir divulgación: según una fuente, en mayo de 2026 aún no era regla definitiva; otra proyecta regla final en Q4-2026/Q1-2027, con posible retraso por prioridades desreguladoras. — [CallSphere: FCC AI-call disclosure rules 2024-2026](https://callsphere.ai/blog/vw2d-fcc-ai-call-disclosure-rules-2026); [Retell TCPA playbook](https://www.retellai.com/blog/tcpa-compliance-playbook-voice-ai-outbound)
- Daños legales de $500 a $1,500 por llamada (triple si es intencional); las demandas colectivas privadas son el mayor riesgo práctico. — [Layer3 Labs: Are AI Phone Calls Legal?](https://www.layer3labs.io/guides/are-ai-phone-calls-legal); [Consig AI](https://consig.ai/guides/tcpa-compliance-for-ai-patient-calls)
- Una fuente menciona una regla "one-to-one consent" anulada (vacated), sin detalle. — [Klariqo](https://klariqo.com/blog/tcpa-compliance-ai-voice-agents/)

### Inferences
- Guion de apertura sugerido (bilingüe): "Hola, gracias por llamar a [Estudio]. Soy la asistente virtual con IA; esta llamada se graba para calidad. ¿Prefieres inglés o español?" (en USA empezar en inglés, en Panamá en español, según `called_number`).
- Guardarraíles en el prompt + tools: precios solo como rangos de la knowledge base ("desde $X; el precio final lo confirma el artista tras ver la referencia"); no opinar sobre salud, cicatrización, medicación, embarazo, alergias ni piel con condiciones: derivar al artista/médico; verificar edad mínima (18+, o la normativa local) antes de reservar; no confirmar cita sin respuesta OK de la tool; leer de vuelta fecha, hora, sede y artista; ofrecer humano si hay frustración, quejas, cotizaciones complejas (cover-ups, piezas grandes) o fallos de tool.
- Autenticación ligera: el caller ID se puede falsificar; antes de revelar saldos o datos de citas, confirmar un segundo factor (nombre + fecha de la próxima cita o código por SMS). Ver la guía de ElevenLabs sobre métodos de autenticación (sección 1).
- Salientes: recordatorios solo a clientes que dieron su número al reservar, con texto de consentimiento en el formulario; respetar horarios permitidos y opt-out ("responde STOP"/"di 'no me llames'"); preferir SMS/WhatsApp para recordatorios y la llamada IA solo para confirmaciones o reprogramaciones; nada de promociones por voz IA sin consentimiento escrito.
- Panamá: aplicar la misma divulgación de grabación y finalidad del tratamiento de datos.

### Gaps
- No se encontró información sobre la Ley 81 de 2019 de Panamá (protección de datos personales) aplicada a grabación de llamadas y uso de IA; queda pendiente de revisar con asesoría legal local.
- Sin fuente primaria de la FCC consultada (solo blogs legales/proveedores); confirmar el texto de FCC 24-17 y el estado del NPRM.
- No se confirmó el horario permitido de llamadas TCPA ni normas estatales "mini-TCPA" (Florida, Oklahoma) en esta sesión.
