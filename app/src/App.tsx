import { PushToTalk } from "./components/PushToTalk";
import "./App.css";

export default function App() {
  return (
    <main className="orole-main">
      <h1 className="orole-title">OROLE-OS</h1>
      <p className="orole-sub">Voice interface — hold the button (or space bar) and speak.</p>
      <PushToTalk />
    </main>
  );
}
