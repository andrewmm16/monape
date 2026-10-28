import { describe, expect, it } from "vitest";
import { buildFeedXml, cdata, escapeXml, formatSalaryText } from "@/modules/public-jobs/feed";
import { textToHtml } from "@/modules/public-jobs/html";
import { buildJobPosting, serializeJsonLd } from "@/modules/public-jobs/job-posting";
import { buildJobSlug, jobPath, parseJobSlug, slugifyTitle } from "@/modules/public-jobs/slug";
import type { PublicSiteContext, PublicVacancy } from "@/modules/public-jobs/types";

const site: PublicSiteContext = {
  siteUrl: "https://empleos.ejemplo.test",
  companyName: "Empresa Ficticia SAC",
  companyWebsite: "https://www.ejemplo.test",
  companyLogoUrl: "https://www.ejemplo.test/logo.png",
};

function vacancy(overrides: Partial<PublicVacancy> = {}): PublicVacancy {
  return {
    code: "abc123def4",
    title: "Analista de Datos",
    department: "Tecnología",
    description: "Análisis de información comercial.\n\nReportes para la toma de decisiones.",
    responsibilities: "- Construir tableros\n- Automatizar reportes",
    city: "Lima",
    region: "Lima",
    modality: "hibrido",
    employmentType: "tiempo_completo",
    contractType: null,
    salary: null,
    firstPublishedAt: "2026-10-28T15:00:00+00:00",
    closingDate: "2026-11-30",
    updatedAt: "2026-10-28T15:00:00+00:00",
    ...overrides,
  };
}

