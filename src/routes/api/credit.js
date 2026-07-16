// Financial flows — SCAFFOLD ONLY.
// These endpoints return well-formed placeholder responses so the SPA's screens render
// and navigate. They intentionally perform NO real money movement, on-chain settlement,
// order matching, or balance mutation. Implement real logic behind your own compliance
// and custody before using any of this for actual funds.
const express = require('express');
const router = express.Router();

const { mongoose } = require('../../db');
const { nextId } = require('../../models/Counter');
const Account = require('../../models/Account');
const Coin = require('../../models/Coin');
const AppSettings = require('../../models/AppSettings');
const { kefuLink } = require('../../utils/support');
const RechargeOrder = require('../../models/RechargeOrder');
const WithdrawOrder = require('../../models/WithdrawOrder');
const { price } = require('../../ws');
const { optionalAuth, requireAuth } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');

const r2 = (n) => Number((Number(n) || 0).toFixed(2));

// Minimal saved-withdrawal-address store (safe, non-custodial metadata only).
const withdrawAddressSchema =
  mongoose.models.WithdrawAddress ||
  mongoose.model(
    'WithdrawAddress',
    new mongoose.Schema(
      {
        id: { type: Number, index: true },
        user_id: { type: Number, index: true },
        chain: { type: String, default: 'TRC20' },
        coin: { type: String, default: 'USDT' },
        address: { type: String, required: true },
        remark: { type: String, default: '' },
      },
      { timestamps: true }
    )
  );

router.use(optionalAuth, requireAuth);

// POST /api/credit/usercredit -> the Assets page balances (simulated / paper).
// Shape matches the SPA: { userinfo, contract_balance, oct_balance, kefu_link,
// wallet_balance:[{coin_name, usable_balance, freeze_balance}] }. Funds Account = the
// per-coin wallet_balance; Contract Account = contract_balance; Fiat Account = oct_balance.
router.post('/usercredit', async (req, res) => {
  const acc = await Account.forUser(req.user.id);
  const coins = await Coin.find({ status: 1 }).sort({ sort: -1 });
  const holdings = acc.holdings || {};

  const wallet_balance = [{ coin_name: 'USDT', usable_balance: r2(acc.funds), freeze_balance: r2(acc.funds_freeze) }];
  let holdingsValue = 0;
  coins.forEach((c) => {
    const sym = (c.symbol || '').toUpperCase();
    if (sym === 'USDT') return;
    const amt = Number(holdings[sym] || 0);
    holdingsValue += amt * (price(sym) || 0);
    wallet_balance.push({ coin_name: sym, usable_balance: amt, freeze_balance: 0 });
  });

  // Capital that has LEFT a balance but is still the user's: margin posted on open contract
  // positions (plus its unrealised PnL), staked principal, and escrowed option stakes.
  // Without these the "Total Asset Equivalent" drops the moment you open a position, as if
  // opening a trade destroyed money.
  const ContractOrder = require('../../models/ContractOrder');
  const StakingPosition = require('../../models/StakingPosition');
  const OptionOrder = require('../../models/OptionOrder');

  const openPositions = await ContractOrder.find({ user_id: req.user.id, status: 1 });
  const openMargin = openPositions.reduce((s, o) => s + (o.margin || 0), 0);
  const openPnl = openPositions.reduce((s, o) => s + o.pnlAt(price(o.coin_name)), 0);
  const stakedPrincipal = (await StakingPosition.find({ user_id: req.user.id, status: 0 }))
    .reduce((s, p) => s + (p.amount || 0), 0);
  const openOptionStakes = (await OptionOrder.find({ user_id: req.user.id, status: 0 }))
    .reduce((s, o) => s + (o.bet_amount || 0), 0);

  const total = r2(
    acc.funds + acc.funds_freeze +
    acc.contract + acc.contract_freeze +
    acc.fiat + acc.fiat_freeze +
    holdingsValue + openMargin + openPnl + stakedPrincipal + openOptionStakes
  );
  const info = req.user.toApi();
  info.USD = total; // "Total Asset Equivalent" binds to userinfo.USD
  info.usbalance = r2(acc.funds);
  info.total = total;
  info.usable_balance = r2(acc.funds);
  info.balance = r2(acc.funds);

  return ok(res, {
    userinfo: info,
    total,
    // The Contract and Fiat tabs are v-fors (`_l(contract_balance)` / `_l(oct_balance)`) over
    // rows of {coin_name, usable_balance, freeze_balance} — same shape as wallet_balance.
    // Returning a bare number here renders an empty tab (or N junk rows for a number N).
    // Freeze = margin currently posted on open positions, so the tab shows where it went.
    contract_balance: [{ coin_name: 'USDT', usable_balance: r2(acc.contract), freeze_balance: r2(acc.contract_freeze + openMargin) }],
    oct_balance: [{ coin_name: 'USDT', usable_balance: r2(acc.fiat), freeze_balance: r2(acc.fiat_freeze) }],
    kefu_link: await kefuLink(),
    wallet_balance,
  });
});

