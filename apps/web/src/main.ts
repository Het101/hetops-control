import { mount } from "svelte";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/pages.css";
import "./lib/prefs.js"; // applies the saved motion and density before the first paint
import App from "./App.svelte";

mount(App, { target: document.getElementById("root")! });
