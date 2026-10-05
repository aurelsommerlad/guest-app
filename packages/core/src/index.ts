export { APP_ENVIRONMENTS, appEnvironmentSchema, type AppEnvironment } from "./env/app-environment";
export { EnvValidationError, parseEnv } from "./env/parse-env";
export {
  createLogger,
  LOG_LEVELS,
  type Logger,
  type LogLevel,
  type LogSink,
} from "./logging/logger";
export { deriveStayPhase, type StayPhase, type StayWindow } from "./stay/stay-phase";
export { type LocalizedText, resolveLocalizedText } from "./i18n/localized-text";
export {
  type ContentAudience,
  isVisible,
  type Visibility,
  type VisibilityBoundary,
  type VisibilityContext,
} from "./content/visibility";
export {
  type ContentImage,
  type ContentScope,
  type GuideBlock,
  type GuideIcon,
  type GuideSection,
} from "./guide/guide-model";
export {
  type GuideContext,
  scopeApplies,
  selectGuideSections,
} from "./guide/select-guide-sections";
