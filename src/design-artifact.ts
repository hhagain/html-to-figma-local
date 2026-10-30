export interface DesignArtifact {
  kind: 'page' | 'component'; familyId: string; familyName: string; stateName: string; reason: string; sampleCount: number;
}
export function validArtifact(value: unknown): value is DesignArtifact {
  const v = value as DesignArtifact;
  return !!v && typeof v === 'object' && !Array.isArray(v) && ['page','component'].includes(v.kind)
    && typeof v.familyId === 'string' && /^[\w-]{1,200}$/.test(v.familyId)
    && ['familyName','stateName','reason'].every(k => typeof (v as any)[k] === 'string' && (v as any)[k].length > 0 && (v as any)[k].length <= 500)
    && Number.isSafeInteger(v.sampleCount) && v.sampleCount >= 1;
}
