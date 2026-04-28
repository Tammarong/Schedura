/*
  Warnings:

  - The `status` column on the `friends` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[chat_id,client_msg_id]` on the table `dm_messages` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "public"."FriendStatus" AS ENUM ('pending', 'accepted', 'rejected', 'blocked');

-- CreateEnum
CREATE TYPE "public"."MessageVisibility" AS ENUM ('normal', 'deletedForSender', 'deletedForReceiver');

-- AlterTable
ALTER TABLE "public"."dm_messages" ADD COLUMN     "client_msg_id" UUID;

-- AlterTable
ALTER TABLE "public"."friends" DROP COLUMN "status",
ADD COLUMN     "status" "public"."FriendStatus" NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE "public"."dm_receipts" (
    "conversation_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "last_read_msg_id" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dm_receipts_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "public"."user_blocks" (
    "id" SERIAL NOT NULL,
    "blocker_id" INTEGER NOT NULL,
    "blockee_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_blocks_blocker_id_idx" ON "public"."user_blocks"("blocker_id");

-- CreateIndex
CREATE INDEX "user_blocks_blockee_id_idx" ON "public"."user_blocks"("blockee_id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_user_block" ON "public"."user_blocks"("blocker_id", "blockee_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "public"."notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "public"."notifications"("created_at");

-- CreateIndex
CREATE INDEX "availability_user_id_idx" ON "public"."availability"("user_id");

-- CreateIndex
CREATE INDEX "calendar_events_user_id_idx" ON "public"."calendar_events"("user_id");

-- CreateIndex
CREATE INDEX "calendar_events_group_id_idx" ON "public"."calendar_events"("group_id");

-- CreateIndex
CREATE INDEX "calendar_events_date_idx" ON "public"."calendar_events"("date");

-- CreateIndex
CREATE INDEX "dm_chats_user1_id_idx" ON "public"."dm_chats"("user1_id");

-- CreateIndex
CREATE INDEX "dm_chats_user2_id_idx" ON "public"."dm_chats"("user2_id");

-- CreateIndex
CREATE INDEX "dm_messages_chat_id_created_at_idx" ON "public"."dm_messages"("chat_id", "created_at");

-- CreateIndex
CREATE INDEX "dm_messages_sender_id_created_at_idx" ON "public"."dm_messages"("sender_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dm_messages_chat_id_client_msg_id_key" ON "public"."dm_messages"("chat_id", "client_msg_id");

-- CreateIndex
CREATE INDEX "events_group_id_idx" ON "public"."events"("group_id");

-- CreateIndex
CREATE INDEX "events_created_by_idx" ON "public"."events"("created_by");

-- CreateIndex
CREATE INDEX "events_date_idx" ON "public"."events"("date");

-- CreateIndex
CREATE INDEX "friends_user_id_status_idx" ON "public"."friends"("user_id", "status");

-- CreateIndex
CREATE INDEX "friends_friend_id_status_idx" ON "public"."friends"("friend_id", "status");

-- CreateIndex
CREATE INDEX "group_members_user_id_idx" ON "public"."group_members"("user_id");

-- CreateIndex
CREATE INDEX "group_members_group_id_idx" ON "public"."group_members"("group_id");

-- CreateIndex
CREATE INDEX "groups_owner_id_idx" ON "public"."groups"("owner_id");

-- CreateIndex
CREATE INDEX "messages_group_id_created_at_idx" ON "public"."messages"("group_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_receiver_id_created_at_idx" ON "public"."messages"("receiver_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_sender_id_created_at_idx" ON "public"."messages"("sender_id", "created_at");

-- CreateIndex
CREATE INDEX "post_comments_post_id_created_at_idx" ON "public"."post_comments"("post_id", "created_at");

-- CreateIndex
CREATE INDEX "post_comments_user_id_created_at_idx" ON "public"."post_comments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "post_likes_user_id_idx" ON "public"."post_likes"("user_id");

-- CreateIndex
CREATE INDEX "post_pictures_post_id_idx" ON "public"."post_pictures"("post_id");

-- CreateIndex
CREATE INDEX "posts_user_id_created_at_idx" ON "public"."posts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "posts_group_id_created_at_idx" ON "public"."posts"("group_id", "created_at");

-- AddForeignKey
ALTER TABLE "public"."dm_receipts" ADD CONSTRAINT "dm_receipts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."dm_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."dm_receipts" ADD CONSTRAINT "dm_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_blocks" ADD CONSTRAINT "user_blocks_blockee_id_fkey" FOREIGN KEY ("blockee_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
