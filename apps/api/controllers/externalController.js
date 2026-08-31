// Bridge endpoints for the whatsappcrm integration.
// - ssoExchange:  verify a whatsappcrm-issued HMAC JWT, upsert an Elixir Books User
//                 by email, mint an Elixir Books session token. Called by the
//                 Elixir Books frontend's /sso landing route.
// - upsertCustomer: server-to-server push of a Contact from whatsappcrm.
//                 Uses (externalSource, externalRef, tenantId) as the match key
//                 (mapped to the @@unique index customer_external_upsert_idx),
//                 falls back to email when present.
//
// Both endpoints assume whatsappcrm is the identity authority for users and
// the source of truth for contacts. Elixir Books stays standalone for everything
// else.
//
// WHICH WORKSPACE? (P5). Both endpoints used to answer this by finding "the
// sole admin" — the one user_type:1 account the old registration guard
// guaranteed. That guard is gone, so the answer has to come from the request:
//
//   upsertCustomer  the API key names its tenant (middleware/apiKeyAuth.js
//                   puts it on req.tenantId).
//   ssoExchange     a `tenant` claim in the signed token, else
//                   WHATSAPPCRM_TENANT_ID, else the sole workspace if there is
//                   exactly one. See lib/tenantApiKey.resolveExternalTenant.
//
// Neither falls back to "the first tenant". A wrong answer here writes one
// company's data into another's books, so an unresolvable request fails.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { prisma } = require('../lib/prisma');
const { generateToken } = require('../utils/generateToken');
const { hashPassword } = require('../utils/password');
const { ensureRole, DEFAULT_ROLE_BY_USER_TYPE } = require('../lib/defaultRoles');
const { resolveExternalTenant } = require('../lib/tenantApiKey');

const base64UrlDecode = (input) => {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
};

const verifyWhatsappcrmJwt = (token, secret) => {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed token');
  }
  const [h, p, s] = parts;

  // Constant-time signature compare.
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const provided = base64UrlDecode(s);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw new Error('Invalid signature');
  }

  const header = JSON.parse(base64UrlDecode(h).toString('utf8'));
  if (header.alg !== 'HS256') {
    throw new Error('Unexpected signing algorithm');
  }
  const payload = JSON.parse(base64UrlDecode(p).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new Error('Token expired');
  }
  return payload;
};

exports.ssoExchange = async (req, res) => {
  const secret = process.env.WHATSAPPCRM_SSO_SECRET;
  if (!secret) {
    return res.status(503).json({
      success: false,
      message: 'SSO not configured on this Elixir Books instance.',
    });
  }

  const token = (req.body && req.body.token) || req.query.token;
  if (!token) {
    return res.status(400).json({ success: false, message: 'Missing token.' });
  }

  let claims;
  try {
    claims = verifyWhatsappcrmJwt(token, secret);
  } catch (err) {
    return res.status(401).json({ success: false, message: err.message });
  }

  if (!claims.email) {
    return res.status(400).json({ success: false, message: 'Token missing email claim.' });
  }

  // Resolve the workspace BEFORE touching any data: a user provisioned into
  // the wrong company is far harder to undo than a rejected request.
  const resolved = await resolveExternalTenant(claims.tenant || null);
  if (!resolved.ok) {
    return res.status(resolved.status).json({ success: false, message: resolved.message });
  }
  const tenantId = resolved.tenantId;

  try {
    const email = String(claims.email).toLowerCase().trim();
    // isDeleted: { not: true } excludes rows where isDeleted IS true.
    // This works correctly here ONLY because isDeleted is a non-nullable
    // Boolean @default(false) — there are no NULLs to worry about.
    // Do NOT copy this pattern for nullable columns; on nullable columns
    // Prisma's `not: true` excludes NULLs as well (use `notIn: [true]` there).
    let user = await prisma.user.findFirst({
      where: { email, isDeleted: { not: true } },
    });

    const userType = Number(claims.user_type) === 1 ? 1 : 2;

    // The role is resolved in the RESOLVED workspace rather than guessed at
    // from "the sole tenant", and it is resolved for RETURNING users too, not
    // only new ones: someone who already has an account elsewhere and arrives
    // here for the first time needs a role in THIS workspace, or their new
    // membership authenticates them into an app where they can do nothing.
    //
    // Still best-effort: a transient failure leaves the user without
    // permissions until prisma/seedRoles.ts heals it on the next boot, which
    // beats refusing the SSO exchange outright. The MEMBERSHIP below is the
    // part that is fatal - without one the user cannot authenticate at all.
    let ssoRoleId = null;
    try {
      const roleName = DEFAULT_ROLE_BY_USER_TYPE[userType];
      if (roleName) ssoRoleId = await ensureRole(roleName, tenantId);
    } catch (roleErr) {
      console.warn('ssoExchange: ensureRole failed (non-fatal, roleId will be null)', roleErr);
    }

    if (!user) {
      // First-time SSO from whatsappcrm — provision an Elixir Books user.
      // Random password (32 bytes hex) means the local-login path can't be
      // used; this user can only return via SSO until an admin sets a
      // password through Elixir Books' normal flow.
      // The password MUST be hashed before storage — the old Mongoose model
      // did this via a pre-save hook; Prisma has no such hook, so we hash
      // explicitly here using the same bcrypt helper as authController.
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const hashedPassword = await hashPassword(randomPassword);
      const fullName = String(claims.name || '').trim();
      const [firstName, ...rest] = fullName.split(/\s+/).filter(Boolean);

      user = await prisma.user.create({
        data: {
          firstName: firstName || email.split('@')[0],
          lastName: rest.join(' ') || '',
          email,
          password: hashedPassword,
          user_type: userType,
          lastTenantId: tenantId,
        },
      });
    }

    // The MEMBERSHIP is what lets this user authenticate: authMiddleware.protect
    // resolves the tenant from it and 401s without one. Idempotent, because an
    // existing user returning through SSO already has theirs — and because a
    // user who exists in ANOTHER workspace must gain a membership here rather
    // than be rejected or silently moved.
    const membership = await prisma.tenantMembership.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId } },
      update: { status: 'ACTIVE' },
      create: {
        userId: user.id,
        tenantId,
        // The role resolved for THIS workspace above. It used to read
        // `user.roleId`, a single global column — so a user arriving through
        // SSO into a second workspace carried the first workspace's role in.
        roleId: ssoRoleId || null,
        status: 'ACTIVE',
        isOwner: false,
        joinedAt: new Date(),
      },
      select: { id: true },
    });

    return res.json({
      success: true,
      message: 'SSO accepted',
      token: generateToken(user.id, tenantId, membership.id),
      user: {
        // Return both `id` (Prisma) and `_id` (legacy alias) so external
        // CRM consumers that read `_id` from this response continue to work.
        id: user.id,
        _id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        user_type: user.user_type,
      },
    });
  } catch (err) {
    console.error('SSO exchange error:', err);
    return res.status(500).json({ success: false, message: 'SSO exchange failed' });
  }
};

