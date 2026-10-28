import { DownloadIcon } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes, formatDateTime } from "@/lib/format";
import { EXTRACTION_STATUS_LABELS } from "@/lib/labels";
import type { listResumes } from "@/modules/candidates/queries";
import { ExtractionReview } from "./extraction-review";
import { ResumeUpload } from "./resume-upload";

type Resume = Awaited<ReturnType<typeof listResumes>>[number];

export function ResumesSection({
  candidateId,
  resumes,
  canUpload,
  canManage,
  existingSkills,
}: {
  candidateId: string;
  resumes: Resume[];
  canUpload: boolean;
  canManage: boolean;
  existingSkills: string[];
}) {
  const current = resumes.find((r) => r.is_current);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Currículum</CardTitle>
        <CardDescription>
          Los archivos se descargan mediante enlaces temporales y cada descarga queda registrada en la auditoría.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {canUpload ? <ResumeUpload candidateId={candidateId} /> : null}
        {resumes.length === 0 ? (
          <EmptyState title="Sin CV cargado" description="Cargue el CV para extraer su texto y evaluar la compatibilidad." />
        ) : (
          <ul className="divide-y rounded-md border">
            {resumes.map((resume) => (
              <li key={resume.id} className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-all">{resume.original_filename}</span>
                    <Badge variant="outline">v{resume.version}</Badge>
                    {resume.is_current ? <Badge>Vigente</Badge> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatBytes(resume.size_bytes)} · {formatDateTime(resume.created_at)}
                    {resume.uploader ? ` · ${resume.uploader.full_name}` : ""}
                    {resume.resume_extractions ? ` · ${EXTRACTION_STATUS_LABELS[resume.resume_extractions.status]}` : ""}
                  </div>
                </div>
                <a
                  href={`/api/resumes/${resume.id}/download`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  rel="noreferrer"
                >
                  <DownloadIcon className="size-4" aria-hidden /> Descargar
                </a>
              </li>
            ))}
          </ul>
        )}
        {current?.resume_extractions ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Revisión de la extracción (versión vigente)</h3>
            <ExtractionReview
              candidateId={candidateId}
              resumeId={current.id}
              extraction={current.resume_extractions}
              canManage={canManage}
              isPdf={current.mime_type === "application/pdf"}
              existingSkills={existingSkills}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
