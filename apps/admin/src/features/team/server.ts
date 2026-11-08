import "server-only";

import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { type TeamDeps } from "./team-service";

export function teamDeps(): TeamDeps {
  return { db: getDatabase(), logger, now: () => new Date() };
}
