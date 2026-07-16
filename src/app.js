const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { connectDB } = require('./db');

const app = express();

// Views (EJS admin panel).
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Parsers.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Ensure a DB connection before any /api or /admin handler runs. Static asset requests
// skip this so the SPA shell still serves even if the DB is momentarily unavailable.
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/admin')) {
    try {
      await connectDB();
    } catch (e) {
      if (req.path.startsWith('/api')) {
        return res.json({ status_code: 503, data: [], message: 'Database unavailable: ' + e.message });
      }
      return res.status(503).send('Database unavailable: ' + e.message);
    }
  }
  next();
});

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// API + admin.
app.use('/api', require('./routes/api'));
app.use('/admin', require('./routes/admin'));

// Public marketing homepage (server-rendered EJS) at the root URL.
app.get('/', (_req, res) => res.render('home'));

// In-app support page. The SPA's Service screen embeds `kefu_link` in a web-view, so this is
// the default target — it always renders instead of leaving the frame blank (or, when
// kefu_link was empty, loading the homepage into it). Contacts are admin-configurable via the
// AppSettings key `support_contacts`; point `kefu_link` at an external desk to override.
app.get('/support', async (req, res) => {
  const AppSettings = require('./models/AppSettings');
  const DEFAULTS = {
    hours: 'Our team is available 24/7. We usually reply within a few minutes.',
    note: 'We will never ask for your password, seed phrase, or private keys. Support will never ask you to send funds.',
    contacts: [
      { icon: '✉️', label: 'Email', value: 'support@strategidefi.com', href: 'mailto:support@strategidefi.com' },
      { icon: '💬', label: 'Live chat', value: 'Not configured yet', href: '' },
    ],
  };
  let cfg = DEFAULTS;
  try {
    cfg = { ...DEFAULTS, ...((await AppSettings.getOrSeed('support_contacts', DEFAULTS)) || {}) };
  } catch (e) { /* DB down — still render the page rather than a blank frame */ }
  res.render('support', {
    hours: cfg.hours || DEFAULTS.hours,
    note: cfg.note || DEFAULTS.note,
    contacts: Array.isArray(cfg.contacts) && cfg.contacts.length ? cfg.contacts : DEFAULTS.contacts,
    userId: req.query.user_id || '',
  });
});

// Static assets: /static, /assets, /upload, favicon, etc. (index:false so it never
// auto-serves the SPA shell at "/").
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));

// The Vue SPA lives under /app (hash-routed, so one shell covers all its client routes).
app.get(['/app', '/app/*'], (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// Unknown non-API/admin paths fall back to the homepage.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/admin')) return next();
  res.redirect('/');
});

module.exports = app;
