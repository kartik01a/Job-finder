import { useCallback, useEffect, useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { getConfig, type AppConfig } from "./api";

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getConfig()
      .then(setConfig)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load config"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <main className="shell"><p className="banner">{error}</p></main>;
  if (!config) return <main className="shell"><p>Loading…</p></main>;
  return <Dashboard config={config} />;
}
