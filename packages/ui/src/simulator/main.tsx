import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { SimulatorApp } from "./SimulatorApp";
import "../styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element");
}

createRoot(container).render(
  <StrictMode>
    <SimulatorApp />
  </StrictMode>
);
