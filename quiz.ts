// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Question {
  id: number;
  cat: string;
  q: string;
  opts: [string, string, string, string];
  correct: 0 | 1 | 2 | 3;
}

interface BadgeDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  // Parameters: score, totalQuestions, xp, maxStreak, fastAnswers
  check: (score: number, total: number, xp: number, maxStreak: number, fastAnswers?: number) => boolean;
}

interface SessionLogEntry {
  q: string;
  cat: string;
  correct: boolean;
  yourAnswer: string | null;
  rightAnswer: string;
}

// ─── QUESTION DATA ───────────────────────────────────────────────────────────

let ALL_QUESTIONS: Question[] = [];

async function loadQuestions(): Promise<void> {
  const res = await fetch('questions.json');
  const data: Array<{ id: number; question: string; options: string[]; answer: string }> = await res.json();
  ALL_QUESTIONS = data.map(item => {
    const correct = item.options.indexOf(item.answer) as 0 | 1 | 2 | 3;
    return {
      id: item.id,
      cat: '',
      q: item.question,
      opts: item.options as [string, string, string, string],
      correct
    };
  });
}

loadQuestions();

// ─── GAMIFICATION DATA ────────────────────────────────────────────────────────

// Badge check functions receive: (score, totalQuestions, xp, maxStreak, lawCorrect, lawTotal, fastAnswers)
const BADGES_DEF: BadgeDef[] = [
  { id:'first',     icon:'🐾', name:'Erster Schritt',  desc:'Quiz abgeschlossen',         check:(_s,_q,_x,_streak) => true },
  { id:'perfect',   icon:'🏆', name:'Perfekt!',         desc:'100% richtig',               check:(s,q) => s === q },
  { id:'passed',    icon:'🎓', name:'Bestanden',        desc:'70%+ richtig',               check:(s,q) => s / q >= 0.7 },
  { id:'streak5',   icon:'🔥', name:'Feuer-Hund',       desc:'5 richtig in Folge',         check:(_s,_q,_x,streak) => streak >= 5 },
  { id:'xp100',     icon:'⭐', name:'XP-Sammler',       desc:'100+ XP',                    check:(_s,_q,x) => x >= 100 },
  { id:'speedster', icon:'⚡', name:'Blitz-Antwort',    desc:'5 Fragen in < 5 Sek.',       check:(_s,_q,_x,_streak,fast) => (fast ?? 0) >= 5 },
];

// ─── STATE ─────────────────────────────────────────────────────────────────

let sessionQuestions: Question[] = []; // the 35 randomly selected questions for this session
let currentIdx: number = 0;            // index of the currently displayed question
let score: number = 0;                 // number of correctly answered questions
let xp: number = 0;                    // total XP earned this session
let streak: number = 0;                // current consecutive correct answers
let maxStreak: number = 0;             // highest streak reached this session (for badge check)
let answered: boolean = false;         // whether the current question has been answered (prevents double input)
let sessionLog: SessionLogEntry[] = []; // per-question log: { q, cat, law, correct, yourAnswer, rightAnswer }
let timerInterval: number | null = null; // reference to the countdown setInterval, stored so it can be cleared
let timeLeft: number = 25;             // seconds remaining for the current question
let fastAnswers: number = 0;           // number of correct answers given in under 5 seconds (for "Blitz-Antwort" badge)
let answerStartTime: number = 0;       // timestamp when the current question was shown (ms)

const MAX_QUESTIONS = 35;
const TIMER_SECONDS = 25;

// ─── HELPERS ──────────────────────────────────────────────────────────────

// Fisher-Yates shuffle — returns a new shuffled copy of the array
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Shows a brief toast notification. type: 'xp' | 'streak' | '' for styling
function showToast(msg: string, type: string = 'default'): void {
  const t = document.getElementById('toast')!;
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type + '-toast' : '');
  clearTimeout((t as HTMLElement & { _timeout?: number })._timeout);
  (t as HTMLElement & { _timeout?: number })._timeout = window.setTimeout(() => {
    t.className = 'toast';
  }, 2200);
}

// ─── QUIZ LOGIC ───────────────────────────────────────────────────────────

function startQuiz(): void {
  sessionQuestions = shuffle(ALL_QUESTIONS).slice(0, MAX_QUESTIONS);
  currentIdx = 0; score = 0; xp = 0; streak = 0; maxStreak = 0;
  answered = false; sessionLog = [];
  fastAnswers = 0;

  document.getElementById('start-screen')!.classList.add('hidden');
  document.getElementById('result-screen')!.classList.add('hidden');
  document.getElementById('quiz-screen')!.classList.remove('hidden');
  document.getElementById('review-section')!.classList.add('hidden');

  updateXPBar();
  renderQuestion();
}

