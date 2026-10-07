// Bloque 284 (pedido explícito — "el asistente debe escribir en tiempo real"): envuelve
// una ruta de chat para que, con `?stream=1`, la respuesta viaje como líneas JSON:
//   {"type":"delta","text":"..."}   trozo de texto recién escrito
//   {"type":"reset"}                lo escrito se descarta (se cambió de modelo)
//   {"type":"done", statusCode, ...cuerpo}   resultado final (el mismo JSON de siempre)
//   {"type":"error", message}
// La ruta no cambia: sigue llamando a res.json(...) y, si ya empezó a escribir, ese
// cuerpo sale como evento "done". Sin `?stream=1` todo funciona exactamente igual que antes.
export function streamable(handler) {
  return async (req, res, next) => {
    if (req.query.stream !== "1") return handler(req, res, next);

    let started = false;
    let statusCode = 200;
    let heartbeat = null;
    const write = (event) => res.write(`${JSON.stringify(event)}\n`);
    const start = () => {
      if (started) return;
      started = true;
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      // Una línea en blanco cada 10 s evita que Cloudflare corte una respuesta larga.
      heartbeat = setInterval(() => res.write("\n"), 10_000);
    };

    req.streamText = (text) => {
      if (!text) return;
      start();
      write({ type: "delta", text });
    };
    req.streamReset = () => {
      if (started) write({ type: "reset" });
    };

    const originalStatus = res.status.bind(res);
    const originalJson = res.json.bind(res);
    res.status = (code) => {
      statusCode = code;
      return started ? res : originalStatus(code);
    };
    res.json = (body) => {
      if (!started) return originalJson(body);
      clearInterval(heartbeat);
      write({ type: "done", statusCode, ...body });
      return res.end();
    };

    try {
      await handler(req, res, next);
    } catch (err) {
      if (!started) throw err;
      clearInterval(heartbeat);
      write({ type: "error", message: "No se pudo obtener la respuesta. Prueba de nuevo." });
      res.end();
    } finally {
      clearInterval(heartbeat);
    }
  };
}
