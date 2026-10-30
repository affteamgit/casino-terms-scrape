// Where a local run leaves from, for the ip and ip_country columns. ipinfo.io's free quota is about 1,000 calls a day,
// and a call per casino ran it out: past it the columns went blank and a dropped VPN went unnoticed. So the local exit
// is asked once per process and again once ten minutes have passed. Node's fetch leaves from this machine, through the
// same VPN as the local Chrome. Callers that arrive while a lookup is in flight share it; a failed lookup keeps the last
// good answer (blank before the first one) and is not retried before the next refresh. Browserless sessions are asked
// per session in scrape.mjs: each has its own proxy exit.
export const EXIT_REFRESH_MS = 10 * 60000;
const NONE = { ip: "", ip_country: "" };

export function exitLookup({ fetchFn = fetch, now = Date.now, refreshMs = EXIT_REFRESH_MS, url = "https://ipinfo.io/json", timeoutMs = 20000 } = {}) {
  let last = NONE, at = -Infinity, pending = null;
  const lookup = async () => {
    try {
      const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`http ${r.status}`);
      const j = await r.json();
      if (j && j.ip) last = { ip: String(j.ip), ip_country: String(j.country || "") };
    } catch { /* the last good answer stands */ }
    at = now();
    return last;
  };
  return () => {
    if (now() - at < refreshMs) return Promise.resolve(last);
    pending ??= lookup().finally(() => { pending = null; });
    return pending;
  };
}
