/**
 * Shipped seed templates. The server installs these into an empty local
 * library on demand; nothing auto-writes.
 */
import seedEcrsV1 from "./seed/sps-ecrs-v1.json" with { type: "json" }

export const SEED_TEMPLATES: Array<{ id: string; doc_json: string }> = [
  { id: "sps-ecrs-v1", doc_json: JSON.stringify(seedEcrsV1) },
]
