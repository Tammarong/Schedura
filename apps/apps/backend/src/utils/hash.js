import bcrypt from "bcrypt";

export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}
