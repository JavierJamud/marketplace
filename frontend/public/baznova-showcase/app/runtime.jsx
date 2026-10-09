const Easing = {
  linear: (t) => t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
function interpolate(input, output, ease) {
  ease = ease || Easing.linear;
  return (t) => {
    const n = input.length;
    if (t <= input[0]) return output[0];
    if (t >= input[n - 1]) return output[n - 1];
    for (let i = 0; i < n - 1; i++) {
      if (t <= input[i + 1]) {
        const f = (t - input[i]) / (input[i + 1] - input[i]);
        const e = Array.isArray(ease) ? ease[i] : ease;
        return output[i] + (output[i + 1] - output[i]) * e(f);
      }
    }
  };
}
function animate({ from = 0, to = 1, start = 0, end = 1, ease = Easing.easeInOutCubic }) {
  return (t) => (t <= start ? from : t >= end ? to : from + (to - from) * ease((t - start) / (end - start)));
}
const CompositionContext = React.createContext(null);
function useComposition() { return React.useContext(CompositionContext); }

function CompositionStage({ width = 1280, height = 720, scenes, paused = false, children }) {
  const list = React.useMemo(() => JSON.parse(scenes), [scenes]);
  const { CUES, total } = React.useMemo(() => {
    let acc = 0; const c = {};
    list.forEach((s) => { c[s.name] = acc; acc += s.dur; });
    return { CUES: c, total: acc };
  }, [list]);
  const fixed = new URLSearchParams(location.search).get('t');
  const [T, setT] = React.useState(fixed != null ? +fixed : 0);
  const [scale, setScale] = React.useState(1);
  const box = React.useRef(null);
  const vis = React.useRef(true);
  React.useEffect(() => {
    const el = box.current;
    const fit = () => setScale(el.clientWidth / width);
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    const io = new IntersectionObserver((e) => { vis.current = e[0].isIntersecting; }); io.observe(el);
    return () => { ro.disconnect(); io.disconnect(); };
  }, [width]);
  React.useEffect(() => {
    if (paused || fixed != null) return;
    let raf, last = performance.now(), t = 0;
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (vis.current) { t = (t + dt) % total; setT(t); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [total, paused]);
  return (
    <div ref={box} style={{ position: 'relative', width: '100%', aspectRatio: width + ' / ' + height, overflow: 'hidden', background: 'transparent' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width, height, transform: 'scale(' + scale + ')', transformOrigin: '0 0', background: 'transparent' }}>
        <CompositionContext.Provider value={{ T, CUES, total }}>{children}</CompositionContext.Provider>
      </div>
    </div>
  );
}
