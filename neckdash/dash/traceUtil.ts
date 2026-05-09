import crypto from "node:crypto";
import type { OTLPAttribute, SpanBuilder, TraceError, TraceID } from "./traceTypes";

export function hexTraceID(id: TraceID | undefined) {
  if (!id) return "";
  const buffer = Buffer.alloc(16);
  buffer.writeBigUInt64LE(id.low, 0);
  buffer.writeBigUInt64LE(id.high, 8);
  return buffer.toString("hex");
}

export function hexSpanID(id: bigint | undefined) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(id || 0n, 0);
  return buffer.toString("hex");
}

export function syntheticSpanID(parentSpanID: string, index: number) {
  return crypto.createHash("sha256").update(`${parentSpanID}:${index}`).digest("hex").slice(0, 16);
}

export function stringAttr(key: string, value: string): OTLPAttribute {
  return { key, value: { stringValue: value } };
}

export function intAttr(key: string, value: bigint | number): OTLPAttribute {
  return { key, value: { intValue: String(value) } };
}

export function boolAttr(key: string, value: boolean): OTLPAttribute {
  return { key, value: { boolValue: value } };
}

export function doubleAttr(key: string, value: number): OTLPAttribute {
  return { key, value: { doubleValue: value } };
}

export function errorMessage(err: TraceError | undefined) {
  return err?.msg || "";
}

export function firstSQLVerb(query: string) {
  return (query.trim().split(/\s+/)[0] || "").toUpperCase();
}

export function httpHost(rawURL: string) {
  try {
    return new URL(rawURL).hostname;
  } catch {
    return "";
  }
}

export function httpPath(rawURL: string) {
  try {
    return new URL(rawURL).pathname || rawURL;
  } catch {
    return rawURL;
  }
}

export function status(span: SpanBuilder) {
  if (span.error) return { code: 2, message: span.error };
  return { code: 1 };
}

export function unixNano(date: Date) {
  return BigInt(date.getTime()) * 1_000_000n;
}
