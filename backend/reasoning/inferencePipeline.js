// backend/reasoning/inferencePipeline.js
// Core inference pipeline (MVP):
// 1) normalize -> symptom ids
// 2) score syndromes using syndrome_symptom weights
// 3) apply constraints (basic)
// 4) return top candidates + questions

/**
 * @typedef {Object} CaseData
 * @property {string} encounterId
 * @property {string[]} symptomIds         // normalized symptom UUIDs (MVP input)
 * @property {Object} meta                // optional: age/sex/bmi...
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {CaseData} caseData
 */
export async function infer(supabase, caseData) {
  const { encounterId, symptomIds = [] } = caseData;

  if (!symptomIds.length) {
    return {
      best: null,
      candidates: [],
      evidence: [],
      questions: [{ type: "need_more_info", message: "Chưa có triệu chứng đã chuẩn hoá." }],
    };
  }

  // --- 1) Fetch weights: syndrome_symptom for observed symptoms
  const { data: links, error: linksErr } = await supabase
    .from("syndrome_symptom")
    .select("syndrome_id, symptom_id, weight, polarity")
    .in("symptom_id", symptomIds);

  if (linksErr) throw new Error(`syndrome_symptom query failed: ${linksErr.message}`);

  // --- 2) Score syndromes
  // polarity: support -> +weight, contra -> -weight
  const scoreMap = new Map(); // syndrome_id -> score
  const evidenceMap = new Map(); // syndrome_id -> evidence items

  for (const row of links || []) {
    const delta = row.polarity === "contra" ? -Number(row.weight || 0) : Number(row.weight || 0);
    scoreMap.set(row.syndrome_id, (scoreMap.get(row.syndrome_id) || 0) + delta);

    const ev = evidenceMap.get(row.syndrome_id) || [];
    ev.push({ symptom_id: row.symptom_id, weight: row.weight, polarity: row.polarity });
    evidenceMap.set(row.syndrome_id, ev);
  }

  // turn into sorted candidates
  let candidates = [...scoreMap.entries()]
    .map(([syndrome_id, score]) => ({
      syndrome_id,
      score,
      evidence: evidenceMap.get(syndrome_id) || [],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (!candidates.length) {
    return {
      best: null,
      candidates: [],
      evidence: [],
      questions: [{ type: "no_match", message: "Không có mapping hội chứng–triệu chứng phù hợp." }],
    };
  }

  // --- 3) Apply constraints (basic):
  // rule_constraint: {id, syndrome_id, rule_type, message}
  // rule_condition: {constraint_id, symptom_id, operator} operator: present/absent (MVP)
  const candidateSyndromeIds = candidates.map(c => c.syndrome_id);

  const { data: constraints, error: cErr } = await supabase
    .from("rule_constraint")
    .select("id, syndrome_id, rule_type, message, rule_condition(id, symptom_id, operator)")
    .in("syndrome_id", candidateSyndromeIds);

  if (cErr) throw new Error(`rule_constraint query failed: ${cErr.message}`);

  const observed = new Set(symptomIds);
  const dropped = new Set();
  const questions = [];

  for (const rc of constraints || []) {
    const conds = rc.rule_condition || [];

    // evaluate all conditions (AND)
    let ok = true;
    for (const cond of conds) {
      if (cond.operator === "present" && !observed.has(cond.symptom_id)) ok = false;
      if (cond.operator === "absent" && observed.has(cond.symptom_id)) ok = false;
    }

    if (rc.rule_type === "exclude") {
      // if conditions satisfied => exclude syndrome
      if (ok) dropped.add(rc.syndrome_id);
    }

    if (rc.rule_type === "required") {
      // if NOT ok => ask missing present symptoms
      if (!ok) {
        for (const cond of conds) {
          if (cond.operator === "present" && !observed.has(cond.symptom_id)) {
            questions.push({
              type: "missing_required",
              syndrome_id: rc.syndrome_id,
              symptom_id: cond.symptom_id,
              message: rc.message || "Cần bổ sung triệu chứng để củng cố hội chứng.",
            });
          }
        }
      }
    }

    if (rc.rule_type === "incompatibility") {
      // if conditions satisfied => drop (MVP: treat like exclude)
      if (ok) dropped.add(rc.syndrome_id);
    }
  }

  candidates = candidates.filter(c => !dropped.has(c.syndrome_id));

  // --- 4) Attach syndrome names for display
  const { data: syndromes, error: sErr } = await supabase
    .from("syndrome")
    .select("id, name, description")
    .in("id", candidates.map(c => c.syndrome_id));

  if (sErr) throw new Error(`syndrome query failed: ${sErr.message}`);

  const synMap = new Map((syndromes || []).map(s => [s.id, s]));

  const enriched = candidates.map(c => ({
    ...c,
    syndrome: synMap.get(c.syndrome_id) || { id: c.syndrome_id, name: "Unknown", description: "" },
  }));

  const best = enriched[0] || null;

  return {
    best,
    candidates: enriched,
    evidence: best?.evidence || [],
    questions,
  };
}
