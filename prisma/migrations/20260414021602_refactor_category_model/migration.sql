-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "parentId" TEXT,
    "notebookId" INTEGER,
    CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Category_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Migrate existing category strings → Category records (before table is dropped)
INSERT INTO "Category" ("id", "name", "notebookId", "order")
SELECT hex(randomblob(16)), "category", "notebookId", 0
FROM "DiagramKeyword"
WHERE "category" IS NOT NULL
GROUP BY "notebookId", "category";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DiagramKeyword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "x" REAL,
    "y" REAL,
    "categoryId" TEXT,
    "notebookId" INTEGER,
    CONSTRAINT "DiagramKeyword_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DiagramKeyword_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DiagramKeyword" ("color", "id", "notebookId", "text", "x", "y", "categoryId", "order")
SELECT
  dk."color",
  dk."id",
  dk."notebookId",
  dk."text",
  dk."x",
  dk."y",
  (SELECT c."id" FROM "Category" c
   WHERE c."name" = dk."category"
   AND (c."notebookId" = dk."notebookId" OR (c."notebookId" IS NULL AND dk."notebookId" IS NULL))
   LIMIT 1),
  0
FROM "DiagramKeyword" dk;
DROP TABLE "DiagramKeyword";
ALTER TABLE "new_DiagramKeyword" RENAME TO "DiagramKeyword";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
