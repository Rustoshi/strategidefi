// Options tab. Two kinds of products:
//   • Crypto (type 1) — fully tradable, HONEST fixed-time paper bets. Stake is escrowed
//     from the simulated USDT balance and settled against the REAL live price move.
//   • Gold (4) / Forex (3) / Stocks (2) — VIEW-ONLY. They show the correct TradingView
//     chart but cannot be traded (no live price feed to settle honestly), so `trade_switch`
//     is 0 which hides the bet form, and /order refuses them.
const express = require('express');
const router = express.Router();

const Account = require('../../models/Account');
const Coin = require('../../models/Coin');
const OptionOrder = require('../../models/OptionOrder');
const { nextId } = require('../../models/Counter');
const { optionalAuth, requireAuth } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');
const { price, disp } = require('../../ws');

const r2 = (n) => Number((Number(n) || 0).toFixed(2));

// Delivery windows for tradable (crypto) products (honest, symmetric up/down odds).
const TIERS = [
  { second: 60, second_name: '60S', odds: 0.85, min_amount: 10, max_amount: 5000 },
  { second: 120, second_name: '120S', odds: 0.9, min_amount: 10, max_amount: 5000 },
  { second: 300, second_name: '300S', odds: 0.95, min_amount: 10, max_amount: 20000 },
  { second: 600, second_name: '600S', odds: 1.0, min_amount: 10, max_amount: 50000 },
];
function optionConfig() {
  return TIERS.map((t) => ({
    second: t.second, second_name: t.second_name,
    min_amount: t.min_amount, max_amount: t.max_amount,
    odds: t.odds, up_rate: t.odds, down_rate: t.odds,
  }));
}

// listType categories: 1 digital currency, 2 stocks, 3 forex, 4 precious metals.
// Non-crypto products are view-only (tradable:false) with a real TradingView symbol.
const NONCRYPTO = [
  { id: 4001, type: 4, pair_name: 'XAU/USD', show_name: 'Gold', desc: 'XAU/USD', tv_symbol: 'OANDA:XAUUSD', price: 2400 },
  { id: 4002, type: 4, pair_name: 'XAG/USD', show_name: 'Silver', desc: 'XAG/USD', tv_symbol: 'OANDA:XAGUSD', price: 30 },
  { id: 3001, type: 3, pair_name: 'EUR/USD', show_name: 'Euro', desc: 'EUR/USD', tv_symbol: 'OANDA:EURUSD', price: 1.08 },
  { id: 3002, type: 3, pair_name: 'GBP/USD', show_name: 'Pound', desc: 'GBP/USD', tv_symbol: 'OANDA:GBPUSD', price: 1.27 },
  { id: 3003, type: 3, pair_name: 'USD/JPY', show_name: 'Yen', desc: 'USD/JPY', tv_symbol: 'OANDA:USDJPY', price: 157 },
  { id: 2001, type: 2, pair_name: 'AAPL', show_name: 'Apple', desc: 'AAPL', tv_symbol: 'NASDAQ:AAPL', price: 210 },
  { id: 2002, type: 2, pair_name: 'TSLA', show_name: 'Tesla', desc: 'TSLA', tv_symbol: 'NASDAQ:TSLA', price: 250 },
  { id: 2003, type: 2, pair_name: 'NVDA', show_name: 'NVIDIA', desc: 'NVDA', tv_symbol: 'NASDAQ:NVDA', price: 120 },
];

function cryptoProduct(c) {
  const sym = (c.symbol || '').toUpperCase();
  return {
    id: c.id, type: 1, tradable: true,
    coin_name: sym, pair_name: `${sym}/USDT`, show_name: `${sym}/USDT`, desc: sym,
    icon: c.icon || c.logo || '', tv_symbol: `BINANCE:${sym}USDT`, price: disp(price(sym)),
  };
}
function nonCryptoProduct(p) {
  return {
    id: p.id, type: p.type, tradable: false,
    coin_name: p.pair_name.split('/')[0], pair_name: p.pair_name, show_name: p.show_name, desc: p.desc,
    icon: '', tv_symbol: p.tv_symbol, price: p.price,
  };
}

