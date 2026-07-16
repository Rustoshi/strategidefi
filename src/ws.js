// Live-price feed + WebSocket server.
//
// SINGLE SOURCE OF TRUTH for crypto prices. Everything that shows or settles a price reads
// from here (dashboard rows, Coin/Spot, Contract, Options, staking) so every page agrees.
//
// Prices are REAL, polled from CoinGecko (`/coins/markets` — one request covers every coin
// and also gives the true 24h change / high / low). Between polls the ticker micro-moves
// around the real price (±0.005%) so charts and books look alive without drifting off the
// real value. If the feed is unreachable we keep the last real price and fall back to
// representative bases, so the app still runs offline.
//
// The SPA speaks: {cmd:"sub",msg:{type:"coinrate"}} / {cmd:"ping"}; we stream
// {cmd:"coinrate", message:[...]} a few times a second.
const { WebSocketServer } = require('ws');
const Coin = require('./models/Coin');

const POINTS = 30;
const POLL_MS = 15000; // CoinGecko free tier: 4 req/min is comfortably within limits
const JITTER = 0.0001; // ±0.005% micro-move around the real price between polls

// symbol -> CoinGecko id
const CG_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', BCH: 'bitcoin-cash', LTC: 'litecoin',
  XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', SOL: 'solana', DOT: 'polkadot',
  LINK: 'chainlink', USDT: 'tether', USDC: 'usd-coin', DAI: 'dai', EOS: 'eos',
  ETC: 'ethereum-classic', TRX: 'tron', MATIC: 'matic-network', AVAX: 'avalanche-2',
};

// Fallback only — used until the first successful poll (or if the feed is unreachable).
const BASE = {
  USDT: 1, USDC: 1, DAI: 1,
  BTC: 64678, ETH: 1881, BNB: 578, BCH: 234.7, LTC: 45.49,
  XRP: 1.1082, ADA: 0.1647, DOGE: 0.07366, SOL: 77.44, DOT: 0.85,
  LINK: 8.36, EOS: 0.52, ETC: 7.061, TRX: 0.32848, MATIC: 0.72, AVAX: 6.662,
};

let state = null; // [{ id, sym, real, chg24, high24, low24, live, il:[numbers] }]
let pollTimer = null;
let lastPollOk = 0;

// Displayed decimals: 2 for anything >= $1, more for sub-dollar coins (0.07 would be useless).
function dispDecimals(p) { return p >= 1 ? 2 : 6; }
function round(p, d) { return Number(Number(p).toFixed(d != null ? d : dispDecimals(p))); }

// Seed a plausible 30-point history inside the real 24h range, ending exactly at the real
// price, so the sparkline reflects real high/low/last rather than invented numbers.
function seedIl(real, low, high) {
  const lo = Math.min(low || real * 0.995, real);
  const hi = Math.max(high || real * 1.005, real);
  const il = [];
  let v = lo + (hi - lo) * Math.random();
  for (let i = 0; i < POINTS - 1; i++) {
    v += (Math.random() - 0.5) * (hi - lo) * 0.3;
    v = Math.min(hi, Math.max(lo, v));
    il.push(v);
  }
  il.push(real);
  return il;
}

async function initState() {
  const coins = await Coin.find({ status: 1 }).sort({ sort: -1 });
  state = coins.map((c) => {
    const sym = (c.symbol || c.coin_name || 'USDT').toUpperCase();
    const base = BASE[sym] || 1;
    return { id: c.id, sym, real: base, chg24: 0, high24: base, low24: base, live: false, il: seedIl(base, base * 0.99, base * 1.01) };
  });
  await refreshReal().catch((e) => console.warn('[price] initial fetch failed:', e.message));
  startPolling();
}

// Pull real prices for every tracked coin in a single request.
async function refreshReal() {
  if (!state || !state.length) return;
  const ids = [...new Set(state.map((s) => CG_IDS[s.sym]).filter(Boolean))];
  if (!ids.length) return;
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(',')}&per_page=250&page=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('CoinGecko: unexpected payload');

  const bySym = {};
  rows.forEach((r) => { bySym[String(r.symbol || '').toUpperCase()] = r; });

  let updated = 0;
  state.forEach((s) => {
    const m = bySym[s.sym];
    if (!m || !m.current_price) return;
    const firstLive = !s.live;
    s.real = m.current_price;
    s.chg24 = Number(m.price_change_percentage_24h) || 0;
    s.high24 = Number(m.high_24h) || m.current_price;
    s.low24 = Number(m.low_24h) || m.current_price;
    s.live = true;
    // On the first real price, reseed the history around the true 24h range.
    if (firstLive) s.il = seedIl(s.real, s.low24, s.high24);
    updated++;
  });
  lastPollOk = Date.now();
  return updated;
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    refreshReal().catch((e) => console.warn('[price] refresh failed:', e.message));
  }, POLL_MS);
  if (pollTimer.unref) pollTimer.unref();
}

// Micro-move each coin around its real price so the ticker/chart breathe between polls.
function tick() {
  if (!state) return;
  for (let i = 0; i < state.length; i++) {
    const s = state[i];
    const anchor = s.real || s.il[s.il.length - 1] || 1;
    s.il.push(anchor * (1 + (Math.random() - 0.5) * JITTER));
    if (s.il.length > POINTS) s.il.shift();
  }
}

function find(sym) {
  if (!state) return null;
  sym = (sym || '').toUpperCase();
  for (let i = 0; i < state.length; i++) if (state[i].sym === sym) return state[i];
  return null;
}

// Current price for a symbol — what every endpoint settles against.
function price(sym) {
  const s = find(sym);
  if (!s) return 0;
  return s.il[s.il.length - 1];
}

