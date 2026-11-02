import type { BrowserContext } from "@playwright/test";
import { FakePortalAdapter } from "./fake";

/** «Trabajos Diarios» ficticio montado en `/trabajos-diarios` (misma estructura que el portal falso original). */
export class FakeTrabajosDiariosAdapter extends FakePortalAdapter {
  protected override readonly externalOrigin = "https://trabajos-diarios.fake.test";

  constructor(context: BrowserContext, baseUrl: string, timeoutMs = 15_000) {
    super(context, baseUrl, timeoutMs, "/trabajos-diarios");
  }
}
