import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash("secret123", 10);
  const alice = await prisma.user.upsert({
    where: { email: "alice@mail.com" },
    update: {},
    create: {
      username: "alice",
      email: "alice@mail.com",
      display_name: "Alice",
      password_hash: hash
    }
  });
  const bob = await prisma.user.upsert({
    where: { email: "bob@mail.com" },
    update: {},
    create: {
      username: "bob",
      email: "bob@mail.com",
      display_name: "Bob",
      password_hash: hash
    }
  });

  console.log("Seeded users:", { alice: alice.id, bob: bob.id });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
