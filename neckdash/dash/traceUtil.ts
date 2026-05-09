import crypto from "node:crypto";
import type { OTLPAttribute, SpanBuilder, TraceError, TraceID } from "./traceTypes";

const encoreTraceAlphabet = "0123456789abcdefghijklmnopqrstuv";

export function hexTraceID(id: TraceID | undefined) {
  if (!id) return "";
  return traceIDBytes(id).toString("hex");
}

export function encoreTraceID(id: TraceID | undefined) {
  if (!id) return "";
  const bytes = traceIDBytes(id);
  let out = "";
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += encoreTraceAlphabet[(value >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += encoreTraceAlphabet[(value << (5 - bits)) & 31];
  return out;
}

function traceIDBytes(id: TraceID) {
  const buffer = Buffer.alloc(16);
  buffer.writeBigUInt64LE(id.low, 0);
  buffer.writeBigUInt64LE(id.high, 8);
  return buffer;
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
