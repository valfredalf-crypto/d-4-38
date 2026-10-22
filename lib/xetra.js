// Download della lista ufficiale Deutsche Börse "T7 (XETR) All tradable instruments".
// L'indirizzo del file cambia nel tempo: lo si ricava dalle pagine ufficiali che lo linkano.
const PAGES = [
  'https://www.cashmarket.deutsche-boerse.com/cash-en/trading/Tradable-Instruments-Xetra/Downloads',
  'https://www.cashmarket.deutsche-boerse.com/cash-en/trading/Tradable-Instruments-Xetra/xetra',
  'https://www.xetra.com/xetra-en/instruments/instruments',
  'https://www.eurexgroup.com/xetra-en/instruments/instruments',
];
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export function findCsvLinks(html, baseUrl) {
  const out = [];
  for (const m of html.matchAll(/href="([^"]*t7-xetr-allTradableInstruments[^"]*\.csv)"/gi)) {
    if (/simulation/i.test(m[1])) continue;
    out.push(new URL(m[1].replace(/&amp;/g, '&'), baseUrl).href);
  }
  return [...new Set(out)];
}

export async function downloadXetraCsv(log = console.log) {
  const candidates = process.env.XETRA_CSV_URL ? [process.env.XETRA_CSV_URL] : [];
  for (const page of PAGES) {
    try {
      const res = await fetch(page, { headers: { 'User-Agent': UA } });
      if (!res.ok) {
        log(`  pagina ${page}: HTTP ${res.status}`);
        continue;
      }
      const links = findCsvLinks(await res.text(), page);
      log(`  pagina ${page}: ${links.length} link`);
      candidates.push(...links);
    } catch (e) {
      log(`  pagina ${page}: ${e.message}`);
    }
  }
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) continue;
      const text = await res.text();
      if (/ISIN/i.test(text) && text.length > 10000) return { url, text };
    } catch {
      /* prova il prossimo */
    }
  }
  throw new Error('Lista Xetra non trovata (imposta XETRA_CSV_URL con l\'indirizzo del file)');
}
