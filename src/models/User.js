const { mongoose } = require('../db');
const bcrypt = require('bcryptjs');
const { fmt, unix } = require('../utils/time');

const userSchema = new mongoose.Schema(
  {
    id: { type: Number, index: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true }, // bcrypt hash
    nickname: { type: String, default: '' },
    invite_code: { type: String, default: '' },
    parent_invite_code: { type: String, default: '' },
    is_admin: { type: Boolean, default: false },

    // Balances / assets (scaffold; no real settlement).
    USD: { type: Number, default: 0 },
    wallet_address: { type: String, default: '' },
    wallet_connected: { type: Boolean, default: false },

    // KYC / status
    real_name: { type: String, default: '' },
    auth_status: { type: Number, default: 0 }, // 0 none, 1 pending, 2 verified

    status: { type: Number, default: 1 }, // 1 active
    // Withdrawal ("trade") password required to submit a withdrawal. Set by an admin per
    // user; falls back to the global AppSettings `withdraw_password` when unset.
    withdraw_password: { type: String, default: '' },
    // Loan credit limit (USDT). Set by an admin per user; falls back to the global
    // AppSettings `loan_total_quota` when null.
    loan_quota: { type: Number, default: null },
    last_login_at: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function (plain) {
  this.password = await bcrypt.hash(plain, 10);
};

userSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

// Safe public representation returned as `userInfo` to the SPA.
userSchema.methods.toApi = function () {
  return {
    id: this.id,
    email: this.email,
    nickname: this.nickname,
    invite_code: this.invite_code,
    USD: this.USD,
    wallet_address: this.wallet_address,
    wallet_connected: this.wallet_connected,
    real_name: this.real_name,
    auth_status: this.auth_status,
    status: this.status,
    created_at: fmt(this.createdAt),
    create_time: unix(this.createdAt),
  };
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
