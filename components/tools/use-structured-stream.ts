"use client";

import * as React from "react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import type { z } from "zod";
import { readableError } from "@/lib/api-client";

/**
 * Thin wrapper over the AI SDK's useObject: partial objects stream in token
 * by token; on completion the full object is validated against the Zod
 * schema before we accept it. Also captures which Gemini model answered.
 */
export function useStructuredStream<S extends z.ZodTypeAny>(api: string, schema: S) {
  const [model, setModel] = React.useState<string | null>(null);
  const [final, setFinal] = React.useState<z.infer<S> | null>(null);
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [ran, setRan] = React.useState(false);

  const trackingFetch = React.useCallback<typeof fetch>(async (input, init) => {
    const res = await fetch(input, init);
    setModel(res.headers.get("X-Model"));
    return res;
  }, []);

  const { object, submit, isLoading, error, stop } = useObject({
    api,
    schema,
    fetch: trackingFetch,
    onFinish: ({ object: done, error: err }) => {
      if (done) {
        setFinal(done);
        setValidationError(null);
      } else if (err) {
        setValidationError("The AI returned an incomplete answer. Try again.");
      }
    },
  });

  const run = React.useCallback(
    (body: unknown) => {
      setFinal(null);
      setValidationError(null);
      setModel(null);
      setRan(true);
      submit(body);
    },
    [submit],
  );

  const errorMessage = error ? readableError(error).message : validationError;
  const state: "idle" | "streaming" | "done" | "error" = isLoading ? "streaming" : errorMessage ? "error" : ran && (final || object) ? "done" : "idle";

  return { partial: object as Partial<z.infer<S>> | undefined, final, run, stop, isLoading, errorMessage, model, state };
}
