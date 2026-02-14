import { getSupabaseAdmin } from "../backend/api/supabaseClient.js";
import { infer } from "../backend/reasoning/inferencePipeline.js";

// ---------- CORS ----------
function setCors(res) {
  // Nếu bạn muốn khóa domain, thay "*" bằng domain Vercel của bạn
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function safeError(err) {
  return {
    message: err?.message || "Unknown error",
    name: err?.name || "Error",
  };
}

// ---------- Handler ----------
export default async function handler(req, res) {
  setCors(res);

  // Preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: { message: "Method not allowed" } });
  }

  try {
    // Parse JSON body (Vercel Node runtime usually parses req.body already,
    // but we handle both cases robustly)
    let body = req.body;
    if (!body || typeof body === "string") {
      body = body ? JSON.parse(body) : {};
    }

    // ---- Expected payload from UI ----
    // Minimal MVP:
    // {
    //   encounterId: "uuid-optional",
    //   symptomIds: ["uuid1","uuid2",...],
    //   meta: { age, sex, bmi, job }
    // }
    const caseData = {
      encounterId: body.encounterId || null,
      symptomIds: Array.isArray(body.symptomIds) ? body.symptomIds : [],
      meta: body.meta || {},
      // bạn có thể gửi thêm raw FourDx text để log sau:
      fourdx: body.fourdx || null,
    };

    const supabase = getSupabaseAdmin();

    const result = await infer(supabase, caseData);

    // (Tuỳ chọn) log vào inference_run nếu bạn đã tạo bảng
    // Nếu chưa tạo bảng thì cứ comment đoạn này.
    try {
      if (caseData.encounterId && result?.best?.syndrome_id) {
        await supabase.from("inference_run").insert({
          encounter_id: caseData.encounterId,
          syndrome_id: result.best.syndrome_id,
          score: result.best.score ?? null,
          evidence: result.best.evidence ?? [],
          questions: result.questions ?? [],
        });
      }
    } catch (logErr) {
      // Không làm fail request nếu log lỗi
      // Bạn có thể bật debug khi cần:
      // console.error("inference_run insert failed", logErr);
    }

    return sendJson(res, 200, { ok: true, data: result });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: safeError(err) });
  }
}
