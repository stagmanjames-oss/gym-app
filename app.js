// app.js — Core application logic

// ── State ─────────────────────────────────────────────────────────────────────

const AppState = {
  sessions: [],          // recent sessions from DB, newest first
  currentSession: null,  // active session object
  currentType: null,     // 'push' | 'pull' | 'legs' | 'rest'
  currentLocation: 'gym', // 'gym' | 'home'
  loggedSets: {},        // { exerciseId: { setNumber: { reps, weight } } }
  isOnline: navigator.onLine,
  offlineQueue: JSON.parse(localStorage.getItem('offlineQueue') || '[]'),
};

// ── Split Logic ───────────────────────────────────────────────────────────────

const SPLIT_CYCLE = ['push', 'pull', 'legs', 'rest'];

function recommendWorkout(sessions) {
  const completed = sessions.filter(s => s.completed);
  if (completed.length === 0) return 'push';
  const last = completed[0]; // sessions sorted newest first
  const idx = SPLIT_CYCLE.indexOf(last.type);
  return SPLIT_CYCLE[(idx + 1) % SPLIT_CYCLE.length];
}

// ── PR Helpers ────────────────────────────────────────────────────────────────

function getAllSetsForExercise(exerciseId, sessions) {
  const sets = [];
  sessions.forEach(session => {
    (session.sets || []).forEach(set => {
      if (set.exercise_id === exerciseId && set.completed) sets.push(set);
    });
  });
  return sets;
}

function getPreviousSessionPR(exerciseId, sessions) {
  const exercise = getExerciseById(exerciseId);
  // Find last completed session that contains this exercise
  for (const session of sessions) {
    if (!session.completed) continue;
    // Skip current session
    if (AppState.currentSession && session.id === AppState.currentSession.id) continue;
    const exerciseSets = (session.sets || []).filter(
      s => s.exercise_id === exerciseId && s.completed
    );
    if (exerciseSets.length === 0) continue;
    if (exercise && exercise.bodyweight) {
      return { value: Math.max(...exerciseSets.map(s => s.reps)), unit: 'reps' };
    } else {
      return { value: Math.max(...exerciseSets.map(s => s.weight || 0)), unit: 'kg' };
    }
  }
  return null;
}

function getAllTimePR(exerciseId, sessions) {
  const exercise = getExerciseById(exerciseId);
  const sets = getAllSetsForExercise(exerciseId, sessions);
  if (sets.length === 0) return null;
  if (exercise && exercise.bodyweight) {
    return { value: Math.max(...sets.map(s => s.reps)), unit: 'reps' };
  } else {
    return { value: Math.max(...sets.map(s => s.weight || 0)), unit: 'kg' };
  }
}

// Pre-fill logic: same set position from last session of this exercise, else defaultWeight
function getWeightSuggestion(exerciseId, setNumber, sessions) {
  const exercise = getExerciseById(exerciseId);
  if (!exercise) return null;

  for (const session of sessions) {
    if (!session.completed) continue;
    if (AppState.currentSession && session.id === AppState.currentSession.id) continue;
    const match = (session.sets || []).find(
      s => s.exercise_id === exerciseId && s.set_number === setNumber && s.completed
    );
    if (match) {
      return exercise.bodyweight
        ? { reps: match.reps, weight: null }
        : { reps: match.reps, weight: match.weight };
    }
  }
  return exercise.bodyweight
    ? { reps: exercise.defaultReps, weight: null }
    : { reps: exercise.defaultReps, weight: exercise.defaultWeight };
}

// ── Offline Queue ─────────────────────────────────────────────────────────────

function queueWrite(entry) {
  AppState.offlineQueue.push({ ...entry, timestamp: Date.now() });
  localStorage.setItem('offlineQueue', JSON.stringify(AppState.offlineQueue));
}

