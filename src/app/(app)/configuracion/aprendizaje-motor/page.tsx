import type { Metadata } from "next";
import { AccessDenied } from "@/components/common/access-denied";
import { ActionButton } from "@/components/common/action-button";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { REQUIREMENT_CATEGORY_LABELS } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setLearnedRuleActive } from "@/modules/evaluation/learning-actions";
import { getLearningOverview, listAiQualityChecks, type LearnedRuleRow } from "@/modules/evaluation/learning";
import { QUALITY_THRESHOLDS } from "@/modules/evaluation/ai/quality";

export const metadata: Metadata = { title: "Aprendizaje del motor" };

const STATUS_LABELS: Record<string, string> = {
  aprendiendo: "Aprendiendo",
  pendiente_juez: "Esperando al segundo juez",
  activa: "Activa",
  rechazada: "Rechazada por el juez",
  suspendida: "Suspendida",
};

function Verdict({ rule }: { rule: LearnedRuleRow }) {
  if (!rule.verdict) return <span className="text-muted-foreground">—</span>;
  return rule.verdict === "equivale" ? <span>cuenta como lo pedido</span> : <span>no cuenta (queda por confirmar)</span>;
}

function Requirement({ rule }: { rule: LearnedRuleRow }) {
  return (
    <div className="space-y-0.5">
      <p>{rule.requirement_description}</p>
      <p className="text-xs text-muted-foreground">{REQUIREMENT_CATEGORY_LABELS[rule.requirement_category]}</p>
    </div>
  );
}

