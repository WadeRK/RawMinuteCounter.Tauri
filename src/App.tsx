
import { type ClipboardEvent, type KeyboardEvent, type MouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type RootRow = {
  id: number;
  name: string;
  path: string;
  isAdding?: boolean;
  isRemoving?: boolean;
  testState?: "idle" | "loading" | "ok" | "bad";
};

type DragState = {
  id: number;
  offsetY: number;
  top: number;
  left: number;
  width: number;
  phase: "dragging" | "dropping";
  active: boolean;
};

type InputStatusType = "idle" | "loading" | "success" | "error";
type ScreenType = "config" | "input" | "search" | "results";
type WorkerSearchState = "waiting" | "waking" | "searching" | "done" | "unreachable";
type ResultRow = {
  order: number;
  name: string;
  found: boolean;
  folders: number;
  clips: number;
  durationMin: number;
};

type TeacherRow = {
  id: number;
  name: string;
  isAdding?: boolean;
  isRemoving?: boolean;
};

type BackendSheetRow = {
  name: string;
  row: number;
};

type LoadFromSheetBackendResponse = {
  folders: string[];
  rows: BackendSheetRow[];
};

type SearchBackendRootStatus = {
  id: number;
  state: "done" | "unreachable" | "searching" | "waking" | "waiting";
  status: string;
};

type SearchBackendResultRow = {
  order: number;
  name: string;
  found: boolean;
  folders: number;
  clips: number;
  durationMin: number;
};

type RunSearchBackendResponse = {
  elapsedSec: number;
  rootStatuses: SearchBackendRootStatus[];
  results: SearchBackendResultRow[];
};

type UpdateSheetBackendResponse = {
  updatedRows: number;
  message: string;
};

type AppConfigRoot = {
  name: string;
  path: string;
};

type AppConfigBackendResponse = {
  searchRoots: AppConfigRoot[];
  teachers: string[];
};

let nextId = 2;
let nextTeacherId = 2;

function snapshotRows(rows: RootRow[]): string {
  const normalized = rows
    .map((row) => ({ name: row.name.trim(), path: row.path.trim() }))
    .filter((row) => row.name.length > 0 || row.path.length > 0);
  return JSON.stringify(normalized);
}

function snapshotTeachers(rows: TeacherRow[]): string {
  const normalized = rows
    .map((row) => row.name.trim())
    .filter((name) => name.length > 0);
  return JSON.stringify(normalized);
}

function formatMinutesHMM(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function formatSecondsMS(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function AnimatedButtonLabel({ label, icon }: { label: string; icon?: string }) {
  const [items, setItems] = useState<Array<{ id: number; label: string; icon?: string; phase: "in" | "out" }>>([
    { id: 0, label, icon, phase: "in" },
  ]);
  const nextIdRef = useRef(1);

  useEffect(() => {
    setItems((prev) => {
      const current = prev[prev.length - 1];
      if (current && current.label === label && current.icon === icon) return prev;
      const faded = prev.map((item) => ({ ...item, phase: "out" as const }));
      return [...faded, { id: nextIdRef.current++, label, icon, phase: "in" as const }];
    });
    const timer = window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.phase === "in").slice(-1));
    }, 420);
    return () => window.clearTimeout(timer);
  }, [label, icon]);

  return (
    <span className="btn-swap-wrap" aria-live="polite">
      {items.map((item) => (
        <span key={item.id} className={`btn-swap ${item.phase === "in" ? "btn-swap-in" : "btn-swap-out"}`}>
          {item.label}
          {item.icon ? <span className="material-symbols-outlined icon-16" aria-hidden="true">{item.icon}</span> : null}
        </span>
      ))}
    </span>
  );
}

