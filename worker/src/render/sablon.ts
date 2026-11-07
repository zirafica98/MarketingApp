// Šablon slajda 1080×1350 u bojama brenda. Tekst piše Pisac, raspored i izgled određuje kod (ne AI).

export interface Slajd {
  naslov: string;
  tekst: string;
}

export interface Izgled {
  boja: string;
  brend: string;
  potpis: string; // sajt ili @nalog
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Svetla nijansa boje brenda za pozadinu. */
function nijansa(hex: string, udeo: number): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const m = (c: number) => Math.round(c + (255 - c) * udeo);
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
}

function velicinaNaslova(t: string, naslovna: boolean): number {
  const n = t.length;
  if (naslovna) return n < 30 ? 96 : n < 55 ? 80 : 64;
  return n < 30 ? 72 : n < 55 ? 60 : 50;
}

export function slajdHtml(s: Slajd, i: number, ukupno: number, iz: Izgled): string {
  const naslovna = i === 0 && ukupno > 1;
  const poslednja = i === ukupno - 1 && ukupno > 1;
  const pozadina = naslovna ? iz.boja : nijansa(iz.boja, 0.92);
  const tekstBoja = naslovna ? '#fff' : '#1c1b19';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1080px; height: 1350px; }
  body { background: ${pozadina}; color: ${tekstBoja}; font-family: -apple-system, "Inter", "Segoe UI", Helvetica, Arial, sans-serif; overflow: hidden; }
  .s { position: absolute; inset: 0; padding: 88px; display: flex; flex-direction: column; }
  .vrh, .dno { display: flex; justify-content: space-between; align-items: center; font-size: 28px; font-weight: 600; opacity: .85; }
  .znak { display: flex; align-items: center; gap: 16px; }
  .znak i { width: 46px; height: 46px; border-radius: 14px; background: ${naslovna ? '#fff' : iz.boja}; display: inline-block; }
  .sr { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 36px; }
  h1 { font-size: ${velicinaNaslova(s.naslov, naslovna)}px; line-height: 1.08; letter-spacing: -0.02em; font-weight: 800; text-wrap: balance; }
  p { font-size: ${s.tekst.length > 160 ? 36 : 42}px; line-height: 1.35; font-weight: 450; opacity: .9; text-wrap: pretty; white-space: pre-line; }
  .crta { width: 120px; height: 10px; border-radius: 5px; background: ${naslovna ? '#fff' : iz.boja}; }
  .dalje { color: ${naslovna ? '#fff' : iz.boja}; }
  </style></head><body><div class="s">
    <div class="vrh"><span class="znak"><i></i>${esc(iz.brend)}</span><span>${ukupno > 1 ? `${i + 1}/${ukupno}` : ''}</span></div>
    <div class="sr">
      <div class="crta"></div>
      <h1>${esc(s.naslov)}</h1>
      ${s.tekst ? `<p>${esc(s.tekst)}</p>` : ''}
    </div>
    <div class="dno"><span>${esc(iz.potpis)}</span><span class="dalje">${ukupno > 1 && !poslednja ? 'prevuci →' : ''}</span></div>
  </div></body></html>`;
}
