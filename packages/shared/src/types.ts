// Shapes of API responses shared by the web app and the API.

export type ApiErrorCode = "NOT_FOUND" | "VALIDATION" | "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "RATE_LIMITED" | "INTERNAL";
export interface ApiErrorBody { error: { code: ApiErrorCode; message: string; fields?: Record<string, string> } }

export type AccountVisibility = "PUBLIC" | "PRIVATE";

export interface Me {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  bio: string;
  visibility: AccountVisibility;
  topics: string[];
  isAdmin: boolean;
  createdAt: string;
}

export interface AuthOptions { passwordReset: boolean }

export interface ImportResult { plansCreated: number; plansMerged: number; articlesAdded: number; favoritesAdded: number }

/* ---------- people ---------- */

export type FollowState = "none" | "pending" | "accepted";

/** How the viewer relates to a profile. */
export interface Relationship {
  self: boolean;
  /** viewer -> them */
  following: FollowState;
  /** them -> viewer */
  followsYou: FollowState;
  /** the viewer has blocked them */
  blocked: boolean;
}

export interface UserCard {
  handle: string;
  displayName: string;
  bio: string;
  visibility: AccountVisibility;
  relationship: Relationship | null; // null for guests
}

export interface ReadingStats {
  articlesRead: number;
  minutesRead: number;
  articlesThisMonth: number;
  minutesThisMonth: number;
}

export interface Profile extends UserCard {
  followers: number;
  following: number;
  joinedAt: string;
  /** False when the viewer may only see the header (private account, guest viewer, or blocked). */
  canSeeReading: boolean;
  stats: ReadingStats | null;
}

/** A plan as followers see it: progress, never notes or pace. */
export interface PlanSummary {
  id: string;
  name: string;
  start: string;
  days: number;
  total: number;
  done: number;
  minutesAll: number;
  minutesDone: number;
}

export interface FinishedItem {
  id: string;
  title: string;
  url: string;
  topic: string;
  minutes: number;
  doneAt: string;
  planName: string;
}

export interface PublicFavorite {
  id: string;
  title: string;
  url: string;
  topic: string;
  minutes: number;
  savedAt: string;
}

export interface Page<T> { items: T[]; nextCursor: string | null }

/* ---------- feed, recommendations, notifications ---------- */

export interface ArticleRef { title: string; url: string; minutes: number | null; topic: string }

export type FeedItem =
  | { id: string; kind: "FINISHED"; createdAt: string; actor: UserCard; article: ArticleRef; planName: string }
  | { id: string; kind: "FAVORITED"; createdAt: string; actor: UserCard; article: ArticleRef }
  | { id: string; kind: "RECOMMENDED"; createdAt: string; actor: UserCard; article: ArticleRef; message: string }
  | { id: string; kind: "STARTED_PLAN"; createdAt: string; actor: UserCard; planName: string; days: number; articles: number }
  | { id: string; kind: "JOINED_CHALLENGE"; createdAt: string; actor: UserCard; challenge: { slug: string; title: string }; track: string };

export interface InboxRecommendation {
  id: string;
  from: UserCard;
  article: ArticleRef;
  message: string;
  createdAt: string;
  read: boolean;
}

export type NotificationItem =
  | { id: string; kind: "NEW_FOLLOWER" | "FOLLOW_REQUEST" | "FOLLOW_ACCEPTED"; actor: UserCard; createdAt: string; read: boolean }
  | { id: string; kind: "RECOMMENDATION"; actor: UserCard; createdAt: string; read: boolean; recommendation: InboxRecommendation };

export interface QuickAddResult { planName: string; due: string; duplicate: boolean }
