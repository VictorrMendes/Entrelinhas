/** The Progress tab (Progress.kt): level, daily and weekly streaks over a calendar, numbers, the week's chart and achievements. */
import arrowLeftSvg from '@material-design-icons/svg/filled/keyboard_arrow_left.svg?raw';
import arrowRightSvg from '@material-design-icons/svg/filled/keyboard_arrow_right.svg?raw';
import textFieldsSvg from '@material-design-icons/svg/filled/text_fields.svg?raw';
import calendarMonthSvg from '@material-design-icons/svg/outlined/calendar_month.svg?raw';
import calendarTodaySvg from '@material-design-icons/svg/outlined/calendar_today.svg?raw';
import trophySvg from '@material-design-icons/svg/outlined/emoji_events.svg?raw';
import flameSvg from '@material-design-icons/svg/outlined/local_fire_department.svg?raw';
import lockSvg from '@material-design-icons/svg/outlined/lock.svg?raw';
import menuBookSvg from '@material-design-icons/svg/outlined/menu_book.svg?raw';
import { Fragment, useState } from 'react';
import { days } from './Goals';
import { type Achievement, ACHIEVEMENTS, type AchievementGroup, Levels, monthCells, type Totals, unlocked, WeekStreak, xp } from './rules';
import { type Day, db, streak, totals, useDb } from './store';
import { firstDayOfWeek, localDay } from './text';
import { Icon, ScreenTitle } from './ui';

const DAY_MS = 86_400_000;
const GROUPS: AchievementGroup[] = ['Ofensiva', 'Vocabulário', 'Leitura'];
// local day numbers are UTC dates, so they are formatted in UTC
const date = (day: number) => new Date(day * DAY_MS);
const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'UTC' });
const weeks = (n: number) => `${n} ${n === 1 ? 'semana' : 'semanas'}`;

export function Progress() {
  const data = useDb(() => Promise.all([db.all<Day>('days'), streak(), totals()]));
  if (!data) return null;
  const [all, s, t] = data;
  const today = localDay();
  const sum = (f: (d: Day) => number) => all.reduce((n, d) => n + f(d), 0);
  const byDay = new Map(all.map((d) => [d.day, d]));
  const bars = Array.from({ length: 7 }, (_, i) => today - 6 + i).map((day) => ({ label: format({ weekday: 'short' }).format(date(day)), value: byDay.get(day)?.translations ?? 0 }));

  return (
    <main className="tab-page">
      <ScreenTitle>Progresso de leitura</ScreenTitle>
      <div className="progress-page">
        <LevelCard t={t} />
        <HabitCard byDay={byDay} current={s.current} today={today} />
        <div className="tiles">
          <StatTile icon={calendarTodaySvg} tint="var(--primary)" label="Dias de leitura" value={`${all.filter((d) => d.active).length}`} />
          <StatTile icon={flameSvg} tint="var(--flame)" label="Ofensiva" value={days(s.current)} />
          <StatTile icon={textFieldsSvg} tint="var(--primary)" label="Traduções" value={`${sum((d) => d.translations)}`} />
          <StatTile icon={menuBookSvg} tint="var(--text)" label="Livros lidos" value={`${t.booksCompleted}`} />
        </div>
        <section className="card box summary">
          <div className="title-row">
            <h2 className="title-large semibold grow">Resumo da atividade</h2>
            <i className="legend-dot" />
            <span className="body-medium variant">Traduções</span>
          </div>
          <p className="body-small variant">Traduções nos últimos 7 dias</p>
          <BarChart bars={bars} />
        </section>
        <h2 className="title-large semibold">Detalhes</h2>
        <section className="card details">
          <Detail label="Tempo de leitura" value={`${Math.floor(sum((d) => d.seconds) / 60)} min`} />
          <Detail label="Maior ofensiva" value={days(s.longest)} />
          <Detail label="Palavras traduzidas manualmente" value={`${sum((d) => d.words)}`} />
          <Detail label="Parágrafos traduzidos manualmente" value={`${sum((d) => d.paragraphs)}`} />
        </section>
        <Achievements t={t} />
      </div>
    </main>
  );
}

/** Lifetime XP and the level it reaches; the bar fills toward the next level. */
function LevelCard({ t }: { t: Totals }) {
  const points = xp(t);
  const level = Levels.of(points);
  const from = Levels.start(level);
  const to = Levels.start(level + 1);
  return (
    <section className="level-card">
      <div className="title-row">
        <Icon svg={trophySvg} className="trophy" />
        <h2 className="title-large grow">Nível {level}</h2>
        <span className="title-medium">{points} XP</span>
      </div>
      <span className="level-bar">
        <span style={{ width: `${((points - from) * 100) / (to - from)}%` }} />
      </span>
      <p className="body-small">
        Faltam {to - points} XP para o nível {level + 1}
      </p>
    </section>
  );
}