function renderQuestion(): void {
  const q = sessionQuestions[currentIdx];
  answered = false;

  // Header
  document.getElementById('q-count')!.textContent = `${currentIdx + 1} / ${MAX_QUESTIONS}`;
  document.getElementById('progress-fill')!.style.width = `${(currentIdx / MAX_QUESTIONS) * 100}%`;
  document.getElementById('score-live')!.textContent = `${score} / ${currentIdx}`;

  // Category tag
  const catTag = document.getElementById('category-tag')!;
  catTag.textContent = q.cat;

  // Question
  document.getElementById('question-text')!.textContent = q.q;

  // Shuffle answer order — track which shuffled position the correct answer landed at
  const indices = shuffle([0, 1, 2, 3]);
  const correctShuffled = indices.indexOf(q.correct); // new position of the correct answer

  const list = document.getElementById('options-list')!;
  list.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];

  indices.forEach((origIdx, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.dataset.origIdx = String(origIdx);
    btn.dataset.shuffledCorrect = String(correctShuffled);
    btn.innerHTML = `<span class="option-letter">${letters[i]}</span><span>${q.opts[origIdx]}</span>`;
    btn.onclick = () => handleAnswer(btn, i === correctShuffled, q);
    li.appendChild(btn);
    list.appendChild(li);
  });

  // Reset feedback
  const fb = document.getElementById('feedback-box')!;
  fb.className = 'feedback-box';
  document.getElementById('next-btn')!.classList.add('hidden');

  // Streak badge — only show if player has 2+ consecutive correct answers
  const sb = document.getElementById('streak-badge')!;
  if (streak >= 2) {
    sb.classList.remove('hidden');
    document.getElementById('streak-count')!.textContent = String(streak);
  } else {
    sb.classList.add('hidden');
  }

  // Timer
  startTimer();
}

function startTimer(): void {
  clearInterval(timerInterval ?? undefined); // clear any previous timer before starting a new one
  timeLeft = TIMER_SECONDS;
  answerStartTime = Date.now();
  updateTimerUI();

  timerInterval = window.setInterval(() => {
    timeLeft--;
    updateTimerUI();
    if (timeLeft <= 0) {
      clearInterval(timerInterval ?? undefined);
      if (!answered) handleAnswer(null, false, sessionQuestions[currentIdx], true);
    }
  }, 1000);
}

function updateTimerUI(): void {
  // Circumference of the SVG circle: 2π × r = 2π × 14 ≈ 87.96, rounded to 88
  const circumference = 88;
  // stroke-dashoffset controls how much of the ring is "empty" — 0 = full, 88 = empty
  const offset = circumference - (timeLeft / TIMER_SECONDS) * circumference;

  const circle = document.getElementById('timer-circle')!;
  const num = document.getElementById('timer-num')!;
  circle.style.strokeDashoffset = String(offset);
  num.textContent = String(timeLeft);

  circle.className = 'fill';
  if (timeLeft <= 5) circle.classList.add('danger');
  else if (timeLeft <= 10) circle.classList.add('warning');
}

function handleAnswer(btn: HTMLButtonElement | null, isCorrect: boolean, q: Question, timedOut: boolean = false): void {
  if (answered) return;
  answered = true;
  clearInterval(timerInterval ?? undefined);

  const elapsed = (Date.now() - answerStartTime) / 1000;
  if (elapsed < 5 && !timedOut && isCorrect) fastAnswers++;

  const allBtns = document.querySelectorAll<HTMLButtonElement>('.option-btn');

  if (timedOut) {
    // Show correct answer when timer runs out
    allBtns.forEach(b => {
      if (parseInt(b.dataset.origIdx ?? '0') === q.correct) b.classList.add('correct');
      b.disabled = true;
    });
    showFeedback(false, '⏰ Zeit abgelaufen! Die richtige Antwort wurde markiert.');
    streak = 0;
    document.getElementById('streak-badge')!.classList.add('hidden');
  } else {
    allBtns.forEach(b => {
      const isThisCorrect = parseInt(b.dataset.origIdx ?? '0') === q.correct;
      if (isThisCorrect) b.classList.add('correct');
      else if (b === btn) b.classList.add('wrong');
      b.disabled = true;
    });

    if (isCorrect) {
      score++;
      streak++;
      if (streak > maxStreak) maxStreak = streak;

      // XP formula: base 10 + streak bonus (+5 per answer beyond 2-streak) + speed bonus (+5 if answered in < 5s)
      const xpGain = 10 + (streak > 2 ? (streak - 2) * 5 : 0) + (elapsed < 5 ? 5 : 0);
      xp += xpGain;

      showFeedback(true, `✅ Richtig! +${xpGain} XP${streak > 2 ? ` 🔥 ${streak}er-Serie!` : ''}`);
      showToast(`+${xpGain} XP`, 'xp');
      if (streak === 3) showToast('🔥 3er Serie!', 'streak');
      if (streak === 5) showToast('🔥 5er Feuer!', 'streak');

      document.getElementById('streak-count')!.textContent = String(streak);
      if (streak >= 2) document.getElementById('streak-badge')!.classList.remove('hidden');
      updateXPBar();
    } else {
      streak = 0;
      document.getElementById('streak-badge')!.classList.add('hidden');
      showFeedback(false, `❌ Leider falsch. Die richtige Antwort ist markiert.`);
    }

  }

  document.getElementById('score-live')!.textContent = `${score} / ${currentIdx + 1}`;

  sessionLog.push({
    q: q.q, cat: q.cat,
    correct: isCorrect && !timedOut,
    yourAnswer: timedOut ? null : q.opts[parseInt(btn?.dataset?.origIdx ?? '0') as 0 | 1 | 2 | 3],
    rightAnswer: q.opts[q.correct]
  });

  document.getElementById('next-btn')!.classList.remove('hidden');
}

