// db.js — All Supabase interactions (no auth)

let _supabase = null;

function initSupabase() {
  if (_supabase) return _supabase;
  _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}

function getClient() {
  if (!_supabase) initSupabase();
  return _supabase;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

async function fetchRecentSessions(limit = 30) {
  const db = getClient();

  const { data: sessions, error: sessErr } = await db
    .from('sessions')
    .select('*')
    .order('date', { ascending: false })
    .limit(limit);

  if (sessErr) throw sessErr;
  if (!sessions || sessions.length === 0) return [];

  const sessionIds = sessions.map(s => s.id);

  const { data: sets, error: setsErr } = await db
    .from('sets')
    .select('*')
    .in('session_id', sessionIds);

  if (setsErr) throw setsErr;

  const setsBySession = {};
  (sets || []).forEach(set => {
    if (!setsBySession[set.session_id]) setsBySession[set.session_id] = [];
    setsBySession[set.session_id].push(set);
  });

  return sessions.map(s => ({
    ...s,
    sets: setsBySession[s.id] || [],
  }));
}

async function createSession(type, location) {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await getClient()
    .from('sessions')
    .insert({ date: today, type, location, completed: false })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function completeSession(sessionId) {
  const { error } = await getClient()
    .from('sessions')
    .update({ completed: true })
    .eq('id', sessionId);

  if (error) throw error;
}

// ── Sets ─────────────────────────────────────────────────────────────────────

async function logSet(sessionId, exerciseId, setNumber, reps, weight) {
  const db = getClient();

  const payload = {
    session_id: sessionId,
    exercise_id: exerciseId,
    set_number: setNumber,
    reps,
    weight: weight ?? null,
    completed: true,
    logged_at: new Date().toISOString(),
  };

  const { data: existing } = await db
    .from('sets')
    .select('id')
    .eq('session_id', sessionId)
    .eq('exercise_id', exerciseId)
    .eq('set_number', setNumber)
    .maybeSingle();

  if (existing) {
    const { error } = await db.from('sets').update(payload).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await db.from('sets').insert(payload);
    if (error) throw error;
  }
}

// ── PR History ────────────────────────────────────────────────────────────────

async function getPRHistory(exerciseId) {
  const db = getClient();
  const exercise = getExerciseById(exerciseId);

  const { data: sets, error } = await db
    .from('sets')
    .select('reps, weight, logged_at, session_id')
    .eq('exercise_id', exerciseId)
    .eq('completed', true)
    .order('logged_at', { ascending: true });

  if (error) throw error;
  if (!sets || sets.length === 0) return [];

  const sessionIds = [...new Set(sets.map(s => s.session_id))];
  const { data: sessions, error: sessErr } = await db
    .from('sessions')
    .select('id, date')
    .in('id', sessionIds);

  if (sessErr) throw sessErr;

  const dateBySession = {};
  (sessions || []).forEach(s => { dateBySession[s.id] = s.date; });

  const bySession = {};
  sets.forEach(set => {
    const date = dateBySession[set.session_id];
    if (!date) return;
    if (!bySession[date]) bySession[date] = [];
    bySession[date].push(set);
  });

  const isBodyweight = exercise ? exercise.bodyweight : false;

  return Object.entries(bySession)
    .map(([date, sessionSets]) => {
      const value = isBodyweight
        ? Math.max(...sessionSets.map(s => s.reps))
        : Math.max(...sessionSets.map(s => s.weight || 0));
      return { date, value };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
