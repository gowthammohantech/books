# Integrations

All third-party integrations in Kanakku follow a BYOK (Bring Your Own Key)
model — you supply your own API keys and credentials. Keys are never shipped
with the software and there are no required paid integrations to run the
application.

---

## SMTP / Email

Kanakku sends email for invoice delivery, payment reminders, quotations,
and user invitations. There are two ways to configure it.

### Option A — Environment variables (simple)

Set in `docker/.env` before starting the stack:

```env
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=you@yourcompany.com
SMTP_PASS=your-smtp-password
SMTP_FROM=Kanakku <billing@yourcompany.com>
```

These are runtime variables — restart the API after changing them:
`make rebuild-api`

### Option B — In-app Email Settings (recommended)

Go to **Settings → Email Settings**. The in-app configuration takes
precedence over the environment variables and supports three providers:

| Provider | Notes |
|---|---|
| SMTP | Any standard SMTP server |
| Node Mail | Secondary SMTP configuration (useful for a secondary account) |
| Resend | Configured via `smtp.resend.com` using your Resend API key |

Changes in the UI take effect immediately (the mailer cache clears on save,
no container restart needed).

You can send a test email from the Email Settings page to confirm the
configuration works before going live.

### Gmail App Password Example

Google Workspace and personal Gmail accounts require an App Password when
2-Step Verification is enabled.

1. Go to Google Account → Security → 2-Step Verification → App passwords.
2. Create a new app password (select "Mail" and "Other").
3. Use these settings in the Email Settings UI or `docker/.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=you@gmail.com
SMTP_PASS=xxxx-xxxx-xxxx-xxxx   # the 16-character app password
```

---

## Razorpay

Razorpay enables online invoice payment collection for Indian businesses.

### Setup

1. Log in to your [Razorpay Dashboard](https://dashboard.razorpay.com).
2. Go to **Settings → API Keys** and generate a key pair (Key ID + Key Secret).
3. In Kanakku, go to **Settings → Payment Gateways → Razorpay**.
4. Enter your Key ID, Key Secret, and (for webhook signature verification)
   your Webhook Secret.
5. Toggle **Enabled** and save.

### Webhook

Razorpay sends payment events to your Kanakku instance. The webhook endpoint
is:

```
https://your-domain.com/api/razorpay/webhook
```

In the Razorpay Dashboard under **Settings → Webhooks**, add this URL and copy
the generated webhook secret into the Kanakku Payment Gateway settings as
**Webhook Secret**. Kanakku verifies every inbound webhook using HMAC-SHA256
against this secret.

The webhook endpoint is public (no authentication header) but signature
verification is enforced — unsigned or tampered payloads are rejected with
HTTP 400.

### Keys stored

Your Razorpay Key ID, Key Secret, and Webhook Secret are stored in the
`GatewayConfig` database table. They are redacted in API responses by default
(only the first 4 and last 2 characters are returned) and never appear in logs.

---

## Stripe

Stripe enables online invoice payment collection for businesses in Stripe's
supported countries.

### Setup

1. Log in to your [Stripe Dashboard](https://dashboard.stripe.com).
2. Go to **Developers → API keys** and copy your Publishable key and Secret key.
3. In Kanakku, go to **Settings → Payment Gateways → Stripe**.
4. Enter your Secret key and Webhook Secret.
5. Toggle **Enabled** and save.

### Webhook

The Stripe webhook endpoint is:

```
https://your-domain.com/api/stripe/webhook
```

In the Stripe Dashboard under **Developers → Webhooks**, add this endpoint.
Copy the generated signing secret into Kanakku's Stripe settings as
**Webhook Secret**. Kanakku verifies inbound events using
`stripe.webhooks.constructEvent` — tampered payloads are rejected.

### Live mode vs test mode

The Razorpay and Stripe gateway settings include a **Live mode** toggle.
In test mode, use your test API keys from the respective dashboards. Switch
to live mode when you are ready to accept real payments, and replace the
keys with live keys.

---

## AI Features (BYOK)

Kanakku includes AI-powered document extraction (parse receipts and invoices)
and an AI chat assistant. These features require a provider API key.

### Providers

| Provider | Notes |
|---|---|
| Claude (Anthropic) | Recommended for document extraction |
| OpenAI | Alternative |
| Mock | Built-in. Used automatically when no key is configured or when the user selects it. Returns placeholder responses. |

### Configuration

**Option A — Server-level keys in `docker/.env`:**

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

These are runtime variables. Apply with `make rebuild-api`.

**Option B — Per-user BYOK in the UI (recommended):**

Each user can configure their own key under **Settings → AI Configuration**:
1. Select a provider (Claude or OpenAI).
2. Paste your API key.
3. Click **Test connection** to verify the key works.
4. Enable AI features with the toggle.

Keys entered in the UI are encrypted at rest using AES-256-GCM with the
`AI_ENCRYPTION_KEY` from your `docker/.env`. Only the last 4 characters
of each key are ever returned to the UI.

### Key encryption

The `AI_ENCRYPTION_KEY` variable must be set to a unique 32-byte hex string
per installation:

```bash
openssl rand -hex 32
```

If `AI_ENCRYPTION_KEY` is absent, the app falls back to deriving a key from
`JWT_SECRET` and logs a warning. This means rotating `JWT_SECRET` would
invalidate all stored provider keys. Set `AI_ENCRYPTION_KEY` explicitly in
production.

### Daily quota

`AI_MAX_CALLS_PER_DAY` limits the number of AI API calls a single user can
make per day. Default is 200. Set to a lower value to control costs:

```env
AI_MAX_CALLS_PER_DAY=50
```

### Mock fallback

If no key is configured or the user has disabled AI features, all AI endpoints
automatically use the built-in `MockProvider`, which returns placeholder
responses without making any external API calls. The application never errors
on missing AI keys — it silently falls back.

---

## WhatsApp CRM Integration

Kanakku includes a bridge for an external WhatsApp CRM service. This is an
optional integration for businesses that manage customer communication through
a separate WhatsApp platform.

### What it does

- **SSO exchange**: The WhatsApp CRM can authenticate users into Kanakku using
  a signed JWT (HMAC). On success, Kanakku provisions or updates the user
  account.
- **Customer sync**: The CRM can push customer/contact records into Kanakku
  via a server-to-server API call. Phone-only contacts get a synthetic email
  address (e.g. `external-{id}@whatsappcrm.local`).
- **Invoice WhatsApp link**: From any invoice, generate a `wa.me` deep link
  with the invoice details pre-filled for sending via WhatsApp.

### Setup

Set the shared API key in `docker/.env`:

```env
WHATSAPPCRM_API_KEY=a-long-random-shared-secret
```

This is a runtime variable — apply with `make rebuild-api`.

The same value must be configured on the WhatsApp CRM side as its
`kanakku_api_key` setting. All inbound server-to-server requests from the
CRM must include this key as a Bearer token:

```
Authorization: Bearer a-long-random-shared-secret
```

Requests with a missing or incorrect key are rejected with HTTP 401.
The endpoint returns HTTP 503 if `WHATSAPPCRM_API_KEY` is not configured,
so the integration gracefully disables itself if the env var is absent.

### In-app messaging config

Additional WhatsApp settings (provider selection, message template) are
configurable in **Settings → Messaging**. The v1 send path returns a `wa.me`
deep link; direct provider delivery (Twilio, Cloud API) is a placeholder
in this release.
