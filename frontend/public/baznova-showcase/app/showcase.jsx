const NAVY = '#0e1a28', ORANGE = '#fe9800', TEAL = '#337475', INK = '#1b1b1d', HDR = '#232F3E';
const MOTION = { enter: Easing.easeOutCubic, draw: Easing.easeInOutCubic, pop: Easing.easeOutBack };
const A = (T, from, to, s, e, ease) => animate({ from, to, start: s, end: e, ease: ease || MOTION.draw })(T);
const fmt = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const MONT = "'Montserrat',sans-serif", INTER = "'Inter',sans-serif";
const IMG = (n) => 'assets/showcase/' + n + '.webp';

const ICONS = {
  home: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  box: 'M16.5 9.4 7.5 4.2M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7zM3.3 7 12 12l8.7-5M12 22V12',
  tag: 'M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2ZM7 7h.01',
  gift: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
  cart: 'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12M8 21h.01M19 21h.01',
  qr: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7',
  shield: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4',
  msg: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z',
  alert: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM12 8v4M12 16h.01',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  profile: 'M2 21a8 8 0 0 1 13.29-6M10 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM19 16v6M22 19h-6',
  laptop: 'M4 5h16v11H4zM2 19h20',
  check: 'M5 12l5 5L20 7',
  chev: 'M15 18l-6-6 6-6',
  trend: 'm22 7-8.5 8.5-5-5L2 17M16 7h6v6',
  bag: 'M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z',
  user: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  plus: 'M12 5v14M5 12h14',
  out: 'M7 7h10v10M7 17 17 7',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.35-4.35',
  heart: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
  store: 'M3 9l2-5h14l2 5M3 9c0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0M5 11v9h14v-9',
  clock: 'M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
  pin: 'M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  recibo: 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1ZM16 8H8M16 12H8M13 16H8',
  warn: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01',
};
function Ico({ k, s = 16, c = 'currentColor', w = 2 }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', display: 'block' }}><path d={ICONS[k]} /></svg>;
}
const Badge = ({ s = 14 }) => <img src="assets/verified-badge.svg" alt="" style={{ width: s, height: s, flex: 'none' }} />;

const PRODUCTS = [
  { n: 'Zapatillas Urban Run', v: 'Moda Vedado', p: 2450, o: 3200, img: 'sneakers', b: '-23%', bc: '#ba1a1a', loc: 'La Habana', st: 'En stock' },
  { n: 'Audífonos inalámbricos Pro', v: 'TecnoHabana', p: 3890, o: 4900, img: 'headphones', b: 'Oferta', bc: ORANGE, loc: 'La Habana', st: '3 uds.' },
  { n: 'Lámpara nórdica de mesa', v: 'Casa Luna', p: 2150, img: 'lamp', b: '', loc: 'Playa', st: 'En stock' },
  { n: 'Canasta mixta de frutas', v: 'Sabor Cubano', p: 1750, img: 'basket', b: 'Nuevo', bc: TEAL, loc: 'Cerro', st: 'En stock' },
  { n: 'Reloj inteligente Fit', v: 'TecnoHabana', p: 5200, o: 6500, img: 'watch', b: '-20%', bc: '#ba1a1a', loc: 'La Habana', st: 'En stock' },
  { n: 'Bolso tote de cuero', v: 'Moda Vedado', p: 3300, img: 'tote', b: '', loc: 'Vedado', st: 'En stock' },
  { n: 'Ultrabook 14" 16GB', v: 'TecnoHabana', p: 96500, img: 'laptop', b: 'Nuevo', bc: TEAL, loc: 'La Habana', st: '2 uds.' },
  { n: 'Set de belleza y perfume', v: 'Belleza Real', p: 2800, o: 3400, img: 'beauty', b: '-18%', bc: '#ba1a1a', loc: 'Plaza', st: 'En stock' },
  { n: 'Auriculares Buds', v: 'TecnoHabana', p: 2400, img: 'earbuds', b: '', loc: 'La Habana', st: 'En stock' },
];
const STORES = [
  { n: 'Casa Luna', cat: 'Hogar y decoración', d: 'Decoración, lámparas y textiles para tu casa.', r: '4.9', cnt: 48, k: 'home', c: '#fe9800' },
  { n: 'TecnoHabana', cat: 'Tecnología', d: 'Laptops, audio y accesorios con garantía.', r: '4.8', cnt: 124, k: 'laptop', c: '#337475' },
  { n: 'Moda Vedado', cat: 'Ropa y calzado', d: 'Ropa, calzado y accesorios de temporada.', r: '4.7', cnt: 86, k: 'bag', c: '#232F3E' },
  { n: 'Sabor Cubano', cat: 'Alimentos', d: 'Frutas, viandas y productos frescos.', r: '4.9', cnt: 62, k: 'gift', c: '#2f7d5b' },
];

