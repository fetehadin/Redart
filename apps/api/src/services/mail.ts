import nodemailer from "nodemailer";

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export interface SmtpSettings { host: string; port: number; user?: string; pass?: string; from: string }

export function smtpMailer(s: SmtpSettings): Mailer {
  const transport = nodemailer.createTransport({
    host: s.host, port: s.port, secure: s.port === 465,
    auth: s.user ? { user: s.user, pass: s.pass ?? "" } : undefined,
  });
  return { send: async (to, subject, text) => { await transport.sendMail({ from: s.from, to, subject, text }); } };
}
