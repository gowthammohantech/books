-- AlterTable: per-invoice "Pay with" links shown on the public view
ALTER TABLE "Invoice" ADD COLUMN "paymentOptions" JSONB;

-- CreateTable: company-defined link-based payment methods (Wise, Revolut, ...)
CREATE TABLE "PaymentLinkMethod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLinkMethod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentLinkMethod_userId_idx" ON "PaymentLinkMethod"("userId");

-- AddForeignKey
ALTER TABLE "PaymentLinkMethod" ADD CONSTRAINT "PaymentLinkMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
