import argon2 from "argon2";

// OWASP's argon2id baseline: 19 MiB, 2 iterations, 1 lane.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => argon2.hash(password, OPTIONS);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try { return await argon2.verify(hash, password); } catch { return false; }
}

/** A real hash to verify against when the account doesn't exist, so timing doesn't reveal which emails are registered. */
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword("not-a-real-password-" + Math.random()));