// Real 24h percent change.
function change(sym) {
  const s = find(sym);
  return s ? s.chg24 : 0;
}

// Everything known about a symbol (price + real 24h stats).
function stats(sym) {
  const s = find(sym);
  if (!s) return { price: 0, change: 0, high24: 0, low24: 0, live: false };
  return { price: price(sym), change: s.chg24, high24: s.high24, low24: s.low24, live: s.live };
}

// One market row (dashboard sparkline + ticker). `il` drives the mini chart, `iz` its colour.
function itemFor(coin) {
  const sym = (coin.symbol || coin.coin_name || 'USDT').toUpperCase();
  const s = find(sym);
  const base = BASE[sym] || 1;
  const real = s ? price(sym) : base;
  const d = dispDecimals(real);
  const il = s ? s.il : seedIl(base, base * 0.99, base * 1.01);
  const chg = s ? s.chg24 : 0;
  return {
    id: coin.id != null ? coin.id : (s && s.id),
    pn: `${sym}/USDT`,
    c: sym,
    td: round(real, d),
    io: '',
    ic: `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`,
    iz: chg >= 0 ? 1 : 0,
    h24: round(s ? s.high24 : base, d),
    l24: round(s ? s.low24 : base, d),
    c24: 0,
    il: il.map((n) => n.toFixed(Math.max(d, 2))),
  };
}

function snapshot() {
  if (!state) return [];
  return state.filter((s) => s.sym !== 'USDT').map((s) => itemFor({ id: s.id, symbol: s.sym }));
}

// --- Spot order books (the Coin page's depth ladder) -------------------------------------
// Keyed by pair_id: { <pair_id>: [ {ty:'s',cr,cc} x5, {ty:'b',cr,cc} x5 ] }. The page splits
// on `ty` and takes the first 5 of each, so asks are emitted highest->best and bids
// best->lowest. A real spread around the mid, depth growing outward, rebuilt on a slow
// cadence so it reads like a book instead of flickering noise.
const BOOK_LEVELS = 5;
const BOOK_REFRESH_MS = 3000;
let books = {};
let booksAt = 0;

function tickSize(p) {
  if (p >= 10000) return 0.1;
  if (p >= 100) return 0.01;
  if (p >= 1) return 0.001;
  return 0.000001;
}
function depthAt(level) {
  const base = 200 + level * level * 900;
  return Math.round(base * (0.6 + Math.random() * 0.8));
}

function buildBooks() {
  if (!state) return;
  const now = Date.now();
  if (booksAt && now - booksAt < BOOK_REFRESH_MS) return;
  booksAt = now;
  const out = {};
  state.forEach((s) => {
    if (s.sym === 'USDT') return;
    const mid = s.il[s.il.length - 1];
    if (!mid) return;
    const step = tickSize(mid);
    const d = Math.max(dispDecimals(mid), 2);
    const half = step / 2;
    const rows = [];
    for (let i = BOOK_LEVELS; i >= 1; i--) rows.push({ ty: 's', cr: (mid + half + (i - 1) * step).toFixed(d), cc: depthAt(i) });
    for (let j = 1; j <= BOOK_LEVELS; j++) rows.push({ ty: 'b', cr: (mid - half - (j - 1) * step).toFixed(d), cc: depthAt(j) });
    out[s.id] = rows;
  });
  books = out;
}

function orderBooks() { buildBooks(); return books; }

let streamTimer = null;

function attachWs(server) {
  const wss = new WebSocketServer({ server });
  const clients = new Set();

  wss.on('connection', function (ws) {
    clients.add(ws);
    ws.on('message', function (raw) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      if (!msg) return;
      if (msg.cmd === 'sub') {
        // The SPA subscribes separately to 'coinrate' (tickers) and 'coincoinentrust' (spot
        // depth). Answer whichever was asked for.
        const type = (msg.msg && msg.msg.type) || 'coinrate';
        try {
          if (type === 'coincoinentrust') ws.send(JSON.stringify({ cmd: 'coincoinentrust', message: orderBooks() }));
          else ws.send(JSON.stringify({ cmd: 'coinrate', message: snapshot() }));
        } catch (e) {}
      } else if (msg.cmd === 'ping') {
        try { ws.send(JSON.stringify({ cmd: 'pong', msg: {} })); } catch (e) {}
      }
    });
    ws.on('close', function () { clients.delete(ws); });
    ws.on('error', function () { clients.delete(ws); });
  });

  if (!streamTimer) {
    streamTimer = setInterval(function () {
      if (!state || clients.size === 0) return;
      tick();
      const rates = JSON.stringify({ cmd: 'coinrate', message: snapshot() });
      const depth = JSON.stringify({ cmd: 'coincoinentrust', message: orderBooks() });
      clients.forEach(function (ws) {
        if (ws.readyState !== 1) return;
        try { ws.send(rates); ws.send(depth); } catch (e) {}
      });
    }, 1200);
  }

  const live = state ? state.filter((s) => s.live).length : 0;
  console.log(`Live-price WebSocket attached — ${live}/${state ? state.length : 0} coins on the real feed (CoinGecko, ${POLL_MS / 1000}s)`);
}

// Round a PRICE for display/transport with the right precision for its magnitude.
// Flat 2dp is fine for BTC but destroys sub-dollar coins (DOGE 0.0734 -> 0.07 is ~5% wrong),
// so money amounts stay 2dp while prices use this.
function disp(p) { return round(p); }

module.exports = { attachWs, initState, price, change, stats, snapshot, itemFor, refreshReal, disp, dispDecimals, orderBooks };
