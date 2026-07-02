-- CreateTable
CREATE TABLE "monthly_reward_point_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "year_month" TEXT NOT NULL,
    "plan" "PlanType" NOT NULL,
    "points" INTEGER NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_reward_point_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monthly_reward_point_grants_year_month_idx" ON "monthly_reward_point_grants"("year_month");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_reward_point_grants_user_id_year_month_key" ON "monthly_reward_point_grants"("user_id", "year_month");

-- AddForeignKey
ALTER TABLE "monthly_reward_point_grants" ADD CONSTRAINT "monthly_reward_point_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

