const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Banner = require('../models/Banner');
const Coin = require('../models/Coin');
const Notice = require('../models/Notice');
const Setting = require('../models/Setting');
const { nextId } = require('../models/Counter');
const { signAdmin, requireAdmin } = require('../middleware/adminAuth');

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
  const [users, banners, coins, notices] = await Promise.all([
    User.countDocuments(),
    Banner.countDocuments(),
    Coin.countDocuments(),
    Notice.countDocuments(),
  ]);
  res.render('admin/dashboard', {
    title: 'Dashboard',
    active: 'dashboard',
    stats: { users, banners, coins, notices },
  });
});

// ---------- Banners ----------
router.get('/banners', async (_req, res) => {
  const banners = await Banner.find().sort({ sort: -1, createdAt: -1 });
  res.render('admin/banners', { title: 'Banners', active: 'banners', banners });
});

router.post('/banners', async (req, res) => {
  const { id, name, image, redirect_url, sort, status } = req.body;
  if (id) {
    await Banner.updateOne(
      { id: Number(id) },
      { $set: { name, image, redirect_url: redirect_url || null, sort: Number(sort) || 0, status: Number(status) } }
    );
  } else {
    await Banner.create({
      id: await nextId('banners'),
      name,
      image,
      redirect_url: redirect_url || null,
      sort: Number(sort) || 0,
      status: Number(status),
    });
  }
  res.redirect('/admin/banners');
});

router.post('/banners/:id/delete', async (req, res) => {
  await Banner.deleteOne({ id: Number(req.params.id) });
  res.redirect('/admin/banners');
});

// ---------- Coins ----------
router.get('/coins', async (_req, res) => {
  const coins = await Coin.find().sort({ sort: -1 });
  res.render('admin/coins', { title: 'Coins', active: 'coins', coins });
});

router.post('/coins', async (req, res) => {
  const { id, coin_name, symbol, icon, qty_decimals, price_decimals, sort, status } = req.body;
  const data = {
    coin_name,
    symbol,
    icon,
    qty_decimals: Number(qty_decimals) || 2,
    price_decimals: Number(price_decimals) || 4,
    sort: Number(sort) || 0,
    status: Number(status),
  };
  if (id) await Coin.updateOne({ id: Number(id) }, { $set: data });
  else await Coin.create({ id: await nextId('coins'), ...data });
  res.redirect('/admin/coins');
});

router.post('/coins/:id/delete', async (req, res) => {
  await Coin.deleteOne({ id: Number(req.params.id) });
  res.redirect('/admin/coins');
});

// ---------- Notices ----------
router.get('/notices', async (_req, res) => {
  const notices = await Notice.find().sort({ createdAt: -1 });
  res.render('admin/notices', { title: 'Notices', active: 'notices', notices });
});

router.post('/notices', async (req, res) => {
  const { id, titles, contents, status } = req.body;
  if (id) await Notice.updateOne({ id: Number(id) }, { $set: { titles, contents, status: Number(status) } });
  else await Notice.create({ id: await nextId('notices'), user_id: 0, titles, contents, status: Number(status) });
  res.redirect('/admin/notices');
});

router.post('/notices/:id/delete', async (req, res) => {
  await Notice.deleteOne({ id: Number(req.params.id) });
  res.redirect('/admin/notices');
});

// ---------- Settings ----------
router.get('/settings', async (_req, res) => {
  const settings = await Setting.find().sort({ name: 1 });
  res.render('admin/settings', { title: 'Settings', active: 'settings', settings });
});

router.post('/settings', async (req, res) => {
  const { name, value } = req.body;
  if (name) await Setting.updateOne({ name }, { $set: { value } }, { upsert: true });
  res.redirect('/admin/settings');
});

router.post('/settings/:name/delete', async (req, res) => {
  await Setting.deleteOne({ name: req.params.name });
  res.redirect('/admin/settings');
});

// ---------- Users (read-only listing) ----------
router.get('/users', async (_req, res) => {
  const users = await User.find().sort({ createdAt: -1 }).limit(200);
  res.render('admin/users', { title: 'Users', active: 'users', users });
});

module.exports = router;