function showFeedback(ok: boolean, msg: string): void {
  const box = document.getElementById('feedback-box')!;
  box.className = 'feedback-box show ' + (ok ? 'correct-feedback' : 'wrong-feedback');
  document.getElementById('feedback-text')!.textContent = msg;
}

function nextQuestion(): void {
  currentIdx++;
  if (currentIdx >= MAX_QUESTIONS) {
    showResults();
  } else {
    renderQuestion();
  }
}

function updateXPBar(): void {
  const maxXP = MAX_QUESTIONS * 20;
  const pct = Math.min((xp / maxXP) * 100, 100);
  document.getElementById('xp-bar')!.style.width = pct + '%';
  document.getElementById('xp-value')!.textContent = xp + ' XP';
}

// ─── RESULTS ─────────────────────────────────────────────────────────────

function showResults(): void {
  document.getElementById('quiz-screen')!.classList.add('hidden');
  document.getElementById('result-screen')!.classList.remove('hidden');

  const pct = Math.round((score / MAX_QUESTIONS) * 100);
  const passed = pct >= 70;

  document.getElementById('result-icon')!.textContent = passed ? '🎉' : '😔';
  document.getElementById('result-title')!.textContent = passed ? 'Bestanden! Glückwunsch!' : 'Knapp daneben...';
  document.getElementById('result-subtitle')!.textContent = passed
    ? 'Du hast den Hundeführerschein-Test erfolgreich absolviert!'
    : 'Du brauchst mindestens 70% – probiere es nochmal!';

  const pctEl = document.getElementById('result-pct')!;
  pctEl.textContent = pct + '%';
  pctEl.className = 'result-score-big ' + (passed ? 'passed' : 'failed');

  document.getElementById('res-correct')!.textContent = String(score);
  document.getElementById('res-wrong')!.textContent = String(MAX_QUESTIONS - score);
  document.getElementById('res-xp')!.textContent = String(xp);

  // Render badges — earned badges are fully visible, locked ones are greyed out
  const grid = document.getElementById('badges-grid')!;
  grid.innerHTML = '';
  BADGES_DEF.forEach((b, i) => {
    const earned = b.check(score, MAX_QUESTIONS, xp, maxStreak, fastAnswers);
    const div = document.createElement('div');
    div.className = 'badge' + (earned ? '' : ' locked');
    div.style.animationDelay = (i * 0.1) + 's';
    div.innerHTML = `<span class="badge-icon">${b.icon}</span><span class="badge-name">${b.name}</span>`;
    div.title = b.desc;
    grid.appendChild(div);
    if (earned) showToast(`${b.icon} ${b.name} freigeschaltet!`, '');
  });
}

function showReview(): void {
  const sec = document.getElementById('review-section')!;
  sec.classList.toggle('hidden');
  if (!sec.classList.contains('hidden')) {
    const list = document.getElementById('review-list')!;
    list.innerHTML = '';
    sessionLog.forEach((item, i) => {
      const div = document.createElement('div');
      div.className = 'review-item ' + (item.correct ? 'review-correct' : 'review-wrong');
      div.innerHTML = `
        <div class="review-q">${i + 1}. ${item.q}</div>
        <div class="review-a">
          ${item.correct
            ? `<span class="correct-ans">✅ ${item.rightAnswer}</span>`
            : `${item.yourAnswer ? `<span class="wrong-ans">Deine Antwort: ${item.yourAnswer}</span><br>` : '<em>Zeit abgelaufen</em><br>'}
               <span class="correct-ans">✅ Richtig: ${item.rightAnswer}</span>`}
        </div>`;
      list.appendChild(div);
    });
    sec.scrollIntoView({ behavior: 'smooth' });
  }
}

// ─── EXPOSE TO HTML ───────────────────────────────────────────────────────
// Make functions callable from inline onclick attributes in the HTML
(window as Window & typeof globalThis & {
  startQuiz: typeof startQuiz;
  nextQuestion: typeof nextQuestion;
  showReview: typeof showReview;
}).startQuiz = startQuiz;
(window as any).nextQuestion = nextQuestion;
(window as any).showReview = showReview;
