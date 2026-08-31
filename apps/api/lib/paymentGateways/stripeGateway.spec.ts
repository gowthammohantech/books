/**
 * Stripe webhook verification tests.
 *
 * stripe.webhooks.constructEvent validates a time-based HMAC signature locally
 * (no network call). stripe.webhooks.generateTestHeaderString produces a
 * correctly-signed header for a given payload + secret, so both the accept
 * and reject paths can be exercised without any external calls.
 */
import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { stripeGateway } from './stripeGateway';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A minimal Stripe secret key format is required by the SDK client constructor.
const STRIPE_SECRET_KEY = 'sk_test_aaaabbbbccccddddeeeeffffgggghhhh';
const WEBHOOK_SECRET = 'whsec_testsecret1234567890abcdef';

const RAW_BODY = JSON.stringify({
  id: 'evt_test_001',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_001', payment_intent: 'pi_test_001' } },
});

/** Build a valid Stripe-Signature header for the given payload using the SDK helper. */
function buildSignedHeader(body: string, secret: string): string {
  // generateTestHeaderString is part of the stripe package's webhooks module.
  const stripe = new Stripe(STRIPE_SECRET_KEY);
  return stripe.webhooks.generateTestHeaderString({ payload: body, secret });
}

const VALID_CONFIG = {
  secretKey: STRIPE_SECRET_KEY,
  webhookSecret: WEBHOOK_SECRET,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stripeGateway.verifyWebhook', () => {
  it('accepts a valid signed webhook and returns a WebhookEvent', () => {
    const sig = buildSignedHeader(RAW_BODY, WEBHOOK_SECRET);
    const result = stripeGateway.verifyWebhook(
      { 'stripe-signature': sig },
      RAW_BODY,
      VALID_CONFIG,
    );

    expect(result).not.toBeNull();
    expect(result!.type).toBe('checkout.session.completed');
  });

  it('rejects a webhook with a tampered signature', () => {
    // Use a signature generated with a different secret.
    const wrongSig = buildSignedHeader(RAW_BODY, 'whsec_wrongsecretxxxxxxxxxxxxxxxx');
    const result = stripeGateway.verifyWebhook(
      { 'stripe-signature': wrongSig },
      RAW_BODY,
      VALID_CONFIG,
    );

    expect(result).toBeNull();
  });
});