// Balance transaction history (stakes, principal returns, admin-credited earnings).
router.post('/creditlog', async (req, res) => {
  const CreditLog = require('../../models/CreditLog');
  const body = req.body || {};
  const q = { user_id: req.user.id };
  if (body.type) q.type = String(body.type);
  const rows = await CreditLog.find(q).sort({ createdAt: -1 }).limit(100);
  return ok(res, { list: { data: rows.map((r) => r.toApi()), current_page: 1, last_page: 1, total: rows.length }, total: rows.length });
});

// --- Withdrawal address book (real, Mongo-backed) ---
router.post('/getwithdrawaddress', async (req, res) => {
  const list = await withdrawAddressSchema.find({ user_id: req.user.id }).sort({ createdAt: -1 });
  return ok(res, {
    list: list.map((a) => ({
      id: a.id,
      chain: a.chain,
      coin: a.coin,
      address: a.address,
      remark: a.remark,
    })),
  });
});

router.post('/bindwithdrawaddress', async (req, res) => {
  const { address, chain, coin, remark } = req.body || {};
  if (!address) return fail(res, 400, 'Address required');
  const doc = await withdrawAddressSchema.create({
    id: await nextId('withdraw_addresses'),
    user_id: req.user.id,
    address,
    chain: chain || 'TRC20',
    coin: coin || 'USDT',
    remark: remark || '',
  });
  return ok(res, { id: doc.id });
});

router.post('/editwithdrawaddress', async (req, res) => {
  const { id, address, chain, coin, remark } = req.body || {};
  await withdrawAddressSchema.updateOne(
    { id: Number(id), user_id: req.user.id },
    { $set: { address, chain, coin, remark } }
  );
  return ok(res, {});
});

router.post('/delwithdrawaddress', async (req, res) => {
  const { id } = req.body || {};
  await withdrawAddressSchema.deleteOne({ id: Number(id), user_id: req.user.id });
  return ok(res, {});
});

// --- Deposit page (rechargeinfo + recharge) ---
// Wallet addresses & bank details are read from the admin-configurable AppSettings store
// (keys `deposit_currencies` and `bank_deposit`). Defaults are PLACEHOLDER / burn addresses
// so no real funds can be collected until an admin sets real ones. Submitting a deposit only
// records a PENDING request for admin review — it never credits the (simulated) balance.
const REMARK =
  '· Minimum recharge amount will not be credited if below the minimum and cannot be refunded. ' +
  '· This address is your latest recharge address. When the system receives a recharge, it will be credited to your account automatically.';

