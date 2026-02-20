/*
  Warnings:

  - You are about to drop the `prompts` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "prompts" DROP CONSTRAINT "prompts_userId_fkey";

-- DropTable
DROP TABLE "prompts";
