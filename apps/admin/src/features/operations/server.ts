import "server-only";

import { apaleoPropertyIdOf, serviceWriteGateway } from "../../server/apaleo-services";
import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { type OperationsDeps } from "./operations-service";

export function operationsDeps(): OperationsDeps {
  return {
    db: getDatabase(),
    logger,
    now: () => new Date(),
    gateway: serviceWriteGateway,
    apaleoPropertyIdOf,
  };
}
