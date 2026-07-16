// A withdrawal request submitted from the Withdraw page. The amount is debited from the
// (simulated) balance and the request is recorded as PENDING for an admin to approve or
// reject; rejecting refunds the amount. No real funds move — this is a paper-trading app.
const { mongoose } = require('../db');

const schema = new mongoose.Schema(
  {
    id: { type: Number, index: true, unique: true },
    order_no: { type: String, index: true },
    user_id: { type: Number, index: true },
    coin_type: { type: String, default: '' }, // e.g. "USDT(ERC20)"
    coin_name: { type: String, default: 'USDT' },
    address: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    fee: { type: Number, default: 0 },
    receive_amount: { type: Number, default: 0 }, // amount - fee
    status: { type: Number, default: 0 }, // 0 pending, 1 approved, 2 rejected
    remark: { type: String, default: '' },
  },
  { timestamps: true }
);

schema.methods.toApi = function toApi() {
  return {
    id: this.id,
    order_no: this.order_no,
    coin_type: this.coin_type,
    coin_name: this.coin_name,
    address: this.address,
    amount: Number((this.amount || 0).toFixed(8)),
    fee: Number((this.fee || 0).toFixed(8)),
    receive_amount: Number((this.receive_amount || 0).toFixed(8)),
    status: this.status,
    status_text: this.status === 1 ? 'Approved' : this.status === 2 ? 'Rejected' : 'Pending',
    remark: this.remark,
    create_time: Math.floor(new Date(this.createdAt || Date.now()).getTime() / 1000),
  };
};

module.exports = mongoose.models.WithdrawOrder || mongoose.model('WithdrawOrder', schema);
