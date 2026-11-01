import { useEffect, useState } from "react";

import { subscribeLive } from "../api";

export function useLiveWeight(): number | null {
  const [weightKg, setWeightKg] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeLive({
      onConnectionChange: () => {},
      onMessage: (message) => {
        if (
          message.type === "measurement.measuring" ||
          message.type === "measurement.completed"
        ) {
          setWeightKg(message.payload.weight / 100);
        }
      },
    });

    return unsubscribe;
  }, []);

  return weightKg;
}
