// Support inbox: every user conversation, and the thread view where an admin replies.
const express = require('express');
const router = express.Router();

const User = require('../../models/User');
const SupportMessage = require('../../models/SupportMessage');
const { nextId } = require('../../models/Counter');

const PER_PAGE = 25;

// Conversation list, newest activity first, with unread counts.
router.get('/messages', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const onlyUnread = req.query.unread === '1';

  // Group every message by user: last message + unread count.
  const grouped = await SupportMessage.aggregate([
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: '$user_id',
        last_body: { $last: '$body' },
        last_sender: { $last: '$sender' },
        last_at: { $last: '$createdAt' },
        total: { $sum: 1 },
        unread: { $sum: { $cond: [{ $and: [{ $eq: ['$sender', 'user'] }, { $eq: ['$admin_read', false] }] }, 1, 0] } },
      },
    },
    ...(onlyUnread ? [{ $match: { unread: { $gt: 0 } } }] : []),
    { $sort: { last_at: -1 } },
  ]);

  const total = grouped.length;
  const slice = grouped.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const users = await User.find({ id: { $in: slice.map((g) => g._id) } });
  const byId = {};
  users.forEach((u) => { byId[u.id] = u; });

  res.render('admin/messages', {
    title: 'Messages', active: 'messages',
    rows: slice.map((g) => ({
      user_id: g._id,
      email: byId[g._id] ? byId[g._id].email : `#${g._id}`,
      last_body: g.last_body,
      last_sender: g.last_sender,
      last_at: g.last_at,
      total: g.total,
      unread: g.unread,
    })),
    onlyUnread,
    page, pages: Math.max(1, Math.ceil(total / PER_PAGE)), total,
    unreadTotal: grouped.reduce((s, g) => s + g.unread, 0),
  });
});

// A single conversation. Opening it marks the user's messages as read.
router.get('/messages/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  const user = await User.findOne({ id: userId });
  if (!user) return res.redirect('/admin/messages');

  const messages = await SupportMessage.find({ user_id: userId }).sort({ createdAt: 1 }).limit(500);
  await SupportMessage.updateMany({ user_id: userId, sender: 'user', admin_read: false }, { $set: { admin_read: true } });

  res.render('admin/message-thread', {
    title: `Chat · ${user.email}`, active: 'messages',
    user, messages: messages.map((m) => m.toApi()),
    flash: req.query.msg || null, err: req.query.err || null,
  });
});

// Reply to this user.
router.post('/messages/:userId/reply', async (req, res) => {
  const userId = Number(req.params.userId);
  const body = String((req.body || {}).body || '').trim();
  if (!body) return res.redirect(`/admin/messages/${userId}?err=` + encodeURIComponent('Type a message first'));
  const user = await User.findOne({ id: userId });
  if (!user) return res.redirect('/admin/messages?err=User+not+found');

  await SupportMessage.create({
    id: await nextId('support_messages'),
    user_id: userId,
    sender: 'admin',
    body: body.slice(0, 2000),
    admin_read: true,
    user_read: false,
    admin_id: req.admin ? req.admin.id : 0,
  });
  res.redirect(`/admin/messages/${userId}`);
});

module.exports = router;
