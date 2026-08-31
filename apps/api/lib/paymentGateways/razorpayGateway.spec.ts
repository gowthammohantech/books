import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';

import { razorpayGateway } from './razorpayGateway';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = 'test-webhook-secret-abc123';

/** Compute the expected Razorpay HMAC-SHA256 signature for a raw body. */
function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

const VALID_BODY = JSON.stringify({
  event: 'payment.captured',
  payload: {
    payment: {
      entity: { id: 'pay_ABCDEF123456', order_id: 'order_XYZ789' },
    },
  },
});

const VALID_CONFIG = {
  keyId: 'rzp_test_key',
  keySecret: 'rzp_test_secret',
  webhookSecret: SECRET,
};

const VALID_HEADERS = { 'x-razorpay-signature': sign(VALID_BODY) };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('razorpayGateway.verifyWebhook', () => {
  it('accepts a valid signature and returns a WebhookEvent', () => {
    const result = razorpayGateway.verifyWebhook(VALID_HEADERS, VALID_BODY, VALID_CONFIG);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('payment.captured');
    expect(result!.paymentId).toBe('pay_ABCDEF123456');
    expect(result!.orderId).toBe('order_XYZ789');
  });

  it('rejects a tampered body (signature mismatch)', () => {
    const tamperedBody = VALID_BODY.replace('payment.captured', 'payment.failed');
    // signature was computed over the original body, so it no longer matches
    const result = razorpayGateway.verifyWebhook(VALID_HEADERS, tamperedBody, VALID_CONFIG);

    expect(result).toBeNull();
  });

  it('rejects when the wrong webhook secret is used', () => {
    const wrongSecretConfig = { ...VALID_CONFIG, webhookSecret: 'completely-wrong-secret' };
    const result = razorpayGateway.verifyWebhook(VALID_HEADERS, VALID_BODY, wrongSecretConfig);

    expect(result).toBeNull();
  });

  it('rejects when the signature header is missing', () => {
    const result = razorpayGateway.verifyWebhook({}, VALID_BODY, VALID_CONFIG);

    expect(result).toBeNull();
  });

  it('rejects when no webhookSecret is configured', () => {
    const noSecretConfig = { keyId: 'rzp_test_key', keySecret: 'rzp_test_secret' };
    const result = razorpayGateway.verifyWebhook(VALID_HEADERS, VALID_BODY, noSecretConfig);

    expect(result).toBeNull();
  });
});
