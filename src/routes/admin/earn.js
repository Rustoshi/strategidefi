// Earn / staking: plan tiers + open positions, and crediting realised yield.
//
// Crediting yield is the ONLY thing that grows a position's earnings (nothing accrues on a
// timer), and every credit writes a CreditLog transaction. This page replaces what previously
// needed a hand-run node call.
const express = require('express');
const router = express.Router();

const User = require('../../models/User');
const StakingPlan = require('../../models/StakingPlan');
const StakingPosition = require('../../models/StakingPosition');
const { nextId } = require('../../models/Counter');
const staking = require('../../services/staking');

router.get('/earn', async (req, res) => {
  const plans = await StakingPlan.find().sort({ sort: 1, min_price: 1 });
  const positions = await StakingPosition.find().sort({ createdAt: -1 }).limit(50);
  const ids = [...new Set(positions.map((p) => p.user_id))];
  const users = await User.find({ id: { $in: ids } });
  const emails = {};
  users.forEach((u) => { emails[u.id] = u.email; });

  res.render('admin/earn', {
    title: 'Earn / Staking', active: 'earn',
    plans,
    positions: positions.map((p) => ({ ...p.toApi(), user_id: p.user_id })),
    emails,
    flash: req.query.msg || null, err: req.query.err || null,
  });
});

// Create / update a plan tier.
router.post('/earn/plans', async (req, res) => {
  const b = req.body || {};
  const data = {
    names: String(b.names || 'Tether AI'),
    image: String(b.image || '/tether.png'),
    min_price: Number(b.min_price) || 0,
    max_price: Number(b.max_price) || 0,
    day_num: Number(b.day_num) || 1,
    // Stored as decimals: the form takes percent (1.40) -> 0.014
    profit_rate_min: (Number(b.profit_rate_min) || 0) / 100,
    profit_rate_max: (Number(b.profit_rate_max) || 0) / 100,
    sort: Number(b.sort) || 0,
    status: Number(b.status),
  };
  if (b.id) await StakingPlan.updateOne({ id: Number(b.id) }, { $set: data });
  else await StakingPlan.create({ id: await nextId('staking_plans'), ...data });
  res.redirect('/admin/earn?msg=' + encodeURIComponent('Plan saved'));
});

router.post('/earn/plans/:id/delete', async (req, res) => {
  await StakingPlan.deleteOne({ id: Number(req.params.id) });
  res.redirect('/admin/earn?msg=' + encodeURIComponent('Plan deleted'));
});

// Credit realised yield to a position — credits the balance AND writes the transaction.
router.post('/earn/positions/:id/yield', async (req, res) => {
  const id = Number(req.params.id);
  const amount = Number((req.body || {}).amount);
  const remark = String((req.body || {}).remark || '').trim();
  try {
    const pos = await staking.creditYield(id, amount, remark || undefined);
    res.redirect('/admin/earn?msg=' + encodeURIComponent(`Credited ${amount} USDT to position #${pos.id}`));
  } catch (e) {
    res.redirect('/admin/earn?err=' + encodeURIComponent(e.message));
  }
});

// Return principal once matured.
router.post('/earn/positions/:id/redeem', async (req, res) => {
  const id = Number(req.params.id);
  const pos = await StakingPosition.findOne({ id });
  if (!pos) return res.redirect('/admin/earn?err=Position+not+found');
  try {
    await staking.redeem(pos.user_id, id);
    res.redirect('/admin/earn?msg=' + encodeURIComponent('Principal returned'));
  } catch (e) {
    res.redirect('/admin/earn?err=' + encodeURIComponent(e.message));
  }
});

module.exports = router;
