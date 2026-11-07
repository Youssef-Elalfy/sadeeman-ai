import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";
import { AuthoritativeCatalogBatch, CompanyPackage } from "@sadeeman/contracts";
import { describe, expect, it } from "vitest";
import { projectRoot } from "../apps/api/src/persistence/local.js";

// TEST-ONLY approval metadata; not real company inventory.
const program = () => ({
  id: randomUUID(),
  code: "TEST-ONLY",
  title: "TEST ONLY program",
  destination: "TEST ONLY destination",
  aliases: [],
  description: null,
  days: 5,
  nights: null,
  price: {
    amountMinor: null,
    currency: null,
    basis: "unknown",
    forTravellers: null,
    verifiedAt: null,
  },
  departures: [],
  inclusions: [],
  exclusions: [],
  activities: [],
  isDemo: false,
  status: "draft",
  approval: { sourceRef: null, verifiedAt: null },
});
describe("authoritative catalog ingestion boundary — test fixtures only", () => {
  it.each([true, false])(
    "runs the read-only CLI with valid=%s without exposing fixture contents",
    async (valid) => {
      const directory = resolve(projectRoot, ".private/tests"),
        file = resolve(directory, `catalog-validation-${randomUUID()}.json`);
      if (!file.startsWith(directory + sep))
        throw new Error("Unsafe test path");
      await mkdir(directory, { recursive: true });
      await writeFile(
        file,
        JSON.stringify([
          valid
            ? program()
            : { ...program(), unauthorizedField: "DO_NOT_PRINT_TEST_VALUE" },
        ]),
      );
      try {
        let output: string;
        try {
          output = (
            await promisify(execFile)(
              process.execPath,
              [
                resolve(projectRoot, "tools/catalog-validate.ts"),
                "--file",
                file,
              ],
              { cwd: projectRoot },
            )
          ).stdout;
        } catch (error) {
          if (
            valid ||
            typeof error !== "object" ||
            error === null ||
            !("stdout" in error) ||
            typeof error.stdout !== "string"
          )
            throw error;
          output = error.stdout;
        }
        const report = JSON.parse(output);
        expect(report.status).toBe(
          valid
            ? "VALID_STRUCTURE_REQUIRES_OPERATOR_SOURCE_REVIEW"
            : "INVALID_CATALOG",
        );
        expect(output).not.toContain("DO_NOT_PRINT_TEST_VALUE");
        if (valid) {
          expect(report.databaseWrites).toBe(0);
          expect(report.networkRequests).toBe(0);
        }
      } finally {
        await rm(file, { force: true });
      }
    },
  );
  it("keeps absent price, dates and description unknown in a valid draft", () => {
    const data = AuthoritativeCatalogBatch.parse([program()]);
    expect(data[0]).toMatchObject({
      description: null,
      price: { amountMinor: null },
      departures: [],
      activities: [],
      status: "draft",
    });
  });
  it("rejects accidental ingestion of the unfilled template", async () => {
    const template = JSON.parse(
      await readFile(
        new URL("../templates/company-program.template.json", import.meta.url),
        "utf8",
      ),
    );
    expect(AuthoritativeCatalogBatch.safeParse(template).success).toBe(false);
  });
  it("rejects demo, duplicate IDs/codes, and unresolved placeholders", () => {
    const p = program();
    for (const data of [
      [{ ...p, isDemo: true }],
      [p, p],
      [p, { ...program(), id: randomUUID() }],
      [{ ...p, title: "REPLACE_WITH_TITLE" }],
    ])
      expect(AuthoritativeCatalogBatch.safeParse(data).success).toBe(false);
  });
  it("requires nonempty approval evidence before publication and dated price basis for known amounts", () => {
    const p = program();
    expect(
      AuthoritativeCatalogBatch.safeParse([{ ...p, status: "published" }])
        .success,
    ).toBe(false);
    const approved = {
      ...p,
      status: "published",
      approval: {
        sourceRef: "TEST ONLY approval fixture",
        verifiedAt: "2026-11-05T00:00:00Z",
      },
    };
    expect(AuthoritativeCatalogBatch.safeParse([approved]).success).toBe(true);
    expect(
      AuthoritativeCatalogBatch.safeParse([
        {
          ...approved,
          price: {
            amountMinor: 10000,
            currency: "EGP",
            basis: "per_person",
            forTravellers: null,
            verifiedAt: null,
          },
        },
      ]).success,
    ).toBe(false);
  });
  it("does not accept bookable/live-inventory assertions or impossible schedules", () => {
    expect(
      CompanyPackage.safeParse({ ...program(), bookable: true }).success,
    ).toBe(false);
    expect(
      CompanyPackage.safeParse({
        ...program(),
        activities: [{ day: 6, title: "TEST", description: null }],
      }).success,
    ).toBe(false);
    expect(
      CompanyPackage.safeParse({
        ...program(),
        departures: [
          {
            startsOn: "2027-01-10",
            endsOn: "2027-01-01",
            availability: "unverified",
            note: null,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
