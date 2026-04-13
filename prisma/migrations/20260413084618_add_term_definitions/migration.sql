-- CreateTable
CREATE TABLE "TermDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "term" TEXT NOT NULL,
    "definition" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TermDefinition_term_key" ON "TermDefinition"("term");
