// A loan movement against the user's credit quota.
//   debt_type 1 = borrow  (credited to the Funds Account, increases what's owed)
//   debt_type 2 = repay   (taken back out of the Funds Account, reduces what's owed)
// Outstanding = sum(borrow) - sum(repay). All amounts are simulated USDT.
const { mongoose } = require('../db');

const schema = new mongoose.Schema(
  {
    id: { type: Number, index: true, unique: true },
    user_id: { type: Number, index: true },
    debt_type: { type: Number, default: 1 },
    amount: { type: Number, default: 0 },
    remark: { type: String, default: '' },
  },
  { timestamps: true }
);

function fmt(d) {
  const t = new Date(d || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}

schema.methods.toApi = function toApi() {
  return {
    id: this.id,
    debt_type: this.debt_type, // 1 borrow / 2 repay — drives the row's icon + label
    amount: Number((this.amount || 0).toFixed(2)),
    remark: this.remark,
    created_at: fmt(this.createdAt),
    create_time: Math.floor(new Date(this.createdAt || Date.now()).getTime() / 1000),
  };
};

// Total still owed by a user.
schema.statics.outstandingFor = async function outstandingFor(userId) {
  const rows = await this.find({ user_id: userId });
  const owed = rows.reduce((s, r) => s + (r.debt_type === 1 ? r.amount : -r.amount), 0);
  return Number(Math.max(0, owed).toFixed(2));
};

module.exports = mongoose.models.Debt || mongoose.model('Debt', schema);
