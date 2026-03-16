export function multimodalStoryboardAnalysisEnabled() {
  return process.env.ENABLE_MULTIMODAL_STORYBOARD_ANALYSIS !== "false";
}

export function generatedSupportEnabled() {
  return process.env.ENABLE_GENERATED_SUPPORT_MEDIA === "true";
}

export function generatedSupportMediaMode() {
  return process.env.GENERATED_SUPPORT_MEDIA_MODE === "video" ? "video" : "image";
}

export function generatedSupportVideoEnabled() {
  return generatedSupportMediaMode() === "video";
}
