import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AcousticAI from "./components/AcousticAI";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AcousticAI />
  </StrictMode>
);
