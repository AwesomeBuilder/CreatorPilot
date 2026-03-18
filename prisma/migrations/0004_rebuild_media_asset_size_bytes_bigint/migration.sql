PRAGMA foreign_keys=OFF;

CREATE TABLE "new_MediaAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MediaAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_MediaAsset" (
    "id",
    "userId",
    "path",
    "type",
    "status",
    "filename",
    "mimeType",
    "sizeBytes",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "userId",
    "path",
    "type",
    "status",
    "filename",
    "mimeType",
    "sizeBytes",
    "createdAt",
    "updatedAt"
FROM "MediaAsset";

DROP TABLE "MediaAsset";

ALTER TABLE "new_MediaAsset" RENAME TO "MediaAsset";

CREATE INDEX "MediaAsset_userId_createdAt_idx" ON "MediaAsset"("userId", "createdAt");
CREATE INDEX "MediaAsset_userId_status_createdAt_idx" ON "MediaAsset"("userId", "status", "createdAt");

PRAGMA foreign_keys=ON;
