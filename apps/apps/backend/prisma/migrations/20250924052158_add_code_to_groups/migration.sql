/*
  Warnings:

  - A unique constraint covering the columns `[code]` on the table `groups` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."groups" ADD COLUMN     "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "groups_code_key" ON "public"."groups"("code");
