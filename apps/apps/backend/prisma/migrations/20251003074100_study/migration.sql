-- CreateEnum
CREATE TYPE "public"."TaskPriority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "public"."SessionMode" AS ENUM ('focus', 'break', 'longBreak');

-- CreateTable
CREATE TABLE "public"."study_desks" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" VARCHAR(120),
    "theme" VARCHAR(30),
    "layout" JSONB,
    "prefs" JSONB,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "study_desks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."study_tasks" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "desk_id" INTEGER,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "priority" "public"."TaskPriority" NOT NULL DEFAULT 'medium',
    "due_at" TIMESTAMP(3),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "study_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."study_resources" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "desk_id" INTEGER,
    "title" VARCHAR(200) NOT NULL,
    "url" VARCHAR(500),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."study_sessions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "desk_id" INTEGER,
    "mode" "public"."SessionMode" NOT NULL DEFAULT 'focus',
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "study_desks_user_id_key" ON "public"."study_desks"("user_id");

-- CreateIndex
CREATE INDEX "study_desks_user_id_idx" ON "public"."study_desks"("user_id");

-- CreateIndex
CREATE INDEX "study_tasks_user_id_done_idx" ON "public"."study_tasks"("user_id", "done");

-- CreateIndex
CREATE INDEX "study_tasks_desk_id_idx" ON "public"."study_tasks"("desk_id");

-- CreateIndex
CREATE INDEX "study_resources_user_id_idx" ON "public"."study_resources"("user_id");

-- CreateIndex
CREATE INDEX "study_resources_desk_id_idx" ON "public"."study_resources"("desk_id");

-- CreateIndex
CREATE INDEX "study_sessions_user_id_started_at_idx" ON "public"."study_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "study_sessions_desk_id_idx" ON "public"."study_sessions"("desk_id");

-- AddForeignKey
ALTER TABLE "public"."study_desks" ADD CONSTRAINT "fk_study_desk_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."study_tasks" ADD CONSTRAINT "study_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."study_tasks" ADD CONSTRAINT "study_tasks_desk_id_fkey" FOREIGN KEY ("desk_id") REFERENCES "public"."study_desks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."study_resources" ADD CONSTRAINT "study_resources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."study_resources" ADD CONSTRAINT "study_resources_desk_id_fkey" FOREIGN KEY ("desk_id") REFERENCES "public"."study_desks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."study_sessions" ADD CONSTRAINT "study_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."study_sessions" ADD CONSTRAINT "study_sessions_desk_id_fkey" FOREIGN KEY ("desk_id") REFERENCES "public"."study_desks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
