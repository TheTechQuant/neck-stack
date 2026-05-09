import type {
  CacheCallEnd,
  LogField,
  SpanEnd,
  SpanEvent,
  SpanStart,
  StackTrace,
  TraceError,
  TraceEvent,
  TraceID,
} from "./traceTypes";

const EventType = {
  RequestSpanStart: 0x01,
  RequestSpanEnd: 0x02,
  AuthSpanStart: 0x03,
  AuthSpanEnd: 0x04,
  PubsubMessageSpanStart: 0x05,
  PubsubMessageSpanEnd: 0x06,
  DBTransactionStart: 0x07,
  DBTransactionEnd: 0x08,
  DBQueryStart: 0x09,
  DBQueryEnd: 0x0a,
  RPCCallStart: 0x0b,
  RPCCallEnd: 0x0c,
  HTTPCallStart: 0x0d,
  HTTPCallEnd: 0x0e,
  LogMessage: 0x0f,
  PubsubPublishStart: 0x10,
  PubsubPublishEnd: 0x11,
  ServiceInitStart: 0x12,
  ServiceInitEnd: 0x13,
  CacheCallStart: 0x14,
  CacheCallEnd: 0x15,
  BodyStream: 0x16,
  TestStart: 0x17,
  TestEnd: 0x18,
  BucketObjectUploadStart: 0x19,
  BucketObjectUploadEnd: 0x1a,
  BucketObjectDownloadStart: 0x1b,
  BucketObjectDownloadEnd: 0x1c,
  BucketObjectGetAttrsStart: 0x1d,
  BucketObjectGetAttrsEnd: 0x1e,
  BucketListObjectsStart: 0x1f,
  BucketListObjectsEnd: 0x20,
  BucketDeleteObjectsStart: 0x21,
  BucketDeleteObjectsEnd: 0x22,
} as const;

type TimeAnchor = { nano: bigint; real: Date };

export function parseTimeAnchor(value: string): TimeAnchor {
  const index = value.indexOf(" ");
  if (index === -1) throw new Error(`invalid time anchor format: ${value}`);
  const nano = BigInt(value.slice(0, index));
  const real = new Date(value.slice(index + 1));
  if (Number.isNaN(real.getTime())) throw new Error("invalid time anchor real time");
  return { nano, real };
}

export function parseEncoreEvents(body: Buffer, anchor: TimeAnchor, version: number): TraceEvent[] {
  const reader = new TraceReader(body, version);
  const events: TraceEvent[] = [];
  while (!reader.done()) {
    const start = reader.offset;
    const type = reader.byte();
    const eventID = reader.uint64();
    const nanotime = reader.int64();
    const traceID = reader.traceID();
    const spanID = reader.uint64();
    const len = Number(reader.uint32());
    const bodyStart = reader.offset;
    const ev: TraceEvent = {
      traceID,
      spanID,
      eventID,
      eventTime: toReal(anchor, nanotime),
    };
    switch (type) {
      case EventType.RequestSpanStart:
        ev.spanStart = reader.requestSpanStart();
        break;
      case EventType.RequestSpanEnd:
        ev.spanEnd = reader.requestSpanEnd();
        break;
      case EventType.AuthSpanStart:
        ev.spanStart = reader.authSpanStart();
        break;
      case EventType.AuthSpanEnd:
        ev.spanEnd = reader.authSpanEnd();
        break;
      case EventType.PubsubMessageSpanStart:
        ev.spanStart = reader.pubsubMessageSpanStart();
        break;
      case EventType.PubsubMessageSpanEnd:
        ev.spanEnd = reader.pubsubMessageSpanEnd();
        break;
      case EventType.TestStart:
        ev.spanStart = reader.testSpanStart();
        break;
      case EventType.TestEnd:
        ev.spanEnd = reader.testSpanEnd();
        break;
      default:
        ev.spanEvent = reader.spanEvent(type);
    }
    const consumed = reader.offset - bodyStart;
    if (consumed < len) reader.skip(len - consumed);
    if (consumed > len) throw new Error(`parser overflowed event ${type} at ${start}`);
    events.push(ev);
  }
  return events;
}

class TraceReader {
  offset = 0;

