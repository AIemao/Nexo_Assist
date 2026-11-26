-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerEmployeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assignedAnalystId" TEXT,
    "flow" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "targetTicketId" TEXT,
    "collectedData" JSONB,
    "resolutionSource" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "openOwnerEmployeeId" TEXT
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorEmployeeId" TEXT,
    "content" TEXT NOT NULL,
    "decisionRecordId" TEXT,
    "attachments" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_openOwnerEmployeeId_key" ON "Conversation"("openOwnerEmployeeId");

-- CreateIndex
CREATE INDEX "Conversation_ownerEmployeeId_idx" ON "Conversation"("ownerEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_position_key" ON "Message"("conversationId", "position");
