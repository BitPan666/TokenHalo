import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DesignPlayground } from "./components/DesignPlayground";
import { TaskCompanionPlayground } from "./components/TaskCompanionPlayground";
import { TaskToastApp } from "./TaskToastApp";
import { resolveAppSurface } from "./lib/surface";
import "./styles.css";

const surface = resolveAppSurface(window.location.search);
const root = surface === "taskToast"
  ? <TaskToastApp />
  : surface === "taskDesigner"
    ? <TaskCompanionPlayground />
    : surface === "designer"
      ? <DesignPlayground />
      : <App />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{root}</React.StrictMode>,
);
