// Diagnostica dell'accesso a Yahoo Finance (eseguita da .github/workflows/diag.yml).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const show = async (label, res) => console.log(`${label}: HTTP ${res.status} ${(await res.text()).slice(0, 300).replace(/\s+/g, ' ')}`);

const fc = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
const cookies = (fc.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]);
console.log(`fc.yahoo.com: HTTP ${fc.status}, cookie: ${cookies.map((c) => c.split('=')[0]).join(', ') || 'nessuno'}`);
const cookie = cookies.join('; ');
const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie } });
const crumb = (await cr.text()).trim();
console.log(`getcrumb: HTTP ${cr.status} "${crumb.slice(0, 40)}"`);
const q = (path) => fetch(`https://query2.finance.yahoo.com${path}${path.includes('?') ? '&' : '?'}crumb=${encodeURIComponent(crumb)}`, { headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json' } });
for (const sym of ['AAPL', 'NVDA', 'SAP.DE']) {
  await show(`quoteSummary ${sym} (senza earningsTrend)`, await q(`/v10/finance/quoteSummary/${sym}?modules=financialData,summaryDetail,defaultKeyStatistics,price`));
  await show(`quoteSummary ${sym} (con earningsTrend)`, await q(`/v10/finance/quoteSummary/${sym}?modules=financialData,summaryDetail,defaultKeyStatistics,price,earningsTrend`));
  await show(`quoteSummary ${sym} (solo earningsTrend)`, await q(`/v10/finance/quoteSummary/${sym}?modules=earningsTrend`));
}
await show('v7 quote', await q('/v7/finance/quote?symbols=AAPL,SAP.DE'));
await show('chart senza crumb', await fetch('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d', { headers: { 'User-Agent': UA } }));
