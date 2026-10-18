import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.string().default("4000"),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().default("dev-only-secret-change-me"),
  AI_SERVICE_URL: z.string().default("http://127.0.0.1:8000"),
  AI_REQUEST_TIMEOUT_MS: z.string().default("5000")
});

export const env = envSchema.parse(process.env);
export const AI_REQUEST_TIMEOUT_MS = Number(env.AI_REQUEST_TIMEOUT_MS);
