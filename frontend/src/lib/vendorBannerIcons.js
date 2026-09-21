import {
  Utensils,
  UtensilsCrossed,
  ChefHat,
  Pizza,
  Sandwich,
  Soup,
  Salad,
  Coffee,
  CupSoda,
  Wine,
  Martini,
  Beer,
  IceCreamCone,
  Cake,
  CakeSlice,
  Cookie,
  Donut,
  Croissant,
  Apple,
  Banana,
  Cherry,
  Grape,
  Citrus,
  Carrot,
  Fish,
  Beef,
  Drumstick,
  Ham,
  Egg,
  Popcorn,
  LeafyGreen,
  Wheat,
  Shell,
  Shirt,
  ShoppingBag,
  Watch,
  Glasses,
  Footprints,
  Gem,
  Tag,
  Backpack,
  Briefcase,
  Umbrella,
  Sparkles,
  Droplet,
  Droplets,
  Scissors,
  Brush,
  Paintbrush,
  Palette,
  SprayCan,
  Bath,
  Flower,
  Flower2,
  Smartphone,
  Laptop,
  Monitor,
  Cpu,
  Headphones,
  Camera,
  Gamepad2,
  Keyboard,
  Mouse,
  Tv,
  Speaker,
  Router,
  Wifi,
  Battery,
  Printer,
  Server,
  Database,
  Tablet,
  Hammer,
  Wrench,
  Drill,
  Settings,
  Cog,
  Gauge,
  Plug,
  Zap,
  Construction,
  Truck,
  Warehouse,
  Box,
  Boxes,
  Sofa,
  Lamp,
  Home,
  Armchair,
  BedDouble,
  Bed,
  Blinds,
  DoorOpen,
  Table,
  Refrigerator,
  WashingMachine,
  ShoppingCart,
  Package,
  Milk,
  Pill,
  HeartPulse,
  Stethoscope,
  Syringe,
  Cross,
  Thermometer,
  Bandage,
  Ambulance,
  Hospital,
  FlaskConical,
  TestTube,
  ShieldPlus,
  PillBottle,
  Activity,
  BriefcaseMedical,
  PawPrint,
  Bone,
  Dog,
  Cat,
  Bird,
  Rabbit,
  Turtle,
  Squirrel,
  Gift,
  Store,
  CreditCard,
  Wallet,
} from "lucide-react";

// Bloque 207 (pedido explícito — "las tiendas no tendrán imágenes de
// banner... en el banner de cada tienda se mantendrá... color personalizado
// para cada una, degradado con iconos de formas dentro"): reemplaza la foto
// de portada (retirada, ver StoreHeaderBanner.jsx) por un patrón decorativo
// de íconos — el mismo `businessCategory` que la tienda ya elige al
// registrarse decide el tema, un restaurante ve comida, una tienda de ropa
// ve moda, etc. `isRestaurant` pesa más que la categoría (una cafetería con
// otra categoría cargada sigue siendo, ante todo, un negocio de comida).
// Cada tema trae ~15-30 íconos a propósito (pedido explícito — "muy
// repetitivos... deben ser más variados") — con una grilla de varias
// decenas de celdas, un tema de 5 íconos se repite demasiado seguido.
const THEMES = {
  food: [
    Utensils, UtensilsCrossed, ChefHat, Pizza, Sandwich, Soup, Salad, Coffee, CupSoda, Wine, Martini, Beer,
    IceCreamCone, Cake, CakeSlice, Cookie, Donut, Croissant, Apple, Banana, Cherry, Grape, Citrus, Carrot,
    Fish, Beef, Drumstick, Ham, Egg, Popcorn, LeafyGreen, Wheat, Shell,
  ],
  fashion: [Shirt, ShoppingBag, Watch, Glasses, Footprints, Gem, Tag, Backpack, Briefcase, Umbrella],
  beauty: [Sparkles, Droplet, Droplets, Scissors, Gem, Brush, Paintbrush, Palette, SprayCan, Bath, Flower, Flower2],
  tech: [
    Smartphone, Laptop, Monitor, Cpu, Headphones, Watch, Camera, Gamepad2, Keyboard, Mouse, Tv, Speaker,
    Router, Wifi, Battery, Printer, Server, Database, Tablet,
  ],
  hardware: [Hammer, Wrench, Drill, Settings, Cog, Gauge, Plug, Zap, Construction, Truck, Warehouse, Box, Boxes, Package],
  home: [Sofa, Lamp, Home, Armchair, BedDouble, Bed, Blinds, DoorOpen, Table, Refrigerator, WashingMachine, Flower2],
  grocery: [
    ShoppingCart, ShoppingBag, Package, Apple, Milk, Carrot, Wheat, Banana, Egg, Fish, Beef, Croissant, Coffee,
    Cherry, Grape,
  ],
  health: [
    Pill, HeartPulse, Stethoscope, Syringe, Cross, Thermometer, Bandage, Ambulance, Hospital, FlaskConical,
    TestTube, ShieldPlus, PillBottle, Activity, BriefcaseMedical,
  ],
  pets: [PawPrint, Bone, Dog, Cat, Fish, Bird, Rabbit, Turtle, Squirrel],
  services: [Wrench, Hammer, Settings, Drill, Cog, Gauge, Construction, Truck, Briefcase, Plug, Zap, Package],
  default: [ShoppingBag, Package, Tag, Gift, Store, Truck, Box, CreditCard, Wallet, Boxes],
};

