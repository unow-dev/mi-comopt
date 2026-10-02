import React from "react";
import ReactDOM from "react-dom/client";
import App from "./ui/App.jsx";
import faviconUrl from "./ui/images/favicon.ico";
import "./ui/index.css";

const favicon = document.querySelector('link[rel="icon"]') ?? document.createElement("link");
favicon.rel = "icon";
favicon.href = faviconUrl;
document.head.appendChild(favicon);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
