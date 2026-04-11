import { useMemo, useState } from "react";
import "./App.css";

type RootRow = {
  id: number;
  name: string;
  path: string;
  isRemoving?: boolean;
};

let nextId = 2;

function App() {
  const [rows, setRows] = useState<RootRow[]>([{ id: 1, name: "", path: "" }]);

  const nonEmptyCount = useMemo(
    () => rows.filter((row) => row.name.trim() || row.path.trim()).length,
    [rows],
  );

  const updateRow = (id: number, key: "name" | "path", value: string) => {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    );
  };

  const addRow = () => {
    setRows((prev) => [...prev, { id: nextId++, name: "", path: "" }]);
  };

  const removeRow = (id: number) => {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, isRemoving: true } : row)),
    );

    window.setTimeout(() => {
      setRows((prev) => prev.filter((row) => row.id !== id));
    }, 170);
  };

  const onNext = () => {
    const normalized = rows
      .map((row) => ({ name: row.name.trim(), path: row.path.trim() }))
      .filter((row) => row.path.length > 0);
    localStorage.setItem("rmc.searchRoots", JSON.stringify(normalized));
  };

  return (
    <div className="shell">
      <main className="panel">
        <header className="panel-header">
          <h1>Configure Search Roots</h1>
          <p>Set the source folders used by Raw Minute Counter.</p>
        </header>

        <section className="roots-card">
          <div className="roots-head">
            <span>Name</span>
            <span>Path</span>
            <span aria-hidden="true"></span>
          </div>

          <div className="roots-rows">
            {rows.length === 0 ? (
              <div className="empty">No roots yet. Press + to add one.</div>
            ) : (
              rows.map((row) => (
                <div
                  key={row.id}
                  className={`root-row ${row.isRemoving ? "row-exit" : "row-enter"}`}
                >
                  <input
                    value={row.name}
                    onChange={(event) => updateRow(row.id, "name", event.target.value)}
                    placeholder="e.g. Lectures"
                    className="cell-input"
                  />
                  <input
                    value={row.path}
                    onChange={(event) => updateRow(row.id, "path", event.target.value)}
                    placeholder="\\\\server\\share\\folder"
                    className="cell-input"
                  />
                  <button
                    type="button"
                    className="delete-btn"
                    onClick={() => removeRow(row.id)}
                    aria-label="Delete row"
                  >
                    x
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <footer className="panel-actions">
          <button type="button" className="add-btn" onClick={addRow} aria-label="Add root">
            +
          </button>
          <div className="row-count">{nonEmptyCount} configured</div>
          <button type="button" className="next-btn" onClick={onNext} aria-label="Next">
            <svg viewBox="0 0 16 16">
              <line x1="3" y1="8" x2="13" y2="8"></line>
              <polyline points="9,4 13,8 9,12"></polyline>
            </svg>
          </button>
        </footer>
      </main>
    </div>
  );
}

export default App;
