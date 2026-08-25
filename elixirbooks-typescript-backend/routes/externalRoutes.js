// External-integration routes — currently only whatsappcrm consumes these.
const express = require('express');
const router = express.Router();
const apiKeyAuth = require('../middleware/apiKeyAuth');
const externalController = require('../controllers/externalController');

// Public — token in body is the auth; verified by HMAC against the shared secret.
router.post('/sso/exchange', externalController.ssoExchange);

// Server-to-server — bearer-token gated.
router.post('/customers', apiKeyAuth, externalController.upsertCustomer);

module.exports = router;
