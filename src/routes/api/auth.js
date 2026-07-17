const express = require('express');
const router = express.Router();

const User = require('../../models/User');
const Account = require('../../models/Account');
const { nextId } = require('../../models/Counter');
const { sign, optionalAuth, requireAuth } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');

function makeInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// The dashboard header renders `userInfo.USD` as its "Balance". `User.USD` is a stale DB
// column that nothing maintains (always 0), so fill it from the live Funds Account balance —
// that's the number the dashboard is meant to show.
// (The Assets page uses /api/credit/usercredit, which sets USD to the full Total Asset
// Equivalent instead — different screen, different meaning.)
async function withFunds(user) {
  const info = user.toApi();
  const acc = await Account.forUser(user.id);
  info.USD = Number((acc.funds || 0).toFixed(2));
  info.usbalance = info.USD;
  return info;
}

// Auth success payload. Includes both `userinfo` and `userInfo` because the SPA's
// cache layer reads one casing and other screens read the other.
async function authPayload(user) {
  const info = await withFunds(user);
  return { token: sign(user), userinfo: info, userInfo: info };
}

// POST /api/auth/captcha -> image/text captcha (scaffold: returns a trivial one)
router.post('/captcha', async (_req, res) => {
  const code = String(Math.floor(1000 + Math.random() * 9000));
  return ok(res, { key: 'dev', code, img: '' });
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, invite_code } = req.body || {};
    if (!email || !password) return fail(res, 400, 'Email and password are required');

    const exists = await User.findOne({ email: String(email).toLowerCase() });
    if (exists) return fail(res, 400, 'Account already exists');

    const user = new User({
      id: await nextId('users'),
      email: String(email).toLowerCase(),
      invite_code: makeInviteCode(),
      parent_invite_code: invite_code || '',
    });
    await user.setPassword(String(password));
    await user.save();
    await Account.forUser(user.id); // credit the starting (paper) balance

    return ok(res, await authPayload(user));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return fail(res, 400, 'Email and password are required');

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user || !(await user.verifyPassword(String(password)))) {
      return fail(res, 400, 'Incorrect account or password');
    }
    user.last_login_at = new Date();
    await user.save();

    return ok(res, await authPayload(user));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/auth/loginvirtual -> demo/virtual login. Creates or reuses a throwaway
// demo account so visitors can explore the app without registering.
router.post('/loginvirtual', async (req, res) => {
  try {
    const email = 'demo@strategidefi.local';
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({ id: await nextId('users'), email, nickname: 'Demo', invite_code: makeInviteCode() });
      await user.setPassword(Math.random().toString(36));
      await user.save();
    }
    return ok(res, await authPayload(user));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/auth/walletsignlogin -> wallet-signature login (scaffold: trusts address)
router.post('/walletsignlogin', async (req, res) => {
  try {
    const { address } = req.body || {};
    if (!address) return fail(res, 400, 'Wallet address required');

    const addr = String(address).toLowerCase();
    let user = await User.findOne({ wallet_address: addr });
    if (!user) {
      user = new User({
        id: await nextId('users'),
        email: `${addr}@wallet.local`,
        wallet_address: addr,
        invite_code: makeInviteCode(),
      });
      await user.setPassword(Math.random().toString(36));
      await user.save();
    }
    return ok(res, await authPayload(user));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/auth/userinfo -> current user.
// Matches the live contract: 200 with empty userinfo when anonymous (so the SPA stays
// on the public home page instead of treating it as an expired session and redirecting).
router.post('/userinfo', optionalAuth, async (req, res) => {
  // The dashboard calls this and renders userinfo.USD as its "Balance" — so it must carry
  // the live Funds Account balance, not User.USD (which nothing maintains).
  const info = req.user ? await withFunds(req.user) : [];
  return ok(res, { userinfo: info, userInfo: info });
});

// POST /api/auth/bindwallet -> link the connected (self-custody) wallet address to the
// account. Records the address returned by the browser wallet (eth_requestAccounts); no
// funds are moved and no transaction is signed here.
router.post('/bindwallet', optionalAuth, requireAuth, async (req, res) => {
  try {
    const address = String((req.body && req.body.address) || '').toLowerCase().trim();
    if (!/^0x[0-9a-f]{40}$/.test(address)) return fail(res, 400, 'A valid wallet address is required');
    req.user.wallet_address = address;
    req.user.wallet_connected = true;
    await req.user.save();
    return ok(res, { wallet_address: address, wallet_connected: true });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/auth/logout
router.post('/logout', async (_req, res) => ok(res, {}));

// POST /api/auth/sendemail -> email verification code (scaffold)
router.post('/sendemail', async (_req, res) => ok(res, { sent: true }));

// POST /api/auth/resetpassword (scaffold)
router.post('/resetpassword', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await User.findOne({ email: String(email || '').toLowerCase() });
    if (!user) return fail(res, 400, 'Account not found');
    await user.setPassword(String(password || Math.random().toString(36)));
    await user.save();
    return ok(res, {});
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

module.exports = router;