exports.upsertCustomer = async (req, res) => {
  const { external_id, name, email, phone, whatsapp, company_id } = req.body || {};
  if (!external_id) {
    return res.status(400).json({ success: false, message: 'external_id is required.' });
  }
  if (!name) {
    return res.status(400).json({ success: false, message: 'name is required.' });
  }

  // Set by middleware/apiKeyAuth.js from the presented credential. The old
  // "find the sole admin" lookup this replaces was the single largest
  // cross-tenant hazard in the integration.
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(503).json({
      success: false,
      message: 'Could not determine the target workspace for this request.',
    });
  }

  // Elixir Books Customer requires a unique email per user. whatsappcrm contacts
  // can be phone-only, so we synthesize a placeholder when missing. A real
  // email added upstream later overwrites this on the next sync (matched by
  // externalRef, not email).
  const safeEmail = (email && String(email).trim())
    || `external-${external_id}@whatsappcrm.local`;

  const customerData = {
    name: String(name).trim() || `Contact ${external_id}`,
    email: safeEmail.toLowerCase(),
    phone: phone ? String(phone).trim() : '',
    whatsapp: whatsapp ? String(whatsapp).trim() : '',
    status: 'Active',
  };

  try {
    // Upsert on @@unique([externalSource, externalRef, tenantId]) —
    // named customer_external_upsert_idx in schema.prisma.
    const customer = await prisma.customer.upsert({
      where: {
        customer_external_upsert_idx: {
          externalSource: 'whatsappcrm',
          externalRef: String(external_id),
          tenantId,
        },
      },
      update: customerData,
      create: {
        ...customerData,
        tenantId,
        externalSource: 'whatsappcrm',
        externalRef: String(external_id),
      },
    });

    return res.json({
      success: true,
      message: 'Customer upserted',
      data: {
        // Return both `id` (Prisma) and `_id` (legacy alias) so external
        // CRM consumers that read `_id` from this response continue to work.
        id: customer.id,
        _id: customer.id,
        name: customer.name,
        email: customer.email,
        externalSource: customer.externalSource,
        externalRef: customer.externalRef,
      },
    });
  } catch (err) {
    // Prisma unique constraint violation (P2002) maps to the Mongoose 11000
    // duplicate-key path: an Elixir Books-native customer already owns this email.
    // Bail with a 409 so whatsappcrm logs it without retrying forever.
    if (err && err.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'An Elixir Books customer with this email already exists outside the integration.',
        // `meta` is the Prisma field name. `keyValue` is the legacy alias that
        // whatsappcrm consumers already read from the old Mongoose 11000 path —
        // both are returned so neither consumer breaks during the migration window.
        meta: err.meta || null,
        keyValue: err.meta || null,
      });
    }
    console.error('External upsertCustomer error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to upsert customer',
      error: err.message,
    });
  }
};
