// Bearer-token gate for server-to-server traffic from whatsappcrm. The key
// lives in WHATSAPPCRM_API_KEY — same value that whatsappcrm stores under
// its `kanakku_api_key` setting. Constant-time compare so length-based
// timing leaks don't reveal which characters matched.
const crypto = require('crypto');

const apiKeyAuth = (req, res, next) => {
  const expected = process.env.WHATSAPPCRM_API_KEY;
  if (!expected) {
    return res.status(503).json({
      success: false,
      message: 'External API not configured on this kanakku instance.',
    });
  }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Bearer token required.' });
  }

  const provided = auth.slice(7).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ success: false, message: 'Invalid API key.' });
  }

  next();
};

module.exports = apiKeyAuth;
