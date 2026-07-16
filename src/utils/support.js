// Customer-service link used by the SPA's Service screen.
//
// The Service page builds its web-view URL as `kefu_link + "&user_id=" + id`, blindly. Two
// consequences we have to defend against:
//   1. An EMPTY kefu_link makes the URL "&user_id=3" — a relative URL, so the frame loads the
//      site root (i.e. the marketing homepage). That's the bug this replaces.
//   2. A link with no query string ("https://x.com/chat") becomes "https://x.com/chat&user_id=3",
//      which is malformed. So we guarantee a "?" is present.
// Default target is our own /support page, which always renders.
const AppSettings = require('../models/AppSettings');

const DEFAULT_KEFU_LINK = '/support?src=app';

function normalize(link) {
  const s = String(link || '').trim();
  if (!s) return DEFAULT_KEFU_LINK;
  // Ensure a query string exists so the appended "&user_id=" stays valid.
  return s.indexOf('?') === -1 ? `${s}?src=app` : s;
}

async function kefuLink() {
  try {
    return normalize(await AppSettings.getOrSeed('kefu_link', DEFAULT_KEFU_LINK));
  } catch (e) {
    return DEFAULT_KEFU_LINK;
  }
}

module.exports = { kefuLink, normalize, DEFAULT_KEFU_LINK };
