// Balance transaction ledger. Every movement of the (simulated) USDT balance writes one row
// here so the user and admin can see exactly what happened and why — including each yield
// payout an admin credits against a staking position.
const { mongoose } = require('../db');

const schema = new mongoose.Schema(
  {
    id: { type: Number, index: true, unique: true },
    user_id: { type: Number, index: true },
    // 'stake' (funds locked), 'unstake' (principal returned), 'yield' (admin-credited
    // earnings), 'withdraw' (withdrawal request debit), 'refund' (rejected withdrawal)
    type: { type: String, default: 'yield' },
    amount: { type: Number, default: 0 }, // signed: negative = debit
    balance_after: { type: Number, default: 0 },
    coin_name: { type: String, default: 'USDT' },
    remark: { type: String, default: '' },
    ref_id: { type: Number, default: 0 }, // related staking position, if any
  },
  { timestamps: true }
);

schema.methods.toApi = function toApi() {
  return {
    id: this.id,
    type: this.type,
    type_text: { yield: 'Earnings', stake: 'Stake', unstake: 'Unstake', withdraw: 'Withdrawal', refund: 'Refund', transfer: 'Transfer', loan: 'Loan', repay: 'Repayment' }[this.type] || this.type,
    amount: Number((this.amount || 0).toFixed(2)),
    balance: Number((this.balance_after || 0).toFixed(2)),
    coin_name: this.coin_name,
    remark: this.remark,
    create_time: Math.floor(new Date(this.createdAt || Date.now()).getTime() / 1000),
  };
};

module.exports = mongoose.models.CreditLog || mongoose.model('CreditLog', schema);
