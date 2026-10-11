// Catálogos iniciales: etiquetas de producto, tipos de negocio, países y provincias o estados.
// Equivale a cargarlos a mano desde el panel de admin (Marca, Categorías de negocio, Países y provincias).
// Es seguro repetirlo: solo AGREGA lo que falta (por código, nombre o slug) y nunca modifica ni borra lo que ya existe.
// Uso (desde la carpeta backend, con DATABASE_URL en el entorno):  node prisma/seed-catalogos.mjs [--dry-run]
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry-run");
const prisma = new PrismaClient();

// ---------------------------------------------------------------- etiquetas de producto (máximo 20 en total)
const BADGES = [
  "Oferta", "Más vendido", "Recomendado", "Liquidación", "Últimas unidades", "Envío gratis", "Hecho a mano",
  "Producto local", "Orgánico", "Con garantía", "Importado", "Edición limitada", "Combo", "De temporada",
  "Precio especial", "Entrega inmediata",
];

// ---------------------------------------------------------------- tipos de negocio: [nombre, slug, ícono de lucide]
const BUSINESS = [
  ["Panadería y repostería", "panaderia-y-reposteria", "Croissant"],
  ["Dulces y chocolates", "dulces-y-chocolates", "Candy"],
  ["Carnicería y embutidos", "carniceria-y-embutidos", "Beef"],
  ["Pescados y mariscos", "pescados-y-mariscos", "Fish"],
  ["Frutas y verduras", "frutas-y-verduras", "Apple"],
  ["Granos, cereales y despensa", "granos-cereales-y-despensa", "Wheat"],
  ["Lácteos y huevos", "lacteos-y-huevos", "Milk"],
  ["Bebidas y licores", "bebidas-y-licores", "Wine"],
  ["Cervecería y bar", "cerveceria-y-bar", "Beer"],
  ["Heladería", "heladeria", "IceCream"],
  ["Comida rápida", "comida-rapida", "Sandwich"],
  ["Pizzería", "pizzeria", "Pizza"],
  ["Comida para llevar y catering", "comida-para-llevar-y-catering", "ChefHat"],
  ["Productos naturales y orgánicos", "productos-naturales-y-organicos", "Leaf"],
  ["Mayorista y distribuidora", "mayorista-y-distribuidora", "Warehouse"],
  ["Calzado", "calzado", "Footprints"],
  ["Joyería y accesorios", "joyeria-y-accesorios", "Gem"],
  ["Bolsos, mochilas y equipaje", "bolsos-mochilas-y-equipaje", "Backpack"],
  ["Ropa infantil y bebés", "ropa-infantil-y-bebes", "Baby"],
  ["Juguetes y juegos", "juguetes-y-juegos", "Gamepad2"],
  ["Óptica", "optica", "Glasses"],
  ["Peluquería y barbería", "peluqueria-y-barberia", "Scissors"],
  ["Spa, uñas y estética", "spa-unas-y-estetica", "Flower2"],
  ["Computadoras y laptops", "computadoras-y-laptops", "Laptop"],
  ["Electrodomésticos", "electrodomesticos", "Plug"],
  ["Televisores y audio", "televisores-y-audio", "Tv"],
  ["Celulares, recargas y accesorios", "celulares-recargas-y-accesorios", "Signal"],
  ["Baterías y energía solar", "baterias-y-energia-solar", "Sun"],
  ["Videojuegos y consolas", "videojuegos-y-consolas", "Gamepad2"],
  ["Fotografía y video", "fotografia-y-video", "Camera"],
  ["Música e instrumentos", "musica-e-instrumentos", "Music"],
  ["Impresión y diseño gráfico", "impresion-y-diseno-grafico", "Printer"],
  ["Papelería y libros", "papeleria-y-libros", "BookOpen"],
  ["Arte y manualidades", "arte-y-manualidades", "Palette"],
  ["Flores y regalos", "flores-y-regalos", "Gift"],
  ["Eventos y fiestas", "eventos-y-fiestas", "PartyPopper"],
  ["Deportes y fitness", "deportes-y-fitness", "Dumbbell"],
  ["Bicicletas y motos", "bicicletas-y-motos", "Bike"],
  ["Autos y repuestos", "autos-y-repuestos", "Car"],
  ["Construcción y materiales", "construccion-y-materiales", "HardHat"],
  ["Pinturas y acabados", "pinturas-y-acabados", "PaintRoller"],
  ["Electricidad y plomería", "electricidad-y-plomeria", "Zap"],
  ["Muebles", "muebles", "Bed"],
  ["Iluminación y decoración", "iluminacion-y-decoracion", "Lamp"],
  ["Textiles y ropa de cama", "textiles-y-ropa-de-cama", "Shirt"],
  ["Jardinería y agro", "jardineria-y-agro", "Sprout"],
  ["Agropecuaria y veterinaria", "agropecuaria-y-veterinaria", "Tractor"],
  ["Limpieza y lavandería", "limpieza-y-lavanderia", "Droplets"],
  ["Clínica y consulta médica", "clinica-y-consulta-medica", "Stethoscope"],
  ["Odontología", "odontologia", "Smile"],
  ["Educación y clases particulares", "educacion-y-clases-particulares", "GraduationCap"],
  ["Mensajería y transporte", "mensajeria-y-transporte", "Truck"],
  ["Alquiler de casas y habitaciones", "alquiler-de-casas-y-habitaciones", "BedDouble"],
  ["Turismo y excursiones", "turismo-y-excursiones", "Plane"],
  ["Artesanías", "artesanias", "Hand"],
];

