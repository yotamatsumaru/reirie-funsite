-- プロモーション / デモ配信用アカウントの有効期限。
-- null=通常, 未来=プロモ有効 (回数無制限 + 勝率PREMIUM相当), 過去=期限切れ。
ALTER TABLE "users" ADD COLUMN "promo_until" TIMESTAMP(3);
