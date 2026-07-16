const { mongoose } = require('../db');
const { fmt, unix } = require('../utils/time');

const noticeSchema = new mongoose.Schema(
  {
    id: { type: Number, index: true, unique: true },
    user_id: { type: Number, default: 0 }, // 0 = global notice
    titles: { type: String, default: '' },
    contents: { type: String, default: '' },
    status: { type: Number, default: 0 },
    is_need_confirm: { type: Number, default: 0 },
    publish_at: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

noticeSchema.methods.toApi = function () {
  return {
    id: this.id,
    user_id: this.user_id,
    created_at: fmt(this.createdAt),
    updated_at: fmt(this.updatedAt),
    status: this.status,
    send_time: null,
    publish_at: fmt(this.publish_at || this.createdAt),
    is_read: 0,
    user_confirm: 0,
    is_need_confirm: this.is_need_confirm,
    titles: this.titles,
    contents: this.contents,
    create_time: unix(this.createdAt),
    update_time: unix(this.updatedAt),
  };
};

module.exports = mongoose.models.Notice || mongoose.model('Notice', noticeSchema);
