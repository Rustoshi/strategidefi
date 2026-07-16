// Perpetual contract trading (paper).
//
// Sizing: 1 Cont = 1 USDT notional (unit_amount = 1), so margin = entrust_sheet / lever —
// which is exactly what the app's "Estimated Margin" line displays.
// PnL settles honestly against the live mark price: long gains when price rises, short when
// it falls. Market orders fill now; limit orders rest until the price crosses. A monitor
// fills resting orders, triggers take-profit / stop-loss and liquidates when the loss eats
// the margin. All balances are simulated.
const express = require('express');
const router = express.Router();

const Account = require('../../models/Account');
const Coin = require('../../models/Coin');
const ContractOrder = require('../../models/ContractOrder');
const { nextId } = require('../../models/Counter');
const { optionalAuth, requireAuth } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');
const { price, change, disp } = require('../../ws');

const r2 = (n) => Number((Number(n) || 0).toFixed(2));
const LEVERS = [1, 5, 10, 20, 50, 100];
const UNIT_AMOUNT = 1; // 1 Cont = 1 USDT notional

async function pairCoin(body) {
  body = body || {};
  const id = body.pair_id != null ? body.pair_id : body.id;
  if (id != null && id !== '') {
    const c = await Coin.findOne({ id: Number(id) });
    if (c && (c.symbol || '').toUpperCase() !== 'USDT') return c;
  }
  const name = String(body.coin_name || '').toUpperCase();
  if (name) return Coin.findOne({ symbol: name });
  return Coin.findOne({ symbol: 'BTC' }); // sensible default pair
}

router.use(optionalAuth, requireAuth);

// Tradable perpetual pairs (left nav / pair picker).
// The nav template does `e.increase.toString().indexOf('-')` to pick the rise/fall colour and
// prints `e.current_rate` — if either is missing the v-for throws, which aborts the WHOLE
// page render (no pairs, and the price/board stop repainting). Both are required.
router.post('/getpairlist', async (_req, res) => {
  const coins = await Coin.find({ status: 1 }).sort({ sort: -1 });
  const pair_list = coins
    .filter((c) => (c.symbol || '').toUpperCase() !== 'USDT')
    .map((c) => {
      const sym = (c.symbol || '').toUpperCase();
      const chg = Number(change(sym)) || 0;
      return {
        id: c.id,
        pair_id: c.id,
        pair_name: `${sym}/USDT`,
        coin_name: sym,
        price: disp(price(sym)),
        price_decimals: 2,
        increase: Number(chg.toFixed(2)), // sign drives the rise/fall class
        current_rate: `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`,
      };
    });
  return ok(res, { pair_list });
});

// Pair detail: current price, leverage options (with openable max) and pair meta.
router.post('/detail', async (req, res) => {
  const coin = await pairCoin(req.body);
  if (!coin) return fail(res, 400, 'Unknown contract pair');
  const sym = (coin.symbol || '').toUpperCase();
  const cur = price(sym);
  const acc = await Account.forUser(req.user.id);

  // Openable contracts at each leverage: margin per Cont = 1/lever, so max = funds * lever.
  const lever_cfg = LEVERS.map((lever) => ({ lever, max: Math.floor(r2(acc.contract) * lever) }));

  return ok(res, {
    cfg: {
      current_price: disp(cur),
      entrust_price_up: disp(cur * 1.1),
      entrust_price_down: disp(cur * 0.9),
      fee_rate: 0,
    },
    lever_cfg,
    pair_info: { id: coin.id, pair_id: coin.id, pair_name: `${sym}/USDT`, coin_name: sym, price_decimals: 2, unit_amount: UNIT_AMOUNT },
  });
});

