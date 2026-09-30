// The error envelope every non-2xx serving answer rides. The code
// vocabulary is generated from serving-openapi.json; the envelope shape
// stays hand-written because the generated ErrorEnvelope carries the
// dashboard's full closed ApiErrorCode, while this public surface wants
// the serving codes plus forward compatibility.

export type { ServingErrorCode } from "../generated/models/index.js";

import type { ServingErrorCode } from "../generated/models/index.js";

// The contract is additive-only: new codes may appear, so a client must
// tolerate strings outside the known union while keeping autocompletion.
export type ServingErrorCodeOnTheWire = ServingErrorCode | (string & {});

export interface ServingErrorBody {
  code: ServingErrorCodeOnTheWire;
  message: string;
  details?: unknown;
}

export interface ServingErrorEnvelope {
  error: ServingErrorBody;
}