async function resolveProduct(body) {
  body = body || {};
  const id = body.id != null ? body.id : body.pair_id;
  if (id != null && id !== '') {
    const nc = NONCRYPTO.find((p) => p.id === Number(id));
    if (nc) return nonCryptoProduct(nc);
    const c = await Coin.findOne({ id: Number(id) });
    if (c) return cryptoProduct(c);
  }
  const name = String(body.coin_name || body.symbol || '').toUpperCase();
  if (name) { const c = await Coin.findOne({ symbol: name }); if (c) return cryptoProduct(c); }
  return null;
}

router.use(optionalAuth, requireAuth);

function listItem(p) {
  return {
    id: p.id, pair_id: p.id, type: p.type, tradable: p.tradable,
    pair_name: p.pair_name, coin_name: p.coin_name, show_name: p.show_name, desc: p.desc,
    icon: p.icon, tv_symbol: p.tv_symbol,
    price: p.price, rate_amount: p.price,
    increase: '0.00%', // string: the list template calls increase.indexOf('-')
    up_rate: TIERS[0].odds, down_rate: TIERS[0].odds,
  };
}

// Product list for the Options tab (crypto tradable + gold/forex/stocks view-only).
router.post('/optionlist', async (_req, res) => {
  const coins = await Coin.find({ status: 1 }).sort({ sort: -1 });
  const crypto = coins
    .filter((c) => (c.symbol || '').toUpperCase() !== 'USDT')
    .map((c) => listItem(cryptoProduct(c)));
  const others = NONCRYPTO.map((p) => listItem(nonCryptoProduct(p)));
  return ok(res, { list: crypto.concat(others), category_swich: 0, usernotice: { is_need_confirm: 0, title: '' }, notice: [] });
});

// Detail for one product. Crypto -> trade_switch 1 (bet form shown). Non-crypto -> 0 (hidden).
router.post('/optiondetail', async (req, res) => {
  const p = await resolveProduct(req.body);
  if (!p) return fail(res, 400, 'Unknown option product');
  const acc = await Account.forUser(req.user.id);
  const bal = r2(acc.funds);
  return ok(res, {
    optionpair: { id: p.id, pair_name: p.pair_name, coin_name: p.coin_name, price_decimals: 2, price: p.price, tv_symbol: p.tv_symbol },
    // parentData = pairInfo — template reads .icon and .show_name (throws if missing).
    pairInfo: { icon: p.icon, show_name: p.pair_name, coin_name: p.coin_name },
    tv_symbol: p.tv_symbol, // the injected chart reads this to load the correct market
    trade_switch: p.tradable ? 1 : 0, // 0 hides the bet form -> view-only chart
    option_config: optionConfig(),
    user_balance: bal, balance: bal, usable_balance: bal, usbalance: bal,
  });
});

// Candles for the (native) chart datafeed — kept for completeness; the visible chart is the
// injected TradingView embed, but this keeps any code path that reads candles working.
router.post('/optionkline', async (req, res) => {
  const p = await resolveProduct(req.body);
  const base = p ? p.price || 1 : 1;
  const t0 = Math.floor(Date.now() / 1000) - 60 * 60;
  const list = [];
  let v = base * 0.995;
  for (let i = 0; i < 60; i++) {
    const o = v;
    v = v * (1 + (Math.random() - 0.5) * 0.004);
    const cl = v;
    const hi = Math.max(o, cl) * (1 + Math.random() * 0.001);
    const lo = Math.min(o, cl) * (1 - Math.random() * 0.001);
    list.push([t0 + i * 60, r2(o), r2(hi), r2(lo), r2(cl), r2(Math.random() * 10)]);
  }
  return ok(res, { list });
});

