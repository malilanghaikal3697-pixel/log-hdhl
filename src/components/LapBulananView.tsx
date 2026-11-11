import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  MasterNurse,
  PatientHDSession,
  ShiftInfo,
  SystemAccessRole
} from '../types/dialysis.ts';
import {
  OFFICIAL_LOGBOOK_ITEMS,
  logbookService,
  getDynamicBagianTitle
} from '../data/officialPelaksanaLogbookData.ts';
import {
  pasienLogbookService,
  type MonthlyNurseSpoMatrixReport
} from '../data/laporanPasienData.ts';
import { OfficialPelaksanaLogbookPrintable } from './OfficialPelaksanaLogbookPrintable.tsx';
import { LoginUserData } from './LoginPage.tsx';
import {
  buildAllStaffMonthlyRecap,
  parseIndonesianLogbookDate,
  getMonthLabel,
  UnitMonthlyRecapOverview
} from '../utils/monthlyRecapHelpers.ts';
import {
  getCurrentIndonesianFullDate,
  normalizeIndonesianDateLabel
} from '../utils/dateHelpers.ts';
import { isMatchingNurse } from '../utils/nurseVerificationHelpers.ts';
import { canVerifyLogbook, resolveNurseSystemAccess } from '../utils/masterDataHelpers.ts';
import { printDocumentWithOrientation, downloadElementAsPdf } from '../utils/printHelpers.ts';
import {
  Table,
  Printer,
  FileDown,
  Calendar,
  Award,
  UserCheck,
  Users,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Activity,
  Filter,
  RefreshCw,
  FileText,
  FileSpreadsheet,
  Loader2,
  Search
} from 'lucide-react';
import { exportMasterHemodialisaWorkbook } from '../utils/exportMasterSpreadsheet.ts';
import type { NurseLogbookCloudData } from '../services/firebase.ts';

interface LapBulananViewProps {
  masterNurses?: MasterNurse[];
  loggedInUser?: LoginUserData | null;
  shiftInfo?: ShiftInfo;
  userRole?: SystemAccessRole;
  sessions?: PatientHDSession[];
  cloudNurseLogbooks?: NurseLogbookCloudData[];
  onNavigateToLogbook?: () => void;
  onNavigateToVerifikasi?: () => void;
}

const BAGIAN_SECTION_HEADERS: {
  bagian: number;
  title: string;
  ruleBadge: string;
}[] = [
  {
    bagian: 1,
    title: `BAGIAN I: ${getDynamicBagianTitle(1, 'KESIAPAN FASILITAS RUANGAN & WATER TREATMENT (RO)').toUpperCase()}`,
    ruleBadge: 'Nilai = 1 (1x Aktivitas / Hari Terverifikasi PJ / Karu)'
  },
  {
    bagian: 2,
    title: `BAGIAN II: ${getDynamicBagianTitle(2, 'PERSIAPAN PERAWAT, PERALATAN, MESIN HD & ALKES (PRE-HD)').toUpperCase()}`,
    ruleBadge: 'Akumulasi Pasien Kelolaan Terverifikasi (PJ / Karu)'
  },
  {
    bagian: 3,
    title: `BAGIAN III: ${getDynamicBagianTitle(3, 'IDENTIFIKASI PASIEN, PENGKAJIAN PRE-HD & PATIENT SAFETY').toUpperCase()}`,
    ruleBadge: 'Akumulasi Pasien Kelolaan Terverifikasi (PJ / Karu)'
  },
  {
    bagian: 4,
    title: `BAGIAN IV: ${getDynamicBagianTitle(4, 'MONITORING INTRA-HD & PENCEGAHAN IKP').toUpperCase()}`,
    ruleBadge: 'Akumulasi Pasien Kelolaan Terverifikasi (PJ / Karu)'
  },
  {
    bagian: 5,
    title: `BAGIAN V: ${getDynamicBagianTitle(5, 'EDUKASI TERSTRUKTUR PASIEN & KELUARGA (KIE)').toUpperCase()}`,
    ruleBadge: 'Akumulasi Pasien Kelolaan Terverifikasi (PJ / Karu)'
  },
  {
    bagian: 6,
    title: `BAGIAN VI: ${getDynamicBagianTitle(6, 'TERMINASI AMAN, EVALUASI POST-HD, DISINFEKSI & CPPT').toUpperCase()}`,
    ruleBadge: 'Akumulasi Pasien Kelolaan Terverifikasi (PJ / Karu)'
  }
];

