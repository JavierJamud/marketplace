# Referentes de diseño y animación web de alto nivel para un estudio de tatuajes de lujo (y stack técnico para reproducirlos)

> Nota de método: WebFetch y curl a sitios web (awwwards.com, gsap.com, web.dev, tympanus.net, abduzeedo.com, cdn.jsdelivr.net) estaban bloqueados en este entorno (DNS ENOTFOUND / proxy 403). Todo lo que sigue viene de **snippets de búsqueda web** (WebSearch) más una consulta directa al **registro npm** (registry.npmjs.org, que sí respondía) para versiones, fechas y licencias, y de la inspección del paquete `gsap@3.15.0` descargado desde npm. Los skills de Bright Data (search/scrape/design-mirror) no eran utilizables: no hay credenciales configuradas y la salida de red está limitada a registros de paquetes. Por eso, la descripción detallada de los efectos de muchos sitios premiados no se pudo verificar abriendo los sitios; donde falta, se indica en *Gaps*. Fecha de la investigación: 20-oct-2026.

## 1. Sitios premiados (Awwwards, FWA, CSSDA, galerías) con estética oscura/editorial/lujo y los efectos que usan

### Takeaway
Los referentes premiados 2024–2026 más útiles para un estudio de lujo son los de estudios como Immersive Garden (Cartier, GQ & AP), Lusion (Oryzo AI), OFF+BRAND (Lando Norris, SOTY 2025), Bürocratik (Floema, SOTM may-2026) y abeto (Messenger, Igloo Inc). El patrón común de 2026 es "una sola idea fuerte bien ejecutada" (un objeto 3D con peso real, un fluido, una narrativa guiada por scroll) en lugar de acumular efectos.