  constructor(private readonly buffer: Buffer, private readonly version: number) {}

  done() {
    return this.offset >= this.buffer.length;
  }

  skip(n: number) {
    this.offset += n;
    if (this.offset > this.buffer.length) throw new Error("unexpected EOF");
  }

  byte() {
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  bool() {
    return this.byte() !== 0;
  }

  bytes(n: number) {
    const out = this.buffer.subarray(this.offset, this.offset + n);
    this.offset += n;
    if (out.length !== n) throw new Error("unexpected EOF");
    return out;
  }

  byteString() {
    const size = Number(this.uvarint());
    return size === 0 ? Buffer.alloc(0) : this.bytes(size);
  }

  string() {
    return this.byteString().toString("utf8");
  }

  optString() {
    const value = this.string();
    return value || undefined;
  }

  uint32() {
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  int32() {
    const u = this.uint32();
    return (u & 1) === 0 ? u >>> 1 : ~(u >>> 1);
  }

  uint64() {
    const value = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  int64() {
    return unsignedToSigned(this.uint64());
  }

  uvarint() {
    let shift = 0n;
    let out = 0n;
    for (;;) {
      const b = this.byte();
      out |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return out;
      shift += 7n;
    }
  }

  varint() {
    return unsignedToSigned(this.uvarint());
  }

  float32() {
    const value = this.buffer.readFloatLE(this.offset);
    this.offset += 4;
    return value;
  }

  float64() {
    const value = this.buffer.readDoubleLE(this.offset);
    this.offset += 8;
    return value;
  }

  time() {
    const sec = this.int64();
    const nsec = this.int32();
    return new Date(Number(sec) * 1000 + nsec / 1_000_000);
  }

  traceID(): TraceID {
    const low = this.uint64();
    const high = this.uint64();
    return { low, high };
  }

  spanStartEvent() {
    const goid = Number(this.uvarint());
    const parentTraceID = this.traceID();
    const parentSpanID = this.uint64();
    const defLoc = Number(this.uvarint());
    const callerEventID = this.uvarint();
    const externalCorrelationID = this.string();
    return { goid, parentTraceID, parentSpanID, defLoc, callerEventID, externalCorrelationID };
  }

  spanEndEvent(): Omit<SpanEnd, "request" | "auth" | "pubsubMessage" | "test"> {
    const durationNanos = this.duration();
    let statusCode = 0;
    let error: TraceError | undefined;
    if (this.version >= 17) {
      statusCode = this.byte();
      error = this.errWithStack();
    } else {
      error = this.errWithStack();
      statusCode = error ? 2 : 0;
    }
    this.formattedStack();
    this.traceID();
    const parentSpanID = this.uint64();
    return {
      durationNanos: durationNanos < 0n ? 0n : durationNanos,
      statusCode,
      error,
      parentSpanID: parentSpanID === 0n ? undefined : parentSpanID,
    };
  }

  requestSpanStart(): SpanStart {
    const start = this.spanStartEvent();
    const pathParams: string[] = [];
    const request = {
      serviceName: this.string(),
      endpointName: this.string(),
      httpMethod: this.string(),
      path: this.string(),
    };
    const count = Number(this.uvarint());
    for (let i = 0; i < count; i++) pathParams.push(this.string());
    this.headers();
    this.byteString();
    this.string();
    this.string();
    if (this.version >= 15) this.bool();
    return { parentSpanID: start.parentSpanID || undefined, request };
  }

  requestSpanEnd(): SpanEnd {
    const end = this.spanEndEvent();
    const request = {
      serviceName: this.string(),
      endpointName: this.string(),
      httpStatusCode: Number(this.uvarint()),
    };
    this.headers();
    this.byteString();
    if (this.version >= 16) this.uvarint();
    if (this.version >= 17) this.optString();
    return { ...end, request };
  }

  authSpanStart(): SpanStart {
    const start = this.spanStartEvent();
    const auth = { serviceName: this.string(), endpointName: this.string() };
    this.byteString();
    return { parentSpanID: start.parentSpanID || undefined, auth };
  }

  authSpanEnd(): SpanEnd {
    const end = this.spanEndEvent();
    const auth = { serviceName: this.string(), endpointName: this.string() };
    this.string();
    this.byteString();
    return { ...end, auth };
  }

  pubsubMessageSpanStart(): SpanStart {
    const start = this.spanStartEvent();
    const pubsubMessage = {
      serviceName: this.string(),
      topicName: this.string(),
      subscriptionName: this.string(),
      messageId: this.string(),
    };
    this.uvarint();
    this.time();
    this.byteString();
    return { parentSpanID: start.parentSpanID || undefined, pubsubMessage };
  }

  pubsubMessageSpanEnd(): SpanEnd {
    const end = this.spanEndEvent();
    const pubsubMessage = {
      serviceName: this.string(),
      topicName: this.string(),
      subscriptionName: this.string(),
      messageId: this.version >= 17 ? this.string() : "",
    };
    return { ...end, pubsubMessage };
  }

  testSpanStart(): SpanStart {
    const start = this.spanStartEvent();
    const test = { serviceName: this.string(), testName: this.string() };
    this.string();
    this.string();
    this.uint32();
    return { parentSpanID: start.parentSpanID || undefined, test };
  }

  testSpanEnd(): SpanEnd {
    const end = this.spanEndEvent();
    const test = { serviceName: this.string(), testName: this.string() };
    this.bool();
    this.bool();
    if (this.version >= 17) this.optString();
    return { ...end, test };
  }

  spanEvent(type: number): SpanEvent {
    this.uvarint();
    this.uvarint();
    this.uvarint();
    switch (type) {
      case EventType.RPCCallStart:
        return { rpcCallStart: { targetServiceName: this.string(), targetEndpointName: this.string() } };
      case EventType.RPCCallEnd:
        return { rpcCallEnd: { err: this.errWithStack() } };
      case EventType.DBQueryStart:
        return { dbQueryStart: { query: this.string() } };
      case EventType.DBQueryEnd:
        return { dbQueryEnd: { err: this.errWithStack() } };
      case EventType.DBTransactionStart:
        this.stack();
        return { dbTransactionStart: {} };
      case EventType.DBTransactionEnd: {
        const completion = this.bool() ? "COMMIT" : "ROLLBACK";
        this.stack();
        return { dbTransactionEnd: { completion, err: this.errWithStack() } };
      }
      case EventType.PubsubPublishStart:
        return { pubsubPublishStart: { topic: this.string() } };
      case EventType.PubsubPublishEnd:
        return { pubsubPublishEnd: { messageId: this.optString(), err: this.errWithStack() } };
      case EventType.HTTPCallStart:
        this.uint64();
        return { httpCallStart: { method: this.string(), url: this.string() } };
      case EventType.HTTPCallEnd: {
        const statusCode = Number(this.uvarint()) || undefined;
        const err = this.errWithStack();
        this.skipHTTPTraceEvents();
        return { httpCallEnd: { statusCode, err } };
      }
      case EventType.LogMessage:
        return { logMessage: this.logMessage() };
      case EventType.CacheCallStart: {
        const operation = this.string();
        const write = this.bool();
        this.stack();
        const keys = this.stringList();
        return { cacheCallStart: { operation, write, keys } };
      }
      case EventType.CacheCallEnd:
        return { cacheCallEnd: this.cacheCallEnd() };
      case EventType.BodyStream:
        this.byte();
        this.byteString();
        return {};
      default:
        return this.skipKnownNoop(type);
    }
  }

  logMessage() {
    const level = logLevelFromRuntime(this.byte());
    const msg = this.string();
    const fields = this.logFields();
    const stack = this.stack();
    return { level, msg, fields, stack };
  }

  logFields(): LogField[] {
    const count = Number(this.uvarint());
    const fields: LogField[] = [];
    for (let i = 0; i < count; i++) {
      const type = this.byte();
      const key = this.string();
      switch (type) {
        case 1:
          fields.push({ key, error: this.errWithStack() });
          break;
        case 2:
          fields.push({ key, str: this.string() });
          break;
        case 3:
          fields.push({ key, bool: this.bool() });
          break;
        case 4:
          fields.push({ key, time: this.time() });
          break;
        case 5:
          fields.push({ key, dur: this.int64() });
          break;
        case 6:
          fields.push({ key, uuid: this.bytes(16) });
          break;
        case 7: {
          const json = this.byteString();
          const err = this.errWithStack();
          fields.push(err ? { key, error: err } : { key, json });
          break;
        }
        case 8:
          fields.push({ key, int: this.varint() });
          break;
        case 9:
          fields.push({ key, uint: this.uvarint() });
          break;
        case 10:
          fields.push({ key, float32: this.float32() });
          break;
        case 11:
          fields.push({ key, float64: this.float64() });
          break;
      }
    }
    return fields;
  }

  cacheCallEnd(): CacheCallEnd {
    const result = ["UNKNOWN", "OK", "NO_SUCH_KEY", "CONFLICT", "ERR"][this.byte()] || "UNKNOWN";
    return { result, err: this.errWithStack() };
  }

  headers() {
    const count = Number(this.uvarint());
    for (let i = 0; i < count; i++) {
      this.string();
      this.string();
    }
  }

  stringList() {
    const count = Number(this.uvarint());
    const values: string[] = [];
    for (let i = 0; i < count; i++) values.push(this.string());
    return values;
  }

  stack(): StackTrace | undefined {
    const count = this.byte();
    if (count === 0) return undefined;
    const pcs: bigint[] = [];
    let prev = 0n;
    for (let i = 0; i < count; i++) {
      prev += this.varint();
      pcs.push(prev);
    }
    return { pcs };
  }

  formattedStack(): StackTrace | undefined {
    const count = this.byte();
    if (count === 0) return undefined;
    const frames = [];
    for (let i = 0; i < count; i++) frames.push({ filename: this.string(), line: Number(this.uvarint()), func: this.string() });
    return { frames };
  }

  errWithStack(): TraceError | undefined {
    const msg = this.string();
    if (!msg) return undefined;
    return { msg, stack: this.stack() };
  }

  duration() {
    return this.varint();
  }

  skipHTTPTraceEvents() {
    const count = Number(this.uvarint());
    for (let i = 0; i < count; i++) {
      const code = this.byte();
      this.int64();
      switch (code) {
        case 1:
          this.string();
          break;
        case 2:
          this.bool(); this.bool(); this.int64();
          break;
        case 4:
          this.varint();
          break;
        case 5:
          this.string();
          break;
        case 6: {
          this.byteString();
          const addrs = Number(this.uvarint());
          for (let j = 0; j < addrs; j++) this.byteString();
          break;
        }
        case 7:
        case 8:
          this.string(); this.string();
          if (code === 8) this.byteString();
          break;
        case 10:
          this.byteString(); this.uint32(); this.uint32(); this.string(); this.string();
          break;
        case 12:
        case 14:
          this.byteString();
          break;
      }
    }
  }

  skipKnownNoop(type: number): SpanEvent {
    switch (type) {
      case EventType.ServiceInitStart:
        this.string();
        break;
      case EventType.ServiceInitEnd:
        this.errWithStack();
        break;
      case EventType.BucketObjectUploadStart:
      case EventType.BucketObjectDownloadStart:
      case EventType.BucketObjectGetAttrsStart:
      case EventType.BucketListObjectsStart:
      case EventType.BucketDeleteObjectsStart:
      case EventType.BucketObjectUploadEnd:
      case EventType.BucketObjectDownloadEnd:
      case EventType.BucketObjectGetAttrsEnd:
      case EventType.BucketListObjectsEnd:
      case EventType.BucketDeleteObjectsEnd:
        // Bucket events are not yet rendered as synthetic spans; the declared
        // event length lets the caller skip remaining bytes safely.
        break;
      default:
        throw new Error(`unknown event ${type}`);
    }
    return {};
  }
}

function unsignedToSigned(u: bigint) {
  return (u & 1n) === 0n ? u >> 1n : ~(u >> 1n);
}

function toReal(anchor: TimeAnchor, nano: bigint) {
  return new Date(anchor.real.getTime() + Number(nano - anchor.nano) / 1_000_000);
}

function logLevelFromRuntime(level: number) {
  switch (level) {
    case 1:
      return 0; // debug
    case 2:
      return 1; // info
    case 3:
      return 3; // warn
    case 4:
      return 2; // error
    default:
      return 4; // trace
  }
}
