// Who may see what. Every query for another member's data goes through here (CLAUDE.md §7).
import type { FollowState, Relationship } from "@redart/shared";
import type { Db } from "../db";
import type { User } from "../generated/prisma/client";

export interface Access {
  relationship: Relationship | null; // null for guests
  /** Either side has blocked the other. */
  blockedEitherWay: boolean;
  /** The viewer is blocked by the owner: the profile should look like it doesn't exist. */
  hiddenFromViewer: boolean;
  /** May see plans, finished articles, favourites, followers and activity. */
  canSeeReading: boolean;
}

const state = (s: string | undefined): FollowState => (s === "ACCEPTED" ? "accepted" : s === "PENDING" ? "pending" : "none");

/**
 * Reading is visible to: the owner; and signed-in members who aren't blocked either way,
 * when the account is public or they're an accepted follower. Guests only ever see the profile header.
 */
export async function accessTo(db: Db, viewerId: string | null, owner: Pick<User, "id" | "visibility">): Promise<Access> {
  if (!viewerId) return { relationship: null, blockedEitherWay: false, hiddenFromViewer: false, canSeeReading: false };
  if (viewerId === owner.id) {
    return { relationship: { self: true, following: "none", followsYou: "none", blocked: false }, blockedEitherWay: false, hiddenFromViewer: false, canSeeReading: true };
  }
  const [out, back, blocks] = await Promise.all([
    db.follow.findUnique({ where: { followerId_followeeId: { followerId: viewerId, followeeId: owner.id } }, select: { status: true } }),
    db.follow.findUnique({ where: { followerId_followeeId: { followerId: owner.id, followeeId: viewerId } }, select: { status: true } }),
    db.block.findMany({ where: { OR: [{ blockerId: viewerId, blockedId: owner.id }, { blockerId: owner.id, blockedId: viewerId }] }, select: { blockerId: true } }),
  ]);
  const youBlocked = blocks.some((b) => b.blockerId === viewerId);
  const theyBlocked = blocks.some((b) => b.blockerId === owner.id);
  const following = state(out?.status);
  const blockedEitherWay = youBlocked || theyBlocked;
  return {
    relationship: { self: false, following, followsYou: state(back?.status), blocked: youBlocked },
    blockedEitherWay,
    hiddenFromViewer: theyBlocked,
    canSeeReading: !blockedEitherWay && (owner.visibility === "PUBLIC" || following === "accepted"),
  };
}

/** Ids of members the viewer must never see in lists (blocked either way). */
export async function blockedIds(db: Db, viewerId: string): Promise<string[]> {
  const rows = await db.block.findMany({ where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] }, select: { blockerId: true, blockedId: true } });
  return [...new Set(rows.map((r) => (r.blockerId === viewerId ? r.blockedId : r.blockerId)))];
}
