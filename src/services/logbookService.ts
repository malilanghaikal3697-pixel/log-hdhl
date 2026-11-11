import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  Timestamp,
  onSnapshot
} from "firebase/firestore";
import { db } from "./firebase.ts";

export interface DashboardStats {
  pribadiCount: number;
  unitCount: number;
  monthlyData: number[];
}

/**
 * Real-time listener onSnapshot untuk statistik dashboard & chart perawat
 */
export function subscribeToDashboardStats(
  userUsername: string,
  _userRole: string,
  targetMonth: number,
  targetYear: number,
  onUpdate: (stats: DashboardStats) => void,
  onError?: (err: unknown) => void
): () => void {
  const logbooksRef = collection(db, "nurse_logbooks");
  const startOfMonth = new Date(targetYear, targetMonth, 1);
  const endOfMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

  const qUnit = query(
    logbooksRef,
    where("tanggal_input", ">=", Timestamp.fromDate(startOfMonth)),
    where("tanggal_input", "<=", Timestamp.fromDate(endOfMonth))
  );

  return onSnapshot(
    qUnit,
    (querySnapshot) => {
      let pribadiCount = 0;
      let unitCount = 0;
      const monthlyData = new Array(12).fill(0);

      querySnapshot.forEach((document) => {
        const data = document.data();
        if (data.status === 'disetujui_final') {
          unitCount++;
          const logDate = (data.tanggal_input as Timestamp)?.toDate?.() || new Date();
          monthlyData[logDate.getMonth()]++;
        }
        if (data.username === userUsername) {
          pribadiCount++;
        }
      });

      onUpdate({ pribadiCount, unitCount, monthlyData });
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

// 1. Ambil data hitungan untuk Dashboard & Grafik Chart
export async function getDashboardStats(
  userUsername: string,
  _userRole: string,
  targetMonth: number,
  targetYear: number
): Promise<DashboardStats> {
  const logbooksRef = collection(db, "nurse_logbooks");

  const startOfMonth = new Date(targetYear, targetMonth, 1);
  const endOfMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

  let pribadiCount = 0;
  let unitCount = 0;
  const monthlyData = new Array(12).fill(0);

  const qUnit = query(
    logbooksRef,
    where("tanggal_input", ">=", Timestamp.fromDate(startOfMonth)),
    where("tanggal_input", "<=", Timestamp.fromDate(endOfMonth))
  );

  const querySnapshot = await getDocs(qUnit);

  querySnapshot.forEach((document) => {
    const data = document.data();

    // Hitung total unit HD jika status sudah disetujui final oleh Kepala Ruang
    if (data.status === 'disetujui_final') {
      unitCount++;
      const logDate = (data.tanggal_input as Timestamp).toDate();
      monthlyData[logDate.getMonth()]++;
    }

    // Hitung akumulasi pribadi berdasarkan username perawat yang login
    if (data.username === userUsername) {
      pribadiCount++;
    }
  });

  return { pribadiCount, unitCount, monthlyData };
}

/**
 * Real-time listener onSnapshot untuk antrean verifikasi logbook perawat (PJ Shift & Kepala Ruang)
 */
export function subscribeToPendingVerifications(
  userRole: string,
  onUpdate: (items: any[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const logbooksRef = collection(db, "nurse_logbooks");
  let q;

  const normalized = userRole.toLowerCase().trim();
  if (normalized === 'pj_shift' || normalized === 'pj shift') {
    q = query(logbooksRef, where("status", "==", "diajukan_ke_pj"));
  } else if (normalized === 'kepala_ruang' || normalized === 'kepala_ruangan' || normalized === 'kepala ruang') {
    q = query(logbooksRef, where("status", "==", "diajukan_ke_karu"));
  } else {
    onUpdate([]);
    return () => {};
  }

  return onSnapshot(
    q,
    (querySnapshot) => {
      const items = querySnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      onUpdate(items);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

// 2. Ambil daftar logbook yang membutuhkan verifikasi (State Machine 4 Hak Akses)
export async function getPendingVerifications(userRole: string) {
  const logbooksRef = collection(db, "nurse_logbooks");
  let q;

  const normalized = userRole.toLowerCase().trim();
  if (normalized === 'pj_shift' || normalized === 'pj shift') {
    // PJ Shift memverifikasi logbook milik Perawat Pelaksana
    q = query(logbooksRef, where("status", "==", "diajukan_ke_pj"));
  } else if (normalized === 'kepala_ruang' || normalized === 'kepala_ruangan' || normalized === 'kepala ruang') {
    // Kepala Ruang memverifikasi logbook yang sudah lolos dari PJ Shift
    q = query(logbooksRef, where("status", "==", "diajukan_ke_karu"));
  } else {
    return [];
  }

  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// 3. Aksi Tombol Verifikasi (Setuju / Tolak)
export async function verifyLogbook(
  logbookId: string,
  verifikatorUsername: string,
  action: 'setuju' | 'tolak',
  currentRole: string
) {
  const logbookDocRef = doc(db, "nurse_logbooks", logbookId);
  let nextStatus = "draft";

  if (action === 'setuju') {
    if (currentRole === 'pj_shift') nextStatus = "diajukan_ke_karu";
    else if (currentRole === 'kepala_ruang') nextStatus = "disetujui_final";
  } else {
    nextStatus = "draft"; // Jika ditolak, kembali ke perawat pelaksana untuk direvisi
  }

  await updateDoc(logbookDocRef, {
    status: nextStatus,
    [`verifikator_${currentRole}`]: verifikatorUsername,
    tanggal_verifikasi: Timestamp.now()
  });
}