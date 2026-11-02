import { z } from "zod";

export const MeasurementQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  userId: z.coerce.number().int().min(0).max(0xffffffff).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.iso.datetime().optional(),
});

export type MeasurementQuery = z.infer<typeof MeasurementQuerySchema>;

export const LatestQuerySchema = z.object({
  userId: z.coerce.number().int().min(0).max(0xffffffff).optional(),
});

export type LatestQuery = z.infer<typeof LatestQuerySchema>;

export const MeasurementDtoSchema = z.object({
  id: z.number().int(),
  deviceId: z.string(),
  scaleDate: z.iso.datetime(),
  receivedAt: z.iso.datetime(),
  userId: z.number().int(),
  weightKg: z.number(),
  resistance: z.number().int(),
  fatPercentage: z.number().int(),
  historical: z.boolean(),
  firmwareVersion: z.number().int().nullable(),
});

export type MeasurementDto = z.infer<typeof MeasurementDtoSchema>;

export const MeasurementsResponseSchema = z.object({
  measurements: z.array(MeasurementDtoSchema),
  next: z.iso.datetime().nullable(),
});

export const LatestResponseSchema = MeasurementDtoSchema;

export const DeviceDtoSchema = z.object({
  id: z.string(),
  lastSeenAt: z.iso.datetime(),
  firmwareVersion: z.number().int().nullable(),
  model: z.string().nullable(),
});

export const DevicesResponseSchema = z.object({
  devices: z.array(DeviceDtoSchema),
});

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.object({ ok: z.boolean() }),
  upstream: z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    lastMessageAt: z.iso.datetime().nullable(),
    lastError: z.string().nullable(),
  }),
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

const LegacyMeasuringSchema = z.object({
  firmwareVersion: z.number().int().optional(),
  packetType: z.literal("measuring"),
  data: z.object({
    date: z.number().int(),
    weight: z.number().int().min(0).max(65535),
  }),
});

const LegacyMeasuredSchema = z.object({
  firmwareVersion: z.number().int(),
  packetType: z.literal("measured"),
  data: z.object({
    historicalInfo: z.number().int(),
    date: z.number().int(),
    userId: z.number().int(),
    weight: z.number().int().min(0).max(65535),
    resistance: z.number().int(),
    fatPercentage: z.number().int(),
  }),
});

export const LegacyMessageSchema = z.union([
  LegacyMeasuringSchema,
  LegacyMeasuredSchema,
]);

export type LegacyMessage = z.infer<typeof LegacyMessageSchema>;
