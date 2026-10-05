import "server-only";

import { MOCK_NOW, mockStay } from "../../mocks/stay/mock-stay";
import { type Locale } from "../../i18n/routing";
import { buildStayViewModel } from "./build-stay-view-model";
import { type StayViewModel } from "./model";

/**
 * Loads the current guest's stay. Phase 2: mock data with a fixed "now".
 * Later: resolve the stay from the guest session and load it from the database.
 */
export function getStay(locale: Locale): StayViewModel {
  return buildStayViewModel(mockStay, locale, MOCK_NOW);
}
