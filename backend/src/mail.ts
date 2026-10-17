import nodemailer from 'nodemailer';
import type { Config } from './config.ts';

export type Mailer = (to: string, subject: string, text: string) => Promise<void>;

/**
 * SMTP from SMTP_URL (e.g. smtps://user:password@smtp.gmail.com:465). Without it, development prints the message to the log
 * and production has no mailer, so features that need email answer "unavailable" instead of failing silently.
 */
export function createMailer(config: Config): Mailer | null {
  if (!config.smtpUrl) {
    if (config.production) return null;
    return async (to, subject, text) => console.log(`[mail to ${to}] ${subject}\n${text}`);
  }
  const transport = nodemailer.createTransport(config.smtpUrl);
  return async (to, subject, text) => {
    await transport.sendMail({ from: config.mailFrom, to, subject, text });
  };
}
