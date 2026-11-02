import { chromium, type Browser } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeBumeranAdapter } from "../../bot/src/adapters/fake-bumeran";
import { FakeComputrabajoAdapter } from "../../bot/src/adapters/fake-computrabajo";
import { FakeIndeedAdapter } from "../../bot/src/adapters/fake-indeed";
import { FakeLinkedinAdapter } from "../../bot/src/adapters/fake-linkedin";
import { FakeTrabajosDiariosAdapter } from "../../bot/src/adapters/fake-trabajos-diarios";
import { ERROR_CODES, errorCodeOf } from "../../bot/src/errors";
import { startFakePortal, type FakePortal } from "../../bot/src/fake-portal/server";

/** Una oferta que ya no existe en el portal se distingue de «la página cambió» (Chromium real, portales ficticios). */
let browser: Browser;
let portal: FakePortal;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(() => browser.close());
beforeEach(async () => {
  portal = await startFakePortal();
});
afterEach(() => portal.close());

const publication = { publicationId: "p-1", externalId: "fp-999", externalUrl: "https://portal.test/o/999", lastSyncedAt: null };

describe("leer postulantes de una oferta inexistente", () => {
  const factories = {
    linkedin: FakeLinkedinAdapter,
    bumeran: FakeBumeranAdapter,
    "trabajos-diarios": FakeTrabajosDiariosAdapter,
    indeed: FakeIndeedAdapter,
    computrabajo: FakeComputrabajoAdapter,
  };
  for (const [slug, Adapter] of Object.entries(factories)) {
    it(`${slug}: oferta_no_encontrada, sin esperar al tiempo máximo`, async () => {
      const context = await browser.newContext();
      try {
        const adapter = new Adapter(context, portal.url, 3_000);
        const started = Date.now();
        const error = await adapter.listApplicants(publication).then(
          () => null,
          (caught: unknown) => caught,
        );
        expect(error).not.toBeNull();
        expect(errorCodeOf(error)).toBe(ERROR_CODES.offerNotFound);
        expect(Date.now() - started).toBeLessThan(2_500);
      } finally {
        await context.close();
      }
    });
  }
});
