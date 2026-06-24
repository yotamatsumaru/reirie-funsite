-- AlterTable
ALTER TABLE "users" ADD COLUMN     "admin_capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "admin_invitations" ADD COLUMN     "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[];

