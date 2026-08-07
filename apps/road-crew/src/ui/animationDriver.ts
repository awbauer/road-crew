/**
 * Native Fabric animations must use the native driver so React Native does not
 * replace ShadowNode native props from JavaScript on every frame. React Native
 * Web has no native animation module and keeps its JS driver fallback.
 */
export function shouldUseNativeAnimationDriver(platform: string): boolean {
  return platform !== "web";
}
