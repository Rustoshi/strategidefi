// Matches the response envelope the SPA expects: { status_code, data, message }.
function ok(res, data = {}, message = 'success') {
  return res.json({ status_code: 200, data, message });
}

function fail(res, status_code = 400, message = 'error', data = []) {
  // The SPA reads status_code from the body (HTTP status stays 200 for its axios layer).
  return res.json({ status_code, data, message });
}

// 401 with the exact wording the original backend used (SPA checks status_code === 401
// to trigger logout / redirect to login).
function unauthorized(res, message = '您尚未登錄，請前往登錄') {
  return res.json({ status_code: 401, data: [], message });
}

module.exports = { ok, fail, unauthorized };