// Open a position. { pair_id, entrust_type(1 long|2 short), trade_type(1 limit|2 market),
//                    lever, entrust_price, entrust_sheet, stop_win_price, stop_lose_price }
router.post('/order', async (req, res) => {
  try {
    const body = req.body || {};
    const coin = await pairCoin(body);
    if (!coin) return fail(res, 400, 'Unknown contract pair');
    const sym = (coin.symbol || '').toUpperCase();
    const cur = price(sym);
    if (!cur) return fail(res, 400, 'Market price unavailable');

    const dir = Number(body.entrust_type) === 2 ? 2 : 1;
    const isMarket = Number(body.trade_type) === 2;
    const lever = LEVERS.includes(Number(body.lever)) ? Number(body.lever) : 1;
    const sheets = Math.floor(Number(body.entrust_sheet) || 0);
    if (sheets <= 0) return fail(res, 400, 'Please enter a quantity');

    const entrustPrice = isMarket ? cur : Number(body.entrust_price) || cur;
    if (!isMarket && (entrustPrice > cur * 1.1 || entrustPrice < cur * 0.9)) {
      return fail(res, 400, 'Price is outside the allowed range');
    }

    const margin = r2(sheets / lever); // 1 Cont = 1 USDT notional
    const acc = await Account.forUser(req.user.id);
    if (acc.contract < margin) return fail(res, 400, 'Insufficient Contract Account balance — transfer USDT from your Funds Account first');
    acc.contract = r2(acc.contract - margin);
    await acc.save();

    const order = await ContractOrder.create({
      id: await nextId('contract_orders'),
      order_no: 'C' + Date.now() + Math.floor(Math.random() * 900 + 100),
      user_id: req.user.id,
      pair_id: coin.id,
      pair_name: `${sym}/USDT`,
      coin_name: sym,
      entrust_type: dir,
      trade_type: isMarket ? 2 : 1,
      lever,
      entrust_price: r2(entrustPrice),
      entrust_sheet: sheets,
      avg_price: isMarket ? cur : 0, // limit orders fill later
      margin,
      stop_win_price: Number(body.stop_win_price) || 0,
      stop_lose_price: Number(body.stop_lose_price) || 0,
      status: isMarket ? 1 : 0,
    });

    return ok(res, { order_no: order.order_no, status: order.status }, isMarket ? 'Position opened' : 'Order placed');
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// Positions / current (resting) orders. status_text: 'open' | 'current'
router.post('/getopenlist', async (req, res) => {
  const body = req.body || {};
  const q = { user_id: req.user.id };
  if (body.pair_id) q.pair_id = Number(body.pair_id);
  const wantOpen = String(body.status_text || 'open') === 'open';
  q.status = wantOpen ? 1 : 0;

  const rows = await ContractOrder.find(q).sort({ createdAt: -1 }).limit(100);
  const data = rows.map((o) => o.toApi(price(o.coin_name)));
  const open_total = await ContractOrder.countDocuments({ user_id: req.user.id, status: 1 });
  const current_total = await ContractOrder.countDocuments({ user_id: req.user.id, status: 0 });
  return ok(res, {
    list: { data, current_page: 1, last_page: 1, total: data.length },
    total: data.length,
    open_total,
    current_total,
  });
});

// Close a position at the live mark price, returning margin + PnL.
async function closeOrder(order, mark, reason) {
  const pnl = order.pnlAt(mark);
  const acc = await Account.forUser(order.user_id);
  acc.contract = r2(acc.contract + order.margin + pnl);
  await acc.save();
  order.status = 2;
  order.close_price = mark;
  order.profit = pnl;
  order.close_reason = reason || 'manual';
  await order.save();
  return order;
}

router.post('/dealorder', async (req, res) => {
  const order = await ContractOrder.findOne({ order_no: String((req.body || {}).order_no), user_id: req.user.id });
  if (!order) return fail(res, 400, 'Order not found');
  if (order.status !== 1) return fail(res, 400, 'Position is not open');
  const mark = price(order.coin_name);
  if (!mark) return fail(res, 400, 'Market price unavailable');
  await closeOrder(order, mark, 'manual');
  return ok(res, order.toApi(mark), 'Position closed');
});

// Close and immediately reopen in the opposite direction, same size/leverage.
router.post('/reverse', async (req, res) => {
  const order = await ContractOrder.findOne({ order_no: String((req.body || {}).order_no), user_id: req.user.id });
  if (!order) return fail(res, 400, 'Order not found');
  if (order.status !== 1) return fail(res, 400, 'Position is not open');
  const mark = price(order.coin_name);
  if (!mark) return fail(res, 400, 'Market price unavailable');
  await closeOrder(order, mark, 'manual');

  const acc = await Account.forUser(req.user.id);
  const margin = r2(order.entrust_sheet / order.lever);
  if (acc.contract < margin) return fail(res, 400, 'Insufficient Contract Account balance to reverse');
  acc.contract = r2(acc.contract - margin);
  await acc.save();

  const rev = await ContractOrder.create({
    id: await nextId('contract_orders'),
    order_no: 'C' + Date.now() + Math.floor(Math.random() * 900 + 100),
    user_id: req.user.id,
    pair_id: order.pair_id,
    pair_name: order.pair_name,
    coin_name: order.coin_name,
    entrust_type: order.entrust_type === 1 ? 2 : 1,
    trade_type: 2,
    lever: order.lever,
    entrust_price: mark,
    entrust_sheet: order.entrust_sheet,
    avg_price: mark,
    margin,
    status: 1,
  });
  return ok(res, rev.toApi(mark), 'Position reversed');
});

// Cancel a resting limit order and refund its margin.
router.post('/cancelorder', async (req, res) => {
  const order = await ContractOrder.findOne({ order_no: String((req.body || {}).order_no), user_id: req.user.id });
  if (!order) return fail(res, 400, 'Order not found');
  if (order.status !== 0) return fail(res, 400, 'Order is not pending');
  const acc = await Account.forUser(req.user.id);
  acc.contract = r2(acc.contract + order.margin);
  await acc.save();
  order.status = 3;
  await order.save();
  return ok(res, {}, 'Order cancelled');
});

router.post('/setwinlosestop', async (req, res) => {
  const body = req.body || {};
  const order = await ContractOrder.findOne({ order_no: String(body.order_no), user_id: req.user.id });
  if (!order) return fail(res, 400, 'Order not found');
  order.stop_win_price = Number(body.stop_win_price) || 0;
  order.stop_lose_price = Number(body.stop_lose_price) || 0;
  await order.save();
  return ok(res, order.toApi(price(order.coin_name)), 'Take profit / stop loss saved');
});

// --- monitor: fill resting limits, trigger TP/SL, liquidate ---
let monitorTimer = null;
async function tick() {
  // 1) fill resting limit orders when the price crosses
  const pending = await ContractOrder.find({ status: 0 }).limit(200);
  for (const o of pending) {
    const p = price(o.coin_name);
    if (!p) continue;
    // long fills at/below its limit; short fills at/above.
    const cross = o.entrust_type === 1 ? p <= o.entrust_price : p >= o.entrust_price;
    if (!cross) continue;
    o.status = 1;
    o.avg_price = p;
    await o.save();
  }

  // 2) TP / SL / liquidation on open positions
  const open = await ContractOrder.find({ status: 1 }).limit(500);
  for (const o of open) {
    const p = price(o.coin_name);
    if (!p) continue;
    const pnl = o.pnlAt(p);
    const long = o.entrust_type === 1;

    if (o.stop_win_price && (long ? p >= o.stop_win_price : p <= o.stop_win_price)) {
      await closeOrder(o, p, 'take_profit');
      continue;
    }
    if (o.stop_lose_price && (long ? p <= o.stop_lose_price : p >= o.stop_lose_price)) {
      await closeOrder(o, p, 'stop_loss');
      continue;
    }
    // liquidation: loss has consumed the posted margin
    if (pnl <= -o.margin) {
      const acc = await Account.forUser(o.user_id);
      await acc.save();
      o.status = 2;
      o.close_price = p;
      o.profit = -o.margin; // can't lose more than the margin
      o.close_reason = 'liquidation';
      await o.save();
    }
  }
}
function startMonitor() {
  if (monitorTimer) return;
  monitorTimer = setInterval(() => { tick().catch(() => {}); }, 1500);
}

module.exports = router;
module.exports.startMonitor = startMonitor;
