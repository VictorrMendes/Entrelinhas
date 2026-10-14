package com.victor.leitor

import org.junit.Assert.assertEquals
import org.junit.Test

class SyncTest {
    private fun book(hash: String, lastBlock: Int, at: Long) = SyncBook(hash, "T", "epub", "en", "pt", lastBlock, at, null, at)
    private fun word(text: String, box: Int, at: Long) = SyncWord(text, text, "x", "en", "pt", null, null, box, 1, 0, at)
    private fun day(d: Long, seconds: Int, met: Int) = SyncDay(d, 1, 1, 0, 0, 0, 0, seconds, met)

    @Test
    fun newestEditWins() {
        val phone = Snapshot(books = listOf(book("a", 10, 100)), words = listOf(word("dog", 3, 50)))
        val tablet = Snapshot(books = listOf(book("a", 40, 200)), words = listOf(word("dog", 1, 20), word("cat", 0, 30)))
        val m = merge(phone, tablet)
        assertEquals(40, m.books.single().lastBlock)
        assertEquals(mapOf("dog" to 3, "cat" to 0), m.words.associate { it.normalized to it.box })
        assertEquals(m.words.toSet(), merge(tablet, phone).words.toSet()) // same result whichever side syncs first
    }

    @Test
    fun deletionBeatsOlderEditsOnly() {
        val local = Snapshot(deletions = mapOf("word|dog|en|pt" to 100L, "book|a" to 100L))
        val remote = Snapshot(books = listOf(book("a", 5, 90)), words = listOf(word("dog", 2, 90), word("cat", 0, 90)))
        val m = merge(local, remote)
        assertEquals(emptyList<SyncBook>(), m.books)
        assertEquals(listOf("cat"), m.words.map { it.normalized })
        // saved again after the deletion: it comes back
        assertEquals(listOf("dog"), merge(local, Snapshot(words = listOf(word("dog", 0, 150)))).words.map { it.normalized })
    }

    @Test
    fun highlightsLeaveWithTheirBook() {
        val h = SyncHighlight("a", 1, 0, 5, 0, "note", 10, 10)
        val m = merge(Snapshot(highlights = listOf(h)), Snapshot(deletions = mapOf("book|a" to 50L)))
        assertEquals(emptyList<SyncHighlight>(), m.highlights)
    }

    @Test
    fun dailyStatsKeepTheLargerCountersInsteadOfSumming() {
        val m = merge(Snapshot(days = listOf(day(7, 180, 1))), Snapshot(days = listOf(day(7, 120, 0), day(8, 60, 0))))
        assertEquals(listOf(day(7, 180, 1), day(8, 60, 0)), m.days.sortedBy { it.day })
        assertEquals(m.days.sortedBy { it.day }, merge(m, m).days.sortedBy { it.day }) // syncing again changes nothing
    }
}
