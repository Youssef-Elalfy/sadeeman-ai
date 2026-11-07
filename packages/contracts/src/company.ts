import { z } from "zod";

const text = z.string().trim().min(1).max(200);
export const CompanyPackage = z
  .strictObject({
    id: z.uuid(),
    code: text,
    title: text,
    destination: text,
    aliases: z.array(text).max(12).default([]),
    description: z.string().max(1200).nullable(),
    days: z.number().int().min(1).max(90),
    nights: z.number().int().min(0).max(89).nullable(),
    price: z.strictObject({
      amountMinor: z.number().int().min(0).max(1000000000000).nullable(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable(),
      basis: z.enum(["per_adult", "per_person", "party_total", "unknown"]),
      forTravellers: z.number().int().min(1).max(100).nullable(),
      verifiedAt: z.iso.datetime().nullable(),
    }),
    departures: z
      .array(
        z.strictObject({
          startsOn: z.iso.date(),
          endsOn: z.iso.date().nullable(),
          availability: z.literal("unverified"),
          note: z.string().max(200).nullable(),
        }),
      )
      .max(20),
    inclusions: z.array(text).max(20),
    exclusions: z.array(text).max(20),
    activities: z
      .array(
        z.strictObject({
          day: z.number().int().min(1).max(90).nullable(),
          title: text,
          description: z.string().max(300).nullable(),
        }),
      )
      .max(10),
    isDemo: z.boolean(),
    status: z.enum(["draft", "published", "archived"]),
    approval: z.strictObject({
      sourceRef: z.string().trim().min(1).max(200).nullable(),
      verifiedAt: z.iso.datetime().nullable(),
    }),
  })
  .refine((p) => p.nights === null || p.nights < p.days)
  .refine((p) =>
    p.activities.every(
      (activity) => activity.day === null || activity.day <= p.days,
    ),
  )
  .refine((p) =>
    p.departures.every(
      (departure) =>
        departure.endsOn === null || departure.endsOn >= departure.startsOn,
    ),
  )
  .refine(
    (p) =>
      p.price.amountMinor === null ||
      (p.price.currency !== null &&
        p.price.basis !== "unknown" &&
        (p.price.basis !== "party_total" || p.price.forTravellers !== null) &&
        (p.isDemo || p.price.verifiedAt !== null)),
  )
  .refine(
    (p) =>
      p.status !== "published" ||
      p.isDemo ||
      (p.approval.sourceRef !== null && p.approval.verifiedAt !== null),
  );
export type CompanyPackage = z.infer<typeof CompanyPackage>;
// Administrative ingestion boundary; model tools never write these records.
export const AuthoritativeCatalogBatch = z
  .array(CompanyPackage)
  .min(1)
  .max(100)
  .superRefine((packages, context) => {
    const ids = new Set<string>(),
      codes = new Set<string>();
    packages.forEach((p, index) => {
      if (p.isDemo)
        context.addIssue({
          code: "custom",
          path: [index, "isDemo"],
          message: "Demo records are test-only",
        });
      if (ids.has(p.id))
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Duplicate ID",
        });
      if (codes.has(p.code))
        context.addIssue({
          code: "custom",
          path: [index, "code"],
          message: "Duplicate code",
        });
      ids.add(p.id);
      codes.add(p.code);
      for (const [field, value] of [
        ["code", p.code],
        ["title", p.title],
        ["destination", p.destination],
        ["approval.sourceRef", p.approval.sourceRef],
      ] as const)
        if (
          value &&
          /^(?:REPLACE(?:_|\b)|TODO\b|TBD\b|PLACEHOLDER\b)/i.test(value)
        )
          context.addIssue({
            code: "custom",
            path: [index, ...field.split(".")],
            message: "Replace template placeholders with approved data",
          });
    });
  });
export const PackageReference = z
  .strictObject({
    id: z.uuid().optional(),
    optionNumber: z.number().int().min(1).max(20).optional(),
  })
  .refine((v) => (v.id !== undefined) !== (v.optionNumber !== undefined));
export const CompanyComparison = z
  .strictObject({
    ids: z.array(z.uuid()).min(2).max(4).optional(),
    optionNumbers: z
      .array(z.number().int().min(1).max(20))
      .min(2)
      .max(4)
      .optional(),
  })
  .refine((v) => (v.ids !== undefined) !== (v.optionNumbers !== undefined));
export const TravelConstraints = z.strictObject({
  destination: text.optional(),
  excludedDestinations: z.array(text).max(10).optional(),
  startsOn: z.iso.date().optional(),
  endsOn: z.iso.date().optional(),
  days: z.number().int().min(1).max(90).optional(),
  travellers: z.number().int().min(1).max(100).optional(),
  adults: z.number().int().min(1).max(100).optional(),
  children: z.number().int().min(0).max(99).optional(),
  budgetIncludesFlights: z.boolean().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  budgetMinor: z.number().int().min(0).max(1000000000000).optional(),
  budgetBasis: z.enum(["party_total", "per_person"]).optional(),
});
export type TravelConstraints = z.infer<typeof TravelConstraints>;
export const TravelState = z
  .strictObject({
    version: z.number().int().min(0),
    constraints: TravelConstraints,
    budgetBasisConfidence: z.enum(["shared_intent", "confirmed"]).optional(),
    options: z.array(z.strictObject({ id: z.uuid(), title: text })).max(20),
  })
  .refine(
    (state) =>
      !state.constraints.startsOn ||
      !state.constraints.endsOn ||
      state.constraints.endsOn >= state.constraints.startsOn,
    { message: "Travel end precedes start" },
  );
export type TravelState = z.infer<typeof TravelState>;
export const ConstraintProposal = z.strictObject({
  expectedVersion: z.number().int().min(0),
  patch: TravelConstraints,
  evidence: z
    .array(
      z.strictObject({
        field: z.enum([
          "destination",
          "excludedDestinations",
          "startsOn",
          "endsOn",
          "days",
          "travellers",
          "adults",
          "children",
          "budgetIncludesFlights",
          "currency",
          "budgetMinor",
          "budgetBasis",
        ]),
        quote: z.string().min(1).max(240),
        source: z.enum(["current_user", "previous_user"]).optional(),
      }),
    )
    .max(12),
});

export const TravelAction = z.enum([
  "research",
  "itinerary",
  "budget_comparison",
  "budget_recommendation",
  "age_pricing",
  "conversation",
]);
export const TravelReadinessRequest = z.strictObject({ action: TravelAction });
