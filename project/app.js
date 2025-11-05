// Firestore-only 프런트 (CDN 모듈)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, query, orderBy, updateDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDnDt91Zg7ycDh6rRC6AdOd-sA2jKlQpVw",
  authDomain: "special-room-reservation.firebaseapp.com",
  projectId: "special-room-reservation",
  appId: "1:846567817629:web:3d0bba298491de3f762f74",
  measurementId: "G-2E17JFLMY2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Helpers
const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const inferRole = (email) => (/^\d{4}/.test((email || "").split("@")[0]) ? "student" : "teacher");

let currentUser = null;
let currentRole = "guest";

function renderMode(){
  $("whoami").textContent = currentUser ? (currentUser.displayName || currentUser.email) : "로그인하지 않음";
  $("loginBtn").style.display = currentUser ? "none" : "inline-block";
  $("logoutBtn").style.display = currentUser ? "inline-block" : "none";
  $("modeHint").textContent = `모드: ${currentRole}`;
  $("studentSubmitCard").style.display = currentRole === "student" ? "block" : "none";
  $("teacherCard").style.display = currentRole === "teacher" ? "block" : "none";
  if (currentRole === "student" && currentUser) {
    // 학생 폼의 이메일은 로그인 기준으로 고정(변경 불가)
    document.querySelector('input[name="email"]').value = currentUser.email;
  }
}

async function loadSheet(){
  const target = $("sheetTable");
  try{
    target.textContent = "불러오는 중…";
    const q = query(collection(db, "reservations"), orderBy("createdAt","desc"));
    const snap = await getDocs(q);
    const headers = ["room","date","start","end","studentId","email","status","updatedAt"];
    let html = "<table><thead><tr>" + headers.map(h=>`<th>${h}</th>`).join("") + "</tr></thead><tbody>";
    snap.forEach(docSnap => {
      const r = docSnap.data();
      html += "<tr>" + headers.map(h => `<td>${escapeHtml(String(r[h] ?? ""))}</td>`).join("") + "</tr>";
    });
    html += "</tbody></table>";
    target.innerHTML = html;
  }catch(e){
    target.textContent = "불러오기 실패: " + (e?.message || e);
  }
}

async function submitReservation(ev){
  ev.preventDefault();
  const form = ev.currentTarget;
  const msg = $("submitMsg");
  msg.textContent = "";
  try{
    if(!currentUser) throw new Error("로그인이 필요합니다.");
    if(currentRole !== "student") throw new Error("학생만 신청 가능합니다.");

    await addDoc(collection(db, "reservations"), {
      email: currentUser.email,
      studentId: form.studentId.value.trim(),
      room: form.room.value.trim(),
      date: form.date.value,
      start: form.start.value,
      end: form.end.value,
      reason: form.reason.value.trim(),
      status: "PENDING",
      updatedAt: new Date().toISOString(),
      createdAt: serverTimestamp(),        // 정렬을 위한 서버 타임스탬프
    });

    msg.textContent = "신청 완료!";
    form.reset();
    await loadSheet();
  }catch(e){
    msg.textContent = "실패: " + (e?.message || e);
  }
}

async function loadAdmin(){
  const target = $("adminTable");
  if(currentRole !== "teacher"){ target.textContent = "선생님 모드에서만 사용"; return; }
  try{
    target.textContent = "불러오는 중…";
    const q = query(collection(db, "reservations"), orderBy("createdAt","desc"));
    const snap = await getDocs(q);
    if(snap.empty){ target.textContent = "데이터 없음"; return; }

    let html = '<table><thead><tr><th>ID</th><th>실</th><th>일시</th><th>신청자</th><th>상태</th><th>조치</th></tr></thead><tbody>';
    const rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    for(const r of rows){
      const when = `${r.date || "-"} ${r.start || ""}~${r.end || ""}`;
      const who = `${r.studentId ? "학번 " + r.studentId + " / " : ""}${r.email || "-"}`;
      html += `<tr>
        <td>${escapeHtml(r.id)}</td>
        <td>${escapeHtml(r.room || "")}</td>
        <td>${escapeHtml(when)}</td>
        <td>${escapeHtml(who)}</td>
        <td>${escapeHtml(r.status || "")}</td>
        <td class="actions">
          <button class="btn sm" data-act="approve" data-id="${escapeHtml(r.id)}">승인</button>
          <button class="btn sm danger" data-act="deny" data-id="${escapeHtml(r.id)}">거절</button>
        </td>
      </tr>`;
    }
    html += "</tbody></table>";
    target.innerHTML = html;

    target.querySelectorAll("button[data-id]").forEach((b) =>
      b.addEventListener("click", async (e) => {
        const id = e.currentTarget.getAttribute("data-id");
        const act = e.currentTarget.getAttribute("data-act");
        const decision = act === "approve" ? "APPROVED" : "DENIED";
        try{
          await updateDoc(doc(db, "reservations", id), {
            status: decision,
            updatedAt: new Date().toISOString()
          });
          await loadAdmin();
          await loadSheet();
        }catch(err){ alert("실패: " + (err?.message || err)); }
      })
    );
  }catch(e){
    target.textContent = "불러오기 실패: " + (e?.message || e);
  }
}

// Auth UI
$("loginBtn").addEventListener("click", async () => {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
});
$("logoutBtn").addEventListener("click", async () => { await signOut(auth); });

// Auth 상태 반영
onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;
  currentRole = user?.email ? inferRole(user.email) : "guest";
  renderMode();
  if(currentRole === "teacher") await loadAdmin();
});

window.addEventListener("load", () => {
  $("refreshBtn").addEventListener("click", loadSheet);
  $("submitForm")?.addEventListener("submit", submitReservation);
  renderMode();
  loadSheet();
});
