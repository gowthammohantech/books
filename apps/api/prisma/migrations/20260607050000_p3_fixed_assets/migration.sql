-- P3.4 — Fixed Assets + Depreciation: FixedAsset table

CREATE TABLE "FixedAsset" (
    "id"                      TEXT             NOT NULL,
    "userId"                  TEXT             NOT NULL,
    "name"                    TEXT             NOT NULL,
    "cost"                    DECIMAL(18, 4)   NOT NULL,
    "salvageValue"            DECIMAL(18, 4)   NOT NULL DEFAULT 0,
    "usefulLifeMonths"        INTEGER          NOT NULL,
    "method"                  TEXT             NOT NULL DEFAULT 'STRAIGHT_LINE',
    "acquisitionDate"         TIMESTAMP(3)     NOT NULL,
    "accumulatedDepreciation" DECIMAL(18, 4)   NOT NULL DEFAULT 0,
    "lastDepreciatedOn"       TIMESTAMP(3),
    "status"                  TEXT             NOT NULL DEFAULT 'active',
    "isDeleted"               BOOLEAN          NOT NULL DEFAULT FALSE,
    "createdAt"               TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               TIMESTAMP(3)     NOT NULL,
    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FixedAsset_userId_status_idx" ON "FixedAsset"("userId", "status");

ALTER TABLE "FixedAsset"
    ADD CONSTRAINT "FixedAsset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
