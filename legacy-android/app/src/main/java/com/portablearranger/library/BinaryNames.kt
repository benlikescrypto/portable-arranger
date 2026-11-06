package com.portablearranger.library

object BinaryNames {
    fun extractKorgNames(bytes: ByteArray): List<String> {
        if (bytes.isEmpty()) return emptyList()
        val hits = mutableListOf<IndexedValue<String>>()
        var i = 0
        while (i + 8 < bytes.size) {
            if (isNameChar(bytes[i])) {
                var len = 0
                while (i + len < bytes.size && len < 24 && isNameChar(bytes[i + len])) len++
                if (len in 8..24) {
                    val raw = bytes.copyOfRange(i, i + len).toString(Charsets.ISO_8859_1).trim()
                    if (looksLikeName(raw)) hits += IndexedValue(i, raw)
                    i += len
                    continue
                }
            }
            i++
        }
        if (hits.isEmpty()) return emptyList()
        val byStride = detectStride(hits)
        val unique = LinkedHashSet<String>()
        (byStride ?: hits.map { it.value }).forEach { n ->
            if (n.length >= 3) unique += n
        }
        return unique.toList()
    }

    private fun detectStride(hits: List<IndexedValue<String>>): List<String>? {
        if (hits.size < 8) return hits.map { it.value }
        val deltas = mutableMapOf<Int, Int>()
        for (i in 1 until hits.size) {
            val d = hits[i].index - hits[i - 1].index
            if (d in 16..1024) deltas[d] = (deltas[d] ?: 0) + 1
        }
        val best = deltas.maxByOrNull { it.value } ?: return hits.map { it.value }
        if (best.value < 6) return hits.map { it.value }
        val stride = best.key
        val first = hits.first().index
        return hits.filter { (it.index - first) % stride == 0 || kotlin.math.abs((it.index - first) % stride) <= 2 }
            .map { it.value }
    }

    private fun isNameChar(b: Byte): Boolean {
        val c = b.toInt() and 0xFF
        return c in 32..126 && c != 127
    }

    private fun looksLikeName(s: String): Boolean {
        if (s.isBlank()) return false
        val letters = s.count { it.isLetter() }
        if (letters < 3) return false
        if (s.all { it == s[0] }) return false
        val weird = s.count { it in "@#$%^&*{}[]<>|\\~`" }
        if (weird > 1) return false
        if (s.startsWith("http") || s.contains("://")) return false
        return true
    }
}
