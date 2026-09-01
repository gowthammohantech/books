CREATE TABLE "MessagingConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsappProvider" TEXT,
    "whatsappConfig" JSONB,
    "defaultTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MessagingConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MessagingConfig_userId_key" ON "MessagingConfig"("userId");
ALTER TABLE "MessagingConfig" ADD CONSTRAINT "MessagingConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
