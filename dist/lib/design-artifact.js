// src/design-artifact.ts
function validArtifact(value) {
  const v = value;
  return !!v && typeof v === "object" && !Array.isArray(v) && ["page", "component", "icon"].includes(v.kind) && typeof v.familyId === "string" && /^[\w-]{1,200}$/.test(v.familyId) && ["familyName", "stateName", "reason"].every((k) => typeof v[k] === "string" && v[k].length > 0 && v[k].length <= 500) && Number.isSafeInteger(v.sampleCount) && v.sampleCount >= 1;
}
export {
  validArtifact
};