async function flushQueue() {
  if (!AppState.isOnline || AppState.offlineQueue.length === 0) return;
  const queue = [...AppState.offlineQueue];
  AppState.offlineQueue = [];
  localStorage.setItem('offlineQueue', '[]');

  for (const entry of queue) {
    try {
      await logSet(entry.sessionId, entry.exerciseId, entry.setNumber, entry.reps, entry.weight);
    } catch (e) {
      // Re-queue on failure
      AppState.offlineQueue.push(entry);
    }
  }
  if (AppState.offlineQueue.length > 0) {
    localStorage.setItem('offlineQueue', JSON.stringify(AppState.offlineQueue));
  }
}

// ── Set Logging with offline fallback ─────────────────────────────────────────

async function saveSet(sessionId, exerciseId, setNumber, reps, weight) {
  if (AppState.isOnline) {
    try {
      await logSet(sessionId, exerciseId, setNumber, reps, weight);
      return;
    } catch (e) {
      console.warn('logSet failed, queuing:', e);
    }
  }
  queueWrite({ sessionId, exerciseId, setNumber, reps, weight });
}

// ── Render ─────────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Main App Render ───────────────────────────────────────────────────────────

function renderApp() {
  updateOfflineIndicator();

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  document.getElementById('date-heading').textContent = today;

  // Check for in-progress session today
  const inProgress = AppState.sessions.find(
    s => s.date === todayStr() && !s.completed
  );

  if (inProgress) {
    AppState.currentSession = inProgress;
    AppState.currentType = inProgress.type;
    AppState.currentLocation = inProgress.location;
    loadLoggedSetsFromSession(inProgress);
    renderSession();
  } else {
    renderSessionPicker();
  }
}

function loadLoggedSetsFromSession(session) {
  AppState.loggedSets = {};
  (session.sets || []).forEach(set => {
    if (!AppState.loggedSets[set.exercise_id]) {
      AppState.loggedSets[set.exercise_id] = {};
    }
    AppState.loggedSets[set.exercise_id][set.set_number] = {
      reps: set.reps,
      weight: set.weight,
    };
  });
}

// ── Session Picker ─────────────────────────────────────────────────────────────

