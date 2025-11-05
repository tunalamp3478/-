import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { google } from "googleapis";
import { customAlphabet } from "nanoid";

admin.initializeApp();
const nanoid = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", 10);

// .env 사용
const SHEET_ID = process.env.SHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || "설문지 응답 시트1";
if (!SHEET_ID) console.warn("⚠️ SHEET_ID 미설정 (.env.local 확인)");

function sheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

// A:O 전체 읽고 헤더 인덱스 매핑
async function getSheetMatrix(sheets, sheetName, range = "A:O") {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!${range}`
  });
  const values = r.data.values || [];
  const headers = (values[0] || []).map(String);
  const rows = values.slice(1);
  const idx = {};
  headers.forEach((h, i) => (idx[h.trim()] = i));
  return { headers, idx, rows };
}
const gv = (row, idx, key) => {
  const i = idx[key];
  return (i != null && row[i] != null) ? row[i] : "";
};

// 표준 레코드로 정규화(프런트에서 그대로 사용)
function normalizeRecord(row, idx) {
  return {
    id:         gv(row, idx, "_ID") || gv(row, idx, "id"),
    email:      gv(row, idx, "이메일 주소") || gv(row, idx, "email"),
    studentId:  gv(row, idx, "학번") || gv(row, idx, "studentId"),
    room:       gv(row, idx, "특별실") || gv(row, idx, "room"),
    date:       gv(row, idx, "예약일") || gv(row, idx, "date"),
    start:      gv(row, idx, "시작시간") || gv(row, idx, "start"),
    end:        gv(row, idx, "종료시간") || gv(row, idx, "end"),
    reason:     gv(row, idx, "사유") || gv(row, idx, "reason"),
    status:     gv(row, idx, "_Status") || gv(row, idx, "status") || "PENDING",
    updatedAt:  gv(row, idx, "_UpdatedAt") || gv(row, idx, "updatedAt"),
  };
}

// 공개 목록
export const list = functions.https.onRequest(async (req, res) => {
  try {
    const sheets = sheetsClient();
    const { idx, rows } = await getSheetMatrix(sheets, SHEET_NAME, "A:O");
    const data = rows.map(r => normalizeRecord(r, idx));
    res.json({ rows: data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 자체 제출(구글폼 대신 사용 시)
export const submit = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { email, studentId, room, date, start, end, reason } = req.body || {};
    if (!email || !studentId || !room || !date || !start || !end) {
      return res.status(400).json({ error: "필수값 누락" });
    }
    const now = new Date().toISOString();
    const id = nanoid();
    const row = [now, email, studentId, room, date, start, end, reason || "", "PENDING", now, id];

    const sheets = sheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:K`,
      valueInputOption: "RAW",
      requestBody: { values: [row] }
    });
    res.json({ id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 토큰 검증 + 교사 판정(앞 4자리 숫자면 학생 → 거절)
async function verifyTeacher(req) {
  const authz = req.headers.authorization || "";
  const m = authz.match(/^Bearer (.+)$/);
  if (!m) { req.res.status(401).json({ error: "인증 필요" }); return null; }
  const idToken = m[1];
  const decoded = await admin.auth().verifyIdToken(idToken);
  const email = decoded.email || "";
  const local = email.split("@")[0] || "";
  const isStudent = /^\d{4}/.test(local);
  if (isStudent) { req.res.status(403).json({ error: "교사 전용" }); return null; }
  return decoded;
}

// 교사 목록
export const adminList = functions.https.onRequest(async (req, res) => {
  try {
    const user = await verifyTeacher(req);
    if (!user) return;

    const sheets = sheetsClient();
    const { idx, rows } = await getSheetMatrix(sheets, SHEET_NAME, "A:O");
    const data = rows.map(r => normalizeRecord(r, idx));
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 교사 승인/거절 (동적 열 위치)
export const adminDecide = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const user = await verifyTeacher(req);
    if (!user) return;

    const { id, decision } = req.body || {};
    if (!id || !["APPROVED","DENIED"].includes(decision)) {
      return res.status(400).json({ error: "잘못된 요청" });
    }

    const sheets = sheetsClient();
    const { idx, rows } = await getSheetMatrix(sheets, SHEET_NAME, "A:O");

    const idCol = idx["_ID"] ?? idx["id"];
    if (idCol == null) return res.status(400).json({ error: "_ID/id 컬럼 없음" });

    let targetRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i][idCol] || "") === id) { targetRowIndex = i; break; }
    }
    if (targetRowIndex < 0) return res.status(404).json({ error: "ID를 찾을 수 없음" });

    const statusCol = idx["_Status"] ?? idx["status"];
    const updatedCol = idx["_UpdatedAt"] ?? idx["updatedAt"];
    if (statusCol == null || updatedCol == null) {
      return res.status(400).json({ error: "_Status/_UpdatedAt 컬럼 없음" });
    }

    const rowNumber = targetRowIndex + 2; // 1행=헤더
    const now = new Date().toISOString();

    const toA1 = (colIndex) => {
      let n = colIndex + 1, s = "";
      while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n/26); }
      return s;
    };

    const statusA1 = `${toA1(statusCol)}${rowNumber}`;
    const updatedA1 = `${toA1(updatedCol)}${rowNumber}`;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: `${SHEET_NAME}!${statusA1}`,  values: [[decision]] },
          { range: `${SHEET_NAME}!${updatedA1}`, values: [[now]] }
        ]
      }
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});
<script type="module" src="/app.js"></script>
