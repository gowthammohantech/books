/**
 * services/ai/paymentFollowup.ts
 *
 * Prisma port of the former Mongoose `paymentFollowup.js`, which backs
 * `GET /api/ai/overdue-invoices` and the AI-drafted payment chaser. It queried
 * a Mongo instance that no longer exists, so the endpoint reported no overdue
 * invoices for every tenant however many were outstanding.
 *
 * Party resolution follows the contact-first pattern the rest of the AI
 * controller already uses (see aiController.generateFollowup): new-flow
 * documents set `contactId` and leave the legacy `customer` relation null, so
 * reading only `customer` — as the Mongo version did — yields "Unknown" on
 * exactly the invoices most likely to be chased. Both endpoints now name the
 * same customer for the same invoice.
 *
 * `tenantId` is named explicitly rather than delegated to lib/tenantGuard.ts,
 * which ships in `warn` mode and does not filter.
 */
import Anthropic from '@anthropic-ai/sdk';

import { prisma } from '../../lib/prisma';
import { resolveDisplayName } from '../../lib/contacts/contactIdentity';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const OVERDUE_STATUSES = ['SENT', 'UNPAID', 'OVERDUE', 'PARTIALLY_PAID'] as const;

const partySelect = {
  select: { firstName: true, lastName: true, organisation: true, email: true },
} as const;

const legacySelect = { select: { name: true, email: true, phone: true } } as const;

/**
 * Every invoice past its due date and not settled, oldest first.
 */
async function getOverdueInvoices(tenantId: string): Promise<Record<string, unknown>[]> {
  const now = new Date();

  const invoices = await prisma.invoice.findMany({
    where: {
      tenantId,
      isDeleted: false,
      status: { in: [...OVERDUE_STATUSES] },
      dueDate: { lt: now },
    },
    select: {
      id: true,
      invoiceNumber: true,
      TotalAmount: true,
      status: true,
      invoiceDate: true,
      dueDate: true,
      contact: partySelect,
      billToContact: partySelect,
      customer: legacySelect,
      billToCustomer: legacySelect,
    },
    orderBy: { dueDate: 'asc' },
  });

  return invoices.map((inv) => {
    const party = inv.contact ?? inv.billToContact ?? null;
    const legacy = inv.customer ?? inv.billToCustomer;
    const daysOverdue = inv.dueDate
      ? Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      TotalAmount: Number(inv.TotalAmount),
      status: inv.status,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      daysOverdue,
      customerName: (party ? resolveDisplayName(party) : '') || legacy?.name || 'Unknown',
      customerEmail: party?.email || legacy?.email || null,
    };
  });
}

/**
 * Generate a personalised payment reminder email. No datastore access —
 * carried across from the Mongoose version unchanged apart from the amount
 * formatting, which now coerces Prisma's `Decimal` to a number so
 * `toLocaleString()` produces grouped digits rather than a raw decimal string.
 */
async function generateFollowupEmail(
  invoice: Record<string, unknown>,
  companyName: string,
  tone = 'professional',
): Promise<Record<string, unknown>> {
  const toneGuide: Record<string, string> = {
    professional: 'Polite and professional. Formal but not cold. Business-appropriate.',
    friendly: 'Warm and friendly. Casual but respectful. Like a trusted partner.',
    firm: 'Direct and firm. Emphasize urgency. Mention potential consequences politely.',
  };

  const amount = Number(invoice.TotalAmount ?? 0).toLocaleString();
  const dueDate = invoice.dueDate
    ? new Date(invoice.dueDate as string).toLocaleDateString('en-IN')
    : '';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: `You are a professional email writer for ${companyName || 'our company'}. Generate payment reminder emails.
Tone: ${toneGuide[tone] || toneGuide.professional}

Respond ONLY with valid JSON:
{
  "subject": "Email subject line",
  "body": "Full HTML email body with proper formatting. Use <p>, <strong>, <br> tags. Include greeting, context, amount, due date, and call to action."
}`,
    messages: [
      {
        role: 'user',
        content: `Generate a payment reminder email for:
- Customer: ${invoice.customerName}
- Invoice Number: ${invoice.invoiceNumber}
- Amount: ₹${amount}
- Due Date: ${dueDate}
- Days Overdue: ${invoice.daysOverdue} days
- Status: ${invoice.status}`,
      },
    ],
  });

  const block = response.content[0];
  const rawText = block && block.type === 'text' ? block.text.trim() : '';

  try {
    return JSON.parse(rawText);
  } catch {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // fall through to the static template below
      }
    }
    return {
      subject: `Payment Reminder: Invoice ${invoice.invoiceNumber}`,
      body: `<p>Dear ${invoice.customerName},</p><p>This is a reminder that Invoice ${invoice.invoiceNumber} for ₹${amount} was due on ${dueDate} and is now ${invoice.daysOverdue} days overdue.</p><p>Please arrange for payment at your earliest convenience.</p><p>Thank you.</p>`,
    };
  }
}

export { getOverdueInvoices, generateFollowupEmail };
