-- DropForeignKey
ALTER TABLE "public"."post_pictures" DROP CONSTRAINT "post_pictures_post_id_fkey";

-- AddForeignKey
ALTER TABLE "public"."post_pictures" ADD CONSTRAINT "post_pictures_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
