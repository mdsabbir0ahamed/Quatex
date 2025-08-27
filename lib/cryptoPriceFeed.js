// Lightweight crypto price helpers – Binance public API (primary) utilities
// For few symbols polling REST every 5s is OK. For many symbols or lower latency, move to WebSocket streaming or websockets.

const BINANCE_ENDPOINT = 'https://api.binance.com/api/v3/ticker/price';

// Internal stored symbol uses BASE_QUOTE (e.g. BTC_USDT) -> Binance wants BTCUSDT
function toBinanceSymbol(internalSymbol) {
  return internalSymbol.replace('_', '');
}

// Batch fetch prices for internal symbols; returns { internalSymbol: number }
export async function fetchBinancePrices(internalSymbols = []) {
  if (!internalSymbols.length) return {};
  const binanceSymbols = internalSymbols.map(toBinanceSymbol);
  const url = BINANCE_ENDPOINT + '?symbols=' + encodeURIComponent(JSON.stringify(binanceSymbols));
  let res;
  try { res = await fetch(url, { cache: 'no-store' }); } catch (e) {
    rateLimitedLog('[binance] network error batch: ' + (e?.message || e));
    return {};
  }
  if (res.ok) {
    try {
      const data = await res.json();
      const out = {};
      for (const row of data) {
        const idx = binanceSymbols.indexOf(row.symbol);
        if (idx !== -1) out[internalSymbols[idx]] = Number(row.price);
      }
      return out;
    } catch (e) {
      rateLimitedLog('[binance] parse error: ' + (e?.message || e));
      return {};
    }
  }
  // 400 fallback: try per symbol sequentially (small set assumed); skip invalids
  if (res.status === 400) {
    rateLimitedLog('[binance] batch 400, falling back per-symbol');
    const out = {};
    for (let i = 0; i < binanceSymbols.length; i++) {
      const sym = binanceSymbols[i];
      try {
        const r = await fetch(BINANCE_ENDPOINT + '?symbol=' + sym, { cache: 'no-store' });
        if (!r.ok) continue;
        const j = await r.json();
        if (j.price !== undefined) out[internalSymbols[i]] = Number(j.price);
      } catch (_) { /* ignore */ }
    }
    return out;
  }
  rateLimitedLog('[binance] price fetch failed status=' + res.status);
  return {};
}

// Classification sets
const STABLE_QUOTES = new Set(['USDT','USDC','BUSD']); // primary stablecoins
const CRYPTO_BASES = new Set(['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','LTC','TRX','DOT','LINK','MATIC','AVAX','SHIB']);
const FIAT_CODES = new Set(['USD','EUR','GBP','JPY','CHF','AUD','CAD','NZD','CNY']);

export function classifyPair(symbol) {
  const [base, quote] = symbol.split('_');
  if (CRYPTO_BASES.has(base) && (STABLE_QUOTES.has(quote) || CRYPTO_BASES.has(quote))) return { type: 'CRYPTO', base, quote };
  if (FIAT_CODES.has(base) && FIAT_CODES.has(quote)) return { type: 'FOREX', base, quote };
  return { type: 'OTHER', base, quote };
}

export function isCryptoPair(p) { return classifyPair(p.symbol).type === 'CRYPTO'; }
export function isCryptoSymbol(symbol) { return classifyPair(symbol).type === 'CRYPTO'; }

// In-memory validation cache to reduce repeated exchangeInfo lookups
const VALIDATE_CACHE = new Map(); // binanceSymbol -> { ok, ts }
const VALIDATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let lastErrorLog = 0;
function rateLimitedLog(msg) {
  const now = Date.now();
  if (now - lastErrorLog > 60000) { // 1 minute window
    console.warn(msg);
    lastErrorLog = now;
  }
}

// Validate a single internal symbol against Binance exchange info (e.g. BTC_USDT -> BTCUSDT)
export async function validateBinanceSymbol(internalSymbol) {
  try {
    if (!internalSymbol) return false;
    const binSym = internalSymbol.replace('_', '');
    const now = Date.now();
    const cached = VALIDATE_CACHE.get(binSym);
    if (cached && (now - cached.ts) < VALIDATE_TTL_MS) return cached.ok;
    const url = 'https://api.binance.com/api/v3/exchangeInfo?symbol=' + encodeURIComponent(binSym);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      VALIDATE_CACHE.set(binSym, { ok: false, ts: now });
      return false;
    }
    const data = await res.json();
    const ok = Array.isArray(data.symbols) ? data.symbols.length > 0 : !!data.symbol;
    VALIDATE_CACHE.set(binSym, { ok, ts: now });
    return ok;
  } catch (e) {
    console.warn('validateBinanceSymbol error', e?.message || e);
    return false;
  }
}

export function formatCryptoPrice(num, decimalsOverride) {
  if (typeof decimalsOverride === 'number' && decimalsOverride >= 0 && decimalsOverride <= 10) {
    return Number(num.toFixed(decimalsOverride));
  }
  if (num >= 100) return Number(num.toFixed(2));
  if (num >= 1) return Number(num.toFixed(4));
  return Number(num.toFixed(6));
}
