// Runtime settings. Everything here is stored in the AppSettings key/value store and read by
// the app at request time, so changes take effect without a redeploy.
const express = require('express');
const router = express.Router();

const AppSettings = require('../../models/AppSettings');
const Setting = require('../../models/Setting');

const flash = (base, msg) => `${base}?msg=${encodeURIComponent(msg)}`;

// Rebuild an array-of-objects from parallel form fields (name="addr[]" etc.).
function rows(body, keys) {
  const arr = (k) => { const v = body[k + '[]']; return v === undefined ? [] : (Array.isArray(v) ? v : [v]); };
  const first = arr(keys[0]);
  return first.map((_, i) => {
    const o = {};
    keys.forEach((k) => { o[k] = arr(k)[i]; });
    return o;
  });
}

// ---------- Deposit wallets ----------
router.get('/settings/deposit', async (req, res) => {
  const currencies = (await AppSettings.get('deposit_currencies', [])) || [];
  const bank = (await AppSettings.get('bank_deposit', {})) || {};
  res.render('admin/settings-deposit', {
    title: 'Deposit wallets', active: 'set-deposit', currencies, bank, flash: req.query.msg || null,
  });
});

router.post('/settings/deposit', async (req, res) => {
  const b = req.body || {};
  const list = rows(b, ['coin_type', 'coin_name', 'recharge_address', 'min_recharge', 'price_decimals', 'recharge_remark'])
    .filter((r) => String(r.coin_type || '').trim())
    .map((r) => ({
      coin_type: String(r.coin_type).trim(),
      name: String(r.coin_type).trim(),
      coin_name: String(r.coin_name || 'USDT').trim().toUpperCase(),
      recharge_address: String(r.recharge_address || '').trim(),
      min_recharge: Number(r.min_recharge) || 0,
      price_decimals: Number(r.price_decimals) || 2,
      recharge_remark: String(r.recharge_remark || ''),
    }));
  await AppSettings.set('deposit_currencies', list);
  res.redirect(flash('/admin/settings/deposit', 'Deposit wallets saved'));
});

router.post('/settings/deposit/bank', async (req, res) => {
  const b = req.body || {};
  await AppSettings.set('bank_deposit', {
    bank_name: String(b.bank_name || ''),
    name: String(b.name || ''),
    bank_card: String(b.bank_card || ''),
    zhuanshukuai: String(b.zhuanshukuai || ''),
    bank_recharge_fee_rate: Number(b.bank_recharge_fee_rate) || 0,
    recharge_remark: String(b.recharge_remark || ''),
  });
  res.redirect(flash('/admin/settings/deposit', 'Bank details saved'));
});

// ---------- Withdrawals ----------
router.get('/settings/withdraw', async (req, res) => {
  const currencies = (await AppSettings.get('withdraw_currencies', [])) || [];
  const rate = await AppSettings.get('withdraw_commission_rate', 0);
  const password = await AppSettings.get('withdraw_password', '');
  res.render('admin/settings-withdraw', {
    title: 'Withdrawals', active: 'set-withdraw', currencies, rate, password, flash: req.query.msg || null,
  });
});

router.post('/settings/withdraw', async (req, res) => {
  const b = req.body || {};
  const list = rows(b, ['coin_type', 'coin_name', 'min_withdraw', 'recharge_remark'])
    .filter((r) => String(r.coin_type || '').trim())
    .map((r) => ({
      coin_type: String(r.coin_type).trim(),
      coin_name: String(r.coin_name || 'USDT').trim().toUpperCase(),
      min_withdraw: Number(r.min_withdraw) || 0,
      recharge_remark: String(r.recharge_remark || ''),
    }));
  await AppSettings.set('withdraw_currencies', list);
  await AppSettings.set('withdraw_commission_rate', Number(b.rate) || 0);
  res.redirect(flash('/admin/settings/withdraw', 'Withdrawal settings saved'));
});

// Global withdrawal password — used when a user has no per-user one set.
router.post('/settings/withdraw/password', async (req, res) => {
  await AppSettings.set('withdraw_password', String((req.body || {}).password || '').trim());
  res.redirect(flash('/admin/settings/withdraw', 'Global withdrawal password saved'));
});

// ---------- Loan ----------
router.get('/settings/loan', async (req, res) => {
  res.render('admin/settings-loan', {
    title: 'Loan', active: 'set-loan',
    quota: await AppSettings.get('loan_total_quota', 0),
    flash: req.query.msg || null,
  });
});

router.post('/settings/loan', async (req, res) => {
  await AppSettings.set('loan_total_quota', Math.max(0, Number((req.body || {}).quota) || 0));
  res.redirect(flash('/admin/settings/loan', 'Default credit limit saved'));
});

// ---------- Support ----------
router.get('/settings/support', async (req, res) => {
  const contacts = (await AppSettings.get('support_contacts', {})) || {};
  res.render('admin/settings-support', {
    title: 'Support', active: 'set-support',
    kefu_link: await AppSettings.get('kefu_link', ''),
    cfg: contacts,
    contacts: Array.isArray(contacts.contacts) ? contacts.contacts : [],
    flash: req.query.msg || null,
  });
});

router.post('/settings/support', async (req, res) => {
  const b = req.body || {};
  await AppSettings.set('kefu_link', String(b.kefu_link || '').trim());
  const list = rows(b, ['icon', 'label', 'value', 'href'])
    .filter((r) => String(r.label || '').trim())
    .map((r) => ({
      icon: String(r.icon || '•'),
      label: String(r.label).trim(),
      value: String(r.value || '').trim(),
      href: String(r.href || '').trim(),
    }));
  await AppSettings.set('support_contacts', {
    hours: String(b.hours || ''),
    note: String(b.note || ''),
    contacts: list,
  });
  res.redirect(flash('/admin/settings/support', 'Support settings saved'));
});

// ---------- Uploads (Cloudinary) ----------
router.get('/settings/upload', async (req, res) => {
  const cfg = (await AppSettings.get('cloudinary', {})) || {};
  res.render('admin/settings-upload', {
    title: 'Uploads', active: 'set-upload',
    cfg,
    env: { cloud: process.env.CLOUDINARY_CLOUD_NAME || '', preset: process.env.CLOUDINARY_UPLOAD_PRESET || '' },
    flash: req.query.msg || null,
  });
});

router.post('/settings/upload', async (req, res) => {
  const b = req.body || {};
  await AppSettings.set('cloudinary', {
    cloud_name: String(b.cloud_name || '').trim(),
    upload_preset: String(b.upload_preset || '').trim(),
    folder: String(b.folder || '').trim(),
  });
  res.redirect(flash('/admin/settings/upload', 'Upload settings saved'));
});

// ---------- Site settings (raw key/value) ----------
router.get('/settings', async (_req, res) => {
  const settings = await Setting.find().sort({ name: 1 });
  res.render('admin/settings', { title: 'Site settings', active: 'settings', settings });
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

module.exports = router;
