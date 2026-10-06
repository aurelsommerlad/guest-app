/**
 * Key box access (ADR 0017): one code per unit, stored encrypted; decrypted only on the
 * server when getAccessForStay() has already decided the guest may see it.
 * A smart-lock adapter (Nuki, DOM, TESA, Glutz, Pindora …) implements the same port later.
 */
import {
  type AccessCredential,
  type AccessProvider,
  type AccessRequest,
  decryptAccessCode,
  type Logger,
} from "@up/core";

export type KeyboxAccessProviderOptions = {
  /** 32-byte key (parseAccessCodeKey(ACCESS_CODE_KEY)). */
  key: Buffer;
  /** Encrypted code of the unit, if one is stored. */
  loadCiphertext: (request: {
    tenantId: string;
    propertyId: string;
    unitId: string;
  }) => Promise<string | undefined>;
  logger: Logger;
};

export class KeyboxAccessProvider implements AccessProvider {
  readonly name = "keybox";
  readonly #options: KeyboxAccessProviderOptions;

  constructor(options: KeyboxAccessProviderOptions) {
    this.#options = options;
  }

  async getCredential(request: AccessRequest): Promise<AccessCredential | undefined> {
    if (!request.unitId) return undefined;
    const binding = {
      tenantId: request.tenantId,
      propertyId: request.propertyId,
      unitId: request.unitId,
    };
    const stored = await this.#options.loadCiphertext(binding);
    if (!stored) return undefined;
    const code = decryptAccessCode(this.#options.key, binding, stored);
    if (!code) {
      // Wrong key or tampered value – never log the value itself.
      this.#options.logger.error("key box code could not be decrypted", {
        tenantId: request.tenantId,
        propertyId: request.propertyId,
        unitId: request.unitId,
      });
      return undefined;
    }
    return {
      type: "keybox",
      status: "active",
      validFrom: request.checkInAt,
      validUntil: request.checkOutAt,
      displayValue: code,
      provider: this.name,
    };
  }
}
