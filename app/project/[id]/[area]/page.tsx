"use client";

import { useEffect, useState, use as usePromise } from "react";
import HeaderBgStrip from "@/components/HeaderBgStrip";

type Folder = { id: string; name: string; area: string; photoCount: number };
type Project = { id: string; name: string; substationName: string };

// Defined at module scope (not inside AreaPage) so it isn't recreated as a
// new component identity on every render -- that would make React remount
// the list instead of just re-rendering it.
function AmpPickerList({
  names,
  loading,
  onPick,
}: {
  names: string[] | null;
  loading: boolean;
  onPick: (name: string) => void;
}) {
  if (loading) {
    return <div className="amp-picker-list"><div className="amp-picker-empty">Loading names from ExcelApp…</div></div>;
  }
  if (!names || names.length === 0) {
    return <div className="amp-picker-list"><div className="amp-picker-empty">No names found in ExcelApp for this project yet.</div></div>;
  }
  return (
    <div className="amp-picker-list">
      {names.map((name) => (
        <button key={name} type="button" className="amp-picker-item" onClick={() => onPick(name)}>
          {name}
        </button>
      ))}
    </div>
  );
}

export default function AreaPage({ params }: { params: Promise<{ id: string; area: string }> }) {
  const { id, area } = usePromise(params);

  const [project, setProject] = useState<Project | null>(null);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [presets, setPresets] = useState<string[] | null>(null);
  const [extraOptions, setExtraOptions] = useState<string[]>([]); // custom names added to the checklist, not yet saved
  const [open, setOpen] = useState(false);
  // Selected items: original option name -> current (possibly edited) name.
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [customDraft, setCustomDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  // Names ExcelApp already has for this same project (matched by project
  // name -- see /api/excelapp-labels), offered as a "pick instead of
  // retype" list so a folder here ends up spelled exactly like the card
  // it needs to match for the AMP photo importer. Fetched once and reused
  // for both the rename picker and the add-folder picker; `null` means
  // "not fetched yet", not "fetched and empty".
  const [ampNames, setAmpNames] = useState<string[] | null>(null);
  const [ampNamesLoading, setAmpNamesLoading] = useState(false);
  const [ampPickerFor, setAmpPickerFor] = useState<"rename" | "add" | null>(null);

  function loadFolders() {
    fetch(`/api/folders?projectId=${id}&area=${area}`)
      .then((r) => r.json())
      .then(setFolders)
      .catch(() => setFolders([]));
  }

  function loadPresets() {
    fetch(`/api/folder-presets?area=${area}`)
      .then((r) => r.json())
      .then(setPresets)
      .catch(() => setPresets([]));
  }

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setProject)
      .catch(() => setProject(null));
    loadFolders();
    loadPresets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, area]);

  // Presets stay in the list even after you've already added a folder with
  // that name -- you might want another one (e.g. a second "Breakers"
  // folder), so picking it again and editing the name should still work.
  const options = [...(presets || []), ...extraOptions].filter(
    (name, i, arr) => arr.indexOf(name) === i
  );

  function toggleOption(name: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.set(name, name);
      }
      return next;
    });
  }

  function editSelected(name: string, value: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      next.set(name, value);
      return next;
    });
  }

  function addNameToList(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!options.some((o) => o.toLowerCase() === trimmed.toLowerCase())) {
      setExtraOptions((prev) => [...prev, trimmed]);
    }
    setSelected((prev) => new Map(prev).set(trimmed, trimmed));
  }

  function addCustomToList() {
    addNameToList(customDraft);
    setCustomDraft("");
  }

  // Loads ExcelApp's names for this project on first use, then just
  // toggles the picker list open/closed on later clicks -- no need to
  // refetch every time it's opened during one visit to this page.
  async function openAmpPicker(target: "rename" | "add") {
    if (ampPickerFor === target) {
      setAmpPickerFor(null);
      return;
    }
    setAmpPickerFor(target);
    if (ampNames !== null || !project?.name) return;
    setAmpNamesLoading(true);
    try {
      const res = await fetch(`/api/excelapp-labels?project=${encodeURIComponent(project.name)}`);
      const data = await res.json();
      setAmpNames(Array.isArray(data.names) ? data.names : []);
    } catch {
      setAmpNames([]);
    } finally {
      setAmpNamesLoading(false);
    }
  }

  function pickAmpName(name: string, apply: (name: string) => void) {
    apply(name);
    setAmpPickerFor(null);
  }

  function startRename(f: Folder) {
    setRenamingId(f.id);
    setRenameValue(f.name);
    setRenameError("");
  }

  async function saveRename() {
    if (!renamingId || !renameValue.trim()) return;
    setBusy(true);
    setRenameError("");
    try {
      const res = await fetch(`/api/folders/${renamingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRenameError(data.error || "Could not rename the folder.");
        return;
      }
      setRenamingId(null);
      loadFolders();
      loadPresets();
    } catch {
      setRenameError("Could not connect. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteFolder(f: Folder) {
    const warning =
      f.photoCount > 0
        ? `Delete "${f.name}" and its ${f.photoCount} photo${f.photoCount === 1 ? "" : "s"}? This can't be undone.`
        : `Delete "${f.name}"?`;
    if (!confirm(warning)) return;
    await fetch(`/api/folders/${f.id}`, { method: "DELETE" });
    loadFolders();
  }

  async function createSelected() {
    const entries = [...selected.entries()].filter(([, v]) => v.trim());
    if (entries.length === 0) return;
    setBusy(true);
    setError("");
    try {
      for (const [, name] of entries) {
        const res = await fetch("/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: id, area, name: name.trim() }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || `Could not create "${name}".`);
          setBusy(false);
          return;
        }
      }
      setSelected(new Map());
      setExtraOptions([]);
      setOpen(false);
      loadFolders();
      loadPresets();
    } catch {
      setError("Could not connect. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="app-header">
        <HeaderBgStrip />
        <a href={`/project/${id}`} className="app-header-back">‹ {project?.substationName || "Project"}</a>
        <img src="/logo.png" alt="PrimeCore" className="app-logo" />
        <div className="app-header-spacer" />
      </header>
      <main>
        <h1>{area}</h1>
        <p className="muted">Choose an equipment folder, or add new ones.</p>

        {folders === null && <p className="muted">Loading…</p>}
        {folders && folders.length === 0 && (
          <div className="empty-state">No folders in {area} yet. Add some below.</div>
        )}
        {folders && folders.length > 0 && (
          <div className="tile-grid">
            {folders.map((f) => (
              <a key={f.id} href={`/folder/${f.id}`} className="tile">
                <span className="tile-label">{f.name}</span>
                <span className="tile-count">
                  {f.photoCount} {f.photoCount === 1 ? "photo" : "photos"}
                </span>
                <span
                  role="button"
                  aria-label={`Rename ${f.name}`}
                  className="tile-edit-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startRename(f);
                  }}
                >
                  ✎
                </span>
                <span
                  role="button"
                  aria-label={`Delete ${f.name}`}
                  className="tile-delete-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteFolder(f);
                  }}
                >
                  Delete
                </span>
              </a>
            ))}
          </div>
        )}

        {renamingId && (
          <div className="capture-card">
            <label className="field-label" htmlFor="renameInput">
              Rename folder
            </label>
            <input
              id="renameInput"
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className="amp-picker-btn"
              onClick={() => openAmpPicker("rename")}
              disabled={!project?.name}
            >
              📋 Choose from ExcelApp {ampPickerFor === "rename" ? "▴" : "▾"}
            </button>
            {ampPickerFor === "rename" && (
              <AmpPickerList
                names={ampNames}
                loading={ampNamesLoading}
                onPick={(name) => pickAmpName(name, setRenameValue)}
              />
            )}
            {renameError && <div className="error-text">{renameError}</div>}
            <button className="camera-button" onClick={saveRename} disabled={busy || !renameValue.trim()}>
              {busy ? "Saving…" : "Save name"}
            </button>
            <div style={{ height: 10 }} />
            <button
              type="button"
              className="secondary-button"
              style={{ width: "100%" }}
              onClick={() => setRenamingId(null)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        )}

        <button
          type="button"
          className="secondary-button"
          style={{ marginTop: 18, width: "100%" }}
          onClick={() => setOpen((v) => !v)}
        >
          + Add folders {selected.size > 0 ? `(${selected.size} selected)` : ""} {open ? "▴" : "▾"}
        </button>

        {open && (
          <div className="capture-card">
            <div className="preset-list">
              {options.length === 0 && <p className="muted">No presets yet — add a name below.</p>}
              {options.map((name) => {
                const isSelected = selected.has(name);
                return (
                  <label key={name} className="preset-row">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOption(name)}
                    />
                    {isSelected ? (
                      <input
                        type="text"
                        className="preset-row-input"
                        value={selected.get(name) || ""}
                        onChange={(e) => editSelected(name, e.target.value)}
                        onClick={(e) => e.preventDefault()}
                      />
                    ) : (
                      <span>{name}</span>
                    )}
                  </label>
                );
              })}
            </div>

            <label className="field-label" style={{ marginTop: 14 }} htmlFor="customDraft">
              Add a new name
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id="customDraft"
                type="text"
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                placeholder="Panel A7 (PD-3519)"
                style={{ flex: 1, marginBottom: 0 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomToList();
                  }
                }}
              />
              <button
                type="button"
                className="secondary-button"
                onClick={addCustomToList}
                disabled={!customDraft.trim()}
              >
                Add
              </button>
            </div>

            <button
              type="button"
              className="amp-picker-btn"
              style={{ marginTop: 10 }}
              onClick={() => openAmpPicker("add")}
              disabled={!project?.name}
            >
              📋 Choose from ExcelApp {ampPickerFor === "add" ? "▴" : "▾"}
            </button>
            {ampPickerFor === "add" && (
              <AmpPickerList
                names={ampNames}
                loading={ampNamesLoading}
                onPick={(name) => pickAmpName(name, addNameToList)}
              />
            )}

            {error && <div className="error-text" style={{ marginTop: 14 }}>{error}</div>}

            <button
              className="camera-button"
              style={{ marginTop: 14 }}
              onClick={createSelected}
              disabled={busy || selected.size === 0}
            >
              {busy ? "Creating…" : `Create ${selected.size || ""} folder${selected.size === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </main>
    </>
  );
}
