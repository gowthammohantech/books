/**
 * Baseline EmailTemplate seed.
 *
 * EmailTemplate is a GLOBAL (not tenant-scoped) table, so these ship as a
 * ready-to-use content library for every company on the install. They're
 * managed in Settings → Email Templates and can be edited per business.
 *
 * Merge fields use the `{Tag Title}` syntax the template editor inserts, and
 * are limited to the tags seeded for each NotificationType (see
 * seedNotifications.ts). `description` holds the email body (rich text/HTML),
 * `subject` the email subject, `sms_content` / `notification_content` the SMS
 * and in-app notification variants.
 *
 * Idempotent: a template is created only if one with the same title does not
 * already exist for its notification type.
 *
 * Run: `npx ts-node prisma/seedEmailTemplates.ts` (or via the boot seed flow).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TemplateDef {
  typeSlug: string;
  title: string;
  subject: string;
  description: string; // email body (HTML)
  sms_content: string;
  notification_content: string;
}

// Shared, neutral HTML wrapper so every template looks consistent and works in
// any company's branding. Sign-off uses {Company Name} where available.
function wrap(bodyInner: string, signOffCompany = true): string {
  const signOff = signOffCompany
    ? '<p style="margin:20px 0 0 0">Best regards,<br/>{Company Name}</p>'
    : '<p style="margin:20px 0 0 0">Best regards,<br/>The Accounts Team</p>';
  return (
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#333;line-height:1.6">' +
    bodyInner +
    signOff +
    '</div>'
  );
}

// Centered call-to-action button (used for the View Invoice/Quotation links).
function button(label: string, linkTag: string): string {
  return (
    '<p style="text-align:center;margin:18px 0"><a href="' + linkTag +
    '" style="display:inline-block;padding:10px 22px;background-color:#4191f2;color:#fff;text-decoration:none;border-radius:4px;font-size:15px">' +
    label + '</a></p>'
  );
}

const TEMPLATES: TemplateDef[] = [
  {
    typeSlug: 'new-quotation-created',
    title: 'New Quotation Created',
    subject: 'Quotation {Quotation Number} from {Company Name}',
    description: wrap(
      '<p>Dear {Customer Name},</p>' +
        '<p>Thank you for your interest. Please find your quotation <strong>{Quotation Number}</strong> dated {Quotation Date} for the amount of <strong>{Quotation Amount}</strong>.</p>' +
        '<p>This quotation is valid until <strong>{Expiry Date}</strong>. You can review it online using the button below.</p>' +
        button('View Quotation', '{View Quotation Link}') +
        '<p>If you would like to proceed or have any questions, simply reply to this email.</p>',
    ),
    sms_content: 'Quotation {Quotation Number} for {Quotation Amount} is ready (valid until {Expiry Date}).',
    notification_content: 'Quotation {Quotation Number} ({Quotation Amount}) was created.',
  },
  {
    typeSlug: 'quotation-approved',
    title: 'Quotation Approved',
    subject: 'Quotation {Quotation Number} has been approved',
    description: wrap(
      '<p>Dear {Customer Name},</p>' +
        '<p>Good news — quotation <strong>{Quotation Number}</strong> for <strong>{Quotation Amount}</strong> has been approved.</p>' +
        '<p>We will proceed with the next steps and share the invoice shortly. Thank you for your business.</p>',
    ),
    sms_content: 'Quotation {Quotation Number} ({Quotation Amount}) approved. Thank you!',
    notification_content: 'Quotation {Quotation Number} was approved.',
  },
  {
    typeSlug: 'invoice-generated',
    title: 'Invoice Generated',
    subject: 'Invoice {Invoice Number} from {Company Name}',
    description: wrap(
      '<p>Dear {Customer Name},</p>' +
        '<p>Thank you for your business. Please find your invoice <strong>{Invoice Number}</strong> dated {Invoice Date}.</p>' +
        '<table role="presentation" style="border-collapse:collapse;margin:8px 0 4px 0">' +
        '<tr><td style="padding:2px 16px 2px 0;color:#555">Amount</td><td style="padding:2px 0;font-weight:700">{Invoice Amount}</td></tr>' +
        '<tr><td style="padding:2px 16px 2px 0;color:#555">Due Date</td><td style="padding:2px 0">{Due Date}</td></tr>' +
        '<tr><td style="padding:2px 16px 2px 0;color:#555">Status</td><td style="padding:2px 0">{Invoice Status}</td></tr>' +
        '<tr><td style="padding:2px 16px 2px 0;color:#555">Balance Due</td><td style="padding:2px 0;font-weight:700">{Balance Due}</td></tr>' +
        '</table>' +
        button('View Invoice', '{View Invoice Link}') +
        '<p>Kindly arrange payment by the due date. A PDF copy is attached for your records.</p>',
    ),
    sms_content: 'Invoice {Invoice Number} for {Invoice Amount} (due {Due Date}). Balance: {Balance Due}.',
    notification_content: 'Invoice {Invoice Number} generated for {Invoice Amount}.',
  },
  {
    typeSlug: 'invoice-payment-received',
    title: 'Invoice Payment Received',
    subject: 'Payment received for invoice {Invoice Number}',
    description: wrap(
      '<p>Dear {Customer Name},</p>' +
        '<p>We have received your payment of <strong>{Amount Paid}</strong> towards invoice <strong>{Invoice Number}</strong> dated {Invoice Date}.</p>' +
        '<p>Remaining balance: <strong>{Balance Due}</strong>. Current status: <strong>{Invoice Status}</strong>.</p>' +
        '<p>Thank you for your prompt payment — we truly appreciate your business.</p>',
    ),
    sms_content: 'Payment of {Amount Paid} received for {Invoice Number}. Balance: {Balance Due}.',
    notification_content: 'Payment of {Amount Paid} received for invoice {Invoice Number}.',
  },
  {
    typeSlug: 'purchase-added',
    title: 'Purchase Added',
    subject: 'New purchase recorded — {Purchase Reference}',
    description: wrap(
      '<p>Dear {Supplier Name},</p>' +
        '<p>A new purchase has been recorded with reference <strong>{Purchase Reference}</strong> dated {Purchase Date} for the amount of <strong>{Purchase Amount}</strong>.</p>' +
        '<p>Please review the details. No action is required if everything looks correct.</p>',
    ),
    sms_content: 'Purchase {Purchase Reference} for {Purchase Amount} recorded.',
    notification_content: 'Purchase {Purchase Reference} ({Purchase Amount}) was added.',
  },
  {
    typeSlug: 'purchase-updated',
    title: 'Purchase Updated',
    subject: 'Purchase {Purchase Reference} updated',
    description: wrap(
      '<p>Dear {Supplier Name},</p>' +
        '<p>The purchase with reference <strong>{Purchase Reference}</strong> has been updated. The current amount is <strong>{Purchase Amount}</strong>.</p>' +
        '<p>Please review the updated details.</p>',
    ),
    sms_content: 'Purchase {Purchase Reference} updated. Amount: {Purchase Amount}.',
    notification_content: 'Purchase {Purchase Reference} was updated ({Purchase Amount}).',
  },
  {
    typeSlug: 'purchase-order-created',
    title: 'Purchase Order Created',
    subject: 'Purchase Order {PO Number} from {Company Name}',
    description: wrap(
      '<p>Dear {Supplier Name},</p>' +
        '<p>Please find our purchase order <strong>{PO Number}</strong> dated {PO Date} for the amount of <strong>{PO Amount}</strong>, with a due date of <strong>{PO Due Date}</strong>.</p>' +
        '<p>Kindly confirm receipt and the expected delivery schedule. A PDF copy is attached for your reference.</p>',
    ),
    sms_content: 'PO {PO Number} for {PO Amount} (due {PO Due Date}). Please confirm.',
    notification_content: 'Purchase Order {PO Number} ({PO Amount}) was created.',
  },
  {
    typeSlug: 'purchase-order-approved',
    title: 'Purchase Order Approved',
    subject: 'Purchase Order {PO Number} approved',
    description: wrap(
      '<p>Dear {Supplier Name},</p>' +
        '<p>Purchase order <strong>{PO Number}</strong> for <strong>{PO Amount}</strong> (due <strong>{PO Due Date}</strong>) has been approved.</p>' +
        '<p>Please proceed as per the agreed terms. Thank you.</p>',
    ),
    sms_content: 'PO {PO Number} ({PO Amount}) approved. Due {PO Due Date}.',
    notification_content: 'Purchase Order {PO Number} was approved.',
  },
];

export async function seedEmailTemplates(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const t of TEMPLATES) {
    const type = await prisma.notificationType.findUnique({ where: { slug: t.typeSlug } });
    if (!type) {
      // Notification types are seeded earlier; skip gracefully if missing.
      skipped += 1;
      continue;
    }

    const existing = await prisma.emailTemplate.findFirst({
      where: { notificationTypeId: type.id, title: t.title },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.emailTemplate.create({
      data: {
        title: t.title,
        notificationTypeId: type.id,
        description: t.description,
        subject: t.subject,
        sms_content: t.sms_content,
        notification_content: t.notification_content,
        status: 'active',
      },
    });
    created += 1;
  }

  return { created, skipped };
}

if (require.main === module) {
  seedEmailTemplates()
    .then((r) => {
      console.log(`Email templates seeded (created ${r.created}, skipped ${r.skipped}).`);
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch(async (e) => {
      console.error('seedEmailTemplates error:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
