// read-sheet.mjs (디버그 버전)
console.log("[START] read-sheet.mjs");

import { google } from "googleapis";

const SHEET_ID = process.env.SHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || "특별실예약";

console.log("[ENV] SHEET_ID =", SHEET_ID || "(없음)");
console.log("[ENV] SHEET_NAME =", SHEET_NAME || "(없음)");

if (!SHEET_ID) {
  console.error("[ERROR] 환경변수 SHEET_ID가 필요합니다.");
  process.exit(1);
}

async function main() {
  try {
    console.log("[AUTH] GoogleAuth 초기화…");
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    // 자격증명 간단 점검
    const client = await auth.getClient();
    console.log("[AUTH] 클라이언트 확보 OK");

    const sheets = google.sheets({ version: "v4", auth });

    console.log("[CALL] values.get 호출…");
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:O`,
    });

    const values = r.data.values || [];
    console.log("[RESULT] rows including header =", values.length);

    if (values.length === 0) {
      console.log("[INFO] 시트에 데이터가 없습니다.");
      return;
    }

    const headers = values[0].map(String);
    const rows = values.slice(1);
    console.log("[HEADERS]", headers.join(" | "));
    console.log("[ROWS]", rows.length);

    // 앞 5행만 미리보기
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      console.log(`[ROW ${i + 1}]`, (rows[i] || []).join(" | "));
    }

    console.log("[DONE] 완료");
  } catch (err) {
    console.error("[EXCEPTION]", err?.message || err);
    if (err?.response?.data) {
      console.error("[EXCEPTION.DATA]", JSON.stringify(err.response.data));
    }
    process.exit(1);
  }
}

main();
