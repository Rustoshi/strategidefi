// Earn/staking service.
//
// Yield policy (deliberate): this product promises NO rate. Nothing here accrues interest on
// a timer or a formula. `creditYield` is the ONLY way a position's yield grows, it is an
// explicit admin action for earnings that were actually realised, and every credit writes a
// CreditLog transaction. That keeps displayed "income" equal to money that actually moved.
const Account = require('../models/Account');
const CreditLog = require('../models/CreditLog');
const StakingPlan = require('../models/StakingPlan');
const StakingPosition = require('../models/StakingPosition');
const { nextId } = require('../models/Counter');

const r2 = (n) => Number((Number(n) || 0).toFixed(2));

async function log(user_id, type, amount, balance_after, remark, ref_id) {
  return CreditLog.create({
    id: await nextId('credit_logs'),
    user_id,
    type,
    amount: r2(amount),
    balance_after: r2(balance_after),
    remark: remark || '',
    ref_id: ref_id || 0,
  });
}

// Stake `amount` into a plan: principal leaves the usable balance and locks for day_num days.
async function stake(userId, planId, amount) {
  const plan = await StakingPlan.findOne({ id: Number(planId), status: 1 });
  if (!plan) throw new Error('Unknown plan');
  const amt = r2(amount);
  if (!(amt > 0)) throw new Error('Enter a valid amount');
  if (amt < plan.min_price) throw new Error(`Minimum amount is ${plan.min_price}`);
  if (plan.max_price && amt > plan.max_price) throw new Error(`Maximum amount is ${plan.max_price}`);

  const acc = await Account.forUser(userId);
  if (acc.funds < amt) throw new Error('Insufficient balance');
  acc.funds = r2(acc.funds - amt);
  await acc.save();

  const now = Date.now();
  const pos = await StakingPosition.create({
    id: await nextId('staking_positions'),
    user_id: userId,
    plan_id: plan.id,
    plan_name: plan.names,
    amount: amt,
    day_num: plan.day_num,
    start_at: now,
    end_at: now + plan.day_num * 86400000,
    status: 0,
  });
  await log(userId, 'stake', -amt, acc.funds, `Staked into ${plan.names}`, pos.id);
  return pos;
}

// ADMIN: credit realised yield to a position. Writes a transaction and moves real balance.
// There is no automatic/scheduled caller for this by design.
async function creditYield(positionId, amount, remark) {
  const pos = await StakingPosition.findOne({ id: Number(positionId) });
  if (!pos) throw new Error('Unknown position');
  const amt = r2(amount);
  if (!(amt > 0)) throw new Error('Yield amount must be positive');

  const acc = await Account.forUser(pos.user_id);
  acc.funds = r2(acc.funds + amt);
  await acc.save();

  pos.total_yield = r2((pos.total_yield || 0) + amt);
  await pos.save();

  await log(pos.user_id, 'yield', amt, acc.funds, remark || `Earnings credited — ${pos.plan_name}`, pos.id);
  return pos;
}

// Return principal once the cycle has matured.
async function redeem(userId, positionId) {
  const pos = await StakingPosition.findOne({ id: Number(positionId), user_id: userId });
  if (!pos) throw new Error('Unknown position');
  if (pos.status === 1) throw new Error('Already redeemed');
  if (Date.now() < pos.end_at) throw new Error('Still locked until the cycle matures');

  const acc = await Account.forUser(userId);
  acc.funds = r2(acc.funds + pos.amount);
  await acc.save();
  pos.status = 1;
  await pos.save();
  await log(userId, 'unstake', pos.amount, acc.funds, `Principal returned — ${pos.plan_name}`, pos.id);
  return pos;
}

// Header figures for the Earn page — all derived from real positions / credited yield.
async function totals(userId) {
  const active = await StakingPosition.find({ user_id: userId, status: 0 });
  const all = await StakingPosition.find({ user_id: userId });
  const order_price = r2(active.reduce((s, p) => s + (p.amount || 0), 0));
  const total_profit = r2(all.reduce((s, p) => s + (p.total_yield || 0), 0));

  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const todayRows = await CreditLog.find({ user_id: userId, type: 'yield', createdAt: { $gte: midnight } });
  const today_profit = r2(todayRows.reduce((s, r) => s + (r.amount || 0), 0));
  return { order_price, total_profit, today_profit };
}

module.exports = { stake, creditYield, redeem, totals };
