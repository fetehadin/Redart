// Activity rows feed other readers' feeds. They never carry notes.
import type { Tx } from "../db";
import type { Prisma } from "../generated/prisma/client";

type Json = Prisma.InputJsonValue;

export async function recordFinished(tx: Tx, userId: string, planId: string, a: { id: string; title: string; url: string; minutes: number; topic: string }, planName: string) {
  // One entry per article, even when it's ticked, unticked and ticked again.
  await clearFinished(tx, a.id);
  await tx.activity.create({
    data: { userId, planId, kind: "FINISHED", payload: { articleId: a.id, title: a.title, url: a.url, minutes: a.minutes, topic: a.topic, planName } satisfies Json },
  });
}

export const clearFinished = (tx: Tx, articleId: string) =>
  tx.activity.deleteMany({ where: { kind: "FINISHED", payload: { path: ["articleId"], equals: articleId } } });

export async function recordFavorited(tx: Tx, userId: string, f: { articleKey: string; title: string; url: string; minutes: number; topic: string }) {
  await clearFavorited(tx, userId, f.articleKey);
  await tx.activity.create({
    data: { userId, kind: "FAVORITED", payload: { articleKey: f.articleKey, title: f.title, url: f.url, minutes: f.minutes, topic: f.topic } satisfies Json },
  });
}

export const clearFavorited = (tx: Tx, userId: string, articleKey: string) =>
  tx.activity.deleteMany({ where: { userId, kind: "FAVORITED", payload: { path: ["articleKey"], equals: articleKey } } });

export async function recordStartedPlan(tx: Tx, userId: string, plan: { id: string; name: string; days: number; articles: number }) {
  await tx.activity.create({
    data: { userId, planId: plan.id, kind: "STARTED_PLAN", payload: { name: plan.name, days: plan.days, articles: plan.articles } satisfies Json },
  });
}
