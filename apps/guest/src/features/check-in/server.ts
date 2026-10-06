import "server-only";

import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { pmsFor } from "../../server/pms";
import { type CheckInDeps } from "./check-in-service";

export function checkInDeps(): CheckInDeps {
  return { db: getDatabase(), logger, now: () => new Date(), pmsFor };
}
