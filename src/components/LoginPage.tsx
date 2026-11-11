import React, { useState } from 'react';
import { Lock, Eye, EyeOff, AlertCircle, User, Info, X, Loader2 } from 'lucide-react';
import { signInWithEmailAndPassword, AuthError } from 'firebase/auth';
import { auth } from '../services/firebase.ts';
import {
  ShiftInfo,
  ShiftName,
  MasterNurse,
  NurseScheduleEntry,
  SystemAccessRole
} from '../types/dialysis.ts';
import {
  findNurseByAccountInput,
  resolveNurseSystemAccess
} from '../utils/masterDataHelpers.ts';
import { getCurrentIsoDateWib } from '../utils/dateHelpers.ts';
import { resolveNurseMatrixShiftForDate } from '../utils/monthlyScheduleMatrixHelpers.ts';
import { useCleanHospitalBackground } from '../utils/useCleanHospitalBackground.ts';
import { RshlLogo } from './RshlLogo.tsx';

export interface LoginUserData {
  nurseId?: string;
  email: string;
  username?: string;
  name: string;
  role: string;
  shift: ShiftName;
  shiftHours: string;
  nip?: string;
  userRole?: SystemAccessRole;
}

interface LoginPageProps {
  onLogin: (userData: LoginUserData) => void;
  shiftInfo?: ShiftInfo;
  masterNurses?: MasterNurse[];
  nurseSchedules?: NurseScheduleEntry[];
}

const REMEMBER_STORAGE_KEY = 'rshl_dialisis_remembered_nip_v1';

/**
 * Menerjemahkan kode error bawaan Firebase Auth ke pesan Bahasa Indonesia yang ramah pengguna
 */