const INDONESIAN_MONTH_OPTIONS = [
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

const ALL_STAFF_KEY = 'ALL_STAFF';

export const LapBulananView: React.FC<LapBulananViewProps> = ({
  masterNurses = [],
  loggedInUser,
  shiftInfo,
  userRole = 'perawat_pelaksana',
  sessions = [],
  cloudNurseLogbooks = [],
  onNavigateToLogbook,
  onNavigateToVerifikasi
}) => {
  const [refreshTick, setRefreshTick] = useState<number>(0);

  const activeDateLabel = shiftInfo?.date
    ? normalizeIndonesianDateLabel(shiftInfo.date)
    : getCurrentIndonesianFullDate();

  const activeParsedDate = useMemo(
    () => parseIndonesianLogbookDate(activeDateLabel),
    [activeDateLabel]
  );

  // Month & Year state filterable by user
  const [selectedMonth, setSelectedMonth] = useState<number>(() => activeParsedDate.month);
  const [selectedYear, setSelectedYear] = useState<number>(() => activeParsedDate.year);

  const bulanTahun = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
  const monthStartIso = `${bulanTahun}-01`;
  const monthEndIso = `${bulanTahun}-31`;

  const isPelaksana = userRole === 'perawat_pelaksana';
  const isManagerial = userRole === 'managerial';

  const activeNurses = useMemo(() => {
    return masterNurses.filter(
      (n) =>
        n.accountStatus !== 'nonaktif' &&
        resolveNurseSystemAccess(n) !== 'managerial'
    );
  }, [masterNurses]);

  const loggedInNurse = useMemo(() => {
    if (!loggedInUser?.name) return null;
    return activeNurses.find((n) => isMatchingNurse(n.name, loggedInUser.name)) || null;
  }, [activeNurses, loggedInUser?.name]);

  const personalStaffName =
    loggedInNurse?.name || activeNurses[0]?.name || loggedInUser?.name || 'Perawat Pelaksana';

  // Default langsung ke perawat aktif agar matriks horizontal 1–31 (29 poin SPO) langsung dipanggil & ditampilkan
  const [selectedStaff, setSelectedStaff] = useState<string>(() => personalStaffName);

  // Guard: Perawat Pelaksana terkunci pada nama sendiri; Supervisor yang masih di placeholder diselaraskan ke staf pertama
  useEffect(() => {
    if (isPelaksana && selectedStaff !== personalStaffName) {
      setSelectedStaff(personalStaffName);
      return;
    }
    if (
      !isPelaksana &&
      selectedStaff === 'Perawat Pelaksana' &&
      personalStaffName !== 'Perawat Pelaksana'
    ) {
      setSelectedStaff(personalStaffName);
    }
  }, [isPelaksana, personalStaffName, selectedStaff]);

  const effectiveSelectedStaff = isPelaksana ? personalStaffName : selectedStaff;

  const daysArray = Array.from({ length: 31 }, (_, i) => i + 1);
  const currentMonthLabel = getMonthLabel(selectedMonth);
  const currentMonthYearTitle = `${currentMonthLabel} ${selectedYear}`;

  // Find the selected individual nurse object
  const activeNurseObject = useMemo(() => {
    if (!isPelaksana && effectiveSelectedStaff === ALL_STAFF_KEY) return null;
    const targetName = isPelaksana ? personalStaffName : effectiveSelectedStaff;
    const found = activeNurses.find((n) => isMatchingNurse(n.name, targetName));
    if (found) return found;
    return {
      id: 'nurse-selected',
      name: targetName,
      nip: loggedInUser?.nip || '-',
      role: 'perawat_pelaksana',
      systemAccess: userRole,
      accountStatus: 'aktif'
    } as MasterNurse;
  }, [isPelaksana, effectiveSelectedStaff, personalStaffName, activeNurses, loggedInUser?.nip, userRole]);

  const headNurseMaster = useMemo(() => {
    const karuName = shiftInfo?.kepalaRuangan || 'TWIS FERTILIANTI PW';
    return masterNurses.find(
      (n) => n.role === 'kepala_ruangan' || isMatchingNurse(n.name, karuName)
    );
  }, [masterNurses, shiftInfo?.kepalaRuangan]);

  // =========================================================================
  // CLOUD FIRESTORE FETCH: pasienLogbookService.getMonthlyReportByNurse(namaPerawat, bulanTahun)
  // Melacak akumulasi 29 butir kegiatan asuhan keperawatan milik perawat yang terverifikasi (PJ Shift / Ka. Ruang)
  // =========================================================================
  const [monthlyNurseReport, setMonthlyNurseReport] =
    useState<MonthlyNurseSpoMatrixReport | null>(null);
  const [patientSearchQuery, setPatientSearchQuery] = useState<string>('');
  const [patientShiftFilter, setPatientShiftFilter] = useState<'all' | 'Pagi' | 'Siang'>('all');
  const [isLoadingMonthlyCloud, setIsLoadingMonthlyCloud] = useState<boolean>(false);
  const [monthlyCloudError, setMonthlyCloudError] = useState<string | null>(null);

  const fetchMonthlyCloudData = useCallback(async () => {
    const hasImmediateData =
      Boolean(monthlyNurseReport) || sessions.length > 0 || cloudNurseLogbooks.length > 0;
    if (!hasImmediateData) {
      setIsLoadingMonthlyCloud(true);
    }
    setMonthlyCloudError(null);
    try {
      if (effectiveSelectedStaff !== ALL_STAFF_KEY && activeNurseObject?.name) {
        const report = await pasienLogbookService.getMonthlyReportByNurse(
          activeNurseObject.name,
          bulanTahun,
          {
            nipNira: activeNurseObject.nip || '-',
            nurseRole: activeNurseObject.systemAccess || 'perawat_pelaksana',
            headNurseName: headNurseMaster?.name || shiftInfo?.kepalaRuangan,
            headNurseNip: headNurseMaster?.nip
          }
        );
        setMonthlyNurseReport(report);
      } else {
        await Promise.all([
          logbookService.getVerifiedReports(monthStartIso, monthEndIso),
          pasienLogbookService.getVerifiedPatientReports(monthStartIso, monthEndIso)
        ]);
        setRefreshTick((t) => t + 1);
      }
    } catch (err) {
      console.error('Gagal mengambil laporan matriks bulanan perawat dari Cloud Firestore:', err);
      setMonthlyCloudError(
        'Gagal memuat matriks bulanan 29 poin SPO terverifikasi (PJ Shift / Ka. Ruang) dari jaringan Cloud Firestore.'
      );
    } finally {
      setIsLoadingMonthlyCloud(false);
    }
  }, [
    effectiveSelectedStaff,
    activeNurseObject,
    bulanTahun,
    headNurseMaster?.name,
    headNurseMaster?.nip,
    shiftInfo?.kepalaRuangan,
    monthStartIso,
    monthEndIso
  ]);

  useEffect(() => {
    let isMounted = true;
    void fetchMonthlyCloudData();

    let unsubNurseMatrix: (() => void) | null = null;
    let unsubUnitLogs: (() => void) | null = null;
    let unsubUnitPatients: (() => void) | null = null;

    if (effectiveSelectedStaff !== ALL_STAFF_KEY && activeNurseObject?.name) {
      unsubNurseMatrix = pasienLogbookService.subscribeMonthlyReportByNurse(
        activeNurseObject.name,
        bulanTahun,
        (report) => {
          if (!isMounted) return;
          setMonthlyNurseReport(report);
          setIsLoadingMonthlyCloud(false);
        },
        (err) => {
          console.error(
            'Subscription error pasienLogbookService.subscribeMonthlyReportByNurse:',
            err
          );
          if (!isMounted) return;
          setMonthlyCloudError(
            'Sinkronisasi real-time matriks bulanan terganggu. Klik tombol Muat Ulang.'
          );
          setIsLoadingMonthlyCloud(false);
        },
        {
          nipNira: activeNurseObject.nip || '-',
          nurseRole: activeNurseObject.systemAccess || 'perawat_pelaksana',
          headNurseName: headNurseMaster?.name || shiftInfo?.kepalaRuangan,
          headNurseNip: headNurseMaster?.nip
        }
      );
    } else {
      unsubUnitLogs = logbookService.subscribeVerifiedReports(
        monthStartIso,
        monthEndIso,
        () => {
          if (!isMounted) return;
          setRefreshTick((t) => t + 1);
          setIsLoadingMonthlyCloud(false);
        }
      );
      unsubUnitPatients = pasienLogbookService.subscribeVerifiedPatientReports(
        monthStartIso,
        monthEndIso,
        () => {
          if (!isMounted) return;
          setRefreshTick((t) => t + 1);
          setIsLoadingMonthlyCloud(false);
        }
      );
    }

    const handleLocalUpdate = () => {
      setRefreshTick((t) => t + 1);
      if (effectiveSelectedStaff !== ALL_STAFF_KEY && activeNurseObject?.name) {
        void pasienLogbookService
          .getMonthlyReportByNurse(activeNurseObject.name, bulanTahun, {
            nipNira: activeNurseObject.nip || '-',
            nurseRole: activeNurseObject.systemAccess || 'perawat_pelaksana',
            headNurseName: headNurseMaster?.name || shiftInfo?.kepalaRuangan,
            headNurseNip: headNurseMaster?.nip
          })
          .then((rep) => {
            if (isMounted) setMonthlyNurseReport(rep);
          })
          .catch(() => {});
      }
    };

    window.addEventListener('logbook_records_updated', handleLocalUpdate);
    window.addEventListener('logbook_sessions_updated', handleLocalUpdate);
    window.addEventListener('verification_registry_updated', handleLocalUpdate);
    window.addEventListener('storage', handleLocalUpdate);

    return () => {
      isMounted = false;
      if (unsubNurseMatrix) unsubNurseMatrix();
      if (unsubUnitLogs) unsubUnitLogs();
      if (unsubUnitPatients) unsubUnitPatients();
      window.removeEventListener('logbook_records_updated', handleLocalUpdate);
      window.removeEventListener('logbook_sessions_updated', handleLocalUpdate);
      window.removeEventListener('verification_registry_updated', handleLocalUpdate);
      window.removeEventListener('storage', handleLocalUpdate);
    };
  }, [
    effectiveSelectedStaff,
    activeNurseObject,
    bulanTahun,
    headNurseMaster?.name,
    headNurseMaster?.nip,
    shiftInfo?.kepalaRuangan,
    monthStartIso,
    monthEndIso,
    fetchMonthlyCloudData
  ]);

  // Enriched logbook with dailyPatientNames (merging Firestore verified data with local active sessions fallback)
  const enrichedLogbook = useMemo(() => {
    if (!monthlyNurseReport?.logbook) return null;
    const base = monthlyNurseReport.logbook;
    const targetNurseName = activeNurseObject?.name || base.nurseName;
    const resolvedDailyNames: string[][] = Array.from({ length: 31 }, (_, dayIdx) => {
      const fromCloud = base.dailyPatientNames?.[dayIdx] || [];
      if (fromCloud.length > 0) return fromCloud;

      const dayNum = dayIdx + 1;
      if (dayNum > (monthlyNurseReport.daysInMonth || 31)) return [];

      // Fallback from active nurse's sessions prop if Firestore hasn't synced yet
      if (targetNurseName && sessions && sessions.length > 0) {
        const dayPad = String(dayNum).padStart(2, '0');
        const targetDateIso = `${bulanTahun}-${dayPad}`;
        const fallbackSet = new Set<string>();
        sessions.forEach((s) => {
          const sDate = s.sessionDate || (s.date && s.date.includes(targetDateIso) ? targetDateIso : '');
          const sNurse = s.nurseInCharge || '';
          if (
            (sDate === targetDateIso || (s.date && s.date.includes(`${dayNum} `))) &&
            isMatchingNurse(sNurse, targetNurseName) &&
            s.patientName &&
            s.patientName.trim()
          ) {
            fallbackSet.add(s.patientName.trim());
          }
        });
        if (fallbackSet.size > 0) {
          return Array.from(fallbackSet);
        }
      }
      return [];
    });

    return {
      ...base,
      dailyPatientNames: resolvedDailyNames
    };
  }, [monthlyNurseReport, activeNurseObject?.name, sessions, bulanTahun]);

  // Filter individual nurse's verified patient logbook rows for the month
  const filteredIndividualVerifiedRows = useMemo(() => {
    const list = monthlyNurseReport?.verifiedRows || [];
    return list.filter((row) => {
      if (patientShiftFilter !== 'all') {
        const rowShift = (row.shift || '').toLowerCase();
        if (patientShiftFilter === 'Pagi' && !rowShift.includes('pagi')) return false;
        if (patientShiftFilter === 'Siang' && !rowShift.includes('siang')) return false;
      }
      if (patientSearchQuery.trim()) {
        const q = patientSearchQuery.toLowerCase().trim();
        const matchName = (row.namaPasien || '').toLowerCase().includes(q);
        const matchRm = (row.noRm || '').toLowerCase().includes(q);
        const matchRuang = (row.ruangKategori || '').toLowerCase().includes(q);
        const matchBed = (row.noBedMesin || '').toLowerCase().includes(q);
        const matchDate = (row.tanggal || '').toLowerCase().includes(q);
        if (!matchName && !matchRm && !matchRuang && !matchBed && !matchDate) return false;
      }
      return true;
    });
  }, [monthlyNurseReport?.verifiedRows, patientShiftFilter, patientSearchQuery]);

  // Compute Unit All-Staff Recap for supervisor / admin roles
  const unitRecap: UnitMonthlyRecapOverview = useMemo(() => {
    if (isPelaksana) {
      return {
        month: selectedMonth,
        year: selectedYear,
        monthYear: currentMonthYearTitle,
        totalActiveNurses: 0,
        totalVerifiedDutyDays: 0,
        totalVerifiedPatientsUnit: 0,
        unitOverallCompliancePct: 0,
        staffSummaries: []
      };
    }
    return buildAllStaffMonthlyRecap({
      masterNurses: activeNurses,
      shiftInfo,
      sessions,
      cloudNurseLogbooks,
      targetMonth: selectedMonth,
      targetYear: selectedYear
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isPelaksana,
    activeNurses,
    shiftInfo,
    sessions,
    cloudNurseLogbooks,
    selectedMonth,
    selectedYear,
    currentMonthYearTitle,
    refreshTick
  ]);

  const isCurrentMonthActive =
    selectedMonth === activeParsedDate.month && selectedYear === activeParsedDate.year;

  const handleResetToCurrentMonth = () => {
    setSelectedMonth(activeParsedDate.month);
    setSelectedYear(activeParsedDate.year);
  };

  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handlePrint = () => {
    const isIndiv = isPelaksana || effectiveSelectedStaff !== ALL_STAFF_KEY;
    const docTitle = isIndiv
      ? `Logbook_Bulanan_${activeNurseObject?.name || 'Perawat'}_${currentMonthYearTitle}`
      : `Rekapitulasi_Bulanan_Unit_HD_${currentMonthYearTitle}`;

    // Langsung buka dialog cetak browser tanpa mengubah tampilan layar ke format cetak
    printDocumentWithOrientation(true, docTitle);
  };

  const handleDownloadPdf = async () => {
    const isIndiv = isPelaksana || effectiveSelectedStaff !== ALL_STAFF_KEY;
    const docTitle = isIndiv
      ? `Logbook_Bulanan_${activeNurseObject?.name || 'Perawat'}_${currentMonthYearTitle}`
      : `Rekapitulasi_Bulanan_Unit_HD_${currentMonthYearTitle}`;

    setIsExportingPdf(true);
    let wrapper: HTMLElement | null = null;
    try {
      if (isIndiv) {
        wrapper = document.getElementById('printable-official-logbook-wrapper');
        if (wrapper) {
          wrapper.style.position = 'fixed';
          wrapper.style.left = '-99999px';
          wrapper.style.top = '0';
          wrapper.style.display = 'block';
          wrapper.style.zIndex = '-9999';
        }
      }

      const targetId = isIndiv ? 'printable-official-logbook' : 'printable-unit-recap';
      await downloadElementAsPdf(targetId, {
        filename: docTitle,
        isLandscape: true
      });
    } catch (err) {
      console.error('Download PDF error:', err);
    } finally {
      if (wrapper) {
        wrapper.style.position = '';
        wrapper.style.left = '';
        wrapper.style.top = '';
        wrapper.style.display = '';
        wrapper.style.zIndex = '';
      }
      setIsExportingPdf(false);
    }
  };

  const handleExportMasterSpreadsheet = () => {
    exportMasterHemodialisaWorkbook({
      shiftInfo: shiftInfo || {
        hospitalName: 'RS Happy Land Medical Centre',
        unitName: 'Instalasi Dialisis',
        date: getCurrentIndonesianFullDate(),
        shift: 'Pagi',
        shiftHours: '07.00 - 14.00 WIB',
        pjShift: 'M. Haikal Malilang, A.Md. Kep.',
        dokterDpjp: 'dr. Raden Heru Prasanto, Sp.PD-KGH',
        kepalaRuangan: 'Twis Fertilianti PW., S.Kep., Ns.',
        dokterJaga: 'dr. Paramitha',
        totalPerawatDinas: 8,
        detailPerawat: '8 Orang (1 PJ Shift + 7 Perawat Pelaksana)',
        perawatRatio: '1 : 3',
        tenagaPendukung: '1 Teknisi Elektromedis/RO, 1 HK Ruangan',
        pjShiftBerikutnya: 'Aprillia Dwi N, S.Kep., Ns.'
      },
      sessions: sessions || [],
      masterNurses: masterNurses || [],
      cloudNurseLogbooks: cloudNurseLogbooks || [],
      targetMonth: selectedMonth,
      targetYear: selectedYear
    });
  };

  const isViewingIndividualMatrix = isPelaksana || effectiveSelectedStaff !== ALL_STAFF_KEY;

  return (
    <div className="w-full max-w-[1750px] mx-auto px-2 sm:px-4 space-y-4 pb-12">
      {/* ===================================================================== */}
      {/* 1. HEADER CARD & INTEGRATED CONTROL BAR                               */}
      {/* ===================================================================== */}
      <div className="bg-white/95 rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-xs flex flex-col gap-4 print:hidden">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
              <span className="text-[#164e78] font-bold uppercase tracking-wider">
                Laporan Bulanan Hemodialisis (29 Poin SPO)
              </span>
              <span aria-hidden="true" className="text-slate-300">&middot;</span>
              <span>Basis Data: Terverifikasi PJ Shift &amp; Kepala Ruang</span>
              <span aria-hidden="true" className="text-slate-300">&middot;</span>
              <span>{shiftInfo?.hospitalName || 'RS Happy Land Medical Centre'}</span>
            </div>

            <h2 className="text-lg sm:text-xl xl:text-2xl font-black text-slate-950 tracking-tight flex flex-wrap items-center gap-2.5 leading-snug">
              <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#164e78] flex items-center justify-center shrink-0 border border-blue-100">
                <Calendar className="w-4 h-4" />
              </div>
              <span>MATRIKS REKAPITULASI BULANAN</span>
              <span className="text-base sm:text-lg font-bold text-[#164e78] font-mono">
                ({currentMonthYearTitle})
              </span>
              {isManagerial && (
                <span className="px-2.5 py-0.5 rounded-lg bg-sky-100 text-sky-800 border border-sky-300 font-bold text-xs uppercase tracking-wider">
                  Mode Audit Managerial
                </span>
              )}
            </h2>

            {isLoadingMonthlyCloud && (
              <div className="inline-flex items-center gap-1.5 text-xs text-[#164e78] font-semibold">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Menarik data Cloud Firestore...</span>
              </div>
            )}
            {monthlyCloudError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 flex flex-wrap items-center justify-between gap-2 text-xs text-rose-900 mt-1">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span className="font-semibold">{monthlyCloudError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchMonthlyCloudData()}
                  className="px-3 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-bold cursor-pointer whitespace-nowrap shrink-0"
                >
                  Coba Lagi
                </button>
              </div>
            )}
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2 self-start xl:self-center shrink-0">
            <button
              type="button"
              onClick={() => void fetchMonthlyCloudData()}
              disabled={isLoadingMonthlyCloud}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 text-xs font-bold border border-slate-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Muat ulang data bulanan dari Cloud Firestore"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMonthlyCloud ? 'animate-spin' : ''}`} />
              <span>Muat Ulang</span>
            </button>

            <button
              type="button"
              onClick={handleExportMasterSpreadsheet}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-all cursor-pointer shadow-xs whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
              <span>Master Excel (.xlsx)</span>
            </button>
          </div>
        </div>

        {/* Bottom Row: Staff Selector & Month/Year Filter Bar */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/80 rounded-xl p-3 border border-slate-200/70">
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {isPelaksana ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 shrink-0">
                  <UserCheck className="w-3.5 h-3.5 text-[#164e78]" />
                  <span>Nama Perawat:</span>
                </span>
                <div className="bg-white border border-blue-200 text-slate-900 font-bold text-xs rounded-lg px-3 py-1.5 flex items-center gap-2 shadow-2xs">
                  <span className="text-[#164e78] font-bold">{personalStaffName}</span>
                  <span aria-hidden="true" className="text-slate-300">&middot;</span>
                  <span className="text-[11px] font-medium text-slate-600">Akun Mandiri</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0 sm:min-w-[260px] flex-1 sm:flex-initial max-w-full">
                <label
                  htmlFor="select-staff"
                  className="text-xs font-bold text-slate-700 flex items-center gap-1.5 shrink-0"
                >
                  <UserCheck className="w-3.5 h-3.5 text-[#164e78]" />
                  <span>Pilih Perawat:</span>
                </label>
                <select
                  id="select-staff"
                  value={selectedStaff}
                  onChange={(e) => {
                    setSelectedStaff(e.target.value);
                  }}
                  className="bg-white border border-slate-300 text-slate-900 font-semibold text-xs rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-[#164e78]/30 focus:border-[#164e78] focus:outline-hidden w-full cursor-pointer shadow-2xs transition-all"
                >
                  <optgroup label="Matriks 1–31 Perawat (29 Poin SPO Terverifikasi)">
                    {activeNurses.map((nurse) => {
                      const nurseRecap = unitRecap.staffSummaries.find(
                        (s) => s.nurseName === nurse.name
                      );
                      const verifiedDays = nurseRecap?.verifiedDaysCount || 0;
                      const verifiedPats = nurseRecap?.totalVerifiedPatients || 0;
                      const roleTag =
                        nurse.role === 'kepala_ruangan'
                          ? '[Ka. Ruangan]'
                          : nurse.role === 'pj_shift'
                          ? '[PJ Shift]'
                          : '[Pelaksana]';
                      return (
                        <option key={nurse.id} value={nurse.name}>
                          {roleTag} {nurse.name} — ({verifiedDays} Hari | {verifiedPats} Pasien)
                        </option>
                      );
                    })}
                  </optgroup>
                  <optgroup label="Ringkasan Unit">
                    <option value={ALL_STAFF_KEY}>
                      Rekapitulasi Seluruh Staf (Unit Hemodialisis)
                    </option>
                  </optgroup>
                </select>
              </div>
            )}

            {!isPelaksana && selectedStaff !== ALL_STAFF_KEY && (
              <button
                type="button"
                onClick={() => setSelectedStaff(ALL_STAFF_KEY)}
                className="text-xs font-bold text-[#164e78] hover:text-[#0e3553] bg-blue-50/80 hover:bg-blue-100/80 border border-blue-200/80 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Rekap Semua Staf</span>
              </button>
            )}
          </div>

          {/* Month & Year Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 shadow-2xs tabular-nums">
              <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                aria-label="Pilih Bulan Rekapitulasi"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="text-xs font-bold text-slate-800 bg-transparent border-none py-0.5 px-1 focus:ring-0 focus:outline-hidden cursor-pointer"
              >
                {INDONESIAN_MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <span className="text-slate-300 font-bold">/</span>
              <select
                aria-label="Pilih Tahun Rekapitulasi"
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="text-xs font-bold text-slate-800 bg-transparent border-none py-0.5 px-1 focus:ring-0 focus:outline-hidden cursor-pointer"
              >
                <option value={2025}>2025</option>
                <option value={2026}>2026</option>
                <option value={2027}>2027</option>
              </select>
            </div>

            {!isCurrentMonthActive && (
              <button
                type="button"
                onClick={handleResetToCurrentMonth}
                title="Kembali ke bulan berjalan saat ini"
                className="text-xs font-semibold text-slate-700 hover:text-[#164e78] bg-white hover:bg-slate-50 border border-slate-300 px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Bulan Ini</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 2. VIEW UNIT OVERVIEW (OPSIONAL JIKA SUPERVISOR MEMILIH SEMUA STAF)    */}
      {/* ===================================================================== */}
      {!isPelaksana && effectiveSelectedStaff === ALL_STAFF_KEY && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 tabular-nums">
            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Total Tenaga Perawat
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                  {unitRecap.totalActiveNurses}{' '}
                  <span className="text-xs font-semibold text-slate-500 font-sans">Orang</span>
                </div>
                <div className="text-[11px] text-slate-500 leading-snug mt-0.5">
                  Unit Dialisis &middot; Terjadwal
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0 border border-indigo-100">
                <Users className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Hari Dinas Disahkan
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                  {unitRecap.totalVerifiedDutyDays}{' '}
                  <span className="text-xs font-semibold text-slate-500 font-sans">Hari Kerja</span>
                </div>
                <div className="text-[11px] text-[#164e78] font-semibold leading-snug mt-0.5">
                  Periode {unitRecap.monthYear}
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-blue-50 text-[#164e78] flex items-center justify-center shrink-0 border border-blue-100">
                <Calendar className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Pasien HD Terverifikasi
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                  {unitRecap.totalVerifiedPatientsUnit}{' '}
                  <span className="text-xs font-semibold text-slate-500 font-sans">Pasien</span>
                </div>
                <div className="text-[11px] text-emerald-700 font-semibold leading-snug mt-0.5">
                  Terverifikasi PJ Shift &amp; Ka. Ruang
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Kepatuhan SPO Unit HD
                </div>
                <div className="text-xl sm:text-2xl font-black text-emerald-800 mt-1 font-mono">
                  {unitRecap.unitOverallCompliancePct}%
                </div>
                <div className="text-[11px] text-slate-500 leading-snug mt-0.5">
                  Standar Akreditasi KARS
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                <Award className="w-5 h-5" />
              </div>
            </div>
          </div>

          <div
            id="printable-unit-recap"
            className="printable-sheet bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden print:border-none print:shadow-none print:rounded-none"
          >
            <div className="px-5 py-4 bg-slate-50/90 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 print:hidden">
              <div>
                <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#164e78]" />
                  <span>Daftar Rekapitulasi Capaian Logbook Seluruh Perawat ({unitRecap.monthYear})</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Klik tombol Buka Matriks pada baris perawat untuk membuka tabel matriks 1–31 horizontal (29 Poin SPO).
                </p>
              </div>
            </div>

            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-left text-xs border-collapse tabular-nums">
                <thead>
                  <tr className="bg-[#164e78] text-white font-bold text-center text-[11px] uppercase tracking-wider">
                    <th className="p-3 border-r border-[#1e5d8e] w-12 text-center">NO</th>
                    <th className="p-3 border-r border-[#1e5d8e] text-left min-w-[210px]">NAMA PERAWAT &amp; NIP</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-36 text-center">JABATAN</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-28 text-center">HARI DISAHKAN</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-32 text-center">PASIEN KELOLAAN</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-32 text-center">NILAI SPO / MAKS</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-28 text-center">% CAPAIAN</th>
                    <th className="p-3 w-36 text-center print:hidden">AKSI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-800">
                  {unitRecap.staffSummaries.map((staff, idx) => {
                    const hasVerified = staff.verifiedDaysCount > 0 || staff.totalVerifiedPatients > 0;
                    return (
                      <tr
                        key={staff.nurseId || idx}
                        className={
                          idx % 2 === 1
                            ? 'bg-slate-50/60 hover:bg-blue-50/50 transition-colors'
                            : 'bg-white hover:bg-blue-50/50 transition-colors'
                        }
                      >
                        <td className="p-3 text-center font-mono text-slate-500 font-semibold border-r border-slate-200">
                          {idx + 1}
                        </td>
                        <td className="p-3 border-r border-slate-200">
                          <div className="font-bold text-slate-950 text-xs">{staff.nurseName}</div>
                          <div className="text-[11px] text-slate-500 font-mono mt-0.5">NIP: {staff.nurseNip}</div>
                        </td>
                        <td className="p-3 text-center border-r border-slate-200 font-semibold text-slate-700">
                          {staff.role === 'kepala_ruangan'
                            ? 'Kepala Ruangan'
                            : staff.role === 'pj_shift'
                            ? 'PJ Shift'
                            : 'Perawat Pelaksana'}
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-slate-900 border-r border-slate-200">
                          {hasVerified ? `${staff.verifiedDaysCount} Hari` : '0 Hari'}
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-slate-900 border-r border-slate-200">
                          {hasVerified ? `${staff.totalVerifiedPatients} Pasien` : '0 Pasien'}
                        </td>
                        <td className="p-3 text-center font-mono border-r border-slate-200">
                          {hasVerified ? `${staff.grandTotalScore} / ${staff.grandMaxScore}` : '-'}
                        </td>
                        <td className="p-3 text-center font-mono font-bold border-r border-slate-200">
                          {hasVerified ? `${staff.overallCompliancePct}%` : '-'}
                        </td>
                        <td className="p-3 text-center print:hidden">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedStaff(staff.nurseName);
                            }}
                            className="px-3 py-1.5 bg-[#164e78] hover:bg-[#103b5b] text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 w-full cursor-pointer shadow-2xs whitespace-nowrap"
                          >
                            <span>Buka Matriks 1–31</span>
                            <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 3. MATRIKS HORIZONTAL TANGGAL 1 S/D 31 (29 POIN KEGIATAN SPO)         */}
      {/* Hasil pemetaan pasienLogbookService.getMonthlyReportByNurse(...)      */}
      {/* ===================================================================== */}
      {isViewingIndividualMatrix && (
        <div className="space-y-4">
          {isLoadingMonthlyCloud && !monthlyNurseReport ? (
            /* Loading Skeleton State saat menarik matriks 1-31 dari Cloud Firestore */
            <div className="space-y-4 animate-pulse print:hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="bg-white p-4 rounded-xl border border-slate-200 h-24" />
                ))}
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <div className="h-5 w-80 bg-slate-200 rounded" />
                {Array.from({ length: 8 }).map((_, rIdx) => (
                  <div key={rIdx} className="h-7 bg-slate-100 rounded" />
                ))}
              </div>
            </div>
          ) : monthlyNurseReport ? (
            <>
              {/* Individual Nurse KPI Metric Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 tabular-nums print:hidden">
                <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex flex-col justify-between gap-3 shadow-xs min-h-[110px]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Perawat Pelaksana Asuhan
                      </div>
                      <div className="text-base sm:text-lg font-black text-slate-950 mt-1 leading-snug break-words">
                        {monthlyNurseReport.logbook.nurseName}
                      </div>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0 border border-indigo-100">
                      <UserCheck className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="text-[11.5px] text-slate-500 leading-snug pt-2 border-t border-slate-100">
                    {monthlyNurseReport.roleLabel} &middot; NIP: {monthlyNurseReport.logbook.nipNira}
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex flex-col justify-between gap-3 shadow-xs min-h-[110px]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Hari Dinas Disahkan
                      </div>
                      <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                        {monthlyNurseReport.verifiedDaysCount}{' '}
                        <span className="text-xs font-semibold text-slate-500 font-sans">Hari Kerja</span>
                      </div>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#164e78] flex items-center justify-center shrink-0 border border-blue-100">
                      <Calendar className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="text-[11.5px] text-[#164e78] font-semibold leading-snug pt-2 border-t border-slate-100">
                    Periode {monthlyNurseReport.logbook.monthYear}
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex flex-col justify-between gap-3 shadow-xs min-h-[110px]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Pasien Terverifikasi
                      </div>
                      <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                        {monthlyNurseReport.totalVerifiedPatientsInMonth}{' '}
                        <span className="text-xs font-semibold text-slate-500 font-sans">Pasien</span>
                      </div>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                      <Users className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="text-[11.5px] text-emerald-700 font-semibold leading-snug pt-2 border-t border-slate-100">
                    Status: verified_pj / verified_karu
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex flex-col justify-between gap-3 shadow-xs min-h-[110px]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Akumulasi 29 Poin SPO
                      </div>
                      <div className="text-xl sm:text-2xl font-black text-emerald-800 mt-1 font-mono">
                        {monthlyNurseReport.overallCompliancePct}%
                      </div>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                      <Award className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="text-[11.5px] text-slate-500 font-mono leading-snug pt-2 border-t border-slate-100">
                    Nilai: {monthlyNurseReport.grandTotalScore} / {monthlyNurseReport.grandMaxScore}
                  </div>
                </div>
              </div>

              {/* Informational Banner if No verified Days in This Month (disembunyikan untuk Managerial) */}
              {!isManagerial && monthlyNurseReport.verifiedDaysCount === 0 && !isLoadingMonthlyCloud && (
                <div className="bg-amber-50/60 rounded-2xl border border-amber-200 p-4 sm:p-5 shadow-2xs space-y-3 print:hidden">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <div className="space-y-1 flex-1">
                      <h3 className="text-sm font-bold text-amber-950">
                        Belum Ada Data Terverifikasi untuk {monthlyNurseReport.logbook.nurseName} pada Periode {currentMonthYearTitle}
                      </h3>
                      <p className="text-xs text-amber-900/90 leading-relaxed">
                        Tabel matriks horizontal 1–31 di bawah ini melacak akumulasi 29 poin kegiatan asuhan keperawatan milik perawat yang telah diverifikasi oleh Penanggung Jawab (PJ) Shift atau disahkan oleh Kepala Ruang di Cloud Firestore.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {canVerifyLogbook(userRole) && onNavigateToVerifikasi && (
                      <button
                        type="button"
                        onClick={onNavigateToVerifikasi}
                        className="px-3.5 py-1.5 bg-[#164e78] hover:bg-[#103b5b] text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Buka Halaman Verifikasi</span>
                      </button>
                    )}
                    {onNavigateToLogbook && (
                      <button
                        type="button"
                        onClick={onNavigateToLogbook}
                        className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-500" />
                        <span>Buka Input Logbook</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Dokumen Resmi Cetak A4 Landscape (Otomatis tercetak saat klik 'Cetak' tanpa mengubah tampilan layar) */}
              <div id="printable-official-logbook-wrapper" className="hidden print:block">
                <OfficialPelaksanaLogbookPrintable logbook={enrichedLogbook || monthlyNurseReport.logbook} />
              </div>

              {/* Large Horizontal 1-31 Matrix Table Container (29 SPO Items) */}
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden print:hidden">
                <div className="px-5 py-3.5 bg-slate-50/90 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                      <Table className="w-4 h-4 text-[#164e78]" />
                      <span>
                        Matriks Akumulasi 29 Poin Kegiatan SPO — Tanggal 1 s/d 31 ({monthlyNurseReport.logbook.monthYear})
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Perawat: <strong>{monthlyNurseReport.logbook.nurseName}</strong> &middot; Menghitung kegiatan yang telah diverifikasi PJ Shift maupun Kepala Ruang (<strong>verified_pj / verified_karu</strong>).
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={handlePrint}
                          className="px-3 py-1.5 bg-[#164e78] hover:bg-[#103b5b] text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs"
                        >
                          <Printer className="w-3.5 h-3.5 shrink-0" />
                          <span>Cetak</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadPdf}
                          disabled={isExportingPdf}
                          className="px-3 py-1.5 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs"
                        >
                          <FileDown className="w-3.5 h-3.5 shrink-0" />
                          <span>{isExportingPdf ? 'Mengunduh...' : 'Simpan PDF'}</span>
                        </button>
                      </div>
                    </div>

                    {/* 31-Day Horizontal Matrix Table */}
                    <div className="overflow-x-auto max-h-[760px] relative scrollbar-thin">
                      <table className="w-full text-left text-xs border-collapse tabular-nums table-fixed">
                        <thead className="sticky top-0 z-20 shadow-xs">
                          <tr className="bg-[#164e78] text-white font-bold text-center text-[10.5px]">
                            <th
                              rowSpan={2}
                              className="p-2 border-r border-[#1e5d8e] w-[46px] min-w-[46px] max-w-[46px] sticky left-0 z-30 bg-[#164e78] text-center"
                            >
                              POIN
                            </th>
                            <th
                              rowSpan={2}
                              className="p-2 border-r border-[#1e5d8e] w-[110px] min-w-[110px] max-w-[110px] text-left sticky left-[46px] z-30 bg-[#164e78]"
                            >
                              FASE ASUHAN
                            </th>
                            <th
                              rowSpan={2}
                              className="p-2 border-r-2 border-[#1e5d8e] w-[260px] min-w-[260px] max-w-[260px] text-left sticky left-[156px] z-30 bg-[#164e78] shadow-[3px_0_6px_rgba(0,0,0,0.14)]"
                            >
                              URAIAN 29 BUTIR KEGIATAN (SPO)
                            </th>
                            <th
                              colSpan={31}
                              className="p-1.5 border-b border-[#1e5d8e] text-[10px] uppercase font-bold tracking-wider bg-[#1a5b8c] text-white"
                            >
                              TANGGAL 1 SAMPAI 31 HORIZONTAL (TERVERIFIKASI PJ / KARU) — {monthlyNurseReport.logbook.monthYear.toUpperCase()}
                            </th>
                            <th
                              rowSpan={2}
                              className="p-2 border-l border-[#1e5d8e] w-[54px] min-w-[54px] max-w-[54px] text-center bg-[#164e78]"
                            >
                              TOTAL
                            </th>
                            <th
                              rowSpan={2}
                              className="p-2 border-l border-[#1e5d8e] w-[54px] min-w-[54px] max-w-[54px] text-center bg-[#164e78]"
                            >
                              MAKS
                            </th>
                            <th
                              rowSpan={2}
                              className="p-2 border-l border-[#1e5d8e] w-[54px] min-w-[54px] max-w-[54px] text-center bg-[#164e78]"
                            >
                              %
                            </th>
                          </tr>

                          {/* Row 2: Horizontal Columns Date 1 to 31 */}
                          <tr className="bg-[#1a5b8c] text-white font-bold text-[9.5px] text-center">
                            {daysArray.map((day, idx) => {
                              const isOutOfMonth = day > monthlyNurseReport.daysInMonth;
                              const isActiveDay =
                                !isOutOfMonth && day === activeParsedDate.day && isCurrentMonthActive;
                              const isVerifiedDay =
                                !isOutOfMonth && Boolean(monthlyNurseReport.logbook.verifiedDays?.[idx]);
                              return (
                                <th
                                  key={day}
                                  title={
                                    isOutOfMonth
                                      ? `Tidak ada tanggal ${day} pada periode ${monthlyNurseReport.logbook.monthYear}`
                                      : `Tanggal ${day} ${monthlyNurseReport.logbook.monthYear}`
                                  }
                                  className={`p-1 border-r border-[#226ca4] w-[34px] min-w-[34px] max-w-[34px] font-mono ${
                                    isOutOfMonth
                                      ? 'bg-slate-900/60 text-slate-500'
                                      : isActiveDay
                                      ? 'bg-cyan-400 text-slate-950 font-black ring-2 ring-inset ring-white'
                                      : isVerifiedDay
                                      ? 'bg-[#246ea3] text-white'
                                      : 'text-slate-200'
                                  }`}
                                >
                                  {day}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>

                        <tbody className="divide-y divide-slate-200 text-[11px] text-slate-800">
                          {/* Reference Row: Verified Patients per Day (1..31) */}
                          <tr className="bg-indigo-50/80 font-bold text-indigo-950 group">
                            <td
                              colSpan={3}
                              className="px-3 py-2 border-r-2 border-indigo-200 sticky left-0 bg-indigo-50/95 group-hover:bg-indigo-100 z-10 text-[10.5px] uppercase tracking-wider font-bold shadow-[3px_0_6px_rgba(0,0,0,0.06)]"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[#164e78] font-black">Pasien Kelolaan Terverifikasi</span>
                                <span className="text-[10px] text-indigo-700 font-semibold lowercase tracking-normal">(sesi harian disahkan)</span>
                              </div>
                            </td>
                            {daysArray.map((day, dayIdx) => {
                              const pCount =
                                monthlyNurseReport.logbook.dailyVerifiedPatientCounts?.[dayIdx] || 0;
                              const isVerif =
                                Boolean(monthlyNurseReport.logbook.verifiedDays?.[dayIdx]) &&
                                pCount > 0;
                              const isOutOfMonth = day > monthlyNurseReport.daysInMonth;
                              return (
                                <td
                                  key={day}
                                  className={`p-1 text-center font-mono border-r border-slate-200 w-[34px] min-w-[34px] max-w-[34px] text-[11px] ${
                                    isOutOfMonth
                                      ? 'bg-slate-100/60 text-slate-300'
                                      : isVerif
                                      ? 'bg-indigo-100/90 text-indigo-950 font-black'
                                      : 'text-slate-300'
                                  }`}
                                >
                                  {isOutOfMonth ? '·' : isVerif ? pCount : ''}
                                </td>
                              );
                            })}
                            <td className="p-2 text-center font-mono font-black text-indigo-950 border-l border-slate-200 w-[54px] min-w-[54px] max-w-[54px]">
                              {monthlyNurseReport.totalVerifiedPatientsInMonth}
                            </td>
                            <td
                              colSpan={2}
                              className="p-2 text-center text-[10px] font-bold text-indigo-900 border-l border-slate-200"
                            >
                              Pasien Disahkan
                            </td>
                          </tr>

                          {/* Grouped 29 SPO Items (1.1 through 6.5) */}
                          {BAGIAN_SECTION_HEADERS.map((sec) => {
                            const sectionItems = OFFICIAL_LOGBOOK_ITEMS.filter(
                              (it) => it.bagian === sec.bagian
                            );

                            return (
                              <React.Fragment key={sec.bagian}>
                                <tr className="bg-slate-100/95 text-slate-900 font-bold">
                                  <td
                                    colSpan={3}
                                    className="px-3 py-2 text-[10.5px] uppercase tracking-wider sticky left-0 bg-slate-100/95 z-10 border-r-2 border-slate-300 shadow-[3px_0_6px_rgba(0,0,0,0.06)]"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-extrabold text-[#164e78]">{sec.title}</span>
                                      <span className="font-semibold text-slate-600 text-[10px] normal-case tracking-normal">
                                        {sec.ruleBadge}
                                      </span>
                                    </div>
                                  </td>
                                  <td colSpan={34} className="bg-slate-100/95 border-b border-slate-200" />
                                </tr>

                                {sectionItems.map((item, idx) => {
                                  const scoreArr =
                                    monthlyNurseReport.logbook.dailyScores?.[item.code] || [];
                                  const stat = monthlyNurseReport.itemStats[item.code] || {
                                    totalScore: 0,
                                    maxScore: 0,
                                    pct: 0
                                  };

                                  return (
                                    <tr
                                      key={item.code}
                                      className={`group transition-colors ${
                                        idx % 2 === 1
                                          ? 'bg-slate-50/50 hover:bg-blue-50/40'
                                          : 'bg-white hover:bg-blue-50/40'
                                      }`}
                                    >
                                      <td className={`px-2 py-1.5 text-center font-mono font-bold text-slate-900 border-r border-slate-200 w-[46px] min-w-[46px] max-w-[46px] sticky left-0 z-10 ${idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'} group-hover:bg-blue-50/70`}>
                                        {item.code}
                                      </td>
                                      <td className={`px-2 py-1.5 font-bold text-slate-800 border-r border-slate-200 w-[110px] min-w-[110px] max-w-[110px] sticky left-[46px] z-10 ${idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'} group-hover:bg-blue-50/70 leading-snug text-[10px] truncate`}>
                                        {item.category}
                                      </td>
                                      <td className={`px-3 py-1.5 text-slate-700 border-r-2 border-slate-200 w-[260px] min-w-[260px] max-w-[260px] text-[11px] leading-tight sticky left-[156px] z-10 ${idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'} group-hover:bg-blue-50/70 shadow-[3px_0_6px_rgba(0,0,0,0.06)]`}>
                                        {item.description}
                                      </td>

                                      {/* Horizontal Date Columns 1 to 31 */}
                                      {daysArray.map((day, dayIdx) => {
                                        const isOutOfMonth = day > monthlyNurseReport.daysInMonth;
                                        const val = scoreArr[dayIdx];
                                        const isVerif =
                                          val !== null &&
                                          val !== undefined &&
                                          Boolean(monthlyNurseReport.logbook.verifiedDays?.[dayIdx]);
                                        const maxCell =
                                          monthlyNurseReport.logbook.dailyItemMaxScores?.[item.code]?.[
                                            dayIdx
                                          ] ??
                                          (item.bagian === 1
                                            ? 1
                                            : monthlyNurseReport.logbook
                                                .dailyVerifiedPatientCounts?.[dayIdx] || 0);

                                        const cellColor = isOutOfMonth
                                          ? 'bg-slate-100/50 text-slate-300'
                                          : !isVerif
                                          ? 'text-slate-300'
                                          : val === 0 && maxCell === 0
                                          ? 'bg-slate-50 text-slate-400 font-semibold'
                                          : val === maxCell && maxCell > 0
                                          ? 'bg-emerald-50 text-emerald-900 font-bold'
                                          : (val ?? 0) > 0
                                          ? 'bg-amber-50 text-amber-900 font-bold'
                                          : 'bg-rose-50/70 text-rose-700 font-semibold';

                                        return (
                                          <td
                                            key={day}
                                            className={`p-1 text-center font-mono border-r border-slate-200 w-[34px] min-w-[34px] max-w-[34px] text-[11px] ${cellColor}`}
                                            title={
                                              isOutOfMonth
                                                ? undefined
                                                : isVerif
                                                ? `Tanggal ${day}: Poin ${item.code} = ${val} dari ${maxCell} (terverifikasi)`
                                                : undefined
                                            }
                                          >
                                            {isOutOfMonth ? '·' : isVerif ? val : ''}
                                          </td>
                                        );
                                      })}

                                      <td className="p-2 text-center font-mono font-bold text-slate-900 border-l border-slate-200 w-[54px] min-w-[54px] max-w-[54px]">
                                        {stat.totalScore}
                                      </td>
                                      <td className="p-2 text-center font-mono text-slate-500 border-l border-slate-200 w-[54px] min-w-[54px] max-w-[54px]">
                                        {stat.maxScore}
                                      </td>
                                      <td
                                        className={`p-2 text-center font-mono font-bold border-l border-slate-200 w-[54px] min-w-[54px] max-w-[54px] ${
                                          stat.maxScore === 0
                                            ? 'text-slate-400'
                                            : stat.pct === 100
                                            ? 'text-emerald-700'
                                            : stat.pct >= 75
                                            ? 'text-amber-700'
                                            : 'text-rose-700'
                                        }`}
                                      >
                                        {stat.pct}%
                                      </td>
                                    </tr>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })}

                          {/* Sticky Footer Sums across 1..31 */}
                          <tr className="bg-slate-100 text-slate-950 font-bold text-center border-t-2 border-slate-300 text-[10.5px] sticky bottom-0 z-20 shadow-xs">
                            <td
                              colSpan={3}
                              className="px-3 py-2.5 border-r-2 border-slate-300 text-right uppercase tracking-wider font-black sticky left-0 bg-slate-100 z-30 shadow-[3px_0_6px_rgba(0,0,0,0.06)]"
                            >
                              TOTAL AKUMULASI 29 POIN SPO (VERIFIED_KARU)
                            </td>
                            {daysArray.map((day, dayIdx) => {
                              const isOutOfMonth = day > monthlyNurseReport.daysInMonth;
                              const daySum = monthlyNurseReport.dailyTotalScores[dayIdx];
                              const dayMax = monthlyNurseReport.dailyMaxScores[dayIdx];
                              const hasDay =
                                daySum !== null && daySum !== undefined && !isOutOfMonth;
                              return (
                                <td
                                  key={dayIdx}
                                  className={`p-1 border-r border-slate-300 font-mono w-[34px] min-w-[34px] max-w-[34px] ${
                                    isOutOfMonth
                                      ? 'bg-slate-200/50 text-slate-400'
                                      : hasDay
                                      ? 'bg-emerald-50 text-slate-950 font-black'
                                      : 'text-slate-300'
                                  }`}
                                  title={
                                    hasDay
                                      ? `Total Harian Tanggal ${day}: ${daySum} / ${dayMax}`
                                      : undefined
                                  }
                                >
                                  {isOutOfMonth ? '·' : hasDay ? daySum : ''}
                                </td>
                              );
                            })}
                            <td className="p-2 border-l border-slate-300 font-mono font-black text-[#164e78] text-xs w-[54px] min-w-[54px] max-w-[54px]">
                              {monthlyNurseReport.grandTotalScore}
                            </td>
                            <td className="p-2 border-l border-slate-300 font-mono font-bold text-slate-600 text-xs w-[54px] min-w-[54px] max-w-[54px]">
                              {monthlyNurseReport.grandMaxScore}
                            </td>
                            <td className="p-2 border-l border-slate-300 font-mono font-black text-emerald-800 text-xs w-[54px] min-w-[54px] max-w-[54px]">
                              {monthlyNurseReport.overallCompliancePct}%
                            </td>
                          </tr>

                          {/* Row Paling Bawah: Ringkasan Pasien Kelolaan Per Tanggal (1..31) */}
                          <tr className="bg-sky-50/90 text-slate-900 border-t-2 border-sky-300/80 group">
                            <td
                              colSpan={3}
                              className="px-3 py-2.5 border-r-2 border-sky-200 sticky left-0 bg-sky-50/95 group-hover:bg-sky-100/90 z-10 text-[10px] uppercase tracking-wider font-extrabold text-[#164e78] shadow-[3px_0_6px_rgba(0,0,0,0.06)]"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-black">PASIEN KELOLAAN</span>
                                <span className="text-[10px] text-sky-800 font-semibold normal-case tracking-normal">
                                  Sesi disahkan per tanggal
                                </span>
                              </div>
                            </td>
                            {daysArray.map((day, dayIdx) => {
                              const isOutOfMonth = day > monthlyNurseReport.daysInMonth;
                              const patNames =
                                enrichedLogbook?.dailyPatientNames?.[dayIdx] ||
                                monthlyNurseReport.logbook.dailyPatientNames?.[dayIdx] ||
                                [];
                              const hasPats = patNames.length > 0 && !isOutOfMonth;

                              return (
                                <td
                                  key={day}
                                  className={`p-1 border-r border-slate-200 text-center w-[34px] min-w-[34px] max-w-[34px] ${
                                    isOutOfMonth
                                      ? 'bg-slate-100/60 text-slate-300'
                                      : hasPats
                                      ? 'bg-sky-100/70 text-sky-950 font-bold'
                                      : 'text-slate-300'
                                  }`}
                                  title={
                                    hasPats
                                      ? `Pasien Tanggal ${day} (${patNames.length} Pasien):\n• ${patNames.join('\n• ')}`
                                      : undefined
                                  }
                                >
                                  {isOutOfMonth ? (
                                    '·'
                                  ) : hasPats ? (
                                    <div className="flex flex-col items-center justify-center gap-0.5 py-0.5">
                                      <span className="inline-flex items-center justify-center w-6 h-5 rounded bg-sky-700 text-white font-mono text-[9.5px] font-bold shadow-2xs leading-none cursor-help">
                                        {patNames.length}
                                      </span>
                                    </div>
                                  ) : (
                                    '-'
                                  )}
                                </td>
                              );
                            })}
                            <td
                              colSpan={3}
                              className="p-2 text-center text-[10.5px] font-black text-[#164e78] border-l border-slate-300 bg-sky-100/50"
                            >
                              {Math.max(
                                monthlyNurseReport.totalVerifiedPatientsInMonth,
                                daysArray.reduce(
                                  (acc, _, dIdx) =>
                                    acc +
                                    (enrichedLogbook?.dailyPatientNames?.[dIdx]?.length ||
                                      monthlyNurseReport.logbook.dailyPatientNames?.[dIdx]?.length ||
                                      0),
                                  0
                                )
                              )}{' '}
                              Sesi
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* DAFTAR LOGBOOK PASIEN KELOLAAN TERVERIFIKASI BULAN INI */}
                  <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden print:hidden">
                    <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/70 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-5 h-5 text-emerald-600" />
                          <h4 className="text-sm sm:text-base font-black text-slate-900 tracking-tight">
                            Daftar Logbook Pasien Kelolaan Terverifikasi ({monthlyNurseReport.verifiedRows?.length || 0} Pasien)
                          </h4>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Memuat seluruh pasien asuhan terverifikasi oleh PJ Shift &amp; Kepala Ruang untuk perawat{' '}
                          <span className="font-bold text-slate-700">{activeNurseObject?.name || 'Perawat'}</span> pada bulan {monthlyNurseReport.logbook.monthYear}.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="relative min-w-[200px] sm:min-w-[240px]">
                          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={patientSearchQuery}
                            onChange={(e) => setPatientSearchQuery(e.target.value)}
                            placeholder="Cari pasien / RM / Bed..."
                            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#164e78]/20 focus:border-[#164e78]"
                          />
                        </div>

                        <div className="flex items-center rounded-xl bg-slate-100 p-0.5 border border-slate-200 text-xs">
                          {(['all', 'Pagi', 'Siang'] as const).map((shiftOpt) => (
                            <button
                              key={shiftOpt}
                              type="button"
                              onClick={() => setPatientShiftFilter(shiftOpt)}
                              className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                                patientShiftFilter === shiftOpt
                                  ? 'bg-white text-[#164e78] shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {shiftOpt === 'all' ? 'Semua Shift' : `Shift ${shiftOpt}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="sticky top-0 bg-slate-100/95 backdrop-blur z-10 border-b border-slate-200 text-slate-700 font-bold">
                          <tr>
                            <th className="p-3 text-center w-12">NO</th>
                            <th className="p-3 whitespace-nowrap">TANGGAL &amp; SHIFT</th>
                            <th className="p-3 whitespace-nowrap">NO. RM</th>
                            <th className="p-3 min-w-[160px]">NAMA PASIEN</th>
                            <th className="p-3 whitespace-nowrap">STATUS &amp; RUANG</th>
                            <th className="p-3 whitespace-nowrap text-center">BED / MESIN</th>
                            <th className="p-3 whitespace-nowrap">AKSES VASKULAR</th>
                            <th className="p-3 whitespace-nowrap text-center">DURASI</th>
                            <th className="p-3 whitespace-nowrap text-center">UF GOAL/REAL</th>
                            <th className="p-3 whitespace-nowrap text-center">TD PRE / POST</th>
                            <th className="p-3 min-w-[200px]">KOMPLIKASI &amp; ADVIS DPJP</th>
                            <th className="p-3 whitespace-nowrap text-center">PENGESAHAN</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-800">
                          {filteredIndividualVerifiedRows.length === 0 ? (
                            <tr>
                              <td colSpan={12} className="p-8 text-center text-slate-400">
                                <div className="flex flex-col items-center justify-center gap-2">
                                  <AlertCircle className="w-6 h-6 text-slate-300" />
                                  <p className="font-semibold text-slate-500">
                                    {monthlyNurseReport.verifiedRows && monthlyNurseReport.verifiedRows.length > 0
                                      ? 'Tidak ada pasien yang sesuai dengan kata kunci pencarian / filter shift.'
                                      : 'Belum ada data logbook pasien kelolaan yang berstatus Terverifikasi untuk bulan ini.'}
                                  </p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            filteredIndividualVerifiedRows.map((row, idx) => (
                              <tr key={row.id || idx} className="hover:bg-blue-50/40 transition-colors">
                                <td className="p-3 text-center font-mono text-slate-500 font-semibold">{idx + 1}</td>
                                <td className="p-3 whitespace-nowrap">
                                  <div className="font-bold text-slate-900">{row.tanggal}</div>
                                  <span className={`inline-block text-[10px] font-bold px-1.5 py-0.2 rounded mt-0.5 ${
                                    (row.shift || '').toLowerCase().includes('pagi')
                                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                      : 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                                  }`}>
                                    Shift {row.shift || 'Pagi'}
                                  </span>
                                </td>
                                <td className="p-3 font-mono font-bold text-[#164e78] whitespace-nowrap">{row.noRm}</td>
                                <td className="p-3 font-bold text-slate-900 whitespace-nowrap">{row.namaPasien}</td>
                                <td className="p-3 whitespace-nowrap">
                                  <div className="text-[11px] font-medium text-slate-700">{row.statusRawat || 'Rawat Jalan'}</div>
                                  <span className="text-[10px] text-slate-500">{row.ruangKategori || 'Reguler'}</span>
                                </td>
                                <td className="p-3 text-center whitespace-nowrap">
                                  <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                    {row.noBedMesin || '-'}
                                  </span>
                                </td>
                                <td className="p-3 whitespace-nowrap text-slate-700">{row.aksesVaskular || 'AV Shunt (Cimino)'}</td>
                                <td className="p-3 text-center whitespace-nowrap font-mono">{row.durasiJam || 4.5} Jam</td>
                                <td className="p-3 text-center whitespace-nowrap font-mono">
                                  <span className="font-bold text-emerald-700">{row.capaianUf ?? row.targetUf ?? 0}</span>
                                  <span className="text-slate-400 text-[10px]"> / {row.targetUf ?? 0} mL</span>
                                </td>
                                <td className="p-3 text-center whitespace-nowrap font-mono text-[11px]">
                                  <span className="font-semibold text-slate-800">{row.tdPre || '-'}</span>
                                  <span className="text-slate-400"> &rarr; </span>
                                  <span className="font-semibold text-slate-800">{row.tdPost || '-'}</span>
                                </td>
                                <td className="p-3 text-[11px]">
                                  {row.komplikasiIntraHd && row.komplikasiIntraHd !== '-' ? (
                                    <div className="text-rose-700 font-semibold">{row.komplikasiIntraHd}</div>
                                  ) : (
                                    <div className="text-slate-400 italic">Tidak ada komplikasi</div>
                                  )}
                                  {row.tindakanAdvisDpjp && row.tindakanAdvisDpjp !== '-' && (
                                    <div className="text-slate-600 text-[10px] mt-0.5 font-medium">Advis: {row.tindakanAdvisDpjp}</div>
                                  )}
                                </td>
                                <td className="p-3 text-center whitespace-nowrap">
                                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10.5px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                                    <span>{row.statusVerifikasi === 'verified_karu' ? 'Ka. Ruang' : 'PJ Shift'}</span>
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Rincian Nama Pasien Kelolaan Terverifikasi per Tanggal */}
                  {daysArray.some((day, dIdx) => {
                    const isOutOfMonth = day > monthlyNurseReport.daysInMonth;
                    const pList =
                      enrichedLogbook?.dailyPatientNames?.[dIdx] ||
                      monthlyNurseReport.logbook.dailyPatientNames?.[dIdx] ||
                      [];
                    return !isOutOfMonth && pList.length > 0;
                  }) && (
                    <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-xs space-y-3 print:hidden">
                      <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2.5">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-[#164e78]" />
                          <h4 className="text-xs sm:text-sm font-bold text-slate-900">
                            Rincian Nama Pasien Asuhan Terverifikasi per Tanggal ({monthlyNurseReport.logbook.monthYear})
                          </h4>
                        </div>
                        <span className="text-xs text-[#164e78] font-bold bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100 font-mono">
                          Total {monthlyNurseReport.totalVerifiedPatientsInMonth} Sesi Pasien
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
                        {daysArray.map((day, dIdx) => {
                          const isOutOfMonth = day > monthlyNurseReport.daysInMonth;
                          const pList =
                            enrichedLogbook?.dailyPatientNames?.[dIdx] ||
                            monthlyNurseReport.logbook.dailyPatientNames?.[dIdx] ||
                            [];
                          if (isOutOfMonth || pList.length === 0) return null;
                          return (
                            <div
                              key={day}
                              className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs flex flex-col justify-between gap-2"
                            >
                              <div className="flex items-center justify-between text-xs font-bold text-[#164e78]">
                                <span>Tanggal {day} {monthlyNurseReport.logbook.monthYear}</span>
                                <span className="font-mono text-slate-600 bg-white px-1.5 py-0.5 rounded border border-slate-200 text-[10.5px]">
                                  {pList.length} Pasien
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {pList.map((pName, pIdx) => (
                                  <span
                                    key={pIdx}
                                    className="text-[11px] font-semibold text-slate-800 bg-white px-2 py-1 rounded-lg border border-slate-200/90 shadow-2xs"
                                  >
                                    {pName}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
};