// ---------------------------------------------------------------- países y sus provincias, estados o regiones.
// Fuera de Cuba cada división es de tipo "STATE" (no lleva municipios; la ciudad se escribe a mano al pedir).
// Código de la provincia: <país>-<abreviatura> en minúsculas, único en toda la base.
const numbered = (names) => names.map((n, i) => [String(i + 1).padStart(2, "0"), n]);
const COUNTRIES = [
  {
    code: "US", name: "Estados Unidos",
    divisions: [
      ["al", "Alabama"], ["ak", "Alaska"], ["az", "Arizona"], ["ar", "Arkansas"], ["ca", "California"], ["nc", "Carolina del Norte"],
      ["sc", "Carolina del Sur"], ["co", "Colorado"], ["ct", "Connecticut"], ["nd", "Dakota del Norte"], ["sd", "Dakota del Sur"],
      ["de", "Delaware"], ["dc", "Distrito de Columbia"], ["fl", "Florida"], ["ga", "Georgia"], ["hi", "Hawái"], ["id", "Idaho"],
      ["il", "Illinois"], ["in", "Indiana"], ["ia", "Iowa"], ["ks", "Kansas"], ["ky", "Kentucky"], ["la", "Luisiana"], ["me", "Maine"],
      ["md", "Maryland"], ["ma", "Massachusetts"], ["mi", "Míchigan"], ["mn", "Minnesota"], ["ms", "Misisipi"], ["mo", "Misuri"],
      ["mt", "Montana"], ["ne", "Nebraska"], ["nv", "Nevada"], ["nj", "Nueva Jersey"], ["ny", "Nueva York"], ["nh", "Nuevo Hampshire"],
      ["nm", "Nuevo México"], ["oh", "Ohio"], ["ok", "Oklahoma"], ["or", "Oregón"], ["pa", "Pensilvania"], ["ri", "Rhode Island"],
      ["tn", "Tennessee"], ["tx", "Texas"], ["ut", "Utah"], ["vt", "Vermont"], ["va", "Virginia"], ["wv", "Virginia Occidental"],
      ["wa", "Washington"], ["wi", "Wisconsin"], ["wy", "Wyoming"], ["pr", "Puerto Rico"],
    ],
  },
  {
    code: "ES", name: "España",
    divisions: numbered([
      "Álava", "Albacete", "Alicante", "Almería", "Ávila", "Badajoz", "Islas Baleares", "Barcelona", "Burgos", "Cáceres", "Cádiz", "Castellón",
      "Ciudad Real", "Córdoba", "A Coruña", "Cuenca", "Girona", "Granada", "Guadalajara", "Gipuzkoa", "Huelva", "Huesca", "Jaén", "León",
      "Lleida", "La Rioja", "Lugo", "Madrid", "Málaga", "Murcia", "Navarra", "Ourense", "Asturias", "Palencia", "Las Palmas", "Pontevedra",
      "Salamanca", "Santa Cruz de Tenerife", "Cantabria", "Segovia", "Sevilla", "Soria", "Tarragona", "Teruel", "Toledo", "Valencia",
      "Valladolid", "Bizkaia", "Zamora", "Zaragoza", "Ceuta", "Melilla",
    ]),
  },
  {
    code: "MX", name: "México",
    divisions: [
      ["agu", "Aguascalientes"], ["bcn", "Baja California"], ["bcs", "Baja California Sur"], ["cam", "Campeche"], ["chp", "Chiapas"],
      ["chh", "Chihuahua"], ["cmx", "Ciudad de México"], ["coa", "Coahuila"], ["col", "Colima"], ["dur", "Durango"], ["gua", "Guanajuato"],
      ["gro", "Guerrero"], ["hid", "Hidalgo"], ["jal", "Jalisco"], ["mex", "Estado de México"], ["mic", "Michoacán"], ["mor", "Morelos"],
      ["nay", "Nayarit"], ["nle", "Nuevo León"], ["oax", "Oaxaca"], ["pue", "Puebla"], ["que", "Querétaro"], ["roo", "Quintana Roo"],
      ["slp", "San Luis Potosí"], ["sin", "Sinaloa"], ["son", "Sonora"], ["tab", "Tabasco"], ["tam", "Tamaulipas"], ["tla", "Tlaxcala"],
      ["ver", "Veracruz"], ["yuc", "Yucatán"], ["zac", "Zacatecas"],
    ],
  },
  {
    code: "CA", name: "Canadá",
    divisions: [
      ["ab", "Alberta"], ["bc", "Columbia Británica"], ["mb", "Manitoba"], ["nb", "Nuevo Brunswick"], ["nl", "Terranova y Labrador"],
      ["ns", "Nueva Escocia"], ["nt", "Territorios del Noroeste"], ["nu", "Nunavut"], ["on", "Ontario"], ["pe", "Isla del Príncipe Eduardo"],
      ["qc", "Quebec"], ["sk", "Saskatchewan"], ["yt", "Yukón"],
    ],
  },
  {
    code: "DO", name: "República Dominicana",
    divisions: numbered([
      "Azua", "Bahoruco", "Barahona", "Dajabón", "Distrito Nacional", "Duarte", "Elías Piña", "El Seibo", "Espaillat", "Hato Mayor",
      "Hermanas Mirabal", "Independencia", "La Altagracia", "La Romana", "La Vega", "María Trinidad Sánchez", "Monseñor Nouel", "Monte Cristi",
      "Monte Plata", "Pedernales", "Peravia", "Puerto Plata", "Samaná", "San Cristóbal", "San José de Ocoa", "San Juan", "San Pedro de Macorís",
      "Sánchez Ramírez", "Santiago", "Santiago Rodríguez", "Santo Domingo", "Valverde",
    ]),
  },
  {
    code: "PA", name: "Panamá",
    divisions: numbered([
      "Bocas del Toro", "Chiriquí", "Coclé", "Colón", "Darién", "Herrera", "Los Santos", "Panamá", "Panamá Oeste", "Veraguas",
      "Comarca Guna Yala", "Comarca Emberá-Wounaan", "Comarca Ngäbe-Buglé",
    ]),
  },
  {
    code: "CO", name: "Colombia",
    divisions: numbered([
      "Amazonas", "Antioquia", "Arauca", "Atlántico", "Bolívar", "Boyacá", "Caldas", "Caquetá", "Casanare", "Cauca", "Cesar", "Chocó", "Córdoba",
      "Cundinamarca", "Guainía", "Guaviare", "Huila", "La Guajira", "Magdalena", "Meta", "Nariño", "Norte de Santander", "Putumayo", "Quindío",
      "Risaralda", "San Andrés y Providencia", "Santander", "Sucre", "Tolima", "Valle del Cauca", "Vaupés", "Vichada", "Bogotá D.C.",
    ]),
  },
  {
    code: "VE", name: "Venezuela",
    divisions: numbered([
      "Amazonas", "Anzoátegui", "Apure", "Aragua", "Barinas", "Bolívar", "Carabobo", "Cojedes", "Delta Amacuro", "Falcón", "Guárico", "Lara",
      "Mérida", "Miranda", "Monagas", "Nueva Esparta", "Portuguesa", "Sucre", "Táchira", "Trujillo", "La Guaira", "Yaracuy", "Zulia",
      "Distrito Capital", "Dependencias Federales",
    ]),
  },
  {
    code: "AR", name: "Argentina",
    divisions: numbered([
      "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza",
      "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego",
      "Tucumán", "Ciudad Autónoma de Buenos Aires",
    ]),
  },
  {
    code: "CL", name: "Chile",
    divisions: numbered([
      "Arica y Parinacota", "Tarapacá", "Antofagasta", "Atacama", "Coquimbo", "Valparaíso", "Región Metropolitana de Santiago",
      "Libertador General Bernardo O'Higgins", "Maule", "Ñuble", "Biobío", "La Araucanía", "Los Ríos", "Los Lagos", "Aysén",
      "Magallanes y de la Antártica Chilena",
    ]),
  },
  {
    code: "PE", name: "Perú",
    divisions: numbered([
      "Amazonas", "Áncash", "Apurímac", "Arequipa", "Ayacucho", "Cajamarca", "Callao", "Cusco", "Huancavelica", "Huánuco", "Ica", "Junín",
      "La Libertad", "Lambayeque", "Lima", "Loreto", "Madre de Dios", "Moquegua", "Pasco", "Piura", "Puno", "San Martín", "Tacna", "Tumbes", "Ucayali",
    ]),
  },
  {
    code: "EC", name: "Ecuador",
    divisions: numbered([
      "Azuay", "Bolívar", "Cañar", "Carchi", "Chimborazo", "Cotopaxi", "El Oro", "Esmeraldas", "Galápagos", "Guayas", "Imbabura", "Loja",
      "Los Ríos", "Manabí", "Morona Santiago", "Napo", "Orellana", "Pastaza", "Pichincha", "Santa Elena", "Santo Domingo de los Tsáchilas",
      "Sucumbíos", "Tungurahua", "Zamora Chinchipe",
    ]),
  },
  {
    code: "BR", name: "Brasil",
    divisions: [
      ["ac", "Acre"], ["al", "Alagoas"], ["ap", "Amapá"], ["am", "Amazonas"], ["ba", "Bahía"], ["ce", "Ceará"], ["df", "Distrito Federal"],
      ["es", "Espírito Santo"], ["go", "Goiás"], ["ma", "Maranhão"], ["mt", "Mato Grosso"], ["ms", "Mato Grosso do Sul"], ["mg", "Minas Gerais"],
      ["pa", "Pará"], ["pb", "Paraíba"], ["pr", "Paraná"], ["pe", "Pernambuco"], ["pi", "Piauí"], ["rj", "Río de Janeiro"], ["rn", "Río Grande do Norte"],
      ["rs", "Río Grande do Sul"], ["ro", "Rondônia"], ["rr", "Roraima"], ["sc", "Santa Catarina"], ["sp", "São Paulo"], ["se", "Sergipe"], ["to", "Tocantins"],
    ],
  },
  {
    code: "UY", name: "Uruguay",
    divisions: numbered([
      "Artigas", "Canelones", "Cerro Largo", "Colonia", "Durazno", "Flores", "Florida", "Lavalleja", "Maldonado", "Montevideo", "Paysandú",
      "Río Negro", "Rivera", "Rocha", "Salto", "San José", "Soriano", "Tacuarembó", "Treinta y Tres",
    ]),
  },
  { code: "CR", name: "Costa Rica", divisions: numbered(["San José", "Alajuela", "Cartago", "Heredia", "Guanacaste", "Puntarenas", "Limón"]) },
  {
    code: "IT", name: "Italia",
    divisions: numbered([
      "Abruzos", "Basilicata", "Calabria", "Campania", "Emilia-Romaña", "Friuli-Venecia Julia", "Lacio", "Liguria", "Lombardía", "Marcas", "Molise",
      "Piamonte", "Apulia", "Cerdeña", "Sicilia", "Toscana", "Trentino-Alto Adigio", "Umbría", "Valle de Aosta", "Véneto",
    ]),
  },
];

