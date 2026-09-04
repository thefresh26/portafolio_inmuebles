import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import Screen from "./pages/Screen.js";
import Play from "./pages/Play.js";
import Host from "./pages/Host.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/play" replace />} />
        <Route path="/screen" element={<Screen />} />
        <Route path="/play" element={<Play />} />
        <Route path="/host" element={<Host />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
