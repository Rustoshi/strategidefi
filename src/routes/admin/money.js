// Deposit requests, withdrawal requests, and the balance transaction ledger.
//
// Deposits are recorded PENDING by the app and never auto-credit — approving here is what
// actually credits the (simulated) balance. Withdrawals already debited on submission, so
// approving just marks them done, while rejecting must REFUND.
const express = require('express');
const router = express.Router();

const User = require('../../models/User');
const Account = require('../../models/Account');
const CreditLog = require('../../models/CreditLog');
const RechargeOrder = require('../../models/RechargeOrder');
const WithdrawOrder = require('../../models/WithdrawOrder');
const { nextId } = require('../../models/Counter');

const r2 = (n) => Number((Number(n) || 0).toFixed(2));
const PER_PAGE = 25;

async function log(user_id, type, amount, balance_after, remark, ref_id) {
  return CreditLog.create({
    id: await nextId('credit_logs'), user_id, type,
    amount: r2(amount), balance_after: r2(balance_after), remark: remark || '', ref_id: ref_id || 0,
  });
}

// Map user_id -> email for display.
async function emailsFor(rows) {
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const users = await User.find({ id: { $in: ids } });
  const m = {};
  users.forEach((u) => { m[u.id] = u.email; });
  return m;
}

// ---------- Deposits ----------
router.get('/deposits', async (req, res) => {
  const status = req.query.status === undefined ? '0' : String(req.query.status);
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = status === '' ? {} : { status: Number(status) };
  const total = await RechargeOrder.countDocuments(where);
  const rows = await RechargeOrder.find(where).sort({ createdAt: -1 }).skip((page - 1) * PER_PAGE).limit(PER_PAGE);
  res.render('admin/deposits', {
    title: 'Deposits', active: 'deposits', rows, emails: await emailsFor(rows), status,
    page, pages: Math.max(1, Math.ceil(total / PER_PAGE)), total,
    flash: req.query.msg || null, err: req.query.err || null,
  });
});

router.post('/deposits/:id/approve', async (req, res) => {
  const order = await RechargeOrder.findOne({ id: Number(req.params.id) });
  if (!order) return res.redirect('/admin/deposits?err=Not+found');
  if (order.status !== 0) return res.redirect('/admin/deposits?err=Already+reviewed');
  // Credit only USDT deposits to the cash balance; other coins credit the spot holding.
  const acc = await Account.forUser(order.user_id);
  const coin = String(order.coin_name || 'USDT').toUpperCase();
  if (coin === 'USDT') {
    acc.funds = r2(acc.funds + order.amount);
  } else {
    acc.holdings = acc.holdings || {};
    acc.holdings[coin] = Number(((acc.holdings[coin] || 0) + order.amount).toFixed(8));
    acc.markModified('holdings');
  }
  await acc.save();
  order.status = 1;
  await order.save();
  await log(order.user_id, 'deposit', order.amount, r2(acc.funds), `Deposit approved — ${order.channel || coin}`, order.id);
  res.redirect('/admin/deposits?msg=' + encodeURIComponent(`Approved ${order.amount} ${coin} for user #${order.user_id}`));
});

router.post('/deposits/:id/reject', async (req, res) => {
  const order = await RechargeOrder.findOne({ id: Number(req.params.id) });
  if (!order) return res.redirect('/admin/deposits?err=Not+found');
  if (order.status !== 0) return res.redirect('/admin/deposits?err=Already+reviewed');
  order.status = 2;
  await order.save(); // nothing was credited, so nothing to reverse
  res.redirect('/admin/deposits?msg=Deposit+rejected');
});

// ---------- Withdrawals ----------
router.get('/withdrawals', async (req, res) => {
  const status = req.query.status === undefined ? '0' : String(req.query.status);
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = status === '' ? {} : { status: Number(status) };
  const total = await WithdrawOrder.countDocuments(where);
  const rows = await WithdrawOrder.find(where).sort({ createdAt: -1 }).skip((page - 1) * PER_PAGE).limit(PER_PAGE);
  res.render('admin/withdrawals', {
    title: 'Withdrawals', active: 'withdrawals', rows, emails: await emailsFor(rows), status,
    page, pages: Math.max(1, Math.ceil(total / PER_PAGE)), total,
    flash: req.query.msg || null, err: req.query.err || null,
  });
});

router.post('/withdrawals/:id/approve', async (req, res) => {
  const order = await WithdrawOrder.findOne({ id: Number(req.params.id) });
  if (!order) return res.redirect('/admin/withdrawals?err=Not+found');
  if (order.status !== 0) return res.redirect('/admin/withdrawals?err=Already+reviewed');
  order.status = 1; // the amount was debited at submission — approving just confirms it
  await order.save();
  res.redirect('/admin/withdrawals?msg=' + encodeURIComponent(`Approved ${order.amount} ${order.coin_name}`));
});

router.post('/withdrawals/:id/reject', async (req, res) => {
  const order = await WithdrawOrder.findOne({ id: Number(req.params.id) });
  if (!order) return res.redirect('/admin/withdrawals?err=Not+found');
  if (order.status !== 0) return res.redirect('/admin/withdrawals?err=Already+reviewed');
  // Rejecting MUST give the money back — it left the balance when the request was submitted.
  const acc = await Account.forUser(order.user_id);
  const coin = String(order.coin_name || 'USDT').toUpperCase();
  if (coin === 'USDT') {
    acc.funds = r2(acc.funds + order.amount);
  } else {
    acc.holdings = acc.holdings || {};
    acc.holdings[coin] = Number(((acc.holdings[coin] || 0) + order.amount).toFixed(8));
    acc.markModified('holdings');
  }
  await acc.save();
  order.status = 2;
  order.remark = String((req.body || {}).remark || 'Rejected by admin');
  await order.save();
  await log(order.user_id, 'refund', order.amount, r2(acc.funds), `Withdrawal rejected — refunded ${order.coin_type || coin}`, order.id);
  res.redirect('/admin/withdrawals?msg=' + encodeURIComponent(`Rejected and refunded ${order.amount} ${coin}`));
});

// ---------- Transactions (ledger across all users) ----------
router.get('/transactions', async (req, res) => {
  const type = String(req.query.type || '');
  const uid = String(req.query.uid || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = {};
  if (type) where.type = type;
  if (uid && !Number.isNaN(Number(uid))) where.user_id = Number(uid);

  const total = await CreditLog.countDocuments(where);
  const rows = await CreditLog.find(where).sort({ createdAt: -1 }).skip((page - 1) * PER_PAGE).limit(PER_PAGE);
  const types = await CreditLog.distinct('type');

  res.render('admin/transactions', {
    title: 'Transactions', active: 'transactions',
    rows: rows.map((r) => ({ ...r.toApi(), user_id: r.user_id })),
    emails: await emailsFor(rows), types, type, uid,
    page, pages: Math.max(1, Math.ceil(total / PER_PAGE)), total,
  });
});

module.exports = router;
