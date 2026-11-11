import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ClipboardCheck,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Search,
  RotateCcw,
  AlertTriangle,
  AlertCircle,
  Loader2,
  RefreshCw,
  X,
  MessageSquare,
  Send,
  Lock,
  Eye,
  Edit3,
  Trash2,
  Printer,
  FileSpreadsheet,
  Users,
  Calendar,
  Award,
  UserCheck,
  ChevronDown,
  ChevronUp,
  Filter
} from 'lucide-react';
import { ShiftInfo, MasterNurse, SystemAccessRole, PatientHDSession } from '../types/dialysis.ts';
import {
  OFFICIAL_LOGBOOK_ITEMS,
  logbookService,
  type LogbookHarianRecord
} from '../data/officialPelaksanaLogbookData.ts';
import { MasterLogbookTemplateEditor } from './MasterLogbookTemplateEditor.tsx';
import {
  pasienLogbookService,
  buildDeterministicPatientSessionId,
  convertSessionToLaporanRow,
  formatBedAndMachineLabel,
  type LaporanPasienRow
} from '../data/laporanPasienData.ts';
import { LoginUserData } from './LoginPage.tsx';
import { ManagedPatient, PjVerificationSubmission, PjVerificationStatus } from './Logbook5ButtonsView.tsx';
import { formatSystemAccessLabel, resolveNurseSystemAccess } from '../utils/masterDataHelpers.ts';
import {
  saveNurseLogbookCloud,
  subscribeToNurseLogbook,
  deleteDialysisSessionCloud,
  deleteNurseLogbookCloud,
  type NurseLogbookCloudData
} from '../services/firebase.ts';
import {
  isMatchingNurse,
  isSameBed,
  getVerificationRegistry,
  upsertVerificationRegistryEntry,
  removeVerificationRegistryEntry,
  convertLogbookRecordToRegistryEntry,
  filterVerificationQueueForUser,
  LogbookVerificationRegistryEntry,
  ManagedPatientMinimal,
  PER_PATIENT_STATUS_STORAGE_KEY,
  buildPatientVerificationKey,
  getNurseManagedPatientsKey,
  getNurseMonthlySnapshotsKey,
  getNursePatientStatusesKey,
  getNursePatientNotesKey,
  getNurseClinicalDetailsKey,
  getNurseFacilityStatusesKey,
  getNurseFacilityNotesKey,
  readNurseFacilityStatuses,
  getNurseSubmissionKey,
  getNursePatientSubmissionsKey,
  getNurseStorageKey,
  canVerifierRoleEditSubmitted,
  isSessionVerifiedByPj
} from '../utils/nurseVerificationHelpers.ts';
import { normalizePatientClinicalDetails } from '../utils/logbookClinicalHelpers.ts';
import {
  syncNurseVerifiedDailySnapshot,
  buildAllStaffMonthlyRecap,
  getMonthLabel,
  parseIndonesianLogbookDate,
  type UnitMonthlyRecapOverview
} from '../utils/monthlyRecapHelpers.ts';
import {
  formatCurrentWibTimestamp,
  getCurrentIndonesianFullDate,
  getCurrentIsoDateWib,
  normalizeIndonesianDateLabel,
  indonesianDateLabelToIso
} from '../utils/dateHelpers.ts';
import {
  PatientLogbookVerificationModal,
  PatientLogbookEditPayload
} from './PatientLogbookVerificationModal.tsx';

interface VerifikasiViewProps {
  shiftInfo?: ShiftInfo;
  masterNurses?: MasterNurse[];
  userRole: SystemAccessRole;
  loggedInUser?: LoginUserData | null;
  sessions?: PatientHDSession[];
  cloudNurseLogbooks?: NurseLogbookCloudData[];
  onVerificationUpdated?: (
    nurseName: string,
    status: PjVerificationStatus,
    details: {
      verifiedAt?: string;
      verifiedBy?: string;
      verifiedByRole?: string;
      verifierNotes?: string;
      revisionRequested?: boolean;
      revisionRequestedAt?: string;
      revisionRequestedBy?: string;
      revisionRequestedByRole?: string;
      revisionEpoch?: number;
      shift?: string;
      dateKey?: string;
      dateLabel?: string;
    }
  ) => void;
  onVerifyPatientSession?: (
    patientIdentifier: { bedNumber?: string; patientName?: string; medicalRecord?: string },
    verified: boolean,
    details: {
      verifiedAt?: string;
      verifiedBy?: string;
      verifiedByRole?: string;
      verifierNotes?: string;
      revisionRequested?: boolean;
      revisionRequestedAt?: string;
      revisionRequestedBy?: string;
      revisionRequestedByRole?: string;
      revisionEpoch?: number;
      nurseName?: string;
      shift?: string;
      dateKey?: string;
      dateLabel?: string;
    }
  ) => void;
  onSaveSession?: (session: PatientHDSession) => void;
  onDeleteSessions?: (
    criteria: Array<{
      sessionId?: string;
      nurseName: string;
      bedNumber: string;
      medicalRecord?: string;
      patientName: string;
      dateKey?: string;
    }>
  ) => void;
}

export interface PatientVerificationDetail {
  id: string;
  bedNumber: string;
  patientName: string;
  medicalRecord?: string;
  completed: number;
  total: number;
  status: PjVerificationStatus;
  submittedAt?: string;
  submittedEpoch?: number;
  verifiedAt?: string;
  verifiedBy?: string;
  verifiedByRole?: string;
  verifierNotes?: string;
  revisionRequested?: boolean;
  revisionRequestedAt?: string;
  revisionRequestedBy?: string;
  revisionRequestedByRole?: string;
  revisionEpoch?: number;
  session?: PatientHDSession;
  score?: number;
  grade?: string;
  isCorrected?: boolean;
}

interface RosterVerificationRecord {
  id: string;
  nurseName: string;
  nurseNip: string;
  nurseRole: 'perawat_pelaksana' | 'pj_shift' | 'kepala_ruangan';
  targetRole: 'pj_shift' | 'kepala_ruangan' | 'mandiri';
  targetVerifierName: string;
  shift: string;
  dateKey?: string;
  dateLabel?: string;
  status: PjVerificationStatus;
  statusVerifikasi?: LogbookHarianRecord['statusVerifikasi'];
  verifikatorPjNama?: string;
  verifiedPjAt?: string;
  submittedAt?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  verifiedByRole?: string;
  pelaksanaNotes: string;
  verifierNotes: string;
  facilityCompleted: number;
  facilityTotal: number;
  rawItemsCompleted?: number;
  rawItemsTotal?: number;
  patientsSummary: PatientVerificationDetail[];
}

interface NurseColorPalette {
  bgHeader: string;
  avatarBg: string;
  badgeRole: string;
  nameColor: string;
  tagPill: string;
}

const NURSE_COLOR_PALETTES: NurseColorPalette[] = [
  {
    bgHeader: 'bg-slate-50/90',
    avatarBg: 'bg-blue-600 text-white shadow-xs ring-2 ring-blue-100',
    badgeRole: 'bg-blue-50 text-blue-900 border-blue-200 font-bold',
    nameColor: 'text-slate-900',
    tagPill: 'bg-blue-50 text-blue-800 border-blue-200'
  },
  {
    bgHeader: 'bg-slate-50/90',
    avatarBg: 'bg-teal-600 text-white shadow-xs ring-2 ring-teal-100',
    badgeRole: 'bg-teal-50 text-teal-900 border-teal-200 font-bold',
    nameColor: 'text-slate-900',
    tagPill: 'bg-teal-50 text-teal-800 border-teal-200'
  },
  {
    bgHeader: 'bg-slate-50/90',
    avatarBg: 'bg-indigo-600 text-white shadow-xs ring-2 ring-indigo-100',
    badgeRole: 'bg-indigo-50 text-indigo-900 border-indigo-200 font-bold',
    nameColor: 'text-slate-900',
    tagPill: 'bg-indigo-50 text-indigo-800 border-indigo-200'
  },
  {
    bgHeader: 'bg-slate-50/90',
    avatarBg: 'bg-amber-600 text-white shadow-xs ring-2 ring-amber-100',
    badgeRole: 'bg-amber-50 text-amber-900 border-amber-200 font-bold',
    nameColor: 'text-slate-900',
    tagPill: 'bg-amber-50 text-amber-800 border-amber-200'
  }
];

