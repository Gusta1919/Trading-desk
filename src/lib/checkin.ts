/** Shown in the greeting. */
export const USER_NAME = "Gustaw";

export type Verdict = "ready" | "caution" | "sit-out";

export interface CheckIn {
  date: string; // "YYYY-MM-DD"
  answers: Record<string, number>; // question id → option index
  note: string;
  score: number; // 0–100
  verdict: Verdict;
  reflection?: string; // answer to the coach's question of the day
  createdAt: string;
}

export interface Question {
  id: string;
  short: string; // label used in Stats and Calendar
  title: string;
  hint?: string;
  /** `risk`: 0 = fine, 1 = caution, 2 = red flag. */
  options: { label: string; risk: 0 | 1 | 2 }[];
  /** The reason shown on the result screen when this answer is risky. */
  flag: string;
}

export const QUESTIONS: Question[] = [
  {
    id: "sleep",
    short: "Sleep",
    title: "How many hours did you sleep?",
    options: [
      { label: "Under 5", risk: 2 },
      { label: "5–6", risk: 1 },
      { label: "6–7", risk: 0 },
      { label: "7–8", risk: 0 },
      { label: "8+", risk: 0 },
    ],
    flag: "Short on sleep — patience and reaction time drop before you notice it.",
  },
  {
    id: "energy",
    short: "Energy",
    title: "How is your energy?",
    options: [
      { label: "Drained", risk: 2 },
      { label: "Low", risk: 1 },
      { label: "Normal", risk: 0 },
      { label: "Strong", risk: 0 },
      { label: "Peak", risk: 0 },
    ],
    flag: "Low energy — this is when traders force setups that aren't there.",
  },
  {
    id: "mood",
    short: "Focus",
    title: "How focused are you right now?",
    options: [
      { label: "Distracted", risk: 2 },
      { label: "Neutral", risk: 0 },
      { label: "Dialed in", risk: 0 },
    ],
    flag: "Focus is off — execution errors cluster in distracted sessions.",
  },
  {
    id: "stress",
    short: "Stress",
    title: "Anything stressing you outside trading?",
    hint: "Work, studies, money, health, people.",
    options: [
      { label: "Nothing", risk: 0 },
      { label: "Some", risk: 1 },
      { label: "A lot", risk: 2 },
    ],
    flag: "Outside stress — it does not stay outside the chart.",
  },
  {
    id: "focus",
    short: "Attention",
    title: "Can you watch the market without interruptions?",
    options: [
      { label: "Yes", risk: 0 },
      { label: "Partly", risk: 1 },
      { label: "No", risk: 2 },
    ],
    flag: "Divided attention — you will either miss the setup or take half of one.",
  },
  {
    id: "lastDay",
    short: "Last session",
    title: "How did your last session end?",
    options: [
      { label: "Green", risk: 0 },
      { label: "Flat", risk: 0 },
      { label: "Red — accepted", risk: 0 },
      { label: "Red — still annoyed", risk: 2 },
      { label: "Broke my rules", risk: 1 },
      { label: "No trade", risk: 0 },
    ],
    flag: "Last session is unfinished business — the classic setup for revenge trading.",
  },
  {
    id: "urge",
    short: "Pressure",
    title: "Do you need money from the market today?",
    hint: "Be honest. This is the strongest predictor of a broken rule.",
    options: [
      { label: "No", risk: 0 },
      { label: "A little", risk: 1 },
      { label: "Yes", risk: 2 },
    ],
    flag: "Pressure to earn — the market does not care what you need.",
  },
  {
    id: "body",
    short: "Food & water",
    title: "Have you eaten and had water?",
    options: [
      { label: "Both", risk: 0 },
      { label: "One of them", risk: 1 },
      { label: "Neither", risk: 1 },
    ],
    flag: "Not fuelled — fix it before the session, not during it.",
  },
  {
    id: "walk",
    short: "Movement",
    title: "Did you move before sitting down?",
    hint: "Ten minutes away from screens counts.",
    options: [
      { label: "Yes", risk: 0 },
      { label: "A little", risk: 0 },
      { label: "No", risk: 1 },
    ],
    flag: "No reset — stress from your day carries straight into your first entry.",
  },
];

/** Turns answers into a 0–100 score, a verdict, and the reasons behind it. */
export function evaluate(answers: Record<string, number>) {
  let points = 0;
  const flags: { text: string; risk: 1 | 2 }[] = [];

  for (const q of QUESTIONS) {
    const risk = q.options[answers[q.id]]?.risk ?? 0;
    points += risk;
    if (risk > 0) flags.push({ text: q.flag, risk: risk as 1 | 2 });
  }

  const max = QUESTIONS.length * 2;
  const score = Math.round(100 - (points / max) * 100);
  const redFlags = flags.filter((f) => f.risk === 2).length;

  const verdict: Verdict =
    redFlags >= 2 || score < 55 ? "sit-out" : redFlags === 1 || score < 80 ? "caution" : "ready";

  flags.sort((a, b) => b.risk - a.risk);
  return { score, verdict, flags };
}

export const VERDICTS: Record<Verdict, { label: string; advice: string }> = {
  ready: {
    label: "Cleared to trade",
    advice: "Green light. Every base rule, let the grade set the size, no improvising.",
  },
  caution: {
    label: "Trade restricted",
    advice: "Amber. No trade today, whatever the grade. Review the journal instead — the desk opens again tomorrow.",
  },
  "sit-out": {
    label: "Stand down",
    advice: "Red. Nothing is tradable today. Protecting capital is today's job — the desk opens again tomorrow.",
  },
};

/** The session about to be opened, named by the clock. */
export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 6) return "Overnight session";
  if (h < 12) return "Morning session";
  if (h < 18) return "Afternoon session";
  return "Evening session";
}
