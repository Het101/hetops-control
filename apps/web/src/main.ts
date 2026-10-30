import { mount } from "svelte";
import "./styles/tokens.css";
import "./lib/prefs.js"; // applies the saved motion and density before the first paint
import App from "./App.svelte";

mount(App, { target: document.getElementById("root")! });
