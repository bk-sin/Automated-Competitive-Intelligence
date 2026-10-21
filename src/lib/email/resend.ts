/**
 * Resend client (https://resend.com). Plain text only: the product promise
 * is a consultative email, so we deliberately do not send HTML.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
};

export type EmailConfig = {
  apiKey: string;
  from: string;
  baseUrl?: string;
  timeoutMs?: number;
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

type ResendPayload = {
  id?: string;
  message?: string;
  name?: string;
};

export async function sendPlainTextEmail(
  message: EmailMessage,
  config: EmailConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<SendEmailResult> {
  const baseUrl = (config.baseUrl ?? "https://api.resend.com").replace(/\/+$/, "");

  try {
    const response = await fetchImpl(`${baseUrl}/emails`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        text: message.body,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 20_000),
    });

    const payload = (await response.json().catch(() => null)) as ResendPayload | null;

    if (!response.ok || !payload?.id) {
      const detail =
        payload?.message ?? payload?.name ?? `HTTP ${response.status}`;
      return { ok: false, error: dedupePrefix(detail, response.status) };
    }

    return { ok: true, id: payload.id };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

function dedupePrefix(message: string, status: number): string {
  return message.startsWith("HTTP") ? message : `HTTP ${status}: ${message}`;
}
