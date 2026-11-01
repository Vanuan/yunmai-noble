import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

export const MessageTypes = {
  HELLO: "hello",
  MEASURING: "measurement.measuring",
  COMPLETED: "measurement.completed",
  STATUS: "status",
  ERROR: "error",
} as const;

export type MessageType = (typeof MessageTypes)[keyof typeof MessageTypes];

const isoDateTime = z.iso.datetime();

const envelope = {
  v: z.literal(PROTOCOL_VERSION),
  deviceId: z.string().min(1),
  sentAt: isoDateTime,
};

export const HelloPayloadSchema = z.object({
  capabilities: z.array(z.string().min(1)),
});

export const MeasuringPayloadSchema = z.object({
  measuredAt: isoDateTime,
  weight: z.number().int().min(0).max(65535),
});

export const CompletedPayloadSchema = z.object({
  measuredAt: isoDateTime,
  userId: z.number().int().min(0).max(0xffffffff),
  weight: z.number().int().min(0).max(65535),
  resistance: z.number().int().min(0).max(65535),
  fatPercentage: z.number().int().min(0).max(65535),
  historical: z.boolean(),
  firmwareVersion: z.number().int().min(0).max(255),
});

export const BluetoothStateSchema = z.enum([
  "poweredOn",
  "poweredOff",
  "resetting",
  "unauthorized",
  "unsupported",
  "unknown",
]);

export const StatusPayloadSchema = z.object({
  bluetooth: BluetoothStateSchema,
  scanning: z.boolean(),
  connected: z.boolean(),
  peripheralName: z.string().min(1).nullable(),
});

export const ErrorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
});

export const HelloMessageSchema = z.object({
  ...envelope,
  type: z.literal(MessageTypes.HELLO),
  payload: HelloPayloadSchema,
});

export const MeasuringMessageSchema = z.object({
  ...envelope,
  type: z.literal(MessageTypes.MEASURING),
  payload: MeasuringPayloadSchema,
});

export const CompletedMessageSchema = z.object({
  ...envelope,
  type: z.literal(MessageTypes.COMPLETED),
  payload: CompletedPayloadSchema,
});

export const StatusMessageSchema = z.object({
  ...envelope,
  type: z.literal(MessageTypes.STATUS),
  payload: StatusPayloadSchema,
});

export const ErrorMessageSchema = z.object({
  ...envelope,
  type: z.literal(MessageTypes.ERROR),
  payload: ErrorPayloadSchema,
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  HelloMessageSchema,
  MeasuringMessageSchema,
  CompletedMessageSchema,
  StatusMessageSchema,
  ErrorMessageSchema,
]);

export type HelloMessage = z.infer<typeof HelloMessageSchema>;
export type MeasuringMessage = z.infer<typeof MeasuringMessageSchema>;
export type CompletedMessage = z.infer<typeof CompletedMessageSchema>;
export type StatusMessage = z.infer<typeof StatusMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export function parseServerMessage(input: unknown): ServerMessage {
  return ServerMessageSchema.parse(input);
}

export function safeParseServerMessage(input: unknown) {
  return ServerMessageSchema.safeParse(input);
}
