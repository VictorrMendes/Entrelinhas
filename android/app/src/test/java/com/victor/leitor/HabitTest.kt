package com.victor.leitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
}
