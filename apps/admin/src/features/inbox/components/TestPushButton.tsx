"use client";

import { useActionState } from "react";

import { type PushActionState, testPushAction } from "../push-actions";

export function TestPushButton({
  subscriptionId,
  enabled,
}: {
  subscriptionId: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState<PushActionState>(
    testPushAction.bind(null, subscriptionId),
    { status: "idle" },
  );
  return (
    <form action={action} className="flex flex-col gap-1">
      <button
        type="submit"
        disabled={!enabled || pending}
        className="type-small min-h-11 self-start underline disabled:no-underline disabled:opacity-40 md:min-h-9"
      >
        {pending ? "Wird gesendet …" : "Test-Mitteilung senden"}
      </button>
      {state.status !== "idle" && (
        <p role="status" className="type-caption text-text">
          {state.message}
        </p>
      )}
    </form>
  );
}
