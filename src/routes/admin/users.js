// Users list + the user detail / management hub.
const express = require('express');
const router = express.Router();

const User = require('../../models/User');
const Account = require('../../models/Account');
const Coin = require('../../models/Coin');
const CreditLog = require('../../models/CreditLog');
const Debt = require('../../models/Debt');
const CoinOrder = require('../../models/CoinOrder');
const ContractOrder = require('../../models/ContractOrder');
const OptionOrder = require('../../models/OptionOrder');
const StakingPosition = require('../../models/StakingPosition');
const RechargeOrder = require('../../models/RechargeOrder');
const WithdrawOrder = require('../../models/WithdrawOrder');
const { nextId } = require('../../models/Counter');
const { price } = require('../../ws');

const r2 = (n) => Number((Number(n) || 0).toFixed(2));
const PER_PAGE = 25;

// The three sub-accounts an admin can adjust.
const FIELDS = { funds: 'Funds Account', contract: 'Contract Account', fiat: 'Fiat Account' };

async function log(user_id, type, amount, balance_after, remark) {
  return CreditLog.create({
    id: await nextId('credit_logs'), user_id, type,
    amount: r2(amount), balance_after: r2(balance_after), remark: remark || '',
  });
}

// Net worth across every account + holdings (same basis as the app's Total Asset Equivalent).
async function totalFor(userId, acc) {
  const coins = await Coin.find({ status: 1 });
  const holdings = acc.holdings || {};
  let held = 0;
  coins.forEach((c) => {
    const sym = (c.symbol || '').toUpperCase();
    if (sym === 'USDT') return;
    held += Number(holdings[sym] || 0) * (price(sym) || 0);
  });
  const open = await ContractOrder.find({ user_id: userId, status: 1 });
  const openMargin = open.reduce((s, o) => s + (o.margin || 0), 0);
  const openPnl = open.reduce((s, o) => s + o.pnlAt(price(o.coin_name)), 0);
  const staked = (await StakingPosition.find({ user_id: userId, status: 0 })).reduce((s, p) => s + (p.amount || 0), 0);
  const bets = (await OptionOrder.find({ user_id: userId, status: 0 })).reduce((s, o) => s + (o.bet_amount || 0), 0);
  return r2(acc.funds + acc.funds_freeze + acc.contract + acc.contract_freeze + acc.fiat + acc.fiat_freeze + held + openMargin + openPnl + staked + bets);
}

// ---------- List ----------
router.get('/users', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '');
  const page = Math.max(1, Number(req.query.page) || 1);

  const where = {};
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const asNum = Number(q);
    where.$or = [{ email: rx }, { nickname: rx }, { invite_code: rx }, { wallet_address: rx }];
    if (!Number.isNaN(asNum)) where.$or.push({ id: asNum });
  }
  if (status === 'active') where.status = 1;
  if (status === 'disabled') where.status = 0;

  const total = await User.countDocuments(where);
  const users = await User.find(where).sort({ createdAt: -1 }).skip((page - 1) * PER_PAGE).limit(PER_PAGE);

  // Attach each user's balance for the list.
  const rows = [];
  for (const u of users) {
    const acc = await Account.forUser(u.id);
    rows.push({ u, funds: r2(acc.funds), total: await totalFor(u.id, acc) });
  }

  res.render('admin/users', {
    title: 'Users', active: 'users', rows, q, status,
    page, pages: Math.max(1, Math.ceil(total / PER_PAGE)), total,
    flash: req.query.msg || null, err: req.query.err || null,
  });
});

// ---------- Detail ----------
router.get('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const user = await User.findOne({ id });
  if (!user) return res.redirect('/admin/users?err=User+not+found');
  const acc = await Account.forUser(id);

  const coins = await Coin.find({ status: 1 }).sort({ sort: -1 });
  const holdings = [];
  coins.forEach((c) => {
    const sym = (c.symbol || '').toUpperCase();
    if (sym === 'USDT') return;
    const amt = Number((acc.holdings || {})[sym] || 0);
    if (amt > 0) holdings.push({ sym, amt, value: r2(amt * (price(sym) || 0)) });
  });

  const [logs, spot, contracts, options, stakes, deposits, withdrawals, owed] = await Promise.all([
    CreditLog.find({ user_id: id }).sort({ createdAt: -1 }).limit(25),
    CoinOrder.find({ user_id: id }).sort({ createdAt: -1 }).limit(10),
    ContractOrder.find({ user_id: id }).sort({ createdAt: -1 }).limit(10),
    OptionOrder.find({ user_id: id }).sort({ createdAt: -1 }).limit(10),
    StakingPosition.find({ user_id: id }).sort({ createdAt: -1 }).limit(10),
    RechargeOrder.find({ user_id: id }).sort({ createdAt: -1 }).limit(10),
    WithdrawOrder.find({ user_id: id }).sort({ createdAt: -1 }).limit(10),
    Debt.outstandingFor(id),
  ]);

  res.render('admin/user-detail', {
    title: `User #${id}`, active: 'users',
    user, acc, holdings, owed,
    total: await totalFor(id, acc),
    logs: logs.map((l) => l.toApi()),
    spot: spot.map((o) => o.toApi()),
    contracts: contracts.map((o) => o.toApi(price(o.coin_name))),
    options: options.map((o) => o.toApi()),
    stakes: stakes.map((s) => s.toApi()),
    deposits, withdrawals, FIELDS,
    flash: req.query.msg || null, err: req.query.err || null,
  });
});

