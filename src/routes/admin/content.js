// Content management: banners, coins, notices. (Behaviour unchanged from the original admin;
// moved here so the panel is organised by area.)
const express = require('express');
const router = express.Router();

const Banner = require('../../models/Banner');
const Coin = require('../../models/Coin');
const Notice = require('../../models/Notice');
const { nextId } = require('../../models/Counter');

// ---------- Banners ----------
router.get('/banners', async (_req, res) => {
  const banners = await Banner.find().sort({ sort: -1, createdAt: -1 });
  res.render('admin/banners', { title: 'Banners', active: 'banners', banners });
});

router.post('/banners', async (req, res) => {
  const { id, name, image, redirect_url, sort, status } = req.body;
  const data = { name, image, redirect_url: redirect_url || null, sort: Number(sort) || 0, status: Number(status) };
  if (id) await Banner.updateOne({ id: Number(id) }, { $set: data });
  else await Banner.create({ id: await nextId('banners'), ...data });
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
    coin_name, symbol, icon,
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

module.exports = router;
