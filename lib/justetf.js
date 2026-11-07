// Dati del fondo da justETF (patrimonio e TER per ISIN): usati dall'«imbuto» degli ETF globali.
// La pagina profilo contiene «Fund size: EUR 105,187 m» e «Total expense ratio: 0.20% p.a.».
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export function parseJustEtf(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  let aum = null;
  // «EUR 105,187 m Fund size» oppure «Fund size EUR 105,187 m»
  const m1 = text.match(/(EUR|USD|GBP|CHF)\s*([\d.,]+)\s*(m|bn)\b[^A-Za-z]{0,20}Fund size/i) || text.match(/Fund size[^A-Za-z]{0,20}(EUR|USD|GBP|CHF)\s*([\d.,]+)\s*(m|bn)\b/i);
  if (m1) {
    const n = Number(m1[2].replace(/,/g, ''));
    if (Number.isFinite(n)) aum = { value: n * (m1[3].toLowerCase() === 'bn' ? 1e9 : 1e6), currency: m1[1].toUpperCase() };
  }
  let ter = null;
  const m2 = text.match(/([\d.]+)\s*%\s*p\.a\.[^A-Za-z]{0,20}Total expense ratio/i) || text.match(/Total expense ratio[^A-Za-z]{0,20}([\d.]+)\s*%/i);
  if (m2) {
    const t = Number(m2[1]) / 100;
    if (Number.isFinite(t) && t >= 0 && t < 0.05) ter = t;
  }
  return { aum, ter };
}

export async function justEtf(isin) {
  const res = await fetch(`https://www.justetf.com/en/etf-profile.html?isin=${encodeURIComponent(isin)}`, { headers: { 'user-agent': UA, 'accept-language': 'en' } });
  if (!res.ok) throw new Error(`justETF ${res.status}`);
  const html = await res.text();
  const out = parseJustEtf(html);
  if (!out.aum && !out.ter) {
    const i = html.indexOf('Fund size');
    out.debug = i >= 0 ? html.slice(Math.max(0, i - 400), i + 200).replace(/\s+/g, ' ') : html.slice(0, 300);
  }
  return out;
}
