-- CreateTable
CREATE TABLE "public"."whiteboards" (
    "id" SERIAL NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "group_id" INTEGER,
    "title" VARCHAR(120) NOT NULL,
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "whiteboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sticky_notes" (
    "id" SERIAL NOT NULL,
    "board_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "color" VARCHAR(20),
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "rotation" DOUBLE PRECISION DEFAULT 0,
    "z_index" INTEGER NOT NULL DEFAULT 0,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sticky_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whiteboards_owner_id_idx" ON "public"."whiteboards"("owner_id");

-- CreateIndex
CREATE INDEX "whiteboards_group_id_idx" ON "public"."whiteboards"("group_id");

-- CreateIndex
CREATE INDEX "sticky_notes_board_id_idx" ON "public"."sticky_notes"("board_id");

-- CreateIndex
CREATE INDEX "sticky_notes_user_id_created_at_idx" ON "public"."sticky_notes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "sticky_notes_board_id_z_index_idx" ON "public"."sticky_notes"("board_id", "z_index");

-- AddForeignKey
ALTER TABLE "public"."whiteboards" ADD CONSTRAINT "fk_whiteboard_owner" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."whiteboards" ADD CONSTRAINT "fk_whiteboard_group" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sticky_notes" ADD CONSTRAINT "fk_note_board" FOREIGN KEY ("board_id") REFERENCES "public"."whiteboards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sticky_notes" ADD CONSTRAINT "fk_note_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