/* ---------------- Teléfono (web móvil, lógico 390x844) ---------------- */
function MHeader({ n = 3 }) {
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, background: HDR, padding: '50px 14px 12px', boxShadow: '0 2px 12px rgba(0,0,0,0.18)', zIndex: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: ORANGE, color: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico k="store" s={17} w={2.2} /></div>
        <span style={{ fontFamily: MONT, fontWeight: 800, fontSize: 19, color: '#fff', flex: 1 }}>Baz<span style={{ color: ORANGE }}>nova</span></span>
        <div style={{ position: 'relative', color: 'rgba(255,255,255,0.92)' }}><Ico k="cart" s={23} /><span style={{ position: 'absolute', top: -7, right: -8, background: ORANGE, color: NAVY, fontSize: 10, fontWeight: 800, width: 17, height: 17, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span></div>
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 12px', borderRadius: 9, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontSize: 13.5 }}>
        <Ico k="search" s={16} />Buscar productos...
      </div>
    </div>
  );
}
function PCard({ p, i, T, t0, added }) {
  const a = A(T, 0, 1, t0 + i * 0.05, t0 + i * 0.05 + 0.5, MOTION.enter);
  return (
    <div style={{ background: '#fff', border: '1px solid #eae7e9', borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 20px rgba(35,47,62,0.06)' }}>
      <div style={{ position: 'relative', height: 164, background: '#f1eff0' }}>
        <img src={IMG(p.img)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {p.b ? <span style={{ position: 'absolute', top: 9, left: 9, background: p.bc, color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 99 }}>{p.b}</span> : null}
        <span style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 99, background: 'rgba(255,255,255,0.92)', color: '#44474c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico k="heart" s={14} /></span>
      </div>
      <div style={{ padding: '11px 12px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: TEAL }}>{p.v}<Badge s={12} /></div>
        <div style={{ fontWeight: 600, fontSize: 13.5, lineHeight: '17px', color: INK, margin: '3px 0 4px', height: 34, overflow: 'hidden' }}>{p.n}</div>
        <div style={{ fontSize: 10.5, color: '#75777c', marginBottom: 8 }}>{p.loc} · {p.st}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div><div style={{ fontWeight: 800, fontSize: 14.5, color: INK, whiteSpace: 'nowrap' }}>{fmt(p.p)} CUP</div>{p.o ? <div style={{ fontSize: 10.5, color: '#75777c', textDecoration: 'line-through' }}>{fmt(p.o)} CUP</div> : <div style={{ height: 14 }} />}</div>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: added ? NAVY : ORANGE, color: added ? '#fff' : NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico k={added ? 'check' : 'plus'} s={16} w={2.6} /></div>
        </div>
      </div>
    </div>
  );
}
function MobileHome({ T, t0 }) {
  const y = -A(T, 0, 1260, t0 + 1.0, t0 + 5.4, Easing.easeInOutSine);
  const cd = Math.max(0, 8077 - T * 1);
  const hh = String(Math.floor(cd / 3600)).padStart(2, '0'), mm = String(Math.floor((cd % 3600) / 60)).padStart(2, '0'), ss = String(Math.floor(cd % 60)).padStart(2, '0');
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#fbf9fa', overflow: 'hidden' }}>
      <div style={{ transform: `translateY(${y}px)`, paddingTop: 108 }}>
        <div style={{ background: NAVY, borderRadius: '0 0 28px 28px', padding: '26px 18px 28px', position: 'relative', overflow: 'hidden', marginTop: -2 }}>
          <div style={{ position: 'absolute', right: -50, top: -40, width: 170, height: 170, borderRadius: 99, background: 'rgba(254,152,0,0.2)' }} />
          <span style={{ display: 'inline-block', padding: '5px 12px', borderRadius: 99, background: 'rgba(254,152,0,0.15)', color: ORANGE, fontSize: 11, fontWeight: 700 }}>Marketplace multi vendedor</span>
          <div style={{ margin: '14px 0 10px', fontFamily: MONT, fontWeight: 700, fontSize: 28, lineHeight: 1.17, letterSpacing: '-0.02em', color: '#fff', position: 'relative' }}>Compra y vende cerca tuyo, de <span style={{ color: ORANGE }}>vendedores</span> de tu provincia.</div>
          <div style={{ fontSize: 14.5, lineHeight: '22px', color: 'rgba(255,255,255,0.72)', marginBottom: 20 }}>Productos, comida y servicios de tiendas locales. Pide directo por WhatsApp, paga contra entrega o por transferencia.</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ padding: '12px 18px', borderRadius: 8, background: ORANGE, color: '#643900', fontSize: 13.5, fontWeight: 700 }}>Explorar catálogo →</div>
            <div style={{ padding: '12px 18px', borderRadius: 8, border: '1.5px solid rgba(255,255,255,0.3)', color: '#fff', fontSize: 13.5, fontWeight: 600 }}>Ver tiendas</div>
          </div>
        </div>
        <div style={{ padding: '22px 16px 0', fontFamily: MONT, fontWeight: 700, fontSize: 20, color: INK }}>Explorá por categoría</div>
        <div style={{ display: 'flex', gap: 8, padding: '12px 16px 0', overflow: 'hidden' }}>
          {['Tecnología', 'Moda', 'Hogar', 'Belleza', 'Alimentos', 'Deportes'].map((c) => (
            <span key={c} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 99, border: '1px solid #c5c6cc', background: '#fff', fontSize: 12.5, fontWeight: 500, color: '#44474c' }}><span style={{ width: 20, height: 20, borderRadius: 99, background: 'rgba(51,116,117,0.1)', color: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico k="tag" s={11} w={2.4} /></span>{c}</span>
          ))}
        </div>
        <div style={{ padding: '24px 16px 10px' }}><div style={{ fontFamily: MONT, fontWeight: 700, fontSize: 20, color: INK }}>Ofertas de la semana</div><div style={{ fontSize: 11.5, fontWeight: 500, color: '#75777c', marginTop: 2 }}>De tiendas verificadas y de la casa</div></div>
        <div style={{ margin: '0 16px', position: 'relative', height: 168, borderRadius: 22, overflow: 'hidden', boxShadow: '0 10px 24px rgba(14,26,40,0.2)' }}>
          <div style={{ position: 'absolute', inset: 0, background: '#337475' }} /><div style={{ position: 'absolute', right: 8, top: 6, color: 'rgba(255,255,255,0.2)' }}><Ico k="laptop" s={130} w={1.1} /></div><div style={{ position: 'absolute', right: 96, top: 66, color: 'rgba(255,255,255,0.14)' }}><Ico k="tag" s={70} w={1.3} /></div>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top,rgba(0,0,0,0.85),rgba(0,0,0,0.15) 60%,transparent)' }} />
          <span style={{ position: 'absolute', left: 10, top: 10, display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 99, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10.5, fontWeight: 700 }}><Ico k="clock" s={11} w={2.4} />{hh}:{mm}:{ss}</span>
          <span style={{ position: 'absolute', right: 10, top: 10, padding: '4px 11px', borderRadius: 99, background: '#ba1a1a', color: '#fff', fontSize: 11, fontWeight: 700 }}>-30%</span>
          <div style={{ position: 'absolute', left: 14, bottom: 12, right: 14, color: '#fff' }}><div style={{ fontFamily: MONT, fontWeight: 700, fontSize: 17 }}>Semana de la tecnología</div><div style={{ fontSize: 11.5, opacity: 0.85 }}>TecnoHabana · hasta 30% de descuento</div></div>
        </div>
        <div style={{ padding: '26px 16px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><div style={{ fontFamily: MONT, fontWeight: 700, fontSize: 20, color: INK }}>Productos destacados</div><div style={{ fontSize: 12.5, fontWeight: 600, color: TEAL }}>Ver todo →</div></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '0 16px 120px' }}>
          {PRODUCTS.map((p, i) => <PCard key={p.n} p={p} i={i} T={T} t0={t0 + 1.4} />)}
        </div>
      </div>
    </div>
  );
}
function MobileStores({ T, t0 }) {
  const y = -A(T, 0, 520, t0 + 1.2, t0 + 4.6, Easing.easeInOutSine);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#fbf9fa', overflow: 'hidden' }}>
      <div style={{ transform: `translateY(${y}px)`, paddingTop: 108 }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #eae7e9', padding: '18px 16px' }}>
          <div style={{ fontSize: 11.5, color: '#75777c', marginBottom: 6 }}>Inicio / <span style={{ color: INK }}>Tiendas</span></div>
          <div style={{ fontFamily: MONT, fontWeight: 700, fontSize: 24, color: INK }}>Tiendas verificadas</div>
          <div style={{ fontSize: 12, color: '#75777c', marginTop: 4 }}>Vendedores de tu provincia · verificadas primero</div>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '14px 16px 0', overflow: 'hidden' }}>
          {['Todas', 'Tecnología', 'Hogar', 'Moda', 'Alimentos'].map((c, i) => <span key={c} style={{ flex: 'none', padding: '7px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, background: i === 0 ? NAVY : '#fff', color: i === 0 ? '#fff' : '#44474c', border: i === 0 ? 'none' : '1px solid #c5c6cc' }}>{c}</span>)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 16px 120px' }}>
          {STORES.map((s, i) => {
            const a = A(T, 0, 1, t0 + 0.15 + i * 0.22, t0 + 0.75 + i * 0.22, MOTION.enter);
            return (
              <div key={s.n} style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', border: '1px solid #eae7e9', boxShadow: '0 6px 22px rgba(35,47,62,0.08)', opacity: a, transform: `translateY(${(1 - a) * 40}px)` }}>
                <div style={{ position: 'relative', height: 110, background: s.c, overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', right: -14, top: -10, color: 'rgba(255,255,255,0.22)' }}><Ico k={s.k} s={120} w={1.2} /></div>
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(14,26,40,0.55), transparent)' }} />
                  <div style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(255,255,255,0.95)', borderRadius: 99, padding: '4px 9px 4px 7px', display: 'flex', alignItems: 'center', gap: 5 }}><Badge s={13} /><span style={{ fontWeight: 700, fontSize: 10, color: NAVY }}>VERIFICADA</span></div>
                </div>
                <div style={{ padding: '0 14px 14px', marginTop: -28, display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
                  <div style={{ width: 52, height: 52, borderRadius: 99, background: s.c, border: '3px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONT, fontWeight: 800, fontSize: 20, color: '#fff' }}>{s.n[0]}</div>
                  <div style={{ fontWeight: 700, fontSize: 15.5, color: INK }}>{s.n}</div>
                  <div style={{ fontSize: 12, color: '#75777c', lineHeight: '17px' }}>{s.d}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#75777c', marginTop: 2, paddingTop: 9, borderTop: '1px solid #f0edee' }}><span style={{ color: ORANGE, fontWeight: 700 }}>★ {s.r}</span><span>{s.cnt} productos</span><span style={{ marginLeft: 'auto', padding: '2px 9px', borderRadius: 99, background: 'rgba(254,152,0,0.15)', color: '#8A5100', fontWeight: 700, fontSize: 11 }}>Business</span></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const TAPS = [1.5, 2.9, 4.1, 6.0, 8.6];
function FlowTop({ title, back = true }) {
  return (
    <div style={{ background: '#fff', padding: '56px 16px 12px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 1px 0 #eae7e9' }}>
      <span style={{ width: 34, height: 34, borderRadius: 99, background: '#f0edee', color: INK, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico k="chev" s={18} w={2.4} /></span>
      <span style={{ fontFamily: MONT, fontWeight: 700, fontSize: 19, color: INK }}>{title}</span>
    </div>
  );
}
function MobileFlow({ T, f0 }) {
  const s = T - f0;
  const a1 = s >= 1.5, a2 = s >= 2.9;
  const count = (a1 ? 1 : 0) + (a2 ? 1 : 0);
  const cartP = A(T, 0, 1, f0 + 4.3, f0 + 4.9, MOTION.enter);
  const chkP = A(T, 0, 1, f0 + 6.2, f0 + 6.8, MOTION.enter);
  const okP = A(T, 0, 1, f0 + 8.8, f0 + 9.3, MOTION.enter);
  const tog = A(T, 0, 1, f0 + 1.5, f0 + 1.8, Easing.linear);
  const row = (n, v, im, pr) => (
    <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, background: '#fff', border: '1px solid #eae7e9' }}>
      <img src={IMG(im)} alt="" style={{ width: 66, height: 66, borderRadius: 12, objectFit: 'cover' }} />
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 10.5, fontWeight: 700, color: TEAL }}>{v}</div><div style={{ fontSize: 14, fontWeight: 600, color: INK, lineHeight: '18px' }}>{n}</div><div style={{ fontSize: 14, fontWeight: 800, color: INK, marginTop: 3 }}>{pr} CUP</div></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 99, background: '#f0edee', fontWeight: 700, fontSize: 13 }}>1</div>
    </div>
  );
  const sum = (l, v, b) => <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: b ? 16 : 13.5, fontWeight: b ? 800 : 500, color: b ? INK : '#44474c' }}><span>{l}</span><span>{v}</span></div>;
  const cta = (txt) => <div style={{ position: 'absolute', left: 16, right: 16, bottom: 30, height: 52, borderRadius: 14, background: ORANGE, color: '#643900', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15.5, boxShadow: '0 10px 24px rgba(254,152,0,0.4)' }}>{txt}</div>;
  const ring = A(T, 0, 1, f0 + 9.0, f0 + 9.8, MOTION.enter);
  const ck = A(T, 1, 0, f0 + 9.1, f0 + 9.8, MOTION.draw);
  const prog = A(T, 0, 1, f0 + 9.8, f0 + 12, Easing.easeInOutSine);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#fbf9fa', overflow: 'hidden' }}>
      <MHeader n={count} />
      <div style={{ paddingTop: 116 }}>
        <div style={{ padding: '10px 16px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><div style={{ fontFamily: MONT, fontWeight: 700, fontSize: 20, color: INK }}>Productos destacados</div><div style={{ fontSize: 12.5, fontWeight: 600, color: TEAL }}>Ver todo →</div></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '0 16px' }}>
          {PRODUCTS.slice(0, 4).map((p, i) => <PCard key={p.n} p={p} i={i} T={T} t0={f0 - 2} added={(i === 0 && a1) || (i === 1 && a2)} />)}
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, background: '#fbf9fa', transform: 'translateY(' + (1 - cartP) * 852 + 'px)', zIndex: 6, boxShadow: '0 -20px 40px rgba(0,0,0,0.15)' }}>
        <FlowTop title="Tu carrito (2)" />
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {row('Zapatillas Urban Run', 'Moda Vedado', 'sneakers', '2 450')}
          {row('Audífonos inalámbricos Pro', 'TecnoHabana', 'headphones', '3 890')}
          <div style={{ marginTop: 6, padding: 16, borderRadius: 16, background: '#fff', border: '1px solid #eae7e9', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sum('Subtotal', '6 340 CUP')}{sum('Envío a domicilio', '300 CUP')}<div style={{ height: 1, background: '#eae7e9' }} />{sum('Total', '6 640 CUP', true)}
          </div>
        </div>
        {cta('Finalizar compra →')}
      </div>
      <div style={{ position: 'absolute', inset: 0, background: '#fbf9fa', transform: 'translateX(' + (1 - chkP) * 400 + 'px)', zIndex: 7, boxShadow: '-20px 0 40px rgba(0,0,0,0.12)' }}>
        <FlowTop title="Finalizar compra" />
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: 14, borderRadius: 16, background: '#fff', border: '1px solid #eae7e9', display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ width: 40, height: 40, borderRadius: 99, background: 'rgba(51,116,117,0.12)', color: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico k="pin" s={19} /></span>
            <div><div style={{ fontSize: 11, color: '#75777c', fontWeight: 600 }}>Entrega a domicilio</div><div style={{ fontSize: 14.5, fontWeight: 700, color: INK }}>Calle 23 #456, Vedado</div><div style={{ fontSize: 12, color: '#75777c' }}>La Habana · Casa</div></div>
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, color: INK }}>Método de pago</div>
          {[['Transferencia', 'Pago seguro en línea', true], ['Contra entrega', 'Paga al recibir', false], ['WhatsApp', 'Coordina con la tienda', false]].map(([t, d, on]) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 14, background: '#fff', border: on ? '2px solid ' + TEAL : '1px solid #eae7e9', boxShadow: on ? '0 6px 18px rgba(51,116,117,0.18)' : 'none' }}>
              <span style={{ width: 20, height: 20, borderRadius: 99, border: '2px solid ' + (on ? TEAL : '#c5c6cc'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? <span style={{ width: 10, height: 10, borderRadius: 99, background: TEAL }} /> : null}</span>
              <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{t}</div><div style={{ fontSize: 11.5, color: '#75777c' }}>{d}</div></div>
            </div>
          ))}
          <div style={{ padding: 14, borderRadius: 16, background: '#fff', border: '1px solid #eae7e9', display: 'flex', flexDirection: 'column', gap: 8 }}>{sum('2 productos', '6 340 CUP')}{sum('Envío', '300 CUP')}{sum('Total a pagar', '6 640 CUP', true)}</div>
        </div>
        {cta('Confirmar pedido')}
      </div>
      <div style={{ position: 'absolute', inset: 0, background: '#fbf9fa', opacity: okP, zIndex: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 170, pointerEvents: 'none' }}>
        <div style={{ position: 'relative', width: 120, height: 120 }}>
          <div style={{ position: 'absolute', inset: -16, borderRadius: 99, background: 'rgba(12,174,83,0.12)', transform: 'scale(' + (0.6 + 0.4 * ring) + ')', opacity: ring }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: 99, background: '#0cae53', transform: 'scale(' + ring + ')', boxShadow: '0 16px 36px rgba(12,174,83,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" pathLength="1" strokeDasharray="1" strokeDashoffset={ck} /></svg>
          </div>
        </div>
        <div style={{ marginTop: 34, fontFamily: MONT, fontWeight: 800, fontSize: 26, color: INK }}>¡Pedido confirmado!</div>
        <div style={{ marginTop: 6, fontSize: 14, color: '#75777c' }}>Pedido #Z-2042 · 6 640 CUP</div>
        <div style={{ marginTop: 26, width: 340, padding: 16, borderRadius: 18, background: '#fff', border: '1px solid #eae7e9', boxShadow: '0 10px 28px rgba(35,47,62,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}><span style={{ width: 36, height: 36, borderRadius: 99, background: 'rgba(254,152,0,0.18)', color: '#8a5100', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico k="box" s={18} /></span><div><div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Llega a tu puerta hoy</div><div style={{ fontSize: 12, color: '#75777c' }}>Entre 2:00 y 4:00 pm</div></div></div>
          <div style={{ height: 6, borderRadius: 99, background: '#f0edee', overflow: 'hidden' }}><div style={{ height: '100%', width: (28 + 40 * prog) + '%', borderRadius: 99, background: 'linear-gradient(90deg,' + TEAL + ',' + ORANGE + ')' }} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 10.5, fontWeight: 700, color: '#75777c' }}><span style={{ color: TEAL }}>Confirmado</span><span style={{ color: prog > 0.4 ? TEAL : '#75777c' }}>Preparando</span><span>En camino</span><span>Entregado</span></div>
        </div>
      </div>
    </div>
  );
}
function TapCursor({ T, f0 }) {
  const s = T - f0;
  const t = [0, 0.3, 1.3, 1.5, 2.5, 2.7, 2.9, 3.8, 4.0, 4.1, 5.0, 5.8, 6.0, 7.2, 8.4, 8.6];
  const x = interpolate(t, [300, 300, 160, 160, 356, 356, 356, 363, 363, 363, 250, 194, 194, 230, 194, 194], Easing.easeInOutCubic)(s);
  const y = interpolate(t, [560, 560, 418, 418, 418, 418, 418, 70, 70, 70, 600, 796, 796, 700, 796, 796], Easing.easeInOutCubic)(s);
  const o = A(T, 0, 1, f0 + 0.1, f0 + 0.5, Easing.linear) * (1 - A(T, 0, 1, f0 + 8.8, f0 + 9.1, Easing.linear));
  let press = 0;
  TAPS.forEach((tt) => { const d = s - tt; if (d > 0 && d < 0.18) press = Math.max(press, 1 - d / 0.18); if (d > -0.12 && d <= 0) press = Math.max(press, 1 + d / 0.12); });
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, zIndex: 14, opacity: o, transform: 'translate(' + x + 'px,' + y + 'px)', pointerEvents: 'none' }}>
      {TAPS.map((tt, i) => { const p = Math.min(1, Math.max(0, (s - tt) / 0.55)); return p > 0 && p < 1 ? <div key={i} style={{ position: 'absolute', left: -30, top: -30, width: 60, height: 60, borderRadius: 99, border: '3px solid rgba(254,152,0,0.9)', transform: 'scale(' + (0.4 + 1.3 * p) + ')', opacity: 0.8 * (1 - p) }} /> : null; })}
      <div style={{ position: 'absolute', left: -21, top: -21, width: 42, height: 42, borderRadius: 99, background: 'rgba(255,255,255,0.6)', border: '2px solid rgba(14,26,40,0.55)', boxShadow: '0 4px 14px rgba(0,0,0,0.3)', transform: 'scale(' + (1 - 0.22 * press) + ')' }} />
    </div>
  );
}

const PW = 418, PH = 872;
function Phone({ T, t0, mode, f0 }) {
  const flow = mode === 'flow';
  const btn = (side, top, h) => <div style={{ position: 'absolute', [side]: -4, top, width: 5, height: h, borderRadius: 3, background: 'linear-gradient(90deg,#6c727a,#a7adb5,#6c727a)' }} />;
  const navO = flow ? 1 - A(T, 0, 1, f0 + 4.3, f0 + 4.8, Easing.linear) : 1;
  const ti = 'linear-gradient(135deg,#c3c8cf 0%,#6b7179 22%,#2a2e34 48%,#6f757d 74%,#c9ced4 100%)';
  return (
    <div style={{ position: 'relative', width: PW, height: PH, transformStyle: 'preserve-3d' }}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => <div key={i} style={{ position: 'absolute', inset: 0, borderRadius: 70, background: ti, transform: 'translateZ(' + (-i) + 'px)' }} />)}
      <div style={{ position: 'absolute', inset: 0, borderRadius: 70, background: 'linear-gradient(135deg,#2b3038,#1a1d23)', transform: 'translateZ(-10px) rotateY(180deg)', backfaceVisibility: 'hidden' }}>
        <div style={{ position: 'absolute', right: 26, top: 26, width: 128, height: 128, borderRadius: 34, background: 'rgba(255,255,255,0.08)', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.12)' }} />
      </div>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 70, padding: 5, boxSizing: 'border-box', background: ti, boxShadow: '0 60px 90px -30px rgba(0,0,0,0.7)', backfaceVisibility: 'hidden' }}>
        {btn('left', 150, 34)}{btn('left', 214, 64)}{btn('left', 292, 64)}{btn('right', 250, 100)}
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 65, background: '#05070a', padding: 10, boxSizing: 'border-box' }}>
          <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 56, overflow: 'hidden', background: '#fbf9fa' }}>
            {flow ? <MobileFlow T={T} f0={f0} /> : <MobileHome T={T} t0={t0} />}
            {flow ? null : <MHeader />}
            <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 50, zIndex: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 30px 0 34px', color: flow && T > f0 + 4.5 ? INK : '#fff', fontSize: 14, fontWeight: 700 }}>
              <span>9:41</span>
              <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="4.5" y="5" width="3" height="6" rx="1" /><rect x="9" y="2.5" width="3" height="8.5" rx="1" /><rect x="13.5" y="0" width="3" height="11" rx="1" /></svg>
                <svg width="25" height="12" viewBox="0 0 25 12"><rect x="0.5" y="0.5" width="21" height="11" rx="3.5" fill="none" stroke="currentColor" opacity="0.5" /><rect x="2" y="2" width="18" height="8" rx="2" fill="currentColor" /><rect x="22.5" y="4" width="2" height="4" rx="1" fill="currentColor" opacity="0.5" /></svg>
              </span>
            </div>
            <div style={{ position: 'absolute', left: 12, right: 12, bottom: 18, height: 64, borderRadius: 24, background: 'rgba(255,255,255,0.92)', boxShadow: '0 8px 30px rgba(14,26,40,0.25)', display: 'flex', justifyContent: 'space-around', alignItems: 'center', zIndex: 9, opacity: navO }}>
              {[['home', 'Inicio'], ['store', 'Tiendas'], ['heart', 'Favoritos'], ['user', 'Cuenta']].map(([k, l]) => <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700, color: k === 'home' ? ORANGE : '#75777c' }}><Ico k={k} s={22} /><span>{l}</span></div>)}
            </div>
            {flow ? <TapCursor T={T} f0={f0} /> : null}
            <div style={{ position: 'absolute', left: '50%', bottom: 7, width: 134, height: 5, marginLeft: -67, borderRadius: 4, background: flow && T > f0 + 4.5 ? '#0e1a28' : '#0e1a28', zIndex: 10 }} />
            <div style={{ position: 'absolute', left: '50%', top: 11, width: 122, height: 35, marginLeft: -61, borderRadius: 20, background: '#000', zIndex: 15 }}><div style={{ position: 'absolute', right: 16, top: 11, width: 13, height: 13, borderRadius: 9, background: 'radial-gradient(circle at 35% 35%,#2b3a63,#05070a 70%)' }} /></div>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg,rgba(255,255,255,0.16) 0%,rgba(255,255,255,0) 30%,rgba(255,255,255,0) 70%,rgba(255,255,255,0.06) 100%)', pointerEvents: 'none', zIndex: 16 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Panel del vendedor (réplica de VendorDashboard) ---------------- */
