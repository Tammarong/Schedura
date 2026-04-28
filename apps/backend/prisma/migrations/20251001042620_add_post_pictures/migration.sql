-- CreateTable
CREATE TABLE "public"."post_pictures" (
    "id" SERIAL NOT NULL,
    "post_id" INTEGER NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "post_pictures_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."post_pictures" ADD CONSTRAINT "post_pictures_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
