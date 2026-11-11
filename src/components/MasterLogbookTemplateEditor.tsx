import React, { useState, useEffect } from 'react';
import { OfficialLogbookItem } from '../types/dialysis.ts';
import {
  OFFICIAL_LOGBOOK_ITEMS,
  DEFAULT_OFFICIAL_LOGBOOK_ITEMS,
  applyLogbookTemplateItems,
  resetLogbookTemplateToDefault
} from '../data/officialPelaksanaLogbookData.ts';
import { saveLogbookTemplateCloud } from '../services/firebase.ts';
import {
  Save,
  RotateCcw,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  BookOpen,
  Layers,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

function toRoman(num: number): string {
  const map: Array<[number, string]> = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I']
  ];
  let n = Math.max(1, Math.floor(num));
  let res = '';
  for (const [val, sym] of map) {
    while (n >= val) {
      res += sym;
      n -= val;
    }
  }
  return res;
}

export const MasterLogbookTemplateEditor: React.FC = () => {
  const [items, setItems] = useState<OfficialLogbookItem[]>(() =>
    OFFICIAL_LOGBOOK_ITEMS.map((it) => ({ ...it }))
  );
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<OfficialLogbookItem | null>(null);

  const [editingBagianNum, setEditingBagianNum] = useState<number | null>(null);
  const [bagianTitleDraft, setBagianTitleDraft] = useState<string>('');

  const [addingToBagian, setAddingToBagian] = useState<number | null>(null);
  const [newPointDraft, setNewPointDraft] = useState<{
    code: string;
    category: string;
    shortTitle: string;
    simpleGuide: string;
    description: string;
    standardSpo: string;
  }>({
    code: '',
    category: '',
    shortTitle: '',
    simpleGuide: '',
    description: '',
    standardSpo: ''
  });

  const [isAddingBagian, setIsAddingBagian] = useState(false);
  const [newBagianTitle, setNewBagianTitle] = useState('');
  const [newBagianFirstPoint, setNewBagianFirstPoint] = useState('');

  const [confirmDeleteCode, setConfirmDeleteCode] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    setItems(OFFICIAL_LOGBOOK_ITEMS.map((it) => ({ ...it })));
  }, []);

  // Group items by Bagian number
  const bagianGroups = React.useMemo(() => {
    const map = new Map<
      number,
      { num: number; title: string; items: OfficialLogbookItem[] }
    >();
    items.forEach((it) => {
      const existing = map.get(it.bagian);
      if (existing) {
        existing.items.push(it);
        if (!existing.title && it.bagianTitle) {
          existing.title = it.bagianTitle;
        }
      } else {
        map.set(it.bagian, {
          num: it.bagian,
          title: it.bagianTitle || `Bagian ${it.bagian}`,
          items: [it]
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.num - b.num);
  }, [items]);

  const persistTemplate = async (nextItems: OfficialLogbookItem[], message: string) => {
    setIsSaving(true);
    setSaveNotice(null);
    try {
      applyLogbookTemplateItems(nextItems);
      await saveLogbookTemplateCloud(nextItems);
      setSaveNotice(message);
      setTimeout(() => setSaveNotice(null), 4500);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveBagianTitle = async (bagianNum: number) => {
    const cleanTitle = bagianTitleDraft.trim();
    if (!cleanTitle) return;
    const nextItems = items.map((it) =>
      it.bagian === bagianNum ? { ...it, bagianTitle: cleanTitle } : it
    );
    setItems(nextItems);
    setEditingBagianNum(null);
    await persistTemplate(
      nextItems,
      `Judul Bagian ${toRoman(bagianNum)} diperbarui & disinkronkan ke seluruh hak akses.`
    );
  };

  const handleStartEditPoint = (item: OfficialLogbookItem) => {
    setEditingCode(item.code);
    setEditDraft({ ...item });
    setConfirmDeleteCode(null);
  };

  const handleSaveEditPoint = async () => {
    if (!editDraft || !editingCode) return;
    const cleanShortTitle = (editDraft.shortTitle || '').trim();
    if (!cleanShortTitle) return;
    const nextItems = items.map((it) =>
      it.code === editingCode
        ? {
            ...editDraft,
            shortTitle: cleanShortTitle,
            category: (editDraft.category || '').trim() || 'Standar Asuhan HD',
            simpleGuide: (editDraft.simpleGuide || '').trim() || cleanShortTitle,
            description: (editDraft.description || '').trim() || cleanShortTitle,
            standardSpo: (editDraft.standardSpo || '').trim() || `SPO-HD-${editDraft.code}`
          }
        : it
    );
    setItems(nextItems);
    setEditingCode(null);
    setEditDraft(null);
    await persistTemplate(
      nextItems,
      `Poin ${editDraft.code} berhasil diperbarui untuk Kepala Ruang, PJ Shift & Perawat Pelaksana.`
    );
  };

  const handleOpenAddPoint = (bagianNum: number) => {
    const existingInBagian = items.filter((it) => it.bagian === bagianNum);
    const nextSubNum = existingInBagian.length + 1;
    let candidateCode = `${bagianNum}.${nextSubNum}`;
    let counter = nextSubNum;
    while (items.some((it) => it.code === candidateCode)) {
      counter += 1;
      candidateCode = `${bagianNum}.${counter}`;
    }
    setAddingToBagian(bagianNum);
    setNewPointDraft({
      code: candidateCode,
      category: '',
      shortTitle: '',
      simpleGuide: '',
      description: '',
      standardSpo: `SPO-HD-${candidateCode}`
    });
  };

  const handleSaveNewPoint = async (bagianNum: number, bagianTitle: string) => {
    const cleanTitle = newPointDraft.shortTitle.trim();
    const cleanCode = newPointDraft.code.trim();
    if (!cleanTitle || !cleanCode) return;
    if (items.some((it) => it.code === cleanCode)) return;

    const newItem: OfficialLogbookItem = {
      code: cleanCode,
      bagian: bagianNum,
      bagianTitle,
      category: newPointDraft.category.trim() || 'Indikator Tambahan Unit HD',
      shortTitle: cleanTitle,
      simpleGuide: newPointDraft.simpleGuide.trim() || cleanTitle,
      keyMetrics: [cleanTitle],
      notePlaceholder: `Catat hasil pelaksanaan ${cleanTitle}...`,
      quickNotes: [`${cleanTitle} terlaksana sesuai SPO`],
      description: newPointDraft.description.trim() || cleanTitle,
      standardSpo: newPointDraft.standardSpo.trim() || `SPO-HD-${cleanCode}`
    };

    const nextItems = [...items, newItem];
    setItems(nextItems);
    setAddingToBagian(null);
    await persistTemplate(
      nextItems,
      `Poin baru ${cleanCode} ditambahkan ke Bagian ${toRoman(bagianNum)} & aktif di semua peran.`
    );
  };

  const handleDeletePoint = async (code: string) => {
    if (items.length <= 1) return;
    const nextItems = items.filter((it) => it.code !== code);
    setItems(nextItems);
    setConfirmDeleteCode(null);
    await persistTemplate(
      nextItems,
      `Poin ${code} dihapus dari template Master Logbook.`
    );
  };

  const handleAddNewBagian = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanBagianTitle = newBagianTitle.trim();
    const cleanFirstPoint = newBagianFirstPoint.trim();
    if (!cleanBagianTitle || !cleanFirstPoint) return;

    // Bagian 7 is reserved for Verifikasi in Logbook5ButtonsView, so skip 7 if next is 7
    const maxBagian = items.reduce((max, it) => Math.max(max, it.bagian), 6);
    const nextBagianNum = maxBagian + 1 === 7 ? 8 : maxBagian + 1;
    const firstCode = `${nextBagianNum}.1`;

    const newItem: OfficialLogbookItem = {
      code: firstCode,
      bagian: nextBagianNum,
      bagianTitle: cleanBagianTitle,
      category: cleanBagianTitle,
      shortTitle: cleanFirstPoint,
      simpleGuide: cleanFirstPoint,
      keyMetrics: [cleanFirstPoint],
      notePlaceholder: `Catat hasil ${cleanFirstPoint}...`,
      quickNotes: [`${cleanFirstPoint} sesuai standar`],
      description: cleanFirstPoint,
      standardSpo: `SPO-HD-${firstCode}`
    };

    const nextItems = [...items, newItem];
    setItems(nextItems);
    setIsAddingBagian(false);
    setNewBagianTitle('');
    setNewBagianFirstPoint('');
    await persistTemplate(
      nextItems,
      `Bagian ${toRoman(nextBagianNum)} (${cleanBagianTitle}) ditambahkan & disinkronkan.`
    );
  };

  const handleResetToDefault = async () => {
    resetLogbookTemplateToDefault();
    const defaults = DEFAULT_OFFICIAL_LOGBOOK_ITEMS.map((it) => ({ ...it }));
    setItems(defaults);
    setConfirmReset(false);
    setEditingCode(null);
    setEditingBagianNum(null);
    setAddingToBagian(null);
    await persistTemplate(
      defaults,
      'Struktur Bagian & 29 Poin Logbook dikembalikan ke standar baku KARS & PERNEFRI.'
    );
  };

  return (
    <div className="space-y-5">
      {/* Header & Action Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
              <span className="font-bold text-indigo-700">Template Master Logbook</span>
              <span aria-hidden="true">&middot;</span>
              <span>{bagianGroups.length} Bagian</span>
              <span aria-hidden="true">&middot;</span>
              <span>{items.length} Poin Indikator SPO</span>
            </div>
            <h3 className="text-base sm:text-lg font-black text-slate-900">
              Pengaturan Bagian &amp; Poin Logbook Keperawatan HD
            </h3>
            <p className="text-xs text-slate-500 max-w-3xl">
              Perubahan judul Bagian atau rincian Poin Logbook di sini otomatis diterapkan pada tampilan{' '}
              <strong className="text-slate-700">Kepala Ruang</strong>,{' '}
              <strong className="text-slate-700">PJ Shift</strong>, dan{' '}
              <strong className="text-slate-700">Perawat Pelaksana</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsAddingBagian((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Bagian Baru</span>
            </button>

            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Standar Baku</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl text-xs">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="font-semibold text-amber-900">Reset ke 29 poin standar?</span>
                <button
                  type="button"
                  onClick={() => void handleResetToDefault()}
                  disabled={isSaving}
                  className="px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold cursor-pointer"
                >
                  Ya, Reset
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-2 py-0.5 bg-white border border-slate-200 text-slate-600 rounded-lg font-semibold cursor-pointer"
                >
                  Batal
                </button>
              </div>
            )}
          </div>
        </div>

        {saveNotice && (
          <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{saveNotice}</span>
          </div>
        )}

        {/* Form Tambah Bagian Baru */}
        {isAddingBagian && (
          <form
            onSubmit={(e) => void handleAddNewBagian(e)}
            className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-indigo-600" />
                <span>Tambah Bagian Logbook Baru</span>
              </h4>
              <button
                type="button"
                onClick={() => setIsAddingBagian(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Judul Bagian Baru <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={newBagianTitle}
                  onChange={(e) => setNewBagianTitle(e.target.value)}
                  placeholder="contoh: Pengelolaan Limbah Medis & Linen Infeksius"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-900"
                  required
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Judul Poin Pertama <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={newBagianFirstPoint}
                  onChange={(e) => setNewBagianFirstPoint(e.target.value)}
                  placeholder="contoh: Pemilahan limbah infeksius & benda tajam sesuai warna"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-900"
                  required
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setIsAddingBagian(false)}
                className="px-3.5 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-xl font-bold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold cursor-pointer"
              >
                Simpan Bagian Baru
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Daftar Bagian & Poin Logbook */}
      <div className="space-y-4">
        {bagianGroups.map((group) => {
          const isEditingThisBagian = editingBagianNum === group.num;

          return (
            <div
              key={group.num}
              className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs"
            >
              {/* Bagian Header */}
              <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums mb-0.5">
                    <span className="font-extrabold text-indigo-700">
                      BAGIAN {toRoman(group.num)}
                    </span>
                    <span aria-hidden="true">&middot;</span>
                    <span>{group.items.length} Poin Indikator</span>
                  </div>

                  {isEditingThisBagian ? (
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <input
                        type="text"
                        value={bagianTitleDraft}
                        onChange={(e) => setBagianTitleDraft(e.target.value)}
                        className="flex-1 min-w-[240px] px-3 py-1.5 bg-white border border-indigo-400 rounded-xl text-xs sm:text-sm font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSaveBagianTitle(group.num)}
                        disabled={isSaving}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Simpan Judul</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingBagianNum(null)}
                        className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 rounded-xl text-xs font-bold cursor-pointer"
                      >
                        Batal
                      </button>
                    </div>
                  ) : (
                    <h4 className="text-sm sm:text-base font-black text-slate-900 leading-snug">
                      {group.title}
                    </h4>
                  )}
                </div>

                {!isEditingThisBagian && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingBagianNum(group.num);
                        setBagianTitleDraft(group.title);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold cursor-pointer transition-colors whitespace-nowrap"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit Judul Bagian</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenAddPoint(group.num)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold cursor-pointer transition-colors whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah Poin</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Form Tambah Poin Baru di Bagian Ini */}
              {addingToBagian === group.num && (
                <div className="p-4 bg-indigo-50/50 border-b border-indigo-200 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-indigo-950">
                      Tambah Poin Baru pada BAGIAN {toRoman(group.num)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAddingToBagian(null)}
                      className="text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        Kode Poin <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={newPointDraft.code}
                        onChange={(e) =>
                          setNewPointDraft({ ...newPointDraft, code: e.target.value })
                        }
                        placeholder="contoh: 1.4"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono font-bold text-slate-900"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block font-bold text-slate-700 mb-1">
                        Nama / Judul Poin Logbook <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={newPointDraft.shortTitle}
                        onChange={(e) =>
                          setNewPointDraft({ ...newPointDraft, shortTitle: e.target.value })
                        }
                        placeholder="contoh: Verifikasi Suhu & Konduktivitas Dialisat Sebelum Priming"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-semibold text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        Kategori / Sub-Topik
                      </label>
                      <input
                        type="text"
                        value={newPointDraft.category}
                        onChange={(e) =>
                          setNewPointDraft({ ...newPointDraft, category: e.target.value })
                        }
                        placeholder="contoh: Keselamatan Mesin HD"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        Kode Referensi SPO
                      </label>
                      <input
                        type="text"
                        value={newPointDraft.standardSpo}
                        onChange={(e) =>
                          setNewPointDraft({ ...newPointDraft, standardSpo: e.target.value })
                        }
                        placeholder="contoh: SPO-HD-21"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        Panduan Singkat Perawat
                      </label>
                      <input
                        type="text"
                        value={newPointDraft.simpleGuide}
                        onChange={(e) =>
                          setNewPointDraft({ ...newPointDraft, simpleGuide: e.target.value })
                        }
                        placeholder="Instruksi singkat pelaksanaan..."
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-slate-900"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setAddingToBagian(null)}
                      className="px-3.5 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-xl font-bold cursor-pointer"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveNewPoint(group.num, group.title)}
                      disabled={isSaving || !newPointDraft.shortTitle.trim() || !newPointDraft.code.trim()}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Simpan Poin Baru</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Daftar Poin dalam Bagian */}
              <div className="divide-y divide-slate-100">
                {group.items.map((item) => {
                  const isEditingThisPoint = editingCode === item.code && editDraft;
                  const isConfirmingDelete = confirmDeleteCode === item.code;

                  return (
                    <div key={item.code} className="p-4 hover:bg-slate-50/70 transition-colors">
                      {isEditingThisPoint && editDraft ? (
                        <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-indigo-200 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-black text-indigo-950 flex items-center gap-1.5">
                              <BookOpen className="w-4 h-4 text-indigo-600" />
                              <span>Edit Poin Logbook {item.code}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCode(null);
                                setEditDraft(null);
                              }}
                              className="text-slate-400 hover:text-slate-600 cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="md:col-span-2">
                              <label className="block font-bold text-slate-700 mb-1">
                                Judul / Nama Poin Logbook <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="text"
                                value={editDraft.shortTitle}
                                onChange={(e) =>
                                  setEditDraft({ ...editDraft, shortTitle: e.target.value })
                                }
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-semibold text-slate-900 focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>
                            <div>
                              <label className="block font-bold text-slate-700 mb-1">
                                Kategori / Sub-Topik
                              </label>
                              <input
                                type="text"
                                value={editDraft.category}
                                onChange={(e) =>
                                  setEditDraft({ ...editDraft, category: e.target.value })
                                }
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>
                            <div className="md:col-span-2">
                              <label className="block font-bold text-slate-700 mb-1">
                                Panduan Singkat Pelaksanaan
                              </label>
                              <input
                                type="text"
                                value={editDraft.simpleGuide}
                                onChange={(e) =>
                                  setEditDraft({ ...editDraft, simpleGuide: e.target.value })
                                }
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>
                            <div>
                              <label className="block font-bold text-slate-700 mb-1">
                                Referensi Standar SPO
                              </label>
                              <input
                                type="text"
                                value={editDraft.standardSpo}
                                onChange={(e) =>
                                  setEditDraft({ ...editDraft, standardSpo: e.target.value })
                                }
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono text-slate-900 focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>
                          </div>

                          <div className="flex justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCode(null);
                                setEditDraft(null);
                              }}
                              className="px-3.5 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-xl font-bold cursor-pointer"
                            >
                              Batal
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSaveEditPoint()}
                              disabled={isSaving || !(editDraft.shortTitle || '').trim()}
                              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold cursor-pointer"
                            >
                              <Save className="w-3.5 h-3.5" />
                              <span>Simpan Perubahan Poin</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <span className="font-mono text-xs font-black text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg shrink-0 tabular-nums">
                              {item.code}
                            </span>
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="text-xs sm:text-sm font-bold text-slate-900">
                                {item.shortTitle}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                                <span className="font-semibold text-slate-600">{item.category}</span>
                                <span aria-hidden="true">&middot;</span>
                                <span className="font-mono">{item.standardSpo}</span>
                              </div>
                              {item.simpleGuide && (
                                <p className="text-xs text-slate-500 leading-relaxed pt-0.5">
                                  {item.simpleGuide}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                            <button
                              type="button"
                              onClick={() => handleStartEditPoint(item)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Edit</span>
                            </button>

                            {!isConfirmingDelete ? (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteCode(item.code)}
                                disabled={items.length <= 1}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-xl text-xs font-bold cursor-pointer transition-colors disabled:opacity-40"
                                title="Hapus poin logbook"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <div className="inline-flex items-center gap-1 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-xl text-xs">
                                <button
                                  type="button"
                                  onClick={() => void handleDeletePoint(item.code)}
                                  className="px-2 py-0.5 bg-rose-600 text-white rounded-lg font-bold cursor-pointer"
                                >
                                  Hapus
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteCode(null)}
                                  className="px-2 py-0.5 bg-white text-slate-600 border border-slate-200 rounded-lg font-semibold cursor-pointer"
                                >
                                  Batal
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
