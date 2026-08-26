// utils/mailer.js
//
// Single send path for the whole app. The active email provider is configured
// in the UI (Settings > Email Settings) and stored on the EmailSettings row;
// this module reads that row and builds the right nodemailer transport:
//
//   RESEND -> SMTP to smtp.resend.com (user "resend", pass = API key)
//   SMTP   -> the configured SMTP host/port/credentials
//   NODE   -> the configured Node Mail host/port/credentials
//   (none) -> env fallback (SMTP_HOST/SMTP_EMAIL/SMTP_PASSWORD; defaults to Gmail)
//
// When the active provider has a configured "from" address we override the
// caller-supplied `from` so mail always goes out as the verified sender
// (required by Resend, and what users expect from the UI config).
const nodemailer = require("nodemailer");

// Brief in-process cache so we don't hit the DB on every email.
let cache = { at: 0, settings: null };
const CACHE_MS = 30000;

async function loadActiveSettings() {
  const now = Date.now();
  if (cache.settings !== undefined && now - cache.at < CACHE_MS) return cache.settings;
  try {
    const { prisma } = require("../lib/prisma");
    const settings = await prisma.emailSettings.findFirst({
      where: { OR: [{ resend_status: true }, { smtp_status: true }, { node_status: true }] },
      orderBy: { updatedAt: "desc" },
    });
    cache = { at: now, settings: settings || null };
    return cache.settings;
  } catch (err) {
    console.warn("[mailer] could not load EmailSettings, using env fallback:", err && err.message);
    return null;
  }
}

function fmtFrom(name, email) {
  if (!email) return null;
  return name ? `"${name}" <${email}>` : email;
}

// Secrets are stored encrypted (enc:: marker); decrypt at point of use.
const { decryptSecret } = require("../lib/emailSecret");

function buildTransport(s) {
  // 1. Demo no-op: swallow the send silently so demo buttons work without
  //    actually delivering any email. Check this before everything else.
  if (process.env.DEMO_MODE === 'true') {
    return {
      transport: nodemailer.createTransport({ jsonTransport: true }),
      from: null,
      replyTo: null,
    };
  }

  if (s && s.resend_status && s.resendApiKey) {
    return {
      transport: nodemailer.createTransport({
        host: "smtp.resend.com",
        port: 465,
        secure: true,
        auth: { user: "resend", pass: decryptSecret(s.resendApiKey) },
      }),
      from: fmtFrom(s.resendFromName, s.resendFromEmail),
      replyTo: s.resendReplyTo || null,
    };
  }
  if (s && s.smtp_status && s.smtpHost) {
    const port = Number(s.smtpPort) || 587;
    return {
      transport: nodemailer.createTransport({
        host: s.smtpHost,
        port,
        secure: port === 465,
        auth: { user: s.smtpUsername, pass: decryptSecret(s.smtpPassword) },
      }),
      from: fmtFrom(s.smtpFromName, s.smtpFromEmail),
      replyTo: s.smtpReplyTo || null,
    };
  }
  if (s && s.node_status && s.nodeHost) {
    const port = Number(s.nodePort) || 587;
    return {
      transport: nodemailer.createTransport({
        host: s.nodeHost,
        port,
        secure: port === 465,
        auth: { user: s.nodeUsername, pass: decryptSecret(s.nodePassword) },
      }),
      from: fmtFrom(s.nodeFromName, s.nodeFromEmail),
      replyTo: s.nodeReplyTo || null,
    };
  }

  // 2. Env fallback — only use it when all three SMTP env vars are present.
  //    Without credentials the Gmail fallback will always fail with an auth
  //    error, which surfaces as a confusing 500 on a fresh install.
  const envHost = process.env.SMTP_HOST;
  const envUser = process.env.SMTP_EMAIL || process.env.SMTP_USER;
  const envPass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS;
  if (envHost && envUser && envPass) {
    const port = Number(process.env.SMTP_PORT) || 465;
    return {
      transport: nodemailer.createTransport({
        host: envHost,
        port,
        secure: port === 465,
        auth: { user: envUser, pass: envPass },
      }),
      from: fmtFrom(process.env.SMTP_FROM_NAME, process.env.SMTP_FROM || envUser),
      replyTo: process.env.SMTP_REPLY_TO || null,
    };
  }

  // 3. Nothing usable is configured — throw a typed, actionable error so
  //    callers can return 422 instead of a cryptic 500.
  const err = new Error(
    'Email is not configured. Set up an email provider in Settings → Email.'
  );
  err.code = 'EMAIL_NOT_CONFIGURED';
  throw err;
}

const sendMail = async (options) => {
  const settings = await loadActiveSettings();
  const { transport, from, replyTo } = buildTransport(settings);
  const opts = { ...options };
  // Always send as the configured/verified sender when one is set.
  if (from) opts.from = from;
  // Set the configured reply-to unless the caller already supplied one.
  if (replyTo && !opts.replyTo) opts.replyTo = replyTo;
  return await transport.sendMail(opts);
};

// Allow the controller to clear the cache right after a settings change so the
// next email uses the new provider without waiting for the TTL.
const clearMailerCache = () => { cache = { at: 0, settings: null }; };

module.exports = { sendMail, clearMailerCache };