// Placeholder / well-known burn addresses — valid format (so the QR renders) but not real
// deposit targets. Replace these per-currency in AppSettings via the admin panel.
// `coin_type` is the chip label the page renders; `coin_name` is the settlement coin.
const DEFAULT_DEPOSIT_CURRENCIES = [
  { name: 'USDT(ERC20)', coin_type: 'USDT(ERC20)', coin_name: 'USDT', recharge_address: '0x000000000000000000000000000000000000dEaD', min_recharge: 10, price_decimals: 2, recharge_remark: REMARK },
  { name: 'USDT(TRC20)', coin_type: 'USDT(TRC20)', coin_name: 'USDT', recharge_address: 'TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', min_recharge: 10, price_decimals: 2, recharge_remark: REMARK },
  { name: 'BTC', coin_type: 'BTC', coin_name: 'BTC', recharge_address: '1BitcoinEaterAddressDontSendf59kuE', min_recharge: 0.001, price_decimals: 8, recharge_remark: REMARK },
  { name: 'ETH', coin_type: 'ETH', coin_name: 'ETH', recharge_address: '0x000000000000000000000000000000000000dEaD', min_recharge: 0.01, price_decimals: 6, recharge_remark: REMARK },
];

const DEFAULT_BANK_DEPOSIT = {
  bank_name: 'Please contact customer service to ask for bank account deposit methods.',
  name: 'Please contact customer service to ask for bank account deposit methods.',
  bank_card: '',
  zhuanshukuai: '',
  bank_recharge_fee_rate: 0,
  recharge_remark: REMARK,
};

router.post('/rechargeinfo', async (req, res) => {
  const currencies = await AppSettings.getOrSeed('deposit_currencies', DEFAULT_DEPOSIT_CURRENCIES);
  const bank = await AppSettings.getOrSeed('bank_deposit', DEFAULT_BANK_DEPOSIT);

  // Attach a live USDT conversion rate so the page's "≈ amount USDT" preview is accurate.
  const recharge_withdraw_config = (currencies || []).map((c) => {
    const coin = String(c.coin_name || 'USDT').toUpperCase();
    const rate = coin === 'USDT' ? 1 : Number(price(coin)) || 0;
    // Derive `coin_type` (chip label) when an admin-set row omits it, so chips never render blank.
    return { USDT_rate: rate, price_decimals: c.price_decimals != null ? c.price_decimals : 2, coin_type: c.coin_type || c.name || coin, ...c };
  });

  const rows = await RechargeOrder.find({ user_id: req.user.id }).sort({ createdAt: -1 }).limit(50);
  const recharge_log = {
    data: rows.map((o) => ({
      order_no: o.order_no,
      coin_name: o.coin_name,
      channel: o.channel,
      amount: o.amount,
      status: o.status,
      status_text: o.status === 1 ? 'Approved' : o.status === 2 ? 'Rejected' : 'Pending',
      create_time: Math.floor(new Date(o.createdAt || Date.now()).getTime() / 1000),
    })),
    total: rows.length,
  };

  return ok(res, { recharge_withdraw_config, bank_recharge_config: bank, recharge_log });
});

// Submit a deposit request. Records a PENDING order (no balance is credited) and returns the
// order handle the page needs to navigate to the "finish" screen.
router.post('/recharge', async (req, res) => {
  const body = req.body || {};
  const order_no = 'R' + Date.now() + Math.floor(1000 + (Date.now() % 9000));
  const order = await RechargeOrder.create({
    id: await nextId('recharge_orders'),
    order_no,
    user_id: req.user.id,
    method: /bank/i.test(String(body.type || body.method || '')) ? 'bank' : 'crypto',
    coin_name: String(body.coin_name || 'USDT').toUpperCase(),
    channel: body.name || body.channel || '',
    address: body.recharge_address || body.address || '',
    amount: Number(body.amount || body.recharge_amount) || 0,
    voucher: body.recharge_image || body.voucher || body.image || '',
    status: 0,
  });
  return ok(res, {
    rechargeOrder: { order_no: order.order_no, create_time: Math.floor(Date.now() / 1000) },
    note: 'Deposit request received and pending review. No balance is credited automatically.',
  });
});

