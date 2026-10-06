import { type GuestRegistrationProvider, type RegistrationTarget } from "@up/core";
import { FeratelRegistrationProvider } from "@up/integrations";

/**
 * Which targets may be called in this environment (ADR 0016):
 * - apaleo: only with APALEO_REGISTRATION_WRITEBACK=enabled and credentials
 * - feratel: never until the interface is verified (FeratelRegistrationProvider.implemented)
 * Everything else stays a pending sync row – collected, not sent.
 */
export function selectRegistrationProviders(
  env: {
    APALEO_REGISTRATION_WRITEBACK: "disabled" | "enabled";
    APALEO_CLIENT_ID?: string | undefined;
    APALEO_CLIENT_SECRET?: string | undefined;
  },
  create: { apaleo: () => GuestRegistrationProvider },
  feratelImplemented: boolean = FeratelRegistrationProvider.implemented,
): Partial<Record<RegistrationTarget, GuestRegistrationProvider>> {
  const providers: Partial<Record<RegistrationTarget, GuestRegistrationProvider>> = {};
  if (
    env.APALEO_REGISTRATION_WRITEBACK === "enabled" &&
    env.APALEO_CLIENT_ID &&
    env.APALEO_CLIENT_SECRET
  ) {
    providers.apaleo = create.apaleo();
  }
  if (feratelImplemented) providers.feratel = new FeratelRegistrationProvider();
  return providers;
}
