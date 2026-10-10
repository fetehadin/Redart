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
