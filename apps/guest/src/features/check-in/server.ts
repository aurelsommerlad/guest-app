import "server-only";

import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { type CheckInDeps } from "./check-in-service";

export function checkInDeps(): CheckInDeps {
  return { db: getDatabase(), logger, now: () => new Date() };
}