// --- Withdraw page (withdrawinfo + withdraw) ---
// Channels/limits come from the admin-configurable AppSettings key `withdraw_currencies`;
// the fee rate from `withdraw_commission_rate`. Submitting debits the (simulated) balance and
// records a PENDING WithdrawOrder for admin review — rejecting it refunds the amount.
const WITHDRAW_REMARK =
  '*Please ensure that the address and information are correct before transferring! ' +
  'Once transferred, it cannot be revoked!';

const DEFAULT_WITHDRAW_CURRENCIES = [
  { coin_type: 'USDT(ERC20)', coin_name: 'USDT', min_withdraw: 50, recharge_remark: WITHDRAW_REMARK },
  { coin_type: 'USDT(TRC20)', coin_name: 'USDT', min_withdraw: 50, recharge_remark: WITHDRAW_REMARK },
  { coin_type: 'BTC', coin_name: 'BTC', min_withdraw: 0.001, recharge_remark: WITHDRAW_REMARK },
  { coin_type: 'ETH', coin_name: 'ETH', min_withdraw: 0.01, recharge_remark: WITHDRAW_REMARK },
];

// Usable balance for a coin: USDT is the cash balance, everything else is a spot holding.
function usableBalance(acc, coin) {
  const sym = String(coin || 'USDT').toUpperCase();
  if (sym === 'USDT') return r2(acc.funds);
  return Number(((acc.holdings || {})[sym] || 0));
}

router.post('/withdrawinfo', async (req, res) => {
  const currencies = await AppSettings.getOrSeed('withdraw_currencies', DEFAULT_WITHDRAW_CURRENCIES);
  const rate = await AppSettings.getOrSeed('withdraw_commission_rate', 0);
  const acc = await Account.forUser(req.user.id);

  const recharge_withdraw_config = (currencies || []).map((c) => ({
    ...c,
    coin_type: c.coin_type || c.name || c.coin_name,
    usable_balance: usableBalance(acc, c.coin_name),
  }));

  const rows = await WithdrawOrder.find({ user_id: req.user.id }).sort({ createdAt: -1 }).limit(50);
  return ok(res, {
    recharge_withdraw_config,
    withdraw_commission_rate: Number(rate) || 0,
    withdraw_log: { data: rows.map((o) => o.toApi()), current_page: 1, last_page: 1, total: rows.length },
  });
});

// Submit a withdrawal: { coin_type, amount, withdraw_address, trade_password }.
router.post('/withdraw', async (req, res) => {
  const body = req.body || {};
  const currencies = await AppSettings.getOrSeed('withdraw_currencies', DEFAULT_WITHDRAW_CURRENCIES);
  const cfg = (currencies || []).find((c) => (c.coin_type || c.name) === body.coin_type) || currencies[0];
  if (!cfg) return fail(res, 400, 'Unknown withdrawal channel');

  const address = String(body.withdraw_address || '').trim();
  if (!address) return fail(res, 400, 'Please enter a withdrawal address');

  // Withdrawal password: per-user value set by an admin, else the global AppSettings one.
  const globalPw = await AppSettings.getOrSeed('withdraw_password', '');
  const expected = req.user.withdraw_password || globalPw;
  if (!expected) return fail(res, 400, 'Withdrawal password is not set yet. Please contact support.');
  if (String(body.trade_password || '') !== String(expected)) return fail(res, 400, 'Incorrect withdrawal password');

  const amount = Number(body.amount) || 0;
  if (!(amount > 0)) return fail(res, 400, 'Please enter a valid quantity');
  if (amount < Number(cfg.min_withdraw || 0)) return fail(res, 400, `Minimum withdrawal amount is ${cfg.min_withdraw} ${cfg.coin_name}`);

  const acc = await Account.forUser(req.user.id);
  const coin = String(cfg.coin_name || 'USDT').toUpperCase();
  if (usableBalance(acc, coin) < amount) return fail(res, 400, 'Insufficient balance');

  const rate = Number(await AppSettings.getOrSeed('withdraw_commission_rate', 0)) || 0;
  const fee = Number((amount * rate).toFixed(8));

  // Debit now; an admin approves (keeps it) or rejects (refunds).
  if (coin === 'USDT') acc.funds = r2(acc.funds - amount);
  else {
    acc.holdings = acc.holdings || {};
    acc.holdings[coin] = Number(((acc.holdings[coin] || 0) - amount).toFixed(8));
    acc.markModified('holdings');
  }
  await acc.save();

  const order = await WithdrawOrder.create({
    id: await nextId('withdraw_orders'),
    order_no: 'W' + Date.now(),
    user_id: req.user.id,
    coin_type: cfg.coin_type || cfg.name,
    coin_name: coin,
    address,
    amount,
    fee,
    receive_amount: Number((amount - fee).toFixed(8)),
    status: 0,
  });

  const CreditLog = require('../../models/CreditLog');
  await CreditLog.create({
    id: await nextId('credit_logs'),
    user_id: req.user.id,
    type: 'withdraw',
    amount: -amount,
    balance_after: coin === 'USDT' ? r2(acc.funds) : 0,
    coin_name: coin,
    remark: `Withdrawal requested — ${order.coin_type}`,
    ref_id: order.id,
  });

  return ok(res, { order_no: order.order_no, status: 'pending' }, 'Withdrawal submitted and pending review');
});

