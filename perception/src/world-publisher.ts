import type { IngestObservationParams } from "../../world-client/src/generated/types/reducers.ts";
import type { DbConnection } from "../../world-client/src/generated/index.ts";
import type { ObservationPublisher, ObservationReceipt, PublishedObservation } from "./types.ts";

/** Generated world-client seam; the client supplies authenticated member scope. */
export interface PerceptionWorldPort {
  ingestObservation(params: IngestObservationParams): Promise<void>;
}

/** Thin generated-client adapter; authentication remains on the connection. */
export class GeneratedWorldObservationPort implements PerceptionWorldPort {
  readonly #connection: Pick<DbConnection, "reducers">;

  constructor(connection: Pick<DbConnection, "reducers">) {
    this.#connection = connection;
  }

  ingestObservation(params: IngestObservationParams): Promise<void> {
    return this.#connection.reducers.ingestObservation(params);
  }
}

/**
 * Sends the native generated ObservationInput to the world operation. The
 * checks here catch a misbound worker before a real reducer call; the world
 * reducer repeats them authoritatively from the authenticated member.
 */
export class WorldObservationPublisher implements ObservationPublisher {
  readonly #port: PerceptionWorldPort;
  readonly #producerSession: string;
  readonly #localMapId: string;

  constructor(options: { port: PerceptionWorldPort; producerSession: string; localMapId: string }) {
    if (!options.producerSession || !options.localMapId) throw new Error("world_observation_scope_required");
    this.#port = options.port;
    this.#producerSession = options.producerSession;
    this.#localMapId = options.localMapId;
  }

  async publish(observation: PublishedObservation): Promise<ObservationReceipt> {
    if (observation.input.producerSession !== this.#producerSession) throw new Error("producer_session_mismatch");
    if (observation.input.localMapId !== this.#localMapId) throw new Error("local_map_mismatch");
    await this.#port.ingestObservation({ input: observation.input });
    return { observationId: observation.input.id, duplicate: false };
  }
}
