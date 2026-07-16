// The original PHP/Laravel backend exposed both a string `created_at`/`updated_at`
// ("YYYY-MM-DD HH:MM:SS") and a unix-seconds `create_time`. These helpers reproduce
// that shape from a JS Date so the SPA's date handling keeps working.
function fmt(d) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

function unix(d) {
  return Math.floor(d.getTime() / 1000);
}

module.exports = { fmt, unix };
