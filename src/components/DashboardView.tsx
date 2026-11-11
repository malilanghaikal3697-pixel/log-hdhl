import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Calendar, Cpu, RotateCcw, Stethoscope, UserCheck, Users } from 'lucide-react';
import {
  MasterBed,
  MasterDoctor,
  MasterNurse,
  MasterPatient,
  PatientHDSession,
  ShiftInfo,
  SystemAccessRole
} from '../types/dialysis.ts';
import {
  getCurrentIndonesianFullDate,
  normalizeIndonesianDateLabel
} from '../utils/dateHelpers.ts';
import { isMatchingNurse } from '../utils/nurseVerificationHelpers.ts';
import {
  getMonthLabel,
  parseIndonesianLogbookDate
} from '../utils/monthlyRecapHelpers.ts';
import { buildDashboardAnalytics } from '../utils/dashboardAnalyticsHelpers.ts';
import { resolveNurseSystemAccess } from '../utils/masterDataHelpers.ts';
import { HeaderNavTab } from './HeaderNavbar.tsx';
import { LoginUserData } from './LoginPage.tsx';

interface DashboardViewProps {
  masterNurses?: MasterNurse[];
  masterPatients?: MasterPatient[];
  masterDoctors?: MasterDoctor[];
  masterBeds?: MasterBed[];
  sessions?: PatientHDSession[];
  shiftInfo?: ShiftInfo;
  loggedInUser?: LoginUserData | null;
  userRole?: SystemAccessRole;
  onNavigateTab?: (tab: HeaderNavTab) => void;
}

const ALL_MONTHS = [
  { value: 1, label: 'Januari' },
  { value: 2, label: 'Februari' },
  { value: 3, label: 'Maret' },
  { value: 4, label: 'April' },
  { value: 5, label: 'Mei' },
  { value: 6, label: 'Juni' },
  { value: 7, label: 'Juli' },
  { value: 8, label: 'Agustus' },
  { value: 9, label: 'September' },
  { value: 10, label: 'Oktober' },
  { value: 11, label: 'November' },
  { value: 12, label: 'Desember' }
];

