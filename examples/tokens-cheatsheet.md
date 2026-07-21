# Cheatsheet de tokens — mockup → Tailwind (tu `frontend/tailwind.config.js`)

Regla de oro: **nunca metas los hex crudos del mockup en el código React.**
Traducilos a la clase de Tailwind equivalente. Tu config ya define todos estos.

## Colores

| Hex mockup | Clase Tailwind |
|---|---|
| `#0e1a28` | `primary` (`bg-primary` / `text-primary`) |
| `#232F3E` | `primary-container` |
| `#fbf9fa` | `background` / `surface` |
| `#ffffff` | `surface-container-lowest` |
| `#f0edee` | `surface-container` |
| `#eae7e9` | `surface-container-high` (bordes) |
| `#c5c6cc` | `outline-variant` (bordes input) |
| `#FE9800` | `secondary-container` (naranja CTA) |
| `#8A5100` | `secondary` |
| `#337475` | teal accent (links "Ver tienda") |
| `#003435` | `tertiary-container` |
| `#1b1b1d` | `on-surface` (texto principal) |
| `#44474c` | `on-surface-variant` |
| `#75777c` | `outline` (captions) |
| `#ba1a1a` | `error` |
| verde check | `verified` (`#0CAE53`) |

## Tipografía

| Mockup | Clase |
|---|---|
| Montserrat | `font-display` |
| Inter | `font-body` |
| 48/56 700 | `text-display-lg` |
| 30-32 700 | `text-headline-lg` |
| 24 600 | `text-headline-md` |
| 20 600 | `text-title-lg` |
| 18 400 | `text-body-lg` |
| 14-16 400 | `text-body-md` |
| 14 600 | `text-label-md` |
| 11-12 500 | `text-label-sm` |

## Forma / layout

| Mockup | Clase |
|---|---|
| `border-radius:16px` (tarjetas) | `rounded-lg` |
| `border-radius:8px` (botones/inputs) | `rounded` |
| pills/badges | `rounded-full` |
| `max-width:1280px; margin auto; padding 24px` | `.container-app` |
| `box-shadow:0 4px 20px rgba(35,47,62,.05)` | `shadow-sm` (hover `shadow-md`) |

## Íconos (SVG inline del mockup → lucide-react)

carrito → `ShoppingCart` · buscar → `Search` · usuario → `User` ·
envío → `Truck` · pago seguro → `ShieldCheck` · devolución → `RotateCcw` ·
soporte → `Headphones` · favorito → `Heart` · rating → `Star` ·
ubicación → `MapPin` · flecha → `ArrowRight` · check verificado →
tu `components/ui/VerifiedBadge.jsx`.

## Categorías de tipo de negocio (Bloque 18) → ícono lucide-react

`BusinessCategory.icon` guarda el nombre exacto del export de lucide-react
(validado en `businessCategories.controller.js` contra la librería real, no
un mapa hardcodeado — cualquier ícono nuevo que exista en lucide-react ya
sirve sin tocar código). Mapeo elegido para la semilla inicial
(`cuba-seed-data.js` → `businessCategories`):

| Categoría | Ícono | Categoría | Ícono |
|---|---|---|---|
| Tienda general | `Store` | Servicios informáticos | `Server` |
| Catálogo | `BookOpen` | Floristería | `Flower2` |
| Belleza | `Sparkles` | Panadería | `Croissant` |
| Tienda de regalos | `Gift` | Servicio de fotografía | `Camera` |
| Combos | `PackagePlus` | Hamburguesa | `Sandwich` |
| Dulcería | `Candy` | Óptica | `Glasses` |
| Ropa | `Shirt` | Academia | `GraduationCap` |
| Arte y artesanía | `Palette` | Pescadería | `Fish` |
| Cafetería y comida rápida | `Utensils` | Enoteca | `Wine` |
| Restaurante | `UtensilsCrossed` | Consultoría | `Briefcase` |
| Bar | `Martini` | Impresión y personalización | `Printer` |
| Hogar y decoración | `Sofa` | Café | `Coffee` |
| Artículos de aseo | `SprayCan` | Juguetería | `ToyBrick` |
| Grocery o bodegón | `ShoppingBasket` | Gym | `Dumbbell` |
| Ferretería | `Hammer` | Marketing y publicidad | `Megaphone` |
| Perfumería | `FlaskConical` | Set | `Package` |
| Cosmética natural | `Leaf` | Shop | `ShoppingBag` |
| Joyería y relojería | `Gem` | Heladería | `IceCreamCone` |
| Ropa deportiva | `Footprints` | Productos naturales | `Sprout` |
| Móviles y accesorios | `Smartphone` | Organización de eventos | `PartyPopper` |
| Salud y farmacia | `Pill` | Tienda de mascotas | `PawPrint` |
| Carnicería | `Beef` | Computadoras y accesorios | `Laptop` |
| Pizzería | `Pizza` | Imprenta | `Newspaper` |
| Artículos para bebés | `Baby` | Automotriz | `Car` |
| Tienda de videojuegos | `Gamepad2` | | |

Resolución en frontend: `components/ui/CategoryIcon.jsx` hace
`Icons[name] ?? Store` (fallback silencioso si algún día un nombre guardado
dejara de existir en una versión futura de la librería).

## Moneda

El mockup formatea con `es-AR` + `$`. **Usá tu formato real:**
`Number(price).toLocaleString("es-CU")` + `"CUP"` (como tu `ProductCard.jsx`).
