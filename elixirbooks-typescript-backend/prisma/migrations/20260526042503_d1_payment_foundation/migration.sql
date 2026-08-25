-- Enums
CREATE TYPE "GatewayKind" AS ENUM ('RAZORPAY', 'STRIPE', 'OFFLINE');
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('CREATED', 'PENDING', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- GatewayConfig
CREATE TABLE "GatewayConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "GatewayKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GatewayConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GatewayConfig_userId_kind_key" ON "GatewayConfig"("userId", "kind");
ALTER TABLE "GatewayConfig" ADD CONSTRAINT "GatewayConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PaymentTransaction
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "kind" "GatewayKind" NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'CREATED',
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "gatewayOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "gatewaySignature" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PaymentTransaction_userId_status_idx" ON "PaymentTransaction"("userId", "status");
CREATE INDEX "PaymentTransaction_invoiceId_idx" ON "PaymentTransaction"("invoiceId");
CREATE INDEX "PaymentTransaction_gatewayOrderId_idx" ON "PaymentTransaction"("gatewayOrderId");
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Refund
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'CREATED',
    "gatewayRefundId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Refund_paymentTransactionId_idx" ON "Refund"("paymentTransactionId");
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- InvoicePayment link
ALTER TABLE "InvoicePayment" ADD COLUMN "paymentTransactionId" TEXT;
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "InvoicePayment_paymentTransactionId_idx" ON "InvoicePayment"("paymentTransactionId");