const NAV = [['home', 'Dashboard'], ['box', 'Productos'], ['tag', 'Ofertas'], ['gift', 'Ofertas y códigos'], ['cart', 'Pedidos'], ['qr', 'Mesas / QR'], ['shield', 'Verificación y plan'], ['msg', 'Mensajes'], ['star', 'Reseñas'], ['alert', 'Reportes de fraude'], ['cog', 'Configuración'], ['users', 'Usuarios'], ['profile', 'Mi perfil']];
const CARD = { padding: 20, borderRadius: 16, border: '1px solid rgba(234,231,233,0.7)', background: '#fff', boxShadow: '0 1px 2px rgba(15,23,42,0.04),0 12px 28px -10px rgba(15,23,42,0.12)' };
const DW = 1440, DH = 900;
function Dashboard({ T, t0, tn }) {
  const g = (s, e) => A(T, 0, 1, t0 + s, t0 + e, Easing.easeOutCubic);
  const tone = { green: ['rgba(12,174,83,0.1)', '#0a8f42'], teal: ['rgba(51,116,117,0.12)', TEAL], orange: ['rgba(138,81,0,0.1)', '#8a5100'], blue: ['rgba(14,107,168,0.1)', '#0e6ba8'] };
  const ev = A(T, 0, 1, tn, tn + 1.2, Easing.easeOutCubic);
  const kp = [
    ['Ventas (semana)', 'Últimos 7 días', fmt(g(0.2, 2.4) * 90400 + ev * 6640) + ' CUP', '+12% vs semana anterior', true, 'green', 'trend'],
    ['Pedidos', 'Esta semana', String(Math.round(g(0.3, 2.4) * 38) + (T > tn + 0.6 ? 1 : 0)), '+5 vs semana anterior', true, 'blue', 'cart'],
    ['Productos activos', 'Visibles en tu tienda', String(Math.round(g(0.4, 2.4) * 24)), '2 sin foto', false, 'teal', 'bag'],
    ['Clientes potenciales', 'Últimos 30 días', String(Math.round(g(0.5, 2.4) * 17)), 'Visitaron sin completar pedido', true, 'orange', 'user'],
  ];
  const series = [['Lun', 8], ['Mar', 12], ['Mié', 6], ['Jue', 14], ['Vie', 18], ['Sáb', 22], ['Dom', 10]];
  const orders = [['#Z-2041', 'Yanet Pérez', 'WhatsApp', 'Nuevo', '4 900 CUP', 'rgba(51,116,117,0.12)', TEAL], ['#Z-2039', 'Osmany Ruiz', 'Contra entrega', 'Preparando', '1 800 CUP', 'rgba(138,81,0,0.1)', '#8a5100'], ['#Z-2033', 'Claudia Font', 'En línea', 'Entregado', '6 700 CUP', 'rgba(12,174,83,0.1)', '#0a8f42'], ['#Z-2030', 'Reinier Cruz', 'WhatsApp', 'Cancelado', '1 800 CUP', 'rgba(186,26,26,0.1)', '#ba1a1a']];
  const ring = 82 * g(1.2, 3.2);
  const health = [['Productos completos', 90, '#0cae53'], ['Pedidos sin cancelar', 86, TEAL], ['Stock disponible', 70, ORANGE]];
  const toast = A(T, 0, 1, tn, tn + 0.6, MOTION.pop) * (1 - A(T, 0, 1, tn + 3.4, tn + 3.8, Easing.linear));
  const newRow = A(T, 0, 1, tn + 0.4, tn + 1.0, MOTION.enter);
  const iconBox = (k, t) => <span style={{ width: 36, height: 36, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', background: t[0], color: t[1] }}><Ico k={k} s={16} /></span>;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: DW, height: DH, display: 'flex', gap: 24, padding: 16, boxSizing: 'border-box', background: '#f5f3f4', fontFamily: INTER, color: INK }}>
      <aside style={{ width: 248, height: DH - 32, flex: 'none', display: 'flex', flexDirection: 'column', padding: '22px 14px', boxSizing: 'border-box', borderRadius: 24, background: NAVY, boxShadow: '0 20px 50px -20px rgba(14,26,40,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 6px 18px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <span style={{ width: 40, height: 40, borderRadius: 99, background: '#232f3e', border: '1px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONT, fontWeight: 800, fontSize: 16, color: '#fff' }}>T</span>
          <div><div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: '#fff' }}>TecnoHabana<Badge /></div><div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Plan Business · Verificada</div></div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '14px 0' }}>
          {NAV.map(([k, l], i) => <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, fontSize: 13.5, fontWeight: 600, background: i === 0 ? ORANGE : 'transparent', color: i === 0 ? NAVY : 'rgba(255,255,255,0.72)' }}><Ico k={k} s={17} />{l}</div>)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.1)' }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' }}>Tu tienda pública</span>
          <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, color: '#fff' }}>Ver mi tienda <span>↗</span></span>
        </div>
        <div style={{ marginTop: 12, padding: '0 6px', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Julio Ramírez</div>
      </aside>
      <main style={{ flex: 1, minWidth: 0, padding: '8px 8px 0', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
          <div><div style={{ fontFamily: MONT, fontSize: 28, fontWeight: 700 }}>Dashboard</div><div style={{ marginTop: 4, fontSize: 14, color: '#75777c' }}>Hola de nuevo, <span style={{ fontWeight: 500, color: '#44474c' }}>TecnoHabana</span></div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, background: ORANGE, color: '#643900', fontSize: 13.5, fontWeight: 700 }}><Ico k="plus" s={15} w={2.6} />Nuevo producto</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20, marginBottom: 20 }}>
          {kp.map(([t, sub, v, d, up, tn, ic], i) => {
            const a = g(i * 0.1, i * 0.1 + 0.6);
            return (
              <div key={t} style={{ ...CARD, opacity: a, transform: `translateY(${(1 - a) * 22}px)` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{iconBox(ic, tone[tn])}<div><div style={{ fontSize: 14, fontWeight: 700 }}>{t}</div><div style={{ fontSize: 11.5, color: '#75777c' }}>{sub}</div></div></div>
                  <span style={{ width: 32, height: 32, borderRadius: 99, border: '1px solid #eae7e9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#44474c', flex: 'none' }}><Ico k="out" s={15} /></span>
                </div>
                <div style={{ marginTop: 16, fontFamily: MONT, fontSize: 28, fontWeight: 800, whiteSpace: 'nowrap' }}>{v}</div>
                <div style={{ marginTop: 2, fontSize: 12, fontWeight: 600, color: up ? '#0a8f42' : '#ba1a1a' }}>{d}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{iconBox('trend', tone.green)}<div style={{ fontSize: 14, fontWeight: 700 }}>Ventas</div></div>
              <div style={{ display: 'flex', padding: 3, borderRadius: 99, background: '#f0edee' }}>{['Día', 'Semana', 'Mes', 'Año'].map((l) => <span key={l} style={{ padding: '6px 12px', borderRadius: 99, fontSize: 12, fontWeight: 700, background: l === 'Semana' ? TEAL : 'transparent', color: l === 'Semana' ? '#fff' : '#44474c' }}>{l}</span>)}</div>
            </div>
            <div style={{ height: 200, display: 'flex', alignItems: 'flex-end', gap: 10, paddingBottom: 6, borderBottom: '1px solid #eae7e9' }}>
              {series.map(([x, v], i) => {
                const gr = g(0.9 + i * 0.12, 1.9 + i * 0.12);
                return <div key={x} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}><span style={{ fontSize: 10, fontWeight: 600, color: '#75777c', opacity: gr }}>{v}</span><div style={{ width: '100%', maxWidth: 36, height: Math.round(v / 22 * 150 * gr), borderRadius: '8px 8px 4px 4px', background: i === 6 ? ORANGE : TEAL }} /></div>;
              })}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>{series.map(([x]) => <span key={x} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: '#75777c' }}>{x}</span>)}</div>
          </div>
          <div style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ width: 36, height: 36, borderRadius: 99, background: '#f0edee', color: '#44474c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico k="recibo" s={16} /></span><div><div style={{ fontSize: 14, fontWeight: 700 }}>Pedidos recientes</div><div style={{ fontSize: 11.5, color: '#75777c' }}>Lo último que entró a tu tienda</div></div></div>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: TEAL }}>Ver todos →</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {[['#Z-2042', 'Maykel Díaz', 'En línea', 'Nuevo', '6 640 CUP', 'rgba(51,116,117,0.12)', TEAL]].map(([id, c, ch, st, tot, bg, fg]) => (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: `${10 * newRow}px 0`, height: 57 * newRow, opacity: newRow, overflow: 'hidden', borderBottom: newRow > 0.05 ? '1px solid #f0edee' : 'none', background: `rgba(254,152,0,${0.12 * (1 - A(T, 0, 1, tn + 1.0, tn + 3, Easing.linear))})` }}>
                  <span style={{ width: 36, height: 36, flex: 'none', borderRadius: 99, background: 'rgba(51,116,117,0.15)', color: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{c[0]}</span>
                  <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{c}</div><div style={{ fontSize: 11.5, color: '#75777c' }}>{id} · {ch}</div></div>
                  <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: bg, color: fg }}>{st}</span><span style={{ minWidth: 90, textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{tot}</span>
                </div>
              ))}
              {orders.map(([id, c, ch, st, tot, bg, fg], i) => {
                const a = g(1.6 + i * 0.25, 2.3 + i * 0.25);
                return (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0edee', opacity: a, transform: `translateX(${(1 - a) * 30}px)`, display: i === 3 && newRow > 0.9 ? 'none' : 'flex' }}>
                    <span style={{ width: 36, height: 36, flex: 'none', borderRadius: 99, background: 'rgba(51,116,117,0.15)', color: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{c[0]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{c}</div><div style={{ fontSize: 11.5, color: '#75777c' }}>{id} · {ch}</div></div>
                    <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: bg, color: fg }}>{st}</span><span style={{ minWidth: 90, textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{tot}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>{iconBox('heart', tone.green)}<div><div style={{ fontSize: 14, fontWeight: 700 }}>Salud de tu tienda</div><div style={{ fontSize: 11.5, color: '#75777c' }}>Completitud de productos, cancelaciones y stock</div></div></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ width: 120, height: 120, flex: 'none', borderRadius: 99, background: `conic-gradient(#0cae53 0 ${ring}%, #f0edee ${ring}% 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 94, height: 94, borderRadius: 99, background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontFamily: MONT, fontSize: 28, fontWeight: 800 }}>{Math.round(ring)}</span><span style={{ fontSize: 10, color: '#75777c' }}>de 100</span></div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ width: 'fit-content', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 99, background: 'rgba(12,174,83,0.12)', color: '#0a8f42', fontSize: 12, fontWeight: 700 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: '#0cae53' }} />Saludable</span>
                {health.map(([l, p, c]) => <div key={l}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#44474c' }}><span>{l}</span><strong style={{ color: INK }}>{Math.round(p * g(1.4, 3.2))}%</strong></div><div style={{ height: 6, marginTop: 4, borderRadius: 99, background: '#f0edee', overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 99, background: c, width: `${p * g(1.4, 3.2)}%` }} /></div></div>)}
              </div>
            </div>
          </div>
          <div style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>{iconBox('warn', tone.orange)}<div style={{ fontSize: 14, fontWeight: 700 }}>Productos por agotarse</div></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[['Audífonos inalámbricos Pro', '3 uds.', 'headphones'], ['Cable USB-C trenzado 2m', '2 uds.', 'earbuds'], ['Protector de pantalla 9H', '1 ud.', 'watch']].map(([n, s, im], i) => {
                const a = g(2.4 + i * 0.25, 3.0 + i * 0.25);
                return <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 12, background: '#f5f3f4', opacity: a, transform: `translateY(${(1 - a) * 14}px)` }}><img src={IMG(im)} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover' }} /><span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{n}</span><span style={{ padding: '2px 10px', borderRadius: 99, background: 'rgba(138,81,0,0.1)', color: '#8a5100', fontSize: 11, fontWeight: 700 }}>{s}</span></div>;
              })}
            </div>
          </div>
        </div>
        <div style={{ position: 'absolute', right: 8, top: 4, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 14, background: NAVY, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 16px 36px rgba(14,26,40,0.4)', opacity: toast, transform: `translateY(${(1 - toast) * -24}px) scale(${0.92 + 0.08 * toast})`, zIndex: 5 }}>
          <span style={{ width: 30, height: 30, borderRadius: 99, background: ORANGE, color: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico k="cart" s={15} w={2.4} /></span>
          <div><div>Nuevo pedido <b style={{ color: ORANGE }}>#Z-2042</b></div><div style={{ fontSize: 11, opacity: 0.7 }}>Maykel Díaz · 6 640 CUP</div></div>
        </div>
      </main>
    </div>
  );
}

/* ---------------- Laptop 3D ---------------- */
const LW = 900, LH = 587, LD = 580, LT = 24, BZ = 18;
const KROWS = [[1,1,1,1,1,1,1,1,1,1,1,1,1,1],[1.5,1,1,1,1,1,1,1,1,1,1,1,1,1.5],[1.8,1,1,1,1,1,1,1,1,1,1,1,2.2],[2.3,1,1,1,1,1,1,1,1,1,1,2.7],[1.2,1,1,1.2,6,1.2,1,1,1.2]];
const Keys = () => (
  <div style={{ position: 'absolute', left: 52, right: 52, top: 34, height: 258, borderRadius: 10, background: '#0d0f12', padding: 8, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 6, boxShadow: 'inset 0 0 0 2px #9aa0a8, 0 1px 0 rgba(255,255,255,0.6)' }}>
    {KROWS.map((r, ri) => <div key={ri} style={{ flex: ri === 0 ? 0.65 : 1, display: 'flex', gap: 6 }}>{r.map((w, c) => <div key={c} style={{ flex: w, borderRadius: 5, background: 'linear-gradient(180deg,#2d3138,#1a1d22)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 1px 1px rgba(0,0,0,0.6)' }} />)}</div>)}
  </div>
);
const Grill = ({ side }) => <div style={{ position: 'absolute', [side]: 10, top: 40, width: 30, height: 230, borderRadius: 6, backgroundImage: 'radial-gradient(circle, #7f858e 1.3px, transparent 1.6px)', backgroundSize: '7px 7px', opacity: 0.8 }} />;
function Laptop({ T, lid, camX, camY, scale, x, y, show, t0, tn }) {
  const sc = (LW - 32) / DW;
  const edge = { position: 'absolute', background: 'linear-gradient(180deg,#d4d8de,#8d939c)' };
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, visibility: show ? 'visible' : 'hidden', transformStyle: 'preserve-3d', transform: 'scale(' + scale + ') rotateX(' + camX + 'deg) rotateY(' + camY + 'deg)' }}>
      <div style={{ position: 'absolute', left: -LW / 2 - 30, top: LT + 2, width: LW + 60, height: LD + 70, transformOrigin: 'top', transform: 'rotateX(90deg)', background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.22) 45%, transparent 72%)', filter: 'blur(14px)' }} />
      <div style={{ position: 'absolute', left: -LW / 2, top: 0, width: LW, height: 0, transformStyle: 'preserve-3d' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: LW, height: LD, transformOrigin: 'top', transform: 'rotateX(90deg)', borderRadius: '4px 4px 22px 22px', background: 'linear-gradient(180deg,#e0e3e7,#c4c8cf)', boxShadow: 'inset 0 0 0 1.5px #f1f3f5, inset 0 -10px 18px rgba(0,0,0,0.06)' }}>
          <Grill side="left" /><Grill side="right" />
          <Keys />
          <div style={{ position: 'absolute', left: '50%', top: 322, width: 340, height: 205, marginLeft: -170, borderRadius: 14, background: 'linear-gradient(180deg,#d6dae0,#c8ccd3)', boxShadow: 'inset 0 0 0 1.5px #aab0b8, inset 0 8px 16px rgba(255,255,255,0.4)' }} />
          <div style={{ position: 'absolute', left: 70, right: 70, top: -2, height: 16, borderRadius: '0 0 10px 10px', background: 'linear-gradient(180deg,#14171b,#3b4048 60%,#14171b)' }} />
        </div>
        <div style={{ ...edge, left: 0, top: 0, width: LD, height: LT, transformOrigin: 'left top', transform: 'rotateY(-90deg)', borderRadius: '0 0 0 16px' }}><div style={{ position: 'absolute', left: 60, top: 9, width: 34, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.35)' }} /></div>
        <div style={{ ...edge, left: LW, top: 0, width: LD, height: LT, transformOrigin: 'left top', transform: 'rotateY(-90deg)', borderRadius: '0 0 16px 0' }}><div style={{ position: 'absolute', left: 60, top: 9, width: 34, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.35)' }} /><div style={{ position: 'absolute', left: 104, top: 9, width: 34, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.35)' }} /></div>
        <div style={{ ...edge, left: 0, top: 0, width: LW, height: LT, transform: 'translateZ(' + LD + 'px)', borderRadius: '0 0 20px 20px' }}>
          <div style={{ position: 'absolute', left: '50%', top: 0, width: 130, height: 6, marginLeft: -65, borderRadius: '0 0 7px 7px', background: 'rgba(0,0,0,0.32)' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: 'rgba(255,255,255,0.7)' }} />
        </div>
        <div style={{ position: 'absolute', left: 0, top: -LH, width: LW, height: LH, transformOrigin: '50% 100%', transform: 'translateY(-1px) rotateX(' + lid + 'deg)', transformStyle: 'preserve-3d' }}>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => <div key={n} style={{ position: 'absolute', inset: 0, borderRadius: '16px 16px 4px 4px', background: 'linear-gradient(180deg,#cfd3d9,#9aa0a9)', transform: 'translateZ(' + (-n) + 'px)' }} />)}
          <div style={{ position: 'absolute', inset: 0, borderRadius: '16px 16px 4px 4px', background: '#07090c', padding: BZ + 'px 16px ' + (BZ + 6) + 'px', boxSizing: 'border-box', backfaceVisibility: 'hidden', boxShadow: '0 0 0 2px #aab0b8, 0 0 0 4px #d6d9de' }}>
            <div style={{ position: 'absolute', left: '50%', top: 6, width: 6, height: 6, marginLeft: -3, borderRadius: 9, background: '#1a2230' }} />
            <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 3, overflow: 'hidden', background: '#f5f3f4' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, width: DW, height: DH, transform: 'scale(' + sc + ')', transformOrigin: '0 0' }}><Dashboard T={T} t0={t0} tn={tn} /></div>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(120deg,rgba(255,255,255,0.14) 0%,rgba(255,255,255,0) 35%)', pointerEvents: 'none' }} />
            </div>
          </div>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '16px 16px 4px 4px', background: 'repeating-linear-gradient(90deg,rgba(255,255,255,0.05) 0 2px,transparent 2px 5px), linear-gradient(135deg,#e1e3e7 0%,#b8bdc5 55%,#d5d8dd 100%)', transform: 'translateZ(-8px) rotateY(180deg) rotateZ(180deg)', backfaceVisibility: 'hidden', boxShadow: 'inset 0 0 0 2px #eceef1' }} />
        </div>
      </div>
    </div>
  );
}

function Piece() {
  const { T, CUES } = useComposition();
  const E = CUES.Entrada, LA = CUES.Laptop, FO = CUES.Fondo, FI = CUES.Final;
  const end = FI + 11.4;
  const f0 = FI + 0.6;
  const tn = f0 + 8.8;
  const fade = 1 - A(T, 0, 1, end - 0.9, end - 0.1, Easing.linear);

  // Phone
  const rise = A(T, 900, 0, E + 0.2, E + 1.8, MOTION.enter);
  const yawIn = A(T, -62, -34, E + 0.2, E + 1.8, MOTION.enter);
  const yaw = T < E + 1.8 ? yawIn : interpolate([E + 1.8, E + 3.6, E + 5.6], [-34, 28, -8], Easing.easeInOutSine)(T);
  const hold = A(T, 0, 1, E + 1.0, E + 2.4, MOTION.draw);
  const exit = A(T, 0, 1, LA, LA + 1.3, Easing.easeInOutCubic);
  const back = A(T, 0, 1, FO + 0.4, FO + 1.9, MOTION.enter);
  let ph;
  if (T < LA) ph = { x: 0, y: rise, s: 0.64 + 0.03 * hold, rx: 7 * hold, ry: yaw, rz: -4 * hold };
  else if (T < FO + 0.3) ph = { x: -820 * exit, y: -30 * exit, s: 0.67 - 0.1 * exit, rx: 7 + 6 * exit, ry: -8 - 70 * exit, rz: -4 - 10 * exit };
  else ph = { x: -250, y: (1 - back) * 900, s: 0.64, rx: 3, ry: 14 - 38 * (1 - back), rz: -3 * (1 - back) };

  // Laptop
  const show = T >= LA + 0.4;
  const orbit = A(T, 0, 1, LA + 0.4, LA + 3.6, Easing.easeInOutCubic);
  const lid = A(T, -90, 11, LA + 1.8, LA + 3.8, Easing.easeInOutCubic);
  const toB = A(T, 0, 1, FO, FO + 1.7, MOTION.draw);
  const drift = A(T, 0, -8, LA + 3.8, FO, Easing.linear);
  const camY = 50 * (1 - orbit) + drift - 22 * toB;
  const camX = -34 + 18 * orbit + 2 * toB;
  const lx = 640 + 300 * toB, ly = 380 + 30 * orbit - 6 * toB;
  const lscale = (0.56 - 0.08 * toB - 0.06 * (1 - orbit)) * (0.4 + 0.6 * A(T, 0, 1, LA + 0.4, LA + 1.8, MOTION.enter));

  const caps = [
    { at: E + 1.2, until: LA - 0.2, text: 'Tu tienda, en el bolsillo de tus clientes' },
    { at: LA + 4.0, until: FO - 0.3, text: 'Panel del vendedor con estadísticas en tiempo real' },
  ];
  const finalCap = A(T, 0, 1, FO + 1.6, FO + 2.2, Easing.linear) * fade;
  const pill = A(T, 0, 1, f0 + 9.6, f0 + 10.2, Easing.linear) * fade;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', fontFamily: INTER }}>
      <div style={{ position: 'absolute', inset: 0, perspective: 2400, perspectiveOrigin: '50% 30%', opacity: fade }}>
        <Laptop T={T} t0={LA + 3.2} tn={tn} lid={lid} camX={camX} camY={camY} scale={lscale} x={lx} y={ly} show={show} />
        <div style={{ position: 'absolute', left: 640 - PW / 2, top: 360 - PH / 2, width: PW, height: PH, transform: 'translate3d(' + ph.x + 'px, ' + ph.y + 'px, 80px) scale(' + ph.s + ') rotateX(' + ph.rx + 'deg) rotateY(' + ph.ry + 'deg) rotateZ(' + ph.rz + 'deg)', transformStyle: 'preserve-3d' }}>
          <Phone T={T} t0={E + 1.0} mode={T < LA ? 'home' : 'flow'} f0={f0} />
        </div>
      </div>
          </div>
  );
}

function BaznovaShowcase(props) {
  return (
    <CompositionStage width={1280} height={720} scenes={window.BAZNOVA_SCENES} paused={props && props.paused}>
      <Piece />
    </CompositionStage>
  );
}
window.BaznovaShowcase = BaznovaShowcase;
