import "server-only";

import { getDatabase } from "../../server/database";
import { logger } from "../../server/logger";
import { pmsFor } from "../../server/pms";
import { verificationConfig } from "../../server/verification";
import { type CheckInDeps } from "./check-in-service";
import { contactVerificationView, type VerificationDeps } from "./contact-verification-service";

export function verificationDeps(): VerificationDeps {
  return { db: getDatabase(), logger, now: () => new Date(), pmsFor, ...verificationConfig() };
}

export function checkInDeps(): CheckInDeps {
  return {
    db: getDatabase(),
    logger,
    now: () => new Date(),
    pmsFor,
    // A required e-mail confirmation blocks the submit only when a code can be sent.
    verificationGate: async (context, journey) => {
      const view = await contactVerificationView(verificationDeps(), context, journey, "email");
      return view.blocksSubmit ? "blocked" : "ok";
    },
  };
}