### Cited Findings
**Site of the Year (SOTY)**
- Lando Norris (landonorris.com), de OFF+BRAND, aparece en un listado de Awwwards con las insignias "Developer Award" y "Site Of The Year 2025"; otra fuente lo describe como ganador del SOTY 2025 — [Awwwards listing](https://www.awwwards.com/websites/%23e2de00/?page=5); [Metabole: Immersive Website Examples 2026 (snippet)](https://metabole.studio/en/blog/immersive-website-examples)
- Diseño del sitio de Lando Norris: overlays reactivos tipo "blob" sobre la imagen del hero que se mueven con el cursor, inspirados en el lenguaje gráfico de su casco; el layout separa "On Track" (resultados) de "Off Track" (cultura); paleta de cuatro colores — [DesignRush](https://designrush.com/best-designs/websites/lando-norris-website-design)
- Messenger, de abeto, figura con "Developer Award" y "Site Of The Year 2025"; otra fuente lo describe como "Developer Site of the Year 2025" (ambigüedad sobre si es el SOTY general o el de Developer) — [Awwwards listing](https://www.awwwards.com/websites/%23EDF726/?page=5)
- Igloo Inc (abeto) aparece en una colección de Awwwards con Developer Award en la categoría Site of the Year 2024; Lusion v3 aparece con SOTY 2023 — [Awwwards collection "webgl-animations"](https://www.awwwards.com/du-haihang/collections/webgl-animations/)
- Awwwards distingue entre el SOTY general (elegido por el jurado entre los 12 Sites of the Month + 3 nominados) y el Developer's SOTY (elegido por el jurado Developer entre los ganadores del Developer Award) — [Wikipedia: Awwwards](https://en.wikipedia.org/wiki/Awwwards)

**Sites of the Month 2026 (según el listado de Awwwards, vía snippets)**
- Enero 2026: portfolio de Bruno Simon (entorno 3D en navegador donde se conduce un pequeño vehículo por un mundo virtual) — [Awwwards Sites of the Month](https://www.awwwards.com/websites/sites_of_the_month/)
- Febrero 2026: "The Renaissance Edition" de Shopify (más de 150 novedades de plataforma presentadas con pinturas generativas de inspiración renacentista) — [Awwwards Sites of the Month](https://www.awwwards.com/websites/sites_of_the_month/)
- Marzo 2026: "GQ & AP The Extraordinary Lab" (atribuido a Immersive Garden) — [Awwwards Sites of the Month](https://www.awwwards.com/websites/sites_of_the_month/)
- Abril 2026: "Oryzo AI" de Lusion, descrito como una historia de producto cinematográfica que convierte un posavasos de corcho corriente en protagonista — [Awwwards: Lusion](https://www.awwwards.com/lusion/)
- Mayo 2026: Floema (floema.com) de Bürocratik, SOTM + Developer Award; Muzli lo describe como diseño refinado y minimalista — [LinkedIn (Bürocratik)](https://pt.linkedin.com/in/anachande); [Muzli abril 2026](https://muz.li/blog/the-best-creative-websites-of-the-month-april-2026/)
- Junio: Son Daven; Julio: Lama Lama; Agosto: ERA Residence; Septiembre 2026: Why Zero (Sindhur Dutta) — [Awwwards Sites of the Month](https://www.awwwards.com/websites/sites_of_the_month/)
- Septiembre 2025: Terminal Industries, SOTM en Awwwards, con transiciones de scroll que convierten visuales 3D en vistas wireframe — [Metabole (snippet)](https://metabole.studio/en/blog/immersive-website-examples)
- Nominados SOTM 2025 incluyen: enero (Immersive Garden Website, Scout Motors, Mat Voyce, Jeton) y mayo (PrimeAsia Leather, KODE Immersive, Anime.js, Inkwell) — [Vote SOTM enero 2025](https://www.awwwards.com/vote-for-site-of-the-month-january-2025.html); [Vote SOTM mayo 2025](https://www.awwwards.com/vote-for-site-of-the-month-may-2025.html)

**Lujo (joyería/relojería) – Immersive Garden + Cartier**
- Immersive Garden hizo los sitios de Cartier Watches & Wonders 2023 y 2024, con 60fps y Mooders como colaboradores; recibieron Awwwards SOTD, FWA SOTD y CSSDA SOTD — [Immersive Garden: Cartier W&W 24](https://immersive-g.com/projects/cartier-watches-and-wonders-24); [Immersive Garden: Cartier W&W 23](https://immersive-g.com/projects/cartier-watches-and-wonders-23)
- La experiencia Cartier Watches & Wonders 2025 tiene seis escenas 3D únicas, cada una inspirada en un reloj emblemático de Cartier — [Awwwards: W&W immersive experience for Cartier](https://www.awwwards.com/watches-wonders-immersive-experience-for-cartier.html)
- "Cartier Love Is All" (Immersive Garden; desarrollo técnico y WebGL por 60FPS) fue nominado en los Webby Awards en "Best Use of Video or Moving Image" — [Webby Awards](https://winners.webbyawards.com/2022/websites-and-mobile-sites/features-design/best-use-of-video-or-moving-image/215832/cartier-love-is-all)
- Un snippet indica que Immersive Garden fue "Agency of the Year 2025" de Awwwards; no se pudo verificar en fuente primaria — [Metabole (snippet; sin fuente primaria)](https://metabole.studio/en/blog/immersive-website-examples)
- Joyería premiada: "Unique Jewelry" (Honorable Mention en Awwwards), landing de visualización de producto con WebGL + Three.js y GSAP — [Awwwards: Unique Jewelry](https://www.awwwards.com/sites/unique-jewelry)
- Joyería con animación GSAP (no premiadas, roundups): Carlo Barberis (slider + GSAP), Chekotin (GSAP), Limnia (homepage animada con GSAP) — [Colorlib](https://colorlib.com/wp/jewelry-website-design/); [Bentbargains](https://www.bentbargains.com/blog/18-best-jewelry-website-design-inspiration-2025)

**Tendencias 2026 en sitios 3D premiados (Utsubo, roundup de un estudio Three.js; sesgo comercial)**
- WebGPU llegó al mainstream en 2026; sitios como IVRESS ya usan renderer WebGPU con fallback WebGL — [Utsubo: 8 Best Three.js Websites of 2026](https://www.utsubo.com/blog/best-threejs-websites-2026)
- Cartier, Shopify, Sleep Well y Primland (resort de lujo) dirigen toda la experiencia desde el scroll, secuenciando escenas 3D — [Utsubo](https://www.utsubo.com/blog/best-threejs-websites-2026)
- Los mejores eligen una idea difícil y la ejecutan limpiamente (mundo físico conducible, fluido reactivo al audio, un solo objeto con "peso real") en lugar de apilar efectos — [Utsubo](https://www.utsubo.com/blog/best-threejs-websites-2026)
- Un artículo de tendencias 2026 afirma que los clientes ya esperan un hero WebGL funcionando en proyectos premium — [svilenkovic.com](https://svilenkovic.com/3d/metaverse-2026-trends)
- Otros referentes "inmersivos" citados: Unseen Studio (entorno central que ancla la página y scroll no lineal), Curious & Company (estilo coherente en todo el sitio, no solo la home), páginas de producto de Apple (animaciones de scroll que dosifican contenido técnico) — [Immersive Websites (Notion)](https://blushing-cardboard-aac.notion.site/Immersive-Websites-236d9794fb124c42b44f0edd65011d1e)

### Inferences
- Para un estudio de tatuajes de lujo, los modelos más transferibles son: (a) Cartier/Immersive Garden — escenas por "pieza" (aquí: por obra/artista) guiadas por scroll; (b) Oryzo AI/Lusion — elevar un objeto cotidiano a protagonista cinematográfico (aquí: la aguja/máquina, la piel, la tinta); (c) Lando Norris — un motivo gráfico propio (blob del casco) convertido en interacción del cursor (aquí: trazo de tinta o flash propio del estudio); (d) Floema/Bürocratik — minimalismo refinado editorial.
- El consejo de "una sola idea fuerte" encaja con el rendimiento móvil: un único efecto WebGL de alta calidad (p. ej., tinta en el hero) es más defendible que cursor magnético + distorsión + 3D + transiciones a la vez.
- Patrones típicos de este circuito (smooth scroll, reveals por scroll, split text, hover con distorsión WebGL, marquees, transiciones de página, cursores custom) son de conocimiento general del sector, pero no se pudo verificar sitio por sitio cuál usa cada uno.

### Gaps
- No se pudo abrir awwwards.com, thefwa.com, cssdesignawards.com, godly.website, land-book, lapa.ninja, siteinspire ni onepagelove: no hay listas verificadas por galería ni capturas de stack (Awwwards suele listar "Technologies"; no accesible).
- No se confirmó cuál fue el SOTY general 2024 (Igloo Inc solo aparece confirmado como Developer SOTY 2024) ni si Messenger fue SOTY general o Developer SOTY 2025.
- Efectos concretos de Son Daven, Lama Lama, ERA Residence, Why Zero, GQ & AP Lab y Floema: no documentados en los snippets (la búsqueda de ERA Residence y Son Daven solo devolvió resultados no relacionados).
- La técnica de implementación del sitio de Lando Norris (WebGL/shaders) no está documentada en las fuentes encontradas.
- No se encontró evidencia de URLs de hoteles de lujo / galerías de arte premiados específicos (aparte de Primland vía Utsubo).

## 2. Webs de estudios de tatuaje de alto nivel que destacan visualmente

### Takeaway
El único caso de tatuaje con reconocimiento de premios de diseño web confirmado es Monolith Studio (Brooklyn), de Le:mma Studio, hecho en Webflow con 3D interactivo (Awwwards SOTD + DEV, CSSDA SOTD). El resto de referencias de tatuaje son estudios "appointment-only" con estética sobria (Atelier Eva, Brilliance Tattoo, Barber's Electric) pero sin premios de animación; el listón visual del sector es bajo, lo que es una oportunidad.

### Cited Findings
- Monolith Studio es un estudio de tatuaje en Brooklyn, NY; su web (Webflow) incluye interactividad 3D, voice-overs en artículos, CMS adaptado, soluciones custom de gestión, SEO y un diseño minimalista reimaginado; premios: Awwwards SOTD & DEV, CSSDA SOTD, Behance UI & XD — [Made in Webflow: monolith-st](https://webflow.com/made-in-webflow/website/monolith-st)
- Abduzeedo describe la web de Monolith como casi negra, con tipografía display sobredimensionada y elementos 3D en Webflow, y afirma que obtuvo también FWA of the Day (la ficha de Webflow no menciona FWA, así que el FWA no está confirmado) — [Abduzeedo](https://abduzeedo.com/node/89302); contrastado con [Made in Webflow](https://webflow.com/made-in-webflow/website/monolith-st)
- Monolith Studio es conocido por tatuaje geométrico — [the5krunner](https://the5krunner.com/2024/12/01/monolith-studio-art-geometric-tattoos)
- Codrops publicó (11-may-2026) un perfil de Le:mma Studio, "Building the Feeling Behind the Screen"; según Codrops lo fundaron Artemii Lebedev y Svetlana Markova (Abduzeedo nombra a otros fundadores: discrepancia) — [Codrops](https://tympanus.net/codrops/2026/05/11/lemma-studio-building-the-feeling-behind-the-screen/); contradicho por [Abduzeedo](https://abduzeedo.com/node/89302)
- Atelier Eva: estudio de "fine art" con paleta negro-beige, tipografía serif elegante y estética de galería (Squarespace) — [Colorlib: 27 Best Tattoo Studio Website Examples](https://colorlib.com/wp/tattoo-studio-website-examples/)
- Brilliance Tattoo: estudio pequeño solo por encargo, con citas y 6–8 semanas de espera; layout limpio que transmite exclusividad (Squarespace) — [Colorlib](https://colorlib.com/wp/tattoo-studio-website-examples/)
- Barber's Electric Tattoo: estudio privado con cita previa y diseño oscuro y atmosférico — [Colorlib](https://colorlib.com/wp/tattoo-studio-website-examples/)
- Guns N Needles y Empire Inks se citan por buena navegación y CTAs (no por diseño premiado) — [CyberOptik](https://cyberoptik.net/blog/best-tattoo-shop-websites)
- Recomendaciones del sector: el portfolio es el principal argumento de venta; el cliente mira trabajo cicatrizado en el estilo que quiere antes de reservar — [Mapletree case study](https://mapletree.studio/work/tattoo-creations/)
- Filtrar solicitudes publicando normas de edad, estilos y requisitos de consulta — [WebPop Design](https://www.webpopdesign.com/tattoo-studio-web-design/) (agencia; promocional)
- Para estudio privado: minimalismo de lujo con negro, blanco y un único acento metálico, y guía de cuidados con "timeline" de cicatrización día a día — [Lovart (brand kit)](https://www.lovart.ai/ko/blog/brand-kit-tattoo-studio-lovart) (promocional)
- Tendencias citadas: animaciones activadas por scroll y hover sustituyendo galerías estáticas; layouts mobile-first y reserva integrada — [Seahawk Media](https://seahawkmedia.com/design/tattoo-website-design-tips/)

### Inferences
- Monolith es el benchmark directo a superar: casi negro + display gigante + 3D. Diferenciación posible: tinta/fluido como lenguaje de marca, portfolio tipo galería de arte (Atelier Eva) con fichas por obra, y booking con depósito integrado.
- El hecho de que los ejemplos "lujo" de tatuaje sean mayoritariamente Squarespace sugiere que un sitio a medida con motion de nivel Awwwards destacaría claramente en el nicho.

### Gaps
- No se pudo verificar visualmente ningún sitio ni obtener la URL pública exacta de Monolith Studio (solo la ficha de Webflow).
- No se encontraron otros estudios de tatuaje con SOTD/FWA verificados (se buscó; los resultados son guías de agencias).

## 3. Librerías y herramientas: versiones actuales y licencias

### Takeaway
GSAP es 100% gratis (incluidos SplitText, MorphSVG, ScrollSmoother, etc.) desde el 30-abr-2025 bajo una licencia propietaria "no charge" de Webflow (no MIT), con una única restricción relevante para constructores visuales no-code que compitan con Webflow; para un sitio de estudio no aplica. El stack recomendado y vivo en oct-2026: GSAP 3.15 + Lenis 1.3.27 + (Three.js 0.186 / R3F 9.8 o OGL para efectos ligeros) + View Transitions; Barba, curtains.js y Theatre.js llevan sin publicar desde 2024.

### Cited Findings
**Versiones y licencias (registro npm, consultado 20-oct-2026)**
| Paquete | Última versión | Fecha publicación | Licencia |
|---|---|---|---|
| gsap | 3.15.0 | 2026-04-13 | Standard "no charge" license (gsap.com/standard-license) |
| lenis | 1.3.27 | 2026-10-15 | MIT |
| motion (ex Framer Motion) | 14.4.0 | 2026-10-19 | MIT |
| three | 0.186.1 | 2026-09-24 | MIT |
| @react-three/fiber | 9.8.2 | 2026-10-14 | MIT |
| @react-three/drei | 10.7.9 | — | MIT |
| ogl | 1.0.11 | — | Unlicense |
| curtainsjs | 8.1.6 | 2024-05-02 | MIT |
| @barba/core | 2.10.3 | 2024-08-12 | MIT |
| @theatre/core | 0.7.2 | 2024-05-19 | Apache-2.0 |
| lottie-web | 5.13.0 | — | MIT |
| @lottiefiles/dotlottie-web | 0.81.0 | — | MIT |
| @rive-app/canvas | 2.45.0 | — | MIT |
| @splinetool/runtime | 2.0.95 | — | (sin licencia declarada en npm) |
| split-type | 0.3.4 | — | ISC |
— [npm registry](https://registry.npmjs.org/) (consultas a `/<paquete>` y `/<paquete>/latest`)

**GSAP**
- El README de `gsap@3.15.0` dice: "Thanks to Webflow, GSAP is now 100% FREE including ALL of the bonus plugins like SplitText, MorphSVG, and all the others that were exclusively available to Club GSAP members… even for commercial use"; licencia: "GreenSock's standard 'no charge' license" — [npm: gsap](https://www.npmjs.com/package/gsap)
- El paquete público `gsap@3.15.0` incluye: ScrollTrigger, ScrollSmoother, SplitText, Flip, MorphSVGPlugin, DrawSVGPlugin, MotionPathPlugin, Observer, Draggable, InertiaPlugin, ScrambleTextPlugin, CustomEase/CustomBounce/CustomWiggle, Physics2D/PhysicsProps, GSDevTools, TextPlugin, PixiPlugin, etc. — [npm: gsap tarball 3.15.0](https://registry.npmjs.org/gsap/-/gsap-3.15.0.tgz)
- Webflow anunció la adquisición de GreenSock el 15-oct-2024 — [Webflow blog: Webflow acquires GSAP](https://webflow.com/blog/webflow-acquires-gsap); [Axios](https://www.axios.com/pro/media-deals/2024/10/15/webflow-gsap-animation-websites)
- Webflow anunció GSAP "100% free to all users, whether Webflow customer or not" (30-abr-2025) — [Webflow updates: GSAP becomes free](https://webflow.com/updates/gsap-becomes-free); [Webflow blog](https://webflow.com/blog/gsap-becomes-free)
- El paquete `gsap-trial` está deprecado; todo está en `gsap` — [npm: gsap-trial](https://npmjs.com/package/gsap-trial)
- Restricción ("Prohibited Uses"): usar GSAP en herramientas que permiten crear animaciones visuales sin código y que compitan con las capacidades de animación visual de Webflow requiere consentimiento escrito de Webflow; cualquier web/app/interfaz está permitida (incluso de competidores de Webflow en otras áreas); el código generado por IA no es uso prohibido — [GSAP Standard License](https://gsap.com/community/standard-license/); [copia en Wind River](https://open.windriver.com/info/uni-license-list/licenses/gsap-standard-no-charge-2025.html)
- Hay debate en comunidad sobre lo amplio de "compete with Webflow" (Pinegrow lo llama "zona gris") — [Pinegrow forum](https://forum.pinegrow.com/t/gsap-has-been-acquired-by-webflow/9906)

**Lenis**
- Lenis (darkroom.engineering): ligero, sin dependencias, pensado para sincronizar WebGL con scroll y parallax — [Lenis README (jsDelivr)](https://cdn.jsdelivr.net/gh/darkroomengineering/lenis@1.3.26/README.md)
- Integración típica con GSAP: `lenis.on('scroll', ScrollTrigger.update)` y `gsap.ticker.add(time => lenis.raf(time * 1000))` — [hontran.dev](https://www.hontran.dev/blog/nextjs-smooth-scroll-gsap-lenis)

**Motion (ex Framer Motion)**
- Framer Motion se independizó de Framer en 2024 y pasó a ser "Motion" (motion.dev), con APIs vanilla JS además de React y Vue; importar desde `motion/react` en lugar de `framer-motion` — [Tumult forums](https://forums.tumult.com/t/motion-dev-now-becomes-independent-and-uses-vanilla-javascript/24256); [README framer-motion](https://unpkg.com/framer-motion@12.23.0/README.md)
- Núcleo MIT; Motion+ es una membresía de pago único con APIs premium (p. ej. Cursor, Ticker), editor de transiciones, etc.; precios reportados ($99 AI Kit / $399 Motion+) no verificados — [OpenReplay: Motion vs GSAP](https://blog.openreplay.com/motion-vs-gsap/); [EveryDev](https://www.everydev.ai/developers/motion-division)

**Three.js / WebGPU**
- `WebGPURenderer` hace fallback automático a backend WebGL 2 cuando no hay WebGPU — [three.js manual: WebGPURenderer](https://threejs.org/manual/en/webgpurenderer.html)
- Soporte WebGPU citado (ene-2026): Chrome/Edge 113+, Firefox 141+ Windows y 145+ macOS, Safari 26+; se reporta canvas negro sin error en Firefox/Linux; `forceWebGL: true` para probar el fallback; hay que `await renderer.init()` antes del primer render — [Utsubo: WebGPU migration guide](https://www.utsubo.com/blog/webgpu-threejs-migration-guide); [buildmvpfast](https://www.buildmvpfast.com/blog/threejs-webgl-to-webgpu-renderer-migration-2026)
- Las cifras de mejora de rendimiento de WebGPU son inconsistentes entre fuentes (2–10x, 10–100x, 30–50%) — [Utsubo 100 tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips)

**View Transitions (alternativa nativa a Barba.js)**
- Las view transitions same-document son Baseline "Newly available" desde Firefox 144 (oct-2025) — [web.dev](https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available)
- Las cross-document (MPA) tienen soporte parcial/en desarrollo en Firefox y son foco de Interop 2026 — [Speaker Deck (Sascha Lehmann)](https://speakerdeck.com/saschaleh/24-08-2026-erster-zwischenstand); [devtoolbox guide 2026](https://devtoolbox.dedyn.io/blog/css-view-transitions-complete-guide); novedades 2025 en [Chrome for Developers](https://developer.chrome.com/blog/view-transitions-in-2025)

**Shaders: tinta / fluidos / distorsión (tema tatuaje)**
- WebGL-Fluid-Simulation de Pavel Dobryakov: licencia MIT, ~14k estrellas; al arrastrar el puntero emite tinte que forma vórtices (aspecto marmolado); parámetros de "splat" (radio 0.25, fuerza 6000); existe el paquete npm `webgl-fluid` con soporte ESM — [ecosyste.ms](https://awesome.ecosyste.ms/projects/321175); [Gigazine](https://gigazine.net/news/20190523-webgl-fluid-simulation/); [jsDelivr: webgl-fluid](https://jsdelivr.com/package/npm/webgl-fluid)
- Base teórica habitual: "Stable Fluids" de Jos Stam (1999), implementable en fragment shaders WebGL — [RHEO fluid lab](https://golden-linden-rwqy.here.now/README.md)
- Codrops (feb-2025): artículo sobre simulaciones de fluidos de alto rendimiento con WebGPU de Hector Arellano ("Particles, Progress, and Perseverance: A Journey into WebGPU Fluids"); requiere WebGPU — [Codrops](https://tympanus.net/codrops/?p=84103); [archivo feb-2025](https://tympanus.net/codrops/2025/02/)
- Componentes de referencia: carrusel "Ink Flow" donde cada slide es pintura húmeda con simulación de fluido GPU; shader "Celestial Ink"; "Dye Whorl" — [21st.dev Ink Flow Carousel](https://21st.dev/@kedhareswer/components/ink-flow-carousel.md); [21st.dev Celestial Ink](https://21st.dev/@dhileepkumargm/components/celestial-ink-shader.md); [21st.dev Dye Whorl](https://21st.dev/@nikolas-sapa/components/dye-whorl.md)
- Hover con distorsión de imagen: tutorial Codrops con Three.js (desplazamiento RGB, image trail, stretch); hover "gooey" con ruido en shader (Arno Di Nunzio); playground OGL de Robin Delaporte con distorsión fluida al hover; tutorial OGL de galería infinita con GLSL — [Codrops: Motion Hover Effects](https://tympanus.net/codrops/?p=44003); [Codrops: Interactive WebGL Hover Effects](https://tympanus.net/codrops/?p=49069); [gooey-hover-codrops](https://github.com/aqro/gooey-hover-codrops); [Codrops: WebGL Distortion Hover Effects](https://tympanus.net/codrops/?p=34430)

### Inferences
- Stack propuesto (inferencia): Next.js/Astro + GSAP (ScrollTrigger, SplitText para titulares, Flip para filtros del portfolio, MorphSVG/DrawSVG para trazos de "línea fina" tipo tatuaje) + Lenis como scroll suave; un único canvas WebGL (OGL si solo son planos de imagen con shaders; Three.js/R3F si hay 3D) para el hero de tinta y los hovers de distorsión; View Transitions nativas para transiciones de página (en vez de Barba, sin releases desde 2024).
- Evitar dependencias estancadas (curtains.js 2024, Theatre.js 0.7.2 de 2024, Barba 2024) para un proyecto nuevo, salvo que se acepte mantenimiento propio.
- Lottie/dotLottie o Rive sirven para microanimaciones vectoriales (icono de máquina, firma del artista); Rive es MIT en el runtime, pero el editor es un SaaS (no verificado aquí).
- Spline es cómodo para prototipar 3D pero el runtime no declara licencia en npm; revisar términos y peso antes de usarlo en producción.

### Gaps
- No se pudo leer la licencia completa de gsap.com ni la página de precios de Motion+ (bloqueo de fetch).
- No se verificaron términos/licencia del editor de Rive ni de Spline, ni el peso de sus runtimes.
- No se encontró un tutorial Codrops 2025–2026 específico de "tinta en WebGL"; los recursos de tinta encontrados son componentes de 21st.dev y la simulación MIT de Dobryakov.
- Estado "estable vs experimental" de WebGPURenderer en three r186 no confirmado.

## 4. Rendimiento y accesibilidad con animación pesada

### Takeaway
Los objetivos son LCP ≤ 2,5 s, INP ≤ 200 ms y CLS ≤ 0,1 en el percentil 75 de usuarios reales; con animación pesada eso implica: hero LCP como imagen (no WebGL) con `fetchpriority="high"` y AVIF/WebP, WebGL cargado después y desactivable, y respeto de `prefers-reduced-motion` (desactivar Lenis y simplificar ScrollTrigger con `gsap.matchMedia`).

### Cited Findings
- Umbrales "good": LCP ≤ 2.500 ms, INP ≤ 200 ms, CLS ≤ 0,1, medidos en el percentil 75; "poor": LCP > 4.000 ms, INP > 500 ms, CLS > 0,25 — [web.dev: Defining the Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
- INP sustituyó a FID como Core Web Vital en marzo de 2024; Google se basa en datos de campo, Lighthouse es solo un proxy — [ppc.land](https://ppc.land/core-web-vitals/); [Unlighthouse](https://unlighthouse.dev/learn-lighthouse/core-web-vitals.md)
- `gsap.matchMedia()` permite registrar animaciones bajo condiciones como `(prefers-reduced-motion: reduce)` y revertir todas sus animaciones/ScrollTriggers con `revert()`; el ejemplo oficial pone duración 0 en reduced motion — [GSAP docs: gsap.matchMedia()](https://gsap.com/docs/v3/GSAP/gsap.matchMedia/)
- Patrón habitual: comprobar `prefers-reduced-motion` antes de instanciar Lenis (o `smoothWheel: !reduced`) — [hontran.dev](https://www.hontran.dev/blog/nextjs-smooth-scroll-gsap-lenis)
- Usar `fetchpriority="high"` solo en 1–2 imágenes, nunca en una imagen con lazy; lazy-loading solo below-the-fold (un hero lazy retrasa el LCP); precargar el hero si su URL se conoce pronto en el HTML — [ApogeeWatcher](https://apogeewatcher.com/blog/image-optimisation-strategies-better-lcp-scores)
- Servir AVIF/WebP como hermanos del original; un plugin trata el poster del vídeo como objetivo LCP y lo precarga (afirmación de plugin, no estándar) — [FetchPriority Featured Image (WordPress)](https://wordpress.org/plugins/fetchpriority-featured-image)
- Three.js: WebGPU con fallback WebGL 2; probar el path WebGL (`forceWebGL`) y Firefox/Linux — [three.js manual](https://threejs.org/manual/en/webgpurenderer.html); [buildmvpfast](https://www.buildmvpfast.com/blog/threejs-webgl-to-webgpu-renderer-migration-2026)

### Inferences
- Arquitectura recomendada (inferencia): renderizar el hero con una imagen/vídeo poster AVIF como elemento LCP y montar el canvas WebGL encima tras `requestIdleCallback`/IntersectionObserver; si `prefers-reduced-motion`, `navigator.connection.saveData`, poca memoria o WebGL no disponible → mantener la imagen estática.
- Para INP: no ejecutar trabajo pesado en handlers de `pointermove` (cursor magnético) fuera de `requestAnimationFrame`; animar solo `transform`/`opacity`.
- Para CLS: reservar `aspect-ratio` en todas las imágenes del portfolio y aplicar SplitText tras cargar las fuentes (`document.fonts.ready`) para evitar saltos de línea.
- En móvil: limitar devicePixelRatio del canvas (p. ej. a 1,5–2), reducir resolución de la simulación de fluido y desactivar hovers de distorsión (no hay hover en táctil).

### Gaps
- No se pudo leer web.dev directamente (las cifras vienen de snippets coherentes entre varias fuentes).
- Sin fuente verificada sobre si un `<video>` o su poster cuentan como candidato LCP, ni sobre buenas prácticas de codificación de vídeo (AV1/HEVC/H.264, bitrates) para heros.
- Sin datos verificados de soporte de AVIF por navegador en 2026.

## 5. Patrones de diseño de lujo: qué hace que un sitio se sienta "premium" frente a "plantilla"

### Takeaway
Las fuentes coinciden en: contención (poco ruido, sin CTAs estridentes), mucho espacio en blanco, jerarquía tipográfica muy controlada (serif clásica para herencia/artesanía o sans geométrica gigante + texto utilitario mínimo) y motion sutil que guía la atención. En tatuaje de lujo: paletas negro/beige o negro + un acento metálico y un "aire de galería".

### Cited Findings
- Marcas como Dior y Rolex usan serifs clásicas para evocar atemporalidad, artesanía y autoridad — [Designveloper: luxurious websites](https://www.designveloper.com/blog/luxurious-websites)
- Un sistema de diseño de lujo 2025 combina titulares masivos y en negrita con texto utilitario hiperminimalista y usa el tracking (letter-spacing) para jerarquía — [Superdesign: Luxury-focused Design System](https://superdesign.dev/library/luxury-focused-design-system)
- Kerning, jerarquía y contención son lo que hace funcionar la tipografía premium — [IIAD: Why some websites just feel expensive](https://www.iiad.edu.in/the-circle/why-some-websites-just-feel-expensive/)
- El espacio en blanco generoso evita el desorden y centra la atención en el producto; el desorden resta sensación premium; se cita a NN/g (el espacio en blanco mejora la comprensión hasta un 20%; cita de segunda mano) — [KIJO London](https://kijo.london/blog/luxury-website-design); [Designveloper](https://www.designveloper.com/blog/luxurious-websites)
- Los sitios premium evitan promociones llamativas y CTAs ruidosos; las animaciones deben ser suaves y guiar sin distraer — [Designveloper](https://www.designveloper.com/blog/luxurious-websites)
- Cartier se cita por su espacio en blanco generoso e imaginería contenida; Gorjana por su layout editorial — [10Web](https://10web.io/blog/jewelry-website-examples/); [Colorlib](https://colorlib.com/wp/jewelry-website-design/)
- Tatuaje: negro-beige + serif + estética de galería (Atelier Eva); negro + blanco + un acento metálico (brand kit); negro y oro para estudio privado de alto nivel (brief real) — [Colorlib](https://colorlib.com/wp/tattoo-studio-website-examples/); [Lovart](https://www.lovart.ai/ko/blog/brand-kit-tattoo-studio-lovart); [DesignCrowd](https://www.designcrowd.com/web-design/contest/4024464)
- Monolith (referente directo): casi negro + tipografía display sobredimensionada + 3D — [Abduzeedo](https://abduzeedo.com/node/89302)
- Floema (SOTM may-2026) destacado por diseño refinado y minimalista — [Muzli](https://muz.li/blog/the-best-creative-websites-of-the-month-april-2026/)

### Inferences
- "Premium vs plantilla" (inferencia a partir de lo anterior y de los referentes premiados): lo premium tiene una idea de marca propia traducida a interacción (blob de Lando Norris, objeto protagonista de Oryzo); lo genérico usa fade-ups iguales en todo, carruseles estándar, iconos de stock, CTAs gritones y tipografía del sistema.
- Para el estudio: pareja editorial serif de alto contraste (titulares) + grotesk neutra (UI); fondo casi negro (no #000 puro) con texto hueso/beige; grano sutil como textura de "papel/piel"; fotografía grande de obra cicatrizada con dirección de arte coherente; microinteracciones discretas (cursor que "entinta", subrayados que se dibujan con DrawSVG).
- El grano es una práctica extendida en el circuito Awwwards, pero no se encontró una fuente que lo documente (ver Gaps).

### Gaps
- Ninguna fuente encontrada documenta el uso de texturas de grano/ruido como señal de lujo.
- No se encontraron fuentes que nombren pares tipográficos concretos (familias específicas) usados por los sitios premiados citados.
- Las fuentes de esta sección son en su mayoría blogs de agencias, no investigación independiente.
