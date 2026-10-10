// Responses go through these mappers, never straight from Prisma rows: this is where secrets and notes are dropped.
import type { Me } from "@redart/shared";
import type { User } from "../generated/prisma/client";

export const toMe = (u: User): Me => ({
  id: u.id, email: u.email, handle: u.handle, displayName: u.displayName, bio: u.bio,
  visibility: u.visibility, topics: u.topics, isAdmin: u.isAdmin, createdAt: u.createdAt.toISOString(),
});
