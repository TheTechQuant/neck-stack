<script setup lang="ts">
import type { core } from "~/lib/encore-client.gen";

const config = useRuntimeConfig();
const client = useEncoreClient();
const health = ref<core.HealthResponse | null>(null);
const status = ref<"idle" | "pending" | "success" | "error">("idle");
const streamStatus = ref<"idle" | "connecting" | "connected" | "closed" | "error">("idle");
const streamInput = ref("hello from Nuxt");
const streamMessages = ref<core.RealtimeServerMessage[]>([]);

type RealtimeStream = Awaited<ReturnType<typeof client.core.realtime>>;

let realtimeStream: RealtimeStream | null = null;

async function refreshHealth() {
  status.value = "pending";
  try {
    health.value = await client.core.health();
    status.value = "success";
  } catch {
    health.value = null;
    status.value = "error";
  }
}

async function readRealtime(stream: RealtimeStream) {
  try {
    for await (const message of stream) {
      streamMessages.value.unshift(message);
    }
  } catch {
    streamStatus.value = "error";
  } finally {
    if (realtimeStream === stream) {
      realtimeStream = null;
    }
    if (streamStatus.value === "connected") {
      streamStatus.value = "closed";
    }
  }
}

async function connectRealtime() {
  if (!import.meta.client || realtimeStream || streamStatus.value === "connecting") return;

  streamStatus.value = "connecting";
  try {
    const stream = await client.core.realtime();
    realtimeStream = stream;
    streamStatus.value = "connected";
    stream.socket.on("close", () => {
      if (realtimeStream === stream) {
        realtimeStream = null;
      }
      streamStatus.value = "closed";
    });
    stream.socket.on("error", () => {
      if (realtimeStream === stream) {
        realtimeStream = null;
      }
      streamStatus.value = "error";
    });
    void readRealtime(stream);
  } catch {
    realtimeStream = null;
    streamStatus.value = "error";
  }
}

async function sendRealtime() {
  const text = streamInput.value.trim();
  if (!text) return;

  if (!realtimeStream) {
    await connectRealtime();
  }

  if (!realtimeStream) return;

  try {
    await realtimeStream.send({ text });
    streamInput.value = "";
  } catch {
    streamStatus.value = "error";
  }
}

onMounted(() => {
  void refreshHealth();
  void connectRealtime();
});

onBeforeUnmount(() => {
  realtimeStream?.socket.close();
  realtimeStream = null;
});
</script>

<template>
  <main class="shell">
    <section class="panel">
      <div>
        <p class="eyebrow">NECK</p>
        <h1>__APP_NAME__</h1>
      </div>

      <div class="status-grid">
        <div>
          <span>API</span>
          <strong>{{ status === "success" ? "online" : status === "error" ? "offline" : "checking" }}</strong>
        </div>
        <div>
          <span>Client</span>
          <strong>{{ health?.ok ? "typed" : "pending" }}</strong>
        </div>
        <div>
          <span>Target</span>
          <strong>{{ config.public.apiBaseUrl }}</strong>
        </div>
      </div>

      <div class="actions">
        <button type="button" :disabled="status === 'pending'" @click="refreshHealth">
          {{ status === "pending" ? "Checking" : "Refresh" }}
        </button>
        <button type="button" :disabled="streamStatus === 'connecting' || streamStatus === 'connected'" @click="connectRealtime">
          {{ streamStatus === "connected" ? "Connected" : "Connect stream" }}
        </button>
      </div>

      <section class="stream-panel" aria-labelledby="stream-title">
        <div>
          <p id="stream-title" class="stream-title">Realtime</p>
          <span>{{ streamStatus }}</span>
        </div>

        <form class="stream-form" @submit.prevent="sendRealtime">
          <input v-model="streamInput" name="message" autocomplete="off" placeholder="Message" />
          <button type="submit" :disabled="streamStatus === 'connecting'">Send</button>
        </form>

        <ul class="message-list">
          <li v-for="message in streamMessages" :key="`${message.receivedAt}-${message.text}`">
            <strong>{{ message.text }}</strong>
            <span>{{ message.receivedAt }}</span>
          </li>
          <li v-if="streamMessages.length === 0">
            <strong>No messages yet</strong>
            <span>Send one through the generated Encore client stream.</span>
          </li>
        </ul>
      </section>
    </section>
  </main>
</template>

<style scoped>
:global(body) {
  margin: 0;
  background: #f6f7f9;
  color: #121417;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
}

.panel {
  width: min(720px, 100%);
  display: grid;
  gap: 28px;
}

.eyebrow {
  margin: 0 0 8px;
  color: #53606f;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0;
}

h1 {
  margin: 0;
  font-size: clamp(40px, 8vw, 72px);
  line-height: 0.95;
  letter-spacing: 0;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.status-grid div {
  min-height: 96px;
  border: 1px solid #d8dde4;
  border-radius: 8px;
  background: #ffffff;
  padding: 18px;
  display: grid;
  align-content: space-between;
  min-width: 0;
}

span {
  color: #53606f;
  font-size: 14px;
}

strong {
  font-size: 18px;
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

button {
  width: fit-content;
  min-height: 44px;
  border: 0;
  border-radius: 8px;
  background: #121417;
  color: white;
  padding: 0 18px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

button:disabled {
  opacity: 0.65;
  cursor: wait;
}

.stream-panel {
  border: 1px solid #d8dde4;
  border-radius: 8px;
  background: #ffffff;
  display: grid;
  gap: 16px;
  padding: 18px;
}

.stream-panel > div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.stream-title {
  margin: 0;
  color: #121417;
  font-size: 18px;
  font-weight: 800;
}

.stream-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
}

input {
  min-width: 0;
  min-height: 44px;
  border: 1px solid #c6ccd5;
  border-radius: 8px;
  padding: 0 14px;
  font: inherit;
}

.message-list {
  display: grid;
  gap: 10px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.message-list li {
  min-height: 64px;
  border: 1px solid #eef0f3;
  border-radius: 8px;
  display: grid;
  gap: 6px;
  padding: 12px;
}

.message-list span {
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .shell {
    place-items: start;
    padding: 24px;
  }

  .status-grid {
    grid-template-columns: 1fr;
  }

  .stream-form {
    grid-template-columns: 1fr;
  }
}
</style>
