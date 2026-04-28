-- CreateTable
CREATE TABLE "public"."message_pictures" (
    "id" SERIAL NOT NULL,
    "message_id" INTEGER NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "message_pictures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_pictures_message_id_idx" ON "public"."message_pictures"("message_id");

-- AddForeignKey
ALTER TABLE "public"."message_pictures" ADD CONSTRAINT "fk_message_picture_message" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
