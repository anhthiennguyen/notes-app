-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DiagramKeyword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "x" REAL,
    "y" REAL,
    "category" TEXT,
    "notebookId" INTEGER,
    CONSTRAINT "DiagramKeyword_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DiagramKeyword" ("category", "color", "id", "text", "x", "y") SELECT "category", "color", "id", "text", "x", "y" FROM "DiagramKeyword";
DROP TABLE "DiagramKeyword";
ALTER TABLE "new_DiagramKeyword" RENAME TO "DiagramKeyword";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
