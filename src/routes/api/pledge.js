// Earn / staking page (`pages/licai/chanpin`).
//
// This product makes NO return promise: plans expose a deposit band and a lock cycle only.
// Yield is variable and is credited by an admin from realised earnings (staking service),
// each credit writing a CreditLog transaction. The rate fields the compiled template requires
// are held at 0 so nothing advertises a return the product cannot guarantee.
const express = require('express');
const router = express.Router();

const StakingPlan = require('../../models/StakingPlan');
const StakingPosition = require('../../models/StakingPosition');
const { optionalAuth, requireAuth } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');
const staking = require('../../services/staking');

router.use(optionalAuth, requireAuth);

// Plan list + the header figures (Deposit Amount / Cumulative Income / Today's Income).
router.post('/pledgelist', async (req, res) => {
  const page = Number((req.body || {}).page) || 1;
  const perPage = 20;
  const plans = await StakingPlan.find({ status: 1 }).sort({ sort: 1, min_price: 1 });
  const t = await staking.totals(req.user.id);
  const data = plans.slice((page - 1) * perPage, page * perPage).map((p) => p.toApi());
  return ok(res, {
    list: { data, current_page: page, last_page: Math.max(1, Math.ceil(plans.length / perPage)), total: plans.length },
    total: plans.length,
    ...t,
  });
});

// Same figures for the wealth landing page.
router.post('/taolilicai', async (req, res) => {
  const plans = await StakingPlan.find({ status: 1 }).sort({ sort: 1, min_price: 1 });
  const t = await staking.totals(req.user.id);
  return ok(res, {
    list: plans.map((p) => ({ id: p.id, name: p.names, icon: p.image, price: p.min_price, flag: 0 })),
    ...t,
  });
});

router.post('/pledgedetail', async (req, res) => {
  const plan = await StakingPlan.findOne({ id: Number((req.body || {}).id), status: 1 });
  if (!plan) return fail(res, 400, 'Unknown plan');
  const acc = await require('../../models/Account').forUser(req.user.id);
  return ok(res, {
    ...plan.toApi(),
    detail: plan.toApi(),
    user_balance: Number((acc.funds || 0).toFixed(2)),
    balance: Number((acc.funds || 0).toFixed(2)),
  });
});

// Stake into a plan.
router.post('/pledgeorder', async (req, res) => {
  try {
    const body = req.body || {};
    const pos = await staking.stake(req.user.id, body.id || body.plan_id || body.pledge_id, body.price || body.amount || body.money);
    return ok(res, { id: pos.id, order_no: 'S' + pos.id, amount: pos.amount, end_time: Math.floor(pos.end_at / 1000) });
  } catch (e) {
    return fail(res, 400, e.message);
  }
});

router.post('/orderlist', async (req, res) => {
  const body = req.body || {};
  const q = { user_id: req.user.id };
  if (body.status != null && body.status !== '') q.status = Number(body.status);
  const rows = await StakingPosition.find(q).sort({ createdAt: -1 }).limit(100);
  const t = await staking.totals(req.user.id);
  return ok(res, { list: { data: rows.map((r) => r.toApi()), current_page: 1, last_page: 1, total: rows.length }, total: rows.length, ...t });
});

router.post('/orderdetail', async (req, res) => {
  const pos = await StakingPosition.findOne({ id: Number((req.body || {}).id), user_id: req.user.id });
  if (!pos) return fail(res, 400, 'Unknown order');
  return ok(res, pos.toApi());
});

// Redeem principal after the cycle matures.
router.post('/redeem', async (req, res) => {
  try {
    const pos = await staking.redeem(req.user.id, (req.body || {}).id);
    return ok(res, pos.toApi());
  } catch (e) {
    return fail(res, 400, e.message);
  }
});

module.exports = router;
