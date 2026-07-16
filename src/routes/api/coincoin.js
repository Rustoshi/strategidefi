// Spot trading (paper). Buy spends USDT for a coin; sell does the reverse. Market orders
// fill immediately at the live price; limit orders rest and fill when the price crosses.
// All balances/holdings live on the user's Account (simulated — no real funds).
const express = require('express');
const router = express.Router();

const Account = require('../../models/Account');
const Coin = require('../../models/Coin');
const CoinOrder = require('../../models/CoinOrder');
const { nextId } = require('../../models/Counter');
const { optionalAuth, requireAuth } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');
const { price, disp, orderBooks } = require('../../ws');

const r2 = (n) => Number((Number(n) || 0).toFixed(2));
const r8 = (n) => Number((Number(n) || 0).toFixed(8));

function getHold(acc, sym) { return Number((acc.holdings || {})[sym] || 0); }
function setHold(acc, sym, v) { acc.holdings = acc.holdings || {}; acc.holdings[sym] = r8(v); acc.markModified('holdings'); }

async function pairCoin(body) {
  body = body || {};
  if (body.pair_id != null) { const c = await Coin.findOne({ id: Number(body.pair_id) }); if (c) return c; }
  const name = String(body.coin_name || body.from_coin_name || body.symbol || '').toUpperCase();
  if (name) return Coin.findOne({ symbol: name });
  return null;
}

router.use(optionalAuth, requireAuth);

// Balance + trade context for a pair. The Coin page reads:
//   to_coin_name/from_coin_name and data[<those>] for the two balances,
//   form_decimal/to_decimal for the input precision,
//   tradelist  -> the depth ladder KEYED BY pair_id (same shape the coincoinentrust WS pushes;
//                 the page does buySellAllList[pair_id] and splits rows on `ty`),
//   cny_rate   -> for the ≈CNY line under the price.
router.post('/getuserbalance', async (req, res) => {
  const acc = await Account.forUser(req.user.id);
  const coin = await pairCoin(req.body);
  const from = coin ? (coin.symbol || '').toUpperCase() : String(req.body.coin_name || 'BTC').toUpperCase();
  const out = { to_coin_name: 'USDT', from_coin_name: from };
  out.USDT = r2(acc.funds);
  out[from] = getHold(acc, from);
  out.form_decimal = 6; // coin quantity input precision
  out.to_decimal = 2; // USDT amount input precision
  out.cny_rate = Number(process.env.CNY_RATE) || 7.24;
  out.tradelist = orderBooks();
  return ok(res, out);
});

// Trading pairs list (pair picker): every active coin traded against USDT. USDT itself is
// the quote currency, not a tradable pair, so it's excluded — otherwise "USDT/USDT" would be
// the first/default pair and the trade page title would read USDT/USDT instead of the coin.
// bibiDetail also calls this with a `pair_id` and reads `data.pair.{pair_name,price_decimals}`
// (its .then throws if `pair` is missing), so return the selected pair's info too.
router.post('/getcointradelist', async (req, res) => {
  const coins = await Coin.find({ status: 1 }).sort({ sort: -1 });
  const list = coins
    .filter((c) => (c.symbol || '').toUpperCase() !== 'USDT')
    .map((c) => {
      const sym = (c.symbol || '').toUpperCase();
      return { pair_id: c.id, coin_name: sym, from_coin_name: sym, to_coin_name: 'USDT', pn: `${sym}/USDT`, tv_symbol: `BINANCE:${sym}USDT`, price: disp(price(sym)) };
    });

  let pair = null;
  const pid = (req.body || {}).pair_id;
  if (pid != null && pid !== '') {
    const c = await Coin.findOne({ id: Number(pid) });
    if (c) {
      const sym = (c.symbol || '').toUpperCase();
      pair = { pair_id: c.id, pair_name: `${sym}/USDT`, coin_name: sym, from_coin_name: sym, to_coin_name: 'USDT', price_decimals: 2, tv_symbol: `BINANCE:${sym}USDT`, price: disp(price(sym)) };
    }
  }
  return ok(res, { list, pair });
});

