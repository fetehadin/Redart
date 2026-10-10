import type { Mailer } from "./services/mail";

/** Runtime settings the routes need, separate from process.env so tests can build them directly. */
export interface AppConfig {
  appOrigin: string;
  cookieName: string;
  secureCookies: boolean;
  adminEmails: string[];
  mailer: Mailer | null;
}
