/*
  Warnings:

  - A unique constraint covering the columns `[user_id,date,type]` on the table `calendar_events` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_user_id_date_type_key" ON "public"."calendar_events"("user_id", "date", "type");