// Place a bet: { pair_id, second, bet_amount, bet_up_down }. bet_up_down: 1=Up, 2/0=Down.
router.post('/order', async (req, res) => {
  try {
    const body = req.body || {};
    const p = await resolveProduct(body);
    if (!p) return fail(res, 400, 'Unknown option product');
    if (!p.tradable) return fail(res, 400, 'This market is view-only');
    const sym = p.coin_name;

    const second = Number(body.second) || 0;
    const tier = TIERS.find((t) => t.second === second);
    if (!tier) return fail(res, 400, 'Invalid delivery time');

    const amount = r2(body.bet_amount);
    if (!(amount > 0)) return fail(res, 400, 'Enter a valid amount');
    if (amount < tier.min_amount) return fail(res, 400, `Minimum amount is ${tier.min_amount}`);
    if (amount > tier.max_amount) return fail(res, 400, `Maximum amount is ${tier.max_amount}`);

    const live = price(sym);
    if (!live) return fail(res, 400, 'Market price unavailable');

    const dir = String(body.bet_up_down) === '1' || body.bet_up_down === true || /up|rise/i.test(String(body.bet_up_down)) ? 'up' : 'down';

    const acc = await Account.forUser(req.user.id);
    if (acc.funds < amount) return fail(res, 400, 'Insufficient balance');
    acc.funds = r2(acc.funds - amount); // stake is escrowed until settlement
    await acc.save();

    const order = await OptionOrder.create({
      id: await nextId('option_orders'),
      user_id: req.user.id,
      pair_id: p.id,
      coin_name: sym,
      pair_name: p.pair_name,
      dir,
      bet_amount: amount,
      second,
      second_name: tier.second_name,
      odds: tier.odds,
      entry_price: live,
      deliver_at: Date.now() + second * 1000,
      status: 0,
    });

    return ok(res, { id: order.id, entry_price: live, deliver_at: order.deliver_at, second });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// Bet history / open positions. status: '0' open, '1' settled (omit = all).
router.post('/orderlist', async (req, res) => {
  const body = req.body || {};
  const q = { user_id: req.user.id };
  if (body.status != null && body.status !== '') q.status = Number(body.status);
  else if (body.type === 'current' || body.is_current) q.status = 0;
  const rows = await OptionOrder.find(q).sort({ createdAt: -1 }).limit(100);
  return ok(res, {
    list: { data: rows.map((o) => o.toApi()), total: rows.length },
    usernotice: { is_need_confirm: 0, title: '' },
    notice: [],
  });
});

// --- honest settlement (started from the server entry) ---
let settleTimer = null;
async function settleDue() {
  const now = Date.now();
  const due = await OptionOrder.find({ status: 0, deliver_at: { $lte: now } }).limit(200);
  for (const o of due) {
    const live = price(o.coin_name);
    if (!live) continue; // no price yet — settle on a later tick
    const acc = await Account.forUser(o.user_id);
    let result;
    let credit = 0;
    let profit = 0;
    if (live > o.entry_price) result = o.dir === 'up' ? 'win' : 'lose';
    else if (live < o.entry_price) result = o.dir === 'down' ? 'win' : 'lose';
    else result = 'tie';

    if (result === 'win') { profit = r2(o.bet_amount * o.odds); credit = r2(o.bet_amount + profit); }
    else if (result === 'tie') { profit = 0; credit = r2(o.bet_amount); }
    else { profit = r2(-o.bet_amount); credit = 0; }

    if (credit > 0) { acc.funds = r2(acc.funds + credit); await acc.save(); }

    o.status = 1;
    o.delivery_price = live;
    o.result = result;
    o.profit_amount = profit;
    await o.save();
  }
}
function startSettler() {
  if (settleTimer) return;
  settleTimer = setInterval(() => { settleDue().catch(() => {}); }, 1000);
}

module.exports = router;
module.exports.startSettler = startSettler;