const back = (id, msg, err) =>
  `/admin/users/${id}?${err ? 'err=' + encodeURIComponent(err) : 'msg=' + encodeURIComponent(msg)}`;

// ---------- Profile actions ----------
router.post('/users/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const user = await User.findOne({ id });
  if (!user) return res.redirect('/admin/users?err=User+not+found');
  user.status = user.status === 1 ? 0 : 1;
  await user.save();
  res.redirect(back(id, user.status === 1 ? 'Account enabled' : 'Account disabled'));
});

router.post('/users/:id/admin', async (req, res) => {
  const id = Number(req.params.id);
  const user = await User.findOne({ id });
  if (!user) return res.redirect('/admin/users?err=User+not+found');
  // Don't let an admin strip their own access and lock themselves out.
  if (req.admin && req.admin.id === id) return res.redirect(back(id, null, 'You cannot change your own admin access'));
  user.is_admin = !user.is_admin;
  await user.save();
  res.redirect(back(id, user.is_admin ? 'Granted admin access' : 'Revoked admin access'));
});

router.post('/users/:id/password', async (req, res) => {
  const id = Number(req.params.id);
  const pw = String((req.body || {}).password || '');
  if (pw.length < 6) return res.redirect(back(id, null, 'Password must be at least 6 characters'));
  const user = await User.findOne({ id });
  if (!user) return res.redirect('/admin/users?err=User+not+found');
  await user.setPassword(pw); // bcrypt — the model has no pre-save hook, so never assign .password directly
  await user.save();
  res.redirect(back(id, 'Login password reset'));
});

// ---------- Security: withdrawal password (admin-set, viewable) ----------
router.post('/users/:id/withdraw-password', async (req, res) => {
  const id = Number(req.params.id);
  const user = await User.findOne({ id });
  if (!user) return res.redirect('/admin/users?err=User+not+found');
  user.withdraw_password = String((req.body || {}).withdraw_password || '').trim();
  await user.save();
  res.redirect(back(id, user.withdraw_password ? 'Withdrawal password set' : 'Withdrawal password cleared (global one applies)'));
});

// ---------- Loan ----------
router.post('/users/:id/loan-quota', async (req, res) => {
  const id = Number(req.params.id);
  const user = await User.findOne({ id });
  if (!user) return res.redirect('/admin/users?err=User+not+found');
  const raw = String((req.body || {}).loan_quota || '').trim();
  user.loan_quota = raw === '' ? null : Math.max(0, Number(raw) || 0);
  await user.save();
  res.redirect(back(id, raw === '' ? 'Credit limit cleared (global default applies)' : `Credit limit set to ${user.loan_quota}`));
});

// Settle (write off) outstanding debt without touching the user's balance.
router.post('/users/:id/settle-debt', async (req, res) => {
  const id = Number(req.params.id);
  const amount = r2((req.body || {}).amount);
  const owed = await Debt.outstandingFor(id);
  if (!(amount > 0)) return res.redirect(back(id, null, 'Enter a valid amount'));
  if (amount > owed) return res.redirect(back(id, null, `They only owe ${owed} USDT`));
  await Debt.create({ id: await nextId('debts'), user_id: id, debt_type: 2, amount, remark: 'Written off by admin' });
  res.redirect(back(id, `Wrote off ${amount} USDT of debt`));
});

// ---------- Balance adjustment ----------
router.post('/users/:id/balance', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const field = String(body.field || 'funds');
  if (!FIELDS[field]) return res.redirect(back(id, null, 'Unknown account'));
  const amount = r2(body.amount); // may be negative to debit
  const reason = String(body.reason || '').trim();
  if (!amount) return res.redirect(back(id, null, 'Enter a non-zero amount'));
  if (!reason) return res.redirect(back(id, null, 'A reason is required — it goes on the audit trail'));

  const acc = await Account.forUser(id);
  const next = r2(acc[field] + amount);
  if (next < 0) return res.redirect(back(id, null, `That would take ${FIELDS[field]} negative (balance ${r2(acc[field])})`));
  acc[field] = next;
  await acc.save();
  await log(id, 'adjust', amount, field === 'funds' ? next : r2(acc.funds), `Admin adjustment (${FIELDS[field]}): ${reason}`);
  res.redirect(back(id, `${amount > 0 ? 'Credited' : 'Debited'} ${Math.abs(amount)} USDT to ${FIELDS[field]}`));
});

module.exports = router;