function computeHundredScaleCeiling(rawMax: number): number {
  if (rawMax <= 20 && rawMax > 0) return 25;
  if (rawMax <= 50 && rawMax > 20) return 50;
  if (rawMax <= 100) return 100;
  if (rawMax <= 200) return Math.ceil(rawMax / 25) * 25;
  return Math.ceil(rawMax / 50) * 50;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  masterNurses = [],
  masterPatients = [],
  masterDoctors = [],
  masterBeds = [],
  sessions = [],
  shiftInfo,
  loggedInUser,
  userRole = 'perawat_pelaksana'
}) => {
  const activeDateFormatted = shiftInfo?.date
    ? normalizeIndonesianDateLabel(shiftInfo.date)
    : getCurrentIndonesianFullDate();

  const runningDateParsed = useMemo(
    () => parseIndonesianLogbookDate(activeDateFormatted),
    [activeDateFormatted]
  );

  const [selectedMonth, setSelectedMonth] = useState<number>(() => runningDateParsed.month);
  const [selectedYear, setSelectedYear] = useState<number>(() => runningDateParsed.year);
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);
  const [syncTick, setSyncTick] = useState<number>(0);

  useEffect(() => {
    setSelectedMonth((prev) => (prev === runningDateParsed.month ? prev : runningDateParsed.month));
    setSelectedYear((prev) => (prev === runningDateParsed.year ? prev : runningDateParsed.year));
  }, [runningDateParsed.month, runningDateParsed.year]);

  useEffect(() => {
    const handleUpdate = () => setSyncTick((t) => t + 1);
    window.addEventListener('logbook_records_updated', handleUpdate);
    window.addEventListener('verification_registry_updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('logbook_records_updated', handleUpdate);
      window.removeEventListener('verification_registry_updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const isAdminOrManagerial = userRole === 'administrator' || userRole === 'managerial';

  // Resolve active logged-in staff identity
  const currentStaff = useMemo(() => {
    if (loggedInUser?.name && !isAdminOrManagerial) {
      const matched = masterNurses.find(
        (n) =>
          (loggedInUser.nurseId && n.id === loggedInUser.nurseId) ||
          isMatchingNurse(n.name, loggedInUser.name)
      );
      return {
        name: loggedInUser.name,
        nip: loggedInUser.nip || matched?.nip || '-'
      };
    }

    if (userRole === 'kepala_ruangan') {
      const karu = masterNurses.find(
        (n) => n.role === 'kepala_ruangan' || n.systemAccess === 'kepala_ruangan'
      );
      return {
        name: karu?.name || shiftInfo?.kepalaRuangan || '-',
        nip: karu?.nip || '-'
      };
    }

    if (userRole === 'pj_shift') {
      const pj = masterNurses.find(
        (n) => n.role === 'pj_shift' || n.systemAccess === 'pj_shift'
      );
      return {
        name: pj?.name || shiftInfo?.pjShift || '-',
        nip: pj?.nip || '-'
      };
    }

    const pelaksana = masterNurses.find((n) => n.role === 'perawat_pelaksana');
    return {
      name: pelaksana?.name || '-',
      nip: pelaksana?.nip || '-'
    };
  }, [loggedInUser, masterNurses, shiftInfo, userRole]);

  const analytics = useMemo(() => {
    void syncTick;
    return buildDashboardAnalytics({
      currentStaffName: currentStaff.name,
      currentStaffRole: userRole,
      masterNurses,
      masterPatients,
      sessions,
      shiftInfo,
      selectedMonth,
      selectedYear
    });
  }, [currentStaff.name, userRole, masterNurses, masterPatients, sessions, shiftInfo, selectedMonth, selectedYear, syncTick]);

  const adminMasterStats = useMemo(() => {
    const totalPatients = masterPatients.length;
    const rajalPatients = masterPatients.filter((p) => p.defaultStatus === 'rajal').length;
    const ranapPatients = masterPatients.filter((p) => p.defaultStatus === 'ranap').length;

    const totalDoctors = masterDoctors.length;
    const dpjpDoctors = masterDoctors.filter(
      (d) => d.role === 'dpjp' || d.role === 'both'
    ).length;
    const jagaDoctors = masterDoctors.filter(
      (d) => d.role === 'dokter_jaga' || d.role === 'both'
    ).length;

    // Untuk hak akses Administrator & Managerial pada halaman dashboard: hanya menghitung jumlah akun yang memiliki hak akses Kepala Ruang, PJ Shift dan Perawat Pelaksana. Akun managerial dan administrator tidak masuk dalam hitungan.
    const filteredNurses =
      userRole === 'administrator' || userRole === 'managerial'
        ? masterNurses.filter((n) => {
            const access = resolveNurseSystemAccess(n);
            return (
              access === 'kepala_ruangan' ||
              access === 'pj_shift' ||
              access === 'perawat_pelaksana'
            );
          })
        : masterNurses.filter((n) => {
            const access = resolveNurseSystemAccess(n);
            return (
              access === 'kepala_ruangan' ||
              access === 'pj_shift' ||
              access === 'perawat_pelaksana'
            );
          });

    const totalNurses = filteredNurses.length;
    const activeNurses = filteredNurses.filter((n) => n.accountStatus !== 'nonaktif').length;

    const totalMachines = masterBeds.length;
    const readyMachines = masterBeds.filter((b) => b.status === 'ready').length;
    const maintenanceMachines = masterBeds.filter((b) => b.status === 'maintenance').length;

    return {
      totalPatients,
      rajalPatients,
      ranapPatients,
      totalDoctors,
      dpjpDoctors,
      jagaDoctors,
      totalNurses,
      activeNurses,
      totalMachines,
      readyMachines,
      maintenanceMachines
    };
  }, [masterPatients, masterDoctors, masterNurses, masterBeds, userRole]);

  const availableYears = useMemo(() => {
    const baseYear = runningDateParsed.year;
    return [baseYear - 1, baseYear, baseYear + 1];
  }, [runningDateParsed.year]);

  const isViewingRunningPeriod =
    selectedMonth === analytics.runningMonth && selectedYear === analytics.runningYear;

  // Focus month on annual chart: active running month (Oktober)
  const primaryFocusMonth =
    selectedYear === analytics.runningYear ? analytics.runningMonth : 10;

  // Compute Y-axis scale for the 12-month bar chart
  const annualMaxRaw = useMemo(() => {
    return analytics.yearlySeries.reduce(
      (maxVal, item) => Math.max(maxVal, item.unitSessionsCount, item.personalSessionsCount),
      0
    );
  }, [analytics.yearlySeries]);

  const yCeiling = useMemo(() => computeHundredScaleCeiling(annualMaxRaw), [annualMaxRaw]);

  const yTicks = useMemo(
    () => [
      yCeiling,
      Math.round(yCeiling * 0.8),
      Math.round(yCeiling * 0.6),
      Math.round(yCeiling * 0.4),
      Math.round(yCeiling * 0.2),
      0
    ],
    [yCeiling]
  );

  const inspectedMonthPoint = useMemo(() => {
    const targetM = hoveredMonth ?? selectedMonth;
    return (
      analytics.yearlySeries.find((m) => m.month === targetM) ||
      analytics.yearlySeries[primaryFocusMonth - 1]
    );
  }, [analytics.yearlySeries, hoveredMonth, primaryFocusMonth, selectedMonth]);

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ===================================================================== */}
      {/* SECTION HEADER: DASHBOARD + PEMILIH PERIODE BULAN / TAHUN             */}
      {/* ===================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[19px] sm:text-[21px] font-extrabold text-[#1c3144] tracking-tight uppercase">
          DASHBOARD
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          {!isViewingRunningPeriod && (
            <button
              type="button"
              onClick={() => {
                setSelectedMonth(analytics.runningMonth);
                setSelectedYear(analytics.runningYear);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/82 hover:bg-white text-[#19588f] text-xs font-semibold border border-white/90 shadow-2xs transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Fokus Bulan Berjalan ({analytics.runningMonthLabel})</span>
            </button>
          )}

          <div className="inline-flex items-center gap-1.5 bg-white/82 backdrop-blur-xs border border-white/90 rounded-lg px-3 py-1.5 shadow-2xs">
            <Calendar className="w-3.5 h-3.5 text-[#1f6a96] shrink-0" />
            <label htmlFor="rshl-dash-month" className="sr-only">
              Pilih Bulan
            </label>
            <select
              id="rshl-dash-month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="bg-transparent text-xs font-semibold text-slate-900 focus:outline-hidden cursor-pointer"
            >
              {ALL_MONTHS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                  {selectedYear === analytics.runningYear && m.value === analytics.runningMonth
                    ? ' (Berjalan)'
                    : ''}
                </option>
              ))}
            </select>

            <span className="text-slate-300 select-none">/</span>

            <label htmlFor="rshl-dash-year" className="sr-only">
              Pilih Tahun
            </label>
            <select
              id="rshl-dash-year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-xs font-semibold text-slate-900 focus:outline-hidden cursor-pointer tabular-nums"
            >
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* BARIS 1: KARTU RINGKASAN UTAMA                                        */}
      {/* ===================================================================== */}
      {isAdminOrManagerial ? (
        <div className="space-y-4 sm:space-y-5">
          {/* Kartu Master Data Unit HD: 4 kartu untuk Administrator, 3 kartu (tanpa Jumlah Mesin) untuk Managerial */}
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 ${
              userRole === 'managerial' ? 'xl:grid-cols-3' : 'xl:grid-cols-4'
            } gap-4`}
          >
            {/* Jumlah Pasien */}
            <div className="rounded-[14px] bg-white/84 backdrop-blur-xs border border-white/90 shadow-[0_6px_18px_rgba(14,42,74,0.08)] px-5 py-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-950 leading-snug">
                  Jumlah Pasien
                </p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-slate-950 tabular-nums leading-none">
                    {adminMasterStats.totalPatients}
                  </span>
                  <span className="text-xs font-semibold text-slate-600">Pasien</span>
                </div>
                <p className="mt-2 text-xs text-slate-600 tabular-nums">
                  Rajal: <strong className="font-semibold text-slate-900">{adminMasterStats.rajalPatients}</strong> &middot; Ranap:{' '}
                  <strong className="font-semibold text-slate-900">{adminMasterStats.ranapPatients}</strong>
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#118f8d]/12 text-[#0e7876] flex items-center justify-center shrink-0">
                <Users className="w-5 h-5" />
              </div>
            </div>

            {/* Jumlah Dokter (DPJP dan Dokter Jaga Ruangan) */}
            <div className="rounded-[14px] bg-white/84 backdrop-blur-xs border border-white/90 shadow-[0_6px_18px_rgba(14,42,74,0.08)] px-5 py-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-950 leading-snug">
                  Jumlah Dokter
                </p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-slate-950 tabular-nums leading-none">
                    {adminMasterStats.totalDoctors}
                  </span>
                  <span className="text-xs font-semibold text-slate-600">Dokter</span>
                </div>
                <p className="mt-2 text-xs text-slate-600 tabular-nums">
                  DPJP: <strong className="font-semibold text-slate-900">{adminMasterStats.dpjpDoctors}</strong> &middot; Dokter Jaga:{' '}
                  <strong className="font-semibold text-slate-900">{adminMasterStats.jagaDoctors}</strong>
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-indigo-500/12 text-indigo-700 flex items-center justify-center shrink-0">
                <Stethoscope className="w-5 h-5" />
              </div>
            </div>

            {/* Jumlah Perawat */}
            <div className="rounded-[14px] bg-white/84 backdrop-blur-xs border border-white/90 shadow-[0_6px_18px_rgba(14,42,74,0.08)] px-5 py-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-950 leading-snug">
                  Jumlah Perawat
                </p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-slate-950 tabular-nums leading-none">
                    {adminMasterStats.totalNurses}
                  </span>
                  <span className="text-xs font-semibold text-slate-600">Perawat</span>
                </div>
                <p className="mt-2 text-xs text-slate-600 tabular-nums">
                  Aktif bertugas:{' '}
                  <strong className="font-semibold text-slate-900">{adminMasterStats.activeNurses}</strong> Perawat
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-500/12 text-emerald-700 flex items-center justify-center shrink-0">
                <UserCheck className="w-5 h-5" />
              </div>
            </div>

            {/* Jumlah Mesin (Khusus Administrator) */}
            {userRole === 'administrator' && (
              <div className="rounded-[14px] bg-white/84 backdrop-blur-xs border border-white/90 shadow-[0_6px_18px_rgba(14,42,74,0.08)] px-5 py-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-950 leading-snug">
                    Jumlah Mesin
                  </p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-slate-950 tabular-nums leading-none">
                      {adminMasterStats.totalMachines}
                    </span>
                    <span className="text-xs font-semibold text-slate-600">Mesin</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-600 tabular-nums">
                    Ready: <strong className="font-semibold text-slate-900">{adminMasterStats.readyMachines}</strong> &middot; Maintenance:{' '}
                    <strong className="font-semibold text-slate-900">{adminMasterStats.maintenanceMachines}</strong>
                  </p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-amber-500/12 text-amber-700 flex items-center justify-center shrink-0">
                  <Cpu className="w-5 h-5" />
                </div>
              </div>
            )}
          </div>

          {/* Kartu Jumlah Treatmen Unit HD (Rawat Jalan, Rawat Inap, dan CITO) */}
          <div className="rounded-[14px] bg-white/84 backdrop-blur-xs border border-white/90 shadow-[0_6px_18px_rgba(14,42,74,0.08)] px-6 py-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-[#22749b]/12 text-[#19588f] flex items-center justify-center shrink-0 mt-0.5">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[15px] sm:text-[16.5px] font-medium text-slate-950 leading-snug">
                  Jumlah Treatmen Unit HD ({analytics.selectedMonthLabel})
                </p>
                <div className="mt-2 flex items-baseline gap-2.5">
                  <span className="text-[34px] sm:text-[40px] font-extrabold text-slate-950 tabular-nums leading-none">
                    {analytics.unitMonthlySessions}
                  </span>
                  <span className="text-xs sm:text-sm font-semibold text-slate-600">
                    Treatmen
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-600 tabular-nums">
                  Akumulasi dari{' '}
                  <strong className="font-semibold text-slate-900">
                    {analytics.unitActiveDaysCount} hari layanan
                  </strong>{' '}
                  Unit HD
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5 sm:gap-3 shrink-0 tabular-nums">
              <div className="rounded-xl bg-sky-50/90 border border-sky-200/80 px-4 py-2.5 text-center">
                <div className="text-[11px] font-semibold text-sky-800">Rawat Jalan</div>
                <div className="mt-1 text-xl sm:text-2xl font-extrabold text-sky-950">
                  {analytics.unitMonthlyRajal}
                </div>
              </div>
              <div className="rounded-xl bg-indigo-50/90 border border-indigo-200/80 px-4 py-2.5 text-center">
                <div className="text-[11px] font-semibold text-indigo-800">Rawat Inap</div>
                <div className="mt-1 text-xl sm:text-2xl font-extrabold text-indigo-950">
                  {analytics.unitMonthlyRanap}
                </div>
              </div>
              <div className="rounded-xl bg-rose-50/90 border border-rose-200/80 px-4 py-2.5 text-center">
                <div className="text-[11px] font-semibold text-rose-800">CITO</div>
                <div className="mt-1 text-xl sm:text-2xl font-extrabold text-rose-950">
                  {analytics.unitMonthlyCito}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
          {/* Kartu 1: Jumlah Treatmen yang Dikelola Pribadi dalam Satu Bulan */}
          <div className="rounded-[14px] bg-white/84 backdrop-blur-xs border border-white/90 shadow-[0_6px_18px_rgba(14,42,74,0.08)] px-6 py-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-[15px] sm:text-[16.5px] font-medium text-slate-950 leading-snug">
                Jumlah Treatmen yang Dikelola Pribadi ({analytics.selectedMonthLabel})
              </p>
              <div className="mt-2.5 flex items-baseline gap-2.5">
                <span className="text-[34px] sm:text-[40px] font-extrabold text-slate-950 tabular-nums leading-none">
                  {analytics.personalMonthlySessions}
                </span>
                <span className="text-xs sm:text-sm font-semibold text-slate-600">
                  Treatmen
                </span>
              </div>
              <p className="mt-2.5 text-xs text-slate-600 tabular-nums">
                Akumulasi dari{' '}
                <strong className="font-semibold text-slate-900">
                  {analytics.personalVerifiedDaysCount} hari dinas
                </strong>{' '}
                terverifikasi
              </p>
            </div>

            <div className="w-11 h-11 rounded-xl bg-[#118f8d]/12 text-[#0e7876] flex items-center justify-center shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
          </div>

          {/* Kartu 2: Jumlah Treatmen Unit HD dalam Satu Bulan */}
          <div className="rounded-[14px] bg-white/84 backdrop-blur-xs border border-white/90 shadow-[0_6px_18px_rgba(14,42,74,0.08)] px-6 py-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-[15px] sm:text-[16.5px] font-medium text-slate-950 leading-snug">
                Jumlah Treatmen Unit HD ({analytics.selectedMonthLabel})
              </p>
              <div className="mt-2.5 flex items-baseline gap-2.5">
                <span className="text-[34px] sm:text-[40px] font-extrabold text-slate-950 tabular-nums leading-none">
                  {analytics.unitMonthlySessions}
                </span>
                <span className="text-xs sm:text-sm font-semibold text-slate-600">
                  Treatmen
                </span>
              </div>
              <p className="mt-2.5 text-xs text-slate-600 tabular-nums">
                Akumulasi dari{' '}
                <strong className="font-semibold text-slate-900">
                  {analytics.unitActiveDaysCount} hari layanan
                </strong>{' '}
                Unit HD
              </p>
            </div>

            <div className="w-11 h-11 rounded-xl bg-[#22749b]/12 text-[#19588f] flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* BARIS 2: GRAFIK DATA DIALISIS BULANAN (JANUARI – DESEMBER)            */}
      {/* Fokus pada bulan berjalan (Oktober)                                   */}
      {/* ===================================================================== */}
      <div className="rounded-[14px] bg-white/84 backdrop-blur-xs border border-white/90 shadow-[0_6px_18px_rgba(14,42,74,0.08)] p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-[16.5px] sm:text-[18px] font-semibold text-slate-950">
              Grafik Data Dialisis Bulanan ({analytics.selectedYear}) — Fokus Bulan{' '}
              {getMonthLabel(primaryFocusMonth)}
            </h3>
            <p className="mt-0.5 text-xs text-slate-600">
              Tren volume data dialisis setahun penuh (Januari – Desember {analytics.selectedYear})
              dengan sorotan fokus pada bulan berjalan (
              <strong className="font-semibold text-slate-800">
                {getMonthLabel(primaryFocusMonth)}
              </strong>
              ). Klik batang bulan untuk melihat angka rekap pada bulan tersebut.
            </p>
          </div>
        </div>

        {/* 12-Month Bar Chart (Januari - Desember) */}
        <div className="mt-6 overflow-x-auto pb-1">
          <div className="min-w-[600px]">
            <div className="relative h-[276px] flex">
              {/* Y-Axis Labels */}
              <div className="w-9 pr-2.5 flex flex-col justify-between text-right text-xs font-medium text-slate-800 tabular-nums select-none pb-8 pt-6">
                {yTicks.map((tick, idx) => (
                  <span key={idx} className="leading-none">
                    {tick}
                  </span>
                ))}
              </div>

              {/* Plot Grid + 12 Monthly Columns */}
              <div className="relative flex-1 flex flex-col">
                {/* Horizontal Gridlines + Left Y-axis Spine */}
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 top-6 bottom-8 border-l border-slate-400/45 flex flex-col justify-between pointer-events-none"
                >
                  {yTicks.map((_, idx) => (
                    <div
                      key={idx}
                      className={`w-full border-b ${
                        idx === yTicks.length - 1
                          ? 'border-slate-400/65'
                          : 'border-slate-400/25'
                      }`}
                    />
                  ))}
                </div>

                {/* 12 Month Columns (Jan..Des) */}
                <div className="relative z-10 flex-1 grid grid-cols-12 gap-1.5 sm:gap-2.5 px-2 items-stretch">
                  {analytics.yearlySeries.map((point) => {
                    const isPrimaryFocus = point.month === primaryFocusMonth;
                    const isSelected = point.month === selectedMonth;
                    const isHovered = hoveredMonth === point.month;

                    const unitHeightPct =
                      yCeiling > 0
                        ? Math.min(100, (point.unitSessionsCount / yCeiling) * 100)
                        : 0;
                    const personalHeightPct =
                      yCeiling > 0
                        ? Math.min(100, (point.personalSessionsCount / yCeiling) * 100)
                        : 0;

                    return (
                      <button
                        key={point.month}
                        type="button"
                        onClick={() => setSelectedMonth(point.month)}
                        onMouseEnter={() => setHoveredMonth(point.month)}
                        onMouseLeave={() => setHoveredMonth(null)}
                        onFocus={() => setHoveredMonth(point.month)}
                        onBlur={() => setHoveredMonth(null)}
                        title={`${point.fullLabel} ${analytics.selectedYear} — Treatmen Unit HD: ${point.unitSessionsCount}, Dikelola Pribadi: ${point.personalSessionsCount}`}
                        className={`group flex flex-col justify-between rounded-xl px-1 transition-colors cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[#1f6a96] ${
                          isPrimaryFocus
                            ? 'bg-[#22749b]/12 ring-1 ring-[#22749b]/45'
                            : isSelected
                            ? 'bg-slate-900/[0.06] ring-1 ring-slate-400/45'
                            : isHovered
                            ? 'bg-slate-900/[0.04]'
                            : 'bg-transparent'
                        }`}
                      >
                        {/* Top Focus Indicator */}
                        <div className="h-5 flex items-center justify-center">
                          {isPrimaryFocus ? (
                            <span className="text-[10px] font-bold text-[#19588f] tracking-tight whitespace-nowrap">
                              Fokus
                            </span>
                          ) : isSelected ? (
                            <span className="text-[10px] font-semibold text-slate-600 whitespace-nowrap">
                              Dipilih
                            </span>
                          ) : null}
                        </div>

                        {/* Bar Pair Area */}
                        <div className="flex-1 w-full flex items-end justify-center gap-1 px-0.5">
                          {/* Unit HD Bar */}
                          <div className="flex-1 max-w-[24px] h-full flex flex-col justify-end items-center">
                            {point.unitSessionsCount > 0 && (
                              <span
                                className={`mb-0.5 text-[10.5px] font-bold tabular-nums leading-none ${
                                  isPrimaryFocus
                                    ? 'text-[#19588f]'
                                    : 'text-slate-700'
                                }`}
                              >
                                {point.unitSessionsCount}
                              </span>
                            )}
                            <div
                              style={{
                                height:
                                  point.unitSessionsCount > 0
                                    ? `${Math.max(unitHeightPct, 4)}%`
                                    : '3px'
                              }}
                              className={`w-full rounded-t-[3px] transition-opacity ${
                                point.unitSessionsCount === 0
                                  ? isPrimaryFocus
                                    ? 'bg-[#22749b]/40'
                                    : 'bg-slate-300/75'
                                  : isPrimaryFocus
                                  ? 'bg-[#19588f]'
                                  : isSelected
                                  ? 'bg-[#22749b]'
                                  : 'bg-[#22749b]/75 group-hover:bg-[#22749b]'
                              }`}
                            />
                          </div>

                          {/* Personal Managed Bar */}
                          {!isAdminOrManagerial && (
                            <div className="flex-1 max-w-[24px] h-full flex flex-col justify-end items-center">
                              {point.personalSessionsCount > 0 && (
                                <span
                                  className={`mb-0.5 text-[10.5px] font-bold tabular-nums leading-none ${
                                    isPrimaryFocus
                                      ? 'text-[#0b6e6c]'
                                      : 'text-[#0e7876]'
                                  }`}
                                >
                                  {point.personalSessionsCount}
                                </span>
                              )}
                              <div
                                style={{
                                  height:
                                    point.personalSessionsCount > 0
                                      ? `${Math.max(personalHeightPct, 4)}%`
                                      : '3px'
                                }}
                                className={`w-full rounded-t-[3px] transition-opacity ${
                                  point.personalSessionsCount === 0
                                    ? isPrimaryFocus
                                      ? 'bg-[#118f8d]/40'
                                      : 'bg-slate-300/60'
                                    : isPrimaryFocus
                                    ? 'bg-[#0e8583]'
                                    : isSelected
                                    ? 'bg-[#118f8d]'
                                    : 'bg-[#118f8d]/75 group-hover:bg-[#118f8d]'
                                }`}
                              />
                            </div>
                          )}
                        </div>

                        {/* X-Axis Month Label */}
                        <div className="h-8 flex items-center justify-center">
                          <span
                            className={`text-xs whitespace-nowrap ${
                              isPrimaryFocus
                                ? 'font-extrabold text-[#19588f]'
                                : isSelected
                                ? 'font-bold text-slate-950'
                                : 'font-medium text-slate-800'
                            }`}
                          >
                            {point.shortLabel}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Focused / Hovered Month Summary Footer */}
        <div className="mt-3 pt-3 border-t border-slate-300/45 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
          <div>
            <strong className="font-bold text-slate-950">
              {inspectedMonthPoint.fullLabel} {analytics.selectedYear}
              {inspectedMonthPoint.month === primaryFocusMonth ? ' (Fokus Bulan Berjalan)' : ''}
            </strong>
            <span className="mx-1.5 text-slate-400">·</span>
            <span>
              Treatmen Unit HD:{' '}
              <strong className="font-semibold text-slate-950 tabular-nums">
                {inspectedMonthPoint.unitSessionsCount} treatmen
              </strong>
            </span>
            {!isAdminOrManagerial && (
              <>
                <span className="mx-1.5 text-slate-400">·</span>
                <span>
                  Dikelola Pribadi:{' '}
                  <strong className="font-semibold text-[#0e7876] tabular-nums">
                    {inspectedMonthPoint.personalSessionsCount} treatmen
                  </strong>
                </span>
              </>
            )}
          </div>

          <span className="text-slate-600 tabular-nums">
            Total Setahun ({analytics.selectedYear}):{' '}
            <strong className="font-semibold text-slate-900">
              {analytics.yearlyTotalUnitSessions}
            </strong>{' '}
            Treatmen Unit HD
            {!isAdminOrManagerial && (
              <>
                {' '}
                ·{' '}
                <strong className="font-semibold text-[#0e7876]">
                  {analytics.yearlyTotalPersonalSessions}
                </strong>{' '}
                Dikelola Pribadi
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
};
