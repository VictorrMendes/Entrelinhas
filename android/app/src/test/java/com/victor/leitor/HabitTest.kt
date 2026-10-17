package com.victor.leitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class HabitTest {
    private fun day(y: Int, m: Int, d: Int) = LocalDate.of(y, m, d).toEpochDay()

    private val today = day(2026, 10, 15) // a Thursday
    private val sunday = 0
    private val monday = 1

    @Test
    fun weeksInARowCountThisWeekOnceItHasAReadingDay() {
        val s = WeekStreak.compute(listOf(day(2026, 9, 30), day(2026, 10, 6), day(2026, 10, 13)), today, sunday)
        assertEquals(3, s.current)
        assertTrue(s.thisWeek)
    }

    @Test
    fun anOpenWeekDoesNotBreakTheStreakYet() {
        val s = WeekStreak.compute(listOf(day(2026, 9, 30), day(2026, 10, 6)), today, sunday)
        assertEquals(2, s.current)
        assertFalse(s.thisWeek)
    }

    @Test
    fun aWholeWeekWithoutReadingStartsOver() {
        val s = WeekStreak.compute(listOf(day(2026, 9, 1), day(2026, 9, 8), day(2026, 9, 15), day(2026, 10, 13)), today, sunday)
        assertEquals(1, s.current)
        assertEquals(3, s.longest)
        assertEquals(0, WeekStreak.compute(listOf(day(2026, 9, 30)), today, sunday).current)
    }

    @Test
    fun theFirstDayOfTheWeekFollowsTheDevice() {
        val sundayAndMonday = listOf(day(2026, 10, 11), day(2026, 10, 12))
        assertEquals(1, WeekStreak.compute(sundayAndMonday, today, sunday).current)
        assertEquals(2, WeekStreak.compute(sundayAndMonday, today, monday).current)
    }

    @Test
    fun aMonthGridStartsOnTheRightWeekday() {
        val first = day(2026, 10, 1) // a Thursday
        val cells = monthCells(first, 31, sunday)
        assertEquals(4, cells.takeWhile { it == null }.size)
        assertEquals(first, cells[4])
        assertEquals(first + 30, cells.last())
        assertEquals(3, monthCells(first, 31, monday).takeWhile { it == null }.size)
        assertNull(monthCells(first, 31, sunday).first())
    }

    @Test
    fun aBrokenStreakComesBackAfterFiveMetDaysInARow() {
        val before = (1L..10L).toList() // a 10-day streak, then 4 blank days: more than the 2 shields
        assertEquals(Streak.Recovery(10, 0), Streak.compute(before, 14).recovery)
        val midway = Streak.compute(before + (15L..17L), 17)
        assertEquals(3, midway.current)
        assertEquals(Streak.Recovery(10, 3), midway.recovery)
        val back = Streak.compute(before + (15L..19L), 19)
        assertEquals(15, back.current)
        assertNull(back.recovery)
        // a blank day while earning back (even one a shield covers) loses it
        val gap = Streak.compute(before + listOf(15L, 16L, 18L, 19L, 20L), 20)
        assertEquals(5, gap.current)
        assertNull(gap.recovery)
        // and so does coming back too late
        assertEquals(5, Streak.compute(before + (25L..29L), 29).current)
    }

    @Test
    fun theWordOfTheDayStaysAllDayAndSkipsMasteredWords() {
        fun w(id: Long, box: Int = 0) = Word(id, "w$id", "t$id", null, null, box, null, "en")
        val words = listOf(w(3), w(1), w(2, box = Leitner.MASTERED))
        assertEquals(wordOfDay(words, 10), wordOfDay(words.reversed(), 10))
        assertTrue(wordOfDay(words, 10)!!.id in setOf(1L, 3L))
        assertNotEquals(wordOfDay(words, 10), wordOfDay(words, 11))
        assertEquals(2L, wordOfDay(listOf(w(2, box = Leitner.MASTERED)), 5)!!.id)
        assertNull(wordOfDay(emptyList(), 5))
    }
}