function getFirebaseErrorMessage(error: AuthError | Error): string {
  const code = 'code' in error ? (error as AuthError).code : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'Email/NIP atau kata sandi yang Anda masukkan tidak sesuai. Silakan periksa kembali.';
    case 'auth/user-not-found':
      return 'Akun dengan kredensial tersebut belum terdaftar pada sistem hemodialisa.';
    case 'auth/invalid-email':
      return 'Format alamat email tidak valid (contoh: perawat@happyland.co.id).';
    case 'auth/user-disabled':
      return 'Akun ini telah dinonaktifkan oleh Administrator. Hubungi Kepala Ruangan atau Admin.';
    case 'auth/too-many-requests':
      return 'Terlalu banyak percobaan masuk yang gagal. Akses ditangguhkan sementara demi keamanan. Coba lagi beberapa saat lagi.';
    case 'auth/operation-not-allowed':
      return 'Metode masuk Email/Password belum diaktifkan di Firebase Console. Silakan buka menu Authentication > Sign-in method di Firebase Console, lalu aktifkan (Enable) penyedia "Email/Password".';
    case 'auth/unauthorized-domain':
      return 'Domain aplikasi belum diizinkan di Firebase Authentication. Buka Firebase Console > Authentication > Settings > Authorized Domains dan tambahkan domain aplikasi ini.';
    default:
      return code
        ? `Gagal masuk (${code}). Periksa kembali email dan kata sandi Anda atau pastikan penyedia Email/Password telah aktif di Firebase.`
        : 'Gagal masuk ke sistem. Periksa kembali NIP/Email dan kata sandi Anda.';
  }
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onLogin,
  shiftInfo,
  masterNurses = [],
  nurseSchedules = []
}) => {
  const [loginId, setLoginId] = useState<string>(() => {
    try {
      return localStorage.getItem(REMEMBER_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState<string>('');
  const [rememberMe, setRememberMe] = useState<boolean>(() => {
    try {
      return Boolean(localStorage.getItem(REMEMBER_STORAGE_KEY));
    } catch {
      return false;
    }
  });
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showForgotInfo, setShowForgotInfo] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const { bgSrc, isProcessed, hasError, onImageError } = useCleanHospitalBackground();

  const activeShiftName: ShiftName = shiftInfo?.shift || 'Pagi';
  const activeShiftHours = shiftInfo?.shiftHours || 'Pagi, jam 07.00 - 14.00 WIB';

  const formatNurseRoleTitle = (role: MasterNurse['role'], access?: SystemAccessRole) => {
    if (access === 'administrator') return 'Administrator Unit HD';
    if (access === 'managerial') return 'Managerial (Monitoring & Audit Eksekutif)';
    if (access === 'kepala_ruangan' || role === 'kepala_ruangan')
      return 'Kepala Ruangan (Ka. Ruangan)';
    if (access === 'pj_shift' || role === 'pj_shift')
      return 'Penanggung Jawab Shift (PJ Shift)';
    return 'Perawat Pelaksana Dialisis';
  };

  const resolveShiftHours = (shiftName: ShiftName): string => {
    if (shiftName === 'Siang') return 'Siang, jam 14.00 - 21.00 WIB';
    if (shiftName === 'Malam') return 'Malam, jam 21.00 - 07.00 WIB';
    return 'Pagi, jam 07.00 - 14.00 WIB';
  };

  const persistRememberPreference = (rawIdentifier: string) => {
    try {
      if (rememberMe && rawIdentifier.trim()) {
        localStorage.setItem(REMEMBER_STORAGE_KEY, rawIdentifier.trim());
      } else {
        localStorage.removeItem(REMEMBER_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setShowForgotInfo(false);

    const cleanInput = loginId.trim().toLowerCase();
    const compactInput = cleanInput.replace(/\s+/g, '');

    if (!cleanInput) {
      setErrorMessage('Harap masukkan Email, Nomor Induk Pegawai (NIP), atau ID akun Anda.');
      return;
    }

    if (!password) {
      setErrorMessage('Harap masukkan Kata Sandi Anda.');
      return;
    }

    if (password.length < 3) {
      setErrorMessage('Kata sandi minimal terdiri dari 3 karakter.');
      return;
    }

    setIsLoading(true);

    // 1. Tentukan target email untuk autentikasi langsung ke Firebase Authentication
    let authEmail = '';
    if (cleanInput.includes('@')) {
      authEmail = cleanInput;
    } else if (cleanInput === 'admin' || compactInput === '198809152014021001') {
      authEmail = 'admin@happyland.co.id';
    } else if (cleanInput === 'managerial' || cleanInput === 'manajemen') {
      authEmail = 'manager@happyland.co.id';
    } else {
      const nurseMatch = findNurseByAccountInput(masterNurses, cleanInput);
      if (nurseMatch?.email && nurseMatch.email.includes('@')) {
        authEmail = nurseMatch.email.toLowerCase().trim();
      } else {
        // Fallback email dengan domain resmi RS Happy Land jika user menginputkan username (misal: twis.hdhl -> twis.hdhl@happyland.co.id)
        authEmail = `${cleanInput}@happyland.co.id`;
      }
    }

    // 2. Autentikasi ke Firebase Authentication menggunakan authEmail
    let firebaseAuthSuccess = false;
    let firebaseUserCred: any = null;
    let lastAuthError: any = null;

    if (authEmail) {
      try {
        firebaseUserCred = await signInWithEmailAndPassword(auth, authEmail, password);
        firebaseAuthSuccess = true;
      } catch (authErr: any) {
        lastAuthError = authErr;
        console.warn('Firebase Auth sign-in attempt with', authEmail, 'info:', authErr?.code, authErr?.message || authErr);

        const errCode = authErr?.code || '';
        if (
          errCode === 'auth/user-disabled' ||
          errCode === 'auth/too-many-requests' ||
          errCode === 'auth/operation-not-allowed' ||
          errCode === 'auth/unauthorized-domain'
        ) {
          setIsLoading(false);
          setErrorMessage(getFirebaseErrorMessage(authErr));
          return;
        }
      }
    }

    // 3. Jika autentikasi Firebase berhasil, mapping profil dan hak akses pengguna
    if (firebaseAuthSuccess && firebaseUserCred) {
      const fbEmail = (firebaseUserCred.user?.email || authEmail).toLowerCase();

      // A. Cek Administrator
      if (fbEmail === 'admin@happyland.co.id' || cleanInput === 'admin') {
        persistRememberPreference(loginId);
        setIsLoading(false);
        onLogin({
          email: fbEmail,
          username: 'admin',
          name: firebaseUserCred.user?.displayName || 'Administrator Unit HD',
          role: 'Administrator Unit HD',
          shift: activeShiftName,
          shiftHours: activeShiftHours,
          nip: '19880915 201402 1 001',
          userRole: 'administrator'
        });
        return;
      }

      // B. Cek Managerial
      if (fbEmail === 'manager@happyland.co.id' || cleanInput === 'managerial') {
        persistRememberPreference(loginId);
        setIsLoading(false);
        onLogin({
          email: fbEmail,
          username: 'managerial',
          name: firebaseUserCred.user?.displayName || 'Managerial Unit Dialisis',
          role: 'Managerial (Monitoring & Audit Eksekutif)',
          shift: activeShiftName,
          shiftHours: activeShiftHours,
          nip: '-',
          userRole: 'managerial'
        });
        return;
      }

      // C. Cek Master Data Perawat (berdasarkan email Firebase atau input user)
      const matchedNurse =
        masterNurses.find(
          (n) =>
            (n.email || '').toLowerCase().trim() === fbEmail ||
            (n.email || '').toLowerCase().trim() === cleanInput
        ) || findNurseByAccountInput(masterNurses, cleanInput);

      if (matchedNurse) {
        if (matchedNurse.accountStatus === 'nonaktif') {
          setIsLoading(false);
          setErrorMessage(`Akun "${matchedNurse.name}" sedang dinonaktifkan oleh Administrator.`);
          return;
        }

        const resolvedRole = resolveNurseSystemAccess(matchedNurse);
        const matrixScheduleToday = resolveNurseMatrixShiftForDate(
          nurseSchedules,
          { id: matchedNurse.id, name: matchedNurse.name },
          getCurrentIsoDateWib()
        );
        const assignedShift: ShiftName =
          matrixScheduleToday.logbookShift || matchedNurse.shiftAssigned || activeShiftName;

        persistRememberPreference(loginId);
        setIsLoading(false);
        onLogin({
          nurseId: matchedNurse.id,
          email: fbEmail,
          username: matchedNurse.username || cleanInput,
          name: matchedNurse.name,
          role: formatNurseRoleTitle(matchedNurse.role, resolvedRole),
          shift: assignedShift,
          shiftHours: resolveShiftHours(assignedShift),
          nip: matchedNurse.nip,
          userRole: resolvedRole
        });
        return;
      }

      // D. User terdaftar di Firebase Auth namun belum di-mapping di master nurses
      persistRememberPreference(loginId);
      setIsLoading(false);
      const resolvedName = firebaseUserCred.user?.displayName || fbEmail.split('@')[0];
      onLogin({
        email: fbEmail,
        username: fbEmail.split('@')[0],
        name: resolvedName,
        role: 'Perawat Pelaksana Dialisis',
        shift: activeShiftName,
        shiftHours: activeShiftHours,
        nip: '-',
        userRole: 'perawat_pelaksana'
      });
      return;
    }

    // 4. Fallback Cadangan Offline / Demo Lokal jika Firebase Auth tidak cocok
    const isBuiltInAdmin =
      (cleanInput === 'admin' || cleanInput === 'admin@happyland.co.id' || compactInput === '198809152014021001') &&
      (password === 'admin' || password === 'Dialisis2026!');

    if (isBuiltInAdmin) {
      persistRememberPreference(loginId);
      setTimeout(() => {
        setIsLoading(false);
        onLogin({
          email: 'admin@happyland.co.id',
          username: 'admin',
          name: 'Administrator Unit HD',
          role: 'Administrator Unit HD',
          shift: activeShiftName,
          shiftHours: activeShiftHours,
          nip: '19880915 201402 1 001',
          userRole: 'administrator'
        });
      }, 150);
      return;
    }

    const isBuiltInManagerial =
      (cleanInput === 'managerial' || cleanInput === 'manajemen' || cleanInput === 'manager@happyland.co.id') &&
      (password === 'managerial' || password === 'manajemen' || password === 'Dialisis2026!');

    if (isBuiltInManagerial) {
      persistRememberPreference(loginId);
      setTimeout(() => {
        setIsLoading(false);
        onLogin({
          email: 'manager@happyland.co.id',
          username: 'managerial',
          name: 'Managerial Unit Dialisis',
          role: 'Managerial (Monitoring & Audit Eksekutif)',
          shift: activeShiftName,
          shiftHours: activeShiftHours,
          nip: '-',
          userRole: 'managerial'
        });
      }, 150);
      return;
    }

    const matchedLocalNurse = findNurseByAccountInput(masterNurses, cleanInput);
    if (matchedLocalNurse) {
      if (matchedLocalNurse.accountStatus === 'nonaktif') {
        setIsLoading(false);
        setErrorMessage(
          `Akun "${matchedLocalNurse.name}" sedang dinonaktifkan oleh Administrator.`
        );
        return;
      }

      const expectedPass = matchedLocalNurse.password || '12345';
      if (password === expectedPass) {
        const resolvedRole = resolveNurseSystemAccess(matchedLocalNurse);
        const matrixScheduleToday = resolveNurseMatrixShiftForDate(
          nurseSchedules,
          { id: matchedLocalNurse.id, name: matchedLocalNurse.name },
          getCurrentIsoDateWib()
        );
        const assignedShift: ShiftName =
          matrixScheduleToday.logbookShift || matchedLocalNurse.shiftAssigned || activeShiftName;

        persistRememberPreference(loginId);
        setTimeout(() => {
          setIsLoading(false);
          onLogin({
            nurseId: matchedLocalNurse.id,
            email: matchedLocalNurse.email || `${matchedLocalNurse.username || 'perawat'}@happyland.co.id`,
            username: matchedLocalNurse.username,
            name: matchedLocalNurse.name,
            role: formatNurseRoleTitle(matchedLocalNurse.role, resolvedRole),
            shift: assignedShift,
            shiftHours: resolveShiftHours(assignedShift),
            nip: matchedLocalNurse.nip,
            userRole: resolvedRole
          });
        }, 150);
        return;
      }
    }

    // 5. Jika kedua jalur (Firebase Auth dan Fallback Lokal) gagal, tampilkan pesan error
    setIsLoading(false);
    if (lastAuthError) {
      setErrorMessage(getFirebaseErrorMessage(lastAuthError));
    } else {
      setErrorMessage('NIP / Email / ID akun atau kata sandi yang Anda masukkan tidak sesuai.');
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-4 sm:p-6 overflow-hidden select-none sm:select-auto font-sans">
      {/* Hospital Building Full-Viewport Background - Crisp & Clear Photo */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[#164e78]"
      >
        {!hasError && (
          <img
            src={bgSrc}
            alt="Gedung RS Happy Land Medical Centre Yogyakarta"
            referrerPolicy="no-referrer"
            onError={onImageError}
            className="w-full h-full object-cover object-center opacity-90 transition-opacity duration-300"
          />
        )}
        {/* Soft atmospheric overlay for high-contrast card legibility without blurring the building */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/50 via-slate-900/20 to-slate-950/40" />
      </div>

      {/* Centered Clean Flat Login Card (No Outer Shadows) */}
      <div className="relative z-10 w-full max-w-[460px] rounded-2xl bg-white/95 border border-slate-200/90 shadow-none px-7 sm:px-9 py-8 text-slate-900 transition-all">
        {/* RSHL Logo Lockup */}
        <div className="flex flex-col items-center text-center">
          <div className="p-1 flex items-center justify-center">
            <RshlLogo
              className="w-[260px] sm:w-[300px] max-w-full h-auto drop-shadow-xs"
              idPrefix="login-rshl"
            />
          </div>

          {/* Main Heading & Hospital Unit Subtitle */}
          <h1 className="mt-4 text-[21px] sm:text-[23px] font-black tracking-tight text-[#164e78] uppercase leading-tight">
            SISTEM LOGBOOK DIALISIS
          </h1>

          <div className="mt-1.5 text-xs sm:text-[13px] font-medium text-slate-600 leading-relaxed">
            <p className="font-semibold text-slate-800">Unit Hemodialisa (Dialisis)</p>
            <p>RS Happy Land Medical Centre Yogyakarta</p>
          </div>
        </div>

        {/* Inline Error Message */}
        {errorMessage && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-semibold flex items-start gap-2 shadow-2xs animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {/* Inline Forgot Password Help Box */}
        {showForgotInfo && (
          <div className="mt-4 p-3.5 rounded-xl bg-sky-50/95 border border-sky-200 text-slate-800 text-xs flex items-start justify-between gap-2 shadow-2xs animate-in fade-in">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-[#1f6a96] shrink-0 mt-0.5" />
              <span className="leading-relaxed">
                Untuk pengaturan ulang kata sandi akun, silakan hubungi{' '}
                <strong className="text-[#154f7a]">Administrator Unit Dialisis</strong> atau{' '}
                <strong className="text-[#154f7a]">Kepala Ruangan HD</strong> RS Happy Land.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowForgotInfo(false)}
              className="text-slate-400 hover:text-slate-700 cursor-pointer shrink-0 p-0.5"
              aria-label="Tutup informasi lupa kata sandi"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Email / Nomor Induk Pegawai (NIP) / ID */}
          <div className="space-y-1.5">
            <label
              htmlFor="rshl-login-nip"
              className="block text-xs font-bold text-slate-700 uppercase tracking-wider"
            >
              Email / Nomor Induk Pegawai (NIP) / ID Akun
            </label>
            <div className="relative">
              <User
                className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                strokeWidth={2}
              />
              <input
                id="rshl-login-nip"
                type="text"
                autoComplete="username"
                value={loginId}
                onChange={(e) => {
                  setLoginId(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="Masukkan Email, NIP, atau ID Akun..."
                className="w-full h-11 pl-10 pr-3.5 bg-white text-slate-900 placeholder:text-slate-400 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:border-[#1f6a96] focus:ring-2 focus:ring-[#1f6a96]/20 shadow-2xs transition-all"
              />
            </div>
          </div>

          {/* Kata Sandi */}
          <div className="space-y-1.5">
            <label
              htmlFor="rshl-login-password"
              className="block text-xs font-bold text-slate-700 uppercase tracking-wider"
            >
              Kata Sandi
            </label>

            <div className="relative">
              <Lock
                className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                strokeWidth={2}
              />
              <input
                id="rshl-login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="Masukkan kata sandi..."
                className="w-full h-11 pl-10 pr-10 bg-white text-slate-900 placeholder:text-slate-400 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:border-[#1f6a96] focus:ring-2 focus:ring-[#1f6a96]/20 shadow-2xs transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer p-1"
                aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" strokeWidth={2} />
                ) : (
                  <Eye className="w-4 h-4" strokeWidth={2} />
                )}
              </button>
            </div>

            {/* Lupa Kata Sandi? */}
            <div className="flex justify-end pt-0.5">
              <button
                type="button"
                onClick={() => setShowForgotInfo((prev) => !prev)}
                className="text-xs font-medium text-slate-500 hover:text-[#1f6a96] hover:underline transition-colors cursor-pointer"
              >
                Lupa Kata Sandi?
              </button>
            </div>
          </div>

          {/* Ingat Saya */}
          <div className="pt-0.5">
            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded-md border-slate-300 text-[#1f6a96] focus:ring-[#1f6a96]/30 accent-[#1f6a96] cursor-pointer"
              />
              <span className="text-xs font-semibold text-slate-700">Ingat Akun Saya</span>
            </label>
          </div>

          {/* MASUK Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-[#154f7a] via-[#1a5f91] to-[#1f6a96] hover:from-[#114063] hover:to-[#17557d] active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed text-white text-sm font-bold tracking-wider uppercase shadow-[0_8px_20px_rgba(23,87,130,0.28)] transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-sky-200" />
                  <span>Memproses Masuk...</span>
                </>
              ) : (
                <span>Masuk ke Sistem</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
