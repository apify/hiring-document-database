import { randomUUID } from 'node:crypto';

import type { DocumentId } from './types.js';

/** Generates a fresh, unique document id. */
export function generateId(): DocumentId {
  return randomUUID();
}
