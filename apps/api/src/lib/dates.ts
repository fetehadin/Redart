// Calendar days are stored as Postgres `date`, which Prisma hands us as UTC-midnight Dates.
import { toISO, type ISODate } from "@redart/shared";

export const toDbDate = (s: ISODate): Date => new Date(`${s}T00:00:00.000Z`);
export const fromDbDate = (d: Date): ISODate => d.toISOString().slice(0, 10);
/** Today's date where the server is. Clients send their own local "today" whenever it matters. */
export const serverToday = (): ISODate => toISO(new Date());
