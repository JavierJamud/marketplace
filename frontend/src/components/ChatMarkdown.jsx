import { Link } from "react-router-dom";

// Muestra las respuestas de los asistentes con orden: párrafos cortos, listas con cada elemento en su línea y tablas.
// Entiende un subconjunto pequeño de markdown (**negrita**, listas "- " y "1. ", tablas con "|", enlaces [texto](/ruta)).
// No usa HTML crudo: todo se pinta como elementos de React, así que un texto de la IA nunca puede inyectar código.
// Si el modelo escribe una enumeración en una sola línea ("1) uno 2) dos 3) tres"), se separa en una lista.

function inline(text, keyPrefix) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((\/[^)\s]*)\)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) out.push(<strong key={`${keyPrefix}-b${i++}`} className="font-bold text-on-surface">{m[1]}</strong>);
    else out.push(<Link key={`${keyPrefix}-l${i++}`} to={m[3]} className="font-semibold text-tertiary-accent underline">{m[2]}</Link>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSeparator = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const bulletRe = /^\s*[-*•]\s+(.*)$/;
const orderedRe = /^\s*\d{1,2}[.)]\s+(.*)$/;

const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

// "1) a 2) b 3) c" en una línea -> una línea por elemento
function explodeInlineEnumeration(line) {
  if (!/(^|\s)1[.)]\s.+\s2[.)]\s/.test(line)) return [line];
  return line.split(/\s+(?=\d{1,2}[.)]\s)/).map((s) => s.trim()).filter(Boolean);
}

function parse(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n").flatMap(explodeInlineEnumeration);
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", lines: para });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) {
      flush();
    } else if (isTableRow(l) && isSeparator(lines[i + 1] ?? "")) {
      flush();
      const head = cells(l);
      const rows = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      i--;
      blocks.push({ type: "table", head, rows });
    } else if (bulletRe.test(l) || orderedRe.test(l)) {
      flush();
      const ordered = orderedRe.test(l);
      const re = ordered ? orderedRe : bulletRe;
      const items = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].match(re)[1]);
      i--;
      blocks.push({ type: ordered ? "ol" : "ul", items });
    } else {
      para.push(l);
    }
  }
  flush();
  return blocks;
}

export function ChatMarkdown({ text, className = "" }) {
  const blocks = parse(text);
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {blocks.map((b, bi) => {
        const k = `b${bi}`;
        if (b.type === "p") {
          return (
            <p key={k}>
              {b.lines.map((line, li) => (
                <span key={li}>
                  {li > 0 && <br />}
                  {inline(line, `${k}-${li}`)}
                </span>
              ))}
            </p>
          );
        }
        if (b.type === "ul" || b.type === "ol") {
          const Tag = b.type;
          return (
            <Tag key={k} className={`flex flex-col gap-1 pl-5 ${b.type === "ul" ? "list-disc" : "list-decimal"}`}>
              {b.items.map((it, ii) => (
                <li key={ii}>{inline(it, `${k}-${ii}`)}</li>
              ))}
            </Tag>
          );
        }
        return (
          <div key={k} className="-mx-1 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr>
                  {b.head.map((h, hi) => (
                    <th key={hi} className="border-b border-outline-variant px-2 py-1.5 font-bold text-on-surface">
                      {inline(h, `${k}-h${hi}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri} className="odd:bg-surface-container-low/60">
                    {r.map((c, ci) => (
                      <td key={ci} className={`border-b border-surface-container-high px-2 py-1.5 align-top ${ci === 0 ? "font-semibold text-on-surface" : ""}`}>
                        {inline(c, `${k}-${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
