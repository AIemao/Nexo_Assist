-- CreateTable
CREATE TABLE "Ticket" (
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
    "serviceDeskUpdatedAt" DATETIME
);
