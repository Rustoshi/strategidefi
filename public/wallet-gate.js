/*
 * StrategiDeFi — wallet gate.
 * Shown ONLY after the user is authenticated (a token is present): if no wallet is
 * linked yet, a "Please visit wallet" modal blocks the dashboard until a self-custody
 * wallet is connected. The auth guard sends unauthenticated visitors to the login page,
 * so this modal never appears before login. No transactions are signed and no funds move
 * — it only reads the wallet address (eth_requestAccounts) and links it via
 * /api/auth/bindwallet. It also removes the (unusable) email-verification field from signup.
 */
(function () {
  'use strict';

  var css =
    '#sdf-gate,#sdf-gate *{box-sizing:border-box}' +
    '#sdf-gate{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;' +
    'padding:22px;background:rgba(0,0,0,.5);font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
    '#sdf-gate .card{width:100%;max-width:360px;background:#ECECEC;border-radius:18px;padding:30px 26px 26px;' +
    'text-align:center;box-shadow:0 30px 70px -20px rgba(0,0,0,.5)}' +
    '#sdf-gate h2{margin:0 0 14px;font-size:20px;font-weight:600;color:#2b2b2b;letter-spacing:.01em}' +
    '#sdf-gate p{margin:0 auto;font-size:14px;line-height:1.5;color:#8a8a8a;max-width:30ch}' +
    '#sdf-gate .wgrid{display:grid;grid-template-columns:1fr 1fr;gap:18px 16px;margin:26px 0 4px;text-align:left}' +
    '#sdf-gate .wopt{display:flex;align-items:center;gap:10px;cursor:pointer;color:#8a8a8a;font-size:12px;' +
    'font-weight:700;letter-spacing:.02em;background:none;border:0;padding:2px;font-family:inherit;text-align:left}' +
    '#sdf-gate .wopt:hover{color:#444}' +
    '#sdf-gate .wopt img{width:30px;height:30px;border-radius:6px;flex:0 0 auto}' +
    '#sdf-gate .status{min-height:18px;margin-top:16px;font-size:12.5px;color:#8a8a8a}' +
    '#sdf-gate .status.err{color:#c0392b}' +
    '#sdf-gate .foot{margin-top:14px;font-size:12px}' +
    '#sdf-gate .foot .link{color:#9a9a9a;cursor:pointer;text-decoration:none}' +
    '#sdf-gate .foot .link:hover{color:#555;text-decoration:underline}';

  var style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  var IMG = '/static/images/';
  var overlay = document.createElement('div');
  overlay.id = 'sdf-gate';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML =
    '<div class="card">' +
      '<h2>Please visit wallet</h2>' +
      '<p>You are currently visiting a decentralized website, please run in the wallet application</p>' +
      '<div class="wgrid">' +
        '<button class="wopt" data-wallet="metamask"><img src="' + IMG + 'metamask.png" alt="" />METAMASK</button>' +
        '<button class="wopt" data-wallet="cryptocom"><img src="' + IMG + 'crypto.png" alt="" />crypto.com</button>' +
        '<button class="wopt" data-wallet="tokenpocket"><img src="' + IMG + 'tokenpockt.png" alt="" />TOKEN POCKET</button>' +
      '</div>' +
      '<div class="status" id="sdf-status"></div>' +
      '<div class="foot"><span class="link" data-act="logout">Use a different account</span></div>' +
    '</div>';

  function mount() {
    if (!document.body) return setTimeout(mount, 30);
    if (!document.getElementById('sdf-gate')) document.body.appendChild(overlay);
  }
  mount();

  function status(msg, isErr) {
    var s = document.getElementById('sdf-status');
    if (s) { s.textContent = msg || ''; s.className = 'status' + (isErr ? ' err' : ''); }
  }
  var shown = false;
  function show() { overlay.style.display = 'flex'; shown = true; }
  function hide() { overlay.style.display = 'none'; shown = false; status(''); }

  function isMobile() { return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent); }
  // The real provider is captured & hidden from the page by the shell gate; use it directly.
  function provider() { return (window.__sdfWallet && window.__sdfWallet.eth) || null; }
  function hasWallet() { return !!provider(); }

  // Read the JWT the SPA cached under "token" (uni-app wraps it as {key,value,...}).
  function getToken() {
    try {
      var raw = localStorage.getItem('token');
      if (raw) { var o = JSON.parse(raw); if (o && o.value) return o.value; if (typeof o === 'string' && o) return o; }
    } catch (e) {}
    for (var i = 0; i < localStorage.length; i++) {
      try { var v = JSON.parse(localStorage.getItem(localStorage.key(i))); if (v && v.key === 'token' && v.value) return v.value; } catch (e) {}
    }
    return '';
  }

  function api(path, token, bodyObj) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(bodyObj || {}),
    }).then(function (r) { return r.json(); });
  }

  var checkedToken = null, connected = false, busy = false;

  // --- Route guard: dashboard is for authenticated users only; bounce others to login.
  function isPublicRoute() {
    return /#\/pages\/login\/(login|register|forget)/.test(location.href) || /#\/pages\/index\/webView/.test(location.href);
  }
  function authGuard() {
    var token = getToken();
    if (!token && !isPublicRoute() && location.pathname.indexOf('/app') === 0) {
      if (shown) hide();
      location.replace('/app#/pages/login/login');
      return false;
    }
    return true;
  }
  window.addEventListener('hashchange', authGuard);

  function clearToken() {
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i), v = JSON.parse(localStorage.getItem(k) || 'null');
        if (v && (v.key === 'token' || v.key === 'userInfo')) localStorage.removeItem(k);
      }
      localStorage.removeItem('token');
    } catch (e) {}
  }

  function poll() {
    if (!authGuard()) return;
    var token = getToken();
    if (!token) { checkedToken = null; connected = false; if (shown) hide(); return; }
    if (token !== checkedToken) {
      checkedToken = token; connected = false;
      api('/api/auth/userinfo', token).then(function (j) {
        if (token !== getToken()) return;
        var info = j && j.data && (j.data.userinfo || j.data.userInfo);
        var authed = info && !Array.isArray(info) && (info.id || info.email);
        if (!authed) {
          // Stale/invalid token (e.g. user not in this database) — treat as logged out:
          // never show the wallet modal for an unauthenticated session; send to login.
          clearToken(); connected = false; checkedToken = null; if (shown) hide();
          if (!isPublicRoute() && location.pathname.indexOf('/app') === 0) location.replace('/app#/pages/login/login');
          return;
        }
        if (info.wallet_connected) { connected = true; hide(); } else show();
      }).catch(function () { /* network error: don't pop the modal */ });
      return;
    }
    if (connected) { if (shown) hide(); return; }
    if (!shown) show();
  }

  // Wallet chosen from the picker.
  function onWallet(key) {
    if (busy) return;
    var eth = provider();
    if (eth) {
      busy = true; status('Connecting…');
      // User-initiated: call the captured real provider directly (this is the only path
      // that ever prompts the wallet, so nothing fires automatically on page load).
      eth.request({ method: 'eth_requestAccounts' }).then(function (accts) {
        var addr = (accts && accts[0] || '').toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(addr)) throw new Error('No wallet account was shared.');
        return api('/api/auth/bindwallet', getToken(), { address: addr }).then(function (j) {
          if (j && j.status_code === 200) { connected = true; hide(); }
          else status((j && j.message) || 'Could not link wallet.', true);
        });
      }).catch(function (e) {
        if (e && (e.code === 4001 || /reject/i.test(e.message || ''))) status('Connection request was rejected.', true);
        else status((e && e.message) || 'Connection failed.', true);
      }).then(function () { busy = false; });
      return;
    }
    // No injected wallet: send the user to the wallet app / install page.
    var target = location.host + location.pathname + location.hash;
    var links = {
      metamask: isMobile() ? 'https://metamask.app.link/dapp/' + target : 'https://metamask.io/download/',
      cryptocom: 'https://crypto.com/defi-wallet',
      tokenpocket: 'https://www.tokenpocket.pro/en/download/app',
    };
    status('Open this site inside your wallet app’s browser to connect.');
    if (key === 'metamask' && isMobile()) location.href = links.metamask;
    else window.open(links[key] || links.metamask, '_blank', 'noopener');
  }

  overlay.addEventListener('click', function (e) {
    var w = e.target.closest && e.target.closest('[data-wallet]');
    if (w) { onWallet(w.getAttribute('data-wallet')); return; }
    var a = e.target.closest && e.target.closest('[data-act]');
    if (a && a.getAttribute('data-act') === 'logout') {
      try { for (var i = localStorage.length - 1; i >= 0; i--) { var k = localStorage.key(i); var v = JSON.parse(localStorage.getItem(k) || 'null'); if (v && (v.key === 'token' || v.key === 'userInfo')) localStorage.removeItem(k); } localStorage.removeItem('token'); } catch (e2) {}
      connected = false; checkedToken = null; hide(); location.href = '/app#/pages/login/login';
    }
  });

  // --- Signup: remove email verification. The register form's "Verification Code" field
  // can't be satisfied (no email is sent), so auto-fill it with a throwaway value (the
  // backend ignores the code) and hide the field + its label so signup only needs email +
  // password.
  function enhanceRegister() {
    if (!/#\/pages\/login\/register/.test(location.href)) return;
    var inputs = document.querySelectorAll('uni-input');
    for (var i = 0; i < inputs.length; i++) {
      var ui = inputs[i], ph = ui.querySelector('.uni-input-placeholder');
      if (!ph || !/verification code/i.test(ph.textContent || '')) continue;
      var input = ui.querySelector('input');
      if (input && input.value === '') {
        var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        d.set.call(input, '000000');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      var row = ui.closest('.form_box') || ui.parentElement;
      if (row) {
        row.style.display = 'none';
        var prev = row.previousElementSibling;
        if (prev && /verification/i.test(prev.textContent || '')) prev.style.display = 'none';
      }
    }

    // The signup form ships two tabs: account registration (the first, currentTab=2) and
    // email registration (the second, currentTab=1 — the default). Only email signup exists
    // in the API, and the English locale renders the account tab's label as "EmailRegister",
    // so it reads as a confusing duplicate of "Email Registration". Hide the first tab.
    var tabs = document.querySelectorAll('.form_tab .tab_item');
    if (tabs.length > 1 && tabs[0].style.display !== 'none') tabs[0].style.display = 'none';
  }
  var enhTimer = null;
  var mo2 = new MutationObserver(function () {
    if (enhTimer) return;
    enhTimer = setTimeout(function () { enhTimer = null; enhanceRegister(); }, 60);
  });
  function startObserver() { if (document.body) mo2.observe(document.body, { childList: true, subtree: true }); else setTimeout(startObserver, 40); }
  startObserver();
  window.addEventListener('hashchange', enhanceRegister);

  // --- Coin chart: the SPA's k-line component points its iframe at a self-hosted
  // TradingView charting_library (/static/TV/…) that isn't part of this clone, so the
  // iframe 302s to "/" and the homepage banner shows inside the chart box. Replace it with
  // TradingView's hosted Advanced-Chart embed for the pair's symbol so a real, live chart
  // renders. Data is TradingView's (Binance <coin>USDT) — fine for a paper-trading demo.
  var TV = (function () {
    var curInterval = '1', curSymbol = null;
    var TF = { '1min': '1', '5min': '5', '15min': '15', '30min': '30', '60min': '60', 'daily': 'D' };
    // Coin/Spot (bibiDetail), Options (stocksDetail) and Contract (heyueDetail) all use the
    // same broken native chart component — replace the chart on every one of them.
    function onDetail() { return /#\/pages\/(index\/bibiDetail|qiquan\/stocksDetail|index\/heyueDetail)/.test(location.href); }

    function qparam(name) { var m = new RegExp('[?&]' + name + '=([^&]+)').exec(location.hash || ''); return m ? decodeURIComponent(m[1]) : null; }

    // Per-page-type symbol maps: id -> full TradingView symbol. Spot/Contract read the coin
    // pairs (getcointradelist); Options read the option products (optionlist), which include
    // gold/forex/stocks with their correct exchange symbols (e.g. OANDA:XAUUSD).
    var maps = {}, mapPromises = {};
    function mapKind() { return /qiquan\/stocksDetail/.test(location.href) ? 'option' : 'spot'; }
    function loadMap(kind) {
      if (maps[kind]) return Promise.resolve(maps[kind]);
      if (mapPromises[kind]) return mapPromises[kind];
      var url = kind === 'option' ? '/api/option/optionlist' : '/api/coincoin/getcointradelist';
      mapPromises[kind] = api(url, getToken(), {}).then(function (j) {
        var m = {}, list = (j && j.data && j.data.list) || [];
        list.forEach(function (it) {
          var id = String(it.pair_id != null ? it.pair_id : it.id);
          m[id] = it.tv_symbol || tvFromName(it.pair_name || it.coin_name);
        });
        maps[kind] = m; return m;
      }).catch(function () { maps[kind] = {}; return maps[kind]; });
      return mapPromises[kind];
    }

    // Crypto-only fallback: turn "BTC/USDT" / "BTC" into a Binance symbol.
    function tvFromName(name) {
      if (!name) return null;
      var s = String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/USDT$/, '').replace(/USD$/, '');
      return s ? 'BINANCE:' + s + 'USDT' : null;
    }

    // Resolve the current product's TradingView symbol from the backend (authoritative).
    // Never guesses a default coin — an unknown market shows no chart rather than the wrong one.
    function resolveSymbol() {
      var id = qparam('id') || qparam('pair_id');
      if (id) return loadMap(mapKind()).then(function (m) { return m[String(id)] || tvFromName(qparam('coin_name') || qparam('symbol')); });
      return Promise.resolve(tvFromName(qparam('coin_name') || qparam('symbol')));
    }

    function buildSrc(sym) {
      return 'https://www.tradingview.com/widgetembed/?frameElementId=sdf-tv' +
        '&symbol=' + encodeURIComponent(sym) + '&interval=' + curInterval +
        '&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=282c38&theme=dark&style=1' +
        '&timezone=Asia%2FShanghai&withdateranges=0&hideideas=1&locale=en';
    }

    function updateTV() { var f = document.getElementById('sdf-tv'); if (f && curSymbol) f.src = buildSrc(curSymbol); }

    function ensure() {
      if (!onDetail()) { if (curSymbol) curSymbol = null; return; }
      var box = document.getElementById('tv_chart_container');
      if (!box) return;
      resolveSymbol().then(function (sym) {
        if (!onDetail()) return;
        // always hide the broken native chart iframe(s)
        [].slice.call(box.querySelectorAll('iframe')).forEach(function (fr) { if (fr.id !== 'sdf-tv') fr.style.display = 'none'; });
        if (!sym) return; // unknown market — don't show a misleading chart
        var existing = document.getElementById('sdf-tv');
        if (existing && curSymbol === sym) return;
        curSymbol = sym;
        if (!existing) {
          existing = document.createElement('iframe');
          existing.id = 'sdf-tv';
          existing.setAttribute('frameborder', '0');
          existing.setAttribute('allowfullscreen', 'true');
          existing.style.cssText = 'width:100%;height:100%;min-height:' + (box.clientHeight || 360) + 'px;border:0;display:block;background:#131722';
          box.appendChild(existing);
        }
        existing.src = buildSrc(sym);
      });
    }

    // Native timeframe tabs (1min/5min/…) drive the chart interval.
    document.addEventListener('click', function (e) {
      if (!onDetail()) return;
      var el = e.target;
      for (var i = 0; i < 4 && el; i++) {
        var t = (el.textContent || '').trim();
        if (TF[t] != null) { if (curInterval !== TF[t]) { curInterval = TF[t]; updateTV(); } return; }
        el = el.parentElement;
      }
    }, true);

    return { ensure: ensure };
  })();

  // --- Client-side Cloudinary upload. The app uploads images (deposit payment voucher, KYC,
  // avatar) via uni.uploadFile -> /api/auth/upload and reads the URL back from
  // response.data.file. We wrap uni.uploadFile so the file goes straight from the browser to
  // Cloudinary using an UNSIGNED upload preset (no bytes touch our server), then hand the
  // Cloudinary secure_url back in the shape the app expects.
  var Upload = (function () {
    var cfg = null, cfgPromise = null;
    function loadCfg() {
      if (cfg) return Promise.resolve(cfg);
      if (cfgPromise) return cfgPromise;
      cfgPromise = fetch('/api/common/uploadconfig', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.json(); })
        .then(function (j) { cfg = (j && j.data) || {}; return cfg; })
        .catch(function () { cfg = {}; return cfg; });
      return cfgPromise;
    }

    function toCloudinary(opts) {
      loadCfg().then(function (c) {
        if (!c || !c.cloud_name || !c.upload_preset) {
          // Not configured — fall back to the app's original upload so nothing silently breaks.
          if (origUpload) return origUpload.call(window.uni, opts);
          if (opts.fail) opts.fail({ errMsg: 'upload: Cloudinary not configured' });
          try { window.uni.hideLoading(); } catch (e) {}
          return;
        }
        var endpoint = 'https://api.cloudinary.com/v1_1/' + c.cloud_name + '/image/upload';
        // opts.filePath is a blob: URL in H5 — fetch it back into a Blob to forward.
        fetch(opts.filePath).then(function (r) { return r.blob(); }).then(function (blob) {
          var fd = new FormData();
          fd.append('file', blob);
          fd.append('upload_preset', c.upload_preset);
          if (c.folder) fd.append('folder', c.folder);
          return fetch(endpoint, { method: 'POST', body: fd });
        }).then(function (r) { return r.json(); }).then(function (j) {
          var url = j && (j.secure_url || j.url);
          if (url) {
            // The app does JSON.parse(res.data) then reads .data.file
            if (opts.success) opts.success({ statusCode: 200, data: JSON.stringify({ status_code: 200, data: { file: url, url: url } }) });
          } else if (opts.fail) { opts.fail(j); }
        }).catch(function (e) { if (opts.fail) opts.fail(e); })
          .then(function () { try { window.uni.hideLoading(); } catch (e) {} if (opts.complete) opts.complete(); });
      });
    }

    var origUpload = null;
    function wrap() {
      if (!window.uni || window.uni.__sdfUploadWrapped) return;
      if (typeof window.uni.uploadFile !== 'function') return;
      origUpload = window.uni.uploadFile.bind(window.uni);
      window.uni.uploadFile = function (opts) {
        opts = opts || {};
        if (opts.url && /\/api\/auth\/upload/.test(opts.url) && opts.filePath) { toCloudinary(opts); return; }
        return origUpload(opts);
      };
      window.uni.__sdfUploadWrapped = true;
    }
    return { wrap: wrap };
  })();

  // --- Contract order book. The app builds its own book client-side: every row is
  // `entrust_price ± Math.random()` (see randPrice), so asks and bids are unsorted, overlap
  // each other, and the whole ladder is redrawn every 1s — it reads as noise, not a market.
  // Replace the generator with a proper ladder around the mark price: a real spread, prices
  // stepping away from the mid on both sides, depth growing outward, and slow, partial
  // updates so it moves like a book instead of flickering.
  var Book = (function () {
    var LEVELS = 6;         // the app renders 6 rows per side
    var REFRESH_MS = 3000;  // the app ticks every 1s; only actually move the book this often
    var lastAt = 0, mid = 0, patched = null;

    function tickSize(p) {
      if (p >= 10000) return 0.1;
      if (p >= 100) return 0.01;
      if (p >= 1) return 0.001;
      return 0.0001;
    }
    // Depth: thin near the touch, heavier further out — roughly how real books look.
    function depthAt(level) {
      var base = 200 + level * level * 900;
      return Math.round(base * (0.6 + Math.random() * 0.8));
    }

    // Build both sides around `m`. sellList renders top->bottom as highest->best ask, so the
    // best ask sits next to the mid; buyList runs best bid -> lowest, mirroring it.
    function build(vm, m) {
      var dec = parseInt((vm.pair_info && vm.pair_info.price_decimals) || 2, 10);
      var step = tickSize(m);
      var half = step / 2; // half-spread: best ask = mid + half, best bid = mid - half
      var asks = [], bids = [];
      for (var i = LEVELS; i >= 1; i--) asks.push({ cr: (m + half + (i - 1) * step).toFixed(dec), cc: depthAt(i) });
      for (var j = 1; j <= LEVELS; j++) bids.push({ cr: (m - half - (j - 1) * step).toFixed(dec), cc: depthAt(j) });
      vm.sellList = asks;
      vm.buyList = bids;
    }

    // Nudge a couple of rows' sizes between rebuilds so it breathes without flickering.
    function jitter(vm) {
      [vm.sellList, vm.buyList].forEach(function (side) {
        if (!side || !side.length) return;
        var k = Math.floor(Math.random() * side.length);
        if (side[k]) side[k].cc = Math.max(1, Math.round(side[k].cc * (0.85 + Math.random() * 0.3)));
      });
    }

    function patch(vm) {
      if (!vm || patched === vm) return;
      // Take over the book generator; the app's own 1s timer will call this instead.
      vm.getTopRightList = function () {
        var m = Number((vm.cfg && vm.cfg.current_price) || vm.entrust_price) || mid;
        if (!m) return;
        var now = Date.now();
        if (!mid || Math.abs(m - mid) / m > 0.002) { mid = m; build(vm, mid); lastAt = now; return; }
        if (now - lastAt < REFRESH_MS) { jitter(vm); return; }
        // drift the mid a touch so the ladder walks instead of teleporting
        mid = m + (Math.random() - 0.5) * tickSize(m) * 2;
        build(vm, mid);
        lastAt = now;
      };
      patched = vm;
      vm.getTopRightList();
    }

    function apply() {
      if (!/#\/pages\/index\/heyue(\?|$)/.test(location.href)) { patched = null; return; }
      try {
        var pages = getCurrentPages();
        var vm = pages[pages.length - 1] && pages[pages.length - 1].$vm;
        if (vm && vm.cfg && typeof vm.randPrice === 'function') patch(vm);
      } catch (e) {}
    }
    return { apply: apply };
  })();

  window.__sdfGate = { poll: poll, show: show, hide: hide, getToken: getToken, connect: onWallet, enhanceRegister: enhanceRegister, tv: TV.ensure, book: Book.apply };

  setInterval(function () { poll(); enhanceRegister(); TV.ensure(); Upload.wrap(); Book.apply(); }, 800);
  window.addEventListener('hashchange', TV.ensure);
  poll();
  enhanceRegister();
  TV.ensure();
  Upload.wrap();
})();
