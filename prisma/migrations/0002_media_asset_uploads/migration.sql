ALTER TABLE "MediaAsset" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE "MediaAsset" ADD COLUMN "filename" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MediaAsset" ADD COLUMN "mimeType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MediaAsset" ADD COLUMN "sizeBytes" INTEGER;
ALTER TABLE "MediaAsset" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "MediaAsset"
SET
  "filename" = "path",
  "mimeType" = 'application/octet-stream',
  "updatedAt" = COALESCE("updatedAt", "createdAt"),
  "status" = COALESCE("status", 'ready');

CREATE INDEX "MediaAsset_userId_status_createdAt_idx" ON "MediaAsset"("userId", "status", "createdAt");
