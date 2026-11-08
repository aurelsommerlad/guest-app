import "server-only";

import { apaleoPropertyIdOf, shadowEngine } from "../../server/apaleo-services";
import { type ShadowDeps } from "./shadow-service";

export function shadowDeps(): ShadowDeps {
  return { engine: shadowEngine, apaleoPropertyIdOf };
}