describe("dirección de la vacante", () => {
  it("normaliza el título: sin tildes, símbolos ni mayúsculas", () => {
    expect(slugifyTitle("  Ingeniero/a de Operaciones Ñandú — Sr. (Lima)  ")).toBe("ingeniero-a-de-operaciones-nandu-sr-lima");
    expect(slugifyTitle("¡¡¡")).toBe("vacante");
    expect(slugifyTitle("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it("arma <título>-<código> y recupera el código del final", () => {
    expect(buildJobSlug("Analista de Datos", "abc123def4")).toBe("analista-de-datos-abc123def4");
    expect(jobPath("Analista de Datos", "abc123def4")).toBe("/empleos/analista-de-datos-abc123def4");
    expect(parseJobSlug("analista-de-datos-abc123def4")).toBe("abc123def4");
    // El código se reconoce aunque el título haya cambiado (para redirigir a la dirección canónica).
    expect(parseJobSlug("titulo-antiguo-abc123def4")).toBe("abc123def4");
  });

  it("rechaza direcciones sin código válido", () => {
    expect(parseJobSlug("analista-de-datos")).toBeNull();
    expect(parseJobSlug("analista-ABC123DEF4")).toBeNull();
    expect(parseJobSlug("analista-abc123def")).toBeNull();
    expect(parseJobSlug("abc123def4")).toBeNull();
  });
});

describe("texto a HTML", () => {
  it("genera párrafos y listas con todo el texto escapado", () => {
    const html = textToHtml("Hola <b>mundo</b> & \"amigos\"\nsegunda línea\n\n- uno <i>\n- dos\n\n1. primero\n2) segundo");
    expect(html).toBe(
      "<p>Hola &lt;b&gt;mundo&lt;/b&gt; &amp; &quot;amigos&quot;<br>segunda línea</p>" +
        "<ul><li>uno &lt;i&gt;</li><li>dos</li></ul>" +
        "<ol><li>primero</li><li>segundo</li></ol>",
    );
    expect(textToHtml("<script>alert(1)</script>")).not.toContain("<script>");
  });
});

describe("JSON-LD JobPosting", () => {
  it("incluye los campos obligatorios de Google", () => {
    const posting = buildJobPosting(vacancy(), site) as Record<string, unknown>;
    expect(posting["@context"]).toBe("https://schema.org");
    expect(posting["@type"]).toBe("JobPosting");
    expect(posting.title).toBe("Analista de Datos");
    expect(posting.description).toContain("<p>Análisis de información comercial.</p>");
    expect(posting.description).toContain("<li>Construir tableros</li>");
    expect(posting.datePosted).toBe("2026-10-28T15:00:00+00:00");
    expect(posting.validThrough).toBe("2026-11-30T23:59:59-05:00");
    expect(posting.employmentType).toBe("FULL_TIME");
    expect(posting.hiringOrganization).toEqual({
      "@type": "Organization",
      name: "Empresa Ficticia SAC",
      sameAs: "https://www.ejemplo.test",
      logo: "https://www.ejemplo.test/logo.png",
    });
    expect(posting.identifier).toEqual({ "@type": "PropertyValue", name: "Empresa Ficticia SAC", value: "abc123def4" });
    expect(posting.jobLocation).toEqual({
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: "Lima", addressRegion: "Lima", addressCountry: "PE" },
    });
    expect(posting).not.toHaveProperty("directApply");
    expect(posting).not.toHaveProperty("jobLocationType");
    expect(posting).not.toHaveProperty("baseSalary");
  });

  it("directApply: true solo cuando se ofrece el formulario; nunca false", () => {
    expect(buildJobPosting(vacancy(), site, { directApply: true }).directApply).toBe(true);
    expect(buildJobPosting(vacancy(), site, { directApply: false })).not.toHaveProperty("directApply");
    expect(buildJobPosting(vacancy(), site, {})).not.toHaveProperty("directApply");
  });

  it("omite validThrough sin fecha de cierre y mapea los tipos de empleo", () => {
    expect(buildJobPosting(vacancy({ closingDate: null }), site)).not.toHaveProperty("validThrough");
    const types = (["tiempo_completo", "medio_tiempo", "temporal", "practicas", "por_proyecto"] as const).map(
      (employmentType) => buildJobPosting(vacancy({ employmentType }), site).employmentType,
    );
    expect(types).toEqual(["FULL_TIME", "PART_TIME", "TEMPORARY", "INTERN", "CONTRACTOR"]);
  });

  it("vacante remota: TELECOMMUTE y requisito de ubicación del postulante en Perú", () => {
    const posting = buildJobPosting(vacancy({ modality: "remoto", city: null, region: null }), site);
    expect(posting.jobLocationType).toBe("TELECOMMUTE");
    expect(posting.applicantLocationRequirements).toEqual({ "@type": "Country", name: "Perú" });
    expect(posting).not.toHaveProperty("jobLocation");
  });

  it("sueldo con rango, monto fijo y sin sueldo", () => {
    const range = buildJobPosting(
      vacancy({ salary: { min: 3000, max: 4500, currency: "PEN", period: "mes" } }),
      site,
    );
    expect(range.baseSalary).toEqual({
      "@type": "MonetaryAmount",
      currency: "PEN",
      value: { "@type": "QuantitativeValue", minValue: 3000, maxValue: 4500, unitText: "MONTH" },
    });
    const fixed = buildJobPosting(vacancy({ salary: { min: 25, max: null, currency: "USD", period: "hora" } }), site);
    expect(fixed.baseSalary).toEqual({
      "@type": "MonetaryAmount",
      currency: "USD",
      value: { "@type": "QuantitativeValue", value: 25, unitText: "HOUR" },
    });
    expect(buildJobPosting(vacancy(), site)).not.toHaveProperty("baseSalary");
  });

  it("la serialización no puede cerrar la etiqueta <script>", () => {
    const posting = buildJobPosting(vacancy({ title: "Analista </script><script>alert(1)</script>" }), site);
    const json = serializeJsonLd(posting);
    expect(json).not.toContain("<");
    expect(json).toContain("\\u003c/script>");
    expect(JSON.parse(json).title).toBe("Analista </script><script>alert(1)</script>");
  });
});

describe("feed XML", () => {
  const now = new Date("2026-11-15T12:00:00-05:00");

  it("incluye los campos del formato y escapa el texto", () => {
    const xml = buildFeedXml(
      [
        vacancy({
          title: "Analista & <Líder> \"Sr\"",
          city: "San Isidro",
          salary: { min: 3000, max: 4500, currency: "PEN", period: "mes" },
        }),
      ],
      site,
      now,
    );
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<source>')).toBe(true);
    expect(xml).toContain("<publisher>Empresa Ficticia SAC</publisher>");
    expect(xml).toContain("<publisherurl>https://www.ejemplo.test</publisherurl>");
    expect(xml).toContain("<lastbuilddate>");
    expect(xml).toContain("<referencenumber>abc123def4</referencenumber>");
    expect(xml).toContain("<title>Analista &amp; &lt;Líder&gt; &quot;Sr&quot;</title>");
    expect(xml).toContain("<company>Empresa Ficticia SAC</company>");
    expect(xml).toContain("<city>San Isidro</city>");
    expect(xml).toContain("<state>Lima</state>");
    expect(xml).toContain("<country>PE</country>");
    expect(xml).toContain("<dateposted>2026-10-28</dateposted>");
    expect(xml).toContain("<url>https://empleos.ejemplo.test/empleos/analista-lider-sr-abc123def4</url>");
    expect(xml).toContain("<description><![CDATA[<p>Análisis de información comercial.</p>");
    expect(xml).toContain("<expirationdate>2026-11-30</expirationdate>");
    expect(xml).toContain("<jobtype>fulltime</jobtype>");
    expect(xml).toContain("<isremote>no</isremote>");
    expect(xml).toContain("<salary>S/ 3000 - 4500 por mes</salary>");
  });

  it("parte cualquier ]]> dentro del CDATA", () => {
    expect(cdata("a ]]> b")).toBe("<![CDATA[a ]]]]><![CDATA[> b]]>");
    // El texto de la vacante ya llega escapado (`>` pasa a `&gt;`), así que el feed nunca lo cierra.
    const xml = buildFeedXml([vacancy({ description: "Texto con ]]> dentro de la descripción de la vacante." })], site, now);
    const outside = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
    expect(outside).not.toContain("]]>");
    expect(xml).toContain("]]&gt;");
  });

  it("omite las vacantes vencidas, marca las remotas y no emite salario sin sueldo", () => {
    const xml = buildFeedXml(
      [
        vacancy({ code: "vigente0001", closingDate: "2026-11-15", modality: "remoto" }),
        vacancy({ code: "vencida0002", closingDate: "2026-11-14" }),
        vacancy({ code: "sincierre3", closingDate: null }),
      ],
      site,
      now,
    );
    expect(xml).toContain("vigente0001");
    expect(xml).toContain("sincierre3");
    expect(xml).not.toContain("vencida0002");
    expect(xml).toContain("<isremote>yes</isremote>");
    expect(xml).not.toContain("<salary>");
  });

  it("sin vacantes produce un feed válido y vacío", () => {
    const xml = buildFeedXml([], site, now);
    expect(xml).not.toContain("<job>");
    expect(xml).toContain("</source>");
  });

  it("escapa y descarta caracteres inválidos en XML", () => {
    expect(escapeXml("a&b<c>d\"e'f\u0001")).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });

  it("formatea el sueldo fijo", () => {
    expect(formatSalaryText({ min: 25.5, max: null, currency: "USD", period: "hora" })).toBe("US$ 25.50 por hora");
  });
});
