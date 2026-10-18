/** The streak card on the library and its goals sheet (Goals.kt). */
import { useState } from 'react';
import { Pills } from './Kits';
import { Sheet } from './ReaderSheets';
import { flameLevel, STREAK_GOALS, Streak } from './rules';
import { dailyGoalMinutes, type Day, db, streak, streakGoal, useDb } from './store';
import { localDay } from './text';

const GOAL_OPTIONS = [3, 5, 10, 15, 20, 30];
// the aura behind the flame for each level: none, amber, blue, purple
const FLAME_AURAS = ['transparent', '#f59e0b55', '#38bdf855', '#a855f766'];

export const days = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

export function Flame({ lit, longest, size }: { lit: boolean; longest: number; size: number }) {
  return (
    <span className="flame" style={{ width: size + 10, height: size + 10, background: FLAME_AURAS[flameLevel(longest)] }}>
      <img src={lit ? '/art/streak.png' : '/art/streak_inactive.png'} alt="" width={size} height={size} />
    </span>
  );
}

export function StreakCard() {
  const [sheet, setSheet] = useState(false);
  // the sheet changes goals kept outside the database: redraw with them
  const [, setVersion] = useState(0);
  const data = useDb(() => Promise.all([streak(), db.get<Day>('days', localDay())]));
  if (!data) return null;
  const [s, today] = data;
  const read = today?.seconds ?? 0;
  const goal = dailyGoalMinutes() * 60;
  const aim = streakGoal();
  return (
    <>
      <button type="button" className="card streak-card" onClick={() => setSheet(true)}>
        <Flame lit={s.metToday} longest={s.longest} size={40} />
        <span className="streak-text">
          <strong>{s.current === 0 ? 'Comece sua ofensiva' : `${days(s.current)} de ofensiva`}</strong>
          <span className="small muted">{s.metToday ? 'Meta de hoje concluída ✓' : `Hoje: ${Math.floor(read / 60)} de ${goal / 60} min de leitura`}</span>
          {aim > 0 && s.current > 0 && (
            <span className="small muted">
              Meta: {s.current} de {aim} dias
            </span>
          )}
          {s.recovery && (
            <span className="small recovery">
              Recupere {days(s.recovery.lost)}: cumpra a meta {Streak.RECOVER_DAYS} dias seguidos ({s.recovery.done}/{Streak.RECOVER_DAYS})
            </span>
          )}
          <span className="goal-bar">
            <span style={{ width: `${s.metToday ? 100 : Math.min(100, (read * 100) / goal)}%` }} />
          </span>
        </span>
        {s.shields > 0 && <span className="shields">🛡️{s.shields}</span>}
      </button>
      {sheet && <GoalSheet longest={s.longest} current={s.current} shields={s.shields} onChange={() => setVersion((v) => v + 1)} onClose={() => setSheet(false)} />}
    </>
  );
}

function GoalSheet(props: { current: number; longest: number; shields: number; onChange: () => void; onClose: () => void }) {
  const set = (key: string, value: number) => {
    localStorage.setItem(key, String(value));
    props.onChange();
  };
  const minutes = dailyGoalMinutes();
  return (
    <Sheet onClose={props.onClose}>
      <div className="sheet-head">
        <Flame lit longest={props.longest} size={36} />
        <h2>Ofensiva</h2>
      </div>
      <p className="muted">
        Leia {minutes} min ou termine um exercício (Cartões, Aprender, Avaliar ou Ditado) por dia para manter a ofensiva. Os escudos 🛡️ cobrem um dia
        parado cada; você começa com 2 e ganha um de volta a cada 7 dias seguidos. Se a ofensiva quebrar, cumpra a meta 5 dias seguidos (começando em até
        uma semana) e ela volta inteira.
      </p>
      <strong>
        Atual: {days(props.current)} · Recorde: {days(props.longest)} · Escudos: {props.shields}
      </strong>
      <h3 className="box-title">Meta de ofensiva</h3>
      <p className="muted">
        Cada meta cumprida evolui a sua chama (nível {flameLevel(props.longest)} de {STREAK_GOALS.length}).
      </p>
      <Pills options={STREAK_GOALS.map(days)} selected={STREAK_GOALS.indexOf(streakGoal())} onSelect={(i) => set('streakGoal', STREAK_GOALS[i])} />
      <h3 className="box-title">Meta diária</h3>
      <Pills options={GOAL_OPTIONS.map((m) => `${m} min`)} selected={GOAL_OPTIONS.indexOf(minutes)} onSelect={(i) => set('dailyGoalMinutes', GOAL_OPTIONS[i])} />
    </Sheet>
  );
}
