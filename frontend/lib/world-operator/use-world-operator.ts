"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NativeOperatorClient,
  NativeOperatorCall,
  NativeOperatorInputs,
  NativeOperatorOperation,
  OperatorConnectionState,
  OperatorProjection
} from "../../types/operator";
import { createNativeOperatorClient, EMPTY_OPERATOR_PROJECTION } from "./native-client";

type OperatorState = {
  actionError: string | null;
  connection: OperatorConnectionState;
  error: string | null;
  lastAppliedAt: string | null;
  pendingOperation: NativeOperatorOperation | null;
  projection: OperatorProjection;
};

export type WorldOperatorState = OperatorState & {
  invoke: NativeOperatorCall;
  readEvents: (subjectId: string, afterSequence: string) => Promise<import("../../types/operator").OperatorEventPage>;
  refresh: () => void;
  supports: (operation: NativeOperatorOperation) => boolean;
};

export function useWorldOperator(): WorldOperatorState {
  const clientRef = useRef<NativeOperatorClient | null>(null);
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<OperatorState>(() => ({
    actionError: null,
    connection: "connecting",
    error: null,
    lastAppliedAt: null,
    pendingOperation: null,
    projection: EMPTY_OPERATOR_PROJECTION
  }));

  const refresh = useCallback(() => setGeneration((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    const client = createNativeOperatorClient();
    clientRef.current = client;
    setState((current) => ({
      ...current,
      connection: client ? "connecting" : "unavailable",
      error: client ? null : "No generated authenticated world-client is configured for this loopback browser."
    }));
    if (!client) {
      return () => {
        if (clientRef.current === client) { clientRef.current = null; }
      };
    }

    const cleanup = client.subscribe({
      onError: (error) => {
        if (!active) { return; }
        const message = errorMessage(error);
        setState((current) => ({
          ...current,
          connection: message === "world_client_not_authorized" ? "forbidden" : "disconnected",
          error: message
        }));
      },
      onProjection: (projection) => {
        if (!active) { return; }
        const role = projection.readiness.role;
        const authorized = projection.readiness.authorized && projection.readiness.synchronized && (role === "world_operator" || role === "admin");
        setState((current) => ({
          ...current,
          connection: !projection.readiness.authorized ? "forbidden" : authorized ? "authenticated" : "connecting",
          error: !projection.readiness.authorized ? "The authenticated member is not authorized in this world." : authorized ? null : "Waiting for the world readiness projection to synchronize.",
          lastAppliedAt: new Date().toISOString(),
          projection
        }));
      },
      onStatus: (connection) => {
        if (!active) { return; }
        setState((current) => ({ ...current, connection }));
      }
    });

    return () => {
      active = false;
      if (typeof cleanup === "function") { cleanup(); }
      else if (cleanup) { cleanup.unsubscribe(); }
      if (clientRef.current === client) { clientRef.current = null; }
    };
  }, [generation]);

  const invoke = useCallback(async <Operation extends NativeOperatorOperation>(operation: Operation, input: NativeOperatorInputs[Operation]) => {
    const client = clientRef.current;
    if (!client) {
      setState((current) => ({ ...current, actionError: "Native world-client is unavailable." }));
      return false;
    }
    setState((current) => ({ ...current, actionError: null, pendingOperation: operation }));
    try {
      await client.call(operation, input);
      return true;
    } catch (error) {
      setState((current) => ({ ...current, actionError: errorMessage(error) }));
      return false;
    } finally {
      setState((current) => ({ ...current, pendingOperation: null }));
    }
  }, []);

  const supports = useCallback((operation: NativeOperatorOperation) => clientRef.current?.supports(operation) ?? false, []);
  const readEvents = useCallback((subjectId: string, afterSequence: string) => {
    const client = clientRef.current;
    return client ? client.readEvents(subjectId, afterSequence) : Promise.reject(new Error("native_world_client_unavailable"));
  }, []);

  return { ...state, invoke, readEvents, refresh, supports };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
