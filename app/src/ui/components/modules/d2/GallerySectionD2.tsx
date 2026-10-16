/**
 * Dev-gallery section "Anleitung, Training, Timer" (modules-d2). Mounted in ui/Gallery.tsx.
 * Replies go to the gallery's onAction logger ("LETZTE AKTION").
 */
import { View } from 'react-native';
import { useTheme } from '../../../theme';
import { HText } from '../../../primitives/basics';
import { HuiView } from '../../../HuiView';
import type { HuiActionHandler } from '../../../primitives/context';

export const GUIDE_SAMPLE = {
  type: 'guide',
  id: 'schlauch',
  title: 'Fahrradschlauch wechseln',
  intro: 'Dauer ca. 20 Minuten. Du brauchst: 2 Reifenheber, neuen Schlauch (passende Ventilart), Pumpe.',
  steps: [
    { id: 'rad', title: 'Rad ausbauen', body: 'Schalte auf das **kleinste Ritzel** und öffne die Bremse (bei Felgenbremsen).\n\n- Schnellspanner oder Steckachse lösen\n- Rad nach unten aus dem Rahmen ziehen', imageQuery: 'Fahrrad Hinterrad ausbauen Schnellspanner', warning: 'Bei Scheibenbremsen den Bremshebel nicht ziehen, solange das Rad ausgebaut ist.' },
    { id: 'luft', title: 'Restluft ablassen', body: 'Ventilkappe abschrauben und die restliche Luft komplett ablassen. Bei Presta-Ventilen zuerst die kleine Rändelmutter öffnen.' },
    { id: 'hebeln', title: 'Reifen abhebeln', body: 'Ersten Reifenheber gegenüber dem Ventil unter die Reifenwulst schieben und einhaken. Zweiten Heber 10 cm daneben ansetzen und rundherum ziehen.', tip: 'Den Reifen vorher rundum in das Felgenbett drücken – dann geht es viel leichter.', imageQuery: 'Reifenheber Fahrrad Reifen abhebeln' },
    { id: 'pruefen', title: 'Reifen innen prüfen', body: 'Mit den Fingern **vorsichtig** innen über die Lauffläche streichen und Fremdkörper (Glas, Dornen) entfernen.' },
    { id: 'einlegen', title: 'Neuen Schlauch einlegen', body: 'Schlauch leicht aufpumpen, damit er rund ist. Ventil durch das Felgenloch stecken und den Schlauch rundum in den Reifen legen.' },
    { id: 'aufziehen', title: 'Reifen aufziehen', body: 'Am Ventil beginnen und den Reifen mit beiden Daumen zurück auf die Felge drücken. Die letzten Zentimeter sind am schwersten – Wulst ins Felgenbett schieben.' },
    { id: 'pumpen', title: 'Aufpumpen und warten', body: 'Auf etwa die Hälfte des Drucks pumpen und prüfen, ob der Reifen gleichmäßig sitzt. Dann auf vollen Druck pumpen und kurz warten, ob er hält.', seconds: 120, tip: 'Den Solldruck findest du auf der Reifenflanke (z. B. 4–6 bar).' },
    { id: 'einbauen', title: 'Rad einbauen', body: 'Rad einsetzen, Kette aufs kleinste Ritzel legen, Schnellspanner schließen und die Bremse wieder einhängen. Probefahrt!' },
  ],
};

export const WORKOUT_SAMPLE = {
  type: 'workout',
  id: 'ganzkoerper30',
  title: 'Ganzkörper in 30 Minuten',
  kind: 'mixed',
  warmup: '5 min lockeres Seilspringen oder Hampelmänner, dann Arm- und Hüftkreisen.',
  exercises: [
    { id: 'squat', name: 'Kniebeuge', sets: 3, reps: 10, weight: '60 kg', restSeconds: 90, note: 'Knie zeigen in Richtung der Zehen, Rücken gerade.', imageQuery: 'Kniebeuge Langhantel' },
    { id: 'push', name: 'Liegestütze', sets: 3, reps: 12, restSeconds: 60 },
    { id: 'row', name: 'Kurzhantel-Rudern', sets: 3, reps: '10–12', weight: '16 kg', restSeconds: 60 },
    { id: 'lunge', name: 'Ausfallschritte', sets: 2, reps: 12, restSeconds: 45, note: 'Pro Seite.' },
    { id: 'plank', name: 'Unterarmstütz', sets: 2, seconds: 45, restSeconds: 30 },
  ],
  cooldown: 'Je 30 s dehnen: Oberschenkel vorne/hinten, Brust, Schultern.',
};

export const PASTA_TIMER_SAMPLE = {
  type: 'timer',
  id: 'pasta',
  label: 'Pasta-Abend',
  timers: [
    { id: 'wasser', label: 'Wasser kochen', seconds: 480 },
    { id: 'nudeln', label: 'Spaghetti', seconds: 540 },
    { id: 'sosse', label: 'Tomatensoße köcheln', seconds: 900 },
  ],
};

function inDays(d: number, h: number): string {
  const x = new Date();
  x.setDate(x.getDate() + d);
  x.setHours(h, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(h)}:00`;
}

const SAMPLES: { title: string; node: unknown; streaming?: boolean }[] = [
  { title: 'guide · Schritt für Schritt', node: GUIDE_SAMPLE },
  { title: 'workout · Trainingssession', node: WORKOUT_SAMPLE },
  { title: 'timer v2 · Multi-Timer', node: PASTA_TIMER_SAMPLE },
  { title: 'timer v2 · Countdown (v1-kompatibel)', node: { type: 'timer', id: 'eier', label: 'Eier kochen', seconds: 420 } },
  { title: 'timer v2 · bis Datum/Uhrzeit', node: { type: 'timer', id: 'urlaub', label: 'Urlaub', until: inDays(12, 7) } },
  { title: 'timer v2 · Stoppuhr', node: { type: 'timer', id: 'lauf', label: 'Laufrunde', mode: 'stopwatch' } },
  { title: 'guide · streaming (teilweise)', node: { type: 'guide', id: 'teil-guide', title: 'Fahrradschlauch wechseln', steps: GUIDE_SAMPLE.steps.slice(0, 3) }, streaming: true },
  { title: 'workout · streaming (teilweise)', node: { ...WORKOUT_SAMPLE, id: 'teil-workout', exercises: WORKOUT_SAMPLE.exercises.slice(0, 2), cooldown: undefined }, streaming: true },
  { title: 'timer · streaming (ohne Dauer)', node: { type: 'timer', id: 'teil-timer', label: 'Teig' }, streaming: true },
];

export function GallerySectionD2({ onAction }: { onAction: HuiActionHandler }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xl }}>
      <HText variant="title" style={{ marginTop: t.spacing.l }}>
        Anleitung, Training, Timer
      </HText>
      {SAMPLES.map((s, i) => (
        <View key={i} style={{ gap: t.spacing.s }} nativeID={`gallery-d2-${i}`}>
          <HText variant="caption" weight="600" color="subtle">
            {s.title}
          </HText>
          <HuiView node={s.node} streaming={!!s.streaming} onAction={onAction} />
        </View>
      ))}
    </View>
  );
}