function updatePickerExercisePreview() {
  const list = document.getElementById('picker-ex-list');
  if (!list) return;
  const { currentType, currentLocation } = AppState;
  if (!currentType || currentType === 'rest') {
    list.innerHTML = '';
    return;
  }
  const exercises = getExercisesForSession(currentType, currentLocation);
  list.innerHTML = '';
  exercises.forEach(ex => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="ex-name">${ex.name}</span><span class="ex-target">${ex.muscles}</span>`;
    list.appendChild(li);
  });
}

function renderSessionPicker() {
  const recommended = recommendWorkout(AppState.sessions);
  AppState.currentType = recommended;
  // Keep existing location preference

  updateLocationToggle();
  updateSessionTypeButtons(recommended);
  updatePickerExercisePreview();

  document.getElementById('session-picker').classList.remove('hidden');
  document.getElementById('workout-view').classList.add('hidden');
  document.getElementById('session-summary').classList.add('hidden');

  // Update header
  document.getElementById('current-session-label').textContent = 'Select Session';
}

function updateSessionTypeButtons(activeType) {
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === activeType);
  });

  // Show rest screen or workout exercises
  if (activeType === 'rest') {
    document.getElementById('picker-exercises').classList.add('hidden');
    document.getElementById('picker-rest').classList.remove('hidden');
  } else {
    document.getElementById('picker-exercises').classList.remove('hidden');
    document.getElementById('picker-rest').classList.add('hidden');
  }
}

// ── Session Active ─────────────────────────────────────────────────────────────

async function startSession() {
  const type = AppState.currentType;
  const location = AppState.currentLocation;

  if (type === 'rest') {
    renderRestDay();
    return;
  }

  try {
    const session = await createSession(type, location);
    AppState.currentSession = session;
    AppState.sessions.unshift({ ...session, sets: [] });
  } catch (e) {
    if (!AppState.isOnline) {
      // Create a local placeholder session
      const localId = 'local-' + Date.now();
      AppState.currentSession = {
        id: localId,
        date: todayStr(),
        type,
        location,
        completed: false,
      };
    } else {
      showToast('Failed to start session. Please try again.', 'error');
      return;
    }
  }

  AppState.loggedSets = {};
  renderSession();
}

function renderSession() {
  const { currentType, currentLocation } = AppState;
  document.getElementById('session-picker').classList.add('hidden');
  document.getElementById('workout-view').classList.remove('hidden');
  document.getElementById('session-summary').classList.add('hidden');

  document.getElementById('current-session-label').textContent =
    capitalize(currentType) + ' — ' + capitalize(currentLocation);

  updateLocationToggle();

  const exercises = getExercisesForSession(currentType, currentLocation);
  const container = document.getElementById('exercise-cards');
  container.innerHTML = '';

  exercises.forEach(exercise => {
    container.appendChild(buildExerciseCard(exercise));
  });

  checkAllComplete();
}

// ── Exercise Card ─────────────────────────────────────────────────────────────

function buildExerciseCard(exercise) {
  const prevPR = getPreviousSessionPR(exercise.id, AppState.sessions);
  const allTimePR = getAllTimePR(exercise.id, AppState.sessions);
  const loggedSets = AppState.loggedSets[exercise.id] || {};
  const completedCount = Object.keys(loggedSets).length;
  const allDone = completedCount >= exercise.sets;

  const card = document.createElement('div');
  card.className = 'exercise-card' + (allDone ? ' all-done' : '');
  card.dataset.exerciseId = exercise.id;

  // ── Card Header
  const header = document.createElement('div');
  header.className = 'card-header';

  const nameEl = document.createElement('h3');
  nameEl.className = 'exercise-name';
  nameEl.textContent = exercise.name;

  const meta = document.createElement('div');
  meta.className = 'card-meta';

  const muscleBadge = document.createElement('span');
  muscleBadge.className = 'muscle-badge';
  muscleBadge.textContent = exercise.muscles;

  meta.appendChild(muscleBadge);

  if (allTimePR) {
    const prChip = document.createElement('span');
    prChip.className = 'pr-chip';
    prChip.textContent = allTimePR.unit === 'reps'
      ? `PR: ${allTimePR.value} reps`
      : `PR: ${allTimePR.value}kg`;
    meta.appendChild(prChip);
  }

  header.appendChild(nameEl);
  header.appendChild(meta);
  card.appendChild(header);

  if (allDone) {
    // Collapsed complete state
    const doneRow = document.createElement('div');
    doneRow.className = 'done-row';
    doneRow.innerHTML = `<span class="done-check">${exercise.sets}/${exercise.sets}</span><span class="done-label">Complete</span>`;
    card.appendChild(doneRow);
  } else {
    // ── Set Rows
    const setsContainer = document.createElement('div');
    setsContainer.className = 'sets-container';

    for (let i = 1; i <= exercise.sets; i++) {
      setsContainer.appendChild(buildSetRow(exercise, i, loggedSets[i] || null));
    }
    card.appendChild(setsContainer);
  }

  // ── Card Footer
  const footer = document.createElement('div');
  footer.className = 'card-footer';

  const prevEl = document.createElement('span');
  prevEl.className = 'prev-pr';
  if (prevPR) {
    prevEl.textContent = prevPR.unit === 'reps'
      ? `Prev: ${prevPR.value} reps`
      : `Prev: ${prevPR.value}kg`;
  } else {
    prevEl.textContent = 'No previous data';
  }

  const progressLink = document.createElement('button');
  progressLink.className = 'progress-link';
  progressLink.textContent = 'View progress →';
  progressLink.addEventListener('click', () => openProgressSheet(exercise));

  footer.appendChild(prevEl);
  footer.appendChild(progressLink);
  card.appendChild(footer);

  return card;
}

function buildSetRow(exercise, setNumber, logged) {
  const isLogged = !!logged;
  const suggestion = getWeightSuggestion(exercise.id, setNumber, AppState.sessions);

  const row = document.createElement('div');
  row.className = 'set-row' + (isLogged ? ' set-done' : '');
  row.dataset.setNumber = setNumber;

  const setLabel = document.createElement('span');
  setLabel.className = 'set-label';
  setLabel.textContent = `Set ${setNumber}`;

  const inputs = document.createElement('div');
  inputs.className = 'set-inputs';

  const repsInput = document.createElement('input');
  repsInput.type = 'number';
  repsInput.inputMode = 'decimal';
  repsInput.className = 'set-input reps-input';
  repsInput.placeholder = 'reps';
  repsInput.min = 0;
  repsInput.value = logged ? logged.reps : (suggestion ? suggestion.reps : '');
  repsInput.disabled = isLogged;

  inputs.appendChild(repsInput);

  if (!exercise.bodyweight) {
    const times = document.createElement('span');
    times.className = 'input-sep';
    times.textContent = '×';

    const weightInput = document.createElement('input');
    weightInput.type = 'number';
    weightInput.inputMode = 'decimal';
    weightInput.className = 'set-input weight-input';
    weightInput.placeholder = 'kg';
    weightInput.step = '0.5';
    weightInput.min = 0;
    weightInput.value = logged ? (logged.weight || '') : (suggestion ? suggestion.weight : '');
    weightInput.disabled = isLogged;

    const kgLabel = document.createElement('span');
    kgLabel.className = 'input-unit';
    kgLabel.textContent = 'kg';

    inputs.appendChild(times);
    inputs.appendChild(weightInput);
    inputs.appendChild(kgLabel);
  } else {
    const repsLabel = document.createElement('span');
    repsLabel.className = 'input-unit';
    repsLabel.textContent = 'reps';
    inputs.appendChild(repsLabel);
  }

  const tickBtn = document.createElement('button');
  tickBtn.className = 'tick-btn' + (isLogged ? ' ticked' : '');
  tickBtn.innerHTML = isLogged ? checkIcon() : circleIcon();
  tickBtn.setAttribute('aria-label', isLogged ? 'Set complete' : 'Mark set complete');
  tickBtn.disabled = isLogged;

  if (!isLogged) {
    tickBtn.addEventListener('click', () => {
      const reps = parseInt(repsInput.value, 10);
      if (!reps || reps < 1) {
        repsInput.classList.add('input-error');
        repsInput.focus();
        return;
      }
      repsInput.classList.remove('input-error');

      const weight = exercise.bodyweight
        ? null
        : parseFloat(row.querySelector('.weight-input')?.value) || null;

      completeSet(exercise, setNumber, reps, weight, row);
    });
  }

  row.appendChild(setLabel);
  row.appendChild(inputs);
  row.appendChild(tickBtn);

  return row;
}

async function completeSet(exercise, setNumber, reps, weight, rowEl) {
  // Animate
  rowEl.classList.add('flash');
  setTimeout(() => rowEl.classList.remove('flash'), 600);

  // Update local state
  if (!AppState.loggedSets[exercise.id]) {
    AppState.loggedSets[exercise.id] = {};
  }
  AppState.loggedSets[exercise.id][setNumber] = { reps, weight };

  // Persist
  if (AppState.currentSession) {
    await saveSet(AppState.currentSession.id, exercise.id, setNumber, reps, weight);
  }

  // Update row UI
  rowEl.classList.add('set-done');
  rowEl.querySelectorAll('input').forEach(i => i.disabled = true);
  const tickBtn = rowEl.querySelector('.tick-btn');
  if (tickBtn) {
    tickBtn.innerHTML = checkIcon();
    tickBtn.classList.add('ticked');
    tickBtn.disabled = true;
  }

  // Check if exercise is fully complete
  const loggedCount = Object.keys(AppState.loggedSets[exercise.id]).length;
  if (loggedCount >= exercise.sets) {
    const card = rowEl.closest('.exercise-card');
    if (card) {
      card.classList.add('all-done');
      // Rebuild card to collapsed state
      const newCard = buildExerciseCard(exercise);
      card.replaceWith(newCard);
    }
  }

  checkAllComplete();
}

// ── All Complete Check ─────────────────────────────────────────────────────────

function checkAllComplete() {
  const exercises = getExercisesForSession(AppState.currentType, AppState.currentLocation);
  if (exercises.length === 0) return;

  const allDone = exercises.every(ex => {
    const logged = AppState.loggedSets[ex.id] || {};
    return Object.keys(logged).length >= ex.sets;
  });

  const finishBar = document.getElementById('finish-bar');
  if (finishBar) finishBar.classList.toggle('visible', allDone);
}

// ── Session Summary ───────────────────────────────────────────────────────────

async function finishSession() {
  if (!AppState.currentSession) return;

  try {
    await completeSession(AppState.currentSession.id);
    // Update local state
    const s = AppState.sessions.find(s => s.id === AppState.currentSession.id);
    if (s) s.completed = true;
  } catch (e) {
    console.warn('Could not mark session complete:', e);
  }

  renderSummary();
}

function renderSummary() {
  document.getElementById('workout-view').classList.add('hidden');
  document.getElementById('session-summary').classList.remove('hidden');
  document.getElementById('finish-bar').classList.remove('visible');

  const exercises = getExercisesForSession(AppState.currentType, AppState.currentLocation);
  let totalVolume = 0;
  let newPRs = [];

  exercises.forEach(ex => {
    const logged = AppState.loggedSets[ex.id] || {};
    Object.values(logged).forEach(set => {
      if (set.weight) totalVolume += set.reps * set.weight;
    });

    // Check for new PRs
    const currentBest = ex.bodyweight
      ? Math.max(...Object.values(logged).map(s => s.reps || 0))
      : Math.max(...Object.values(logged).map(s => s.weight || 0));

    const prev = getAllTimePR(ex.id, AppState.sessions.slice(1)); // exclude current
    if (prev === null || currentBest > prev.value) {
      newPRs.push({ name: ex.name, value: currentBest, unit: ex.bodyweight ? 'reps' : 'kg' });
    }
  });

  document.getElementById('summary-type').textContent =
    capitalize(AppState.currentType) + ' — ' + capitalize(AppState.currentLocation);
  document.getElementById('summary-exercises').textContent = exercises.length + ' exercises';
  document.getElementById('summary-volume').textContent =
    AppState.currentLocation === 'gym' ? totalVolume.toFixed(0) + ' kg total volume' : '—';

  const prList = document.getElementById('summary-prs');
  prList.innerHTML = '';
  if (newPRs.length === 0) {
    prList.innerHTML = '<li class="no-pr">No new PRs today — but consistency wins.</li>';
  } else {
    newPRs.forEach(pr => {
      const li = document.createElement('li');
      li.textContent = `${pr.name}: ${pr.value}${pr.unit === 'kg' ? 'kg' : ' reps'}`;
      prList.appendChild(li);
    });
  }
}

// ── Rest Day ──────────────────────────────────────────────────────────────────

function renderRestDay() {
  document.getElementById('session-picker').classList.add('hidden');
  document.getElementById('workout-view').classList.add('hidden');
  document.getElementById('session-summary').classList.add('hidden');
  document.getElementById('rest-screen').classList.remove('hidden');
}

// ── Progress Bottom Sheet ─────────────────────────────────────────────────────

async function openProgressSheet(exercise) {
  const sheet = document.getElementById('progress-sheet');
  const overlay = document.getElementById('sheet-overlay');
  const title = document.getElementById('sheet-title');
  const chartWrap = document.getElementById('chart-wrap');

  title.textContent = exercise.name;
  chartWrap.innerHTML = '<canvas id="pr-chart"></canvas>';

  sheet.classList.add('open');
  overlay.classList.add('visible');

  try {
    const history = await getPRHistory(exercise.id);
    renderPRGraph('pr-chart', history, exercise.bodyweight);
  } catch (e) {
    chartWrap.innerHTML = '<p class="chart-error">Could not load progress data.</p>';
  }
}

function closeProgressSheet() {
  document.getElementById('progress-sheet').classList.remove('open');
  document.getElementById('sheet-overlay').classList.remove('visible');
}

// ── Location Toggle ───────────────────────────────────────────────────────────

function updateLocationToggle() {
  document.querySelectorAll('.location-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.location === AppState.currentLocation);
  });
}

async function switchLocation(newLocation) {
  if (newLocation === AppState.currentLocation) return;

  // Check if sets have been logged in current session
  const hasSets = Object.values(AppState.loggedSets).some(
    sets => Object.keys(sets).length > 0
  );

  if (hasSets && AppState.currentSession) {
    const confirmed = await showConfirmModal(
      'Switch Location',
      `Switching to ${capitalize(newLocation)} will start a new session. Your current sets will be saved. Continue?`
    );
    if (!confirmed) return;

    // Save current, start fresh
    try {
      await completeSession(AppState.currentSession.id);
    } catch (e) { /* offline ok */ }
  }

  AppState.currentLocation = newLocation;
  AppState.loggedSets = {};
  AppState.currentSession = null;

  if (document.getElementById('workout-view').classList.contains('hidden')) {
    // Still on picker
    updateLocationToggle();
    updatePickerExercisePreview();
  } else {
    // Active session — start new
    await startSession();
  }
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────

function showConfirmModal(title, message) {
  return new Promise(resolve => {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    document.getElementById('confirm-modal').classList.add('open');

    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');

    function cleanup(result) {
      document.getElementById('confirm-modal').classList.remove('open');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    const onConfirm = () => cleanup(true);
    const onCancel = () => cleanup(false);

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  setTimeout(() => toast.classList.remove('show'), 3500);
}

// ── Offline Indicator ─────────────────────────────────────────────────────────

function updateOfflineIndicator() {
  document.getElementById('offline-indicator').classList.toggle('visible', !AppState.isOnline);
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function checkIcon() {
  return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="11" cy="11" r="10" fill="#C9A84C" opacity="0.15"/>
    <circle cx="11" cy="11" r="10" stroke="#C9A84C" stroke-width="1.5"/>
    <path d="M7 11.5l3 3 5-5" stroke="#C9A84C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function circleIcon() {
  return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="11" cy="11" r="10" stroke="#1E2D40" stroke-width="1.5"/>
  </svg>`;
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  const lbl = document.getElementById('current-session-label');
  try {
    lbl.textContent = 'Starting…';
    initSupabase();

    lbl.textContent = 'Connecting…';
    window.addEventListener('online', () => { AppState.isOnline = true; updateOfflineIndicator(); flushQueue(); });
    window.addEventListener('offline', () => { AppState.isOnline = false; updateOfflineIndicator(); });

    wireUI();

    try {
      AppState.sessions = await fetchRecentSessions(30);
    } catch (e) {
      AppState.sessions = [];
      if (!AppState.isOnline) showToast('Offline — showing cached data', 'warn');
    }

    renderApp();
    flushQueue();
  } catch (e) {
    lbl.textContent = 'Boot error: ' + e.message;
    console.error(e);
  }
}

// ── UI Wiring ─────────────────────────────────────────────────────────────────

function wireUI() {
  // Location toggle
  document.querySelectorAll('.location-btn').forEach(btn => {
    btn.addEventListener('click', () => switchLocation(btn.dataset.location));
  });

  // Session type buttons
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      AppState.currentType = btn.dataset.type;
      updateSessionTypeButtons(btn.dataset.type);
      updatePickerExercisePreview();
    });
  });

  // Start session button
  document.getElementById('start-session-btn').addEventListener('click', startSession);

  // Finish session button
  document.getElementById('finish-session-btn').addEventListener('click', finishSession);

  // New session after summary
  document.getElementById('new-session-btn').addEventListener('click', () => {
    AppState.currentSession = null;
    AppState.loggedSets = {};
    document.getElementById('session-summary').classList.add('hidden');
    document.getElementById('rest-screen').classList.add('hidden');
    renderSessionPicker();
  });

  // Progress sheet close
  document.getElementById('sheet-close').addEventListener('click', closeProgressSheet);
  document.getElementById('sheet-overlay').addEventListener('click', closeProgressSheet);

  // Rest screen: train anyway
  document.getElementById('train-anyway-btn').addEventListener('click', () => {
    document.getElementById('rest-screen').classList.add('hidden');
    AppState.currentType = 'push';
    renderSessionPicker();
  });
}

document.addEventListener('DOMContentLoaded', boot);
