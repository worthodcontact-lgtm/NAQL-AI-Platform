import { z } from "zod";

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const CreateShipmentSchema = z.object({
  originPortId: z.string().min(1),
  destinationPortId: z.string().min(1),
  mode: z.enum(["SEA", "AIR", "LAND", "RAIL", "MULTIMODAL"]),
  incoterm: z.enum(["EXW", "FCA", "FOB", "CFR", "CIF", "DAP", "DDP"]),
  cargoDescription: z.string().min(3),
  weightKg: z.number().positive(),
  volumeCbm: z.number().positive().optional()
});

export const LandedCostSchema = z.object({
  productCost: z.number().nonnegative(),
  freight: z.number().nonnegative(),
  insurance: z.number().nonnegative(),
  customsDutyRate: z.number().min(0).max(1),
  taxRate: z.number().min(0).max(1),
  fees: z.number().nonnegative(),
  currency: z.string().length(3)
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type CreateShipmentInput = z.infer<typeof CreateShipmentSchema>;
export type LandedCostInput = z.infer<typeof LandedCostSchema>;
