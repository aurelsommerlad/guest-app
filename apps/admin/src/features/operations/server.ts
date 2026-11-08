import "server-only";

import {
  apaleoPropertyIdOf,
  decisionEngine,
  serviceWriteGateway,
} from "../../server/apaleo-services";
import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { type OperationsDeps } from "./operations-service";

export function operationsDeps(): OperationsDeps {
  return {
    db: getDatabase(),
    logger,
    now: () => new Date(),
    gateway: serviceWriteGateway,
    engine: decisionEngine,
    apaleoPropertyIdOf,
  };
}
