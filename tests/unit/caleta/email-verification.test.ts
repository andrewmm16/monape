import { describe, expect, it, vi } from "vitest";
import {
  normalizeEmail,
  verifyProvidedEmail,
  type MxResolver,
} from "@/modules/caleta/email-verification";

describe("normalizeEmail", () => {
  it("recorta y pasa a minúsculas los correos válidos", () => {
    expect(normalizeEmail("  Juan.Perez@Empresa.COM.pe ")).toBe("juan.perez@empresa.com.pe");
  });

  it("rechaza lo que no es un correo bien formado", () => {
    for (const malo of ["", "sin-arroba", "dos@@arrobas.com", "sin-dominio@local", "a b@c.com"]) {
      expect(normalizeEmail(malo)).toBeNull();
    }
  });
});

describe("verifyProvidedEmail", () => {
  const dnsError = (code: string): NodeJS.ErrnoException => {
    const err = new Error(code) as NodeJS.ErrnoException;
    err.code = code;
    return err;
  };

  it("no llama al DNS si la sintaxis es inválida", async () => {
    const resolver = vi.fn<MxResolver>();
    const res = await verifyProvidedEmail("no-es-correo", resolver);
    expect(res.status).toBe("sintaxis-invalida");
    expect(res.normalized).toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("es entregable cuando el dominio tiene MX, ordenados por prioridad", async () => {
    const resolver: MxResolver = async () => [
      { exchange: "alt.mx.empresa.com.pe", priority: 20 },
      { exchange: "mx.empresa.com.pe", priority: 10 },
    ];
    const res = await verifyProvidedEmail("Juan.Perez@Empresa.com.pe", resolver);
    expect(res.status).toBe("entregable");
    expect(res.normalized).toBe("juan.perez@empresa.com.pe");
    expect(res.mxHosts).toEqual(["mx.empresa.com.pe", "alt.mx.empresa.com.pe"]);
  });

  it("marca sin-mx cuando el dominio no devuelve ningún MX", async () => {
    const resolver: MxResolver = async () => [];
    const res = await verifyProvidedEmail("ana@dominio-sin-correo.pe", resolver);
    expect(res.status).toBe("sin-mx");
    expect(res.mxHosts).toEqual([]);
  });

  it("trata ENOTFOUND/ENODATA como veredicto sin-mx", async () => {
    for (const code of ["ENOTFOUND", "ENODATA"]) {
      const resolver: MxResolver = async () => {
        throw dnsError(code);
      };
      const res = await verifyProvidedEmail("ana@dominio-inexistente.pe", resolver);
      expect(res.status).toBe("sin-mx");
    }
  });

  it("trata otros fallos de DNS como error transitorio", async () => {
    const resolver: MxResolver = async () => {
      throw dnsError("ESERVFAIL");
    };
    const res = await verifyProvidedEmail("ana@empresa.com.pe", resolver);
    expect(res.status).toBe("error-dns");
  });
});
