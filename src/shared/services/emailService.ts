/**
 * Email Dispatch Service with SMTP / Gmail App Password support (MOV-227 / MOV-230)
 *
 * Sends real HTML emails to caregivers when SMTP credentials exist in environment variables.
 * Gracefully logs if credentials are not configured.
 */

import nodemailer from 'nodemailer';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendRealEmail(options: SendEmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const user = process.env.SMTP_EMAIL || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.log(`[EmailService] No SMTP_EMAIL / SMTP_PASSWORD configured. Simulating dispatch to ${options.to}`);
    return { success: true, messageId: 'SIMULATED_NO_SMTP_CREDENTIALS' };
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user,
        pass,
      },
    });

    const info = await transporter.sendMail({
      from: `"MoreAble Safety Network" <${user}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    console.log(`[EmailService] Real Email sent to ${options.to} (MessageId: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error(`[EmailService] Failed to send email to ${options.to}:`, error);
    return { success: false, error: error.message };
  }
}
