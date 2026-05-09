import type { StreamOut } from "encore.dev/api";
import type { LiveEvent } from "./types";

const streams = new Set<StreamOut<LiveEvent>>();

export async function serveLiveEvents(stream: StreamOut<LiveEvent>) {
  streams.add(stream);
  try {
    await stream.send(liveEvent("ready"));
    for (;;) {
      await sleep(1000);
      await stream.send(liveEvent("tick"));
    }
  } finally {
    streams.delete(stream);
  }
}

export function publishLiveEvent(type: string) {
  const event = liveEvent(type);
  for (const stream of streams) {
    void stream.send(event).catch(() => streams.delete(stream));
  }
}

function liveEvent(type: string): LiveEvent {
  return { type, time: new Date().toISOString() };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
