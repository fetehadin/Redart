import type { Db } from "../db";
import type { NotificationKind } from "../generated/prisma/client";

/** Record an in-app notification. Never notify yourself; collapse repeats of the same follow event. */
export async function notify(db: Db, userId: string, actorId: string, kind: NotificationKind, recommendationId?: string): Promise<void> {
  if (userId === actorId) return;
  if (kind !== "RECOMMENDATION") await db.notification.deleteMany({ where: { userId, actorId, kind } });
  await db.notification.create({ data: { userId, actorId, kind, recommendationId: recommendationId ?? null } });
}
