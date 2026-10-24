// Diagnostica dell'accesso a Yahoo Finance (eseguita da .github/workflows/diag.yml).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const fc = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
const cookie = (fc.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
const crumb = (await (await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie } })).text()).trim();
const q = async (path) => {
  const r = await fetch(`https://query2.finance.yahoo.com${path}&crumb=${encodeURIComponent(crumb)}`, { headers: { 'User-Agent': UA, Cookie: cookie } });
  return r.ok ? r.json() : { status: r.status };
};
// Holdings degli ETF (anche UCITS quotati su Xetra)
for (const sym of ['EUNL.DE', 'VWCE.DE', 'SXR8.DE', 'QDVE.DE', 'XU61.DE', 'SELD.DE', 'IWDA.AS', 'SPY']) {
  const j = await q(`/v10/finance/quoteSummary/${sym}?modules=topHoldings,fundProfile,summaryDetail`);
  const th = j?.quoteSummary?.result?.[0]?.topHoldings;
  const eq = th?.equityHoldings || {};
  const h = (th?.holdings || []).map((x) => `${x.symbol}:${x.holdingPercent?.raw?.toFixed(3)}`).join(' ');
  console.log(`${sym}: holdings=${(th?.holdings || []).length} [${h}] PE=${eq.priceToEarnings?.raw ?? '-'} stock%=${th?.stockPosition?.raw ?? '-'} bond%=${th?.bondPosition?.raw ?? '-'} status=${j.status ?? 'ok'}`);
}
