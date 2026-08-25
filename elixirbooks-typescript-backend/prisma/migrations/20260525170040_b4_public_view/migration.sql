-- Invoice public-view fields
ALTER TABLE "Invoice" ADD COLUMN "publicViewToken" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "publicViewEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Invoice_publicViewToken_key" ON "Invoice"("publicViewToken");

-- CompanySettings public base URL
ALTER TABLE "CompanySettings" ADD COLUMN "publicBaseUrl" TEXT;
