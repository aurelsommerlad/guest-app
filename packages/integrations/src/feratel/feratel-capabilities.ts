/**
 * What the Feratel interface is known to support. Only facts from the official documentation
 * may switch a value to true (F4). Public sources (ADR 0022, docs/integrations) describe
 * pre-registrations, registration forms and guest cards in the Feratel web client, but not
 * how – or whether – the PMS interface exposes them. Until then: nothing.
 */
import { NO_CAPABILITIES, type ProviderCapabilities } from "@up/core";

export const FERATEL_DOCUMENTED_CAPABILITIES: ProviderCapabilities = NO_CAPABILITIES;
