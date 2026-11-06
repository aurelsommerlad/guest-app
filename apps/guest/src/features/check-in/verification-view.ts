/**
 * Serializable form of the verification view for client components (dates as ISO strings).
 */
import { type ContactVerificationView } from "./contact-verification-service";

export type VerificationPanelView = {
  required: boolean;
  offered: boolean;
  status: ContactVerificationView["status"];
  masked?: string;
  pending?: { expiresAt: string; attemptsLeft: number; resendAt: string; simulated: boolean };
  blocksSubmit: boolean;
  /** Minutes a code is valid (for the text). */
  validMinutes: number;
};

export function toPanelView(
  view: ContactVerificationView,
  validMinutes: number,
): VerificationPanelView {
  return {
    required: view.required,
    offered: view.offered,
    status: view.status,
    ...(view.masked ? { masked: view.masked } : {}),
    ...(view.pending
      ? {
          pending: {
            expiresAt: view.pending.expiresAt.toISOString(),
            attemptsLeft: view.pending.attemptsLeft,
            resendAt: view.pending.resendAt.toISOString(),
            simulated: view.pending.simulated,
          },
        }
      : {}),
    blocksSubmit: view.blocksSubmit,
    validMinutes,
  };
}
