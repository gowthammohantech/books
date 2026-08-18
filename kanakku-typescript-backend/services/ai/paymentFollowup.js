const Anthropic = require("@anthropic-ai/sdk").default;
const Invoice = require("@models/Invoice");
const Customer = require("@models/Customer");

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Get overdue invoices for a user
 */
async function getOverdueInvoices(userId) {
  const now = new Date();

  const invoices = await Invoice.find({
    userId,
    isDeleted: false,
    status: { $in: ["SENT", "UNPAID", "OVERDUE", "PARTIALLY_PAID"] },
    dueDate: { $lt: now },
  })
    .select(
      "invoiceNumber TotalAmount status invoiceDate dueDate customerId billTo"
    )
    .populate("customerId", "name email phone")
    .populate("billTo", "name email phone")
    .sort({ dueDate: 1 })
    .lean();

  return invoices.map((inv) => {
    const daysOverdue = Math.floor(
      (now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    return {
      ...inv,
      daysOverdue,
      customerName: inv.customerId?.name || inv.billTo?.name || "Unknown",
      customerEmail: inv.customerId?.email || inv.billTo?.email || null,
    };
  });
}

/**
 * Generate personalized payment reminder email using AI
 */
async function generateFollowupEmail(invoice, companyName, tone = "professional") {
  const toneGuide = {
    professional:
      "Polite and professional. Formal but not cold. Business-appropriate.",
    friendly:
      "Warm and friendly. Casual but respectful. Like a trusted partner.",
    firm:
      "Direct and firm. Emphasize urgency. Mention potential consequences politely.",
  };

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `You are a professional email writer for ${companyName || "our company"}. Generate payment reminder emails.
Tone: ${toneGuide[tone] || toneGuide.professional}

Respond ONLY with valid JSON:
{
  "subject": "Email subject line",
  "body": "Full HTML email body with proper formatting. Use <p>, <strong>, <br> tags. Include greeting, context, amount, due date, and call to action."
}`,
    messages: [
      {
        role: "user",
        content: `Generate a payment reminder email for:
- Customer: ${invoice.customerName}
- Invoice Number: ${invoice.invoiceNumber}
- Amount: ₹${invoice.TotalAmount?.toLocaleString()}
- Due Date: ${new Date(invoice.dueDate).toLocaleDateString("en-IN")}
- Days Overdue: ${invoice.daysOverdue} days
- Status: ${invoice.status}`,
      },
    ],
  });

  const rawText = response.content[0].text.trim();
  try {
    return JSON.parse(rawText);
  } catch {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return {
      subject: `Payment Reminder: Invoice ${invoice.invoiceNumber}`,
      body: `<p>Dear ${invoice.customerName},</p><p>This is a reminder that Invoice ${invoice.invoiceNumber} for ₹${invoice.TotalAmount?.toLocaleString()} was due on ${new Date(invoice.dueDate).toLocaleDateString("en-IN")} and is now ${invoice.daysOverdue} days overdue.</p><p>Please arrange for payment at your earliest convenience.</p><p>Thank you.</p>`,
    };
  }
}

module.exports = { getOverdueInvoices, generateFollowupEmail };
