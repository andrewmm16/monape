import type { ResumeKind } from "@/modules/resumes/file-validation";

/** Ruta temporal de un archivo del lote (el bucket `resumes` es privado). */
export function intakeStoragePath(batchId: string, itemId: string, kind: ResumeKind): string {
  return `intake/${batchId}/${itemId}.${kind}`;
}

/** Ruta definitiva exigida por resumes_storage_path_check. */
export function resumeStoragePath(candidateId: string, resumeId: string, kind: ResumeKind): string {
  return `candidates/${candidateId}/${resumeId}.${kind}`;
}

export function kindFromPath(path: string): ResumeKind | null {
  const extension = path.split(".").pop();
  return extension === "pdf" || extension === "docx" ? extension : null;
}
