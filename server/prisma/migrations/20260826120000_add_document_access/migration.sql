-- CreateEnum
CREATE TYPE "DocumentRole" AS ENUM ('VIEWER', 'EDITOR');

-- CreateTable
CREATE TABLE "DocumentAccess" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "DocumentRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAccess_documentId_userId_key" ON "DocumentAccess"("documentId", "userId");

-- CreateIndex
CREATE INDEX "DocumentAccess_userId_idx" ON "DocumentAccess"("userId");

-- AddForeignKey
ALTER TABLE "DocumentAccess" ADD CONSTRAINT "DocumentAccess_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccess" ADD CONSTRAINT "DocumentAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
