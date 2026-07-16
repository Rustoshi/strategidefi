const express = require('express');
const router = express.Router();

const Banner = require('../../models/Banner');
const Coin = require('../../models/Coin');
const Notice = require('../../models/Notice');
const Setting = require('../../models/Setting');
const Account = require('../../models/Account');
const AppSettings = require('../../models/AppSettings');
const { kefuLink } = require('../../utils/support');
const { optionalAuth, requireAuth } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');
const { marketItem } = require('../../utils/market');

// Image-upload config for the client-side (unsigned) Cloudinary upload. cloud_name and the
// unsigned upload_preset are PUBLIC by design (that's how unsigned browser uploads work), so
// this endpoint needs no auth. Admin sets them in AppSettings key `cloudinary`.
router.all('/uploadconfig', async (_req, res) => {
  // Admin-set AppSettings win; otherwise fall back to env vars. (Env fallback matters because
  // an empty `cloudinary` row may have been seeded before the env vars were filled in.)
  const cfg = (await AppSettings.get('cloudinary', null)) || {};
  const cloud_name = cfg.cloud_name || process.env.CLOUDINARY_CLOUD_NAME || '';
  const upload_preset = cfg.upload_preset || process.env.CLOUDINARY_UPLOAD_PRESET || '';
  const folder = cfg.folder || 'strategidefi/deposits';
  return ok(res, { provider: cloud_name && upload_preset ? 'cloudinary' : 'none', cloud_name, upload_preset, folder });
});

// --- Loan / credit line (pages/index/jiekuan) --------------------------------------------
// Quota-limited borrowing of simulated USDT. Borrowing credits the Funds Account and records
// the debt; what's owed is tracked as outstanding. The credit limit is admin-configurable:
// per-user `User.loan_quota`, else the global AppSettings key `loan_total_quota`.
// No interest is charged — the page only presents a limit and an outstanding balance.
const Debt = require('../../models/Debt');
const { nextId } = require('../../models/Counter');
const r2c = (n) => Number((Number(n) || 0).toFixed(2));

async function quotaFor(user) {
  if (user.loan_quota != null) return Number(user.loan_quota) || 0;
  return Number(await AppSettings.getOrSeed('loan_total_quota', 0)) || 0;
}

router.post('/userdebtpage', optionalAuth, requireAuth, async (req, res) => {
  const page = Number((req.body || {}).page) || 1;
  const perPage = 20;
  const total_quota = r2c(await quotaFor(req.user));
  const wait_back_quota = await Debt.outstandingFor(req.user.id);
  const available_quota = r2c(Math.max(0, total_quota - wait_back_quota));

  const all = await Debt.find({ user_id: req.user.id }).sort({ createdAt: -1 });
  const data = all.slice((page - 1) * perPage, page * perPage).map((d) => d.toApi());
  return ok(res, {
    total_quota,
    available_quota,
    wait_back_quota,
    debt_list: { data, current_page: page, last_page: Math.max(1, Math.ceil(all.length / perPage)), total: all.length },
  });
});

// Borrow against the credit line: { amount } -> credited to the Funds Account.
router.post('/userdebt', optionalAuth, requireAuth, async (req, res) => {
  const amount = r2c((req.body || {}).amount);
  if (!(amount > 0)) return fail(res, 400, 'Enter a valid amount');

  const total_quota = r2c(await quotaFor(req.user));
  if (total_quota <= 0) return fail(res, 400, 'You have no credit limit yet. Please contact support.');
  const owed = await Debt.outstandingFor(req.user.id);
  const available = r2c(total_quota - owed);
  if (amount > available) return fail(res, 400, `Amount exceeds your available limit (${available} USDT)`);

  const acc = await Account.forUser(req.user.id);
  acc.funds = r2c(acc.funds + amount);
  await acc.save();

  await Debt.create({ id: await nextId('debts'), user_id: req.user.id, debt_type: 1, amount, remark: 'Loan drawn' });
  const CreditLog = require('../../models/CreditLog');
  await CreditLog.create({
    id: await nextId('credit_logs'),
    user_id: req.user.id,
    type: 'loan',
    amount,
    balance_after: r2c(acc.funds),
    remark: 'Loan credited to Funds Account',
  });
  return ok(res, { amount, outstanding: r2c(owed + amount) }, 'Loan credited to your Funds Account');
});

