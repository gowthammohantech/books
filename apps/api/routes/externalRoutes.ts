// External-integration routes — currently only whatsappcrm consumes these.
import { Router } from 'express';

import { ssoExchange, upsertCustomer } from '../controllers/externalController';
import apiKeyAuth from '../middleware/apiKeyAuth';

const router = Router();

// Public — token in body is the auth; verified by HMAC against the shared secret.
router.post('/sso/exchange', ssoExchange);

// Server-to-server — bearer-token gated.
router.post('/customers', apiKeyAuth, upsertCustomer);

export default router;
