import { z } from "zod";
// Local avatar glyphs avoid fetching untrusted URLs or copying vendor identities.
export const personalProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    avatar: z.enum(["spark", "leaf", "star", "sun"]).default("spark"),
    purpose: z.string().trim().min(1).max(2000),
    preferences: z.string().trim().max(4000).default(""),
  })
  .strict();
export type PersonalProfile = z.infer<typeof personalProfileSchema>;
