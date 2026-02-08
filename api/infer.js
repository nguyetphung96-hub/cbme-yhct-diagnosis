export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body || {};
  const q = body?.fourDx?.van_chung || [];

  // Mock: lấy vài triệu chứng để làm evidence
  const evidence = q.slice(0, 4).map(x => `Vấn: ${x.symptom} (VAS ${x.vas}, ${x.onset})`);

  res.status(200).json({
    best: {
      label: "Thận dương hư (mock)",
      score: 0.78,
      evidence: evidence.length ? evidence : ["Chưa có dữ liệu vấn chẩn"],
      questions: [
        "Bạn có sợ lạnh rõ, thích ấm không?",
        "Tiểu trong nhiều? có phù nhẹ buổi sáng không?",
        "Lưng gối mỏi lạnh, sinh lực giảm?"
      ]
    },
    ranked: [
      { label: "Thận dương hư (mock)", score: 0.78, evidence },
      { label: "Tỳ khí hư (mock)", score: 0.41, evidence: ["Gợi ý: đầy bụng/ăn kém?"] },
      { label: "Can khí uất (mock)", score: 0.25, evidence: ["Gợi ý: căng tức ngực/sườn?"] }
    ],
    warnings: []
  });
}