// Repay from the Funds Account: { amount }.
router.post('/userdebtrepay', optionalAuth, requireAuth, async (req, res) => {
  const amount = r2c((req.body || {}).amount);
  if (!(amount > 0)) return fail(res, 400, 'Enter a valid amount');
  const owed = await Debt.outstandingFor(req.user.id);
  if (owed <= 0) return fail(res, 400, 'You have nothing to repay');
  if (amount > owed) return fail(res, 400, `You only owe ${owed} USDT`);

  const acc = await Account.forUser(req.user.id);
  if (acc.funds < amount) return fail(res, 400, 'Insufficient Funds Account balance');
  acc.funds = r2c(acc.funds - amount);
  await acc.save();

  await Debt.create({ id: await nextId('debts'), user_id: req.user.id, debt_type: 2, amount, remark: 'Loan repaid' });
  const CreditLog = require('../../models/CreditLog');
  await CreditLog.create({
    id: await nextId('credit_logs'),
    user_id: req.user.id,
    type: 'repay',
    amount: -amount,
    balance_after: r2c(acc.funds),
    remark: 'Loan repayment',
  });
  return ok(res, { amount, outstanding: r2c(owed - amount) }, 'Repayment complete');
});

// POST /api/common/index -> home dashboard payload (banners, latest notice, markets)
router.post('/index', optionalAuth, async (req, res) => {
  try {
    const banners = await Banner.find({ status: 1 }).sort({ sort: -1, createdAt: -1 });
    const notice = await Notice.findOne({ user_id: 0 }).sort({ createdAt: -1 });
    const coins = await Coin.find({ status: 1 }).sort({ sort: -1 });

    // `messagedata` = the market rows + each coin's mini-chart data (`il` = price array,
    // `iz` = up/down color). The dashboard renders one sparkline chart per item.
    // USDT is the quote currency, not a tradable pair — exclude it from the market rows.
    const messagedata = coins.filter((c) => (c.symbol || '').toUpperCase() !== 'USDT').map((c) => marketItem(c));

    // Balance shown in the home header (Funds Account USDT), when logged in.
    let usbalance = 0;
    if (req.user) { const acc = await Account.forUser(req.user.id); usbalance = Number((acc.funds || 0).toFixed(2)); }

    return ok(res, {
      banner: banners.map((b) => b.toApi()),
      notice: notice ? notice.toApi() : null,
      messagedata,
      usbalance,
      // Customer-service URL (admin-configurable). The dashboard reads this for its support
      // link, and the Loan page's "Repayment" button routes to support rather than an API.
      kefu_link: await kefuLink(),
      is_login: req.user ? 1 : 0,
      is_read: true,
    });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/common/coinlist -> supported coins
router.post('/coinlist', async (_req, res) => {
  try {
    const coins = await Coin.find({ status: 1 }).sort({ sort: -1 });
    return ok(res, { list: coins.map((c) => c.toApi()) });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/common/getsetting -> site settings key/value map
router.post('/getsetting', async (_req, res) => {
  try {
    const settings = await Setting.asObject();
    return ok(res, settings);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/common/noticelist -> per-user notice list (auth required)
router.post('/noticelist', optionalAuth, requireAuth, async (req, res) => {
  try {
    const notices = await Notice.find({ $or: [{ user_id: 0 }, { user_id: req.user.id }] })
      .sort({ createdAt: -1 })
      .limit(50);
    return ok(res, { list: notices.map((n) => n.toApi()) });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/common/noticeread -> mark a notice read (scaffold: acknowledge)
router.post('/noticeread', optionalAuth, requireAuth, async (_req, res) => ok(res, {}));

// POST /api/common/appversion -> client version info
router.post('/appversion', async (_req, res) =>
  ok(res, { version: '1.0.0', force: 0, url: '', content: '' })
);

router.post('/appversionlog', async (_req, res) => ok(res, { list: [] }));

module.exports = router;