export default async function EngineLearningPage() {
  const user = await requirePageUser();
  if (!can(user.role, "users:manage")) {
    return <AccessDenied message="Solo la administración ve lo que aprendió el motor." />;
  }
  const supabase = await createSupabaseServerClient();
  const [{ rules, weeks, learnedLastWeek: learnedThisWeek }, checks] = await Promise.all([
    getLearningOverview(supabase),
    listAiQualityChecks(supabase),
  ]);
  const pct = (value: number | null) => (value === null ? "—" : `${(100 * value).toFixed(1).replace(".", ",")} %`);
  const active = rules.filter((r) => r.status === "activa");
  const learning = rules.filter((r) => r.status === "aprendiendo" || r.status === "pendiente_juez");
  const stopped = rules.filter((r) => r.status === "suspendida" || r.status === "rechazada");

  return (
    <>
      <PageHeader
        eyebrow="Configuración"
        title="Aprendizaje del motor"
        description="Lo que el motor de reglas aprendió para depender cada vez menos de la IA. Cuando la IA o RRHH resuelven una duda de vocabulario (un cargo o una habilidad parecida), un modelo más capaz, el segundo juez, decide si ese término cuenta como lo que pide el requisito, y desde entonces el motor lo aplica solo. Se suspende sola si RRHH verifica «no cumple» en un caso que resolvió. No necesita aprobación: aquí puede revisarlas y deshacerlas."
      />
      <div className="space-y-6">
        <Card data-testid="ai-quality-checks">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Vigilancia semanal de la IA
              {checks[0] ? (
                <Badge variant={checks[0].status === "ok" ? "outline" : "destructive"}>{checks[0].status === "ok" ? "Todo bien" : "Alerta"}</Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              Cada semana el worker mide a la IA de los CV contra los CV de prueba con respuesta conocida. Si motor + IA baja de{" "}
              {pct(QUALITY_THRESHOLDS.relayLenientMin)} o la IA acredita de más más de {QUALITY_THRESHOLDS.overAccreditedMax} requisitos, se avisa
              por correo a administración (por ejemplo, si Anthropic cambia el modelo).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {checks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aún no hay revisiones. Se programan en la máquina del worker con «scripts\vigilancia-ia.cmd instalar» (o se corre a mano con «npm
                run vigilar:ia»).
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead className="text-right">Motor + IA</TableHead>
                    <TableHead className="text-right">IA sola</TableHead>
                    <TableHead className="text-right">Acreditó de más</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checks.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{formatDateTime(c.checked_at)}</TableCell>
                      <TableCell className="text-xs">
                        {c.model} · {c.prompt_version}
                        {c.failures > 0 ? ` · ${c.failures} de ${c.cv_count} CV fallaron` : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{pct(c.accuracy_relay_lenient === null ? null : Number(c.accuracy_relay_lenient))}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(c.accuracy_ai === null ? null : Number(c.accuracy_ai))}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.ai_over_accredited}</TableCell>
                      <TableCell>
                        {c.status === "ok" ? "Todo bien" : <span className="text-destructive">Alerta: {c.reasons.join(" ")}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cuánto depende todavía de la IA</CardTitle>
            <CardDescription>
              {learnedThisWeek > 0
                ? `El motor aprendió ${learnedThisWeek} regla${learnedThisWeek === 1 ? "" : "s"} en los últimos 7 días.`
                : "Últimas cuatro semanas. A medida que el motor aprende, menos evaluaciones necesitan a la IA."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Semana desde</TableHead>
                  <TableHead className="text-right">Evaluaciones del motor</TableHead>
                  <TableHead className="text-right">Enviadas a la IA</TableHead>
                  <TableHead className="text-right">Requisitos resueltos con reglas aprendidas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeks.map((w) => (
                  <TableRow key={w.from}>
                    <TableCell>{formatDate(w.from)}</TableCell>
                    <TableCell className="text-right tabular-nums">{w.engineEvaluations}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {w.sentToAi}
                      {w.engineEvaluations > 0 ? ` (${Math.round((100 * w.sentToAi) / w.engineEvaluations)} %)` : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{w.resolvedByRules}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reglas activas ({active.length})</CardTitle>
            <CardDescription>El motor las aplica solo, sin consultar a la IA. Si una no le convence, desactívela.</CardDescription>
          </CardHeader>
          <CardContent>
            {active.length === 0 ? (
              <EmptyState
                title="Todavía no aprendió reglas"
                description="Cuando la IA resuelva la misma duda del motor en varios CV distintos, aparecerán aquí."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>En el CV dice</TableHead>
                    <TableHead>Requisito</TableHead>
                    <TableHead>Lo que aprendió</TableHead>
                    <TableHead>Evidencia</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {active.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium">«{rule.cv_term_display}»</TableCell>
                      <TableCell>
                        <Requirement rule={rule} />
                      </TableCell>
                      <TableCell>
                        <Verdict rule={rule} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        Decidió el juez ({rule.judge_model ?? "—"}){rule.judge_reason ? `: ${rule.judge_reason}` : "."}
                        {rule.activated_at ? ` Activa desde ${formatDate(rule.activated_at)}.` : ""}
                        {(() => {
                          const against = rule.verdict === "equivale" ? rule.votes_no : rule.votes_yes;
                          return against > 0 ? (
                            <span className="block pt-1 text-warning-foreground">
                              La IA del CV opinó distinto en {against} CV: revísela si RRHH también lo duda.
                            </span>
                          ) : null;
                        })()}
                      </TableCell>
                      <TableCell className="text-right">
                        <ActionButton
                          size="sm"
                          variant="outline"
                          action={setLearnedRuleActive.bind(null, rule.id, false)}
                          confirm={{
                            title: "¿Desactivar esta regla?",
                            description: `El motor dejará de aplicar «${rule.cv_term_display}» y esos casos volverán a ir a la IA.`,
                            confirmLabel: "Desactivar",
                          }}
                        >
                          Desactivar
                        </ActionButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {learning.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Aprendiendo ({learning.length})</CardTitle>
              <CardDescription>
                Dudas que la IA resolvió o RRHH verificó en algún CV. Al llegar al mínimo, el segundo juez decide y la regla se activa sola.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>En el CV dice</TableHead>
                    <TableHead>Requisito</TableHead>
                    <TableHead className="text-right">Cuenta / no cuenta</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {learning.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium">«{rule.cv_term_display}»</TableCell>
                      <TableCell>
                        <Requirement rule={rule} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rule.votes_yes} / {rule.votes_no}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{STATUS_LABELS[rule.status] ?? rule.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        {stopped.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Suspendidas o rechazadas ({stopped.length})</CardTitle>
              <CardDescription>El motor no las aplica. Puede reactivarlas si está seguro de que son correctas.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>En el CV dice</TableHead>
                    <TableHead>Requisito</TableHead>
                    <TableHead>Lo que había aprendido</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stopped.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium">«{rule.cv_term_display}»</TableCell>
                      <TableCell>
                        <Requirement rule={rule} />
                      </TableCell>
                      <TableCell>
                        <Verdict rule={rule} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <Badge variant="outline">{STATUS_LABELS[rule.status] ?? rule.status}</Badge>{" "}
                        {rule.status_reason ?? ""} {formatDateTime(rule.status_changed_at)}
                        {rule.judge_reason ? ` · Juez: ${rule.judge_reason}` : ""}
                      </TableCell>
                      <TableCell className="text-right">
                        {rule.verdict ? (
                          <ActionButton
                            size="sm"
                            variant="outline"
                            action={setLearnedRuleActive.bind(null, rule.id, true)}
                            confirm={{
                              title: "¿Reactivar esta regla?",
                              description: `El motor volverá a aplicar «${rule.cv_term_display}» sin consultar a la IA.`,
                              confirmLabel: "Reactivar",
                            }}
                          >
                            Reactivar
                          </ActionButton>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
