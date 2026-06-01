import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { environments } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const EnvironmentInputSchema = z.object({
  name: z.string().min(1, "Environment name is required"),
  gpuModel: z.string().optional().nullable(),
  gpuCount: z.number().int().nonnegative().optional().nullable(),
  inferenceEngine: z.string().optional().nullable(),
  engineVersion: z.string().optional().nullable(),
  quantization: z.string().optional().nullable(),
  maxModelLen: z.number().int().nonnegative().optional().nullable(),
  gpuMemoryUtilization: z.number().min(0).max(1).optional().nullable(),
  prometheusUrl: z.string().optional().nullable(),
});

export const environmentRouter = router({
  // Get all environments for current user
  getEnvironments: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    return db
      .select()
      .from(environments)
      .where(eq(environments.userId, ctx.user.id));
  }),

  // Create environment
  createEnvironment: protectedProcedure
    .input(EnvironmentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const result = await db.insert(environments).values({
        userId: ctx.user.id,
        name: input.name,
        gpuModel: input.gpuModel || null,
        gpuCount: input.gpuCount || null,
        inferenceEngine: input.inferenceEngine || null,
        engineVersion: input.engineVersion || null,
        quantization: input.quantization || null,
        maxModelLen: input.maxModelLen || null,
        gpuMemoryUtilization: input.gpuMemoryUtilization ? input.gpuMemoryUtilization.toString() : null,
        prometheusUrl: input.prometheusUrl || null,
      });

      const insertId = (result as any)[0]?.insertId;
      return { success: true, id: insertId };
    }),

  // Update environment
  updateEnvironment: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        data: EnvironmentInputSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Verify ownership
      const existing = await db
        .select()
        .from(environments)
        .where(eq(environments.id, input.id));

      if (existing.length === 0 || existing[0].userId !== ctx.user.id) {
        throw new Error("Unauthorized or environment not found");
      }

      await db
        .update(environments)
        .set({
          name: input.data.name,
          gpuModel: input.data.gpuModel || null,
          gpuCount: input.data.gpuCount || null,
          inferenceEngine: input.data.inferenceEngine || null,
          engineVersion: input.data.engineVersion || null,
          quantization: input.data.quantization || null,
          maxModelLen: input.data.maxModelLen || null,
          gpuMemoryUtilization: input.data.gpuMemoryUtilization ? input.data.gpuMemoryUtilization.toString() : null,
          prometheusUrl: input.data.prometheusUrl || null,
          updatedAt: new Date(),
        })
        .where(eq(environments.id, input.id));

      return { success: true };
    }),

  // Delete environment
  deleteEnvironment: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Verify ownership
      const existing = await db
        .select()
        .from(environments)
        .where(eq(environments.id, input.id));

      if (existing.length === 0 || existing[0].userId !== ctx.user.id) {
        throw new Error("Unauthorized or environment not found");
      }

      await db.delete(environments).where(eq(environments.id, input.id));

      return { success: true };
    }),
});
