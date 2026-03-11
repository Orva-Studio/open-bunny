import { useEffect, useState } from "react";
import { api, type SetupStatus } from "../api";

export function useSetupStatus() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSetupStatus()
      .then(setStatus)
      .finally(() => setLoading(false));
  }, []);

  return { status, loading };
}