function getNurseInitials(name: string): string {
  if (!name) return 'PR';
  const clean = name
    .replace(/(S\.Kep|Ners|A\.Md\.?\s?Kep|S\.Tr\.?\s?Kep|M\.Kep|dr\.|Ns\.|PW\.)/gi, '')
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function formatSubmitterRoleLabel(role: 'perawat_pelaksana' | 'pj_shift' | 'kepala_ruangan'): string {
  if (role === 'kepala_ruangan') return 'Kepala Ruang (Pengaju)';
  if (role === 'pj_shift') return 'PJ Shift (Pengaju)';
  return 'Perawat Pelaksana';
}

export const VerifikasiView: React.FC<VerifikasiViewProps> = ({
  shiftInfo,
  masterNurses = [],
  userRole,
  loggedInUser,
  sessions = [],
  cloudNurseLogbooks = [],
  onVerificationUpdated,
  onVerifyPatientSession,
  onSaveSession,
  onDeleteSessions
}) => {
  const activeDate = shiftInfo?.date
    ? normalizeIndonesianDateLabel(shiftInfo.date)
    : getCurrentIndonesianFullDate();
  const activeShift = shiftInfo?.shift || 'Pagi';
  const validKaruShift =
    shiftInfo?.kepalaRuangan && shiftInfo.kepalaRuangan !== '-' ? shiftInfo.kepalaRuangan : '';
  const validPjShift =
    shiftInfo?.pjShift && shiftInfo.pjShift !== '-' ? shiftInfo.pjShift : '';
  const verifierName =
    loggedInUser?.name ||
    (userRole === 'kepala_ruangan' ? validKaruShift || '-' : validPjShift || '-');
  const verifierRoleLabel =
    userRole === 'kepala_ruangan'
      ? 'Kepala Ruangan'
      : userRole === 'pj_shift'
      ? 'PJ Shift'
      : formatSystemAccessLabel(userRole);

  const isMasterLogbookViewer = userRole === 'administrator' || userRole === 'managerial';
  const isManagerial = userRole === 'managerial';

  const isManagerialStaff = useCallback(
    (name?: string, role?: string) => {
      if (!name || name === '-') return false;
      if (role === 'managerial') return true;
      const matched = masterNurses.find((n) => isMatchingNurse(n.name, name));
      if (matched && resolveNurseSystemAccess(matched) === 'managerial') {
        return true;
      }
      return false;
    },
    [masterNurses]
  );

  const activeParsedDate = useMemo(
    () => parseIndonesianLogbookDate(shiftInfo?.date),
    [shiftInfo?.date]
  );
  const [recapMonth, setRecapMonth] = useState<number>(() => activeParsedDate.month);
  const [recapYear, setRecapYear] = useState<number>(() => activeParsedDate.year);
  const [isRecapTableExpanded, setIsRecapTableExpanded] = useState<boolean>(true);

  useEffect(() => {
    if (activeParsedDate.month && activeParsedDate.year) {
      setRecapMonth(activeParsedDate.month);
      setRecapYear(activeParsedDate.year);
    }
  }, [activeParsedDate.month, activeParsedDate.year]);

  const unitMonthlyRecap = useMemo<UnitMonthlyRecapOverview>(() => {
    return buildAllStaffMonthlyRecap({
      masterNurses,
      shiftInfo,
      sessions,
      cloudNurseLogbooks,
      targetMonth: recapMonth,
      targetYear: recapYear
    });
  }, [masterNurses, shiftInfo, sessions, cloudNurseLogbooks, recapMonth, recapYear]);

  const activeTodayIso =
    (shiftInfo?.date ? indonesianDateLabelToIso(shiftInfo.date) : '') || getCurrentIsoDateWib();

  const [adminSubView, setAdminSubView] = useState<'records' | 'template'>('records');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>(() => {
    if (userRole === 'administrator') {
      return activeTodayIso;
    }
    return '';
  });

  // Untuk hak akses administrator pada halaman Master Logbook, otomatis set filter tanggal ke tanggal aktif
  useEffect(() => {
    if (userRole === 'administrator' && activeTodayIso) {
      setSelectedDateFilter((prev) => prev || activeTodayIso);
    }
  }, [userRole, activeTodayIso]);
  const [statusFilter, setStatusFilter] = useState<'all' | PjVerificationStatus>(() =>
    isManagerial ? 'terverifikasi' : isMasterLogbookViewer ? 'all' : 'diajukan'
  );
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<
    | {
        type: 'record';
        rec: {
          id: string;
          nurseName: string;
          shift: string;
          dateKey?: string;
          dateLabel?: string;
          patientsSummary: PatientVerificationDetail[];
        };
      }
    | {
        type: 'patient';
        rec: {
          id: string;
          nurseName: string;
          shift: string;
          dateKey?: string;
          dateLabel?: string;
          patientsSummary: PatientVerificationDetail[];
        };
        pat: PatientVerificationDetail;
      }
    | {
        type: 'all';
        records: Array<{
          id: string;
          nurseName: string;
          shift: string;
          dateKey?: string;
          dateLabel?: string;
          patientsSummary: PatientVerificationDetail[];
        }>;
      }
    | null
  >(null);
  const [isDeletingLogbook, setIsDeletingLogbook] = useState(false);

  // Cloud Firestore Verification Queue States (logbookService + pasienLogbookService)
  const [isLoadingCloud, setIsLoadingCloud] = useState<boolean>(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [verifyingKeyMap, setVerifyingKeyMap] = useState<Record<string, boolean>>({});
  const [pendingCloudLogbooks, setPendingCloudLogbooks] = useState<LogbookHarianRecord[]>(() =>
    userRole === 'kepala_ruangan'
      ? logbookService.getCachedPendingVerifications('Kepala Ruang', verifierName)
      : logbookService.getCachedPendingVerifications('PJ Shift', verifierName)
  );
  const [pendingPatientSessions, setPendingPatientSessions] = useState<LaporanPasienRow[]>([]);

  // Load logbook records cache via logbookService
  const [serviceRecords, setServiceRecords] = useState<LogbookHarianRecord[]>(() =>
    logbookService.getAllRecords()
  );

  // Verification registry entries synced with localStorage / Firestore
  const [registryEntries, setRegistryEntries] = useState<LogbookVerificationRegistryEntry[]>(() =>
    getVerificationRegistry(masterNurses, validPjShift, validKaruShift)
  );

  // Per-patient verification records state (deterministic nurse+bed+rm keys)
  const [perPatientRecords, setPerPatientRecords] = useState<
    Record<
      string,
      {
        status: PjVerificationStatus;
        submittedAt?: string;
        submittedEpoch?: number;
        verifiedAt?: string;
        verifiedBy?: string;
        verifiedByRole?: string;
        verifierNotes?: string;
        revisionRequested?: boolean;
        revisionRequestedAt?: string;
        revisionRequestedBy?: string;
        revisionRequestedByRole?: string;
        revisionEpoch?: number;
        score?: number;
        grade?: string;
        isCorrected?: boolean;
      }
    >
  >(() => {
    try {
      const saved = localStorage.getItem(PER_PATIENT_STATUS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return {};
  });

  // Fetch antrean verifikasi secara asinkron dari Cloud Firestore (logbookService & pasienLogbookService)
  const fetchCloudVerificationQueue = useCallback(async () => {
    setIsLoadingCloud(true);
    setCloudError(null);
    try {
      if (isMasterLogbookViewer) {
        const [pjLogs, karuLogs, allPatSessions, verifiedLogs] = await Promise.all([
          logbookService.getPendingVerifications('PJ Shift'),
          logbookService.getPendingVerifications('Kepala Ruang'),
          pasienLogbookService.getAllSessionsFromCloud(),
          logbookService.getVerifiedReports()
        ]);
        const mergedLogsMap = new Map<string, LogbookHarianRecord>();
        [...pjLogs, ...karuLogs, ...verifiedLogs].forEach((r) => mergedLogsMap.set(r.id, r));

        setPendingCloudLogbooks(Array.from(mergedLogsMap.values()));
        setPendingPatientSessions(allPatSessions);
        setServiceRecords(logbookService.getAllRecords());
      } else {
        const serviceRole: 'PJ Shift' | 'Kepala Ruang' =
          userRole === 'kepala_ruangan' ? 'Kepala Ruang' : 'PJ Shift';
        const [pendingLogs, pendingSessions] = await Promise.all([
          logbookService.getPendingVerifications(serviceRole, verifierName),
          pasienLogbookService.getSessionsForVerification(serviceRole),
          logbookService.getVerifiedReports()
        ]);
        setPendingCloudLogbooks(pendingLogs);
        setPendingPatientSessions(pendingSessions);
      }
      setServiceRecords(logbookService.getAllRecords());
    } catch (err) {
      console.error('Gagal memuat antrean verifikasi dari Cloud Firestore:', err);
      setCloudError(
        'Gagal memuat antrean verifikasi terbaru dari jaringan cloud. Menampilkan data sinkron terakhir.'
      );
    } finally {
      setIsLoadingCloud(false);
    }
  }, [userRole, verifierName]);

  // Initial cloud fetch + real-time Firestore onSnapshot subscriptions for multi-device sync
  useEffect(() => {
    void fetchCloudVerificationQueue();

    if (isMasterLogbookViewer) {
      const unsubLogPj = logbookService.subscribePendingVerifications('PJ Shift', () => {
        const combined = [
          ...logbookService.getCachedPendingVerifications('PJ Shift'),
          ...logbookService.getCachedPendingVerifications('Kepala Ruang')
        ];
        const dedup = new Map<string, LogbookHarianRecord>();
        combined.forEach((r) => dedup.set(r.id, r));
        setPendingCloudLogbooks(Array.from(dedup.values()));
        setServiceRecords(logbookService.getAllRecords());
      });
      const unsubLogKaru = logbookService.subscribePendingVerifications('Kepala Ruang', () => {
        const combined = [
          ...logbookService.getCachedPendingVerifications('PJ Shift'),
          ...logbookService.getCachedPendingVerifications('Kepala Ruang')
        ];
        const dedup = new Map<string, LogbookHarianRecord>();
        combined.forEach((r) => dedup.set(r.id, r));
        setPendingCloudLogbooks(Array.from(dedup.values()));
        setServiceRecords(logbookService.getAllRecords());
      });
      const unsubSess = pasienLogbookService.subscribeSessionsForVerification(
        'Kepala Ruang',
        (rows) => {
          setPendingPatientSessions(rows);
        }
      );
      return () => {
        unsubLogPj();
        unsubLogKaru();
        unsubSess();
      };
    }

    const serviceRole: 'PJ Shift' | 'Kepala Ruang' =
      userRole === 'kepala_ruangan' ? 'Kepala Ruang' : 'PJ Shift';

    const unsubLogs = logbookService.subscribePendingVerifications(
      serviceRole,
      (records) => {
        setPendingCloudLogbooks(records);
        setServiceRecords(logbookService.getAllRecords());
      },
      undefined,
      verifierName
    );

    const unsubPatientSessions = pasienLogbookService.subscribeSessionsForVerification(
      serviceRole,
      (rows) => {
        setPendingPatientSessions(rows);
      }
    );

    return () => {
      unsubLogs();
      unsubPatientSessions();
    };
  }, [fetchCloudVerificationQueue, userRole, verifierName]);

  // Refresh logbookService & per-patient records when tab mounts, sessions change, or cloud/local events fire
  useEffect(() => {
    setServiceRecords(logbookService.getAllRecords());
    setRegistryEntries(getVerificationRegistry(masterNurses, validPjShift, validKaruShift));

    const handleCloudUpdate = () => {
      setServiceRecords(logbookService.getAllRecords());
      setRegistryEntries(getVerificationRegistry(masterNurses, validPjShift, validKaruShift));
      try {
        const saved = localStorage.getItem(PER_PATIENT_STATUS_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object') {
            setPerPatientRecords((prev) =>
              JSON.stringify(prev) === JSON.stringify(parsed) ? prev : parsed
            );
          }
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('logbook_records_updated', handleCloudUpdate);
    window.addEventListener('verification_registry_updated', handleCloudUpdate);
    window.addEventListener('storage', handleCloudUpdate);
    return () => {
      window.removeEventListener('logbook_records_updated', handleCloudUpdate);
      window.removeEventListener('verification_registry_updated', handleCloudUpdate);
      window.removeEventListener('storage', handleCloudUpdate);
    };
  }, [masterNurses, validPjShift, validKaruShift, sessions]);

  useEffect(() => {
    try {
      localStorage.setItem(PER_PATIENT_STATUS_STORAGE_KEY, JSON.stringify(perPatientRecords));
    } catch {
      // ignore
    }
    const syncedNurseKeys = new Set<string>();
    registryEntries.forEach((reg) => {
      if (!reg.submittedNurseName) return;
      syncedNurseKeys.add(getNurseStorageKey(reg.submittedNurseName));
      syncNurseVerifiedDailySnapshot({
        nurseName: reg.submittedNurseName,
        userRole: reg.submittedNurseRole || 'perawat_pelaksana',
        shiftInfo,
        sessions,
        masterNurses,
        cloudNurseLogbooks
      });
    });

    // Also sync daily snapshots for any nurse who performed cross-nurse vascular accessing (Poin 3.6)
    sessions.forEach((s) => {
      const vascNurse = (s.vascularAccessNurse || s.bagian3?.vascularAccessNurse || '').trim();
      if (!vascNurse || vascNurse === '-') return;
      const vKey = getNurseStorageKey(vascNurse);
      if (syncedNurseKeys.has(vKey)) return;
      syncedNurseKeys.add(vKey);
      const matchedMaster = masterNurses.find((n) => isMatchingNurse(n.name, vascNurse));
      const resolvedRole: SystemAccessRole =
        matchedMaster?.systemAccess ||
        (matchedMaster?.role === 'kepala_ruangan'
          ? 'kepala_ruangan'
          : matchedMaster?.role === 'pj_shift'
          ? 'pj_shift'
          : 'perawat_pelaksana');
      syncNurseVerifiedDailySnapshot({
        nurseName: vascNurse,
        userRole: resolvedRole,
        shiftInfo,
        sessions,
        masterNurses,
        cloudNurseLogbooks
      });
    });
  }, [perPatientRecords, registryEntries, shiftInfo, sessions, masterNurses, cloudNurseLogbooks]);

  const [localEditTick, setLocalEditTick] = useState(0);

  // Real-time multi-device hydration of submitting nurses' SPO checklists & clinical details
  const submittedNursesKey = useMemo(() => {
    const visible = filterVerificationQueueForUser(registryEntries, userRole, verifierName);
    const visibleNames = visible.map((e) => e.submittedNurseName);
    const cloudNames = cloudNurseLogbooks.map((lb) => lb.nurseName);
    const sessionNames = sessions.map((s) => s.nurseInCharge);
    const uniqueNames = Array.from(
      new Set(
        [...visibleNames, ...cloudNames, ...sessionNames].filter(
          (n): n is string => Boolean(n && n !== '-')
        )
      )
    ).sort();
    return uniqueNames.join('||');
  }, [registryEntries, cloudNurseLogbooks, sessions, userRole, verifierName]);

  useEffect(() => {
    if (!submittedNursesKey) return;
    const nurseNames = submittedNursesKey.split('||').filter(Boolean);
    const todayIso = getCurrentIsoDateWib();

    const syncKeyIfChanged = (storageKey: string, val: unknown): boolean => {
      try {
        const nextJson = JSON.stringify(val);
        const prevJson = localStorage.getItem(storageKey);
        if (prevJson !== nextJson) {
          localStorage.setItem(storageKey, nextJson);
          return true;
        }
      } catch {
        // ignore
      }
      return false;
    };

    const unsubs = nurseNames.map((nName) =>
      subscribeToNurseLogbook(nName, (cloudData) => {
        if (cloudData.dateIso && cloudData.dateIso !== todayIso) {
          return;
        }
        let changed = false;
        if (Array.isArray(cloudData.managedPatients) && cloudData.managedPatients.length > 0) {
          changed =
            syncKeyIfChanged(getNurseManagedPatientsKey(nName), cloudData.managedPatients) ||
            changed;
        }
        if (cloudData.facilityStatuses && typeof cloudData.facilityStatuses === 'object') {
          changed =
            syncKeyIfChanged(getNurseFacilityStatusesKey(nName), cloudData.facilityStatuses) ||
            changed;
        }
        if (cloudData.facilityNotes && typeof cloudData.facilityNotes === 'object') {
          changed =
            syncKeyIfChanged(getNurseFacilityNotesKey(nName), cloudData.facilityNotes) ||
            changed;
        }
        if (cloudData.patientStatuses && typeof cloudData.patientStatuses === 'object') {
          changed =
            syncKeyIfChanged(getNursePatientStatusesKey(nName), cloudData.patientStatuses) ||
            changed;
        }
        if (cloudData.patientNotes && typeof cloudData.patientNotes === 'object') {
          changed =
            syncKeyIfChanged(getNursePatientNotesKey(nName), cloudData.patientNotes) ||
            changed;
        }
        if (cloudData.clinicalDetails && typeof cloudData.clinicalDetails === 'object') {
          changed =
            syncKeyIfChanged(getNurseClinicalDetailsKey(nName), cloudData.clinicalDetails) ||
            changed;
        }
        if (cloudData.patientSubmissions && typeof cloudData.patientSubmissions === 'object') {
          changed =
            syncKeyIfChanged(
              getNursePatientSubmissionsKey(nName),
              cloudData.patientSubmissions
            ) || changed;
        }
        if (changed) {
          setLocalEditTick((t) => t + 1);
        }
      })
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [submittedNursesKey]);

  // Modal State for inspecting & editing individual patient logbook
  const [selectedPatientModal, setSelectedPatientModal] = useState<{
    patient: PatientVerificationDetail;
    nurseName: string;
    nurseNip?: string;
    session?: PatientHDSession;
    shift?: string;
    dateKey?: string;
    dateLabel?: string;
  } | null>(null);

  // Modal State for requesting repair (Minta Perbaikan Kembali)
  const [revisionModalTarget, setRevisionModalTarget] = useState<{
    rec: RosterVerificationRecord;
    patient?: PatientVerificationDetail;
  } | null>(null);
  const [revisionNoteInput, setRevisionNoteInput] = useState<string>('');

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  const formatNowWib = () => {
    return formatCurrentWibTimestamp(activeDate);
  };

  // Resolve matching session for a specific nurse's patient without substring bed collisions
  const findMatchingSession = (
    nurseName: string,
    bedNumber: string,
    patientName: string,
    rm?: string,
    targetShift?: string,
    targetDateIso?: string
  ): PatientHDSession | undefined => {
    const cleanName = patientName.toLowerCase().trim();
    const cleanRm = rm?.trim();
    const normalizedShift = targetShift?.toLowerCase().includes('siang')
      ? 'Siang'
      : targetShift
      ? 'Pagi'
      : undefined;

    const matchesSessionIdentity = (s: PatientHDSession) => {
      if (cleanRm && s.medicalRecordNumber?.trim() === cleanRm) return true;
      if (isSameBed(s.bedNumber, bedNumber)) return true;
      if (cleanName && s.patientName.toLowerCase().trim() === cleanName) return true;
      return false;
    };

    // 1. Prefer session explicitly matching nurse + shift + date
    const exactShiftDateMatch = sessions.find((s) => {
      if (s.nurseInCharge && !isMatchingNurse(s.nurseInCharge, nurseName)) return false;
      if (normalizedShift && s.shift && s.shift !== normalizedShift) return false;
      if (targetDateIso) {
        const sIso = s.sessionDate || (s.date ? indonesianDateLabelToIso(s.date) : '');
        if (sIso && sIso !== targetDateIso) return false;
      }
      return matchesSessionIdentity(s);
    });
    if (exactShiftDateMatch) return exactShiftDateMatch;

    // 2. Fallback: session assigned to this nurse
    const nurseMatch = sessions.find((s) => {
      if (s.nurseInCharge && !isMatchingNurse(s.nurseInCharge, nurseName)) return false;
      return matchesSessionIdentity(s);
    });
    if (nurseMatch) return nurseMatch;

    // 3. Fallback by exact RM
    return sessions.find((s) => Boolean(cleanRm && s.medicalRecordNumber?.trim() === cleanRm));
  };

  // Helper to sync nurse's individual & per-patient submission storage keys AND Cloud Firestore
  const syncNurseSubmissionStorage = (
    nurseName: string,
    patch: Partial<PjVerificationSubmission>,
    patientPatches?: Array<{
      patientId?: string;
      bedNumber: string;
      medicalRecord?: string;
      patch: Partial<PjVerificationSubmission>;
    }>
  ) => {
    let nextSubObj: Record<string, any> = {};
    let nextPatSubsMap: Record<string, any> | undefined;

    try {
      const subKey = getNurseSubmissionKey(nurseName);
      const raw = localStorage.getItem(subKey);
      const existing = raw ? JSON.parse(raw) : {};
      nextSubObj = {
        ...existing,
        ...patch
      };
      localStorage.setItem(subKey, JSON.stringify(nextSubObj));
    } catch {
      // ignore
    }

    if (patientPatches && patientPatches.length > 0) {
      try {
        const patSubKey = getNursePatientSubmissionsKey(nurseName);
        const rawPatSubs = localStorage.getItem(patSubKey);
        const existingPatSubs: Record<string, any> =
          rawPatSubs ? JSON.parse(rawPatSubs) : {};

        let managedList: ManagedPatient[] = [];
        try {
          const rawManaged = localStorage.getItem(getNurseManagedPatientsKey(nurseName));
          if (rawManaged) {
            const parsedManaged = JSON.parse(rawManaged);
            if (Array.isArray(parsedManaged)) managedList = parsedManaged;
          }
        } catch {
          // ignore
        }

        const updatedMap: Record<string, any> = { ...existingPatSubs };
        patientPatches.forEach((item) => {
          const matchedManaged = managedList.find(
            (m) =>
              (item.patientId && m.id === item.patientId) ||
              (item.medicalRecord &&
                m.medicalRecord &&
                m.medicalRecord.trim().toLowerCase() === item.medicalRecord.trim().toLowerCase()) ||
              isSameBed(m.bedNumber, item.bedNumber)
          );
          const candidateKeys = new Set<string>();
          if (item.patientId) candidateKeys.add(item.patientId);
          if (matchedManaged?.id) candidateKeys.add(matchedManaged.id);
          // Also patch any existing entry in updatedMap whose bed matches if keyed differently
          if (candidateKeys.size === 0 && item.bedNumber) {
            candidateKeys.add(item.bedNumber);
          }
          candidateKeys.forEach((key) => {
            updatedMap[key] = {
              ...(updatedMap[key] || {}),
              ...item.patch
            };
          });
        });

        nextPatSubsMap = updatedMap;
        localStorage.setItem(patSubKey, JSON.stringify(updatedMap));
      } catch {
        // ignore
      }
    }

    // Push updated lock/revision/verification state to nurse_logbooks in Cloud Firestore
    saveNurseLogbookCloud(nurseName, {
      submission: nextSubObj,
      ...(nextPatSubsMap ? { patientSubmissions: nextPatSubsMap } : {})
    }).catch(() => {});

    try {
      window.dispatchEvent(new CustomEvent('verification_registry_updated'));
    } catch {
      // ignore
    }
  };

  // ALUR VERIFIKASI BERBASIS logbookService.getPendingVerifications() & logbookService.getVerifiedReports():
  // 1. PJ Shift: mengambil antrean dari logbookService.getPendingVerifications('PJ Shift', verifierName)
  //    serta riwayat yang sudah diverifikasi dari logbookService.getVerifiedReports().
  // 2. Kepala Ruang: mengambil antrean dari logbookService.getPendingVerifications('Kepala Ruang', verifierName)
  //    (termasuk logbook berstatus 'verified_pj' untuk pengesahan berjenjang ke 'verified_karu' dan pengajuan langsung Kepala Ruang)
  //    serta riwayat terverifikasi dari logbookService.getVerifiedReports().
  const queueRecords = useMemo<RosterVerificationRecord[]>(() => {
    void serviceRecords;
    const serviceRecordById = new Map<string, LogbookHarianRecord>();
    const combinedEntries: LogbookVerificationRegistryEntry[] = [];
    const seenIds = new Set<string>();

    const pushServiceRec = (sRec: LogbookHarianRecord) => {
      if (!sRec || !sRec.id || seenIds.has(sRec.id)) return;
      // Akun managerial tidak memiliki logbook apapun
      if (isManagerialStaff(sRec.namaPerawat, sRec.perawatRole)) return;
      seenIds.add(sRec.id);
      serviceRecordById.set(sRec.id, sRec);
      combinedEntries.push(
        convertLogbookRecordToRegistryEntry(sRec, { viewerRole: userRole })
      );
    };

    // 1. Utamakan antrean real-time yang ditarik dari Cloud Firestore (pendingCloudLogbooks)
    pendingCloudLogbooks.forEach(pushServiceRec);

    if (userRole === 'kepala_ruangan') {
      const pendingKaru = logbookService.getCachedPendingVerifications(
        'Kepala Ruang',
        verifierName
      );
      pendingKaru.forEach(pushServiceRec);

      const verifiedKaru = logbookService
        .getCachedVerifiedReports()
        .filter(
          (r) =>
            (r.statusVerifikasi === 'verified_karu' || r.statusVerifikasi === 'verified_pj') &&
            (r.targetRole === 'kepala_ruangan' ||
              r.targetRole === 'mandiri' ||
              r.perawatRole === 'pj_shift' ||
              r.perawatRole === 'kepala_ruangan' ||
              (verifierName &&
                verifierName !== '-' &&
                r.targetVerifierName &&
                isMatchingNurse(r.targetVerifierName, verifierName)))
        );
      verifiedKaru.forEach(pushServiceRec);

      logbookService
        .getAllRecords()
        .filter(
          (r) =>
            r.statusVerifikasi === 'draft' &&
            Boolean(r.revisionRequested || r.verifierNotes) &&
            (r.targetRole === 'kepala_ruangan' ||
              r.targetRole === 'mandiri' ||
              r.revisionRequestedByRole === 'Kepala Ruang' ||
              r.revisionRequestedByRole === 'Kepala Ruangan')
        )
        .forEach(pushServiceRec);
    } else if (userRole === 'pj_shift') {
      const pendingPj = logbookService.getCachedPendingVerifications('PJ Shift', verifierName);
      pendingPj.forEach(pushServiceRec);

      const verifiedPj = logbookService
        .getAllRecords()
        .filter(
          (r) => r.statusVerifikasi === 'verified_pj' || r.statusVerifikasi === 'verified_karu'
        )
        .filter((r) => {
          if (isMatchingNurse(r.namaPerawat, verifierName)) return false;
          if (r.targetRole === 'kepala_ruangan' || r.targetRole === 'mandiri') return false;
          if (
            verifierName &&
            verifierName !== '-' &&
            r.targetVerifierName &&
            r.targetVerifierName !== '-'
          ) {
            return isMatchingNurse(r.targetVerifierName, verifierName);
          }
          return true;
        });
      verifiedPj.forEach(pushServiceRec);

      logbookService
        .getAllRecords()
        .filter((r) => {
          if (r.statusVerifikasi !== 'draft' || (!r.revisionRequested && !r.verifierNotes)) {
            return false;
          }
          if (isMatchingNurse(r.namaPerawat, verifierName)) return false;
          if (r.targetRole === 'kepala_ruangan' || r.targetRole === 'mandiri') return false;
          if (
            verifierName &&
            verifierName !== '-' &&
            r.targetVerifierName &&
            r.targetVerifierName !== '-'
          ) {
            return isMatchingNurse(r.targetVerifierName, verifierName);
          }
          return true;
        })
        .forEach(pushServiceRec);
    } else if (userRole === 'administrator' || userRole === 'managerial') {
      logbookService.getCachedPendingVerifications('PJ Shift').forEach(pushServiceRec);
      logbookService.getCachedPendingVerifications('Kepala Ruang').forEach(pushServiceRec);
      logbookService.getCachedVerifiedReports().forEach(pushServiceRec);
      logbookService.getAllRecords().forEach(pushServiceRec);
    }

    // 2. Rekonsiliasi entri sesi pasien dari pasienLogbookService.getSessionsForVerification(role)
    if (pendingPatientSessions.length > 0) {
      const groupedByNurseShift = new Map<string, LaporanPasienRow[]>();
      pendingPatientSessions.forEach((ps) => {
        if (!ps.perawatPelaksana || ps.perawatPelaksana === '-') return;
        if (isManagerialStaff(ps.perawatPelaksana)) return;
        if (userRole === 'pj_shift' && isMatchingNurse(ps.perawatPelaksana, verifierName)) return;
        const gKey = `${ps.tanggal}__${ps.shift || 'Pagi'}__${getNurseStorageKey(ps.perawatPelaksana)}`;
        const arr = groupedByNurseShift.get(gKey) || [];
        arr.push(ps);
        groupedByNurseShift.set(gKey, arr);
      });

      groupedByNurseShift.forEach((rowsForNurse) => {
        const sample = rowsForNurse[0];
        const existingIdx = combinedEntries.findIndex(
          (e) =>
            isMatchingNurse(e.submittedNurseName, sample.perawatPelaksana) &&
            (e.dateKey || '') === sample.tanggal &&
            (e.shift || 'Pagi') === (sample.shift || 'Pagi')
        );

        if (existingIdx === -1) {
          const matchedMasterNurse = masterNurses.find((n) =>
            isMatchingNurse(n.name, sample.perawatPelaksana)
          );
          const mapRowStatus = (r: LaporanPasienRow): PjVerificationStatus =>
            r.statusVerifikasi === 'verified_karu' || r.statusVerifikasi === 'verified_pj'
              ? 'terverifikasi'
              : r.statusVerifikasi === 'draft'
              ? 'belum_diajukan'
              : 'diajukan';
          const groupStatus: PjVerificationStatus = rowsForNurse.every(
            (r) => mapRowStatus(r) === 'terverifikasi'
          )
            ? 'terverifikasi'
            : rowsForNurse.some((r) => mapRowStatus(r) === 'belum_diajukan')
            ? 'belum_diajukan'
            : 'diajukan';
          combinedEntries.push({
            id: `psgroup-${sample.tanggal}-${sample.shift || 'Pagi'}-${getNurseStorageKey(sample.perawatPelaksana)}`,
            submittedNurseName: sample.perawatPelaksana,
            submittedNurseNip: matchedMasterNurse?.nip || '-',
            submittedNurseRole:
              matchedMasterNurse?.role === 'kepala_ruangan'
                ? 'kepala_ruangan'
                : matchedMasterNurse?.role === 'pj_shift'
                ? 'pj_shift'
                : 'perawat_pelaksana',
            targetRole: userRole === 'kepala_ruangan' ? 'kepala_ruangan' : 'pj_shift',
            targetVerifierName: verifierName,
            status: groupStatus,
            shift: sample.shift || 'Pagi',
            dateKey: sample.tanggal,
            dateLabel: activeDate,
            patients: rowsForNurse.map((r) => ({
              id: r.id,
              bedNumber: r.noBedMesin.split('/')[0]?.trim() || r.noBedMesin,
              patientName: r.namaPasien,
              medicalRecord: r.noRm !== '-' ? r.noRm : undefined,
              status: mapRowStatus(r)
            }))
          });
        }
      });
    }

    // 3. Fallback: rekonsiliasi entri dari filterVerificationQueueForUser jika belum ada di combinedEntries
    const fallbackFiltered = filterVerificationQueueForUser(
      registryEntries,
      userRole,
      verifierName
    );
    fallbackFiltered.forEach((fEntry) => {
      if (isManagerialStaff(fEntry.submittedNurseName, fEntry.submittedNurseRole)) return;
      const alreadyPresent = combinedEntries.some(
        (existing) =>
          (fEntry.id && existing.id === fEntry.id) ||
          (isMatchingNurse(existing.submittedNurseName, fEntry.submittedNurseName) &&
            (existing.dateKey || '') === (fEntry.dateKey || '') &&
            (existing.shift || 'Pagi') === (fEntry.shift || 'Pagi'))
      );
      if (!alreadyPresent) {
        combinedEntries.push(fEntry);
      }
    });

    // 4. Rekonsiliasi cloudNurseLogbooks (seluruh logbook yang diajukan perawat pelaksana di perangkat lain)
    cloudNurseLogbooks.forEach((lb) => {
      if (!lb.nurseName || lb.nurseName === '-') return;
      if (isManagerialStaff(lb.nurseName)) return;
      const pts = Array.isArray(lb.managedPatients) ? lb.managedPatients : [];
      if (pts.length === 0) return;
      const lbDateIso =
        lb.dateIso ||
        (lb.logbookDate ? indonesianDateLabelToIso(lb.logbookDate) : '') ||
        indonesianDateLabelToIso(activeDate);
      const lbShift = lb.shiftSchedule?.shift || 'Pagi';
      const alreadyPresent = combinedEntries.some(
        (existing) =>
          isMatchingNurse(existing.submittedNurseName, lb.nurseName) &&
          (!existing.dateKey || existing.dateKey === lbDateIso) &&
          (existing.shift || 'Pagi') === lbShift
      );
      if (!alreadyPresent) {
        const patSubs =
          lb.patientSubmissions && typeof lb.patientSubmissions === 'object'
            ? Object.values(lb.patientSubmissions)
            : [];
        const hasAnyPatSubmitted = patSubs.some((ps: any) => ps?.status === 'diajukan');
        const hasAnyPatVerified = patSubs.some((ps: any) => ps?.status === 'terverifikasi');
        const headerStatus = lb.submission?.status;

        const subStatus: PjVerificationStatus =
          headerStatus === 'terverifikasi' || (!headerStatus && hasAnyPatVerified && !hasAnyPatSubmitted)
            ? 'terverifikasi'
            : headerStatus === 'diajukan' || hasAnyPatSubmitted
            ? 'diajukan'
            : 'belum_diajukan';

        // PJ Shift & Kepala Ruang hanya melihat logbook yang berstatus 'diajukan' atau 'terverifikasi'
        if (!isMasterLogbookViewer) {
          if (userRole === 'pj_shift' && isMatchingNurse(lb.nurseName, verifierName)) return;
          if (subStatus === 'belum_diajukan') return;
        }

        const matchedMasterNurse = masterNurses.find((n) =>
          isMatchingNurse(n.name, lb.nurseName)
        );
        combinedEntries.push({
          id: `cloudlb-${lbDateIso}-${lbShift}-${getNurseStorageKey(lb.nurseName)}`,
          submittedNurseName: lb.nurseName,
          submittedNurseNip: matchedMasterNurse?.nip || '-',
          submittedNurseRole:
            matchedMasterNurse?.role === 'kepala_ruangan'
              ? 'kepala_ruangan'
              : matchedMasterNurse?.role === 'pj_shift'
              ? 'pj_shift'
              : 'perawat_pelaksana',
          targetRole: lb.submission?.targetRole || 'pj_shift',
          targetVerifierName: lb.submission?.targetVerifierName || '-',
          status: subStatus,
          shift: lbShift,
          dateKey: lbDateIso,
          dateLabel: lb.logbookDate || activeDate,
          patients: pts.map((p: any, idx: number) => {
            const pId = p.id || `pat-${idx}`;
            const ps = (lb.patientSubmissions && lb.patientSubmissions[pId]) || lb.submission || {};
            const pStatus: PjVerificationStatus =
              ps.status === 'terverifikasi'
                ? 'terverifikasi'
                : ps.status === 'diajukan'
                ? 'diajukan'
                : subStatus;
            return {
              id: pId,
              bedNumber: p.bedNumber || '-',
              patientName: p.patientName || '-',
              medicalRecord: p.medicalRecord,
              status: pStatus
            };
          })
        });
      }
    });

    if (isMasterLogbookViewer) {

      const sessionsByNurseShift = new Map<string, PatientHDSession[]>();
      sessions.forEach((s) => {
        const nurse = s.nurseInCharge && s.nurseInCharge !== '-' ? s.nurseInCharge : 'Perawat Unit HD';
        if (isManagerialStaff(nurse)) return;
        const sDateIso =
          s.updatedAt && /^\d{4}-\d{2}-\d{2}/.test(s.updatedAt)
            ? s.updatedAt.slice(0, 10)
            : indonesianDateLabelToIso(activeDate);
        const sShift = s.shift || 'Pagi';
        const key = `${sDateIso}__${sShift}__${getNurseStorageKey(nurse)}`;
        const list = sessionsByNurseShift.get(key) || [];
        list.push(s);
        sessionsByNurseShift.set(key, list);
      });

      sessionsByNurseShift.forEach((sessList) => {
        const sample = sessList[0];
        const nurse =
          sample.nurseInCharge && sample.nurseInCharge !== '-'
            ? sample.nurseInCharge
            : 'Perawat Unit HD';
        const sDateIso =
          sample.updatedAt && /^\d{4}-\d{2}-\d{2}/.test(sample.updatedAt)
            ? sample.updatedAt.slice(0, 10)
            : indonesianDateLabelToIso(activeDate);
        const sShift = sample.shift || 'Pagi';

        const alreadyPresent = combinedEntries.some(
          (existing) =>
            isMatchingNurse(existing.submittedNurseName, nurse) &&
            (!existing.dateKey || existing.dateKey === sDateIso) &&
            (existing.shift || 'Pagi') === sShift
        );
        if (!alreadyPresent) {
          const matchedMasterNurse = masterNurses.find((n) => isMatchingNurse(n.name, nurse));
          const allVerified = sessList.every(
            (s) =>
              s.sessionStatus === 'selesai' ||
              isSessionVerifiedByPj(s, masterNurses).isVerified
          );
          combinedEntries.push({
            id: `sessgroup-${sDateIso}-${sShift}-${getNurseStorageKey(nurse)}`,
            submittedNurseName: nurse,
            submittedNurseNip: matchedMasterNurse?.nip || '-',
            submittedNurseRole:
              matchedMasterNurse?.role === 'kepala_ruangan'
                ? 'kepala_ruangan'
                : matchedMasterNurse?.role === 'pj_shift'
                ? 'pj_shift'
                : 'perawat_pelaksana',
            targetRole: 'pj_shift',
            targetVerifierName: '-',
            status: allVerified ? 'terverifikasi' : 'diajukan',
            shift: sShift,
            dateKey: sDateIso,
            dateLabel: activeDate,
            patients: sessList.map((s) => {
              const sVerif = isSessionVerifiedByPj(s, masterNurses);
              const isDone = s.sessionStatus === 'selesai' || sVerif.isVerified;
              return {
                id: s.id,
                bedNumber: s.bedNumber,
                patientName: s.patientName,
                medicalRecord: s.medicalRecordNumber,
                status: isDone ? 'terverifikasi' : 'diajukan',
                verifiedAt: sVerif.verifiedAt,
                verifiedBy: sVerif.verifiedBy,
                verifiedByRole: sVerif.verifiedByRole
              };
            })
          });
        }
      });

      // Rekonsiliasi snapshot historis perawat di localStorage jika masih ada sisa hitungan Dashboard yang belum tercatat di koleksi lain
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          masterNurses.forEach((n) => {
            if (isManagerialStaff(n.name, n.role)) return;
            const rawSnap = localStorage.getItem(getNurseMonthlySnapshotsKey(n.name));
            if (!rawSnap) return;
            const parsedSnap = JSON.parse(rawSnap);
            if (!parsedSnap || typeof parsedSnap !== 'object') return;
            Object.values(parsedSnap).forEach((snap: any) => {
              if (!snap || !snap.dateKey || !(snap.verifiedPatientCount > 0)) return;
              const alreadyPresent = combinedEntries.some(
                (existing) =>
                  isMatchingNurse(existing.submittedNurseName, n.name) &&
                  existing.dateKey === snap.dateKey
              );
              if (!alreadyPresent) {
                const count = Number(snap.verifiedPatientCount) || 1;
                combinedEntries.push({
                  id: `snap-${snap.dateKey}-${getNurseStorageKey(n.name)}`,
                  submittedNurseName: n.name,
                  submittedNurseNip: n.nip || '-',
                  submittedNurseRole:
                    n.role === 'kepala_ruangan'
                      ? 'kepala_ruangan'
                      : n.role === 'pj_shift'
                      ? 'pj_shift'
                      : 'perawat_pelaksana',
                  targetRole: 'pj_shift',
                  targetVerifierName: '-',
                  status: 'terverifikasi',
                  shift: 'Pagi',
                  dateKey: snap.dateKey,
                  dateLabel: snap.dateLabel || snap.dateKey,
                  patients: Array.from({ length: count }, (_, idx) => ({
                    id: `snap-pat-${snap.dateKey}-${idx + 1}`,
                    bedNumber: `BED ${String(idx + 1).padStart(2, '0')}`,
                    patientName: `Pasien Terverifikasi #${idx + 1}`,
                    status: 'terverifikasi' as const
                  }))
                });
              }
            });
          });
        } catch {
          // ignore
        }
      }
    }

    const facItems = OFFICIAL_LOGBOOK_ITEMS.filter((it) => it.bagian === 1);
    const patSpoItems = OFFICIAL_LOGBOOK_ITEMS.filter((it) => it.bagian >= 2 && it.bagian <= 6);

    // Hanya perawat pelaksana, pj shift, dan kepala ruang yang memiliki logbook. Akun managerial tidak memiliki logbook apapun.
    return combinedEntries
      .filter((reg) => !isManagerialStaff(reg.submittedNurseName, reg.submittedNurseRole))
      .map((reg) => {
      const matchedServiceRec =
        serviceRecordById.get(reg.id) ||
        logbookService
          .getAllRecords()
          .find(
            (sr) =>
              sr.id === reg.id ||
              (isMatchingNurse(sr.namaPerawat, reg.submittedNurseName) &&
                (!reg.dateKey || sr.tanggal === reg.dateKey))
          );

      const nurseFacStatuses =
        matchedServiceRec?.facilityStatuses &&
        Object.keys(matchedServiceRec.facilityStatuses).length > 0
          ? matchedServiceRec.facilityStatuses
          : readNurseFacilityStatuses(reg.submittedNurseName);
      const nurseFacCompleted =
        matchedServiceRec?.items && matchedServiceRec.items.length > 0
          ? facItems.filter((it) =>
              Boolean(matchedServiceRec.items.find((ri) => ri.code === it.code)?.verified)
            ).length
          : facItems.filter((it) => Boolean(nurseFacStatuses[it.code])).length;
      // Read submitted patients from registry entry; enrich matching IDs/beds from live storage without leaking unsubmitted drafts
      let managedLookup: ManagedPatient[] = [];
      try {
        const rawManaged = localStorage.getItem(getNurseManagedPatientsKey(reg.submittedNurseName));
        if (rawManaged) {
          const parsed = JSON.parse(rawManaged);
          if (Array.isArray(parsed)) {
            managedLookup = parsed;
          }
        }
      } catch {
        // ignore
      }

      let nursePatSubmissions: Record<string, Partial<PjVerificationSubmission>> = {};
      try {
        const rawPatSubs = localStorage.getItem(
          getNursePatientSubmissionsKey(reg.submittedNurseName)
        );
        if (rawPatSubs) {
          const parsedSubs = JSON.parse(rawPatSubs);
          if (parsedSubs && typeof parsedSubs === 'object') {
            nursePatSubmissions = parsedSubs;
          }
        }
      } catch {
        // ignore
      }

      let nursePatients: ManagedPatient[] =
        Array.isArray(reg.patients) && reg.patients.length > 0
          ? reg.patients.map((p, idx) => {
              const matchedLive = managedLookup.find(
                (m) =>
                  (p.id && m.id === p.id) ||
                  (p.medicalRecord && m.medicalRecord && m.medicalRecord === p.medicalRecord) ||
                  isSameBed(m.bedNumber, p.bedNumber)
              );
              return {
                id: matchedLive?.id || p.id || `pat-${reg.id}-${idx}`,
                bedNumber: matchedLive?.bedNumber || p.bedNumber,
                patientName: matchedLive?.patientName || p.patientName,
                medicalRecord: matchedLive?.medicalRecord || p.medicalRecord
              };
            })
          : managedLookup;

      // If still empty, derive from sessions belonging to this nurse
      if (nursePatients.length === 0) {
        const fromSessions = sessions.filter((s) =>
          isMatchingNurse(s.nurseInCharge, reg.submittedNurseName)
        );
        nursePatients = fromSessions.map((s, idx) => ({
          id: s.id || `pat-${reg.id}-${idx}`,
          bedNumber: s.bedNumber,
          patientName: s.patientName,
          medicalRecord: s.medicalRecordNumber
        }));
      }

      // Read per-nurse SPO statuses if saved
      let nursePatStatuses: Record<string, Record<string, boolean>> = {};
      try {
        const rawPatStat = localStorage.getItem(getNursePatientStatusesKey(reg.submittedNurseName));
        if (rawPatStat) {
          const parsed = JSON.parse(rawPatStat);
          if (parsed && typeof parsed === 'object') {
            nursePatStatuses = parsed;
          }
        }
      } catch {
        // fallback
      }

      const regDateIso =
        reg.dateKey || indonesianDateLabelToIso(reg.dateLabel || activeDate);

      const patientsToMap: PatientVerificationDetail[] = nursePatients.map((p, pIdx) => {
        const matchingSession = findMatchingSession(
          reg.submittedNurseName,
          p.bedNumber,
          p.patientName,
          p.medicalRecord,
          reg.shift,
          regDateIso
        );
        const regPat: ManagedPatientMinimal | undefined = Array.isArray(reg.patients)
          ? reg.patients.find(
              (rp) =>
                (p.id && rp.id === p.id) ||
                (p.medicalRecord && rp.medicalRecord && rp.medicalRecord === p.medicalRecord) ||
                isSameBed(rp.bedNumber, p.bedNumber)
            )
          : undefined;
        const subPat = nursePatSubmissions[p.id] || nursePatSubmissions[p.bedNumber];

        const datedPatKey = buildPatientVerificationKey(
          reg.submittedNurseName,
          p.bedNumber,
          p.medicalRecord,
          regDateIso
        );
        const patKey = buildPatientVerificationKey(
          reg.submittedNurseName,
          p.bedNumber,
          p.medicalRecord
        );
        const savedPerPat = perPatientRecords[datedPatKey] || perPatientRecords[patKey];

        const checks = nursePatStatuses[p.id] || nursePatStatuses[p.bedNumber];
        const completed = checks
          ? patSpoItems.filter((it) => Boolean(checks[it.code])).length
          : 0;

        const latestSubmittedEpoch = Math.max(
          regPat?.submittedEpoch || 0,
          subPat?.submittedEpoch || 0,
          savedPerPat?.submittedEpoch || 0,
          matchingSession?.submittedEpoch || 0
        );
        const latestRevisionEpoch = Math.max(
          regPat?.revisionEpoch || 0,
          subPat?.revisionEpoch || 0,
          savedPerPat?.revisionEpoch || 0,
          matchingSession?.revisionEpoch || 0
        );

        const isExplicitlyResubmitted =
          (regPat?.status === 'diajukan' && regPat?.revisionRequested === false) ||
          (subPat?.status === 'diajukan' && subPat?.revisionRequested === false);

        let patStatus: PjVerificationStatus;
        if (
          isExplicitlyResubmitted &&
          savedPerPat?.status !== 'terverifikasi' &&
          regPat?.status !== 'terverifikasi'
        ) {
          patStatus = 'diajukan';
        } else if (latestRevisionEpoch > 0 && latestRevisionEpoch >= latestSubmittedEpoch) {
          patStatus = 'belum_diajukan';
        } else if (latestSubmittedEpoch > latestRevisionEpoch) {
          const isApprovedAfterSubmit =
            (savedPerPat?.status === 'terverifikasi' && !savedPerPat.revisionRequested) ||
            (regPat?.status === 'terverifikasi' && !regPat.revisionRequested) ||
            (matchingSession?.verificationStatus === 'terverifikasi' &&
              !matchingSession.revisionRequested);
          patStatus = isApprovedAfterSubmit ? 'terverifikasi' : 'diajukan';
        } else {
          patStatus =
            savedPerPat?.status ||
            regPat?.status ||
            subPat?.status ||
            (reg.status === 'terverifikasi' ? 'terverifikasi' : reg.status);
        }

        const isRevisionState = patStatus === 'belum_diajukan';

        return {
          id: p.id || `pat-${reg.id}-${pIdx}`,
          bedNumber: p.bedNumber,
          patientName: p.patientName,
          medicalRecord: p.medicalRecord || matchingSession?.medicalRecordNumber,
          completed,
          total: patSpoItems.length,
          status: patStatus,
          submittedAt:
            regPat?.submittedAt ||
            subPat?.submittedAt ||
            savedPerPat?.submittedAt ||
            reg.submittedAt,
          submittedEpoch: latestSubmittedEpoch || undefined,
          verifiedAt:
            patStatus === 'terverifikasi'
              ? savedPerPat?.verifiedAt ||
                regPat?.verifiedAt ||
                reg.verifiedAt ||
                matchingSession?.verifiedAt
              : undefined,
          verifiedBy:
            patStatus === 'terverifikasi'
              ? savedPerPat?.verifiedBy ||
                regPat?.verifiedBy ||
                reg.verifiedBy ||
                matchingSession?.verifiedBy
              : undefined,
          verifiedByRole:
            patStatus === 'terverifikasi'
              ? savedPerPat?.verifiedByRole ||
                regPat?.verifiedByRole ||
                reg.verifiedByRole ||
                matchingSession?.verifiedByRole
              : undefined,
          verifierNotes:
            savedPerPat?.verifierNotes ||
            regPat?.verifierNotes ||
            subPat?.verifierNotes ||
            matchingSession?.verifierNotes ||
            reg.verifierNotes ||
            '',
          revisionRequested:
            isRevisionState &&
            Boolean(
              savedPerPat?.revisionRequested ||
                regPat?.revisionRequested ||
                subPat?.revisionRequested ||
                matchingSession?.revisionRequested ||
                reg.revisionRequested ||
                savedPerPat?.verifierNotes ||
                regPat?.verifierNotes
            ),
          revisionRequestedAt: isRevisionState
            ? savedPerPat?.revisionRequestedAt ||
              regPat?.revisionRequestedAt ||
              subPat?.revisionRequestedAt ||
              matchingSession?.revisionRequestedAt ||
              reg.revisionRequestedAt
            : undefined,
          revisionRequestedBy: isRevisionState
            ? savedPerPat?.revisionRequestedBy ||
              regPat?.revisionRequestedBy ||
              subPat?.revisionRequestedBy ||
              matchingSession?.revisionRequestedBy ||
              reg.revisionRequestedBy
            : undefined,
          revisionRequestedByRole: isRevisionState
            ? savedPerPat?.revisionRequestedByRole ||
              regPat?.revisionRequestedByRole ||
              subPat?.revisionRequestedByRole ||
              matchingSession?.revisionRequestedByRole ||
              reg.revisionRequestedByRole
            : undefined,
          revisionEpoch: isRevisionState ? latestRevisionEpoch || undefined : undefined,
          session: matchingSession,
          score: savedPerPat?.score,
          grade: savedPerPat?.grade,
          isCorrected: savedPerPat?.isCorrected
        };
      });

      // Compute effective submission status from individual patient verification states
      const verifiedPats = patientsToMap.filter((p) => p.status === 'terverifikasi').length;
      const unsubmittedPats = patientsToMap.filter((p) => p.status === 'belum_diajukan').length;
      let effectiveStatus: PjVerificationStatus = reg.status;

      if (patientsToMap.length > 0) {
        if (verifiedPats === patientsToMap.length) {
          effectiveStatus = 'terverifikasi';
        } else if (unsubmittedPats === patientsToMap.length) {
          effectiveStatus = 'belum_diajukan';
        } else {
          effectiveStatus = 'diajukan';
        }
      }

      const rawItemsTotal = matchedServiceRec?.items?.length || 0;
      const rawItemsCompleted = matchedServiceRec?.items
        ? matchedServiceRec.items.filter((i) => Boolean(i.verified)).length
        : 0;

      return {
        id: reg.id,
        nurseName: reg.submittedNurseName,
        nurseNip: reg.submittedNurseNip || '-',
        nurseRole: reg.submittedNurseRole || 'perawat_pelaksana',
        targetRole: reg.targetRole || 'pj_shift',
        targetVerifierName: reg.targetVerifierName || verifierName,
        shift: reg.shift || activeShift,
        dateKey: reg.dateKey || regDateIso,
        dateLabel: reg.dateLabel || activeDate,
        status: effectiveStatus,
        statusVerifikasi: matchedServiceRec?.statusVerifikasi,
        verifikatorPjNama: matchedServiceRec?.verifikatorPjNama,
        verifiedPjAt: matchedServiceRec?.verifiedPjAt,
        submittedAt: reg.submittedAt,
        verifiedAt:
          effectiveStatus === 'terverifikasi'
            ? reg.verifiedAt
            : undefined,
        verifiedBy:
          effectiveStatus === 'terverifikasi'
            ? reg.verifiedBy
            : undefined,
        verifiedByRole:
          effectiveStatus === 'terverifikasi'
            ? reg.verifiedByRole
            : undefined,
        pelaksanaNotes: reg.pelaksanaNotes || '',
        verifierNotes: reg.verifierNotes || '',
        facilityCompleted: nurseFacCompleted,
        facilityTotal: facItems.length,
        rawItemsCompleted,
        rawItemsTotal,
        patientsSummary: patientsToMap
      };
    });
  }, [
    pendingCloudLogbooks,
    pendingPatientSessions,
    serviceRecords,
    registryEntries,
    masterNurses,
    userRole,
    verifierName,
    activeShift,
    activeDate,
    sessions,
    perPatientRecords,
    localEditTick,
    isManagerialStaff
  ]);

  // Helper to build ManagedPatientMinimal[] preserving per-patient lock/revision metadata
  const buildRegistryPatientsPayload = (
    summary: PatientVerificationDetail[]
  ): ManagedPatientMinimal[] =>
    summary.map((p) => ({
      id: p.id,
      bedNumber: p.bedNumber,
      patientName: p.patientName,
      medicalRecord: p.medicalRecord,
      status: p.status,
      submittedAt: p.submittedAt,
      submittedEpoch: p.submittedEpoch,
      verifiedAt: p.status === 'terverifikasi' ? p.verifiedAt : '',
      verifiedBy: p.status === 'terverifikasi' ? p.verifiedBy : '',
      verifiedByRole: p.status === 'terverifikasi' ? p.verifiedByRole : '',
      verifierNotes: p.verifierNotes || '',
      revisionRequested: p.status === 'belum_diajukan' && Boolean(p.revisionRequested),
      revisionRequestedAt: p.status === 'belum_diajukan' ? p.revisionRequestedAt || '' : '',
      revisionRequestedBy: p.status === 'belum_diajukan' ? p.revisionRequestedBy || '' : '',
      revisionRequestedByRole: p.status === 'belum_diajukan' ? p.revisionRequestedByRole || '' : '',
      revisionEpoch: p.status === 'belum_diajukan' ? p.revisionEpoch || 0 : 0
    }));

  const resolvePatientSessionCloudId = (
    rec: RosterVerificationRecord,
    patient: PatientVerificationDetail,
    targetDateIso: string
  ): string => {
    const matchedCloud = pendingPatientSessions.find(
      (ps) =>
        ps.tanggal === targetDateIso &&
        isMatchingNurse(ps.perawatPelaksana, rec.nurseName) &&
        ((patient.medicalRecord &&
          ps.noRm &&
          ps.noRm.trim().toLowerCase() === patient.medicalRecord.trim().toLowerCase()) ||
          isSameBed(ps.noBedMesin, patient.bedNumber))
    );
    if (matchedCloud?.id) return matchedCloud.id;
    return buildDeterministicPatientSessionId({
      tanggal: targetDateIso,
      shift: rec.shift,
      perawatPelaksana: rec.nurseName,
      noBedMesin: patient.bedNumber,
      noRm: patient.medicalRecord
    });
  };

  const buildFallbackLaporanRowForVerification = (
    rec: RosterVerificationRecord,
    patient: PatientVerificationDetail,
    targetDateIso: string,
    rowIdx: number
  ): Partial<LaporanPasienRow> => {
    if (patient.session) {
      return convertSessionToLaporanRow(patient.session, rowIdx, {
        tanggalIso: targetDateIso
      });
    }
    const shiftLabel: 'Pagi' | 'Siang' = rec.shift === 'Siang' ? 'Siang' : 'Pagi';
    return {
      no: rowIdx + 1,
      tanggal: targetDateIso,
      shift: shiftLabel,
      noRm: patient.medicalRecord || '-',
      namaPasien: patient.patientName,
      statusRawat: 'Rawat Jalan',
      ruangKategori: 'Reguler',
      noBedMesin: formatBedAndMachineLabel(patient.bedNumber),
      aksesVaskular: 'AV SHUNT',
      waktuMulai: shiftLabel === 'Siang' ? '14:00' : '07:30',
      waktuSelesai: shiftLabel === 'Siang' ? '18:30' : '12:00',
      durasiJam: 4.5,
      bbKering: 60,
      bbPreHd: 62,
      bbPostHd: 60,
      qb: 220,
      qd: 500,
      targetUf: 2000,
      ktV: 1.35,
      capaianUf: 2000,
      tdPre: '140/85',
      tdPost: '125/80',
      dialiser: 'High Flux (SAS HF 18)',
      heparinisasi: 'Standar (5000 IU)',
      komplikasiIntraHd: 'Tidak ada',
      tindakanAdvisDpjp: 'Tidak ada',
      statusMesin: 'Siap Pakai',
      metodeDisinfeksi: 'Heat Clean',
      ketTeknis: 'Normal',
      jamCekRo: shiftLabel === 'Siang' ? '13:30' : '06:30',
      kondisiAirRo: 'Memenuhi Syarat',
      perawatPelaksana: rec.nurseName
    };
  };

  // 1. VERIFY / APPROVE AN INDIVIDUAL PATIENT (ASYNC CLOUD FIRESTORE)
  const handleVerifyPatientApprove = async (
    rec: RosterVerificationRecord,
    patient: PatientVerificationDetail,
    notes: string = '',
    evaluation?: { score?: number; grade?: string; isCorrected?: boolean }
  ) => {
    if (userRole === 'administrator' || userRole === 'managerial') return;
    if (patient.status === 'belum_diajukan') {
      showToast(
        `Logbook pasien ${patient.patientName} sedang dalam status perbaikan. Tunggu perawat mengajukan ulang terlebih dahulu.`
      );
      return;
    }

    const actionKey = `${rec.id}__${patient.id}`;
    if (verifyingKeyMap[actionKey]) return;
    setVerifyingKeyMap((prev) => ({ ...prev, [actionKey]: true }));
    setCloudError(null);

    try {
      const timestamp = formatNowWib();
      const targetDateLabel = rec.dateLabel || activeDate;
      const targetDateIso = rec.dateKey || indonesianDateLabelToIso(targetDateLabel);
      const serviceRole: 'PJ Shift' | 'Kepala Ruang' =
        userRole === 'kepala_ruangan' ? 'Kepala Ruang' : 'PJ Shift';
      const verifikatorId = loggedInUser?.nurseId || loggedInUser?.nip || verifierName;

      const patKey = buildPatientVerificationKey(
        rec.nurseName,
        patient.bedNumber,
        patient.medicalRecord,
        targetDateIso
      );
      const fallbackPatKey = buildPatientVerificationKey(
        rec.nurseName,
        patient.bedNumber,
        patient.medicalRecord
      );

      const effectiveSubEpoch = patient.submittedEpoch || Date.now();
      const updateDetails = {
        status: 'terverifikasi' as PjVerificationStatus,
        submittedAt: patient.submittedAt || rec.submittedAt || timestamp,
        submittedEpoch: effectiveSubEpoch,
        verifiedAt: timestamp,
        verifiedBy: verifierName,
        verifiedByRole: verifierRoleLabel,
        verifierNotes: notes || patient.verifierNotes || '',
        revisionRequested: false,
        revisionRequestedAt: '',
        revisionRequestedBy: '',
        revisionRequestedByRole: '',
        revisionEpoch: 0,
        score: evaluation?.score ?? patient.score ?? 95,
        grade: evaluation?.grade ?? patient.grade ?? 'A',
        isCorrected: evaluation?.isCorrected ?? patient.isCorrected ?? false
      };

      const patientSessionId = resolvePatientSessionCloudId(rec, patient, targetDateIso);
      const fallbackRow = buildFallbackLaporanRowForVerification(rec, patient, targetDateIso, 0);

      // Verifikasi sesi pasien di Cloud Firestore secara asinkron
      await pasienLogbookService.verifyPatientSession(
        patientSessionId,
        verifikatorId,
        serviceRole,
        {
          verifikatorNama: verifierName,
          verifierNotes: updateDetails.verifierNotes,
          fallbackRow
        }
      );

      // Hapus langsung sesi pasien dari antrean state aktif secara real-time
      setPendingPatientSessions((prev) => prev.filter((item) => item.id !== patientSessionId));

      setPerPatientRecords((prev) => ({
        ...prev,
        [patKey]: updateDetails,
        [fallbackPatKey]: updateDetails
      }));

      if (onVerifyPatientSession) {
        onVerifyPatientSession(
          {
            bedNumber: patient.bedNumber,
            patientName: patient.patientName,
            medicalRecord: patient.medicalRecord
          },
          true,
          {
            verifiedAt: timestamp,
            verifiedBy: verifierName,
            verifiedByRole: verifierRoleLabel,
            verifierNotes: updateDetails.verifierNotes,
            revisionRequested: false,
            revisionEpoch: 0,
            nurseName: rec.nurseName,
            shift: rec.shift,
            dateKey: targetDateIso,
            dateLabel: targetDateLabel
          }
        );
      }

      const updatedSummary = rec.patientsSummary.map((p) =>
        p.id === patient.id || isSameBed(p.bedNumber, patient.bedNumber)
          ? { ...p, ...updateDetails }
          : p
      );
      const allPatsVerified =
        updatedSummary.length > 0 && updatedSummary.every((p) => p.status === 'terverifikasi');
      const nextOverallStatus: PjVerificationStatus = allPatsVerified
        ? 'terverifikasi'
        : 'diajukan';

      if (allPatsVerified) {
        await logbookService.verifyRecord(rec.id, verifikatorId, serviceRole, {
          verifikatorNama: verifierName,
          verifierNotes: updateDetails.verifierNotes
        });
        // Hapus langsung baris logbook yang sudah terverifikasi penuh dari antrean state real-time
        setPendingCloudLogbooks((prev) => prev.filter((item) => item.id !== rec.id));
      }

      upsertVerificationRegistryEntry({
        id: rec.id,
        submittedNurseName: rec.nurseName,
        submittedNurseNip: rec.nurseNip,
        submittedNurseRole: rec.nurseRole,
        targetRole: rec.targetRole,
        targetVerifierName: rec.targetVerifierName || verifierName,
        shift: rec.shift,
        dateKey: targetDateIso,
        dateLabel: targetDateLabel,
        status: nextOverallStatus,
        submittedAt: rec.submittedAt || timestamp,
        verifiedAt: allPatsVerified ? timestamp : undefined,
        verifiedBy: allPatsVerified ? verifierName : undefined,
        verifiedByRole: allPatsVerified ? verifierRoleLabel : undefined,
        verifierNotes: updateDetails.verifierNotes,
        revisionRequested: false,
        revisionEpoch: 0,
        patients: buildRegistryPatientsPayload(updatedSummary)
      });

      syncNurseSubmissionStorage(
        rec.nurseName,
        {
          status: nextOverallStatus,
          verifiedAt: allPatsVerified ? timestamp : '',
          verifiedBy: allPatsVerified ? verifierName : '',
          verifiedByRole: allPatsVerified ? verifierRoleLabel : '',
          verifierNotes: updateDetails.verifierNotes,
          revisionRequested: false,
          revisionRequestedAt: '',
          revisionRequestedBy: '',
          revisionRequestedByRole: '',
          revisionEpoch: 0
        },
        [
          {
            patientId: patient.id,
            bedNumber: patient.bedNumber,
            medicalRecord: patient.medicalRecord,
            patch: {
              status: 'terverifikasi',
              submittedAt: updateDetails.submittedAt,
              submittedEpoch: effectiveSubEpoch,
              verifiedAt: timestamp,
              verifiedBy: verifierName,
              verifiedByRole: verifierRoleLabel,
              verifierNotes: updateDetails.verifierNotes,
              revisionRequested: false,
              revisionRequestedAt: '',
              revisionRequestedBy: '',
              revisionRequestedByRole: '',
              revisionEpoch: 0
            }
          }
        ]
      );

      setServiceRecords(logbookService.getAllRecords());
      setRegistryEntries(getVerificationRegistry());

      if (allPatsVerified && onVerificationUpdated) {
        onVerificationUpdated(rec.nurseName, 'terverifikasi', {
          verifiedAt: timestamp,
          verifiedBy: verifierName,
          verifiedByRole: verifierRoleLabel,
          verifierNotes: updateDetails.verifierNotes,
          revisionRequested: false,
          revisionEpoch: 0,
          shift: rec.shift,
          dateKey: targetDateIso,
          dateLabel: targetDateLabel
        });
      }

      showToast(
        `Logbook pasien ${patient.patientName} (${patient.bedNumber}) telah disahkan & dikunci di Cloud.`
      );
    } catch (err) {
      console.error('Gagal memverifikasi logbook pasien di Cloud Firestore:', err);
      setCloudError('Gagal menyimpan pengesahan verifikasi ke jaringan cloud. Silakan coba lagi.');
    } finally {
      setVerifyingKeyMap((prev) => {
        const next = { ...prev };
        delete next[actionKey];
        return next;
      });
    }
  };

  // 2. REQUEST REPAIR / REVISE AN INDIVIDUAL PATIENT (UNLOCKS LOGBOOK FOR NURSE)
  const handleVerifyPatientRevise = async (
    rec: RosterVerificationRecord,
    patient: PatientVerificationDetail,
    notes: string = '',
    evaluation?: { score?: number; grade?: string; isCorrected?: boolean }
  ) => {
    if (userRole === 'administrator' || userRole === 'managerial') return;
    const actionKey = `${rec.id}__${patient.id}`;
    if (verifyingKeyMap[actionKey]) return;
    setVerifyingKeyMap((prev) => ({ ...prev, [actionKey]: true }));
    setCloudError(null);

    try {
      const timestamp = formatNowWib();
      const nowEpoch = Date.now();
      const targetDateLabel = rec.dateLabel || activeDate;
      const targetDateIso = rec.dateKey || indonesianDateLabelToIso(targetDateLabel);
      const serviceRole: 'PJ Shift' | 'Kepala Ruang' =
        userRole === 'kepala_ruangan' ? 'Kepala Ruang' : 'PJ Shift';
      const verifikatorId = loggedInUser?.nurseId || loggedInUser?.nip || verifierName;

      const datedPatKey = buildPatientVerificationKey(
        rec.nurseName,
        patient.bedNumber,
        patient.medicalRecord,
        targetDateIso
      );
      const patKey = buildPatientVerificationKey(
        rec.nurseName,
        patient.bedNumber,
        patient.medicalRecord
      );
      const effectiveNote =
        notes.trim() ||
        patient.verifierNotes ||
        'Mohon periksa dan perbaiki kembali kelengkapan SPO pasien ini.';

      const patientSessionId = resolvePatientSessionCloudId(rec, patient, targetDateIso);
      await pasienLogbookService.requestPatientSessionRevision(
        patientSessionId,
        verifikatorId,
        serviceRole,
        effectiveNote
      );
      setPendingPatientSessions((prev) => prev.filter((item) => item.id !== patientSessionId));

      const updateDetails = {
        status: 'belum_diajukan' as PjVerificationStatus,
        submittedAt: patient.submittedAt || rec.submittedAt || '',
        submittedEpoch: 0,
        verifiedAt: '',
        verifiedBy: '',
        verifiedByRole: '',
        verifierNotes: effectiveNote,
        revisionRequested: true,
        revisionRequestedAt: timestamp,
        revisionRequestedBy: verifierName,
        revisionRequestedByRole: verifierRoleLabel,
        revisionEpoch: nowEpoch,
        score: evaluation?.score ?? patient.score,
        grade: evaluation?.grade ?? patient.grade,
        isCorrected: evaluation?.isCorrected ?? patient.isCorrected ?? false
      };

      setPerPatientRecords((prev) => ({
        ...prev,
        [datedPatKey]: updateDetails,
        [patKey]: updateDetails
      }));

      if (onVerifyPatientSession) {
        onVerifyPatientSession(
          {
            bedNumber: patient.bedNumber,
            patientName: patient.patientName,
            medicalRecord: patient.medicalRecord
          },
          false,
          {
            verifierNotes: effectiveNote,
            revisionRequested: true,
            revisionRequestedAt: timestamp,
            revisionRequestedBy: verifierName,
            revisionRequestedByRole: verifierRoleLabel,
            revisionEpoch: nowEpoch,
            nurseName: rec.nurseName,
            shift: rec.shift,
            dateKey: targetDateIso,
            dateLabel: targetDateLabel
          }
        );
      }

      const updatedSummary = rec.patientsSummary.map((p) =>
        p.id === patient.id || isSameBed(p.bedNumber, patient.bedNumber)
          ? { ...p, ...updateDetails }
          : p
      );
      const anyStillSubmittedOrVerified = updatedSummary.some(
        (p) => p.status === 'diajukan' || p.status === 'terverifikasi'
      );
      const nextOverallStatus: PjVerificationStatus = anyStillSubmittedOrVerified
        ? 'diajukan'
        : 'belum_diajukan';

      if (nextOverallStatus === 'belum_diajukan') {
        await logbookService.requestRevision(rec.id, verifikatorId, serviceRole, {
          verifikatorNama: verifierName,
          verifierNotes: effectiveNote
        });
        setPendingCloudLogbooks((prev) => prev.filter((item) => item.id !== rec.id));
      }

      upsertVerificationRegistryEntry({
        id: rec.id,
        submittedNurseName: rec.nurseName,
        submittedNurseNip: rec.nurseNip,
        submittedNurseRole: rec.nurseRole,
        targetRole: rec.targetRole,
        targetVerifierName: rec.targetVerifierName || verifierName,
        shift: rec.shift,
        dateKey: targetDateIso,
        dateLabel: targetDateLabel,
        status: nextOverallStatus,
        submittedAt: rec.submittedAt,
        verifiedAt: '',
        verifiedBy: '',
        verifiedByRole: '',
        verifierNotes: effectiveNote,
        revisionRequested: true,
        revisionRequestedAt: timestamp,
        revisionRequestedBy: verifierName,
        revisionRequestedByRole: verifierRoleLabel,
        revisionEpoch: nowEpoch,
        patients: buildRegistryPatientsPayload(updatedSummary)
      });

      syncNurseSubmissionStorage(
        rec.nurseName,
        {
          status: nextOverallStatus,
          verifiedAt: '',
          verifiedBy: '',
          verifiedByRole: '',
          verifierNotes: effectiveNote,
          revisionRequested: true,
          revisionRequestedAt: timestamp,
          revisionRequestedBy: verifierName,
          revisionRequestedByRole: verifierRoleLabel,
          revisionEpoch: nowEpoch,
          declarationChecked: false
        },
        [
          {
            patientId: patient.id,
            bedNumber: patient.bedNumber,
            medicalRecord: patient.medicalRecord,
            patch: {
              status: 'belum_diajukan',
              submittedEpoch: 0,
              verifiedAt: '',
              verifiedBy: '',
              verifiedByRole: '',
              verifierNotes: effectiveNote,
              revisionRequested: true,
              revisionRequestedAt: timestamp,
              revisionRequestedBy: verifierName,
              revisionRequestedByRole: verifierRoleLabel,
              revisionEpoch: nowEpoch,
              declarationChecked: false
            }
          }
        ]
      );

      setServiceRecords(logbookService.getAllRecords());
      setRegistryEntries(getVerificationRegistry());

      showToast(
        `Permintaan perbaikan dikirim. Kunci logbook ${patient.patientName} (${patient.bedNumber}) telah dibuka untuk diedit kembali oleh ${rec.nurseName}.`
      );
    } catch (err) {
      console.error('Gagal mengirim permintaan revisi pasien ke Cloud Firestore:', err);
      setCloudError('Gagal mengirim permintaan perbaikan ke jaringan cloud. Silakan coba lagi.');
    } finally {
      setVerifyingKeyMap((prev) => {
        const next = { ...prev };
        delete next[actionKey];
        return next;
      });
    }
  };

  // 2a. BATCH REQUEST REPAIR FOR ALL PATIENTS OF A NURSE
  const handleVerifyAllPatientsRevise = async (
    rec: RosterVerificationRecord,
    notes: string = ''
  ) => {
    if (userRole === 'administrator' || userRole === 'managerial') return;
    const batchKey = `batch__${rec.id}`;
    if (verifyingKeyMap[batchKey]) return;
    setVerifyingKeyMap((prev) => ({ ...prev, [batchKey]: true }));
    setCloudError(null);

    try {
      const timestamp = formatNowWib();
      const nowEpoch = Date.now();
      const targetDateLabel = rec.dateLabel || activeDate;
      const targetDateIso = rec.dateKey || indonesianDateLabelToIso(targetDateLabel);
      const serviceRole: 'PJ Shift' | 'Kepala Ruang' =
        userRole === 'kepala_ruangan' ? 'Kepala Ruang' : 'PJ Shift';
      const verifikatorId = loggedInUser?.nurseId || loggedInUser?.nip || verifierName;

      const effectiveNote =
        notes.trim() ||
        rec.verifierNotes ||
        'Mohon periksa dan perbaiki kembali kelengkapan logbook SPO pasien kelolaan Anda.';

      const revisedSessionIds = rec.patientsSummary.map((p) =>
        resolvePatientSessionCloudId(rec, p, targetDateIso)
      );

      await Promise.all([
        ...revisedSessionIds.map((psId) =>
          pasienLogbookService.requestPatientSessionRevision(
            psId,
            verifikatorId,
            serviceRole,
            effectiveNote
          )
        ),
        logbookService.requestRevision(rec.id, verifikatorId, serviceRole, {
          verifikatorNama: verifierName,
          verifierNotes: effectiveNote
        })
      ]);

      const revisedIdSet = new Set(revisedSessionIds);
      setPendingPatientSessions((prev) => prev.filter((item) => !revisedIdSet.has(item.id)));
      setPendingCloudLogbooks((prev) => prev.filter((item) => item.id !== rec.id));

      const nextPerPatUpdates: typeof perPatientRecords = {};
      const patientPatches: Array<{
        patientId?: string;
        bedNumber: string;
        medicalRecord?: string;
        patch: Partial<PjVerificationSubmission>;
      }> = [];

      const updatedSummary = rec.patientsSummary.map((p) => {
        const datedPatKey = buildPatientVerificationKey(
          rec.nurseName,
          p.bedNumber,
          p.medicalRecord,
          targetDateIso
        );
        const patKey = buildPatientVerificationKey(rec.nurseName, p.bedNumber, p.medicalRecord);
        const updateDetails = {
          status: 'belum_diajukan' as PjVerificationStatus,
          submittedAt: p.submittedAt || rec.submittedAt || '',
          submittedEpoch: 0,
          verifiedAt: '',
          verifiedBy: '',
          verifiedByRole: '',
          verifierNotes: effectiveNote,
          revisionRequested: true,
          revisionRequestedAt: timestamp,
          revisionRequestedBy: verifierName,
          revisionRequestedByRole: verifierRoleLabel,
          revisionEpoch: nowEpoch,
          score: p.score,
          grade: p.grade,
          isCorrected: p.isCorrected ?? false
        };
        nextPerPatUpdates[datedPatKey] = updateDetails;
        nextPerPatUpdates[patKey] = updateDetails;

        patientPatches.push({
          patientId: p.id,
          bedNumber: p.bedNumber,
          medicalRecord: p.medicalRecord,
          patch: {
            status: 'belum_diajukan',
            submittedEpoch: 0,
            verifiedAt: '',
            verifiedBy: '',
            verifiedByRole: '',
            verifierNotes: effectiveNote,
            revisionRequested: true,
            revisionRequestedAt: timestamp,
            revisionRequestedBy: verifierName,
            revisionRequestedByRole: verifierRoleLabel,
            revisionEpoch: nowEpoch,
            declarationChecked: false
          }
        });

        if (onVerifyPatientSession) {
          onVerifyPatientSession(
            {
              bedNumber: p.bedNumber,
              patientName: p.patientName,
              medicalRecord: p.medicalRecord
            },
            false,
            {
              verifierNotes: effectiveNote,
              revisionRequested: true,
              revisionRequestedAt: timestamp,
              revisionRequestedBy: verifierName,
              revisionRequestedByRole: verifierRoleLabel,
              revisionEpoch: nowEpoch,
              nurseName: rec.nurseName,
              shift: rec.shift,
              dateKey: targetDateIso,
              dateLabel: targetDateLabel
            }
          );
        }

        return { ...p, ...updateDetails };
      });

      setPerPatientRecords((prev) => ({
        ...prev,
        ...nextPerPatUpdates
      }));

      upsertVerificationRegistryEntry({
        id: rec.id,
        submittedNurseName: rec.nurseName,
        submittedNurseNip: rec.nurseNip,
        submittedNurseRole: rec.nurseRole,
        targetRole: rec.targetRole,
        targetVerifierName: rec.targetVerifierName || verifierName,
        shift: rec.shift,
        dateKey: targetDateIso,
        dateLabel: targetDateLabel,
        status: 'belum_diajukan',
        submittedAt: rec.submittedAt,
        verifiedAt: '',
        verifiedBy: '',
        verifiedByRole: '',
        verifierNotes: effectiveNote,
        revisionRequested: true,
        revisionRequestedAt: timestamp,
        revisionRequestedBy: verifierName,
        revisionRequestedByRole: verifierRoleLabel,
        revisionEpoch: nowEpoch,
        patients: buildRegistryPatientsPayload(updatedSummary)
      });

      syncNurseSubmissionStorage(
        rec.nurseName,
        {
          status: 'belum_diajukan',
          verifiedAt: '',
          verifiedBy: '',
          verifiedByRole: '',
          verifierNotes: effectiveNote,
          revisionRequested: true,
          revisionRequestedAt: timestamp,
          revisionRequestedBy: verifierName,
          revisionRequestedByRole: verifierRoleLabel,
          revisionEpoch: nowEpoch,
          declarationChecked: false
        },
        patientPatches
      );

      if (onVerificationUpdated) {
        onVerificationUpdated(rec.nurseName, 'belum_diajukan', {
          verifierNotes: effectiveNote,
          revisionRequested: true,
          revisionRequestedAt: timestamp,
          revisionRequestedBy: verifierName,
          revisionRequestedByRole: verifierRoleLabel,
          revisionEpoch: nowEpoch,
          shift: rec.shift,
          dateKey: targetDateIso,
          dateLabel: targetDateLabel
        });
      }

      setServiceRecords(logbookService.getAllRecords());
      setRegistryEntries(getVerificationRegistry());

      showToast(
        `Permintaan perbaikan dikirim ke ${rec.nurseName}. Seluruh ${rec.patientsSummary.length} logbook pasien dibuka kembali untuk diperbaiki.`
      );
    } catch (err) {
      console.error('Gagal mengirim revisi semua pasien ke Cloud Firestore:', err);
      setCloudError('Gagal memproses permintaan revisi ke jaringan cloud. Silakan coba lagi.');
    } finally {
      setVerifyingKeyMap((prev) => {
        const next = { ...prev };
        delete next[batchKey];
        return next;
      });
    }
  };

  // 2b. SAVE PATIENT LOGBOOK EDITS & EVALUATION BY VERIFIER (PJ SHIFT / KEPALA RUANG)
  const handleSavePatientLogbookEdits = (
    rec: RosterVerificationRecord,
    patient: PatientVerificationDetail,
    payload: PatientLogbookEditPayload
  ) => {
    if (patient.status === 'terverifikasi') {
      showToast(
        'Logbook yang sudah diverifikasi terkunci. Klik Minta Perbaikan Kembali untuk membuka kunci.'
      );
      return;
    }
    if (!canVerifierRoleEditSubmitted(userRole)) {
      showToast(
        'Hanya Verifikator (PJ Shift / Kepala Ruang) yang dapat mengedit logbook yang diajukan.'
      );
      return;
    }

    const targetDateLabel = rec.dateLabel || activeDate;
    const targetDateIso = rec.dateKey || indonesianDateLabelToIso(targetDateLabel);
    const datedPatKey = buildPatientVerificationKey(
      rec.nurseName,
      patient.bedNumber,
      patient.medicalRecord,
      targetDateIso
    );
    const patKey = buildPatientVerificationKey(
      rec.nurseName,
      patient.bedNumber,
      patient.medicalRecord
    );

    const updateDetails = {
      status: payload.status || patient.status,
      submittedAt: patient.submittedAt || rec.submittedAt,
      submittedEpoch: patient.submittedEpoch || Date.now(),
      verifiedAt: payload.status === 'terverifikasi' ? formatNowWib() : patient.verifiedAt,
      verifiedBy: payload.status === 'terverifikasi' ? verifierName : patient.verifiedBy,
      verifiedByRole:
        payload.status === 'terverifikasi' ? verifierRoleLabel : patient.verifiedByRole,
      verifierNotes: payload.verifierNotes ?? patient.verifierNotes ?? '',
      score: payload.score,
      grade: payload.grade,
      isCorrected: true
    };

    setPerPatientRecords((prev) => ({
      ...prev,
      [datedPatKey]: updateDetails,
      [patKey]: updateDetails
    }));

    let nextAllStatuses: Record<string, Record<string, boolean>> | undefined;
    let nextAllNotes: Record<string, Record<string, string>> | undefined;
    let nextAllClin: Record<string, unknown> | undefined;

    try {
      const statKey = getNursePatientStatusesKey(rec.nurseName);
      const raw = localStorage.getItem(statKey);
      const allStatuses = raw ? JSON.parse(raw) : {};
      const pKey = patient.id || patient.bedNumber;
      allStatuses[pKey] = payload.patientStatuses;
      allStatuses[patient.bedNumber] = payload.patientStatuses;
      nextAllStatuses = allStatuses;
      localStorage.setItem(statKey, JSON.stringify(allStatuses));
    } catch {
      // ignore
    }

    if (payload.facilityStatuses) {
      try {
        localStorage.setItem(
          getNurseFacilityStatusesKey(rec.nurseName),
          JSON.stringify(payload.facilityStatuses)
        );
      } catch {
        // ignore
      }
    }

    if (payload.facilityNotes) {
      try {
        localStorage.setItem(
          getNurseFacilityNotesKey(rec.nurseName),
          JSON.stringify(payload.facilityNotes)
        );
      } catch {
        // ignore
      }
    }

    if (payload.patientNotes) {
      try {
        const notesKey = getNursePatientNotesKey(rec.nurseName);
        const rawNotes = localStorage.getItem(notesKey);
        const allNotes = rawNotes ? JSON.parse(rawNotes) : {};
        const pKey = patient.id || patient.bedNumber;
        allNotes[pKey] = payload.patientNotes;
        allNotes[patient.bedNumber] = payload.patientNotes;
        nextAllNotes = allNotes;
        localStorage.setItem(notesKey, JSON.stringify(allNotes));
      } catch {
        // ignore
      }
    }

    if (payload.clinicalDetail) {
      try {
        const clinKey = getNurseClinicalDetailsKey(rec.nurseName);
        const rawClin = localStorage.getItem(clinKey);
        const allClin = rawClin ? JSON.parse(rawClin) : {};
        const normalizedClin = normalizePatientClinicalDetails(payload.clinicalDetail);
        const pKey = patient.id || patient.bedNumber;
        allClin[pKey] = normalizedClin;
        allClin[patient.bedNumber] = normalizedClin;
        nextAllClin = allClin;
        localStorage.setItem(clinKey, JSON.stringify(allClin));
      } catch {
        // ignore
      }
    }

    // Sync verifier edits to Cloud Firestore so submitting nurse & other devices receive updates
    saveNurseLogbookCloud(rec.nurseName, {
      ...(nextAllStatuses ? { patientStatuses: nextAllStatuses } : {}),
      ...(payload.facilityStatuses ? { facilityStatuses: payload.facilityStatuses } : {}),
      ...(payload.facilityNotes ? { facilityNotes: payload.facilityNotes } : {}),
      ...(nextAllNotes ? { patientNotes: nextAllNotes } : {}),
      ...(nextAllClin ? { clinicalDetails: nextAllClin } : {})
    }).catch(() => {});

    // Also sync verifier edits (including Poin 3.6 vascularAccessNurse & patientStatuses) to logbooks & patient_sessions
    const existingLogRec = logbookService
      .getAllRecords()
      .find(
        (sr) =>
          sr.id === rec.id ||
          (isMatchingNurse(sr.namaPerawat, rec.nurseName) &&
            (!targetDateIso || sr.tanggal === targetDateIso))
      );
    if (existingLogRec) {
      logbookService
        .saveRecord({
          ...existingLogRec,
          ...(nextAllStatuses ? { patientStatuses: nextAllStatuses } : {}),
          ...(payload.facilityStatuses ? { facilityStatuses: payload.facilityStatuses } : {}),
          ...(nextAllClin
            ? { clinicalDetails: nextAllClin as LogbookHarianRecord['clinicalDetails'] }
            : {})
        })
        .then(() => {
          setServiceRecords(logbookService.getAllRecords());
        })
        .catch(() => {});
    }

    if (payload.updatedSession && onSaveSession) {
      const normalizedShift: 'Pagi' | 'Siang' = (rec.shift || activeShift)
        .toLowerCase()
        .includes('siang')
        ? 'Siang'
        : 'Pagi';
      const enrichedSession: PatientHDSession = {
        ...payload.updatedSession,
        nurseInCharge: rec.nurseName,
        date: targetDateLabel,
        sessionDate: targetDateIso,
        shift: normalizedShift,
        verificationStatus: payload.status || patient.status
      };
      onSaveSession(enrichedSession);
      pasienLogbookService
        .savePatientSession(
          convertSessionToLaporanRow(enrichedSession, 0, {
            tanggalIso: targetDateIso
          })
        )
        .catch(() => {});
      setSelectedPatientModal((prev) =>
        prev &&
        isMatchingNurse(prev.nurseName, rec.nurseName) &&
        (prev.patient.id === patient.id || isSameBed(prev.patient.bedNumber, patient.bedNumber))
          ? { ...prev, session: enrichedSession }
          : prev
      );
    }

    setLocalEditTick((t) => t + 1);

    if (payload.status !== 'terverifikasi' && payload.status !== 'belum_diajukan') {
      showToast(
        `Perubahan logbook pasien ${patient.patientName} (${patient.bedNumber}) berhasil disimpan oleh Verifikator.`
      );
    }
  };

  // 3. BATCH VERIFY SUBMITTED PATIENTS (OR DIRECT LOGBOOK RECORD) FOR A NURSE
  const handleVerifyAllPatients = async (rec: RosterVerificationRecord) => {
    if (userRole === 'administrator' || userRole === 'managerial') return;
    const batchKey = `batch__${rec.id}`;
    if (verifyingKeyMap[batchKey]) return;
    setVerifyingKeyMap((prev) => ({ ...prev, [batchKey]: true }));
    setCloudError(null);

    try {
      const serviceRole: 'PJ Shift' | 'Kepala Ruang' =
        userRole === 'kepala_ruangan' ? 'Kepala Ruang' : 'PJ Shift';
      const verifikatorId = loggedInUser?.nurseId || loggedInUser?.nip || verifierName;

      // Jika logbook disimpan langsung via logbookService tanpa daftar rincian pasien, sahkan langsung lewat logbookService
      if (rec.patientsSummary.length === 0 && rec.status === 'diajukan') {
        const timestamp = formatNowWib();
        const targetDateLabel = rec.dateLabel || activeDate;
        const targetDateIso = rec.dateKey || indonesianDateLabelToIso(targetDateLabel);

        await logbookService.verifyRecord(rec.id, verifikatorId, serviceRole, {
          verifikatorNama: verifierName,
          verifierNotes: rec.verifierNotes || ''
        });

        // Hapus baris yang baru diverifikasi dari antrean state real-time
        setPendingCloudLogbooks((prev) => prev.filter((item) => item.id !== rec.id));

        upsertVerificationRegistryEntry({
          id: rec.id,
          submittedNurseName: rec.nurseName,
          submittedNurseNip: rec.nurseNip,
          submittedNurseRole: rec.nurseRole || 'perawat_pelaksana',
          targetRole:
            rec.targetRole || (userRole === 'kepala_ruangan' ? 'kepala_ruangan' : 'pj_shift'),
          targetVerifierName: rec.targetVerifierName || verifierName,
          shift: rec.shift,
          dateKey: targetDateIso,
          dateLabel: targetDateLabel,
          status: 'terverifikasi',
          submittedAt: rec.submittedAt || timestamp,
          verifiedAt: timestamp,
          verifiedBy: verifierName,
          verifiedByRole: verifierRoleLabel,
          verifierNotes: rec.verifierNotes || '',
          revisionRequested: false,
          revisionEpoch: 0
        });

        setServiceRecords(logbookService.getAllRecords());
        setRegistryEntries(getVerificationRegistry());

        if (onVerificationUpdated) {
          onVerificationUpdated(rec.nurseName, 'terverifikasi', {
            verifiedAt: timestamp,
            verifiedBy: verifierName,
            verifiedByRole: verifierRoleLabel,
            verifierNotes: rec.verifierNotes || '',
            revisionRequested: false,
            revisionEpoch: 0,
            shift: rec.shift,
            dateKey: targetDateIso,
            dateLabel: targetDateLabel
          });
        }

        showToast(
          `Logbook harian ${rec.nurseName} telah diverifikasi & disahkan oleh ${verifierRoleLabel}.`
        );
        return;
      }

      const eligiblePatients = rec.patientsSummary.filter((p) => p.status === 'diajukan');
      if (eligiblePatients.length === 0) {
        showToast(
          'Tidak ada logbook berstatus Menunggu Verifikasi. Pasien yang sedang diperbaiki harus diajukan ulang oleh perawat terlebih dahulu.'
        );
        return;
      }

      const timestamp = formatNowWib();
      const targetDateLabel = rec.dateLabel || activeDate;
      const targetDateIso = rec.dateKey || indonesianDateLabelToIso(targetDateLabel);
      const nextPerPatUpdates: typeof perPatientRecords = {};
      const patientPatches: Array<{
        patientId?: string;
        bedNumber: string;
        medicalRecord?: string;
        patch: Partial<PjVerificationSubmission>;
      }> = [];

      const verifiedSessionIds: string[] = [];

      // Verifikasi seluruh sesi pasien yang menunggu secara paralel di Cloud Firestore
      await Promise.all(
        eligiblePatients.map((p, idx) => {
          const psId = resolvePatientSessionCloudId(rec, p, targetDateIso);
          verifiedSessionIds.push(psId);
          const fallbackRow = buildFallbackLaporanRowForVerification(rec, p, targetDateIso, idx);
          return pasienLogbookService.verifyPatientSession(psId, verifikatorId, serviceRole, {
            verifikatorNama: verifierName,
            verifierNotes: p.verifierNotes || rec.verifierNotes || '',
            fallbackRow
          });
        })
      );

      const verifiedIdSet = new Set(verifiedSessionIds);
      setPendingPatientSessions((prev) => prev.filter((item) => !verifiedIdSet.has(item.id)));

      const updatedSummary = rec.patientsSummary.map((p) => {
        if (p.status !== 'diajukan') return p;
        const effectiveSubEpoch = p.submittedEpoch || Date.now();
        const datedPatKey = buildPatientVerificationKey(
          rec.nurseName,
          p.bedNumber,
          p.medicalRecord,
          targetDateIso
        );
        const patKey = buildPatientVerificationKey(rec.nurseName, p.bedNumber, p.medicalRecord);
        const updateDetails = {
          status: 'terverifikasi' as PjVerificationStatus,
          submittedAt: p.submittedAt || rec.submittedAt || timestamp,
          submittedEpoch: effectiveSubEpoch,
          verifiedAt: timestamp,
          verifiedBy: verifierName,
          verifiedByRole: verifierRoleLabel,
          verifierNotes: p.verifierNotes || rec.verifierNotes || '',
          revisionRequested: false,
          revisionRequestedAt: '',
          revisionRequestedBy: '',
          revisionRequestedByRole: '',
          revisionEpoch: 0
        };
        nextPerPatUpdates[datedPatKey] = updateDetails;
        nextPerPatUpdates[patKey] = updateDetails;

        patientPatches.push({
          patientId: p.id,
          bedNumber: p.bedNumber,
          medicalRecord: p.medicalRecord,
          patch: {
            status: 'terverifikasi',
            submittedAt: updateDetails.submittedAt,
            submittedEpoch: effectiveSubEpoch,
            verifiedAt: timestamp,
            verifiedBy: verifierName,
            verifiedByRole: verifierRoleLabel,
            verifierNotes: updateDetails.verifierNotes,
            revisionRequested: false,
            revisionRequestedAt: '',
            revisionRequestedBy: '',
            revisionRequestedByRole: '',
            revisionEpoch: 0
          }
        });

        if (onVerifyPatientSession) {
          onVerifyPatientSession(
            {
              bedNumber: p.bedNumber,
              patientName: p.patientName,
              medicalRecord: p.medicalRecord
            },
            true,
            {
              verifiedAt: timestamp,
              verifiedBy: verifierName,
              verifiedByRole: verifierRoleLabel,
              verifierNotes: updateDetails.verifierNotes,
              revisionRequested: false,
              revisionEpoch: 0,
              nurseName: rec.nurseName,
              shift: rec.shift,
              dateKey: targetDateIso,
              dateLabel: targetDateLabel
            }
          );
        }

        return { ...p, ...updateDetails };
      });

      setPerPatientRecords((prev) => ({
        ...prev,
        ...nextPerPatUpdates
      }));

      const allVerifiedNow =
        updatedSummary.length > 0 && updatedSummary.every((p) => p.status === 'terverifikasi');
      const nextOverallStatus: PjVerificationStatus = allVerifiedNow
        ? 'terverifikasi'
        : 'diajukan';

      if (allVerifiedNow) {
        await logbookService.verifyRecord(rec.id, verifikatorId, serviceRole, {
          verifikatorNama: verifierName,
          verifierNotes: rec.verifierNotes || ''
        });
        // Hapus langsung baris logbook dari antrean verifikasi aktif secara real-time
        setPendingCloudLogbooks((prev) => prev.filter((item) => item.id !== rec.id));
      }

      upsertVerificationRegistryEntry({
        id:
          rec.id ||
          `sub-${rec.nurseRole || 'perawat_pelaksana'}-${getNurseStorageKey(rec.nurseName)}-${targetDateIso}-${rec.shift || 'Pagi'}`,
        submittedNurseName: rec.nurseName,
        submittedNurseNip: rec.nurseNip,
        submittedNurseRole: rec.nurseRole || 'perawat_pelaksana',
        targetRole:
          rec.targetRole || (userRole === 'kepala_ruangan' ? 'kepala_ruangan' : 'pj_shift'),
        targetVerifierName: rec.targetVerifierName || verifierName,
        shift: rec.shift,
        dateKey: targetDateIso,
        dateLabel: targetDateLabel,
        status: nextOverallStatus,
        submittedAt: rec.submittedAt || timestamp,
        verifiedAt: allVerifiedNow ? timestamp : '',
        verifiedBy: allVerifiedNow ? verifierName : '',
        verifiedByRole: allVerifiedNow ? verifierRoleLabel : '',
        verifierNotes: rec.verifierNotes || '',
        revisionRequested: false,
        revisionEpoch: 0,
        patients: buildRegistryPatientsPayload(updatedSummary)
      });

      syncNurseSubmissionStorage(
        rec.nurseName,
        {
          status: nextOverallStatus,
          submittedNurseName: rec.nurseName,
          submittedNurseNip: rec.nurseNip,
          submittedAt: rec.submittedAt || timestamp,
          verifiedAt: allVerifiedNow ? timestamp : '',
          verifiedBy: allVerifiedNow ? verifierName : '',
          verifiedByRole: allVerifiedNow ? verifierRoleLabel : '',
          verifierNotes: rec.verifierNotes || '',
          revisionRequested: false,
          revisionEpoch: 0
        },
        patientPatches
      );

      setServiceRecords(logbookService.getAllRecords());
      setRegistryEntries(getVerificationRegistry());

      if (allVerifiedNow && onVerificationUpdated) {
        onVerificationUpdated(rec.nurseName, 'terverifikasi', {
          verifiedAt: timestamp,
          verifiedBy: verifierName,
          verifiedByRole: verifierRoleLabel,
          verifierNotes: rec.verifierNotes || '',
          revisionRequested: false,
          revisionEpoch: 0,
          shift: rec.shift,
          dateKey: targetDateIso,
          dateLabel: targetDateLabel
        });
      }

      showToast(
        `${eligiblePatients.length} logbook pasien kelolaan ${rec.nurseName} telah diverifikasi & dikunci oleh ${verifierRoleLabel}.`
      );
    } catch (err) {
      console.error('Gagal memverifikasi seluruh logbook pasien di Cloud Firestore:', err);
      setCloudError('Gagal menyimpan verifikasi ke jaringan cloud. Silakan coba lagi.');
    } finally {
      setVerifyingKeyMap((prev) => {
        const next = { ...prev };
        delete next[batchKey];
        return next;
      });
    }
  };

  const openRevisionModal = (
    rec: RosterVerificationRecord,
    patient?: PatientVerificationDetail
  ) => {
    if (userRole === 'administrator' || userRole === 'managerial') return;
    setRevisionModalTarget({ rec, patient });
    setRevisionNoteInput(
      patient?.verifierNotes ||
        rec.verifierNotes ||
        ''
    );
  };

  const handleConfirmRevisionModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!revisionModalTarget) return;
    const { rec, patient } = revisionModalTarget;
    const cleanNote =
      revisionNoteInput.trim() ||
      'Mohon periksa dan perbaiki kembali kelengkapan logbook SPO sesuai standar.';
    if (patient) {
      void handleVerifyPatientRevise(rec, patient, cleanNote);
    } else {
      void handleVerifyAllPatientsRevise(rec, cleanNote);
    }
    setRevisionModalTarget(null);
    setRevisionNoteInput('');
  };

  const baseQueue = useMemo(() => {
    const nonManagerialQueue = queueRecords.filter(
      (rec) => !isManagerialStaff(rec.nurseName, rec.nurseRole)
    );
    if (!isManagerial) return nonManagerialQueue;
    return nonManagerialQueue
      .map((rec) => {
        const verifiedPatients = rec.patientsSummary.filter((p) => p.status === 'terverifikasi');
        if (rec.patientsSummary.length > 0) {
          if (verifiedPatients.length === 0) return null;
          return {
            ...rec,
            status: 'terverifikasi' as PjVerificationStatus,
            statusVerifikasi: (rec.statusVerifikasi === 'verified_karu' || rec.statusVerifikasi === 'verified_pj'
              ? rec.statusVerifikasi
              : 'verified_pj') as any,
            patientsSummary: verifiedPatients
          };
        }
        if (
          rec.status === 'terverifikasi' ||
          rec.statusVerifikasi === 'verified_karu' ||
          rec.statusVerifikasi === 'verified_pj'
        ) {
          return rec;
        }
        return null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [isManagerial, isManagerialStaff, queueRecords]);

  const dateFilteredQueue = baseQueue.filter((rec) => {
    if (!selectedDateFilter) return true;
    const recDateIso =
      rec.dateKey || (rec.dateLabel ? indonesianDateLabelToIso(rec.dateLabel) : '');
    return recDateIso === selectedDateFilter;
  });

  const filteredRecords = dateFilteredQueue.filter((rec) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      rec.nurseName.toLowerCase().includes(q) ||
      rec.nurseNip.toLowerCase().includes(q) ||
      rec.patientsSummary.some(
        (p) =>
          p.patientName.toLowerCase().includes(q) ||
          p.bedNumber.toLowerCase().includes(q) ||
          (p.medicalRecord && p.medicalRecord.toLowerCase().includes(q))
      );
    const matchesStatus = isManagerial ? true : (statusFilter === 'all' || rec.status === statusFilter);
    return matchesSearch && matchesStatus;
  });

  const waitingCount = dateFilteredQueue.filter((r) => r.status === 'diajukan').length;
  const verifiedCount = dateFilteredQueue.filter((r) => r.status === 'terverifikasi').length;
  const revisionCount = dateFilteredQueue.filter((r) => r.status === 'belum_diajukan').length;

  return (
    <div className="space-y-5">
      {toastMsg && (
        <div className="fixed top-20 right-6 z-50 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-3 border border-emerald-400/40">
          <CheckCircle2 className="w-5 h-5 text-emerald-100 shrink-0" />
          <span className="text-xs sm:text-sm font-semibold">{toastMsg}</span>
        </div>
      )}

      {/* Role Queue Context Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`p-2.5 rounded-xl shrink-0 ${
                userRole === 'kepala_ruangan'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-indigo-100 text-indigo-700'
              }`}
            >
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black text-slate-900">
                  {userRole === 'administrator'
                    ? 'Master Logbook Unit HD'
                    : userRole === 'managerial'
                    ? 'Master Logbook Unit HD (Mode Audit Managerial)'
                    : userRole === 'kepala_ruangan'
                    ? 'Halaman Verifikasi Kepala Ruang'
                    : 'Halaman Verifikasi Penanggung Jawab (PJ) Shift'}
                </h2>
                <span className="text-xs text-slate-400" aria-hidden="true">
                  &middot;
                </span>
                <span className="text-xs font-bold text-indigo-700">{verifierName}</span>
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                {userRole === 'administrator'
                  ? 'Menampilkan seluruh data logbook yang diinputkan oleh perawat serta pengaturan struktur Bagian & Poin Logbook untuk Kepala Ruang, PJ Shift, dan Perawat Pelaksana.'
                  : userRole === 'managerial'
                  ? 'Mode Audit Eksekutif: Menampilkan seluruh data logbook yang diinputkan oleh Kepala Ruang, PJ Shift, dan Perawat Pelaksana. Berfungsi untuk melihat, mengaudit, dan mencetak/menyimpan rekapitulasi data logbook tanpa mengubah data klinis.'
                  : userRole === 'kepala_ruangan'
                  ? 'Hanya menampilkan pengajuan verifikasi logbook yang ditujukan kepada Kepala Ruang (termasuk pasien kelolaan PJ Shift dan pengajuan mandiri Kepala Ruang). Pengajuan yang tidak ditujukan kepada Kepala Ruang tidak ditampilkan.'
                  : `Hanya menampilkan pengajuan verifikasi logbook yang ditujukan khusus untuk Anda (${verifierName}) sebagai PJ Shift (dari Perawat Pelaksana, PJ Shift lainnya, atau Kepala Ruang). Pengajuan yang tidak ditujukan untuk Anda otomatis disembunyikan.`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-center shrink-0 tabular-nums">
            <button
              type="button"
              onClick={() => void fetchCloudVerificationQueue()}
              disabled={isLoadingCloud}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60 px-3 py-1.5 rounded-xl border border-slate-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Muat ulang antrean verifikasi dari Cloud Firestore"
            >
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isLoadingCloud ? 'animate-spin text-indigo-600' : 'text-slate-500'}`} />
              <span>{isLoadingCloud ? 'Memuat Cloud...' : 'Sinkron Cloud'}</span>
            </button>

            <button
              type="button"
              onClick={async () => {
                const XLSX = await import('xlsx');
                const rows = [
                  ['No', 'Tanggal', 'Shift', 'Nama Perawat Pengaju', 'Peran', 'Status Verifikasi', 'Jumlah Pasien', 'Rincian Pasien'],
                  ...filteredRecords.map((r, idx) => [
                    idx + 1,
                    r.dateLabel || r.dateKey || '-',
                    r.shift || 'Pagi',
                    r.nurseName,
                    r.targetRole === 'kepala_ruangan' ? 'Kepala Ruang' : 'Perawat Pelaksana / PJ',
                    r.statusVerifikasi === 'verified_karu' || r.statusVerifikasi === 'verified_pj'
                      ? 'Terverifikasi'
                      : r.statusVerifikasi === 'submitted'
                      ? 'Menunggu Verifikasi'
                      : 'Perlu Revisi',
                    r.patientsSummary.length,
                    r.patientsSummary.map((p) => `${p.patientName} (${p.bedNumber}) - ${p.status === 'terverifikasi' ? 'Sah' : 'Menunggu'}`).join('; ')
                  ])
                ];
                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.aoa_to_sheet(rows);
                XLSX.utils.book_append_sheet(wb, ws, 'Master Logbook');

                // Sheet 2: Rekap Bulanan Per Perawat
                const recapRows = [
                  [
                    'No',
                    'Nama Perawat',
                    'NIP',
                    'Peran / Jabatan',
                    'Bulan / Tahun',
                    'Hari Dinas Disahkan',
                    'Total Pasien Terverifikasi',
                    'Skor SPO',
                    'Max Skor SPO',
                    'Kepatuhan SPO (%)',
                    'Status Audit'
                  ],
                  ...unitMonthlyRecap.staffSummaries.map((s, idx) => [
                    idx + 1,
                    s.nurseName,
                    s.nurseNip,
                    formatSystemAccessLabel(resolveNurseSystemAccess(s as any)),
                    `${getMonthLabel(recapMonth)} ${recapYear}`,
                    s.verifiedDaysCount,
                    s.totalVerifiedPatients,
                    s.grandTotalScore,
                    s.grandMaxScore,
                    `${s.overallCompliancePct}%`,
                    s.statusLabel
                  ])
                ];
                const wsRecap = XLSX.utils.aoa_to_sheet(recapRows);
                XLSX.utils.book_append_sheet(wb, wsRecap, 'Rekap Bulanan Per Perawat');

                XLSX.writeFile(
                  wb,
                  `Master_Logbook_Dialisis_${new Date().toISOString().slice(0, 10)}.xlsx`
                );
              }}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-xl border border-emerald-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Unduh seluruh data logbook yang tampil beserta rekapitulasi bulanan sebagai file Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span>Ekspor Excel</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#19588f] bg-sky-50 hover:bg-sky-100 px-3 py-1.5 rounded-xl border border-sky-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Cetak daftar master logbook ini"
            >
              <Printer className="w-3.5 h-3.5 text-[#19588f] shrink-0" />
              <span>Cetak</span>
            </button>

            {isManagerial ? (
              <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-3 py-1.5 rounded-xl border border-emerald-300 whitespace-nowrap flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                <span>{dateFilteredQueue.length} Logbook Terverifikasi</span>
              </span>
            ) : (
              <span className="text-xs font-bold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 whitespace-nowrap">
                {waitingCount} Antrean Aktif
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Sub-Navigasi Khusus Administrator: Daftar Master Logbook vs Kelola Bagian & Poin Logbook */}
      {userRole === 'administrator' && (
        <div className="flex items-center gap-1.5 p-1.5 bg-slate-100 border border-slate-200 rounded-2xl w-fit">
          <button
            type="button"
            onClick={() => setAdminSubView('records')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
              adminSubView === 'records'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Daftar Master Logbook
          </button>
          <button
            type="button"
            onClick={() => setAdminSubView('template')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
              adminSubView === 'template'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Kelola Bagian &amp; Poin Logbook
          </button>
        </div>
      )}

      {userRole === 'administrator' && adminSubView === 'template' ? (
        <MasterLogbookTemplateEditor />
      ) : (
        <>

      {/* SECTION AUDIT MANAGERIAL & MASTER LOGBOOK: TOTAL LOGBOOK UNIT & REKAP BULANAN PER PERAWAT */}
      {(isManagerial || isMasterLogbookViewer) && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          {/* Header Bar with Month/Year Picker & Toggle */}
          <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-50 to-indigo-50/40 border-b border-slate-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-600 text-white shrink-0 shadow-2xs">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm sm:text-base font-black text-slate-900">
                      Rekapitulasi Total Logbook Unit HD &amp; Per Masing-Masing Perawat
                    </h3>
                    <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>Data Terverifikasi 1 Bulan</span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Menampilkan total logbook pasien terverifikasi di Unit Hemodialisis dan rekapitulasi capaian masing-masing perawat dalam periode satu bulan kalender.
                  </p>
                </div>
              </div>

              {/* Month & Year Selectors and Toggle Table */}
              <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                <div className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-xl border border-slate-300 shadow-2xs">
                  <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <select
                    value={recapMonth}
                    onChange={(e) => setRecapMonth(Number(e.target.value))}
                    aria-label="Pilih Bulan Rekapitulasi"
                    className="text-xs font-bold text-slate-800 bg-transparent focus:outline-hidden cursor-pointer"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                      <option key={m} value={m}>
                        {getMonthLabel(m)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={recapYear}
                    onChange={(e) => setRecapYear(Number(e.target.value))}
                    aria-label="Pilih Tahun Rekapitulasi"
                    className="text-xs font-bold text-slate-800 bg-transparent focus:outline-hidden cursor-pointer border-l border-slate-200 pl-1.5"
                  >
                    {[2024, 2025, 2026, 2027, 2028].map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setIsRecapTableExpanded(!isRecapTableExpanded)}
                  className="px-2.5 py-1.5 text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 rounded-xl transition-colors border border-slate-300 shadow-2xs flex items-center gap-1 text-xs font-bold cursor-pointer"
                  title={isRecapTableExpanded ? 'Sembunyikan tabel perawat' : 'Tampilkan tabel perawat'}
                >
                  <span>{isRecapTableExpanded ? 'Tutup Rincian' : 'Buka Rincian Perawat'}</span>
                  {isRecapTableExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* 4 KPI Cards: Total Logbook Unit HD */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 sm:p-5 bg-white border-b border-slate-200">
            {/* 1. Total Pasien Terverifikasi Unit */}
            <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-100 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-indigo-600 text-white shrink-0 shadow-2xs">
                <ClipboardCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider truncate">
                  Total Logbook Pasien Unit
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 tabular-nums">
                  {unitMonthlyRecap.totalVerifiedPatientsUnit}{' '}
                  <span className="text-xs font-semibold text-slate-500">Pasien</span>
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {getMonthLabel(recapMonth)} {recapYear} &middot; Terverifikasi Sah
                </div>
              </div>
            </div>

            {/* 2. Hari Dinas Terverifikasi Unit */}
            <div className="p-3.5 rounded-xl bg-sky-50/70 border border-sky-100 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-[#19588f] text-white shrink-0 shadow-2xs">
                <Calendar className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-sky-800 uppercase tracking-wider truncate">
                  Hari Dinas Disahkan
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 tabular-nums">
                  {unitMonthlyRecap.totalVerifiedDutyDays}{' '}
                  <span className="text-xs font-semibold text-slate-500">Hari</span>
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  Akumulasi seluruh perawat
                </div>
              </div>
            </div>

            {/* 3. Tenaga Perawat Aktif Berlogbook */}
            <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-100 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-600 text-white shrink-0 shadow-2xs">
                <Users className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider truncate">
                  Tenaga Perawat
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 tabular-nums">
                  {unitMonthlyRecap.staffSummaries.filter((s) => s.totalVerifiedPatients > 0).length} / {unitMonthlyRecap.totalActiveNurses}{' '}
                  <span className="text-xs font-semibold text-slate-500">Staf</span>
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  Perawat berlogbook sah bulan ini
                </div>
              </div>
            </div>

            {/* 4. Rata-rata Kepatuhan SPO Unit */}
            <div className="p-3.5 rounded-xl bg-purple-50/70 border border-purple-100 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-purple-600 text-white shrink-0 shadow-2xs">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-purple-800 uppercase tracking-wider truncate">
                  Kepatuhan 29 SPO Unit
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 tabular-nums">
                  {unitMonthlyRecap.unitOverallCompliancePct}%
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  Standar Akreditasi KARS
                </div>
              </div>
            </div>
          </div>

          {/* Table: Total Logbook Per Masing-Masing Perawat dalam 1 Bulan */}
          {isRecapTableExpanded && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-[11px] font-bold text-slate-700 uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">No</th>
                    <th className="py-3 px-4">Nama Perawat &amp; NIP</th>
                    <th className="py-3 px-4">Peran / Jabatan</th>
                    <th className="py-3 px-4 text-center">Hari Dinas Disahkan</th>
                    <th className="py-3 px-4 text-center">Total Logbook Pasien (1 Bln)</th>
                    <th className="py-3 px-4 text-center">Skor SPO</th>
                    <th className="py-3 px-4 text-center">Kepatuhan SPO</th>
                    <th className="py-3 px-4 text-center">Status Audit</th>
                    <th className="py-3 px-4 text-right">Aksi Audit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {unitMonthlyRecap.staffSummaries.map((staff, idx) => {
                    const accessRole = resolveNurseSystemAccess(staff as any);
                    const roleDisplay = formatSystemAccessLabel(accessRole);
                    const isHigh = staff.overallCompliancePct >= 85;
                    const isMedium = staff.overallCompliancePct >= 70;
                    const hasData = staff.totalVerifiedPatients > 0 || staff.verifiedDaysCount > 0;

                    return (
                      <tr
                        key={staff.nurseId || staff.nurseName}
                        className={`hover:bg-slate-50 transition-colors ${
                          hasData ? '' : 'text-slate-400 bg-slate-50/30'
                        }`}
                      >
                        <td className="py-3 px-4 font-mono text-slate-400">{idx + 1}</td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">{staff.nurseName}</div>
                          <div className="text-[10px] font-mono text-slate-500">{staff.nurseNip}</div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              accessRole === 'kepala_ruangan'
                                ? 'bg-amber-100 text-amber-800'
                                : accessRole === 'pj_shift'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {roleDisplay}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center tabular-nums font-semibold">
                          {staff.verifiedDaysCount > 0 ? (
                            <span className="text-slate-900">{staff.verifiedDaysCount} hari</span>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center tabular-nums">
                          {staff.totalVerifiedPatients > 0 ? (
                            <span className="inline-flex items-center gap-1 font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100">
                              <UserCheck className="w-3 h-3 text-indigo-600" />
                              <span>{staff.totalVerifiedPatients} Pasien</span>
                            </span>
                          ) : (
                            <span className="text-slate-400">0 Pasien</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center tabular-nums font-mono text-[11px]">
                          {hasData ? (
                            `${staff.grandTotalScore} / ${staff.grandMaxScore}`
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center tabular-nums">
                          {hasData ? (
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                isHigh
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : isMedium
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {staff.overallCompliancePct}%
                            </span>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {hasData ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Terverifikasi</span>
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">Belum Ada Data</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setSearchQuery(staff.nurseName)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] transition-colors border border-indigo-200 cursor-pointer"
                            title={`Lihat rincian logbook ${staff.nurseName} pada daftar di bawah`}
                          >
                            <Filter className="w-3 h-3" />
                            <span>Filter Logbook</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Cloud Error Alert Banner */}
      {cloudError && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-900">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-semibold">{cloudError}</span>
          </div>
          <button
            type="button"
            onClick={() => void fetchCloudVerificationQueue()}
            className="px-3 py-1.5 rounded-lg bg-white hover:bg-rose-100 text-rose-800 border border-rose-300 font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* Search, Date & Status Filter Toolbar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                userRole === 'kepala_ruangan'
                  ? 'Cari nama PJ Shift pengaju, nomor bed, atau nama pasien kelolaan...'
                  : 'Cari nama perawat / PJ Shift pengaju, nomor bed, atau nama pasien kelolaan...'
              }
              className="w-full text-xs pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white font-medium"
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            <input
              type="date"
              value={selectedDateFilter}
              onChange={(e) => setSelectedDateFilter(e.target.value)}
              aria-label="Filter tanggal logbook"
              className="text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white font-semibold text-slate-700 cursor-pointer"
            />
            {selectedDateFilter !== activeTodayIso && (
              <button
                type="button"
                onClick={() => setSelectedDateFilter(activeTodayIso)}
                className="px-2.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 border border-indigo-200"
                title="Tampilkan tanggal aktif hari ini"
              >
                Hari Ini
              </button>
            )}
            {selectedDateFilter && (
              <button
                type="button"
                onClick={() => setSelectedDateFilter('')}
                className="px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                title="Tampilkan semua tanggal"
              >
                Semua Tanggal
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {isManagerial ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Logbook Terverifikasi ({filteredRecords.length})</span>
              </span>
              <span className="text-[11px] text-slate-500">
                (Hanya menampilkan logbook yang disahkan oleh PJ Shift atau Kepala Ruang)
              </span>
            </div>
          ) : (
            (
              [
                { id: 'diajukan', label: `Menunggu Verifikasi (${waitingCount})` },
                { id: 'terverifikasi', label: `Riwayat Terverifikasi (${verifiedCount})` },
                ...(revisionCount > 0
                  ? [{ id: 'belum_diajukan' as const, label: `Perlu Revisi (${revisionCount})` }]
                  : []),
                { id: 'all', label: `Semua (${dateFilteredQueue.length})` }
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                  statusFilter === tab.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))
          )}

          {userRole === 'administrator' && filteredRecords.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setDeleteConfirmTarget({ type: 'all', records: filteredRecords })
              }
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 shadow-2xs tabular-nums"
              title="Hapus seluruh logbook yang tampil pada daftar ini dari sistem & Cloud Firestore"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>Hapus Semua Logbook ({filteredRecords.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Verification Queue Cards */}
      <div className="space-y-4">
        {isLoadingCloud && filteredRecords.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 space-y-4">
            <div className="flex items-center justify-center gap-2.5 text-slate-700">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-600 shrink-0" />
              <span className="text-xs sm:text-sm font-bold">
                Memuat antrean verifikasi real-time dari Cloud Firestore...
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              {[1, 2, 3].map((sk) => (
                <div
                  key={sk}
                  className="rounded-2xl border border-slate-200 p-4 space-y-2.5 bg-slate-50/70"
                >
                  <div className="h-3.5 w-28 bg-slate-200 rounded animate-pulse" />
                  <div className="h-4 w-44 bg-slate-200 rounded animate-pulse" />
                  <div className="h-3 w-full bg-slate-200/80 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
            <ClipboardCheck className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-800">
              {statusFilter === 'diajukan'
                ? userRole === 'kepala_ruangan'
                  ? 'Tidak ada antrean verifikasi yang menunggu pengesahan Kepala Ruang'
                  : `Tidak ada antrean verifikasi yang menunggu pengesahan ${verifierName}`
                : queueRecords.length === 0
                ? userRole === 'kepala_ruangan'
                  ? 'Belum ada pengajuan verifikasi logbook yang ditujukan kepada Kepala Ruang'
                  : `Belum ada pengajuan verifikasi logbook yang ditujukan kepada ${verifierName}`
                : 'Tidak ada data pengajuan verifikasi yang sesuai filter'}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {statusFilter === 'diajukan'
                ? 'Seluruh pengajuan yang disetujui otomatis berpindah keluar dari antrean aktif secara real-time. Pilih tab "Riwayat Terverifikasi" untuk melihat arsip pengesahan.'
                : 'Ubah kata kunci pencarian atau pilih filter status lainnya.'}
            </p>
          </div>
        ) : (
          filteredRecords.map((rec, nurseIdx) => {
            const palette = NURSE_COLOR_PALETTES[nurseIdx % NURSE_COLOR_PALETTES.length];
            const patSpoCompleted = rec.patientsSummary.reduce((acc, p) => acc + p.completed, 0);
            const patSpoTotal = rec.patientsSummary.reduce((acc, p) => acc + p.total, 0);
            const hasPatientBreakdown = rec.patientsSummary.length > 0;
            const grandCompleted = hasPatientBreakdown
              ? rec.facilityCompleted + patSpoCompleted
              : rec.rawItemsCompleted || rec.facilityCompleted;
            const grandTotal = hasPatientBreakdown
              ? rec.facilityTotal + patSpoTotal
              : rec.rawItemsTotal || OFFICIAL_LOGBOOK_ITEMS.length;
            const grandPct = grandTotal > 0 ? Math.round((grandCompleted / grandTotal) * 100) : 0;
            const verifiedPatientsCount = rec.patientsSummary.filter(
              (p) => p.status === 'terverifikasi'
            ).length;

            const waitingPatientsCount = rec.patientsSummary.filter(
              (p) => p.status === 'diajukan'
            ).length;
            const revisablePatientsCount = rec.patientsSummary.filter(
              (p) => p.status === 'diajukan' || p.status === 'terverifikasi'
            ).length;
            const canApproveDirect = !hasPatientBreakdown && rec.status === 'diajukan';
            const canReviseDirect =
              !hasPatientBreakdown && (rec.status === 'diajukan' || rec.status === 'terverifikasi');
            const isVerifiedByPjPendingKaru =
              userRole === 'kepala_ruangan' && rec.statusVerifikasi === 'verified_pj';

            const targetDisplay =
              rec.targetRole === 'kepala_ruangan' || rec.targetRole === 'mandiri'
                ? `Tujuan Kepala Ruang: ${rec.targetVerifierName}`
                : isVerifiedByPjPendingKaru
                ? `Diverifikasi PJ Shift (${rec.verifikatorPjNama || 'PJ Shift'}) · Pengesahan Kepala Ruang`
                : `Tujuan PJ Shift: ${rec.targetVerifierName}`;

            return (
              <div
                key={rec.id}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs"
              >
                {/* Top Row: Nurse Identity + Verification Status */}
                <div
                  className={`p-4 sm:p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${palette.bgHeader}`}
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 font-black text-sm tracking-wide ${palette.avatarBg}`}
                      title={`Inisial: ${getNurseInitials(rec.nurseName)}`}
                    >
                      <span>{getNurseInitials(rec.nurseName)}</span>
                    </div>

                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 tabular-nums">
                        <span
                          className={`inline-flex items-center gap-1 font-bold ${
                            rec.status === 'terverifikasi'
                              ? 'text-emerald-700'
                              : rec.status === 'diajukan'
                              ? 'text-indigo-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {rec.status === 'terverifikasi' ? (
                            <Lock className="w-3 h-3 shrink-0" />
                          ) : rec.status === 'diajukan' ? (
                            <Edit3 className="w-3 h-3 shrink-0" />
                          ) : null}
                          <span>
                            {rec.status === 'terverifikasi'
                              ? 'Terverifikasi (Terkunci)'
                              : isVerifiedByPjPendingKaru
                              ? 'Disahkan PJ Shift · Menunggu Pengesahan Ka. Ruang'
                              : rec.status === 'diajukan'
                              ? 'Menunggu Verifikasi (Dapat Diedit Verifikator)'
                              : 'Menunggu Perbaikan Perawat'}
                          </span>
                        </span>
                        <span aria-hidden="true">&middot;</span>
                        <span>Shift {rec.shift}</span>
                        <span aria-hidden="true">&middot;</span>
                        <span>{formatSubmitterRoleLabel(rec.nurseRole)}</span>
                        {hasPatientBreakdown && (
                          <>
                            <span aria-hidden="true">&middot;</span>
                            <span className="font-semibold text-slate-700">
                              {verifiedPatientsCount} dari {rec.patientsSummary.length} Pasien Disahkan
                            </span>
                          </>
                        )}
                      </div>

                      <h3 className={`text-base sm:text-lg tracking-tight font-black ${palette.nameColor}`}>
                        {rec.nurseName}
                      </h3>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 tabular-nums">
                        <span className="font-mono">NIP: {rec.nurseNip}</span>
                        <span aria-hidden="true">&middot;</span>
                        <span>{targetDisplay}</span>
                        {rec.submittedAt && (
                          <>
                            <span aria-hidden="true">&middot;</span>
                            <span>Diajukan: {rec.submittedAt}</span>
                          </>
                        )}
                        {rec.verifiedAt && (
                          <>
                            <span aria-hidden="true">&middot;</span>
                            <span className="text-emerald-700 font-semibold">
                              Disahkan: {rec.verifiedAt}
                              {rec.verifiedBy ? ` oleh ${rec.verifiedBy}` : ''}
                            </span>
                          </>
                        )}
                      </div>

                      {rec.pelaksanaNotes && (
                        <p className="text-xs text-slate-600 pt-1 italic">
                          Catatan Pengaju: &ldquo;{rec.pelaksanaNotes}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right SPO Summary & Batch Verify / Request Repair Buttons */}
                  <div className="flex flex-col md:items-end gap-2 shrink-0 tabular-nums">
                    <div className="text-sm font-black text-slate-900 font-mono text-left md:text-right">
                      {grandCompleted}/{grandTotal} SPO ({grandPct}%)
                    </div>
                    <div className="text-xs text-slate-500 text-left md:text-right">
                      Bagian I: {rec.facilityCompleted}/{rec.facilityTotal} &middot;{' '}
                      {hasPatientBreakdown
                        ? `${rec.patientsSummary.length} Pasien Kelolaan`
                        : `${grandCompleted} Poin SPO Tercatat`}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-1 self-start md:self-end">
                      {userRole !== 'administrator' &&
                        userRole !== 'managerial' &&
                        (revisablePatientsCount > 0 || canReviseDirect) && (
                          <button
                            type="button"
                            disabled={Boolean(verifyingKeyMap[`batch__${rec.id}`])}
                            onClick={() => openRevisionModal(rec)}
                            className="px-3 py-2 bg-white hover:bg-amber-50 disabled:opacity-60 text-amber-800 border border-amber-300 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                            title="Minta perawat memperbaiki kembali seluruh logbook pasien ini (membuka kunci edit)"
                          >
                            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                            <span>Minta Perbaikan Semua</span>
                          </button>
                        )}

                      {userRole !== 'administrator' &&
                        userRole !== 'managerial' &&
                        (waitingPatientsCount > 0 || canApproveDirect) && (
                          <button
                            type="button"
                            disabled={Boolean(verifyingKeyMap[`batch__${rec.id}`])}
                            onClick={() => void handleVerifyAllPatients(rec)}
                            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
                            title="Setujui & verifikasi seluruh logbook berstatus Menunggu Verifikasi sekaligus ke Cloud Firestore"
                          >
                            {verifyingKeyMap[`batch__${rec.id}`] ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            ) : (
                              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>
                              {verifyingKeyMap[`batch__${rec.id}`]
                                ? 'Memverifikasi...'
                                : hasPatientBreakdown
                                ? isVerifiedByPjPendingKaru
                                  ? `Setujui Ka. Ruang (${waitingPatientsCount})`
                                  : `Setujui & Verifikasi (${waitingPatientsCount})`
                                : isVerifiedByPjPendingKaru
                                ? 'Setujui Logbook (Ka. Ruang)'
                                : 'Setujui & Verifikasi'}
                            </span>
                          </button>
                        )}
                      {userRole === 'administrator' && (
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmTarget({ type: 'record', rec })}
                          className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                          title="Hapus logbook ini dari sistem & Cloud Firestore (khusus Administrator)"
                        >
                          <Trash2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Hapus Logbook</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Middle Row: Managed Patients Detailed Cards */}
                <div className="p-4 sm:p-5 bg-white space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-slate-700 flex items-center gap-2">
                      <ClipboardCheck className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span>Daftar Logbook Pasien Kelolaan ({rec.patientsSummary.length} Pasien)</span>
                    </h4>
                    <span className="text-[11px] text-slate-500">
                      {userRole === 'managerial'
                        ? 'Hak akses Managerial: Mode audit pengawasan. Seluruh data logbook pasien telah diverifikasi oleh PJ Shift / Kepala Ruang.'
                        : 'Verifikator (PJ Shift & Kepala Ruang) dapat mengedit logbook yang diajukan melalui tombol "Edit & Verifikasi", atau klik "Minta Perbaikan" agar perawat pengaju memperbaiki kembali.'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {rec.patientsSummary.map((pat) => {
                      const isPatVerified = pat.status === 'terverifikasi';
                      const isPatWaiting = pat.status === 'diajukan';
                      const sess = pat.session;

                      return (
                        <div
                          key={`${rec.id}-${pat.bedNumber}-${pat.id}`}
                          className={`rounded-2xl border p-4 transition-all flex flex-col justify-between gap-3 ${
                            isPatVerified
                              ? 'bg-emerald-50/30 border-emerald-300'
                              : isPatWaiting
                              ? 'bg-slate-50/50 border-slate-200 hover:border-slate-300'
                              : 'bg-amber-50/40 border-amber-300'
                          }`}
                        >
                          {/* Card Top: Bed, Name, and Status */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
                              <span className="font-mono font-bold text-blue-800">
                                {pat.bedNumber}
                                {pat.medicalRecord ? ` · RM ${pat.medicalRecord}` : ''}
                              </span>
                              {isPatVerified ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                                  <Lock className="w-3 h-3 text-emerald-600 shrink-0" />
                                  <span>Terverifikasi</span>
                                </span>
                              ) : isPatWaiting ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700">
                                  <Edit3 className="w-3 h-3 text-indigo-600 shrink-0" />
                                  <span>Menunggu Verifikasi</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                  <span>Diminta Perbaikan</span>
                                </span>
                              )}
                            </div>

                            <div className="font-black text-slate-900 text-sm leading-tight pt-0.5">
                              {pat.patientName}
                            </div>

                            {/* SPO Indicator Score */}
                            <div className="flex items-center justify-between text-[11px] pt-1 text-slate-500 font-mono tabular-nums">
                              <span>Kelengkapan SPO Bag. II–VI:</span>
                              <strong
                                className={
                                  pat.completed === pat.total ? 'text-emerald-700' : 'text-amber-700'
                                }
                              >
                                {pat.completed}/{pat.total} SPO
                              </strong>
                            </div>

                            {pat.verifierNotes && (
                              <div className="text-[11px] text-amber-900 bg-amber-50/80 border border-amber-200/80 rounded-lg px-2 py-1 mt-1 line-clamp-2">
                                <strong className="font-bold">Catatan Verifikator:</strong>{' '}
                                {pat.verifierNotes}
                              </div>
                            )}
                          </div>

                          {/* Action Buttons: Edit & Verifikasi / Lihat Detail + Minta Perbaikan / Sahkan Pasien */}
                          <div className="pt-2.5 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPatientModal({
                                  patient: pat,
                                  nurseName: rec.nurseName,
                                  nurseNip: rec.nurseNip,
                                  session: sess,
                                  shift: rec.shift,
                                  dateKey: rec.dateKey,
                                  dateLabel: rec.dateLabel
                                });
                              }}
                              className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-indigo-50 text-indigo-800 font-bold text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer border border-indigo-200 whitespace-nowrap shrink-0"
                              title={
                                isPatVerified || isMasterLogbookViewer
                                  ? 'Lihat rincian SPO Bagian I–VI logbook pasien'
                                  : 'Edit & verifikasi rincian SPO Bagian I–VI logbook pasien ini'
                              }
                            >
                              {isPatVerified || isMasterLogbookViewer ? (
                                <>
                                  <Eye className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                  <span>Lihat Detail</span>
                                </>
                              ) : (
                                <>
                                  <Edit3 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                  <span>Edit &amp; Verifikasi</span>
                                </>
                              )}
                            </button>

                            <div className="flex items-center gap-1.5 flex-wrap">
                              {userRole === 'administrator' ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteConfirmTarget({ type: 'patient', rec, pat })
                                  }
                                  className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
                                  title="Hapus logbook pasien ini dari sistem & Cloud Firestore (khusus Administrator)"
                                >
                                  <Trash2 className="w-3 h-3 shrink-0" />
                                  <span>Hapus</span>
                                </button>
                              ) : userRole === 'managerial' ? null : isPatVerified ? (
                                <button
                                  type="button"
                                  onClick={() => openRevisionModal(rec, pat)}
                                  className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-amber-50 text-amber-800 hover:text-amber-900 border border-amber-300 text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
                                  title="Minta perawat memperbaiki kembali logbook ini (membuka kunci edit)"
                                >
                                  <RotateCcw className="w-3 h-3 shrink-0" />
                                  <span>Minta Perbaikan Kembali</span>
                                </button>
                              ) : isPatWaiting ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={Boolean(verifyingKeyMap[`${rec.id}__${pat.id}`])}
                                    onClick={() => openRevisionModal(rec, pat)}
                                    className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-amber-50 disabled:opacity-60 text-amber-800 border border-amber-300 text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
                                    title="Kembalikan logbook ke perawat pengaju untuk diperbaiki kembali"
                                  >
                                    <RotateCcw className="w-3 h-3 shrink-0" />
                                    <span>Minta Perbaikan</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={Boolean(verifyingKeyMap[`${rec.id}__${pat.id}`])}
                                    onClick={() => void handleVerifyPatientApprove(rec, pat)}
                                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-[11px] flex items-center gap-1 transition-colors cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
                                    title="Setujui & verifikasi logbook pasien ini ke Cloud Firestore"
                                  >
                                    {verifyingKeyMap[`${rec.id}__${pat.id}`] ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                    ) : (
                                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                                    )}
                                    <span>
                                      {verifyingKeyMap[`${rec.id}__${pat.id}`]
                                        ? 'Memproses...'
                                        : 'Setujui'}
                                    </span>
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => openRevisionModal(rec, pat)}
                                  className="px-2.5 py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
                                  title="Perbarui catatan instruksi perbaikan untuk perawat pengaju"
                                >
                                  <MessageSquare className="w-3 h-3 shrink-0" />
                                  <span>Ubah Catatan Perbaikan</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal Minta Perbaikan Kembali (Unlocks Logbook for Submitting Nurse) */}
      {revisionModalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 bg-amber-50 border-b border-amber-200 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-amber-600 text-white shrink-0">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    Minta Perbaikan Kembali &amp; Buka Kunci Logbook
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Verifikator: <strong className="text-slate-900">{verifierName}</strong> ({verifierRoleLabel})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRevisionModalTarget(null);
                  setRevisionNoteInput('');
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-amber-100/60 cursor-pointer"
                aria-label="Tutup modal perbaikan"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmRevisionModal} className="p-5 space-y-4">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Perawat Pengaju:</span>
                  <strong className="text-slate-900 font-bold">
                    {revisionModalTarget.rec.nurseName}
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Target Logbook:</span>
                  <strong className="text-blue-900 font-bold">
                    {revisionModalTarget.patient
                      ? `${revisionModalTarget.patient.patientName} (${revisionModalTarget.patient.bedNumber})`
                      : `Seluruh Pasien (${revisionModalTarget.rec.patientsSummary.length} Pasien)`}
                  </strong>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-amber-900 leading-relaxed">
                Bagi perawat pengaju, logbook yang berstatus <strong>Menunggu Verifikasi</strong>{' '}
                maupun <strong>Sudah Diverifikasi</strong> terkunci otomatis. Mengirim permintaan
                perbaikan akan <strong>membuka kunci logbook</strong> pada halaman perawat pengaju
                sehingga dapat diedit kembali Bagian I–VI lalu diajukan ulang.
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-800">
                  Catatan / Instruksi Perbaikan untuk Perawat:
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Lengkapi parameter klinis Pre/Post HD (BB, TD, UFG)',
                    'Periksa kembali kelengkapan checklist SPO Bagian II–VI',
                    'Lengkapi dokumentasi komplikasi intra-HD & advis DPJP',
                    'Sesuaikan identitas bed / akses vaskuler pasien'
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        setRevisionNoteInput((prev) =>
                          prev.trim() ? `${prev.trim()}; ${preset}` : preset
                        )
                      }
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-900 border border-slate-200 text-[11px] font-medium transition-colors cursor-pointer text-left"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={3}
                  value={revisionNoteInput}
                  onChange={(e) => setRevisionNoteInput(e.target.value)}
                  placeholder="Tuliskan bagian atau butir SPO yang perlu diperbaiki kembali oleh perawat..."
                  className="w-full text-xs p-3 bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setRevisionModalTarget(null);
                    setRevisionNoteInput('');
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Send className="w-3.5 h-3.5 shrink-0" />
                  <span>Kirim Permintaan Perbaikan &amp; Buka Kunci</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Patient Logbook Verification Detail & Edit Modal */}
      {selectedPatientModal && (
        <PatientLogbookVerificationModal
          isOpen={!!selectedPatientModal}
          onClose={() => setSelectedPatientModal(null)}
          patient={selectedPatientModal.patient}
          nurseName={selectedPatientModal.nurseName}
          nurseNip={selectedPatientModal.nurseNip}
          masterNurses={masterNurses}
          shiftInfo={shiftInfo}
          submissionShift={selectedPatientModal.shift}
          submissionDateKey={selectedPatientModal.dateKey}
          submissionDateLabel={selectedPatientModal.dateLabel}
          userRole={userRole}
          verifierName={verifierName}
          session={selectedPatientModal.session}
          verificationStatus={selectedPatientModal.patient.status}
          verifiedAt={selectedPatientModal.patient.verifiedAt}
          verifiedBy={selectedPatientModal.patient.verifiedBy}
          verifiedByRole={selectedPatientModal.patient.verifiedByRole}
          verifierNotes={selectedPatientModal.patient.verifierNotes}
          initialScore={selectedPatientModal.patient.score}
          initialGrade={selectedPatientModal.patient.grade}
          isInitiallyCorrected={selectedPatientModal.patient.isCorrected}
          onSaveLogbookEdits={
            userRole === 'administrator'
              ? undefined
              : (payload) => {
                  const rec =
                    queueRecords.find(
                      (r) =>
                        isMatchingNurse(r.nurseName, selectedPatientModal.nurseName) &&
                        (!selectedPatientModal.dateKey ||
                          r.dateKey === selectedPatientModal.dateKey) &&
                        (!selectedPatientModal.shift || r.shift === selectedPatientModal.shift)
                    ) ||
                    queueRecords.find((r) =>
                      isMatchingNurse(r.nurseName, selectedPatientModal.nurseName)
                    );
                  if (rec) {
                    handleSavePatientLogbookEdits(rec, selectedPatientModal.patient, payload);
                  }
                }
          }
          onVerifyApprove={
            userRole === 'administrator'
              ? () => {}
              : (_patientId, notes, evaluation) => {
                  const rec =
                    queueRecords.find(
                      (r) =>
                        isMatchingNurse(r.nurseName, selectedPatientModal.nurseName) &&
                        (!selectedPatientModal.dateKey ||
                          r.dateKey === selectedPatientModal.dateKey) &&
                        (!selectedPatientModal.shift || r.shift === selectedPatientModal.shift)
                    ) ||
                    queueRecords.find((r) =>
                      isMatchingNurse(r.nurseName, selectedPatientModal.nurseName)
                    );
                  if (rec) {
                    handleVerifyPatientApprove(
                      rec,
                      selectedPatientModal.patient,
                      notes,
                      evaluation
                    );
                  }
                  setSelectedPatientModal(null);
                }
          }
          onVerifyRevise={
            userRole === 'administrator'
              ? () => {}
              : (_patientId, notes, evaluation) => {
                  const rec =
                    queueRecords.find(
                      (r) =>
                        isMatchingNurse(r.nurseName, selectedPatientModal.nurseName) &&
                        (!selectedPatientModal.dateKey ||
                          r.dateKey === selectedPatientModal.dateKey) &&
                        (!selectedPatientModal.shift || r.shift === selectedPatientModal.shift)
                    ) ||
                    queueRecords.find((r) =>
                      isMatchingNurse(r.nurseName, selectedPatientModal.nurseName)
                    );
                  if (rec) {
                    handleVerifyPatientRevise(
                      rec,
                      selectedPatientModal.patient,
                      notes,
                      evaluation
                    );
                  }
                  setSelectedPatientModal(null);
                }
          }
        />
      )}

      {/* Modal Konfirmasi Hapus Logbook (Khusus Administrator) */}
      {deleteConfirmTarget && userRole === 'administrator' && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-verified-logbook-title"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3
                  id="delete-verified-logbook-title"
                  className="text-base font-black text-slate-950"
                >
                  {deleteConfirmTarget.type === 'all'
                    ? 'Hapus Seluruh Logbook?'
                    : deleteConfirmTarget.type === 'record'
                    ? 'Hapus Logbook Perawat?'
                    : 'Hapus Logbook Pasien?'}
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {deleteConfirmTarget.type === 'all' ? (
                    <>
                      Anda akan menghapus seluruh{' '}
                      <strong>{deleteConfirmTarget.records.length}</strong> logbook yang ditampilkan
                      beserta seluruh data pasien terkait dari sistem &amp; Cloud Firestore.
                    </>
                  ) : deleteConfirmTarget.type === 'record' ? (
                    <>
                      Anda akan menghapus seluruh logbook milik{' '}
                      <strong>{deleteConfirmTarget.rec.nurseName}</strong> (Shift{' '}
                      {deleteConfirmTarget.rec.shift},{' '}
                      {deleteConfirmTarget.rec.dateLabel || deleteConfirmTarget.rec.dateKey}) dari
                      sistem &amp; Cloud Firestore.
                    </>
                  ) : (
                    <>
                      Anda akan menghapus data logbook pasien{' '}
                      <strong>{deleteConfirmTarget.pat.patientName}</strong> (
                      {deleteConfirmTarget.pat.bedNumber}) milik{' '}
                      <strong>{deleteConfirmTarget.rec.nurseName}</strong> dari sistem &amp; Cloud
                      Firestore.
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-rose-50/80 border border-rose-200 text-xs text-rose-900 leading-relaxed">
              Tindakan ini bersifat permanen. Data yang dihapus akan langsung dibersihkan dari
              Riwayat, Laporan Pasien, Laporan PJ Shift, dan Laporan Bulanan.
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isDeletingLogbook}
                onClick={() => setDeleteConfirmTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isDeletingLogbook}
                onClick={async () => {
                  if (!deleteConfirmTarget) return;
                  setIsDeletingLogbook(true);
                  try {
                    const deleteSinglePatientArtifacts = async (
                      targetRec: {
                        nurseName: string;
                        shift: string;
                        dateKey?: string;
                        dateLabel?: string;
                      },
                      pat: PatientVerificationDetail
                    ) => {
                      const dateIso =
                        targetRec.dateKey ||
                        indonesianDateLabelToIso(targetRec.dateLabel || activeDate);
                      const nurseSlug = getNurseStorageKey(targetRec.nurseName);
                      const psId = `ps-${dateIso}-${targetRec.shift}-${nurseSlug}-${pat.id}`;
                      const detId = buildDeterministicPatientSessionId({
                        tanggal: dateIso,
                        shift: targetRec.shift,
                        perawatPelaksana: targetRec.nurseName,
                        noBedMesin: pat.bedNumber,
                        noRm: pat.medicalRecord
                      });
                      const patientSessionIdsToDelete = Array.from(
                        new Set(
                          [psId, detId, pat.id, pat.session?.id].filter(
                            (v): v is string => Boolean(v && v.trim())
                          )
                        )
                      );
                      await Promise.allSettled([
                        ...patientSessionIdsToDelete.map((idToDel) =>
                          pasienLogbookService.deletePatientSession(idToDel)
                        ),
                        pasienLogbookService.deletePatientSessionsByCriteria([
                          {
                            tanggal: dateIso,
                            shift: targetRec.shift,
                            perawatPelaksana: targetRec.nurseName,
                            noBedMesin: pat.bedNumber,
                            noRm: pat.medicalRecord,
                            namaPasien: pat.patientName
                          }
                        ]),
                        pat.session?.id
                          ? deleteDialysisSessionCloud(pat.session.id)
                          : Promise.resolve()
                      ]);
                      setPendingPatientSessions((prev) =>
                        prev.filter((s) => !patientSessionIdsToDelete.includes(s.id))
                      );
                    };

                    const cleanupLocalCachesForDeletedPatients = (
                      targetRec: {
                        nurseName: string;
                        dateKey?: string;
                        dateLabel?: string;
                      },
                      deletedPatients: PatientVerificationDetail[],
                      isFullRecordDeleted: boolean
                    ) => {
                      const dateIso =
                        targetRec.dateKey ||
                        indonesianDateLabelToIso(targetRec.dateLabel || activeDate);

                      // 1. Remove per-patient verification status keys
                      setPerPatientRecords((prev) => {
                        const next = { ...prev };
                        deletedPatients.forEach((pat) => {
                          const kExact = buildPatientVerificationKey(
                            targetRec.nurseName,
                            pat.bedNumber,
                            pat.medicalRecord
                          );
                          const kNoRm = buildPatientVerificationKey(
                            targetRec.nurseName,
                            pat.bedNumber,
                            '0'
                          );
                          delete next[kExact];
                          delete next[kNoRm];
                          if (pat.id) delete next[pat.id];
                        });
                        return next;
                      });

                      try {
                        // 2. Update monthly snapshots cache for this nurse
                        const snapKey = getNurseMonthlySnapshotsKey(targetRec.nurseName);
                        const rawSnap = localStorage.getItem(snapKey);
                        if (rawSnap) {
                          const parsedSnap = JSON.parse(rawSnap);
                          if (parsedSnap && typeof parsedSnap === 'object') {
                            if (isFullRecordDeleted) {
                              delete parsedSnap[dateIso];
                            } else if (parsedSnap[dateIso]) {
                              const nextCount =
                                (parsedSnap[dateIso].verifiedPatientCount || 0) -
                                deletedPatients.length;
                              if (nextCount <= 0) {
                                delete parsedSnap[dateIso];
                              } else {
                                parsedSnap[dateIso] = {
                                  ...parsedSnap[dateIso],
                                  verifiedPatientCount: nextCount
                                };
                              }
                            }
                            if (Object.keys(parsedSnap).length === 0) {
                              localStorage.removeItem(snapKey);
                            } else {
                              localStorage.setItem(snapKey, JSON.stringify(parsedSnap));
                            }
                          }
                        }

                        // 3. Update managed patients cache for this nurse
                        const managedKey = getNurseManagedPatientsKey(targetRec.nurseName);
                        const rawManaged = localStorage.getItem(managedKey);
                        if (rawManaged) {
                          const parsedManaged = JSON.parse(rawManaged);
                          if (Array.isArray(parsedManaged)) {
                            const filteredManaged = parsedManaged.filter(
                              (mp: any) =>
                                !deletedPatients.some(
                                  (dp) =>
                                    (dp.id && mp.id === dp.id) ||
                                    (dp.bedNumber && isSameBed(mp.bedNumber, dp.bedNumber)) ||
                                    (dp.medicalRecord &&
                                      dp.medicalRecord !== '0' &&
                                      mp.medicalRecord === dp.medicalRecord)
                                )
                            );
                            if (filteredManaged.length === 0) {
                              localStorage.removeItem(managedKey);
                            } else {
                              localStorage.setItem(managedKey, JSON.stringify(filteredManaged));
                            }
                          }
                        }

                        // 4. Update nurse submission & per-patient submissions caches
                        const patSubKey = getNursePatientSubmissionsKey(targetRec.nurseName);
                        if (isFullRecordDeleted) {
                          localStorage.removeItem(patSubKey);
                          localStorage.removeItem(getNurseSubmissionKey(targetRec.nurseName));
                        } else {
                          const rawPatSub = localStorage.getItem(patSubKey);
                          if (rawPatSub) {
                            const parsedPatSub = JSON.parse(rawPatSub);
                            if (parsedPatSub && typeof parsedPatSub === 'object') {
                              deletedPatients.forEach((dp) => {
                                if (dp.id) delete parsedPatSub[dp.id];
                              });
                              localStorage.setItem(patSubKey, JSON.stringify(parsedPatSub));
                            }
                          }
                        }
                      } catch {
                        // ignore storage errors
                      }

                      // 5. Remove matching sessions from App state & Firestore
                      onDeleteSessions?.(
                        deletedPatients.map((pat) => ({
                          sessionId: pat.session?.id,
                          nurseName: targetRec.nurseName,
                          bedNumber: pat.bedNumber,
                          medicalRecord: pat.medicalRecord,
                          patientName: pat.patientName,
                          dateKey: dateIso
                        }))
                      );
                    };

                    const deleteRecordAndArtifacts = async (targetRec: {
                      id: string;
                      nurseName: string;
                      shift: string;
                      dateKey?: string;
                      dateLabel?: string;
                      patientsSummary: PatientVerificationDetail[];
                    }) => {
                      const dateIso =
                        targetRec.dateKey ||
                        indonesianDateLabelToIso(targetRec.dateLabel || activeDate);
                      await Promise.allSettled([
                        ...targetRec.patientsSummary.map((p) =>
                          deleteSinglePatientArtifacts(targetRec, p)
                        ),
                        logbookService.deleteRecordsByCriteria([
                          {
                            tanggal: dateIso,
                            shift: targetRec.shift,
                            namaPerawat: targetRec.nurseName
                          }
                        ]),
                        deleteNurseLogbookCloud(targetRec.nurseName)
                      ]);
                      await logbookService.deleteRecord(targetRec.id);
                      removeVerificationRegistryEntry(targetRec.id);
                      // Also remove any matching registry entries by nurse/shift/date so it is deleted across all roles
                      getVerificationRegistry().forEach((entry) => {
                        const entryDateIso =
                          entry.dateKey ||
                          (entry.dateLabel ? indonesianDateLabelToIso(entry.dateLabel) : '');
                        if (
                          isMatchingNurse(entry.submittedNurseName, targetRec.nurseName) &&
                          (!targetRec.shift || entry.shift === targetRec.shift) &&
                          (!dateIso || !entryDateIso || entryDateIso === dateIso)
                        ) {
                          removeVerificationRegistryEntry(entry.id);
                        }
                      });
                      cleanupLocalCachesForDeletedPatients(
                        targetRec,
                        targetRec.patientsSummary,
                        true
                      );
                    };

                    if (deleteConfirmTarget.type === 'all') {
                      for (const targetRec of deleteConfirmTarget.records) {
                        await deleteRecordAndArtifacts(targetRec);
                      }
                      const deletedIds = new Set(
                        deleteConfirmTarget.records.map((r) => r.id)
                      );
                      setPendingCloudLogbooks((prev) =>
                        prev.filter((item) => !deletedIds.has(item.id))
                      );
                      showToast(
                        `Seluruh ${deleteConfirmTarget.records.length} logbook berhasil dihapus dari sistem.`
                      );
                    } else if (deleteConfirmTarget.type === 'record') {
                      const { rec } = deleteConfirmTarget;
                      await deleteRecordAndArtifacts(rec);
                      setPendingCloudLogbooks((prev) => prev.filter((item) => item.id !== rec.id));
                      showToast(
                        `Logbook milik ${rec.nurseName} berhasil dihapus dari sistem.`
                      );
                    } else {
                      const { rec, pat } = deleteConfirmTarget;
                      await deleteSinglePatientArtifacts(rec, pat);
                      const remainingPatients = rec.patientsSummary.filter((p) => p.id !== pat.id);
                      const isNowEmpty = remainingPatients.length === 0;
                      cleanupLocalCachesForDeletedPatients(rec, [pat], isNowEmpty);
                      if (isNowEmpty) {
                        await Promise.allSettled([
                          logbookService.deleteRecord(rec.id),
                          deleteNurseLogbookCloud(rec.nurseName)
                        ]);
                        removeVerificationRegistryEntry(rec.id);
                        setPendingCloudLogbooks((prev) => prev.filter((item) => item.id !== rec.id));
                      } else {
                        const existingRec = logbookService
                          .getAllRecords()
                          .find((r) => r.id === rec.id);
                        if (existingRec) {
                          const updatedPatients = (existingRec.patients || []).filter(
                            (p) => p.id !== pat.id
                          );
                          await logbookService.saveRecord({
                            ...existingRec,
                            patients: updatedPatients,
                            updatedAt: new Date().toISOString()
                          });
                        }
                        const regList = getVerificationRegistry();
                        const matchedReg = regList.find((r) => r.id === rec.id);
                        if (matchedReg) {
                          upsertVerificationRegistryEntry({
                            ...matchedReg,
                            patients: (matchedReg.patients || []).filter((p) => p.id !== pat.id)
                          });
                        }
                      }
                      showToast(
                        `Logbook pasien ${pat.patientName} berhasil dihapus dari sistem.`
                      );
                    }
                    setServiceRecords(logbookService.getAllRecords());
                    setRegistryEntries(
                      getVerificationRegistry(masterNurses, validPjShift, validKaruShift)
                    );
                    onVerificationUpdated?.(
                      deleteConfirmTarget.type === 'all'
                        ? deleteConfirmTarget.records[0]?.nurseName || ''
                        : deleteConfirmTarget.rec.nurseName,
                      'belum_diajukan',
                      {}
                    );
                    setDeleteConfirmTarget(null);
                  } finally {
                    setIsDeletingLogbook(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {isDeletingLogbook ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{isDeletingLogbook ? 'Menghapus...' : 'Ya, Hapus Permanen'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};
