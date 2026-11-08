/**
 * Read-only Apaleo calls the Extras booking logic needs (M1-C). Scopes: reservations.read,
 * offers.read, setup.read – no write scope is used here. Schemas validate only the fields the
 * rules read; everything else passes through untouched and is never logged.
 */
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
          })
          .loose(),
      )
      .optional(),
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
  })
  .loose();
const servicesListSchema = z.object({ services: z.array(serviceDefinitionSchema) }).loose();
export type ApaleoServiceDefinition = z.infer<typeof serviceDefinitionSchema>;

const unitGroupSchema = z
  .object({
    id: z.string(),
    code: z.string().optional(),
    name: z.string().optional(),
    maxPersons: z.number().optional(),
  })
  .loose();
export type ApaleoUnitGroup = z.infer<typeof unitGroupSchema>;

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

  async getServiceOffers(reservationId: string): Promise<ApaleoServiceOfferRecord[]> {
    const result = await this.#client.getList(
      `/booking/v1/reservations/${enc(reservationId)}/service-offers?onlyDefaultDates=false`,
      serviceOffersSchema,
      "services.getServiceOffers",
    );
    return result?.services ?? [];
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
      `/rateplan/v1/services?propertyId=${enc(apaleoPropertyId)}&pageSize=200`,
      servicesListSchema,
      "services.listServices",
    );
    return result?.services ?? [];
  }

  getUnitGroup(unitGroupId: string): Promise<ApaleoUnitGroup> {
    return this.#client.get(
      `/inventory/v1/unit-groups/${enc(unitGroupId)}`,
      unitGroupSchema,
      "services.getUnitGroup",
    );
  }
}
