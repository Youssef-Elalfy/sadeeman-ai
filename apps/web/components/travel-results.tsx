import { z } from "zod";

const safeLink = z.url().refine((s) => /^https?:\/\//.test(s));
const Plan = z.object({
  destination: z.string(),
  label: z.literal("ESTIMATED_ITINERARY"),
  days: z.array(
    z.object({
      day: z.number().int(),
      researchSuggestions: z.array(
        z.object({ title: z.string(), sourceUrl: safeLink }),
      ),
    }),
  ),
});
const Compare = z.object({
  currency: z.string(),
  label: z.literal("ESTIMATED_COMPARISON"),
  travellers: z.number().int().min(1),
  options: z.array(
    z.object({
      destination: z.string(),
      days: z.number().int(),
      totalMinor: z.number().int(),
      withinBudget: z.boolean(),
      perTravellerMinorRoundedUp: z.number().int(),
    }),
  ),
});
const Packages = z.object({
  packages: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      destination: z.string(),
      days: z.number().int(),
      label: z.string(),
      bookable: z.literal(false),
      price: z.object({
        amountMinor: z.number().nullable(),
        currency: z.string().nullable(),
      }),
    }),
  ),
});
function money(n: number, currency: string) {
  const exponent =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency }).format(
    n / 10 ** exponent,
  );
}
export function TravelResults({
  artifacts,
}: {
  artifacts: { tool: string; data: unknown }[];
}) {
  return (
    <section className="travel-results" aria-label="نتائج التخطيط والمقارنة">
      {artifacts.map((artifact) => {
        const plan = Plan.safeParse(artifact.data);
        if (plan.success)
          return (
            <article
              className="surface"
              key={`${artifact.tool}-${plan.data.destination}`}
            >
              <span className="badge">خطة تقديرية · غير قابلة للحجز</span>
              <h2>
                {plan.data.destination} · {plan.data.days.length} أيام
              </h2>
              <div className="itinerary-days">
                {plan.data.days.map((day) => (
                  <div key={day.day}>
                    <h3>اليوم {day.day}</h3>
                    {day.researchSuggestions.length ? (
                      day.researchSuggestions.map((s) => (
                        <a
                          key={s.sourceUrl}
                          href={s.sourceUrl}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {s.title} ↗
                        </a>
                      ))
                    ) : (
                      <p className="muted">
                        اليوم ده محتاج بحث إضافي؛ مفيش اقتراح مؤكد.
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <p className="muted">
                اقتراحات بحثية؛ المواعيد والمواصلات والتوافر تحتاج مراجعة.
              </p>
            </article>
          );
        const comparison = Compare.safeParse(artifact.data);
        if (comparison.success)
          return (
            <article
              className="surface"
              key={`${artifact.tool}-${comparison.data.currency}`}
            >
              <h2>مقارنة تقديراتك</h2>
              <span className="badge">
                أرقام مقدمة للتقدير · بدون تحويل عملة
              </span>
              <div className="comparison-grid">
                {comparison.data.options.map((option) => (
                  <div key={`${option.destination}-${option.totalMinor}`}>
                    <h3>{option.destination}</h3>
                    <p>
                      {option.days} أيام · {comparison.data.travellers} مسافرين
                    </p>
                    <strong>
                      {money(option.totalMinor, comparison.data.currency)}
                    </strong>
                    <p>
                      {money(
                        option.perTravellerMinorRoundedUp,
                        comparison.data.currency,
                      )}{" "}
                      للفرد (مقرب لأعلى)
                    </p>
                    <small>
                      {option.withinBudget
                        ? "ضمن الميزانية المقدمة"
                        : "أعلى من الميزانية المقدمة"}
                    </small>
                  </div>
                ))}
              </div>
              <p className="muted">مش عروض أسعار ولا حجوزات مؤكدة.</p>
            </article>
          );
        const packages = Packages.safeParse(artifact.data);
        if (packages.success)
          return (
            <article className="surface" key={`${artifact.tool}-catalog`}>
              <h2>برامج كتالوج الشركة</h2>
              {!packages.data.packages.length && (
                <p>
                  مفيش برامج مطابقة في الكتالوج المتاح. ده مش مخزون حجز مباشر.
                </p>
              )}
              {packages.data.packages.map((p) => (
                <div className="package-card" key={p.id}>
                  <strong>{p.title}</strong>
                  <p>
                    {p.destination} · {p.days} أيام
                  </p>
                  <small>{p.label}</small>
                  <p>
                    {p.price.amountMinor !== null && p.price.currency
                      ? money(p.price.amountMinor, p.price.currency)
                      : "السعر غير معلوم"}
                  </p>
                  <small>التوافر غير مؤكد · مفيش حجز مباشر</small>
                </div>
              ))}
            </article>
          );
        return null;
      })}
    </section>
  );
}
