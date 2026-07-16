// Admin panel (server-rendered EJS). Auth is a JWT in an httpOnly `admin_token` cookie,
// gated by requireAdmin; only User.is_admin accounts can sign in.
//
// Every admin action that moves a balance writes a CreditLog row, so there is an audit trail.
const express = require('express');
const router = express.Router();

const User = require('../../models/User');
const Coin = require('../../models/Coin');
const Account = require('../../models/Account');
const RechargeOrder = require('../../models/RechargeOrder');
const WithdrawOrder = require('../../models/WithdrawOrder');
const { signAdmin, requireAdmin } = require('../../middleware/adminAuth');

// ---------- Auth ----------
router.get('/login', (req, res) => {
  if (req.cookies && req.cookies.admin_token) return res.redirect('/admin');
  res.render('admin/login', { title: 'Admin Login', error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: String(email || '').toLowerCase(), is_admin: true });
  if (!user || !(await user.verifyPassword(String(password || '')))) {
    return res.status(401).render('admin/login', { title: 'Admin Login', error: 'Invalid credentials' });
  }
  res.cookie('admin_token', signAdmin(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 3600 * 1000,
  });
  res.redirect('/admin');
});

router.post('/logout', (_req, res) => {
  res.clearCookie('admin_token');
  res.redirect('/admin/login');
});

// Everything below requires an admin session.
router.use(requireAdmin);

// ---------- Dashboard ----------
router.get('/', async (_req, res) => {
  const [users, coins, pendingDeposits, pendingWithdrawals] = await Promise.all([
    User.countDocuments(),
    Coin.countDocuments({ status: 1 }),
    RechargeOrder.countDocuments({ status: 0 }),
    WithdrawOrder.countDocuments({ status: 0 }),
  ]);

  // Simulated USDT held across all sub-accounts (a rough "float" figure).
  const accounts = await Account.find();
  const totalUsdt = accounts.reduce(
    (s, a) => s + (a.funds || 0) + (a.funds_freeze || 0) + (a.contract || 0) + (a.contract_freeze || 0) + (a.fiat || 0) + (a.fiat_freeze || 0),
    0
  );

  const recentUsers = await User.find().sort({ createdAt: -1 }).limit(6);

  res.render('admin/dashboard', {
    title: 'Dashboard',
    active: 'dashboard',
    stats: { users, coins, pendingDeposits, pendingWithdrawals, totalUsdt: Number(totalUsdt.toFixed(2)) },
    recentUsers,
  });
});

router.use(require('./users'));
router.use(require('./messages'));
router.use(require('./money'));
router.use(require('./content'));
router.use(require('./earn'));
router.use(require('./settings'));

module.exports = router;
