export interface TraceRequestMeta {
  appID: string;
  envID: string;
  deployID: string;
  appCommit: string;
}

export interface TraceID {
  high: bigint;
  low: bigint;
}

export interface TraceEvent {
  traceID: TraceID;
  spanID: bigint;
  eventID: bigint;
  eventTime: Date;
  spanStart?: SpanStart;
  spanEnd?: SpanEnd;
  spanEvent?: SpanEvent;
}

export interface SpanStart {
  parentSpanID?: bigint;
  request?: RequestSpanStart;
  auth?: AuthSpanStart;
  pubsubMessage?: PubsubMessageSpanStart;
  test?: TestSpanStart;
}

export interface SpanEnd {
  durationNanos: bigint;
  statusCode: number;
  error?: TraceError;
  parentSpanID?: bigint;
  request?: RequestSpanEnd;
  auth?: AuthSpanEnd;
  pubsubMessage?: PubsubMessageSpanEnd;
  test?: TestSpanEnd;
}

export interface SpanEvent {
  logMessage?: LogMessage;
  rpcCallStart?: RPCCallStart;
  rpcCallEnd?: RPCCallEnd;
  dbTransactionStart?: {};
  dbTransactionEnd?: DBTransactionEnd;
  dbQueryStart?: DBQueryStart;
  dbQueryEnd?: DBQueryEnd;
  httpCallStart?: HTTPCallStart;
  httpCallEnd?: HTTPCallEnd;
  pubsubPublishStart?: PubsubPublishStart;
  pubsubPublishEnd?: PubsubPublishEnd;
  cacheCallStart?: CacheCallStart;
  cacheCallEnd?: CacheCallEnd;
}

export interface RequestSpanStart {
  serviceName: string;
  endpointName: string;
  httpMethod: string;
  path: string;
}

export interface RequestSpanEnd {
  serviceName: string;
  endpointName: string;
  httpStatusCode: number;
}

export interface AuthSpanStart {
  serviceName: string;
  endpointName: string;
}

export interface AuthSpanEnd {
  serviceName: string;
  endpointName: string;
}

export interface PubsubMessageSpanStart {
  serviceName: string;
  topicName: string;
  subscriptionName: string;
  messageId: string;
}

export interface PubsubMessageSpanEnd {
  serviceName: string;
  topicName: string;
  subscriptionName: string;
  messageId: string;
}

export interface TestSpanStart {
  serviceName: string;
  testName: string;
}

export interface TestSpanEnd {
  serviceName: string;
  testName: string;
}

export interface RPCCallStart {
  targetServiceName: string;
  targetEndpointName: string;
}

export interface RPCCallEnd {
  err?: TraceError;
}

export interface DBQueryStart {
  query: string;
}

export interface DBQueryEnd {
  err?: TraceError;
}

export interface DBTransactionEnd {
  completion: "COMMIT" | "ROLLBACK";
  err?: TraceError;
}

export interface HTTPCallStart {
  method: string;
  url: string;
}

export interface HTTPCallEnd {
  statusCode?: number;
  err?: TraceError;
}

export interface PubsubPublishStart {
  topic: string;
}

export interface PubsubPublishEnd {
  messageId?: string;
  err?: TraceError;
}

export interface CacheCallStart {
  operation: string;
  keys: string[];
  write: boolean;
}

export interface CacheCallEnd {
  result: string;
  err?: TraceError;
}

export interface LogMessage {
  level: number;
  msg: string;
  fields: LogField[];
  stack?: StackTrace;
}

export interface LogField {
  key: string;
  error?: TraceError;
  str?: string;
  bool?: boolean;
  time?: Date;
  dur?: bigint;
  uuid?: Buffer;
  json?: Buffer;
  int?: bigint;
  uint?: bigint;
  float32?: number;
  float64?: number;
}

export interface StackTrace {
  pcs?: bigint[];
  frames?: Array<{ filename: string; line: number; func: string }>;
}

export interface TraceError {
  msg: string;
  stack?: StackTrace;
}

export interface SpanBuilder {
  traceID: string;
  spanID: string;
  parentSpanID: string;
  name: string;
  service: string;
  endpoint: string;
  topic: string;
  subscription: string;
  kind: number;
  start: Date;
  end: Date;
  statusCode: number;
  error: string;
  synthetic: boolean;
  attributes: OTLPAttribute[];
  events: OTLPEvent[];
}

export interface OTLPRequest {
  resourceSpans: OTLPResourceSpan[];
}

export interface OTLPResourceSpan {
  resource: { attributes: OTLPAttribute[] };
  scopeSpans: Array<{ scope: { name: string; version: string }; spans: OTLPSpan[] }>;
}

export interface OTLPSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: OTLPAttribute[];
  events?: OTLPEvent[];
  status: { code?: number; message?: string };
}

export interface OTLPEvent {
  timeUnixNano: string;
  name: string;
  attributes?: OTLPAttribute[];
}

export interface OTLPAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string;
    doubleValue?: number;
    boolValue?: boolean;
  };
}
