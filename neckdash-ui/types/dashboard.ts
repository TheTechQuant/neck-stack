export type TraceSummary = {
  traceId: string;
  service: string;
  endpoint: string;
  startedAt: string;
  durationMs: number;
  spanCount: number;
  error: boolean;
  statusCode: number;
  environment: string;
};

export type SpanSummary = {
  spanId: string;
  parentSpanId: string;
  spanType: string;
  kind: string;
  name: string;
  serviceName: string;
  endpointName: string;
  topicName: string;
  subscriptionName: string;
  messageId: string;
  startedAt: string;
  durationMs: number;
  statusCode: number;
  isError: boolean;
  attributes: Record<string, string>;
  logs: SpanLog[];
};

export type TraceEvent = {
  spanId: string;
  eventId: string;
  eventType: string;
  eventTime: string;
  eventJson: string;
};

export type SpanLog = {
  timestamp: string;
  level: string;
  message: string;
  fields: Record<string, string>;
};
