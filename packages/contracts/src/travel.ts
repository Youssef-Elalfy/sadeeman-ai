import { z } from "zod";

// Public research terms only: contact details, URLs and document identifiers are not queries.
export const ResearchText = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .refine(
    (s) =>
      !/@|https?:|www\.|\d[\d\s()+-]{7,}\d|passport\s*(no|number)|رقم\s*(الجواز|الباسبور)/iu.test(
        s,
      ),
  );
export const TravelSource = z.strictObject({
  id: z.string().regex(/^src_[a-f0-9]{16}$/),
  url: z.url().max(2048),
  title: z.string().max(180),
  excerpt: z.string().max(1200),
  score: z.number().min(0).max(1).nullable(),
  retrievedAt: z.iso.datetime(),
  publicationEstimateAt: z.iso.datetime().nullable(),
  publicationDateBasis: z.literal("provider_estimate_or_unknown"),
  authority: z.enum(["official_government", "official_tourism", "publisher"]),
  urlBasis: z.literal("search_provider_url_not_publisher_canonical_verified"),
});
export type TravelSource = z.infer<typeof TravelSource>;
export const DestinationResearch = z.strictObject({
  destination: ResearchText,
  focus: z
    .enum(["overview", "culture", "nature", "family", "logistics"])
    .default("overview"),
  interests: z.array(ResearchText).max(6).default([]),
});
export const ExternalTravelQuery = z.strictObject({
  destination: ResearchText,
  departureCity: ResearchText.optional(),
  listingType: z
    .enum(["package", "hotel_only", "flights_only", "activity"])
    .default("package"),
});
export const TravelRequirements = z.strictObject({
  destination: ResearchText,
  nationality: ResearchText,
  residenceCountry: ResearchText.optional(),
  purpose: z.enum(["tourism", "business", "transit"]).default("tourism"),
});
export const ItineraryRequest = z
  .strictObject({
    destination: ResearchText,
    days: z.number().int().min(1).max(14),
    pace: z.enum(["relaxed", "balanced", "active"]).default("balanced"),
    interests: z.array(ResearchText).max(6).default([]),
    sourceIds: z
      .array(z.string().regex(/^src_[a-f0-9]{16}$/))
      .min(1)
      .max(12),
    dailyBudgetMinor: z.number().int().min(0).max(1000000000).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .refine(
    (v) => (v.dailyBudgetMinor === undefined) === (v.currency === undefined),
  );
const CostItem = z.strictObject({
  label: z.string().min(1).max(100),
  unitAmountMinor: z.number().int().min(0).max(1000000000),
  quantity: z.number().int().min(1).max(1000),
});
export const TravelComparison = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  totalBudgetMinor: z.number().int().min(0).max(1000000000000),
  travellers: z.number().int().min(1).max(100),
  options: z
    .array(
      z.strictObject({
        destination: ResearchText,
        days: z.number().int().min(1).max(90),
        items: z.array(CostItem).min(1).max(30),
        assumptions: z.array(z.string().min(1).max(200)).min(1).max(10),
        sourceIds: z
          .array(z.string().regex(/^src_[a-f0-9]{16}$/))
          .max(12)
          .default([]),
      }),
    )
    .min(2)
    .max(5),
});
export const ResearchData = z.strictObject({
  kind: z.enum([
    "destination_research",
    "external_listing",
    "entry_requirements",
  ]),
  destination: ResearchText,
  sources: z.array(TravelSource).min(1).max(5),
  retrievedAt: z.iso.datetime(),
  availability: z.literal("unverified"),
  bookable: z.literal(false),
  liveInventory: z.literal(false),
  prices: z.null(),
  instructions: z.literal("UNTRUSTED_SOURCE_DATA"),
  eligibility: z.literal("not_determined").optional(),
  jurisdictionScope: z.string().max(200).optional(),
});
