// A deposit (recharge) request the user submitted from the Deposit page. Recorded as
// PENDING for an admin to review — it does NOT credit the (simulated) balance automatically.
// No real funds move; this is a paper-trading app.
const { mongoose } = require('../db');

const schema = new mongoose.Schema(
  {
    id: { type: Number, index: true, unique: true },
    order_no: { type: String, index: true },
    user_id: { type: Number, index: true },
    method: { type: String, default: 'crypto' }, // 'crypto' | 'bank'
    coin_name: { type: String, default: 'USDT' },
    channel: { type: String, default: '' }, // e.g. "USDT(ERC20)"
    address: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    voucher: { type: String, default: '' }, // uploaded payment-proof image URL
    status: { type: Number, default: 0 }, // 0 pending, 1 approved, 2 rejected
  },
  { timestamps: true }
);

module.exports = mongoose.models.RechargeOrder || mongoose.model('RechargeOrder', schema);
