import { createHash } from 'node:crypto'
import {
  scopedRelationships,
  type VirtualRelationship,
} from '@shared/relationships'
import type { MetadataScope } from './metadata'

/** Main-owned settings snapshot; changing these hints invalidates the turn and resume key. */
export function relationshipScope(
  scope: MetadataScope,
  read: () => VirtualRelationship[],
): MetadataScope {
  const current = () =>
    scopedRelationships(read(), scope.connectionId, scope.database)
  const relationships = current()
  const revision = JSON.stringify(relationships)
  return {
    ...scope,
    key: `${scope.key}:${createHash('sha256').update(revision).digest('hex')}`,
    virtualRelationships: relationships,
    assertCurrent: () => {
      scope.assertCurrent()
      if (JSON.stringify(current()) !== revision)
        throw new Error('Virtual relationships changed; start a new turn')
    },
  }
}

export function boundedRelationships<T>(values: T[]) {
  const result: T[] = []
  for (const value of values) {
    if (Buffer.byteLength(JSON.stringify([...result, value])) > 12000) break
    result.push(value)
  }
  return {
    virtualRelationships: result,
    virtualRelationshipsTruncated: result.length < values.length,
  }
}