const stats = { badges: 0, business: 0, countries: 0, provinces: 0, skipped: 0 };
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// ---- etiquetas
{
  const settings = await prisma.siteSettings.findFirst();
  if (!settings) {
    console.log("No hay configuración del sitio todavía: las etiquetas se omiten.");
  } else {
    const current = settings.availableProductBadges ?? [];
    const have = new Set(current.map(norm));
    const next = [...current];
    for (const b of BADGES) {
      if (have.has(norm(b))) continue;
      if (next.length >= 20) { stats.skipped++; continue; }
      next.push(b);
      stats.badges++;
    }
    if (!DRY && next.length !== current.length) await prisma.siteSettings.update({ where: { id: settings.id }, data: { availableProductBadges: next } });
  }
}

// ---- tipos de negocio
{
  const existing = await prisma.businessCategory.findMany({ select: { slug: true, name: true, sortOrder: true } });
  const slugs = new Set(existing.map((b) => b.slug));
  const names = new Set(existing.map((b) => norm(b.name)));
  let order = existing.reduce((m, b) => Math.max(m, b.sortOrder), -1) + 1;
  for (const [name, slug, icon] of BUSINESS) {
    if (slugs.has(slug) || names.has(norm(name))) continue;
    if (!DRY) await prisma.businessCategory.create({ data: { name, slug, icon, sortOrder: order, active: true } });
    order++;
    stats.business++;
  }
}

