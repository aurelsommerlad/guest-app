import { type ServerEnv } from "../../env/schema";

export type StayDataSourceConfig =
  | { kind: "mock"; reservationId: string }
  | { kind: "apaleo"; reservationId: string; clientId: string; clientSecret: string };

/**
 * Picks the stay data source from the validated environment. Apaleo mode always
 * uses the server-side preview reservation – never an id from the request.
 * (The env schema already forbids apaleo mode and preview reservations in production.)
 */
export function resolveStayDataSource(
  env: Pick<
    ServerEnv,
    | "APP_ENV"
    | "STAY_DATA_SOURCE"
    | "APALEO_CLIENT_ID"
    | "APALEO_CLIENT_SECRET"
    | "APALEO_PREVIEW_RESERVATION_ID"
  >,
  mockReservationId: string,
): StayDataSourceConfig {
  if (env.STAY_DATA_SOURCE !== "apaleo") {
    return { kind: "mock", reservationId: mockReservationId };
  }
  if (
    env.APP_ENV === "production" ||
    !env.APALEO_CLIENT_ID ||
    !env.APALEO_CLIENT_SECRET ||
    !env.APALEO_PREVIEW_RESERVATION_ID
  ) {
    // Defence in depth – validation should have stopped this earlier.
    throw new Error("Apaleo data source is not configured for this environment");
  }
  return {
    kind: "apaleo",
    reservationId: env.APALEO_PREVIEW_RESERVATION_ID,
    clientId: env.APALEO_CLIENT_ID,
    clientSecret: env.APALEO_CLIENT_SECRET,
  };
}
