// One message in a user <-> support conversation. A "conversation" is simply every message
// sharing a user_id — support only ever talks to one user at a time.
const { mongoose } = require('../db');

const schema = new mongoose.Schema(
  {
    id: { type: Number, index: true, unique: true },
    user_id: { type: Number, index: true }, // whose conversation this belongs to
    sender: { type: String, enum: ['user', 'admin'], default: 'user' },
    body: { type: String, default: '' },
    admin_read: { type: Boolean, default: false }, // has support seen this user message?
    user_read: { type: Boolean, default: false }, // has the user seen this admin reply?
    admin_id: { type: Number, default: 0 }, // which admin replied
  },
  { timestamps: true }
);

schema.index({ user_id: 1, createdAt: 1 });

schema.methods.toApi = function toApi() {
  return {
    id: this.id,
    sender: this.sender,
    body: this.body,
    mine: this.sender === 'user',
    created_at: new Date(this.createdAt || Date.now()).toISOString(),
    create_time: Math.floor(new Date(this.createdAt || Date.now()).getTime() / 1000),
  };
};

module.exports = mongoose.models.SupportMessage || mongoose.model('SupportMessage', schema);
