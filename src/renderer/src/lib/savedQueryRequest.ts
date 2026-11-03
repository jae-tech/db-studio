import { queryKey, resolveSavedQuery, type SavedQuery } from '@shared/database'

/** Local, exact-name commands only: never infer SQL or interpolate values. */
export function savedQueryRequest(
  queries: SavedQuery[],
  scope: { connectionId: string; database: string } | undefined,
  text: string,
): SavedQuery | undefined {
  const input = text.trim()
  const explicit = /^\/조회(?:\s+(.*))?$/u.exec(input)
  const reserved =
    /^저장\s*쿼리\s+(.+?)\s+(?:실행해줘|조회해줘|실행|조회)$/u.exec(input)
  const command =
    explicit ?? reserved ?? /^(.+?)\s+(?:실행해줘|조회해줘)$/u.exec(input)
  const names = explicit ? [explicit[1] ?? ''] : [input, command?.[1] ?? '']
  const candidates = queries.filter((query) =>
    [query.name, ...query.aliases].some((name) =>
      names.some((candidate) => queryKey(candidate) === queryKey(name)),
    ),
  )
  // Unknown prose stays a normal AI message. Explicit or saved-name requests
  // fail locally instead of sending stored SQL/names to a provider.
  if (!explicit && !reserved && candidates.length === 0) return undefined
  if (!scope)
    throw new Error('저장 쿼리를 조회하려면 데이터베이스에 연결하세요.')
  const scoped = candidates.filter(
    (query) =>
      query.connectionId === scope.connectionId &&
      query.database === scope.database,
  )
  if (scoped.length > 1)
    throw new Error(
      '저장 쿼리 여러 개와 일치합니다. /조회 정확한이름을 사용하세요.',
    )
  return resolveSavedQuery(
    scoped,
    scope,
    explicit ? (explicit[1] ?? '') : (scoped[0]?.name ?? command?.[1] ?? input),
  )
}