// --- Transfer between the three sub-accounts (real movement of the simulated balance) ---
// Account ids match the Assets page's zhanghuDetail?type=N: 1 Funds, 2 Contract, 3 Fiat.
const ACCOUNTS = [
  { id: 1, name: 'Funds Account', field: 'funds', freeze: 'funds_freeze' },
  { id: 2, name: 'Contract Account', field: 'contract', freeze: 'contract_freeze' },
  { id: 3, name: 'Fiat Account', field: 'fiat', freeze: 'fiat_freeze' },
];
const accountById = (id) => ACCOUNTS.find((a) => String(a.id) === String(id));

// Picker data: account_type[] needs {id, name, balance}; coin_type[] needs {coin_type, balance}.
router.post('/transferinfo', async (req, res) => {
  const acc = await Account.forUser(req.user.id);
  return ok(res, {
    account_type: ACCOUNTS.map((a) => ({ id: a.id, name: a.name, balance: r2(acc[a.field]) })),
    coin_type: [{ coin_type: 'USDT', coin_name: 'USDT', balance: r2(acc.funds) }],
  });
});

// { from_account_type, to_account_type, amount, coin_type }
router.post('/transfer', async (req, res) => {
  const body = req.body || {};
  const from = accountById(body.from_account_type);
  const to = accountById(body.to_account_type);
  if (!from || !to) return fail(res, 400, 'Unknown account');
  if (from.id === to.id) return fail(res, 400, 'Choose two different accounts');

  const coin = String(body.coin_type || 'USDT').toUpperCase();
  if (coin !== 'USDT') return fail(res, 400, 'Only USDT can be transferred between accounts');

  const amount = r2(body.amount);
  if (!(amount > 0)) return fail(res, 400, 'Enter a valid amount');

  const acc = await Account.forUser(req.user.id);
  if (r2(acc[from.field]) < amount) return fail(res, 400, `Insufficient ${from.name} balance`);

  acc[from.field] = r2(acc[from.field] - amount);
  acc[to.field] = r2(acc[to.field] + amount);
  await acc.save();

  const CreditLog = require('../../models/CreditLog');
  await CreditLog.create({
    id: await nextId('credit_logs'),
    user_id: req.user.id,
    type: 'transfer',
    amount,
    balance_after: r2(acc.funds),
    coin_name: coin,
    remark: `Transfer ${from.name} -> ${to.name}`,
  });

  return ok(res, { from: from.name, to: to.name, amount }, 'Transfer complete');
});

module.exports = router;
