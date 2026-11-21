-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "role" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "workImpact" TEXT NOT NULL,
    "affectedScope" TEXT NOT NULL,
    "commitmentRisk" TEXT NOT NULL,
    "assignedTo" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    "firstResponseDueAt" DATETIME NOT NULL,
    "nextUpdateDueAt" DATETIME,
    "serviceDeskUpdatedAt" DATETIME,
    CONSTRAINT "Ticket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "Ticket_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
INSERT INTO "new_Ticket" ("affectedScope", "assignedTo", "category", "commitmentRisk", "createdAt", "description", "firstResponseDueAt", "id", "nextUpdateDueAt", "priority", "requesterId", "resolvedAt", "serviceDeskUpdatedAt", "status", "title", "type", "updatedAt", "version", "workImpact") SELECT "affectedScope", "assignedTo", "category", "commitmentRisk", "createdAt", "description", "firstResponseDueAt", "id", "nextUpdateDueAt", "priority", "requesterId", "resolvedAt", "serviceDeskUpdatedAt", "status", "title", "type", "updatedAt", "version", "workImpact" FROM "Ticket";
DROP TABLE "Ticket";
ALTER TABLE "new_Ticket" RENAME TO "Ticket";
CREATE TABLE "new_TicketEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorEmployeeId" TEXT,
    "summary" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "TicketEvent_actorEmployeeId_fkey" FOREIGN KEY ("actorEmployeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
INSERT INTO "new_TicketEvent" ("actorEmployeeId", "actorType", "changes", "id", "occurredAt", "summary", "ticketId", "type") SELECT "actorEmployeeId", "actorType", "changes", "id", "occurredAt", "summary", "ticketId", "type" FROM "TicketEvent";
DROP TABLE "TicketEvent";
ALTER TABLE "new_TicketEvent" RENAME TO "TicketEvent";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");
