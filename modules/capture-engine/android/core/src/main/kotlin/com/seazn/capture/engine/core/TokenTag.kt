package com.seazn.capture.engine.core

/**
 * Which issue of a code a pairing holds, without the token (plan A's N2). FNV-1a 32-bit over the
 * token's UTF-16 code units, as eight lowercase hex digits: the same function as
 * `src/domain/credentials/tokenTag.ts`, pinned by `modules/capture-engine/src/wire/token-tag-vectors.json`.
 */
object TokenTag {
  private const val OFFSET = 0x811c9dc5L
  private const val PRIME = 0x01000193

  fun of(token: String): String {
    var hash = OFFSET.toInt()
    for (unit in token) {
      hash = hash xor unit.code
      hash *= PRIME
    }
    return (hash.toLong() and 0xffff_ffffL).toString(16).padStart(8, '0')
  }
}
