import {
  CompanyComparison,
  CompanyPackage,
  type PackageQuery,
  PackageReference,
  ToolResult,
  type TravelConstraints,
} from "@sadeeman/contracts";
import { z } from "zod";
import { SafeError } from "../errors.js";
import type { DatabaseTransport } from "../persistence/types.js";
import type {
  CatalogRepository,
  ToolContext,
  ToolRegistry,
} from "../tools/registry.js";
import { canonicalPlace } from "./context.js";

export function packageCost(
  p: CompanyPackage,
  c: TravelConstraints,
): {
  partyTotalMinor: number | null;
  budgetStatus: "within_budget" | "over_budget" | "unknown";
} {
  const price = p.price;
  let partyTotalMinor: number | null = null;
  if (price.amountMinor !== null && c.travellers) {
    if (
      price.basis === "per_person" ||
      (price.basis === "per_adult" && c.adults === c.travellers)
    )
      partyTotalMinor = price.amountMinor * c.travellers;
    else if (
      price.basis === "party_total" &&
      price.forTravellers === c.travellers
    )
      partyTotalMinor = price.amountMinor;
  }
  const budget =
    c.budgetMinor !== undefined && c.budgetBasis && c.travellers
      ? c.budgetMinor * (c.budgetBasis === "per_person" ? c.travellers : 1)
      : null;
  return {
    partyTotalMinor,
    budgetStatus:
      budget !== null &&
      partyTotalMinor !== null &&
      price.currency === c.currency
        ? partyTotalMinor <= budget
          ? "within_budget"
          : "over_budget"
        : "unknown",
  };
}
const rejected = (code: string): ToolResult => ({
  status: "rejected",
  evidence: "unavailable",
  code,
});
export class PersistentCompanyCatalog implements CatalogRepository {
  constructor(private readonly transport: DatabaseTransport) {}
  private async get(
    id: string,
    context: ToolContext,
  ): Promise<CompanyPackage | null> {
    if (!context.identity) throw new SafeError("UNAUTHORIZED", 401);
    return CompanyPackage.nullable().parse(
      await this.transport.call(context.identity, "catalog_get", { id }),
    );
  }
  private reference(
    input: z.infer<typeof PackageReference>,
    context: ToolContext,
  ) {
    return (
      input.id ??
      context.travel?.draft.options[(input.optionNumber ?? 0) - 1]?.id
    );
  }
  private summary(p: CompanyPackage, c: TravelConstraints) {
    return {
      id: p.id,
      code: p.code,
      title: p.title,
      destination: p.destination,
      days: p.days,
      nights: p.nights,
      price: p.price,
      ...packageCost(p, c),
      classification: p.isDemo ? "company_demo" : "company_verified",
      label: p.isDemo
        ? "FICTIONAL DEMO"
        : "COMPANY CATALOG — availability unverified",
      bookable: false,
      liveInventory: false,
      datesKnown: p.departures.length > 0,
      inclusions: p.inclusions,
      exclusions: p.exclusions,
      approval: p.approval,
    };
  }
  private result(
    packages: CompanyPackage[],
    context: ToolContext,
    full = false,
  ): ToolResult {
    const c = context.travel?.draft.constraints ?? {};
    return {
      status: "ok",
      evidence: packages.some((p) => p.isDemo)
        ? "company_demo"
        : "company_verified",
      data: {
        packages: packages.map((p) =>
          full ? { ...p, ...this.summary(p, c) } : this.summary(p, c),
        ),
        constraints: c,
        note: "Company database records, not external listings or live inventory. Empty departures/activities and null prices mean unknown. Budget arithmetic excludes anything not priced in the record; no FX conversion.",
      },
    };
  }
  async search(
    input: z.infer<typeof PackageQuery>,
    context: ToolContext,
  ): Promise<ToolResult> {
    if (!context.identity) return rejected("UNAUTHORIZED");
    const c = context.travel?.draft.constraints ?? {};
    const destination = input.destination ?? c.destination,
      currency = input.currency ?? c.currency;
    if (input.maxPricePerAdult !== undefined && !currency)
      return rejected("CURRENCY_REQUIRED");
    const raw = await this.transport.call(context.identity, "catalog_search", {
      ...(destination
        ? {
            destination,
            destinationVariants: [destination, canonicalPlace(destination)],
          }
        : {}),
      ...((input.days ?? c.days) !== undefined
        ? { days: input.days ?? c.days }
        : {}),
      ...(currency ? { currency } : {}),
    });
    let packages = z.array(CompanyPackage).max(20).parse(raw);
    packages = packages.filter(
      (p) =>
        !c.excludedDestinations?.some(
          (d) => canonicalPlace(p.destination) === canonicalPlace(d),
        ),
    );
    if (input.maxPricePerAdult !== undefined) {
      const exponent =
        new Intl.NumberFormat("en", {
          style: "currency",
          currency: currency ?? "XXX",
        }).resolvedOptions().maximumFractionDigits ?? 2;
      const max = input.maxPricePerAdult * 10 ** exponent;
      packages = packages.filter(
        (p) =>
          p.price.amountMinor !== null &&
          p.price.basis === "per_adult" &&
          p.price.amountMinor <= max,
      );
    }
    if (input.cheaperThanOption !== undefined) {
      const id = this.reference(
        { optionNumber: input.cheaperThanOption },
        context,
      );
      const reference = id ? await this.get(id, context) : null;
      if (!reference) return rejected("OPTION_REFERENCE_NOT_FOUND");
      const referenceCost = packageCost(reference, c).partyTotalMinor;
      if (referenceCost === null || !reference.price.currency)
        return rejected("COMPARABLE_PARTY_PRICE_REQUIRED");
      packages = packages.filter((p) => {
        const cost = packageCost(p, c).partyTotalMinor;
        return (
          cost !== null &&
          p.price.currency === reference.price.currency &&
          cost < referenceCost
        );
      });
    }
    const rank = (p: CompanyPackage) =>
      ({ within_budget: 0, unknown: 1, over_budget: 2 })[
        packageCost(p, c).budgetStatus
      ];
    packages.sort((a, b) => rank(a) - rank(b));
    packages = packages.slice(0, 6);
    if (context.travel) {
      context.travel.draft.options = packages.map((p) => ({
        id: p.id,
        title: p.title,
      }));
      context.travel.dirty = true;
    }
    return this.result(packages, context);
  }
  register(registry: ToolRegistry) {
    registry.register({
      name: "get_company_package",
      description:
        "Read current company program details, dates, activities, schedule and exclusions. Resolve optionNumber from the stored ordered options, never guess an ID. Empty dates mean unknown availability.",
      input: PackageReference,
      output: ToolResult,
      timeoutMs: 6000,
      sideEffect: false,
      execute: async (raw, context) => {
        const id = this.reference(PackageReference.parse(raw), context);
        const p = id ? await this.get(id, context) : null;
        return p
          ? this.result([p], context, true)
          : rejected("OPTION_REFERENCE_NOT_FOUND");
      },
    });
    registry.register({
      name: "compare_company_packages",
      description:
        "Compare 2–4 database programs by IDs or stored ordinal optionNumbers. Keep currency and price basis; party price and budget suitability remain unknown if inputs are missing. No FX or fabricated child prices.",
      input: CompanyComparison,
      output: ToolResult,
      timeoutMs: 6000,
      sideEffect: false,
      execute: async (raw, context) => {
        const input = CompanyComparison.parse(raw);
        const ids =
          input.ids ??
          input.optionNumbers?.map((optionNumber) =>
            this.reference({ optionNumber }, context),
          ) ??
          [];
        if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
          return rejected("OPTION_REFERENCE_NOT_FOUND");
        const packages: CompanyPackage[] = [];
        for (const id of ids) {
          const p = id ? await this.get(id, context) : null;
          if (!p) return rejected("OPTION_REFERENCE_NOT_FOUND");
          packages.push(p);
        }
        return this.result(packages, context);
      },
    });
  }
}
