CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'HIDDEN');
CREATE TYPE "ContactVatMode" AS ENUM ('ALWAYS', 'NEVER', 'UK_VAT_AREA');

CREATE TABLE "Contact" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "firstName" TEXT, "lastName" TEXT, "organisation" TEXT,
  "showNameOnInvoice" BOOLEAN NOT NULL DEFAULT false,
  "email" TEXT, "billingEmail" TEXT, "telephone" TEXT, "mobile" TEXT,
  "addressLine1" TEXT, "addressLine2" TEXT, "addressLine3" TEXT,
  "town" TEXT, "region" TEXT, "postcode" TEXT, "countryId" TEXT,
  "defaultPaymentTermDays" INTEGER,
  "useContactEmailSettings" BOOLEAN NOT NULL DEFAULT false,
  "invoiceSequencePrefix" TEXT,
  "vatMode" "ContactVatMode" NOT NULL DEFAULT 'ALWAYS',
  "vatRegNumber" TEXT, "gstin" TEXT, "invoiceLanguage" TEXT,
  "currencyCode" TEXT, "bankDetails" JSONB, "notes" TEXT, "image" TEXT,
  "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
  "legacyCustomerId" TEXT, "legacySupplierId" TEXT,
  "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Contact_userId_idx" ON "Contact"("userId");
CREATE INDEX "Contact_userId_status_idx" ON "Contact"("userId", "status");
CREATE INDEX "Contact_legacyCustomerId_idx" ON "Contact"("legacyCustomerId");
CREATE INDEX "Contact_legacySupplierId_idx" ON "Contact"("legacySupplierId");
CREATE INDEX "Contact_email_idx" ON "Contact"("email");
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