// Kline candles for the pair chart (built from the live price with light noise).
router.post('/getkline', async (req, res) => {
  const coin = await pairCoin(req.body);
  const sym = coin ? (coin.symbol || '').toUpperCase() : 'BTC';
  const p = price(sym) || 1;
  const now = Math.floor(Date.now ? 0 : 0); // Date.now available server-side
  const t0 = Math.floor(new Date().getTime() / 1000) - 60 * 60;
  const list = [];
  let v = p * 0.995;
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

// --- order placement ---
async function placeOrder(req, res, side) {
  try {
    const body = req.body || {};
    const coin = await pairCoin(body);
    if (!coin) return fail(res, 400, 'Unknown trading pair');
    const sym = (coin.symbol || '').toUpperCase();
    const acc = await Account.forUser(req.user.id);

    const live = price(sym);
    if (!live) return fail(res, 400, 'Market price unavailable');

    // trade_type: market (execute now) vs limit. Treat missing/"market"/1 as market.
    const tt = body.trade_type;
    const isMarket = tt == null || tt === 1 || tt === '1' || /market|shishi/i.test(String(tt)) || Number(body.entrust_price) <= 0;
    const limitPrice = Number(body.entrust_price) || live;
    const usePrice = isMarket ? live : limitPrice;

    // quantity: prefer entrust_num, else derive from expect_money
    let qty = Number(body.entrust_num) || 0;
    if (!qty && Number(body.expect_money)) qty = Number(body.expect_money) / usePrice;
    qty = r8(qty);
    if (qty <= 0) return fail(res, 400, 'Enter a valid amount');

    const total = r2(qty * usePrice);

    if (side === 'buy') {
      if (isMarket) {
        if (acc.funds < total) return fail(res, 400, 'Insufficient USDT balance');
        acc.funds = r2(acc.funds - total);
        setHold(acc, sym, getHold(acc, sym) + qty);
      } else {
        // limit buy: freeze the cost, rest the order
        const cost = r2(qty * limitPrice);
        if (acc.funds < cost) return fail(res, 400, 'Insufficient USDT balance');
        acc.funds = r2(acc.funds - cost);
        acc.funds_freeze = r2(acc.funds_freeze + cost);
      }
    } else {
      // sell
      const held = getHold(acc, sym);
      if (held < qty) return fail(res, 400, `Insufficient ${sym} balance`);
      if (isMarket) {
        setHold(acc, sym, held - qty);
        acc.funds = r2(acc.funds + total);
      } else {
        setHold(acc, sym, held - qty); // reserve the coin for the resting sell
      }
    }
    await acc.save();

    const order = await CoinOrder.create({
      id: await nextId('coin_orders'),
      user_id: req.user.id,
      pair_id: coin.id,
      coin_name: sym,
      side,
      is_market: isMarket,
      entrust_price: usePrice,
      entrust_num: qty,
      expect_money: total,
      filled_price: isMarket ? usePrice : 0,
      filled_num: isMarket ? qty : 0,
      filled_money: isMarket ? total : 0,
      status: isMarket ? 1 : 0,
    });

    return ok(res, { id: order.id, status: order.status, deal_price: order.filled_price, deal_num: order.filled_num });
  } catch (e) {
    return fail(res, 500, e.message);
  }
}

router.post('/buyorder', (req, res) => placeOrder(req, res, 'buy'));
router.post('/sellorder', (req, res) => placeOrder(req, res, 'sell'));

// Orders list — { list: { data: [...] } }. `status` filter: 0 pending, else history.
router.post('/entrustorderlist', async (req, res) => {
  const body = req.body || {};
  const q = { user_id: req.user.id };
  if (body.status != null && body.status !== '') q.status = Number(body.status);
  else if (body.type === 'current' || body.is_current) q.status = 0;
  const rows = await CoinOrder.find(q).sort({ createdAt: -1 }).limit(100);
  return ok(res, { list: { data: rows.map((o) => o.toApi()), total: rows.length } });
});

// Cancel a resting limit order and refund the frozen balance / reserved coin.
router.post('/cancelorder', async (req, res) => {
  // The Coin page sends `order_no`; other callers use `id`. Accept either.
  const body = req.body || {};
  const key = body.id != null && body.id !== '' ? body.id : body.order_no;
  const order = await CoinOrder.findOne({ id: Number(key), user_id: req.user.id });
  if (!order) return fail(res, 400, 'Order not found');
  if (order.status !== 0) return fail(res, 400, 'Order is not open');
  const acc = await Account.forUser(req.user.id);
  if (order.side === 'buy') {
    const cost = r2(order.entrust_num * order.entrust_price);
    acc.funds_freeze = r2(acc.funds_freeze - cost);
    acc.funds = r2(acc.funds + cost);
  } else {
    setHold(acc, order.coin_name, getHold(acc, order.coin_name) + order.entrust_num);
  }
  await acc.save();
  order.status = 2;
  await order.save();
  return ok(res, {});
});

// --- resting limit-order matcher (dev only; started from the server entry) ---
let matcherTimer = null;
function startMatcher() {
  if (matcherTimer) return;
  matcherTimer = setInterval(async () => {
    try {
      const pending = await CoinOrder.find({ status: 0, is_market: false }).limit(200);
      for (const o of pending) {
        const live = price(o.coin_name);
        if (!live) continue;
        const cross = o.side === 'buy' ? live <= o.entrust_price : live >= o.entrust_price;
        if (!cross) continue;
        const acc = await Account.forUser(o.user_id);
        const total = r2(o.entrust_num * o.entrust_price);
        if (o.side === 'buy') {
          acc.funds_freeze = r2(acc.funds_freeze - total);
          setHold(acc, o.coin_name, getHold(acc, o.coin_name) + o.entrust_num);
        } else {
          acc.funds = r2(acc.funds + total);
        }
        await acc.save();
        o.status = 1; o.filled_price = o.entrust_price; o.filled_num = o.entrust_num; o.filled_money = total;
        await o.save();
      }
    } catch (e) { /* keep the loop alive */ }
  }, 1500);
}

module.exports = router;
module.exports.startMatcher = startMatcher;
