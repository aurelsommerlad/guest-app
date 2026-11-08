/**
 * Read-only Apaleo calls the Extras booking logic needs (M1-C). Scopes: reservations.read,
 * offers.read, setup.read – no write scope is used here. Schemas validate only the fields the
 * rules read; everything else passes through untouched and is never logged.
 */
import { isPastDate, PmsError } from "@up/core";
import { z } from "zod";

import { type ApaleoClient } from "../apaleo-client";

const money = z.object({ amount: z.number(), currency: z.string() }).loose();
const grossMoney = z
  .object({ grossAmount: z.number().optional(), currency: z.string().optional() })
  .loose();

export const reservationForServicesSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    property: z.object({ id: z.string() }).loose(),
    unitGroup: z.object({ id: z.string() }).loose().optional(),
    arrival: z.string(),
    departure: z.string(),
    adults: z.number().int(),
    childrenAges: z.array(z.number()).optional(),
    bookingId: z.string().optional(),
    unit: z
      .object({ id: z.string().optional(), unitGroupId: z.string().optional() })
      .loose()
      .optional(),
    actions: z
      .array(z.object({ action: z.string(), isAllowed: z.boolean().optional() }).loose())
      .optional(),
    hasCityTax: z.boolean().optional(),
    primaryGuest: z
      .object({
        vehicleRegistration: z.object({ number: z.string().optional() }).loose().optional(),
      })
      .loose()
      .optional(),
    timeSlices: z
      .array(
        z
          .object({
            ratePlan: z.object({ id: z.string() }).loose().optional(),
            totalGrossAmount: money.optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();
export type ReservationForServices = z.infer<typeof reservationForServicesSchema>;

const serviceOfferSchema = z
  .object({
    service: z
      .object({ id: z.string(), name: z.string().optional(), code: z.string().optional() })
      .loose(),
    dates: z
      .array(
        z
          .object({
            serviceDate: z.string(),
            amount: grossMoney.optional(),
            count: z.number().optional(),
            isAvailable: z.boolean().optional(),
            isDefaultDate: z.boolean().optional(),
            availableCount: z.number().optional(),
          })
          .loose(),
      )
      .optional(),
    totalAmount: grossMoney.optional(),
    availabilityMode: z.string().optional(),
  })
  .loose();
const serviceOffersSchema = z.object({ services: z.array(serviceOfferSchema) }).loose();
export type ApaleoServiceOfferRecord = z.infer<typeof serviceOfferSchema>;

const bookedServiceSchema = z
  .object({
    service: z
      .object({ id: z.string(), name: z.string().optional(), code: z.string().optional() })
      .loose(),
    dates: z
      .array(
        z
          .object({
            serviceDate: z.string(),
            count: z.number().optional(),
            amount: grossMoney.optional(),
            isMandatory: z.boolean().optional(),
          })
          .loose(),
      )
      .optional(),
    isMandatory: z.boolean().optional(),
  })
  .loose();
const reservationServicesSchema = z.object({ services: z.array(bookedServiceSchema) }).loose();
export type ApaleoBookedServiceRecord = z.infer<typeof bookedServiceSchema>;

const serviceDefinitionSchema = z
  .object({
    id: z.string(),
    code: z.string().optional(),
    name: z.string().optional(),
    property: z.object({ id: z.string() }).loose().optional(),
    availability: z.object({ mode: z.string().optional() }).loose().optional(),
    postNextDay: z.boolean().optional(),
    defaultGrossPrice: z.object({ amount: z.number(), currency: z.string() }).loose().optional(),
    pricingUnit: z.string().optional(),
  })
  .loose();
const servicesListSchema = z.object({ services: z.array(serviceDefinitionSchema) }).loose();
export type ApaleoServiceDefinition = z.infer<typeof serviceDefinitionSchema>;

const unitGroupsListSchema = () => z.object({ unitGroups: z.array(unitGroupSchema) }).loose();
const unitGroupSchema = z
  .object({
    id: z.string(),
    code: z.string().optional(),
    name: z.string().optional(),
    maxPersons: z.number().optional(),
  })
  .loose();
export type ApaleoUnitGroup = z.infer<typeof unitGroupSchema>;

const nightlyAvailabilitySchema = z
  .object({
    timeSlices: z.array(
      z
        .object({
          from: z.string(),
          to: z.string(),
          unitGroups: z
            .array(
              z
                .object({
                  availableCount: z.number().optional(),
                  physicalCount: z.number().optional(),
                })
                .loose(),
            )
            .optional(),
        })
        .loose(),
    ),
  })
  .loose();
export type NightlyAvailability = z.infer<typeof nightlyAvailabilitySchema>["timeSlices"];

const availableUnitsSchema = z
  .object({ units: z.array(z.object({ id: z.string() }).loose()) })
  .loose();

const foliosSchema = z
  .object({
    folios: z.array(
      z
        .object({
          charges: z
            .array(
              z
                .object({
                  type: z.string().optional(),
                  serviceDate: z.string().optional(),
                  amount: grossMoney.optional(),
                })
                .loose(),
            )
            .optional(),
        })
        .loose(),
    ),
  })
  .loose();
export type ApaleoFolio = z.infer<typeof foliosSchema>["folios"][number];

const localizedText = z.union([z.string(), z.record(z.string(), z.string())]).optional();
const localizedServiceSchema = z
  .object({ id: z.string(), name: localizedText, description: localizedText })
  .loose();

/** Extras' localizedMapFromApaleo: a plain string serves both languages. */
function localizedMap(value: string | Record<string, string> | undefined) {
  if (!value) return { de: "", en: "" };
  if (typeof value === "string") return { de: value, en: value };
  return { de: value.de ?? value["de-DE"] ?? "", en: value.en ?? value["en-US"] ?? "" };
}

const enc = encodeURIComponent;

export class ApaleoServiceReader {
  readonly #client: ApaleoClient;

  constructor(client: ApaleoClient) {
    this.#client = client;
  }

  getReservation(reservationId: string): Promise<ReservationForServices> {
    return this.#client.get(
      `/booking/v1/reservations/${enc(reservationId)}?expand=timeSlices`,
      reservationForServicesSchema,
      "services.getReservation",
    );
  }

  /**
   * The reservation as Extras reads it for the stay extension (timeSlices, actions and the
   * assigned unit expanded). Unknown reservation → null.
   */
  async getReservationForExtension(reservationId: string): Promise<ReservationForServices | null> {
    try {
      return await this.#client.get(
        `/booking/v1/reservations/${enc(reservationId)}?expand=timeSlices,actions,assignedUnits`,
        reservationForServicesSchema,
        "services.getReservationForExtension",
      );
    } catch (error) {
      if (error instanceof PmsError && error.kind === "not-found") return null;
      throw error;
    }
  }

  /** Service offers exactly as Extras requests them (no query parameters). */
  async getServiceOffers(reservationId: string): Promise<ApaleoServiceOfferRecord[]> {
    const result = await this.#client.getList(
      `/booking/v1/reservations/${enc(reservationId)}/service-offers`,
      serviceOffersSchema,
      "services.getServiceOffers",
    );
    return result?.services ?? [];
  }

  /**
   * Extras' getServiceOffers: a departure before today, or Apaleo's 422 ("cannot be booked for
   * a reservation in the past"), is a past stay – an empty, flagged result instead of an error.
   */
  async getServiceOffersForStay(
    reservationId: string,
    departureDate: string | null,
    today: Date,
  ): Promise<{ items: ApaleoServiceOfferRecord[]; pastStay: boolean }> {
    if (isPastDate(departureDate, today)) return { items: [], pastStay: true };
    try {
      return { items: await this.getServiceOffers(reservationId), pastStay: false };
    } catch (error) {
      if (error instanceof PmsError && error.status === 422) return { items: [], pastStay: true };
      throw error;
    }
  }

  /** Nightly availability of one unit group over [from, to) – one time slice per night. */
  async getUnitGroupNightlyAvailability(
    apaleoPropertyId: string,
    unitGroupId: string,
    from: string,
    to: string,
  ): Promise<NightlyAvailability> {
    const query = new URLSearchParams({
      propertyId: apaleoPropertyId,
      unitGroupIds: unitGroupId,
      from,
      to,
    });
    const result = await this.#client.getList(
      `/availability/v1/unit-groups?${query.toString()}`,
      nightlyAvailabilitySchema,
      "services.getUnitGroupAvailability",
    );
    return result?.timeSlices ?? [];
  }

  /** Whether exactly this unit is free for [from, to) (date-times from the nightly slice). */
  async isUnitAvailable(
    apaleoPropertyId: string,
    unitGroupId: string,
    unitId: string,
    from: string,
    to: string,
  ): Promise<boolean> {
    const query = new URLSearchParams({ propertyId: apaleoPropertyId, unitGroupId, from, to });
    const result = await this.#client.getList(
      `/availability/v1/units?${query.toString()}`,
      availableUnitsSchema,
      "services.getAvailableUnits",
    );
    return (result?.units ?? []).some((u) => u.id === unitId);
  }

  /** Folios of a reservation with charges – only read for the posted city tax. */
  async listReservationFolios(reservationId: string): Promise<ApaleoFolio[]> {
    const query = new URLSearchParams({ reservationIds: reservationId, expand: "charges" });
    const result = await this.#client.getList(
      `/finance/v1/folios?${query.toString()}`,
      foliosSchema,
      "services.listFolios",
    );
    return result?.folios ?? [];
  }

  /** Localized service name/description (languages=de,en); never throws, like Extras. */
  async getServiceLocalized(
    serviceId: string,
  ): Promise<{ name: { de: string; en: string }; description: { de: string; en: string } } | null> {
    try {
      const data = await this.#client.get(
        `/rateplan/v1/services/${enc(serviceId)}?languages=de,en`,
        localizedServiceSchema,
        "services.getServiceLocalized",
      );
      return { name: localizedMap(data.name), description: localizedMap(data.description) };
    } catch {
      return null;
    }
  }

  async getBookedServices(reservationId: string): Promise<ApaleoBookedServiceRecord[]> {
    const result = await this.#client.getList(
      `/booking/v1/reservations/${enc(reservationId)}/services`,
      reservationServicesSchema,
      "services.getBookedServices",
    );
    return result?.services ?? [];
  }

  getServiceDefinition(serviceId: string): Promise<ApaleoServiceDefinition> {
    return this.#client.get(
      `/rateplan/v1/services/${enc(serviceId)}`,
      serviceDefinitionSchema,
      "services.getService",
    );
  }

  async listServiceDefinitions(apaleoPropertyId: string): Promise<ApaleoServiceDefinition[]> {
    const result = await this.#client.getList(
      `/rateplan/v1/services?propertyId=${enc(apaleoPropertyId)}&onlySoldAsExtras=true&pageSize=200`,
      servicesListSchema,
      "services.listServices",
    );
    return result?.services ?? [];
  }

  async listUnitGroups(apaleoPropertyId: string): Promise<ApaleoUnitGroup[]> {
    const result = await this.#client.getList(
      `/inventory/v1/unit-groups?propertyId=${enc(apaleoPropertyId)}&pageSize=200`,
      unitGroupsListSchema(),
      "services.listUnitGroups",
    );
    return result?.unitGroups ?? [];
  }

  getUnitGroup(unitGroupId: string): Promise<ApaleoUnitGroup> {
    return this.#client.get(
      `/inventory/v1/unit-groups/${enc(unitGroupId)}`,
      unitGroupSchema,
      "services.getUnitGroup",
    );
  }
}
