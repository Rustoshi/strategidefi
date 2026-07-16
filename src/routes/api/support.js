// User-side support chat API.
//
// AUTH NOTE: the Service screen loads /support in a web-view and appends `&user_id=<id>` to
// the URL — that value is trivially spoofable, so it is NEVER trusted here. /support is
// served from the same origin as the SPA, so its page script reads the SPA's own JWT out of
// localStorage and sends it as a Bearer token; the conversation is keyed off THAT.
const express = require('express');
const router = express.Router();

const SupportMessage = require('../../models/SupportMessage');
const { nextId } = require('../../models/Counter');
const { optionalAuth, requireAuth } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');

const MAX_LEN = 2000;

router.use(optionalAuth, requireAuth);

// My conversation. Reading it marks support's replies as seen.
router.post('/messages', async (req, res) => {
  const since = Number((req.body || {}).since) || 0;
  const q = { user_id: req.user.id };
  if (since) q.id = { $gt: since };
  const rows = await SupportMessage.find(q).sort({ createdAt: 1 }).limit(200);

  await SupportMessage.updateMany({ user_id: req.user.id, sender: 'admin', user_read: false }, { $set: { user_read: true } });

  return ok(res, {
    list: rows.map((m) => m.toApi()),
    last_id: rows.length ? rows[rows.length - 1].id : since,
  });
});

// Send a message to support.
router.post('/send', async (req, res) => {
  const body = String((req.body || {}).body || '').trim();
  if (!body) return fail(res, 400, 'Type a message first');
  if (body.length > MAX_LEN) return fail(res, 400, `Message is too long (max ${MAX_LEN} characters)`);

  const msg = await SupportMessage.create({
    id: await nextId('support_messages'),
    user_id: req.user.id,
    sender: 'user',
    body,
    admin_read: false,
    user_read: true,
  });
  return ok(res, msg.toApi(), 'Sent');
});

// Unread replies (for a badge, if the app ever wants one).
router.post('/unread', async (req, res) => {
  const n = await SupportMessage.countDocuments({ user_id: req.user.id, sender: 'admin', user_read: false });
  return ok(res, { unread: n });
});

module.exports = router;
