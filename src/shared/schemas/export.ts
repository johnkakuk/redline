import { z } from 'zod';

export const EXPORT_APP = 'redline';

export const ExportFile = z.object({
  app: z.literal(EXPORT_APP),
  schemaVersion: z.number().int().positive(),
  exportedAt: z.string(),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});
export type ExportFile = z.infer<typeof ExportFile>;