const CATEGORY_THEME = {
  cafeteria: "food",
  restaurantes: "food",
  "moda-y-ropa": "fashion",
  "belleza-y-cuidado-personal": "beauty",
  tecnologia: "tech",
  ferreteria: "hardware",
  "hogar-y-decoracion": "home",
  "supermercado-y-abarrotes": "grocery",
  "farmacia-y-salud": "health",
  mascotas: "pets",
  "servicios-y-reparaciones": "services",
};

function themeFor(vendor) {
  if (vendor?.isRestaurant) return THEMES.food;
  const key = CATEGORY_THEME[vendor?.businessCategory?.slug];
  return THEMES[key] ?? THEMES.default;
}

// Hash simple del id — semilla determinística: la misma tienda siempre
// muestra el mismo patrón (no cambia en cada render/recarga).
function seedFrom(id) {
  let hash = 0;
  for (const ch of String(id ?? "")) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash || 1;
}
function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// "Bolsa" barajada (Fisher-Yates con la misma semilla) en vez de un sorteo
// independiente por celda — un sorteo puro repite el mismo ícono seguido
// tarde o temprano (más probable todavía con pocas celdas por tema chico).
// Barajando y consumiendo en orden, NINGÚN ícono se repite hasta que
// aparecieron todos los demás una vez — mucha más variedad a simple vista
// dentro de un mismo banner (pedido explícito).
function shuffledBag(icons, rand) {
  const bag = icons.slice();
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

// Grilla con jitter (en vez de posiciones 100% al azar) — reparte los
// íconos por todo el contenedor sin que el azar los amontone en una esquina
// y deje otra vacía, pero el jitter + rotación por ícono igual se ve
// orgánico, no como una grilla prolija.
// Bloque 207 (ajuste, pedido explícito — "más finos y más claros, un
// efecto único"): trazo fino (strokeWidth bajo, el default de lucide es 2)
// + opacidad más alta que la primera versión, MISMOS valores en cualquier
// lugar que use este patrón (banner grande de Store.jsx, tarjetas chicas de
// Shop.jsx) — "un efecto único" es un solo estilo consistente en toda la
// plataforma, no uno distinto por componente. `cols`/`rows` sí varían por
// tamaño real del contenedor (una tarjeta de 104px no entra la misma
// densidad que el banner completo de Store.jsx).
const STROKE_WIDTH = 1.25;
const MIN_OPACITY = 0.16;
const MAX_OPACITY = 0.28;

export function getBannerIconPattern(vendor, { cols = 9, rows = 5, minSize = 20, maxSize = 44 } = {}) {
  const icons = themeFor(vendor);
  const rand = mulberry32(seedFrom(vendor?.id));
  let bag = shuffledBag(icons, rand);
  let bagIndex = 0;
  function nextIcon() {
    if (bagIndex >= bag.length) {
      bag = shuffledBag(icons, rand);
      bagIndex = 0;
    }
    return bag[bagIndex++];
  }

  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cellW = 100 / cols;
      const cellH = 100 / rows;
      const jitterX = (rand() - 0.5) * cellW * 0.7;
      const jitterY = (rand() - 0.5) * cellH * 0.7;
      cells.push({
        key: `${row}-${col}`,
        Icon: nextIcon(),
        top: `${row * cellH + cellH / 2 + jitterY}%`,
        left: `${col * cellW + cellW / 2 + jitterX}%`,
        size: minSize + rand() * (maxSize - minSize),
        rotate: Math.floor(rand() * 360),
        opacity: MIN_OPACITY + rand() * (MAX_OPACITY - MIN_OPACITY),
        strokeWidth: STROKE_WIDTH,
      });
    }
  }
  return cells;
}
