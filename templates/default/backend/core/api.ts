import { api } from "encore.dev/api";
import log from "encore.dev/log";

// HealthResponse describes the current backend health status.
interface HealthResponse {
  // Whether the backend is reachable and serving requests.
  ok: boolean;
}

// RealtimeClientMessage is sent from the Nuxt app over the generated Encore client stream.
interface RealtimeClientMessage {
  // Client-provided message text.
  text: string;
}

// RealtimeServerMessage is sent by the backend over the realtime stream.
interface RealtimeServerMessage {
  // Server-generated response text.
  text: string;

  // ISO 8601 timestamp for when the backend handled the message.
  receivedAt: string;
}

const logger = log.with({ service: "core" });

export function formatRealtimeReply(
  message: RealtimeClientMessage,
  receivedAt = new Date().toISOString(),
): RealtimeServerMessage {
  return {
    text: `Echo: ${message.text}`,
    receivedAt,
  };
}

// Health reports whether the backend is available.
// The frontend calls this endpoint through the generated Encore client.
export const health = api(
  { expose: true, method: "GET", path: "/health" },
  async (): Promise<HealthResponse> => {
    logger.info("health check", { endpoint: "health" });

    return { ok: true };
  },
);

// Realtime opens a bidirectional stream for low-latency frontend updates.
// Replace the echo behavior with Pub/Sub or another event source when broadcasting across workers or instances.
export const realtime = api.streamInOut<RealtimeClientMessage, RealtimeServerMessage>(
  { expose: true, path: "/realtime" },
  async (stream) => {
    try {
      for await (const message of stream) {
        logger.info("realtime message", { endpoint: "realtime" });
        await stream.send(formatRealtimeReply(message));
      }
    } catch (error) {
      logger.error(error, "realtime stream failed", { endpoint: "realtime" });
    }
  },
);