function App() {
  const [rows, setRows] = useState<RootRow[]>([{ id: 1, name: "", path: "" }]);
  const [teacherRows, setTeacherRows] = useState<TeacherRow[]>([{ id: 1, name: "" }]);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [savedTeacherSnapshot, setSavedTeacherSnapshot] = useState("");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [screen, setScreen] = useState<ScreenType>("config");
  const [configTab, setConfigTab] = useState<"roots" | "teachers">("roots");
  const [configTabFx, setConfigTabFx] = useState<"idle" | "out" | "in">("idle");
  const [screenFx, setScreenFx] = useState<"idle" | "out" | "in">("idle");
  const [windowHeight, setWindowHeight] = useState<number | null>(null);
  const [inputMode, setInputMode] = useState<"sheet" | "manual">("sheet");
  const [sheetState, setSheetState] = useState<InputStatusType>("idle");
  const [sheetMessage, setSheetMessage] = useState("Load from sheet to fetch folders");
  const [sheetFolders, setSheetFolders] = useState<string[]>([]);
  const [sheetRowMap, setSheetRowMap] = useState<Record<string, number>>({});
  const [manualInput, setManualInput] = useState("");
  const [rootReachability, setRootReachability] = useState<Record<number, "checking" | "ok" | "bad">>({});
  const [isSheetLoading, setIsSheetLoading] = useState(false);
  const [searchPercent, setSearchPercent] = useState(0);
  const [searchElapsedSec, setSearchElapsedSec] = useState(0);
  const [searchDone, setSearchDone] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "working" | "done">("idle");
  const [updateSheetState, setUpdateSheetState] = useState<"idle" | "working" | "done">("idle");
  const [workerSearchState, setWorkerSearchState] = useState<Record<number, { state: WorkerSearchState; status: string }>>({});
  const [resultsRows, setResultsRows] = useState<ResultRow[]>([]);

  const validationTimersRef = useRef<Record<number, number>>({});
  const sheetTimerARef = useRef<number | null>(null);
  const sheetTimerBRef = useRef<number | null>(null);
  const rootPingTimersRef = useRef<number[]>([]);
  const rowsRef = useRef(rows);
  const teacherRowsRef = useRef(teacherRows);
  const dragRef = useRef<DragState | null>(dragState);
  const rowPositionsRef = useRef<Record<number, number>>({});
  const savedSnapshotRef = useRef(savedSnapshot);
  const savedTeacherSnapshotRef = useRef(savedTeacherSnapshot);
  const screenFxTimerRef = useRef<number | null>(null);
  const screenFxSettleTimerRef = useRef<number | null>(null);
  const configTabFxTimerRef = useRef<number | null>(null);
  const configTabFxSettleTimerRef = useRef<number | null>(null);
  const searchTimersRef = useRef<number[]>([]);
  const searchElapsedTimerRef = useRef<number | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const mainContentRef = useRef<HTMLDivElement | null>(null);

  const isDirty = snapshotRows(rows) !== savedSnapshot || snapshotTeachers(teacherRows) !== savedTeacherSnapshot;

  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => { teacherRowsRef.current = teacherRows; }, [teacherRows]);
  useEffect(() => { dragRef.current = dragState; }, [dragState]);
  useEffect(() => { savedSnapshotRef.current = savedSnapshot; }, [savedSnapshot]);
  useEffect(() => { savedTeacherSnapshotRef.current = savedTeacherSnapshot; }, [savedTeacherSnapshot]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    if (!("__TAURI_INTERNALS__" in window)) return () => {};
    getCurrentWindow().onCloseRequested((event) => {
      const dirty =
        snapshotRows(rowsRef.current) !== savedSnapshotRef.current ||
        snapshotTeachers(teacherRowsRef.current) !== savedTeacherSnapshotRef.current;
      if (!dirty) return;
      const ok = window.confirm("You have unsaved changes. Close anyway?");
      if (!ok) event.preventDefault();
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { if (unlisten) unlisten(); };
  }, []);

  useEffect(() => {
    void invoke<AppConfigBackendResponse>("load_app_config")
      .then((cfg) => {
        const nextRoots = cfg.searchRoots.length
          ? cfg.searchRoots.map((root, index) => ({ id: index + 1, name: root.name ?? "", path: root.path ?? "", testState: "idle" as const }))
          : [{ id: 1, name: "", path: "" }];
        const nextTeachers = cfg.teachers.length
          ? cfg.teachers.map((name, index) => ({ id: index + 1, name }))
          : [{ id: 1, name: "" }];
        nextId = nextRoots.length + 1;
        nextTeacherId = nextTeachers.length + 1;
        setRows(nextRoots);
        setTeacherRows(nextTeachers);
        setSavedSnapshot(snapshotRows(nextRoots));
        setSavedTeacherSnapshot(snapshotTeachers(nextTeachers));
      })
      .catch(() => {
        const fallbackRoots = [{ id: 1, name: "", path: "" }];
        const fallbackTeachers = [{ id: 1, name: "" }];
        setRows(fallbackRoots);
        setTeacherRows(fallbackTeachers);
        setSavedSnapshot(snapshotRows(fallbackRoots));
        setSavedTeacherSnapshot(snapshotTeachers(fallbackTeachers));
      });
  }, []);

  useLayoutEffect(() => {
    const positions: Record<number, number> = {};
    rows.forEach((row) => {
      const element = document.querySelector<HTMLElement>(`.root-row[data-row-id="${row.id}"]`);
      if (!element) return;
      const top = element.getBoundingClientRect().top;
      positions[row.id] = top;
      const prevTop = rowPositionsRef.current[row.id];
      if (prevTop === undefined || dragState?.id === row.id) return;
      const delta = prevTop - top;
      if (Math.abs(delta) < 1) return;
      element.style.transition = "none";
      element.style.transform = `translateY(${delta}px)`;
      window.requestAnimationFrame(() => {
        element.style.transition = "transform 170ms cubic-bezier(.2,.8,.2,1)";
        element.style.transform = "";
      });
    });
    rowPositionsRef.current = positions;
  }, [rows, dragState?.id]);

  useEffect(() => {
    return () => {
      Object.values(validationTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      if (sheetTimerARef.current) window.clearTimeout(sheetTimerARef.current);
      if (sheetTimerBRef.current) window.clearTimeout(sheetTimerBRef.current);
      rootPingTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      if (screenFxTimerRef.current) window.clearTimeout(screenFxTimerRef.current);
      if (screenFxSettleTimerRef.current) window.clearTimeout(screenFxSettleTimerRef.current);
      if (configTabFxTimerRef.current) window.clearTimeout(configTabFxTimerRef.current);
      if (configTabFxSettleTimerRef.current) window.clearTimeout(configTabFxSettleTimerRef.current);
      searchTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      if (searchElapsedTimerRef.current) window.clearInterval(searchElapsedTimerRef.current);
    };
  }, []);

  const activeRoots = useMemo(() => {
    const chips = rows.map((row) => ({ id: row.id, label: row.name.trim() || row.path.trim() })).filter((row) => row.label.length > 0);
    return chips.length ? chips : [{ id: -1, label: "Studio 1" }, { id: -2, label: "Studio 2" }, { id: -3, label: "Studio 3" }];
  }, [rows]);

  const folderCount = inputMode === "sheet"
    ? sheetFolders.length
    : manualInput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
  const isSearchDisabled = folderCount === 0;
  const headerTitle =
    screen === "config"
      ? "Configure Search Roots"
      : screen === "input"
        ? "Footage Search"
        : screen === "search"
          ? "Searching..."
          : "Search Complete";
  const isSheetPopulated = inputMode === "sheet" && sheetState === "success" && sheetFolders.length > 0;
  const inputShellClassName = `input-shell mode-${inputMode}${inputMode === "sheet" ? ` state-${sheetState}` : ""}${isSheetPopulated ? " sheet-populated" : ""}`;
  const sourceFolders = useMemo(
    () =>
      (inputMode === "sheet"
        ? sheetFolders
        : manualInput
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)).slice(0, 24),
    [inputMode, sheetFolders, manualInput],
  );
  const totalDurationMin = resultsRows.reduce((sum, row) => sum + row.durationMin, 0);
  const videosFound = resultsRows.filter((row) => row.found).length;
  const videosTotal = sourceFolders.length || resultsRows.length;
  const orderedResults = useMemo(() => [...resultsRows].sort((a, b) => a.order - b.order), [resultsRows]);

  useEffect(() => {
    if (screen !== "input") return;
    rootPingTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    rootPingTimersRef.current = [];
    const checking: Record<number, "checking"> = {};
    activeRoots.forEach((root) => { checking[root.id] = "checking"; });
    setRootReachability(checking);
    activeRoots.forEach((root, index) => {
      const timer = window.setTimeout(() => {
        setRootReachability((prev) => ({ ...prev, [root.id]: root.id % 3 === 0 ? "bad" : "ok" }));
      }, 450 + index * 240);
      rootPingTimersRef.current.push(timer);
    });
  }, [screen, activeRoots]);

  useEffect(() => {
    if (screen !== "search") return;
    let cancelled = false;
    const rootsForSearch = rows
      .map((row) => ({ id: row.id, name: row.name.trim() || row.path.trim(), path: row.path.trim() }))
      .filter((row) => row.path.length > 0);
    const foldersForSearch = sourceFolders;

    const initial: Record<number, { state: WorkerSearchState; status: string }> = {};
    activeRoots.forEach((root) => {
      initial[root.id] = { state: "searching", status: "Searching..." };
    });
    setWorkerSearchState(initial);
    setSearchPercent(2);
    setSearchElapsedSec(0);
    setSearchDone(false);
    setResultsRows([]);
    setCopyState("idle");
    setUpdateSheetState("idle");

    const pctTimer = window.setInterval(() => {
      setSearchPercent((prev) => Math.min(92, prev + 2));
    }, 260);

    const startedAt = Date.now();

    void invoke<RunSearchBackendResponse>("run_search", {
      request: {
        roots: rootsForSearch,
        folders: foldersForSearch,
      },
    })
      .then((resp) => {
        if (cancelled) return;
        window.clearInterval(pctTimer);
        const next: Record<number, { state: WorkerSearchState; status: string }> = {};
        activeRoots.forEach((root) => {
          next[root.id] = { state: "unreachable", status: "Unreachable" };
        });
        resp.rootStatuses.forEach((root) => {
          next[root.id] = {
            state: root.state === "unreachable" ? "unreachable" : root.state === "waking" ? "waking" : "done",
            status: root.status || (root.state === "unreachable" ? "Unreachable" : "Done"),
          };
        });
        setWorkerSearchState(next);
        setResultsRows(resp.results.map((row) => ({ ...row })));
        setSearchElapsedSec(Math.max(1, resp.elapsedSec || Math.round((Date.now() - startedAt) / 1000)));
        setSearchPercent(100);
        setSearchDone(true);
      })
      .catch((err) => {
        if (cancelled) return;
        window.clearInterval(pctTimer);
        const failed: Record<number, { state: WorkerSearchState; status: string }> = {};
        activeRoots.forEach((root) => {
          failed[root.id] = { state: "unreachable", status: "Failed" };
        });
        setWorkerSearchState(failed);
        setSearchElapsedSec(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
        setSearchPercent(100);
        setSearchDone(true);
        window.alert(`Search failed: ${String(err)}`);
      });

    return () => {
      cancelled = true;
      window.clearInterval(pctTimer);
    };
  }, [screen, activeRoots, rows, sourceFolders]);

  const focusRowNameInput = (id: number) => {
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(`.root-row[data-row-id="${id}"] .name-in`);
      input?.focus();
      input?.select();
    }, 40);
  };

  const updateRow = (id: number, key: "name" | "path", value: string) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
    if (key === "path") {
      if (validationTimersRef.current[id]) window.clearTimeout(validationTimersRef.current[id]);
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, testState: value.trim() ? "loading" : "idle" } : row)));
      validationTimersRef.current[id] = window.setTimeout(() => {
        setRows((prev) =>
          prev.map((row) => {
            if (row.id !== id) return row;
            const path = row.path.trim();
            if (!path) return { ...row, testState: "idle" };
            const valid = /^([a-zA-Z]:\\|\\\\).+/.test(path);
            return { ...row, testState: valid ? "ok" : "bad" };
          }),
        );
        delete validationTimersRef.current[id];
      }, 1000);
    }
  };

  const addRow = (afterId?: number, focus = false) => {
    const id = nextId++;
    setRows((prev) => {
      const next = [...prev];
      const newRow: RootRow = { id, name: "", path: "", isAdding: true };
      if (afterId === undefined) next.push(newRow);
      else {
        const index = next.findIndex((row) => row.id === afterId);
        const insertAt = index >= 0 ? index + 1 : next.length;
        next.splice(insertAt, 0, newRow);
      }
      return next;
    });
    window.setTimeout(() => setRows((prev) => prev.map((row) => (row.id === id ? { ...row, isAdding: false } : row))), 180);
    if (focus) focusRowNameInput(id);
    return id;
  };

  const removeRow = (id: number) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, isRemoving: true } : row)));
    window.setTimeout(() => {
      setRows((prev) => {
        const filtered = prev.filter((row) => row.id !== id);
        return filtered.length ? filtered : [{ id: nextId++, name: "", path: "" }];
      });
    }, 170);
  };

  const duplicateRow = (id: number, focus = false) => {
    let newId = 0;
    setRows((prev) => {
      const index = prev.findIndex((row) => row.id === id);
      if (index < 0) return prev;
      const row = prev[index];
      newId = nextId++;
      const duplicate: RootRow = { id: newId, name: row.name, path: row.path, isAdding: true };
      const next = [...prev];
      next.splice(index + 1, 0, duplicate);
      return next;
    });
    window.setTimeout(() => setRows((prev) => prev.map((row) => (row.id === newId ? { ...row, isAdding: false } : row))), 180);
    if (focus && newId) focusRowNameInput(newId);
  };

  const duplicateTeacherRow = (id: number) => {
    let newId = 0;
    setTeacherRows((prev) => {
      const index = prev.findIndex((row) => row.id === id);
      if (index < 0) return prev;
      const row = prev[index];
      newId = nextTeacherId++;
      const duplicate: TeacherRow = { id: newId, name: row.name, isAdding: true };
      const next = [...prev];
      next.splice(index + 1, 0, duplicate);
      return next;
    });
    window.setTimeout(() => {
      setTeacherRows((prev) => prev.map((row) => (row.id === newId ? { ...row, isAdding: false } : row)));
    }, 180);
  };

  const addTeacherRow = (afterId?: number) => {
    const id = nextTeacherId++;
    setTeacherRows((prev) => {
      const next = [...prev];
      const row: TeacherRow = { id, name: "", isAdding: true };
      if (afterId === undefined) next.push(row);
      else {
        const index = next.findIndex((item) => item.id === afterId);
        const insertAt = index >= 0 ? index + 1 : next.length;
        next.splice(insertAt, 0, row);
      }
      return next;
    });
    window.setTimeout(() => {
      setTeacherRows((prev) => prev.map((item) => (item.id === id ? { ...item, isAdding: false } : item)));
    }, 180);
  };

  const removeTeacherRow = (id: number) => {
    setTeacherRows((prev) => prev.map((item) => (item.id === id ? { ...item, isRemoving: true } : item)));
    window.setTimeout(() => {
      setTeacherRows((prev) => {
        const filtered = prev.filter((item) => item.id !== id);
        return filtered.length ? filtered : [{ id: nextTeacherId++, name: "" }];
      });
    }, 170);
  };

  const updateTeacherRow = (id: number, value: string) => {
    setTeacherRows((prev) => prev.map((item) => (item.id === id ? { ...item, name: value } : item)));
  };

  const pasteTeachersIntoRows = (raw: string) => {
    const lines = raw
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return;
    const unique = Array.from(new Set(lines)).sort((a, b) => a.localeCompare(b));
    const next = unique.map((name, index) => ({ id: index + 1, name }));
    nextTeacherId = next.length + 1;
    setTeacherRows(next);
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLInputElement>, row: RootRow) => {
    if (event.key === "Enter") { event.preventDefault(); addRow(row.id, true); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateRow(row.id, true); return; }
    if (event.key === "Delete" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      const input = event.target as HTMLInputElement;
      if (input.selectionStart !== null && input.selectionEnd !== null && input.selectionStart === input.selectionEnd && input.selectionStart < input.value.length) return;
      event.preventDefault();
      removeRow(row.id);
    }
  };

  const onPointerMove = (event: globalThis.MouseEvent) => {
    const current = dragRef.current;
    if (!current) return;
    const pointerY = event.clientY;
    setDragState((prev) => (prev ? { ...prev, top: pointerY - prev.offsetY } : prev));
    const allRows = rowsRef.current;
    const moving = allRows.find((row) => row.id === current.id);
    if (!moving) return;
    const others = allRows.filter((row) => row.id !== current.id);
    const rowElements = Array.from(document.querySelectorAll<HTMLElement>(".root-row[data-row-id]")).filter((el) => Number(el.dataset.rowId) !== current.id);
    let insertAt = rowElements.length;
    for (let i = 0; i < rowElements.length; i += 1) {
      const rect = rowElements[i].getBoundingClientRect();
      if (pointerY < rect.top + rect.height / 2) { insertAt = i; break; }
    }
    const next = [...others];
    next.splice(insertAt, 0, moving);
    if (next.some((row, index) => row.id !== allRows[index]?.id)) setRows(next);
  };

  const endDrag = () => {
    document.body.classList.remove("row-dragging");
    window.removeEventListener("mousemove", onPointerMove);
    window.removeEventListener("mouseup", endDrag);
    const current = dragRef.current;
    if (!current) { setDragState(null); return; }
    const rowElement = document.querySelector<HTMLElement>(`.root-row[data-row-id="${current.id}"]`);
    if (!rowElement) { setDragState(null); dragRef.current = null; return; }
    const rect = rowElement.getBoundingClientRect();
    const dropState: DragState = { ...current, top: rect.top, left: rect.left, width: rect.width, phase: "dropping", active: false };
    setDragState(dropState);
    dragRef.current = dropState;
    window.setTimeout(() => { setDragState(null); dragRef.current = null; }, 150);
  };

  const startDrag = (id: number, event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const row = event.currentTarget.closest<HTMLElement>(".root-row");
    if (!row) return;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const next: DragState = { id, offsetY: event.clientY - rect.top, top: rect.top, left: rect.left, width: rect.width, phase: "dragging", active: false };
    setDragState(next);
    dragRef.current = next;
    window.requestAnimationFrame(() => setDragState((prev) => (prev ? { ...prev, active: true } : prev)));
    document.body.classList.add("row-dragging");
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", endDrag);
  };

  const navigateToScreen = (next: ScreenType) => {
    if (next === screen) return;
    if (screenFxTimerRef.current) window.clearTimeout(screenFxTimerRef.current);
    if (screenFxSettleTimerRef.current) window.clearTimeout(screenFxSettleTimerRef.current);
    const fromHeight = windowRef.current?.getBoundingClientRect().height;
    if (fromHeight && fromHeight > 0) setWindowHeight(fromHeight);
    setScreenFx("out");
    screenFxTimerRef.current = window.setTimeout(() => {
      setScreen(next);
      window.requestAnimationFrame(() => {
        const windowNode = windowRef.current;
        const headerNode = headerRef.current;
        const mainNode = mainRef.current;
        const contentNode = mainContentRef.current;
        let toHeight: number | undefined;
        if (windowNode && mainNode && contentNode && headerNode) {
          const mainStyle = window.getComputedStyle(mainNode);
          const winStyle = window.getComputedStyle(windowNode);
          const padTop = Number.parseFloat(mainStyle.paddingTop) || 0;
          const padBottom = Number.parseFloat(mainStyle.paddingBottom) || 0;
          const borderTop = Number.parseFloat(winStyle.borderTopWidth) || 0;
          const borderBottom = Number.parseFloat(winStyle.borderBottomWidth) || 0;
          toHeight =
            headerNode.getBoundingClientRect().height +
            padTop +
            padBottom +
            contentNode.getBoundingClientRect().height +
            borderTop +
            borderBottom;
        }
        if (toHeight && toHeight > 0) setWindowHeight(toHeight);
        setScreenFx("in");
        screenFxSettleTimerRef.current = window.setTimeout(() => {
          setScreenFx("idle");
          setWindowHeight(null);
        }, 300);
      });
    }, 190);
  };

  const onNext = () => {
    const searchRoots = rows
      .map((row) => ({ name: row.name.trim(), path: row.path.trim() }))
      .filter((row) => row.path.length > 0);
    const teachers = teacherRows
      .map((row) => row.name.trim())
      .filter((name) => name.length > 0);

    void invoke("save_app_config", {
      config: {
        searchRoots,
        teachers,
      },
    })
      .then(() => {
        setSavedSnapshot(snapshotRows(rows));
        setSavedTeacherSnapshot(snapshotTeachers(teacherRows));
        navigateToScreen("input");
      })
      .catch((err) => {
        window.alert(`Saving config failed: ${String(err)}`);
      });
  };

  const switchConfigTab = (next: "roots" | "teachers") => {
    if (next === configTab) return;
    if (configTabFxTimerRef.current) window.clearTimeout(configTabFxTimerRef.current);
    if (configTabFxSettleTimerRef.current) window.clearTimeout(configTabFxSettleTimerRef.current);
    const fromHeight = windowRef.current?.getBoundingClientRect().height;
    if (fromHeight && fromHeight > 0) setWindowHeight(fromHeight);
    setConfigTabFx("out");
    configTabFxTimerRef.current = window.setTimeout(() => {
      setConfigTab(next);
      window.requestAnimationFrame(() => {
        const windowNode = windowRef.current;
        const headerNode = headerRef.current;
        const mainNode = mainRef.current;
        const contentNode = mainContentRef.current;
        let toHeight: number | undefined;
        if (windowNode && mainNode && contentNode && headerNode) {
          const mainStyle = window.getComputedStyle(mainNode);
          const winStyle = window.getComputedStyle(windowNode);
          const padTop = Number.parseFloat(mainStyle.paddingTop) || 0;
          const padBottom = Number.parseFloat(mainStyle.paddingBottom) || 0;
          const borderTop = Number.parseFloat(winStyle.borderTopWidth) || 0;
          const borderBottom = Number.parseFloat(winStyle.borderBottomWidth) || 0;
          toHeight =
            headerNode.getBoundingClientRect().height +
            padTop +
            padBottom +
            contentNode.getBoundingClientRect().height +
            borderTop +
            borderBottom;
        }
        if (toHeight && toHeight > 0) setWindowHeight(toHeight);
        setConfigTabFx("in");
        configTabFxSettleTimerRef.current = window.setTimeout(() => {
          setConfigTabFx("idle");
          setWindowHeight(null);
        }, 280);
      });
    }, 120);
  };

  const clearInput = () => {
    setSheetFolders([]);
    setSheetRowMap({});
    setManualInput("");
    setSheetState("idle");
    setSheetMessage("Load from sheet to fetch folders");
  };

  const loadFromSheet = () => {
    if (sheetTimerARef.current) window.clearTimeout(sheetTimerARef.current);
    if (sheetTimerBRef.current) window.clearTimeout(sheetTimerBRef.current);
    setInputMode("sheet");
    setIsSheetLoading(true);
    setSheetFolders([]);
    setSheetRowMap({});
    setSheetState("loading");
    setSheetMessage("Importing from Operations Dashboard...");
    void invoke<LoadFromSheetBackendResponse>("load_from_sheet")
      .then((resp) => {
        const map: Record<string, number> = {};
        resp.rows.forEach((item) => {
          if (map[item.name] === undefined) map[item.name] = item.row;
        });
        setSheetRowMap(map);
        setSheetFolders(resp.folders);
        setSheetState("success");
        setSheetMessage(`Loaded ${resp.folders.length} folders from sheet`);
      })
      .catch((err) => {
        setSheetState("error");
        setSheetMessage(`Import failed: ${String(err)}`);
      })
      .finally(() => {
        setIsSheetLoading(false);
      });
  };

  const onManualPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!pasted) return;
    event.preventDefault();
    const normalized = pasted.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
    const textarea = event.currentTarget;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const insert = normalized.length ? normalized : "";
    const padBefore = before.length > 0 && !before.endsWith("\n") && insert.length ? "\n" : "";
    const padAfter = after.length > 0 && !after.startsWith("\n") && insert.length ? "\n" : "";
    const next = `${before}${padBefore}${insert}${padAfter}${after}`.split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
    setManualInput(next);
  };

  const startSearch = () => {
    if (!folderCount) {
      setSheetState("error");
      setSheetMessage("No folders loaded. Use Load from sheet first.");
      return;
    }
    setSheetState("success");
    setSheetMessage("Ready to start search.");
    navigateToScreen("search");
  };

  const onCopyDurations = async () => {
    const payload = orderedResults.map((row) => String(Math.max(0, Math.round(row.durationMin)))).join("\n");
    if (!payload) return;
    setCopyState("working");
    try {
      await navigator.clipboard.writeText(payload);
      setCopyState("done");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = payload;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopyState("done");
    }
  };

  const onUpdateSheet = async () => {
    setUpdateSheetState("working");
    try {
      await invoke<UpdateSheetBackendResponse>("update_sheet", {
        request: {
          rows: orderedResults.map((row) => ({ name: row.name, found: row.found, durationMin: Math.max(0, Math.round(row.durationMin)) })),
          rowMap: sheetRowMap,
        },
      });
      setUpdateSheetState("done");
    } catch (err) {
      setUpdateSheetState("idle");
      window.alert(`Sheet update failed: ${String(err)}`);
    }
  };

  useEffect(() => {
    if (screen !== "results") return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void onCopyDurations();
        return;
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Enter") {
        event.preventDefault();
        void onUpdateSheet();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screen, onCopyDurations, onUpdateSheet]);

  useEffect(() => {
    if (screen === "results") return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTypingTarget = tag === "input" || tag === "textarea" || target?.isContentEditable;

      if (screen === "config") {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          onNext();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
          event.preventDefault();
          if (configTab === "roots") addRow(undefined, true);
          else addTeacherRow();
        }
        return;
      }

      if (screen === "input") {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l" && inputMode === "sheet" && !isSheetLoading) {
          event.preventDefault();
          loadFromSheet();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          startSearch();
          return;
        }
        if (!isTypingTarget && event.key === "Escape") {
          event.preventDefault();
          clearInput();
        }
        return;
      }

      if (screen === "search" && !isTypingTarget && event.key === "Escape") {
        event.preventDefault();
        navigateToScreen("input");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screen, inputMode, isSheetLoading, onNext, startSearch, clearInput, loadFromSheet, navigateToScreen, configTab]);

  useEffect(() => {
    if (screen !== "search" || !searchDone) return;
    const timer = window.setTimeout(() => {
      navigateToScreen("results");
    }, 500);
    return () => window.clearTimeout(timer);
  }, [screen, searchDone]);

  const onMinimize = async () => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    await getCurrentWindow().minimize();
  };

  const onClose = async () => {
    if (!("__TAURI_INTERNALS__" in window)) { window.close(); return; }
    if (isDirty) {
      const ok = window.confirm("You have unsaved changes. Close anyway?");
      if (!ok) return;
    }
    await getCurrentWindow().close();
  };

  const draggingRow = dragState ? rows.find((row) => row.id === dragState.id) ?? null : null;

  return (
    <div ref={windowRef} className="window" style={windowHeight !== null ? { height: `${windowHeight}px` } : undefined}>
      <header ref={headerRef} className="header" data-tauri-drag-region>
        <span className="h-title">{headerTitle}</span>
        <div className="h-controls">
          {screen === "input" ? (
            <button type="button" className="h-btn" title="Config" onClick={() => navigateToScreen("config")}>
              <span className="material-symbols-outlined icon-18" aria-hidden="true">settings</span>
            </button>
          ) : null}
          <button type="button" className="h-btn" title="Minimize" onClick={onMinimize}>
            <span className="material-symbols-outlined icon-18" aria-hidden="true">remove</span>
          </button>
          <button type="button" className="h-btn" title="Close" onClick={onClose}>
            <span className="material-symbols-outlined icon-18" aria-hidden="true">close</span>
          </button>
        </div>
      </header>

      <main ref={mainRef} className={`main main-${screenFx}`}>
        <div ref={mainContentRef} className="main-content">
          {screen === "config" ? (
            <>
              <div className="input-shell config-shell">
                <div className="input-shell-head config-shell-head">
                  <div className="config-tabs">
                    <div className={`mode-switch mode-switch-lg ${configTab === "teachers" ? "manual" : "sheet"}`} role="tablist" aria-label="Config mode">
                      <span className="mode-indicator" aria-hidden="true"></span>
                      <button type="button" className={`mode-seg mode-seg-lg ${configTab === "roots" ? "active" : ""}`} onClick={() => switchConfigTab("roots")} aria-pressed={configTab === "roots"}>Search Roots</button>
                      <button type="button" className={`mode-seg mode-seg-lg ${configTab === "teachers" ? "active" : ""}`} onClick={() => switchConfigTab("teachers")} aria-pressed={configTab === "teachers"}>Teachers</button>
                    </div>
                  </div>
                </div>
              </div>
              <div className={`config-table-anim config-table-${configTabFx}`}>
              <section className="table-wrap">
                {configTab === "roots" ? (
                  <div className="table-head">
                    <span aria-hidden="true"></span><span>Name</span><span>Path</span><span className="actions-head">Actions</span>
                  </div>
                ) : (
                  <div className="table-head table-head-teachers">
                    <span aria-hidden="true"></span><span>Teacher Name</span><span className="actions-head">Actions</span>
                  </div>
                )}
                <div className="rows-wrap">
                  {configTab === "roots" ? (
                    rows.length === 0 ? (
                      <div className="empty-state">No roots configured - click Add Root below</div>
                    ) : rows.map((row) => {
                      const isDraggingSource = dragState?.id === row.id;
                      const hasValidationError = row.testState === "bad" && row.path.trim().length > 0;
                      return (
                        <div key={row.id} data-row-id={row.id} className={`root-row${row.isAdding ? " adding" : ""}${row.isRemoving ? " removing" : ""}${isDraggingSource ? " drag-placeholder" : ""}${hasValidationError ? " with-msg" : ""}`}>
                          <button type="button" className="drag-handle" title="Drag to reorder" onMouseDown={(event) => startDrag(row.id, event)}>
                            <span className="material-symbols-outlined icon-18" aria-hidden="true">drag_indicator</span>
                          </button>
                          <input value={row.name} onChange={(event) => updateRow(row.id, "name", event.target.value)} onKeyDown={(event) => onRowKeyDown(event, row)} placeholder="e.g. Studio 1" className="cell-in name-in" />
                          <input value={row.path} onChange={(event) => updateRow(row.id, "path", event.target.value)} onKeyDown={(event) => onRowKeyDown(event, row)} placeholder="\\S1Storage\\2026" className="cell-in" />
                          <div className="action-cell">
                            <button type="button" className={`icon-btn test-btn${row.testState === "loading" ? " test-loading" : ""}${row.testState === "ok" ? " test-ok" : ""}${row.testState === "bad" ? " test-bad" : ""}`} title="Path validation status">
                              <span className={`material-symbols-outlined icon-16${row.testState === "loading" ? " spin" : ""}`} aria-hidden="true">{row.testState === "loading" ? "autorenew" : row.testState === "bad" ? "error" : "check_circle"}</span>
                            </button>
                            <button type="button" className="icon-btn" onClick={() => duplicateRow(row.id)} title="Duplicate"><span className="material-symbols-outlined icon-16" aria-hidden="true">content_copy</span></button>
                            <button type="button" className="icon-btn del-btn" onClick={() => removeRow(row.id)} title="Remove"><span className="material-symbols-outlined icon-16" aria-hidden="true">delete</span></button>
                          </div>
                          {hasValidationError ? <div className="validation-msg">Invalid path. Use C:\... or \\server\share\...</div> : null}
                        </div>
                      );
                    })
                  ) : (
                    teacherRows.length === 0 ? (
                      <div className="empty-state">No teachers configured - click Add Teacher below</div>
                    ) : teacherRows.map((row) => (
                      <div key={row.id} className={`root-row root-row-teacher${row.isAdding ? " adding" : ""}${row.isRemoving ? " removing" : ""}`}>
                        <button type="button" className="drag-handle" title="Teacher row">
                          <span className="material-symbols-outlined icon-18" aria-hidden="true">person</span>
                        </button>
                        <input
                          value={row.name}
                          onChange={(event) => updateTeacherRow(row.id, event.target.value)}
                          onPaste={(event) => {
                            const pasted = event.clipboardData.getData("text");
                            if (pasted.includes("\n")) {
                              event.preventDefault();
                              pasteTeachersIntoRows(pasted);
                            }
                          }}
                          placeholder="Teacher name"
                          className="cell-in name-in"
                        />
                        <div className="action-cell">
                          <button type="button" className="icon-btn" onClick={() => duplicateTeacherRow(row.id)} title="Duplicate"><span className="material-symbols-outlined icon-16" aria-hidden="true">content_copy</span></button>
                          <button type="button" className="icon-btn del-btn" onClick={() => removeTeacherRow(row.id)} title="Remove"><span className="material-symbols-outlined icon-16" aria-hidden="true">delete</span></button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
              </div>
              <footer className="actions">
                {configTab === "roots" ? (
                  <button type="button" className="btn btn-ghost" onClick={() => addRow(undefined, true)}><span className="material-symbols-outlined icon-16" aria-hidden="true">add</span>Add Root</button>
                ) : (
                  <>
                    <button type="button" className="btn btn-ghost" onClick={() => addTeacherRow()}><span className="material-symbols-outlined icon-16" aria-hidden="true">add</span>Add Teacher</button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={async () => {
                        try {
                          pasteTeachersIntoRows(await navigator.clipboard.readText());
                        } catch {
                          window.alert("Clipboard access failed. Paste into a teacher field instead.");
                        }
                      }}
                    >
                      <span className="material-symbols-outlined icon-16" aria-hidden="true">content_paste</span>Paste Teachers
                    </button>
                  </>
                )}
                <div className="spacer"></div>
                <button type="button" className="btn btn-accent" onClick={onNext}>Save and continue<span className="material-symbols-outlined icon-16" aria-hidden="true">arrow_forward</span></button>
              </footer>
            </>
          ) : screen === "input" ? (
            <>
              <div>
                <div className="row-bw">
                  <div className="slabel">Active roots</div>
                </div>
                <div className="chips">{activeRoots.map((chip) => <div key={chip.id} className="chip"><div className={`cdot ${rootReachability[chip.id] ?? "checking"}`}></div>{chip.label}</div>)}</div>
              </div>
              <div className="divider"></div>
              <div className="input-block">
                <div className={inputShellClassName}>
                  <div className="input-shell-head">
                    <div className={`mode-switch mode-switch-lg ${inputMode}`} role="tablist" aria-label="Input mode">
                      <span className="mode-indicator" aria-hidden="true"></span>
                      <button type="button" className={`mode-seg mode-seg-lg ${inputMode === "sheet" ? "active" : ""}`} onClick={() => setInputMode("sheet")} aria-pressed={inputMode === "sheet"}>Import</button>
                      <button type="button" className={`mode-seg mode-seg-lg ${inputMode === "manual" ? "active" : ""}`} onClick={() => setInputMode("manual")} aria-pressed={inputMode === "manual"}>Manual</button>
                    </div>
                  </div>
                  <div className="input-shell-body">
                    <div className={`input-mode-panel sheet-panel ${inputMode === "sheet" ? "active" : ""}`} aria-hidden={inputMode !== "sheet"}>
                      <div className={`sheet-box merged ${sheetState}${!isSheetLoading ? " clickable" : ""}`} onClick={() => { if (!isSheetLoading) loadFromSheet(); }} role="button" tabIndex={inputMode === "sheet" ? 0 : -1} onKeyDown={(event) => { if (!isSheetLoading && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); loadFromSheet(); } }} aria-label="Load folders from sheet">
                        {sheetState === "loading" || sheetState === "error" || sheetState === "idle" ? (
                          <div className="sheet-center">
                            <span className={`material-symbols-outlined sheet-icon ${sheetState === "loading" ? "spin" : ""}`}>{sheetState === "loading" ? "autorenew" : sheetState === "error" ? "error" : "download"}</span>
                            <div className="sheet-msg">{sheetMessage}</div>
                            {sheetState === "error" ? <button type="button" className="btn btn-ghost sheet-retry" onClick={loadFromSheet}><span className="material-symbols-outlined icon-16" aria-hidden="true">refresh</span>Retry import</button> : null}
                          </div>
                        ) : (
                          <div className="sheet-list">{sheetFolders.map((folder) => <div key={folder} className="sheet-row">{folder}</div>)}</div>
                        )}
                      </div>
                    </div>
                    <div className={`input-mode-panel manual-panel ${inputMode === "manual" ? "active" : ""}`} aria-hidden={inputMode !== "manual"}>
                      <textarea className="fta merged" value={manualInput} onChange={(event) => setManualInput(event.target.value)} onPaste={onManualPaste} placeholder={"M3-T2-U9-L3-L4-EN-P0091-Rodaina-C13-{Vocabulary}\nM3-T2-U9-L3-L4-EN-P0091-Rodaina-C14-{Chapter 3}\nM3-T2-U9-L3-L4-EN-P0091-Rodaina--{Diverse Book Question - Lecture 8}\nM3-T2-U9-L3-L4-EN-P0091-Rodaina--{Homework - Lecture 8}"} tabIndex={inputMode === "manual" ? 0 : -1} />
                    </div>
                  </div>
                </div>
              </div>
              <footer className="actions">
                <div className="spacer"></div>
                <button type="button" className="btn btn-ghost" onClick={clearInput}>Clear</button>
                <div className="search-cta"><button type="button" className="btn btn-accent" onClick={startSearch} disabled={isSearchDisabled}>Search<span className="material-symbols-outlined icon-16">search</span></button></div>
              </footer>
            </>
          ) : screen === "search" ? (
            <>
              <div className="prog-wrap">
                <div className="prog-meta"><span className="prog-label">Overall progress</span><span className="prog-pct">{searchPercent}%</span></div>
                <div className="prog-track"><div className="prog-fill" style={{ width: `${searchPercent}%` }}></div></div>
                <div className="prog-time">{searchDone ? `Completed in ${searchElapsedSec}s` : `Elapsed: ${searchElapsedSec}s`}</div>
              </div>
              <div className="divider"></div>
              <div>
                <div className="worker-list">
                  {activeRoots.map((root) => {
                    const worker = workerSearchState[root.id] ?? { state: "waiting" as const, status: "Queued..." };
                    const icon =
                      worker.state === "done"
                        ? "check_circle"
                        : worker.state === "unreachable"
                          ? "error"
                          : worker.state === "waking"
                            ? "power"
                        : worker.state === "searching"
                          ? "autorenew"
                            : "schedule";

                    return (
                      <div key={root.id} className={`worker-row state-${worker.state}`}>
                        <div className="worker-icon">
                          <span className={`material-symbols-outlined icon-16${worker.state === "searching" ? " spin" : ""}`} aria-hidden="true">{icon}</span>
                        </div>
                        <div className="worker-info"><div className="worker-name">{root.label}</div></div>
                        <div className="worker-status worker-status-inline">{worker.status}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <footer className="actions"><div className="spacer"></div><button type="button" className="btn btn-ghost" onClick={() => navigateToScreen("input")}>Cancel</button></footer>
            </>
          ) : (
            <>
              <section className="results-wrap">
                <div className="results-summary">
                  <div className="summary-card">
                    <div className="summary-label">Total duration</div>
                    <div className="summary-value">{formatMinutesHMM(totalDurationMin)}</div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-label">Videos found</div>
                    <div className="summary-value">{`${videosFound}/${videosTotal}`}</div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-label">Search time</div>
                    <div className="summary-value">{formatSecondsMS(searchElapsedSec)}</div>
                  </div>
                </div>
                <div className="results-table-wrap">
                  <table className="results-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Name</th>
                        <th>Folders</th>
                        <th>Videos</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderedResults.map((row) => (
                        <tr key={`${row.order}-${row.name}`} className={row.found ? "" : "unfound-row"}>
                          <td>
                            <span className={`result-status-icon ${row.found ? "found" : "unfound"}`}>
                              <span className="material-symbols-outlined icon-16" aria-hidden="true">{row.found ? "check" : "close"}</span>
                            </span>
                          </td>
                          <td>{row.name}</td>
                          <td>{row.folders}</td>
                          <td>{row.clips}</td>
                          <td>{formatMinutesHMM(row.durationMin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <footer className="actions">
                <div className="spacer"></div>
                <button type="button" className="btn btn-outline" onClick={onCopyDurations} disabled={copyState === "working"}>
                  <AnimatedButtonLabel
                    label={copyState === "done" ? "Copied" : copyState === "working" ? "Copying..." : "Copy"}
                    icon={copyState === "done" ? "check" : undefined}
                  />
                </button>
                <button type="button" className="btn btn-accent" onClick={onUpdateSheet} disabled={updateSheetState === "working"}>
                  <AnimatedButtonLabel
                    label={updateSheetState === "done" ? "Sheet Updated" : updateSheetState === "working" ? "Updating Sheet..." : "Update Sheet"}
                    icon={updateSheetState === "done" ? "check" : undefined}
                  />
                </button>
              </footer>
            </>
          )}
        </div>
      </main>

      {screen === "config" && dragState && draggingRow ? (
        <div className={`root-row drag-overlay${dragState.phase === "dragging" ? " is-dragging" : " is-dropping"}${dragState.active ? " is-active" : ""}`} style={{ top: `${dragState.top}px`, left: `${dragState.left}px`, width: `${dragState.width}px` }}>
          <button type="button" className="drag-handle" tabIndex={-1}><span className="material-symbols-outlined icon-18" aria-hidden="true">drag_indicator</span></button>
          <input value={draggingRow.name} readOnly className="cell-in name-in" />
          <input value={draggingRow.path} readOnly className="cell-in" />
          <div className="action-cell">
            <button type="button" className="icon-btn test-btn" tabIndex={-1}><span className="material-symbols-outlined icon-16" aria-hidden="true">check_circle</span></button>
            <button type="button" className="icon-btn" tabIndex={-1}><span className="material-symbols-outlined icon-16" aria-hidden="true">content_copy</span></button>
            <button type="button" className="icon-btn del-btn" tabIndex={-1}><span className="material-symbols-outlined icon-16" aria-hidden="true">delete</span></button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
