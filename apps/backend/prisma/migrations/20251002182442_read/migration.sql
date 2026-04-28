-- CreateTable
CREATE TABLE "public"."message_reads" (
    "message_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reads_pkey" PRIMARY KEY ("message_id","user_id")
);

-- CreateIndex
CREATE INDEX "message_reads_user_id_idx" ON "public"."message_reads"("user_id");

-- CreateIndex
CREATE INDEX "message_reads_message_id_created_at_idx" ON "public"."message_reads"("message_id", "created_at");

-- AddForeignKey
ALTER TABLE "public"."message_reads" ADD CONSTRAINT "fk_read_message" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."message_reads" ADD CONSTRAINT "fk_read_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
