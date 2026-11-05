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
  CONTENT_LOCALES,
  type ContentImage,
  type ContentLocale,
  type ContentScope,
  GUIDE_ICONS,
  GUIDE_STATUSES,
  type GuideBlock,
  type GuideContent,
  type GuideEntry,
  type GuideIcon,
  type GuideOverride,
  type GuideSection,
  type GuideStatus,
  type GuideTopic,
  SOURCE_LOCALE,
  type TranslationState,
  type TranslationStatus,
} from "./guide/guide-model";
export {
  type GuideContext,
  resolveGuideSections,
  scopeApplies,
} from "./guide/resolve-guide-sections";
export {
  contentImageSchema,
  guideBlockSchema,
  guideContentSchema,
  guideKeySchema,
  guideStatusSchema,
  guideTopicMetaSchema,
  httpUrlSchema,
  localizedSlugSchema,
  localizedTextSchema,
  optionalLocalizedTextSchema,
  slugify,
} from "./guide/guide-schema";
export {
  dummyPasswordHash,
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from "./auth/password";
export {
  PmsError,
  type PmsErrorKind,
  type PmsProvider,
  type PmsReservation,
  type PmsReservationCandidate,
  type PmsReservationStatus,
} from "./pms/pms-provider";
export {
  occupancyTotal,
  type PmsGuestData,
  type PmsOccupancy,
  type PmsReservationGuests,
  prefillGuests,
} from "./registration/prefill";
export {
  isRelayEmail,
  normalizeEmail,
  RELAY_EMAIL_DOMAINS,
  usableContactEmail,
} from "./contact/email";
export {
  EXPLORE_CATEGORIES,
  EXPLORE_FILTERS,
  type ExploreCategory,
  type ExploreFilter,
  type ExplorePlace,
  type ExploreStatus,
} from "./explore/explore-model";
export {
  categoriesOf,
  compareExplorePlaces,
  englishStateOf,
  type ExploreContext,
  filterPlacesByCategory,
  isPlaceVisibleFor,
  selectExplorePlaces,
} from "./explore/select-explore-places";
export {
  exploreCategorySchema,
  type ExplorePlaceInput,
  explorePlaceSchema,
  phoneSchema,
} from "./explore/explore-schema";
export {
  ENTITY_KEY_PATTERN,
  EXTERNAL_ENTITY_TYPES,
  EXTERNAL_PROVIDERS,
  type ExternalEntityType,
  type ExternalProvider,
  isEntityKey,
  isExternalEntityType,
  isExternalProvider,
  isValidTimeZone,
  type Property,
  type Tenant,
  type TenantContext,
  type Unit,
} from "./tenancy/tenancy-model";
export {
  constantTimeEquals,
  generateSecret,
  hashSecret,
  isSecretHash,
  isWellFormedSecret,
  SECRET_BYTES,
} from "./guest-access/access-token";
export {
  type AccessState,
  type AccessWindowPolicy,
  computeAccessWindow,
  DEFAULT_ACCESS_WINDOW_POLICY,
  evaluateAccess,
  type GuestAccess,
  isReservationProvider,
  RESERVATION_PROVIDERS,
  type ReservationProvider,
} from "./guest-access/guest-access-model";
export {
  lastNameMatches,
  normalizeBookingReference,
  normalizeLastName,
} from "./guest-access/guest-login";
export {
  deriveGuestJourney,
  deriveJourneyPhase,
  type GuestJourney,
  JOURNEY_ACTIONS,
  JOURNEY_PHASES,
  type JourneyAccessState,
  type JourneyAction,
  type JourneyPhase,
  type JourneyWindow,
  localDateOf,
  primaryActionFor,
  REGISTRATION_PROGRESS,
  type RegistrationProgress,
} from "./journey/guest-journey";
export {
  ADDRESS_FIELDS,
  CHECK_IN_STEPS,
  type CheckInStep,
  DOCUMENT_TYPES,
  type DocumentType,
  GUEST_COUNT_SOURCES,
  GUEST_ROLES,
  type GuestCountSource,
  type GuestFieldRules,
  type GuestRegistration,
  type GuestRole,
  MANDATORY_FIELDS,
  MAX_TRAVELLERS,
  ROLE_MANDATORY_FIELDS,
  type PropertyRegistrationConfig,
  REGISTRATION_FIELDS,
  REGISTRATION_STATUSES,
  REGISTRATION_TARGETS,
  type RegistrationField,
  type RegistrationGuest,
  type RegistrationGuestData,
  type RegistrationStatus,
  type RegistrationTarget,
} from "./registration/registration-model";
export {
  ageOn,
  assessRegistration,
  type FieldError,
  fieldsForRole,
  guestMissingFields,
  guestStepFields,
  hasAddressStep,
  isValidIsoDate,
  missingFields,
  normalizeGuestInput,
  PERSONAL_FIELDS,
  propertyRegistrationConfigSchema,
  REGISTRATION_DISABLED,
  type RegistrationAssessment,
  rulesFor,
  type StepState,
} from "./registration/registration-rules";
export {
  type GuestRegistrationProvider,
  MAX_SYNC_ATTEMPTS,
  nextSyncState,
  type RegistrationSubmission,
  retryDelayMs,
  SYNC_ERROR_CODES,
  SYNC_LEASE_MS,
  SYNC_STATUSES,
  type SyncErrorCode,
  type SyncMemory,
  type SyncOutcome,
  type SyncStatus,
} from "./registration/registration-sync";
export { COUNTRY_CODES, isCountryCode } from "./registration/countries";
export {
  ACCESS_CREDENTIAL_STATUSES,
  ACCESS_CREDENTIAL_TYPES,
  ACCESS_MODES,
  ACCESS_RELEASES,
  type AccessCredential,
  type AccessCredentialStatus,
  type AccessCredentialType,
  type AccessMode,
  type AccessPendingReason,
  type AccessProvider,
  type AccessRelease,
  accessReleaseAt,
  type AccessRequest,
  DEFAULT_ACCESS_CONFIG,
  getAccessForStay,
  type GuestAccessCredential,
  type PropertyAccessConfig,
  type StayAccess,
  type StayAccessInput,
} from "./access/access-model";
export { keyboxCodeSchema, propertyAccessConfigSchema } from "./access/access-schema";
export {
  type AccessCodeBinding,
  AccessCodeKeyError,
  decryptAccessCode,
  encryptAccessCode,
  parseAccessCodeKey,
} from "./access/access-code-cipher";

export {
  confirmsPayment,
  dueRuleFor,
  evaluatePayment,
  type PaymentAccessCondition,
  paymentAccessCondition,
  paymentDueAt,
  type PaymentEvaluation,
  type PaymentReviewReason,
  type PaymentState,
  type PaymentTotals,
  unknownPayment,
} from "./payment/evaluate-payment";
export {
  type PaymentConfig,
  paymentConfigSchema,
  type PaymentDueRule,
  paymentDueRuleSchema,
  PAYMENTS_OFF,
} from "./payment/payment-config";
export type {
  DebitorKind,
  FolioCharge,
  FolioKind,
  FolioPayment,
  FolioRefund,
  Money,
  PaymentFolio,
  PaymentReservationFacts,
  PaymentStatus,
  PaymentSummary,
} from "./payment/payment-summary";
export { type PaymentProvider } from "./payment/payment-provider";

// Check-in validation and verification (ADR 0021, phase C1 – not wired into the apps yet).
export {
  ADDRESS_GRANULARITIES,
  ADDRESS_STATUSES,
  type AddressAssessment,
  type AddressEvidence,
  type AddressFieldIssue,
  type AddressGranularity,
  type AddressInputMode,
  addressIssues,
  type AddressStatus,
  assessAddress,
  type PostalAddress,
  sameAddress,
} from "./address/address-check";
export {
  type AddressLookupFailure,
  type AddressProvider,
  type AddressSuggestion,
} from "./address/address-provider";
export {
  checkPostalCode,
  normalizePostalCode,
  POSTAL_CODE_NOT_USED,
  POSTAL_CODE_PATTERNS,
  type PostalCodeCheck,
} from "./address/postal-codes";
export {
  attemptOtp,
  canIssueOtp,
  contactTargetHash,
  generateOtpCode,
  hashOtpCode,
  maskEmail,
  maskPhone,
  newOtpChallenge,
  normalizeOtpInput,
  OTP_CHALLENGE_STATUSES,
  OTP_CHANNELS,
  OTP_CODE_LENGTH,
  OTP_POLICIES,
  type OtpAttemptOutcome,
  type OtpChallenge,
  type OtpChallengeStatus,
  type OtpChannel,
  type OtpIssueDecision,
  type OtpPolicy,
  type OtpSend,
  supersede,
} from "./verification/otp";
export {
  CONTACT_VERIFICATION_STATUSES,
  type ContactVerificationRecord,
  type ContactVerificationStatus,
  contactVerificationStatus,
  type ContactWaiver,
  contactWaiverSchema,
  DEFAULT_SMS_VERIFICATION,
  satisfiesRequiredVerification,
  type SmsAvailability,
  smsAvailability,
  type SmsVerificationConfig,
  smsVerificationConfigSchema,
  WAIVER_REASONS,
  type WaiverReason,
} from "./verification/contact-verification";
export {
  type MessageSendResult,
  type VerificationEmailSender,
  type VerificationMessage,
  type VerificationSmsSender,
} from "./verification/message-ports";
export {
  AGE_DECLARATION_STATUSES,
  type AgeDeclarationStatus,
  DEFAULT_RESPONSIBLE_ADULT_MIN_AGE,
  MAX_PLAUSIBLE_AGE,
  responsibleAdultStatus,
} from "./registration/responsible-adult";
export {
  CONTACT_FIELDS,
  DATA_CLASSES,
  type DataClass,
  FIELD_DATA_CLASS,
  LEGAL_FIELDS,
  splitGuestData,
} from "./registration/data-classification";
export {
  type AddressSource,
  resolveSharedAddresses,
  SHARED_ADDRESS_POLICIES,
  type SharedAddressGuest,
  type SharedAddressPolicy,
  type SharedAddressResult,
} from "./registration/shared-address";
export {
  configFromTemplate,
  DE_BMG_TEMPLATE,
  LEGAL_REGISTRATION_TEMPLATES,
  type LegalRegistrationTemplate,
  legalRequiredFields,
  registrationFormRequired,
} from "./registration/legal-templates";
export {
  checkVatIdFormat,
  normalizeVatId,
  VAT_ID_STATUSES,
  type VatIdChecker,
  type VatIdFormat,
  type VatIdStatus,
  vatIdStatus,
  VIES_PREFIXES,
} from "./billing/vat-id";
export {
  BILLING_KINDS,
  type BillingChoice,
  type BillingFieldIssue,
  type BillingKind,
  type CompanyBillingAddress,
  DEFAULT_BILLING_CHOICE,
  normalizeBillingInput,
} from "./billing/billing-address";
export {
  BILLING_DEBITOR_KINDS,
  BILLING_FOLIO_KINDS,
  BILLING_PLAN_ACTIONS,
  type BillingDebitorKind,
  billingFingerprint,
  type BillingFolioFacts,
  type BillingFolioKind,
  type BillingFolioPlan,
  type BillingPlanAction,
  type BillingTransferPlan,
  planBillingTransfer,
} from "./billing/billing-transfer";
export {
  type CheckInValidationPolicy,
  checkInValidationPolicySchema,
  DEFAULT_CHECK_IN_VALIDATION_POLICY,
} from "./check-in-status/validation-policy";
export {
  BILLING_STATUSES,
  type BillingStatus,
  billingStatus,
  type CheckInStatus,
  type CheckInStatusInput,
  COMPLETENESS_BLOCKERS,
  type CompletenessBlocker,
  deriveCheckInStatus,
  IDENTITY_CHECK_STATUSES,
  type IdentityCheckRecord,
  type IdentityCheckStatus,
  identityCheckStatus,
  LEGAL_REGISTRATION_STATUSES,
  type LegalRegistrationStatus,
  legalRegistrationStatus,
} from "./check-in-status/check-in-status";