// ---- países y provincias o estados
for (const c of COUNTRIES) {
  let country = await prisma.country.findUnique({ where: { code: c.code } });
  if (!country) {
    if (!DRY) country = await prisma.country.create({ data: { code: c.code, name: c.name } });
    stats.countries++;
  }
  const existing = country ? await prisma.province.findMany({ where: { countryId: country.id }, select: { code: true, name: true } }) : [];
  const codes = new Set(existing.map((p) => p.code));
  const names = new Set(existing.map((p) => norm(p.name)));
  for (const [abbr, name] of c.divisions) {
    const code = `${c.code.toLowerCase()}-${abbr}`;
    if (codes.has(code) || names.has(norm(name))) continue;
    if (await prisma.province.findUnique({ where: { code }, select: { id: true } })) continue;
    if (!DRY && country) await prisma.province.create({ data: { code, name, type: "STATE", countryId: country.id } });
    stats.provinces++;
  }
}

// ---- Cuba (provincias, municipios y cercanía entre provincias), categorías de producto y los tipos de negocio originales.
// Los datos salen de prisma/catalogos-cuba.json (exportado de la base de desarrollo).
const cuba = JSON.parse(readFileSync(new URL("./catalogos-cuba.json", import.meta.url), "utf8"));
stats.municipalities = 0; stats.links = 0; stats.categories = 0;
{
  let country = await prisma.country.findUnique({ where: { code: cuba.cuba.code } });
  if (!country) {
    if (!DRY) country = await prisma.country.create({ data: { code: cuba.cuba.code, name: cuba.cuba.name } });
    stats.countries++;
  }
  const provinceByCode = {};
  for (const pv of cuba.provincias) {
    let row = await prisma.province.findUnique({ where: { code: pv.code } });
    if (!row && country) row = await prisma.province.findFirst({ where: { countryId: country.id, name: pv.name } });
    if (!row) {
      if (!DRY && country) row = await prisma.province.create({ data: { code: pv.code, name: pv.name, type: pv.type, countryId: country.id } });
      stats.provinces++;
    }
    if (row) provinceByCode[pv.code] = row;
    if (!row) continue;
    const have = new Set((await prisma.municipality.findMany({ where: { provinceId: row.id }, select: { name: true } })).map((m) => norm(m.name)));
    for (const name of pv.municipios) {
      if (have.has(norm(name))) continue;
      if (!DRY) await prisma.municipality.create({ data: { provinceId: row.id, name } });
      stats.municipalities++;
    }
  }
  for (const [a, b] of cuba.adyacencias) {
    const A = provinceByCode[a], B = provinceByCode[b];
    if (!A || !B) continue;
    const found = await prisma.provinceAdjacency.findFirst({ where: { OR: [{ provinceAId: A.id, provinceBId: B.id }, { provinceAId: B.id, provinceBId: A.id }] } });
    if (found) continue;
    if (!DRY) await prisma.provinceAdjacency.create({ data: { provinceAId: A.id, provinceBId: B.id } });
    stats.links++;
  }
  // categorías de producto: primero las principales y después sus subcategorías
  const catBySlug = Object.fromEntries((await prisma.category.findMany()).map((c) => [c.slug, c]));
  for (const c of [...cuba.categorias.filter((x) => !x.parent), ...cuba.categorias.filter((x) => x.parent)]) {
    if (catBySlug[c.slug]) continue;
    const parent = c.parent ? catBySlug[c.parent] : null;
    if (!DRY) catBySlug[c.slug] = await prisma.category.create({ data: { slug: c.slug, name: c.name, parentId: parent?.id ?? null } });
    stats.categories++;
  }
  // tipos de negocio originales
  const slugs = new Set((await prisma.businessCategory.findMany({ select: { slug: true } })).map((b) => b.slug));
  let order = (await prisma.businessCategory.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? -1;
  for (const b of cuba.tiposDeNegocio) {
    if (slugs.has(b.slug)) continue;
    order++;
    if (!DRY) await prisma.businessCategory.create({ data: { name: b.name, slug: b.slug, icon: b.icon, sortOrder: order, active: true } });
    stats.business++;
  }
}

console.log(`${DRY ? "[simulación] " : ""}Agregado: ${stats.badges} etiquetas, ${stats.business} tipos de negocio, ${stats.countries} países, ${stats.provinces} provincias o estados, ${stats.municipalities} municipios, ${stats.links} cercanías, ${stats.categories} categorías de producto.` + (stats.skipped ? ` (${stats.skipped} etiquetas omitidas por el máximo de 20)` : ""));
console.log(`Totales ahora: etiquetas ${(await prisma.siteSettings.findFirst())?.availableProductBadges.length ?? 0}, tipos de negocio ${await prisma.businessCategory.count()}, países ${await prisma.country.count()}, provincias o estados ${await prisma.province.count()}, municipios ${await prisma.municipality.count()}, categorías de producto ${await prisma.category.count()}.`);
await prisma.$disconnect();