/** Daily and weekly streaks over a month calendar: goal days filled in amber, other reading days ringed, today outlined. */
function HabitCard({ byDay, current, today }: { byDay: Map<number, Day>; current: number; today: number }) {
  const [offset, setOffset] = useState(0);
  const firstDow = firstDayOfWeek();
  const w = WeekStreak.compute(
    [...byDay.values()].filter((d) => d.active).map((d) => d.day),
    today,
    firstDow,
  );
  const now = date(today);
  const first = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1) / DAY_MS;
  const length = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1) / DAY_MS - first;
  const month = format({ month: 'long' }).format(date(first));
  // epoch day 3 was a Sunday
  const weekdays = Array.from({ length: 7 }, (_, i) => format({ weekday: 'narrow' }).format(date(3 + ((firstDow + i) % 7))));

  return (
    <section className="card habit">
      <div className="habit-stats">
        <HabitStat icon={flameSvg} tint="var(--flame)" value={days(current)} label="Ofensiva diária" />
        <HabitStat
          icon={calendarMonthSvg}
          tint="var(--primary)"
          value={weeks(w.current)}
          label={w.thisWeek ? 'Ofensiva semanal · semana garantida' : 'Ofensiva semanal · leia esta semana para manter'}
        />
      </div>
      <hr />
      <div className="month-head">
        <button type="button" className="icon" aria-label="Mês anterior" onClick={() => setOffset(offset - 1)}>
          <Icon svg={arrowLeftSvg} />
        </button>
        <span className="title-medium">
          {month[0].toUpperCase() + month.slice(1)} {date(first).getUTCFullYear()}
        </span>
        <button type="button" className="icon" aria-label="Próximo mês" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>
          <Icon svg={arrowRightSvg} />
        </button>
      </div>
      <div className="month label-medium">
        {weekdays.map((d, i) => (
          <span key={i} className="weekday">
            {d.toUpperCase()}
          </span>
        ))}
        {monthCells(first, length, firstDow).map((day, i) => {
          if (day === null) return <span key={`b${i}`} />;
          const d = byDay.get(day);
          const mark = d?.goalMet ? ' goal' : d?.active ? ' read' : day === today ? ' today' : '';
          return (
            <span key={day} className="day-cell">
              <span className={`day${mark}${day > today ? ' future' : ''}${day === today ? ' is-today' : ''}`}>{day - first + 1}</span>
            </span>
          );
        })}
      </div>
      <div className="legend body-small variant">
        <span>
          <i className="dot-goal" /> Meta cumprida
        </span>
        <span>
          <i className="dot-read" /> Leu
        </span>
      </div>
    </section>
  );
}

function HabitStat({ icon, tint, value, label }: { icon: string; tint: string; value: string; label: string }) {
  return (
    <div className="habit-stat">
      <span className="stat-icon" style={{ color: tint }}>
        <Icon svg={icon} size={20} />
      </span>
      <span>
        <span className="title-medium">{value}</span>
        <span className="body-small variant clamp-2">{label}</span>
      </span>
    </div>
  );
}

function StatTile({ icon, tint, label, value }: { icon: string; tint: string; label: string; value: string }) {
  return (
    <div className="card stat-tile">
      <span className="tile-head">
        <span className="stat-icon" style={{ color: tint }}>
          <Icon svg={icon} size={20} />
        </span>
        <span className="title-small clamp-2">{label}</span>
      </span>
      <span className="headline-small semibold">{value}</span>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail">
      <span>{label}</span>
      <span className="semibold">{value}</span>
    </div>
  );
}

/** Rounds up to 1/2/5 × 10ⁿ so the gridlines carry clean numbers. */
function niceMax(v: number) {
  if (v <= 1) return 1;
  let p = 1;
  while (p * 10 < v) p *= 10;
  return ([1, 2, 5, 10].find((m) => m * p >= v) as number) * p;
}

/** One bar per day; a tap shows a bar's number. */
function BarChart({ bars }: { bars: { label: string; value: number }[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...bars.map((b) => b.value)));
  const step = max <= 5 ? 1 : max / 5;
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const total = bars.reduce((n, b) => n + b.value, 0);
  return (
    <div className="chart" role="img" aria-label={`Gráfico de traduções: ${total} no período`}>
      <div className="chart-plot">
        {ticks.map((t) => (
          <span key={t} className="tick label-medium" style={{ bottom: `${(t * 100) / max}%` }}>
            <i>{t}</i>
          </span>
        ))}
        <div className="chart-bars">
          {bars.map((b, i) => (
            <button type="button" key={i} className={selected === null || selected === i ? '' : 'dim'} onClick={() => setSelected(selected === i ? null : i)}>
              {b.value > 0 && (
                <span className="bar-fill" style={{ height: `${(b.value * 100) / max}%` }}>
                  {selected === i && <b className="label-large">{b.value}</b>}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-labels label-medium">
        {bars.map((b, i) => (
          <span key={i}>{b.label}</span>
        ))}
      </div>
    </div>
  );
}

function Achievements({ t }: { t: Totals }) {
  return (
    <div className="achievements">
      <div className="title-row">
        <h2 className="title-large semibold grow">Conquistas</h2>
        <span className="title-medium variant">
          {ACHIEVEMENTS.filter((a) => unlocked(a, t)).length}/{ACHIEVEMENTS.length}
        </span>
      </div>
      <p className="body-medium variant">Você ganha XP lendo, salvando e dominando palavras, fazendo ditados e cumprindo a meta do dia.</p>
      {GROUPS.map((g) => (
        <Fragment key={g}>
          <h3 className="title-small variant group-title">{g}</h3>
          <div className="ach-grid">
            {ACHIEVEMENTS.filter((a) => a.group === g).map((a) => (
              <AchievementTile key={a.id} a={a} t={t} />
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/** A locked one shows its art in gray, with a padlock and how far along it is. */
function AchievementTile({ a, t }: { a: Achievement; t: Totals }) {
  const done = unlocked(a, t);
  return (
    <div className={`card ach${done ? '' : ' locked'}`}>
      <span className="ach-art">
        <img src={`/art/ach_${a.id}.webp`} alt="" width={72} height={72} loading="lazy" />
        {!done && (
          <span className="lock">
            <Icon svg={lockSvg} size={16} />
          </span>
        )}
      </span>
      <span className="title-small">{a.title}</span>
      <span className="body-small variant ach-text">{a.text}</span>
      {!done && (
        <span className="label-large primary-text ach-progress">
          {Math.min(a.value(t), a.target)}/{a.target}
        </span>
      )}
    </div>
  );
}
