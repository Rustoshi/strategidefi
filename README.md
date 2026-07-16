# StrategiDeFi — Express + MongoDB + EJS (Vercel-ready)

Full-stack app built around the cloned StrategiDeFi mobile dApp:

- **Frontend** — the original Vue/uni-app SPA, served as static files from `public/`.
- **API** — Express REST endpoints under `/api/*`, backed by **MongoDB via Mongoose**,
  reproducing the response contract the SPA expects (`{ status_code, data, message }`).
- **Admin** — an **EJS** dashboard at `/admin` to manage the dynamic content the SPA
  loads (banners, coins, notices, settings) plus a read-only user list.
- **Deploy** — structured for **Vercel** (single serverless function serves API, admin,
  and the SPA).

---

## Quick start (local, no database needed)

```bash
npm install
npm run dev
```

`npm run dev` starts an **in-memory MongoDB** (no external DB required), auto-seeds demo
data, and serves everything at:

- Homepage (public):  http://localhost:5173/           ← server-rendered EJS marketing page
- App (Vue SPA):      http://localhost:5173/app         ← hash-routed trading app
- Admin:              http://localhost:5173/admin  → `admin@strategidefi.com` / `admin12345`

### Routing

| Path | Serves |
|---|---|
| `/` | Public marketing homepage (`views/home.ejs`) |
| `/app`, `/app#/...` | The Vue SPA (one shell, hash-routed client pages) |
| `/api/*` | JSON API (Mongoose) |
| `/admin*` | EJS admin panel |
| `/static`, `/assets`, `/upload` | Static assets (shared by SPA + homepage) |
| anything else | 302 → `/` |

The homepage's "Get started" / "Sign in" CTAs deep-link into the app
(`/app#/pages/login/register` and `/app#/pages/login/login`).

To run against a **real** database instead, set `MONGODB_URI` (see `.env.example`) and use
`npm start`. Seed a real database once with `npm run seed`.

---

## Project structure

```
api/index.js            Vercel serverless entry (exports the Express app)
vercel.json             Vercel routing: /api, /admin, static, SPA fallback
server’s code:
src/
  app.js                Express app (EJS views, static, route mounting, DB gate)
  db.js                 Mongoose connection with global caching (serverless-safe)
  loadEnv.js            dependency-free .env loader (local only)
  models/               User, Coin, Banner, Notice, Setting, Counter (+ WithdrawAddress)
  middleware/           auth.js (JWT for SPA), adminAuth.js (cookie session for EJS)
  routes/
    api/                auth.js, common.js, credit.js, index.js (+ 404 envelope)
    admin.js            EJS admin CRUD
  utils/                response.js (envelope helpers), time.js (timestamp shapes)
views/admin/            EJS templates (login, dashboard, banners, coins, notices, settings, users)
scripts/                dev-server.js (in-memory Mongo), start.js, seed.js
public/                 the Vue SPA (index.html, static/, assets/, upload/)
.backups/               original un-patched JS + old static server
```

---

## API endpoints (implemented)

| Method + path | Backing | Notes |
|---|---|---|
| `POST /api/common/index` | Mongo | banners + latest notice + coin seed |
| `POST /api/common/coinlist` | Mongo | supported coins |
| `POST /api/common/getsetting` | Mongo | settings key/value map |
| `POST /api/common/noticelist` | Mongo | per-user notices (auth) |
| `POST /api/common/appversion` | — | version stub |
| `POST /api/auth/register` · `login` · `userinfo` · `logout` | Mongo + JWT | `Authorization: Bearer <token>` |
| `POST /api/auth/loginvirtual` · `walletsignlogin` | Mongo + JWT | demo / wallet login |
| `POST /api/auth/captcha` · `sendemail` · `resetpassword` | — | scaffold |
| `POST /api/credit/*withdrawaddress` | Mongo | address book (real) |
| `POST /api/credit/recharge` · `withdraw` · `transfer` | — | **stubs — no funds move** |

Any other `/api/*` path returns a well-formed `404` envelope instead of HTML, so the SPA
degrades gracefully. The SPA was repointed to call the API **same-origin**
(`window.location.origin`) — see `public/static/js/index.fa9137f8.js`.

> **Financial flows are scaffolding only.** Deposit / withdraw / trading endpoints return
> placeholder responses and perform no real settlement, on-chain movement, or balance
> mutation. Implement real logic behind your own custody and compliance before using with
> actual funds.

---

## Deploy to Vercel

1. Push this folder to a Git repo and import it in Vercel.
2. Set environment variables (Project → Settings → Environment Variables):
   - `MONGODB_URI` — a MongoDB Atlas connection string.
   - `JWT_SECRET`, `ADMIN_SESSION_SECRET` — long random strings.
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` — bootstrap admin (for the seed step).
   - `ASSET_BASE_URL` — host serving `/upload/images/...` (defaults to the working host).
3. Deploy. `vercel.json` routes `/api/*` and `/admin*` to the Express function, serves
   static files from `public/`, and falls back to the SPA shell for other paths.
4. Seed the Atlas database once (locally, with the same `MONGODB_URI`): `npm run seed`.

### Note on WebSockets
The SPA opens a `wss://` socket for live prices. Vercel serverless functions don't hold
persistent socket connections — the SPA handles socket errors gracefully (the UI still
renders), but for live prices run a separate WebSocket service (e.g. Railway/Render/Fly)
and point `socketUrl` at it.

---

## Banner image note (carried over from the clone)

The original backend returned banner image URLs on a dead template host
(`api.ethchainer.com`). A small shim in `public/index.html` rewrites those to a working
host at load time. In this app the banners are seeded pointing at a working host directly,
and both slide images are also mirrored under `public/upload/images/`. Manage banners in
the admin panel (`/admin/banners`).
